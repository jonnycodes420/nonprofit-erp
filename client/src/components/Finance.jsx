import { useState, useEffect, Fragment } from "react";
import { RestrictedView } from "./RestrictedView";
import { T, activeMark, fmt, fmtFull, Card, EmptyState, SectionLabel, PageTitle, SectionTabs, interactive, Modal } from "./shared";
import { apiFetch, API, getToken } from "../api";
import { OPEN_GRANT_STATUSES, findOpenGrantMatch, findDonorMatch } from "../lib/financeMatch";
import { errorMessage } from "../lib/domainError";
import { CASH_ON_HAND_SENTENCE, stripeBalanceSentence } from "../../../shared/payoutReconcile.js";
import { displayDate, displayDateShort } from "../../../shared/displayDate";

// ── Constants ──────────────────────────────────────────────────────────────
// Account-type accents for the ledger's account badge, palette tokens only.
const TYPE_COLOR = { asset:T.ink, liability:T.gold700, net_asset:T.ink, revenue:T.ink, expense:T.ink3 };   // FIX-2 C: a category is a word, not a green or a red

// FIX-1 E — every number on screen has a sentence. Cash on hand is the
// ledger's, not the bank's and not Stripe's, and it says so: the sentence is
// CASH_ON_HAND_SENTENCE in shared/payoutReconcile.js, one string for the
// screen and the suite.

// (BUILD-12) The Overview narrative headline was removed as page-subtitle
// clutter — it duplicated the stat cards. Its one non-duplicated number, the
// vs-prior-period revenue delta, now lives on the Revenue stat card caption
// (`revDeltaCaption`, computed in the Finance component). The pure-function
// guard cases still live in tests/finance-overview.test.js as a unit.

// Money in = income (gold, positive/primary); money out = expense (terracotta,
// needs-attention). One convention used everywhere in this tab.
const IN = T.ink;   // FIX-2 C — money in reads ink; emerald is the one action
const OUT = T.terracotta;

// Where a ledger row came from — badged in the unified Transactions ledger.
const SOURCE_META = {
  online: { label:"Online · Stripe", color:T.greenDk, bg:T.gold+"26" },
  gift:   { label:"Gift",            color:T.ink, bg:T.bg2 },
  import:  { label:"Import",         color:T.ink3,    bg:T.bg2 },
  manual: { label:"Manual",          color:T.ink3,    bg:T.bg2 },
  grant:  { label:"Grant · Award",   color:T.greenDk, bg:T.gold+"26" },
};
// A row carrying grant_id IS a grant award's single ledger booking — badge it
// as such even when it entered as a manual row later adopted by the award.
const sourceMeta = (s, grantId) => (grantId ? SOURCE_META.grant : (SOURCE_META[s] || SOURCE_META.manual));

// ── Shared style helpers ───────────────────────────────────────────────────
const inp = { background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, padding:"8px 11px", color:T.ink, fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" };
const btn = (bg=T.greenDk,fg=T.white) => ({ background:bg, border:"none", borderRadius:8, padding:"9px 16px", color:fg, fontSize:13, fontWeight:700, cursor:"pointer" });
const ghostBtn = { background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, padding:"8px 14px", color:T.ink3, fontSize:12, cursor:"pointer" };

// Read-only gate for write buttons — matches the app-wide isReadOnly pattern.
const RO_TIP = "Reactivate your subscription to make changes.";
const writeBtn = (isReadOnly, style) => ({
  ...style,
  ...(isReadOnly ? { opacity:0.5, cursor:"not-allowed" } : {}),
});

// ── FundModal ──────────────────────────────────────────────────────────────
function FundModal({ fund, onSave, onClose }) {
  const [form, setForm] = useState(
    fund
      ? { name: fund.name, description: fund.description || "", restricted: !!fund.restricted }
      : { name:"", description:"", restricted:false }
  );
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <Modal onClose={onClose} width={400} backdrop="rgba(0,0,0,0.4)" blur={false} zIndex={1000} padding={28}
      dialogStyle={{borderRadius:16}}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>{fund ? "Edit fund" : "New fund"}</div>
        <div>
          <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Fund name</div>
          <input value={form.name} onChange={set("name")} placeholder="e.g. General Operating" style={inp}/>
        </div>
        <div>
          <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Description</div>
          <input value={form.description} onChange={set("description")} placeholder="Purpose of this fund" style={inp}/>
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:T.ink, cursor:"pointer" }}>
          <input type="checkbox" checked={form.restricted} onChange={e => setForm(p => ({ ...p, restricted: e.target.checked }))}/>
          Restricted fund (donor or grant restricted)
        </label>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={btn()} onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ── TransactionModal ───────────────────────────────────────────────────────
// Entity-routing FIX (2026-08-04): the Vendor/Donor field is entity-aware.
// Type-ahead searches this org's donors AND open grant asks; money-in that
// names a foundation with an open ask routes to the EXISTING grant-award flow
// (the award stamp IS the ledger entry — no manual row inserted), money-in
// from a known donor offers the gift flow (the gift chain stamps the ledger
// once). Free text stays for true vendors. Declining a prompt logs the manual
// row as typed.
function TransactionModal({ accounts, funds, onSave, onRouted, onClose }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ date:today, description:"", vendorDonor:"", amount:"", type:"income", accountId:"", fundId:"", notes:"" });
  const [linked, setLinked] = useState(null);           // { kind:'donor'|'grant', entity }
  const [sugs, setSugs] = useState(null);               // { donors, grants } | null
  const [sugsOpen, setSugsOpen] = useState(false);
  const [routing, setRouting] = useState(null);         // { kind:'grant'|'donor', entity } | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const filtered = accounts.filter(a => a.active !== false && a.type === (form.type === "income" ? "revenue" : "expense"));

  // Debounced org-scoped lookup (donors + open grants) as the name is typed.
  useEffect(() => {
    const q = form.vendorDonor.trim();
    if (linked || q.length < 2) { setSugs(null); setSugsOpen(false); return; }
    let alive = true;
    const t = setTimeout(() => {
      Promise.all([
        apiFetch(`/donors?search=${encodeURIComponent(q)}&limit=5`).catch(() => null),
        apiFetch(`/grants?search=${encodeURIComponent(q)}&limit=8`).catch(() => []),
      ]).then(([d, g]) => {
        if (!alive) return;
        const donors = Array.isArray(d) ? d : (d?.donors || []);
        const grants = (Array.isArray(g) ? g : []).filter(x => OPEN_GRANT_STATUSES.has(x.status));
        setSugs({ donors, grants });
        setSugsOpen(donors.length > 0 || grants.length > 0);
      });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [form.vendorDonor, linked]);

  const pickDonor = d => { setLinked({ kind:"donor", entity:d }); setForm(p => ({ ...p, vendorDonor:d.name })); setSugsOpen(false); };
  const pickGrant = g => { setLinked({ kind:"grant", entity:g }); setForm(p => ({ ...p, vendorDonor:g.funder })); setSugsOpen(false); };
  const clearLink = () => setLinked(null);
  const editName = e => { if (linked) setLinked(null); set("vendorDonor")(e); };

  // Save: expenses (and unrecognized income) log as typed; income naming an
  // open-ask foundation or a known donor gets ONE routing prompt first.
  const trySave = async () => {
    if (!form.description || !form.amount || busy) return;
    setErr("");
    const payload = { ...form, donorId: linked?.kind === "donor" ? linked.entity.id : undefined };
    if (form.type !== "income") { onSave(payload); return; }
    if (linked?.kind === "grant") { setRouting({ kind:"grant", entity:linked.entity }); return; }
    if (linked?.kind === "donor") { setRouting({ kind:"donor", entity:linked.entity }); return; }
    const q = form.vendorDonor.trim();
    if (q.length >= 2) {
      setBusy(true);
      try {
        const [d, g] = await Promise.all([
          apiFetch(`/donors?search=${encodeURIComponent(q)}&limit=10`).catch(() => null),
          apiFetch(`/grants?search=${encodeURIComponent(q)}&limit=20`).catch(() => []),
        ]);
        const grant = findOpenGrantMatch(q, Array.isArray(g) ? g : []);
        if (grant) { setRouting({ kind:"grant", entity:grant }); setBusy(false); return; }
        const donor = findDonorMatch(q, Array.isArray(d) ? d : (d?.donors || []));
        if (donor) { setRouting({ kind:"donor", entity:donor }); setBusy(false); return; }
      } catch { /* lookup failure never blocks a manual save */ }
      setBusy(false);
    }
    onSave(payload);
  };

  // Accept the grant prompt → the EXISTING award flow (PUT status:'awarded').
  // The award stamps the ledger exactly once (uq_fin_txns_grant) — the manual
  // transaction is NOT separately inserted, so a double-count is impossible.
  const acceptGrant = async () => {
    const g = routing.entity;
    setBusy(true); setErr("");
    try {
      const updated = await apiFetch(`/grants/${g.id}`, { method:"PUT", body: JSON.stringify({
        funder:g.funder, program:g.program || "", amount:Number(form.amount) || g.amount,
        received:Number(form.amount) || 0, status:"awarded",
        deadline:g.deadline || "", reportDue:g.report_due || g.reportDue || "", officer:g.officer || "",
        notes:g.notes || "", description:g.description || "", requirements:g.requirements || "",
        campaignId:g.campaign_id || g.campaignId || "",
      })});
      onRouted({ kind:"grant", name:g.funder, grant:updated });
    } catch(e) { setErr(errorMessage(e, "Could not mark the grant awarded.")); setBusy(false); }
  };

  // Accept the donor prompt → the EXISTING gift flow (POST /donors/:id/gifts),
  // which stamps the ledger once and runs the whole gift chain.
  const acceptGift = async () => {
    const d = routing.entity;
    setBusy(true); setErr("");
    try {
      await apiFetch(`/donors/${d.id}/gifts`, { method:"POST", body: JSON.stringify({
        amount:Number(form.amount), date:form.date, type:"cash",
        notes:form.description, fundId:form.fundId || undefined,
      })});
      onRouted({ kind:"gift", name:d.name });
    } catch(e) { setErr(errorMessage(e, "Could not log the gift.")); setBusy(false); }
  };

  // Decline → it's genuinely different money; log the manual row as typed
  // (a linked donor keeps the donor_id FK — deliberate ledger-only income).
  const decline = () => {
    const donorId = routing?.kind === "donor" ? routing.entity.id : (linked?.kind === "donor" ? linked.entity.id : undefined);
    setRouting(null);
    onSave({ ...form, donorId });
  };

  const sugBtn = { display:"block", width:"100%", textAlign:"left", background:"none", border:"none", padding:"8px 11px", fontSize:13, color:T.ink, cursor:"pointer" };

  // Routing prompt view — replaces the form until answered.
  if (routing) {
    const isGrant = routing.kind === "grant";
    const g = routing.entity;
    return (
      <Modal onClose={()=>{ if(!busy) onClose(); }} width={480} backdrop="rgba(0,0,0,0.4)" blur={false} zIndex={1000} padding={28}
        dialogStyle={{borderRadius:16,width:480}}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>
            {isGrant ? "This looks like a grant arriving" : "This looks like a donor's money"}
          </div>
          <div style={{ fontSize:13, color:T.ink, lineHeight:1.6 }}>
            {isGrant ? (
              <>
                <b>{g.funder}</b> has a {fmtFull(parseFloat(g.amount) || 0)} open ask{g.program ? <> (<i>{g.program}</i>)</> : null}. Is this that grant?
                Marking it awarded books {fmtFull(Number(form.amount) || 0)} into the ledger once, moves the board, and clears the open ask —
                no separate manual entry.
              </>
            ) : (
              <>
                Log this as a <b>gift from {g.name}</b> instead? A gift updates their lifetime giving, receipts, and campaign attribution —
                and lands in this ledger automatically. A ledger-only entry does none of that.
              </>
            )}
          </div>
          {err && <div style={{ fontSize:12, color:T.terracotta }}>{err}</div>}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
            <button style={ghostBtn} disabled={busy} onClick={decline}>
              {isGrant ? "No — different money, log as typed" : "No — keep as a ledger entry"}
            </button>
            <button style={btn(T.gold, T.ink)} disabled={busy} onClick={isGrant ? acceptGrant : acceptGift}>
              {busy ? "Working…" : isGrant ? "Yes — mark awarded" : "Log as a gift"}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} width={460} backdrop="rgba(0,0,0,0.4)" blur={false} zIndex={1000} padding={28}
      dialogStyle={{borderRadius:16}}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>Log transaction</div>
        <div style={{ display:"flex", gap:6 }}>
          {["income","expense"].map(t => (
            <button key={t} onClick={() => setForm(p => ({ ...p, type:t, accountId:"" }))}
              style={{ flex:1, ...btn(form.type===t ? (t==="income"?IN:OUT) : T.bg, form.type===t?T.white:T.ink3), border:"1px solid "+(form.type===t?"transparent":T.bg3) }}>
              {t === "income" ? "↑ Money in" : "↓ Money out"}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ flex:"0 0 150px" }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Date</div>
            <input type="date" value={form.date} onChange={set("date")} style={inp}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Amount ($)</div>
            <input type="number" value={form.amount} onChange={set("amount")} placeholder="0.00" style={inp}/>
          </div>
        </div>
        <div>
          <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Description</div>
          <input value={form.description} onChange={set("description")} placeholder="What is this for?" style={inp}/>
        </div>
        <div style={{ position:"relative" }}>
          <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Vendor / Donor</div>
          <input value={form.vendorDonor} onChange={editName} placeholder="Start typing — donors and open grants link automatically"
            onFocus={() => { if (sugs && (sugs.donors.length || sugs.grants.length)) setSugsOpen(true); }}
            onBlur={() => setTimeout(() => setSugsOpen(false), 150)}
            style={inp}/>
          {linked && (
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5, fontSize:12, color:T.greenDk, fontWeight:600 }}>
              {linked.kind === "donor" ? "Linked donor" : "Open grant"} · {linked.kind === "donor" ? linked.entity.name : linked.entity.funder}
              <button onClick={clearLink} aria-label="Unlink" style={{ background:"none", border:"none", color:T.ink3, cursor:"pointer", fontSize:12, padding:0 }}>✕</button>
            </div>
          )}
          {!linked && (
            <div style={{ fontSize:11, color:T.ink3, marginTop:5, lineHeight:1.5 }}>
              Donor or grant money enters as a gift or award — free text is for true vendors (the hardware store).
            </div>
          )}
          {sugsOpen && !linked && (
            <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:10, background:T.white, border:"1px solid "+T.bg3, borderRadius:10, boxShadow:"0 8px 24px rgba(15,26,18,0.14)", overflow:"hidden", marginTop:2 }}>
              {form.type === "income" && sugs.grants.length > 0 && (
                <>
                  <div style={{ fontSize:10, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", padding:"7px 11px 2px" }}>Open grant asks</div>
                  {sugs.grants.map(g => (
                    <button key={g.id} style={sugBtn} onClick={() => pickGrant(g)}
                      onMouseDown={e => e.preventDefault()}>
                      <b>{g.funder}</b>{g.program ? ` — ${g.program}` : ""} · {fmtFull(parseFloat(g.amount) || 0)} · {g.status}
                    </button>
                  ))}
                </>
              )}
              {sugs.donors.length > 0 && (
                <>
                  <div style={{ fontSize:10, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", padding:"7px 11px 2px" }}>Donors</div>
                  {sugs.donors.map(d => (
                    <button key={d.id} style={sugBtn} onClick={() => pickDonor(d)}
                      onMouseDown={e => e.preventDefault()}>
                      {d.name}{d.email ? <span style={{ color:T.ink3 }}> · {d.email}</span> : null}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Account</div>
            <select value={form.accountId} onChange={set("accountId")} style={{ ...inp, cursor:"pointer" }}>
              <option value="">— select —</option>
              {filtered.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Fund</div>
            <select value={form.fundId} onChange={set("fundId")} style={{ ...inp, cursor:"pointer" }}>
              <option value="">— select —</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={btn(form.type === "income" ? IN : OUT)} disabled={busy} onClick={trySave}>
            {busy ? "Checking…" : "Save transaction"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Money in — Stripe status/balance/payouts strip (Overview) ───────────────
const PAYOUT_STATUS = { paid:IN, in_transit:T.gold, pending:T.gold, canceled:OUT, failed:OUT };
// FIX-2 finding 10 — the one formatter, never a Date in some timezone.
const fmtDate = (iso, year) => iso ? ((year ? displayDate(iso) : displayDateShort(iso, new Date())) || "—") : "—";
const useStripeSummary = () => {
  const [s, setS] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch("/finance/stripe-summary")
      .then(r => { if (alive) setS(r); })
      .catch(() => { if (alive) setS({ connected:false }); });
    return () => { alive = false; };
  }, []);
  return s;
};

function ConnectStripeCard({ onNavigate }) {
  return (
    <Card style={{ borderLeft:`3px solid ${T.gold}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <div style={{ flex:"1 1 280px" }}>
          <SectionLabel>Money in</SectionLabel>
          <div style={{ fontSize:14, color:T.ink, fontWeight:600, marginBottom:3 }}>Connect Stripe to accept donations online.</div>
          <div style={{ fontSize:12, color:T.ink3, lineHeight:1.6 }}>Once you connect, every online gift lands here — and in your ledger — automatically, with 0% platform fees.</div>
        </div>
        {onNavigate && <button style={btn(T.gold, T.ink)} onClick={() => onNavigate("settings", { section:"giving" })}>Connect Stripe →</button>}
      </div>
    </Card>
  );
}

function PayoutRow({ p, first, onOpen }) {
  return (
    <div {...interactive(() => onOpen(p.id), { label: `Open the payout of ${fmtFull(p.amount)}` })} data-testid="payout-row"
      style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 8px", margin:"0 -8px", borderRadius:8, borderTop: first ? "" : "1px solid "+T.bg3, minHeight:44 }}>
      <span style={{ width:8, height:8, borderRadius:"50%", background:PAYOUT_STATUS[p.status]||T.ink3, flexShrink:0 }}/>
      <span style={{ fontSize:13, fontWeight:700, color:T.ink, minWidth:90 }}>{fmtFull(p.amount)}</span>
      <span style={{ flex:1, fontSize:12, color:T.ink3 }}>{fmtDate(p.arrival_date, true)}</span>
      <span style={{ fontSize:11, fontWeight:600, color:PAYOUT_STATUS[p.status]||T.ink3, textTransform:"capitalize" }}>{(p.status||"").replace(/_/g," ")}</span>
      <span style={{ fontSize:12, color:T.greenMid, fontWeight:700 }}>Open →</span>
    </div>
  );
}

function MoneyInStrip({ onNavigate, onOpenPayout, cashOnHand }) {
  const s = useStripeSummary();
  if (!s) return <Card><div style={{ fontSize:12, color:T.ink3 }}>Checking your Stripe balance…</div></Card>;
  if (!s.connected) return <ConnectStripeCard onNavigate={onNavigate}/>;
  const payouts = (s.payouts || []).slice(0, 5);
  return (
    <Card>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <SectionLabel>Money in · Stripe</SectionLabel>
        <span style={{ fontSize:11, color:IN, fontWeight:700 }}>Connected</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12 }}>
        <div>
          <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>Available in Stripe</div>
          <div style={{ fontSize:24, fontWeight:800, color:IN, fontFamily:"'DM Serif Display',serif" }}>{fmtFull(s.balance?.available || 0)}</div>
        </div>
        <div>
          <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>On its way</div>
          <div style={{ fontSize:24, fontWeight:800, color:T.gold, fontFamily:"'DM Serif Display',serif" }}>{fmtFull(s.balance?.pending || 0)}</div>
        </div>
      </div>
      {/* A $0 Stripe balance beside a large cash-on-hand figure is not a
          discrepancy, and the screen says so rather than leaving it to worry. */}
      <div data-testid="stripe-balance-sentence" style={{ fontSize:12, color:T.ink2, marginTop:10, lineHeight:1.55 }}>
        {stripeBalanceSentence({
          availableCents: Math.round((s.balance?.available || 0) * 100),
          pendingCents: Math.round((s.balance?.pending || 0) * 100),
          cashOnHandText: cashOnHand == null ? "" : fmt(cashOnHand),
        })}
      </div>
      {payouts.length > 0 && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", margin:"4px 0 6px" }}>Recent payouts</div>
          {payouts.map((p, i) => <PayoutRow key={p.id || i} p={p} first={i === 0} onOpen={onOpenPayout}/>)}
        </div>
      )}
    </Card>
  );
}

// ── Payouts — which gifts made up this payout (FIX-1 E) ────────────────────
const KIND_LABEL = { charge:"Gift", refund:"Refund", fee:"Stripe fee", adjustment:"Adjustment", other:"Other" };
function PayoutsView({ onNavigate, openId, onOpen }) {
  const s = useStripeSummary();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!openId) { setD(null); return; }
    let alive = true; setD(null); setErr("");
    apiFetch(`/finance/payout-lines?payout=${encodeURIComponent(openId)}`)
      .then(r => { if (alive) setD(r); })
      .catch(e => { if (alive) setErr(errorMessage(e, "Steward could not open that payout.")); });
    return () => { alive = false; };
  }, [openId]);

  if (!s) return <Card><div style={{ fontSize:12, color:T.ink3 }}>Checking your Stripe payouts…</div></Card>;
  if (!s.connected) return <ConnectStripeCard onNavigate={onNavigate}/>;
  const payouts = s.payouts || [];
  if (!openId) return (
    <Card>
      <SectionLabel>Payouts</SectionLabel>
      <div style={{ fontSize:12, color:T.ink3, marginBottom:10, lineHeight:1.6 }}>
        Each payout is one deposit in your bank. Open one to see the gifts, refunds and fees inside it.
      </div>
      {payouts.length === 0
        ? <div style={{ fontSize:13, color:T.ink3 }}>Stripe has not paid anything out yet. The first payout will appear here the day it is sent to your bank.</div>
        : payouts.map((p, i) => <PayoutRow key={p.id} p={p} first={i === 0} onOpen={onOpen}/>)}
    </Card>
  );
  return (
    <div data-testid="payout-detail"><Card>
      <button onClick={() => onOpen(null)} style={{ ...ghostBtn, marginBottom:12 }}>← All payouts</button>
      {err && <div role="alert" style={{ fontSize:13, color:T.terra700 }}>{err}</div>}
      {!d && !err && <div style={{ fontSize:12, color:T.ink3 }}>Opening the payout…</div>}
      {d && <>
        <div style={{ display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap" }}>
          <div style={{ fontSize:26, fontWeight:800, color:T.ink, fontFamily:"'DM Serif Display',serif" }}>{fmtFull(d.payoutCents / 100)}</div>
          <div style={{ fontSize:12, color:T.ink3 }}>reached your bank {fmtDate(d.arrivalDate, true)}</div>
        </div>
        {/* A payout that does not add up is a finding, not an error: brass, the
            attention colour, never red (red is only a destructive confirm). */}
        <div data-testid="payout-sentence" style={{ fontSize:13, color:T.ink, marginTop:6, lineHeight:1.55,
          ...(d.reconciled ? {} : { background:T.gold100, border:"1px solid "+T.gold, borderRadius:8, padding:"8px 10px", fontWeight:600 }) }}>
          {d.sentence}
        </div>
        <div className="reports-table-wrap" style={{ overflowX:"auto", marginTop:14 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ textAlign:"left", color:T.ink3, fontSize:11, textTransform:"uppercase", letterSpacing:".05em" }}>
                <th style={{ padding:"6px 8px" }}>Line</th><th style={{ padding:"6px 8px" }}>Donor</th>
                <th style={{ padding:"6px 8px", textAlign:"right" }}>Amount</th><th style={{ padding:"6px 8px", textAlign:"right" }}>Fee</th>
                <th style={{ padding:"6px 8px", textAlign:"right" }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map(r => (
                <tr key={r.id} data-testid="payout-line" style={{ borderTop:"1px solid "+T.bg3 }}>
                  <td style={{ padding:"8px" }}>{KIND_LABEL[r.kind] || r.kind}</td>
                  <td style={{ padding:"8px" }}>
                    {r.donorId
                      ? <span {...interactive(() => onNavigate && onNavigate("donors", { selectDonorId: r.donorId }), { label: `Open ${r.donorName}` })}
                          data-testid="payout-donor" style={{ color:T.greenMid, fontWeight:700 }}>{r.donorName}</span>
                      : <span style={{ color:T.ink3 }}>{r.kind === "fee" ? "Stripe" : "Not a gift on file"}</span>}
                  </td>
                  <td style={{ padding:"8px", textAlign:"right" }}>{fmtFull(r.grossCents / 100)}</td>
                  <td style={{ padding:"8px", textAlign:"right", color:T.ink3 }}>{r.feeCents ? fmtFull(-r.feeCents / 100) : ""}</td>
                  <td style={{ padding:"8px", textAlign:"right", fontWeight:700 }}>{fmtFull(r.netCents / 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop:"2px solid "+T.bg3 }}>
                <td colSpan={4} style={{ padding:"8px", fontSize:12, color:T.ink3 }}>The lines add up to</td>
                <td style={{ padding:"8px", textAlign:"right", fontWeight:800 }}>{fmtFull(d.sumNetCents / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </>}
    </Card></div>
  );
}

// ── Monthly close — what goes to the bookkeeper this month (FIX-1 E) ───────
// The BUILD-87 bookkeeper export, asked for one month. There is no second
// export path: this is /reports/bookkeeper with the month's first and last
// day, and a month that does not foot REFUSES to become a file (409), which
// this screen says in the server's own words.
const monthBounds = ym => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
};
const lastMonth = () => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
function MonthlyClose() {
  const [ym, setYm] = useState(lastMonth);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { from, to } = monthBounds(ym);
  useEffect(() => {
    let alive = true; setD(null); setErr("");
    apiFetch(`/reports/bookkeeper?from=${from}&to=${to}`)
      .then(r => { if (alive) setD(r); })
      .catch(e => { if (alive) setErr(errorMessage(e, "Steward could not build that month.")); });
    return () => { alive = false; };
  }, [from, to]);
  const monthName = new Date(from + "T12:00:00").toLocaleDateString("en-US", { month:"long", year:"numeric" });
  const download = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/reports/bookkeeper?from=${from}&to=${to}&format=csv`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || e.error || "Download failed"); }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `bookkeeper-${ym}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { setErr(errorMessage(e, "The file did not download.")); }
    setBusy(false);
  };
  return (
    <div data-testid="monthly-close">
      {/* FIN-1 — THE CHECKLIST, above the file. Five things, each one open or
          done, each one saying what to do. Not a score and not a progress
          bar: somebody closing a month wants to know WHICH of five is still
          open, and a percentage tells her nothing. */}
      <MonthCloseChecklist month={ym}/>
      <Card>
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:12 }}>
        <SectionLabel>Monthly close</SectionLabel>
        <input type="month" value={ym} onChange={e => e.target.value && setYm(e.target.value)} aria-label="Month to close" style={{ ...inp, width:170 }}/>
      </div>
      <div style={{ fontSize:12, color:T.ink3, marginBottom:12, lineHeight:1.6 }}>
        One row per gift received in {monthName}, for the person who reconciles the bank. Steward checks that the rows, the fund totals and its own sum agree to the cent before it will write the file.
      </div>
      {err && <div role="alert" style={{ fontSize:13, color:T.terra700, marginBottom:10 }}>{err}</div>}
      {!d && !err && <div style={{ fontSize:12, color:T.ink3 }}>Adding up {monthName}…</div>}
      {d && <>
        <div data-testid="close-sentence" style={{ fontSize:14, color:d.balanced ? T.ink : T.terra700, marginBottom:12, lineHeight:1.55 }}>
          {d.giftCount === 0
            ? `No gifts were received in ${monthName}, so there is nothing to send the bookkeeper.`
            : d.balanced
              ? `${d.giftCount} gift${d.giftCount === 1 ? "" : "s"} totalling ${fmtFull(d.totalCents / 100)}. It foots: the rows, the fund totals and the database agree to the cent.`
              : d.exportRefused}
        </div>
        {d.byFund.length > 0 && (
          <div style={{ marginBottom:14 }}>
            {d.byFund.map((f, i) => (
              <div key={f.name} style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"8px 0", borderTop: i ? "1px solid "+T.bg3 : "" }}>
                <span style={{ fontSize:13, color:T.ink }}>{f.name} <span style={{ color:T.ink3 }}>· {f.giftCount} gift{f.giftCount === 1 ? "" : "s"}</span></span>
                <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmtFull(f.cents / 100)}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={download} disabled={busy || !d.balanced || d.giftCount === 0}
          style={{ ...btn(), ...((busy || !d.balanced || d.giftCount === 0) ? { opacity:0.5, cursor:"not-allowed" } : {}) }}>
          {busy ? "Preparing…" : `Download ${monthName} for the bookkeeper`}
        </button>
        {/* FIN-1 — the same rows, in the column order their tool wants. */}
        <BookkeeperFlavours/>
      </>}
    </Card></div>
  );
}

// FIN-1 — the month-close checklist.
function MonthCloseChecklist({ month }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true; setD(null);
    apiFetch(`/finance/month-close?month=${month}`).then(r => { if (alive) setD(r); }).catch(() => {});
    return () => { alive = false; };
  }, [month]);
  if (!d) return null;
  return (
    <Card>
      <div style={{ display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap", marginBottom:6 }}>
        <SectionLabel>Before you close {d.monthLabel}</SectionLabel>
        <span data-testid="close-open-count"
          style={{ fontSize:12.5, fontWeight:700, color: d.openCount ? T.gold700 : T.greenDk }}>{d.sentence}</span>
      </div>
      {d.items.map(i => (
        <div key={i.key} data-testid={"close-item-" + i.key}
          style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"9px 0", borderTop:"1px solid "+T.bg2 }}>
          <span aria-hidden="true" style={{ width:16, height:16, borderRadius:"50%", flexShrink:0, marginTop:2,
            background: i.done ? T.green100 : T.gold100, border:"1.5px solid "+(i.done ? T.greenDk : T.gold500),
            display:"inline-flex", alignItems:"center", justifyContent:"center",
            fontSize:10, fontWeight:900, color: i.done ? T.greenDk : T.gold700 }}>{i.done ? "✓" : ""}</span>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13.5, fontWeight:700, color: i.done ? T.ink3 : T.ink }}>{i.label}</div>
            <div style={{ fontSize:12.5, color:T.ink3, marginTop:2, lineHeight:1.5 }}>{i.sentence}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

// FIN-1 — the same rows, in the column order the bookkeeper's tool wants.
function BookkeeperFlavours() {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch("/finance/bookkeeper-flavours").then(r => { if (alive) setD(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!d) return null;
  return (
    <div data-testid="bookkeeper-flavours" style={{ marginTop:16, paddingTop:14, borderTop:"1px solid "+T.bg2 }}>
      <div style={{ fontSize:12.5, color:T.ink2, lineHeight:1.6, maxWidth:640 }}>{d.sentence}</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:10 }}>
        {d.flavours.map(f => (
          <span key={f.key} title={f.note}
            style={{ fontSize:12, fontWeight:700, borderRadius:8, padding:"6px 12px",
                     background:T.white, border:"1px solid "+T.bg3, color:T.ink }}>
            {f.label}
            {f.confidence !== "walked" && <span style={{ color:T.ink3, fontWeight:500 }}> · check the first file</span>}
          </span>
        ))}
      </div>
      <div style={{ fontSize:12, color:T.ink3, lineHeight:1.55, marginTop:8, maxWidth:640 }}>{d.caveat}</div>
    </div>
  );
}

// ── FIN-1 · FIVE SECTIONS, EACH ONE A QUESTION ────────────────────────────
const FIN_SECTIONS = [
  { id: "overview", label: "Overview", question: "What happened this month, and what needs you?",
    parts: [{ id: "overview", label: "This month" }, { id: "transactions", label: "Transactions" }] },
  { id: "funds", label: "Funds", question: "Where is the money, and what is it promised to?",
    parts: [{ id: "funds", label: "Funds" }, { id: "budgets", label: "Budgets" }] },
  { id: "deposits", label: "Deposits and payouts", question: "What arrived, and does it match?",
    parts: [{ id: "payouts", label: "Payouts" }, { id: "deposits", label: "Deposit sheet" }] },
  { id: "grantsmoney", label: "Grants money", question: "What is restricted, and who restricted it?",
    parts: [{ id: "restricted", label: "Restricted" }] },
  { id: "exports", label: "Exports", question: "What does the bookkeeper need?",
    parts: [{ id: "close", label: "Month close" }, { id: "yearend", label: "Year-end statements" },
            { id: "audit", label: "Audit log" }] },
];
// An old sub-tab id resolves to its section, so every deep link that named
// one still lands on it rather than on the first thing in the list.
const PART_SECTION = {};
for (const sec of FIN_SECTIONS) for (const p of sec.parts) PART_SECTION[p.id] = sec.id;

// ── Finance ────────────────────────────────────────────────────────────────
export function Finance({ data, setData, isReadOnly, onNavigate }) {
  // FIX-1 E: restricted money leads Finance — the first question a treasurer
  // asks Steward that the books cannot answer.
  // FIN-1 — `subtab` stays the name of the OPEN PART, because forty-odd
  // lines below read it and every deep link names one. What is new is the
  // section above it; setting a part sets the section it lives in, so the
  // two can never disagree.
  const [subtab, setSubtabRaw] = useState("overview");
  const [section, setSection] = useState("overview");
  const setSubtab = id => { setSubtabRaw(id); if (PART_SECTION[id]) setSection(PART_SECTION[id]); };
  const [openPayout, setOpenPayout] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [budgetErr, setBudgetErr] = useState("");
  const [summary, setSummary] = useState(null);
  const [txnYear, setTxnYear] = useState(new Date().getFullYear());
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState(-1);
  const [txnFilter, setTxnFilter] = useState("");
  const [txnType, setTxnType] = useState("");     // "" | income | expense
  const [txnSource, setTxnSource] = useState("");  // "" | online | gift | manual | import
  const [txnFund, setTxnFund] = useState("");      // "" | fundId
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);
  const [editFund, setEditFund] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auditLog, setAuditLog] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditEntityFilter, setAuditEntityFilter] = useState("");
  const [expandedAuditRows, setExpandedAuditRows] = useState(new Set());
  // Persisted in localStorage so it survives page reloads
  const [yearMode, setYearMode] = useState(() => localStorage.getItem("steward_fin_yearmode") || "fiscal");

  const loadAll = (yr = txnYear, byr = budgetYear, ym = yearMode) => {
    Promise.all([
      apiFetch("/finance/accounts"),
      apiFetch("/finance/funds"),
      apiFetch(`/finance/transactions?year=${yr}`),
      apiFetch(`/finance/budgets?year=${byr}`),
      apiFetch(`/finance/summary?yearMode=${ym}`),
    ]).then(([a, f, t, b, s]) => {
      setAccounts(a); setFunds(f); setTransactions(t); setBudgets(b); setSummary(s);
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (subtab === "audit") reloadAuditLog(); }, [subtab]);

  const reloadTxns = (yr) => apiFetch(`/finance/transactions?year=${yr}`).then(setTransactions);
  const reloadBudgets = (yr) => apiFetch(`/finance/budgets?year=${yr}`).then(setBudgets);
  const reloadSummary = (ym = yearMode) => apiFetch(`/finance/summary?yearMode=${ym}`).then(setSummary);
  const handleYearModeChange = (v) => {
    localStorage.setItem("steward_fin_yearmode", v);
    setYearMode(v);
    reloadSummary(v); // pass explicitly to avoid stale closure
  };
  const reloadAuditLog = async () => {
    setAuditLoading(true);
    try { const rows = await apiFetch("/finance/audit-log?limit=200"); setAuditLog(rows); }
    catch(e) { console.error(e); }
    setAuditLoading(false);
  };

  // ── Reports & derived views (fund balances, monthly breakdown) ──
  const allTxns = transactions; // already loaded for current year

  // Fund balances are cumulative (all-time) — a fund balance means nothing
  // per-calendar-year. The server computes them in /finance/summary so they
  // reconcile with the all-time Cash on Hand; fall back to a year-filtered
  // client computation only until the summary arrives.
  const _fbMap = {};
  funds.forEach(f => { _fbMap[f.id] = { name: f.name, restricted: f.restricted, income: 0, expense: 0 }; });
  (Array.isArray(allTxns) ? allTxns : []).forEach(t => {
    if (!t || !t.fund_id || !_fbMap[t.fund_id]) return;
    if (t.type === "income") _fbMap[t.fund_id].income += (parseFloat(t.amount) || 0);
    else _fbMap[t.fund_id].expense += (parseFloat(t.amount) || 0);
  });
  const finFundBalances = summary?.fundBalances
    || Object.values(_fbMap).map(f => ({ ...f, balance: f.income - f.expense }));

  const monthsElapsed = new Date().getMonth() + 1;

  // ── Donor lookup for transactions ──
  const donorById = Object.fromEntries((data.donors || []).map(d => [d.id, d]));

  // ── Sub-tabs (SectionTabs) ──
  // FIX-1 E — the three questions come first: where restricted money sits,
  // which gifts made up a payout, what goes to the bookkeeper this month. The
  // manual Accounts tab is gone (the chart of accounts is still provisioned
  // and still read by Budgets and the transaction form).
  // ── FIN-1 · THE SAME SHAPE FUNDRAISING AND VOLUNTEERS GOT ─────────────
  // Finance had EIGHT sub-tabs in a flat strip, every one of them equally
  // loud, and a treasurer opening it had to know which of the eight held
  // the answer before she could look for it. Five sections now, each one a
  // question, with the old views folded in underneath as parts.
  //
  // NOTHING WAS DROPPED. Restricted, Payouts, Monthly close, Overview,
  // Transactions, Funds, Budgets and the Audit log are all still here, each
  // under the question it answers, and every deep link that named a subtab
  // still resolves (PART_SECTION below maps an old id to its section).

  // ── Transactions filtering + sort ──
  const sortedTxns = [...transactions]
    .filter(t => !txnType || t.type === txnType)
    .filter(t => !txnSource || (t.source || "manual") === txnSource)
    .filter(t => !txnFund || t.fund_id === txnFund)
    .filter(t => !txnFilter || (t.description + t.vendor_donor + t.account_name + t.fund_name).toLowerCase().includes(txnFilter.toLowerCase()))
    .sort((a, b) => {
      let va = a[sortCol === "date" ? "date" : sortCol === "amount" ? "amount" : "account_name"];
      let vb = b[sortCol === "date" ? "date" : sortCol === "amount" ? "amount" : "account_name"];
      if (sortCol === "amount") return sortDir * (Number(vb) - Number(va));
      return sortDir * (va < vb ? -1 : va > vb ? 1 : 0);
    });

  const toggleSort = col => {
    if (sortCol === col) setSortDir(d => -d);
    else { setSortCol(col); setSortDir(-1); }
  };
  const sortArrow = col => sortCol === col ? (sortDir === -1 ? " ↓" : " ↑") : "";

  const handleAddTxn = async (form) => {
    try {
      const created = await apiFetch("/finance/transactions", { method:"POST", body: JSON.stringify(form) });
      const thisYear = new Date(created.date).getFullYear() === txnYear;
      if (thisYear) setTransactions(prev => [created, ...prev]);
      await Promise.all([reloadSummary(), reloadBudgets(budgetYear)]);
      setShowTxnModal(false);
    } catch(e) { console.error(e); }
  };

  // A money-in routed to the grant-award or gift flow: the ledger was stamped
  // by that flow (exactly once) — reload everything, no manual insert here.
  // A routed award also updates the shared data.grants so the Grants board
  // reads Awarded immediately, not on the next full app load.
  const handleRouted = async (info) => {
    setShowTxnModal(false);
    if (info?.kind === "grant" && info.grant && setData) {
      const raw = info.grant;
      setData(prev => prev ? { ...prev, grants: (prev.grants || []).map(g => g.id === raw.id ? {
        ...g, status: raw.status, amount: raw.amount || 0, received: raw.received || 0,
      } : g) } : prev);
    }
    loadAll();
  };

  const handleDeleteTxn = async (id) => {
    if (!window.confirm("Delete this transaction?")) return;
    try {
      await apiFetch(`/finance/transactions/${id}`, { method:"DELETE" });
      setTransactions(prev => prev.filter(t => t.id !== id));
      await Promise.all([reloadSummary(), reloadBudgets(budgetYear)]);
    } catch(e) { console.error(e); }
  };

  const handleSaveFund = async (form) => {
    try {
      if (editFund) {
        const updated = await apiFetch(`/finance/funds/${editFund.id}`, { method:"PUT", body: JSON.stringify(form) });
        setFunds(prev => prev.map(f => f.id === editFund.id ? updated : f));
      } else {
        const created = await apiFetch("/finance/funds", { method:"POST", body: JSON.stringify(form) });
        setFunds(prev => [...prev, created]);
      }
      setShowFundModal(false); setEditFund(null);
    } catch(e) { console.error(e); }
  };

  // BUILD-88a A.3 — a budget line is (account, FUND, year, amount), and all
  // four are editable. Re-reading after the write is what keeps the actual and
  // the variance honest: a fund change moves which money the line is compared
  // against, and a local patch would have shown the old comparison.
  const handleBudgetChange = async (accountId, amount, fundId = null) => {
    try {
      await apiFetch("/finance/budgets", { method:"POST", body: JSON.stringify({ accountId, year: budgetYear, amount, fundId: fundId || null }) });
      await reloadBudgets(budgetYear);
    } catch(e) { setBudgetErr(errorMessage(e, "That budget could not be saved.")); }
  };
  const handleBudgetFund = async (row, fundId) => {
    try {
      // Write the new line first, then remove the one it left: a budget that
      // vanishes between two requests is worse than one that briefly exists twice.
      await apiFetch("/finance/budgets", { method:"POST", body: JSON.stringify({ accountId: row.accountId, year: budgetYear, amount: row.budget, fundId: fundId || null }) });
      if (row.id) await apiFetch(`/finance/budgets/${row.id}`, { method:"DELETE" });
      await reloadBudgets(budgetYear);
    } catch(e) { setBudgetErr(errorMessage(e, "That budget could not be moved.")); }
  };
  const handleBudgetDelete = async (row) => {
    if (!row.id) return;
    try { await apiFetch(`/finance/budgets/${row.id}`, { method:"DELETE" }); await reloadBudgets(budgetYear); }
    catch(e) { setBudgetErr(errorMessage(e, "That budget could not be removed.")); }
  };

  const getFundSparkline = (fundId) => {
    const now = new Date();
    const pts = Array.from({ length: 8 }, (_, i) => {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 7);
      const s = weekStart.toISOString().split("T")[0];
      const e = weekEnd.toISOString().split("T")[0];
      return (Array.isArray(allTxns) ? allTxns : [])
        .filter(t => t && t.fund_id === fundId && t.date >= s && t.date <= e)
        .reduce((sum, t) => sum + (t.type === "income" ? 1 : -1) * (parseFloat(t.amount) || 0), 0);
    }).reverse();
    let running = 0;
    return pts.map(v => { running += v; return running; });
  };

  const filteredAudit = auditLog
    .filter(e => !auditActionFilter || e.action === auditActionFilter)
    .filter(e => !auditEntityFilter || e.entity_type === auditEntityFilter);

  const exportAuditCSV = () => {
    const esc = v => `"${String(v == null ? "" : v).replace(/"/g,'""')}"`;
    const rows = [
      ["Timestamp","User","Action","Entity Type","Description","Entity ID"],
      ...filteredAudit.map(e => [
        new Date(e.created_at).toLocaleString(),
        e.user_name || "",
        e.action,
        e.entity_type,
        (typeof e.changes === "object" ? e.changes?.description : "") || "",
        e.entity_id || "",
      ])
    ];
    const csv = rows.map(r => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "finance-audit-log.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // BUILD-12: the page-subtitle blurb was removed (it duplicated the stat
  // cards). Its one non-duplicated number — the vs-prior-period delta — is
  // surfaced on the Revenue card caption below so nothing is silently lost.
  const revDeltaCaption = (() => {
    if (!summary) return null;
    const rev = summary.ytdRevenue || 0, prior = summary.priorRevenue || 0;
    const delta = rev - prior;
    if (!(prior > 0 && delta !== rev)) return null;
    const lastWord = yearMode === "fiscal" ? "last FY" : "last year";
    return `${delta >= 0 ? "↑" : "↓"} ${fmtFull(Math.abs(delta))} vs ${lastWord}`;
  })();

  if (loading) return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <PageTitle main="Your" accent="money."/>
      <div style={{ color:T.ink3, fontSize:13 }}>Loading your money…</div>
    </div>
  );

  const addBtnHandler = (fn) => isReadOnly ? undefined : fn;

  // BUILD-12 clickability: drill any aggregate into the Transactions ledger,
  // pre-filtered by type/fund where it makes sense (no month filter exists yet,
  // so monthly rows land on the full ledger — noted gap).
  const gotoTxns = (patch = {}) => {
    if (patch.type !== undefined) setTxnType(patch.type);
    if (patch.fund !== undefined) setTxnFund(patch.fund);
    setSubtab("transactions");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      {/* Title + year-basis toggle share one row (no dead band under the title). */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, flexWrap:"wrap" }}>
        <PageTitle main="Your" accent="money."/>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, marginTop:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color:T.ink3 }}>Year basis:</span>
            <div style={{ display:"flex", background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, overflow:"hidden" }}>
              {[["fiscal","Fiscal Year"],["calendar","Calendar Year"]].map(([v,l]) => (
                <button key={v} aria-pressed={yearMode===v} onClick={() => handleYearModeChange(v)}
                  style={{ background:"transparent", border:"none", padding:"6px 14px", color:T.ink3, fontSize:12, fontWeight:400, cursor:"pointer", whiteSpace:"nowrap", ...activeMark(yearMode===v,"bottom") }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {summary?.periodLabel && (
            <div style={{ fontSize:11, color:T.ink3 }}>
              {yearMode === "fiscal" ? "Fiscal Year" : "Calendar Year"} &nbsp;·&nbsp; {summary.periodLabel}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showTxnModal && <TransactionModal accounts={accounts} funds={funds} onSave={handleAddTxn} onRouted={handleRouted} onClose={() => setShowTxnModal(false)}/>}
      {(showFundModal || editFund) && <FundModal fund={editFund} onSave={handleSaveFund} onClose={() => { setShowFundModal(false); setEditFund(null); }}/>}

      <SectionTabs tabs={FIN_SECTIONS.map(x => ({ id: x.id, label: x.label }))} active={section}
        onSelect={id => { setSection(id); const sec = FIN_SECTIONS.find(x => x.id === id); if (sec) setSubtabRaw(sec.parts[0].id); }}
        className="finance-tabbar fr-tabbar" dataKey="fin-section"
        stripProps={{ "data-fin-strip": "", "aria-label": "Finance" }} style={{ marginBottom: 12 }}/>
      {(() => {
        const sec = FIN_SECTIONS.find(x => x.id === section) || FIN_SECTIONS[0];
        return (
          <>
            <div style={{ display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap", margin:"0 0 10px" }}>
              <div style={{ fontSize:13, color:T.ink3 }}>{sec.question}</div>
            </div>
            {sec.parts.length > 1 && (
              <div data-fin-parts="" role="navigation" aria-label={sec.label}
                style={{ display:"flex", flexWrap:"wrap", gap:2, marginBottom:14, borderBottom:"1px solid "+T.bg2 }}>
                {sec.parts.map(pt => {
                  const on = subtab === pt.id;
                  return (
                    <button key={pt.id} data-fin-part={pt.id} aria-current={on ? "true" : undefined}
                      onClick={() => setSubtabRaw(pt.id)}
                      style={{ display:"inline-flex", alignItems:"center", gap:6, background:"transparent", color:T.ink3,
                               border:"none", borderRadius:"6px 6px 0 0", padding:"6px 12px", fontSize:12.5,
                               fontWeight:600, cursor:"pointer", whiteSpace:"nowrap", ...activeMark(on,"bottom") }}>
                      {pt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Restricted (BUILD-100 Part 7) ── */}
      {/* FIX-1 E: where restricted money sits is the first thing Finance shows,
          with cash on hand beneath it in one line and its defining sentence. */}
      {subtab === "restricted" && <>
        <RestrictedView isReadOnly={isReadOnly} onNavigate={onNavigate}/>
        {summary && (
          <Card>
            <div data-testid="cash-on-hand-line" style={{ display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em" }}>Cash on hand</span>
              <span style={{ fontSize:18, fontWeight:800, color:T.ink, fontFamily:"'DM Serif Display',serif" }}>{fmt(summary.cashOnHand)}</span>
            </div>
            <div style={{ fontSize:12, color:T.ink3, marginTop:4, lineHeight:1.55 }}>{CASH_ON_HAND_SENTENCE}</div>
          </Card>
        )}
      </>}

      {/* ── Payouts (FIX-1 E): which gifts made up this payout ── */}
      {subtab === "payouts" && <PayoutsView onNavigate={onNavigate} openId={openPayout} onOpen={setOpenPayout}/>}

      {/* ── FIN-1 · the deposit sheet, where a treasurer looks for it ── */}
      {subtab === "deposits" && <DepositSheetCard onNavigate={onNavigate} isReadOnly={isReadOnly}/>}

      {/* ── FIN-1 · the year-end statement run, in Exports with the rest ── */}
      {subtab === "yearend" && <YearEndCard isReadOnly={isReadOnly} onNavigate={onNavigate}/>}

      {/* ── Monthly close (FIX-1 E): what goes to the bookkeeper this month ── */}
      {subtab === "close" && <MonthlyClose/>}

      {/* ── Overview ── */}
      {subtab === "overview" && <>
        {/* FIN-1 — THE FOUR FIGURES A TREASURER OPENS FINANCE TO ASK, above
            everything else, each one opening its rows and footing to the
            cent. The period tiles below are unchanged and still there: they
            answer a different question (the fiscal-year picture) and one is
            not a replacement for the other. */}
        <FinOverview onNavigate={onNavigate}/>
        {/* FIX-1 E — the period figures live on Overview now; Restricted leads. */}
        {summary && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10 }}>
              {[
                // Cash on Hand is ALL-TIME (Σ income − Σ expense over the whole ledger);
                // the other three are the selected period. The captions make the scope
                // explicit so a treasurer never reads cash and period revenue as the
                // same kind of number.
                ["Cash on Hand", fmt(summary.cashOnHand), summary.cashOnHand >= 0 ? IN : OUT, CASH_ON_HAND_SENTENCE, () => gotoTxns({ type: "" })],
                [yearMode==="fiscal" ? "FY Revenue" : "YTD Revenue", fmt(summary.ytdRevenue), IN, revDeltaCaption || summary.periodLabel, () => gotoTxns({ type: "income" })],
                [yearMode==="fiscal" ? "FY Expenses" : "YTD Expenses", fmt(summary.ytdExpenses), OUT, summary.periodLabel, () => gotoTxns({ type: "expense" })],
                ["Net Surplus", fmt(summary.netSurplus), summary.netSurplus >= 0 ? IN : OUT, summary.periodLabel, () => gotoTxns({ type: "" })],
              ].map(([label, value, color, caption, onClick]) => (
                <div key={label} {...interactive(onClick, { label: `View ${label} in transactions` })}
                  style={{ background:T.white, border:"1px solid "+T.bg3, borderRadius:12, padding:"14px 16px" }}>
                  <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>{label}</div>
                  <div style={{ fontSize:22, fontWeight:800, color, fontFamily:"'DM Serif Display',serif" }}>{value}</div>
                  {caption && <div style={{ fontSize:10, color:T.ink3, marginTop:4 }}>{caption}</div>}
                </div>
              ))}
            </div>
          </>
        )}
        {/* B1 — never let Finance read as "$0 raised" next to a Reports page
            showing years of giving. When imported historical giving lives in
            Reports but not the ledger, say so plainly and cross-link, so a
            treasurer can reconcile the two numbers instead of distrusting both. */}
        {summary?.hasUnledgeredGiving && (
          <div style={{ background:T.gold100, border:"1px solid "+T.gold300, borderRadius:12, padding:"14px 16px", display:"flex", gap:14, alignItems:"flex-start", flexWrap:"wrap" }}>
            <div style={{ flex:"1 1 320px", minWidth:260 }}>
              <div style={{ fontSize:13, fontWeight:700, color:T.ink, marginBottom:3 }}>
                Your giving history lives in Reports
              </div>
              <div style={{ fontSize:12, color:T.ink2, lineHeight:1.5 }}>
                {fmtFull(summary.unledgeredGiving)} of imported giving{summary.giftHistoryCount ? ` across ${summary.giftHistoryCount.toLocaleString()} gifts` : ""} isn't in this ledger.
                The ledger tracks <strong>money moving through Steward</strong> — connect Stripe or log a transaction. Your full giving record is in Reports.
              </div>
            </div>
            <button onClick={() => onNavigate("reports")}
              style={{ background:T.white, color:T.ink, border:"1.5px solid "+T.ink, borderRadius:8, padding:"9px 14px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
              View giving in Reports →
            </button>
          </div>
        )}
        <MoneyInStrip onNavigate={onNavigate} cashOnHand={summary ? summary.cashOnHand : null} onOpenPayout={id => { setOpenPayout(id); setSubtab("payouts"); }}/>
        <Card>
          {/* Follows the selected year basis (server-supplied, Jul-first under
              fiscal) and collapses empty months into a single line instead of a
              wall of $0 bars. */}
          <SectionLabel>Monthly Breakdown · {summary?.monthlyLabel || ""}</SectionLabel>
          {(() => {
            const months = summary?.monthly || [];
            const active = months.filter(m => m.income !== 0 || m.expense !== 0);
            if (active.length === 0)
              return <EmptyState title="No money has moved yet" message="Log your first transaction — or connect Stripe above — and your month-by-month income and spending will chart here."/>;
            const maxBar = Math.max(...active.map(m => m.income), 1);
            const hidden = months.length - active.length;
            return <>
              {active.map((m) => {
                const net = m.income - m.expense;
                return (
                  <div key={m.key} {...interactive(() => gotoTxns({ type: "" }), { label: `View ${m.label} transactions` })}
                    style={{ padding:"0 12px 12px", margin:"0 -12px 12px", borderRadius:8, borderBottom:"1px solid "+T.bg3 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{m.label}</span>
                      <div style={{ display:"flex", gap:12 }}>
                        <span style={{ fontSize:11, color:IN }}>↑ {fmtFull(m.income)}</span>
                        <span style={{ fontSize:11, color:OUT }}>↓ {fmtFull(m.expense)}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:net>=0?IN:OUT }}>{net>=0?"+":""}{fmtFull(net)}</span>
                      </div>
                    </div>
                    <div style={{ height:5, background:T.bg2, borderRadius:99, overflow:"hidden", marginBottom:3 }}>
                      <div style={{ height:"100%", width:`${(m.income/maxBar)*100}%`, background:IN, borderRadius:99 }}/>
                    </div>
                    <div style={{ height:4, background:T.bg2, borderRadius:99, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(m.expense/maxBar)*100}%`, background:OUT, borderRadius:99, opacity:0.85 }}/>
                    </div>
                  </div>
                );
              })}
              {hidden > 0 && (
                <div style={{ fontSize:12, color:T.ink3, fontStyle:"italic", paddingTop:2 }}>
                  No activity yet in the other {hidden} month{hidden === 1 ? "" : "s"}.
                </div>
              )}
            </>;
          })()}
        </Card>
        <Card>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:4 }}>
            <div>
              <SectionLabel>Fund Balances</SectionLabel>
              <div style={{ fontSize:10, color:T.ink3, marginTop:2 }}>Cumulative — all money in minus out, since inception</div>
            </div>
            {onNavigate && funds.length > 0 && (
              <button onClick={() => onNavigate("reports", { report: "std:by-fund" })} style={{ background:"none", border:"none", color:T.greenMid, fontSize:12, fontWeight:700, cursor:"pointer", padding:0 }}>Gifts by fund →</button>
            )}
          </div>
          {finFundBalances.length === 0
            ? <EmptyState title="No funds yet" message="Funds are how you track which dollars are restricted. Add one under the Funds tab and every gift you log can be tagged to it."/>
            : finFundBalances.map((f, i) => (
              <div key={f.name} {...interactive(() => f.id ? gotoTxns({ fund: f.id }) : setSubtab("funds"), { label: `View ${f.name} fund` })}
                style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 12px", margin:"0 -12px", borderRadius:8, borderBottom: i < finFundBalances.length - 1 ? "1px solid "+T.bg3 : "" }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:f.restricted?T.gold:T.ink3, flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:T.ink }}>{f.name}</div>
                  <div style={{ fontSize:10, color:f.restricted?T.gold700:T.ink3, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", marginTop:1 }}>{f.restricted ? "Restricted" : "Unrestricted"}</div>
                </div>
                <div style={{ fontSize:18, fontWeight:800, color:f.balance>=0?T.ink:OUT, fontFamily:"'DM Serif Display',serif" }}>{fmt(f.balance)}</div>
              </div>
            ))}
        </Card>
      </>}

      {/* ── Transactions ── */}
      {subtab === "transactions" && <>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }} className="filter-bar">
          <input value={txnFilter} onChange={e => setTxnFilter(e.target.value)} placeholder="Search transactions…" style={{ ...inp, flex:1, minWidth:160 }}/>
          <select value={txnType} onChange={e => setTxnType(e.target.value)} style={{ ...inp, width:120, cursor:"pointer" }}>
            <option value="">All types</option>
            <option value="income">Money in</option>
            <option value="expense">Money out</option>
          </select>
          <select value={txnSource} onChange={e => setTxnSource(e.target.value)} style={{ ...inp, width:130, cursor:"pointer" }}>
            <option value="">All sources</option>
            <option value="online">Online · Stripe</option>
            <option value="gift">Gift</option>
            <option value="manual">Manual</option>
            <option value="import">Import</option>
          </select>
          <select value={txnFund} onChange={e => setTxnFund(e.target.value)} style={{ ...inp, width:140, cursor:"pointer" }}>
            <option value="">All funds</option>
            {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select value={txnYear} onChange={e => { const yr = parseInt(e.target.value); setTxnYear(yr); reloadTxns(yr); }} style={{ ...inp, width:100, cursor:"pointer" }}>
            {[2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button style={writeBtn(isReadOnly, btn(IN))} onClick={addBtnHandler(() => setShowTxnModal(true))} title={isReadOnly ? RO_TIP : ""}>+ Add transaction</button>
        </div>
        <Card style={{ padding:0, overflow:"hidden" }}>
          {sortedTxns.length === 0
            ? <EmptyState title="No transactions here" message="This is your unified ledger — every online gift, manual entry, and imported record lands here. Log one, or connect Stripe, to begin."/>
            : (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:T.bg2 }}>
                      {[["date","Date"],["amount","Amount"],["description","Description"],["account_name","Account"],["fund_name","Fund"]].map(([col, label]) => (
                        <th key={col} onClick={() => toggleSort(col)} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", cursor:"pointer", whiteSpace:"nowrap" }}>
                          {label}{sortArrow(col)}
                        </th>
                      ))}
                      <th style={{ padding:"10px 14px", width:40 }}/>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTxns.map((t, i) => {
                      const sm = sourceMeta(t.source, t.grant_id);
                      const linkedDonor = t.donor_id && donorById[t.donor_id];
                      return (
                      <tr key={t.id} style={{ borderTop:"1px solid "+T.bg3, background: i%2===0?T.white:T.ground }}>
                        <td style={{ padding:"10px 14px", color:T.ink3, whiteSpace:"nowrap" }}>{displayDate(t.date)}</td>
                        <td style={{ padding:"10px 14px", fontWeight:700, color:t.type==="income"?IN:OUT, whiteSpace:"nowrap", textAlign:"right" }}>
                          {t.type === "income" ? "+" : "−"}{fmtFull(parseFloat(t.amount))}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                            <span style={{ fontWeight:600, color:T.ink }}>{t.description}</span>
                            <span style={{ background:sm.bg, color:sm.color, borderRadius:99, padding:"1px 8px", fontSize:10, fontWeight:700 }}>{sm.label}</span>
                          </div>
                          {t.vendor_donor && <div style={{ fontSize:11, color:T.ink3, marginTop:2 }}>
                            {linkedDonor && onNavigate
                              ? <button onClick={() => onNavigate("donors", { selectDonorId:t.donor_id })} style={{ background:"none", border:"none", padding:0, color:T.greenMid, fontWeight:600, cursor:"pointer", fontSize:11, textDecoration:"underline" }}>{t.vendor_donor}</button>
                              : t.vendor_donor}
                          </div>}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          {t.account_name && (
                            <span style={{ background:(TYPE_COLOR[t.account_type]||T.ink3)+"1e", color:TYPE_COLOR[t.account_type]||T.ink3, borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
                              {t.account_code} {t.account_name}
                            </span>
                          )}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          {t.fund_name && (
                            <span style={{ background:t.fund_restricted?T.gold+"22":T.bg2, color:t.fund_restricted?T.gold700:T.ink, borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
                              {t.fund_name}
                            </span>
                          )}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          <button onClick={() => handleDeleteTxn(t.id)} style={{ background:"none", border:"none", cursor:"pointer", color:T.ink3, fontSize:14 }}>×</button>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop:"2px solid "+T.bg3, background:T.bg2 }}>
                      <td style={{ padding:"10px 14px", fontSize:12, fontWeight:700, color:T.ink3 }}>Totals</td>
                      <td style={{ padding:"10px 14px", textAlign:"right" }}>
                        <div style={{ fontSize:12, color:IN, fontWeight:700 }}>+{fmtFull(sortedTxns.filter(t=>t.type==="income").reduce((s,t)=>s+parseFloat(t.amount),0))}</div>
                        <div style={{ fontSize:12, color:OUT, fontWeight:700 }}>−{fmtFull(sortedTxns.filter(t=>t.type==="expense").reduce((s,t)=>s+parseFloat(t.amount),0))}</div>
                      </td>
                      <td colSpan={4}/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </Card>
      </>}

      {/* ── Funds ── */}
      {subtab === "funds" && <>
        {/* FIN-1 — ONE CARD PER FUND: balance, in and out this period, and
            the restriction, with WHO restricted it read from the grants and
            the gifts rather than guessed from the fund's name. The table
            below is unchanged. */}
        <FinFundCards/>
        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <button style={writeBtn(isReadOnly, btn(IN))} onClick={addBtnHandler(() => setShowFundModal(true))} title={isReadOnly ? RO_TIP : ""}>+ Add fund</button>
        </div>
        <Card>
          <SectionLabel>Fund Accounting</SectionLabel>
          <div style={{ fontSize:12, color:T.ink3, marginBottom:14, lineHeight:1.6 }}>
            Every transaction is tagged to a fund. Restricted funds hold donor- or grant-restricted dollars and must be spent only for the designated purpose.
          </div>
          {funds.length === 0
            ? <EmptyState title="No funds yet" message="Create your first fund — most orgs start with one General Operating fund and add restricted funds as grants and designated gifts come in."/>
            : funds.map((f, i) => {
            const fb = _fbMap[f.id] || { income:0, expense:0 };
            const balance = fb.income - fb.expense;
            const sparkVals = getFundSparkline(f.id);
            return (
              <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderTop: i > 0 ? "1px solid "+T.bg3 : "" }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:f.restricted?T.gold:T.ink3, flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{f.name}</span>
                    <span style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", color:f.restricted?T.gold700:T.ink3 }}>{f.restricted ? "Restricted" : "Unrestricted"}</span>
                  </div>
                  {f.description && <div style={{ fontSize:12, color:T.ink3, marginTop:2 }}>{f.description}</div>}
                  <div style={{ fontSize:11, color:T.ink3, marginTop:4 }}>
                    ↑ {fmtFull(fb.income)} in &nbsp;·&nbsp; ↓ {fmtFull(fb.expense)} out &nbsp;·&nbsp;
                    <span style={{ fontWeight:700, color:balance >= 0?IN:OUT }}>Balance: {fmtFull(balance)}</span>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                  <Sparkline values={sparkVals}/>
                  <span style={{ fontSize:9, color:T.ink3, textTransform:"uppercase", letterSpacing:".05em" }}>8 wks</span>
                </div>
                <button style={ghostBtn} onClick={() => gotoTxns({ fund: f.id })}>View txns →</button>
                <button style={ghostBtn} onClick={() => setEditFund(f)}>Edit</button>
              </div>
            );
          })}
        </Card>
      </>}

      {/* ── Budgets ── */}
      {subtab === "budgets" && <>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:13, color:T.ink3 }}>Year:</span>
          <select value={budgetYear} onChange={e => { const yr = parseInt(e.target.value); setBudgetYear(yr); reloadBudgets(yr); }} style={{ ...inp, width:90, cursor:"pointer" }}>
            {[2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {!isReadOnly && <span style={{ fontSize:12, color:T.ink3, marginLeft:4 }}>Click any budget cell to edit inline. A budget can name a fund; leave it on "Whole account" for the whole column.</span>}
        </div>
        {budgetErr && <div role="alert" style={{ fontSize:12.5, color:T.terra700 }}>{budgetErr}</div>}
        {budgets.length === 0 && (
          <Card><EmptyState title="No revenue or expense accounts yet" message="Budgets are built from your chart of accounts, which Steward sets up when your organization starts. Once it has revenue and expense accounts they appear here to budget against."/></Card>
        )}
        {["revenue","expense"].map(section => {
          const rows = budgets.filter(b => b.accountType === section);
          if (!rows.length) return null;
          const totBudget = rows.reduce((s,b) => s + b.budget, 0);
          const totActual = rows.reduce((s,b) => s + b.actual, 0);
          const totVar = totBudget - totActual;
          return (
            <Card key={section}>
              <SectionLabel>{section === "revenue" ? "Revenue Budget" : "Expense Budget"}</SectionLabel>
              <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr style={{ background:T.bg2 }}>
                    <th style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em" }}>Account</th>
                    <th style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em" }}>Fund</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em" }}>Budget</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em" }}>Actual YTD</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em" }}>Variance</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em" }}>Proj. Year-End</th>
                    <th style={{ padding:"8px 12px", width:80 }}/>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const pct = b.budget > 0 ? Math.round(b.actual / b.budget * 100) : 0;
                    const over = section === "expense" ? b.actual > b.budget : b.actual < b.budget * 0.5;
                    const projected = monthsElapsed > 0 && b.actual > 0 ? Math.round((b.actual / monthsElapsed) * 12) : b.actual;
                    const overProj = section === "expense" && b.budget > 0 && projected > b.budget;
                    return (
                      <tr key={b.id || b.accountId} data-budget-row={b.accountId} style={{ borderTop:"1px solid "+T.bg3 }}>
                        <td style={{ padding:"10px 12px" }}>
                          <span style={{ fontSize:11, color:T.ink3, marginRight:8 }}>{b.accountCode}</span>
                          <span style={{ fontWeight:600, color:T.ink }}>{b.accountName}</span>
                        </td>
                        {/* A.3 — WHICH FUND this line commits. Blank is the whole
                            account, which is every budget written before today. */}
                        <td style={{ padding:"10px 12px" }}>
                          {isReadOnly
                            ? <span style={{ color:T.ink3 }}>{b.fundName || "Whole account"}</span>
                            : <select value={b.fundId || ""} aria-label="Fund" data-testid="budget-fund"
                                onChange={e => handleBudgetFund(b, e.target.value)}
                                style={{ ...inp, width:170, cursor:"pointer" }}>
                                <option value="">Whole account</option>
                                {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>}
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right" }}>
                          {isReadOnly
                            ? <span style={{ fontWeight:600, color:T.ink }}>{fmtFull(b.budget)}</span>
                            : <BudgetInput value={b.budget} onSave={val => handleBudgetChange(b.accountId, val, b.fundId)}/>}
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:600, color:T.ink }}>
                          <div>{fmtFull(b.actual)}</div>
                          {b.budget > 0 && <div style={{ fontSize:10, color:T.ink3 }}>{pct}% of budget</div>}
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:over?OUT:IN }}>
                          {b.variance >= 0 ? "+" : ""}{fmtFull(b.variance)}
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:overProj?OUT:T.ink3 }}>
                          {fmtFull(projected)}
                          {overProj && <div style={{ fontSize:10, color:OUT }}>over budget</div>}
                        </td>
                        <td style={{ padding:"10px 12px" }}>
                          <div style={{ height:6, background:T.bg3, borderRadius:99, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${Math.min(pct,100)}%`, background:over?OUT:IN, borderRadius:99 }}/>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:"2px solid "+T.bg3, background:T.bg2 }}>
                    <td style={{ padding:"10px 12px", fontWeight:700, fontSize:12 }}>Total</td>
                    <td/>
                    <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700 }}>{fmtFull(totBudget)}</td>
                    <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700 }}>{fmtFull(totActual)}</td>
                    <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:totVar>=0?IN:OUT }}>{totVar>=0?"+":""}{fmtFull(totVar)}</td>
                    <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:T.ink3 }}>{fmtFull(monthsElapsed>0?Math.round((totActual/monthsElapsed)*12):totActual)}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
              </div>
            </Card>
          );
        })}
      </>}

      {/* ── Audit Log ── */}
      {subtab === "audit" && <>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }} className="filter-bar">
          <select value={auditActionFilter} onChange={e => setAuditActionFilter(e.target.value)} style={{ ...inp, width:140, cursor:"pointer" }}>
            <option value="">All actions</option>
            <option value="created">Created</option>
            <option value="updated">Updated</option>
            <option value="deleted">Deleted</option>
          </select>
          <select value={auditEntityFilter} onChange={e => setAuditEntityFilter(e.target.value)} style={{ ...inp, width:160, cursor:"pointer" }}>
            <option value="">All entity types</option>
            <option value="transaction">Transaction</option>
            <option value="account">Account</option>
            <option value="fund">Fund</option>
            <option value="budget">Budget</option>
          </select>
          <span style={{ fontSize:12, color:T.ink3, marginLeft:4 }}>{filteredAudit.length} entries</span>
          <button style={{ ...ghostBtn, marginLeft:"auto" }} onClick={exportAuditCSV}>Export CSV</button>
        </div>
        <Card style={{ padding:0, overflow:"hidden" }}>
          {auditLoading
            ? <div style={{ padding:24, color:T.ink3, fontSize:13 }}>Loading audit log…</div>
            : filteredAudit.length === 0
              ? <EmptyState title="No changes recorded yet" message="Every edit to a transaction, account, fund, or budget is logged here with who, what, and when — your paper trail for the board and auditors."/>
              : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead>
                      <tr style={{ background:T.bg2 }}>
                        {["Timestamp","User","Action","Entity","Description"].map(h => (
                          <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", whiteSpace:"nowrap" }}>{h}</th>
                        ))}
                        <th style={{ padding:"10px 14px", width:40 }}/>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAudit.map((entry, i) => {
                        const expanded = expandedAuditRows.has(entry.id);
                        const changes = typeof entry.changes === "object" && entry.changes ? entry.changes : {};
                        const hasOldNew = (changes.old && Object.keys(changes.old).length > 0) || (changes.new && Object.keys(changes.new).length > 0);
                        const ACTION_STYLE = {
                          created: { bg:T.bg2, color:T.ink },
                          updated: { bg:T.gold+"26", color:T.gold700 },
                          deleted: { bg:OUT+"20", color:OUT },
                        };
                        const as = ACTION_STYLE[entry.action] || { bg:T.bg2, color:T.ink3 };
                        return (
                          <Fragment key={entry.id}>
                            <tr style={{ borderTop:"1px solid "+T.bg3, background:i%2===0?"transparent":T.ink+"44" }}>
                              <td style={{ padding:"10px 14px", color:T.ink3, whiteSpace:"nowrap", fontSize:11, fontFamily:"'Fira Mono',monospace" }}>
                                {new Date(entry.created_at).toLocaleString()}
                              </td>
                              <td style={{ padding:"10px 14px", fontSize:12, color:T.ink }}>{entry.user_name || "System"}</td>
                              <td style={{ padding:"10px 14px" }}>
                                <span style={{ fontSize:11, fontWeight:700, borderRadius:5, padding:"2px 8px", background:as.bg, color:as.color }}>{entry.action}</span>
                              </td>
                              <td style={{ padding:"10px 14px", color:T.ink3, fontSize:12 }}>{entry.entity_type}</td>
                              <td style={{ padding:"10px 14px", fontSize:12, color:T.ink, maxWidth:320 }}>{changes.description || "—"}</td>
                              <td style={{ padding:"10px 14px" }}>
                                {hasOldNew && (
                                  <button onClick={() => setExpandedAuditRows(prev => {
                                    const next = new Set(prev);
                                    expanded ? next.delete(entry.id) : next.add(entry.id);
                                    return next;
                                  })} style={{ background:"none", border:"none", cursor:"pointer", color:T.ink3, fontSize:11 }}>
                                    {expanded ? "▲" : "▼"}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {expanded && hasOldNew && (
                              <tr style={{ background:T.bg2 }}>
                                <td colSpan={6} style={{ padding:"10px 24px 14px 24px" }}>
                                  <div style={{ display:"flex", gap:32 }}>
                                    {changes.old && Object.keys(changes.old).length > 0 && (
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:700, color:OUT, marginBottom:6, textTransform:"uppercase", letterSpacing:".06em" }}>Before</div>
                                        {Object.entries(changes.old).map(([k, v]) => (
                                          <div key={k} style={{ fontSize:12, color:T.ink, marginBottom:2 }}>
                                            <span style={{ color:T.ink3 }}>{k}:</span> {String(v ?? "—")}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {changes.new && Object.keys(changes.new).length > 0 && (
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:700, color:T.ink3, marginBottom:6, textTransform:"uppercase", letterSpacing:".06em" }}>After</div>
                                        {Object.entries(changes.new).map(([k, v]) => (
                                          <div key={k} style={{ fontSize:12, color:T.ink, marginBottom:2 }}>
                                            <span style={{ color:T.ink3 }}>{k}:</span> {String(v ?? "—")}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
          }
        </Card>
      </>}
    </div>
  );
}

// ── Sparkline — 8-week SVG trend line ─────────────────────────────────────
function Sparkline({ values, width = 80, height = 28 }) {
  // Drop any non-finite point (a null/NaN amount upstream) so bad data degrades
  // to a flat/short line instead of emitting "NaN,NaN" SVG coords (BUILD-21).
  values = (Array.isArray(values) ? values : []).filter(v => Number.isFinite(v));
  if (!values || values.length < 2) {
    return <svg width={width} height={height}><line x1={0} y1={height/2} x2={width} y2={height/2} stroke={T.bg3} strokeWidth="1" strokeDasharray="3,2"/></svg>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = (height - pad * 2) - ((v - min) / range) * (height - pad * 2) + pad;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const trending = values[values.length - 1] >= values[0];
  const color = trending ? T.ink : T.gold600;
  return (
    <svg width={width} height={height} style={{ display:"block", overflow:"visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── BudgetInput — inline editable cell ────────────────────────────────────
function BudgetInput({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { onSave(val); setEditing(false); }}
        onKeyDown={e => { if (e.key === "Enter") { onSave(val); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
        style={{ ...inp, width:90, padding:"4px 8px", textAlign:"right" }}
      />
    );
  }
  return (
    <span onClick={() => { setVal(String(value)); setEditing(true); }}
      style={{ cursor:"text", fontWeight:600, color:T.ink, padding:"4px 8px", borderRadius:6, border:"1px solid transparent", display:"inline-block", minWidth:80, textAlign:"right" }}
      title="Click to edit">
      {fmtFull(value)}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  FIN-1 · THE SCREENS A TREASURER TRUSTS ON SIGHT
// ═══════════════════════════════════════════════════════════════════════════

// A figure that OPENS. The number, its one sentence, and the rows behind it —
// with the rows saying out loud whether they add up to the figure, because
// "trust me" is exactly what a bookkeeper will not do.
function FinFigure({ f, onOpen }) {
  return (
    <button data-testid={"fin-figure-" + f.key} onClick={() => onOpen(f)} title={f.definition}
      style={{ background:T.white, border:"1px solid "+T.bg2, borderRadius:12, padding:"15px 16px",
               textAlign:"left", cursor:"pointer", fontFamily:"inherit", minWidth:0 }}>
      <div style={{ fontSize:10.5, color:T.ink3, textTransform:"uppercase", letterSpacing:".07em", marginBottom:5 }}>{f.label}</div>
      <div style={{ fontSize:26, fontWeight:800, color:T.ink, fontFamily:"'DM Serif Display',serif", lineHeight:1.1 }}>{fmtFull(f.amount)}</div>
    </button>
  );
}

function FinOverview({ onNavigate }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch("/finance/overview").then(r => { if (alive) setD(r); })
      .catch(e => { if (alive) setErr(errorMessage(e, "Steward could not add up this month.")); });
    return () => { alive = false; };
  }, []);

  async function openFigure(f) {
    setOpen({ loading: true, label: f.label, definition: f.definition });
    try { setOpen({ ...(await apiFetch(`/finance/overview/rows?rows=${encodeURIComponent(f.rows)}`)), label: f.label, definition: f.definition }); }
    catch (e) { setOpen({ label: f.label, error: errorMessage(e, "Those rows did not open.") }); }
  }
  async function openMonth(m) {
    setOpen({ loading: true, label: m.month });
    try { setOpen({ ...(await apiFetch(`/finance/overview/month?month=${m.month}`)), label: m.month }); }
    catch (e) { setOpen({ label: m.month, error: errorMessage(e, "Those gifts did not open.") }); }
  }

  if (err) return <Card><div role="alert" style={{ fontSize:13, color:T.terra700 }}>{err}</div></Card>;
  if (!d) return <Card><div style={{ fontSize:12, color:T.ink3 }}>Adding up this month…</div></Card>;

  const maxBar = Math.max(...d.byMonth.map(m => m.cents), 1);
  const monthWord = k => new Date(k + "-01T12:00:00Z").toLocaleDateString("en-US", { month:"short", timeZone:"UTC" });

  return (
    <div data-testid="fin-overview" style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ fontSize:13, color:T.ink3, lineHeight:1.6 }}>{d.sentence}</div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:10 }}>
        {d.figures.map(f => <FinFigure key={f.key} f={f} onOpen={openFigure}/>)}
      </div>

      {/* MONEY IN BY MONTH, and every bar opens its gifts. Empty months are
          zeros rather than gaps: a chart that skips them makes a quiet year
          look like a busy one. */}
      <Card>
        <SectionLabel>Money in, by month</SectionLabel>
        <div data-testid="fin-bars" style={{ display:"flex", alignItems:"flex-end", gap:6, height:120, marginTop:8 }}>
          {d.byMonth.map(m => (
            <button key={m.month} data-testid={"fin-bar-" + m.month} onClick={() => openMonth(m)}
              title={`${m.month} · ${fmtFull(m.amount)} from ${m.gifts} ${m.gifts === 1 ? "gift" : "gifts"}`}
              style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"flex-end", alignItems:"center",
                       gap:5, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", minWidth:0, height:"100%" }}>
              <span style={{ width:"100%", height:`${Math.max(2, (m.cents / maxBar) * 84)}%`,
                             background: m.cents ? T.greenDk : T.bg2, borderRadius:"5px 5px 0 0" }}/>
              <span style={{ fontSize:10, color:T.ink3, whiteSpace:"nowrap" }}>{monthWord(m.month)}</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize:12, color:T.ink3, marginTop:10, lineHeight:1.5 }}>
          Twelve months of gifts, in your organisation&apos;s own months. Every bar opens the gifts behind it.
        </div>
      </Card>

      {/* NEEDS YOU. Three things at most, each one a thing somebody can do
          today, each with its rows. Not a health score and not a warning. */}
      <Card>
        <SectionLabel>Needs you</SectionLabel>
        {!d.needsYou.length && (
          <div style={{ fontSize:13, color:T.ink3, lineHeight:1.6, marginTop:6 }}>
            Nothing is waiting. Every gift is on a fund, every cheque is on a deposit, and no restricted grant has a report due inside sixty days.
          </div>
        )}
        {d.needsYou.map(n => (
          <button key={n.key} data-testid={"fin-needs-" + n.key}
            onClick={() => openFigure({ rows: n.rows, label: n.label, definition: n.sentence })}
            style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none",
                     borderTop:"1px solid "+T.bg2, padding:"11px 2px", cursor:"pointer", fontFamily:"inherit" }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"baseline", flexWrap:"wrap" }}>
              <span style={{ fontSize:13.5, fontWeight:700, color:T.ink }}>{n.label}</span>
              <span style={{ fontSize:13, fontWeight:700, color:T.gold700 }}>
                {n.count}{n.amount != null ? ` · ${fmtFull(n.amount)}` : ""}
              </span>
            </div>
            <div style={{ fontSize:12.5, color:T.ink3, marginTop:3, lineHeight:1.5 }}>{n.sentence}</div>
          </button>
        ))}
      </Card>

      <Definitions4 items={d.figures.map(f => [f.label, f.definition])}/>

      {open && (
        <Modal onClose={() => setOpen(null)} title={open.label + (open.total != null ? ` · ${fmtFull(open.total)}` : "")}>
          {open.error && <div role="alert" style={{ fontSize:13, color:T.terra700 }}>{open.error}</div>}
          {open.loading && <div style={{ fontSize:13, color:T.ink3 }}>Opening the rows…</div>}
          {open.sentence && (
            <div data-testid="fin-rows-sentence"
              style={{ fontSize:13, color: open.foots === false ? T.gold700 : T.ink2, lineHeight:1.6, marginBottom:12 }}>
              {open.sentence}
            </div>
          )}
          {open.definition && <div style={{ fontSize:12, color:T.ink3, lineHeight:1.55, marginBottom:12 }}>{open.definition}</div>}
          {open.rows && (
            <div style={{ maxHeight:380, overflowY:"auto" }}>
              {!open.rows.length && <div style={{ fontSize:13, color:T.ink3 }}>No rows.</div>}
              {open.rows.map((r, i) => (
                <div key={r.id || i} style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"baseline",
                                              padding:"8px 0", borderBottom:"1px solid "+T.bg2, fontSize:13 }}>
                  <span style={{ color:T.ink, minWidth:0 }}>
                    {r.date || r.report_due || r.name || ""}
                    {r.who ? ` · ${r.who}` : ""}{r.funder ? ` · ${r.funder}` : ""}{r.program ? ` · ${r.program}` : ""}
                    {r.fund ? <span style={{ color:T.ink3 }}> · {r.fund}</span> : null}
                    {r.payment_method ? <span style={{ color:T.ink3 }}> · {r.payment_method}</span> : null}
                  </span>
                  <span style={{ fontWeight:700, color:T.ink, whiteSpace:"nowrap" }}>
                    {r.amount != null ? fmtFull(r.amount) : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// FIN-1 — one card per fund. Balance, in and out this period, the
// restriction, and WHO restricted it.
function FinFundCards() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch("/finance/funds-detail").then(r => { if (alive) setD(r); })
      .catch(e => { if (alive) setErr(errorMessage(e, "The funds did not load.")); });
    return () => { alive = false; };
  }, []);
  async function openFund(f) {
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
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:12 }}>
        {d.funds.map(f => (
          <button key={f.id} data-testid="fin-fund-card" onClick={() => openFund(f)}
            style={{ background:T.white, border:"1px solid "+T.bg2, borderRadius:12, padding:"16px 17px",
                     textAlign:"left", cursor:"pointer", fontFamily:"inherit",
                     borderLeft:"3px solid "+(f.restricted ? T.gold500 : T.greenDk) }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"baseline", flexWrap:"wrap" }}>
              <span style={{ fontSize:14.5, fontWeight:700, color:T.ink }}>{f.name}</span>
              <span style={{ fontSize:11, fontWeight:700, borderRadius:99, padding:"2px 9px",
                             background: f.restricted ? T.gold100 : T.green100,
                             color: f.restricted ? T.gold700 : T.greenDk }}>
                {f.restricted ? "Restricted" : "Unrestricted"}
              </span>
            </div>
            <div style={{ fontSize:26, fontWeight:800, color:T.ink, fontFamily:"'DM Serif Display',serif", lineHeight:1.15, marginTop:6 }}>
              {fmtFull(f.balance)}
            </div>
            <div style={{ fontSize:12, color:T.ink3, marginTop:4 }}>
              In {fmtFull(f.inPeriod)} · out {fmtFull(f.outPeriod)} this period
            </div>
            <div style={{ fontSize:12.5, color:T.ink2, marginTop:8, lineHeight:1.55 }}>{f.sentence}</div>
          </button>
        ))}
      </div>
      <Definitions4 items={Object.entries(d.definitions || {})}/>
      {open && (
        <Modal onClose={() => setOpen(null)} title={open.label + (open.net != null ? ` · ${fmtFull(open.net)} net` : "")}>
          {open.error && <div role="alert" style={{ fontSize:13, color:T.terra700 }}>{open.error}</div>}
          {open.loading && <div style={{ fontSize:13, color:T.ink3 }}>Opening the rows…</div>}
          {open.sentence && <div style={{ fontSize:13, color:T.ink2, lineHeight:1.6, marginBottom:12 }}>{open.sentence}</div>}
          {open.rows && (
            <div style={{ maxHeight:380, overflowY:"auto" }}>
              {!open.rows.length && <div style={{ fontSize:13, color:T.ink3 }}>Nothing has moved through this fund yet.</div>}
              {open.rows.map(r => (
                <div key={r.id} style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"8px 0",
                                         borderBottom:"1px solid "+T.bg2, fontSize:13 }}>
                  <span style={{ color:T.ink, minWidth:0 }}>{r.date} · {r.description || r.vendor_donor || ""}</span>
                  <span style={{ fontWeight:700, color: r.type === "income" ? IN : OUT, whiteSpace:"nowrap" }}>
                    {r.type === "income" ? "+" : "−"}{fmtFull(r.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// FIN-1 — the deposit sheet, where a treasurer looks for it. The sheet
// itself lives in Donors (it writes gifts, and a gift is written in one
// place); this is the door, beside the payouts it reconciles against.
function DepositSheetCard({ onNavigate, isReadOnly }) {
  return (
    <Card>
      <SectionLabel>The deposit sheet</SectionLabel>
      <div style={{ fontSize:13, color:T.ink2, lineHeight:1.6, maxWidth:640 }}>
        Cheques and cash, keyed as one slip that has to foot before Steward will write a single gift.
        Photograph the cheques and Steward reads the amounts; the two amounts are cross-checked, and a
        slip that does not add up is refused rather than half-entered.
      </div>
      <div style={{ fontSize:12.5, color:T.ink3, lineHeight:1.55, marginTop:8, maxWidth:640 }}>
        It lives with the donors because it writes gifts, and a gift is written in one place.
        Anything banked and not yet on a slip shows up as <strong>Deposits not yet matched</strong> on Overview.
      </div>
      {!isReadOnly && (
        <button onClick={() => onNavigate && onNavigate("donors", { openImport: true })}
          data-testid="fin-open-deposit-sheet"
          style={{ ...btn(), marginTop:14 }}>
          Open the deposit sheet →
        </button>
      )}
    </Card>
  );
}

// FIN-1 — the year-end statement run, in Exports with the rest of what a
// bookkeeper needs, rather than three screens away in Settings.
function YearEndCard({ onNavigate }) {
  return (
    <Card>
      <SectionLabel>Year-end giving statements</SectionLabel>
      <div style={{ fontSize:13, color:T.ink2, lineHeight:1.6, maxWidth:640 }}>
        One statement per donor for the tax year, with every gift on it and the deductible amount
        worked out where a gift carried something in return. Steward drafts the run; a person sends it.
      </div>
      <div style={{ fontSize:12.5, color:T.ink3, lineHeight:1.55, marginTop:8, maxWidth:640 }}>
        The run is in Settings, under Receipts, because it sends mail and mail settings live together.
        It is named here because this is where somebody closing the year looks for it.
      </div>
      <button onClick={() => onNavigate && onNavigate("settings", { section: "receipts" })}
        data-testid="fin-open-yearend"
        style={{ ...btn(), marginTop:14 }}>
        Open the year-end run →
      </button>
    </Card>
  );
}

// The defining sentence for every figure, shown under the figures it
// defines. Named with a 4 because Finance already had a `Definitions`-shaped
// block inline and two components of one name in one file is how a later
// edit picks the wrong one.
function Definitions4({ items }) {
  const rows = (items || []).filter(([, s]) => s);
  if (!rows.length) return null;
  return (
    <div data-testid="fin-definitions" style={{ fontSize:12, color:T.ink3, lineHeight:1.6, display:"flex", flexDirection:"column", gap:3 }}>
      {rows.map(([k, s]) => <div key={k}><strong style={{ color:T.ink2, fontWeight:700 }}>{k}.</strong> {s}</div>)}
    </div>
  );
}
