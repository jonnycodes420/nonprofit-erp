import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage, rethrowProgrammerError } from "../lib/domainError";

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
    catch (e) { alert(errorMessage(e)); }
    setWorking(false);
  }

  async function changePlan() {
    setWorking(true);
    try { await adminFetch("/admin/orgs/" + org.id + "/change-plan", { method: "POST", body: JSON.stringify({ plan: newPlan }) }); onRefresh(); }
    catch (e) { alert(errorMessage(e)); }
    setWorking(false);
  }

  async function deleteOrg() {
    if (deleteInput !== org.name) { alert("Type the org name exactly to confirm."); return; }
    setWorking(true);
    try {
      await adminFetch("/admin/orgs/" + org.id, { method: "DELETE", body: JSON.stringify({ confirm: true }) });
      onClose(); onRefresh();
    } catch (e) { alert(errorMessage(e)); }
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
function Organizations({ orgs, loading, onRefresh, onCloseOrg }) {
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
    catch (e) { alert(errorMessage(e)); }
  }

  async function quickChangePlan(orgId) {
    try { await adminFetch("/admin/orgs/" + orgId + "/change-plan", { method: "POST", body: JSON.stringify({ plan: newPlan }) }); onRefresh(); setChangePlanOrgId(null); }
    catch (e) { alert(errorMessage(e)); }
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
                    {/* A close starts HERE, where she is already looking at the
                        org, instead of being retyped into a blank form that
                        then refuses the address because it already exists. */}
                    {onCloseOrg && !o.stripe_subscription_id && (
                      <button data-testid={`org-close-${o.id}`} onClick={() => onCloseOrg(o)}
                        title={`Put ${o.name} on a plan`}
                        style={{ ...ABTN, fontSize: 11, color: A.green, borderColor: A.greenChip }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = A.green; e.currentTarget.style.background = A.greenPale; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = A.greenChip; e.currentTarget.style.background = "transparent"; }}>
                        Close
                      </button>
                    )}
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
// BUILD-46 §3.2(4) — the human review queue. One screen: EIN match result,
// Stripe status, website, domain plausibility → approve / hold / reject.
// NOTHING auto-approves; the server refuses an approve whose gate (live EIN
// check + Stripe onboarding + dispute resolution) doesn't pass, even from here.
function NetworkReview() {
  const [status, setStatus] = useState("pending");
  const [apps, setApps] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { setApps(await adminFetch(`/admin/network/applications?status=${status}`)); }
    catch (e) { setErr(errorMessage(e, String(e))); }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (id, action) => {
    const reason = action === "approve" ? (window.prompt("Reason (logged with the decision):") || "") : (window.prompt(`Reason to ${action}:`) || "");
    setBusyId(id); setErr("");
    try {
      await adminFetch(`/admin/network/applications/${id}/decide`, { method: "POST", body: JSON.stringify({ action, reason }) });
      await load();
    } catch (e) { setErr(errorMessage(e, String(e))); }
    setBusyId(null);
  };
  const chip = (on, label) => (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginRight: 6,
      background: on ? "rgba(52,168,83,0.15)" : "rgba(234,67,53,0.12)", color: on ? A.green : "#e07a5f" }}>{label}</span>
  );
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        {["pending", "dispute", "held", "approved", "delisted", "rejected"].map(st => (
          <button key={st} onClick={() => setStatus(st)}
            style={{ background: status === st ? A.green : "transparent", color: status === st ? "#fff" : A.muted,
              border: `1px solid ${status === st ? A.green : A.border}`, borderRadius: 20, padding: "5px 14px", marginRight: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {st}
          </button>
        ))}
      </div>
      {err && <div style={{ color: "#e07a5f", fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {!apps ? <div style={{ color: A.muted }}>Loading…</div> : apps.length === 0 ? <div style={{ color: A.muted }}>Nothing {status}.</div> :
        apps.map(a => {
          const einR = typeof a.ein_result === "string" ? JSON.parse(a.ein_result || "{}") : (a.ein_result || {});
          const dom = typeof a.domain_check === "string" ? JSON.parse(a.domain_check || "{}") : (a.domain_check || {});
          const decisions = typeof a.decisions === "string" ? JSON.parse(a.decisions || "[]") : (a.decisions || []);
          return (
            <div key={a.id} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: A.ink }}>{a.org_name} <span style={{ color: A.muted, fontWeight: 400, fontSize: 12 }}>({a.org_id})</span></div>
                <div style={{ color: A.muted, fontSize: 12 }}>{String(a.created_at).slice(0, 10)}</div>
              </div>
              <div style={{ margin: "8px 0", fontSize: 13, color: A.muted }}>
                EIN {a.ein} · {a.admin_email} · {a.website ? <a href={a.website} target="_blank" rel="noreferrer" style={{ color: A.green }}>{a.website}</a> : "no website"}
                {a.disputed_org_id && <span> · DISPUTES {a.disputed_org_id}</span>}
              </div>
              <div style={{ marginBottom: 10 }}>
                {chip(einR.found === true && (einR.status || "ok") === "ok", einR.found ? `IRS: ${einR.name || "found"}${einR.nameScore != null ? ` (${einR.nameScore}% name match)` : ""}` : "IRS: not found")}
                {chip(!!(a.stripe_connected && a.stripe_account_id), a.stripe_connected ? "Stripe onboarded" : "Stripe missing")}
                {chip(dom.plausible === true, dom.plausible ? `domain: ${dom.emailDomain}` : dom.freeMail ? `free mail: ${dom.emailDomain}` : `domain mismatch: ${dom.emailDomain || "?"}`)}
              </div>
              {["pending", "dispute", "held"].includes(a.status) && (
                <div>
                  <button disabled={busyId === a.id} onClick={() => decide(a.id, "approve")}
                    style={{ background: A.green, color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginRight: 8 }}>Approve</button>
                  <button disabled={busyId === a.id} onClick={() => decide(a.id, "hold")}
                    style={{ background: "transparent", color: A.muted, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 8 }}>Hold</button>
                  <button disabled={busyId === a.id} onClick={() => decide(a.id, "reject")}
                    style={{ background: "transparent", color: "#e07a5f", border: "1px solid #e07a5f", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Reject</button>
                </div>
              )}
              {decisions.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: A.muted }}>
                  {decisions.map((d, i) => <div key={i}>{String(d.at).slice(0, 16)} · {d.by} · {d.action}{d.reason ? ` — ${d.reason}` : ""}</div>)}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ── BUILD-92 B1 · THE CLOSE LINK SCREEN ────────────────────────────────────
// BUILD-90 shipped the two routes and no way to reach them. Jonathan closes in
// a room, on a laptop, with the executive director watching: this screen has to
// go from nothing to a link on her screen in under a minute, so it is one card
// with three fields and a button, and everything else on the page is history.
//
// THE PART THAT MATTERS MOST IS THE REFUSAL. A close link will not mint
// without a Stripe price that is BOTH configured and correct (BUILD-90 proved
// "configured" is not "correct": production carried live ids at retired
// amounts). GET /admin/close-links reports that per plan, so the screen says
// exactly what is missing BEFORE the button is pressed, naming the env var and
// both numbers. A blocked plan must never be a mystery in front of a customer.
function closeFetch(path, opts = {}) {
  const token = localStorage.getItem("npe_token");
  return fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, ...(opts.headers || {}) },
  }).then(async r => {
    const d = await r.json().catch(() => ({}));
    // The close-link routes answer with { error, message } and the MESSAGE is
    // the whole point — it names the env var and the amount Stripe holds.
    if (!r.ok) throw new Error(d.message || d.error || r.statusText);
    return d;
  });
}

const usdWhole = n => "$" + Number(n).toLocaleString("en-US");

// What is missing, in a sentence, for a plan the server says is not ready.
// Exported shape mirrors the `plans` rows of GET /admin/close-links.
export function planBlocker(p) {
  if (!p) return "That plan is not one this server knows about.";
  if (p.ready) return null;
  if (!p.configured) {
    return `No Stripe price is set for ${p.name} yet. Set ${p.env} on the server, then reload this page.`;
  }
  if (p.error === "price_unreadable") {
    return `Stripe could not read the price id in ${p.env}. Check that it exists in this Stripe account, then reload this page.`;
  }
  const amount = p.stripeAmountUsd != null ? "$" + Number(p.stripeAmountUsd).toFixed(2) : "an unreadable amount";
  const cadence = p.stripeInterval ? `every ${p.stripeInterval}` : "not recurring";
  return `${p.env} points at a Stripe price of ${amount}, ${cadence}, but ${p.name} is ${usdWhole(p.monthlyUsd)} a month. `
       + `Create the price at the right amount and update ${p.env} before closing anyone.`;
}

function CloseDeal({ target = null, onClearTarget = () => {} }) {
  const [data, setData] = useState(null);       // { plans, links }
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  // When a close was started from an org, the name and the address are FACTS,
  // not fields: the org is the one that was clicked, and the link goes to its
  // own admin. Typing either again is how somebody closes the wrong customer.
  const [targetAdmin, setTargetAdmin] = useState(null);   // { email } | null
  const [targetErr, setTargetErr] = useState("");
  const [planId, setPlanId] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setData(await closeFetch("/admin/close-links")); }
    catch (e) { setErr(errorMessage(e, String(e && e.message || e))); setData({ plans: [], links: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Who the link will actually reach. Read from the org rather than typed, and
  // a removed user is not an answer - requireAuth refuses them, so a link sent
  // there reaches nobody.
  useEffect(() => {
    let alive = true;
    if (!target) { setTargetAdmin(null); setTargetErr(""); return undefined; }
    setTargetAdmin(null); setTargetErr("");
    adminFetch("/admin/orgs/" + target.id)
      .then(d => {
        if (!alive) return;
        const admin = ((d && d.users) || []).find(u => u.role === "admin" && !u.deactivated_at);
        if (admin) setTargetAdmin(admin);
        else setTargetErr(`${target.name} has no active admin to send the link to. Invite one first.`);
      })
      .catch(e => { if (alive) setTargetErr(errorMessage(e, "Steward could not read that organization just now.")); });
    return () => { alive = false; };
  }, [target]);

  const plans = (data && data.plans) || [];
  // Preselect the first plan that can actually be sold, so the common case is
  // type, type, press.
  useEffect(() => {
    if (planId || !plans.length) return;
    setPlanId((plans.find(p => p.ready) || plans[0]).id);
  }, [plans, planId]);

  const plan = plans.find(p => p.id === planId) || null;
  const blocker = plans.length ? planBlocker(plan) : null;
  const canCreate = target
    ? !!(targetAdmin && plan && plan.ready && !creating)
    : !!(orgName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && plan && plan.ready && !creating);

  async function create() {
    setCreating(true); setErr(""); setCreated(null);
    try {
      // ONE ROUTE, TWO BODIES. `orgId` means attach to an org that already
      // exists; the other shape means mint a new one. The server decides which
      // it is - the screen does not carry a second close.
      const body = target
        ? { orgId: target.id, plan: planId }
        : { orgName: orgName.trim(), contactEmail: email.trim(), plan: planId };
      const r = await closeFetch("/admin/close-links", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCreated(r);
      await load();
    } catch (e) {
      // A catch that puts words on a screen routes the error FIRST: a
      // ReferenceError here is a bug in this component, not something true to
      // say to the person reading it (client/src/lib/domainError.js).
      rethrowProgrammerError(e);
      setErr(errorMessage(e, "Steward could not create that link just now."));
    }
    setCreating(false);
  }

  function copyLink() {
    const url = created && created.url;
    if (!url) return;
    const mark = () => { setCopied(true); setTimeout(() => setCopied(false), 2500); };
    // Select the field as well as writing the clipboard: in a room, on a
    // strange laptop, a denied clipboard permission must still leave the link
    // selected and ready for the keyboard.
    const field = document.getElementById("cl-link-field");
    if (field && field.select) { try { field.select(); } catch { /* not focusable */ } }
    try {
      const w = navigator.clipboard && navigator.clipboard.writeText(url);
      if (w && w.then) w.then(mark, mark); else mark();
    } catch { mark(); }
  }

  function reset() {
    setCreated(null); setOrgName(""); setEmail(""); setErr("");
  }

  const field = { width: "100%", font: "inherit", fontSize: 14, padding: "9px 11px", border: `1px solid ${A.border}`, borderRadius: 8, background: "#fff", color: A.ink };
  const label = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: A.muted, marginBottom: 6 };

  return (
    <div>
      <div style={{ ...SH }}>Close a deal</div>

      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "22px 24px", maxWidth: 720 }}>
        <div style={{ fontSize: 13, color: A.secondary, lineHeight: 1.6, marginBottom: 18, maxWidth: 560 }}>
          {target
            ? "This puts an organization that is already in Steward onto a plan. They put a card in, nothing is charged today, and the first charge is thirty days from the moment they sign."
            : "This creates the one link that opens an organization. She puts a card in, nothing is charged today, and the first charge is thirty days from the moment she signs."}
        </div>

        {target && (
          <div data-testid="cl-target" style={{ border: `1px solid ${A.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 16, background: A.surface }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: A.ink }}>{target.name}</div>
                <div style={{ fontSize: 12, color: A.secondary, marginTop: 3 }}>
                  {targetAdmin
                    ? <>The link goes to <span data-testid="cl-target-email" style={{ color: A.ink }}>{targetAdmin.email}</span></>
                    : targetErr ? <span style={{ color: A.red }}>{targetErr}</span> : "Reading this organization…"}
                </div>
              </div>
              <button type="button" data-testid="cl-target-clear" onClick={onClearTarget}
                style={{ fontSize: 12, color: A.secondary, background: "none", border: `1px solid ${A.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                Close a different one
              </button>
            </div>
          </div>
        )}

        {!created && (
          <>
            <div style={{ display: target ? "none" : "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                <label style={label} htmlFor="cl-orgname">Organization name</label>
                <input id="cl-orgname" data-testid="cl-orgname" style={field} value={orgName} autoComplete="off"
                  onChange={e => setOrgName(e.target.value)} placeholder="Sparrow House" />
              </div>
              <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                <label style={label} htmlFor="cl-email">Contact email</label>
                <input id="cl-email" data-testid="cl-email" style={field} value={email} type="email" autoComplete="off"
                  onChange={e => setEmail(e.target.value)} placeholder="director@sparrowhouse.org" />
              </div>
            </div>

            <div style={label}>Plan</div>
            <div data-testid="cl-plans" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              {plans.map(p => {
                const on = p.id === planId;
                return (
                  <button key={p.id} data-testid={`cl-plan-${p.id}`} type="button" aria-pressed={on}
                    onClick={() => { setPlanId(p.id); setErr(""); }}
                    style={{
                      font: "inherit", textAlign: "left", cursor: "pointer", borderRadius: 9, padding: "10px 16px",
                      border: `1px solid ${on ? A.green : A.border}`, background: on ? A.greenPale : "#fff",
                      color: on ? A.green : A.ink, minWidth: 128,
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: on ? A.green : A.secondary, marginTop: 2 }}>{usdWhole(p.monthlyUsd)} a month</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: p.ready ? A.secondary : A.red, fontWeight: 600 }}>
                      {p.ready ? "Ready to sell" : "Not ready"}
                    </div>
                  </button>
                );
              })}
              {data && plans.length === 0 && <div style={{ fontSize: 13, color: A.muted }}>Loading plans…</div>}
            </div>

            {blocker && (
              // NOT READY, AND EXACTLY WHAT IS MISSING. Never a bare "cannot
              // create": the person reading this is the one who can fix it.
              <div data-testid="cl-blocker" style={{ fontSize: 13, color: A.red, lineHeight: 1.55, background: A.card, border: `1px solid ${A.border}`, borderLeft: `3px solid ${A.red}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14, maxWidth: 560 }}>
                {blocker}
              </div>
            )}

            {err && <div data-testid="cl-error" style={{ fontSize: 13, color: A.red, lineHeight: 1.55, marginBottom: 12, maxWidth: 560 }}>{err}</div>}

            <button data-testid="cl-create" type="button" disabled={!canCreate} onClick={create}
              style={{
                font: "inherit", fontSize: 14, fontWeight: 700, padding: "10px 20px", borderRadius: 8, border: "none",
                background: A.green, color: "#fff", cursor: canCreate ? "pointer" : "default", opacity: canCreate ? 1 : 0.45,
              }}>
              {creating ? "Creating…" : "Create close link"}
            </button>
          </>
        )}

        {created && (
          <div data-testid="cl-created">
            <div style={{ fontSize: 15, fontWeight: 700, color: A.ink, marginBottom: 4 }}>
              {created.orgName} on {created.planName}
            </div>
            <div data-testid="cl-first-charge" style={{ fontSize: 13.5, color: A.ink, lineHeight: 1.6, marginBottom: 16 }}>
              {created.notice}
            </div>
            <label style={label} htmlFor="cl-link-field">Her link</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input id="cl-link-field" data-testid="cl-link" readOnly value={created.url}
                onFocus={e => e.target.select()}
                style={{ ...field, flex: "1 1 340px", minWidth: 260, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 }} />
              <button data-testid="cl-copy" type="button" onClick={copyLink}
                style={{ font: "inherit", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 8, border: "none", background: A.green, color: "#fff", cursor: "pointer" }}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: A.secondary, marginTop: 10, lineHeight: 1.6, maxWidth: 520 }}>
              Send it to {created.contactEmail}, or open it on her laptop. The organization is created when
              she finishes, and not before, so an unopened link leaves nothing behind.
            </div>
            <button data-testid="cl-another" type="button" onClick={reset}
              style={{ font: "inherit", fontSize: 13, marginTop: 16, padding: "8px 14px", borderRadius: 8, border: `1px solid ${A.border}`, background: "#fff", color: A.ink, cursor: "pointer" }}>
              Create another
            </button>
          </div>
        )}
      </div>

      {/* ── What has been handed out ─────────────────────────────────────── */}
      <div style={{ ...SH, marginTop: 32 }}>Links handed out</div>
      {!data ? <div style={{ color: A.muted, fontSize: 13 }}>Loading…</div> :
        (data.links || []).length === 0 ? <div style={{ color: A.muted, fontSize: 13 }}>No close link has been created yet.</div> : (
          <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: A.surface }}>
                  {["Organization", "Contact", "Plan", "Status", "Created", "Link"].map(h => (
                    <th key={h} style={{ textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: A.muted, padding: "10px 14px", borderBottom: `1px solid ${A.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.links || []).map(l => (
                  <tr key={l.id} data-testid="cl-row" style={{ borderBottom: `1px solid ${A.borderSub}` }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, color: A.ink }}>{l.orgName}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: A.secondary }}>{l.contactEmail}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: A.secondary, textTransform: "capitalize" }}>{l.plan}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: l.status === "completed" ? A.green : A.secondary }}>{l.status === "completed" ? "Signed" : "Waiting"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: A.secondary }}>{fmtDate(l.createdAt)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5 }}>
                      <a href={l.url} target="_blank" rel="noreferrer" style={{ color: A.green }}>open</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [page, setPage] = useState("overview");
  // The org a close was started FROM. Organizations hands it here and switches
  // page, so there is one close screen rather than a second one embedded in a
  // table row. Cleared whenever the close screen is left or reached from the rail.
  const [closeTarget, setCloseTarget] = useState(null);
  const [orgs, setOrgs] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loadingOrgs, setLoadingOrgs] = useState(true);

  const rawUser = localStorage.getItem("npe_user");
  const storedUser = rawUser ? JSON.parse(rawUser) : null;
  const isSuperAdmin = !!storedUser?.isSuperAdmin;

  // Hooks stay ABOVE the non-super-admin early return below and run
  // unconditionally (react-hooks/rules-of-hooks) — the "only fetch for a super
  // admin" condition lives INSIDE the effect, not around the hook.
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

  useEffect(() => { if (isSuperAdmin) load(); }, [load, isSuperAdmin]);

  if (!isSuperAdmin) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  function logout() {
    localStorage.removeItem("npe_token");
    localStorage.removeItem("npe_user");
    localStorage.removeItem("npe_org");
    navigate("/login");
  }

  const NAV = [
    { id: "overview", label: "Overview",       icon: "◈" },
    // BUILD-92 B1 — second in the list, because closing is the thing this
    // console exists to do on a Monday morning.
    { id: "close",    label: "Close a deal",   icon: "◇" },
    { id: "orgs",     label: "Organizations",  icon: "◉" },
    { id: "metrics",  label: "Metrics",        icon: "▤" },
    { id: "network",  label: "Network Review", icon: "◫" },
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
            <button key={n.id} onClick={() => { setCloseTarget(null); setPage(n.id); }} style={{
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
          {page === "close"     && <CloseDeal target={closeTarget} onClearTarget={() => setCloseTarget(null)} />}
          {page === "orgs"      && <Organizations orgs={orgs} loading={loadingOrgs} onRefresh={load}
                                     onCloseOrg={o => { setCloseTarget(o); setPage("close"); }} />}
          {page === "metrics"   && <Metrics metrics={metrics} orgs={orgs} />}
          {page === "network"   && <NetworkReview />}
        </div>
      </div>
    </div>
  );
}
