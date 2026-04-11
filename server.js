// server.js — Authoritative Bomberman game server
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const maps = require('./maps');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const GRID_W = 15;
const GRID_H = 13;

// Spawn positions (grid coords) for up to 4 players — corners
const SPAWNS = [
  { x: 1, y: 1 },
  { x: 13, y: 1 },
  { x: 1, y: 11 },
  { x: 13, y: 11 }
];

// Player colors
const COLORS = ['#FFFFFF', '#222222', '#FF3333', '#3399FF'];
const COLOR_NAMES = ['White', 'Black', 'Red', 'Blue'];

// Safe zone offsets from each spawn corner (L-shape: 3 tiles horiz + 3 tiles vert)
function getSafeZoneTiles(spawn) {
  const tiles = [];
  const dx = spawn.x === 1 ? 1 : -1;
  const dy = spawn.y === 1 ? 1 : -1;
  // Horizontal arm
  for (let i = 0; i < 3; i++) tiles.push({ x: spawn.x + dx * i, y: spawn.y });
  // Vertical arm (skip corner, already added)
  for (let i = 1; i < 3; i++) tiles.push({ x: spawn.x, y: spawn.y + dy * i });
  return tiles;
}

// --- Game State ---
let lobby = true;
let players = {};
let playerOrder = [];
let grid = [];
let bombs = [];
let explosions = [];
let powerups = [];
let kickedBombs = [];
let roundTimer = null;
let roundEndTimer = null;
let selectedMap = 0;
let itemDropRate = 0.3;
let gameLoopInterval = null;
let lastTick = Date.now();
let ticksSinceBroadcast = 0;
const BROADCAST_EVERY = 3; // broadcast at 20Hz (every 3rd tick of 60Hz loop)
let gridDirty = true; // send grid on first broadcast and whenever a block is destroyed

// Stats persist across rounds
let stats = {};

// Maps deviceId → playerId to prevent same device joining twice
let deviceIdMap = {};

// Players waiting to join the next round (joined mid-game)
let waitingPlayers = {}; // id → { name, sprite, deviceId, ws }
let waitingOrder = [];

// --- HTTP Server ---
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const SPRITES_DIR = path.join(__dirname, 'public', '8 bit originals');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function getAvailableSprites() {
  try {
    return fs.readdirSync(SPRITES_DIR).filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
  } catch (e) {
    return [];
  }
}

const server = http.createServer((req, res) => {
  // Decode URL so paths with spaces (e.g. "8 bit originals") resolve correctly
  const decodedUrl = decodeURIComponent(req.url.split('?')[0]);

  // API: list available sprites
  if (decodedUrl === '/api/sprites') {
    const sprites = getAvailableSprites();
    res.writeHead(200, { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' });
    res.end(JSON.stringify(sprites));
    return;
  }

  let filePath = path.join(__dirname, 'public', decodedUrl === '/' ? 'index.html' : decodedUrl);
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'ngrok-skip-browser-warning': 'true' });
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType, 'ngrok-skip-browser-warning': 'true' });
      res.end(data);
    }
  });
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      try { client.send(data); } catch (e) { /* ignore dead socket */ }
    }
  });
}

function broadcastLobbyState() {
  const playerList = playerOrder.map(id => ({
    id, name: players[id].name, color: players[id].color, colorName: COLOR_NAMES[players[id].colorIndex],
    sprite: players[id].sprite || null,
    wins: stats[id] ? stats[id].wins : 0, score: stats[id] ? stats[id].score : 0
  }));
  const waitingList = waitingOrder.map(id => ({
    id, name: waitingPlayers[id].name, sprite: waitingPlayers[id].sprite || null
  }));
  const msg = JSON.stringify({
    type: 'lobby',
    players: playerList,
    waiting: waitingList,
    maps: maps.map((m, i) => ({ index: i, name: m.name, description: m.description })),
    selectedMap,
    itemDropRate: Math.round(itemDropRate * 100)
  });
  // Send lobby state to lobby players and waiting spectators — NOT to active game players
  wss.clients.forEach(client => {
    if (client.readyState !== 1) return;
    // Find which player this WS belongs to
    const activeId = playerOrder.find(id => players[id].ws === client);
    const waitingId = waitingOrder.find(id => waitingPlayers[id].ws === client);
    if (activeId && !lobby) return; // don't interrupt active game players
    try { client.send(msg); } catch (e) {}
  });
}

function getGameState() {
  const playerList = playerOrder.map(id => {
    const p = players[id];
    return {
      id, name: p.name, color: p.color, colorName: COLOR_NAMES[p.colorIndex],
      sprite: p.sprite || null,
      x: p.x, y: p.y, alive: p.alive,
      moving: p.moving, targetX: p.targetX, targetY: p.targetY, moveProgress: p.moveProgress,
      bombRange: p.bombRange, maxBombs: p.maxBombs, speed: p.speed,
      hasRemote: p.hasRemote, hasKick: p.hasKick, hasShield: p.hasShield,
      curse: p.curse, curseTimer: p.curseTimer,
      wins: stats[id] ? stats[id].wins : 0, score: stats[id] ? stats[id].score : 0,
      invincibleTimer: p.invincibleTimer
    };
  });
  const state = {
    type: 'gameState',
    players: playerList,
    bombs: bombs.map(b => ({ x: b.x, y: b.y, owner: b.owner, timer: b.timer, remote: b.remote })),
    explosions: explosions.map(e => ({ x: e.x, y: e.y, timer: e.timer })),
    powerups: powerups.map(p => ({ x: p.x, y: p.y, kind: p.kind })),
    kickedBombs: kickedBombs.map(b => ({ x: b.x, y: b.y, dx: b.dx, dy: b.dy }))
  };
  // Only include grid when it has changed (saves ~1KB per broadcast)
  if (gridDirty) {
    state.grid = grid;
    gridDirty = false;
  }
  return state;
}

// --- Map Generation ---
function generateGrid(mapIndex) {
  const mapDef = maps[mapIndex];
  const newGrid = [];
  const safeSet = new Set();
  SPAWNS.forEach(s => {
    getSafeZoneTiles(s).forEach(t => safeSet.add(`${t.x},${t.y}`));
  });

  for (let y = 0; y < GRID_H; y++) {
    const row = mapDef.layout[y].split(' ');
    const gridRow = [];
    for (let x = 0; x < GRID_W; x++) {
      const tile = row[x];
      if (tile === 'W') {
        gridRow.push('W');
      } else if (tile === 'S') {
        if (safeSet.has(`${x},${y}`)) {
          gridRow.push('_');
        } else {
          // 70% chance to become a soft block
          gridRow.push(Math.random() < 0.7 ? 'B' : '_');
        }
      } else {
        gridRow.push('_');
      }
    }
    newGrid.push(gridRow);
  }
  return newGrid;
}

// --- Power-up Types ---
const POWERUP_TYPES = ['fireUp', 'bombUp', 'speedUp', 'fullFire', 'remote', 'kick', 'skull', 'shield'];
const POWERUP_WEIGHTS = [25, 25, 15, 5, 10, 10, 7, 3]; // weighted random

function randomPowerup() {
  const totalWeight = POWERUP_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < POWERUP_TYPES.length; i++) {
    r -= POWERUP_WEIGHTS[i];
    if (r <= 0) return POWERUP_TYPES[i];
  }
  return POWERUP_TYPES[0];
}

// --- Curse Effects ---
const CURSE_TYPES = ['reversed', 'autoSpeed', 'rangeDown', 'autoBomb'];

function applyRandomCurse(player) {
  player.curse = CURSE_TYPES[Math.floor(Math.random() * CURSE_TYPES.length)];
  player.curseTimer = 10; // seconds
}

// --- Start Game ---
function startGame() {
  lobby = false;
  grid = generateGrid(selectedMap);
  gridDirty = true;
  bombs = [];
  explosions = [];
  powerups = [];
  kickedBombs = [];

  // Reset players for new round
  let i = 0;
  playerOrder.forEach(id => {
    const p = players[id];
    const spawn = SPAWNS[i];
    p.x = spawn.x;
    p.y = spawn.y;
    p.alive = true;
    p.bombRange = 1;
    p.maxBombs = 1;
    p.activeBombs = 0;
    p.speed = 1;
    p.hasRemote = false;
    p.hasKick = false;
    p.hasShield = false;
    p.curse = null;
    p.curseTimer = 0;
    p.invincibleTimer = 0.5; // 0.5s spawn invincibility
    p.moveProgress = 0;
    p.moving = false;
    p.moveDir = null;
    p.inputQueue = [];
    p.autoBombCooldown = 0;
    i++;
  });

  broadcast({ type: 'gameStart', map: maps[selectedMap].name });
  lastTick = Date.now();
  if (gameLoopInterval) clearInterval(gameLoopInterval);
  gameLoopInterval = setInterval(gameTick, TICK_MS);
}

// --- Game Tick ---
function gameTick() {
  try {
    gameTickInner();
  } catch (err) {
    console.error('[gameTick crash]', err);
  }
}

function gameTickInner() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  if (lobby) return;

  // Update players
  playerOrder.forEach(id => {
    const p = players[id];
    if (!p.alive) return;

    // Invincibility timer
    if (p.invincibleTimer > 0) p.invincibleTimer -= dt;

    // Curse timer
    if (p.curse) {
      p.curseTimer -= dt;
      if (p.curseTimer <= 0) {
        p.curse = null;
        p.curseTimer = 0;
      }
    }

    // Auto-bomb curse
    if (p.curse === 'autoBomb') {
      p.autoBombCooldown -= dt;
      if (p.autoBombCooldown <= 0) {
        placeBomb(id);
        p.autoBombCooldown = 0.5;
      }
    }

    // Auto-speed curse — force movement in random direction
    if (p.curse === 'autoSpeed' && !p.moving) {
      const dirs = ['up', 'down', 'left', 'right'];
      p.inputQueue = [{ action: 'move', dir: dirs[Math.floor(Math.random() * 4)] }];
    }

    // Process movement
    if (p.moving) {
      const baseSpeed = 4 + (p.speed - 1) * 1.2; // tiles per second
      const speed = p.curse === 'autoSpeed' ? baseSpeed * 1.8 : baseSpeed;
      p.moveProgress += speed * dt;
      if (p.moveProgress >= 1) {
        p.moveProgress = 0;
        p.moving = false;
        // Snap to target
        p.x = p.targetX;
        p.y = p.targetY;

        // Check powerup pickup
        checkPowerupPickup(id);

        // Check curse passing (touching another player)
        if (p.curse) {
          playerOrder.forEach(otherId => {
            if (otherId !== id && players[otherId].alive && players[otherId].x === p.x && players[otherId].y === p.y) {
              // Pass curse
              players[otherId].curse = p.curse;
              players[otherId].curseTimer = p.curseTimer;
              p.curse = null;
              p.curseTimer = 0;
            }
          });
        }
      }
    }

    // Process input queue
    if (!p.moving && p.inputQueue.length > 0) {
      const input = p.inputQueue.shift();
      if (input.action === 'move') {
        let dir = input.dir;
        // Reversed curse
        if (p.curse === 'reversed') {
          const reverseMap = { up: 'down', down: 'up', left: 'right', right: 'left' };
          dir = reverseMap[dir];
        }
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        const nx = p.x + dx;
        const ny = p.y + dy;

        if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
          const tile = grid[ny][nx];
          const hasBomb = bombs.some(b => b.x === nx && b.y === ny);

          if (tile !== 'W' && tile !== 'B') {
            if (hasBomb) {
              if (p.hasKick) {
                // Kick the bomb
                const bomb = bombs.find(b => b.x === nx && b.y === ny);
                if (bomb && !kickedBombs.some(kb => kb.bomb === bomb)) {
                  kickedBombs.push({ bomb, dx, dy, x: bomb.x, y: bomb.y });
                }
              }
              // Can't walk into bomb tile (unless it's the one you're standing on — handled by placement)
            } else {
              // Check if another player blocks (players can't walk through each other)
              const blocked = playerOrder.some(oid => {
                if (oid === id) return false;
                const op = players[oid];
                return op.alive && op.x === nx && op.y === ny && !op.moving;
              });
              if (!blocked) {
                p.moving = true;
                p.moveDir = dir;
                p.targetX = nx;
                p.targetY = ny;
                p.moveProgress = 0;
              }
            }
          }
        }
      } else if (input.action === 'bomb') {
        if (p.hasRemote) {
          // If already have active bombs, detonate them
          const myBombs = bombs.filter(b => b.owner === id);
          if (myBombs.length > 0) {
            myBombs.forEach(b => { b.timer = 0; });
          } else {
            placeBomb(id);
          }
        } else {
          placeBomb(id);
        }
      }
    }
  });

  // Update kicked bombs
  for (let i = kickedBombs.length - 1; i >= 0; i--) {
    const kb = kickedBombs[i];
    const nx = kb.bomb.x + kb.dx;
    const ny = kb.bomb.y + kb.dy;

    if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H ||
        grid[ny][nx] === 'W' || grid[ny][nx] === 'B' ||
        bombs.some(b => b !== kb.bomb && b.x === nx && b.y === ny)) {
      // Stop
      kickedBombs.splice(i, 1);
    } else {
      kb.bomb.x = nx;
      kb.bomb.y = ny;
    }
  }

  // Update bomb timers
  bombs.forEach(b => { if (!b.remote) b.timer -= dt; });

  // Explode expired bombs — use find-loop so chain explosions can't corrupt indices
  let guard = 0;
  while (guard++ < 300) {
    const idx = bombs.findIndex(b => b.timer <= 0);
    if (idx === -1) break;
    explodeBomb(idx);
  }

  // Update explosions
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].timer -= dt;
    if (explosions[i].timer <= 0) {
      explosions.splice(i, 1);
    }
  }

  // Check for explosion hits on players
  playerOrder.forEach(id => {
    const p = players[id];
    if (!p.alive || p.invincibleTimer > 0) return;
    const px = p.moving ? Math.round(p.x + (p.targetX - p.x) * p.moveProgress) : p.x;
    const py = p.moving ? Math.round(p.y + (p.targetY - p.y) * p.moveProgress) : p.y;
    if (explosions.some(e => e.x === px && e.y === py)) {
      if (p.hasShield) {
        p.hasShield = false; // Shield absorbs hit
      } else {
        p.alive = false;
      }
    }
  });

  // Check round end
  const alivePlayers = playerOrder.filter(id => players[id].alive);
  if (alivePlayers.length <= 1 && !roundEndTimer) {
    // Small delay to let simultaneous explosions resolve
    roundEndTimer = setTimeout(() => {
      endRound();
    }, 100);
  }

  // Broadcast at 20Hz (every 3rd tick) — client interpolation fills the gaps
  ticksSinceBroadcast++;
  if (ticksSinceBroadcast >= BROADCAST_EVERY) {
    ticksSinceBroadcast = 0;
    broadcast(getGameState());
  }
}

function placeBomb(playerId) {
  const p = players[playerId];
  if (!p.alive) return;
  const myBombs = bombs.filter(b => b.owner === playerId);
  if (myBombs.length >= p.maxBombs) return;
  // Don't place if bomb already at this tile
  if (bombs.some(b => b.x === p.x && b.y === p.y)) return;

  const range = p.curse === 'rangeDown' ? 1 : p.bombRange;
  bombs.push({
    x: p.x, y: p.y, owner: playerId,
    timer: 3, range, remote: p.hasRemote
  });
}

function explodeBomb(index) {
  const bomb = bombs[index];
  bombs.splice(index, 1);

  // Remove from kicked list if present
  const ki = kickedBombs.findIndex(kb => kb.bomb === bomb);
  if (ki !== -1) kickedBombs.splice(ki, 1);

  const range = bomb.range;
  // Center tile
  addExplosion(bomb.x, bomb.y);

  // Four directions
  const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
  dirs.forEach(d => {
    for (let i = 1; i <= range; i++) {
      const ex = bomb.x + d.dx * i;
      const ey = bomb.y + d.dy * i;
      if (ex < 0 || ex >= GRID_W || ey < 0 || ey >= GRID_H) break;
      if (grid[ey][ex] === 'W') break;
      if (grid[ey][ex] === 'B') {
        // Destroy soft block
        grid[ey][ex] = '_';
        gridDirty = true;
        addExplosion(ex, ey);
        // Chance to spawn power-up
        if (Math.random() < itemDropRate) {
          powerups.push({ x: ex, y: ey, kind: randomPowerup() });
        }
        break; // Explosion stops at soft block
      }
      addExplosion(ex, ey);

      // Chain-detonate other bombs
      const chainIdx = bombs.findIndex(b => b.x === ex && b.y === ey);
      if (chainIdx !== -1) {
        explodeBomb(chainIdx);
      }
    }
  });
}

function addExplosion(x, y) {
  // Remove powerup at this tile if any
  const pi = powerups.findIndex(p => p.x === x && p.y === y);
  if (pi !== -1) powerups.splice(pi, 1);
  // Don't duplicate explosion at same tile
  if (!explosions.some(e => e.x === x && e.y === y)) {
    explosions.push({ x, y, timer: 0.5 });
  }
}

function checkPowerupPickup(playerId) {
  const p = players[playerId];
  const pi = powerups.findIndex(pu => pu.x === p.x && pu.y === p.y);
  if (pi === -1) return;
  const pu = powerups[pi];
  powerups.splice(pi, 1);

  switch (pu.kind) {
    case 'fireUp': p.bombRange++; break;
    case 'bombUp': p.maxBombs++; break;
    case 'speedUp': if (p.speed < 4) p.speed++; break;
    case 'fullFire': p.bombRange = 8; break;
    case 'remote': p.hasRemote = !p.hasRemote; break; // toggles
    case 'kick': p.hasKick = true; break;
    case 'skull': applyRandomCurse(p); break;
    case 'shield': p.hasShield = true; break;
  }
}

function endRound() {
  if (gameLoopInterval) clearInterval(gameLoopInterval);
  gameLoopInterval = null;

  const alivePlayers = playerOrder.filter(id => players[id].alive);
  let winner = null;
  let draw = false;

  if (alivePlayers.length === 1) {
    winner = alivePlayers[0];
    if (!stats[winner]) stats[winner] = { wins: 0, score: 0 };
    stats[winner].wins++;
    stats[winner].score++;
  } else {
    draw = true;
  }

  broadcast({
    type: 'roundEnd',
    winner: winner ? { id: winner, name: players[winner].name, color: players[winner].color } : null,
    draw
  });

  // Return to lobby after 4 seconds, promoting waiting players
  setTimeout(() => {
    lobby = true;
    roundEndTimer = null;

    // Promote waiting players into empty active slots (up to 4 total)
    while (waitingOrder.length > 0 && playerOrder.length < 4) {
      const wId = waitingOrder.shift();
      const wp = waitingPlayers[wId];
      const colorIndex = playerOrder.length;
      players[wId] = {
        name: wp.name, color: COLORS[colorIndex], colorIndex,
        sprite: wp.sprite, deviceId: wp.deviceId, ws: wp.ws,
        x: 0, y: 0, alive: true,
        bombRange: 1, maxBombs: 1, activeBombs: 0, speed: 1,
        hasRemote: false, hasKick: false, hasShield: false,
        curse: null, curseTimer: 0, invincibleTimer: 0,
        moveProgress: 0, moving: false, moveDir: null, targetX: 0, targetY: 0,
        inputQueue: [], autoBombCooldown: 0
      };
      playerOrder.push(wId);
      if (!stats[wId]) stats[wId] = { wins: 0, score: 0 };
      delete waitingPlayers[wId];
      // Tell the promoted player they are now active
      try { wp.ws.send(JSON.stringify({ type: 'joined', playerId: wId, colorIndex })); } catch (e) {}
    }

    broadcastLobbyState();
  }, 4000);
}

// --- WebSocket Handlers ---
wss.on('connection', (ws) => {
  let playerId = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'join') {
      // Prevent same device joining twice (check both active and waiting)
      if (msg.deviceId && deviceIdMap[msg.deviceId]) {
        const existingId = deviceIdMap[msg.deviceId];
        const existingPlayer = players[existingId] || waitingPlayers[existingId];
        const existingWsAlive = existingPlayer && existingPlayer.ws && existingPlayer.ws.readyState === 1;
        if (existingWsAlive) {
          ws.send(JSON.stringify({ type: 'error', message: 'This device is already in the game.' }));
          return;
        } else {
          delete deviceIdMap[msg.deviceId];
          if (players[existingId]) {
            playerOrder.splice(playerOrder.indexOf(existingId), 1);
            delete players[existingId];
          } else if (waitingPlayers[existingId]) {
            waitingOrder.splice(waitingOrder.indexOf(existingId), 1);
            delete waitingPlayers[existingId];
          }
        }
      }

      const validSprites = getAvailableSprites();
      const sprite = validSprites.includes(msg.sprite) ? msg.sprite : (validSprites[0] || 'Adam.png');
      const name = msg.name || 'Player';
      playerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (msg.deviceId) deviceIdMap[msg.deviceId] = playerId;

      if (!lobby) {
        // Game in progress — add to waiting queue as a spectator
        waitingPlayers[playerId] = { name, sprite, deviceId: msg.deviceId || null, ws };
        waitingOrder.push(playerId);
        if (!stats[playerId]) stats[playerId] = { wins: 0, score: 0 };
        const queuePosition = waitingOrder.length;
        ws.send(JSON.stringify({ type: 'spectate', playerId, queuePosition }));
        broadcastLobbyState(); // notify everyone of the new spectator in queue
        return;
      }

      // Normal lobby join
      if (playerOrder.length >= 4) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game is full (max 4 players)' }));
        return;
      }
      const colorIndex = playerOrder.length;
      players[playerId] = {
        name, color: COLORS[colorIndex], colorIndex, sprite,
        deviceId: msg.deviceId || null, ws,
        x: 0, y: 0, alive: true,
        bombRange: 1, maxBombs: 1, activeBombs: 0, speed: 1,
        hasRemote: false, hasKick: false, hasShield: false,
        curse: null, curseTimer: 0, invincibleTimer: 0,
        moveProgress: 0, moving: false, moveDir: null, targetX: 0, targetY: 0,
        inputQueue: [], autoBombCooldown: 0
      };
      playerOrder.push(playerId);
      if (!stats[playerId]) stats[playerId] = { wins: 0, score: 0 };
      ws.send(JSON.stringify({ type: 'joined', playerId, colorIndex }));
      broadcastLobbyState();
    }

    if (msg.type === 'selectMap') {
      if (msg.index >= 0 && msg.index < maps.length) {
        selectedMap = msg.index;
        broadcastLobbyState();
      }
    }

    if (msg.type === 'setDropRate') {
      const rate = parseInt(msg.rate);
      if (rate >= 0 && rate <= 100) {
        itemDropRate = rate / 100;
        broadcastLobbyState();
      }
    }

    if (msg.type === 'startGame') {
      if (lobby && playerOrder.length >= 2) {
        startGame();
      }
    }

    // In-game inputs
    if (msg.type === 'input' && playerId && players[playerId] && !lobby) {
      const p = players[playerId];
      if (!p.alive) return;
      if (msg.action === 'move') {
        // Only queue if not already queued
        if (p.inputQueue.length < 2) {
          p.inputQueue.push({ action: 'move', dir: msg.dir });
        }
      } else if (msg.action === 'bomb') {
        p.inputQueue.push({ action: 'bomb' });
      }
    }
  });

  ws.on('close', () => {
    if (!playerId) return;

    if (waitingPlayers[playerId]) {
      // Waiting spectator disconnected
      const deviceId = waitingPlayers[playerId].deviceId;
      if (deviceId) delete deviceIdMap[deviceId];
      waitingOrder.splice(waitingOrder.indexOf(playerId), 1);
      delete waitingPlayers[playerId];
      broadcastLobbyState();
      return;
    }

    if (players[playerId]) {
      const deviceId = players[playerId].deviceId;
      if (deviceId) delete deviceIdMap[deviceId];
      players[playerId].alive = false;
      const idx = playerOrder.indexOf(playerId);
      if (idx !== -1) playerOrder.splice(idx, 1);
      delete players[playerId];

      const nobodyLeft = playerOrder.length === 0 && waitingOrder.length === 0;
      if (nobodyLeft) {
        // Full reset
        lobby = true;
        if (gameLoopInterval) clearInterval(gameLoopInterval);
        gameLoopInterval = null;
        stats = {};
        deviceIdMap = {};
        waitingPlayers = {};
        waitingOrder = [];
        roundEndTimer = null;
        return;
      }

      if (!lobby && playerOrder.length === 0 && !roundEndTimer) {
        // All active players left mid-game — end round to promote waiters
        roundEndTimer = setTimeout(endRound, 500);
        return;
      }

      broadcastLobbyState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bomberman server running on http://localhost:${PORT}`);
  // Show local IPs
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  LAN: http://${net.address}:${PORT}`);
      }
    }
  }
});
