// client/src/components/settings/BillingMore.jsx · HONEST-2 item 3 (W-1126-Integrations-03).
//
// Settings → Billing's lower half: the invoices (GET /billing/invoices, Stripe's own pages for each)
// and the one way to change plans. Steward publishes no prices, so a plan change is a conversation:
// "Talk to Jonathan about changing plans" opens an email to him. Nothing in the app links to a
// public pricing page.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";
import { displayDate } from "../../../../shared/displayDate";

export const PLAN_TALK_HREF = "mailto:jonathan@stewardapp.dev?subject=" + encodeURIComponent("Changing our Steward plan");
export const PLAN_TALK_LABEL = "Talk to Jonathan about changing plans";

const money = (cents, cur) => (cur && cur !== "USD" ? cur + " " : "$") + (Math.round(Number(cents) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_WORD = { paid: "Paid", open: "Due", void: "Voided", uncollectible: "Not collected" };

export function PlanTalkLink({ style }) {
  return <a data-testid="billing-talk" href={PLAN_TALK_HREF} style={{ display: "inline-block", background: T.white, border: "1px solid " + T.ink, borderRadius: 8,
    padding: "9px 18px", color: T.ink, fontSize: 13, fontWeight: 700, textDecoration: "none", ...style }}>{PLAN_TALK_LABEL}</a>;
}

export function BillingInvoices({ isAdmin }) {
  const [data, setData] = useState(null);
  useEffect(() => { if (isAdmin) apiFetch("/billing/invoices").then(setData).catch(() => setData({ invoices: [], sentence: "Steward couldn't read your invoices just now." })); }, [isAdmin]);
  if (!isAdmin) return null;
  return (
    <div data-testid="billing-invoices" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 28px", marginTop: 16 }}>
      <SectionLabel>Invoices</SectionLabel>
      {!data ? <div style={{ fontSize: 13, color: T.ink3 }}>Reading your invoices…</div>
        : data.invoices.length ? data.invoices.map((i, k) => (
          <div key={i.id} data-testid="billing-invoice" style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "9px 0", borderTop: k ? "1px solid " + T.bg3 : "none", fontSize: 13 }}>
            <span style={{ width: 110, color: T.ink }}>{i.date ? displayDate(i.date) : ""}</span>
            <span style={{ flex: 1, minWidth: 120, color: T.ink3 }}>{i.number || "Invoice"}{STATUS_WORD[i.status] ? ` · ${STATUS_WORD[i.status]}` : ""}</span>
            <span style={{ fontWeight: 700, color: T.ink }}>{money(i.amountCents, i.currency)}</span>
            {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" style={{ color: T.greenDk, fontWeight: 700, textDecoration: "none" }}>Open</a>}
          </div>))
        : <div data-testid="billing-invoices-none" style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55 }}>{data.sentence}</div>}
    </div>);
}
