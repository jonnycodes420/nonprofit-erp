// client/src/components/ReviewGroups.jsx · ASKS-2 item 3. ONE DECISION FOR A GROUP OF ROWS.
//
// "Rows that may not be gifts" grouped by the reason and the memo's pattern
// (shared/numbers/notGiftGroups.js): 150 program fees are one decision, not
// 150 clicks. Each group has the row's three outcomes for all of it, and
// "Choose one by one". A choice first shows what it would change (read live
// from the server, never estimated) and changes nothing until the second
// click; the result has one Undo for the whole group.
import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";

const shown = p => String(p || "").replace(/<year>/g, "(year)").replace(/<season>/g, "(season)").replace(/<month>/g, "(month)").replace(/#/g, "(number)");
const WHAT = { not_gift: "not a gift", partly: "partly a gift", keep: "kept as gifts" };

export default function ReviewGroups({ card, onChanged, isReadOnly, open, onOpen, styles }) {
  const { B1, B2, LNK, money } = styles;
  const [pending, setPending] = useState(null);   // { group, decision, value, preview }
  const [value, setValue] = useState("");
  const [partlyFor, setPartlyFor] = useState(null);
  const [done, setDone] = useState(null);          // { sentence, undo }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = card.groups || [];
  if (!groups.length && !done) return null;

  const body = (g, decision, v) => JSON.stringify({ groupKey: g.key, giftIds: g.giftIds, decision, ...(decision === "partly" ? { value: String(v).replace(/[$,\s]/g, "") } : {}) });
  const ask = async (g, decision) => {
    setErr(""); setDone(null);
    if (decision === "partly") {
      const n = Number(String(value).replace(/[$,\s]/g, ""));
      if (!(n > 0)) { setErr("Enter the value each person received, in dollars."); return; }
    }
    setBusy(true);
    try {
      const preview = await apiFetch("/insights/review-preview", { method: "POST", body: body(g, decision, value) });
      setPending({ group: g, decision, value, preview });
    } catch (e) { setErr(e.message || "That didn't work."); }
    setBusy(false);
  };
  const apply = async () => {
    const { group, decision, value: v } = pending;
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/insights/review-group", { method: "POST", body: body(group, decision, v) });
      setPending(null); setPartlyFor(null); setValue("");
      setDone({ sentence: r.sentence, undo: r.undo });
      onChanged && onChanged();
    } catch (e) { setErr(e.message || "That didn't work."); }
    setBusy(false);
  };
  const undo = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(done.undo, { method: "POST" });
      setDone({ sentence: r.sentence, undo: null });
      onChanged && onChanged();
    } catch (e) { setErr(e.message || "That didn't work."); }
    setBusy(false);
  };

  return (
    <div data-testid="review-groups" style={{ marginBottom: 8 }}>
      {done && <div role="status" style={{ background: T.bg, borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 8 }}>
        {done.sentence} {done.undo && <button type="button" style={LNK} disabled={busy} onClick={undo}>Undo</button>}</div>}
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, marginBottom: 8 }}>{err}</div>}
      {groups.map(g => (
        <div key={g.key} data-testid="review-group" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
          <div style={{ fontSize: 14, color: T.ink }}><b>{g.count.toLocaleString("en-US")} rows</b> · {money(g.cents)} · “{shown(g.pattern)}”</div>
          <div style={{ fontSize: 13, color: T.ink3 }}>{g.reason}. Each memo reads the same once the name, year and season are taken out.</div>
          {!isReadOnly && (!pending || pending.group.key !== g.key) && <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={B1} disabled={busy} onClick={() => ask(g, "not_gift")}>Not a gift (all {g.count.toLocaleString("en-US")})</button>
            {g.partly && partlyFor !== g.key && <button type="button" style={B2} disabled={busy} onClick={() => { setPartlyFor(g.key); setValue(""); }}>Partly a gift (all)</button>}
            <button type="button" style={B2} disabled={busy} onClick={() => ask(g, "keep")}>Keep as gifts (all)</button>
            <button type="button" style={LNK} onClick={() => onOpen(open === g.key ? null : g.key)}>{open === g.key ? "Hide the rows" : "Choose one by one"}</button>
          </div>}
          {!isReadOnly && g.partly && partlyFor === g.key && (!pending || pending.group.key !== g.key) && (
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 13, color: T.ink }}>Value each person received $
                <input aria-label="Value each person received" inputMode="decimal" autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder="0.00"
                  style={{ width: 96, marginLeft: 4, fontSize: 13, padding: "7px 8px", border: "1px solid " + T.bg3, borderRadius: 8, background: T.white, color: T.ink, fontFamily: "inherit" }} />
              </label>
              <button type="button" style={B1} disabled={busy} onClick={() => ask(g, "partly")}>See what changes</button>
              <button type="button" style={LNK} onClick={() => setPartlyFor(null)}>Cancel</button>
            </div>
          )}
          {pending && pending.group.key === g.key && (
            <div data-testid="review-group-preview" style={{ background: T.bg, borderRadius: 8, padding: "8px 10px", marginTop: 6, fontSize: 13, color: T.ink }}>
              <div>{pending.preview.rows.toLocaleString("en-US")} {pending.preview.rows === 1 ? "row" : "rows"} would be {WHAT[pending.decision]}. {pending.preview.sentence} Nothing has changed yet.</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <button type="button" style={B1} disabled={busy} onClick={apply}>Apply to {pending.preview.rows.toLocaleString("en-US")} {pending.preview.rows === 1 ? "row" : "rows"}</button>
                <button type="button" style={LNK} onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
