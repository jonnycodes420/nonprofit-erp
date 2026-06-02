import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

function adminFetch(path, opts = {}) {
  const token = localStorage.getItem("npe_token");
  return fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, ...(opts.headers || {}) },
  }).then(async r => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  });
}

// ── Design tokens ──────────────────────────────────────────────────────────
const A = {
  bg:      "#0a0f0a",
  sidebar: "#0f1a12",
  surface: "#111a12",
  card:    "#1a2e1f",
  border:  "#2d4a35",
  green:   "#10b981",
  greenDk: "#1a6b4a",
  gold:    "#c9a84c",
  cream:   "#f0ede6",
  sage:    "#8fa896",
  red:     "#ef4444",
  amber:   "#f59e0b",
  blue:    "#3b82f6",
};

const PLAN_MRR  = { trial: 0, seed: 99, growth: 249, impact: 499 };
const PLAN_COLOR = { trial: A.amber, seed: A.blue, growth: A.green, impact: A.gold };
const PLAN_LABEL = { trial: "Trial", seed: "Seed", growth: "Growth", impact: "Impact" };

function fmt$(n) { return "$" + Number(n || 0).toLocaleString(); }
function fmtDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysAgo(s) {
  if (!s) return "—";
  const d = Math.floor((Date.now() - new Date(s)) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  return d + "d ago";
}

function PlanBadge({ plan }) {
  const color = PLAN_COLOR[plan] || A.sage;
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color, border: `1px solid ${color}44`, borderRadius: 99, padding: "2px 8px" }}>
      {PLAN_LABEL[plan] || plan}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = { active: [A.green, "Active"], trialing: [A.amber, "Trialing"], cancelled: [A.red, "Churned"], past_due: [A.red, "Past Due"] };
  const [color, label] = map[status] || [A.sage, status];
  return <span style={{ fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}44`, borderRadius: 99, padding: "2px 8px" }}>{label}</span>;
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, padding: "20px 24px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: A.sage, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || A.cream, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: A.sage, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ── Overview page ──────────────────────────────────────────────────────────
function Overview({ metrics, orgs }) {
  if (!metrics) return <div style={{ color: A.sage, padding: 32 }}>Loading metrics…</div>;

  const recentOrgs = [...(orgs || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const planGroups = ["seed", "growth", "impact"].map(p => ({
    plan: p,
    count: (orgs || []).filter(o => o.plan === p && o.subscription_status === "active").length,
    revenue: (orgs || []).filter(o => o.plan === p && o.subscription_status === "active").reduce((s) => s + PLAN_MRR[p], 0),
  }));
  const maxRev = Math.max(...planGroups.map(g => g.revenue), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16 }}>
        <MetricCard label="MRR" value={fmt$(metrics.mrr)} color={A.green} />
        <MetricCard label="ARR" value={fmt$(metrics.arr)} color={A.green} />
        <MetricCard label="Active Orgs" value={metrics.active_subscriptions} />
        <MetricCard label="Trialing" value={metrics.trialing} sub={`${metrics.avg_trial_days_remaining}d avg remaining`} color={A.amber} />
        <MetricCard label="Churned" value={metrics.churned} color={metrics.churned > 0 ? A.red : A.sage} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* MRR breakdown */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, padding: "24px 28px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: A.cream, marginBottom: 20 }}>MRR by Plan</div>
          {planGroups.map(g => (
            <div key={g.plan} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PlanBadge plan={g.plan} />
                  <span style={{ fontSize: 12, color: A.sage }}>{g.count} org{g.count !== 1 ? "s" : ""}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: A.cream }}>{fmt$(g.revenue)}</span>
              </div>
              <div style={{ height: 6, background: "#1a2e1f", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(g.revenue / maxRev) * 100}%`, background: PLAN_COLOR[g.plan], borderRadius: 99, transition: "width 0.5s" }} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${A.border}`, marginTop: 8, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: A.sage }}>Trial conversion rate</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: A.green }}>{metrics.trial_conversion_rate}%</span>
          </div>
        </div>

        {/* Growth */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, padding: "24px 28px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: A.cream, marginBottom: 20 }}>New Signups</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div style={{ background: A.surface, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, color: A.sage, marginBottom: 6 }}>This month</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: A.green, fontFamily: "'DM Serif Display',Georgia,serif" }}>{metrics.new_orgs_this_month}</div>
            </div>
            <div style={{ background: A.surface, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, color: A.sage, marginBottom: 6 }}>Last month</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: A.cream, fontFamily: "'DM Serif Display',Georgia,serif" }}>{metrics.new_orgs_last_month}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[["Total orgs", metrics.total_orgs], ["Total donors", metrics.total_donors?.toLocaleString()], ["Total grants", metrics.total_grants?.toLocaleString()], ["Total interactions", metrics.total_interactions?.toLocaleString()]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: A.sage }}>{k}</span>
                <span style={{ color: A.cream, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent signups */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, padding: "24px 28px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: A.cream, marginBottom: 16 }}>Recent Signups</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${A.border}` }}>
              {["Org", "Plan", "Status", "Donors", "Created"].map(h => (
                <th key={h} style={{ fontSize: 11, fontWeight: 700, color: A.sage, letterSpacing: "0.06em", textTransform: "uppercase", padding: "0 12px 10px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentOrgs.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${A.border}22` }}>
                <td style={{ padding: "12px", fontSize: 13, color: A.cream, fontWeight: 600 }}>{o.name}</td>
                <td style={{ padding: "12px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "12px" }}><StatusBadge status={o.subscription_status} /></td>
                <td style={{ padding: "12px", fontSize: 13, color: A.sage }}>{o.donor_count}</td>
                <td style={{ padding: "12px", fontSize: 12, color: A.sage }}>{fmtDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Org detail panel ────────────────────────────────────────────────────────
function OrgPanel({ org, onClose, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [extDays, setExtDays] = useState("14");
  const [newPlan, setNewPlan] = useState(org.plan || "trial");
  const [working, setWorking] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

  useEffect(() => {
    adminFetch("/admin/orgs/" + org.id).then(setDetail).catch(console.error);
  }, [org.id]);

  async function extendTrial() {
    setWorking(true);
    try { await adminFetch("/admin/orgs/" + org.id + "/extend-trial", { method: "POST", body: JSON.stringify({ days: parseInt(extDays, 10) }) }); onRefresh(); }
    catch (e) { alert(e.message); }
    setWorking(false);
  }

  async function changePlan() {
    setWorking(true);
    try { await adminFetch("/admin/orgs/" + org.id + "/change-plan", { method: "POST", body: JSON.stringify({ plan: newPlan }) }); onRefresh(); }
    catch (e) { alert(e.message); }
    setWorking(false);
  }

  async function deleteOrg() {
    if (deleteInput !== org.name) { alert("Type the org name exactly to confirm."); return; }
    setWorking(true);
    try {
      await adminFetch("/admin/orgs/" + org.id, { method: "DELETE", body: JSON.stringify({ confirm: true }) });
      onClose(); onRefresh();
    } catch (e) { alert(e.message); }
    setWorking(false);
  }

  const INP = { background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8, padding: "8px 12px", color: A.cream, fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ width: 480, background: A.surface, borderLeft: `1px solid ${A.border}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ padding: "24px 28px", borderBottom: `1px solid ${A.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: A.cream, marginBottom: 6 }}>{org.name}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <PlanBadge plan={org.plan} />
              <StatusBadge status={org.subscription_status} />
            </div>
            <div style={{ fontSize: 12, color: A.sage, marginTop: 8 }}>Created {fmtDate(org.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: A.sage, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[["Donors", org.donor_count], ["Grants", org.grant_count], ["Users", org.user_count],
              ["Sequences", detail?.sequence_count ?? "—"], ["Enrollments", detail?.enrollment_count ?? "—"], ["MRR", fmt$(org.monthly_revenue)]].map(([k, v]) => (
              <div key={k} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: A.sage, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: A.cream }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Users */}
          {detail?.users?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: A.sage, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Users</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {detail.users.map(u => (
                  <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: A.cream }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: A.sage }}>{u.email}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: u.role === "admin" ? A.gold : A.sage, border: `1px solid ${u.role === "admin" ? A.gold : A.border}44`, borderRadius: 99, padding: "2px 8px" }}>{u.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {detail?.recent_activity?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: A.sage, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Recent Activity</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {detail.recent_activity.slice(0, 6).map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: A.sage, padding: "8px 12px", background: A.card, borderRadius: 8, borderLeft: `2px solid ${A.greenDk}` }}>
                    <span style={{ color: A.cream, fontWeight: 600 }}>{a.donor_name}</span> · {a.type} · {daysAgo(a.created_at)}
                    {a.note && <div style={{ marginTop: 2, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: A.sage, letterSpacing: "0.06em", textTransform: "uppercase" }}>Actions</div>

            {/* Extend trial */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" value={extDays} onChange={e => setExtDays(e.target.value)} min={1} max={365} style={{ ...INP, width: 70 }} />
              <span style={{ fontSize: 13, color: A.sage }}>days</span>
              <button onClick={extendTrial} disabled={working} style={{ flex: 1, background: A.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Extend Trial</button>
            </div>

            {/* Change plan */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={newPlan} onChange={e => setNewPlan(e.target.value)} style={{ ...INP, flex: 1, appearance: "none" }}>
                {["trial", "seed", "growth", "impact"].map(p => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
              </select>
              <button onClick={changePlan} disabled={working} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "9px 16px", color: A.cream, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Change Plan</button>
            </div>

            {/* Stripe + org ID */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => navigator.clipboard.writeText(org.id)} style={{ flex: 1, background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "8px 12px", color: A.sage, fontSize: 12, cursor: "pointer" }}>Copy Org ID</button>
              {org.stripe_customer_id && (
                <a href={`https://dashboard.stripe.com/customers/${org.stripe_customer_id}`} target="_blank" rel="noreferrer"
                  style={{ flex: 1, background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "8px 12px", color: A.sage, fontSize: 12, cursor: "pointer", textDecoration: "none", textAlign: "center" }}>
                  View in Stripe ↗
                </a>
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div style={{ border: `1px solid ${A.red}33`, borderRadius: 10, padding: "16px 20px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: A.red, marginBottom: 10 }}>DANGER ZONE</div>
            {!showDelete ? (
              <button onClick={() => setShowDelete(true)} style={{ background: "transparent", border: `1px solid ${A.red}66`, borderRadius: 8, padding: "8px 16px", color: A.red, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete org permanently</button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: A.sage }}>Type <strong style={{ color: A.cream }}>{org.name}</strong> to confirm:</div>
                <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder={org.name} style={{ ...INP, width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={deleteOrg} disabled={working} style={{ flex: 1, background: A.red, border: "none", borderRadius: 8, padding: "9px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Delete everything</button>
                  <button onClick={() => { setShowDelete(false); setDeleteInput(""); }} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "9px 16px", color: A.sage, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Organizations page ──────────────────────────────────────────────────────
function Organizations({ orgs, loading, onRefresh }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [extendOrgId, setExtendOrgId] = useState(null);
  const [extDays, setExtDays] = useState("14");
  const [changePlanOrgId, setChangePlanOrgId] = useState(null);
  const [newPlan, setNewPlan] = useState("growth");

  const filtered = (orgs || [])
    .filter(o => !search || o.name.toLowerCase().includes(search.toLowerCase()))
    .filter(o => statusFilter === "all" || o.subscription_status === statusFilter)
    .sort((a, b) => {
      if (sortBy === "mrr") return b.monthly_revenue - a.monthly_revenue;
      if (sortBy === "donors") return b.donor_count - a.donor_count;
      if (sortBy === "last_active") return new Date(b.last_active || 0) - new Date(a.last_active || 0);
      return new Date(b.created_at) - new Date(a.created_at);
    });

  async function quickExtend(orgId) {
    try { await adminFetch("/admin/orgs/" + orgId + "/extend-trial", { method: "POST", body: JSON.stringify({ days: parseInt(extDays, 10) }) }); onRefresh(); setExtendOrgId(null); }
    catch (e) { alert(e.message); }
  }

  async function quickChangePlan(orgId) {
    try { await adminFetch("/admin/orgs/" + orgId + "/change-plan", { method: "POST", body: JSON.stringify({ plan: newPlan }) }); onRefresh(); setChangePlanOrgId(null); }
    catch (e) { alert(e.message); }
  }

  const INP = { background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8, padding: "8px 12px", color: A.cream, fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orgs…" style={{ ...INP, flex: 1, minWidth: 200 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...INP }}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="cancelled">Churned</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...INP }}>
          <option value="created_at">Sort: Created</option>
          <option value="mrr">Sort: MRR</option>
          <option value="donors">Sort: Donors</option>
          <option value="last_active">Sort: Last active</option>
        </select>
        <button onClick={onRefresh} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "8px 14px", color: A.sage, fontSize: 13, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {/* Table */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.sidebar }}>
              {["Org", "Plan", "Status", "Donors", "Grants", "Users", "Last active", "MRR", "Actions"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.sage, letterSpacing: "0.07em", textTransform: "uppercase", padding: "12px 14px", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: A.sage, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: A.sage, fontSize: 13 }}>No orgs found</td></tr>}
            {filtered.map(o => (
              <tr key={o.id} style={{ borderTop: `1px solid ${A.border}33`, transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = A.surface + "88"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: A.cream }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: A.sage, marginTop: 2 }}>{o.id}</div>
                </td>
                <td style={{ padding: "12px 14px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "12px 14px" }}><StatusBadge status={o.subscription_status} /></td>
                <td style={{ padding: "12px 14px", fontSize: 13, color: A.sage }}>{o.donor_count}</td>
                <td style={{ padding: "12px 14px", fontSize: 13, color: A.sage }}>{o.grant_count}</td>
                <td style={{ padding: "12px 14px", fontSize: 13, color: A.sage }}>{o.user_count}</td>
                <td style={{ padding: "12px 14px", fontSize: 12, color: A.sage }}>{daysAgo(o.last_active)}</td>
                <td style={{ padding: "12px 14px", fontSize: 13, fontWeight: 700, color: o.monthly_revenue > 0 ? A.green : A.sage }}>{fmt$(o.monthly_revenue)}</td>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => setSelectedOrg(o)} style={{ background: A.greenDk, border: "none", borderRadius: 6, padding: "5px 10px", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>View →</button>
                    {extendOrgId === o.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="number" value={extDays} onChange={e => setExtDays(e.target.value)} style={{ ...INP, width: 50, padding: "4px 8px", fontSize: 11 }} />
                        <button onClick={() => quickExtend(o.id)} style={{ background: A.amber + "22", border: `1px solid ${A.amber}44`, borderRadius: 6, padding: "5px 8px", color: A.amber, fontSize: 11, cursor: "pointer" }}>+days</button>
                        <button onClick={() => setExtendOrgId(null)} style={{ background: "none", border: "none", color: A.sage, fontSize: 13, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setExtendOrgId(o.id)} style={{ background: A.amber + "22", border: `1px solid ${A.amber}44`, borderRadius: 6, padding: "5px 10px", color: A.amber, fontSize: 11, cursor: "pointer" }}>+Trial</button>
                    )}
                    {changePlanOrgId === o.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <select value={newPlan} onChange={e => setNewPlan(e.target.value)} style={{ ...INP, padding: "4px 8px", fontSize: 11 }}>
                          {["trial","seed","growth","impact"].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button onClick={() => quickChangePlan(o.id)} style={{ background: A.blue + "22", border: `1px solid ${A.blue}44`, borderRadius: 6, padding: "5px 8px", color: A.blue, fontSize: 11, cursor: "pointer" }}>Set</button>
                        <button onClick={() => setChangePlanOrgId(null)} style={{ background: "none", border: "none", color: A.sage, fontSize: 13, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setChangePlanOrgId(o.id); setNewPlan(o.plan || "trial"); }} style={{ background: A.blue + "22", border: `1px solid ${A.blue}44`, borderRadius: 6, padding: "5px 10px", color: A.blue, fontSize: 11, cursor: "pointer" }}>Plan</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedOrg && <OrgPanel org={selectedOrg} onClose={() => setSelectedOrg(null)} onRefresh={() => { onRefresh(); setSelectedOrg(null); }} />}
    </div>
  );
}

// ── Metrics page ────────────────────────────────────────────────────────────
function Metrics({ metrics, orgs }) {
  if (!metrics || !orgs) return <div style={{ color: A.sage, padding: 32 }}>Loading…</div>;

  // MRR by signup month (cumulative active orgs)
  const monthCounts = {};
  orgs.filter(o => o.subscription_status === "active").forEach(o => {
    const m = o.created_at?.slice(0, 7);
    if (m) monthCounts[m] = (monthCounts[m] || 0) + (PLAN_MRR[o.plan] || 0);
  });
  const months = Object.keys(monthCounts).sort().slice(-8);
  const maxMRR = Math.max(...months.map(m => monthCounts[m]), 1);

  // Funnel
  const total = metrics.total_orgs;
  const funnel = [
    { label: "Signed up", count: total, pct: 100 },
    { label: "Still trialing", count: metrics.trialing, pct: total ? Math.round((metrics.trialing / total) * 100) : 0 },
    { label: "Converted", count: metrics.active_subscriptions, pct: total ? Math.round((metrics.active_subscriptions / total) * 100) : 0 },
    { label: "Churned", count: metrics.churned, pct: total ? Math.round((metrics.churned / total) * 100) : 0 },
  ];

  // Top orgs by usage
  const topOrgs = [...orgs].sort((a, b) => (b.donor_count + b.grant_count) - (a.donor_count + a.grant_count)).slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* MRR by month */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, padding: "24px 28px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: A.cream, marginBottom: 20 }}>MRR by Cohort Month</div>
          {months.length === 0 ? (
            <div style={{ fontSize: 13, color: A.sage }}>No active subscriptions yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {months.map(m => (
                <div key={m}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: A.sage }}>{m}</span>
                    <span style={{ color: A.green, fontWeight: 700 }}>{fmt$(monthCounts[m])}</span>
                  </div>
                  <div style={{ height: 6, background: A.surface, borderRadius: 99 }}>
                    <div style={{ height: "100%", width: `${(monthCounts[m] / maxMRR) * 100}%`, background: A.green, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plan distribution */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, padding: "24px 28px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: A.cream, marginBottom: 20 }}>Plan Distribution</div>
          {["trial", "seed", "growth", "impact"].map(p => {
            const count = metrics.plan_breakdown?.[p] ?? orgs.filter(o => o.plan === p).length;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={p} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><PlanBadge plan={p} /><span style={{ color: A.sage }}>{count} orgs</span></div>
                  <span style={{ color: A.cream, fontWeight: 600 }}>{pct}%</span>
                </div>
                <div style={{ height: 6, background: A.surface, borderRadius: 99 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: PLAN_COLOR[p], borderRadius: 99 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Funnel */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, padding: "24px 28px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: A.cream, marginBottom: 20 }}>Trial Conversion Funnel</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {funnel.map((f, i) => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 8, flex: i === 0 ? 2 : 1 }}>
              <div style={{ flex: 1, background: i === 2 ? A.greenDk : A.surface, border: `1px solid ${i === 2 ? A.green : A.border}`, borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: i === 2 ? A.green : A.cream }}>{f.count}</div>
                <div style={{ fontSize: 11, color: A.sage, marginTop: 4 }}>{f.label}</div>
                <div style={{ fontSize: 10, color: A.sage, marginTop: 2 }}>{f.pct}%</div>
              </div>
              {i < funnel.length - 1 && <div style={{ fontSize: 16, color: A.border }}>→</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Top orgs by usage */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "20px 28px 12px", fontSize: 13, fontWeight: 700, color: A.cream }}>Top Orgs by Usage</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.sidebar }}>
              {["Org", "Plan", "Donors", "Grants", "MRR"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.sage, letterSpacing: "0.07em", textTransform: "uppercase", padding: "10px 16px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topOrgs.map(o => (
              <tr key={o.id} style={{ borderTop: `1px solid ${A.border}33` }}>
                <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: A.cream }}>{o.name}</td>
                <td style={{ padding: "10px 16px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "10px 16px", fontSize: 13, color: A.sage }}>{o.donor_count}</td>
                <td style={{ padding: "10px 16px", fontSize: 13, color: A.sage }}>{o.grant_count}</td>
                <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 700, color: o.monthly_revenue > 0 ? A.green : A.sage }}>{fmt$(o.monthly_revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [page, setPage] = useState("overview");
  const [orgs, setOrgs] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loadingOrgs, setLoadingOrgs] = useState(true);

  // Guard: non-super-admins see nothing
  const rawUser = localStorage.getItem("npe_user");
  const storedUser = rawUser ? JSON.parse(rawUser) : null;
  if (!storedUser?.isSuperAdmin) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  const load = useCallback(async () => {
    setLoadingOrgs(true);
    try {
      const [o, m] = await Promise.all([adminFetch("/admin/orgs"), adminFetch("/admin/metrics")]);
      setOrgs(o);
      setMetrics(m);
    } catch (e) {
      console.error(e);
    }
    setLoadingOrgs(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function logout() {
    localStorage.removeItem("npe_token");
    localStorage.removeItem("npe_user");
    localStorage.removeItem("npe_org");
    navigate("/login");
  }

  const NAV = [
    { id: "overview", label: "Overview", icon: "◈" },
    { id: "orgs",     label: "Organizations", icon: "♦" },
    { id: "metrics",  label: "Metrics", icon: "◇" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", background: A.bg, fontFamily: "'DM Sans',system-ui,sans-serif", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, background: A.sidebar, borderRight: `1px solid ${A.border}`, display: "flex", flexDirection: "column", padding: "24px 0" }}>
        <div style={{ padding: "0 20px 24px", borderBottom: `1px solid ${A.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 28, height: 28, background: A.greenDk, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#f0ede6"/></svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: A.cream, fontFamily: "'DM Serif Display',Georgia,serif" }}>Steward</span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: A.red, background: A.red + "22", border: `1px solid ${A.red}44`, borderRadius: 4, padding: "2px 7px" }}>Admin</span>
        </div>

        <nav style={{ flex: 1, padding: "16px 12px" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              background: page === n.id ? A.card : "transparent",
              border: "none", borderRadius: 8, color: page === n.id ? A.cream : A.sage,
              fontSize: 13, fontWeight: page === n.id ? 700 : 500, cursor: "pointer", textAlign: "left",
              transition: "all 0.15s", marginBottom: 2,
            }}>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "16px 20px", borderTop: `1px solid ${A.border}` }}>
          <div style={{ fontSize: 12, color: A.sage, marginBottom: 4 }}>{storedUser.name || storedUser.email}</div>
          <button onClick={logout} style={{ background: "none", border: "none", color: A.red, fontSize: 12, cursor: "pointer", padding: 0, fontWeight: 600 }}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ background: A.surface, borderBottom: `1px solid ${A.border}`, padding: "0 32px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 400, color: A.cream, fontFamily: "'DM Serif Display',Georgia,serif" }}>
            Steward Admin
            <span style={{ fontSize: 13, color: A.sage, fontFamily: "'DM Sans',sans-serif", fontWeight: 400, marginLeft: 12 }}>
              {NAV.find(n => n.id === page)?.label}
            </span>
          </span>
          <div style={{ fontSize: 12, color: A.sage }}>{loadingOrgs ? "Loading…" : `${orgs?.length || 0} orgs`}</div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
          {page === "overview"  && <Overview metrics={metrics} orgs={orgs} />}
          {page === "orgs"      && <Organizations orgs={orgs} loading={loadingOrgs} onRefresh={load} />}
          {page === "metrics"   && <Metrics metrics={metrics} orgs={orgs} />}
        </div>
      </div>
    </div>
  );
}
