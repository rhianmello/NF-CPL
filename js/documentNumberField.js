/* Campo obrigatório para o número da NF/NF-e/recibo/comanda.
 * Também tenta localizar automaticamente o número no OCR, priorizando
 * os padrões reais de NFC-e/NF-e/DANFE e deixando o usuário corrigir.
 */
(function () {
  'use strict';

  const pendingNumbers = [];
  const readingCards = new WeakSet();
  let installed = false;

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function labelForType(type) {
    const t = String(type || '').toUpperCase();
    if (t === 'RECIBO') return 'Nº do Recibo';
    if (t === 'COMANDA') return 'Nº da Comanda';
    if (t === 'NOTA FISCAL' || t === 'DANFE') return 'Nº NF / NF-e';
    return 'Nº do Documento';
  }

  function addStyles() {
    if (document.getElementById('document-number-field-style')) return;
    const style = document.createElement('style');
    style.id = 'document-number-field-style';
    style.textContent = `
      .doc-number-field { margin: 10px 0 14px; }
      .doc-number-field label { display:block; margin-bottom:6px; }
      .doc-number-field input { width:100%; box-sizing:border-box; }
      .doc-number-field__hint { display:block; margin-top:5px; font-size:.82rem; opacity:.72; }
      .doc-number-field__hint.is-reading { opacity:.9; }
      .doc-number-field.is-invalid input { border-color:#d9534f !important; box-shadow:0 0 0 2px rgba(217,83,79,.12); }
      .doc-number-field.is-invalid .doc-number-field__hint { color:#c0392b; opacity:1; font-weight:600; }
      .doc-number-field.is-found input { border-color:#4d9a61 !important; box-shadow:0 0 0 2px rgba(77,154,97,.12); }
    `;
    document.head.appendChild(style);
  }

  function cardType(card) {
    return card.querySelector('[data-field="numDoc"]')?.value || '';
  }

  function injectCard(card) {
    if (!card || card.querySelector('[data-field="numeroDoc"]')) return;
    const supplier = card.querySelector('[data-field="fornecedor"]');
    if (!supplier) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'field doc-number-field';
    wrapper.innerHTML = `
      <label>${escapeHtml(labelForType(cardType(card)))}</label>
      <input type="text" data-field="numeroDoc" inputmode="numeric" autocomplete="off" placeholder="Número do documento" required>
      <small class="doc-number-field__hint">Tentando localizar o número no documento…</small>
    `;
    supplier.closest('.field')?.insertAdjacentElement('beforebegin', wrapper);

    const input = wrapper.querySelector('[data-field="numeroDoc"]');
    const typeSelect = card.querySelector('[data-field="numDoc"]');
    const refreshLabel = () => {
      wrapper.querySelector('label').textContent = labelForType(typeSelect?.value);
      if (!input.value.trim()) {
        wrapper.classList.remove('is-invalid', 'is-found');
        wrapper.querySelector('.doc-number-field__hint').textContent = 'Tentando localizar o número no documento…';
      }
    };
    typeSelect?.addEventListener('change', refreshLabel);
    input.addEventListener('input', () => {
      if (input.value.trim()) {
        wrapper.classList.remove('is-invalid');
        wrapper.classList.add('is-found');
        wrapper.querySelector('.doc-number-field__hint').textContent = 'Número conferido/editado pelo usuário.';
      }
    });

    scheduleNumberRead(card);
  }

  function injectAll() {
    document.querySelectorAll('.doc-card').forEach(injectCard);
  }

  function normalizeOcr(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .toUpperCase()
      .replace(/[º°ª]/g, 'O')
      .replace(/[|]/g, 'I')
      .replace(/[\\u2013\\u2014]/g, '-')
      .replace(/\\s+/g, ' ');
  }

  function cleanCandidate(value) {
    const v = String(value || '').replace(/\\D/g, '');
    if (!v || v.length > 12) return '';
    if (/^0+$/.test(v)) return '';
    return v;
  }

  function extractNumber(text, type) {
    const raw = String(text || '');
    const n = normalizeOcr(raw);
    const lines = raw.split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
    const normalizedLines = lines.map(normalizeOcr);
    const patterns = [
      /NFC\\s*-?\\s*E\\s*(?:N\\s*O|N\\s*O|NO|N)?\\s*[:#-]?\\s*(\\d{1,12})\\b/,
      /NFC\\s*-?\\s*E[^0-9]{0,18}(\\d{1,12})\\b/,
      /(?:NUMERO|NUM|N)\\s*(?:DA\\s*)?(?:NF|NFE|NFC\\s*-?\\s*E|NOTA(?:\\s+FISCAL)?)?\\s*(?:N\\s*O|NO|N)?\\s*[:#-]\\s*(\\d{1,12})\\b/,
      /(?:NOTA(?:\\s+FISCAL)?|NF[- ]?E|NFE)[^0-9]{0,25}(?:NUMERO|N\\s*O|NO|N)?[^0-9]{0,8}(\\d{1,12})\\b/,
      /\\bN\\s*[º°O]?\\s*[:#-]?\\s*(\\d{1,12})\\b/
    ];

    const searchTexts = [...normalizedLines, n];
    for (const line of searchTexts) {
      for (const pattern of patterns) {
        const m = line.match(pattern);
        if (m) {
          const candidate = cleanCandidate(m[m.length - 1]);
          if (candidate) return candidate;
        }
      }
    }

    // NFC-e frequentemente aparece como "NFC-e nº 000065". Se o OCR separar
    // o rótulo do número em duas linhas, procura o primeiro número curto logo depois.
    for (let i = 0; i < normalizedLines.length; i++) {
      if (/NFC\\s*-?\\s*E|NOTA\\s+FISCAL|NFE/.test(normalizedLines[i])) {
        const windowText = normalizedLines.slice(i, i + 3).join(' ');
        const nums = windowText.match(/\\b\\d{1,12}\\b/g) || [];
        for (const num of nums) {
          const candidate = cleanCandidate(num);
          if (candidate && candidate.length <= 8) return candidate;
        }
      }
    }

    return '';
  }

  function dataUrlFromCard(card) {
    const thumb = card.querySelector('.doc-card__thumb');
    if (!thumb) return '';
    const bg = getComputedStyle(thumb).backgroundImage || thumb.style.backgroundImage || '';
    const m = bg.match(/url\\(["']?(.*?)["']?\\)/);
    return m ? m[1] : '';
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagem indisponível'));
      img.src = dataUrl;
    });
  }

  function cropToCanvas(img, top, height) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1.8, 1800 / img.width);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, Math.round(img.height * top), img.width, Math.round(img.height * height), 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function readNumberFromCard(card) {
    const input = card.querySelector('[data-field="numeroDoc"]');
    const wrapper = card.querySelector('.doc-number-field');
    const hint = wrapper?.querySelector('.doc-number-field__hint');
    if (!input || input.value.trim() || readingCards.has(card) || typeof OcrEngine === 'undefined') return;
    readingCards.add(card);

    try {
      const dataUrl = dataUrlFromCard(card);
      if (!dataUrl) throw new Error('imagem não encontrada');
      const img = await loadImage(dataUrl);
      const regions = [
        cropToCanvas(img, 0.52, 0.48),
        cropToCanvas(img, 0.00, 0.55),
        cropToCanvas(img, 0.20, 0.60)
      ];
      let found = '';
      for (const region of regions) {
        if (hint) hint.textContent = 'Lendo especificamente o número…';
        try {
          const result = await OcrEngine.recognize(region, null, 12000);
          found = extractNumber(result?.text || '', cardType(card));
          if (found) break;
        } catch (_) {}
      }
      if (found && !input.value.trim()) {
        input.value = found;
        wrapper.classList.add('is-found');
        if (hint) hint.textContent = '✓ Número localizado automaticamente. Confira antes de lançar.';
      } else if (!input.value.trim()) {
        if (hint) hint.textContent = 'Número não localizado com segurança. Digite conforme a NF.';
      }
    } catch (_) {
      if (hint && !input.value.trim()) hint.textContent = 'Número não localizado automaticamente. Digite conforme a NF.';
    } finally {
      readingCards.delete(card);
    }
  }

  function scheduleNumberRead(card) {
    // Aguarda o OCR principal terminar para não disputar o mesmo worker do Tesseract.
    let tries = 0;
    const check = () => {
      tries++;
      const status = card.querySelector('[data-role="status"]')?.textContent || '';
      if (!status.includes('Lendo') || tries >= 40) {
        setTimeout(() => readNumberFromCard(card), 150);
        return;
      }
      setTimeout(check, 500);
    };
    setTimeout(check, 700);
  }

  function validateAndCollect() {
    injectAll();
    const cards = Array.from(document.querySelectorAll('.doc-card'));
    const numbers = [];
    let firstInvalid = null;

    cards.forEach(card => {
      const wrapper = card.querySelector('.doc-number-field');
      const input = card.querySelector('[data-field="numeroDoc"]');
      const value = input?.value.trim() || '';
      if (!value) {
        wrapper?.classList.add('is-invalid');
        const hint = wrapper?.querySelector('.doc-number-field__hint');
        if (hint) hint.textContent = '⚠️ Número não informado. Digite o número da NF/recibo.';
        if (!firstInvalid) firstInvalid = input;
      }
      numbers.push(value);
    });

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }

    pendingNumbers.splice(0, pendingNumbers.length, ...numbers);
    return true;
  }

  function install() {
    if (installed) return;
    installed = true;
    addStyles();

    const grid = document.getElementById('cardsGrid');
    if (!grid) return;

    const observer = new MutationObserver(injectAll);
    observer.observe(grid, { childList: true });
    injectAll();

    const confirmButton = document.getElementById('btnConfirmarAdicao');
    confirmButton?.addEventListener('click', event => {
      if (!validateAndCollect()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = 'Informe o número de cada documento antes de adicionar à tabela.';
          toast.className = 'toast toast--danger';
          toast.hidden = false;
          setTimeout(() => { toast.hidden = true; }, 3800);
        }
      }
    }, true);

    if (window.Storage && typeof Storage.addLancamentos === 'function') {
      const originalAdd = Storage.addLancamentos.bind(Storage);
      Storage.addLancamentos = async function (objs) {
        const saved = await originalAdd(objs);
        if (Array.isArray(saved) && pendingNumbers.length) {
          for (let i = 0; i < saved.length; i++) {
            const number = pendingNumbers[i] || '';
            if (number && typeof Storage.updateLancamento === 'function') {
              await Storage.updateLancamento(saved[i].id, { numeroDoc: number });
            }
          }
          pendingNumbers.splice(0, pendingNumbers.length);
        }
        return saved;
      };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();