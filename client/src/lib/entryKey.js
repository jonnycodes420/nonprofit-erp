// client/src/lib/entryKey.js · FLOWS-4 (W-1109-Volunteers-26 and -18X). ONE
// ENTRY, ONE KEY. A form holds a key from the moment it is empty until it is
// saved; a double click (or a second request for one drag) sends the same key
// twice, and the server keeps the first and writes nothing for the second.
export function entryKey() {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch { /* old browser */ }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
