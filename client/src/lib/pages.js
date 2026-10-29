// pages.js — SECURE-2 item 3. A screen that needs every row pages through.
// No list route answers a whole table at once (default 100, at most 500);
// this reads page after page until a short one, so the caller still gets the
// whole list, a page at a time.
import { apiFetch } from "../api";

export async function allPages(path, { pageSize = 500, pick = b => b } = {}) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await apiFetch(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    const rows = pick(body);
    if (!Array.isArray(rows)) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
