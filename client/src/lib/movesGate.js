// FEEL-1 · Home never jumps.
//
// Home's moves deck answers on its own read (/insights?view=deck). Until it
// does it is a one-line "Reading your donors…" box; the deck it becomes can be
// 1,200 px tall. When that read came late (a cold server, CI's slower runner),
// everything drawn under the box was pushed down at once: perf-app's desktop
// CLS of 0.201, the Thread going from y 480 out of view at about 1.5 s.
//
// So on a wide screen Home draws what sits under the deck only once the deck has its size: it
// drew, or it failed (and draws nothing). New content below a settled deck
// moves nothing. A deck that never says either (its code never arrives) is
// let go after SAFETY_MS, so the Thread can never be held back for good.
import { useState, useEffect, useCallback } from "react";

export const SAFETY_MS = 6000;

// Off (a phone): settled from the start, no timer and no callback, so nothing
// re-renders Home when the deck lands: on a phone that re-render cost ~150 ms
// of the 3.58 s budget (perf-app), and a phone keeps its own order.
export function useMovesGate(enabled = true) {
  const [settled, setSettled] = useState(!enabled);
  const settle = useCallback(() => setSettled(true), []);
  useEffect(() => {
    if (settled || !enabled) return undefined;
    const t = setTimeout(settle, SAFETY_MS);
    return () => clearTimeout(t);
  }, [settled, settle, enabled]);
  return [settled || !enabled, enabled ? settle : null];
}

// ── MOPUP-2 · Home on a phone never jumps either.
//
// FEEL-1 held what sits under the moves deck until the deck had its size, on a
// wide screen only: on a phone the hold (a re-render when the deck lands) cost
// about 150 ms of the phone budget. So a late deck could still push a phone's
// Home down. Here a phone reserves the deck's height from the first paint
// instead: the stand-in ("Reading your donors…") is as tall as the deck it
// becomes, so nothing under it moves and nothing waits or re-renders.
//
// The height is the deck's own last height in this browser (remembered when it
// draws), or PHONE_DECK_H the first time. Pure apart from localStorage, which
// may be missing (a private window): then the default is used.

// The first visit's reservation. It only has to reach past the bottom of the
// screen: on a 412 × 823 phone the deck starts at y 385, so anything under a
// stand-in taller than ~440 px is out of view, and a deck of any real size
// (perf-app's org: 1,825 px) lands without moving what she can see.
export const PHONE_DECK_H = 1200;
const KEY = "steward_deck_h";
const WIDE = "(min-width:1100px)";

export function isPhone() {
  return typeof window !== "undefined" && !!window.matchMedia && !window.matchMedia(WIDE).matches;
}

// ── MOPUP-3 · …and a short deck never pulls it up.
//
// 1,200 px (or the last height) is right for a deck with moves: what sits
// under it is out of view before the deck lands and after. A new org's deck is
// short (no moves, or "being prepared"), so the tall stand-in shrank when it
// landed and pulled what sat under it up into view. GET /org (a boot read)
// carries the deck's move count (server/insights/deckMoves.js), so before the
// deck is read a phone knows which deck it is. With moves: the tall reserve,
// as before (what sits under it is out of view before and after). With none:
// an empty deck's height is not known ahead (it can carry the drifting list
// and the chips), so the stand-in keeps its own small size and Home holds
// what sits under the deck, the rail included, until the deck has landed
// (FEEL-1's gate, which a wide screen always uses): nothing under it is drawn
// yet, so nothing can move. Not known (null, an older build): as before.
let knownMoves = null;
export function noteDeckMoves(n) { knownMoves = typeof n === "number" && n >= 0 ? n : null; }
export const deckKnownEmpty = () => knownMoves === 0;

// The stand-in's height on a phone, or null on a wide screen (FEEL-1's gate holds there).
export function reservedDeckHeight() {
  if (!isPhone()) return null;
  if (knownMoves === 0) return null;
  let h = 0;
  try { h = Number(localStorage.getItem(KEY)) || 0; } catch { h = 0; }
  return h >= 200 && h <= 4000 ? h : PHONE_DECK_H;
}

// The deck drew at this height: the next visit reserves it.
export function rememberDeckHeight(h) {
  // MOPUP-3: an empty deck's height is not a deck-with-moves' height.
  if (!isPhone() || knownMoves === 0 || !(h >= 200 && h <= 4000)) return;
  try { localStorage.setItem(KEY, String(Math.round(h))); } catch { /* this visit only */ }
}
