import { useState, useEffect, Fragment } from "react";
import { T, fmt, fmtFull, SC, askClaude, Card, AIBtn, AIPanel, EmptyState, SectionLabel, PageTitle } from "./shared";
import { apiFetch } from "../api";

// ── Constants ──────────────────────────────────────────────────────────────
const ACCT_TYPES = [
  { id:"asset",     label:"Asset",       color:"#3b82f6" },
  { id:"liability", label:"Liability",   color:"#f59e0b" },
  { id:"net_asset", label:"Net Asset",   color:"#8b5cf6" },
  { id:"revenue",   label:"Revenue",     color:T.greenDk },
  { id:"expense",   label:"Expense",     color:"#ef4444" },
];
const TYPE_COLOR = Object.fromEntries(ACCT_TYPES.map(t => [t.id, t.color]));

const REPORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Shared style helpers ───────────────────────────────────────────────────
const inp = { background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, padding:"8px 11px", color:T.ink, fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" };
const btn = (bg="#10b981",fg="#fff") => ({ background:bg, border:"none", borderRadius:8, padding:"9px 16px", color:fg, fontSize:13, fontWeight:600, cursor:"pointer" });
const ghostBtn = { background:T.bg, border:"1px solid "+T.bg3, borderRadius:8, padding:"8px 14px", color:T.ink3, fontSize:12, cursor:"pointer" };

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
        <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>{account ? "Edit Account" : "New Account"}</div>
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
        <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>{fund ? "Edit Fund" : "New Fund"}</div>
        <div>
          <div style={{ fontSize:11, color:T.ink3, marginBottom:4 }}>Fund Name</div>
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
        <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>Log Transaction</div>
        <div style={{ display:"flex", gap:6 }}>
          {["income","expense"].map(t => (
            <button key={t} onClick={() => setForm(p => ({ ...p, type:t, accountId:"" }))}
              style={{ flex:1, ...btn(form.type===t ? (t==="income"?"#10b981":"#ef4444") : T.bg, form.type===t?"#fff":T.ink3), border:"1px solid "+(form.type===t?"transparent":T.bg3) }}>
              {t === "income" ? "↑ Income" : "↓ Expense"}
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
          <button style={btn(form.type === "income" ? "#10b981" : "#ef4444")}
            onClick={() => { if (!form.description || !form.amount) return; onSave(form); }}>
            Save Transaction
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Finance ────────────────────────────────────────────────────────────────
export function Finance({ data }) {
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
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [showAcctModal, setShowAcctModal] = useState(false);
  const [editAcct, setEditAcct] = useState(null);
  const [showFundModal, setShowFundModal] = useState(false);
  const [editFund, setEditFund] = useState(null);
  const [report, setReport] = useState("income");
  const [forecastAI, setForecastAI] = useState(""); const [forecastLoading, setForecastLoading] = useState(false);
  const [riskAI, setRiskAI] = useState(""); const [riskLoading, setRiskLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drillAcct, setDrillAcct] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditEntityFilter, setAuditEntityFilter] = useState("");
  const [expandedAuditRows, setExpandedAuditRows] = useState(new Set());

  const loadAll = (yr = txnYear, byr = budgetYear) => {
    Promise.all([
      apiFetch("/finance/accounts"),
      apiFetch("/finance/funds"),
      apiFetch(`/finance/transactions?year=${yr}`),
      apiFetch(`/finance/budgets?year=${byr}`),
      apiFetch("/finance/summary"),
    ]).then(([a, f, t, b, s]) => {
      setAccounts(a); setFunds(f); setTransactions(t); setBudgets(b); setSummary(s);
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  };

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (subtab === "audit") reloadAuditLog(); }, [subtab]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadTxns = (yr) => apiFetch(`/finance/transactions?year=${yr}`).then(setTransactions);
  const reloadBudgets = (yr) => apiFetch(`/finance/budgets?year=${yr}`).then(setBudgets);
  const reloadSummary = () => apiFetch("/finance/summary").then(setSummary);
  const reloadAuditLog = async () => {
    setAuditLoading(true);
    try { const rows = await apiFetch("/finance/audit-log?limit=200"); setAuditLog(rows); }
    catch(e) { console.error(e); }
    setAuditLoading(false);
  };

  // ── AI (reuse existing data context) ────────────────────────────────────
  const rev = data.financials.revenue;
  const exp = data.financials.expenses;
  const ytdRev = rev.reduce((s, r) => s + r.individual + r.grants + r.events + r.other, 0);
  const ytdExp = exp.reduce((s, e) => s + e.programs + e.admin + e.fundraising, 0);
  const programRatio = ytdExp > 0 ? Math.round(exp.reduce((s, e) => s + e.programs, 0) / ytdExp * 100) : 0;

  const getForecast = async () => {
    setForecastLoading(true); setForecastAI("");
    await askClaude("You are a nonprofit CFO. Specific, data-driven. Max 200 words.",
      `Generate a 6-month revenue forecast.\nYTD Revenue: ${fmtFull(ytdRev)} | YTD Expenses: ${fmtFull(ytdExp)} | Net: ${fmtFull(ytdRev - ytdExp)}\nActive grants: ${data.grants.filter(g => g.status === "active").map(g => `${g.funder} ${fmtFull(g.amount)} ends ${g.deadline}`).join(", ")}\nFund balances: ${data.financials.funds.map(f => `${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nProgram ratio: ${programRatio}%\n\nQ3-Q4 projection, 3 financial risks, 2 opportunities.`,
      chunk => setForecastAI(chunk));
    setForecastLoading(false);
  };
  const getRisks = async () => {
    setRiskLoading(true); setRiskAI("");
    await askClaude("You are a nonprofit financial auditor. Direct, specific. Max 150 words.",
      `Identify financial risks.\nYTD Net: ${fmtFull(ytdRev - ytdExp)}\nRestricted funds: ${data.financials.funds.filter(f => f.restricted).map(f => `${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nGrant concentration: ${data.grants.filter(g => g.status === "active").map(g => `${g.funder}: ${fmtFull(g.amount)}`).join(", ")}\nLapsed donors: ${data.donors.filter(d => d.status === "lapsed").length}\n\nTop 3 risks with severity and mitigation.`,
      chunk => setRiskAI(chunk));
    setRiskLoading(false);
  };

  // ── Revenue breakdown from transactions ─────────────────────────────────
  const donorRevenue = transactions.filter(t => t.type === "income" && t.donor_id).reduce((s, t) => s + parseFloat(t.amount), 0);
  const grantRevenue = transactions.filter(t => t.type === "income" && (t.category === "Grants" || t.description?.toLowerCase().startsWith("grant"))).reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalIncome = transactions.filter(t => t.type === "income").reduce((s, t) => s + parseFloat(t.amount), 0);
  const donorPct = totalIncome > 0 ? Math.round(donorRevenue / totalIncome * 100) : 0;
  const grantPct = totalIncome > 0 ? Math.round(grantRevenue / totalIncome * 100) : 0;

  // ── Donor lookup for transactions ────────────────────────────────────────
  const donorById = Object.fromEntries((data.donors || []).map(d => [d.id, d]));

  // ── Summary bar ──────────────────────────────────────────────────────────
  const SummaryCard = () => summary ? (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10, marginBottom:4 }}>
      {[
        ["Cash on Hand",    fmt(summary.cashOnHand),    summary.cashOnHand >= 0 ? "#1a6b4a" : "#ef4444"],
        ["YTD Revenue",     fmt(summary.ytdRevenue),    "#1a6b4a"],
        ["YTD Expenses",    fmt(summary.ytdExpenses),   "#ef4444"],
        ["Net Surplus",     fmt(summary.netSurplus),    summary.netSurplus >= 0 ? "#1a6b4a" : "#ef4444"],
      ].map(([label, value, color]) => (
        <div key={label} style={{ background:T.white, border:"1px solid "+T.bg3, borderRadius:12, padding:"14px 16px" }}>
          <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>{label}</div>
          <div style={{ fontSize:22, fontWeight:800, color, fontFamily:"'DM Serif Display',serif" }}>{value}</div>
        </div>
      ))}
      {totalIncome > 0 && <>
        <div style={{ background:T.white, border:"1px solid "+T.bg3, borderRadius:12, padding:"14px 16px" }}>
          <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>Donor Revenue</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#1a6b4a", fontFamily:"'DM Serif Display',serif" }}>{fmt(donorRevenue)}</div>
          <div style={{ fontSize:11, color:T.ink3, marginTop:3 }}>{donorPct}% of total income</div>
        </div>
        <div style={{ background:T.white, border:"1px solid "+T.bg3, borderRadius:12, padding:"14px 16px" }}>
          <div style={{ fontSize:11, color:T.ink3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>Grant Revenue</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#8b5cf6", fontFamily:"'DM Serif Display',serif" }}>{fmt(grantRevenue)}</div>
          <div style={{ fontSize:11, color:T.ink3, marginTop:3 }}>{grantPct}% of total income</div>
        </div>
      </>}
    </div>
  ) : null;

  // ── Sub-tab bar ──────────────────────────────────────────────────────────
  const subTabs = [["overview","Overview"],["donors","Donor Giving"],["transactions","Transactions"],["accounts","Accounts"],["funds","Funds"],["budgets","Budgets"],["reports","Reports"],["audit","Audit Log"]];

  // ── Transactions tab ─────────────────────────────────────────────────────
  const sortedTxns = [...transactions]
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
      // Update transactions immediately so all derived views (reports, fund balances) refresh without a round-trip
      const thisYear = new Date(created.date).getFullYear() === txnYear;
      if (thisYear) setTransactions(prev => [created, ...prev]);
      // Reload summary + budgets actuals (server-computed)
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

  // ── Accounts tab ─────────────────────────────────────────────────────────
  const handleSaveAcct = async (form) => {
    try {
      if (editAcct) {
        const updated = await apiFetch(`/finance/accounts/${editAcct.id}`, { method:"PUT", body: JSON.stringify(form) });
        setAccounts(prev => prev.map(a => a.id === editAcct.id ? updated : a));
      } else {
        const created = await apiFetch("/finance/accounts", { method:"POST", body: JSON.stringify(form) });
        setAccounts(prev => [...prev, created].sort((a,b) => a.code.localeCompare(b.code)));
        // New account shows up in budget table immediately
        if (created.type === "revenue" || created.type === "expense") {
          setBudgets(prev => [...prev, { accountId:created.id, accountCode:created.code, accountName:created.name, accountType:created.type, subtype:created.subtype||"", budget:0, actual:0, variance:0 }]);
        }
      }
      setShowAcctModal(false); setEditAcct(null);
    } catch(e) { console.error(e); }
  };

  // ── Funds tab ─────────────────────────────────────────────────────────────
  const handleSaveFund = async (form) => {
    try {
      if (editFund) {
        const updated = await apiFetch(`/finance/funds/${editFund.id}`, { method:"PUT", body: JSON.stringify(form) });
        // Update funds state — fundBalances is derived from funds+transactions so it re-renders immediately
        setFunds(prev => prev.map(f => f.id === editFund.id ? updated : f));
      } else {
        const created = await apiFetch("/finance/funds", { method:"POST", body: JSON.stringify(form) });
        setFunds(prev => [...prev, created]);
      }
      setShowFundModal(false); setEditFund(null);
    } catch(e) { console.error(e); }
  };

  // ── Budget tab ────────────────────────────────────────────────────────────
  const handleBudgetChange = async (accountId, amount) => {
    try {
      await apiFetch("/finance/budgets", { method:"POST", body: JSON.stringify({ accountId, year: budgetYear, amount }) });
      setBudgets(prev => prev.map(b => b.accountId === accountId ? { ...b, budget: parseFloat(amount) || 0, variance: (parseFloat(amount)||0) - b.actual } : b));
    } catch(e) { console.error(e); }
  };

  // ── Reports ───────────────────────────────────────────────────────────────
  const allTxns = transactions; // already loaded for current year
  const reportRevenue = allTxns.filter(t => t.type === "income");
  const reportExpense = allTxns.filter(t => t.type === "expense");

  // Income statement: group by account, totals by month
  const incomeByAcct = {};
  reportRevenue.forEach(t => {
    const k = t.account_name || "Uncategorized";
    incomeByAcct[k] = (incomeByAcct[k] || 0) + parseFloat(t.amount);
  });
  const expenseByAcct = {};
  reportExpense.forEach(t => {
    const k = t.account_name || "Uncategorized";
    expenseByAcct[k] = (expenseByAcct[k] || 0) + parseFloat(t.amount);
  });

  // Fund summary: balance per fund
  const fundBalances = {};
  funds.forEach(f => { fundBalances[f.id] = { name: f.name, restricted: f.restricted, income: 0, expense: 0 }; });
  allTxns.forEach(t => {
    if (!t.fund_id || !fundBalances[t.fund_id]) return;
    if (t.type === "income") fundBalances[t.fund_id].income += parseFloat(t.amount);
    else fundBalances[t.fund_id].expense += parseFloat(t.amount);
  });

  const totalRev = Object.values(incomeByAcct).reduce((s, v) => s + v, 0);
  const totalExp = Object.values(expenseByAcct).reduce((s, v) => s + v, 0);
  const monthsElapsed = new Date().getMonth() + 1;

  const export990CSV = () => {
    const p8Lines = [
      ["1a","Federated campaigns",""],
      ["1b","Membership dues",""],
      ["1c","Fundraising events (Gross)", expenseByAcct["Fundraising — Events"]||0],
      ["1d","Related organizations",""],
      ["1e","Government grants", incomeByAcct["Government Grants"]||0],
      ["1f","All other contributions", (incomeByAcct["Individual Contributions"]||0)+(incomeByAcct["Foundation Grants"]||0)],
      ["2","Program service revenue", incomeByAcct["Program Revenue"]||0],
      ["7","Other revenue", incomeByAcct["Other Revenue"]||0],
      ["12","Total Revenue", totalRev],
    ];
    const p9Lines = [
      ["Program services", ["Program Services — Salaries","Program Services — Supplies","Program Services — Contractors","Program Services — Occupancy"].reduce((s,k)=>s+(expenseByAcct[k]||0),0)],
      ["Management & general", ["Management & General — Salaries","Management & General — Admin","Management & General — Technology"].reduce((s,k)=>s+(expenseByAcct[k]||0),0)],
      ["Fundraising", ["Fundraising — Salaries","Fundraising — Events","Fundraising — Marketing"].reduce((s,k)=>s+(expenseByAcct[k]||0),0)],
      ["Total Expenses (Line 25)", totalExp],
    ];
    const esc = v => `"${String(v).replace(/"/g,'""')}"`;
    const rows = [
      [`Form 990 Prep Export — Year ${txnYear}`, `Generated ${new Date().toLocaleDateString()}`],
      [],
      ["PART VIII — REVENUE"],
      ["Line","Description","Amount"],
      ...p8Lines.map(([line,desc,amt]) => [line, desc, amt === "" ? "" : Number(amt).toFixed(2)]),
      [],
      ["PART IX — FUNCTIONAL EXPENSES"],
      ["Category","Amount"],
      ...p9Lines.map(([cat,amt]) => [cat, Number(amt).toFixed(2)]),
    ];
    const csv = rows.map(r => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `990-prep-${txnYear}.csv`; a.click();
    URL.revokeObjectURL(url);
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

  if (loading) return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <PageTitle main="Your" accent="finances."/>
      <div style={{ color:T.ink3, fontSize:13 }}>Loading financial data…</div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <PageTitle main="Your" accent="finances."/>

      {/* Modals */}
      {showTxnModal && <TransactionModal accounts={accounts} funds={funds} onSave={handleAddTxn} onClose={() => setShowTxnModal(false)}/>}
      {(showAcctModal || editAcct) && <AccountModal account={editAcct} onSave={handleSaveAcct} onClose={() => { setShowAcctModal(false); setEditAcct(null); }}/>}
      {(showFundModal || editFund) && <FundModal fund={editFund} onSave={handleSaveFund} onClose={() => { setShowFundModal(false); setEditFund(null); }}/>}

      <SummaryCard/>

      {/* Sub-tab nav */}
      <div className="finance-subtab-bar" style={{ display:"flex", background:"#0f1a12", border:"1px solid #1a2e1f", borderRadius:10, overflow:"hidden", flexWrap:"wrap" }}>
        {subTabs.map(([id, label]) => (
          <button key={id} onClick={() => setSubtab(id)} style={{ background:"transparent", border:"none", borderRight:"1px solid #1a2e1f", borderBottom:`2px solid ${subtab===id?"#c9a84c":"transparent"}`, padding:"10px 16px", color:subtab===id?"#f0ede6":"#8fa896", fontSize:13, fontWeight:subtab===id?700:400, cursor:"pointer", transition:"color 0.15s,border-color 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {subtab === "overview" && <>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <AIBtn onClick={getForecast} loading={forecastLoading} label="✦ 6-Month Forecast"/>
          <AIBtn onClick={getRisks} loading={riskLoading} label="✦ Risk Analysis"/>
        </div>
        {(forecastLoading || forecastAI) && <AIPanel text={forecastAI} onClose={() => setForecastAI("")}/>}
        {(riskLoading || riskAI) && <AIPanel text={riskAI} onClose={() => setRiskAI("")}/>}
        <Card>
          <SectionLabel>Monthly Breakdown (legacy data)</SectionLabel>
          {rev.length === 0 && <EmptyState icon="◇" title="No financial data" message="Log transactions to see trends."/>}
          {rev.map((r, i) => {
            const rv = r.individual + r.grants + r.events + r.other;
            const ex = exp[i] ? exp[i].programs + exp[i].admin + exp[i].fundraising : 0;
            const net = rv - ex;
            const maxBar = Math.max(...rev.map(r2 => r2.individual+r2.grants+r2.events+r2.other), 1);
            return (
              <div key={r.month} style={{ marginBottom:12, paddingBottom:12, borderBottom:"1px solid "+T.bg3 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{r.month}</span>
                  <div style={{ display:"flex", gap:12 }}>
                    <span style={{ fontSize:11, color:T.greenDk }}>↑ {fmtFull(rv)}</span>
                    <span style={{ fontSize:11, color:"#ef4444" }}>↓ {fmtFull(ex)}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:net>=0?"#1a6b4a":"#ef4444" }}>{net>=0?"+":""}{fmtFull(net)}</span>
                  </div>
                </div>
                <div style={{ height:5, background:T.bg2, borderRadius:99, overflow:"hidden", marginBottom:3 }}>
                  <div style={{ height:"100%", width:`${(rv/maxBar)*100}%`, background:"linear-gradient(90deg,#1a6b4a,#3b82f6)", borderRadius:99 }}/>
                </div>
                <div style={{ height:4, background:T.bg2, borderRadius:99, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${(ex/maxBar)*100}%`, background:"linear-gradient(90deg,#ef444488,#dc2626)", borderRadius:99, opacity:0.7 }}/>
                </div>
              </div>
            );
          })}
        </Card>
        <Card>
          <SectionLabel>Fund Balances</SectionLabel>
          {data.financials.funds.length === 0 && <EmptyState icon="◇" title="No funds" message="Add funds to track restricted and unrestricted balances."/>}
          {data.financials.funds.map((f, i) => (
            <div key={f.name} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderBottom: i < data.financials.funds.length - 1 ? "1px solid "+T.bg3 : "" }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:f.restricted?"#8b5cf6":"#1a6b4a", flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.ink }}>{f.name}</div>
                <div style={{ fontSize:10, color:f.restricted?"#8b5cf6":"#6b7280", fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", marginTop:1 }}>{f.restricted ? "Restricted" : "Unrestricted"}</div>
              </div>
              <div style={{ fontSize:18, fontWeight:800, color:T.ink, fontFamily:"'DM Serif Display',serif" }}>{fmt(f.balance)}</div>
            </div>
          ))}
        </Card>
      </>}

      {/* ── Donor Giving ── */}
      {subtab === "donors" && (() => {
        const currentYr = new Date().getFullYear();
        const topDonors = [...(data.donors||[])]
          .sort((a,b) => b.total - a.total)
          .slice(0, 10);
        return <>
          <Card style={{ padding:0, overflow:"hidden" }}>
            {topDonors.length === 0
              ? <EmptyState icon="♦" title="No donors yet" message="Import donors to see giving analysis."/>
              : <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#1a6b4a" }}>
                      {["Donor","Stage","Last Gift","Last Gift Date","Lifetime"].map(h => (
                        <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em", whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topDonors.map((d, i) => {
                      const gifts = transactions.filter(t => t.donor_id === d.id && t.type === "income").sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,4);
                      const max = Math.max(...gifts.map(g => parseFloat(g.amount)), 1);
                      return (
                        <tr key={d.id} style={{ borderTop:"1px solid "+T.bg3, background: i%2===0?T.white:"#faf9f6" }}>
                          <td style={{ padding:"10px 14px", fontWeight:700, color:T.ink }}>{d.name}</td>
                          <td style={{ padding:"10px 14px" }}>
                            <span style={{ background:(SC[d.stage]||"#6b7280")+"22", color:SC[d.stage]||"#6b7280", borderRadius:99, padding:"2px 8px", fontSize:11, fontWeight:700, textTransform:"capitalize" }}>{d.stage}</span>
                          </td>
                          <td style={{ padding:"10px 14px", color:T.greenDk, fontWeight:700 }}>{d.lastAmount > 0 ? fmtFull(d.lastAmount) : "—"}</td>
                          <td style={{ padding:"10px 14px", color:T.ink3 }}>{d.lastGift || "—"}</td>
                          <td style={{ padding:"10px 14px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                              <span style={{ fontWeight:800, color:"#1a6b4a" }}>{fmtFull(d.total)}</span>
                              {gifts.length > 1 && (
                                <div style={{ display:"flex", gap:2, alignItems:"flex-end", height:20 }}>
                                  {gifts.map((g,gi) => (
                                    <div key={gi} style={{ width:6, background:"#1a6b4a66", borderRadius:2, height:Math.max(4, Math.round(parseFloat(g.amount)/max*20)) }}/>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
            }
          </Card>
        </>;
      })()}

      {/* ── Transactions ── */}
      {subtab === "transactions" && <>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <input value={txnFilter} onChange={e => setTxnFilter(e.target.value)} placeholder="Search transactions…" style={{ ...inp, flex:1, minWidth:160 }}/>
          <select value={txnYear} onChange={e => { const yr = parseInt(e.target.value); setTxnYear(yr); reloadTxns(yr); }} style={{ ...inp, width:100, cursor:"pointer" }}>
            {[2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button style={btn()} onClick={() => setShowTxnModal(true)}>+ Add Transaction</button>
        </div>
        <Card style={{ padding:0, overflow:"hidden" }}>
          {sortedTxns.length === 0
            ? <EmptyState icon="◇" title="No transactions" message="Log income and expenses to build your ledger."/>
            : (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#1a6b4a" }}>
                      {[["date","Date"],["amount","Amount"],["description","Description"],["account_name","Account"],["fund_name","Fund"]].map(([col, label]) => (
                        <th key={col} onClick={() => toggleSort(col)} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em", cursor:"pointer", whiteSpace:"nowrap" }}>
                          {label}{sortArrow(col)}
                        </th>
                      ))}
                      <th style={{ padding:"10px 14px", width:40 }}/>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTxns.map((t, i) => (
                      <tr key={t.id} style={{ borderTop:"1px solid "+T.bg3, background: i%2===0?T.white:"#faf9f6" }}>
                        <td style={{ padding:"10px 14px", color:T.ink3, whiteSpace:"nowrap" }}>{t.date}</td>
                        <td style={{ padding:"10px 14px", fontWeight:700, color:t.type==="income"?T.greenDk:T.red, whiteSpace:"nowrap", textAlign:"right" }}>
                          {t.type === "income" ? "+" : "−"}{fmtFull(parseFloat(t.amount))}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          <div style={{ fontWeight:600, color:T.ink }}>{t.description}</div>
                          {t.vendor_donor && <div style={{ fontSize:11, color:T.ink3, display:"flex", alignItems:"center", gap:5 }}>
                            {t.vendor_donor}
                            {t.donor_id && donorById[t.donor_id] && (
                              <span style={{ background:(SC[donorById[t.donor_id].stage]||"#6b7280")+"22", color:SC[donorById[t.donor_id].stage]||"#6b7280", borderRadius:99, padding:"1px 6px", fontSize:9, fontWeight:700, textTransform:"capitalize" }}>
                                {donorById[t.donor_id].stage}
                              </span>
                            )}
                          </div>}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          {t.account_name && (
                            <span style={{ background:TYPE_COLOR[t.account_type]+"18", color:TYPE_COLOR[t.account_type], borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
                              {t.account_code} {t.account_name}
                            </span>
                          )}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          {t.fund_name && (
                            <span style={{ background:t.fund_restricted?"#8b5cf618":"#1a6b4a18", color:t.fund_restricted?"#8b5cf6":"#1a6b4a", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>
                              {t.fund_name}
                            </span>
                          )}
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          <button onClick={() => handleDeleteTxn(t.id)} style={{ background:"none", border:"none", cursor:"pointer", color:T.ink3, fontSize:14 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop:"2px solid "+T.bg3, background:T.bg2 }}>
                      <td style={{ padding:"10px 14px", fontSize:12, fontWeight:700, color:T.ink3 }}>Totals</td>
                      <td style={{ padding:"10px 14px" }}>
                        <div style={{ fontSize:12, color:T.greenDk, fontWeight:700 }}>+{fmtFull(sortedTxns.filter(t=>t.type==="income").reduce((s,t)=>s+parseFloat(t.amount),0))}</div>
                        <div style={{ fontSize:12, color:"#ef4444", fontWeight:700 }}>−{fmtFull(sortedTxns.filter(t=>t.type==="expense").reduce((s,t)=>s+parseFloat(t.amount),0))}</div>
                      </td>
                      <td colSpan={4}/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </Card>
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
                ? <EmptyState icon="◇" title="No transactions" message="No transactions posted to this account yet."/>
                : (
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                      <thead>
                        <tr style={{ background:"#1a6b4a" }}>
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
                            <td style={{ padding:"10px 14px", fontWeight:700, color:t.type==="income"?T.greenDk:T.red, textAlign:"right" }}>
                              {t.type==="income"?"+":"−"}{fmtFull(parseFloat(t.amount))}
                            </td>
                            <td style={{ padding:"10px 14px" }}>
                              <div style={{ fontWeight:600, color:T.ink }}>{t.description}</div>
                              {t.vendor_donor && <div style={{ fontSize:11, color:T.ink3 }}>{t.vendor_donor}</div>}
                            </td>
                            <td style={{ padding:"10px 14px" }}>
                              {t.fund_name && <span style={{ fontSize:11, fontWeight:600, color:t.fund_restricted?"#8b5cf6":"#1a6b4a" }}>{t.fund_name}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop:"2px solid "+T.bg3, background:T.bg2 }}>
                          <td style={{ padding:"10px 14px", fontWeight:700, fontSize:12 }}>Balance</td>
                          <td style={{ padding:"10px 14px", fontWeight:800, color:
                            (transactions.filter(t=>t.account_id===drillAcct.id&&t.type==="income").reduce((s,t)=>s+parseFloat(t.amount),0) -
                            transactions.filter(t=>t.account_id===drillAcct.id&&t.type==="expense").reduce((s,t)=>s+parseFloat(t.amount),0)) >= 0 ? "#1a6b4a" : "#ef4444"
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
              <button style={btn()} onClick={() => setShowAcctModal(true)}>+ Add Account</button>
            </div>
            {ACCT_TYPES.map(type => {
              const group = accounts.filter(a => a.type === type.id);
              if (!group.length) return null;
              return (
                <Card key={type.id}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:type.color }}/>
                    <SectionLabel style={{ marginBottom:0 }}>{type.label === "Liability" ? "Liabilities" : type.label + "s"}</SectionLabel>
                  </div>
                  {group.map((a, i) => {
                    const acctBal = transactions.filter(t=>t.account_id===a.id&&t.type==="income").reduce((s,t)=>s+parseFloat(t.amount),0)
                      - transactions.filter(t=>t.account_id===a.id&&t.type==="expense").reduce((s,t)=>s+parseFloat(t.amount),0);
                    return (
                      <div key={a.id} onClick={() => setDrillAcct(a)} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderTop: i > 0 ? "1px solid "+T.bg3 : "", cursor:"pointer" }}>
                        <span style={{ fontSize:12, fontWeight:700, color:T.ink3, minWidth:40 }}>{a.code}</span>
                        <span style={{ flex:1, fontSize:13, fontWeight:600, color:a.active===false?T.ink3:T.ink, textDecoration:a.active===false?"line-through":"none" }}>{a.name}</span>
                        {a.active === false && <span style={{ fontSize:11, color:"#ef4444", background:"#ef444418", borderRadius:5, padding:"2px 7px" }}>Inactive</span>}
                        <span style={{ fontSize:13, fontWeight:700, color:acctBal>=0?"#1a6b4a":"#ef4444", minWidth:80, textAlign:"right" }}>{fmtFull(acctBal)}</span>
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

      {/* ── Funds ── */}
      {subtab === "funds" && <>
        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <button style={btn()} onClick={() => setShowFundModal(true)}>+ Add Fund</button>
        </div>
        <Card>
          <SectionLabel>Fund Accounting</SectionLabel>
          <div style={{ fontSize:12, color:T.ink3, marginBottom:14, lineHeight:1.6 }}>
            Every transaction is tagged to a fund. Restricted funds hold donor- or grant-restricted dollars and must be spent only for the designated purpose.
          </div>
          {funds.length === 0 && <EmptyState icon="◈" title="No funds" message="Create funds to track where each dollar lives."/>}
          {funds.map((f, i) => {
            const fb = fundBalances[f.id] || { income:0, expense:0 };
            const balance = fb.income - fb.expense;
            const sparkVals = getFundSparkline(f.id);
            return (
              <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderTop: i > 0 ? "1px solid "+T.bg3 : "" }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:f.restricted?"#8b5cf6":"#1a6b4a", flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{f.name}</span>
                    <span style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", color:f.restricted?"#8b5cf6":"#1a6b4a" }}>{f.restricted ? "Restricted" : "Unrestricted"}</span>
                  </div>
                  {f.description && <div style={{ fontSize:12, color:T.ink3, marginTop:2 }}>{f.description}</div>}
                  <div style={{ fontSize:11, color:T.ink3, marginTop:4 }}>
                    ↑ {fmtFull(fb.income)} income &nbsp;·&nbsp; ↓ {fmtFull(fb.expense)} expenses &nbsp;·&nbsp;
                    <span style={{ fontWeight:700, color:balance >= 0?"#1a6b4a":"#ef4444" }}>Balance: {fmtFull(balance)}</span>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                  <Sparkline values={sparkVals}/>
                  <span style={{ fontSize:9, color:T.ink3, textTransform:"uppercase", letterSpacing:".05em" }}>8 wks</span>
                </div>
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
          <span style={{ fontSize:12, color:T.ink3, marginLeft:4 }}>Click any budget cell to edit inline.</span>
        </div>
        {["revenue","expense"].map(section => {
          const rows = budgets.filter(b => b.accountType === section);
          if (!rows.length) return null;
          const totBudget = rows.reduce((s,b) => s + b.budget, 0);
          const totActual = rows.reduce((s,b) => s + b.actual, 0);
          const totVar = totBudget - totActual;
          return (
            <Card key={section}>
              <SectionLabel>{section === "revenue" ? "Revenue Budget" : "Expense Budget"}</SectionLabel>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr style={{ background:"#1a6b4a" }}>
                    <th style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Account</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Budget</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Actual YTD</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Variance</th>
                    <th style={{ padding:"8px 12px", textAlign:"right", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>Proj. Year-End</th>
                    <th style={{ padding:"8px 12px", width:80 }}/>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b, i) => {
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
                          <BudgetInput value={b.budget} onSave={val => handleBudgetChange(b.accountId, val)}/>
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:600, color:T.ink }}>
                          <div>{fmtFull(b.actual)}</div>
                          {b.budget > 0 && <div style={{ fontSize:10, color:T.ink3 }}>{pct}% of budget</div>}
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:over?"#ef4444":"#1a6b4a" }}>
                          {b.variance >= 0 ? "+" : ""}{fmtFull(b.variance)}
                        </td>
                        <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:overProj?"#ef4444":T.ink3 }}>
                          {fmtFull(projected)}
                          {overProj && <div style={{ fontSize:10, color:"#ef4444" }}>over budget</div>}
                        </td>
                        <td style={{ padding:"10px 12px" }}>
                          <div style={{ height:6, background:T.bg3, borderRadius:99, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${Math.min(pct,100)}%`, background:over?"#ef4444":"#1a6b4a", borderRadius:99 }}/>
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
                    <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:totVar>=0?"#1a6b4a":"#ef4444" }}>{totVar>=0?"+":""}{fmtFull(totVar)}</td>
                    <td style={{ padding:"10px 12px", textAlign:"right", fontWeight:700, color:T.ink3 }}>{fmtFull(monthsElapsed>0?Math.round((totActual/monthsElapsed)*12):totActual)}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </Card>
          );
        })}
      </>}

      {/* ── Reports ── */}
      {subtab === "reports" && <>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {[["income","Income Statement"],["balance","Balance Sheet"],["fund","Fund Summary"],["990","990 Prep"]].map(([id,label]) => (
            <button key={id} onClick={() => setReport(id)}
              style={{ ...btn(report===id?T.green:T.bg, report===id?"#fff":T.ink3), border:"1px solid "+(report===id?"transparent":T.bg3) }}>
              {label}
            </button>
          ))}
          <button style={{ ...ghostBtn, marginLeft:"auto" }} onClick={() => window.print()}>⎙ Print</button>
        </div>

        {report === "income" && (
          <Card>
            <div style={{ fontSize:16, fontWeight:800, color:T.ink, marginBottom:4 }}>Income Statement</div>
            <div style={{ fontSize:12, color:T.ink3, marginBottom:18 }}>Year to Date {txnYear} &nbsp;·&nbsp; {new Date().toLocaleDateString()}</div>
            <SectionLabel>Revenue</SectionLabel>
            {Object.entries(incomeByAcct).map(([name, amt]) => (
              <div key={name} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid "+T.bg3 }}>
                <span style={{ fontSize:13, color:T.ink }}>{name}</span>
                <span style={{ fontSize:13, fontWeight:600, color:T.greenDk }}>{fmtFull(amt)}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"2px solid "+T.ink3, marginTop:4 }}>
              <span style={{ fontWeight:700, color:T.ink }}>Total Revenue</span>
              <span style={{ fontWeight:800, color:T.greenDk }}>{fmtFull(totalRev)}</span>
            </div>
            <SectionLabel style={{ marginTop:16 }}>Expenses</SectionLabel>
            {Object.entries(expenseByAcct).map(([name, amt]) => (
              <div key={name} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid "+T.bg3 }}>
                <span style={{ fontSize:13, color:T.ink }}>{name}</span>
                <span style={{ fontSize:13, fontWeight:600, color:"#ef4444" }}>{fmtFull(amt)}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"2px solid "+T.ink3, marginTop:4 }}>
              <span style={{ fontWeight:700, color:T.ink }}>Total Expenses</span>
              <span style={{ fontWeight:800, color:"#ef4444" }}>{fmtFull(totalExp)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"14px 16px", background:totalRev-totalExp>=0?"#1a6b4a18":"#ef444418", borderRadius:10, marginTop:16 }}>
              <span style={{ fontWeight:800, fontSize:15, color:T.ink }}>Net Surplus / (Deficit)</span>
              <span style={{ fontWeight:800, fontSize:15, color:totalRev-totalExp>=0?"#1a6b4a":"#ef4444" }}>{fmtFull(totalRev - totalExp)}</span>
            </div>
          </Card>
        )}

        {report === "balance" && (
          <Card>
            <div style={{ fontSize:16, fontWeight:800, color:T.ink, marginBottom:4 }}>Balance Sheet</div>
            <div style={{ fontSize:12, color:T.ink3, marginBottom:18 }}>As of {new Date().toLocaleDateString()}</div>
            {["asset","liability","net_asset"].map(typeId => {
              const type = ACCT_TYPES.find(t => t.id === typeId);
              const typeAccts = accounts.filter(a => a.type === typeId && a.active !== false);
              const netForType = typeId === "asset" ? totalRev : typeId === "liability" ? 0 : totalRev - totalExp;
              return (
                <div key={typeId} style={{ marginBottom:20 }}>
                  <SectionLabel>{type.label}s</SectionLabel>
                  {typeAccts.map(a => (
                    <div key={a.id} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid "+T.bg3 }}>
                      <span style={{ fontSize:13, color:T.ink }}>{a.code} {a.name}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:type.color }}>—</span>
                    </div>
                  ))}
                  {typeAccts.length === 0 && <div style={{ fontSize:12, color:T.ink3, padding:"8px 0" }}>No accounts</div>}
                </div>
              );
            })}
            <div style={{ padding:"12px 16px", background:T.bg2, borderRadius:10, fontSize:13, color:T.ink3 }}>
              Full balance sheet requires opening balances. Log opening entries to populate asset/liability values.
            </div>
          </Card>
        )}

        {report === "fund" && (
          <Card>
            <div style={{ fontSize:16, fontWeight:800, color:T.ink, marginBottom:4 }}>Fund Summary</div>
            <div style={{ fontSize:12, color:T.ink3, marginBottom:18 }}>Year to Date {txnYear} &nbsp;·&nbsp; {new Date().toLocaleDateString()}</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:"#1a6b4a" }}>
                  {["Fund","Type","Income","Expenses","Balance"].map(h => (
                    <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontSize:11, fontWeight:700, color:"#fff", textTransform:"uppercase", letterSpacing:".06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.values(fundBalances).map((f, i) => (
                  <tr key={i} style={{ borderTop:"1px solid "+T.bg3 }}>
                    <td style={{ padding:"10px 12px", fontWeight:600, color:T.ink }}>{f.name}</td>
                    <td style={{ padding:"10px 12px" }}>
                      <span style={{ fontSize:11, fontWeight:600, color:f.restricted?"#8b5cf6":"#1a6b4a" }}>{f.restricted?"Restricted":"Unrestricted"}</span>
                    </td>
                    <td style={{ padding:"10px 12px", color:T.greenDk, fontWeight:600 }}>{fmtFull(f.income)}</td>
                    <td style={{ padding:"10px 12px", color:"#ef4444", fontWeight:600 }}>{fmtFull(f.expense)}</td>
                    <td style={{ padding:"10px 12px", fontWeight:700, color:f.income-f.expense>=0?"#1a6b4a":"#ef4444" }}>{fmtFull(f.income-f.expense)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:"2px solid "+T.ink3, background:T.bg2 }}>
                  <td style={{ padding:"10px 12px", fontWeight:700 }} colSpan={2}>Total</td>
                  <td style={{ padding:"10px 12px", fontWeight:700, color:T.greenDk }}>{fmtFull(Object.values(fundBalances).reduce((s,f)=>s+f.income,0))}</td>
                  <td style={{ padding:"10px 12px", fontWeight:700, color:"#ef4444" }}>{fmtFull(Object.values(fundBalances).reduce((s,f)=>s+f.expense,0))}</td>
                  <td style={{ padding:"10px 12px", fontWeight:700 }}>{fmtFull(Object.values(fundBalances).reduce((s,f)=>s+(f.income-f.expense),0))}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
        )}

        {report === "990" && (
          <Card>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
              <div style={{ fontSize:16, fontWeight:800, color:T.ink, flex:1 }}>Form 990 Prep Report</div>
              <button style={ghostBtn} onClick={export990CSV}>⬇ Export CSV</button>
            </div>
            <div style={{ fontSize:12, color:T.ink3, marginBottom:18 }}>Year {txnYear} &nbsp;·&nbsp; For accountant use — verify all figures with audited financials.</div>
            <SectionLabel>Part VIII — Revenue (Statement of Revenue)</SectionLabel>
            {[
              ["1a", "Federated campaigns", null],
              ["1b", "Membership dues", null],
              ["1c", "Fundraising events (Gross)", expenseByAcct["Fundraising — Events"] || 0],
              ["1d", "Related organizations", null],
              ["1e", "Government grants", incomeByAcct["Government Grants"] || 0],
              ["1f", "All other contributions", (incomeByAcct["Individual Contributions"]||0) + (incomeByAcct["Foundation Grants"]||0)],
              ["2", "Program service revenue", incomeByAcct["Program Revenue"] || 0],
              ["7", "Other revenue", incomeByAcct["Other Revenue"] || 0],
            ].map(([line, label, amt]) => (
              <div key={line} style={{ display:"flex", gap:12, padding:"7px 0", borderBottom:"1px solid "+T.bg3 }}>
                <span style={{ fontSize:12, fontWeight:700, color:T.ink3, minWidth:30 }}>{line}</span>
                <span style={{ flex:1, fontSize:13, color:T.ink }}>{label}</span>
                <span style={{ fontSize:13, fontWeight:600, color:T.ink }}>{amt != null ? fmtFull(amt) : "—"}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"2px solid "+T.ink3, marginTop:4 }}>
              <span style={{ fontWeight:700 }}>Total Revenue (Line 12)</span>
              <span style={{ fontWeight:800, color:T.greenDk }}>{fmtFull(totalRev)}</span>
            </div>
            <SectionLabel style={{ marginTop:16 }}>Part IX — Expenses (Statement of Functional Expenses)</SectionLabel>
            {[
              ["Program services", ["Program Services — Salaries","Program Services — Supplies","Program Services — Contractors","Program Services — Occupancy"].reduce((s,k) => s+(expenseByAcct[k]||0), 0)],
              ["Management & general", ["Management & General — Salaries","Management & General — Admin","Management & General — Technology"].reduce((s,k) => s+(expenseByAcct[k]||0), 0)],
              ["Fundraising", ["Fundraising — Salaries","Fundraising — Events","Fundraising — Marketing"].reduce((s,k) => s+(expenseByAcct[k]||0), 0)],
            ].map(([label, amt]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid "+T.bg3 }}>
                <span style={{ fontSize:13, color:T.ink }}>{label}</span>
                <span style={{ fontSize:13, fontWeight:600, color:"#ef4444" }}>{fmtFull(amt)}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"2px solid "+T.ink3, marginTop:4 }}>
              <span style={{ fontWeight:700 }}>Total Expenses (Line 25)</span>
              <span style={{ fontWeight:800, color:"#ef4444" }}>{fmtFull(totalExp)}</span>
            </div>
            {totalExp > 0 && (
              <div style={{ marginTop:16, padding:"12px 16px", background:T.bg2, borderRadius:10, fontSize:12, color:T.ink3, lineHeight:1.7 }}>
                <strong>Program ratio:</strong> {Math.round(["Program Services — Salaries","Program Services — Supplies","Program Services — Contractors","Program Services — Occupancy"].reduce((s,k) => s+(expenseByAcct[k]||0), 0) / totalExp * 100)}% &nbsp;·&nbsp;
                <strong>M&amp;G ratio:</strong> {Math.round(["Management & General — Salaries","Management & General — Admin","Management & General — Technology"].reduce((s,k) => s+(expenseByAcct[k]||0), 0) / totalExp * 100)}% &nbsp;·&nbsp;
                <strong>Fundraising ratio:</strong> {Math.round(["Fundraising — Salaries","Fundraising — Events","Fundraising — Marketing"].reduce((s,k) => s+(expenseByAcct[k]||0), 0) / totalExp * 100)}%
              </div>
            )}
          </Card>
        )}
      </>}

      {/* ── Audit Log ── */}
      {subtab === "audit" && <>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <select value={auditActionFilter} onChange={e => setAuditActionFilter(e.target.value)} style={{ ...inp, width:140, cursor:"pointer" }}>
            <option value="">All Actions</option>
            <option value="created">Created</option>
            <option value="updated">Updated</option>
            <option value="deleted">Deleted</option>
          </select>
          <select value={auditEntityFilter} onChange={e => setAuditEntityFilter(e.target.value)} style={{ ...inp, width:160, cursor:"pointer" }}>
            <option value="">All Entity Types</option>
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
              ? <EmptyState icon="◇" title="No audit entries" message="Changes to transactions, accounts, funds, and budgets appear here."/>
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
                          created: { bg:"#1a6b4a18", color:T.greenDk },
                          updated: { bg:"#f59e0b20", color:"#d97706" },
                          deleted: { bg:"#ef444420", color:"#ef4444" },
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
                                        <div style={{ fontSize:10, fontWeight:700, color:"#ef4444", marginBottom:6, textTransform:"uppercase", letterSpacing:".06em" }}>Before</div>
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
    return <svg width={width} height={height}><line x1={0} y1={height/2} x2={width} y2={height/2} stroke="#ddd9d0" strokeWidth="1" strokeDasharray="3,2"/></svg>;
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
  const color = trending ? "#1a6b4a" : "#ef4444";
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
