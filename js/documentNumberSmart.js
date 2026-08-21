/*
 * documentNumberSmart.js
 * Leitor dedicado de número de NF/NFC-e.
 * Não confia no número retornado pelo OCR geral.
 * Estratégia: texto contextual + múltiplos recortes + chave de acesso de 44 dígitos.
 */
(function () {
  'use strict';
  if (typeof Tesseract === 'undefined') return;

  const processed = new WeakSet();
  const manual = new WeakSet();
  let workerPromise = null;

  const norm = s => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[º°ª]/g, 'O')
    .replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

  const digits = s => String(s || '').replace(/\D/g, '');

  function addStyles() {
    if (document.getElementById('smart-number-style')) return;
    const st = document.createElement('style');
    st.id = 'smart-number-style';
    st.textContent = `
      .doc-number-field.is-smart-found input {border-color:#3f9b61!important;box-shadow:0 0 0 2px rgba(63,155,97,.14)}
      .doc-number-field.is-smart-warning input {border-color:#d99b2b!important;box-shadow:0 0 0 2px rgba(217,155,43,.14)}
    `;
    document.head.appendChild(st);
  }

  function ensureField(card) {
    let wrap = card.querySelector('.doc-number-field');
    if (wrap) return wrap;
    const supplier = card.querySelector('[data-field="fornecedor"]');
    if (!supplier) return null;
    wrap = document.createElement('div');
    wrap.className = 'field doc-number-field';
    wrap.innerHTML = `
      <label>Nº NF / NF-e</label>
      <input type="text" data-field="numeroDoc" inputmode="numeric" autocomplete="off" placeholder="Número do documento" required>
      <small class="doc-number-field__hint">Localizando o número da NF…</small>`;
    supplier.closest('.field')?.insertAdjacentElement('beforebegin', wrap);
    const input = wrap.querySelector('input');
    input.addEventListener('input', () => {
      if (input.dataset.smartWriting !== '1') manual.add(card);
      wrap.classList.remove('is-smart-warning');
      if (input.value.trim()) wrap.classList.add('is-smart-found');
    });
    return wrap;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function imageSrc(card) {
    const thumb = card.querySelector('.doc-card__thumb');
    if (!thumb) return '';
    const bg = thumb.style.backgroundImage || getComputedStyle(thumb).backgroundImage || '';
    const m = bg.match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : '';
  }

  function crop(img, top, height, left = 0, width = 1, scale = 3.2) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * width * scale));
    c.height = Math.max(1, Math.round(img.height * height * scale));
    const x = Math.round(img.width * left), y = Math.round(img.height * top);
    const w = Math.round(img.width * width), h = Math.round(img.height * height);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  function variants(c) {
    const out = [c];
    const gray = document.createElement('canvas');
    gray.width = c.width; gray.height = c.height;
    const ctx = gray.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(c, 0, 0);
    const im = ctx.getImageData(0, 0, gray.width, gray.height), d = im.data;
    for (let i=0;i<d.length;i+=4) {
      const g = .299*d[i] + .587*d[i+1] + .114*d[i+2];
      const v = Math.max(0, Math.min(255, (g-128)*2.0+128));
      d[i]=d[i+1]=d[i+2]=v;
    }
    ctx.putImageData(im,0,0); out.push(gray);
    return out;
  }

  async function worker() {
    if (!workerPromise) workerPromise = Tesseract.createWorker('por', 1, {logger:()=>{}});
    return workerPromise;
  }

  async function ocr(canvas, psm, digitsOnly=false) {
    const w = await worker();
    const params = {tessedit_pageseg_mode:String(psm), preserve_interword_spaces:'1'};
    if (digitsOnly) params.tessedit_char_whitelist = '0123456789';
    await w.setParameters(params);
    const r = await w.recognize(canvas, {}, {text:true, blocks:true, lines:true, words:true, confidence:true});
    return r?.data || {};
  }

  function validAccessKey(k) {
    if (!/^\d{44}$/.test(k)) return false;
    // NFC-e/NF-e: modelo 65/55 nas posições 21-22.
    if (!/^(55|65)$/.test(k.slice(20,22))) return false;
    let sum=0, weight=2;
    for (let i=42;i>=0;i--) { sum += Number(k[i])*weight; weight = weight===9 ? 2 : weight+1; }
    const r=sum%11, dv=(r===0||r===1)?0:11-r;
    return dv===Number(k[43]);
  }

  function accessKeyCandidates(text) {
    const raw = String(text || '');
    const found = [];
    // OCR pode inserir espaços, pontos ou hífens entre os 44 dígitos.
    const d = digits(raw);
    for (let i=0;i<=d.length-44;i++) {
      const k=d.slice(i,i+44);
      if (validAccessKey(k)) found.push(k);
    }
    return [...new Set(found)];
  }

  function numberFromAccessKey(text) {
    const keys = accessKeyCandidates(text);
    if (!keys.length) return '';
    // nNF ocupa as posições 26-34 da chave e tem exatamente 9 dígitos.
    return keys[0].slice(25,34);
  }

  function explicitCandidates(text) {
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(x=>norm(x)).filter(Boolean);
    const result = [];
    const patterns = [
      /(?:IDENTIFICADO\s*)?NFC\s*-?\s*E[^0-9]{0,45}(?:N[O0]|NUMERO|#)?[^0-9]{0,12}(\d{4,12})\b/,
      /(?:NF\s*-?\s*E|NFE)[^0-9]{0,45}(?:N[O0]|NUMERO|#)?[^0-9]{0,12}(\d{4,12})\b/,
      /(?:NOTA\s+FISCAL|DANFE)[^0-9]{0,45}(?:N[O0]|NUMERO|#)?[^0-9]{0,12}(\d{4,12})\b/
    ];
    for (const line of lines) for (const re of patterns) {
      const m=line.match(re); if (m) result.push(m[1]);
    }
    for (let i=0;i<lines.length;i++) {
      if (!/(?:NFC\s*-?\s*E|NF\s*-?\s*E|NFE)/.test(lines[i])) continue;
      for (let j=i;j<=Math.min(i+2,lines.length-1);j++) {
        const m=lines[j].match(/^(?:[^0-9]{0,12})(\d{4,12})\b/);
        if (m) result.push(m[1]);
      }
    }
    return [...new Set(result)];
  }

  function scoreCandidate(n, source) {
    let s = source === 'label' ? 100 : 0;
    if (/^0/.test(n)) s += 20;
    if (n.length >= 7) s += 15;
    if (n.length === 4 && !/^0/.test(n)) s -= 35;
    if (source === 'key') s += 80;
    return s;
  }

  function choose(texts) {
    const joined = texts.join('\n');
    const label = explicitCandidates(joined);
    const key = numberFromAccessKey(joined);
    const options = [];
    label.forEach(n=>options.push({n,source:'label',score:scoreCandidate(n,'label')}));
    if (key) options.push({n:key,source:'key',score:scoreCandidate(key,'key')});
    options.sort((a,b)=>b.score-a.score);
    return options[0] || null;
  }

  async function process(card) {
    if (processed.has(card) || manual.has(card)) return;
    const wrap = ensureField(card);
    const input = wrap?.querySelector('[data-field="numeroDoc"]');
    const hint = wrap?.querySelector('.doc-number-field__hint');
    if (!input || !wrap) return;
    processed.add(card);

    // O número 2826 veio do parser/OCR geral. Na primeira leitura inteligente,
    // removemos esse valor para não tratá-lo como verdade.
    input.dataset.smartWriting='1'; input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); delete input.dataset.smartWriting;

    try {
      const src=imageSrc(card); if(!src) throw new Error('imagem indisponível');
      const img=await loadImage(src);
      const regions=[
        crop(img,.68,.32,0,1),
        crop(img,.58,.42,0,1),
        crop(img,.48,.52,0,1),
        crop(img,.32,.68,0,1),
        crop(img,0,1,0,1,2.6)
      ];
      const texts=[];
      for (const base of regions) {
        for (const v of variants(base)) {
          if (hint) hint.textContent='Lendo número da NF/NFC-e com verificação…';
          for (const psm of [11,6,7]) {
            try { const data=await ocr(v,psm,false); texts.push(data.text||''); }
            catch (_) {}
            const pick=choose(texts);
            if (pick && pick.source==='label' && (pick.n.length>=7 || /^0/.test(pick.n))) break;
          }
          const pick=choose(texts);
          if (pick && pick.source==='label' && (pick.n.length>=7 || /^0/.test(pick.n))) break;
        }
        const pick=choose(texts);
        if (pick && pick.source==='label' && (pick.n.length>=7 || /^0/.test(pick.n))) break;
      }

      const pick=choose(texts);
      if (!pick) {
        input.value='';
        wrap.classList.remove('is-smart-found'); wrap.classList.add('is-smart-warning');
        if (hint) hint.textContent='⚠️ Número da NF não confirmado. Digite exatamente o número após “NFC-e nº”.';
        return;
      }

      input.dataset.smartWriting='1'; input.value=pick.n; input.dispatchEvent(new Event('input',{bubbles:true})); delete input.dataset.smartWriting;
      wrap.classList.remove('is-smart-warning'); wrap.classList.add('is-smart-found');
      if (hint) hint.textContent = pick.source==='key'
        ? '✓ Número conferido pela chave de acesso da NFC-e. Confira antes de lançar.'
        : '✓ Número localizado junto a “NFC-e/NF-e”. Confira antes de lançar.';
    } catch (_) {
      input.value='';
      wrap.classList.add('is-smart-warning');
      if (hint) hint.textContent='⚠️ Não foi possível confirmar o número. Digite conforme a NF.';
    }
  }

  function install() {
    addStyles();
    const grid=document.getElementById('cardsGrid');
    if(!grid) return setTimeout(install,400);
    const scan=()=>grid.querySelectorAll('.doc-card').forEach(card=>{ensureField(card);if(!processed.has(card)&&!manual.has(card))setTimeout(()=>process(card),500);});
    new MutationObserver(scan).observe(grid,{childList:true,subtree:true});
    scan();

    const confirm=document.getElementById('btnConfirmarAdicao');
    confirm?.addEventListener('click',e=>{
      const invalid=[...grid.querySelectorAll('.doc-card')].find(card=>!card.querySelector('[data-field="numeroDoc"]')?.value.trim());
      if(invalid){e.preventDefault();e.stopImmediatePropagation();invalid.querySelector('[data-field="numeroDoc"]')?.focus();}
    },true);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
