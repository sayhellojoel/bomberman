Build a networked multiplayer Bomberman-style game using Node.js and the browser Canvas API, inspired by Super Bomberman (SNES). The project should support both local network and internet play via ngrok, and run as a PWA on mobile devices.

---

## Project Structure
- `server.js` — Node.js WebSocket server (use the `ws` package)
- `public/index.html` — Game client, PWA-ready with a web app manifest and mobile viewport meta tag
- `public/game.js` — All client-side game logic
- `public/style.css` — Styling, including mobile-friendly layout
- `public/manifest.json` — PWA manifest (name, icons, display: standalone)
- `public/sw.js` — Basic service worker for PWA installability
- `maps.js` — A separate module containing all pre-designed map layouts, imported by server.js
- `package.json` — With a start script (`npm start`)

---

## Networking
- The server is the single authoritative source of truth for all game state
- Clients send inputs to the server (move, place bomb, detonate); server updates state and broadcasts to all clients
- Use WebSockets (`ws` library) for real-time communication
- Support 2–4 players connecting via local network OR the internet via ngrok
- The WebSocket client must use `window.location.host` to build the WebSocket URL so it works identically on local IP or ngrok URL with no code changes
- Server runs on port 3000

---

## Lobby
- Players enter a name on the lobby screen
- The lobby shows all currently connected players with their assigned colors
- A dropdown lets any player select the map for the next round (from the pre-designed map list — see Maps section)
- A slider controls item drop probability (default 30%, range 0–100%)
- A "Start Game" button is visible to all players; any player can press it once at least 2 players are connected
- The selected map name, item drop probability, and all player names are sent to the server when the game starts

---

## Maps
- The game includes at least 6 hand-designed named map layouts selectable from the lobby
- Each map is defined as a 15×13 grid of tile types: `W` (indestructible wall), `S` (soft block placeholder), `_` (open floor)
- On game start, the server takes the selected map layout and randomly fills all `S` placeholder tiles — each has a chance of becoming a soft block or open floor, creating variety each round on the same map
- The `S` tiles near each player's spawn corner (see Safe Zones) are always forced to open floor regardless of the map layout
- Map designs should vary meaningfully in character:
  - **Classic** — standard Bomberman checkerboard of indestructible walls, moderate soft block density
  - **Maze** — dense indestructible wall layout creating narrow corridors
  - **Open Field** — very few indestructible walls, wide open spaces, high soft block density
  - **Fortress** — indestructible walls forming castle-like rooms and chokepoints
  - **Chaos** — asymmetric, unpredictable indestructible wall layout
  - **Island** — indestructible walls around the edges only, open center, soft blocks scattered inside
- All maps must ensure the four player spawn corners are accessible and not walled off

---

## Safe Zones
- Players spawn in the four corners of the map
- Each spawn corner must have a guaranteed safe zone: a 3-tile corridor in both directions from the corner (an L-shape of 3 tiles horizontally and 3 tiles vertically) that is always open floor — no soft blocks, no indestructible walls
- This ensures every player can drop a bomb and walk safely away from it before it explodes, and cannot be immediately trapped at spawn

---

## Players
- Up to 4 players, each a distinct bright color (white, black, red, blue) with a simple round character design drawn on canvas inspired by the Bomberman character silhouette
- One hit = eliminated from the round. No lives per round — being caught in an explosion means instant elimination
- Grid-based movement using arrow keys or WASD on desktop
- On mobile: render an on-screen D-pad and a bomb button as touch controls
- Players cannot walk through walls or other players
- Brief invincibility flash on spawn only (0.5 seconds), not on being hit — hits are always fatal

---

## Bombs
- Press Space (or bomb button on mobile) to place a bomb on the player's current tile
- Default: explodes after 3 seconds, range 1 tile in each direction, max 1 active bomb at a time
- Explosions spread in 4 cardinal directions, blocked by indestructible walls, destroy soft blocks, eliminate any player in range
- Explosions last 0.5 seconds visually and can chain-detonate other bombs instantly
- Remote Control power-up changes detonation behavior: the bomb does NOT auto-explode on a timer; the player manually detonates all their placed bombs with Space / bomb button

---

## Power-ups — Super Bomberman Style
Power-ups are hidden under soft blocks. When a soft block is destroyed, it has a configurable chance (set in the lobby, default 30%) to reveal a power-up. If no power-up spawns, the tile is simply cleared. Players collect power-ups by walking over them. All power-up effects are tracked per-player on the server.

Each power-up must be visually distinct — drawn using Canvas 2D primitives (shapes, colors, letters/symbols). No external image files. The Skull must look notably threatening (dark purple background, skull symbol).

Implement all of the following:

- 🔥 **Fire Up** — increase this player's explosion range by 1 tile
- 💣 **Bomb Up** — increase this player's max active bombs by 1
- 👟 **Speed Up** — increase movement speed slightly (cap at 3 stacks)
- ⚡ **Full Fire** — set explosion range to maximum (8 tiles) instantly
- 📡 **Remote Control** — bombs no longer auto-explode; Space/bomb button detonates all placed bombs manually. Picking up a second Remote Control toggles it off (back to timed)
- 👢 **Kick** — player can kick a bomb by walking into it; it slides in that direction until hitting a wall or another bomb
- ☠️ **Skull** — a curse item. Applies one random negative effect for 10 seconds: reversed controls, uncontrollable speed (moves automatically), explosion range forced to 1, or forced auto-bomb (automatically keeps placing bombs). A visual curse indicator is shown on the affected player's HUD. The curse can be passed to another player by walking into them
- 🛡️ **1-Up Shield** — grants a one-time shield that absorbs a single explosion hit instead of eliminating the player. Show a shield indicator on their HUD. Only one shield can be held at a time

---

## Round & Win Logic
- A round ends when only one player remains alive, OR when all remaining players are eliminated simultaneously (e.g. by a simultaneous chain explosion)
- One player remaining: they win the round, earn 1 win and 1 point
- All remaining players eliminated simultaneously: round is a draw, no points or wins awarded
- After each round, show a round-end screen for 4 seconds (winner name + color, or "DRAW"), then return to the lobby for the next round
- Session stats persist across rounds until all players disconnect: track wins and total score per player

---

## Scoreboard HUD
- Always visible at the top of the screen above the game canvas
- Shows each player's name, color swatch, round wins, and total score
- Updates in real time as rounds complete

---

## Rendering & Visual Style
- HTML5 Canvas for all game rendering
- Visual style inspired by Super Bomberman SNES: bright saturated colors, bold black outlines, chunky tiles with slight shading for pseudo-3D depth — all achieved with Canvas 2D drawing primitives (fillRect, arc, strokeRect, gradients), no external images
- Power-ups rendered as colored tiles with a clear symbol so players can identify them instantly mid-game
- 60fps rendering via `requestAnimationFrame`
- Canvas scales to fit the screen on both desktop and mobile without scrolling

---

## PWA / Mobile Support
- `manifest.json` with app name, short name, theme color, and a generated icon
- `sw.js` service worker that caches client files so the game is installable on mobile home screens
- Mobile layout: canvas centered, on-screen D-pad + bomb button rendered as touch controls (either overlaid or below canvas depending on screen size)
- Touch controls send the same action events to the server as keyboard controls
- Viewport meta tag set to prevent zoom and fit mobile screens

---

## Code Quality
- Brief comments on each major section
- Keep all game state and logic fully on the server; clients are purely input senders and renderers
- Map layouts live in `maps.js` as a clean exported data structure so new maps can be added easily later

---

## README.md must include:
1. **Installation:** `npm install`
2. **Running:** `npm start`
3. **Local play:** how to find your local IP and share `http://YOUR_LOCAL_IP:3000`
4. **Internet play via ngrok:** install ngrok, run `ngrok http 3000`, share the resulting `https://` URL — players open it in any browser, no config needed
5. **How to play:** controls, all power-up descriptions, round rules, how the Skull curse works and can be passed
6. **Lobby options:** how to select a map and adjust item drop probability before starting
7. **Adding new maps:** how to add a new layout to `maps.js`
