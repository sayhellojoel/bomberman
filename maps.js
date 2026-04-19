// maps.js — Pre-designed map layouts for Bomberman
// Small maps: 15x13 grid (indices 0-5) — up to 4 players
// Large maps: 23x19 grid (indices 6-11) — up to 8 players, auto-selected when 5+ players join
// W = indestructible wall, S = soft block placeholder, _ = open floor
// S tiles are randomly filled/cleared at game start. Spawn corners are always kept clear.

const maps = [
  // ─── SMALL MAPS (15×13, indices 0–5) ──────────────────────────────────────
  {
    name: "Classic",
    description: "Standard Bomberman checkerboard walls with moderate soft blocks",
    layout: [
      "W W W W W W W W W W W W W W W",
      "W _ _ S S S S S S S S S _ _ W",
      "W _ W S W S W S W S W S W _ W",
      "W S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S W",
      "W _ W S W S W S W S W S W _ W",
      "W _ _ S S S S S S S S S _ _ W",
      "W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Maze",
    description: "Dense walls creating narrow corridors",
    layout: [
      "W W W W W W W W W W W W W W W",
      "W _ _ S W S S S S S W S _ _ W",
      "W _ W S W S W W W S W S W _ W",
      "W S S S S S S S S S S S S S W",
      "W W W S W W W S W W W S W W W",
      "W S S S S S S S S S S S S S W",
      "W S W W W S W W W S W W W S W",
      "W S S S S S S S S S S S S S W",
      "W W W S W W W S W W W S W W W",
      "W S S S S S S S S S S S S S W",
      "W _ W S W S W W W S W S W _ W",
      "W _ _ S W S S S S S W S _ _ W",
      "W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Open Field",
    description: "Very few walls, wide open spaces, high soft block density",
    layout: [
      "W W W W W W W W W W W W W W W",
      "W _ _ S S S S S S S S S _ _ W",
      "W _ W S S S S S S S S S W _ W",
      "W S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S W",
      "W S S S S S W S W S S S S S W",
      "W S S S S S S S S S S S S S W",
      "W S S S S S W S W S S S S S W",
      "W S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S W",
      "W _ W S S S S S S S S S W _ W",
      "W _ _ S S S S S S S S S _ _ W",
      "W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Fortress",
    description: "Castle-like rooms and chokepoints",
    layout: [
      "W W W W W W W W W W W W W W W",
      "W _ _ S S W S S S W S S _ _ W",
      "W _ W S S W S S S W S S W _ W",
      "W S S W W W S S S W W W S S W",
      "W S S S S S S S S S S S S S W",
      "W W W W S S S S S S S W W W W",
      "W S S S S S W W W S S S S S W",
      "W W W W S S S S S S S W W W W",
      "W S S S S S S S S S S S S S W",
      "W S S W W W S S S W W W S S W",
      "W _ W S S W S S S W S S W _ W",
      "W _ _ S S W S S S W S S _ _ W",
      "W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Chaos",
    description: "Asymmetric, unpredictable wall layout",
    layout: [
      "W W W W W W W W W W W W W W W",
      "W _ _ S S S W S S S S S _ _ W",
      "W _ W S W S S S W S S S W _ W",
      "W S S S S S S W S S W S S S W",
      "W S W W S W S S S W S S W S W",
      "W S S S S S S S W S S S S S W",
      "W S W S W S S S S S W S W S W",
      "W S S S S S W S S S S S S S W",
      "W S W S S W S S S W S W W S W",
      "W S S S W S S W S S S S S S W",
      "W _ W S S S W S S S W S W _ W",
      "W _ _ S S S S S W S S S _ _ W",
      "W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Island",
    description: "Walls around the edges, open center with scattered soft blocks",
    layout: [
      "W W W W W W W W W W W W W W W",
      "W _ _ S W S W S W S W S _ _ W",
      "W _ W S W S S S S S W S W _ W",
      "W S W S S S S S S S S S W S W",
      "W W W S S S S S S S S S W W W",
      "W S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S W",
      "W W W S S S S S S S S S W W W",
      "W S W S S S S S S S S S W S W",
      "W _ W S W S S S S S W S W _ W",
      "W _ _ S W S W S W S W S _ _ W",
      "W W W W W W W W W W W W W W W"
    ]
  },

  // ─── LARGE MAPS (23×19, indices 6–11) — auto-used when 5+ players ──────────
  // Spawn corners: (1,1) (21,1) (1,17) (21,17) + mid-edges: (11,1) (11,17) (1,9) (21,9)
  {
    name: "Classic",
    description: "Standard Bomberman checkerboard walls with moderate soft blocks",
    layout: [
      "W W W W W W W W W W W W W W W W W W W W W W W",
      "W _ _ S S S S S S S S _ S S S S S S S S _ _ W",
      "W _ W S W S W S W S W S W S W S W S W S W _ W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W S W S W S W S W",
      "W _ S S S S S S S S S S S S S S S S S S S _ W",
      "W S W S W S W S W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S W S W S W S W S W S W S W S W S W S W S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W _ W S W S W S W S W S W S W S W S W S W _ W",
      "W _ _ S S S S S S S S _ S S S S S S S S _ _ W",
      "W W W W W W W W W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Maze",
    description: "Dense walls creating narrow corridors",
    layout: [
      "W W W W W W W W W W W W W W W W W W W W W W W",
      "W _ _ S W S S S S S S _ S S S S S S W S _ _ W",
      "W _ W S W S W W W S W S W W W S W S W S W _ W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W W W S W W W S W W W S W W W S W W W S W W W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S W W W S W W W S W W W S W W W S W W W S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W W W S W W W S W W W S W W W S W W W S W W W",
      "W _ S S S S S S S S S S S S S S S S S S S _ W",
      "W W W S W W W S W W W S W W W S W W W S W W W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S W W W S W W W S W W W S W W W S W W W S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W W W S W W W S W W W S W W W S W W W S W W W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W _ W S W S W W W S W S W W W S W S W S W _ W",
      "W _ _ S W S S S S S S _ S S S S S S W S _ _ W",
      "W W W W W W W W W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Open Field",
    description: "Very few walls, wide open spaces, high soft block density",
    layout: [
      "W W W W W W W W W W W W W W W W W W W W W W W",
      "W _ _ S S S S S S S S _ S S S S S S S S _ _ W",
      "W _ W S S S S S S S S S S S S S S S S S W _ W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S W S S S W S S S W S S S W S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S W S S S W S S S W S S S W S S S W",
      "W _ S S S S S S S S S S S S S S S S S S S _ W",
      "W S S S S S W S S S W S S S W S S S W S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S W S S S W S S S W S S S W S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W _ W S S S S S S S S S S S S S S S S S W _ W",
      "W _ _ S S S S S S S S _ S S S S S S S S _ _ W",
      "W W W W W W W W W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Fortress",
    description: "Castle-like rooms and chokepoints",
    layout: [
      "W W W W W W W W W W W W W W W W W W W W W W W",
      "W _ _ S S W S S S S S _ S S S S S W S S _ _ W",
      "W _ W S S W S S S S S S S S S S S W S S W _ W",
      "W S S W W W S S S S S S S S S S S W W W S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W W W W S S S S S S S S S S S S S S S W W W W",
      "W S S S S S W W W S S S S S W W W S S S S S W",
      "W W W W S S S S S S S S S S S S S S S W W W W",
      "W S S S S S W W W S S S S S W W W S S S S S W",
      "W _ S S S S S S S S S S S S S S S S S S S _ W",
      "W S S S S S W W W S S S S S W W W S S S S S W",
      "W W W W S S S S S S S S S S S S S S S W W W W",
      "W S S S S S W W W S S S S S W W W S S S S S W",
      "W W W W S S S S S S S S S S S S S S S W W W W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S W W W S S S S S S S S S S S W W W S S W",
      "W _ W S S W S S S S S S S S S S S W S S W _ W",
      "W _ _ S S W S S S S S _ S S S S S W S S _ _ W",
      "W W W W W W W W W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Chaos",
    description: "Asymmetric, unpredictable wall layout",
    layout: [
      "W W W W W W W W W W W W W W W W W W W W W W W",
      "W _ _ S S S W S S S S _ S S S S W S S S _ _ W",
      "W _ W S W S S S W S S S S S W S S S W S W _ W",
      "W S S S S S S W S S W S S W S S S S S S S S W",
      "W S W W S W S S S W S S S S S W S W W S W S W",
      "W S S S S S S S W S S W S S S S S S S S S S W",
      "W S W S W S S S S S W S W S S S S S S W S S W",
      "W S S S S S W S S S S S S W S S S S W S S S W",
      "W S W S S W S S W S S S S S W S W W S W S S W",
      "W _ S S W S S W S S S S S S S W S S S S S _ W",
      "W S W S S S W S S S S W S S S S S W S W S S W",
      "W S S S S S S S S W S S W S S S S S S S S S W",
      "W S W S W S S S S S W S S W S S S S W S S S W",
      "W S S S S W S S W S S S S S W S S S S S S S W",
      "W S W W S W S S S S S W S S S W S S W S S S W",
      "W S S S S S S S W S S S S S S S S W S S S S W",
      "W _ W S S S W S S S W S S S W S S S W S W _ W",
      "W _ _ S S S S S W S S _ S S S S W S S S _ _ W",
      "W W W W W W W W W W W W W W W W W W W W W W W"
    ]
  },
  {
    name: "Island",
    description: "Walls around the edges, open center with scattered soft blocks",
    layout: [
      "W W W W W W W W W W W W W W W W W W W W W W W",
      "W _ _ S W S W S W S W _ W S W S W S W S _ _ W",
      "W _ W S W S S S S S S S S S S S S S W S W _ W",
      "W S W S S S S S S S S S S S S S S S S S W S W",
      "W W W S S S S S S S S S S S S S S S S S W W W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W W W S S S S S S S S S S S S S S S S S W W W",
      "W _ S S S S S S S S S S S S S S S S S S S _ W",
      "W W W S S S S S S S S S S S S S S S S S W W W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W S S S S S S S S S S S S S S S S S S S S S W",
      "W W W S S S S S S S S S S S S S S S S S W W W",
      "W S W S S S S S S S S S S S S S S S S S W S W",
      "W _ W S W S S S S S S S S S S S S S W S W _ W",
      "W _ _ S W S W S W S W _ W S W S W S W S _ _ W",
      "W W W W W W W W W W W W W W W W W W W W W W W"
    ]
  }
];

module.exports = maps;
