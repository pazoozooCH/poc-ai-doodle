const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { execSync } = require('child_process');

const app = express();
const http = createServer(app);
const io = new Server(http);

// Server info endpoint
const startupTime = new Date().toISOString();
let gitCommit = 'unknown';
try {
  gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch (e) { /* not a git repo */ }

app.get('/api/info', (req, res) => {
  res.json({ gitCommit, startupTime });
});

app.use(express.static('public'));
app.use('/slides', express.static('slides'));

// ============ Shared state ============

const WORD_LIST = [
  'cat', 'dog', 'house', 'car', 'tree', 'fish', 'bird', 'sun', 'moon', 'star',
  'flower', 'hat', 'shoe', 'bicycle', 'airplane', 'sailboat', 'guitar', 'pizza',
  'apple', 'banana', 'clock', 'skull', 'smiley face', 'umbrella', 'lightning'
];

const players = new Map();
const customCategories = {};

// ============ Game mode ============

let gameMode = 'quick-draw'; // 'quick-draw' | 'space-invaders'

// --- Quick Draw config ---
const QUICK_DRAW = { timeLimit: 20, numRounds: 10 };

function shuffleWords() {
  const shuffled = [...WORD_LIST].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, QUICK_DRAW.numRounds);
}

// --- Space Invaders state ---
const SPACE_INVADERS = {
  difficulty: 0.5,        // confidence threshold (0-1)
  spawnInterval: 3000,    // ms between spawns
  moveInterval: 500,      // ms between moves
  invaderSpeed: 1,        // rows per move
  gridRows: 12,           // grid height
  gridCols: 8,            // grid width
  hitBonus: 100,
  missPenalty: -30,
  gameOver: false,
};

let invaders = [];       // { id, category, col, row, alive, image (base64 index) }
let invaderIdCounter = 0;
let spawnTimer = null;
let moveTimer = null;
let siRunning = false;

function spawnInvader() {
  const category = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  const col = Math.floor(Math.random() * SPACE_INVADERS.gridCols);
  const invader = {
    id: invaderIdCounter++,
    category,
    col,
    row: 0,
    alive: true,
  };
  invaders.push(invader);
  broadcastSIState();
}

function moveInvaders() {
  let gameOver = false;
  for (const inv of invaders) {
    if (!inv.alive) continue;
    inv.row += SPACE_INVADERS.invaderSpeed;
    if (inv.row >= SPACE_INVADERS.gridRows) {
      gameOver = true;
    }
  }
  // Remove off-screen invaders
  invaders = invaders.filter(inv => inv.row < SPACE_INVADERS.gridRows + 2);

  if (gameOver) {
    stopSpaceInvaders();
    SPACE_INVADERS.gameOver = true;
  }
  broadcastSIState();
}

function startSpaceInvaders() {
  invaders = [];
  invaderIdCounter = 0;
  SPACE_INVADERS.gameOver = false;
  siRunning = true;

  // Reset player scores
  for (const [, player] of players) {
    player.score = 0;
    player.streak = 0;
  }

  spawnTimer = setInterval(spawnInvader, SPACE_INVADERS.spawnInterval);
  moveTimer = setInterval(moveInvaders, SPACE_INVADERS.moveInterval);
  broadcastSIState();
  io.emit('leaderboard', getLeaderboard());
}

function stopSpaceInvaders() {
  siRunning = false;
  clearInterval(spawnTimer);
  clearInterval(moveTimer);
  spawnTimer = null;
  moveTimer = null;
}

function broadcastSIState() {
  io.emit('si-state', {
    invaders: invaders.filter(inv => inv.alive),
    gameOver: SPACE_INVADERS.gameOver,
    difficulty: SPACE_INVADERS.difficulty,
    gridRows: SPACE_INVADERS.gridRows,
    gridCols: SPACE_INVADERS.gridCols,
    running: siRunning,
  });
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

// ============ Socket handlers ============

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Send current game mode
  socket.emit('game-mode', gameMode);

  socket.on('join', (name) => {
    players.set(socket.id, {
      name,
      score: 0,
      streak: 0,
      round: 0,
      connected: true,
      words: shuffleWords(),
    });

    if (gameMode === 'quick-draw') {
      const player = players.get(socket.id);
      socket.emit('game-config', {
        words: player.words,
        timeLimit: QUICK_DRAW.timeLimit,
        numRounds: QUICK_DRAW.numRounds,
        mode: 'quick-draw',
      });
    } else {
      socket.emit('game-config', {
        mode: 'space-invaders',
        difficulty: SPACE_INVADERS.difficulty,
      });
    }

    io.emit('leaderboard', getLeaderboard());
    console.log(`${name} joined (mode: ${gameMode})`);
  });

  // Quick Draw round result
  socket.on('round-result', ({ success, timeTaken }) => {
    const player = players.get(socket.id);
    if (!player || gameMode !== 'quick-draw') return;

    if (success) {
      player.streak++;
      const streakMultiplier = Math.min(player.streak, 5);
      const timeBonus = Math.max(0, QUICK_DRAW.timeLimit - timeTaken);
      player.score += Math.round(timeBonus * streakMultiplier * 10);
    } else {
      player.streak = 0;
    }
    player.round++;
    io.emit('leaderboard', getLeaderboard());
  });

  // Space Invaders: player submits a classification
  socket.on('si-shoot', ({ category, confidence }) => {
    const player = players.get(socket.id);
    if (!player || gameMode !== 'space-invaders' || !siRunning) return;

    // Find the lowest alive invader matching this category
    const matchingInvaders = invaders
      .filter(inv => inv.alive && inv.category === category)
      .sort((a, b) => b.row - a.row); // lowest (closest to bottom) first

    if (matchingInvaders.length > 0 && confidence >= SPACE_INVADERS.difficulty) {
      const target = matchingInvaders[0];
      target.alive = false;
      player.score += SPACE_INVADERS.hitBonus;
      player.streak++;
      io.emit('si-hit', {
        invaderId: target.id,
        playerName: player.name,
        category: target.category,
      });
      console.log(`${player.name} shot ${target.category} (${(confidence * 100).toFixed(0)}%)`);
    } else {
      // Miss: no matching invader on screen or confidence too low
      player.score += SPACE_INVADERS.missPenalty;
      player.streak = 0;
      socket.emit('si-miss', { category, reason: matchingInvaders.length === 0 ? 'not-on-screen' : 'too-low' });
    }

    io.emit('leaderboard', getLeaderboard());
    broadcastSIState();
  });

  // Game mode switching (from leaderboard/host)
  socket.on('set-game-mode', (mode) => {
    if (mode === 'quick-draw' || mode === 'space-invaders') {
      if (gameMode === 'space-invaders') stopSpaceInvaders();
      gameMode = mode;
      io.emit('game-mode', gameMode);
      console.log(`Game mode changed to: ${gameMode}`);
    }
  });

  socket.on('si-start', () => {
    if (gameMode === 'space-invaders') {
      startSpaceInvaders();
      console.log('Space Invaders started');
    }
  });

  socket.on('si-stop', () => {
    stopSpaceInvaders();
    broadcastSIState();
    console.log('Space Invaders stopped');
  });

  socket.on('si-config', (config) => {
    if (config.difficulty !== undefined) SPACE_INVADERS.difficulty = config.difficulty;
    if (config.spawnInterval !== undefined) {
      SPACE_INVADERS.spawnInterval = config.spawnInterval;
      if (spawnTimer) {
        clearInterval(spawnTimer);
        spawnTimer = setInterval(spawnInvader, SPACE_INVADERS.spawnInterval);
      }
    }
    if (config.moveInterval !== undefined) {
      SPACE_INVADERS.moveInterval = config.moveInterval;
      if (moveTimer) {
        clearInterval(moveTimer);
        moveTimer = setInterval(moveInvaders, SPACE_INVADERS.moveInterval);
      }
    }
    broadcastSIState();
  });

  // Custom category training
  socket.on('get-custom-categories', () => {
    socket.emit('custom-categories', customCategories);
  });

  socket.on('add-sample', (data) => {
    const { category, features } = data || {};
    if (!category || !features || features.length !== 128) return;
    if (!customCategories[category]) {
      customCategories[category] = { samples: [] };
    }
    customCategories[category].samples.push(features);
    io.emit('custom-categories', customCategories);
    console.log(`Custom category "${category}" now has ${customCategories[category].samples.length} samples`);
  });

  socket.on('remove-category', (category) => {
    if (customCategories[category]) {
      delete customCategories[category];
      io.emit('custom-categories', customCategories);
    }
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      player.connected = false;
      io.emit('leaderboard', getLeaderboard());
      console.log(`${player.name} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const localIp = Object.values(nets).flat()
    .find(n => n.family === 'IPv4' && !n.internal)?.address || 'localhost';
  console.log(`Server running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIp}:${PORT}`);
  console.log(`  Leaderboard: http://${localIp}:${PORT}/leaderboard.html`);
});
