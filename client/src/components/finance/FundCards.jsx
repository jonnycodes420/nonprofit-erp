// client/src/components/finance/FundCards.jsx · FIN-1, LEDGER-3, NUMBERS-8. ONE CARD PER FUND, AND
// THE DIALOG IT OPENS. Moved out of Finance.jsx (NUMBERS-8): the card and the dialog read the same
// server function (shared/numbers/fundCard.js), so the balance on the card is the dialog's title,
// and the dialog's sentence says what each of its figures counts.
import { useState, useEffect } from "react";
import { useChanged } from "../../lib/changes";
import { T, fmtFull, Card, EmptyState, Modal } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { DonorLink, RecordLink, useUrlWriter } from "../RecordLink";
import { tabHref, urlParam } from "../../lib/appUrls";
import { FundDefaultChip, FundBooksLines, NoFundLine, FUND_DEF_WORDS } from "./FundBooks";

const IN = T.ink;
const OUT = T.terracotta;

// FIN-1 — one card per fund. Balance, in and out this period, the
// restriction, and WHO restricted it.
export function FinFundCards() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const goUrl = useUrlWriter();
  const fundHref = id => tabHref("finance", { subtab: "funds", fundId: id || null });
  // FEEL-1: the cards read again on STALE-1's announcement of a gift, pledge or
  // fund change, so a total never sits on the figure from before the change.
  useChanged(["gift", "pledge", "fund", "totals"], () => {
    apiFetch("/finance/funds-detail").then(r => setD(r)).catch(() => {});
  });
  useEffect(() => {
    let alive = true;
    const want = urlParam("finance", "fund");
    apiFetch("/finance/funds-detail").then(r => {
      if (!alive) return;
      setD(r);
      const f = want && (r.funds || []).find(x => x.id === want);
      if (f) openFund(f, true);
    })
      .catch(e => { if (alive) setErr(errorMessage(e, "The funds did not load.")); });
    return () => { alive = false; };
  }, []);
  async function openFund(f, fromUrl) {
    if (!fromUrl) goUrl(fundHref(f.id));
    setOpen({ loading: true, label: f.name });
    try { setOpen({ ...(await apiFetch(`/finance/funds-detail/rows?fund=${encodeURIComponent(f.id)}`)), label: f.name }); }
    catch (e) { setOpen({ label: f.name, error: errorMessage(e, "Those rows did not open.") }); }
  }
  if (err) return <Card><div role="alert" style={{ fontSize:13, color:T.terra700 }}>{err}</div></Card>;
  if (!d) return <Card><div style={{ fontSize:12, color:T.ink3 }}>Adding up the funds…</div></Card>;
  if (!d.funds.length) return (
    <Card><EmptyState title="No funds yet"
      message="A fund is a pot of money with a purpose. Make one, name it on your gifts, and this screen tells you what is in it and what it is promised to."/></Card>
  );
  return (
    <div data-testid="fin-fund-cards" style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:6 }}>
      <div style={{ fontSize:13, color:T.ink3 }}>{d.sentence} Figures in and out are for {d.periodLabel}.</div>
      <NoFundLine noFund={d.noFund}/>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:12 }}>
        {d.funds.map(f => (
          <RecordLink key={f.id} to={fundHref(f.id)} data-testid="fin-fund-card" data-record-link="fund" onOpen={() => openFund(f)}
            style={{ display:"block", color:"inherit", background:T.white, border:"1px solid "+T.bg2, borderRadius:12, padding:"16px 17px",
                     textAlign:"left", cursor:"pointer", fontFamily:"inherit",
                     borderLeft:"3px solid "+(f.restricted ? T.gold500 : T.greenDk) }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"baseline", flexWrap:"wrap" }}>
              <span style={{ fontSize:14.5, fontWeight:700, color:T.ink }}>{f.name}</span>
              <span style={{ display:"flex", gap:6 }}><FundDefaultChip f={f}/>
                <span style={{ fontSize:11, fontWeight:700, borderRadius:99, padding:"2px 9px",
                               background: f.restricted ? T.gold100 : T.green100,
                               color: f.restricted ? T.gold700 : T.greenDk }}>
                  {f.restricted ? "Restricted" : "Unrestricted"}
                </span>
              </span>
            </div>
            <FundBooksLines f={f} defs={d.definitions || {}}/>
            <div style={{ fontSize:12, color:T.ink3, marginTop:4 }}>
              In {fmtFull(f.inPeriod)} · out {fmtFull(f.outPeriod)} this period
            </div>
            <div style={{ fontSize:12.5, color:T.ink2, marginTop:8, lineHeight:1.55 }}>{f.sentence}</div>
          </RecordLink>
        ))}
      </div>
      <Definitions4 items={Object.entries(d.definitions || {}).map(([k, v]) => [FUND_DEF_WORDS[k] || k, v])}/>
      {open && (
        <Modal onClose={() => { setOpen(null); goUrl(fundHref(null)); }} title={open.label + (open.net != null ? ` · ${fmtFull(open.net)} net` : "")}>
          {open.error && <div role="alert" style={{ fontSize:13, color:T.terra700 }}>{open.error}</div>}
          {open.loading && <div style={{ fontSize:13, color:T.ink3 }}>Opening the rows…</div>}
          {open.sentence && <div style={{ fontSize:13, color:T.ink2, lineHeight:1.6, marginBottom:12 }}>{open.sentence}</div>}
          {open.rows && (
            <div style={{ maxHeight:380, overflowY:"auto" }}>
              {!open.rows.length && !(open.gifts && open.gifts.length) && <div style={{ fontSize:13, color:T.ink3 }}>Nothing has moved through this fund yet.</div>}
              {open.rows.map(r => (
                <div key={r.id} style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"8px 0",
                                         borderBottom:"1px solid "+T.bg2, fontSize:13 }}>
                  <span style={{ color:T.ink, minWidth:0 }}>{r.date} · {r.description || r.vendor_donor || ""}</span>
                  <span style={{ fontWeight:700, color: r.type === "income" ? IN : OUT, whiteSpace:"nowrap" }}>
                    {r.type === "income" ? "+" : "−"}{fmtFull(r.amount)}
                  </span>
                </div>
              ))}
              {/* TRUTH-3: the gifts behind the fund, and where each stands with the books. */}
              {open.gifts && open.gifts.length > 0 && <div style={{ fontSize:12, fontWeight:700, color:T.ink3, marginTop:12 }}>Gifts to this fund</div>}
              {(open.gifts || []).map(g => (
                <div key={g.id} data-testid="fund-gift-row" style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"8px 0", borderBottom:"1px solid "+T.bg2, fontSize:13 }}>
                  <span style={{ color:T.ink, minWidth:0 }}>{g.date || "No date"} · <DonorLink id={g.donor_id}>{g.donor_name}</DonorLink> · {g.ledgerWord}</span>
                  <span style={{ fontWeight:700, color:T.ink, whiteSpace:"nowrap" }}>{fmtFull(g.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// The definitions under a group of figures, one line each.
export function Definitions4({ items }) {
  const rows = (items || []).filter(([, s]) => s);
  if (!rows.length) return null;
  return (
    <div data-testid="fin-definitions" style={{ fontSize:12, color:T.ink3, lineHeight:1.6, display:"flex", flexDirection:"column", gap:3 }}>
      {rows.map(([k, s]) => <div key={k}><strong style={{ color:T.ink2, fontWeight:700 }}>{`${k}.`}</strong>{` ${s}`}</div>)}
    </div>
  );
}
