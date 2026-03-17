const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { execSync } = require('child_process');

const app = express();
const http = createServer(app);
const io = new Server(http);

// Server info
const startupTime = new Date().toISOString();
let gitCommit = 'unknown';
try {
  gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch (e) {}

function getNetworkUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const nets = require('os').networkInterfaces();
  const localIp = Object.values(nets).flat()
    .find(n => n.family === 'IPv4' && !n.internal)?.address || 'localhost';
  return `http://${localIp}:${process.env.PORT || 3000}`;
}

app.get('/api/info', (req, res) => {
  res.json({ gitCommit, startupTime, url: getNetworkUrl() });
});

app.use(express.static('public'));
app.use('/slides', express.static('slides'));

// ============ State ============

const WORD_LIST = [
  'cat', 'dog', 'house', 'car', 'tree', 'fish', 'bird', 'sun', 'moon', 'star',
  'flower', 'hat', 'shoe', 'bicycle', 'airplane', 'sailboat', 'guitar', 'pizza',
  'apple', 'banana', 'clock', 'skull', 'smiley face', 'umbrella', 'lightning'
];

const players = new Map(); // socketId -> { name, score, streak, round, connected }

// Custom categories with persistence
const fs = require('fs');
const CUSTOM_CATEGORIES_FILE = './custom-categories.json';
let customCategories = {};
try {
  if (fs.existsSync(CUSTOM_CATEGORIES_FILE)) {
    customCategories = JSON.parse(fs.readFileSync(CUSTOM_CATEGORIES_FILE, 'utf-8'));
    console.log(`Loaded ${Object.keys(customCategories).length} custom categories from disk`);
  }
} catch (e) { console.error('Failed to load custom categories:', e.message); }

function saveCustomCategories() {
  try {
    fs.writeFileSync(CUSTOM_CATEGORIES_FILE, JSON.stringify(customCategories));
  } catch (e) { console.error('Failed to save custom categories:', e.message); }
}

let gameMode = 'quick-draw';   // 'quick-draw' | 'space-invaders'
let gameState = 'lobby';       // 'lobby' | 'playing'

// ============ Helpers ============

function getPlayerList() {
  return Array.from(players.values())
    .filter(p => p.connected)
    .map(p => ({ name: p.name, score: p.score }));
}

function getLeaderboard() {
  return Array.from(players.values())
    .filter(p => p.connected)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      score: p.score,
      streak: p.streak,
      round: p.round,
      totalRounds: QUICK_DRAW.numRounds
    }));
}

function broadcastFullState() {
  io.emit('full-state', {
    gameMode,
    gameState,
    players: getPlayerList(),
    leaderboard: getLeaderboard(),
  });
}

// ============ Quick Draw ============

const QUICK_DRAW = { timeLimit: 20, numRounds: 10 };

function shuffleWords() {
  const shuffled = [...WORD_LIST].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, QUICK_DRAW.numRounds);
}

function startQuickDraw() {
  gameState = 'playing';
  // Reset scores and assign words per player
  for (const [socketId, player] of players) {
    player.score = 0;
    player.streak = 0;
    player.round = 0;
    player.words = shuffleWords();
    const sock = io.sockets.sockets.get(socketId);
    if (sock && player.connected) {
      sock.emit('qd-start', {
        words: player.words,
        timeLimit: QUICK_DRAW.timeLimit,
        numRounds: QUICK_DRAW.numRounds,
      });
    }
  }
  broadcastFullState();
}

// ============ Space Invaders ============

const SI_CONFIG = {
  difficulty: 0.5,
  spawnInterval: 4000,
  moveInterval: 2000,
  invaderSpeed: 1,
  gridRows: 10,
  gridCols: 6,
  hitBonus: 100,
  missPenalty: -30,
};

let invaders = [];
let invaderIdCounter = 0;
let spawnTimer = null;
let moveTimer = null;
let siGameOver = false;

function spawnInvader() {
  const category = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  const col = Math.floor(Math.random() * SI_CONFIG.gridCols);
  invaders.push({
    id: invaderIdCounter++,
    category,
    col,
    row: 0,
    alive: true,
  });
  broadcastSIState();
}

function moveInvaders() {
  let reachedBottom = false;
  for (const inv of invaders) {
    if (!inv.alive) continue;
    inv.row += SI_CONFIG.invaderSpeed;
    if (inv.row >= SI_CONFIG.gridRows) reachedBottom = true;
  }
  invaders = invaders.filter(inv => inv.row < SI_CONFIG.gridRows + 2);

  if (reachedBottom) {
    siGameOver = true;
    stopSITimers();
    gameState = 'lobby';
  }
  broadcastSIState();
  if (reachedBottom) broadcastFullState();
}

function startSpaceInvaders() {
  gameState = 'playing';
  invaders = [];
  invaderIdCounter = 0;
  siGameOver = false;

  for (const [, player] of players) {
    player.score = 0;
    player.streak = 0;
  }

  spawnTimer = setInterval(spawnInvader, SI_CONFIG.spawnInterval);
  moveTimer = setInterval(moveInvaders, SI_CONFIG.moveInterval);
  broadcastSIState();
  broadcastFullState();
}

function stopSITimers() {
  clearInterval(spawnTimer);
  clearInterval(moveTimer);
  spawnTimer = null;
  moveTimer = null;
}

function broadcastSIState() {
  io.emit('si-state', {
    invaders: invaders.filter(inv => inv.alive),
    gameOver: siGameOver,
    difficulty: SI_CONFIG.difficulty,
    gridRows: SI_CONFIG.gridRows,
    gridCols: SI_CONFIG.gridCols,
    running: gameState === 'playing' && gameMode === 'space-invaders',
  });
}

// ============ Socket handlers ============

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Send full state on connect
  socket.emit('full-state', {
    gameMode,
    gameState,
    players: getPlayerList(),
    leaderboard: getLeaderboard(),
  });

  // Player joins
  socket.on('join', (name) => {
    if (!name || typeof name !== 'string') return;
    players.set(socket.id, {
      name: name.trim(),
      score: 0,
      streak: 0,
      round: 0,
      connected: true,
      words: [],
    });
    broadcastFullState();
    console.log(`${name} joined`);

    // If a Quick Draw game is already running, send them their words
    if (gameState === 'playing' && gameMode === 'quick-draw') {
      const player = players.get(socket.id);
      player.words = shuffleWords();
      socket.emit('qd-start', {
        words: player.words,
        timeLimit: QUICK_DRAW.timeLimit,
        numRounds: QUICK_DRAW.numRounds,
      });
    }
    // If Space Invaders is running, send current state
    if (gameState === 'playing' && gameMode === 'space-invaders') {
      broadcastSIState();
    }
  });

  // Host: start game
  socket.on('start-game', () => {
    console.log(`Starting ${gameMode}...`);
    if (gameMode === 'quick-draw') startQuickDraw();
    else if (gameMode === 'space-invaders') startSpaceInvaders();
  });

  // Host: switch mode (goes back to lobby)
  socket.on('set-game-mode', (mode) => {
    if (mode !== 'quick-draw' && mode !== 'space-invaders') return;
    if (gameMode === 'space-invaders') stopSITimers();
    gameMode = mode;
    gameState = 'lobby';
    siGameOver = false;
    broadcastFullState();
    console.log(`Mode changed to: ${gameMode}`);
  });

  // Host: stop game (back to lobby)
  socket.on('stop-game', () => {
    if (gameMode === 'space-invaders') stopSITimers();
    gameState = 'lobby';
    siGameOver = false;
    broadcastFullState();
    broadcastSIState();
    console.log('Game stopped, back to lobby');
  });

  // Quick Draw: round result
  socket.on('round-result', ({ success, timeTaken }) => {
    const player = players.get(socket.id);
    if (!player || gameMode !== 'quick-draw' || gameState !== 'playing') return;

    if (success) {
      player.streak++;
      const streakMultiplier = Math.min(player.streak, 5);
      const timeBonus = Math.max(0, QUICK_DRAW.timeLimit - timeTaken);
      player.score += Math.round(timeBonus * streakMultiplier * 10);
    } else {
      player.streak = 0;
    }
    player.round++;
    broadcastFullState();
  });

  // Space Invaders: player shoots
  socket.on('si-shoot', ({ category, confidence }) => {
    const player = players.get(socket.id);
    if (!player || gameMode !== 'space-invaders' || gameState !== 'playing') return;

    const matchingInvaders = invaders
      .filter(inv => inv.alive && inv.category === category)
      .sort((a, b) => b.row - a.row);

    if (matchingInvaders.length > 0 && confidence >= SI_CONFIG.difficulty) {
      const target = matchingInvaders[0];
      target.alive = false;
      player.score += SI_CONFIG.hitBonus;
      player.streak++;
      io.emit('si-hit', {
        invaderId: target.id,
        playerName: player.name,
        category: target.category,
      });
      broadcastFullState();
      broadcastSIState();
      console.log(`${player.name} shot ${target.category} (${(confidence * 100).toFixed(0)}%)`);
    } else {
      player.score += SI_CONFIG.missPenalty;
      player.streak = 0;
      const reason = matchingInvaders.length === 0 ? 'not-on-screen' : 'too-low';
      socket.emit('si-miss', { category, reason });
      io.emit('si-miss-feed', { playerName: player.name, category, reason });
      broadcastFullState();
    }
  });

  // Space Invaders: config changes
  socket.on('si-config', (config) => {
    if (config.difficulty !== undefined) SI_CONFIG.difficulty = config.difficulty;
    if (config.spawnInterval !== undefined) {
      SI_CONFIG.spawnInterval = config.spawnInterval;
      if (spawnTimer) {
        clearInterval(spawnTimer);
        spawnTimer = setInterval(spawnInvader, SI_CONFIG.spawnInterval);
      }
    }
    if (config.moveInterval !== undefined) {
      SI_CONFIG.moveInterval = config.moveInterval;
      if (moveTimer) {
        clearInterval(moveTimer);
        moveTimer = setInterval(moveInvaders, SI_CONFIG.moveInterval);
      }
    }
    broadcastSIState();
  });

  // Custom categories
  socket.on('get-custom-categories', () => {
    socket.emit('custom-categories', customCategories);
  });

  socket.on('add-sample', (data) => {
    const { category, features, thumbnail } = data || {};
    if (!category || !features || features.length !== 128) return;
    if (!customCategories[category]) customCategories[category] = { samples: [], thumbnails: [] };
    if (!customCategories[category].thumbnails) customCategories[category].thumbnails = [];
    customCategories[category].samples.push(features);
    if (thumbnail) customCategories[category].thumbnails.push(thumbnail);
    saveCustomCategories();
    io.emit('custom-categories', customCategories);
    console.log(`Custom category "${category}" now has ${customCategories[category].samples.length} samples`);
  });

  socket.on('remove-category', (category) => {
    if (customCategories[category]) {
      delete customCategories[category];
      saveCustomCategories();
      io.emit('custom-categories', customCategories);
    }
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      player.connected = false;
      broadcastFullState();
      console.log(`${player.name} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: ${getNetworkUrl()}`);
  console.log(`  Leaderboard: ${getNetworkUrl()}/leaderboard.html`);
});
