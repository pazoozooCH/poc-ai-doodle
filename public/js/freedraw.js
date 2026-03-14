import { initCanvas } from './shared/canvas.js';
import { preprocessCanvas } from './shared/preprocessing.js';
import { softmax } from './shared/math.js';
import { initFooter } from './shared/footer.js';
initFooter();
import {
  loadModels, classify, classifyRaw, getCustomScores,
  syncCustomCategories, LABELS, getMainModel
} from './shared/model.js';

const socket = io();
syncCustomCategories(socket);

let classifyInterval = null;
let aiDrawing = false;

const drawer = initCanvas(document.getElementById('canvas'), {
  clearButton: document.getElementById('btn-clear')
});
drawer.onClear = () => {
  document.getElementById('predictions').innerHTML = '';
  document.getElementById('top-prediction').textContent = 'Draw something!';
};

// --- Prediction display ---
function renderPredictions(results) {
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

function renderCustomPredictions(details) {
  const customContainer = document.getElementById('custom-predictions');
  if (!customContainer) return;
  if (details.length === 0) { customContainer.innerHTML = ''; return; }
  customContainer.innerHTML = details
    .sort((a, b) => b.similarity - a.similarity)
    .map(d => {
      const pct = (d.prob * 100).toFixed(0);
      const hue = Math.round(d.prob * 120);
      const bg = `hsl(${hue}, 70%, 30%)`;
      const color = `hsl(${hue}, 80%, 80%)`;
      return `<span class="prediction-tag" style="background:${bg};color:${color}">${d.label.replace(' *', '')} ${pct}% <span style="font-size:0.7rem;opacity:0.6">(sim: ${d.similarity.toFixed(3)})</span></span>`;
    }).join('');
}

async function runClassify() {
  if (!drawer.state.hasStrokes) return;

  const { tensor } = preprocessCanvas(drawer.canvas, {
    debugElement: document.getElementById('debug-preview')
  });

  const results = await classify(tensor);
  renderPredictions(results);

  // Separate custom categories section
  const customResults = results.filter(r => r.similarity !== undefined);
  renderCustomPredictions(customResults);
}

// --- Show Examples ---
let samplesData = null;

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

  grid.querySelectorAll('.sample-img').forEach(img => {
    img.addEventListener('click', () => {
      const tmpImg = new Image();
      tmpImg.onload = () => {
        drawer.ctx.clearRect(0, 0, drawer.canvas.width, drawer.canvas.height);
        drawer.ctx.drawImage(tmpImg, 0, 0, drawer.canvas.width, drawer.canvas.height);
        drawer.state.hasStrokes = true;
      };
      tmpImg.src = img.src;
    });
  });
}

// --- AI Draw ---
function stopAiDraw() {
  aiDrawing = false;
  document.getElementById('btn-ai-draw').textContent = 'Watch AI Draw';
  document.getElementById('ai-status').textContent = '';
  if (!classifyInterval) {
    classifyInterval = setInterval(runClassify, 300);
  }
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
  const tmpCanvas = pixelsToImageData(pixels, drawer.canvas.width);
  drawer.ctx.drawImage(tmpCanvas, 0, 0);
}

function pixelsToDataURL(pixels) {
  return pixelsToImageData(pixels, 56).toDataURL();
}

const topSnapshots = [];
const MAX_SNAPSHOTS = 5;

function updateGallery(pixels, prob) {
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

function drawLine(pixels, sx, sy, len, angle, val, brush) {
  const result = new Float32Array(pixels);
  for (let i = 0; i <= len; i++) {
    const cx = Math.round(sx + Math.cos(angle) * i);
    const cy = Math.round(sy + Math.sin(angle) * i);
    for (let dy = -brush; dy <= brush; dy++) {
      for (let dx = -brush; dx <= brush; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px >= 0 && px < 28 && py >= 0 && py < 28) {
          result[py * 28 + px] = val;
        }
      }
    }
  }
  return result;
}

function mutatePixels(pixels, intensity) {
  const result = new Float32Array(pixels);
  const numMutations = Math.ceil(1 + intensity * 3);

  for (let m = 0; m < numMutations; m++) {
    const action = Math.random();
    const maxLen = Math.floor(2 + intensity * 10);
    const brush = Math.random() < intensity ? 1 : 0;

    if (action < 0.35) {
      const sx = Math.floor(Math.random() * 28);
      const sy = Math.floor(Math.random() * 28);
      const len = Math.floor(Math.random() * maxLen) + 1;
      const angle = Math.random() * Math.PI * 2;
      const drawn = drawLine(result, sx, sy, len, angle, 1, brush);
      for (let i = 0; i < 784; i++) result[i] = drawn[i];
    } else if (action < 0.6) {
      const sx = Math.floor(Math.random() * 28);
      const sy = Math.floor(Math.random() * 28);
      const len = Math.floor(Math.random() * maxLen) + 1;
      const angle = Math.random() * Math.PI * 2;
      const erased = drawLine(result, sx, sy, len, angle, 0, brush);
      for (let i = 0; i < 784; i++) result[i] = erased[i];
    } else if (action < 0.75) {
      const w = Math.floor(Math.random() * (3 + intensity * 5)) + 1;
      const h = Math.floor(Math.random() * (3 + intensity * 5)) + 1;
      const ox = Math.floor(Math.random() * (28 - w));
      const oy = Math.floor(Math.random() * (28 - h));
      for (let y = oy; y < oy + h; y++) {
        for (let x = ox; x < ox + w; x++) {
          result[y * 28 + x] = result[y * 28 + x] > 0.5 ? 0 : 1;
        }
      }
    } else if (action < 0.9) {
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      const copy = new Float32Array(784);
      for (let y = 0; y < 28; y++) {
        for (let x = 0; x < 28; x++) {
          const srcX = x - dx, srcY = y - dy;
          if (srcX >= 0 && srcX < 28 && srcY >= 0 && srcY < 28) {
            copy[y * 28 + x] = result[srcY * 28 + srcX];
          }
        }
      }
      for (let i = 0; i < 784; i++) result[i] = copy[i];
    } else {
      const count = Math.floor(5 + intensity * 20);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * 784);
        result[idx] = result[idx] > 0.5 ? 0 : 1;
      }
    }
  }
  return result;
}

async function aiDraw() {
  const cat = document.getElementById('category-select').value;
  const targetIdx = LABELS.indexOf(cat);
  const statusEl = document.getElementById('ai-status');
  const btn = document.getElementById('btn-ai-draw');

  if (aiDrawing) { stopAiDraw(); return; }

  aiDrawing = true;
  btn.textContent = 'Stop';
  clearInterval(classifyInterval);
  classifyInterval = null;

  drawer.ctx.clearRect(0, 0, drawer.canvas.width, drawer.canvas.height);
  drawer.state.hasStrokes = true;
  topSnapshots.length = 0;
  document.getElementById('ai-gallery').innerHTML = '';

  let pixels = new Float32Array(28 * 28);
  let currentProb = 0;
  let globalBestPixels = new Float32Array(28 * 28);
  let globalBestProb = 0;
  let iteration = 0;
  let accepted = 0;
  let stuckCount = 0;
  const MAX_ITER = 5000;

  while (aiDrawing && iteration < MAX_ITER) {
    const temperature = Math.max(0.01, 1 - iteration / MAX_ITER);
    const intensity = Math.max(0.1, temperature);

    const candidate = mutatePixels(pixels, intensity);
    const probs = await classifyRaw(candidate);
    const candidateProb = probs[targetIdx];

    const delta = candidateProb - currentProb;
    const acceptWorse = Math.random() < Math.exp(delta * 10 / temperature);

    if (delta > 0 || acceptWorse) {
      pixels = candidate;
      currentProb = candidateProb;
      accepted++;

      if (currentProb > globalBestProb) {
        globalBestPixels = new Float32Array(pixels);
        globalBestProb = currentProb;
        stuckCount = 0;
        updateGallery(pixels, globalBestProb);
      }

      renderPixelsToCanvas(pixels);
      const results = LABELS.map((label, i) => ({ label, prob: probs[i] })).sort((a, b) => b.prob - a.prob);
      renderPredictions(results);
    }

    stuckCount++;

    if (stuckCount > 200) {
      pixels = new Float32Array(globalBestPixels);
      currentProb = globalBestProb;
      pixels = mutatePixels(pixels, 0.8);
      const resetProbs = await classifyRaw(pixels);
      currentProb = resetProbs[targetIdx];
      stuckCount = 0;
    }

    iteration++;
    if (iteration % 5 === 0) {
      statusEl.textContent = `Iteration ${iteration}/${MAX_ITER} — ${cat}: ${(globalBestProb * 100).toFixed(1)}% (temp: ${temperature.toFixed(2)})`;
      await new Promise(r => setTimeout(r, 0));
    }

    if (globalBestProb > 0.95) {
      renderPixelsToCanvas(globalBestPixels);
      const finalProbs = await classifyRaw(globalBestPixels);
      const results = LABELS.map((label, i) => ({ label, prob: finalProbs[i] })).sort((a, b) => b.prob - a.prob);
      renderPredictions(results);
      statusEl.textContent = `Done! ${cat}: ${(globalBestProb * 100).toFixed(1)}% after ${iteration} iterations`;
      break;
    }
  }

  if (globalBestProb > currentProb) {
    renderPixelsToCanvas(globalBestPixels);
    const finalProbs = await classifyRaw(globalBestPixels);
    const results = LABELS.map((label, i) => ({ label, prob: finalProbs[i] })).sort((a, b) => b.prob - a.prob);
    renderPredictions(results);
  }

  aiDrawing = false;
  btn.textContent = 'Watch AI Draw';
}

drawer.onDrawStart = () => { if (aiDrawing) stopAiDraw(); };

// --- Init ---
async function init() {
  try {
    await loadModels({ main: true, features: true });

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
    classifyInterval = setInterval(runClassify, 300);
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:#e94560">Failed to load model.</p>`;
    console.error(err);
  }
}

init();
