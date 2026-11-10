// AttributionField.jsx · QUICKADD-1. CAMPAIGN, APPEAL, FUNDRAISER / GIVING PAGE.
//
// One field, three kinds. She types and it searches what the org already has
// (GET /gift-attribution/:kind). Campaign and Appeal end the list with
// "+ New campaign: 'Good Giving Challenge'", made right there; a giving page is
// made in Forms, so the page list only searches. A value carried from the last
// gift reads "Same as last: …" and clears with ×.
//
// value: { id, name, ... } or null. For a page it also carries givingPageId
// and peerFundraiserId (one person's peer-to-peer page under a giving page).
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { displayDate } from "../../../../shared/displayDate";

const LABEL = { campaign: "Campaign", appeal: "Appeal", page: "Fundraiser / giving page" };
const NEW_WORD = { campaign: "campaign", appeal: "appeal" };

// A campaign counts a gift only inside its dates (NUMBERS-1); one the date
// falls outside is shown and cannot be chosen, as on the profile's gift form.
export function outsideWindow(c, date) {
  const d = String(date || "").slice(0, 10);
  if (!c || !d) return "";
  const s = c.startDate ? String(c.startDate).slice(0, 10) : null, e = c.endDate ? String(c.endDate).slice(0, 10) : null;
  if (s && d < s) return `starts ${displayDate(s)}`;
  if (e && d > e) return `ended ${displayDate(e)}`;
  return "";
}

export default function AttributionField({ kind, value, onChange, testid, date = "", campaignId = null, sticky = false, compact = false, style }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seq = useRef(0);
  const createable = kind === "campaign" || kind === "appeal";

  useEffect(() => {
    if (value || !open) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      apiFetch(`/gift-attribution/${kind}?q=${encodeURIComponent(text.trim())}`)
        .then(r => { if (my === seq.current) setRows((r && r.rows) || []); })
        .catch(() => { if (my === seq.current) setRows([]); });
    }, 180);
    return () => clearTimeout(t);
  }, [text, open, kind, value]);

  const pick = r => { setText(""); setOpen(false); setErr(""); onChange(r, { sticky: false }); };
  const create = async () => {
    const name = text.trim();
    if (!name) return;
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/gift-attribution/${kind}`, { method: "POST", body: JSON.stringify({ name, ...(kind === "appeal" && campaignId ? { campaignId } : {}) }) });
      pick(r);
    } catch (e) { setErr(errorMessage(e, `The ${NEW_WORD[kind]} could not be made.`)); }
    setBusy(false);
  };

  const fs = compact ? 12 : 13;
  const box = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: compact ? "6px 8px" : "8px 10px", color: T.ink, fontSize: fs, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
  const chip = { display: "inline-flex", alignItems: "center", gap: 6, background: sticky ? T.gold50 : T.white, border: "1px solid " + (sticky ? T.gold300 : T.bg3), borderRadius: 99, padding: compact ? "4px 10px" : "6px 12px", fontSize: fs, color: T.ink, maxWidth: "100%" };

  if (value) {
    return (
      <div style={style}>
        <span data-testid={sticky ? `${testid}-same` : `${testid}-picked`} title={`${sticky ? "Same as last" : LABEL[kind]}: ${value.name}`} style={chip}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sticky ? <span style={{ color: T.ink3, fontWeight: 700 }}>Same as last: </span> : <span style={{ color: T.ink3, fontWeight: 700 }}>{LABEL[kind]}: </span>}
            {value.name}{value.sub ? <span style={{ color: T.ink3 }}> · {value.sub}</span> : null}
          </span>
          <button type="button" aria-label={`Clear the ${LABEL[kind].toLowerCase()}`} data-testid={`${testid}-clear`} onClick={() => onChange(null, { sticky: false })}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: T.ink3, fontSize: fs + 2, lineHeight: 1 }}>×</button>
        </span>
      </div>
    );
  }
  const typed = text.trim();
  const exact = rows.some(r => String(r.name || "").toLowerCase() === typed.toLowerCase());
  return (
    <div style={{ position: "relative", ...style }}>
      <input value={text} onChange={e => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={`${LABEL[kind]}${createable ? ": search or add" : ": search"}`} aria-label={LABEL[kind]}
        data-testid={testid} style={box} autoComplete="off" />
      {open && (rows.length > 0 || (createable && typed && !exact)) && (
        <div role="listbox" style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", marginTop: 2, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, boxShadow: "0 6px 18px rgba(15,26,18,.12)", maxHeight: 220, overflowY: "auto" }}>
          {rows.map(r => {
            const out = kind === "campaign" ? outsideWindow(r, date) : "";
            return (
              <button key={r.id} type="button" role="option" aria-selected="false" disabled={!!out} data-testid={`${testid}-opt`}
                onMouseDown={e => e.preventDefault()} onClick={() => !out && pick(r)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 10px", fontSize: fs, color: out ? T.ink3 : T.ink, cursor: out ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {r.name}{r.sub ? <span style={{ color: T.ink3 }}> · {r.sub}</span> : null}{out ? <span style={{ color: T.ink3 }}> ({out})</span> : null}
              </button>);
          })}
          {createable && typed && !exact && (
            <button type="button" data-testid={`${testid}-create`} disabled={busy} onMouseDown={e => e.preventDefault()} onClick={create}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: rows.length ? "1px solid " + T.bg3 : "none", padding: "8px 10px", fontSize: fs, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {busy ? "Adding…" : `+ New ${NEW_WORD[kind]}: '${typed}'`}
            </button>)}
        </div>)}
      {err && <div role="alert" style={{ fontSize: 12, color: T.ink, marginTop: 4 }}>{err}</div>}
    </div>
  );
}
