// components/WealthScore.jsx · WEALTH-1. THE WEALTH SCORE, 1 TO 5.
//
// A number somebody on the team sets by hand on a person's record. Shown only
// to someone who may see it (admins and staff with the major gifts
// permission, or everyone once an admin turns that on in Settings); the
// SERVER is the boundary (server/wealth/access.js), this only decides what to
// draw. Steward may suggest a score beside an empty one; nothing is saved
// until somebody clicks.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { T } from "./shared";

const SCORES = [1, 2, 3, 4, 5];
const QUIET = { background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 };
const CHIP = { minWidth: 28, height: 26, borderRadius: 7, border: "1px solid " + T.bg3, background: T.white, color: T.ink, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "0 8px" };

// Who may see it is the server's call: GET /donors/:id/rail carries `wealth`
// only for someone who may (server/wealth/profileRow.js), and this row is drawn
// from that answer, so opening a profile asks for nothing more.

// The moment it was set, in the reader's own day (a timestamp, not a civil date).
const dateWords = d => {
  const t = Date.parse(String(d || ""));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};

// ── THE PROFILE ROW ────────────────────────────────────────────────────────
// A <dt>/<dd> pair for the Contact card, directly under the address.
export function WealthScoreRow({ donorId, initial, isReadOnly, dtStyle, ddStyle }) {
  const [st, setSt] = useState(initial || null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setSt(initial || null); setPicking(false); setErr(""); }, [donorId, initial]);
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
          ? <span data-testid="dp-wealth-value" data-says-ok="WEALTH-1">{set ? st.score : "Not set"}</span>
          : <button type="button" data-testid="dp-wealth-value" data-says-ok="WEALTH-1" title="Click to set 1 to 5, or clear it" onClick={() => setPicking(true)}
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
