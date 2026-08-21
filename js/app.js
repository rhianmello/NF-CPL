/**
 * app.js
 * ---------------------------------------------------------------------
 * Controlador principal: alterna telas, orquestra upload → detecção →
 * OCR → conferência → confirmação → tabela, e liga os modais de
 * cabeçalho, recorte e visualização.
 * ---------------------------------------------------------------------
 */

(function () {
  'use strict';

  const state = {
    lancamentos: [],
    config: { obra: 'COMPERJ', periodo: '', data: '', responsavel: '', dcNum: '' },
    logo: null,
    uploadedPhoto: null,   // canvas da foto original enviada
    uploadedFile: null,
    reviewDocs: [],        // documentos na tela de conferência
    cropTargetLocalId: null,
    cancelDetection: false
  };

  const NUM_DOC_OPTIONS = ['DANFE', 'RECIBO', 'NOTA FISCAL', 'COMANDA', 'OUTRO'];

  // ---------------------------------------------------------------
  // Utilidades de DOM
  // ---------------------------------------------------------------
  const $ = sel => document.querySelector(sel);
  const $all = sel => Array.from(document.querySelectorAll(sel));

  function showView(name) {
    $all('.view').forEach(v => v.hidden = v.dataset.view !== name);
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ` toast--${kind}` : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
  }

  function moneyStrToNumber(str) {
    if (str === '' || str === null || str === undefined) return null;
    const n = FieldParser.moneyToNumber(String(str).includes(',') ? str : String(str).replace('.', ','));
    return n;
  }

  // ---------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------
  async function init() {
    await Storage.init();
    state.config = await Storage.getConfig();
    state.logo = await Storage.getLogo();
    state.lancamentos = await Storage.listLancamentos();

    applyConfigToHeader();
    applyLogo();
    renderTable();
    wireEvents();
  }

  // ---------------------------------------------------------------
  // Cabeçalho / configuração
  // ---------------------------------------------------------------
  function applyConfigToHeader() {
    const c = state.config;
    $('#obraLabel').textContent = `Obra: ${c.obra || '—'}`;
    $('#hObra').textContent = c.obra || '—';
    $('#hPeriodo').textContent = c.periodo || '—';
    $('#hData').textContent = c.data ? formatDateDisplay(c.data) : '—';
    $('#hResponsavel').textContent = c.responsavel || '—';
    $('#ledgerDcNum').textContent = `DC Nº ${c.dcNum || '—'}`;
  }

  function formatDateDisplay(isoOrText) {
    // aceita "aaaa-mm-dd" (input date) ou texto livre já digitado
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoOrText);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return isoOrText;
  }

  function applyLogo() {
    const slot = $('#logoSlot');
    if (state.logo) {
      slot.innerHTML = `<img src="${state.logo}" alt="Logo CPL">`;
    } else {
      slot.textContent = 'CPL';
    }
  }

  function openConfigModal() {
    const c = state.config;
    $('#cfgObra').value = c.obra || '';
    $('#cfgPeriodo').value = c.periodo || '';
    $('#cfgData').value = c.data || '';
    $('#cfgResponsavel').value = c.responsavel || '';
    $('#cfgDcNum').value = c.dcNum || '';
    $('#modalConfig').hidden = false;
  }

  async function saveConfigModal() {
    state.config = {
      obra: $('#cfgObra').value.trim(),
      periodo: $('#cfgPeriodo').value.trim(),
      data: $('#cfgData').value,
      responsavel: $('#cfgResponsavel').value.trim(),
      dcNum: $('#cfgDcNum').value.trim()
    };
    await Storage.saveConfig(state.config);

    const logoFile = $('#cfgLogo').files[0];
    if (logoFile) {
      const dataUrl = await fileToDataUrl(logoFile, 200);
      state.logo = dataUrl;
      await Storage.saveLogo(dataUrl);
      applyLogo();
    }

    applyConfigToHeader();
    $('#modalConfig').hidden = true;
    toast('Cabeçalho atualizado.', 'success');
  }

  function fileToDataUrl(file, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------------------------------------------------------------
  // Tabela principal
  // ---------------------------------------------------------------
  function renderTable() {
    const tbody = $('#tbodyLancamentos');
    tbody.innerHTML = '';
    let totalEntrada = 0, totalSaida = 0;

    state.lancamentos.forEach((l, idx) => {
      totalEntrada += Number(l.entrada) || 0;
      totalSaida += Number(l.saida) || 0;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><input type="text" class="cell-input" data-field="data" value="${escapeAttr(l.data || '')}" placeholder="dd/mm/aaaa"></td>
        <td>
          <select class="cell-input" data-field="numDoc">
            ${NUM_DOC_OPTIONS.map(o => `<option value="${o}" ${o === l.numDoc ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </td>
        <td><input type="text" class="cell-input" data-field="fornecedor" value="${escapeAttr(l.fornecedor || '')}"></td>
        <td class="col-money"><input type="text" class="cell-input" data-field="entrada" value="${l.entrada != null ? FieldParser.formatMoney(l.entrada) : ''}" placeholder="—"></td>
        <td class="col-money"><input type="text" class="cell-input" data-field="saida" value="${l.saida != null ? FieldParser.formatMoney(l.saida) : ''}" placeholder="—"></td>
        <td class="col-actions"><button class="row-btn" title="Remover lançamento" data-action="remove">🗑</button></td>
      `;
      tr.dataset.id = l.id;

      tr.querySelectorAll('.cell-input').forEach(input => {
        input.addEventListener('change', () => onCellEdit(l.id, input));
      });
      tr.querySelector('[data-action="remove"]').addEventListener('click', () => removeLancamento(l.id));

      tbody.appendChild(tr);
    });

    $('#totalEntrada').textContent = FieldParser.formatMoney(totalEntrada);
    $('#totalSaida').textContent = FieldParser.formatMoney(totalSaida);
    $('#emptyState').hidden = state.lancamentos.length > 0;
    $('#tabelaLancamentos').hidden = state.lancamentos.length === 0;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }

  async function onCellEdit(id, input) {
    const field = input.dataset.field;
    let value = input.value.trim();
    const patch = {};
    if (field === 'entrada' || field === 'saida') {
      patch[field] = value === '' ? null : moneyStrToNumber(value);
    } else {
      patch[field] = value;
    }
    const updated = await Storage.updateLancamento(id, patch);
    if (updated) {
      const idx = state.lancamentos.findIndex(l => l.id === id);
      if (idx !== -1) state.lancamentos[idx] = updated;
      renderTable();
    }
  }

  async function removeLancamento(id) {
    if (!confirm('Remover este lançamento da tabela?')) return;
    await Storage.deleteLancamento(id);
    state.lancamentos = state.lancamentos.filter(l => l.id !== id);
    renderTable();
  }

  // ---------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------
  function resetUploadView() {
    $('#dropzoneEmpty').hidden = false;
    $('#dropzonePreview').hidden = true;
    $('#btnAnalisar').hidden = true;
    $('#progressBox').hidden = true;
    $('#previewImg').src = '';
    state.uploadedFile = null;
    state.uploadedPhoto = null;
  }

  async function onFileChosen(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      toast('Envie um arquivo JPG, JPEG ou PNG.', 'danger');
      return;
    }
    state.uploadedFile = file;
    const url = URL.createObjectURL(file);
    $('#previewImg').src = url;
    $('#dropzoneEmpty').hidden = true;
    $('#dropzonePreview').hidden = false;
    $('#btnAnalisar').hidden = false;
  }

  function setProgress(fraction, label) {
    $('#progressBox').hidden = false;
    $('#progressFill').style.width = `${Math.round(fraction * 100)}%`;
    $('#progressLabel').textContent = label;
  }

  async function startDetection() {
    if (!state.uploadedFile) return;
    state.cancelDetection = false;
    $('#btnAnalisar').hidden = true;
    setProgress(0.02, 'Carregando imagem…');

    let photoCanvas, regions;
    try {
      photoCanvas = await DocumentDetector.loadImageToCanvas(state.uploadedFile);
      state.uploadedPhoto = photoCanvas;

      setProgress(0.08, 'Procurando documentos na foto…');
      regions = await DocumentDetector.detect(state.uploadedFile);
    } catch (e) {
      console.error(e);
      toast('Não foi possível analisar a imagem. Tente novamente.', 'danger');
      $('#progressBox').hidden = true;
      $('#btnAnalisar').hidden = false;
      return;
    }

    if (state.cancelDetection) { resetUploadView(); showView('upload'); return; }

    state.reviewDocs = regions.map((r, i) => makeReviewDoc(r.canvas, i));
    renderReviewCards();
    showView('review');
    $('#reviewHint').textContent =
      regions.length > 1
        ? `${regions.length} documentos identificados automaticamente na foto. Confira e corrija se necessário.`
        : 'Foto tratada como um único documento. Use "Recortar" caso ela contenha mais de um.';

    // OCR em segundo plano, atualizando cada card conforme conclui
    runOcrForAllCards();
  }

  function makeReviewDoc(canvas, index) {
    return {
      localId: uuid(),
      canvas,
      data: '',
      numDoc: 'OUTRO',
      fornecedor: '',
      valor: '',
      tipo: 'saida',
      status: 'pending',   // pending | ok | warn | fail
      ocrText: '',
      order: index
    };
  }

  async function runOcrForAllCards() {
    const docs = state.reviewDocs;
    for (let i = 0; i < docs.length; i++) {
      if (state.cancelDetection) break;
      await ocrOneCard(docs[i], i, docs.length);
    }
  }

  async function ocrOneCard(doc, index, total) {
    setCardStatus(doc.localId, 'pending', `Lendo documento ${index + 1} de ${total}…`);
    try {
      // tenta corrigir orientação 90/180/270 antes da leitura final (best-effort)
      const angle = await OcrEngine.detectOrientation(doc.canvas).catch(() => 0);
      if (angle) {
        doc.canvas = DocumentDetector.rotateCanvas(doc.canvas, angle);
        updateCardThumbnail(doc.localId, doc.canvas);
      }

      const { text } = await OcrEngine.recognize(doc.canvas, null, 25000);
      doc.ocrText = text;
      const parsed = FieldParser.parseDocumentText(text);
      doc.data = parsed.data;
      doc.numDoc = parsed.numDoc;
      doc.fornecedor = parsed.fornecedor;
      doc.valor = parsed.valorFormatado;

      const okCount = Object.values(parsed.confidence).filter(Boolean).length;
      doc.status = okCount >= 3 ? 'ok' : (okCount > 0 ? 'warn' : 'fail');
    } catch (e) {
      console.warn('Falha no OCR de um documento:', e.message);
      doc.status = 'fail';
    }
    fillCardFields(doc);
  }

  // ---------------------------------------------------------------
  // Tela de conferência (cards)
  // ---------------------------------------------------------------
  function renderReviewCards() {
    const grid = $('#cardsGrid');
    grid.innerHTML = '';
    state.reviewDocs.forEach((doc, i) => grid.appendChild(buildCardEl(doc, i)));
  }

  function buildCardEl(doc, index) {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.dataset.localId = doc.localId;
    card.innerHTML = `
      <div class="doc-card__thumb" style="background-image:url('${doc.canvas.toDataURL('image/jpeg', 0.85)}')" data-action="view">
        <button class="doc-card__thumb-btn" type="button" data-action="view">Visualizar</button>
      </div>
      <div class="doc-card__body">
        <div class="doc-card__title">
          <span>Documento ${index + 1}</span>
          <span class="doc-card__status" data-role="status">Lendo…</span>
        </div>
        <div class="doc-card__row">
          <div class="field">
            <label>Data</label>
            <input type="text" data-field="data" placeholder="dd/mm/aaaa" value="${escapeAttr(doc.data)}">
          </div>
          <div class="field">
            <label>Num Doc</label>
            <select data-field="numDoc">
              ${NUM_DOC_OPTIONS.map(o => `<option value="${o}" ${o === doc.numDoc ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Fornecedor/Histórico</label>
          <input type="text" data-field="fornecedor" value="${escapeAttr(doc.fornecedor)}">
        </div>
        <div class="doc-card__row">
          <div class="field field--money">
            <label>Valor (R$)</label>
            <input type="text" data-field="valor" inputmode="decimal" placeholder="0,00" value="${escapeAttr(doc.valor)}">
          </div>
          <div class="field">
            <label>Lançar como</label>
            <select data-field="tipo">
              <option value="saida" ${doc.tipo === 'saida' ? 'selected' : ''}>Saída</option>
              <option value="entrada" ${doc.tipo === 'entrada' ? 'selected' : ''}>Entrada</option>
            </select>
          </div>
        </div>
        <div class="doc-card__actions">
          <button class="btn btn--text" type="button" data-action="rotate">⟳ Girar</button>
          <button class="btn btn--text" type="button" data-action="crop">✂️ Recortar</button>
          <button class="btn btn--text" type="button" data-action="reocr">🔁 Repetir leitura</button>
          <button class="btn btn--text" type="button" data-action="remove">🗑 Remover</button>
        </div>
      </div>
    `;

    card.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('change', () => {
        const doc = getReviewDoc(card.dataset.localId);
        doc[input.dataset.field] = input.value;
      });
    });
    card.querySelector('[data-action="rotate"]').addEventListener('click', () => rotateCard(card.dataset.localId));
    card.querySelector('[data-action="crop"]').addEventListener('click', () => openCropModal(card.dataset.localId));
    card.querySelector('[data-action="reocr"]').addEventListener('click', () => reocrCard(card.dataset.localId));
    card.querySelector('[data-action="remove"]').addEventListener('click', () => removeCard(card.dataset.localId));
    card.querySelectorAll('[data-action="view"]').forEach(el =>
      el.addEventListener('click', () => openViewModal(getReviewDoc(card.dataset.localId).canvas))
    );

    setTimeout(() => setCardStatus(doc.localId, doc.status, statusLabel(doc.status)), 0);
    return card;
  }

  function statusLabel(status) {
    return { pending: 'Lendo…', ok: 'Leitura OK', warn: 'Confira os dados', fail: 'Leitura falhou — preencha' }[status] || '';
  }

  function getReviewDoc(localId) {
    return state.reviewDocs.find(d => d.localId === localId);
  }

  function getCardEl(localId) {
    return $(`.doc-card[data-local-id="${localId}"]`);
  }

  function setCardStatus(localId, status, label) {
    const doc = getReviewDoc(localId);
    if (doc) doc.status = status;
    const el = getCardEl(localId);
    if (!el) return;
    const badge = el.querySelector('[data-role="status"]');
    badge.textContent = label || statusLabel(status);
    badge.className = 'doc-card__status ' + (
      status === 'ok' ? 'doc-card__status--ok' :
      status === 'warn' ? 'doc-card__status--warn' :
      status === 'fail' ? 'doc-card__status--fail' : ''
    );
  }

  function fillCardFields(doc) {
    const el = getCardEl(doc.localId);
    if (!el) return;
    el.querySelector('[data-field="data"]').value = doc.data;
    el.querySelector('[data-field="numDoc"]').value = doc.numDoc;
    el.querySelector('[data-field="fornecedor"]').value = doc.fornecedor;
    el.querySelector('[data-field="valor"]').value = doc.valor;
    setCardStatus(doc.localId, doc.status, statusLabel(doc.status));
  }

  function updateCardThumbnail(localId, canvas) {
    const el = getCardEl(localId);
    if (!el) return;
    el.querySelector('.doc-card__thumb').style.backgroundImage = `url('${canvas.toDataURL('image/jpeg', 0.85)}')`;
  }

  function rotateCard(localId) {
    const doc = getReviewDoc(localId);
    doc.canvas = DocumentDetector.rotateCanvas(doc.canvas, 90);
    updateCardThumbnail(localId, doc.canvas);
  }

  async function reocrCard(localId) {
    const doc = getReviewDoc(localId);
    const idx = state.reviewDocs.indexOf(doc);
    await ocrOneCard(doc, idx, state.reviewDocs.length);
  }

  function removeCard(localId) {
    state.reviewDocs = state.reviewDocs.filter(d => d.localId !== localId);
    renderReviewCards();
  }

  function addBlankCard() {
    const source = state.uploadedPhoto;
    if (!source) { toast('Envie uma foto primeiro.', 'danger'); return; }
    const doc = makeReviewDoc(source, state.reviewDocs.length);
    doc.status = 'warn';
    state.reviewDocs.push(doc);
    renderReviewCards();
  }

  async function confirmAddToTable() {
    if (state.reviewDocs.length === 0) {
      toast('Nenhum documento para adicionar.', 'danger');
      return;
    }
    const payload = state.reviewDocs.map(doc => {
      const valorNum = moneyStrToNumber(doc.valor);
      return {
        data: doc.data.trim(),
        numDoc: doc.numDoc,
        fornecedor: doc.fornecedor.trim(),
        entrada: doc.tipo === 'entrada' ? valorNum : null,
        saida: doc.tipo === 'saida' ? valorNum : null
      };
    });
    const novos = await Storage.addLancamentos(payload);
    state.lancamentos = state.lancamentos.concat(novos);
    renderTable();

    state.reviewDocs = [];
    resetUploadView();
    showView('table');
    toast(`${novos.length} documento(s) adicionado(s) à tabela.`, 'success');
  }

  function cancelReview() {
    if (!confirm('Descartar os documentos desta foto?')) return;
    state.reviewDocs = [];
    resetUploadView();
    showView('table');
  }

  // ---------------------------------------------------------------
  // Modal de recorte manual
  // ---------------------------------------------------------------
  let cropDragState = null;
  let cropSelection = null;      // {x,y,w,h} em coords do canvas de exibição (escala reduzida)
  let cropDisplayScale = 1;
  let cropWorkingCanvas = null;  // canvas em resolução real (pode ser girado antes do recorte)

  function layoutCropStage(canvas, source) {
    const stage = $('#cropStage');
    const maxW = Math.min(600, stage.clientWidth || 600);
    cropDisplayScale = Math.min(1, maxW / source.width);
    canvas.width = Math.round(source.width * cropDisplayScale);
    canvas.height = Math.round(source.height * cropDisplayScale);
    cropSelection = null;
    redrawCropCanvas(canvas, source);
    wireCropCanvasEvents(canvas, source);
  }

  function openCropModal(localId) {
    state.cropTargetLocalId = localId;
    const doc = getReviewDoc(localId);
    cropWorkingCanvas = doc.canvas;
    const canvas = $('#cropCanvas');
    layoutCropStage(canvas, cropWorkingCanvas);
    $('#modalCrop').hidden = false;
  }

  function redrawCropCanvas(canvas, source) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (cropSelection) {
      ctx.strokeStyle = '#E29B2B';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(cropSelection.x, cropSelection.y, cropSelection.w, cropSelection.h);
      ctx.fillStyle = 'rgba(226,155,43,0.15)';
      ctx.fillRect(cropSelection.x, cropSelection.y, cropSelection.w, cropSelection.h);
    }
  }

  function wireCropCanvasEvents(canvas, source) {
    const getPos = evt => {
      const rect = canvas.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      return {
        x: Math.max(0, Math.min(canvas.width, (clientX - rect.left) * (canvas.width / rect.width))),
        y: Math.max(0, Math.min(canvas.height, (clientY - rect.top) * (canvas.height / rect.height)))
      };
    };
    const onDown = evt => {
      evt.preventDefault();
      const p = getPos(evt);
      cropDragState = { startX: p.x, startY: p.y };
      cropSelection = { x: p.x, y: p.y, w: 0, h: 0 };
    };
    const onMove = evt => {
      if (!cropDragState) return;
      evt.preventDefault();
      const p = getPos(evt);
      const x = Math.min(cropDragState.startX, p.x);
      const y = Math.min(cropDragState.startY, p.y);
      const w = Math.abs(p.x - cropDragState.startX);
      const h = Math.abs(p.y - cropDragState.startY);
      cropSelection = { x, y, w, h };
      redrawCropCanvas(canvas, source);
    };
    const onUp = () => { cropDragState = null; };

    canvas.onmousedown = onDown;
    canvas.onmousemove = onMove;
    if (window.__cropMouseUpHandler) window.removeEventListener('mouseup', window.__cropMouseUpHandler);
    window.__cropMouseUpHandler = onUp;
    window.addEventListener('mouseup', onUp);
    canvas.ontouchstart = onDown;
    canvas.ontouchmove = onMove;
    canvas.ontouchend = onUp;
  }

  function confirmCrop() {
    const doc = getReviewDoc(state.cropTargetLocalId);
    if (!doc) { $('#modalCrop').hidden = true; return; }
    if (!cropSelection || cropSelection.w < 8 || cropSelection.h < 8) {
      toast('Desenhe um retângulo sobre o documento antes de confirmar.', 'danger');
      return;
    }
    const rect = {
      x: cropSelection.x / cropDisplayScale,
      y: cropSelection.y / cropDisplayScale,
      width: cropSelection.w / cropDisplayScale,
      height: cropSelection.h / cropDisplayScale
    };
    doc.canvas = DocumentDetector.cropRect(cropWorkingCanvas, rect);
    updateCardThumbnail(doc.localId, doc.canvas);
    $('#modalCrop').hidden = true;
    toast('Recorte aplicado. Use "Repetir leitura" para tentar reconhecer o texto novamente.');
  }

  function resetCropToFull() {
    if (!state.uploadedPhoto) return;
    cropWorkingCanvas = state.uploadedPhoto;
    layoutCropStage($('#cropCanvas'), cropWorkingCanvas);
  }

  function rotateCropPreview(delta) {
    if (!cropWorkingCanvas) return;
    cropWorkingCanvas = DocumentDetector.rotateCanvas(cropWorkingCanvas, delta);
    layoutCropStage($('#cropCanvas'), cropWorkingCanvas);
  }

  // ---------------------------------------------------------------
  // Modal de visualização
  // ---------------------------------------------------------------
  function openViewModal(canvas) {
    // Nunca deixe o modal de visualização aberto por cima do modal de recorte.
    $('#modalView').hidden = true;
    $('#modalCrop').hidden = true;

    const img = $('#viewImg');
    if (!canvas || typeof canvas.toDataURL !== 'function') {
      img.removeAttribute('src');
      $('#modalView').hidden = false;
      return;
    }

    try {
      img.src = canvas.toDataURL('image/jpeg', 0.9);
      $('#modalView').hidden = false;
    } catch (err) {
      console.error('Falha ao gerar pré-visualização:', err);
      img.removeAttribute('src');
      $('#modalView').hidden = false;
      toast('Não foi possível visualizar este documento.', 'danger');
    }
  }

  // ---------------------------------------------------------------
  // Exportação
  // ---------------------------------------------------------------
  async function handleExportExcel() {
    if (state.lancamentos.length === 0) { toast('Não há lançamentos para exportar.', 'danger'); return; }
    try {
      ExportExcel.download(state.lancamentos, state.config);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Falha ao gerar o Excel.', 'danger');
    }
  }

  async function handleExportPdf() {
    if (state.lancamentos.length === 0) { toast('Não há lançamentos para exportar.', 'danger'); return; }
    try {
      await ExportPdf.download(state.lancamentos, state.config, state.logo);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Falha ao gerar o PDF.', 'danger');
    }
  }

  // ---------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------
  function wireEvents() {
    $('#btnLerDocumentos').addEventListener('click', () => { resetUploadView(); showView('upload'); });
    $('#btnVoltarDeUpload').addEventListener('click', () => { resetUploadView(); showView('table'); });
    $('#btnBaixarExcel').addEventListener('click', handleExportExcel);
    $('#btnGerarPdf').addEventListener('click', handleExportPdf);

    $('#btnEscolherArquivo').addEventListener('click', () => $('#inputArquivo').click());
    $('#btnTirarFoto').addEventListener('click', () => $('#inputCamera').click());
    $('#inputArquivo').addEventListener('change', e => onFileChosen(e.target.files[0]));
    $('#inputCamera').addEventListener('change', e => onFileChosen(e.target.files[0]));
    $('#btnTrocarImagem').addEventListener('click', () => resetUploadView());
    $('#btnAnalisar').addEventListener('click', startDetection);
    $('#btnCancelarAnalise').addEventListener('click', () => {
      state.cancelDetection = true;
      resetUploadView();
    });

    const dz = $('#dropzone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('is-dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('is-dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('is-dragover');
      const file = e.dataTransfer.files[0];
      onFileChosen(file);
    });

    $('#btnVoltarDeRevisao').addEventListener('click', () => { resetUploadView(); showView('upload'); });
    $('#btnAdicionarCardVazio').addEventListener('click', addBlankCard);
    $('#btnConfirmarAdicao').addEventListener('click', confirmAddToTable);
    $('#btnCancelarRevisao').addEventListener('click', cancelReview);

    $('#btnConfig').addEventListener('click', openConfigModal);
    $('#btnCancelarConfig').addEventListener('click', () => { $('#modalConfig').hidden = true; });
    $('#btnSalvarConfig').addEventListener('click', saveConfigModal);

    $('#btnCancelarCrop').addEventListener('click', () => { $('#modalCrop').hidden = true; });
    $('#btnConfirmarCrop').addEventListener('click', confirmCrop);
    $('#btnResetCrop').addEventListener('click', resetCropToFull);
    $('#btnGirarEsquerda').addEventListener('click', () => rotateCropPreview(-90));
    $('#btnGirarDireita').addEventListener('click', () => rotateCropPreview(90));

    // Fechamento robusto do visualizador.
    $('#btnFecharView').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      $('#modalView').hidden = true;
      $('#viewImg').removeAttribute('src');
    });

    [$('#modalConfig'), $('#modalCrop'), $('#modalView')].forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target === modal) {
          modal.hidden = true;
          if (modal.id === 'modalView') $('#viewImg').removeAttribute('src');
        }
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        $('#modalView').hidden = true;
        $('#modalCrop').hidden = true;
        $('#modalConfig').hidden = true;
        $('#viewImg').removeAttribute('src');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
