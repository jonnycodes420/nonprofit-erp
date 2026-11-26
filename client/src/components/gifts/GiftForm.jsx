// GiftForm.jsx · GIFTS-3 item 1. ONE GIFT FORM, TWO MODES.
//
// A person's New gift and a gift's Edit were two pieces of code, and the edit
// was missing what the form had: Campaign, Appeal, the fundraiser page, the soft
// credit, tribute and match. Both are this component now, the same fields in the
// same order; `mode` changes only the title, the pledge picker (a new gift can
// pay a pledge) and "Same as last" (a new gift can carry the last one's values).
// State lives with the caller (lib/giftForm.js shapes it); this draws it.
//
// Every picker holds a record only once one is clicked (AttributionField,
// PersonField); text typed and not picked is kept in form.typed and Save says so.
import { T, fmtFull } from "../shared";
import DateInput from "../inputs/LazyDateInput";
import { giftTypeLabel } from "../../../../shared/giftWords.js";
import { orgTodayCivil } from "../../lib/orgToday";
import { displayDate } from "../../../../shared/displayDate";
import { methodChoices, NOT_SET } from "../../../../shared/giftMethods.js";
import AttributionField from "./AttributionField";
import FundField, { emptyFund, fundLinesProblem } from "./FundField";
import EventField from "./EventField";
import PropertyFields from "./PropertyFields";
import PersonField from "./PersonField";
import TributeFields from "./TributeFields";   // THANKS-1 item 5
import SameAsLast from "./SameAsLast";
import { unpickedProblem } from "../../lib/giftForm";
import { NEGATIVE_GIFT_SENTENCE } from "../../lib/amountCheck";   // INPUT-1

const TYPES = ["cash", "check", "credit_card", "stock", "in_kind", "matching", "other"];

export default function GiftForm({ mode = "create", form: f, setForm, pledges = [], giftCfDefs = [], pledgeCoverWords = null,
  saving = false, error = "", onSave, onCancel, moreOpen = false, setMoreOpen = () => {}, testid }) {
  const edit = mode === "edit";
  const tid = testid || (edit ? "gift-edit" : "dp-gift");
  const set = patch => setForm(p => ({ ...p, ...patch }));
  const typed = k => t => setForm(p => ((p.typed || {})[k] || "") === t ? p : { ...p, typed: { ...(p.typed || {}), [k]: t } });
  const fs = edit ? 12 : 13;
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: edit ? "6px 8px" : "8px 10px", color: T.ink, fontSize: fs, outline: "none", boxSizing: "border-box", width: "100%", fontFamily: "inherit" };
  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 3, display: "block" };
  const c = f.carried || {}, same = (k, v) => !edit && !!(c[k] && v && (c[k].id ? c[k].id === v.id : c[k] === v));
  const pickAttr = k => v => setForm(p => ({ ...p, [k]: v, ...(k === "campaign" ? { campaign_id: v ? v.id || "" : "" } : {}), typed: { ...(p.typed || {}), [k]: "" } }));
  const pickPerson = k => v => setForm(p => ({ ...p, [k]: v, typed: { ...(p.typed || {}), [k]: "" } }));
  const open = pledges.filter(p => p.status === "open");
  const problem = fundLinesProblem(f.amount, f.fund) || "";
  const unpicked = unpickedProblem(f);
  const cover = !edit && f.pledgeId && pledgeCoverWords ? pledgeCoverWords(open.find(x => x.id === f.pledgeId), f.amount) : "";
  const hasExtras = !!(f.sc || f.trib || f.match || f.tribType);
  const amountSaid = error === NEGATIVE_GIFT_SENTENCE;   // INPUT-1: said under the Amount, not at the foot of the form

  return (
    <div data-testid={edit ? "gift-edit-form" : "dp-add-gift-form"} data-mode={mode}
      ref={edit ? undefined : el => { if (el && !el.dataset.shown) { el.dataset.shown = "1"; el.scrollIntoView({ block: "center" }); } }}
      style={edit ? { padding: "4px 0" } : { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "16px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 10 }}>{edit ? "Edit gift" : "New Gift"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 8 }}>
        <label><span style={lbl}>Amount</span>
          {/* GIFTS-3 item 3: the amount is text in whole cents, never a browser's float.
              INPUT-1: a minus stays as typed, so Save can say why it won't take it (it used to vanish). */}
          <input value={f.amount} onChange={e => set({ amount: e.target.value.replace(/[^0-9.,$-]/g, "") })} placeholder={edit ? "Amount" : "Amount ($)"}
            inputMode="decimal" autoComplete="off" data-testid={tid + "-amount"} aria-invalid={amountSaid ? "true" : undefined} style={inp} />
          {amountSaid && <span role="alert" data-testid={tid + "-amount-error"} style={{ display: "block", fontSize: 12, color: T.ink, background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 8, padding: "5px 8px", marginTop: 4 }}>{error}</span>}</label>
        <label><span style={lbl}>Date</span>
          <DateInput value={f.date} onChange={e => set({ date: e.target.value })} style={inp} /></label>
        <label><span style={lbl}>Type</span>
          <select value={f.type} onChange={e => set({ type: e.target.value })} style={inp} data-testid={tid + "-type"}>
            {(TYPES.includes(f.type) ? TYPES : [f.type, ...TYPES]).map(t => <option key={t} value={t}>{giftTypeLabel(t)}</option>)}
          </select></label>
        <label><span style={lbl}>Method</span>
          <select value={f.payment_method || ""} onChange={e => set({ payment_method: e.target.value })} style={inp} data-testid={tid + "-method"}>
            <option value="">{NOT_SET}</option>
            {methodChoices(f.payment_method).map(m => <option key={m} value={m}>{m}</option>)}
          </select></label>
      </div>
      <input value={f.notes || ""} onChange={e => set({ notes: e.target.value })} placeholder="Notes" data-testid={tid + "-notes"} style={{ ...inp, marginBottom: 8 }} />
      <PropertyFields form={f} setForm={setForm} compact={edit} testid={edit ? "gift-edit-property" : "dp-gift-property"} />
      {!edit && <SameAsLast testid="dp-gift" carried={{ date: same("date", f.date) && f.date, method: same("method", f.payment_method) && f.payment_method, fund: c.fund && f.fund && !f.fund.split && c.fund.fund_id === f.fund.fund_id && f.fund }}
        onClear={k => setForm(p => ({ ...p, ...(k === "date" ? { date: orgTodayCivil() } : k === "method" ? { payment_method: "" } : { fund: emptyFund() }), carried: { ...(p.carried || {}), [k]: null } }))} />}
      <AttributionField kind="campaign" value={f.campaign || null} sticky={same("campaign", f.campaign)} date={f.date} compact={edit} testid={tid + "-campaign"} onChange={pickAttr("campaign")} onTyped={typed("campaign")} style={{ marginTop: 8, marginBottom: 2 }} />
      <div style={{ fontSize: 11, color: T.ink3, marginBottom: 8, lineHeight: 1.4 }}>Which goal this counts toward. It updates that campaign's thermometer live.</div>
      <AttributionField kind="appeal" value={f.appeal || null} sticky={same("appeal", f.appeal)} campaignId={(f.campaign && f.campaign.id) || null} compact={edit} testid={tid + "-appeal"} onChange={pickAttr("appeal")} onTyped={typed("appeal")} style={{ marginBottom: 8 }} />
      <AttributionField kind="page" value={f.page || null} sticky={same("page", f.page)} compact={edit} testid={tid + "-page"} onChange={pickAttr("page")} onTyped={typed("page")} style={{ marginBottom: 8 }} />
      <FundField value={f.fund} amount={f.amount} onChange={v => set({ fund: v })} testid={edit ? "gift-edit-fund" : "gift-fund"} compact={edit} style={{ marginBottom: 8 }} />
      <EventField value={f.eventId || ""} onChange={id => set({ eventId: id })} testid={edit ? "gift-edit-event" : undefined} style={{ marginBottom: 8 }} />
      {!edit && open.length > 0 && (
        <select value={f.pledgeId || ""} onChange={e => set({ pledgeId: e.target.value })} style={{ ...inp, border: "1px solid " + T.terracotta + "50", marginBottom: 8 }}>
          <option value="">Not fulfilling a pledge</option>
          {open.map(p => <option key={p.id} value={p.id}>Fulfills the {fmtFull(p.amount)} pledge{p.summary && p.summary.nextDue ? ` · next ${fmtFull(p.summary.nextAmount)} due ${displayDate(p.summary.nextDue)}` : ""}</option>)}
        </select>)}
      {cover ? <div data-testid="dp-pledge-cover" role="status" style={{ fontSize: 12, color: T.ink2, marginTop: -2, marginBottom: 8, lineHeight: 1.4 }}>{cover}</div> : null}
      {giftCfDefs.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {giftCfDefs.map(d => d.type === "select" ? (
            <select key={d.key} value={(f.customFields || {})[d.key] || ""} onChange={e => setForm(p => ({ ...p, customFields: { ...(p.customFields || {}), [d.key]: e.target.value } }))} title={d.label} style={{ ...inp, width: 140 }}>
              <option value="">{d.label}…</option>
              {(d.options || []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input key={d.key} value={(f.customFields || {})[d.key] || ""} onChange={e => setForm(p => ({ ...p, customFields: { ...(p.customFields || {}), [d.key]: e.target.value } }))} placeholder={d.label} title={d.label} style={{ ...inp, width: 140 }} />
          ))}
        </div>)}
      {/* BUILD-98 Part 1 — closed by default: most gifts are none of these. */}
      <button type="button" onClick={() => setMoreOpen(o => !o)} data-testid={edit ? "gift-edit-more-toggle" : "gift-more-toggle"}
        style={{ background: "transparent", border: "none", padding: "2px 0", color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8, fontFamily: "inherit" }}>
        {moreOpen || hasExtras ? "Hide soft credit, tribute and match" : "Soft credit, tribute or matching gift"}
      </button>
      {(moreOpen || hasExtras) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <PersonField label="Soft credit to" value={f.sc || null} onChange={pickPerson("sc")} onTyped={typed("sc")} compact={edit} testid={edit ? "gift-edit-sc" : "gift-sc-name"} />
          <input value={f.scAmount || ""} onChange={e => set({ scAmount: e.target.value })} placeholder="Soft credit amount (blank = whole gift)" inputMode="decimal" style={inp} />
          <TributeFields form={f} set={set} pickPerson={pickPerson} typed={typed} inp={inp} compact={edit} testid={edit ? "gift-edit-trib" : "gift-trib"} />   {/* THANKS-1: one piece with Record a gift */}
          <PersonField label="Employer that will match it" value={f.match || null} onChange={pickPerson("match")} onTyped={typed("match")} compact={edit} testid={edit ? "gift-edit-match" : "gift-match-employer"} />
          <input value={f.matchAmount || ""} onChange={e => set({ matchAmount: e.target.value })} placeholder="Expected match (blank = same amount)" inputMode="decimal" style={inp} />
        </div>)}
      {((error && !amountSaid) || unpicked || problem) && <div role="alert" data-testid={tid + "-error"} style={{ fontSize: 12, color: T.ink, background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>{(amountSaid ? "" : error) || unpicked || problem}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.ink, cursor: "pointer" }}>
          <input type="checkbox" checked={!!f.thanked} onChange={e => set({ thanked: e.target.checked })} data-testid={tid + "-thanked"} style={{ accentColor: T.greenDk }} />
          Thanked
        </label>
        {/* GIFTS-3 item 6: the gift stays theirs; public lists say Anonymous */}
        <label title="The gift stays on their record. Public recognition and acknowledgment lists say Anonymous." style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.ink, cursor: "pointer" }}>
          <input type="checkbox" checked={!!f.anonymous} onChange={e => set({ anonymous: e.target.checked })} data-testid={tid + "-anonymous"} style={{ accentColor: T.greenDk }} />
          Anonymous
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onSave} disabled={saving || !!problem} data-testid={edit ? "gift-edit-save" : "dp-add-gift-save"}
          style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: edit ? "6px 12px" : "8px 16px", color: T.white, fontSize: fs, fontWeight: 700, cursor: "pointer", opacity: (saving || problem) ? 0.5 : 1, fontFamily: "inherit" }}>Save</button>
        <button type="button" onClick={onCancel} data-testid={edit ? "gift-edit-cancel" : "dp-add-gift-cancel"}
          style={{ background: T.bg, border: "none", borderRadius: 8, padding: edit ? "6px 12px" : "8px 14px", color: T.ink3, fontSize: fs, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
      </div>
    </div>
  );
}
