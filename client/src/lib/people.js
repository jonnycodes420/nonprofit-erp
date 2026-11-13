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
import { useEffect, useRef, useState } from "react";
import { apiFetch, adaptDonor, onWrite } from "../api";
import { allPages } from "./pages";
import { useLatestSearch, personStillMatches } from "./latestSearch";

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

// COMMS-SPEED-1: the whole-org read is shared by whoever is waiting for it,
// and it stops when the last of them has gone. A caller passes the signal of
// an AbortController it aborts on unmount (useLeaveSignal below); when every
// caller with a signal has aborted, the read is cancelled (lib/pages.js) and
// forgotten. A caller with no signal keeps it alive: use one only for a read
// a person asked for and is waiting on (a button press), never on a mount.
let ALL = null;   // { promise, ctl, users, done }
const leftErr = () => Object.assign(new Error("Stopped: the page that asked for this was left."), { name: "AbortError" });
function startAll() {
  const ctl = new AbortController();
  const entry = { ctl, users: 0, done: false };
  entry.promise = allPages("/donors/summaries", { signal: ctl.signal })   // SECURE-2: a page at a time
    .then(rows => (Array.isArray(rows) ? rows : []).map(adaptDonor));
  entry.promise.then(() => { entry.done = true; }, () => { entry.done = true; if (ALL === entry) ALL = null; });
  return entry;
}
export function allPeople({ force = false, signal } = {}) {
  if (force || !ALL) ALL = startAll();
  const entry = ALL;
  if (!signal) { entry.users = Infinity; return entry.promise; }
  if (signal.aborted) return Promise.reject(leftErr());
  entry.users += 1;
  return new Promise((resolve, reject) => {
    const leave = () => {
      reject(leftErr());
      entry.users -= 1;
      if (entry.users <= 0 && !entry.done) { entry.ctl.abort(); if (ALL === entry) ALL = null; }
    };
    signal.addEventListener("abort", leave, { once: true });
    entry.promise.then(v => { signal.removeEventListener("abort", leave); resolve(v); },
      e => { signal.removeEventListener("abort", leave); reject(e); });
  });
}
// A function giving the signal that aborts when the component unmounts, for
// reads started by a button rather than a mount (the call list, a preview).
// Call it when the read starts: leaveSignal().
export function useLeaveSignal() {
  const ref = useRef(null);
  if (!ref.current) ref.current = new AbortController();
  useEffect(() => {
    if (ref.current.signal.aborted) ref.current = new AbortController();   // StrictMode's second mount
    const ctl = ref.current;
    return () => ctl.abort();
  }, []);
  return () => ref.current.signal;
}
export function forgetAllPeople() { ALL = null; }   // a read in flight goes on for whoever is waiting on it
// FIX-46: any write may change somebody's totals, so the next whole-org view
// asks the server again (the same rows the profile reads).
onWrite(forgetAllPeople);

// A picker's suggestions for what has been typed so far (debounced). Returns
// [rows, pending]: pending is true until the answer for this text is back, so
// a "nobody matches" line never shows for an answer that has not arrived.
export function usePeoplePicker(text, { match = "concat", limit = 20, enabled = true, emptyToo = false, withEmail } = {}) {
  const t = String(text || "").trim();
  const key = `${t}|${match}|${limit}|${withEmail ? 1 : 0}`;
  const off = !enabled || (!t && !emptyToo);
  // STALE-2: the newest answer only, and never an older query's rows (lib/latestSearch.js).
  return useLatestSearch(t, key, term => pickPeople({ q: term, match, limit, withEmail }), { enabled: !off, narrow: personStillMatches });
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
