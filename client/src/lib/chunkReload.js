// lib/chunkReload.js · FRESH-1 item 2. A SHIP NEVER CRASHES AN OPEN PAGE.
//
// Jarvis, 24 Nov: "'Record a gift' crashed the Donors view ('Something went
// wrong while loading donors') and 'Add Gift' on Margaret's profile crashed
// twice with a dynamic-module fetch failure." A page left open across a deploy
// still names the old chunk files, which the new deploy no longer serves.
// FIX-56's retryImport asked once more and then drew "Steward was updated"
// for the few lazy() calls wrapped in it; every other import (a route's
// React.lazy, a modal's import() on a click) reached an error boundary.
//
// Now any chunk that fails to load reopens the page ONCE, at the same address,
// with "Steward was just updated. Reopening…" on screen. A draft the page
// already keeps (lib/drafts and the editors' own) survives a reload, as it
// does any reload. If the reopened page fails to load a chunk again within a
// minute, nothing reloads: the error shows with a Reload button, so a broken
// deploy never loops. JSX-free and dependency-free: main.jsx installs it in
// the eager entry chunk, before any lazy code is asked for.

const KEY = "steward_chunk_reopen";
const AGAIN_MS = 60000;   // a second failure inside this is "in a row"
const SETTLED_MS = 15000; // a page that ran this long without one has recovered
let reopening = false;

// A failed dynamic import, by every browser's words for it.
const WORDS = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|'text\/html' is not a valid JavaScript MIME type/i;
export function isChunkError(err) {
  if (!err) return false;
  if (err.name === "ChunkLoadError") return true;
  return WORDS.test(String(err.message || err));
}

function lastReopen() {
  try { return Number(window.sessionStorage.getItem(KEY)) || 0; } catch { return -1; }
}

// The cream notice, drawn straight onto the page: React may be mid-crash.
export const REOPENING_WORDS = "Steward was just updated. Reopening…";
function drawReopening() {
  try {
    if (document.getElementById("steward-reopening")) return;
    const d = document.createElement("div");
    d.id = "steward-reopening";
    d.setAttribute("role", "status");
    d.setAttribute("data-testid", "steward-reopening");
    d.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#F0EDE6;color:#0F1A12;font:600 16px 'DM Sans',system-ui,sans-serif;";
    d.textContent = REOPENING_WORDS;
    document.body.appendChild(d);
  } catch { /* no document */ }
}

// True when the page is reopening (now or already); false when it reopened for
// this a moment ago, or cannot remember that it did, so the caller shows the
// error with its Reload button instead.
export function reopenAfterUpdate(err) {
  if (reopening) return true;
  if (typeof window === "undefined" || !isChunkError(err)) return false;
  const last = lastReopen();
  if (last < 0 || Date.now() - last < AGAIN_MS) return false;
  try { window.sessionStorage.setItem(KEY, String(Date.now())); } catch { return false; }
  reopening = true;
  try { console.warn("[chunk] a chunk did not load after an update; reopening", err && err.message); } catch { /* no console */ }
  drawReopening();
  setTimeout(() => { try { window.location.reload(); } catch { /* nothing to do */ } }, 60);
  return true;
}
export const isReopening = () => reopening;

let installed = false;
export function installChunkReload() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Vite's own signal for a failed preload or import of a lazy chunk.
  window.addEventListener("vite:preloadError", e => { if (reopenAfterUpdate(e && e.payload)) e.preventDefault(); });
  // An import() on a click that nobody caught.
  window.addEventListener("unhandledrejection", e => { if (e && isChunkError(e.reason) && reopenAfterUpdate(e.reason)) e.preventDefault(); });
  // The page that reopened has loaded and run: the next failure is a new deploy, not this one again.
  setTimeout(() => { try { if (!reopening) window.sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } }, SETTLED_MS);
}
