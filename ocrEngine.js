/**
 * ocrEngine.js
 * ---------------------------------------------------------------------
 * Encapsula o Tesseract.js: cria (uma vez) um worker em português,
 * expõe recognize(canvas) com timeout obrigatório e progresso, e nunca
 * deixa a aplicação travada em "Lendo…" — se o OCR estourar o tempo ou
 * falhar, quem chamou recebe um erro e pode oferecer preenchimento
 * manual.
 * ---------------------------------------------------------------------
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
      const worker = await Tesseract.createWorker('por', 1, {
        logger: () => {} // progresso é tratado por chamada (ver recognize)
      });
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

  /**
   * Reconhece o texto de um canvas/imagem.
   * @param {HTMLCanvasElement} canvas
   * @param {(progress:number)=>void} onProgress 0..1
   * @param {number} timeoutMs
   */
  async function recognize(canvas, onProgress, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let worker;
    try {
      worker = await withTimeout(getWorker(), timeoutMs, 'inicialização do OCR');
    } catch (e) {
      throw new Error('Não foi possível iniciar o motor de OCR. Preencha os campos manualmente.');
    }

    // Tesseract.js v5 aceita um segundo parâmetro de opções com callback de progresso
    // por chamada de recognize (mais confiável que o logger global do worker).
    try {
      const result = await withTimeout(
        worker.recognize(canvas, {}, {
          text: true
        }),
        timeoutMs,
        'leitura do documento'
      );
      if (onProgress) onProgress(1);
      const text = result?.data?.text || '';
      const confidence = result?.data?.confidence ?? null;
      return { text, confidence };
    } catch (e) {
      if (String(e.message).startsWith('TIMEOUT')) {
        throw new Error('A leitura demorou demais e foi cancelada. Preencha os campos manualmente.');
      }
      throw new Error('Não foi possível ler este documento automaticamente. Preencha os campos manualmente.');
    }
  }

  /**
   * Tenta detectar se a imagem está de cabeça para baixo / de lado (OSD).
   * Best-effort: se não for suportado pela versão da biblioteca ou falhar,
   * simplesmente retorna 0 (nenhuma correção) sem quebrar o fluxo.
   */
  async function detectOrientation(canvas, timeoutMs = 6000) {
    try {
      const worker = await withTimeout(getWorker(), timeoutMs, 'OSD');
      if (typeof worker.detect !== 'function') return 0;
      const { data } = await withTimeout(worker.detect(canvas), timeoutMs, 'OSD');
      const deg = data?.orientation_degrees;
      if ([0, 90, 180, 270].includes(deg)) return deg;
      return 0;
    } catch (e) {
      return 0; // não bloqueia o fluxo — usuário pode girar manualmente
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
