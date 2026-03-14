import { initCanvas } from './shared/canvas.js';
import { preprocessCanvas } from './shared/preprocessing.js';
import { loadModels, extractFeatures } from './shared/model.js';

const socket = io();
let currentCategory = null;
let localThumbnails = {};

const drawer = initCanvas(document.getElementById('canvas'), {
  clearButton: document.getElementById('btn-clear')
});

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
  drawer.clear();
}

// Add sample
document.getElementById('btn-add-sample').addEventListener('click', async () => {
  if (!drawer.state.hasStrokes || !currentCategory) return;

  const { tensor, thumbnail } = preprocessCanvas(drawer.canvas, {
    debugElement: document.getElementById('debug-preview'),
    returnThumbnail: true
  });
  const features = await extractFeatures(tensor);

  if (!localThumbnails[currentCategory]) localThumbnails[currentCategory] = [];
  localThumbnails[currentCategory].push(thumbnail);

  console.log('Sending add-sample:', currentCategory, 'features length:', features.length);
  socket.emit('add-sample', { category: currentCategory, features });

  drawer.clear();
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
  console.log('Received custom-categories:', Object.keys(categories));
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
      <span style="cursor:pointer;flex:1" onclick="window._selectCategory('${name.replace(/'/g, "\\'")}')">${name} <span style="color:#666">(${data.samples.length} samples)</span></span>
      <button onclick="window._removeCategory('${name.replace(/'/g, "\\'")}')" style="background:none;border:none;color:#666;cursor:pointer;font-size:1.2rem;padding:0 5px" title="Remove">x</button>
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

window._selectCategory = selectCategory;
window._removeCategory = removeCategory;

// Init
async function init() {
  try {
    await loadModels({ main: false, features: true });
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
