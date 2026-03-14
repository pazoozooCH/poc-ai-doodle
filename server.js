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

const WORD_LIST = [
  'cat', 'dog', 'house', 'car', 'tree', 'fish', 'bird', 'sun', 'moon', 'star',
  'flower', 'hat', 'shoe', 'bicycle', 'airplane', 'sailboat', 'guitar', 'pizza',
  'apple', 'banana', 'clock', 'skull', 'smiley face', 'umbrella', 'lightning'
];
const TIME_LIMIT = 20;
const NUM_ROUNDS = 10;

const players = new Map();
const customCategories = {}; // { "robot": { samples: [[0.12, -0.34, ...], ...] } }

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
      totalRounds: NUM_ROUNDS
    }));
}

function shuffleWords() {
  const shuffled = [...WORD_LIST].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, NUM_ROUNDS);
}

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('join', (name) => {
    const words = shuffleWords();
    players.set(socket.id, {
      name,
      score: 0,
      streak: 0,
      round: 0,
      connected: true,
      words
    });
    socket.emit('game-config', { words, timeLimit: TIME_LIMIT, numRounds: NUM_ROUNDS });
    io.emit('leaderboard', getLeaderboard());
    console.log(`${name} joined`);
  });

  socket.on('round-result', ({ success, timeTaken }) => {
    const player = players.get(socket.id);
    if (!player) return;

    if (success) {
      player.streak++;
      const streakMultiplier = Math.min(player.streak, 5);
      const timeBonus = Math.max(0, TIME_LIMIT - timeTaken);
      player.score += Math.round(timeBonus * streakMultiplier * 10);
    } else {
      player.streak = 0;
    }
    player.round++;

    io.emit('leaderboard', getLeaderboard());
  });

  // Custom category training
  socket.on('get-custom-categories', () => {
    socket.emit('custom-categories', customCategories);
  });

  socket.on('add-sample', (data) => {
    const { category, features } = data || {};
    console.log('add-sample received:', category, 'features?', !!features, 'length:', features?.length);
    if (!category || !features || features.length !== 128) {
      console.log('add-sample REJECTED');
      return;
    }
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
      console.log(`Removed custom category "${category}"`);
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
