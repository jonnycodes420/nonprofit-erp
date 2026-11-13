// pages.js — SECURE-2 item 3. A screen that needs every row pages through.
// No list route answers a whole table at once (default 100, at most 500);
// this reads page after page until a short one, so the caller still gets the
// whole list, a page at a time.
//
// COMMS-SPEED-1: NOTHING OUTLIVES ITS PAGE. A screen that pages passes the
// signal of an AbortController it aborts when it unmounts. The page in flight
// is cancelled (the browser drops the request, and the server cancels a read
// whose request has closed, server/shared/requestLimits.js), and no further
// page is asked for. It used to read on: 21 pages, ~40 s, after you had left.
import { apiFetch } from "../api";

const stopped = () => Object.assign(new Error("Stopped: the page that asked for this was left."), { name: "AbortError" });

export async function allPages(path, { pageSize = 500, pick = b => b, signal } = {}) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    if (signal && signal.aborted) throw stopped();
    const sep = path.includes("?") ? "&" : "?";
    const body = await apiFetch(`${path}${sep}limit=${pageSize}&offset=${offset}`, signal ? { signal } : undefined);
    const rows = pick(body);
    if (!Array.isArray(rows)) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
