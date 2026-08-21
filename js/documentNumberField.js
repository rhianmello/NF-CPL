/* Campo obrigatório para o número da NF/NF-e/recibo/comanda.
 * A leitura do número é propositalmente separada do OCR geral para evitar
 * que códigos de produto, valores ou outros números do documento sejam usados.
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
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[º°ª]/g, 'O')
      .replace(/[|]/g, 'I')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ');
  }

  function cleanCandidate(value) {
    const v = String(value || '').replace(/\D/g, '');
    if (!v || v.length > 12) return '';
    if (/^0+$/.test(v)) return '';
    return v;
  }

  function isClearlyProductOrItemLine(line) {
    const s = normalizeOcr(line);
    return /\b(?:COD|CODIGO|C[OÓ]D|ITEM|QTD|QTDE|QUANT|UN|VL\.?\s*UNIT|VL\.?\s*TOTAL|DESCRICAO|DESPESAS?|PRODUTO|SERVICO|SERVICOS)\b/.test(s);
  }

  function extractNumber(text, type) {
    const raw = String(text || '');
    const n = normalizeOcr(raw);
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const normalizedLines = lines.map(normalizeOcr);
    const t = String(type || '').toUpperCase();

    // Só aceitamos números ligados a um rótulo que identifique o documento.
    // Isso evita pegar, por exemplo, código de produto 0621 ou valor 178,20.
    const patterns = [
      /(?:NFC\s*-?\s*E|NF\s*-?\s*E|NFE)[^0-9]{0,16}(?:N[O0º°]?|NUM(?:ERO)?)[^0-9]{0,6}([0-9]{1,12})\b/,
      /(?:NUMERO|N[O0º°]?)[^0-9]{0,8}(?:DA\s+)?(?:NOTA\s+FISCAL|NF\s*-?\s*E|NFE|NFC\s*-?\s*E)[^0-9]{0,8}([0-9]{1,12})\b/,
      /(?:NOTA\s+FISCAL|NF\s*-?\s*E|NFE|NFC\s*-?\s*E)[^0-9]{0,24}([0-9]{1,12})\b/,
      /(?:RECIBO|COMANDA)[^0-9]{0,12}(?:N[O0º°]?|NUM(?:ERO)?)[^0-9]{0,6}([0-9]{1,12})\b/,
      /(?:N[O0º°]?|NUM(?:ERO)?)[^0-9]{0,5}([0-9]{1,12})\b/
    ];

    const candidates = [];
    const searchTexts = normalizedLines.map((line, index) => ({ text: line, lineIndex: index }));
    searchTexts.push({ text: n, lineIndex: -1 });

    for (const entry of searchTexts) {
      const line = entry.text;
      if (!line || (entry.lineIndex >= 0 && isClearlyProductOrItemLine(line))) continue;
      for (let i = 0; i < patterns.length; i++) {
        const m = line.match(patterns[i]);
        if (!m) continue;
        const candidate = cleanCandidate(m[m.length - 1]);
        if (!candidate) continue;

        // O último padrão é genérico; só pode ser usado quando o documento
        // explicitamente for um recibo/comanda e a linha não parecer item.
        if (i === patterns.length - 1 && !/RECIBO|COMANDA|NOTA|NFC|NFE|DANFE/.test(line)) continue;

        candidates.push({ value: candidate, score: 100 - i * 15, lineIndex: entry.lineIndex });
      }
    }

    // Algumas NFC-e têm o rótulo e o número em linhas consecutivas.
    for (let i = 0; i < normalizedLines.length; i++) {
      const line = normalizedLines[i];
      if (isClearlyProductOrItemLine(line)) continue;
      if (!/(?:NFC\s*-?\s*E|NF\s*-?\s*E|NFE|DANFE|NOTA\s+FISCAL)/.test(line)) continue;

      const windowText = normalizedLines.slice(i, i + 3).join(' ');
      if (isClearlyProductOrItemLine(windowText)) continue;
      const nums = windowText.match(/\b\d{1,12}\b/g) || [];
      for (const num of nums) {
        const candidate = cleanCandidate(num);
        if (candidate && candidate.length <= 12) {
          candidates.push({ value: candidate, score: 70, lineIndex: i });
          break;
        }
      }
    }

    if (!candidates.length) return '';

    // Prioriza o padrão mais explícito. Em empate, mantém a primeira ocorrência.
    candidates.sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex);
    return candidates[0].value;
  }

  function dataUrlFromCard(card) {
    const thumb = card.querySelector('.doc-card__thumb');
    if (!thumb) return '';
    const bg = getComputedStyle(thumb).backgroundImage || thumb.style.backgroundImage || '';
    const m = bg.match(/url\(["']?(.*?)["']?\)/);
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
    const scale = Math.min(2.2, 2200 / img.width);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      img,
      0,
      Math.round(img.height * top),
      img.width,
      Math.round(img.height * height),
      0,
      0,
      canvas.width,
      canvas.height
    );
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

      // Aumenta a chance de encontrar o número no cabeçalho ou rodapé da NF-e,
      // sem confiar no OCR geral e sem limitar a leitura à região do item.
      const regions = [
        cropToCanvas(img, 0.00, 0.42),
        cropToCanvas(img, 0.35, 0.40),
        cropToCanvas(img, 0.58, 0.42),
        cropToCanvas(img, 0.00, 1.00)
      ];

      let found = '';
      for (const region of regions) {
        if (hint) hint.textContent = 'Lendo especificamente o número da NF…';
        try {
          const result = await OcrEngine.recognize(region, null, 14000);
          found = extractNumber(result?.text || '', cardType(card));
          if (found) break;
        } catch (_) {}
      }

      if (found && !input.value.trim()) {
        input.value = found;
        wrapper.classList.add('is-found');
        if (hint) hint.textContent = '✓ Número localizado automaticamente. Confira antes de lançar.';
      } else if (!input.value.trim()) {
        if (hint) hint.textContent = '⚠️ Número da NF não localizado com segurança. Confira a imagem e digite manualmente.';
      }
    } catch (_) {
      if (hint && !input.value.trim()) {
        hint.textContent = '⚠️ Não foi possível localizar o número automaticamente. Digite conforme a NF.';
      }
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