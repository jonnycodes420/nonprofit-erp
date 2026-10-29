import { useState, useEffect, useCallback } from "react";
import { GoingOut } from "../components/MailTypes";   // SEND-GATE-2: read-only, for any org
import { useNavigate } from "react-router-dom";
import { rowOpenProps } from "../lib/rowOpen";
import { errorMessage, rethrowProgrammerError } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";
import { planDisplayName, planDisplayBand } from "../lib/planNames";
import { CHANGELOG as CHANGELOG_ADMIN } from "../lib/changelog";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

// ── FIX-4 5 · AN ADMIN ERROR IS A SENTENCE ────────────────────────────────
// This threw `d.error`, which is the machine CODE — so every refusal on this
// screen arrived as `no_subscription`, `internal_price_wrong`,
// `plan_mode_mismatch`. The server has written the sentence for every one of
// them, in `d.message`, and it was being discarded one line before it reached
// a person. Message first, code only as the fallback nobody should see, and
// a code that does slip through is spaced out rather than left in snake_case.
function sentenceFor(d, statusText) {
  if (d && typeof d.message === "string" && d.message.trim()) return d.message.trim();
  const code = d && typeof d.error === "string" ? d.error.trim() : "";
  if (code && /^[a-z0-9_]+$/.test(code)) {
    const words = code.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1) + ".";
  }
  if (code) return code;
  return statusText ? `Steward could not do that: ${statusText}.` : "Steward could not do that.";
}

// FIX-4 5 — WHERE THE $1 TEST IS OFFERED. One predicate, so the button and
// the server's own refusal cannot disagree about which orgs it applies to:
// the route needs `stripe_subscription_id` to be set, and the demo org is
// never a customer. Exported shape kept trivial on purpose — it reads the
// same row the table already has.
function canDollarTest(org) {
  if (!org) return false;
  if (org.demo === true) return false;
  return !!org.stripe_subscription_id;
}

function adminFetch(path, opts = {}) {
  const token = localStorage.getItem("npe_token");
  return fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, ...(opts.headers || {}) },
  }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(sentenceFor(d, r.statusText)), { code: d.error || null, status: r.status });
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

  // FIX-2 C — named here once, where they were inline.
  amberWash: "#fef3c7",
  amberInk: "#92400e",
  blueWash: "#eff6ff",
  greenInk: "#065f46",
  violetWash: "#faf5ff",
  redWash: "#fee2e2",
  redInk: "#991b1b",
  cream3: "#d4cfc6",
  rowHover: "#fafaf8",
  redEdge: "#fecaca",
  redTint: "#fff5f5",
  amberEdge: "#fde68a",
  blueEdge: "#bfdbfe",
  coral: "#e07a5f",
};

const PLAN_COLOR = { trial: "#d97706", seed: "#3b82f6", growth: "#10b981", impact: "#8b5cf6" };
// FIX-4 6 — the PLAN column names the tier, and says the size under it.
// It printed the raw plan value, so a new org read as `t5000_monthly` in the
// one place that is supposed to say what somebody is paying for.
const PLAN_LABEL = { trial: "Trial", seed: "Seed", growth: "Growth", impact: "Impact" };
const planName = plan => planDisplayName(plan) || PLAN_LABEL[plan] || plan || "No plan";
const planBand = plan => planDisplayBand(plan);
const PLAN_BADGE = {
  trial:  { bg: A.amberWash, color: A.amberInk },
  seed:   { bg: A.blueWash, color: A.blue },
  growth: { bg: A.greenChip, color: A.greenInk },
  impact: { bg: A.violetWash, color: A.purple },
};
const STATUS_BADGE = {
  active:    { bg: A.greenChip, color: A.greenInk, label: "Active" },
  trialing:  { bg: A.amberWash, color: A.amberInk, label: "Trialing" },
  cancelled: { bg: A.redWash, color: A.redInk, label: "Churned" },
  canceled:  { bg: A.redWash, color: A.redInk, label: "Churned" },
  past_due:  { bg: A.redWash, color: A.redInk, label: "Past Due" },
};

const SCROLLBAR_CSS = `
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${A.cream3}; border-radius: 99px; }
  :focus-visible { outline: 2px solid ${A.greenLight}; outline-offset: 2px; }
`;

function fmt$(n) { return "$" + Number(n || 0).toLocaleString(); }
function fmtDate(s) {
  if (!s) return "Not set";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysAgo(s) {
  if (!s) return "Not set";
  const d = Math.floor((Date.now() - new Date(s)) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  return d + "d ago";
}

function PlanBadge({ plan }) {
  const b = PLAN_BADGE[plan] || { bg: A.surface, color: A.secondary };
  const band = planBand(plan);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: b.color, background: b.bg, borderRadius: 99, padding: "3px 8px", whiteSpace: "nowrap" }}>
        {planName(plan)}
      </span>
      {/* THE COUNT ALWAYS UNDER THE NAME, never instead of it. */}
      {band && <span style={{ fontSize: 10, color: A.muted, whiteSpace: "nowrap" }}>{band}</span>}
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

// ADMIN-CLEAN: an org that is not a customer never wears a customer status.
// Jonathan's own orgs read "Internal test", never "Churned" or "Canceled".
const KIND_BADGE = {
  customer:       { bg: A.greenChip, color: A.greenInk },
  prospect_trial: { bg: A.amberWash, color: A.amberInk },
  demo:           { bg: A.surface, color: A.secondary },
  internal_test:  { bg: A.surface, color: A.secondary },
  fixture:        { bg: A.surface, color: A.muted },
};
const KIND_OPTIONS = [["customer", "Customer"], ["prospect_trial", "Prospect trial"], ["demo", "Demo"], ["internal_test", "Internal test"], ["fixture", "Fixture"]];
function KindBadge({ org }) {
  const b = KIND_BADGE[org.kind] || KIND_BADGE.fixture;
  return (
    <span title={org.kind_reason ? `${org.kind_source === "set" ? "Set" : "Guessed"}: ${org.kind_reason}` : undefined}
      data-testid={`org-kind-${org.id}`}
      style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: b.color, background: b.bg, borderRadius: 99, padding: "3px 8px", whiteSpace: "nowrap" }}>
      {org.kind_label || "Unknown"}{org.kind_source === "inferred" ? " ?" : ""}{org.archived ? " · archived" : ""}
    </span>
  );
}
// FIX-50: the small "Demo" label, from the server's one rule (orgKind.isDemoOrg),
// so an org that acts like a demo can never hide behind another Kind.
function DemoLabel({ org }) {
  if (org.demo !== true) return null;
  return (
    <span data-testid={`org-demo-${org.id}`} title="Steward treats this org as a demo: demo banner, no mail."
      style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: A.ink, border: `1px solid ${A.border}`, borderRadius: 99, padding: "2px 7px", marginLeft: 6, whiteSpace: "nowrap" }}>
      Demo
    </span>
  );
}
function OrgStatus({ org }) {
  if (org.kind && !["customer", "prospect_trial"].includes(org.kind)) return <span style={{ fontSize: 12, color: A.muted }}>Not billed</span>;
  return <StatusBadge status={org.subscription_status} />;
}

// One number that opens: the label, the figure, the sentence, and the rows.
function RowsDrawer({ title, sentence, rows, onClose }) {
  const total = (rows || []).reduce((s, r) => s + Number(r.monthly_revenue_cents || 0), 0);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }} data-testid="metric-rows">
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.3)" }} />
      <div style={{ width: 520, background: A.card, borderLeft: `1px solid ${A.border}`, padding: "24px 28px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: A.ink }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: A.muted, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        {sentence && <div style={{ fontSize: 12.5, color: A.secondary, marginBottom: 14, lineHeight: 1.5 }}>{sentence}</div>}
        <div style={{ fontSize: 12, color: A.muted, marginBottom: 10 }}>{rows.length} org{rows.length === 1 ? "" : "s"}{total ? `, ${fmt$(total / 100)} a month` : ""}</div>
        {rows.length === 0 && <div style={{ fontSize: 13, color: A.muted }}>No orgs.</div>}
        {rows.map(r => (
          <div key={r.id} style={{ borderTop: `1px solid ${A.borderSub}`, padding: "10px 0", display: "flex", gap: 10, alignItems: "baseline" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: A.ink }}>{r.name}</div>
              <div style={{ fontSize: 11, color: A.muted }}>{r.id} · {r.kind_label} · {r.subscription_status || "no status"}{r.reason ? ` · ${r.reason}` : ""}</div>
            </div>
            <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono','SF Mono',monospace", color: r.monthly_revenue_cents ? A.green : A.muted }}>{fmt$((r.monthly_revenue_cents || 0) / 100)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, valueColor, accentColor, onOpen }) {
  return (
    <div role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}
      onKeyDown={onOpen ? (e => { if (e.key === "Enter") onOpen(); }) : undefined}
      style={{ cursor: onOpen ? "pointer" : "default", background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "20px 24px", borderBottom: `3px solid ${accentColor || A.border}`, transition: "box-shadow 0.15s ease" }}
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
// SCALE-1 · A background job that failed five times has stopped. It is
// listed here with its org and its last error, and Retry puts it back on the
// queue with its tries reset (POST /admin/jobs/:id/retry).
function FailedJobs() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => adminFetch("/admin/jobs/failed").then(setData).catch(console.error), []);
  useEffect(() => { load(); }, [load]);
  const retry = async (id) => {
    setBusy(id);
    try { await adminFetch(`/admin/jobs/${id}/retry`, { method: "POST" }); await load(); }
    catch (e) { rethrowProgrammerError(e); console.error(e); }
    finally { setBusy(null); }
  };
  if (!data) return null;
  const q = data.health && data.health.queue || {};
  return (
    <div data-testid="admin-failed-jobs" style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "20px 24px 12px" }}>
        <div style={SH}>Background jobs</div>
        <div style={{ fontSize: 13, color: A.secondary }}>
          {q.waiting ?? 0} waiting, {q.running ?? 0} running, {q.failedLastHour ?? 0} failed tries in the last hour.
          {" "}A job that fails five times stops and is listed below until it is retried.
        </div>
      </div>
      {data.jobs.length === 0 ? (
        <div style={{ padding: "0 24px 20px", fontSize: 13, color: A.muted }}>No job has stopped.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: A.surface }}>
              {["Job", "Org", "Error", "Stopped", ""].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 20px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.jobs.map(j => (
              <tr key={j.id} style={{ borderBottom: `1px solid ${A.borderSub}` }}>
                <td style={{ padding: "12px 20px", fontSize: 13, color: A.ink, fontWeight: 600 }}>{j.name}</td>
                <td style={{ padding: "12px 20px", fontSize: 13, color: A.secondary }}>{j.org_name || j.org_id || "Every org"}</td>
                <td style={{ padding: "12px 20px", fontSize: 12, color: A.secondary, maxWidth: 420 }}>{j.last_error}</td>
                <td style={{ padding: "12px 20px", fontSize: 12, color: A.muted, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmtDate(j.failed_at)}</td>
                <td style={{ padding: "12px 20px" }}>
                  <button type="button" disabled={busy === j.id} onClick={() => retry(j.id)}
                    style={{ background: A.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {busy === j.id ? "Retrying" : "Retry"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Overview({ metrics, orgs }) {
  const [open, setOpen] = useState(null);
  if (!metrics) return <div style={{ color: A.muted, padding: 40, fontSize: 13 }}>Loading metrics…</div>;

  const recentOrgs = [...(orgs || [])].filter(o => o.counted).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const planGroups = (metrics.by_plan || []).map(g => ({ plan: g.plan, count: g.count, revenue: g.mrr_cents / 100 }));
  const maxRev = Math.max(...planGroups.map(g => g.revenue), 1);
  const opener = (key, title) => () => setOpen({ title, rows: metrics.rows?.[key] || [], sentence: metrics.definitions?.[key === "paying" ? "paying" : key] });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {open && <RowsDrawer title={open.title} sentence={open.sentence} rows={open.rows} onClose={() => setOpen(null)} />}
      <div data-testid="metrics-left-out" style={{ fontSize: 12.5, color: A.secondary }}>
        {metrics.left_out_sentence}{" "}
        {metrics.left_out_count > 0 && <button onClick={() => setOpen({ title: "Left out", rows: metrics.rows?.left_out || [], sentence: metrics.definitions?.left_out })}
          style={{ background: "none", border: "none", color: A.green, cursor: "pointer", fontSize: 12.5, padding: 0, textDecoration: "underline" }}>See which</button>}
      </div>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
        <MetricCard label="MRR"         value={fmt$(metrics.mrr)}               valueColor={A.green}  accentColor={A.green} onOpen={opener("mrr", "MRR")} />
        <MetricCard label="ARR"         value={fmt$(metrics.arr)}               valueColor={A.green}  accentColor={A.green} onOpen={opener("mrr", "ARR (MRR times twelve)")} />
        <MetricCard label="Paying customers" value={metrics.paying_customers}                         accentColor={A.border} onOpen={opener("paying", "Paying customers")} />
        <MetricCard label="Trialing"    value={metrics.trialing}                valueColor={A.amber}  accentColor={A.amber}
          sub={`${metrics.avg_trial_days_remaining}d avg remaining`} onOpen={opener("trialing", "Trialing")} />
        <MetricCard label="Churned"     value={metrics.churned}                 valueColor={metrics.churned > 0 ? A.red : A.muted} accentColor={metrics.churned > 0 ? A.red : A.border} onOpen={opener("churned", "Churned")} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* MRR by Plan */}
        <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }}>
          <div style={SH}>MRR by Plan</div>
          {planGroups.length === 0 && <div style={{ fontSize: 13, color: A.muted, marginBottom: 16 }}>No paying customers yet.</div>}
          {planGroups.map(g => (
            <div key={g.plan} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PlanBadge plan={g.plan} />
                  <span style={{ fontSize: 12, color: A.secondary }}>{g.count} org{g.count !== 1 ? "s" : ""}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: A.ink, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmt$(g.revenue)}</span>
              </div>
              <div style={{ height: 6, background: A.borderSub, borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(g.revenue / maxRev) * 100}%`, background: PLAN_COLOR[g.plan] || A.green, borderRadius: 99, transition: "width 0.5s ease" }} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${A.borderSub}`, marginTop: 4, paddingTop: 16, textAlign: "center" }}>
            <div role="button" tabIndex={0} onClick={opener("conversion", "Trial to paid")} style={{ cursor: "pointer", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: A.green, fontFamily: "'DM Serif Display',Georgia,serif" }}>
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
            {[["Counted orgs", metrics.counted_orgs], ["Total donors", metrics.total_donors?.toLocaleString()], ["Total grants", metrics.total_grants?.toLocaleString()], ["Total interactions", metrics.total_interactions?.toLocaleString()]].map(([k, v]) => (
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
                onMouseEnter={e => e.currentTarget.style.background = A.rowHover}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "14px 20px", fontSize: 13, color: A.ink, fontWeight: 600 }}>{o.name}</td>
                <td style={{ padding: "14px 20px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "14px 20px" }}><OrgStatus org={o} /></td>
                <td style={{ padding: "14px 20px", fontSize: 13, color: A.secondary, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.donor_count}</td>
                <td style={{ padding: "14px 20px", fontSize: 12, color: A.muted, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{fmtDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FailedJobs />
    </div>
  );
}

// ── Org detail panel ────────────────────────────────────────────────────────
// ONBOARD-1 — "Run setup for this org". The plan is prepared here; the
// org's own admin presses Start, so every write carries her name. The minutes
// from Start to ready are shown so real numbers can be quoted.
// CLIENT-SAFE-1 · one org's privacy mode, as Steward support.
function OrgPrivacy({ orgId, PSH }) {
  const [p, setP] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { adminFetch("/admin/orgs/" + orgId + "/privacy").then(setP).catch(() => setP(null)); }, [orgId]);
  if (!p) return null;
  const flip = async on => {
    setBusy(true); setNote("");
    try { setP(await adminFetch("/admin/orgs/" + orgId + "/privacy", { method: "POST", body: JSON.stringify({ on }) })); setNote("Saved. Their audit log shows it was changed by Steward support."); }
    catch (e) { setNote(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <div data-testid="admin-org-privacy">
      <div style={PSH}>Privacy</div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: A.secondary, cursor: "pointer" }}>
        <input type="checkbox" data-testid="admin-privacy-switch" checked={!!p.on} disabled={busy} onChange={e => flip(e.target.checked)} />
        <span style={{ flex: 1 }}>{p.label}</span>
      </label>
      <div style={{ fontSize: 12, color: A.muted, marginTop: 6, lineHeight: 1.5 }}>{p.description}</div>
      {p.line && <div style={{ fontSize: 12, color: A.ink, marginTop: 6 }}>{p.line}</div>}
      {note && <div data-testid="admin-privacy-note" style={{ fontSize: 12, color: A.ink, marginTop: 6 }}>{note}</div>}
    </div>
  );
}

function OrgSetup({ orgId, PSH, PBTN }) {
  const [times, setTimes] = useState(null);
  const [files, setFiles] = useState([]);
  const [site, setSite] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminFetch("/admin/setup-times").then(r => setTimes((r.orgs || []).find(o => o.orgId === orgId) || null)).catch(() => setTimes(null));
  }, [orgId]);
  const prepare = async () => {
    setBusy(true); setNote("");
    try {
      const read = await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })));
      const r = await adminFetch("/admin/orgs/" + orgId + "/setup", { method: "POST", body: JSON.stringify({ files: read, siteUrl: site }) });
      setNote(`Plan ready (${r.plan && r.plan.counts ? `${r.plan.counts.donors} people, ${r.plan.counts.gifts} gifts` : "no files"}). They open Setup in their account and press Start.`);
    } catch (e) { setNote(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <div data-testid="admin-org-setup">
      <div style={PSH}>Setup</div>
      <div style={{ fontSize: 13, color: A.secondary, marginBottom: 8 }} data-testid="admin-setup-minutes">
        {times && times.startedAt
          ? (times.completedAt ? `Set up in ${times.minutes} minutes, from Start to ready.` : `Setup started ${fmtDate(times.startedAt)} and has not finished.`)
          : "Setup has not been run for this org."}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
        <input type="file" multiple accept=".csv,.txt" onChange={e => setFiles([...e.target.files])} />
        <input value={site} onChange={e => setSite(e.target.value)} placeholder="their website" style={{ border: `1px solid ${A.border}`, borderRadius: 6, padding: "6px 8px" }} />
        <button onClick={prepare} disabled={busy || (!files.length && !site)} data-testid="admin-run-setup" style={{ ...PBTN, alignSelf: "flex-start" }}>
          {busy ? "Reading…" : "Run setup for this org"}
        </button>
        {note && <div style={{ fontSize: 12.5, color: A.ink }}>{note}</div>}
      </div>
    </div>
  );
}

// PRICING-1 · EXISTING DEALS HOLD. "Custom price, ends on": an org with one
// (CKRH at $149, a beta org free until its date) is never measured against a
// band and never moved to a band price automatically.
function CustomPrice({ orgId, detail, INP, PBTN, onSaved }) {
  const has = detail.custom_price_cents != null;
  const [usd, setUsd] = useState(has ? String(detail.custom_price_cents / 100) : "");
  const [ends, setEnds] = useState(detail.custom_price_ends_on ? String(detail.custom_price_ends_on).slice(0, 10) : "");
  const [note, setNote] = useState(detail.custom_price_note || "");
  const [msg, setMsg] = useState("");
  async function save(clear) {
    setMsg("");
    try {
      await adminFetch("/admin/orgs/" + orgId + "/custom-price", { method: "POST",
        body: JSON.stringify(clear ? { clear: true } : { monthlyUsd: Number(usd), endsOn: ends || null, note }) });
      onSaved(clear ? { custom_price_cents: null, custom_price_ends_on: null, custom_price_note: null }
        : { custom_price_cents: Math.round(Number(usd) * 100), custom_price_ends_on: ends || null, custom_price_note: note });
      if (clear) { setUsd(""); setEnds(""); setNote(""); }
      setMsg(clear ? "Back to band pricing." : "Saved. This org is never moved to a band price automatically.");
    } catch (e) { setMsg(errorMessage(e)); }
  }
  return (
    <div data-testid="admin-custom-price" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: A.secondary }}>Custom price $</label>
        <input data-testid="admin-custom-price-usd" type="number" min={0} value={usd} onChange={e => setUsd(e.target.value)} placeholder="149" style={{ ...INP, width: 80 }} />
        <span style={{ fontSize: 12, color: A.secondary }}>/mo, ends on</span>
        <input data-testid="admin-custom-price-ends" type="date" value={ends} onChange={e => setEnds(e.target.value)} style={{ ...INP, width: 150 }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why (e.g. first customer, beta until launch)" style={{ ...INP, flex: 1 }} />
        <button data-testid="admin-custom-price-save" onClick={() => save(false)} disabled={usd === ""} style={{ ...PBTN }}>Save</button>
        {has && <button onClick={() => save(true)} style={{ ...PBTN }}>Remove</button>}
      </div>
      {msg && <div style={{ fontSize: 11, color: A.muted }}>{msg}</div>}
    </div>
  );
}

function OrgPanel({ org, onClose, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [extDays, setExtDays] = useState("14");
  const [newPlan, setNewPlan] = useState(org.plan || "trial");
  const [working, setWorking] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  // ADMIN-CLEAN: delete asks twice. First "are you sure", then the org's name.
  const [deleteStep, setDeleteStep] = useState(0);
  const [kind, setKind] = useState(org.kind_source === "set" ? org.kind : "");
  const [kindNote, setKindNote] = useState("");
  // FIX-50: the Demo switch. Its state is the server's one rule, read back
  // from every answer, so the switch, the Kind and the Email section move together.
  const [demo, setDemo] = useState(org.demo === true);

  // MAIL-1: this org's mail, as the policy sees it.
  const [mail, setMail] = useState(null);
  const [mailNote, setMailNote] = useState("");
  const [goingOut, setGoingOut] = useState(null);   // SEND-GATE-2

  useEffect(() => {
    adminFetch("/admin/orgs/" + org.id).then(setDetail).catch(console.error);
    adminFetch("/admin/orgs/" + org.id + "/mail").then(setMail).catch(console.error);
  }, [org.id]);

  // FIX-53: turning Staff or Donor mail on is the one way either goes on, so
  // it asks first and says what it will allow. Turning one off does not ask.
  async function mailSwitch(k, on) {
    const allows = mail && mail.turnOnSentence && mail.turnOnSentence[k];
    if (on && allows) {
      // SEND-GATE-2: Donor mail's confirm names exactly what will start.
      const starts = k === "donor" && mail.emailTypes ? `\n\n${mail.emailTypes.willStart}` : "";
      if (!window.confirm(`Turn on ${k === "staff" ? "Staff" : "Donor"} mail for ${org.name}?\n\n${allows}${starts}`)) return;
      return mailAction("/mail-switches", { [k]: true, confirm: true });
    }
    return mailAction("/mail-switches", { [k]: on });
  }

  async function mailAction(path, body) {
    setWorking(true); setMailNote("");
    try {
      const r = await adminFetch("/admin/orgs/" + org.id + path, { method: "POST", body: JSON.stringify(body || {}) });
      if (path === "/mail-test") setMailNote(r.sentence || "");
      setMail(await adminFetch("/admin/orgs/" + org.id + "/mail"));
    } catch (e) { setMailNote(errorMessage(e)); }
    setWorking(false);
  }

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

  // PARITY-2 Part 5: QuickBooks sync is offered only to the orgs turned on
  // here, until Intuit's app assessment is passed.
  async function toggleQbo() {
    setWorking(true);
    try {
      const on = !(detail?.qbo_sync_enabled === true);
      await adminFetch("/admin/orgs/" + org.id + "/qbo-sync", { method: "POST", body: JSON.stringify({ enabled: on }) });
      setDetail(dd => dd ? { ...dd, qbo_sync_enabled: on } : dd);
    } catch (e) { alert(errorMessage(e)); }
    setWorking(false);
  }

  async function deleteOrg() {
    if (deleteInput !== org.name) { alert("Type the org name exactly to confirm."); return; }
    setWorking(true);
    try {
      await adminFetch("/admin/orgs/" + org.id, { method: "DELETE", body: JSON.stringify({ confirm: true, confirmName: deleteInput }) });
      onClose(); onRefresh();
    } catch (e) { alert(errorMessage(e)); }
    setWorking(false);
  }

  async function saveKind(next) {
    setWorking(true); setKindNote("");
    try {
      const r = await adminFetch("/admin/orgs/" + org.id + "/kind", { method: "POST", body: JSON.stringify({ kind: next || null }) });
      setKind(next); setKindNote(next ? "Saved." : "Back to Steward's guess.");
      // Kind decides whether this org is a demonstration, so the switch and
      // the Email section below take the answer rather than say what they said.
      setDemo(r.demo === true);
      setMail(r.mail || await adminFetch("/admin/orgs/" + org.id + "/mail"));
      onRefresh(false);
    } catch (e) { setKindNote(errorMessage(e)); }
    setWorking(false);
  }

  async function flipDemo(on) {
    setWorking(true); setKindNote("");
    try {
      const r = await adminFetch("/admin/orgs/" + org.id + "/demo", { method: "POST", body: JSON.stringify({ on }) });
      setDemo(r.demo === true);
      setKind(r.kind || "");
      setMail(r.mail);
      onRefresh(false);
    } catch (e) { setKindNote(errorMessage(e)); }
    setWorking(false);
  }

  // Archive hides the org from the console and Metrics. Restore is the undo.
  async function setArchived(on) {
    setWorking(true);
    try {
      await adminFetch("/admin/orgs/" + org.id + (on ? "/archive" : "/unarchive"), { method: "POST", body: "{}" });
      onClose(); onRefresh();
    } catch (e) { alert(errorMessage(e)); }
    setWorking(false);
  }
  const blockers = detail?.delete_blockers || org.delete_blockers || [];

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
              <OrgStatus org={org} />
              <KindBadge org={org} />
            </div>
            <div data-testid="admin-org-demo" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: A.ink }}>Demo</span>
              <button data-testid="admin-org-demo-switch" role="switch" aria-checked={demo} disabled={working} onClick={() => flipDemo(!demo)}
                style={{ width: 40, height: 22, borderRadius: 99, border: "none", padding: 2, cursor: working ? "not-allowed" : "pointer",
                  background: demo ? A.green : A.border, display: "flex", justifyContent: demo ? "flex-end" : "flex-start", transition: "background 0.15s ease" }}>
                <span style={{ width: 18, height: 18, borderRadius: 99, background: "#FFFFFF", display: "block" }} />
              </button>
              <span data-testid="admin-org-demo-state" style={{ fontSize: 12, color: A.secondary }}>
                {demo ? "On: demo banner, demo behavior, no mail." : "Off: a real organization. The mail switches below decide its mail."}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: A.secondary }}>Kind</label>
              <select data-testid="admin-org-kind" value={kind} disabled={working} onChange={e => saveKind(e.target.value)}
                style={{ fontSize: 12, border: `1px solid ${A.border}`, borderRadius: 6, padding: "4px 8px", background: A.surface, color: A.ink }}>
                <option value="">Steward's guess ({org.kind_source === "inferred" ? org.kind_label : "none"})</option>
                {KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {kindNote && <span style={{ fontSize: 11, color: A.muted }}>{kindNote}</span>}
            </div>
            {org.kind_reason && <div style={{ fontSize: 11, color: A.muted, marginBottom: 6 }}>Why: {org.kind_reason}</div>}
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
              ["Sequences", detail?.sequence_count ?? "Not set"], ["Enrollments", detail?.enrollment_count ?? "Not set"], ["MRR", fmt$(org.monthly_revenue)]].map(([k, v]) => (
              <div key={k} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: A.muted, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: A.green, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* ONBOARD-1: setup for this org. Jonathan prepares the plan on a call;
              the customer presses Start in her own session. */}
          <OrgSetup orgId={org.id} PSH={PSH} PBTN={PBTN} />

          {/* CLIENT-SAFE-1: privacy mode, turned on here for an org that asked.
              Their audit log records it as changed by Steward support. */}
          <OrgPrivacy orgId={org.id} PSH={PSH} />

          {/* MAIL-1: this org's mail. A demonstration org shows it all locked, with why. */}
          {mail && (
            <div data-testid="admin-org-mail">
              <div style={PSH}>Email</div>
              {mail.locked && (
                <div data-testid="admin-mail-locked" style={{ fontSize: 12.5, color: A.ink, background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                  {mail.lockedSentence}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: A.secondary }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ flex: 1 }} data-testid="admin-mail-onboarded">
                    Onboarded: {mail.onboarded ? `${fmtDate(mail.onboardedAt)}. ${mail.onboardedHow}` : "not yet"}
                  </span>
                  {!mail.onboarded && !mail.locked && (
                    <button data-testid="admin-mark-onboarded" onClick={() => mailAction("/mark-onboarded")} disabled={working} style={{ ...PBTN }}>
                      Mark onboarded
                    </button>
                  )}
                </div>
                {/* FIX-48: three switches, each saved per org and audit-logged. Sign-in mail always goes. */}
                <div data-testid="admin-mail-switches" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    ["staff", "Staff mail", "Digests, morning emails, reminders and alerts Steward sends this organization's team on its own."],
                    ["donor", "Donor mail", "Mail this organization sends its donors: receipts, thank-yous, campaigns and sequences it turned on."],
                    ["billing", "Billing mail", "Steward's own billing mail to this organization."],
                  ].map(([k, label, help]) => (
                    <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: mail.locked ? "not-allowed" : "pointer" }}>
                      <input type="checkbox" data-testid={`admin-${k}-mail-switch`}
                        checked={!!(mail.switches && mail.switches[k]) && !mail.locked}
                        disabled={working || mail.locked}
                        onChange={e => mailSwitch(k, e.target.checked)} />
                      <span style={{ flex: 1 }}>
                        <span style={{ color: A.ink, fontWeight: 600 }}>{label}</span>
                        <span style={{ display: "block", fontSize: 12, color: A.muted }}>{help}</span>
                        {mail.switchSince && mail.switchSince[k] && (
                          <span data-testid={`admin-${k}-mail-since`} style={{ display: "block", fontSize: 12, color: A.secondary }}>{mail.switchSince[k]}</span>
                        )}
                      </span>
                    </label>
                  ))}
                  <div data-testid="admin-signin-mail" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" checked disabled readOnly aria-label="Sign-in mail is always on" />
                    <span style={{ flex: 1 }}>
                      <span style={{ color: A.ink, fontWeight: 600 }}>Sign-in mail</span>
                      <span style={{ display: "block", fontSize: 12, color: A.muted }}>Sign-in links, password resets and invites. Always on.</span>
                    </span>
                  </div>
                </div>
                {/* SEND-GATE-2: what the org turned on, read-only, beside Donor mail. */}
                {mail.emailTypes && (
                  <div data-testid="admin-mail-types" style={{ fontSize: 12, color: A.muted }}>
                    <div style={{ color: A.ink, fontWeight: 600, marginBottom: 2 }}>Emails this organization turned on</div>
                    {mail.emailTypes.types.filter(t => t.on).map(t => (
                      <div key={t.key}>{t.name}: {t.whoGetsIt}. {t.since}. {t.next7} in the next 7 days.</div>
                    ))}
                    {!mail.emailTypes.types.some(t => t.on) && <div>None. Every email is off.</div>}
                    <div style={{ color: A.secondary, marginTop: 2 }}>{mail.emailTypes.willStart}</div>
                    <button type="button" data-testid="admin-going-out" onClick={async () => setGoingOut(goingOut ? null : await adminFetch("/admin/orgs/" + org.id + "/going-out").catch(() => null))}
                      style={{ ...PBTN, marginTop: 6 }}>{goingOut ? "Hide Going out" : "See Going out (read-only)"}</button>
                    {goingOut && <div style={{ marginTop: 8 }}><GoingOut data={goingOut} orgPath={"/admin/orgs/" + org.id} isReadOnly /></div>}
                  </div>
                )}
                <div data-testid="admin-mail-domain">
                  Sending domain: {mail.domain.domain ? `${mail.domain.domain} (${mail.domain.status})` : "none"}.
                  {mail.domain.from ? ` From: ${mail.domain.from}.` : ""} {mail.domain.sentence}
                </div>
                <div style={{ fontSize: 12, color: A.muted }}>
                  {[["Staff mail", "staff"], ["Donor mail", "donor"], ["Sign-in mail", "account"], ["Billing mail", "billing"]].map(([label, k]) => (
                    <div key={k}>{label}: {mail.families[k].sentence}</div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button data-testid="admin-mail-test" onClick={() => mailAction("/mail-test")} disabled={working || mail.locked} style={{ ...PBTN }}>
                    Send a test to my own address
                  </button>
                  {mailNote && <span data-testid="admin-mail-note" style={{ fontSize: 12, color: A.ink }}>{mailNote}</span>}
                </div>
              </div>
            </div>
          )}

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
                      color: u.role === "admin" ? A.amberInk : A.secondary,
                      background: u.role === "admin" ? A.amberWash : A.surface,
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
                <span style={{ fontSize: 13, color: A.secondary, flex: 1 }}>
                  QuickBooks sync: {detail?.qbo_sync_enabled ? "on" : "off"}
                </span>
                <button data-testid="admin-qbo-toggle" onClick={toggleQbo} disabled={working || !detail} style={{ ...PBTN }}>
                  {detail?.qbo_sync_enabled ? "Turn off" : "Turn on"}
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
              {detail && <CustomPrice orgId={org.id} detail={detail} INP={INP} PBTN={PBTN} onSaved={d => setDetail(dd => ({ ...dd, ...d }))} />}
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
          <div style={{ marginTop: 8, border: `1px solid ${A.redEdge}`, borderRadius: 10, padding: "16px 20px", background: A.redTint }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: A.red, marginBottom: 12 }}>Danger Zone</div>
            <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <button data-testid="admin-org-archive" onClick={() => setArchived(!org.archived)} disabled={working} style={{ ...PBTN }}>
                {org.archived ? "Restore (un-archive)" : "Archive"}
              </button>
              <span style={{ fontSize: 11.5, color: A.secondary }}>{org.archived ? "Archived: hidden from the list and Metrics." : "Hides it from the list and Metrics. Restore undoes it."}</span>
            </div>
            {blockers.length > 0 ? (
              <div data-testid="admin-delete-blocked" style={{ fontSize: 12, color: A.secondary, lineHeight: 1.5 }}>
                Permanent delete is off because {blockers.join(" and ")}. Archive it instead.
              </div>
            ) : !showDelete ? (
              <button onClick={() => { setShowDelete(true); setDeleteStep(0); }} style={{ background: "transparent", border: `1px solid ${A.redEdge}`, borderRadius: 6, padding: "7px 14px", color: A.red, fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.15s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = A.redWash; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                Delete org permanently
              </button>
            ) : deleteStep === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 13, color: A.secondary }}>Delete {org.name} and everything in it? This cannot be undone. Archive can.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button data-testid="admin-delete-step1" onClick={() => setDeleteStep(1)} style={{ flex: 1, background: A.red, border: "none", borderRadius: 6, padding: "9px", color: A.sidebar, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Yes, continue</button>
                  <button onClick={() => setShowDelete(false)} style={{ ...PBTN }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 13, color: A.secondary }}>Type <strong style={{ color: A.ink }}>{org.name}</strong> to confirm:</div>
                <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder={org.name} style={{ ...INP, width: "100%" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={deleteOrg} disabled={working} style={{ flex: 1, background: A.red, border: "none", borderRadius: 6, padding: "9px", color: A.sidebar, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Delete everything</button>
                  <button onClick={() => { setShowDelete(false); setDeleteInput(""); setDeleteStep(0); }} style={{ ...PBTN }}
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
  // ADMIN-CLEAN: the list opens on Customers and Prospect trials. Everything
  // else is one pick away, and archived orgs only show when asked for.
  const [kindFilter, setKindFilter] = useState("counted");
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [extendOrgId, setExtendOrgId] = useState(null);
  const [extDays, setExtDays] = useState("14");
  const [changePlanOrgId, setChangePlanOrgId] = useState(null);
  const [newPlan, setNewPlan] = useState("growth");
  const [dollarBusy, setDollarBusy] = useState(null);
  const [reconcileBusy, setReconcileBusy] = useState(null);

  const filtered = (orgs || [])
    .filter(o => !search || o.name.toLowerCase().includes(search.toLowerCase()))
    .filter(o => statusFilter === "all" || o.subscription_status === statusFilter
      || (statusFilter === "cancelled" && o.subscription_status === "canceled"))
    .filter(o => kindFilter === "archived" ? o.archived
      : !o.archived && (kindFilter === "all" || (kindFilter === "counted" ? ["customer", "prospect_trial"].includes(o.kind) : o.kind === kindFilter)))
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

  // ── GTM-1a 4 · THE $1 PRICE ─────────────────────────────────────────────
  // The only door to it, and it is HERE, on an organisation that already
  // exists. The price is not in the public catalogue, so no pricing page, no
  // signup body and no close link can reach it; this control moves an org's
  // live Stripe subscription onto it so a real charge can be proven end to
  // end for a dollar.
  //
  // It confirms first, and the confirmation says what will actually happen:
  // this changes a LIVE subscription. It is the one control on this screen
  // that touches money that is already being charged.
  // FIX-4 5 — WHEN AN ORG HAS NO SUBSCRIPTION ON FILE. Stripe is the record
  // and Steward's copy of it can be blank (a webhook that never landed), so
  // the answer is to read it back rather than to leave a button that can
  // only refuse. It creates nothing and charges nothing.
  async function reconcileSubscription(org) {
    setReconcileBusy(org.id);
    try {
      const r = await adminFetch("/admin/orgs/" + org.id + "/reconcile-subscription", { method: "POST", body: "{}" });
      window.alert(r.message || "Done.");
      onRefresh();
    } catch (e) { window.alert(errorMessage(e)); }
    finally { setReconcileBusy(null); }
  }

  async function moveToDollarPrice(org) {
    const yes = window.confirm(
      `Move ${org.name} onto the $1 internal test price?\n\n` +
      `This changes their LIVE Stripe subscription. Their next invoice will be $1.\n` +
      `Use it to prove a real charge end to end, then move them back with Plan.`
    );
    if (!yes) return;
    setDollarBusy(org.id);
    try {
      await adminFetch("/admin/orgs/" + org.id + "/internal-test-price", { method: "POST", body: "{}" });
      onRefresh();
    } catch (e) { alert(errorMessage(e)); }
    finally { setDollarBusy(null); }
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
        <select data-testid="admin-kind-filter" value={kindFilter} onChange={e => setKindFilter(e.target.value)} style={{ ...INP }}>
          <option value="counted">Customers and prospect trials</option>
          <option value="all">All kinds (not archived)</option>
          {KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="archived">Archived</option>
        </select>
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
              {["Org", "Kind", "Plan", "Status", "Donors", "Grants", "Users", "Last active", "MRR", "Actions"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 16px", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: A.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: A.muted, fontSize: 13 }}>No orgs found</td></tr>}
            {filtered.map(o => (
              <tr key={o.id} {...rowOpenProps(() => setSelectedOrg(o), { role: "row" })} data-testid="admin-org-row"
                style={{ borderBottom: `1px solid ${A.borderSub}`, transition: "background 0.15s ease", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = A.rowHover}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: A.ink }}>{o.name}</div>
                  <div style={{ fontSize: 10, color: A.muted, marginTop: 2, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{o.id}</div>
                </td>
                <td style={{ padding: "12px 16px" }}><KindBadge org={o} /><DemoLabel org={o} /></td>
                <td style={{ padding: "12px 16px" }}><PlanBadge plan={o.plan} /></td>
                <td style={{ padding: "12px 16px" }}><OrgStatus org={o} /></td>
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
                        <button onClick={() => quickExtend(o.id)} style={{ ...ABTN, fontSize: 11, color: A.amber, borderColor: A.amberEdge }}>+days</button>
                        <button onClick={() => setExtendOrgId(null)} style={{ background: "none", border: "none", color: A.muted, fontSize: 14, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setExtendOrgId(o.id)} style={{ ...ABTN, fontSize: 11, color: A.amber, borderColor: A.amberEdge }}>+Trial</button>
                    )}
                    {changePlanOrgId === o.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <select value={newPlan} onChange={e => setNewPlan(e.target.value)} style={{ ...INP, padding: "4px 8px", fontSize: 12 }}>
                          {["trial","seed","growth","impact"].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button onClick={() => quickChangePlan(o.id)} style={{ ...ABTN, fontSize: 11, color: A.blue, borderColor: A.blueEdge }}>Set</button>
                        <button onClick={() => setChangePlanOrgId(null)} style={{ background: "none", border: "none", color: A.muted, fontSize: 14, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setChangePlanOrgId(o.id); setNewPlan(o.plan || "trial"); }} style={{ ...ABTN, fontSize: 11, color: A.blue, borderColor: A.blueEdge }}>Plan</button>
                    )}
                    {/* GTM-1a 4 — never rendered as a plan you could pick: it
                        is an action on one organisation, beside the other
                        actions on that organisation.
                        FIX-4 5 — AND ONLY WHERE IT CAN WORK. It moves a live
                        Stripe subscription onto the $1 price, so an org that
                        has no subscription has nothing to move and the button
                        could only ever answer "no subscription". The demo org
                        is excluded for the separate reason that it is not a
                        customer and never will be: there is nothing there to
                        prove a real charge with. */}
                    {/* FIX-4 5 — the org has no subscription on file. Read
                        it back from Stripe rather than show a $1 test that
                        can only answer "no subscription". */}
                    {!o.demo && !o.stripe_subscription_id && (
                      <button data-testid={`org-reconcile-${o.id}`} onClick={() => reconcileSubscription(o)}
                        disabled={reconcileBusy === o.id}
                        title="Read this org's subscription back from Stripe and save it. Creates nothing, charges nothing."
                        style={{ ...ABTN, fontSize: 11, color: A.blue, borderColor: A.blueEdge,
                                 cursor: reconcileBusy === o.id ? "not-allowed" : "pointer" }}>
                        {reconcileBusy === o.id ? "…" : "Find subscription"}
                      </button>
                    )}
                    {canDollarTest(o) && (
                      <button data-testid={`org-dollar-${o.id}`} onClick={() => moveToDollarPrice(o)}
                        disabled={dollarBusy === o.id}
                        title="Move this org's live Stripe subscription onto the $1 internal test price"
                        style={{ ...ABTN, fontSize: 11, color: A.amber, borderColor: A.amberEdge,
                                 cursor: dollarBusy === o.id ? "not-allowed" : "pointer" }}>
                        {dollarBusy === o.id ? "…" : "$1 test"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedOrg && <OrgPanel org={selectedOrg} onClose={() => setSelectedOrg(null)} onRefresh={(close = true) => { onRefresh(); if (close) setSelectedOrg(null); }} />}
    </div>
  );
}

// ── Metrics page ────────────────────────────────────────────────────────────
// ADMIN-CLEAN: customers only. Every number opens its rows, MRR is what Stripe
// says each subscription charges, and the plan line shows whether Steward is
// on pace (default: 8 paying customers by 31 Dec 2026, then 5 net new a month).
function Metrics({ metrics, orgs, onRefresh }) {
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState("");
  if (!metrics || !orgs) return <div style={{ color: A.muted, padding: 40, fontSize: 13 }}>Loading…</div>;

  const opener = (key, title, defKey = key) => () => setOpen({ title, rows: metrics.rows?.[key] || [], sentence: metrics.definitions?.[defKey] });
  const months = metrics.by_month || [];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const now = months.find(m => m.month === thisMonth) || {};
  const pace = now.target == null ? null : (metrics.paying_customers >= now.target ? "on pace" : `${Math.ceil(now.target - metrics.paying_customers)} behind`);
  const maxY = Math.max(1, ...months.map(m => Math.max(m.customers || 0, m.target || 0)));
  const W = 640, H = 180, bw = W / Math.max(1, months.length);
  const y = v => H - (v / maxY) * (H - 16);
  const targetPts = months.map((m, i) => m.target == null ? null : `${i * bw + bw / 2},${y(m.target)}`).filter(Boolean).join(" ");
  const t = metrics.target || {};

  async function saveTarget() {
    setNote("");
    try {
      await adminFetch("/admin/metrics/target", { method: "POST", body: JSON.stringify(form) });
      setEditing(false); onRefresh && onRefresh();
    } catch (e) { setNote(errorMessage(e)); }
  }

  const total = metrics.counted_orgs;
  const funnel = [
    { label: "Signed up", key: "counted", count: total, pct: 100, borderColor: A.secondary },
    { label: "Still trialing", key: "trialing", count: metrics.trialing, pct: total ? Math.round((metrics.trialing / total) * 100) : 0, borderColor: A.amber },
    { label: "Paying", key: "paying", count: metrics.paying_customers, pct: total ? Math.round((metrics.paying_customers / total) * 100) : 0, borderColor: A.green },
    { label: "Churned", key: "churned", count: metrics.churned, pct: total ? Math.round((metrics.churned / total) * 100) : 0, borderColor: A.red },
  ];
  const topOrgs = [...orgs].filter(o => o.counted).sort((a, b) => (b.donor_count + b.grant_count) - (a.donor_count + a.grant_count)).slice(0, 10);
  const INP = { border: `1px solid ${A.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, width: 90, background: A.surface, color: A.ink };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {open && <RowsDrawer title={open.title} sentence={open.sentence} rows={open.rows} onClose={() => setOpen(null)} />}
      <div data-testid="metrics-left-out" style={{ fontSize: 12.5, color: A.secondary }}>
        {metrics.left_out_sentence}{" "}
        {metrics.left_out_count > 0 && <button onClick={opener("left_out", "Left out")}
          style={{ background: "none", border: "none", color: A.green, cursor: "pointer", fontSize: 12.5, padding: 0, textDecoration: "underline" }}>See which</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        <MetricCard label="Paying customers" value={metrics.paying_customers} accentColor={A.green} onOpen={opener("paying", "Paying customers")}
          sub={pace ? `Plan says ${Math.round(now.target * 10) / 10} by this month's end: ${pace}` : undefined} />
        <MetricCard label="MRR" value={fmt$(metrics.mrr)} valueColor={A.green} accentColor={A.green} onOpen={opener("mrr", "MRR")} />
        <MetricCard label="ARR" value={fmt$(metrics.arr)} valueColor={A.green} accentColor={A.green} onOpen={opener("mrr", "ARR (MRR times twelve)", "arr")} />
        <MetricCard label="Trial to paid" value={`${metrics.trial_conversion_rate}%`} accentColor={A.border} onOpen={opener("conversion", "Trial to paid")} />
      </div>

      {/* Paying customers and MRR by month, against the plan */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }} data-testid="metrics-by-month">
        <div style={{ ...SH, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Paying customers by month, against the plan</span>
          <button onClick={() => { setEditing(!editing); setForm({ startMonth: t.start?.month || "2026-12", startCustomers: t.start?.customers ?? 8, monthlyNet: t.monthlyNet ?? 5, through: t.through || "2027-12" }); }}
            style={{ background: "none", border: `1px solid ${A.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: A.secondary, cursor: "pointer" }}>
            {editing ? "Close" : "Set the plan"}
          </button>
        </div>
        <div style={{ fontSize: 12, color: A.secondary, marginBottom: 12 }}>
          The plan: {t.start?.customers} paying customers by the end of {t.start?.month}, then {t.monthlyNet} net new a month through {t.through}.
          Bars are paying customers at each month's end, from paid Steward invoices; the line is the plan.
        </div>
        {editing && form && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14, fontSize: 12, color: A.secondary }}>
            <label>Customers <input type="number" min="0" value={form.startCustomers} onChange={e => setForm({ ...form, startCustomers: e.target.value })} style={INP} /></label>
            <label>by <input value={form.startMonth} onChange={e => setForm({ ...form, startMonth: e.target.value })} style={INP} placeholder="YYYY-MM" /></label>
            <label>then net new a month <input type="number" min="0" value={form.monthlyNet} onChange={e => setForm({ ...form, monthlyNet: e.target.value })} style={INP} /></label>
            <label>through <input value={form.through} onChange={e => setForm({ ...form, through: e.target.value })} style={INP} placeholder="YYYY-MM" /></label>
            <button onClick={saveTarget} style={{ background: A.green, color: A.sidebar, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
            {note && <span>{note}</span>}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 160, display: "block" }} role="img" aria-label="Paying customers by month against the plan">
          {months.map((m, i) => m.customers != null && (
            <rect key={m.month} x={i * bw + bw * 0.2} y={y(m.customers)} width={bw * 0.6} height={H - y(m.customers)} fill={A.green} />
          ))}
          {targetPts && <polyline points={targetPts} fill="none" stroke={A.amber} strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: A.muted, marginTop: 4 }}>
          {months.filter((m, i) => i % 3 === 0).map(m => <span key={m.month}>{m.month}</span>)}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead><tr>{["Month", "Paying customers", "MRR", "Plan"].map(h => <th key={h} style={{ fontSize: 10, color: A.muted, textAlign: "left", padding: "6px 8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>)}</tr></thead>
          <tbody>
            {months.filter(m => m.customers != null || m.month <= (t.start?.month || thisMonth)).map(m => (
              <tr key={m.month} style={{ borderTop: `1px solid ${A.borderSub}` }}>
                <td style={{ padding: "6px 8px", fontSize: 12, color: A.secondary }}>{m.month}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{m.customers ?? "Not yet"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>{m.mrr_cents == null ? "Not yet" : fmt$(m.mrr_cents / 100)}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: A.muted }}>{m.target ?? "Not set"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Funnel */}
      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "24px 28px" }}>
        <div style={SH}>Trial Conversion Funnel (customers and prospect trials)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {funnel.map((f, i) => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 8, flex: i === 0 ? 2 : 1 }}>
              <div role="button" tabIndex={0} onClick={opener(f.key, f.label)}
                style={{ cursor: "pointer", flex: 1, background: A.card, border: `1px solid ${A.border}`, borderLeft: `4px solid ${f.borderColor}`, borderRadius: 8, padding: "14px 16px" }}>
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
                onMouseEnter={e => e.currentTarget.style.background = A.rowHover}
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
      background: on ? "rgba(52,168,83,0.15)" : "rgba(234,67,53,0.12)", color: on ? A.green : A.coral }}>{label}</span>
  );
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        {["pending", "dispute", "held", "approved", "delisted", "rejected"].map(st => (
          <button key={st} onClick={() => setStatus(st)}
            style={{ background: status === st ? A.green : "transparent", color: status === st ? A.sidebar : A.muted,
              border: `1px solid ${status === st ? A.green : A.border}`, borderRadius: 20, padding: "5px 14px", marginRight: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {st}
          </button>
        ))}
      </div>
      {err && <div style={{ color: A.coral, fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {!apps ? <div style={{ color: A.muted }}>Loading…</div> : apps.length === 0 ? <div style={{ color: A.muted }}>Nothing {status}.</div> :
        apps.map(a => {
          const einR = typeof a.ein_result === "string" ? JSON.parse(a.ein_result || "{}") : (a.ein_result || {});
          const dom = typeof a.domain_check === "string" ? JSON.parse(a.domain_check || "{}") : (a.domain_check || {});
          const decisions = typeof a.decisions === "string" ? JSON.parse(a.decisions || "[]") : (a.decisions || []);
          return (
            <div key={a.id} style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: A.ink }}>{a.org_name} <span style={{ color: A.muted, fontWeight: 400, fontSize: 12 }}>({a.org_id})</span></div>
                <div style={{ color: A.muted, fontSize: 12 }}>{displayDate(a.created_at)}</div>
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
                    style={{ background: A.green, color: A.sidebar, border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginRight: 8 }}>Approve</button>
                  <button disabled={busyId === a.id} onClick={() => decide(a.id, "hold")}
                    style={{ background: "transparent", color: A.muted, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 8 }}>Hold</button>
                  <button disabled={busyId === a.id} onClick={() => decide(a.id, "reject")}
                    style={{ background: "transparent", color: A.coral, border: "1px solid "+A.coral, borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Reject</button>
                </div>
              )}
              {decisions.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: A.muted }}>
                  {decisions.map((d, i) => <div key={i}>{String(d.at).slice(0, 16)} · {d.by} · {d.action}{d.reason ? ` · ${d.reason}` : ""}</div>)}
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

  const field = { width: "100%", font: "inherit", fontSize: 14, padding: "9px 11px", border: `1px solid ${A.border}`, borderRadius: 8, background: A.sidebar, color: A.ink };
  const label = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: A.muted, marginBottom: 6 };

  return (
    <div>
      <div style={{ ...SH }}>Close a deal</div>

      <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, padding: "22px 24px", maxWidth: 720 }}>
        <div style={{ fontSize: 13, color: A.secondary, lineHeight: 1.6, marginBottom: 18, maxWidth: 560 }}>
          {target
            ? "This puts an organization that is already in Steward onto a plan. They put a card in, nothing is charged today, and the first charge is thirty days from the moment they sign."
            : "This creates the one link that opens an organization. She puts a card in, pays the band's one-time setup fee today, and the plan's first charge is thirty days from the moment she signs."}
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
                      border: `1px solid ${on ? A.green : A.border}`, background: on ? A.greenPale : A.sidebar,
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
                background: A.green, color: A.sidebar, cursor: canCreate ? "pointer" : "default", opacity: canCreate ? 1 : 0.45,
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
                style={{ font: "inherit", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 8, border: "none", background: A.green, color: A.sidebar, cursor: "pointer" }}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: A.secondary, marginTop: 10, lineHeight: 1.6, maxWidth: 520 }}>
              Send it to {created.contactEmail}, or open it on her laptop. The organization is created when
              she finishes, and not before, so an unopened link leaves nothing behind.
            </div>
            <button data-testid="cl-another" type="button" onClick={reset}
              style={{ font: "inherit", fontSize: 13, marginTop: 16, padding: "8px 14px", borderRadius: 8, border: `1px solid ${A.border}`, background: A.sidebar, color: A.ink, cursor: "pointer" }}>
              Create another
            </button>
          </div>
        )}
      </div>

      {/* ── What has been handed out ─────────────────────────────────────── */}
      {/* GTM-1a 5 — a link Jonathan minted and a signup somebody made for
          themselves are the same row in the same table, because they are the
          same object: one close link. The SOURCE column is what tells them
          apart, and the estimate beside it is the size the org said it was. */}
      <div style={{ ...SH, marginTop: 32 }}>Links handed out, and signups</div>
      {!data ? <div style={{ color: A.muted, fontSize: 13 }}>Loading…</div> :
        (data.links || []).length === 0 ? <div style={{ color: A.muted, fontSize: 13 }}>No close link has been created yet.</div> : (
          <div style={{ background: A.card, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: A.surface }}>
                  {["Organization", "Contact", "Source", "Plan", "Status", "Created", "Link"].map(h => (
                    <th key={h} style={{ textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: A.muted, padding: "10px 14px", borderBottom: `1px solid ${A.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.links || []).map(l => (
                  <tr key={l.id} data-testid="cl-row" style={{ borderBottom: `1px solid ${A.borderSub}` }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, color: A.ink }}>{l.orgName}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: A.secondary }}>
                      {l.contactName ? <div style={{ color: A.ink }}>{l.contactName}</div> : null}
                      {l.contactEmail}
                    </td>
                    <td data-testid="cl-source" style={{ padding: "10px 14px", fontSize: 12.5, color: A.secondary }}>
                      {l.signupSource === "public"
                        ? <span style={{ background: A.greenPale, border: `1px solid ${A.greenChip}`, color: A.green, borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 700 }}>Signed up</span>
                        : <span>{l.createdByName || "Console"}</span>}
                      {l.estimatedDonors != null && (
                        <div style={{ color: A.muted, fontSize: 11, marginTop: 3 }}>
                          said {l.estimatedDonors.toLocaleString("en-US")} active donors
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: A.secondary }}>{l.plan}</td>
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

// TRUST-2 — write an incident in plain language (what's affected, what we are
// doing), post updates, resolve it; and hide a What's new entry.
function TrustAdmin() {
  const [sum, setSum] = useState(null);
  const [hidden, setHidden] = useState(new Set());
  const [form, setForm] = useState({ title: "", body: "", affected: [] });
  const [upd, setUpd] = useState({});
  const [msg, setMsg] = useState("");
  const load = () => {
    adminFetch("/status/summary").then(setSum).catch(() => {});
    adminFetch("/changelog/hidden").then(d => setHidden(new Set(d.hidden || []))).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const go = async (fn) => { setMsg(""); try { await fn(); load(); } catch (e) { setMsg(errorMessage(e, "That did not save.")); } };
  const box = { background: A.surface, border: "1px solid " + A.border, borderRadius: 12, padding: 16, marginBottom: 16 };
  const field = { width: "100%", boxSizing: "border-box", padding: 8, marginBottom: 8, fontFamily: "inherit", fontSize: 13 };
  return <div>
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Open an incident</div>
      <input style={field} placeholder="What is affected, in plain words" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
      <textarea style={{ ...field, minHeight: 70 }} placeholder="What we are doing about it" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
        {(sum?.services || []).map(s => <label key={s.key}><input type="checkbox" checked={form.affected.includes(s.key)}
          onChange={e => setForm(f => ({ ...f, affected: e.target.checked ? [...f.affected, s.key] : f.affected.filter(k => k !== s.key) }))} /> {s.label}</label>)}
      </div>
      <button disabled={!form.title || !form.body} onClick={() => go(async () => { await adminFetch("/admin/incidents", { method: "POST", body: JSON.stringify(form) }); setForm({ title: "", body: "", affected: [] }); })}>Publish to /status</button>
    </div>
    {(sum?.incidents || []).map(i => <div key={i.id} style={box}>
      <div style={{ fontWeight: 700 }}>{i.title} · {i.state}{i.resolved_at ? " (resolved)" : ""}</div>
      {i.updates.map((u, k) => <div key={k} style={{ fontSize: 13, margin: "4px 0" }}>{new Date(u.created_at).toLocaleString()} · {u.body}</div>)}
      {!i.resolved_at && <div style={{ marginTop: 8 }}>
        <textarea style={{ ...field, minHeight: 50 }} placeholder="An update" value={upd[i.id] || ""} onChange={e => setUpd(x => ({ ...x, [i.id]: e.target.value }))} />
        {["identified", "monitoring", "resolved"].map(st => <button key={st} style={{ marginRight: 6 }} disabled={!upd[i.id]}
          onClick={() => go(async () => { await adminFetch(`/admin/incidents/${i.id}/update`, { method: "POST", body: JSON.stringify({ body: upd[i.id], state: st }) }); setUpd(x => ({ ...x, [i.id]: "" })); })}>Post as {st}</button>)}
      </div>}
    </div>)}
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>What's new entries</div>
      {CHANGELOG_ADMIN.map(e => <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "6px 0", borderTop: "1px solid " + A.border }}>
        <span>{e.date} · {e.title}{hidden.has(e.id) ? " (hidden)" : ""}</span>
        <button onClick={() => go(() => adminFetch(`/admin/changelog/${e.id}/hide`, { method: "POST", body: JSON.stringify({ hidden: !hidden.has(e.id) }) }))}>{hidden.has(e.id) ? "Show" : "Hide"}</button>
      </div>)}
    </div>
    {msg && <div style={{ fontSize: 13 }}>{msg}</div>}
  </div>;
}

// HELP-1 — the tickets "Ask a person" creates, replied to from here (the reply
// is emailed from support), and the questions people ask, grouped by topic.
function SupportAdmin() {
  const [t, setT] = useState(null);
  const [qs, setQs] = useState(null);
  const [sup, setSup] = useState(null);   // SUPPORT-1: what the help assistant could not answer
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState("");
  const load = () => {
    adminFetch("/admin/tickets").then(d => setT(d.tickets || [])).catch(() => setT([]));
    adminFetch("/admin/questions").then(setQs).catch(() => {});
    adminFetch("/admin/support/unanswered").then(setSup).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const reply = (id, status) => adminFetch(`/admin/tickets/${id}/reply`, { method: "POST", body: JSON.stringify({ body: draft[id] || "", status }) })
    .then(r => { setDraft(d => ({ ...d, [id]: "" })); setMsg(r && r.emailed === false ? "Saved, but the email to the customer did not go. They will see it only if they open the ticket." : r && r.emailed ? "Saved and emailed." : "Saved."); load(); }).catch(e => setMsg(errorMessage(e, "That did not send.")));
  const box = { background: A.surface, border: "1px solid " + A.border, borderRadius: 12, padding: 16, marginBottom: 16 };
  const STATUS = { open: "Open", waiting: "Waiting on customer", closed: "Closed" };
  return <div>
    <div style={{ fontWeight: 700, marginBottom: 8 }}>Tickets</div>
    {t && !t.length && <div style={box}>No tickets yet.</div>}
    {(t || []).map(k => <div key={k.id} style={box}>
      <div style={{ fontWeight: 700 }}>{k.subject} · {STATUS[k.status]}</div>
      <div style={{ fontSize: 12, opacity: 0.75, margin: "4px 0 8px" }}>{k.user_name || k.user_email} at {k.org_name} · screen {k.screen || "not given"} · {new Date(k.created_at).toLocaleString()}</div>
      {k.messages.map((m, i) => <div key={i} style={{ fontSize: 13, margin: "6px 0", whiteSpace: "pre-wrap" }}><b>{m.from_kind === "support" ? "Support" : "Customer"}:</b> {m.body}</div>)}
      {k.status !== "closed" && <div style={{ marginTop: 8 }}>
        <textarea style={{ width: "100%", boxSizing: "border-box", minHeight: 60, padding: 8, fontFamily: "inherit" }} placeholder="Reply (emailed to the customer from support)" value={draft[k.id] || ""} onChange={e => setDraft(d => ({ ...d, [k.id]: e.target.value }))} />
        <button disabled={!draft[k.id]} onClick={() => reply(k.id, "waiting")} style={{ marginRight: 6 }}>Send reply</button>
        <button onClick={() => reply(k.id, "closed")}>Close</button>
      </div>}
    </div>)}
    <div style={{ fontWeight: 700, margin: "16px 0 8px" }}>What the help assistant could not answer</div>
    {sup && <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>{sup.sentence} Last 30 days: {sup.last30?.asked || 0} asked, {sup.last30?.answered || 0} answered.</div>}
    {sup && !(sup.unanswered || []).length && <div style={box}>Nothing unanswered yet.</div>}
    {(sup?.unanswered || []).length > 0 && <div style={box} data-testid="admin-support-unanswered">
      {sup.unanswered.map((u, i) => <div key={i} style={{ display: "flex", gap: 12, fontSize: 13, padding: "4px 0", borderBottom: i < sup.unanswered.length - 1 ? "1px solid " + A.border : "none" }}>
        <b style={{ minWidth: 28, textAlign: "right" }}>{u.times}</b>
        <span style={{ flex: 1 }}>{u.question}</span>
        <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{u.surfaces.includes("site") ? (u.surfaces.length > 1 ? "app and site" : "site") : "app"} · {u.orgs} {u.orgs === 1 ? "org" : "orgs"}</span>
      </div>)}
    </div>}
    <div style={{ fontWeight: 700, margin: "16px 0 8px" }}>What Steward could not answer</div>
    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>Questions asked that none of the answers covers yet, grouped by topic. This is the roadmap.</div>
    {qs && !(qs.unanswered || []).length && <div style={box}>Nothing unanswered yet.</div>}
    {(qs?.unanswered || []).map((g, i) => <div key={"u" + i} style={box} data-testid="admin-unanswered">
      <div style={{ fontWeight: 700 }}>{g.surface} · {g.topic} · {g.n}</div>
      {(g.recent || []).map((r, k) => <div key={k} style={{ fontSize: 13 }}>{r}</div>)}
    </div>)}
    <div style={{ fontWeight: 700, margin: "16px 0 8px" }}>What people ask</div>
    {qs && <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>{qs.sentence}</div>}
    {(qs?.groups || []).map((g, i) => <div key={i} style={box}>
      <div style={{ fontWeight: 700 }}>{g.surface} · {g.topic} · {g.n}</div>
      {(g.recent || []).map((r, k) => <div key={k} style={{ fontSize: 13 }}>{r}</div>)}
    </div>)}
    {msg && <div style={{ fontSize: 13 }}>{msg}</div>}
  </div>;
}

// FIX-13 — every lead in lost_and_found_leads: Book a demo requests (source
// book-a-demo, with the size band and where their donors are today) and the
// people who downloaded a Lost & Found report. Read from the one admin route.
function LeadsAdmin() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { adminFetch("/admin/lost-and-found").then(setD).catch(e => setErr(errorMessage(e, "Could not load the leads."))); }, []);
  const box = { background: A.surface, border: "1px solid " + A.border, borderRadius: 12, padding: 16, marginBottom: 12 };
  if (err) return <div style={box}>{err}</div>;
  if (!d) return <div style={box}>Loading…</div>;
  return <div data-testid="admin-leads">
    <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>{d.leads.length} {d.leads.length === 1 ? "lead" : "leads"}, newest first. A lead is what the person typed on stewardapp.dev; no donor file ever reaches this server.</div>
    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 14 }}>By source: {(d.byRef || []).map(r => `${r.ref === "book-a-demo" ? "Book a demo" : r.ref} ${r.n}`).join(" · ") || "none yet"}</div>
    {!d.leads.length && <div style={box}>No leads yet.</div>}
    {d.leads.map(l => <div key={l.id} style={box} data-lead-ref={l.ref || "direct"}>
      <div style={{ fontWeight: 700 }}>{l.organization} · {l.ref === "book-a-demo" ? "Demo request" : "Lost & Found report"}</div>
      <div style={{ fontSize: 13, margin: "4px 0" }}>{l.name} · <a href={"mailto:" + l.email}>{l.email}</a></div>
      {(l.org_size || l.current_system) && <div style={{ fontSize: 13 }}>Active donors: {l.org_size || "not given"} · Donors today: {l.current_system || "not given"}</div>}
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Source: {l.ref || "direct"} · {new Date(l.created_at).toLocaleString()}</div>
    </div>)}
  </div>;
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
    // TRUST-2 — incidents for /status, and which What's new entries show.
    { id: "trust",    label: "Status and What's new", icon: "◌" },
    // HELP-1 — tickets from "Ask a person", and what people ask.
    { id: "support",  label: "Support", icon: "◍" },
    // FIX-13 — Book a demo requests and Lost & Found report downloads.
    { id: "leads",    label: "Leads", icon: "◎" },
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
              <span style={{ color: A.sidebar, fontSize: 13, fontWeight: 800, letterSpacing: "-0.02em" }}>S</span>
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
          {page === "metrics"   && <Metrics metrics={metrics} orgs={orgs} onRefresh={load} />}
          {page === "network"   && <NetworkReview />}
          {page === "trust"     && <TrustAdmin />}
          {page === "support"   && <SupportAdmin />}
          {page === "leads"     && <LeadsAdmin />}
        </div>
      </div>
    </div>
  );
}
