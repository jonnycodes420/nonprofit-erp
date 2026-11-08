// components/profile/MergeWith.jsx · POLISH-4. MERGE TWO RECORDS BY HAND.
//
// More → Merge with… on the profile (and Merge in the Directory when exactly
// two people are ticked): find the other record, then Data health's own
// compare screen (CompareModal: what moves, which name, email and address
// stay), then Merge, with Undo for 30 days (POST /data-health/merges/:id/undo).
import { useState } from "react";
import { Modal, T, fmtFull } from "../shared";
import { apiFetch } from "../../api";
import { usePeoplePicker } from "../../lib/people";
import { CompareModal } from "../DataHealth";

export function MergeWithModal({ donor, other = null, onClose, onMerged }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(other);
  const [done, setDone] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [msg, setMsg] = useState("");
  const [found, searching] = usePeoplePicker(q, { match: "name", limit: 9 });   // STALE-2: the answer to what is typed now
  const results = q.trim() ? found.filter(d => d.id !== donor.id).slice(0, 8) : [];
  const undo = async () => {
    setUndoing(true);
    try {
      await apiFetch(`/data-health/merges/${done.mergeId}/undo`, { method: "POST" });
      setMsg("Undone. Both records are back as they were.");
      setDone(null);
      onMerged && onMerged(null);
    } catch (e) { setMsg(e.sentence || e.message); }
    setUndoing(false);
  };
  if (done || msg) return (
    <Modal onClose={onClose} title="Merge" width={560}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {done && <button type="button" data-testid="mw-undo" disabled={undoing} onClick={undo}
          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer" }}>{undoing ? "Undoing…" : "Undo"}</button>}
        <button type="button" onClick={onClose} style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer" }}>Done</button>
      </div>}>
      <div data-testid="mw-done" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{done ? done.sentence : msg}</div>
    </Modal>
  );
  if (picked) return <CompareModal pair={{ a: donor.id, b: picked.id }} undoWhere="here, or from Data health," onClose={onClose}
    onMerged={(sentence, r) => { setDone({ sentence, mergeId: r.mergeId }); onMerged && onMerged(r.keptId); }}/>;
  return (
    <Modal onClose={onClose} title={`Merge ${donor.name} with…`} width={560}>
      <div style={{ fontSize: 13, color: T.ink3, marginBottom: 10 }}>Find the other record. You will see both side by side, and what moves, before anything changes.</div>
      <input autoFocus data-testid="mw-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search people and organizations by name…"
        style={{ width: "100%", boxSizing: "border-box", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.ink, outline: "none" }}/>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, maxHeight: 260, overflowY: "auto" }}>
        {q.trim() && !results.length && <div data-testid="mw-none" style={{ fontSize: 12.5, color: T.ink3, padding: "6px 4px" }}>{searching ? "Searching…" : "Nobody by that name."}</div>}
        {results.map(d => (
          <button key={d.id} type="button" data-testid="mw-pick" onClick={() => setPicked(d)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{d.name}{d.email ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {d.email}</span> : null}</span>
            <span style={{ fontSize: 12, color: T.ink3, whiteSpace: "nowrap" }}>{fmtFull(d.total)} lifetime</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
