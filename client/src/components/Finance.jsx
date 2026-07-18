import { useState, useEffect, Fragment } from "react";
import { T, fmt, fmtFull, askClaude, Card, AIBtn, AIPanel, EmptyState, SectionLabel, PageTitle, SectionTabs, interactive } from "./shared";
import { apiFetch } from "../api";

// ── Constants ──────────────────────────────────────────────────────────────
// Account-type accents, five-color palette only (dark-green shades + gold +
// terracotta) — deliberately varied per the five-color rule so adjacent
// categories stay visually distinct without reaching outside the set.
const ACCT_TYPES = [
  { id:"asset",     label:"Asset",     color:T.greenMid },
  { id:"liability", label:"Liability", color:T.gold },
  { id:"net_asset", label:"Net Asset", color:T.greenDk },
  { id:"revenue",   label:"Revenue",   color:T.green },
  { id:"expense",   label:"Expense",   color:T.terracotta },
];
const TYPE_COLOR = Object.fromEntries(ACCT_TYPES.map(t => [t.id, t.color]));

// (BUILD-12) The Overview narrative headline was removed as page-subtitle
// clutter — it duplicated the stat cards. Its one non-duplicated number, the
// vs-prior-period revenue delta, now lives on the Revenue stat card caption
// (`revDeltaCaption`, computed in the Finance component). The pure-function
// guard cases still live in tests/finance-overview.test.js as a unit.

// Money in = income (gold, positive/primary); money out = expense (terracotta,
// needs-attention). One convention used everywhere in this tab.
const IN = T.greenMid;
const OUT = T.terracotta;

// Where a ledger row came from — badged in the unified Transactions ledger.
const SOURCE_META = {
  online: { label:"Online · Stripe", color:T.greenDk, bg:T.gold+"26" },
  gift:   { label:"Gift",            color:T.greenMid, bg:T.greenMid+"18" },
  import:  { label:"Import",         color:T.ink3,    bg:T.bg2 },
  manual: { label:"Manual",          color:T.ink3,    bg:T.bg2 },
};
const sourceMeta = s => SOURCE_META[s] || SOURCE_META.manual;

// ── Shared style helpers ───────────────────────────────────────────────────
const inp = { background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, padding:"8px 11px", color:T.ink, fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" };
const btn = (bg=T.greenDk,fg="#fff") => ({ background:bg, border:"none", borderRadius:8, padding:"9px 16px", color:fg, fontSize:13, fontWeight:700, cursor:"pointer" });
const ghostBtn = { background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, padding:"8px 14px", color:T.ink3, fontSize:12, cursor:"pointer" };

// Read-only gate for write buttons — matches the app-wide isReadOnly pattern.
const RO_TIP = "Reactivate your subscription to make changes.";
const writeBtn = (isReadOnly, style) => ({
  ...style,
  ...(isReadOnly ? { opacity:0.5, cursor:"not-allowed" } : {}),
});

// ── AccountModal ───────────────────────────────────────────────────────────
function AccountModal({ account, onSave, onClose }) {
  const [form, setForm] = useState(
    account
      ? { code: account.code, name: account.name, type: account.type, subtype: account.subtype || "", active: account.active !== false }
      : { code:"", name:"", type:"revenue", subtype:"", active:true }
  );
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const overlay = { position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" };
  const box = { background:T.white, borderRadius:16, padding:28, width:420, display:"flex", flexDirection:"column", gap:14 };
  return (
    <div className="modal-sheet-overlay" style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet-inner" style={box}>
        <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>{account ? "Edit account" : "New account"}</div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ flex:"0 0 90px" }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Code</div>
            <input value={form.code} onChange={set("code")} placeholder="4010" style={inp} disabled={!!account}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Name</div>
            <input value={form.name} onChange={set("name")} placeholder="Account name" style={inp}/>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Type</div>
            <select value={form.type} onChange={set("type")} style={{ ...inp, cursor:"pointer" }} disabled={!!account}>
              {ACCT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Subtype (optional)</div>
            <input value={form.subtype} onChange={set("subtype")} placeholder="e.g. grants" style={inp}/>
          </div>
        </div>
        {account && (
          <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:T.ink, cursor:"pointer" }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))}/>
            Active
          </label>
        )}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={btn()} onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── FundModal ──────────────────────────────────────────────────────────────
function FundModal({ fund, onSave, onClose }) {
  const [form, setForm] = useState(
    fund
      ? { name: fund.name, description: fund.description || "", restricted: !!fund.restricted }
      : { name:"", description:"", restricted:false }
  );
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const overlay = { position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" };
  const box = { background:T.white, borderRadius:16, padding:28, width:400, display:"flex", flexDirection:"column", gap:14 };
  return (
    <div className="modal-sheet-overlay" style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet-inner" style={box}>
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
    </div>
  );
}

// ── TransactionModal ───────────────────────────────────────────────────────
function TransactionModal({ accounts, funds, onSave, onClose }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ date:today, description:"", vendorDonor:"", amount:"", type:"income", accountId:"", fundId:"", notes:"" });
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const filtered = accounts.filter(a => a.active !== false && a.type === (form.type === "income" ? "revenue" : "expense"));
  const overlay = { position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" };
  const box = { background:T.white, borderRadius:16, padding:28, width:460, display:"flex", flexDirection:"column", gap:14 };
  return (
    <div className="modal-sheet-overlay" style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet-inner" style={box}>
        <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>Log transaction</div>
        <div style={{ display:"flex", gap:6 }}>
          {["income","expense"].map(t => (
            <button key={t} onClick={() => setForm(p => ({ ...p, type:t, accountId:"" }))}
              style={{ flex:1, ...btn(form.type===t ? (t==="income"?IN:OUT) : T.bg, form.type===t?"#fff":T.ink3), border:"1px solid "+(form.type===t?"transparent":T.bg3) }}>
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
        <div>
          <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Vendor / Donor</div>
          <input value={form.vendorDonor} onChange={set("vendorDonor")} placeholder="Name of payer or payee" style={inp}/>
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
          <button style={btn(form.type === "income" ? IN : OUT)}
            onClick={() => { if (!form.description || !form.amount) return; onSave(form); }}>
            Save transaction
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Money in — Stripe status/balance/payouts strip (Overview) ───────────────
function MoneyInStrip({ onNavigate }) {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    apiFetch("/finance/stripe-summary")
      .then(r => { if (alive) { setS(r); setLoading(false); } })
      .catch(() => { if (alive) { setS({ connected:false }); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  if (loading) return (
    <Card><div style={{ fontSize:12, color:T.ink3 }}>Checking your Stripe balance…</div></Card>
  );

  // Not connected — warm connect prompt that deep-links to the existing
  // Settings → Giving Pages flow (never duplicate the onboarding here).
  if (!s?.connected) return (
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

  const avail = s.balance?.available || 0;
  const pending = s.balance?.pending || 0;
  const payouts = s.payouts || [];
  const last = payouts[0];
  const PAYOUT_STATUS = { paid:IN, in_transit:T.gold, pending:T.gold, canceled:OUT, failed:OUT };
  return (
    <Card>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <SectionLabel>Money in · Stripe</SectionLabel>
        <span style={{ fontSize:11, color:IN, fontWeight:700, display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background:IN, display:"inline-block" }}/> Connected
        </span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:payouts.length?16:0 }}>
        <div>
          <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>Available</div>
          <div style={{ fontSize:24, fontWeight:800, color:IN, fontFamily:"'DM Serif Display',serif" }}>{fmtFull(avail)}</div>
        </div>
        <div>
          <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>Pending</div>
          <div style={{ fontSize:24, fontWeight:800, color:T.gold, fontFamily:"'DM Serif Display',serif" }}>{fmtFull(pending)}</div>
        </div>
        {last && (
          <div>
            <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>Last payout</div>
            <div style={{ fontSize:16, fontWeight:700, color:T.ink }}>{fmtFull(last.amount)}</div>
            <div style={{ fontSize:11, color:T.ink3, marginTop:2 }}>{last.arrival_date ? new Date(last.arrival_date).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—"} · {last.status}</div>
          </div>
        )}
      </div>
      {payouts.length > 0 && (
        <>
          <div style={{ fontSize:11, fontWeight:700, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", margin:"4px 0 8px" }}>Recent payouts</div>
          <div style={{ display:"flex", flexDirection:"column" }}>
            {payouts.map((p, i) => (
              <div key={p.id || i} style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 0", borderTop: i>0 ? "1px solid "+T.bg3 : "" }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:PAYOUT_STATUS[p.status]||T.ink3, flexShrink:0 }}/>
                <span style={{ fontSize:13, fontWeight:700, color:T.ink, minWidth:90 }}>{fmtFull(p.amount)}</span>
                <span style={{ flex:1, fontSize:12, color:T.ink3 }}>{p.arrival_date ? new Date(p.arrival_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—"}</span>
                <span style={{ fontSize:11, fontWeight:600, color:PAYOUT_STATUS[p.status]||T.ink3, textTransform:"capitalize" }}>{(p.status||"").replace(/_/g," ")}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize:11, color:T.ink3, marginTop:10, lineHeight:1.6 }}>Payouts are what Stripe deposited to your bank. Gift-level reconciliation is coming — for now, match against the online gifts in your ledger.</div>
        </>
      )}
    </Card>
  );
}

// ── Finance ────────────────────────────────────────────────────────────────
export function Finance({ data, isReadOnly, onNavigate }) {
  const [subtab, setSubtab] = useState("overview");
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
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
  const [showAcctModal, setShowAcctModal] = useState(false);
  const [editAcct, setEditAcct] = useState(null);
  const [showFundModal, setShowFundModal] = useState(false);
  const [editFund, setEditFund] = useState(null);
  const [forecastAI, setForecastAI] = useState(""); const [forecastLoading, setForecastLoading] = useState(false);
  const [riskAI, setRiskAI] = useState(""); const [riskLoading, setRiskLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drillAcct, setDrillAcct] = useState(null);
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

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (subtab === "audit") reloadAuditLog(); }, [subtab]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const incomeByAcct = {};
  allTxns.filter(t => t.type === "income").forEach(t => {
    const k = t.account_name || "Uncategorized";
    incomeByAcct[k] = (incomeByAcct[k] || 0) + parseFloat(t.amount);
  });
  const expenseByAcct = {};
  allTxns.filter(t => t.type === "expense").forEach(t => {
    const k = t.account_name || "Uncategorized";
    expenseByAcct[k] = (expenseByAcct[k] || 0) + parseFloat(t.amount);
  });

  // Fund balances are cumulative (all-time) — a fund balance means nothing
  // per-calendar-year. The server computes them in /finance/summary so they
  // reconcile with the all-time Cash on Hand; fall back to a year-filtered
  // client computation only until the summary arrives.
  const _fbMap = {};
  funds.forEach(f => { _fbMap[f.id] = { name: f.name, restricted: f.restricted, income: 0, expense: 0 }; });
  allTxns.forEach(t => {
    if (!t.fund_id || !_fbMap[t.fund_id]) return;
    if (t.type === "income") _fbMap[t.fund_id].income += parseFloat(t.amount);
    else _fbMap[t.fund_id].expense += parseFloat(t.amount);
  });
  const finFundBalances = summary?.fundBalances
    || Object.values(_fbMap).map(f => ({ ...f, balance: f.income - f.expense }));

  const totalRev = Object.values(incomeByAcct).reduce((s, v) => s + v, 0);
  const totalExp = Object.values(expenseByAcct).reduce((s, v) => s + v, 0);
  const monthsElapsed = new Date().getMonth() + 1;

  // ── AI (reuse live finance data) ──
  const ytdRev = summary?.ytdRevenue || 0;
  const ytdExp = summary?.ytdExpenses || 0;
  const getForecast = async () => {
    setForecastLoading(true); setForecastAI("");
    await askClaude("You are a nonprofit CFO. Specific, data-driven. Max 200 words.",
      `Generate a 6-month revenue forecast.\nYTD Revenue: ${fmtFull(ytdRev)} | YTD Expenses: ${fmtFull(ytdExp)} | Net: ${fmtFull(ytdRev - ytdExp)}\nActive grants: ${data.grants.filter(g => g.status === "active").map(g => `${g.funder} ${fmtFull(g.amount)} ends ${g.deadline}`).join(", ")}\nFund balances: ${finFundBalances.map(f => `${f.name}: ${fmtFull(f.balance)}`).join(", ")}\n\nQ3-Q4 projection, 3 financial risks, 2 opportunities.`,
      chunk => setForecastAI(chunk));
    setForecastLoading(false);
  };
  const getRisks = async () => {
    setRiskLoading(true); setRiskAI("");
    await askClaude("You are a nonprofit financial auditor. Direct, specific. Max 150 words.",
      `Identify financial risks.\nYTD Net: ${fmtFull(ytdRev - ytdExp)}\nRestricted funds: ${finFundBalances.filter(f => f.restricted).map(f => `${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nGrant concentration: ${data.grants.filter(g => g.status === "active").map(g => `${g.funder}: ${fmtFull(g.amount)}`).join(", ")}\nLapsed donors: ${data.donors.filter(d => d.status === "lapsed").length}\n\nTop 3 risks with severity and mitigation.`,
      chunk => setRiskAI(chunk));
    setRiskLoading(false);
  };

  // ── Donor lookup for transactions ──
  const donorById = Object.fromEntries((data.donors || []).map(d => [d.id, d]));

  // ── Sub-tabs (SectionTabs) ──
  const SUBTABS = [
    { id:"overview",     label:"Overview" },
    { id:"transactions", label:"Transactions" },
    { id:"funds",        label:"Funds" },
    { id:"budgets",      label:"Budgets" },
    { id:"accounts",     label:"Accounts" },
    { id:"audit",        label:"Audit Log" },
  ];

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

  const handleDeleteTxn = async (id) => {
    if (!window.confirm("Delete this transaction?")) return;
    try {
      await apiFetch(`/finance/transactions/${id}`, { method:"DELETE" });
      setTransactions(prev => prev.filter(t => t.id !== id));
      await Promise.all([reloadSummary(), reloadBudgets(budgetYear)]);
    } catch(e) { console.error(e); }
  };

  const handleSaveAcct = async (form) => {
    try {
      if (editAcct) {
        const updated = await apiFetch(`/finance/accounts/${editAcct.id}`, { method:"PUT", body: JSON.stringify(form) });
        setAccounts(prev => prev.map(a => a.id === editAcct.id ? updated : a));
      } else {
        const created = await apiFetch("/finance/accounts", { method:"POST", body: JSON.stringify(form) });
        setAccounts(prev => [...prev, created].sort((a,b) => a.code.localeCompare(b.code)));
        if (created.type === "revenue" || created.type === "expense") {
          setBudgets(prev => [...prev, { accountId:created.id, accountCode:created.code, accountName:created.name, accountType:created.type, subtype:created.subtype||"", budget:0, actual:0, variance:0 }]);
        }
      }
      setShowAcctModal(false); setEditAcct(null);
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

  const handleBudgetChange = async (accountId, amount) => {
    try {
      await apiFetch("/finance/budgets", { method:"POST", body: JSON.stringify({ accountId, year: budgetYear, amount }) });
      setBudgets(prev => prev.map(b => b.accountId === accountId ? { ...b, budget: parseFloat(amount) || 0, variance: (parseFloat(amount)||0) - b.actual } : b));
    } catch(e) { console.error(e); }
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
      return allTxns
        .filter(t => t.fund_id === fundId && t.date >= s && t.date <= e)
        .reduce((sum, t) => sum + (t.type === "income" ? 1 : -1) * parseFloat(t.amount), 0);
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
      <PageTitle main="Your" accent="finances."/>
      <div style={{ color:T.ink3, fontSize:13 }}>Loading financial data…</div>
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
        <PageTitle main="Your" accent="finances."/>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, marginTop:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color:T.ink3 }}>Year basis:</span>
            <div style={{ display:"flex", background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, overflow:"hidden" }}>
              {[["fiscal","Fiscal Year"],["calendar","Calendar Year"]].map(([v,l]) => (
                <button key={v} onClick={() => handleYearModeChange(v)}
                  style={{ background:yearMode===v?T.greenMid:"transparent", border:"none", padding:"6px 14px", color:yearMode===v?"#fff":T.ink3, fontSize:12, fontWeight:yearMode===v?700:400, cursor:"pointer", whiteSpace:"nowrap" }}>
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
      {showTxnModal && <TransactionModal accounts={accounts} funds={funds} onSave={handleAddTxn} onClose={() => setShowTxnModal(false)}/>}
      {(showAcctModal || editAcct) && <AccountModal account={editAcct} onSave={handleSaveAcct} onClose={() => { setShowAcctModal(false); setEditAcct(null); }}/>}
      {(showFundModal || editFund) && <FundModal fund={editFund} onSave={handleSaveFund} onClose={() => { setShowFundModal(false); setEditFund(null); }}/>}

      {summary && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10 }}>
            {[
              // Cash on Hand is ALL-TIME (Σ income − Σ expense over the whole ledger);
              // the other three are the selected period. The captions make the scope
              // explicit so a treasurer never reads cash and period revenue as the
              // same kind of number.
              ["Cash on Hand", fmt(summary.cashOnHand), summary.cashOnHand >= 0 ? IN : OUT, "All-time · income − expenses", () => gotoTxns({ type: "" })],
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

      <SectionTabs tabs={SUBTABS} active={subtab} onSelect={setSubtab} className="finance-tabbar"/>

      {/* ── Overview ── */}
      {subtab === "overview" && <>
        <MoneyInStrip onNavigate={onNavigate}/>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <AIBtn onClick={getForecast} loading={forecastLoading} label="✦ 6-Month Forecast"/>
          <AIBtn onClick={getRisks} loading={riskLoading} label="✦ Risk Analysis"/>
        </div>
        {(forecastLoading || forecastAI) && <AIPanel text={forecastAI} onClose={() => setForecastAI("")}/>}
        {(riskLoading || riskAI) && <AIPanel text={riskAI} onClose={() => setRiskAI("")}/>}
        <Card>
          {/* Follows the selected year basis (server-supplied, Jul-first under
              fiscal) and collapses empty months into a single line instead of a
              wall of $0 bars. */}
          <SectionLabel>Monthly Breakdown · {summary?.monthlyLabel || ""}</SectionLabel>
          {(() => {
            const months = summary?.monthly || [];
            const active = months.filter(m => m.income !== 0 || m.expense !== 0);
            if (active.length === 0)
              return <EmptyState icon="◇" title="No money has moved yet" message="Log your first transaction — or connect Stripe above — and your month-by-month income and spending will chart here."/>;
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
              <button onClick={() => onNavigate("reports")} style={{ background:"none", border:"none", color:T.greenMid, fontSize:12, fontWeight:700, cursor:"pointer", padding:0 }}>Gifts by fund →</button>
            )}
          </div>
          {finFundBalances.length === 0
            ? <EmptyState icon="◇" title="No funds yet" message="Funds are how you track which dollars are restricted. Add one under the Funds tab and every gift you log can be tagged to it."/>
            : finFundBalances.map((f, i) => (
              <div key={f.name} {...interactive(() => f.id ? gotoTxns({ fund: f.id }) : setSubtab("funds"), { label: `View ${f.name} fund` })}
                style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 12px", margin:"0 -12px", borderRadius:8, borderBottom: i < finFundBalances.length - 1 ? "1px solid "+T.bg3 : "" }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:f.restricted?T.gold:T.greenMid, flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:T.ink }}>{f.name}</div>
                  <div style={{ fontSize:10, color:f.restricted?T.gold:T.greenMid, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", marginTop:1 }}>{f.restricted ? "Restricted" : "Unrestricted"}</div>
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
            ? <EmptyState icon="◇" title="No transactions here" message="This is your unified ledger — every online gift, manual entry, and imported record lands here. Log one, or connect Stripe, to begin."/>
            : (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:T.greenMid }}>
                      {[["date","Date"],["amount","Amount"],["description","Description"],["account_name","Account"],["fund_name","Fund"]].map(([col, label]) => (
                        <th key={col} onClick={() => toggleSort(col)} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em", cursor:"pointer", whiteSpace:"nowrap" }}>
                          {label}{sortArrow(col)}
                        </th>
                      ))}
                      <th style={{ padding:"10px 14px", width:40 }}/>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTxns.map((t, i) => {
                      const sm = sourceMeta(t.source);
                      const linkedDonor = t.donor_id && donorById[t.donor_id];
                      return (
                      <tr key={t.id} style={{ borderTop:"1px solid "+T.bg3, background: i%2===0?T.white:"#faf9f6" }}>
                        <td style={{ padding:"10px 14px", color:T.ink3, whiteSpace:"nowrap" }}>{t.date}</td>
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
                            <span style={{ background:t.fund_restricted?T.gold+"22":T.greenMid+"18", color:t.fund_restricted?"#8a6d1f":T.greenMid, borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
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
        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <button style={writeBtn(isReadOnly, btn(IN))} onClick={addBtnHandler(() => setShowFundModal(true))} title={isReadOnly ? RO_TIP : ""}>+ Add fund</button>
        </div>
        <Card>
          <SectionLabel>Fund Accounting</SectionLabel>
          <div style={{ fontSize:12, color:T.ink3, marginBottom:14, lineHeight:1.6 }}>
            Every transaction is tagged to a fund. Restricted funds hold donor- or grant-restricted dollars and must be spent only for the designated purpose.
          </div>
          {funds.length === 0
            ? <EmptyState icon="◇" title="No funds yet" message="Create your first fund — most orgs start with one General Operating fund and add restricted funds as grants and designated gifts come in."/>
            : funds.map((f, i) => {
            const fb = fundBalances[f.id] || { income:0, expense:0 };
            const balance = fb.income - fb.expense;
            const sparkVals = getFundSparkline(f.id);
            return (
              <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderTop: i > 0 ? "1px solid "+T.bg3 : "" }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:f.restricted?T.gold:T.greenMid, flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{f.name}</span>
                    <span style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", color:f.restricted?T.gold:T.greenMid }}>{f.restricted ? "Restricted" : "Unrestricted"}</span>
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
          {!isReadOnly && <span style={{ fontSize:12, color:T.ink3, marginLeft:4 }}>Click any budget cell to edit inline.</span>}
        </div>
        {budgets.length === 0 && (
          <Card><EmptyState icon="◇" title="No revenue or expense accounts yet" message="Budgets are built from your chart of accounts. Add a few revenue and expense accounts under the Accounts tab and they'll appear here to budget against."/></Card>
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
                  <tr style={{ background:T.greenMid }}>
                    <th style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Account</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Budget</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Actual YTD</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Variance</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Proj. Year-End</th>
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
                      <tr key={b.accountId} style={{ borderTop:"1px solid "+T.bg3 }}>
                        <td style={{ padding:"10px 12px" }}>
                          <span style={{ fontSize:11, color:T.ink3, marginRight:8 }}>{b.accountCode}</span>
                          <span style={{ fontWeight:600, color:T.ink }}>{b.accountName}</span>
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right" }}>
                          {isReadOnly
                            ? <span style={{ fontWeight:600, color:T.ink }}>{fmtFull(b.budget)}</span>
                            : <BudgetInput value={b.budget} onSave={val => handleBudgetChange(b.accountId, val)}/>}
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

      {/* ── Accounts ── */}
      {subtab === "accounts" && <>
        {drillAcct ? (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button style={ghostBtn} onClick={() => setDrillAcct(null)}>← Back</button>
              <span style={{ fontSize:14, fontWeight:700, color:T.ink }}>{drillAcct.code} {drillAcct.name}</span>
            </div>
            <Card style={{ padding:0, overflow:"hidden" }}>
              {transactions.filter(t => t.account_id === drillAcct.id).length === 0
                ? <EmptyState icon="◇" title="Nothing posted here yet" message="No transactions have been posted to this account. As you log gifts and expenses against it, they'll appear here."/>
                : (
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                      <thead>
                        <tr style={{ background:T.greenMid }}>
                          {["Date","Amount","Description","Fund"].map(h => (
                            <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.filter(t => t.account_id === drillAcct.id)
                          .sort((a,b) => b.date.localeCompare(a.date))
                          .map((t, i) => (
                          <tr key={t.id} style={{ borderTop:"1px solid "+T.bg3, background:i%2===0?T.white:"#faf9f6" }}>
                            <td style={{ padding:"10px 14px", color:T.ink3, whiteSpace:"nowrap" }}>{t.date}</td>
                            <td style={{ padding:"10px 14px", fontWeight:700, color:t.type==="income"?IN:OUT, textAlign:"right" }}>
                              {t.type==="income"?"+":"−"}{fmtFull(parseFloat(t.amount))}
                            </td>
                            <td style={{ padding:"10px 14px" }}>
                              <div style={{ fontWeight:600, color:T.ink }}>{t.description}</div>
                              {t.vendor_donor && <div style={{ fontSize:11, color:T.ink3 }}>{t.vendor_donor}</div>}
                            </td>
                            <td style={{ padding:"10px 14px" }}>
                              {t.fund_name && <span style={{ fontSize:11, fontWeight:600, color:t.fund_restricted?"#8a6d1f":T.greenMid }}>{t.fund_name}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop:"2px solid "+T.bg3, background:T.bg2 }}>
                          <td style={{ padding:"10px 14px", fontWeight:700, fontSize:12 }}>Balance</td>
                          <td style={{ padding:"10px 14px", textAlign:"right", fontWeight:800, color:
                            (transactions.filter(t=>t.account_id===drillAcct.id&&t.type==="income").reduce((s,t)=>s+parseFloat(t.amount),0) -
                            transactions.filter(t=>t.account_id===drillAcct.id&&t.type==="expense").reduce((s,t)=>s+parseFloat(t.amount),0)) >= 0 ? IN : OUT
                          }}>
                            {fmtFull(
                              transactions.filter(t=>t.account_id===drillAcct.id&&t.type==="income").reduce((s,t)=>s+parseFloat(t.amount),0) -
                              transactions.filter(t=>t.account_id===drillAcct.id&&t.type==="expense").reduce((s,t)=>s+parseFloat(t.amount),0)
                            )}
                          </td>
                          <td colSpan={2}/>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              }
            </Card>
          </>
        ) : (
          <>
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button style={writeBtn(isReadOnly, btn(IN))} onClick={addBtnHandler(() => setShowAcctModal(true))} title={isReadOnly ? RO_TIP : ""}>+ Add account</button>
            </div>
            {accounts.length === 0 && (
              <Card><EmptyState icon="◇" title="No chart of accounts yet" message="Your chart of accounts is the backbone of every report. Add revenue and expense accounts here — a new org usually seeds these during onboarding."/></Card>
            )}
            {ACCT_TYPES.map(type => {
              const group = accounts.filter(a => a.type === type.id);
              if (!group.length) return null;
              return (
                <Card key={type.id}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:type.color }}/>
                    <SectionLabel>{type.label === "Liability" ? "Liabilities" : type.label + "s"}</SectionLabel>
                  </div>
                  {group.map((a, i) => {
                    const acctBal = transactions.filter(t=>t.account_id===a.id&&t.type==="income").reduce((s,t)=>s+parseFloat(t.amount),0)
                      - transactions.filter(t=>t.account_id===a.id&&t.type==="expense").reduce((s,t)=>s+parseFloat(t.amount),0);
                    return (
                      <div key={a.id} onClick={() => setDrillAcct(a)} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderTop: i > 0 ? "1px solid "+T.bg3 : "", cursor:"pointer" }}>
                        <span style={{ fontSize:12, fontWeight:700, color:T.ink3, minWidth:40 }}>{a.code}</span>
                        <span style={{ flex:1, fontSize:13, fontWeight:600, color:a.active===false?T.ink3:T.ink, textDecoration:a.active===false?"line-through":"none" }}>{a.name}</span>
                        {a.active === false && <span style={{ fontSize:11, color:OUT, background:OUT+"1a", borderRadius:5, padding:"2px 7px" }}>Inactive</span>}
                        <span style={{ fontSize:13, fontWeight:700, color:acctBal>=0?IN:OUT, minWidth:80, textAlign:"right" }}>{fmtFull(acctBal)}</span>
                        <button style={ghostBtn} onClick={e => { e.stopPropagation(); setEditAcct(a); }}>Edit</button>
                      </div>
                    );
                  })}
                </Card>
              );
            })}
          </>
        )}
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
          <button style={{ ...ghostBtn, marginLeft:"auto" }} onClick={exportAuditCSV}>⬇ Export CSV</button>
        </div>
        <Card style={{ padding:0, overflow:"hidden" }}>
          {auditLoading
            ? <div style={{ padding:24, color:T.ink3, fontSize:13 }}>Loading audit log…</div>
            : filteredAudit.length === 0
              ? <EmptyState icon="◇" title="No changes recorded yet" message="Every edit to a transaction, account, fund, or budget is logged here with who, what, and when — your paper trail for the board and auditors."/>
              : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead>
                      <tr style={{ background:"#0f1a12" }}>
                        {["Timestamp","User","Action","Entity","Description"].map(h => (
                          <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"#8fa896", textTransform:"uppercase", letterSpacing:".06em", whiteSpace:"nowrap" }}>{h}</th>
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
                          created: { bg:T.greenMid+"18", color:T.greenDk },
                          updated: { bg:T.gold+"26", color:"#8a6d1f" },
                          deleted: { bg:OUT+"20", color:OUT },
                        };
                        const as = ACTION_STYLE[entry.action] || { bg:T.bg2, color:T.ink3 };
                        return (
                          <Fragment key={entry.id}>
                            <tr style={{ borderTop:"1px solid "+T.bg3, background:i%2===0?"transparent":"#0f1a1244" }}>
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
                                        <div style={{ fontSize:10, fontWeight:700, color:T.greenDk, marginBottom:6, textTransform:"uppercase", letterSpacing:".06em" }}>After</div>
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
  const color = trending ? T.greenMid : T.terracotta;
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
