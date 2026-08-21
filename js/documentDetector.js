/**
 * documentDetector.js
 * ---------------------------------------------------------------------
 * Recebe uma foto (que pode conter vários documentos colados numa
 * folha) e tenta separar cada documento em uma imagem própria, já
 * endireitada (deskew) via OpenCV.js.
 *
 * Se o OpenCV.js não carregar (ex.: sem internet/CDN bloqueado) ou não
 * encontrar contornos plausíveis, cai no fallback de tratar a foto
 * inteira como um único documento — o usuário sempre pode recortar
 * manualmente depois (ver modal de recorte no app.js).
 * ---------------------------------------------------------------------
 */

const DocumentDetector = (() => {

  let cvReadyPromise = null;

  function waitForOpenCV(timeoutMs = 15000) {
    if (cvReadyPromise) return cvReadyPromise;
    cvReadyPromise = new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        if (window.cv && window.cv.Mat) return resolve(true);
        if (Date.now() - start > timeoutMs) return reject(new Error('OpenCV.js não carregou a tempo'));
        setTimeout(check, 150);
      })();
    });
    return cvReadyPromise;
  }

  function loadImageToCanvas(fileOrDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // limita o lado maior para manter desempenho razoável no navegador
        const MAX_SIDE = 2200;
        let { width, height } = img;
        const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      if (fileOrDataUrl instanceof Blob) {
        img.src = URL.createObjectURL(fileOrDataUrl);
      } else {
        img.src = fileOrDataUrl;
      }
    });
  }

  function orderPoints(pts) {
    // pts: [{x,y} x4] -> retorna [tl, tr, br, bl]
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]]; // tl, tr, br, bl
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Recorta+endireita a região definida por 4 pontos (ordem livre) usando warpPerspective. */
  function warpQuad(cv, srcMat, pointsRaw) {
    const pts = orderPoints(pointsRaw);
    const [tl, tr, br, bl] = pts;
    const widthTop = dist(tl, tr);
    const widthBottom = dist(bl, br);
    const heightLeft = dist(tl, bl);
    const heightRight = dist(tr, br);
    const outW = Math.max(Math.round(Math.max(widthTop, widthBottom)), 10);
    const outH = Math.max(Math.round(Math.max(heightLeft, heightRight)), 10);

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, outW, 0, outW, outH, 0, outH
    ]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    const dsize = new cv.Size(outW, outH);
    cv.warpPerspective(srcMat, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    cv.imshow(outCanvas, dst);

    srcTri.delete(); dstTri.delete(); M.delete(); dst.delete();
    return outCanvas;
  }

  function matToCanvas(cv, mat) {
    const c = document.createElement('canvas');
    cv.imshow(c, mat);
    return c;
  }

  /**
   * Detecta documentos individuais numa foto.
   * @returns {Promise<{canvas:HTMLCanvasElement, area:number}[]>}
   */
  async function detect(fileOrDataUrl) {
    const sourceCanvas = await loadImageToCanvas(fileOrDataUrl);

    let cv;
    try {
      await waitForOpenCV();
      cv = window.cv;
    } catch (e) {
      console.warn('OpenCV indisponível, usando a foto inteira como um único documento.', e);
      return [{ canvas: sourceCanvas, area: sourceCanvas.width * sourceCanvas.height, auto: false }];
    }

    let src, gray, blurred, edges, dilated, hierarchy, contours;
    try {
      src = cv.imread(sourceCanvas);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      edges = new cv.Mat();
      cv.Canny(blurred, edges, 40, 120);

      dilated = new cv.Mat();
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
      cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 2);
      kernel.delete();

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const imgArea = sourceCanvas.width * sourceCanvas.height;
      const minArea = imgArea * 0.03;   // ignora ruído pequeno
      const maxArea = imgArea * 0.98;   // um contorno colado à borda inteira não é "um documento separado"

      const candidates = [];
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < minArea) { cnt.delete(); continue; }

        const rot = cv.minAreaRect(cnt);
        const rectArea = rot.size.width * rot.size.height;
        // descarta formas muito "fininhas" (provavelmente sombra/linha, não um documento)
        const aspect = Math.max(rot.size.width, rot.size.height) / Math.max(1, Math.min(rot.size.width, rot.size.height));
        if (aspect > 6) { cnt.delete(); continue; }
        if (rectArea > maxArea) { cnt.delete(); continue; }

        const boxPts = cv.RotatedRect.points(rot);
        candidates.push({
          points: boxPts.map(p => ({ x: p.x, y: p.y })),
          area: rectArea,
          center: rot.center
        });
        cnt.delete();
      }

      // remove caixas quase totalmente contidas dentro de outra maior (evita duplicar o mesmo doc)
      const filtered = candidates
        .sort((a, b) => b.area - a.area)
        .filter((c, idx, arr) => {
          for (let j = 0; j < idx; j++) {
            const other = arr[j];
            const dx = Math.abs(c.center.x - other.center.x);
            const dy = Math.abs(c.center.y - other.center.y);
            if (dx < 30 && dy < 30) return false; // praticamente o mesmo centro -> duplicado
          }
          return true;
        });

      let results;
      if (filtered.length === 0) {
        results = [{ canvas: sourceCanvas, area: imgArea, auto: false }];
      } else if (filtered.length === 1 && filtered[0].area > imgArea * 0.85) {
        // um único contorno cobrindo quase tudo = a foto já é um documento só
        results = [{ canvas: sourceCanvas, area: imgArea, auto: false }];
      } else {
        results = filtered.map(c => ({
          canvas: warpQuad(cv, src, c.points),
          area: c.area,
          auto: true,
          center: c.center
        }));
        // ordena em ordem de leitura: topo->baixo, esquerda->direita
        results.sort((a, b) => {
          const rowDiff = Math.round(a.center.y / 80) - Math.round(b.center.y / 80);
          if (rowDiff !== 0) return rowDiff;
          return a.center.x - b.center.x;
        });
      }

      return results;
    } catch (e) {
      console.error('Erro na detecção de documentos, usando a foto inteira.', e);
      return [{ canvas: sourceCanvas, area: sourceCanvas.width * sourceCanvas.height, auto: false }];
    } finally {
      [src, gray, blurred, edges, dilated, hierarchy].forEach(m => m && m.delete && m.delete());
      if (contours) contours.delete();
    }
  }

  /** Gira um canvas em múltiplos de 90°. */
  function rotateCanvas(canvas, degrees) {
    const deg = ((degrees % 360) + 360) % 360;
    if (deg === 0) return canvas;
    const swap = deg === 90 || deg === 270;
    const out = document.createElement('canvas');
    out.width = swap ? canvas.height : canvas.width;
    out.height = swap ? canvas.width : canvas.height;
    const ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return out;
  }

  /** Recorta manualmente um retângulo (em coordenadas do canvas original) sem OpenCV. */
  function cropRect(canvas, rect) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(rect.width));
    out.height = Math.max(1, Math.round(rect.height));
    out.getContext('2d').drawImage(
      canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height
    );
    return out;
  }

  return { detect, loadImageToCanvas, rotateCanvas, cropRect };
})();
