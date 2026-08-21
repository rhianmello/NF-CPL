/**
 * documentDetector.js
 * Uma foto = um único documento.
 * A imagem deve estar em orientação retrato (em pé).
 */

const DocumentDetector = (() => {
  function loadImageToCanvas(fileOrDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width >= height) {
          reject(new Error('ORIENTACAO: A imagem precisa estar em pé (modo retrato). Tire a foto novamente na vertical.'));
          return;
        }
        const MAX_SIDE = 2600;
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
      img.src = fileOrDataUrl instanceof Blob ? URL.createObjectURL(fileOrDataUrl) : fileOrDataUrl;
    });
  }

  async function detect(fileOrDataUrl) {
    const canvas = await loadImageToCanvas(fileOrDataUrl);
    return [{ canvas, area: canvas.width * canvas.height, auto: false, singleDocument: true }];
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
    ctx.rotate(deg * Math.PI / 180);
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
