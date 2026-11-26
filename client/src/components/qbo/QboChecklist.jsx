// HONEST-1 item 3 · QUICKBOOKS HAS ONE CHECKLIST. "Mapping blocks it and there is no single
// checklist of what remains." Until the first gift is sent, the QuickBooks panel opens with what is
// left, each row mappable where it stands: the account the money lands in, each fund with no income
// account (these hold gifts back, qboSync.mappingGaps), and the campaigns with no account of their
// own (optional: their gifts land on their fund's account). Save writes the same PUT /qbo/mapping
// the full mapping below writes; nothing here is a second way to map.
import { useState } from "react";
import { T } from "../shared";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3 };
const row = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "7px 0", borderTop: "1px solid " + T.bg2, fontSize: 13, color: T.ink };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3,
  color: primary ? T.white : T.ink, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

// d: GET /qbo · m: the mapping being edited · lists: POST /qbo/lists (null until asked) ·
// Pick: QboSync's account picker · setMap / setPart: QboSync's edits · loadLists, save: its calls
export default function QboChecklist({ d, m, can, lists, loadLists, Pick, setMap, setPart, save, busy }) {
  const [showCampaigns, setShowCampaigns] = useState(false);
  const sentAny = !!(d.sent && d.sent.gifts > 0);
  const gapNames = new Set((d.mappingGaps && d.mappingGaps.funds) || []);
  const funds = (d.funds || []).filter(f => gapNames.has(f.name) && !((m.funds || {})[f.id] || {}).accountId);
  const noDeposit = !m.depositAccount;
  const campaigns = (d.campaigns || []).filter(c => !((m.campaigns || {})[c.id] || {}).accountId);
  if (sentAny && !funds.length && !noDeposit) return null;   // nothing left that holds a gift back

  const income = lists ? (lists.income && lists.income.length ? lists.income : lists.accounts) : null;
  const deposit = lists ? (lists.deposit && lists.deposit.length ? lists.deposit : lists.accounts) : null;
  const left = funds.length + (noDeposit ? 1 : 0);
  const pick = (list, v, onChange, placeholder, testid) => lists
    ? <Pick list={list} value={v && v.accountId !== undefined ? v.accountId : v && v.id} name={v && (v.accountName || v.name)} disabled={!can}
        placeholder={placeholder} onChange={onChange} testid={testid} />
    : null;

  return (
    <div data-testid="qbo-checklist" style={{ marginTop: 12, padding: "10px 12px", background: T.bg, borderRadius: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ ...h, color: T.ink }}>{sentAny ? "Still to map" : "Before your first gift posts"}</div>
        {can && !lists && left > 0 && <button type="button" data-testid="qbo-checklist-load" style={{ ...btn(false), marginLeft: "auto" }} onClick={loadLists}>Choose accounts</button>}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>
        {left ? `${left} ${left === 1 ? "thing holds" : "things hold"} gifts back. Map ${left === 1 ? "it" : "them"} here and those gifts can go.`
          : "Everything that holds a gift back is mapped. Press Sync, or turn auto-sync on."}
      </div>
      {noDeposit && <div data-testid="qbo-checklist-row" data-kind="deposit" style={row}>
        <span style={{ flex: "1 1 200px", minWidth: 0 }}>Where the money lands</span>
        {pick(deposit, m.depositAccount, x => setMap({ depositAccount: x }), "Deposit account", "qbo-checklist-deposit")}
      </div>}
      {funds.map(f => (
        <div key={f.id} data-testid="qbo-checklist-row" data-kind="fund" data-name={f.name} style={row}>
          <span style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>Fund: {f.name}</span>
          {pick(income, (m.funds || {})[f.id], x => setPart("funds", f.id, { accountId: x ? x.id : null, accountName: x ? x.name : null }), "Income account", "qbo-checklist-fund")}
        </div>))}
      {campaigns.length > 0 && <div style={{ ...row, color: T.ink3 }}>
        <span style={{ flex: "1 1 240px", minWidth: 0 }}>
          {campaigns.length} {campaigns.length === 1 ? "campaign has" : "campaigns have"} no account of {campaigns.length === 1 ? "its" : "their"} own. That's optional: their gifts land on their fund's account.
        </span>
        <button type="button" data-testid="qbo-checklist-campaigns" style={btn(false)} onClick={() => setShowCampaigns(v => !v)}>{showCampaigns ? "Hide" : "Show them"}</button>
      </div>}
      {showCampaigns && campaigns.map(c => (
        <div key={c.id} data-testid="qbo-checklist-row" data-kind="campaign" data-name={c.name} style={row}>
          <span style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>Campaign: {c.name}</span>
          {pick(income, (m.campaigns || {})[c.id], x => setPart("campaigns", c.id, { accountId: x ? x.id : null, accountName: x ? x.name : null }), "Income account (optional)", "qbo-checklist-campaign")}
        </div>))}
      {can && lists && <div style={{ marginTop: 8 }}>
        <button type="button" data-testid="qbo-checklist-save" disabled={busy === "save"} style={btn(true)} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>}
    </div>);
}
