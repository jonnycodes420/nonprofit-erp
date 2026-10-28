// HARDEN-2 item 1. give.html asks for a giving page's payload (and, on the
// membership page, its levels) while the script is still downloading, and
// leaves the answers here keyed by URL. A component takes the answer for the
// URL it would have asked for, once; any other URL, or a page drawn by the
// main app (the editor's preview), finds nothing and fetches as before.
// Resolves to { ok, data }, the same two things a component reads off fetch.
export function takePrefetched(url) {
  const box = typeof window !== "undefined" && window.__givePrefetch;
  if (!box || !box[url]) return null;
  const p = box[url];
  delete box[url];
  return p;
}
