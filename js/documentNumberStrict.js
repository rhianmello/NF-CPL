/* Leitura estrita do número da NF/NFC-e.
 * Nunca usa números genéricos da chave de acesso, CNPJ, itens ou valores.
 */
(function () {
  'use strict';

  const processed = new WeakSet();

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

  function explicitNumber(text) {
    const rawLines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const lines = rawLines.map(normalize);

    // Regra principal: o número precisa estar imediatamente associado
    // ao rótulo NFC-e/NF-e/DANFE/NOTA FISCAL.
    const strict = [
      /(?:NFC\s*-?\s*E|NF\s*-?\s*E|NFE)\s*(?:N|NO|N O|NUM(?:ERO)?)?\s*[:#-]?\s*(\d{1,12})\b/,
      /(?:NFC\s*-?\s*E|NF\s*-?\s*E|NFE)\s+(?:NO|N O|N)\s*(\d{1,12})\b/,
      /(?:NOTA\s+FISCAL|DANFE)\s*(?:N|NO|N O|NUM(?:ERO)?)?\s*[:#-]?\s*(\d{1,12})\b/
    ];

    for (const line of lines) {
      for (const re of strict) {
        const m = line.match(re);
        if (m) {
          const n = clean(m[1]);
          if (n) return n;
        }
      }
    }

    // Alguns OCRs quebram "NFC-e nº 000063663" em duas linhas.
    // Só aceita a linha seguinte se a anterior contiver explicitamente NFC-e/NF-e.
    for (let i = 0; i < lines.length - 1; i++) {
      if (!/(?:NFC\s*-?\s*E|NF\s*-?\s*E|NFE|DANFE|NOTA\s+FISCAL)/.test(lines[i])) continue;
      const next = lines[i + 1];
      const m = next.match(/^\D{0,8}(\d{1,12})\b/);
      if (m) {
        const n = clean(m[1]);
        if (n) return n;
      }
    }

    return '';
  }

  function imageUrl(card) {
    const el = card.querySelector('.doc-card__thumb');
    if (!el) return '';
    const bg = getComputedStyle(el).backgroundImage || el.style.backgroundImage || '';
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
    const scale = Math.min(2.5, 2400 / img.width);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, Math.round(img.height * top), img.width, Math.round(img.height * height), 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function process(card) {
    if (processed.has(card)) return;
    const input = card.querySelector('[data-field="numeroDoc"]');
    if (!input || !input.value.trim() || !window.OcrEngine) return;
    processed.add(card);

    const wrapper = card.querySelector('.doc-number-field');
    const hint = wrapper?.querySelector('.doc-number-field__hint');

    try {
      const src = imageUrl(card);
      if (!src) throw new Error('imagem indisponível');
      const img = await loadImage(src);

      // A chave de acesso costuma ficar no rodapé. O número da NFC-e fica
      // normalmente perto do texto "NFC-e nº". Fazemos leituras complementares,
      // mas aceitamos SOMENTE o número explicitamente associado ao rótulo.
      const regions = [
        region(img, 0.35, 0.35),
        region(img, 0.50, 0.35),
        region(img, 0.65, 0.35),
        region(img, 0.00, 1.00)
      ];

      let found = '';
      for (const r of regions) {
        if (hint) hint.textContent = 'Verificando especificamente NFC-e/NF-e…';
        try {
          const result = await OcrEngine.recognize(r, null, 12000);
          found = explicitNumber(result?.text || '');
          if (found) break;
        } catch (_) {}
      }

      if (found) {
        input.value = found;
        wrapper?.classList.add('is-found');
        if (hint) hint.textContent = '✓ Número da NF localizado. Confira antes de lançar.';
      } else {
        // Remove o falso positivo colocado pelo leitor anterior.
        input.value = '';
        wrapper?.classList.remove('is-found');
        if (hint) hint.textContent = '⚠️ Número da NF não localizado com segurança. Digite exatamente o número após “NFC-e nº”/“NF-e nº”.';
      }
    } catch (_) {
      input.value = '';
      wrapper?.classList.remove('is-found');
      if (hint) hint.textContent = '⚠️ Número da NF não localizado automaticamente. Digite conforme a nota.';
    }
  }

  function scan() {
    document.querySelectorAll('.doc-card').forEach(card => {
      const input = card.querySelector('[data-field="numeroDoc"]');
      if (input && input.value.trim() && !processed.has(card)) {
        setTimeout(() => process(card), 500);
      }
    });
  }

  function install() {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return setTimeout(install, 500);
    const observer = new MutationObserver(scan);
    observer.observe(grid, { childList: true, subtree: true });
    scan();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
