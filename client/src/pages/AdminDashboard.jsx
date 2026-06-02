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
  bg:         "#f7f7f5",
  sidebar:    "#ffffff",
  surface:    "#f7f7f5",
  card:       "#ffffff",
  border:     "#e5e5e2",
  borderSub:  "#f0f0ee",
  green:      "#0d5c3a",
  greenLight: "#10b981",
  greenPale:  "#f0faf5",
  greenChip:  "#d1fae5",
  ink:        "#1a1a1a",
  secondary:  "#6b6b6b",
  muted:      "#a0a0a0",
  red:        "#dc2626",
  amber:      "#d97706",
  blue:       "#1e40af",
  purple:     "#6b21a8",
};

const PLAN_MRR   = { trial: 0, seed: 99, growth: 249, impact: 499 };
const PLAN_COLOR = { trial: "#d97706", seed: "#3b82f6", growth: "#10b981", impact: "#8b5cf6" };
const PLAN_LABEL = { trial: "Trial", seed: "Seed", growth: "Growth", impact: "Impact" };
const PLAN_BADGE = {
  trial:  { bg: "#fef3c7", color: "#92400e" },
  seed:   { bg: "#eff6ff", color: "#1e40af" },
  growth: { bg: "#d1fae5", color: "#065f46" },
  impact: { bg: "#faf5ff", color: "#6b21a8" },
};
const STATUS_BADGE = {
  active:    { bg: "#d1fae5", color: "#065f46", label: "Active" },
  trialing:  { bg: "#fef3c7", color: "#92400e", label: "Trialing" },
  cancelled: { bg: "#fee2e2", color: "#991b1b", label: "Churned" },
  past_due:  { bg: "#fee2e2", color: "#991b1b", label: "Past Due" },
};

const SCROLLBAR_CSS = `
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #d4cfc6; border-radius: 99px; }
  :focus-visible { outline: 2px solid #10b981; outline-offset: 2px; }
`;

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
  const b = PLAN_BADGE[plan] || { bg: A.surface, color: A.secondary };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: b.color, background: b.bg, borderRadius: 99, padding: "3px 8px", whiteSpace: "nowrap" }}>
      {PLAN_LABEL[plan] || plan}
    </span>
  );
}

function StatusBadge({ status }) {
  const b = STATUS_BADGE[status] || { bg: A.surface, color: A.muted, label: status };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: b.color, background: b.bg, borderRadius: 99, padding: "3px 8px", whiteSpace: "nowrap" }}>
      {b.label}
    </span>
  );
}

function MetricCard({ label, value, sub, valueColor, accentColor }) {
  return (
    <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "20px 24px", borderBottom: `3px solid ${accentColor || A.border}`, transition: "box-shadow 0.15s ease" }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: A.muted, marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", color: valueColor || A.ink, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: A.secondary, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

// ── Section header style ───────────────────────────────────────────────────
const SH = {
  fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
  color: A.muted, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${A.borderSub}`,
};

// ── Overview page ──────────────────────────────────────────────────────────
function Overview({ metrics, orgs }) {
  if (!metrics) return <div style={{ color: A.muted, padding: 40, fontSize: 13 }}>Loading metrics…</div>;

  const recentOrgs = [...(orgs || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const planGroups = ["seed", "growth", "impact"].map(p => ({
    plan: p,
    count: (orgs || []).filter(o => o.plan === p && o.subscription_status === "active").length,
    revenue: (orgs || []).filter(o => o.plan === p && o.subscription_status === "active").reduce((s) => s + PLAN_MRR[p], 0),
  }));
  const maxRev = Math.max(...planGroups.map(g => g.revenue), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
        <MetricCard label="MRR"         value={fmt$(metrics.mrr)}               valueColor={A.green}  accentColor={A.green} />
        <MetricCard label="ARR"         value={fmt$(metrics.arr)}               valueColor={A.green}  accentColor={A.green} />
        <MetricCard label="Active Orgs" value={metrics.active_subscriptions}                          accentColor={A.border} />
        <MetricCard label="Trialing"    value={metrics.trialing}                valueColor={A.amber}  accentColor={A.amber}
          sub={`${metrics.avg_trial_days_remaining}d avg remaining`} />
        <MetricCard label="Churned"     value={metrics.churned}                 valueColor={metrics.churned > 0 ? A.red : A.muted} accentColor={metrics.churned > 0 ? A.red : A.border} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* MRR by Plan */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }}>
          <div style={SH}>MRR by Plan</div>
          {planGroups.map(g => (
            <div key={g.plan} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PlanBadge plan={g.plan} />
                  <span style={{ fontSize: 12, color: A.secondary }}>{g.count} org{g.count !== 1 ? "s" : ""}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: A.ink, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmt$(g.revenue)}</span>
              </div>
              <div style={{ height: 6, background: "#f0f0ee", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(g.revenue / maxRev) * 100}%`, background: PLAN_COLOR[g.plan], borderRadius: 99, transition: "width 0.5s ease" }} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${A.borderSub}`, marginTop: 4, paddingTop: 16, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: A.green, fontFamily: "'DM Serif Display',Georgia,serif" }}>
              {metrics.trial_conversion_rate}%
            </div>
            <div style={{ fontSize: 11, color: A.muted, marginTop: 4, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Trial conversion rate</div>
          </div>
        </div>

        {/* New Signups */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }}>
          <div style={SH}>New Signups</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 24 }}>
            <div style={{ paddingRight: 20, borderRight: `1px solid ${A.borderSub}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: A.muted, marginBottom: 6 }}>This month</div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", color: A.green, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1 }}>{metrics.new_orgs_this_month}</div>
            </div>
            <div style={{ paddingLeft: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: A.muted, marginBottom: 6 }}>Last month</div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", color: A.ink, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1 }}>{metrics.new_orgs_last_month}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[["Total orgs", metrics.total_orgs], ["Total donors", metrics.total_donors?.toLocaleString()], ["Total grants", metrics.total_grants?.toLocaleString()], ["Total interactions", metrics.total_interactions?.toLocaleString()]].map(([k, v]) => (
              <div key={k} style={{ background: A.surface, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: A.ink, fontFamily: "'JetBrains Mono','SF Mono',monospace", marginBottom: 2 }}>{v}</div>
                <div style={{ fontSize: 11, color: A.muted, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{k}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent signups */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 0" }}><div style={SH}>Recent Signups</div></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.surface }}>
              {["Org", "Plan", "Status", "Donors", "Created"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 20px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentOrgs.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${A.borderSub}`, transition: "background 0.15s ease" }}
                onMouseEnter={e => e.currentTarget.style.background = "#fafaf8"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "14px 20px", fontSize: 13, color: A.ink, fontWeight: 600 }}>{o.name}</td>
                <td style={{ padding: "14px 20px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "14px 20px" }}><StatusBadge status={o.subscription_status} /></td>
                <td style={{ padding: "14px 20px", fontSize: 13, color: A.secondary, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.donor_count}</td>
                <td style={{ padding: "14px 20px", fontSize: 12, color: A.muted, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmtDate(o.created_at)}</td>
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

  const INP = {
    background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8,
    padding: "8px 12px", color: A.ink, fontSize: 13, outline: "none",
    fontFamily: "'DM Sans',system-ui,sans-serif", transition: "border-color 0.15s ease",
  };
  const PSH = { fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: A.muted, marginBottom: 12, paddingTop: 16, paddingBottom: 10, borderTop: `1px solid ${A.borderSub}` };
  const PBTN = {
    background: "transparent", border: `1px solid ${A.border}`, borderRadius: 6,
    padding: "7px 14px", color: A.secondary, fontSize: 12, fontWeight: 500,
    cursor: "pointer", transition: "all 0.15s ease",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.3)" }} />
      <div style={{ width: 480, background: A.card, borderLeft: `1px solid ${A.border}`, display: "flex", flexDirection: "column", overflowY: "auto", transition: "transform 0.2s ease" }}>
        {/* Header */}
        <div style={{ padding: "24px 28px", borderBottom: `1px solid ${A.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: A.ink, marginBottom: 10 }}>{org.name}</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <PlanBadge plan={org.plan} />
              <StatusBadge status={org.subscription_status} />
            </div>
            <div style={{ fontSize: 12, color: A.muted }}>Created {fmtDate(org.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: A.muted, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1, transition: "color 0.15s ease" }}
            onMouseEnter={e => e.currentTarget.style.color = A.ink}
            onMouseLeave={e => e.currentTarget.style.color = A.muted}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Metrics chips */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
            {[["Donors", org.donor_count], ["Grants", org.grant_count], ["Users", org.user_count],
              ["Sequences", detail?.sequence_count ?? "—"], ["Enrollments", detail?.enrollment_count ?? "—"], ["MRR", fmt$(org.monthly_revenue)]].map(([k, v]) => (
              <div key={k} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: A.muted, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: A.green, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Users */}
          {detail?.users?.length > 0 && (
            <div>
              <div style={PSH}>Users</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {detail.users.map(u => (
                  <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: A.ink }}>{u.name}</div>
                      <div style={{ fontSize: 12, color: A.secondary }}>{u.email}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", borderRadius: 99, padding: "3px 8px",
                      color: u.role === "admin" ? "#92400e" : A.secondary,
                      background: u.role === "admin" ? "#fef3c7" : A.surface,
                    }}>{u.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {detail?.recent_activity?.length > 0 && (
            <div>
              <div style={PSH}>Recent Activity</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {detail.recent_activity.slice(0, 6).map((a, i) => (
                  <div key={i} style={{ fontSize: 13, color: A.secondary, padding: "10px 14px", background: A.surface, borderRadius: 8, borderLeft: `3px solid ${A.greenLight}` }}>
                    <span style={{ color: A.ink, fontWeight: 600 }}>{a.donor_name}</span> · {a.type} · {daysAgo(a.created_at)}
                    {a.note && <div style={{ marginTop: 3, fontSize: 12, color: A.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div>
            <div style={PSH}>Actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" value={extDays} onChange={e => setExtDays(e.target.value)} min={1} max={365} style={{ ...INP, width: 70 }} />
                <span style={{ fontSize: 13, color: A.secondary }}>days</span>
                <button onClick={extendTrial} disabled={working} style={{ ...PBTN, flex: 1 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.color = A.green; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.secondary; }}>
                  Extend Trial
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={newPlan} onChange={e => setNewPlan(e.target.value)} style={{ ...INP, flex: 1, appearance: "none" }}>
                  {["trial", "seed", "growth", "impact"].map(p => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
                </select>
                <button onClick={changePlan} disabled={working} style={{ ...PBTN }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.color = A.green; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.secondary; }}>
                  Change Plan
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => navigator.clipboard.writeText(org.id)} style={{ ...PBTN, flex: 1 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.color = A.green; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.secondary; }}>
                  Copy Org ID
                </button>
                {org.stripe_customer_id && (
                  <a href={`https://dashboard.stripe.com/customers/${org.stripe_customer_id}`} target="_blank" rel="noreferrer"
                    style={{ ...PBTN, flex: 1, textDecoration: "none", textAlign: "center" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.color = A.green; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.secondary; }}>
                    View in Stripe ↗
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Danger zone */}
          <div style={{ marginTop: 8, border: `1px solid #fecaca`, borderRadius: 10, padding: "16px 20px", background: "#fff5f5" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: A.red, marginBottom: 12 }}>Danger Zone</div>
            {!showDelete ? (
              <button onClick={() => setShowDelete(true)} style={{ background: "transparent", border: `1px solid #fecaca`, borderRadius: 6, padding: "7px 14px", color: A.red, fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.15s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                Delete org permanently
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 13, color: A.secondary }}>Type <strong style={{ color: A.ink }}>{org.name}</strong> to confirm:</div>
                <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder={org.name} style={{ ...INP, width: "100%" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={deleteOrg} disabled={working} style={{ flex: 1, background: A.red, border: "none", borderRadius: 6, padding: "9px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Delete everything</button>
                  <button onClick={() => { setShowDelete(false); setDeleteInput(""); }} style={{ ...PBTN }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = A.ink; e.currentTarget.style.color = A.ink; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.secondary; }}>
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

  const INP = {
    background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8,
    padding: "8px 12px", color: A.ink, fontSize: 13, outline: "none",
    fontFamily: "'DM Sans',system-ui,sans-serif", transition: "border-color 0.15s ease",
  };
  const ABTN = {
    fontSize: 12, color: A.secondary, border: `1px solid ${A.border}`,
    borderRadius: 6, padding: "4px 10px", background: "transparent",
    cursor: "pointer", transition: "all 0.15s ease",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
        <button onClick={onRefresh} style={{ ...ABTN, padding: "8px 14px" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.color = A.green; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = A.border; e.currentTarget.style.color = A.secondary; }}>
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.surface }}>
              {["Org", "Plan", "Status", "Donors", "Grants", "Users", "Last active", "MRR", "Actions"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 16px", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 28, textAlign: "center", color: A.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 28, textAlign: "center", color: A.muted, fontSize: 13 }}>No orgs found</td></tr>}
            {filtered.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${A.borderSub}`, transition: "background 0.15s ease" }}
                onMouseEnter={e => e.currentTarget.style.background = "#fafaf8"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: A.ink }}>{o.name}</div>
                  <div style={{ fontSize: 10, color: A.muted, marginTop: 2, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.id}</div>
                </td>
                <td style={{ padding: "12px 16px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "12px 16px" }}><StatusBadge status={o.subscription_status} /></td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: A.secondary, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.donor_count}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: A.secondary, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.grant_count}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: A.secondary, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.user_count}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: A.secondary }}>{daysAgo(o.last_active)}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: o.monthly_revenue > 0 ? A.green : A.muted, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmt$(o.monthly_revenue)}</td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <button onClick={() => setSelectedOrg(o)} style={{ ...ABTN, color: A.green, borderColor: A.greenChip }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.background = A.greenPale; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = A.greenChip; e.currentTarget.style.background = "transparent"; }}>
                      View →
                    </button>
                    {extendOrgId === o.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="number" value={extDays} onChange={e => setExtDays(e.target.value)} style={{ ...INP, width: 52, padding: "4px 8px", fontSize: 12 }} />
                        <button onClick={() => quickExtend(o.id)} style={{ ...ABTN, fontSize: 11, color: A.amber, borderColor: "#fde68a" }}>+days</button>
                        <button onClick={() => setExtendOrgId(null)} style={{ background: "none", border: "none", color: A.muted, fontSize: 14, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setExtendOrgId(o.id)} style={{ ...ABTN, fontSize: 11, color: A.amber, borderColor: "#fde68a" }}>+Trial</button>
                    )}
                    {changePlanOrgId === o.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <select value={newPlan} onChange={e => setNewPlan(e.target.value)} style={{ ...INP, padding: "4px 8px", fontSize: 12 }}>
                          {["trial","seed","growth","impact"].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button onClick={() => quickChangePlan(o.id)} style={{ ...ABTN, fontSize: 11, color: A.blue, borderColor: "#bfdbfe" }}>Set</button>
                        <button onClick={() => setChangePlanOrgId(null)} style={{ background: "none", border: "none", color: A.muted, fontSize: 14, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setChangePlanOrgId(o.id); setNewPlan(o.plan || "trial"); }} style={{ ...ABTN, fontSize: 11, color: A.blue, borderColor: "#bfdbfe" }}>Plan</button>
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
  if (!metrics || !orgs) return <div style={{ color: A.muted, padding: 40, fontSize: 13 }}>Loading…</div>;

  const monthCounts = {};
  orgs.filter(o => o.subscription_status === "active").forEach(o => {
    const m = o.created_at?.slice(0, 7);
    if (m) monthCounts[m] = (monthCounts[m] || 0) + (PLAN_MRR[o.plan] || 0);
  });
  const months = Object.keys(monthCounts).sort().slice(-8);
  const maxMRR = Math.max(...months.map(m => monthCounts[m]), 1);

  const total = metrics.total_orgs;
  const funnel = [
    { label: "Signed up", count: total, pct: 100, borderColor: A.secondary },
    { label: "Still trialing", count: metrics.trialing, pct: total ? Math.round((metrics.trialing / total) * 100) : 0, borderColor: A.amber },
    { label: "Converted", count: metrics.active_subscriptions, pct: total ? Math.round((metrics.active_subscriptions / total) * 100) : 0, borderColor: A.green },
    { label: "Churned", count: metrics.churned, pct: total ? Math.round((metrics.churned / total) * 100) : 0, borderColor: A.red },
  ];

  const topOrgs = [...orgs].sort((a, b) => (b.donor_count + b.grant_count) - (a.donor_count + a.grant_count)).slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* MRR by month */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }}>
          <div style={SH}>MRR by Cohort Month</div>
          {months.length === 0 ? (
            <div style={{ fontSize: 13, color: A.muted }}>No active subscriptions yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {months.map(m => (
                <div key={m}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: A.secondary }}>{m}</span>
                    <span style={{ fontSize: 13, color: A.green, fontWeight: 700, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmt$(monthCounts[m])}</span>
                  </div>
                  <div style={{ height: 6, background: "#f0f0ee", borderRadius: 99 }}>
                    <div style={{ height: "100%", width: `${(monthCounts[m] / maxMRR) * 100}%`, background: A.greenLight, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plan distribution */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }}>
          <div style={SH}>Plan Distribution</div>
          {["trial", "seed", "growth", "impact"].map(p => {
            const count = metrics.plan_breakdown?.[p] ?? orgs.filter(o => o.plan === p).length;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={p} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><PlanBadge plan={p} /><span style={{ fontSize: 12, color: A.secondary }}>{count} orgs</span></div>
                  <span style={{ fontSize: 12, color: A.ink, fontWeight: 600, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{pct}%</span>
                </div>
                <div style={{ height: 6, background: "#f0f0ee", borderRadius: 99 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: PLAN_COLOR[p], borderRadius: 99 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Funnel */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }}>
        <div style={SH}>Trial Conversion Funnel</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {funnel.map((f, i) => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 8, flex: i === 0 ? 2 : 1 }}>
              <div style={{ flex: 1, background: A.card, border: `1px solid ${A.border}`, borderLeft: `4px solid ${f.borderColor}`, borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: A.ink, fontFamily: "'DM Serif Display',Georgia,serif" }}>{f.count}</div>
                <div style={{ fontSize: 12, color: A.secondary, marginTop: 4 }}>{f.label}</div>
                <div style={{ fontSize: 11, color: A.muted, marginTop: 2 }}>{f.pct}%</div>
              </div>
              {i < funnel.length - 1 && <div style={{ fontSize: 14, color: A.muted }}>→</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Top orgs by usage */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 0" }}><div style={SH}>Top Orgs by Usage</div></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.surface }}>
              {["Org", "Plan", "Donors", "Grants", "MRR"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 20px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topOrgs.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${A.borderSub}`, transition: "background 0.15s ease" }}
                onMouseEnter={e => e.currentTarget.style.background = "#fafaf8"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "12px 20px", fontSize: 13, fontWeight: 600, color: A.ink }}>{o.name}</td>
                <td style={{ padding: "12px 20px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "12px 20px", fontSize: 13, color: A.secondary, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.donor_count}</td>
                <td style={{ padding: "12px 20px", fontSize: 13, color: A.secondary, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.grant_count}</td>
                <td style={{ padding: "12px 20px", fontSize: 13, fontWeight: 700, color: o.monthly_revenue > 0 ? A.green : A.muted, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmt$(o.monthly_revenue)}</td>
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
    { id: "overview", label: "Overview",       icon: "📊" },
    { id: "orgs",     label: "Organizations",  icon: "🏢" },
    { id: "metrics",  label: "Metrics",        icon: "📈" },
  ];

  const currentPage = NAV.find(n => n.id === page)?.label || "";

  return (
    <div style={{ display: "flex", height: "100vh", background: A.bg, fontFamily: "'DM Sans',system-ui,sans-serif", overflow: "hidden" }}>
      <style>{SCROLLBAR_CSS}</style>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet"/>

      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, background: A.sidebar, borderRight: `1px solid ${A.border}`, display: "flex", flexDirection: "column" }}>
        {/* Logo area */}
        <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${A.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 28, height: 28, background: A.green, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "-0.02em" }}>S</span>
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: A.ink, letterSpacing: "-0.01em" }}>Steward</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: A.muted }}>Admin Console</div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, paddingTop: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: A.muted, padding: "16px 16px 6px" }}>Navigation</div>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)} style={{
              width: "calc(100% - 16px)", margin: "1px 8px", display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left",
              background: page === n.id ? A.greenPale : "transparent",
              color: page === n.id ? A.green : A.secondary,
              fontSize: 13, fontWeight: page === n.id ? 600 : 500,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => { if (page !== n.id) e.currentTarget.style.background = A.bg; }}
            onMouseLeave={e => { if (page !== n.id) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 14 }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </div>

        {/* Bottom */}
        <div style={{ padding: "14px 16px", borderTop: `1px solid ${A.border}` }}>
          <div style={{ fontSize: 12, color: A.secondary, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{storedUser.email}</div>
          <button onClick={logout} style={{ background: "none", border: "none", color: A.red, fontSize: 12, cursor: "pointer", padding: 0, fontWeight: 500, transition: "opacity 0.15s ease" }}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ background: A.sidebar, borderBottom: `1px solid ${A.border}`, padding: "0 28px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span style={{ color: A.muted, fontSize: 12 }}>Admin Console</span>
            <span style={{ color: A.muted, fontSize: 12 }}>/</span>
            <span style={{ color: A.ink, fontWeight: 600 }}>{currentPage}</span>
          </div>
          <div style={{ background: A.greenPale, border: `1px solid ${A.greenChip}`, color: A.green, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6 }}>
            {loadingOrgs ? "…" : `${orgs?.length || 0} orgs`}
          </div>
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
