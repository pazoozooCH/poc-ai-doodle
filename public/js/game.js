import { initCanvas } from './shared/canvas.js';
import { preprocessCanvas } from './shared/preprocessing.js';
import { loadModels, classify, syncCustomCategories, LABELS } from './shared/model.js';
import { initFooter } from './shared/footer.js';
initFooter();

const socket = io();
const playerName = sessionStorage.getItem('playerName');
if (!playerName) window.location.href = '/';

socket.emit('join', playerName);
syncCustomCategories(socket);

// ============ Views ============
const views = {
  loading: document.getElementById('loading'),
  lobby: document.getElementById('lobby'),
  qdGame: document.getElementById('game'),
  siGame: document.getElementById('si-game'),
  gameOver: document.getElementById('game-over'),
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    if (el) el.style.display = key === name ? (name === 'gameOver' ? 'flex' : 'block') : 'none';
  }
}

// ============ Lobby ============
socket.on('full-state', ({ gameMode, gameState, players }) => {
  // Update lobby player list
  const lobbyPlayers = document.getElementById('lobby-players');
  const lobbyMode = document.getElementById('lobby-mode');
  const lobbyCount = document.getElementById('lobby-count');
  if (lobbyPlayers) {
    lobbyPlayers.innerHTML = players.map(p =>
      `<span style="display:inline-block;padding:6px 14px;margin:3px;background:#16213e;border-radius:20px;font-size:0.9rem">${p.name}</span>`
    ).join('') || 'Waiting...';
  }
  if (lobbyCount) lobbyCount.textContent = `${players.length} player${players.length !== 1 ? 's' : ''}`;
  if (lobbyMode) lobbyMode.textContent = gameMode === 'quick-draw' ? 'Quick Draw' : 'Space Invaders';

  // Handle state transitions
  if (gameState === 'lobby' && currentView !== 'lobby' && currentView !== 'loading') {
    showView('lobby');
    currentView = 'lobby';
    // Clean up any running game
    clearInterval(timerInterval);
    clearInterval(classifyInterval);
    clearInterval(siClassifyInterval);
  }
});

let currentView = 'loading';

// ============ Quick Draw ============
let qdConfig = null;
let currentRound = 0;
let score = 0;
let streak = 0;
let timerInterval = null;
let timeLeft = 0;
let classifyInterval = null;

const drawer = initCanvas(document.getElementById('canvas'), {
  clearButton: document.getElementById('btn-clear')
});

socket.on('qd-start', (config) => {
  qdConfig = config;
  currentRound = 0;
  score = 0;
  streak = 0;
  showView('qdGame');
  currentView = 'qdGame';
  startRound();
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

async function qdClassify() {
  if (!drawer.state.hasStrokes) return [];
  const { tensor } = preprocessCanvas(drawer.canvas, {
    debugElement: document.getElementById('debug-preview')
  });
  return await classify(tensor);
}

function startRound() {
  if (currentRound >= qdConfig.numRounds) { endGame(); return; }

  drawer.clear();
  const word = qdConfig.words[currentRound];
  document.getElementById('prompt-word').textContent = word;
  document.getElementById('round-info').textContent = `${currentRound + 1} / ${qdConfig.numRounds}`;
  document.getElementById('score').textContent = `Score: ${score}`;
  document.getElementById('streak').textContent = streak >= 2 ? '\u{1F525}'.repeat(Math.min(streak, 5)) : '';

  timeLeft = qdConfig.timeLimit;
  updateTimer();

  timerInterval = setInterval(() => {
    timeLeft -= 0.1;
    updateTimer();
    if (timeLeft <= 0) finishRound(false);
  }, 100);

  classifyInterval = setInterval(async () => {
    const results = await qdClassify();
    if (results.length > 0) {
      showPredictions(results, word);
      if (results[0].label === word && results[0].prob > 0.3) finishRound(true);
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
  const timeTaken = qdConfig.timeLimit - timeLeft;

  if (success) {
    streak++;
    const streakMultiplier = Math.min(streak, 5);
    const timeBonus = Math.max(0, qdConfig.timeLimit - timeTaken);
    score += Math.round(timeBonus * streakMultiplier * 10);
  } else {
    streak = 0;
  }

  socket.emit('round-result', { success, timeTaken: Math.round(timeTaken * 10) / 10 });

  const overlay = document.getElementById('round-overlay');
  const resultText = document.getElementById('round-result-text');
  if (success) {
    resultText.className = 'result-content result-success';
    resultText.textContent = `Got it! +${Math.round((qdConfig.timeLimit - timeTaken) * Math.min(streak, 5) * 10)} pts`;
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
  showView('gameOver');
  currentView = 'gameOver';
  document.getElementById('final-score').textContent = score;
}

// ============ Space Invaders ============
let siDrawer = null;
let siClassifyInterval = null;
let siInvaders = [];
let siScore = 0;
let siStreak = 0;

function initSI() {
  if (siDrawer) return; // already initialized
  siDrawer = initCanvas(document.getElementById('si-canvas'), {
    clearButton: document.getElementById('si-clear')
  });
}

socket.on('si-state', (state) => {
  siInvaders = state.invaders;

  if (state.running && currentView !== 'siGame') {
    initSI();
    showView('siGame');
    currentView = 'siGame';
    document.getElementById('si-waiting').style.display = 'none';

    // Start classifying
    if (!siClassifyInterval) {
      siClassifyInterval = setInterval(siClassifyAndShoot, 400);
    }
  }

  if (!state.running && currentView === 'siGame') {
    clearInterval(siClassifyInterval);
    siClassifyInterval = null;
    if (state.gameOver) {
      document.getElementById('si-waiting').style.display = '';
      document.getElementById('si-waiting').textContent = 'Game Over! Waiting for host...';
    }
  }

  updateTargetList();
});

socket.on('si-hit', ({ playerName: pn, category }) => {
  if (pn === playerName) {
    showSiFeedback(`Hit! ${category}`, 'hit');
    if (siDrawer) siDrawer.clear();
  }
});

socket.on('si-miss', ({ category, reason }) => {
  const msg = reason === 'not-on-screen' ? `${category} not on screen!` : `Not confident enough!`;
  showSiFeedback(msg, 'miss');
});

socket.on('full-state', ({ leaderboard }) => {
  const me = leaderboard.find(p => p.name === playerName);
  if (me && document.getElementById('si-score')) {
    siScore = me.score;
    siStreak = me.streak;
    document.getElementById('si-score').textContent = `Score: ${siScore}`;
    document.getElementById('si-streak').textContent = siStreak >= 2 ? '\u{1F525}'.repeat(Math.min(siStreak, 5)) : '';
  }
});

async function siClassifyAndShoot() {
  if (!siDrawer || !siDrawer.state.hasStrokes || siInvaders.length === 0) return;
  const { tensor } = preprocessCanvas(siDrawer.canvas);
  const results = await classify(tensor);

  // Show predictions
  const container = document.getElementById('si-predictions');
  if (container) {
    container.innerHTML = results.slice(0, 3).map(r => {
      const pct = (r.prob * 100).toFixed(0);
      const onScreen = siInvaders.some(inv => inv.category === r.label);
      return `<span class="prediction-tag ${onScreen ? 'match' : ''}">${r.label} ${pct}%</span>`;
    }).join('');
  }

  // Auto-shoot if top prediction matches an on-screen invader
  if (results.length > 0 && results[0].prob > 0.4) {
    const topLabel = results[0].label;
    if (siInvaders.some(inv => inv.category === topLabel)) {
      socket.emit('si-shoot', { category: topLabel, confidence: results[0].prob });
      siDrawer.clear();
    }
  }
}

function updateTargetList() {
  const container = document.getElementById('si-targets');
  if (!container) return;
  const categories = [...new Set(siInvaders.map(inv => inv.category))];
  container.innerHTML = categories.length > 0
    ? categories.map(c => `<span class="si-invader-tag">${c}</span>`).join('')
    : '<span style="color:#555">No invaders yet</span>';
}

let siFeedbackTimeout = null;
function showSiFeedback(msg, type) {
  const el = document.getElementById('si-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'si-feedback ' + type;
  clearTimeout(siFeedbackTimeout);
  siFeedbackTimeout = setTimeout(() => { el.textContent = ''; }, 2000);
}

// ============ Init ============
async function init() {
  try {
    await loadModels({ main: true, features: true });
    showView('lobby');
    currentView = 'lobby';
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:#e94560">Failed to load model. Make sure you've trained it first.<br>
       Run: <code>cd train && .venv/bin/python train_model.py</code></p>`;
    console.error(err);
  }
}

init();
