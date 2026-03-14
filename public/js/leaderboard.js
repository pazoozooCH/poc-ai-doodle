const socket = io();

// ============ Mode switching ============
let currentMode = 'quick-draw';
const qdContainer = document.getElementById('qd-container');
const siContainer = document.getElementById('si-container');
const modeBtns = document.querySelectorAll('.mode-btn');

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    socket.emit('set-game-mode', mode);
  });
});

socket.on('game-mode', (mode) => {
  currentMode = mode;
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  qdContainer.style.display = mode === 'quick-draw' ? '' : 'none';
  siContainer.style.display = mode === 'space-invaders' ? '' : 'none';
});

// ============ Quick Draw Leaderboard ============
const content = document.getElementById('leaderboard-content');

socket.on('leaderboard', (players) => {
  // Update Quick Draw leaderboard
  if (players.length === 0) {
    content.innerHTML = '<p class="no-players">Waiting for players...</p>';
  } else {
    const rows = players.map(p => {
      const rankClass = p.rank <= 3 ? `rank-${p.rank}` : '';
      const streakText = p.streak >= 2 ? `<span class="streak-fire">${'\u{1F525}'.repeat(Math.min(p.streak, 5))}</span>` : '';
      return `<tr>
        <td class="${rankClass}">${p.rank}</td>
        <td>${p.name}</td>
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

  // Update Space Invaders sidebar scores
  const siScores = document.getElementById('si-scores');
  if (siScores) {
    siScores.innerHTML = players.slice(0, 10).map(p =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1a1a2e;font-size:0.85rem">
        <span>${p.name}</span>
        <span style="color:#e94560;font-weight:600">${p.score}</span>
      </div>`
    ).join('') || '<p style="color:#555;font-size:0.85rem">No players</p>';
  }
});

// ============ Space Invaders Display ============
const siCanvas = document.getElementById('si-canvas');
const siCtx = siCanvas.getContext('2d');
let siState = { invaders: [], gameOver: false, running: false, gridRows: 12, gridCols: 8 };

// Load sample images for rendering invaders
let sampleImages = {};
fetch('/model/samples.json')
  .then(r => r.json())
  .then(data => { sampleImages = data; })
  .catch(() => {});

// Pre-render doodle images
const imageCache = {};
function getDoodleImage(category) {
  const key = category;
  if (imageCache[key]) return imageCache[key];
  if (!sampleImages[category] || sampleImages[category].length === 0) return null;
  const b64 = sampleImages[category][0];
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  imageCache[key] = img;
  return img;
}

function renderSpaceInvaders() {
  const W = siCanvas.width;
  const H = siCanvas.height;
  const cellW = W / siState.gridCols;
  const cellH = H / siState.gridRows;

  siCtx.fillStyle = '#0a0a1a';
  siCtx.fillRect(0, 0, W, H);

  // Draw grid lines (subtle)
  siCtx.strokeStyle = 'rgba(255,255,255,0.03)';
  for (let c = 1; c < siState.gridCols; c++) {
    siCtx.beginPath();
    siCtx.moveTo(c * cellW, 0);
    siCtx.lineTo(c * cellW, H);
    siCtx.stroke();
  }
  for (let r = 1; r < siState.gridRows; r++) {
    siCtx.beginPath();
    siCtx.moveTo(0, r * cellH);
    siCtx.lineTo(W, r * cellH);
    siCtx.stroke();
  }

  // Draw bottom line (danger zone)
  siCtx.strokeStyle = '#e94560';
  siCtx.lineWidth = 2;
  siCtx.setLineDash([8, 4]);
  siCtx.beginPath();
  siCtx.moveTo(0, (siState.gridRows - 1) * cellH);
  siCtx.lineTo(W, (siState.gridRows - 1) * cellH);
  siCtx.stroke();
  siCtx.setLineDash([]);
  siCtx.lineWidth = 1;

  // Draw invaders
  for (const inv of siState.invaders) {
    const x = inv.col * cellW;
    const y = inv.row * cellH;
    const padding = 4;

    // Background
    siCtx.fillStyle = 'rgba(233, 69, 96, 0.15)';
    siCtx.fillRect(x + padding, y + padding, cellW - padding * 2, cellH - padding * 2);
    siCtx.strokeStyle = 'rgba(233, 69, 96, 0.4)';
    siCtx.strokeRect(x + padding, y + padding, cellW - padding * 2, cellH - padding * 2);

    // Doodle image
    const img = getDoodleImage(inv.category);
    if (img && img.complete) {
      const imgSize = Math.min(cellW, cellH) - padding * 4;
      const imgX = x + (cellW - imgSize) / 2;
      const imgY = y + padding * 2;
      siCtx.drawImage(img, imgX, imgY, imgSize, imgSize * 0.7);
    }

    // Category label
    siCtx.fillStyle = '#eee';
    siCtx.font = `bold ${Math.max(10, cellW / 8)}px sans-serif`;
    siCtx.textAlign = 'center';
    siCtx.fillText(inv.category, x + cellW / 2, y + cellH - padding * 2);
  }

  // "Spaceship" at bottom
  const shipX = W / 2;
  const shipY = H - 15;
  siCtx.fillStyle = '#2ecc71';
  siCtx.beginPath();
  siCtx.moveTo(shipX, shipY - 20);
  siCtx.lineTo(shipX - 15, shipY);
  siCtx.lineTo(shipX + 15, shipY);
  siCtx.closePath();
  siCtx.fill();

  // Game status
  if (!siState.running && !siState.gameOver) {
    siCtx.fillStyle = 'rgba(255,255,255,0.5)';
    siCtx.font = 'bold 32px sans-serif';
    siCtx.textAlign = 'center';
    siCtx.fillText('Press Start to begin', W / 2, H / 2);
  }
}

socket.on('si-state', (state) => {
  siState = state;
  document.getElementById('si-game-over').style.display = state.gameOver ? 'flex' : 'none';
  document.getElementById('si-start').style.display = state.running ? 'none' : '';
  document.getElementById('si-stop').style.display = state.running ? '' : 'none';
  renderSpaceInvaders();
});

// Hit feed
socket.on('si-hit', ({ playerName, category }) => {
  const feed = document.getElementById('si-feed');
  const entry = document.createElement('div');
  entry.textContent = `${playerName} shot ${category}!`;
  feed.prepend(entry);
  // Keep max 20 entries
  while (feed.children.length > 20) feed.lastChild.remove();
});

// Controls
document.getElementById('si-start').addEventListener('click', () => {
  socket.emit('si-start');
});

document.getElementById('si-stop').addEventListener('click', () => {
  socket.emit('si-stop');
});

document.getElementById('si-difficulty').addEventListener('change', (e) => {
  socket.emit('si-config', { difficulty: parseFloat(e.target.value) });
});

document.getElementById('si-speed').addEventListener('change', (e) => {
  const speeds = {
    slow: { spawnInterval: 5000, moveInterval: 800 },
    medium: { spawnInterval: 3000, moveInterval: 500 },
    fast: { spawnInterval: 1500, moveInterval: 300 },
  };
  socket.emit('si-config', speeds[e.target.value]);
});

// Render loop for smooth animation
setInterval(renderSpaceInvaders, 50);
