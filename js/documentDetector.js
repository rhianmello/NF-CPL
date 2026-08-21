/**
 * documentDetector.js
 * ---------------------------------------------------------------------
 * Detecta documentos físicos distintos em uma foto usando OpenCV.js.
 * A detecção é conservadora: bordas de texto, sombras e blocos internos
 * não devem virar documentos separados. Quando não houver evidência
 * suficiente de documentos distintos, a foto inteira é tratada como 1.
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
      if (fileOrDataUrl instanceof Blob) img.src = URL.createObjectURL(fileOrDataUrl);
      else img.src = fileOrDataUrl;
    });
  }

  function orderPoints(pts) {
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]];
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function warpQuad(cv, srcMat, pointsRaw) {
    const pts = orderPoints(pointsRaw);
    const [tl, tr, br, bl] = pts;
    const widthTop = dist(tl, tr);
    const widthBottom = dist(bl, br);
    const heightLeft = dist(tl, bl);
    const heightRight = dist(tr, br);
    const outW = Math.max(Math.round(Math.max(widthTop, widthBottom)), 10);
    const outH = Math.max(Math.round(Math.max(heightLeft, heightRight)), 10);

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
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

  /** Verifica se o contorno tem geometria compatível com uma folha/documento. */
  function isDocumentContour(cv, cnt, rectArea, imgArea) {
    const perimeter = cv.arcLength(cnt, true);
    if (!perimeter) return false;

    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.025 * perimeter, true);
    const vertices = approx.rows;
    const convex = cv.isContourConvex(approx);
    approx.delete();

    // Documento deve parecer um quadrilátero e ocupar uma área relevante.
    if (!convex || vertices !== 4) return false;

    const contourArea = cv.contourArea(cnt);
    const rectangularity = contourArea / Math.max(rectArea, 1);
    if (rectangularity < 0.62) return false;

    // Evita quadrados/retângulos minúsculos que são apenas elementos da interface.
    if (rectArea < imgArea * 0.035) return false;
    return true;
  }

  /**
   * Detecta documentos individuais numa foto.
   * Retorna 1 documento quando não existe evidência geométrica suficiente
   * para afirmar que há vários documentos.
   */
  async function detect(fileOrDataUrl) {
    const sourceCanvas = await loadImageToCanvas(fileOrDataUrl);

    let cv;
    try {
      await waitForOpenCV();
      cv = window.cv;
    } catch (e) {
      console.warn('OpenCV indisponível; usando a foto inteira como um único documento.', e);
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
      cv.Canny(blurred, edges, 50, 150);

      dilated = new cv.Mat();
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
      cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 1);
      kernel.delete();

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const imgArea = sourceCanvas.width * sourceCanvas.height;
      const minArea = imgArea * 0.035;
      const maxArea = imgArea * 0.90;
      const candidates = [];

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const contourArea = cv.contourArea(cnt);
        if (contourArea < minArea) { cnt.delete(); continue; }

        const rot = cv.minAreaRect(cnt);
        const rectArea = rot.size.width * rot.size.height;
        if (rectArea < minArea || rectArea > maxArea) { cnt.delete(); continue; }

        const aspect = Math.max(rot.size.width, rot.size.height) /
          Math.max(1, Math.min(rot.size.width, rot.size.height));
        if (aspect > 3.2) { cnt.delete(); continue; }

        if (!isDocumentContour(cv, cnt, rectArea, imgArea)) {
          cnt.delete();
          continue;
        }

        const boxPts = cv.RotatedRect.points(rot);
        candidates.push({
          points: boxPts.map(p => ({ x: p.x, y: p.y })),
          area: rectArea,
          center: { x: rot.center.x, y: rot.center.y }
        });
        cnt.delete();
      }

      // Remove candidatos que representam praticamente o mesmo documento.
      const filtered = candidates
        .sort((a, b) => b.area - a.area)
        .filter((c, idx, arr) => {
          for (let j = 0; j < idx; j++) {
            const other = arr[j];
            const centerDistance = Math.hypot(c.center.x - other.center.x, c.center.y - other.center.y);
            const similarArea = Math.min(c.area, other.area) / Math.max(c.area, other.area);
            if (centerDistance < 0.12 * Math.sqrt(imgArea) && similarArea > 0.55) return false;
          }
          return true;
        });

      let results;
      if (filtered.length <= 1) {
        results = [{ canvas: sourceCanvas, area: imgArea, auto: false }];
      } else {
        results = filtered.map(c => ({
          canvas: warpQuad(cv, src, c.points),
          area: c.area,
          auto: true,
          center: c.center
        }));

        results.sort((a, b) => {
          const rowDiff = Math.round(a.center.y / 80) - Math.round(b.center.y / 80);
          if (rowDiff !== 0) return rowDiff;
          return a.center.x - b.center.x;
        });
      }

      return results;
    } catch (e) {
      console.error('Erro na detecção de documentos; usando a foto inteira.', e);
      return [{ canvas: sourceCanvas, area: sourceCanvas.width * sourceCanvas.height, auto: false }];
    } finally {
      [src, gray, blurred, edges, dilated, hierarchy].forEach(m => m && m.delete && m.delete());
      if (contours) contours.delete();
    }
  }

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

  function cropRect(canvas, rect) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(rect.width));
    out.height = Math.max(1, Math.round(rect.height));
    out.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
    return out;
  }

  return { detect, loadImageToCanvas, rotateCanvas, cropRect };
})();
