// PledgeSchedule.jsx · GIFTS-1. ONE PAYMENT, OR INSTALLMENTS.
//
// The pledge form (Add pledge and its edit) and the grant award step choose
// how the promise is paid: one payment on its due date, or a count of
// installments, how often, from a first due date. The schedule shows before
// saving ("4 × $300, Dec 1, Jan 1, Feb 1, Mar 1") from the same generator the
// server writes with (shared/depositSheet.js generateInstallments, through
// pledgeWrite.js), so what she reads is what is saved: each installment the
// even share to the cent, the remainder on the last.
//
// `value` is { plan: "one" | "many", count, frequency, firstDue }. The body
// the server reads is scheduleBody(value): { dueDate, frequency, installmentCount }.
import { T } from "../shared";
import { apiFetch } from "../../api";
import { generateInstallments, scheduleWords } from "../../../../shared/depositSheet.js";
import DateInput from "../inputs/DateInput";   // POLISH-6: the one date box

export const FREQUENCIES = [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["yearly", "Yearly"]];
// A schedule written elsewhere (a grant paid every six months) keeps its cadence in the edit.
const OTHER = { semiannual: "Every six months" };
export const emptySchedule = firstDue => ({ plan: "one", count: 4, frequency: "monthly", firstDue: firstDue || "" });

// What the pledge routes and the award route read. One payment is one
// installment of the whole on its due date (pledgeWrite's default).
export function scheduleBody(s) {
  if (!s) return {};
  if (s.plan !== "many") return { dueDate: s.firstDue, frequency: undefined, installmentCount: undefined };
  return { dueDate: s.firstDue, firstDue: s.firstDue, frequency: s.frequency, installmentCount: Math.max(2, Number(s.count) || 2) };
}
// An edit's schedule: the pledge's installments laid again from this plan,
// the payments already applied kept (PUT /pledges/:id/installments). One
// payment is one installment of the whole on its due date.
export function savePledgeSchedule(pledgeId, s) {
  const many = s.plan === "many";
  return apiFetch(`/pledges/${pledgeId}/installments`, { method: "PUT", body: JSON.stringify({
    frequency: many ? s.frequency : "monthly", installmentCount: many ? Math.max(2, Number(s.count) || 2) : 1, firstDue: s.firstDue }) });
}
// The rows the server will write, for the preview and the edit's schedule PUT.
export function schedulePlan(s, amount) {
  const cents = Math.round((Number(String(amount == null ? "" : amount).replace(/[$,\s]/g, "")) || 0) * 100);   // "15,000.00" reads as money (POLISH-5)
  if (!s || !(cents > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.firstDue || ""))) return [];
  if (s.plan !== "many") return [{ seq: 1, dueDate: s.firstDue, amountCents: cents }];
  return generateInstallments({ amountCents: cents, frequency: s.frequency, count: Math.max(2, Number(s.count) || 2), firstDue: s.firstDue });
}

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };

export default function PledgeSchedule({ value, onChange, amount, testid = "pledge-schedule", firstLabel }) {
  const s = value || emptySchedule("");
  const set = patch => onChange({ ...s, ...patch });
  const rows = schedulePlan(s, amount);
  const radio = (k, l) => (
    <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5, color: T.ink, cursor: "pointer" }}>
      <input type="radio" name={testid} checked={s.plan === k} onChange={() => set({ plan: k })} data-testid={`${testid}-${k}`} style={{ accentColor: T.greenDk }} />{l}
    </label>);
  return (
    <div data-testid={testid} style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 14, marginBottom: 6 }}>{radio("one", "One payment")}{radio("many", "Installments")}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {s.plan === "many" && <>
          <input aria-label="How many installments" type="number" min={2} max={120} value={s.count} onChange={e => set({ count: e.target.value })}
            data-testid={`${testid}-count`} style={{ ...inp, width: 70 }} />
          <select aria-label="How often" value={s.frequency} onChange={e => set({ frequency: e.target.value })} data-testid={`${testid}-frequency`} style={inp}>
            {[...FREQUENCIES, ...(OTHER[s.frequency] ? [[s.frequency, OTHER[s.frequency]]] : [])].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </>}
        <label style={{ fontSize: 12, color: T.ink3, display: "inline-flex", gap: 6, alignItems: "center" }}>
          {firstLabel || (s.plan === "many" ? "First due" : "Due")}
          <DateInput aria-label={s.plan === "many" ? "First due" : "Due"} value={s.firstDue || ""} onChange={e => set({ firstDue: e.target.value })}
            data-testid={`${testid}-first`} style={inp} />
        </label>
      </div>
      {s.plan === "many" && rows.length > 0 && (
        <div data-testid={`${testid}-preview`} style={{ fontSize: 12.5, color: T.ink, marginTop: 6, lineHeight: 1.5 }}>{scheduleWords(rows)}</div>)}
    </div>
  );
}
