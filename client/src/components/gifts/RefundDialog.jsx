// RefundDialog.jsx · MONEY-4 (W-1109-Finance-27). RECORD A REFUND.
//
// A gift's "Refund": amount (the whole of what is left, or part), date and
// reason. POST /gifts/:id/refund writes a linked negative row and keeps the
// original gift; the receipt is voided and reissued for what remains. A card
// gift through Stripe asks once more, naming the amount, before anything moves.
import { useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { orgTodayCivil } from "../../lib/orgToday";
import DateInput from "../inputs/LazyDateInput";

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
const lbl = { fontSize: 11.5, fontWeight: 700, color: T.ink3, marginBottom: 4, display: "block" };
const btn = (primary, danger) => ({ background: danger ? T.terracotta : primary ? T.greenDk : T.white, color: primary || danger ? T.white : T.ink, border: primary || danger ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

// gift: { id, amount, date }; leftCents: what is still refundable.
export default function RefundDialog({ gift, leftCents, onClose, onSaved }) {
  const [f, setF] = useState({ amount: String(leftCents / 100), date: orgTodayCivil(), reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(null);   // { sentence, cents } for a Stripe gift
  const [done, setDone] = useState(null);
  const send = async (stripeOk) => {
    setErr("");
    const cents = Math.round(Number(f.amount) * 100);
    if (!(cents > 0)) { setErr("Type the amount to refund."); return; }
    if (cents > leftCents) { setErr(`Only ${usd(leftCents)} is left to refund on this gift.`); return; }
    if (!f.reason.trim()) { setErr("Say why it is being refunded."); return; }
    setBusy(true);
    try {
      const r = await apiFetch(`/gifts/${gift.id}/refund`, { method: "POST", body: JSON.stringify({
        amount: f.amount, date: f.date, reason: f.reason.trim(), ...(stripeOk ? { confirmStripe: true, confirmAmount: cents / 100 } : {}) }) });
      setDone(r.sentence); setConfirm(null);
      onSaved && onSaved(r);
    } catch (e) {
      if (e && e.error === "stripe_confirm") setConfirm({ sentence: e.sentence, cents });
      else setErr((e && e.sentence) || errorMessage(e, "The refund was not recorded."));
    }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} width={460} ariaLabel="Record a refund">
      <div data-testid="refund-dialog" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Record a refund</div>
        <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
          The {usd(Math.round(Number(gift.amount) * 100))} gift stays on file. The refund is a separate row against it, totals net it out, and its receipt is voided and reissued for what remains.
        </div>
        {done ? <>
          <div role="status" data-testid="refund-done" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{done}</div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" style={btn(true)} onClick={onClose}>Done</button></div>
        </> : confirm ? <>
          <div role="alert" data-testid="refund-stripe-confirm" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{confirm.sentence}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={btn(false)} onClick={() => setConfirm(null)}>Back</button>
            <button type="button" style={btn(false, true)} disabled={busy} onClick={() => send(true)} data-testid="refund-stripe-yes">{busy ? "Refunding…" : `Refund ${usd(confirm.cents)}`}</button>
          </div>
        </> : <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label><span style={lbl}>Amount ($), up to {usd(leftCents)}</span>
              <input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} data-testid="refund-amount" style={inp} autoFocus /></label>
            <label><span style={lbl}>Date</span>
              <DateInput value={f.date} onChange={e => setF({ ...f, date: e.target.value })} data-testid="refund-date" style={inp} /></label>
          </div>
          <label><span style={lbl}>Reason</span>
            <input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="Donor asked; charged twice; event cancelled…" data-testid="refund-reason" style={inp} /></label>
          {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
            <button type="button" style={btn(true)} onClick={() => send(false)} disabled={busy} data-testid="refund-save">{busy ? "Saving…" : "Record the refund"}</button>
          </div>
        </>}
      </div>
    </Modal>
  );
}
