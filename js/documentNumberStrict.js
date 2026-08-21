/* Leitura estrita do número da NF/NFC-e.
 * Prioriza explicitamente "NFC-e nº ..." e rejeita números que sejam
 * apenas o início da chave de acesso.
 */
(function () {
  'use strict';
  if (typeof Tesseract === 'undefined') return;

  const processed = new WeakSet();
  let workerPromise = null;

  function normalize(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[º°ª]/g, 'O')
      .replace(/[|]/g, 'I')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ');
  }

  function clean(value) {
    const v = String(value || '').replace(/\D/g, '');
    if (!v || v.length > 12 || /^0+$/.test(v)) return '';
    return v;
  }

  function isAccessKeyPrefix(text, candidate) {
    if (!candidate) return false;
    const digits = String(text || '').replace(/\D/g, '');
    if (digits.length < 44) return false;
    for (let i = 0; i <= digits.length - 44; i++) {
      if (digits.slice(i, i + 44).startsWith(candidate)) return true;
    }
    return false;
  }

  function explicitNumber(text) {
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(normalize);

    // REGRA PRINCIPAL: "NFC-e nº 000063663" / "NFC-e n° 000063663".
    // Permite pequenos erros do OCR, inclusive quebra de linha.
    const strict = [
      /(?:IDENTIFICADO[^0-9]{0,60})?NFC\s*-?\s*E[^0-9]{0,22}(?:N[O0]?|NUM(?:ERO)?)?[^0-9]{0,12}([0-9]{1,12})\b/,
      /(?:NFC\s*-?\s*E)[^0-9]{0,30}(?:N[O0]?|NUM(?:ERO)?)[^0-9]{0,12}([0-9]{1,12})\b/,
      /(?:NF\s*-?\s*E|NFE)[^0-9]{0,22}(?:N[O0]?|NUM(?:ERO)?)?[^0-9]{0,12}([0-9]{1,12})\b/,
      /(?:NOTA\s+FISCAL|DANFE)[^0-9]{0,20}(?:N[O0]?|NUM(?:ERO)?)?[^0-9]{0,12}([0-9]{1,12})\b/
    ];

    for (const line of lines) {
      for (const re of strict) {
        const m = line.match(re);
        if (!m) continue;
        const n = clean(m[1]);
        if (n && !isAccessKeyPrefix(raw, n)) return n;
      }
    }

    // OCR pode colocar "NFC-e nº" em uma linha e o número na seguinte.
    for (let i = 0; i < lines.length - 1; i++) {
      if (!/(?:NFC\s*-?\s*E|NF\s*-?\s*E|NFE|DANFE|NOTA\s+FISCAL)/.test(lines[i])) continue;
      const next = lines[i + 1];
      const m = next.match(/^\D{0,8}([0-9]{1,12})\b/);
      if (!m) continue;
      const n = clean(m[1]);
      if (n && !isAccessKeyPrefix(raw, n)) return n;
    }

    return '';
  }

  function imageUrl(card) {
    const el = card.querySelector('.doc-card__thumb');
    if (!el) return '';
    const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage || '';
    const m = bg.match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : '';
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function region(img, top, height) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(2.8, 2800 / img.width);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, Math.round(img.height * top), img.width, Math.round(img.height * height), 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function enhance(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const image = ctx.getImageData(0, 0, out.width, out.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let v = (gray - 128) * 1.7 + 128;
      v = Math.max(0, Math.min(255, v));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(image, 0, 0);
    return out;
  }

  async function getWorker() {
    if (!workerPromise) workerPromise = Tesseract.createWorker('por', 1, { logger: () => {} });
    return workerPromise;
  }

  async function focusedRead(canvas, psm) {
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
    const result = await worker.recognize(canvas, {}, { text: true });
    return result?.data?.text || '';
  }

  async function process(card) {
    if (processed.has(card)) return;
    const input = card.querySelector('[data-field="numeroDoc"]');
    if (!input) return;
    processed.add(card);

    const wrapper = card.querySelector('.doc-number-field');
    const hint = wrapper?.querySelector('.doc-number-field__hint');

    try {
      const src = imageUrl(card);
      if (!src) throw new Error('imagem indisponível');
      const img = await loadImage(src);

      // O identificador "NFC-e nº ..." fica normalmente no rodapé.
      // Fazemos uma leitura dedicada do rodapé e outra da imagem inteira.
      const regions = [
        region(img, 0.60, 0.40),
        region(img, 0.48, 0.52),
        region(img, 0.00, 1.00)
      ];

      let found = '';
      let allText = '';
      for (const r of regions) {
        const prepared = enhance(r);
        for (const psm of [11, 6]) {
          try {
            if (hint) hint.textContent = 'Lendo especificamente o número da NFC-e…';
            const text = await focusedRead(prepared, psm);
            allText += '\n' + text;
            const n = explicitNumber(text);
            if (n) { found = n; break; }
          } catch (_) {}
        }
        if (found) break;
      }

      if (!found) found = explicitNumber(allText);

      if (found) {
        input.value = found;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        wrapper?.classList.remove('is-invalid');
        wrapper?.classList.add('is-found');
        if (hint) hint.textContent = '✓ Número da NFC-e localizado. Confira antes de lançar.';
      } else {
        // 2826, por exemplo, é o começo da chave de acesso desta NFC-e.
        // Se não houver confirmação por "NFC-e nº", não deixamos esse valor passar.
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        wrapper?.classList.remove('is-found');
        if (hint) hint.textContent = '⚠️ Número da NFC-e não confirmado. Digite exatamente o número após “NFC-e nº”.';
      }
    } catch (_) {
      input.value = '';
      wrapper?.classList.remove('is-found');
      if (hint) hint.textContent = '⚠️ Não foi possível confirmar o número. Digite conforme a NFC-e.';
    }
  }

  function scan() {
    document.querySelectorAll('.doc-card').forEach(card => {
      const input = card.querySelector('[data-field="numeroDoc"]');
      if (input && input.value.trim() && !processed.has(card)) setTimeout(() => process(card), 700);
    });
  }

  function install() {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return setTimeout(install, 500);
    new MutationObserver(scan).observe(grid, { childList: true, subtree: true, characterData: true });
    setTimeout(scan, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
