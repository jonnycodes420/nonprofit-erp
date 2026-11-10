// components/BulkWealthScore.jsx · WEALTH-1. "Set Wealth Score" for the people
// ticked on the Donors list (POST /donors/bulk-wealth-score). Its own file so it
// rides in the Donors list's chunk, out of Home's first download.
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../api";
import { errorMessage } from "../lib/domainError";
import { T } from "./shared";

const SCORES = [1, 2, 3, 4, 5];
// Who may see it: one read of GET /me per session token (the server decides,
// server/wealth/access.js). Kept on window so Settings' switch can forget it.
export function loadCanWealthScores() {
  const tok = getToken();
  if (!tok) return Promise.resolve(false);
  const c = window.__stewardWealthAsk;
  if (c && c.tok === tok) return c.p;
  const p = apiFetch("/me").then(r => { const yes = !!(r && r.user && r.user.canWealthScores); return yes; })
    .catch(() => { window.__stewardWealthAsk = null; return false; });
  window.__stewardWealthAsk = { tok, p };
  return p;
}
export function useCanWealthScores() {
  const [can, setCan] = useState(false);
  useEffect(() => { let live = true; loadCanWealthScores().then(v => live && setCan(v)); return () => { live = false; }; }, []);
  return can;
}

export function BulkWealthScore({ ids, disabled, onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async score => {
    if (!ids.length || busy) return;
    setBusy(true);
    try { const r = await apiFetch("/donors/bulk-wealth-score", { method: "POST", body: JSON.stringify({ ids, score }) }); setOpen(false); onDone && onDone(r && r.sentence); }
    catch (e) { onDone && onDone((e && e.sentence) || errorMessage(e, "No Wealth Score changed.")); }
    setBusy(false);
  };
  const btn = { background: "transparent", border: "1px solid " + T.gold500, borderRadius: 8, padding: "7px 12px", color: T.gold500, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
  if (!open) return <button type="button" data-testid="bulk-wealth-score" onClick={() => setOpen(true)} disabled={disabled} style={btn}>Set Wealth Score</button>;
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }} role="group" aria-label={`Set the Wealth Score for ${ids.length}`}>
      {SCORES.map(n => <button key={n} type="button" data-testid={`bulk-wealth-${n}`} disabled={busy} onClick={() => go(n)}
        style={{ ...btn, minWidth: 30, padding: "7px 9px", background: T.greenDk, borderColor: T.greenDk, color: T.white }}>{n}</button>)}
      <button type="button" data-testid="bulk-wealth-clear" disabled={busy} onClick={() => go(null)} style={btn}>Clear</button>
      <button type="button" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: T.inkInverse, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Cancel</button>
    </span>
  );
}
