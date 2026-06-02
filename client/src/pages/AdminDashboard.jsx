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
  bg:      "#080f09",
  sidebar: "#0a110a",
  surface: "#0f1a12",
  card:    "#0f1a12",
  border:  "#1a2e1f",
  borderHover: "#2d4a35",
  green:   "#10b981",
  greenDk: "#1a6b4a",
  gold:    "#c9a84c",
  cream:   "#e8f0e8",
  sage:    "#6b8f6b",
  muted:   "#3d5c3d",
  red:     "#ef4444",
  amber:   "#f59e0b",
  blue:    "#3b82f6",
};

const PLAN_MRR   = { trial: 0, seed: 99, growth: 249, impact: 499 };
const PLAN_COLOR = { trial: "#c9a84c", seed: "#3b82f6", growth: "#10b981", impact: "#c9a84c" };
const PLAN_LABEL = { trial: "Trial", seed: "Seed", growth: "Growth", impact: "Impact" };
const PLAN_BADGE = {
  trial:  { bg: "#1a1a0a", color: "#c9a84c", bdr: "#3d3000" },
  seed:   { bg: "#0a0f1a", color: "#3b82f6", bdr: "#1a2850" },
  growth: { bg: "#0a1a0f", color: "#10b981", bdr: "#1a3d2a" },
  impact: { bg: "#1a150a", color: "#c9a84c", bdr: "#3d2a00" },
};

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
  const b = PLAN_BADGE[plan] || { bg: A.surface, color: A.sage, bdr: A.border };
  return (
    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: b.color, background: b.bg, border: `1px solid ${b.bdr}`, borderRadius: 3, padding: "2px 7px" }}>
      {PLAN_LABEL[plan] || plan}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    active:    { bg: "#0a1a0f", color: "#10b981", bdr: "#1a3d2a", label: "Active" },
    trialing:  { bg: "#1a1a0a", color: "#c9a84c", bdr: "#3d3000", label: "Trialing" },
    cancelled: { bg: "#1a0a0a", color: "#ef4444", bdr: "#3d1515", label: "Churned" },
    past_due:  { bg: "#1a0a0a", color: "#ef4444", bdr: "#3d1515", label: "Past Due" },
  };
  const b = map[status] || { bg: A.surface, color: A.sage, bdr: A.border, label: status };
  return <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: b.color, background: b.bg, border: `1px solid ${b.bdr}`, borderRadius: 3, padding: "2px 7px" }}>{b.label}</span>;
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: A.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || A.cream, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: A.sage, marginTop: 6 }}>{sub}</div>}
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

  const SH = { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: A.muted, marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${A.border}` };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
        <MetricCard label="MRR" value={fmt$(metrics.mrr)} color={A.green} />
        <MetricCard label="ARR" value={fmt$(metrics.arr)} color={A.green} />
        <MetricCard label="Active Orgs" value={metrics.active_subscriptions} />
        <MetricCard label="Trialing" value={metrics.trialing} sub={`${metrics.avg_trial_days_remaining}d avg remaining`} color={A.amber} />
        <MetricCard label="Churned" value={metrics.churned} color={metrics.churned > 0 ? A.red : A.muted} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* MRR breakdown */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
          <div style={SH}>MRR by Plan</div>
          {planGroups.map(g => (
            <div key={g.plan} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PlanBadge plan={g.plan} />
                  <span style={{ fontSize: 11, color: A.sage }}>{g.count} org{g.count !== 1 ? "s" : ""}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: A.cream, fontFamily: "'JetBrains Mono',monospace" }}>{fmt$(g.revenue)}</span>
              </div>
              <div style={{ height: 4, background: A.border, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(g.revenue / maxRev) * 100}%`, background: PLAN_COLOR[g.plan], borderRadius: 2, transition: "width 0.5s" }} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${A.border}`, marginTop: 8, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: A.sage }}>Trial conversion rate</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: A.green, fontFamily: "'JetBrains Mono',monospace" }}>{metrics.trial_conversion_rate}%</span>
          </div>
        </div>

        {/* Growth */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
          <div style={SH}>New Signups</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            <div style={{ background: A.sidebar, border: `1px solid ${A.border}`, borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: A.muted, marginBottom: 6 }}>This month</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: A.green, fontFamily: "'DM Serif Display',Georgia,serif" }}>{metrics.new_orgs_this_month}</div>
            </div>
            <div style={{ background: A.sidebar, border: `1px solid ${A.border}`, borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: A.muted, marginBottom: 6 }}>Last month</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: A.cream, fontFamily: "'DM Serif Display',Georgia,serif" }}>{metrics.new_orgs_last_month}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[["Total orgs", metrics.total_orgs], ["Total donors", metrics.total_donors?.toLocaleString()], ["Total grants", metrics.total_grants?.toLocaleString()], ["Total interactions", metrics.total_interactions?.toLocaleString()]].map(([k, v]) => (
              <div key={k} style={{ background: A.sidebar, border: `1px solid ${A.border}`, borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: A.muted, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: A.cream, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent signups */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "16px 20px 0" }}><div style={SH}>Recent Signups</div></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.sidebar }}>
              {["Org", "Plan", "Status", "Donors", "Created"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 16px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentOrgs.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${A.border}`, transition: "background 0.1s ease" }}
                onMouseEnter={e => e.currentTarget.style.background = A.sidebar}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "12px 16px", fontSize: 12, color: A.cream, fontWeight: 600 }}>{o.name}</td>
                <td style={{ padding: "12px 16px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "12px 16px" }}><StatusBadge status={o.subscription_status} /></td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: A.sage, fontFamily: "'JetBrains Mono',monospace" }}>{o.donor_count}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: A.sage, fontFamily: "'JetBrains Mono',monospace" }}>{fmtDate(o.created_at)}</td>
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

  const INP = { background: A.sidebar, border: `1px solid ${A.border}`, borderRadius: 6, padding: "7px 11px", color: A.cream, fontSize: 12, outline: "none", fontFamily: "'DM Sans',sans-serif", transition: "border-color 0.1s ease" };
  const SH  = { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: A.muted, marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${A.border}` };
  const BTN = { background: "transparent", border: `1px solid ${A.border}`, borderRadius: 6, padding: "7px 12px", color: A.sage, fontSize: 11, fontWeight: 500, cursor: "pointer", transition: "all 0.1s ease" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ width: 480, background: A.sidebar, borderLeft: `1px solid ${A.border}`, display: "flex", flexDirection: "column", overflowY: "auto", transition: "transform 0.2s ease" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${A.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: A.cream, marginBottom: 8 }}>{org.name}</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <PlanBadge plan={org.plan} />
              <StatusBadge status={org.subscription_status} />
            </div>
            <div style={{ fontSize: 11, color: A.muted }}>Created {fmtDate(org.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: A.muted, fontSize: 16, cursor: "pointer", padding: 4, lineHeight: 1, transition: "color 0.1s ease" }}
            onMouseEnter={e => e.currentTarget.style.color = A.sage} onMouseLeave={e => e.currentTarget.style.color = A.muted}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[["Donors", org.donor_count], ["Grants", org.grant_count], ["Users", org.user_count],
              ["Sequences", detail?.sequence_count ?? "—"], ["Enrollments", detail?.enrollment_count ?? "—"], ["MRR", fmt$(org.monthly_revenue)]].map(([k, v]) => (
              <div key={k} style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: A.muted, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: A.cream, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Users */}
          {detail?.users?.length > 0 && (
            <div>
              <div style={SH}>Users</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {detail.users.map(u => (
                  <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: A.surface, border: `1px solid ${A.border}`, borderRadius: 6, padding: "9px 12px" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: A.cream }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: A.sage }}>{u.email}</div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: u.role === "admin" ? A.gold : A.sage, background: u.role === "admin" ? "#1a150a" : A.sidebar, border: `1px solid ${u.role === "admin" ? "#3d2a00" : A.border}`, borderRadius: 3, padding: "2px 7px" }}>{u.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {detail?.recent_activity?.length > 0 && (
            <div>
              <div style={SH}>Recent Activity</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {detail.recent_activity.slice(0, 6).map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: A.sage, padding: "8px 12px", background: A.surface, borderRadius: 6, borderLeft: `2px solid ${A.greenDk}` }}>
                    <span style={{ color: A.cream, fontWeight: 600 }}>{a.donor_name}</span> · {a.type} · {daysAgo(a.created_at)}
                    {a.note && <div style={{ marginTop: 2, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={SH}>Actions</div>

            {/* Extend trial */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" value={extDays} onChange={e => setExtDays(e.target.value)} min={1} max={365} style={{ ...INP, width: 64 }} />
              <span style={{ fontSize: 11, color: A.sage }}>days</span>
              <button onClick={extendTrial} disabled={working} style={{ flex: 1, background: "transparent", border: `1px solid ${A.border}`, borderRadius: 6, padding: "7px 14px", color: A.sage, fontSize: 11, fontWeight: 500, cursor: "pointer", transition: "all 0.1s ease" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.color = A.green; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.sage; }}>
                Extend Trial
              </button>
            </div>

            {/* Change plan */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={newPlan} onChange={e => setNewPlan(e.target.value)} style={{ ...INP, flex: 1, appearance: "none" }}>
                {["trial", "seed", "growth", "impact"].map(p => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
              </select>
              <button onClick={changePlan} disabled={working} style={{ ...BTN }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.color = A.green; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.sage; }}>
                Change Plan
              </button>
            </div>

            {/* Stripe + org ID */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => navigator.clipboard.writeText(org.id)} style={{ ...BTN, flex: 1 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = A.borderHover; e.currentTarget.style.color = A.cream; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.sage; }}>
                Copy Org ID
              </button>
              {org.stripe_customer_id && (
                <a href={`https://dashboard.stripe.com/customers/${org.stripe_customer_id}`} target="_blank" rel="noreferrer"
                  style={{ ...BTN, flex: 1, textDecoration: "none", textAlign: "center" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = A.borderHover; e.currentTarget.style.color = A.cream; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.sage; }}>
                  View in Stripe ↗
                </a>
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div style={{ border: `1px solid #3d1515`, borderRadius: 8, padding: "14px 18px", background: "#1a0a0a" }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: A.red, marginBottom: 12 }}>Danger Zone</div>
            {!showDelete ? (
              <button onClick={() => setShowDelete(true)} style={{ background: "transparent", border: `1px solid #3d1515`, borderRadius: 6, padding: "7px 14px", color: A.red, fontSize: 11, fontWeight: 500, cursor: "pointer", transition: "all 0.1s ease" }}>Delete org permanently</button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: A.sage }}>Type <strong style={{ color: A.cream }}>{org.name}</strong> to confirm:</div>
                <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder={org.name} style={{ ...INP, width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={deleteOrg} disabled={working} style={{ flex: 1, background: A.red, border: "none", borderRadius: 6, padding: "8px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete everything</button>
                  <button onClick={() => { setShowDelete(false); setDeleteInput(""); }} style={{ ...BTN }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = A.borderHover; e.currentTarget.style.color = A.cream; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.sage; }}>
                    Cancel
                  </button>
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

  const INP = { background: A.sidebar, border: `1px solid ${A.border}`, borderRadius: 6, padding: "7px 11px", color: A.cream, fontSize: 12, outline: "none", fontFamily: "'DM Sans',sans-serif", transition: "border-color 0.1s ease" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
        <button onClick={onRefresh} style={{ background: "transparent", border: `1px solid ${A.border}`, borderRadius: 6, padding: "7px 12px", color: A.sage, fontSize: 11, cursor: "pointer", transition: "all 0.1s ease" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = A.borderHover; e.currentTarget.style.color = A.cream; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.sage; }}>↻ Refresh</button>
      </div>

      {/* Table */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.sidebar }}>
              {["Org", "Plan", "Status", "Donors", "Grants", "Users", "Last active", "MRR", "Actions"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 16px", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: A.sage, fontSize: 12 }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: A.sage, fontSize: 12 }}>No orgs found</td></tr>}
            {filtered.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${A.border}`, transition: "background 0.1s ease" }}
                onMouseEnter={e => e.currentTarget.style.background = A.sidebar}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: A.cream }}>{o.name}</div>
                  <div style={{ fontSize: 10, color: A.muted, marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>{o.id}</div>
                </td>
                <td style={{ padding: "12px 16px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "12px 16px" }}><StatusBadge status={o.subscription_status} /></td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: A.sage, fontFamily: "'JetBrains Mono',monospace" }}>{o.donor_count}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: A.sage, fontFamily: "'JetBrains Mono',monospace" }}>{o.grant_count}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: A.sage, fontFamily: "'JetBrains Mono',monospace" }}>{o.user_count}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: A.sage }}>{daysAgo(o.last_active)}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: o.monthly_revenue > 0 ? A.green : A.muted, fontFamily: "'JetBrains Mono',monospace" }}>{fmt$(o.monthly_revenue)}</td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <button onClick={() => setSelectedOrg(o)} style={{ background: "transparent", border: `1px solid ${A.border}`, borderRadius: 5, padding: "4px 9px", color: A.green, fontSize: 10, fontWeight: 700, cursor: "pointer", transition: "all 0.1s ease" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.background = "#0a1a0f"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.background = "transparent"; }}>
                      View →
                    </button>
                    {extendOrgId === o.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="number" value={extDays} onChange={e => setExtDays(e.target.value)} style={{ ...INP, width: 48, padding: "3px 7px", fontSize: 11 }} />
                        <button onClick={() => quickExtend(o.id)} style={{ background: "transparent", border: `1px solid #3d3000`, borderRadius: 5, padding: "4px 7px", color: A.amber, fontSize: 10, cursor: "pointer" }}>+days</button>
                        <button onClick={() => setExtendOrgId(null)} style={{ background: "none", border: "none", color: A.muted, fontSize: 12, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setExtendOrgId(o.id)} style={{ background: "transparent", border: `1px solid #3d3000`, borderRadius: 5, padding: "4px 9px", color: A.amber, fontSize: 10, cursor: "pointer", transition: "all 0.1s ease" }}>+Trial</button>
                    )}
                    {changePlanOrgId === o.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <select value={newPlan} onChange={e => setNewPlan(e.target.value)} style={{ ...INP, padding: "3px 7px", fontSize: 11 }}>
                          {["trial","seed","growth","impact"].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button onClick={() => quickChangePlan(o.id)} style={{ background: "transparent", border: `1px solid #1a2850`, borderRadius: 5, padding: "4px 7px", color: A.blue, fontSize: 10, cursor: "pointer" }}>Set</button>
                        <button onClick={() => setChangePlanOrgId(null)} style={{ background: "none", border: "none", color: A.muted, fontSize: 12, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setChangePlanOrgId(o.id); setNewPlan(o.plan || "trial"); }} style={{ background: "transparent", border: `1px solid #1a2850`, borderRadius: 5, padding: "4px 9px", color: A.blue, fontSize: 10, cursor: "pointer", transition: "all 0.1s ease" }}>Plan</button>
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

  const SH = { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: A.muted, marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${A.border}` };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* MRR by month */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
          <div style={SH}>MRR by Cohort Month</div>
          {months.length === 0 ? (
            <div style={{ fontSize: 12, color: A.sage }}>No active subscriptions yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {months.map(m => (
                <div key={m}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: A.sage }}>{m}</span>
                    <span style={{ fontSize: 12, color: A.green, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{fmt$(monthCounts[m])}</span>
                  </div>
                  <div style={{ height: 4, background: A.border, borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${(monthCounts[m] / maxMRR) * 100}%`, background: A.green, borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plan distribution */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
          <div style={SH}>Plan Distribution</div>
          {["trial", "seed", "growth", "impact"].map(p => {
            const count = metrics.plan_breakdown?.[p] ?? orgs.filter(o => o.plan === p).length;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={p} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><PlanBadge plan={p} /><span style={{ fontSize: 11, color: A.sage }}>{count} orgs</span></div>
                  <span style={{ fontSize: 11, color: A.cream, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: A.border, borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: PLAN_COLOR[p], borderRadius: 2 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Funnel */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
        <div style={SH}>Trial Conversion Funnel</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {funnel.map((f, i) => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 8, flex: i === 0 ? 2 : 1 }}>
              <div style={{ flex: 1, background: i === 2 ? "#0a1a0f" : A.sidebar, border: `1px solid ${i === 2 ? A.green : A.border}`, borderRadius: 8, padding: "12px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: i === 2 ? A.green : A.cream, fontFamily: "'JetBrains Mono',monospace" }}>{f.count}</div>
                <div style={{ fontSize: 10, color: A.sage, marginTop: 4 }}>{f.label}</div>
                <div style={{ fontSize: 10, color: A.muted, marginTop: 2 }}>{f.pct}%</div>
              </div>
              {i < funnel.length - 1 && <div style={{ fontSize: 14, color: A.muted }}>→</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Top orgs by usage */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "16px 20px 0" }}><div style={SH}>Top Orgs by Usage</div></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.sidebar }}>
              {["Org", "Plan", "Donors", "Grants", "MRR"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 16px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topOrgs.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${A.border}`, transition: "background 0.1s ease" }}
                onMouseEnter={e => e.currentTarget.style.background = A.sidebar}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: A.cream }}>{o.name}</td>
                <td style={{ padding: "10px 16px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "10px 16px", fontSize: 12, color: A.sage, fontFamily: "'JetBrains Mono',monospace" }}>{o.donor_count}</td>
                <td style={{ padding: "10px 16px", fontSize: 12, color: A.sage, fontFamily: "'JetBrains Mono',monospace" }}>{o.grant_count}</td>
                <td style={{ padding: "10px 16px", fontSize: 12, fontWeight: 700, color: o.monthly_revenue > 0 ? A.green : A.muted, fontFamily: "'JetBrains Mono',monospace" }}>{fmt$(o.monthly_revenue)}</td>
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
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet"/>

      {/* Sidebar */}
      <div style={{ width: 200, flexShrink: 0, background: A.sidebar, borderRight: `1px solid ${A.border}`, display: "flex", flexDirection: "column", padding: "20px 0" }}>
        <div style={{ padding: "0 16px 20px", borderBottom: `1px solid ${A.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.2em", color: A.green, marginBottom: 8 }}>STEWARD</div>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "#ef4444", background: "#1a0a0a", border: "1px solid #3d1515", borderRadius: 3, padding: "2px 6px" }}>ADMIN</span>
        </div>

        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
              background: page === n.id ? "#1a2e1f" : "transparent",
              border: "none",
              borderLeft: page === n.id ? "3px solid #10b981" : "3px solid transparent",
              color: page === n.id ? A.cream : A.sage,
              fontSize: 12, fontWeight: 500, letterSpacing: "0.04em", cursor: "pointer", textAlign: "left",
              transition: "all 0.1s ease", marginBottom: 1, borderRadius: "0 6px 6px 0",
            }}
            onMouseEnter={e => { if (page !== n.id) e.currentTarget.style.background = A.surface; }}
            onMouseLeave={e => { if (page !== n.id) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 11, opacity: 0.6 }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "14px 16px", borderTop: `1px solid ${A.border}` }}>
          <div style={{ fontSize: 11, color: A.muted, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{storedUser.email}</div>
          <button onClick={logout} style={{ background: "none", border: "none", color: A.red, fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 500 }}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ background: A.bg, borderBottom: `1px solid ${A.border}`, padding: "0 28px", height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: A.cream, letterSpacing: "0.02em" }}>
            {NAV.find(n => n.id === page)?.label}
          </span>
          <div style={{ fontSize: 11, color: A.muted, fontFamily: "'JetBrains Mono',monospace" }}>{loadingOrgs ? "…" : `${orgs?.length || 0} orgs`}</div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {page === "overview"  && <Overview metrics={metrics} orgs={orgs} />}
          {page === "orgs"      && <Organizations orgs={orgs} loading={loadingOrgs} onRefresh={load} />}
          {page === "metrics"   && <Metrics metrics={metrics} orgs={orgs} />}
        </div>
      </div>
    </div>
  );
}
