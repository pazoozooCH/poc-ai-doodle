import { initCanvas } from './shared/canvas.js';
import { preprocessCanvas } from './shared/preprocessing.js';
import { loadModels, classify, syncCustomCategories } from './shared/model.js';
import { initFooter } from './shared/footer.js';
initFooter();

const socket = io();
const config = JSON.parse(sessionStorage.getItem('gameConfig'));
const playerName = sessionStorage.getItem('playerName');

if (!config || !playerName) {
  window.location.href = '/';
}

socket.emit('join', playerName);
syncCustomCategories(socket);

let currentRound = 0;
let score = 0;
let streak = 0;
let timerInterval = null;
let timeLeft = 0;
let classifyInterval = null;

const drawer = initCanvas(document.getElementById('canvas'), {
  clearButton: document.getElementById('btn-clear')
});

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
    if (target) {
      const pct = (target.prob * 100).toFixed(0);
      tags.push(`<span class="prediction-tag match" style="opacity:0.6">${target.label} ${pct}%</span>`);
    }
  }
  container.innerHTML = tags.join('');
}

async function runClassify() {
  if (!drawer.state.hasStrokes) return [];
  const { tensor } = preprocessCanvas(drawer.canvas, {
    debugElement: document.getElementById('debug-preview')
  });
  return await classify(tensor);
}

async function init() {
  try {
    await loadModels({ main: true, features: true });
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

  drawer.clear();
  const word = config.words[currentRound];
  document.getElementById('prompt-word').textContent = word;
  document.getElementById('round-info').textContent = `${currentRound + 1} / ${config.numRounds}`;
  document.getElementById('score').textContent = `Score: ${score}`;
  document.getElementById('streak').textContent = streak >= 2 ? '\u{1F525}'.repeat(Math.min(streak, 5)) : '';

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
    const results = await runClassify();
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

init();
