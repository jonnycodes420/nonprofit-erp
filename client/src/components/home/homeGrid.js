// home/homeGrid.js · HOME-6. HOME'S ONE GRID.
//
// Jonathan, 5 Nov, on a 6,393-person org: "everything needs to be symmetrical
// and right now it's jumbled." Home keeps BUILD-89's one white panel; this is
// the grid inside it, in one place:
//
//   columns   at 1100 px and up, the work and the rail in fixed proportions,
//             7 : 3 (the rail never under 300 px); below that, one column
//   spacing   one scale, 8 · 12 · 16 · 24 · 32 · 40 px (--h-1 … --h-6):
//             sections in the work column are --h-5 apart, rail cards --h-2
//   cards     one radius (--h-radius, 14 px) and one padding (--h-pad, 20 px;
//             a rail card --h-pad-tight, 12 px 16 px). A card's left and right
//             edges are its column's, so every card in a column lines up
//
// shared.jsx keeps the panel's older rules; these come after them and win.
// The work column is `.home-shell-top > :first-child` (the main column's own
// class name stays in Dashboard.jsx, where home2-living reads the order).
import { T } from "../shared";

export const HOME_GRID_CSS = `
.home-shell { --h-1: 8px; --h-2: 12px; --h-3: 16px; --h-4: 24px; --h-5: 32px; --h-6: 40px;
  --h-radius: 14px; --h-pad: 20px; --h-pad-tight: 12px 16px; }
.home-shell-top > :first-child { padding: var(--h-6); gap: var(--h-5); }
.home-head-wide { gap: var(--h-4); margin-bottom: 0; }
.home-rail { padding: var(--h-5) var(--h-4); }
.home-rail [data-testid="home-rail"] { gap: var(--h-2) !important; }
.home-card { background: ${T.white}; border: 1px solid ${T.bg3}; border-radius: var(--h-radius); padding: var(--h-pad); box-sizing: border-box; width: 100%; }
.home-card-tight { padding: var(--h-pad-tight); }
.home-shell .moves-deck { gap: var(--h-3) !important; }
.home-shell .moves-card { border-radius: var(--h-radius); padding: var(--h-4); }
.home-shell .moves-tab { border-radius: var(--h-radius); }
.home-shell [data-testid="home-today"], .home-shell [data-testid="home-to-confirm"], .home-shell [data-testid="home-owners"] { border-radius: var(--h-radius); padding: var(--h-pad-tight); }
@media (min-width: 1100px) {
  .home-shell-top { display: grid; grid-template-columns: minmax(0, 7fr) minmax(300px, 3fr); align-items: stretch; }
  .home-rail { width: auto; }
}
@media (max-width: 768px) {
  .home-shell-top > :first-child { padding: var(--h-3) !important; gap: var(--h-4); }
  .home-head-narrow { padding: var(--h-4) var(--h-3) var(--h-1) !important; gap: var(--h-4); }
  .home-rail { padding: var(--h-3) !important; }
  .home-shell .moves-card { padding: var(--h-3); }
}
`;
