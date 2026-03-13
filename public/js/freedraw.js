const LABELS = [
  'airplane', 'apple', 'banana', 'bicycle', 'bird', 'sailboat', 'car', 'cat',
  'clock', 'dog', 'fish', 'flower', 'guitar', 'hat', 'skull', 'house',
  'lightning', 'moon', 'pizza', 'shoe', 'smiley face', 'star', 'sun',
  'tree', 'umbrella'
];

let model = null;
let isDrawing = false;
let hasStrokes = false;
let classifyInterval = null;

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

async function classify() {
  if (!model || !hasStrokes) return;

  const tensor = preprocessCanvas();
  const output = await model.run({ input: tensor });
  const logits = Array.from(output.output.data);
  const probs = softmax(logits);

  const results = LABELS.map((label, i) => ({ label, prob: probs[i] }))
    .sort((a, b) => b.prob - a.prob);

  // Update top prediction
  document.getElementById('top-prediction').textContent =
    `${results[0].label} (${(results[0].prob * 100).toFixed(0)}%)`;

  // Show top 5
  const container = document.getElementById('predictions');
  container.innerHTML = results.slice(0, 5).map(r => {
    const pct = (r.prob * 100).toFixed(0);
    return `<span class="prediction-tag">${r.label} ${pct}%</span>`;
  }).join('');
}

async function loadModel() {
  try {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    const resp = await fetch('/model/model.onnx');
    const buffer = await resp.arrayBuffer();
    model = await ort.InferenceSession.create(new Uint8Array(buffer));
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
