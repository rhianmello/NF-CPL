/*
 * nfNumberFix.js
 * Segunda leitura especializada do número da NF/NFC-e.
 * Executa depois do OCR principal e dá prioridade ao texto "NFC-e nº".
 */
(function () {
  'use strict';
  if (typeof Tesseract === 'undefined') return;

  let workerPromise = null;
  const processed = new WeakSet();

  function normalize(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[º°ª]/g, 'O')
      .replace(/\s+/g, ' ');
  }

  function cleanDigits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function isAccessKey(text, candidate) {
    const digits = String(text || '').replace(/\D/g, '');
    if (digits.length >= 44) {
      for (let i = 0; i <= digits.length - 44; i++) {
        const key = digits.slice(i, i + 44);
        if (candidate && key.startsWith(candidate)) return true;
      }
    }
    return false;
  }

  function extractExplicit(text) {
    const n = normalize(text);
    const patterns = [
      /(?:IDENTIFICADO[^0-9]{0,60})?NFC\s*-?\s*E[^0-9]{0,20}(?:N[O0]?|NUM(?:ERO)?)?[^0-9]{0,12}([0-9]{1,12})\b/,
      /(?:NFC\s*-?\s*E)[^0-9]{0,25}(?:N[O0]?|NUM(?:ERO)?)[^0-9]{0,12}([0-9]{1,12})\b/,
      /(?:NUMERO|N[O0]?)[^0-9]{0,12}(?:DA\s+)?(?:NOTA\s+FISCAL|NF\s*-?\s*E|NFC\s*-?\s*E|NFE)[^0-9]{0,12}([0-9]{1,12})\b/
    ];
    for (const re of patterns) {
      const m = n.match(re);
      if (!m) continue;
      const candidate = cleanDigits(m[1]);
      if (!candidate || isAccessKey(text, candidate)) continue;
      return candidate;
    }
    return '';
  }

  function getImage(card) {
    const thumb = card.querySelector('.doc-card__thumb');
    const bg = thumb ? (thumb.style.backgroundImage || getComputedStyle(thumb).backgroundImage) : '';
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

  function crop(img, top, height) {
    const scale = Math.min(2.8, 2600 / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.max(1, Math.round(img.height * height * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, Math.round(img.height * top), img.width, Math.round(img.height * height), 0, 0, c.width, c.height);
    return c;
  }

  function sharpen(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, out.width, out.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let v = (g - 128) * 1.7 + 128;
      v = Math.max(0, Math.min(255, v));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return out;
  }

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('por', 1, { logger: () => {} });
    }
    return workerPromise;
  }

  async function read(canvas, psm) {
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
    const result = await worker.recognize(canvas, {}, { text: true });
    return result?.data?.text || '';
  }

  async function inspectCard(card) {
    if (processed.has(card)) return;
    const input = card.querySelector('[data-field="numeroDoc"]');
    if (!input) return;
    processed.add(card);

    try {
      const src = getImage(card);
      if (!src) return;
      const img = await loadImage(src);

      // O número "NFC-e nº ..." costuma ficar no rodapé, perto de "IDENTIFICADO".
      const regions = [
        crop(img, 0.62, 0.38),
        crop(img, 0.50, 0.50),
        crop(img, 0.00, 1.00)
      ];

      let best = '';
      let allText = '';
      for (const region of regions) {
        const prepared = sharpen(region);
        for (const psm of [11, 6]) {
          try {
            const text = await read(prepared, psm);
            allText += '\n' + text;
            const found = extractExplicit(text);
            if (found) { best = found; break; }
          } catch (_) {}
        }
        if (best) break;
      }

      // Segunda chance: procura a expressão em todo o OCR acumulado.
      if (!best) best = extractExplicit(allText);

      if (best) {
        input.value = best;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const wrapper = input.closest('.doc-number-field');
        if (wrapper) {
          wrapper.classList.remove('is-invalid');
          wrapper.classList.add('is-found');
          const hint = wrapper.querySelector('.doc-number-field__hint');
          if (hint) hint.textContent = '✓ Número NF/NFC-e confirmado por leitura focada.';
        }
      } else {
        // Se o OCR só encontrou um número curto que é início da chave de acesso,
        // não permitimos que ele permaneça como número da NF.
        if (isAccessKey(allText, input.value.trim())) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const wrapper = input.closest('.doc-number-field');
          const hint = wrapper?.querySelector('.doc-number-field__hint');
          if (hint) hint.textContent = '⚠️ Número da NF não confirmado. Não use o início da chave de acesso.';
        }
      }
    } catch (_) {}
  }

  function scan() {
    document.querySelectorAll('.doc-card').forEach(card => {
      if (processed.has(card)) return;
      const status = card.querySelector('[data-role="status"]')?.textContent || '';
      if (/Leitura OK|Confira os dados|falhou/i.test(status)) {
        setTimeout(() => inspectCard(card), 250);
      }
    });
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  setTimeout(scan, 1200);
})();