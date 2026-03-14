/**
 * Preprocess a drawing canvas for model inference.
 * Finds the bounding box, centers and scales the drawing to 28x28,
 * converts to grayscale float tensor.
 *
 * Returns { tensor, thumbnail? } where tensor is an ort.Tensor [1,1,28,28]
 */

export function preprocessCanvas(canvas, { debugElement = null, returnThumbnail = false } = {}) {
  const ctx = canvas.getContext('2d');
  const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (srcData[i + 3] > 0 && (srcData[i] < 200 || srcData[i + 1] < 200 || srcData[i + 2] < 200)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = 28;
  tmpCanvas.height = 28;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.fillStyle = 'white';
  tmpCtx.fillRect(0, 0, 28, 28);

  if (maxX > minX && maxY > minY) {
    const padding = 2;
    const drawW = maxX - minX;
    const drawH = maxY - minY;
    const scale = (28 - padding * 2) / Math.max(drawW, drawH);
    const w = drawW * scale;
    const h = drawH * scale;
    const offX = (28 - w) / 2;
    const offY = (28 - h) / 2;
    tmpCtx.drawImage(canvas, minX, minY, drawW, drawH, offX, offY, w, h);
  }

  const imageData = tmpCtx.getImageData(0, 0, 28, 28);
  const data = imageData.data;
  const input = new Float32Array(28 * 28);

  for (let i = 0; i < 28 * 28; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const gray = (r + g + b) / 3;
    input[i] = 1.0 - gray / 255.0;
  }

  if (debugElement) {
    tmpCtx.putImageData(imageData, 0, 0);
    debugElement.style.display = '';
    debugElement.src = tmpCanvas.toDataURL();
  }

  const result = { tensor: new ort.Tensor('float32', input, [1, 1, 28, 28]) };
  if (returnThumbnail) {
    result.thumbnail = tmpCanvas.toDataURL();
  }
  return result;
}
