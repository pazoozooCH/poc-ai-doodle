const LABELS = [
  'airplane', 'apple', 'banana', 'bicycle', 'bird', 'sailboat', 'car', 'cat',
  'clock', 'dog', 'fish', 'flower', 'guitar', 'hat', 'skull', 'house',
  'lightning', 'moon', 'pizza', 'shoe', 'smiley face', 'star', 'sun',
  'tree', 'umbrella'
];

let model = null;
let samplesData = null;
let isDrawing = false;
let hasStrokes = false;
let classifyInterval = null;
let aiDrawing = false;

// Canvas setup
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
ctx.lineWidth = 16;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.strokeStyle = '#000';

// Drawing
let lastX = 0, lastY = 0;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  if (e.touches) {
    return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
  }
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function startDraw(e) {
  e.preventDefault();
  stopAiDraw();
  isDrawing = true;
  const pos = getPos(e);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(e) {
  e.preventDefault();
  if (!isDrawing) return;
  hasStrokes = true;
  const pos = getPos(e);
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  lastX = pos.x;
  lastY = pos.y;
}

function endDraw(e) {
  e.preventDefault();
  isDrawing = false;
}

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', endDraw, { passive: false });

document.getElementById('btn-clear').addEventListener('click', clearCanvas);

function clearCanvas() {
  stopAiDraw();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasStrokes = false;
  document.getElementById('predictions').innerHTML = '';
  document.getElementById('top-prediction').textContent = 'Draw something!';
}

// Model inference (same preprocessing as game.js)
function preprocessCanvas() {
  const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (srcData[i + 3] > 0 && (srcData[i] < 200 || srcData[i+1] < 200 || srcData[i+2] < 200)) {
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

  const debugEl = document.getElementById('debug-preview');
  if (debugEl) {
    tmpCtx.putImageData(imageData, 0, 0);
    debugEl.style.display = '';
    debugEl.src = tmpCanvas.toDataURL();
  }

  return new ort.Tensor('float32', input, [1, 1, 28, 28]);
}

function softmax(arr) {
  const max = Math.max(...arr);
  const exps = arr.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b);
  return exps.map(x => x / sum);
}

async function classifyRaw(inputArray) {
  const tensor = new ort.Tensor('float32', inputArray, [1, 1, 28, 28]);
  const output = await model.run({ input: tensor });
  const logits = Array.from(output.output.data);
  return softmax(logits);
}

async function classify() {
  if (!model || !hasStrokes) return;

  const tensor = preprocessCanvas();
  const output = await model.run({ input: tensor });
  const logits = Array.from(output.output.data);
  const probs = softmax(logits);

  const results = LABELS.map((label, i) => ({ label, prob: probs[i] }))
    .sort((a, b) => b.prob - a.prob);

  document.getElementById('top-prediction').textContent =
    `${results[0].label} (${(results[0].prob * 100).toFixed(0)}%)`;

  const container = document.getElementById('predictions');
  container.innerHTML = results.slice(0, 5).map(r => {
    const pct = (r.prob * 100).toFixed(0);
    const hue = Math.round(r.prob * 120);
    const bg = `hsl(${hue}, 70%, 30%)`;
    const color = `hsl(${hue}, 80%, 80%)`;
    return `<span class="prediction-tag" style="background:${bg};color:${color}">${r.label} ${pct}%</span>`;
  }).join('');
}

// --- Show Examples ---
async function loadSamples() {
  const resp = await fetch('/model/samples.json');
  samplesData = await resp.json();
}

function showExamples() {
  const cat = document.getElementById('category-select').value;
  const grid = document.getElementById('examples-grid');
  if (!samplesData || !samplesData[cat]) {
    grid.innerHTML = '<span style="color:#888">No samples available</span>';
    return;
  }
  grid.innerHTML = samplesData[cat].map(b64 =>
    `<img src="data:image/png;base64,${b64}" width="56" height="56" style="border:1px solid #333;border-radius:4px;image-rendering:pixelated;cursor:pointer" class="sample-img">`
  ).join('');

  // Click a sample to load it onto the canvas
  grid.querySelectorAll('.sample-img').forEach(img => {
    img.addEventListener('click', () => {
      const tmpImg = new Image();
      tmpImg.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tmpImg, 0, 0, canvas.width, canvas.height);
        hasStrokes = true;
      };
      tmpImg.src = img.src;
    });
  });
}

// --- AI Draw (iterative optimization) ---
// Works on a 28x28 pixel grid directly, renders scaled up to canvas.
// Each step: try adding a random short stroke, keep if target prob increases.

function stopAiDraw() {
  aiDrawing = false;
  document.getElementById('btn-ai-draw').textContent = 'Watch AI Draw';
  document.getElementById('ai-status').textContent = '';
}

function pixelsToImageData(pixels, size) {
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = size;
  tmpCanvas.height = size;
  const tmpCtx = tmpCanvas.getContext('2d');
  const imgData = tmpCtx.createImageData(size, size);
  const scale = size / 28;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = Math.floor(x / scale);
      const srcY = Math.floor(y / scale);
      const val = pixels[srcY * 28 + srcX];
      const gray = Math.round((1 - val) * 255);
      const idx = (y * size + x) * 4;
      imgData.data[idx] = gray;
      imgData.data[idx + 1] = gray;
      imgData.data[idx + 2] = gray;
      imgData.data[idx + 3] = 255;
    }
  }
  tmpCtx.putImageData(imgData, 0, 0);
  return tmpCanvas;
}

function renderPixelsToCanvas(pixels) {
  const tmpCanvas = pixelsToImageData(pixels, canvas.width);
  ctx.drawImage(tmpCanvas, 0, 0);
}

function pixelsToDataURL(pixels) {
  return pixelsToImageData(pixels, 56).toDataURL();
}

// Best snapshots gallery
const topSnapshots = []; // { prob, dataURL }
const MAX_SNAPSHOTS = 5;

function updateGallery(pixels, prob, cat) {
  const dominated = topSnapshots.length >= MAX_SNAPSHOTS && prob <= topSnapshots[topSnapshots.length - 1].prob;
  if (dominated) return;

  const dataURL = pixelsToDataURL(pixels);
  topSnapshots.push({ prob, dataURL });
  topSnapshots.sort((a, b) => b.prob - a.prob);
  if (topSnapshots.length > MAX_SNAPSHOTS) topSnapshots.length = MAX_SNAPSHOTS;

  const gallery = document.getElementById('ai-gallery');
  gallery.innerHTML = topSnapshots.map(s => {
    const pct = (s.prob * 100).toFixed(0);
    const hue = Math.round(s.prob * 120);
    const border = `hsl(${hue}, 70%, 45%)`;
    const color = `hsl(${hue}, 80%, 80%)`;
    return `<div style="text-align:center">
      <img src="${s.dataURL}" width="56" height="56" style="border:2px solid ${border};border-radius:4px;image-rendering:pixelated">
      <div style="font-size:0.8rem;color:${color};margin-top:2px">${pct}%</div>
    </div>`;
  }).join('');
}

function mutatePixels(pixels) {
  const result = new Float32Array(pixels);
  const action = Math.random();

  if (action < 0.4) {
    // Small stroke (1-3px long, 1px brush)
    const sx = Math.floor(Math.random() * 28);
    const sy = Math.floor(Math.random() * 28);
    const len = Math.floor(Math.random() * 3) + 1;
    const angle = Math.random() * Math.PI * 2;
    for (let i = 0; i <= len; i++) {
      const x = Math.round(sx + Math.cos(angle) * i);
      const y = Math.round(sy + Math.sin(angle) * i);
      if (x >= 0 && x < 28 && y >= 0 && y < 28) {
        result[y * 28 + x] = 1;
      }
    }
  } else if (action < 0.65) {
    // Erase a small area (1-3px)
    const sx = Math.floor(Math.random() * 28);
    const sy = Math.floor(Math.random() * 28);
    const len = Math.floor(Math.random() * 3) + 1;
    const angle = Math.random() * Math.PI * 2;
    for (let i = 0; i <= len; i++) {
      const x = Math.round(sx + Math.cos(angle) * i);
      const y = Math.round(sy + Math.sin(angle) * i);
      if (x >= 0 && x < 28 && y >= 0 && y < 28) {
        result[y * 28 + x] = 0;
      }
    }
  } else if (action < 0.85) {
    // Toggle a single pixel
    const x = Math.floor(Math.random() * 28);
    const y = Math.floor(Math.random() * 28);
    result[y * 28 + x] = result[y * 28 + x] > 0.5 ? 0 : 1;
  } else {
    // Nudge a small 3x3 patch (shift ink slightly)
    const cx = Math.floor(Math.random() * 26) + 1;
    const cy = Math.floor(Math.random() * 26) + 1;
    const dx = Math.floor(Math.random() * 3) - 1;
    const dy = Math.floor(Math.random() * 3) - 1;
    for (let py = -1; py <= 1; py++) {
      for (let px = -1; px <= 1; px++) {
        const srcX = cx + px, srcY = cy + py;
        const dstX = srcX + dx, dstY = srcY + dy;
        if (dstX >= 0 && dstX < 28 && dstY >= 0 && dstY < 28) {
          result[dstY * 28 + dstX] = pixels[srcY * 28 + srcX];
        }
      }
    }
  }
  return result;
}

function updatePredictions(probs) {
  const results = LABELS.map((label, i) => ({ label, prob: probs[i] }))
    .sort((a, b) => b.prob - a.prob);
  document.getElementById('top-prediction').textContent =
    `${results[0].label} (${(results[0].prob * 100).toFixed(0)}%)`;
  const container = document.getElementById('predictions');
  container.innerHTML = results.slice(0, 5).map(r => {
    const pct = (r.prob * 100).toFixed(0);
    const hue = Math.round(r.prob * 120);
    const bg = `hsl(${hue}, 70%, 30%)`;
    const color = `hsl(${hue}, 80%, 80%)`;
    return `<span class="prediction-tag" style="background:${bg};color:${color}">${r.label} ${pct}%</span>`;
  }).join('');
}

async function aiDraw() {
  const cat = document.getElementById('category-select').value;
  const targetIdx = LABELS.indexOf(cat);
  const statusEl = document.getElementById('ai-status');
  const btn = document.getElementById('btn-ai-draw');

  if (aiDrawing) {
    stopAiDraw();
    return;
  }

  aiDrawing = true;
  btn.textContent = 'Stop';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasStrokes = true;
  topSnapshots.length = 0;
  document.getElementById('ai-gallery').innerHTML = '';

  let pixels = new Float32Array(28 * 28);
  let bestProb = 0;
  let bestProbs = null;
  let iteration = 0;
  let accepted = 0;

  while (aiDrawing) {
    const candidate = mutatePixels(pixels);
    const probs = await classifyRaw(candidate);

    if (probs[targetIdx] > bestProb) {
      pixels = candidate;
      bestProb = probs[targetIdx];
      bestProbs = probs;
      accepted++;
      renderPixelsToCanvas(pixels);
      updatePredictions(bestProbs);
      updateGallery(pixels, bestProb, cat);
    }

    iteration++;
    if (iteration % 10 === 0) {
      statusEl.textContent = `Iteration ${iteration} — ${cat}: ${(bestProb * 100).toFixed(1)}% (${accepted} accepted)`;
    }

    // Yield to browser
    await new Promise(r => setTimeout(r, 0));

    if (bestProb > 0.95) {
      statusEl.textContent = `Done! ${cat}: ${(bestProb * 100).toFixed(1)}% after ${iteration} iterations (${accepted} accepted)`;
      break;
    }
  }

  aiDrawing = false;
  btn.textContent = 'Watch AI Draw';
}

// --- Init ---
async function loadModel() {
  try {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    const resp = await fetch('/model/model.onnx');
    const buffer = await resp.arrayBuffer();
    model = await ort.InferenceSession.create(new Uint8Array(buffer));

    // Populate category selector
    const select = document.getElementById('category-select');
    LABELS.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l;
      select.appendChild(opt);
    });

    document.getElementById('btn-examples').addEventListener('click', showExamples);
    document.getElementById('btn-ai-draw').addEventListener('click', aiDraw);

    await loadSamples();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    classifyInterval = setInterval(classify, 300);
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:#e94560">Failed to load model.</p>`;
    console.error(err);
  }
}

loadModel();
