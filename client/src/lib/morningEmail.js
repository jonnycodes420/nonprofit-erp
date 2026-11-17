// client/src/lib/morningEmail.js · FLOWS-18 item 5 (W-1117-Volunteers-19).
// The morning email's real state for the signed-in person (GET /me: her switch, her hour, the
// org's staff mail), read once per sign-in and again after Settings saves it. Every sentence a
// screen writes about the morning email comes from shared/morningEmailState.js through this.
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../api";
import { morningEmailState } from "../../../shared/morningEmailState.js";

let pending = null, pendingFor = null;
const listeners = new Set();
function load() {
  const tok = getToken();
  if (pendingFor !== tok) { pending = null; pendingFor = tok; }
  if (!tok) return Promise.resolve(null);
  if (!pending) pending = apiFetch("/me").then(r => morningEmailState(r && r.notifications, r && r.org)).catch(() => { pending = null; return null; });
  return pending;
}

// Settings → Your email calls this after a save, so Tasks and Home read the new state without a reload.
export function forgetMorningEmail() {
  pending = null;
  load().then(st => { for (const f of listeners) f(st); });
}

// null until /me answers: a screen says nothing about the email rather than guess.
export function useMorningEmail() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let live = true;
    const on = v => { if (live) setSt(v); };
    listeners.add(on);
    load().then(on);
    return () => { live = false; listeners.delete(on); };
  }, []);
  return st;
}
