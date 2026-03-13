const LABELS = [
  'airplane', 'apple', 'banana', 'bicycle', 'bird', 'sailboat', 'car', 'cat',
  'clock', 'dog', 'fish', 'flower', 'guitar', 'hat', 'skull', 'house',
  'lightning', 'moon', 'pizza', 'shoe', 'smiley face', 'star', 'sun',
  'tree', 'umbrella'
];

const socket = io();
const config = JSON.parse(sessionStorage.getItem('gameConfig'));
const playerName = sessionStorage.getItem('playerName');

if (!config || !playerName) {
  window.location.href = '/';
}

// Reconnect with name
socket.emit('join', playerName);

let model = null;
let currentRound = 0;
let score = 0;
let streak = 0;
let timerInterval = null;
let timeLeft = 0;
let classifyInterval = null;
let isDrawing = false;
let hasStrokes = false;

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
}

// Model inference
function preprocessCanvas() {
  // Find bounding box of the drawing to center it (like the training data)
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
    // Add padding and maintain aspect ratio, centered in 28x28
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

  // Update debug preview
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

async function classify() {
  if (!model || !hasStrokes) return [];

  const tensor = preprocessCanvas();
  const output = await model.run({ input: tensor });
  const logits = Array.from(output.output.data);
  const probs = softmax(logits);

  const results = LABELS.map((label, i) => ({ label, prob: probs[i] }))
    .sort((a, b) => b.prob - a.prob);

  return results;
}

function showPredictions(results, targetWord) {
  const container = document.getElementById('predictions');
  const top5 = results.slice(0, 5);
  const targetInTop5 = top5.some(r => r.label === targetWord);
  const tags = top5.map(r => {
    const isMatch = r.label === targetWord;
    const pct = (r.prob * 100).toFixed(0);
    return `<span class="prediction-tag ${isMatch ? 'match' : ''}">${r.label} ${pct}%</span>`;
  });
  if (!targetInTop5) {
    const target = results.find(r => r.label === targetWord);
    const pct = (target.prob * 100).toFixed(0);
    tags.push(`<span class="prediction-tag match" style="opacity:0.6">${target.label} ${pct}%</span>`);
  }
  container.innerHTML = tags.join('');
}

// Game flow
async function loadModel() {
  try {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    const resp = await fetch('/model/model.onnx');
    const buffer = await resp.arrayBuffer();
    model = await ort.InferenceSession.create(new Uint8Array(buffer));
    document.getElementById('loading').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    startRound();
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:#e94560">Failed to load model. Make sure you've trained it first.<br>
       Run: <code>cd train && .venv/bin/python train_model.py</code></p>`;
    console.error(err);
  }
}

function startRound() {
  if (currentRound >= config.numRounds) {
    endGame();
    return;
  }

  clearCanvas();
  const word = config.words[currentRound];
  document.getElementById('prompt-word').textContent = word;
  document.getElementById('round-info').textContent = `${currentRound + 1} / ${config.numRounds}`;
  document.getElementById('score').textContent = `Score: ${score}`;
  document.getElementById('streak').textContent = streak >= 2 ? '🔥'.repeat(Math.min(streak, 5)) : '';

  timeLeft = config.timeLimit;
  updateTimer();

  timerInterval = setInterval(() => {
    timeLeft -= 0.1;
    updateTimer();
    if (timeLeft <= 0) {
      finishRound(false);
    }
  }, 100);

  classifyInterval = setInterval(async () => {
    const results = await classify();
    if (results.length > 0) {
      showPredictions(results, word);
      if (results[0].label === word && results[0].prob > 0.3) {
        finishRound(true);
      }
    }
  }, 300);
}

function updateTimer() {
  const el = document.getElementById('timer');
  el.textContent = Math.max(0, timeLeft).toFixed(1);
  el.className = timeLeft <= 5 ? 'timer warning' : 'timer';
}

function finishRound(success) {
  clearInterval(timerInterval);
  clearInterval(classifyInterval);

  const timeTaken = config.timeLimit - timeLeft;

  if (success) {
    streak++;
    const streakMultiplier = Math.min(streak, 5);
    const timeBonus = Math.max(0, config.timeLimit - timeTaken);
    score += Math.round(timeBonus * streakMultiplier * 10);
  } else {
    streak = 0;
  }

  socket.emit('round-result', { success, timeTaken: Math.round(timeTaken * 10) / 10 });

  // Show overlay
  const overlay = document.getElementById('round-overlay');
  const resultText = document.getElementById('round-result-text');
  if (success) {
    resultText.className = 'result-content result-success';
    resultText.textContent = `Got it! +${Math.round((config.timeLimit - timeTaken) * Math.min(streak, 5) * 10)} pts`;
  } else {
    resultText.className = 'result-content result-fail';
    resultText.textContent = `Time's up!`;
  }
  overlay.style.display = 'flex';

  setTimeout(() => {
    overlay.style.display = 'none';
    currentRound++;
    startRound();
  }, 1500);
}

function endGame() {
  document.getElementById('game').style.display = 'none';
  document.getElementById('game-over').style.display = 'flex';
  document.getElementById('final-score').textContent = score;
}

// Start
loadModel();
