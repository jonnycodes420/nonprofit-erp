// client/src/components/profile/OfflinePlans.jsx · PLEDGES-2. RECURRING PLANS
// STAFF RECORD BY HAND (W-1107-Finance-24 and -23).
//
// An offline commitment (a check every month, a bank draft, payroll giving) is
// recorded here: the amount, how often, a start, an optional end and a fund.
// Each plan says its next expected date, Behind when a payment is late, and its
// payment history; payments are added here, or gifts already on file are made
// payments of it. Cancel asks first. A card plan through Stripe is the donor's
// own (its card above reads "Card on file · Stripe"); this one reads
// "Recorded by staff · offline". The server computes every date and state.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { askConfirm } from "../ConfirmDialog";
import { T, fmtFull } from "../shared";
import { displayDate } from "../../../../shared/displayDate";
import { orgTodayCivil } from "../../lib/orgToday";
import { told } from "../../lib/stewardTold";
import { useChanged } from "../../lib/changes";
import { countLabel } from "../../../../shared/countWords.js";
import DateInput from "../inputs/DateInput";   // POLISH-6: the one date box

const FREQS = [["monthly", "Monthly"], ["weekly", "Weekly"], ["quarterly", "Quarterly"], ["annually", "Annually"]];
const STATE = { active: { label: "On track", color: T.greenDk }, behind: { label: "Behind", color: T.gold700 },
                complete: { label: "Complete", color: T.ink3 }, cancelled: { label: "Cancelled", color: T.ink3 } };
const input = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12, outline: "none" };
const btn = (primary) => ({ background: primary ? T.greenDk : T.bg, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px",
  color: primary ? T.white : T.ink2, fontSize: 12, fontWeight: 700, cursor: "pointer" });

export default function OfflinePlans({ donorId, isReadOnly, giftsFull = [] }) {
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState(null);
  const [funds, setFunds] = useState([]);
  const [pay, setPay] = useState(null);       // { planId, date, amount }
  const [convert, setConvert] = useState(null); // { planId, ids: Set }
  const [err, setErr] = useState("");
  const load = () => apiFetch(`/donors/${encodeURIComponent(donorId)}/offline-plans`)
    .then(r => setPlans(r.plans || [])).catch(() => setPlans([]));
  useEffect(() => { setPlans(null); setForm(null); setPay(null); setConvert(null); load(); }, [donorId]);
  useChanged(["gift"], load);
  const openForm = () => {
    setForm({ amount: "", frequency: "monthly", startDate: orgTodayCivil(), endDate: "", fundId: "", method: "check" });
    if (!funds.length) apiFetch("/finance/funds").then(r => setFunds(Array.isArray(r) ? r : [])).catch(() => {});
  };
  const act = async (fn) => { setErr(""); try { await fn(); told({ donorId, gift: true }); await load(); } catch (e) { setErr(errorMessage(e, "That did not save.")); } };
  const save = () => act(async () => {
    await apiFetch(`/donors/${encodeURIComponent(donorId)}/offline-plans`, { method: "POST", body: JSON.stringify({ ...form, endDate: form.endDate || undefined, fundId: form.fundId || undefined }) });
    setForm(null);
  });
  const addPayment = () => act(async () => {
    await apiFetch(`/offline-plans/${pay.planId}/payments`, { method: "POST", body: JSON.stringify({ date: pay.date, amount: pay.amount, idempotencyKey: pay.key }) });
    setPay(null);
  });
  const doConvert = () => act(async () => {
    await apiFetch(`/offline-plans/${convert.planId}/convert`, { method: "POST", body: JSON.stringify({ giftIds: [...convert.ids] }) });
    setConvert(null);
  });
  const cancel = async (p) => {
    if (!(await askConfirm({ title: "Cancel this recurring plan?", body: `Cancel the plan of ${fmtFull(p.amount)} ${p.every}? Payments already recorded stay; no more are expected.`, yes: "Cancel the plan", no: "Keep it", danger: true }))) return;
    act(() => apiFetch(`/offline-plans/${p.id}/cancel`, { method: "POST", body: JSON.stringify({ confirmed: true }) }));
  };
  const convertible = giftsFull.filter(g => Number(g.amount) > 0 && !g.pledge_id && !g.recurring_subscription_id && !g.offline_plan_id);
  if (plans === null) return null;
  return (
    <div data-testid="dp-offline-plans" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>Recurring plans recorded by staff</div>
        {!isReadOnly && !form && <button type="button" data-testid="offline-plan-new" onClick={openForm} style={btn(false)}>+ Record a recurring plan</button>}
      </div>
      {err && <div role="alert" style={{ fontSize: 12, color: T.ink, marginBottom: 6 }}>{err}</div>}
      {form && <div data-testid="offline-plan-form" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: 14, marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Amount" placeholder="Amount ($)" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={{ ...input, width: 110 }} />
        <select aria-label="How often" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} style={input}>{FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label style={{ fontSize: 12, color: T.ink3 }}>From <DateInput aria-label="Start date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} style={input} /></label>
        <label style={{ fontSize: 12, color: T.ink3 }}>Until <DateInput aria-label="End date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} style={input} /></label>
        <select aria-label="Fund" value={form.fundId} onChange={e => setForm({ ...form, fundId: e.target.value })} style={input}>
          <option value="">No fund</option>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select aria-label="Paid by" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} style={input}>
          {[["check", "Check"], ["bank draft", "Bank draft"], ["payroll", "Employer payroll"], ["cash", "Cash"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button type="button" data-testid="offline-plan-save" onClick={save} disabled={!(Number(form.amount) > 0) || !form.startDate} style={btn(true)}>Save plan</button>
        <button type="button" onClick={() => setForm(null)} style={{ ...btn(false), border: "none" }}>Cancel</button>
      </div>}
      {!plans.length && !form && <div style={{ fontSize: 12, color: T.ink3, fontStyle: "italic" }}>None. Record one for a check every month, a bank draft or a payroll gift.</div>}
      {plans.map(p => {
        const st = STATE[p.status] || STATE.active;
        return (
          <div key={p.id} id={`offline-plan-${p.id}`} data-testid="offline-plan" style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: "3px solid " + st.color, borderRadius: 10, padding: "10px 14px", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{fmtFull(p.amount)} {p.every}</span>
              <span data-testid="offline-plan-state" style={{ background: st.color + "15", color: st.color, border: "1px solid " + st.color + "40", borderRadius: 99, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>{st.label}</span>
              <span style={{ fontSize: 11, color: T.ink3 }}>{p.label}{p.method ? ` · ${p.method}` : ""}{p.fund_name ? ` · ${p.fund_name}` : ""}</span>
            </div>
            <div data-testid="offline-plan-sentence" style={{ fontSize: 12, color: T.ink2, marginTop: 4 }}>{p.sentence}</div>
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>From {displayDate(p.start_date)}{p.end_date ? ` to ${displayDate(p.end_date)}` : ""} · {countLabel(p.paidCount, "payment")} recorded</div>
            {p.payments.length > 0 && <div data-testid="offline-plan-payments" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {p.payments.map(g => <span key={g.giftId} style={{ fontSize: 11, background: T.bg, borderRadius: 6, padding: "2px 7px", color: T.ink2 }}>{displayDate(g.date)} · {fmtFull(g.amount)}</span>)}</div>}
            {!isReadOnly && p.status !== "cancelled" && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {pay && pay.planId === p.id
                ? <>
                    <DateInput aria-label="Payment date" value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} style={input} />
                    <input aria-label="Payment amount" type="number" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} style={{ ...input, width: 100 }} />
                    <button type="button" data-testid="offline-plan-pay-save" onClick={addPayment} style={btn(true)}>Record payment</button>
                    <button type="button" onClick={() => setPay(null)} style={{ ...btn(false), border: "none" }}>Cancel</button>
                  </>
                : <button type="button" data-testid="offline-plan-pay" onClick={() => setPay({ planId: p.id, date: orgTodayCivil(), amount: String(p.amount), key: crypto.randomUUID() })} style={btn(true)}>Add payment</button>}
              {convertible.length > 0 && !(convert && convert.planId === p.id) &&
                <button type="button" onClick={() => setConvert({ planId: p.id, ids: new Set() })} style={btn(false)}>Make gifts on file payments of it</button>}
              {p.status !== "complete" && <button type="button" data-testid="offline-plan-cancel" onClick={() => cancel(p)} style={btn(false)}>Cancel plan</button>}
            </div>}
            {convert && convert.planId === p.id && <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {convertible.slice(0, 24).map(g => <label key={g.id} style={{ fontSize: 12, color: T.ink2 }}>
                <input type="checkbox" checked={convert.ids.has(g.id)} onChange={e => { const ids = new Set(convert.ids); if (e.target.checked) ids.add(g.id); else ids.delete(g.id); setConvert({ ...convert, ids }); }} />{" "}
                {displayDate(g.date)} · {fmtFull(g.amount)}</label>)}
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={doConvert} disabled={!convert.ids.size} style={btn(true)}>{convert.ids.size ? `Make ${countLabel(convert.ids.size, "payment")} of this plan` : "Pick the gifts"}</button>
                <button type="button" onClick={() => setConvert(null)} style={{ ...btn(false), border: "none" }}>Cancel</button>
              </div>
            </div>}
          </div>
        );
      })}
    </div>
  );
}
