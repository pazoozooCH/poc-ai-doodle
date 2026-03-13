const socket = io();
let featureModel = null;
let currentCategory = null;
let localThumbnails = {}; // category -> [dataURL, ...]

// Canvas setup
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
ctx.lineWidth = 16;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.strokeStyle = '#000';

let isDrawing = false;
let hasStrokes = false;
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

function startDraw(e) { e.preventDefault(); isDrawing = true; const p = getPos(e); lastX = p.x; lastY = p.y; }
function draw(e) {
  e.preventDefault();
  if (!isDrawing) return;
  hasStrokes = true;
  const p = getPos(e);
  ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
  lastX = p.x; lastY = p.y;
}
function endDraw(e) { e.preventDefault(); isDrawing = false; }

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', endDraw, { passive: false });

document.getElementById('btn-clear').addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasStrokes = false;
});

// Preprocessing (same as game.js/freedraw.js)
function preprocessCanvas() {
  const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (srcData[i + 3] > 0 && (srcData[i] < 200 || srcData[i+1] < 200 || srcData[i+2] < 200)) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = 28; tmpCanvas.height = 28;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.fillStyle = 'white';
  tmpCtx.fillRect(0, 0, 28, 28);

  if (maxX > minX && maxY > minY) {
    const padding = 2;
    const drawW = maxX - minX, drawH = maxY - minY;
    const scale = (28 - padding * 2) / Math.max(drawW, drawH);
    const w = drawW * scale, h = drawH * scale;
    tmpCtx.drawImage(canvas, minX, minY, drawW, drawH, (28 - w) / 2, (28 - h) / 2, w, h);
  }

  const imageData = tmpCtx.getImageData(0, 0, 28, 28);
  const data = imageData.data;
  const input = new Float32Array(28 * 28);
  for (let i = 0; i < 784; i++) {
    const gray = (data[i*4] + data[i*4+1] + data[i*4+2]) / 3;
    input[i] = 1.0 - gray / 255.0;
  }

  const debugEl = document.getElementById('debug-preview');
  if (debugEl) {
    tmpCtx.putImageData(imageData, 0, 0);
    debugEl.style.display = '';
    debugEl.src = tmpCanvas.toDataURL();
  }

  return { tensor: new ort.Tensor('float32', input, [1, 1, 28, 28]), thumbnail: tmpCanvas.toDataURL() };
}

// Feature extraction
async function extractFeatures(tensor) {
  const output = await featureModel.run({ input: tensor });
  return Array.from(output.features.data);
}

// Add category
document.getElementById('btn-add-category').addEventListener('click', () => {
  const input = document.getElementById('new-category');
  const name = input.value.trim().toLowerCase();
  if (!name) return;
  input.value = '';
  selectCategory(name);
});

document.getElementById('new-category').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-category').click();
});

function selectCategory(name) {
  currentCategory = name;
  if (!localThumbnails[name]) localThumbnails[name] = [];
  document.getElementById('category-section').style.display = '';
  document.getElementById('current-category').textContent = name;
  updateSamplesGrid();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasStrokes = false;
}

// Add sample
document.getElementById('btn-add-sample').addEventListener('click', async () => {
  if (!hasStrokes || !currentCategory) return;

  const { tensor, thumbnail } = preprocessCanvas();
  const features = await extractFeatures(tensor);

  if (!localThumbnails[currentCategory]) localThumbnails[currentCategory] = [];
  localThumbnails[currentCategory].push(thumbnail);

  console.log('Sending add-sample:', currentCategory, 'features length:', features.length);
  socket.emit('add-sample', { category: currentCategory, features });

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasStrokes = false;
  updateSamplesGrid();
});

function updateSamplesGrid() {
  const grid = document.getElementById('samples-grid');
  const thumbnails = localThumbnails[currentCategory] || [];
  const count = thumbnails.length;
  document.getElementById('sample-count').textContent = `(${count} sample${count !== 1 ? 's' : ''})`;
  const hint = document.getElementById('sample-hint');
  if (count === 0) hint.textContent = 'Draw at least 3 varied examples. Each sample works immediately — no "finish" step needed.';
  else if (count < 3) hint.textContent = `${3 - count} more sample${3 - count > 1 ? 's' : ''} recommended. Try drawing it in different styles/sizes.`;
  else hint.textContent = 'Looking good! Try it in Free Drawing. You can add more samples to improve accuracy.';
  hint.style.color = count >= 3 ? '#2ecc71' : '#e94560';
  grid.innerHTML = thumbnails.map(t =>
    `<img src="${t}" width="56" height="56" style="border:1px solid #333;border-radius:4px;image-rendering:pixelated">`
  ).join('');
}

// Categories list (from server)
socket.on('custom-categories', (categories) => {
  console.log('Received custom-categories:', Object.keys(categories), categories);
  const list = document.getElementById('categories-list');
  const noMsg = document.getElementById('no-categories');
  const entries = Object.entries(categories);

  if (entries.length === 0) {
    list.innerHTML = '';
    noMsg.style.display = '';
    return;
  }

  noMsg.style.display = 'none';
  list.innerHTML = entries.map(([name, data]) => {
    const isActive = name === currentCategory;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 15px;margin:5px 0;background:#16213e;border-radius:8px;${isActive ? 'border:1px solid #e94560' : 'border:1px solid transparent'}">
      <span style="cursor:pointer;flex:1" onclick="selectCategory('${name.replace(/'/g, "\\'")}')">${name} <span style="color:#666">(${data.samples.length} samples)</span></span>
      <button onclick="removeCategory('${name.replace(/'/g, "\\'")}')" style="background:none;border:none;color:#666;cursor:pointer;font-size:1.2rem;padding:0 5px" title="Remove">x</button>
    </div>`;
  }).join('');
});

function removeCategory(name) {
  socket.emit('remove-category', name);
  delete localThumbnails[name];
  if (currentCategory === name) {
    currentCategory = null;
    document.getElementById('category-section').style.display = 'none';
  }
}

// Make selectCategory global for inline onclick
window.selectCategory = selectCategory;
window.removeCategory = removeCategory;

// Init
async function init() {
  try {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    const resp = await fetch('/model/feature_extractor.onnx');
    const buffer = await resp.arrayBuffer();
    featureModel = await ort.InferenceSession.create(new Uint8Array(buffer));

    socket.emit('get-custom-categories');

    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:#e94560">Failed to load feature extractor model.</p>`;
    console.error(err);
  }
}

init();
