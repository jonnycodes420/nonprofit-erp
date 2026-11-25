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
let reopening = false;

// A failed dynamic import, in each browser's words for it.
const WORDS = /dynamically imported module|Importing a module script|Unable to preload|ChunkLoadError|Loading (CSS )?chunk|not a valid JavaScript MIME/i;
export const isChunkError = err => !!err && WORDS.test(err.name + " " + (err.message || err));

export const REOPENING_WORDS = "Steward was just updated. Reopening…";

// True when the page is reopening (now or already); false when it reopened for
// this inside the last minute, or cannot remember that it did, so the caller
// shows the error with its Reload button instead.
export function reopenAfterUpdate(err) {
  if (reopening) return true;
  if (typeof window === "undefined" || !isChunkError(err)) return false;
  try {
    if (Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < 60000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { return false; }
  reopening = true;
  // The cream notice, drawn straight onto the page: React may be mid-crash.
  try { const d = document.createElement("div"); d.setAttribute("role", "status"); d.dataset.testid = "steward-reopening"; d.textContent = REOPENING_WORDS; d.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#F0EDE6;color:#0F1A12;font:600 16px system-ui"; document.body.appendChild(d); } catch { /* no document */ }
  setTimeout(() => location.reload(), 60);
  return true;
}
export const isReopening = () => reopening;

export function installChunkReload() {
  // Vite's own signal for a failed preload or import, and an import() on a click nobody caught.
  addEventListener("vite:preloadError", e => { if (reopenAfterUpdate(e.payload)) e.preventDefault(); });
  addEventListener("unhandledrejection", e => { if (isChunkError(e.reason) && reopenAfterUpdate(e.reason)) e.preventDefault(); });
  // A page that has run 15 s without one has recovered: the next failure is a new deploy.
  setTimeout(() => { try { if (!reopening) sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } }, 15000);
}
