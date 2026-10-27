// PRICING-1 · WHAT BILLING SAYS ABOUT PRICE. The band, the record count and
// how it is counted, the price, the next charge, and whether the setup fee was
// paid, all from GET /billing/status. A band change waits for the owner's yes
// here; moving down waits for renewal, on request.
import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { displayDate } from "../../../shared/displayDate";

const usd = n => "$" + Number(n).toLocaleString("en-US");
const day = d => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3, marginBottom: 4 };
const VALUE = { fontSize: 14, fontWeight: 600, color: T.ink };
const NOTE = { fontSize: 13, color: T.ink, lineHeight: 1.55, background: T.bg, border: `1px solid ${T.bg2}`, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" };
const BTN = { background: T.greenMid, border: "none", borderRadius: 8, padding: "8px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" };
const LINK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" };

export function BillingBand({ billing, isAdmin, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!billing || billing.records == null) return null;
  const act = (path, body) => {
    setBusy(true); setErr("");
    apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) })
      .then(() => onChanged && onChanged())
      .catch(e => setErr(e?.message || "That did not work. Nothing changed."))
      .finally(() => setBusy(false));
  };
  const b = billing, per = b.interval === "yearly" ? "/year" : "/month";
  const cell = (label, value, sub, id) => (
    <div data-testid={id}>
      <div style={LABEL}>{label}</div>
      <div style={VALUE}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2, maxWidth: 300, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
  return (
    <div data-testid="billing-band" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        {b.customPrice
          ? cell("Price", b.customPrice.usd === 0 ? "Free" : `${usd(b.customPrice.usd)}/month`,
              b.customPrice.endsOn ? `Your agreed price, until ${displayDate(b.customPrice.endsOn)}.` : "Your agreed price.", "billing-price")
          : cell("Band", b.band ? b.band.label : "Agreed by hand", b.band && b.band.legacy ? "Your earlier plan. It stays until you change it." : null, "billing-band-label")}
        {!b.customPrice && b.priceUsd != null && cell("Price", `${usd(b.priceUsd)}${per}`, null, "billing-price")}
        {cell("Records", Number(b.records).toLocaleString("en-US"), b.recordSentence, "billing-records")}
        {b.nextChargeAt && cell("Next charge", day(b.nextChargeAt), null, "billing-next-charge")}
        {b.setupFee && (b.setupFee.paid || b.setupFee.usd) && cell("Setup fee",
          b.setupFee.paid ? `${usd(b.setupFee.usd)} paid` : "Not charged",
          b.setupFee.paid ? `Charged once, on ${day(b.setupFee.paidAt)}.` : null, "billing-setup")}
      </div>
      {b.notice && (
        <div data-testid="billing-band-notice" style={{ ...NOTE, borderLeft: `3px solid ${T.gold}` }}>
          <span style={{ flex: 1, minWidth: 220 }}>
            {b.notice.monthlyUsd
              ? <>Your records have been over your band two months running. The next band is <strong>{b.notice.label}</strong> at <strong>{usd(b.notice.monthlyUsd)}/month</strong>. {b.notice.agreedAt
                  ? <>You agreed on {day(b.notice.agreedAt)}; it starts on {day(b.notice.effectiveAt)}.</>
                  : <>Nothing changes without your yes, and not before {day(b.notice.effectiveAt)}.</>}</>
              : <>Your records are past our largest band. Nothing changes; reply to our note and we will talk about it together.</>}
          </span>
          {isAdmin && b.notice.monthlyUsd && !b.notice.agreedAt &&
            <button data-testid="billing-band-agree" style={{ ...BTN, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={() => act("/billing/band/agree")}>Agree to the new band</button>}
        </div>
      )}
      {b.downTo ? (
        <div data-testid="billing-band-down" style={NOTE}>
          <span style={{ flex: 1, minWidth: 220 }}>You asked to move to <strong>{b.downTo.label}</strong>. It happens at renewal{b.downTo.at ? <>, on {day(b.downTo.at)}</> : null}.</span>
          {isAdmin && <button style={LINK} disabled={busy} onClick={() => act("/billing/band/move-down", { cancel: true })}>Keep my current band</button>}
        </div>
      ) : b.canMoveDown && isAdmin ? (
        <div data-testid="billing-band-can-down" style={NOTE}>
          <span style={{ flex: 1, minWidth: 220 }}>Your records now fit <strong>{b.countBand.label}</strong>. You can move down at your next renewal.</span>
          <button style={LINK} disabled={busy} onClick={() => act("/billing/band/move-down")}>Move down at renewal</button>
        </div>
      ) : null}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>{err}</div>}
    </div>
  );
}
