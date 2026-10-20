// lib/people.js · SCALE-2 part 1. THE SHELL NO LONGER HOLDS EVERY DONOR.
//
// The app shell used to load every person in the org on sign-in (24 MB at
// 25,000 donors) so a picker, a count or a name lookup could read memory.
// These ask the server instead (routes/donorLookups.js), over the same rows in
// the same order, so the first match and every count are what they were.
//
// allPeople() is for the few views that really draw the whole org at once
// (Team, Re-engage, the map, the call list): it loads the old whole-org list
// when one of them opens (FIX-46: fresh each time Donors opens, and forgotten
// on any write), never on sign-in.
import { useEffect, useState } from "react";
import { apiFetch, adaptDonor, onWrite } from "../api";

const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();

// People for a picker. match: "concat" (name and email run together), "either"
// (name or email) or "name".
export async function pickPeople({ q = "", match = "concat", limit = 20, status, withEmail, named, kind } = {}) {
  const rows = await apiFetch(`/donors/pick?${qs({ q: q.trim(), match, limit, status, kind,
    withEmail: withEmail ? "1" : "", named: named ? "1" : "" })}`);
  return (Array.isArray(rows) ? rows : []).map(adaptDonor);
}

// The people whose name is exactly this (ignoring case and the typed spaces),
// highest giving first: the first is who the old list's .find() returned.
// trimStored: also ignore spaces around the stored name (the profile's rule).
export async function peopleNamed(name, limit = 2, { trimStored = false } = {}) {
  const n = String(name || "").trim();
  if (!n) return [];
  const rows = await apiFetch(`/donors/pick?${qs({ exact: n, limit, trimStored: trimStored ? "1" : "" })}`);
  return (Array.isArray(rows) ? rows : []).map(adaptDonor);
}
export async function personNamed(name) { return (await peopleNamed(name, 1))[0] || null; }

// These people by id, as { id: person }.
export async function peopleById(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  const out = {};
  for (let i = 0; i < uniq.length; i += 500) {
    const rows = await apiFetch(`/donors/lookup?ids=${encodeURIComponent(uniq.slice(i, i + 500).join(","))}`);
    for (const r of Array.isArray(rows) ? rows : []) out[r.id] = adaptDonor(r);
  }
  return out;
}

export const peopleCounts = () => apiFetch("/donors/counts");

let ALL = null;
export function allPeople({ force = false } = {}) {
  if (force || !ALL) {
    ALL = apiFetch("/donors/summaries").then(rows => (Array.isArray(rows) ? rows : []).map(adaptDonor));
    ALL.catch(() => { ALL = null; });
  }
  return ALL;
}
export function forgetAllPeople() { ALL = null; }
// FIX-46: any write may change somebody's totals, so the next whole-org view
// asks the server again (the same rows the profile reads).
onWrite(forgetAllPeople);

// A picker's suggestions for what has been typed so far (debounced). Returns
// [rows, pending]: pending is true until the answer for this text is back, so
// a "nobody matches" line never shows for an answer that has not arrived.
export function usePeoplePicker(text, { match = "concat", limit = 20, enabled = true, emptyToo = false, withEmail } = {}) {
  const [state, setState] = useState({ key: null, rows: [] });
  const t = String(text || "").trim();
  const key = `${t}|${match}|${limit}|${withEmail ? 1 : 0}`;
  const off = !enabled || (!t && !emptyToo);
  useEffect(() => {
    if (off) return undefined;
    let live = true;
    const h = setTimeout(() => {
      pickPeople({ q: t, match, limit, withEmail })
        .then(r => { if (live) setState({ key, rows: r }); })
        .catch(() => { if (live) setState({ key, rows: [] }); });
    }, t ? 200 : 0);
    return () => { live = false; clearTimeout(h); };
  }, [key, off]);
  if (off) return [[], false];
  return [state.rows, state.key !== key];
}

// These ids as people, refreshed when the set changes. Returns [map, ready]:
// ready is true once the map answers for exactly these ids.
export function usePeopleById(ids) {
  const key = [...new Set((ids || []).filter(Boolean))].sort().join(",");
  const [state, setState] = useState({ key: "", map: {} });
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    peopleById(key.split(","))
      .then(m => { if (live) setState({ key, map: m }); })
      .catch(() => { if (live) setState({ key, map: null }); });   // null: unknown, never "nobody"
    return () => { live = false; };
  }, [key]);
  if (!key) return [{}, true];
  return [state.map, state.key === key];
}
