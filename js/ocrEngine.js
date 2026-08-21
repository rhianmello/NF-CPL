/**
 * ocrEngine.js
 * OCR robusto para NF/DANFE/recibos fotografados.
 */

const OcrEngine = (() => {
  const DEFAULT_TIMEOUT_MS = 25000;
  let workerPromise = null;

  function getWorker() {
    if (workerPromise) return workerPromise;
    if (typeof Tesseract === 'undefined') {
      return Promise.reject(new Error('Biblioteca de OCR (Tesseract.js) não foi carregada.'));
    }
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker('por', 1, { logger: () => {} });
      return worker;
    })();
    return workerPromise;
  }

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`TIMEOUT:${label || 'operação'}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Cria uma versão mais legível para fotos com moiré, sombra e baixo contraste.
  function preprocess(canvas) {
    const scale = 1.5;
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, out.width, out.height);

    const image = ctx.getImageData(0, 0, out.width, out.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // contraste local simples: reduz a aparência acinzentada da fotografia.
      let v = (gray - 128) * 1.45 + 128;
      v = Math.max(0, Math.min(255, v));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(image, 0, 0);
    return out;
  }

  async function recognizePass(worker, canvas, psm, timeoutMs) {
    try {
      await withTimeout(worker.setParameters({ tessedit_pageseg_mode: String(psm) }), 4000, 'configuração OCR');
    } catch (_) { /* algumas versões ignoram o parâmetro; seguimos com o padrão */ }

    const result = await withTimeout(
      worker.recognize(canvas, {}, { text: true }),
      timeoutMs,
      `leitura PSM ${psm}`
    );
    return {
      text: result?.data?.text || '',
      confidence: result?.data?.confidence ?? 0
    };
  }

  /**
   * Faz duas leituras complementares. PSM 6 funciona melhor em recibos
   * tabulares; PSM 11 funciona melhor quando há texto espalhado na foto.
   * O texto das duas leituras é combinado para o parser contextual.
   */
  async function recognize(canvas, onProgress, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const worker = await withTimeout(getWorker(), timeoutMs, 'inicialização do OCR');
    try {
      const prepared = preprocess(canvas);
      const pass6 = await recognizePass(worker, prepared, 6, timeoutMs);
      if (onProgress) onProgress(0.5);
      const pass11 = await recognizePass(worker, prepared, 11, timeoutMs);
      if (onProgress) onProgress(1);

      const parts = [pass6.text, pass11.text].filter(Boolean);
      const text = parts.join('\n\n--- OCR COMPLEMENTAR ---\n\n');
      return {
        text,
        confidence: Math.max(pass6.confidence || 0, pass11.confidence || 0)
      };
    } catch (e) {
      if (String(e.message).startsWith('TIMEOUT')) {
        throw new Error('A leitura demorou demais e foi cancelada. Preencha os campos manualmente.');
      }
      throw new Error('Não foi possível ler este documento automaticamente. Preencha os campos manualmente.');
    }
  }

  async function detectOrientation(canvas, timeoutMs = 6000) {
    // Não corrige silenciosamente uma foto que o usuário pediu para manter em pé.
    // O app pode usar o botão Girar quando necessário.
    try {
      const worker = await withTimeout(getWorker(), timeoutMs, 'OSD');
      if (typeof worker.detect !== 'function') return 0;
      const { data } = await withTimeout(worker.detect(canvas), timeoutMs, 'OSD');
      const deg = data?.orientation_degrees;
      if ([0, 90, 180, 270].includes(deg)) return deg;
      return 0;
    } catch (e) {
      return 0;
    }
  }

  async function terminate() {
    if (workerPromise) {
      try {
        const w = await workerPromise;
        await w.terminate();
      } catch (e) { /* ignore */ }
      workerPromise = null;
    }
  }

  return { recognize, detectOrientation, terminate };
})();
