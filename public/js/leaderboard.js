const socket = io();
const content = document.getElementById('leaderboard-content');

socket.on('leaderboard', (players) => {
  if (players.length === 0) {
    content.innerHTML = '<p class="no-players">Waiting for players...</p>';
    return;
  }

  const rows = players.map(p => {
    const rankClass = p.rank <= 3 ? `rank-${p.rank}` : '';
    const streakText = p.streak >= 2 ? `<span class="streak-fire">${'🔥'.repeat(Math.min(p.streak, 5))}</span>` : '';
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
});
