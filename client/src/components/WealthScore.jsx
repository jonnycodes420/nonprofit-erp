// components/WealthScore.jsx · WEALTH-1. THE WEALTH SCORE, 1 TO 5.
//
// A number somebody on the team sets by hand on a person's record. Shown only
// to someone who may see it (admins and staff with the major gifts
// permission, or everyone once an admin turns that on in Settings); the
// SERVER is the boundary (server/wealth/access.js), this only decides what to
// draw. Steward may suggest a score beside an empty one; nothing is saved
// until somebody clicks.
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../api";
import { errorMessage } from "../lib/domainError";
import { T } from "./shared";

const SCORES = [1, 2, 3, 4, 5];
const QUIET = { background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 };
const CHIP = { minWidth: 28, height: 26, borderRadius: 7, border: "1px solid " + T.bg3, background: T.white, color: T.ink, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "0 8px" };

// One read of GET /me per page load, keyed on the session token.
let pending = null, pendingFor = null;
export function loadCanWealthScores() {
  const tok = getToken();
  if (pendingFor !== tok) { pending = null; pendingFor = tok; }
  if (!tok) return Promise.resolve(false);
  if (!pending) pending = apiFetch("/me").then(r => !!(r && r.user && r.user.canWealthScores)).catch(() => { pending = null; return false; });
  return pending;
}
export function useCanWealthScores() {
  const [can, setCan] = useState(false);
  useEffect(() => { let live = true; loadCanWealthScores().then(v => live && setCan(v)); return () => { live = false; }; }, []);
  return can;
}

// The moment it was set, in the reader's own day (a timestamp, not a civil date).
const dateWords = d => {
  const t = Date.parse(String(d || ""));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};

// ── THE PROFILE ROW ────────────────────────────────────────────────────────
// A <dt>/<dd> pair for the Contact card, directly under the address.
export function WealthScoreRow({ donorId, isReadOnly, dtStyle, ddStyle }) {
  const [st, setSt] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setSt(null); setPicking(false); setErr("");
    if (donorId) apiFetch(`/donors/${encodeURIComponent(donorId)}/wealth-score`).then(r => live && setSt(r)).catch(() => live && setSt(null));
    return () => { live = false; };
  }, [donorId]);
  if (!st) return null;
  const save = async (score, fromSuggestion = false) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/donors/${encodeURIComponent(donorId)}/wealth-score`, { method: "PATCH", body: JSON.stringify({ score, ...(fromSuggestion ? { fromSuggestion: true } : {}) }) });
      setSt(r); setPicking(false);
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "The Wealth Score did not save.")); }
    setBusy(false);
  };
  const set = st.score != null;
  const setLine = set && (st.setByName || st.setAt) ? `Set${st.setByName ? ` by ${st.setByName.split(" ")[0]}` : ""}${st.setAt ? `, ${dateWords(st.setAt)}` : ""}` : "";
  return <>
    <dt style={dtStyle} title={st.definition}>Wealth Score</dt>
    <dd style={{ margin: 0, ...(ddStyle || {}) }} data-testid="dp-wealth-score">
      {picking && !isReadOnly
        ? <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 5, alignItems: "center" }} role="group" aria-label="Choose a Wealth Score">
            {SCORES.map(n => <button key={n} type="button" data-testid={`dp-wealth-pick-${n}`} disabled={busy} onClick={() => save(n)} aria-pressed={st.score === n}
              style={{ ...CHIP, ...(st.score === n ? { background: T.greenDk, color: T.white, borderColor: T.greenDk } : {}) }}>{n}</button>)}
            {set && <button type="button" data-testid="dp-wealth-clear" disabled={busy} onClick={() => save(null)} style={{ ...QUIET, color: T.ink3, fontSize: 12 }}>Clear</button>}
            <button type="button" onClick={() => setPicking(false)} style={{ ...QUIET, color: T.ink3, fontSize: 12 }}>Cancel</button>
          </span>
        : isReadOnly
          ? <span data-testid="dp-wealth-value">{set ? st.score : "Not set"}</span>
          : <button type="button" data-testid="dp-wealth-value" title="Click to set 1 to 5, or clear it" onClick={() => setPicking(true)}
              style={{ ...QUIET, textDecoration: "underline dotted", color: set ? T.ink : T.ink3, fontWeight: set ? 700 : 400 }}>{set ? st.score : "Not set"}</button>}
      {set && setLine && !picking && <span style={{ display: "block", fontSize: 11.5, color: T.ink3 }}>{setLine}</span>}
      {/* A suggestion beside an empty score: shown, never saved, until she clicks. */}
      {!set && st.suggestion && !isReadOnly && <span data-testid="dp-wealth-suggestion" style={{ display: "block", fontSize: 11.5, color: T.ink3, marginTop: 3, lineHeight: 1.4 }}>
        {st.suggestion.sentence}{" "}
        <button type="button" data-testid="dp-wealth-accept" disabled={busy} onClick={() => save(st.suggestion.score, true)}
          style={{ ...QUIET, color: T.greenDk, fontWeight: 700 }}>Use {st.suggestion.score}</button>
      </span>}
      {err && <span role="alert" style={{ display: "block", fontSize: 11.5, color: T.ink }}>{err}</span>}
    </dd>
  </>;
}

// ── THE DONORS LIST'S BULK ACTION ─────────────────────────────────────────
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

// ── SETTINGS: WHO ON THE TEAM SEES IT ─────────────────────────────────────
export function WealthScoresTeamSetting({ isAdmin }) {
  const [team, setTeam] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { apiFetch("/org/wealth-scores").then(r => setTeam(!!(r && r.team))).catch(() => setTeam(null)); }, []);
  if (!isAdmin || team === null) return null;
  const flip = async on => {
    setTeam(on); setMsg("");
    try { const r = await apiFetch("/org/wealth-scores", { method: "PUT", body: JSON.stringify({ team: on }) }); setTeam(!!r.team); setMsg(r.sentence || ""); pending = null; }
    catch (e) { setTeam(!on); setMsg(errorMessage(e, "That setting did not change.")); }
  };
  return (
    <label data-testid="settings-wealth-team" style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: T.ink, padding: "12px 0 4px", cursor: "pointer" }}>
      <input type="checkbox" checked={team} onChange={e => flip(e.target.checked)} style={{ accentColor: T.greenDk, marginTop: 2 }} />
      <span><b>Everyone on the team can see Wealth Scores</b>
        <span style={{ display: "block", fontSize: 11.5, color: T.ink3 }}>{msg || "Off: only admins and staff with the major gifts permission see them. Wealth Scores never appear on anything a donor sees."}</span></span>
    </label>
  );
}
