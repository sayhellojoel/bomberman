// game.js — Bomberman client: input handling, WebSocket communication, Canvas rendering

const GRID_W = 15;
const GRID_H = 13;
const TILE = 40; // base tile size, will scale

let ws = null;
let myId = null;
let myColorIndex = 0;
let inLobby = true;
let gameState = null;
let lastRenderState = null;

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let scale = 1;

// DOM refs
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const joinSection = document.getElementById('join-section');
const lobbyInfo = document.getElementById('lobby-info');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const mapSelect = document.getElementById('mapSelect');
const dropRate = document.getElementById('dropRate');
const dropRateVal = document.getElementById('dropRateVal');
const playerList = document.getElementById('playerList');
const scoreboard = document.getElementById('scoreboard');
const roundEndDiv = document.getElementById('roundEnd');
const roundEndText = document.getElementById('roundEndText');
const gameHeader = document.getElementById('game-header');
const gameTimerEl = document.getElementById('game-timer');
const quitBtn = document.getElementById('quitBtn');
const quitModal = document.getElementById('quitModal');
const ctrlDpad = document.getElementById('game-ctrl-dpad');
const ctrlBomb = document.getElementById('game-ctrl-bomb');

// --- Game Timer ---
let gameStartTime = null;
let timerInterval = null;

function startTimer() {
  gameStartTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 500); // update twice/sec for accuracy
  updateTimer();
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  gameStartTime = null;
  if (gameTimerEl) {
    gameTimerEl.textContent = '0:00';
    gameTimerEl.className = '';
  }
}

function updateTimer() {
  if (!gameStartTime) return;
  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  gameTimerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  // Colour shifts: yellow → orange (2 min) → red (3 min)
  gameTimerEl.classList.toggle('timer-warning',  elapsed >= 120 && elapsed < 180);
  gameTimerEl.classList.toggle('timer-critical', elapsed >= 180);
}

// --- Sprite Images ---
const spriteImages = {};
let selectedSprite = null;

function buildSpritePicker(sprites) {
  const picker = document.getElementById('sprite-picker');
  picker.innerHTML = '';
  sprites.forEach((filename, i) => {
    // Preload image
    const img = new Image();
    img.src = `8%20bit%20originals/${encodeURIComponent(filename)}`;
    spriteImages[filename] = img;

    // Build card
    const card = document.createElement('div');
    card.className = 'sprite-card' + (i === 0 ? ' selected' : '');
    card.dataset.sprite = filename;
    const imgEl = document.createElement('img');
    imgEl.src = img.src;
    imgEl.alt = filename.replace(/\.[^.]+$/, '');
    const label = document.createElement('span');
    label.textContent = filename.replace(/\.[^.]+$/, '');
    card.appendChild(imgEl);
    card.appendChild(label);
    picker.appendChild(card);
  });

  if (sprites.length > 0) selectedSprite = sprites[0];
}

// Event delegation for sprite picker
document.getElementById('sprite-picker').addEventListener('click', (e) => {
  const card = e.target.closest('.sprite-card');
  if (!card) return;
  document.querySelectorAll('.sprite-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedSprite = card.dataset.sprite;
});
document.getElementById('sprite-picker').addEventListener('touchend', (e) => {
  const card = e.target.closest('.sprite-card');
  if (!card) return;
  e.preventDefault();
  document.querySelectorAll('.sprite-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedSprite = card.dataset.sprite;
}, { passive: false });

// Fetch sprite list from server and build picker
fetch('/api/sprites')
  .then(r => r.json())
  .then(sprites => buildSpritePicker(sprites))
  .catch(() => buildSpritePicker(['Adam.png'])); // fallback if fetch fails

// --- Device ID (persistent, prevents same device joining twice) ---
function getDeviceId() {
  let id = localStorage.getItem('bomberman_device_id');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('bomberman_device_id', id);
  }
  return id;
}

// --- WebSocket Connection ---
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => console.log('Connected');

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    // Try reconnect after delay
    setTimeout(connect, 2000);
  };
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// --- Message Handlers ---
function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      myId = msg.playerId;
      myColorIndex = msg.colorIndex;
      joinSection.style.display = 'none';
      lobbyInfo.style.display = 'block';
      break;

    case 'lobby':
      inLobby = true;
      lobbyDiv.style.display = 'block';
      gameDiv.style.display = 'none';
      roundEndDiv.style.display = 'none';
      stopTimer();
      updateLobbyUI(msg);
      break;

    case 'gameStart':
      inLobby = false;
      lobbyDiv.style.display = 'none';
      gameDiv.style.display = 'grid';
      roundEndDiv.style.display = 'none';
      resizeCanvas();
      startTimer();
      break;

    case 'gameState':
      // Grid is only sent when it changes — preserve the last known grid otherwise
      if (!msg.grid && gameState) msg.grid = gameState.grid;
      gameState = msg;
      updateScoreboard(msg.players);
      break;

    case 'roundEnd':
      showRoundEnd(msg);
      break;

    case 'error':
      alert(msg.message);
      // Re-enable join button if the error happened before joining
      if (!myId) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Game';
      }
      break;
  }
}

// --- Lobby UI ---
function updateLobbyUI(data) {
  // Player list
  playerList.innerHTML = data.players.map(p => {
    const thumb = p.sprite
      ? `<img class="player-sprite-thumb" src="8%20bit%20originals/${encodeURIComponent(p.sprite)}" alt="${escapeHtml(p.sprite)}">`
      : `<div class="player-color" style="background:${p.color}"></div>`;
    return `<div class="player-tag">
      ${thumb}
      <span>${escapeHtml(p.name)}</span>
      <span style="color:#ffd700;">${p.wins}W</span>
    </div>`;
  }).join('');

  // Map select
  if (mapSelect.children.length !== data.maps.length) {
    mapSelect.innerHTML = data.maps.map(m =>
      `<option value="${m.index}">${m.name} — ${m.description}</option>`
    ).join('');
  }
  mapSelect.value = data.selectedMap;

  // Drop rate
  dropRate.value = data.itemDropRate;
  dropRateVal.textContent = data.itemDropRate + '%';

  // Start button
  startBtn.disabled = data.players.length < 2;
  startBtn.textContent = data.players.length < 2
    ? 'Start Game (need 2+ players)'
    : 'Start Game';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Scoreboard with powerup badges ---
function updateScoreboard(players) {
  scoreboard.innerHTML = players.map(p => {
    const isMe = p.id === myId;
    const badges = [];

    if (p.bombRange > 1)  badges.push(`<span class="pu-badge pu-fire">F:${p.bombRange}</span>`);
    if (p.maxBombs > 1)   badges.push(`<span class="pu-badge pu-bomb">B:${p.maxBombs}</span>`);
    if (p.speed > 1)      badges.push(`<span class="pu-badge pu-speed">S:${p.speed}</span>`);
    if (p.hasRemote)      badges.push(`<span class="pu-badge pu-remote">RC</span>`);
    if (p.hasKick)        badges.push(`<span class="pu-badge pu-kick">K</span>`);
    if (p.hasShield)      badges.push(`<span class="pu-badge pu-shield">SH</span>`);
    if (p.curse)          badges.push(`<span class="pu-badge pu-curse">☠</span>`);

    const thumb = p.sprite
      ? `<img class="score-sprite" src="8%20bit%20originals/${encodeURIComponent(p.sprite)}" alt="">`
      : `<div class="score-color" style="background:${p.color}"></div>`;
    return `<div class="score-entry ${p.alive ? '' : 'score-dead'}${isMe ? ' score-me' : ''}">
      ${thumb}
      <span class="score-name">${escapeHtml(p.name)}</span>
      <span class="score-badges">${badges.join('')}</span>
      <span class="score-stats">${p.wins}W ${p.score}P</span>
    </div>`;
  }).join('');
}

// --- Round End ---
function showRoundEnd(msg) {
  roundEndDiv.style.display = 'flex';
  if (msg.draw) {
    roundEndText.textContent = 'DRAW!';
    roundEndText.style.color = '#ffd700';
  } else {
    roundEndText.textContent = `${msg.winner.name} WINS!`;
    roundEndText.style.color = msg.winner.color;
  }
}

// --- Quit Button ---
quitBtn.addEventListener('click', () => {
  quitModal.style.display = 'flex';
});

document.getElementById('quitCancel').addEventListener('click', () => {
  quitModal.style.display = 'none';
});

document.getElementById('quitConfirm').addEventListener('click', () => {
  // Reload the page — disconnects WS and returns to lobby
  window.location.reload();
});

// --- Canvas Resize ---
function resizeCanvas() {
  const headerH = gameHeader.offsetHeight || 44;
  const isLandscape = window.innerWidth > window.innerHeight;
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

  let availW, availH;
  if (isTouchDevice && isLandscape) {
    // Landscape: dpad on left, bomb on right — measure their widths
    const dpadW = ctrlDpad.offsetWidth || 164;
    const bombW = ctrlBomb.offsetWidth || 114;
    availW = window.innerWidth - dpadW - bombW;
    availH = window.innerHeight - headerH;
  } else if (isTouchDevice || window.innerWidth <= 600) {
    // Portrait: controls sit below as a separate grid row
    const ctrlH = ctrlDpad.offsetHeight || 0;
    availW = window.innerWidth;
    availH = window.innerHeight - headerH - ctrlH;
  } else {
    // Desktop: full window minus header
    availW = window.innerWidth;
    availH = window.innerHeight - headerH;
  }

  const targetW = GRID_W * TILE;
  const targetH = GRID_H * TILE;

  scale = Math.min(availW / targetW, availH / targetH);
  scale = Math.max(scale, 0.3); // never go below 30% scale
  canvas.width = Math.floor(targetW * scale);
  canvas.height = Math.floor(targetH * scale);
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
}

window.addEventListener('resize', () => {
  if (!inLobby) resizeCanvas();
});

window.addEventListener('orientationchange', () => {
  if (!inLobby) setTimeout(resizeCanvas, 150);
});

// --- Client-side interpolation state ---
// Tracks smooth render positions for each player, updated every animation frame
const renderPos = {}; // playerId → { rx, ry }
let lastRenderTime = null;

function updateRenderPositions(now) {
  if (!gameState) return;
  const dt = lastRenderTime ? (now - lastRenderTime) / 1000 : 0;
  lastRenderTime = now;

  gameState.players.forEach(p => {
    if (!renderPos[p.id]) {
      renderPos[p.id] = { rx: p.x, ry: p.y };
    }
    const r = renderPos[p.id];

    if (p.moving) {
      // Advance client-side interpolation at the same speed as the server
      const baseSpeed = 4 + (p.speed - 1) * 1.2;
      // Use server moveProgress as a lower bound so we never lag behind
      const clientProgress = p.moveProgress + baseSpeed * dt;
      const prog = Math.min(clientProgress, 1);
      r.rx = p.x + (p.targetX - p.x) * prog;
      r.ry = p.y + (p.targetY - p.y) * prog;
    } else {
      // Not moving — snap to confirmed tile position
      r.rx = p.x;
      r.ry = p.y;
    }
  });
}

// --- Rendering ---
function render(now) {
  requestAnimationFrame(render);
  if (inLobby || !gameState) return;

  updateRenderPositions(now);

  const s = TILE * scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw grid
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const tile = gameState.grid[y][x];
      const px = x * s;
      const py = y * s;

      // Floor
      ctx.fillStyle = '#4a7a4a';
      ctx.fillRect(px, py, s, s);
      // Floor grid lines
      ctx.strokeStyle = '#3d6b3d';
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, s, s);

      if (tile === 'W') {
        // Indestructible wall — gray with pseudo-3D
        ctx.fillStyle = '#666';
        ctx.fillRect(px, py, s, s);
        ctx.fillStyle = '#888';
        ctx.fillRect(px + 1, py + 1, s - 4, s - 4);
        ctx.fillStyle = '#555';
        ctx.fillRect(px + 3, py + 3, s - 6, s - 6);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, s, s);
      } else if (tile === 'B') {
        // Soft block — brown brick
        ctx.fillStyle = '#c4813d';
        ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
        ctx.fillStyle = '#a0692e';
        ctx.fillRect(px + 2, py + 2, s - 4, s / 2 - 2);
        ctx.strokeStyle = '#6b4226';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
        // Brick lines
        ctx.beginPath();
        ctx.moveTo(px + 1, py + s / 2);
        ctx.lineTo(px + s - 1, py + s / 2);
        ctx.moveTo(px + s / 2, py + 1);
        ctx.lineTo(px + s / 2, py + s / 2);
        ctx.moveTo(px + s / 3, py + s / 2);
        ctx.lineTo(px + s / 3, py + s - 1);
        ctx.moveTo(px + s * 2 / 3, py + s / 2);
        ctx.lineTo(px + s * 2 / 3, py + s - 1);
        ctx.strokeStyle = '#6b4226';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // Draw powerups
  gameState.powerups.forEach(pu => {
    drawPowerup(pu.x * s, pu.y * s, s, pu.kind);
  });

  // Draw bombs
  gameState.bombs.forEach(b => {
    drawBomb(b.x * s, b.y * s, s, b.timer, b.remote);
  });

  // Draw explosions
  gameState.explosions.forEach(e => {
    const px = e.x * s;
    const py = e.y * s;
    const intensity = e.timer / 0.5;
    ctx.fillStyle = `rgba(255, ${Math.floor(100 + 155 * intensity)}, 0, ${0.5 + 0.5 * intensity})`;
    ctx.fillRect(px, py, s, s);
    // Bright center
    ctx.fillStyle = `rgba(255, 255, 200, ${0.6 * intensity})`;
    ctx.beginPath();
    ctx.arc(px + s / 2, py + s / 2, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw players
  gameState.players.forEach(p => {
    if (!p.alive) return;
    const r = renderPos[p.id] || { rx: p.x, ry: p.y };
    const px = r.rx * s;
    const py = r.ry * s;
    drawPlayer(px, py, s, p);
  });
}

function drawPlayer(px, py, s, p) {
  const cx = px + s / 2;
  const cy = py + s / 2;
  const r = s * 0.38;

  // Invincibility flash
  if (p.invincibleTimer > 0 && Math.floor(Date.now() / 100) % 2 === 0) return;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, py + s * 0.92, s * 0.32, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  const img = p.sprite ? spriteImages[p.sprite] : null;

  if (img && img.complete && img.naturalWidth > 0) {
    // --- Sprite image rendering ---
    // Use high-quality smoothing (these are photos, not pixel art)
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Maintain aspect ratio — fit inside tile, centered
    const margin = s * 0.04;
    const maxW = s - margin * 2;
    const maxH = s - margin * 2;
    const aspect = img.naturalWidth / img.naturalHeight;
    let dw, dh;
    if (aspect >= 1) {
      dw = maxW;
      dh = maxW / aspect;
    } else {
      dh = maxH;
      dw = maxH * aspect;
    }
    const dx = px + margin + (maxW - dw) / 2;
    const dy = py + margin + (maxH - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    // Shield: cyan circle around sprite
    if (p.hasShield) {
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Curse: purple tint overlay
    if (p.curse) {
      ctx.fillStyle = 'rgba(128, 0, 128, 0.28)';
      ctx.fillRect(dx, dy, dw, dh);
    }

  } else {
    // --- Fallback: drawn Bomberman shape ---
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face
    const eyeY = cy - r * 0.25;
    const eyeOff = r * 0.25;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - eyeOff, eyeY, r * 0.15, 0, Math.PI * 2);
    ctx.arc(cx + eyeOff, eyeY, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx - eyeOff, eyeY, r * 0.07, 0, Math.PI * 2);
    ctx.arc(cx + eyeOff, eyeY, r * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // Antenna
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.1 - r);
    ctx.lineTo(cx, cy - r * 0.1 - r - r * 0.4);
    ctx.stroke();
    ctx.fillStyle = '#ff6600';
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1 - r - r * 0.4, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // Shield indicator
    if (p.hasShield) {
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.1, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Curse tint
    if (p.curse) {
      ctx.fillStyle = 'rgba(128, 0, 128, 0.3)';
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.1, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBomb(px, py, s, timer, remote) {
  const cx = px + s / 2;
  const cy = py + s / 2;
  const r = s * 0.32;

  // Pulse effect
  const pulse = 1 + Math.sin(Date.now() / 100) * 0.06;

  // Bomb body
  ctx.fillStyle = remote ? '#4444aa' : '#222';
  ctx.beginPath();
  ctx.arc(cx, cy + 2, r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Fuse
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.3, cy - r * 0.7);
  ctx.quadraticCurveTo(cx + r * 0.6, cy - r * 1.2, cx + r * 0.1, cy - r * 1.1);
  ctx.stroke();

  // Fuse spark
  if (timer < 1.5 || Math.random() > 0.5) {
    ctx.fillStyle = '#ff4400';
    ctx.beginPath();
    ctx.arc(cx + r * 0.1, cy - r * 1.1, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPowerup(px, py, s, kind) {
  const cx = px + s / 2;
  const cy = py + s / 2;
  const pad = 3;

  // Background tile
  const colors = {
    fireUp: '#ff4444', bombUp: '#4444ff', speedUp: '#44bb44',
    fullFire: '#ff8800', remote: '#8844ff', kick: '#bbbb44',
    skull: '#6b2fa0', shield: '#00cccc'
  };
  const symbols = {
    fireUp: 'F', bombUp: 'B', speedUp: 'S',
    fullFire: 'FF', remote: 'RC', kick: 'K',
    skull: 'SK', shield: 'SH'
  };

  // Glowing background
  ctx.fillStyle = kind === 'skull' ? '#2a0040' : '#222';
  ctx.fillRect(px + pad, py + pad, s - pad * 2, s - pad * 2);
  ctx.fillStyle = colors[kind] || '#888';
  ctx.globalAlpha = 0.7 + Math.sin(Date.now() / 200) * 0.3;
  ctx.fillRect(px + pad + 2, py + pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);
  ctx.globalAlpha = 1;

  // Border
  ctx.strokeStyle = kind === 'skull' ? '#ff00ff' : '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + pad, py + pad, s - pad * 2, s - pad * 2);

  // Symbol
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.floor(s * 0.35)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbols[kind], cx, cy);

  // Skull special: draw a skull-like shape
  if (kind === 'skull') {
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, s * 0.18, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// --- Input Handling ---
const keysDown = {};
let moveInterval = null;

document.addEventListener('keydown', (e) => {
  if (inLobby) {
    if (e.key === 'Enter' && document.activeElement === nameInput) {
      joinBtn.click();
    }
    return;
  }

  // Close quit modal with Escape
  if (e.key === 'Escape') {
    quitModal.style.display = 'none';
    return;
  }

  const key = e.key.toLowerCase();
  if (keysDown[key]) return;
  keysDown[key] = true;

  // Bomb
  if (key === ' ' || key === 'spacebar') {
    e.preventDefault();
    send({ type: 'input', action: 'bomb' });
    return;
  }

  // Movement
  const dir = getDirection(key);
  if (dir) {
    e.preventDefault();
    send({ type: 'input', action: 'move', dir });
    startMoveRepeat(key);
  }
});

document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  delete keysDown[key];
  // If no movement keys held, stop repeat
  if (!getHeldDirection()) {
    clearInterval(moveInterval);
    moveInterval = null;
  }
});

function getDirection(key) {
  if (key === 'arrowup' || key === 'w') return 'up';
  if (key === 'arrowdown' || key === 's') return 'down';
  if (key === 'arrowleft' || key === 'a') return 'left';
  if (key === 'arrowright' || key === 'd') return 'right';
  return null;
}

function getHeldDirection() {
  for (const key of Object.keys(keysDown)) {
    const dir = getDirection(key);
    if (dir) return dir;
  }
  return null;
}

function startMoveRepeat(key) {
  if (moveInterval) clearInterval(moveInterval);
  moveInterval = setInterval(() => {
    const dir = getHeldDirection();
    if (dir) send({ type: 'input', action: 'move', dir });
  }, 120);
}

// Mobile controls
document.querySelectorAll('.dpad-btn').forEach(btn => {
  let interval = null;
  const dir = btn.dataset.dir;

  const start = (e) => {
    e.preventDefault();
    send({ type: 'input', action: 'move', dir });
    interval = setInterval(() => send({ type: 'input', action: 'move', dir }), 120);
  };
  const stop = (e) => {
    e.preventDefault();
    clearInterval(interval);
  };

  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', stop, { passive: false });
  btn.addEventListener('touchcancel', stop, { passive: false });
});

document.getElementById('bombBtn').addEventListener('touchstart', (e) => {
  e.preventDefault();
  send({ type: 'input', action: 'bomb' });
}, { passive: false });

// --- Lobby Controls ---
joinBtn.addEventListener('click', () => {
  if (joinBtn.disabled) return;
  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining...';

  const name = nameInput.value.trim() || 'Player';
  connect();
  // Wait for connection, then join
  const waitConnect = setInterval(() => {
    if (ws && ws.readyState === 1) {
      clearInterval(waitConnect);
      send({ type: 'join', name, deviceId: getDeviceId(), sprite: selectedSprite });
    }
  }, 100);

  // Restore button if no response in 5s
  setTimeout(() => {
    clearInterval(waitConnect);
    if (!myId) {
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join Game';
    }
  }, 5000);
});

mapSelect.addEventListener('change', () => {
  send({ type: 'selectMap', index: parseInt(mapSelect.value) });
});

dropRate.addEventListener('input', () => {
  dropRateVal.textContent = dropRate.value + '%';
  send({ type: 'setDropRate', rate: dropRate.value });
});

startBtn.addEventListener('click', () => {
  send({ type: 'startGame' });
});

// Start render loop
render();
