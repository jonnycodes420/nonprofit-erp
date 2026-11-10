// DepositLineExtras.jsx · QUICKADD-1. WHAT EACH DEPOSIT-SHEET LINE CAME FROM, AND WHO.
//
// Six Good Giving Challenge donors on one sheet: line 1 names the campaign and
// the fundraiser, and lines 2 to 6 read "Same as last" until she says
// otherwise (× clears one line's value, and the lines under it follow). A line
// for somebody new can carry their email, phone and address; a line Steward
// matched to somebody on file can be made "+ New person" instead.
//
// carriedAttribution() is the one rule for what a line carries, used by the
// screen and by the commit body alike, so what is shown is what is sent.
import { useState } from "react";
import { T } from "../shared";
import AttributionField from "./AttributionField";

export const ATTR_KINDS = ["campaign", "appeal", "page"];

// lines: the plan's lines in order. chosen: { [line]: { campaign?, appeal?, page? } }
// where a key present with null means "cleared on this line".
// Answers { [line]: { campaign: { value, sticky }, ... } } for the gift lines.
export function carriedAttribution(lines, chosen) {
  const out = {}, last = { campaign: null, appeal: null, page: null };
  for (const l of lines || []) {
    if (l.state !== "placed" && l.state !== "placed_new_donor") continue;
    const mine = chosen[l.line] || {}, row = {};
    for (const k of ATTR_KINDS) {
      if (k in mine) { row[k] = { value: mine[k], sticky: false }; last[k] = mine[k]; }
      else row[k] = { value: last[k], sticky: !!last[k] };
    }
    out[l.line] = row;
  }
  return out;
}

// The commit's per-line fields for one line.
export function attributionBody(row) {
  if (!row) return {};
  const v = k => row[k] && row[k].value;
  return {
    campaignId: (v("campaign") && v("campaign").id) || undefined,
    appealId: (v("appeal") && v("appeal").id) || undefined,
    givingPageId: (v("page") && v("page").givingPageId) || undefined,
    peerFundraiserId: (v("page") && v("page").peerFundraiserId) || undefined,
  };
}

const small = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", color: T.ink, fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box", minWidth: 0, width: "100%" };

export default function DepositLineExtras({ line, row, depositDate, onPick, person, onPerson }) {
  const [open, setOpen] = useState(!!person);
  const isNew = line.state === "placed_new_donor";
  const set = k => e => onPerson({ ...(person || {}), [k]: e.target.value });
  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, maxWidth: 680 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ATTR_KINDS.map(k => (
          <AttributionField key={k} kind={k} compact style={{ flex: "1 1 190px", minWidth: 0, maxWidth: "100%" }} value={row && row[k] ? row[k].value : null} sticky={!!(row && row[k] && row[k].sticky)}
            date={depositDate} campaignId={row && row.campaign && row.campaign.value ? row.campaign.value.id : null}
            testid={`deposit-${k}-${line.line}`} onChange={v => onPick(k, v)} />))}
      </div>
      {isNew && !open && (
        <button type="button" data-testid={`deposit-np-open-${line.line}`} onClick={() => setOpen(true)}
          style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
          Add their email, phone and address</button>)}
      {isNew && open && (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 6 }}>
          <input aria-label={`Email for line ${line.line}`} placeholder="Email" value={(person && person.email) || ""} onChange={set("email")} data-testid={`deposit-np-email-${line.line}`} style={small} />
          <input aria-label={`Phone for line ${line.line}`} placeholder="Phone" value={(person && person.phone) || ""} onChange={set("phone")} data-testid={`deposit-np-phone-${line.line}`} style={small} />
          <input aria-label={`Street address for line ${line.line}`} placeholder="Street address" value={(person && person.address) || ""} onChange={set("address")} data-testid={`deposit-np-address-${line.line}`} style={small} />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 6 }}>
            <input aria-label={`City for line ${line.line}`} placeholder="City" value={(person && person.city) || ""} onChange={set("city")} style={small} />
            <input aria-label={`State for line ${line.line}`} placeholder="State" value={(person && person.state) || ""} onChange={set("state")} style={small} />
            <input aria-label={`ZIP for line ${line.line}`} placeholder="ZIP" value={(person && person.zip) || ""} onChange={set("zip")} style={small} />
          </div>
        </div>)}
    </div>
  );
}
