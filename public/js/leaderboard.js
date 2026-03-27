const socket = io();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ State ============
let currentMode = 'quick-draw';
let currentState = 'lobby';
let currentPlayerColors = {};

// ============ DOM refs ============
const modeBtns = document.querySelectorAll('.mode-btn');
const lobbyContainer = document.getElementById('lobby-container');
const qdContainer = document.getElementById('qd-container');
const siContainer = document.getElementById('si-container');
const tttContainer = document.getElementById('ttt-container');
const startBtn = document.getElementById('btn-start-game');
const stopBtn = document.getElementById('btn-stop-game');

// ============ Mode switching ============
modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('set-game-mode', btn.dataset.mode);
  });
});

startBtn.addEventListener('click', () => {
  socket.emit('start-game');
});

stopBtn.addEventListener('click', () => {
  socket.emit('stop-game');
});

// ============ Full state updates ============
socket.on('full-state', ({ gameMode, gameState, players, leaderboard, playerColors }) => {
  currentMode = gameMode;
  currentState = gameState;
  currentPlayerColors = playerColors || {};

  // Update mode buttons
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === gameMode);
  });

  // Show/hide containers
  const isLobby = gameState === 'lobby';
  const isPlaying = gameState === 'playing';
  const isSI = gameMode === 'space-invaders';
  const isTTT = gameMode === 'tic-tac-toe';
  // Lobby: show for quick-draw and tic-tac-toe lobby
  lobbyContainer.style.display = isLobby && !isSI ? '' : 'none';
  qdContainer.style.display = isPlaying && !isSI && !isTTT ? '' : 'none';
  // SI container: show whenever SI mode is selected
  siContainer.style.display = isSI ? '' : 'none';
  // TTT container: show whenever TTT mode is selected
  tttContainer.style.display = isTTT ? '' : 'none';

  // Start/stop buttons
  startBtn.style.display = gameState === 'lobby' ? '' : 'none';
  stopBtn.style.display = gameState === 'playing' ? '' : 'none';

  // Lobby player list
  const lobbyList = document.getElementById('lobby-players');
  if (players.length === 0) {
    lobbyList.innerHTML = '<p class="no-players">Waiting for players to join...</p>';
  } else {
    lobbyList.innerHTML = players.map(p =>
      `<div style="display:inline-block;padding:8px 16px;margin:4px;background:#16213e;border-radius:20px;font-size:0.95rem">${escapeHtml(p.name)}</div>`
    ).join('');
  }
  document.getElementById('lobby-count').textContent = `${players.length} player${players.length !== 1 ? 's' : ''} joined`;

  // Leaderboard (QD + SI sidebar)
  updateLeaderboard(leaderboard);
});

function updateLeaderboard(players) {
  // Quick Draw leaderboard
  const content = document.getElementById('leaderboard-content');
  if (players.length === 0) {
    content.innerHTML = '<p class="no-players">No scores yet</p>';
  } else {
    const rows = players.map(p => {
      const rankClass = p.rank <= 3 ? `rank-${p.rank}` : '';
      const streakText = p.streak >= 2 ? `<span class="streak-fire">${'\u{1F525}'.repeat(Math.min(p.streak, 5))}</span>` : '';
      return `<tr>
        <td class="${rankClass}">${p.rank}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.score}</td>
        <td>${streakText}</td>
        <td>${p.round} / ${p.totalRounds}</td>
      </tr>`;
    }).join('');

    content.innerHTML = `
      <table class="leaderboard-table">
        <thead><tr>
          <th>Rank</th><th>Player</th><th>Score</th><th>Streak</th><th>Progress</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // TTT sidebar scores with colors
  const tttScores = document.getElementById('ttt-host-scores');
  if (tttScores && currentMode === 'tic-tac-toe') {
    if (players.length === 0) {
      tttScores.innerHTML = '<p style="color:#555;font-size:0.85rem">Waiting for players...</p>';
    } else {
      tttScores.innerHTML = players.map(p => {
        const color = currentPlayerColors[p.name] || '#888';
        return `<div class="ttt-player-score">
          <span><span class="ttt-player-color-dot" style="background:${color}"></span>${escapeHtml(p.name)}</span>
          <span style="color:${color};font-weight:600">${p.score}</span>
        </div>`;
      }).join('');
    }
  }

  // SI sidebar scores/players
  const siScores = document.getElementById('si-scores');
  if (siScores) {
    if (players.length === 0) {
      siScores.innerHTML = '<p style="color:#555;font-size:0.85rem">Waiting for players...</p>';
    } else {
      siScores.innerHTML = players.slice(0, 10).map(p =>
        `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1a1a2e;font-size:0.85rem">
          <span>${escapeHtml(p.name)}</span>
          <span style="color:#e94560;font-weight:600">${p.score}</span>
        </div>`
      ).join('');
    }
  }
}

// ============ Space Invaders Display ============
const siCanvas = document.getElementById('si-canvas');
const siCtx = siCanvas ? siCanvas.getContext('2d') : null;
let siState = { invaders: [], gameOver: false, running: false, gridRows: 10, gridCols: 6 };

let sampleImages = {};
fetch('/model/samples.json')
  .then(r => r.json())
  .then(data => { sampleImages = data; })
  .catch(() => {});

const imageCache = {};
function getDoodleImage(category) {
  if (imageCache[category]) return imageCache[category];
  if (!sampleImages[category] || sampleImages[category].length === 0) return null;
  const img = new Image();
  img.src = 'data:image/png;base64,' + sampleImages[category][0];
  imageCache[category] = img;
  return img;
}

function renderSpaceInvaders() {
  if (!siCanvas || !siCtx) return;
  const W = siCanvas.width;
  const H = siCanvas.height;
  const cellW = W / siState.gridCols;
  const cellH = H / siState.gridRows;

  siCtx.fillStyle = '#0a0a1a';
  siCtx.fillRect(0, 0, W, H);

  // Grid lines
  siCtx.strokeStyle = 'rgba(255,255,255,0.03)';
  for (let c = 1; c < siState.gridCols; c++) {
    siCtx.beginPath(); siCtx.moveTo(c * cellW, 0); siCtx.lineTo(c * cellW, H); siCtx.stroke();
  }
  for (let r = 1; r < siState.gridRows; r++) {
    siCtx.beginPath(); siCtx.moveTo(0, r * cellH); siCtx.lineTo(W, r * cellH); siCtx.stroke();
  }

  // Danger line
  siCtx.strokeStyle = '#e94560';
  siCtx.lineWidth = 2;
  siCtx.setLineDash([8, 4]);
  siCtx.beginPath();
  siCtx.moveTo(0, (siState.gridRows - 1) * cellH);
  siCtx.lineTo(W, (siState.gridRows - 1) * cellH);
  siCtx.stroke();
  siCtx.setLineDash([]);
  siCtx.lineWidth = 1;

  // Invaders
  for (const inv of siState.invaders) {
    const x = inv.col * cellW;
    const y = inv.row * cellH;
    const pad = 4;

    siCtx.fillStyle = 'rgba(233, 69, 96, 0.15)';
    siCtx.fillRect(x + pad, y + pad, cellW - pad * 2, cellH - pad * 2);
    siCtx.strokeStyle = 'rgba(233, 69, 96, 0.4)';
    siCtx.strokeRect(x + pad, y + pad, cellW - pad * 2, cellH - pad * 2);

    const img = getDoodleImage(inv.category);
    if (img && img.complete) {
      const imgSize = Math.min(cellW, cellH) - pad * 4;
      siCtx.drawImage(img, x + (cellW - imgSize) / 2, y + pad * 2, imgSize, imgSize * 0.7);
    }

    siCtx.fillStyle = '#eee';
    siCtx.font = `bold ${Math.max(10, cellW / 8)}px sans-serif`;
    siCtx.textAlign = 'center';
    siCtx.fillText(inv.category, x + cellW / 2, y + cellH - pad * 2);
  }

  // Spaceship
  const shipX = W / 2, shipY = H - 15;
  siCtx.fillStyle = '#2ecc71';
  siCtx.beginPath();
  siCtx.moveTo(shipX, shipY - 20);
  siCtx.lineTo(shipX - 15, shipY);
  siCtx.lineTo(shipX + 15, shipY);
  siCtx.closePath();
  siCtx.fill();

  // Game over overlay
  if (siState.gameOver) {
    siCtx.fillStyle = 'rgba(0,0,0,0.6)';
    siCtx.fillRect(0, 0, W, H);
    siCtx.fillStyle = '#e94560';
    siCtx.font = 'bold 48px sans-serif';
    siCtx.textAlign = 'center';
    siCtx.fillText('GAME OVER', W / 2, H / 2);
    siCtx.fillStyle = '#888';
    siCtx.font = '20px sans-serif';
    siCtx.fillText('Press Start to play again', W / 2, H / 2 + 40);
  }
}

socket.on('si-state', (state) => {
  siState = state;
  renderSpaceInvaders();
});

socket.on('si-hit', ({ playerName, category }) => {
  const feed = document.getElementById('si-feed');
  const entry = document.createElement('div');
  entry.style.color = '#2ecc71';
  entry.textContent = `\u2714 ${playerName} shot ${category}!`;
  feed.prepend(entry);
  while (feed.children.length > 20) feed.lastChild.remove();
});

socket.on('si-miss-feed', ({ playerName, category, reason }) => {
  const feed = document.getElementById('si-feed');
  const entry = document.createElement('div');
  entry.style.color = '#e94560';
  const reasonText = reason === 'not-on-screen' ? 'not on screen' : 'too low confidence';
  entry.textContent = `\u2718 ${playerName} missed (${category} \u2014 ${reasonText})`;
  feed.prepend(entry);
  while (feed.children.length > 20) feed.lastChild.remove();
});

// ============ Tic-Tac-Toe Display ============

socket.on('ttt-state', (state) => {
  renderTTTHost(state);
});

function renderTTTHost(state) {
  const boardEl = document.getElementById('ttt-host-board');
  const winnerEl = document.getElementById('ttt-host-winner');
  const scoresEl = document.getElementById('ttt-host-scores');
  if (!boardEl) return;

  // Render board
  boardEl.innerHTML = state.board.map((cell, i) => {
    const owned = cell.owner;
    const isWinCell = state.winner && state.winner.line && state.winner.line.includes(i);
    const borderColor = owned ? owned.color : '#333';
    const bgColor = owned ? owned.color + '30' : '#16213e';
    const classes = ['ttt-host-cell'];
    if (owned) classes.push('claimed');
    if (isWinCell) classes.push('winning-cell');

    let imgHtml = '';
    if (sampleImages[cell.category] && sampleImages[cell.category].length > 0) {
      imgHtml = `<img src="data:image/png;base64,${sampleImages[cell.category][0]}" alt="${cell.category}">`;
    }

    return `<div class="${classes.join(' ')}" style="border-color:${borderColor};background:${bgColor}">
      ${imgHtml}
      <span>${cell.category}</span>
      ${owned ? `<span class="cell-owner" style="color:${owned.color}">${escapeHtml(owned.name)}</span>` : ''}
    </div>`;
  }).join('');

  // Winner banner
  if (state.winner) {
    if (state.winner.name === 'Nobody') {
      winnerEl.innerHTML = `It's a draw!`;
      winnerEl.style.color = '#888';
    } else {
      winnerEl.innerHTML = `<span style="color:${state.winner.color}">${escapeHtml(state.winner.name)}</span> wins!`;
    }
    winnerEl.style.display = 'block';
  } else {
    winnerEl.style.display = 'none';
  }

  // Player scores with colors
  if (scoresEl && state.playerColors) {
    const entries = Object.entries(state.playerColors);
    if (entries.length === 0) {
      scoresEl.innerHTML = '<p style="color:#555;font-size:0.85rem">Waiting for players...</p>';
    } else {
      scoresEl.innerHTML = entries.map(([name, color]) =>
        `<div class="ttt-player-score">
          <span><span class="ttt-player-color-dot" style="background:${color}"></span>${escapeHtml(name)}</span>
        </div>`
      ).join('');
    }
  }
}

// SI config controls
document.getElementById('si-difficulty').addEventListener('change', (e) => {
  socket.emit('si-config', { difficulty: parseFloat(e.target.value) });
});

document.getElementById('si-speed').addEventListener('change', (e) => {
  const speeds = {
    slow: { spawnInterval: 6000, moveInterval: 3000 },
    medium: { spawnInterval: 4000, moveInterval: 2000 },
    fast: { spawnInterval: 2000, moveInterval: 1000 },
  };
  socket.emit('si-config', speeds[e.target.value]);
});

// Render loop
setInterval(renderSpaceInvaders, 50);
