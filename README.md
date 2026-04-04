# Bomberman

A Super Bomberman (SNES) inspired networked multiplayer game built with Node.js and HTML5 Canvas. Supports 2-4 players over local network or internet via ngrok. Installable as a PWA on mobile devices.

## Installation

```bash
npm install
```

## Running

```bash
npm start
```

The server starts on port 3000.

## Local Play

1. Start the server with `npm start`
2. Find your local IP — it's printed in the console on startup (e.g. `192.168.1.42`)
3. Share `http://YOUR_LOCAL_IP:3000` with other players on the same network
4. Each player opens the URL in their browser, enters a name, and joins the lobby

## Internet Play via ngrok

1. Install ngrok: https://ngrok.com/download
2. Start the game server: `npm start`
3. In another terminal: `ngrok http 3000`
4. Share the resulting `https://xxxx.ngrok-free.app` URL with players
5. Players open the URL in any browser — no config needed, WebSocket URL auto-detects

## How to Play

### Controls

**Desktop:**
- Arrow keys or WASD to move
- Space to place bomb (or detonate if you have Remote Control)

**Mobile:**
- On-screen D-pad to move
- BOMB button to place/detonate bombs

### Power-ups

Power-ups are hidden under soft blocks. When destroyed, blocks have a configurable chance to reveal one:

| Power-up | Symbol | Effect |
|----------|--------|--------|
| Fire Up | F | +1 explosion range |
| Bomb Up | B | +1 max active bombs |
| Speed Up | S | Slightly faster movement (max 3 stacks) |
| Full Fire | FF | Explosion range set to maximum (8 tiles) |
| Remote Control | RC | Bombs don't auto-explode; press Space to detonate all your bombs. Picking up a second RC toggles it off |
| Kick | K | Walk into a bomb to kick it — it slides until hitting a wall or bomb |
| Skull | SK | Curse! Random negative effect for 10 seconds (see below) |
| 1-Up Shield | SH | Absorbs one explosion hit. Only one shield at a time |

### Skull Curse Effects

The Skull applies one random curse for 10 seconds:
- **Reversed Controls** — directions are swapped
- **Auto Speed** — your character moves uncontrollably in random directions
- **Range Down** — explosion range forced to 1
- **Auto Bomb** — you automatically place bombs constantly

**Passing the curse:** Walk into another player while cursed to transfer the curse to them!

### Round Rules

- One hit = eliminated (no extra lives)
- Last player standing wins the round and earns 1 point
- If all remaining players die simultaneously, the round is a draw (no points)
- After each round, a 4-second results screen shows, then back to the lobby
- Stats (wins and score) persist across rounds until everyone disconnects

## Lobby Options

- **Map Select** — Choose from 6 pre-designed maps with different play styles
- **Item Drop Rate** — Slider (0-100%) controls how often destroyed blocks reveal power-ups (default 30%)
- Any player can start the game once 2+ players have joined

## Maps

| Map | Description |
|-----|-------------|
| Classic | Standard Bomberman checkerboard walls |
| Maze | Dense walls creating narrow corridors |
| Open Field | Few walls, wide open, lots of soft blocks |
| Fortress | Castle-like rooms and chokepoints |
| Chaos | Asymmetric, unpredictable layout |
| Island | Walled edges, open center |

## Adding New Maps

Edit `maps.js` and add a new entry to the array:

```javascript
{
  name: "My Map",
  description: "A short description",
  layout: [
    "W W W W W W W W W W W W W W W",
    "W _ _ S S S S S S S S S _ _ W",
    // ... 13 rows total, 15 columns each
    "W W W W W W W W W W W W W W W"
  ]
}
```

- `W` = indestructible wall
- `S` = soft block placeholder (randomly filled/cleared each round)
- `_` = guaranteed open floor

The four corners must remain accessible (safe zones are enforced automatically around spawn points).
