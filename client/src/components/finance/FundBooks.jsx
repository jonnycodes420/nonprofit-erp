// LEDGER-3 item 4 · A FUND'S TWO NUMBERS, EACH NAMED. "Received this fiscal
// year (gifts)" is Reports' Gifts by fund figure; "Balance (books)" is the
// ledger; the gifts waiting to post are a figure that opens them
// (shared/numbers/fundBooks.js). The Default chip marks the org's one default
// fund (shared/numbers/defaultFund.js).
import { T, fmtFull } from "../shared";
import { Figure } from "../Figure";

// SWEEP-5: the fund cards' definitions arrive keyed by field; a person reads
// the words, never "inPeriod.". (Moved here from Finance.jsx by LEDGER-3.)
export const FUND_DEF_WORDS = { received: "Received this fiscal year (gifts)", waiting: "Waiting to post", balance: "Balance (books)", gifts: "Gifts to this fund", inPeriod: "In this period", restrictedBy: "Restricted by" };

export function FundDefaultChip({ f }) {
  if (!f.isDefault) return null;
  return <span data-testid="fund-default" title="Default: a gift that names no fund goes here." style={{ fontSize:11, fontWeight:700, borderRadius:99, padding:"2px 9px", background:T.bg2, color:T.ink }}>Default</span>;
}

// The card is a link to the fund's rows. A figure inside it opens its own rows:
// its click, and every click in the dialog it opens (portaled, but React
// bubbles it up the component tree), must not open the card too. Only the
// figure's own button is kept from following the card's link.
function Hold({ children, ...rest }) {
  return <span {...rest} onClick={e => {
    e.stopPropagation();
    if (e.currentTarget.contains(e.target) && e.target.closest && e.target.closest("[data-figure]")) e.preventDefault();
  }}>{children}</span>;
}

export function FundBooksLines({ f, defs = {} }) {
  return (
    <>
      {f.received && (
        <div data-testid="fund-received" style={{ fontSize:12.5, color:T.ink2, marginTop:8, display:"flex", justifyContent:"space-between", gap:8 }}>
          <span>Received this fiscal year (gifts)</span>
          <Hold style={{ fontWeight:700, color:T.ink }}><Figure variant="inline" kind="money" value={f.received.amount} label={`${f.name}, received this fiscal year`} definition={defs.received} source={f.received.source}/></Hold>
        </div>
      )}
      <div style={{ fontSize:12.5, color:T.ink2, marginTop:6 }}>Balance (books)</div>
      <div data-testid="fund-balance" style={{ fontSize:26, fontWeight:800, color:T.ink, fontFamily:"'DM Serif Display',serif", lineHeight:1.15 }}>{fmtFull(f.balance)}</div>
      {f.balanceWords && <div data-testid="fund-balance-words" style={{ fontSize:12, color:T.ink3, marginTop:2 }}>{f.balanceWords}</div>}
      {f.waiting && f.waiting.cents !== 0 && (
        <div data-testid="fund-waiting" style={{ fontSize:12.5, color:T.ink2, marginTop:4 }}>
          <Hold><Figure variant="inline" kind="money" value={f.waiting.amount} label={`${f.name}, waiting to post`} definition={defs.waiting} source={f.waiting.source}/></Hold>
          {` in ${f.waiting.count === 1 ? "1 gift" : `${f.waiting.count.toLocaleString("en-US")} gifts`} not on the books yet.`}
        </div>
      )}
      <FundGapLines f={f} name={f.name}/>
    </>
  );
}

// NUMBERS-9 item 1 (W-1122-Finance-F7): gifts on the books beside transactions in. The sentence says
// whether they agree, and each part of any difference is a figure that opens its rows
// (shared/numbers/fundGap.js). The card and the dialog show the same server words.
export function FundGapLines({ f, name }) {
  if (!f || !f.gapWords) return null;
  return (
    <div data-testid="fund-gap" style={{ fontSize:12, color:T.ink3, marginTop:4, lineHeight:1.5 }}>
      <div data-testid="fund-gap-words">{f.gapWords}</div>
      {(f.gapLines || []).map(l => (
        <div key={l.kind} data-testid={`fund-gap-${l.kind}`} style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
          <span>{l.label} ({l.n.toLocaleString("en-US")})</span>
          <Hold style={{ fontWeight:700, color:T.ink }}><Figure variant="inline" kind="money" value={l.cents / 100} label={`${name}, ${l.label.toLowerCase()}`} source={l.source}/></Hold>
        </div>
      ))}
    </div>
  );
}

export function NoFundLine({ noFund }) {
  if (!noFund) return null;
  return <div data-testid="fund-no-fund" style={{ fontSize:12.5, color:T.ink2 }}><Figure variant="inline" kind="money" value={noFund.amount} label="Gifts that name no fund" definition={noFund.sentence} source={noFund.source}/>{` ${noFund.sentence}`}</div>;
}
