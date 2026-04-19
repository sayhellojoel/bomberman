// game.js — Bomberman client: input handling, WebSocket communication, Canvas rendering

let GRID_W = 15;
let GRID_H = 13;
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
// iconUrls: sym → URL string (available as soon as /api/icons responds — used for HTML <img> tags)
// iconImages: sym → Image object (used for canvas drawing — needs .complete check)
const iconUrls = {};
const iconImages = {};

fetch('/api/icons')
  .then(r => r.json())
  .then(map => {
    // map = { B: "B.png", SH: "SH.png", ... }
    Object.entries(map).forEach(([sym, filename]) => {
      const url = `Icons/${encodeURIComponent(filename)}`;
      iconUrls[sym] = url;   // immediately usable in HTML img tags
      const img = new Image();
      img.src = url;
      iconImages[sym] = img; // for canvas — browser loads it in background
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
      if (msg.gridW) GRID_W = msg.gridW;
      if (msg.gridH) GRID_H = msg.gridH;
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
      // Sync grid dimensions if a new grid arrived with different size
      if (msg.grid && msg.grid.length > 0) {
        const newH = msg.grid.length;
        const newW = msg.grid[0].length;
        if (newH !== GRID_H || newW !== GRID_W) {
          GRID_H = newH;
          GRID_W = newW;
          resizeCanvas();
        }
      }
      // Detect local player death
      const prevMe = gameState && myId ? gameState.players.find(p => p.id === myId) : null;
      const nextMe = myId ? msg.players.find(p => p.id === myId) : null;
      if (prevMe && prevMe.alive && nextMe && !nextMe.alive) {
        // Check if there's already a winner (last player standing)
        const alivePlayers = msg.players.filter(p => p.alive);
        const winnerName = alivePlayers.length === 1 ? alivePlayers[0].name : null;
        showDiedOverlay(winnerName);
      }
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

  // Large-map badge
  let largeMapNote = document.getElementById('large-map-note');
  if (!largeMapNote) {
    largeMapNote = document.createElement('p');
    largeMapNote.id = 'large-map-note';
    largeMapNote.className = 'large-map-note';
    mapSelect.closest('label').insertAdjacentElement('afterend', largeMapNote);
  }
  if (data.usingLargeMaps) {
    largeMapNote.textContent = '⬆ 5+ players detected — using expanded maps (23×19) with 8 spawn points';
    largeMapNote.style.display = 'block';
  } else {
    largeMapNote.style.display = 'none';
  }

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
function showDiedOverlay(winnerName) {
  const el = document.getElementById('died-overlay');
  const winnerEl = document.getElementById('died-winner');
  if (winnerName) {
    winnerEl.textContent = `🏆 ${winnerName} wins!`;
    winnerEl.style.display = 'block';
  } else {
    winnerEl.style.display = 'none';
  }
  el.style.display = 'flex';
  el.style.opacity = '1';
  clearTimeout(diedOverlayTimeout);
  // Fade out after 3s — round end will also hide it
  diedOverlayTimeout = setTimeout(() => { el.style.opacity = '0'; }, 3000);
  setTimeout(() => { el.style.display = 'none'; el.style.opacity = '1'; }, 3800);
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

// Returns an icon badge — uses URL directly so mobile browsers load it lazily without a .complete check
function iconBadge(sym, cssClass, label) {
  if (iconUrls[sym]) {
    return `<img src="${iconUrls[sym]}" alt="${label}" title="${label}" class="pu-badge-icon-standalone">`;
  }
  return `<span class="pu-badge ${cssClass}" title="${label}">${label}</span>`;
}

// --- Scoreboard with powerup badges ---
function updateScoreboard(players) {
  scoreboard.innerHTML = players.map(p => {
    const isMe = p.id === myId;
    const badges = [];

    if (p.bombRange >= 8) badges.push(iconBadge('FF', 'pu-fire',   'Full Fire'));
    else if (p.bombRange > 1) badges.push(iconBadge('F', 'pu-fire', `F:${p.bombRange}`));
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
  hideDiedOverlay(); // clear the in-game overlay — round-end handles it from here

  // If the local player died this round, show "You died!" inside the round-end overlay
  // so both messages stay visible together for the full 4-second round-end screen
  const roundEndDied = document.getElementById('roundEndDied');
  const iDied = myId && gameState && gameState.players.some(p => p.id === myId && !p.alive);
  roundEndDied.style.display = (iDied && !msg.draw) ? 'block' : 'none';

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
// touchstart fires instantly on mobile; preventDefault on it cancels the 300ms synthetic click
// so we won't double-fire. The plain click handler catches desktop mice.
function addTapHandler(el, fn) {
  el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
  el.addEventListener('click', fn);
}

function doCancel() { quitModal.style.display = 'none'; }
function doQuit() { window.location.reload(); }

addTapHandler(quitBtn, () => { quitModal.style.display = 'flex'; });
addTapHandler(document.getElementById('quitCancel'), doCancel);
addTapHandler(document.getElementById('quitConfirm'), doQuit);

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
    // --- Icon image: fill the whole tile ---
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, px, py, s, s);

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

// Virtual joystick (mobile)
(function () {
  // ── Tuning constants ─────────────────────────────────────────────────────
  const DEAD_ZONE        = 10;   // px from touch origin — no movement
  const INNER_MAX        = 32;   // px — inner zone upper boundary (single step)
  const OUTER_DELAY      = 150;  // ms before continuous movement begins in outer zone
  const MOVE_REPEAT      = 150;  // ms between repeated moves while in outer zone
  const KNOB_INNER       = 24;   // px knob offset in inner zone (visual feedback)
  const KNOB_OUTER       = 50;   // px knob offset in outer zone (visual feedback)
  // Hysteresis: tan(57°) ≈ 1.54 — perpendicular component must exceed this ratio
  // relative to the dominant component to switch axis (~12° guard past the 45° boundary).
  const HYSTERESIS_RATIO = 1.54;

  const joystickKnob = document.getElementById('joystick-knob');
  const joystickBase = document.getElementById('joystick-base');

  // ── State ─────────────────────────────────────────────────────────────────
  let touchActive      = false;
  let originX          = 0;
  let originY          = 0;
  let joyZone          = 'dead'; // 'dead' | 'inner' | 'outer'
  let joyDir           = null;   // 'up' | 'down' | 'left' | 'right' | null
  let innerStepFired   = false;
  let outerDelayTimer  = null;
  let outerRepeatTimer = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Snap analog displacement to the nearest cardinal direction (no hysteresis).
  function snap4(dx, dy) {
    return Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down'  : 'up');
  }

  // Snap with hysteresis: given a current direction, only switch axis when the
  // perpendicular component clearly dominates by HYSTERESIS_RATIO. This prevents
  // flickering when the thumb sits near a 45-degree boundary.
  function snap4Hysteresis(dx, dy, current) {
    if (!current) return snap4(dx, dy);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (current === 'left' || current === 'right') {
      if (ay > ax * HYSTERESIS_RATIO) return dy > 0 ? 'down' : 'up';
      return dx > 0 ? 'right' : 'left';
    } else {
      if (ax > ay * HYSTERESIS_RATIO) return dx > 0 ? 'right' : 'left';
      return dy > 0 ? 'down' : 'up';
    }
  }

  function clearOuterTimers() {
    clearTimeout(outerDelayTimer);
    clearInterval(outerRepeatTimer);
    outerDelayTimer  = null;
    outerRepeatTimer = null;
  }

  // Begin repeating moves at MOVE_REPEAT interval (called after OUTER_DELAY).
  // Reads joyDir at each tick so mid-interval direction changes are always sent
  // in the current direction rather than the direction at timer creation time.
  function startContinuous() {
    clearInterval(outerRepeatTimer);
    outerRepeatTimer = setInterval(() => {
      if (joyZone === 'outer' && joyDir) {
        send({ type: 'input', action: 'move', dir: joyDir });
      }
    }, MOVE_REPEAT);
  }

  // Move knob visually and update data attributes for CSS zone colouring.
  function updateKnob(dir, zone) {
    if (!joystickKnob || !joystickBase) return;
    let x = 0;
    let y = 0;
    const off = zone === 'inner' ? KNOB_INNER : zone === 'outer' ? KNOB_OUTER : 0;
    if      (dir === 'up')    y = -off;
    else if (dir === 'down')  y =  off;
    else if (dir === 'left')  x = -off;
    else if (dir === 'right') x =  off;
    joystickKnob.style.setProperty('--jx', x + 'px');
    joystickKnob.style.setProperty('--jy', y + 'px');
    joystickBase.dataset.zone = zone;
    joystickBase.dataset.dir  = dir || '';
  }

  // Reset everything to neutral.
  function resetJoystick() {
    clearOuterTimers();
    joyZone        = 'dead';
    joyDir         = null;
    innerStepFired = false;
    updateKnob(null, 'dead');
  }

  // ── Core input processing ─────────────────────────────────────────────────
  function processTouch(clientX, clientY) {
    const dx   = clientX - originX;
    const dy   = clientY - originY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Dead zone — finger drift shouldn't trigger movement.
    if (dist < DEAD_ZONE) {
      if (joyZone !== 'dead') resetJoystick();
      return;
    }

    // Snap to one of 4 cardinal directions, with hysteresis to prevent flicker.
    const newDir     = snap4Hysteresis(dx, dy, joyDir);
    const dirChanged = (newDir !== joyDir);

    if (dirChanged) {
      // Direction changed: cancel running timers but keep the zone so that
      // outer-zone movement restarts in the new direction immediately rather
      // than requiring the thumb to return to neutral first.
      clearOuterTimers();
      innerStepFired = false;
      joyDir = newDir;
    }

    if (dist < INNER_MAX) {
      // ── Inner zone: fire exactly one step per direction engagement ────────
      if (joyZone === 'outer') clearOuterTimers();
      joyZone = 'inner';
      if (!innerStepFired) {
        send({ type: 'input', action: 'move', dir: joyDir });
        innerStepFired = true;
      }
      updateKnob(joyDir, 'inner');
    } else {
      // ── Outer zone: continuous movement after OUTER_DELAY ─────────────────
      //
      // Trigger on first entry into outer zone, OR on any direction change
      // while already in outer zone — both cases need a fresh step + delay
      // so the new direction starts cleanly without returning to neutral.
      if (joyZone !== 'outer' || dirChanged) {
        joyZone = 'outer';
        // Fire one immediate step for the new direction (unless inner zone
        // already fired it — handles fingers that skip straight past inner).
        if (!innerStepFired) {
          send({ type: 'input', action: 'move', dir: joyDir });
          innerStepFired = true;
        }
        // Guard delay before continuous movement begins.
        outerDelayTimer = setTimeout(startContinuous, OUTER_DELAY);
      }
      updateKnob(joyDir, 'outer');
    }
  }

  // ── Touch event handlers ──────────────────────────────────────────────────

  // Each new touch sets its own origin — "floating neutral" behaviour.
  function onTouchStart(e) {
    if (inLobby) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    touchActive = true;
    originX = t.clientX;
    originY = t.clientY;
    resetJoystick();
  }

  function onTouchMove(e) {
    if (!touchActive || inLobby) return;
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    processTouch(t.clientX, t.clientY);
  }

  function onTouchEnd(e) {
    if (!touchActive) return;
    e.preventDefault();
    touchActive = false;
    resetJoystick();
  }

  ctrlDpad.addEventListener('touchstart',  onTouchStart, { passive: false });
  ctrlDpad.addEventListener('touchmove',   onTouchMove,  { passive: false });
  ctrlDpad.addEventListener('touchend',    onTouchEnd,   { passive: false });
  ctrlDpad.addEventListener('touchcancel', onTouchEnd,   { passive: false });
}());

// Bomb button: touchstart for instant response; touchend as fallback if touchstart was swallowed
let _bombTouchStartFired = false;
const bombBtnEl = document.getElementById('bombBtn');
bombBtnEl.addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  _bombTouchStartFired = true;
  send({ type: 'input', action: 'bomb' });
}, { passive: false });
bombBtnEl.addEventListener('touchend', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!_bombTouchStartFired) {
    // touchstart was swallowed by something — fire now instead
    send({ type: 'input', action: 'bomb' });
  }
  _bombTouchStartFired = false;
}, { passive: false });
// Also handle click for desktop testing
bombBtnEl.addEventListener('click', () => {
  if (!('ontouchstart' in window)) send({ type: 'input', action: 'bomb' });
});

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
