// lib/leaving.js · FLAKE-3. A READ CUT OFF BY LEAVING THE PAGE IS NOT AN ERROR.
//
// When the page is left (a link to another page, a reload, the address bar),
// Chromium rejects every read still in flight with a plain
// "TypeError: Failed to fetch", the same words as a dropped network. It does
// so after `pagehide` (measured on the built client: beforeunload, pagehide,
// unload, then the rejections). The Donors list logged it as an error, and
// lag1's walk, which moves between pages while reads are out, went red on it
// (PRs 412, 415 and 416). Here a rejection after `pagehide` becomes an AbortError,
// which a caller treats as normal: there is nobody left to tell.
// `pageshow` puts it back for a page restored from the back-forward cache.
let left = false;
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { left = true; }, true);
  window.addEventListener("pageshow", () => { left = false; }, true);
}

export function abortIfLeaving(e) {
  if (!left || !e || e.name === "AbortError") return e;
  return Object.assign(new Error("The page was left before this answer came back."), { name: "AbortError", leftPage: true });
}

export const isAbort = e => !!e && e.name === "AbortError";
