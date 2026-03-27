import { initCanvas } from './shared/canvas.js';
import { preprocessCanvas } from './shared/preprocessing.js';
import { loadModels, classify, syncCustomCategories, LABELS, getLoadErrorMessage } from './shared/model.js';
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
  tttGame: document.getElementById('ttt-game'),
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
  if (lobbyMode) lobbyMode.textContent = gameMode === 'quick-draw' ? 'Quick Draw' : gameMode === 'space-invaders' ? 'Space Invaders' : 'Tic-Tac-Toe';

  // Handle state transitions
  if (gameState === 'lobby' && currentView !== 'lobby' && currentView !== 'loading') {
    showView('lobby');
    currentView = 'lobby';
    // Clean up any running game
    clearInterval(timerInterval);
    clearInterval(classifyInterval);
    clearInterval(siClassifyInterval);
    clearInterval(tttClassifyInterval);
    tttClassifyInterval = null;
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

    // Start live classification (no auto-shoot)
    if (!siClassifyInterval) {
      siClassifyInterval = setInterval(siClassifyLive, 400);
    }
    // Wire up shoot button
    const shootBtn = document.getElementById('si-shoot');
    if (shootBtn && !shootBtn._wired) {
      shootBtn.addEventListener('click', siShoot);
      shootBtn._wired = true;
    }
  }

  if (!state.running && currentView === 'siGame') {
    clearInterval(siClassifyInterval);
    siClassifyInterval = null;
    showView('lobby');
    currentView = 'lobby';
    if (state.gameOver) {
      showSiFeedback('Game Over!', 'miss');
    }
  }
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

async function siClassifyLive() {
  if (!siDrawer || !siDrawer.state.hasStrokes) return;
  const { tensor } = preprocessCanvas(siDrawer.canvas);
  const results = await classify(tensor);

  // Show live predictions (no auto-shoot)
  const container = document.getElementById('si-predictions');
  if (container) {
    container.innerHTML = results.slice(0, 3).map(r => {
      const pct = (r.prob * 100).toFixed(0);
      return `<span class="prediction-tag">${r.label} ${pct}%</span>`;
    }).join('');
  }
}

async function siShoot() {
  if (!siDrawer || !siDrawer.state.hasStrokes) return;
  const { tensor } = preprocessCanvas(siDrawer.canvas);
  const results = await classify(tensor);

  if (results.length > 0) {
    socket.emit('si-shoot', { category: results[0].label, confidence: results[0].prob });
    siDrawer.clear();
    document.getElementById('si-predictions').innerHTML = '';
  }
}

let siFeedbackTimeout = null;
function showSiFeedback(msg, type) {
  const el = document.getElementById('si-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'si-feedback ' + type;
  clearTimeout(siFeedbackTimeout);
  siFeedbackTimeout = setTimeout(() => { el.textContent = ''; el.className = 'si-feedback'; }, 2000);

  // Flash overlay
  const flash = document.getElementById('flash-overlay');
  if (flash) {
    flash.className = 'flash-overlay ' + (type === 'hit' ? 'flash-hit' : 'flash-miss');
    setTimeout(() => { flash.className = 'flash-overlay'; }, 300);
  }

  // Particles
  spawnParticles(type === 'hit' ? '#2ecc71' : '#e94560', type === 'hit' ? 30 : 15);
}

// ============ Particles (DOM-based) ============
function spawnParticles(color, count) {
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 150;
    const size = 4 + Math.random() * 6;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;

    dot.style.cssText = `
      position:fixed; left:50%; top:50%;
      width:${size}px; height:${size}px;
      margin-left:${-size/2}px; margin-top:${-size/2}px;
      border-radius:50%; background:${color};
      pointer-events:none; z-index:200;
      transform:translate(0,0); opacity:1;
    `;
    document.body.appendChild(dot);

    // Force layout before starting transition
    dot.offsetWidth;

    dot.style.transition = 'transform 0.7s ease-out, opacity 0.7s ease-out';
    dot.style.transform = `translate(${dx}px, ${dy}px)`;
    dot.style.opacity = '0';

    setTimeout(() => dot.remove(), 800);
  }
}

// ============ Tic-Tac-Toe ============
let tttDrawer = null;
let tttClassifyInterval = null;
let tttBoard = [];
let tttMyColor = '#888';
let tttScore = 0;
let tttStreak = 0;

// Cache doodle sample images
let tttSampleImages = {};
fetch('/model/samples.json')
  .then(r => r.json())
  .then(data => { tttSampleImages = data; })
  .catch(() => {});

function initTTT() {
  if (tttDrawer) return;
  tttDrawer = initCanvas(document.getElementById('ttt-canvas'), {
    clearButton: document.getElementById('ttt-clear')
  });
}

function renderTTTBoard(board, winner) {
  const container = document.getElementById('ttt-board');
  container.innerHTML = board.map((cell, i) => {
    const owned = cell.owner;
    const isWinCell = winner && winner.line && winner.line.includes(i);
    const borderColor = owned ? owned.color : '#333';
    const bgColor = owned ? owned.color + '30' : '#16213e';
    const classes = ['ttt-cell'];
    if (owned) classes.push('claimed');
    if (isWinCell) classes.push('winning-cell');

    // Try to get a doodle image
    let imgHtml = '';
    if (tttSampleImages[cell.category] && tttSampleImages[cell.category].length > 0) {
      imgHtml = `<img src="data:image/png;base64,${tttSampleImages[cell.category][0]}" alt="${cell.category}">`;
    }

    return `<div class="${classes.join(' ')}" style="border-color:${borderColor};background:${bgColor}">
      ${imgHtml}
      <span class="ttt-cell-label">${cell.category}</span>
      ${owned ? `<span class="ttt-cell-owner">${owned.name}</span>` : ''}
    </div>`;
  }).join('');
}

socket.on('ttt-state', (state) => {
  tttBoard = state.board;

  if (state.running && currentView !== 'tttGame') {
    initTTT();
    showView('tttGame');
    currentView = 'tttGame';

    if (!tttClassifyInterval) {
      tttClassifyInterval = setInterval(tttClassifyLive, 400);
    }
    const claimBtn = document.getElementById('ttt-claim');
    if (claimBtn && !claimBtn._wired) {
      claimBtn.addEventListener('click', tttClaim);
      claimBtn._wired = true;
    }
  }

  if (!state.running && currentView === 'tttGame') {
    clearInterval(tttClassifyInterval);
    tttClassifyInterval = null;
    showView('lobby');
    currentView = 'lobby';
  }

  renderTTTBoard(state.board, state.winner);

  // Show winner banner
  const banner = document.getElementById('ttt-winner-banner');
  if (state.winner) {
    if (state.winner.name === 'Nobody') {
      banner.innerHTML = `It's a draw!`;
      banner.style.color = '#888';
    } else {
      banner.innerHTML = `<span style="color:${state.winner.color}">${state.winner.name}</span> wins!`;
      banner.style.color = state.winner.color;
    }
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }

  // Update my color indicator
  if (state.playerColors && state.playerColors[playerName]) {
    tttMyColor = state.playerColors[playerName];
    const colorDot = document.getElementById('ttt-my-color');
    if (colorDot) colorDot.style.background = tttMyColor;
  }
});

socket.on('ttt-miss', ({ category, reason }) => {
  const msg = reason === 'no-match' ? `"${category}" not available!` : 'Not confident enough!';
  showTTTFeedback(msg, 'miss');
});

socket.on('full-state', ({ leaderboard, playerColors }) => {
  const me = leaderboard.find(p => p.name === playerName);
  if (me && document.getElementById('ttt-score')) {
    tttScore = me.score;
    tttStreak = me.streak;
    document.getElementById('ttt-score').textContent = `Score: ${tttScore}`;
    document.getElementById('ttt-streak').textContent = tttStreak >= 2 ? '\u{1F525}'.repeat(Math.min(tttStreak, 5)) : '';
  }
  if (playerColors && playerColors[playerName]) {
    tttMyColor = playerColors[playerName];
    const colorDot = document.getElementById('ttt-my-color');
    if (colorDot) colorDot.style.background = tttMyColor;
  }
});

async function tttClassifyLive() {
  if (!tttDrawer || !tttDrawer.state.hasStrokes) return;
  const { tensor } = preprocessCanvas(tttDrawer.canvas);
  const results = await classify(tensor);

  const container = document.getElementById('ttt-predictions');
  if (container) {
    // Highlight predictions that match unclaimed board cells
    const unclaimed = new Set(tttBoard.filter(c => !c.owner).map(c => c.category));
    container.innerHTML = results.slice(0, 5).map(r => {
      const pct = (r.prob * 100).toFixed(0);
      const isMatch = unclaimed.has(r.label);
      return `<span class="prediction-tag ${isMatch ? 'match' : ''}">${r.label} ${pct}%</span>`;
    }).join('');
  }
}

async function tttClaim() {
  if (!tttDrawer || !tttDrawer.state.hasStrokes) return;
  const { tensor } = preprocessCanvas(tttDrawer.canvas);
  const results = await classify(tensor);

  if (results.length > 0) {
    // Find the best result that matches an unclaimed cell
    const unclaimed = new Set(tttBoard.filter(c => !c.owner).map(c => c.category));
    const match = results.find(r => unclaimed.has(r.label));
    if (match) {
      socket.emit('ttt-claim', { category: match.label, confidence: match.prob });
      tttDrawer.clear();
      document.getElementById('ttt-predictions').innerHTML = '';
      showTTTFeedback(`Claiming "${match.label}"...`, 'hit');
    } else {
      showTTTFeedback('No matching square found!', 'miss');
    }
  }
}

let tttFeedbackTimeout = null;
function showTTTFeedback(msg, type) {
  const el = document.getElementById('ttt-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'si-feedback ' + type;
  clearTimeout(tttFeedbackTimeout);
  tttFeedbackTimeout = setTimeout(() => { el.textContent = ''; el.className = 'si-feedback'; }, 2000);

  const flash = document.getElementById('flash-overlay');
  if (flash) {
    flash.className = 'flash-overlay ' + (type === 'hit' ? 'flash-hit' : 'flash-miss');
    setTimeout(() => { flash.className = 'flash-overlay'; }, 300);
  }
  if (type === 'hit') spawnParticles('#2ecc71', 20);
}

// ============ Init ============
async function init() {
  try {
    await loadModels({ main: true, features: true });
    showView('lobby');
    currentView = 'lobby';
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:#e94560">${getLoadErrorMessage(err)}</p>`;
    console.error(err);
  }
}

init();
