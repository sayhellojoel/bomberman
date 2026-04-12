// game.js — Bomberman client: input handling, WebSocket communication, Canvas rendering

const GRID_W = 15;
const GRID_H = 13;
const TILE = 40; // base tile size, will scale

let ws = null;
let myId = null;
let myColorIndex = 0;
let inLobby = true;
let isSpectating = false;
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

// --- Powerup Icon Images ---
// Keyed by symbol string (e.g. "B", "SH") — populated from /api/icons
const iconImages = {};

fetch('/api/icons')
  .then(r => r.json())
  .then(map => {
    // map = { B: "B.png", SH: "SH.png", ... }
    Object.entries(map).forEach(([sym, filename]) => {
      const img = new Image();
      img.src = `Icons/${encodeURIComponent(filename)}`;
      iconImages[sym] = img;
    });
  })
  .catch(() => {}); // silently fall back to drawn icons if fetch fails

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

  if (sprites.length > 0) {
    selectedSprite = sprites[0];
    nameInput.value = sprites[0].replace(/\.[^.]+$/, '');
  }
}

function selectSprite(filename) {
  selectedSprite = filename;
  nameInput.value = filename.replace(/\.[^.]+$/, '');
  document.querySelectorAll('.sprite-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.sprite === filename));
}

// Event delegation for sprite picker
document.getElementById('sprite-picker').addEventListener('click', (e) => {
  const card = e.target.closest('.sprite-card');
  if (card) selectSprite(card.dataset.sprite);
});
document.getElementById('sprite-picker').addEventListener('touchend', (e) => {
  const card = e.target.closest('.sprite-card');
  if (!card) return;
  e.preventDefault();
  selectSprite(card.dataset.sprite);
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
    case 'spectate':
      myId = msg.playerId;
      isSpectating = true;
      inLobby = false;
      joinSection.style.display = 'none';
      lobbyDiv.style.display = 'none';
      gameDiv.style.display = 'grid';
      gameDiv.classList.add('spectating');
      roundEndDiv.style.display = 'none';
      resizeCanvas();
      updateSpectatorBanner(msg.queuePosition);
      break;

    case 'joined':
      myId = msg.playerId;
      myColorIndex = msg.colorIndex;
      isSpectating = false;
      gameDiv.classList.remove('spectating');
      document.getElementById('spectator-banner').style.display = 'none';
      document.querySelector('.lobby-options').style.display = '';
      startBtn.style.display = '';
      joinSection.style.display = 'none';
      lobbyInfo.style.display = 'block';
      break;

    case 'lobby':
      inLobby = true;
      stopTimer();
      if (isSpectating) {
        // Still in queue — show waiting view instead of active lobby
        gameDiv.style.display = 'none';
        lobbyDiv.style.display = 'block';
        roundEndDiv.style.display = 'none';
        updateSpectatorLobbyUI(msg);
      } else {
        lobbyDiv.style.display = 'block';
        gameDiv.style.display = 'none';
        roundEndDiv.style.display = 'none';
        updateLobbyUI(msg);
      }
      break;

    case 'gameStart':
      inLobby = false;
      lobbyDiv.style.display = 'none';
      gameDiv.style.display = 'grid';
      roundEndDiv.style.display = 'none';
      hideDiedOverlay();
      resizeCanvas();
      if (isSpectating) {
        gameDiv.classList.add('spectating');
      } else {
        gameDiv.classList.remove('spectating');
        startTimer();
      }
      break;

    case 'gameState': {
      // Grid is only sent when it changes — preserve the last known grid otherwise
      if (!msg.grid && gameState) msg.grid = gameState.grid;
      // Detect local player death
      const prevMe = gameState && myId ? gameState.players.find(p => p.id === myId) : null;
      const nextMe = myId ? msg.players.find(p => p.id === myId) : null;
      if (prevMe && prevMe.alive && nextMe && !nextMe.alive) showDiedOverlay();
      gameState = msg;
      updateScoreboard(msg.players);
      break;
    }

    case 'roundEnd':
      showRoundEnd(msg);
      break;

    case 'midgameJoin':
      // We were spectating and got promoted into the live game mid-round
      myId = msg.playerId;
      myColorIndex = msg.colorIndex;
      isSpectating = false;
      inLobby = false;
      gameDiv.classList.remove('spectating');
      document.getElementById('spectator-banner').style.display = 'none';
      gameDiv.style.display = 'grid';
      startTimer();
      break;

    case 'queueUpdate':
      // Still waiting — queue position changed (someone ahead of us left or got promoted)
      updateSpectatorBanner(msg.queuePosition);
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
function playerThumb(p) {
  return p.sprite
    ? `<img class="player-sprite-thumb" src="8%20bit%20originals/${encodeURIComponent(p.sprite)}" alt="${escapeHtml(p.name)}">`
    : `<div class="player-color" style="background:${p.color || '#888'}"></div>`;
}

function updateLobbyUI(data) {
  // Active player list — show checkmark for ready players
  playerList.innerHTML = data.players.map(p =>
    `<div class="player-tag">
      ${playerThumb(p)}
      <span>${escapeHtml(p.name)}</span>
      <span class="ready-check${p.ready ? ' ready-check-on' : ''}">✓</span>
      <span style="color:#ffd700;">${p.wins}W</span>
    </div>`
  ).join('');

  // Waiting queue
  const waitingSection = document.getElementById('waiting-queue');
  if (data.waiting && data.waiting.length > 0) {
    waitingSection.style.display = 'block';
    waitingSection.innerHTML = `<p class="waiting-label">Up next:</p>` +
      data.waiting.map((p, i) =>
        `<div class="player-tag waiting-tag">${playerThumb(p)}<span>${escapeHtml(p.name)}</span><span style="color:#aaa;">#${i + 1}</span></div>`
      ).join('');
  } else {
    waitingSection.style.display = 'none';
    waitingSection.innerHTML = '';
  }

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

  // Ready button state
  const me = data.players.find(p => p.id === myId);
  const iAmReady = me && me.ready;
  const readyCount = data.players.filter(p => p.ready).length;
  const total = data.players.length;

  if (total < 2) {
    startBtn.disabled = true;
    startBtn.textContent = 'Ready Up (need 2+ players)';
    startBtn.classList.remove('btn-ready');
  } else {
    startBtn.disabled = false;
    startBtn.textContent = iAmReady ? '✓ Ready!' : 'Ready Up';
    startBtn.classList.toggle('btn-ready', iAmReady);
  }

  // Ready count hint
  let hint = document.getElementById('ready-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'ready-hint';
    hint.className = 'waiting-label';
    startBtn.insertAdjacentElement('beforebegin', hint);
  }
  hint.textContent = total >= 2
    ? `${readyCount} / ${total} ready`
    : '';
}

// --- Died overlay ---
let diedOverlayTimeout = null;
function showDiedOverlay() {
  const el = document.getElementById('died-overlay');
  el.style.display = 'flex';
  clearTimeout(diedOverlayTimeout);
  // Fade out after 2.5s — round end will also hide it
  diedOverlayTimeout = setTimeout(() => { el.style.opacity = '0'; }, 2000);
  setTimeout(() => { el.style.display = 'none'; el.style.opacity = '1'; }, 2800);
}
function hideDiedOverlay() {
  clearTimeout(diedOverlayTimeout);
  const el = document.getElementById('died-overlay');
  el.style.display = 'none';
  el.style.opacity = '1';
}

function updateSpectatorBanner(queuePosition) {
  const banner = document.getElementById('spectator-banner');
  banner.style.display = 'block';
  banner.textContent = `👁 Watching • You're #${queuePosition} in queue`;
}

function updateSpectatorLobbyUI(data) {
  // Spectator sees a stripped-down waiting screen
  joinSection.style.display = 'none';
  lobbyInfo.style.display = 'block';
  const myPos = data.waiting ? data.waiting.findIndex(p => p.id === myId) + 1 : 0;
  playerList.innerHTML =
    `<p class="waiting-label" style="color:#ffd700;margin-bottom:8px;">You're #${myPos} in queue — you'll join next round!</p>` +
    `<p class="waiting-label">Currently playing:</p>` +
    data.players.map(p =>
      `<div class="player-tag">${playerThumb(p)}<span>${escapeHtml(p.name)}</span><span style="color:#ffd700;">${p.wins}W</span></div>`
    ).join('');

  // Hide controls spectators shouldn't see
  document.querySelector('.lobby-options').style.display = 'none';
  startBtn.style.display = 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Returns an icon badge — image if loaded, otherwise styled text span
function iconBadge(sym, cssClass, label) {
  const img = iconImages[sym];
  if (img && img.complete && img.naturalWidth > 0) {
    return `<span class="pu-badge ${cssClass}" title="${label}"><img src="${img.src}" alt="${label}" class="pu-badge-icon"></span>`;
  }
  return `<span class="pu-badge ${cssClass}" title="${label}">${label}</span>`;
}

// --- Scoreboard with powerup badges ---
function updateScoreboard(players) {
  scoreboard.innerHTML = players.map(p => {
    const isMe = p.id === myId;
    const badges = [];

    if (p.bombRange > 1)  badges.push(iconBadge('F',  'pu-fire',   `F:${p.bombRange}`));
    if (p.maxBombs > 1)   badges.push(iconBadge('B',  'pu-bomb',   `B:${p.maxBombs}`));
    if (p.speed > 1)      badges.push(iconBadge('S',  'pu-speed',  `S:${p.speed}`));
    if (p.hasRemote)      badges.push(iconBadge('RC', 'pu-remote', 'RC'));
    if (p.hasKick)        badges.push(iconBadge('K',  'pu-kick',   'K'));
    if (p.hasShield)      badges.push(iconBadge('SH', 'pu-shield', 'SH'));
    if (p.curse)          badges.push(`<span class="pu-badge pu-curse" title="Cursed">☠</span>`);

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
  hideDiedOverlay();
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
quitBtn.addEventListener('click', () => { quitModal.style.display = 'flex'; });
quitBtn.addEventListener('touchend', (e) => { e.preventDefault(); quitModal.style.display = 'flex'; }, { passive: false });

function doCancel() { quitModal.style.display = 'none'; }
function doQuit() { window.location.reload(); }

document.getElementById('quitCancel').addEventListener('click', doCancel);
document.getElementById('quitCancel').addEventListener('touchend', (e) => { e.preventDefault(); doCancel(); }, { passive: false });

document.getElementById('quitConfirm').addEventListener('click', doQuit);
document.getElementById('quitConfirm').addEventListener('touchend', (e) => { e.preventDefault(); doQuit(); }, { passive: false });

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
const kickedBombRenderPos = {}; // "x,y,dx,dy" → current client-side moveProgress
let lastRenderTime = null;

function updateRenderPositions(now) {
  if (!gameState) return;
  const dt = lastRenderTime ? (now - lastRenderTime) / 1000 : 0;
  lastRenderTime = now;

  // Interpolate player positions
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

  // Interpolate kicked bomb positions — same speed as base player (4 tiles/sec)
  const KICK_SPEED = 4;
  const activeKickedKeys = new Set();
  (gameState.kickedBombs || []).forEach(kb => {
    const key = `${kb.x},${kb.y},${kb.dx},${kb.dy}`;
    activeKickedKeys.add(key);
    if (!(key in kickedBombRenderPos)) {
      // Seed from server's authoritative progress
      kickedBombRenderPos[key] = kb.moveProgress;
    }
    // Advance client-side progress, but never exceed 1 (we don't know next tile yet)
    kickedBombRenderPos[key] = Math.min(kickedBombRenderPos[key] + KICK_SPEED * dt, 0.999);
  });
  // Clean up entries for kicked bombs that are no longer active
  for (const key of Object.keys(kickedBombRenderPos)) {
    if (!activeKickedKeys.has(key)) delete kickedBombRenderPos[key];
  }
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

  // Draw bombs — skip those being kicked (they're drawn separately at interpolated positions)
  const kickedBombPositions = new Set(
    (gameState.kickedBombs || []).map(kb => `${kb.x},${kb.y}`)
  );
  gameState.bombs.forEach(b => {
    if (kickedBombPositions.has(`${b.x},${b.y}`)) return;
    drawBomb(b.x * s, b.y * s, s, b.timer, b.remote);
  });

  // Draw kicked bombs at their smooth interpolated positions
  (gameState.kickedBombs || []).forEach(kb => {
    const key = `${kb.x},${kb.y},${kb.dx},${kb.dy}`;
    const prog = kickedBombRenderPos[key] ?? kb.moveProgress;
    const rx = kb.x + kb.dx * prog;
    const ry = kb.y + kb.dy * prog;
    drawBomb(rx * s, ry * s, s, kb.timer, kb.remote);
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

  const sym = symbols[kind];
  const img = sym ? iconImages[sym] : null;
  const pulse = 0.7 + Math.sin(Date.now() / 200) * 0.3;

  if (img && img.complete && img.naturalWidth > 0) {
    // --- Icon image ---
    const bgColor = colors[kind] || '#222';

    // Glowing tinted background
    ctx.fillStyle = kind === 'skull' ? '#2a0040' : '#222';
    ctx.fillRect(px + pad, py + pad, s - pad * 2, s - pad * 2);
    ctx.globalAlpha = pulse * 0.45;
    ctx.fillStyle = bgColor;
    ctx.fillRect(px + pad + 2, py + pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);
    ctx.globalAlpha = 1;

    // Border
    ctx.strokeStyle = kind === 'skull' ? '#ff00ff' : bgColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + pad, py + pad, s - pad * 2, s - pad * 2);

    // Draw icon image, maintaining aspect ratio, centered
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const margin = pad + 4;
    const maxW = s - margin * 2;
    const maxH = s - margin * 2;
    const aspect = img.naturalWidth / img.naturalHeight;
    let dw, dh;
    if (aspect >= 1) { dw = maxW; dh = maxW / aspect; }
    else             { dh = maxH; dw = maxH * aspect; }
    const dx = px + margin + (maxW - dw) / 2;
    const dy = py + margin + (maxH - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

  } else {
    // --- Fallback: drawn tile with text symbol ---
    ctx.fillStyle = kind === 'skull' ? '#2a0040' : '#222';
    ctx.fillRect(px + pad, py + pad, s - pad * 2, s - pad * 2);
    ctx.fillStyle = colors[kind] || '#888';
    ctx.globalAlpha = pulse;
    ctx.fillRect(px + pad + 2, py + pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = kind === 'skull' ? '#ff00ff' : '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + pad, py + pad, s - pad * 2, s - pad * 2);

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(s * 0.35)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym || '?', cx, cy);

    if (kind === 'skull') {
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, s * 0.18, 0, Math.PI * 2);
      ctx.stroke();
    }
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
  send({ type: 'ready' });
});

// Leave Lobby — disconnects and returns to the join screen
document.getElementById('leaveLobbyBtn').addEventListener('click', () => {
  window.location.reload();
});

// Start render loop
render();
