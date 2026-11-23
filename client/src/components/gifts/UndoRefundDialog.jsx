// UndoRefundDialog.jsx · UNDO-1 item 2. UNDO A REFUND.
//
// A refund row's "Undo refund" on the profile's gift list (and the same Undo
// in Recent changes). It asks why, then POST /refunds/:id/undo takes the
// refund row back and puts the receipt back as it was, unless a receipt for
// this gift already went to the donor since; the answer's sentence says which.
// Offered for 30 days, never for a refund made to a card through Stripe.
import { useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { announceUndone } from "../../lib/recentUndo";

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

// refund: the refund row { id, amount (negative) }.
export default function UndoRefundDialog({ refund, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const cents = -Math.round(Number(refund.amount) * 100);
  const send = async () => {
    if (!reason.trim()) { setErr("Say why the refund is being undone."); return; }
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/refunds/${encodeURIComponent(refund.id)}/undo`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      setDone(r.sentence); announceUndone({ id: refund.id });
      onSaved && onSaved(r);
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "The refund was not undone.")); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} width={440} ariaLabel="Undo refund">
      <div data-testid="undo-refund-dialog" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Undo the {usd(cents)} refund</div>
        {done ? <>
          <div role="status" data-testid="undo-refund-done" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{done}</div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" style={btn(true)} onClick={onClose}>Done</button></div>
        </> : <>
          <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
            The refund row goes, and the gift counts again. Its receipt comes back as it was, unless a receipt for this gift already went to the donor since the refund.
          </div>
          <label><span style={{ fontSize: 11.5, fontWeight: 700, color: T.ink3, marginBottom: 4, display: "block" }}>Why</span>
            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} autoFocus placeholder="Recorded on the wrong gift; the cheque cleared after all…"
              data-testid="undo-refund-reason" style={inp} onKeyDown={e => { if (e.key === "Enter") send(); }} /></label>
          {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
            <button type="button" style={btn(true)} onClick={send} disabled={busy} data-testid="undo-refund-save">{busy ? "Undoing…" : "Undo refund"}</button>
          </div>
        </>}
      </div>
    </Modal>
  );
}
