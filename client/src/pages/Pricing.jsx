import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../main";
import { apiFetch } from "../api";

// ── Live-billing plans (BUILD-24 cutover) ──────────────────────────────────
// CHECKOUT_PLANS is the source of truth for the in-app PlanPicker's real Stripe
// Checkout (POST /billing/create-checkout maps these ids → STRIPE_PRICE_CORE /
// STRIPE_PRICE_TEAM env vars). BUILD-24 repointed the in-app checkout at the
// Core/Team commercial model. Checkout goes live once those Stripe Prices exist
// and the env vars are set (scripts/create-billing-products.js provisions them);
// until then create-checkout returns a clean `plan_not_configured` message
// instead of 500-ing. The founding-partner $99 price is deliberately NOT here —
// it's off-menu, assigned privately by a super-admin.
export const CHECKOUT_PLANS = [
  {
    id: "core",
    name: "Core",
    price: 149,
    tagline: "Everything a small shop needs.",
    highlight: false,
    features: [
      "Full donor CRM + 0%-fee online giving",
      "Receipts + year-end statements",
      "Households, soft credit, planned-giving",
      "Retention workflows + reports",
    ],
  },
  {
    id: "team",
    name: "Team",
    price: 299,
    tagline: "For staffed development offices.",
    highlight: true,
    features: [
      "Everything in Core",
      "Moves management + prospect pipeline",
      "Officer portfolios + per-officer reports",
      "Solicitations report + multi-officer digests",
    ],
  },
];

// Legacy Stripe-wired set (seed/growth/impact) — retained for reference and any
// pre-cutover org reactivating on its old price. The in-app PlanPicker now uses
// CHECKOUT_PLANS (Core/Team) above; do NOT reintroduce these into the modal.
export const BILLING_PLANS = [
  {
    id: "seed",
    name: "Seed",
    price: 99,
    tagline: "For solo founders and tiny teams.",
    features: [
      "1 user seat",
      "Up to 1,000 donor records",
      "Full platform — CRM, grants, finance, AI",
      "Email support",
    ],
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: 249,
    tagline: "For teams ready to grow.",
    features: [
      "Up to 5 user seats",
      "Up to 10,000 donor records",
      "Everything in the platform — nothing locked",
      "Priority support",
    ],
    highlight: true,
  },
  {
    id: "impact",
    name: "Impact",
    price: 499,
    tagline: "For established orgs at scale.",
    features: [
      "Unlimited user seats",
      "Unlimited donor records",
      "Everything in Growth",
      "Dedicated onboarding call",
    ],
    highlight: false,
  },
];

// ── Public commercial model (what the /pricing page shows) ─────────────────
// Two plans split on Brad's real line: do you have gift officers to manage?
// Every feature listed here is LIVE in-product — except items tagged {soon},
// which render with a "coming soon" chip so the page never advertises an
// unbuilt capability (the landing/pricing honesty rule). Team's full
// white-label (custom domain / brand removal) is the one deferred item.
const PUBLIC_PLANS = [
  {
    id: "core",
    name: "Core",
    price: 149,
    tagline: "Everything a small shop needs.",
    forWho: "The full product for a 1–3 person development team.",
    highlight: false,
    features: [
      { t: "Up to 5,000 active donors · 3 users" },
      { t: "Full donor CRM + online giving on your own Stripe — 0% platform fee, no donor tip" },
      { t: "IRS-compliant receipts + year-end statements" },
      { t: "Households & soft credit, planned-giving tags" },
      { t: "Goals — Annual / Project / Capital, with roll-up" },
      { t: "Retention workflows — automated failed-card recovery + instant gift→thank alert" },
      { t: "Reports — LYBUNT, SYBUNT, Retention, Top Donors, 3-year & annual" },
      { t: "Week-in-Review weekly digest" },
      { t: "Tasks · Finance · Communications · org branding" },
      { t: "Priority support" },
    ],
  },
  {
    id: "team",
    name: "Team",
    price: 299,
    tagline: "For staffed development offices.",
    forWho: "Everything in Core, plus the major-gifts machine.",
    highlight: true,
    everythingIn: "Core",
    features: [
      { t: "Up to 25,000 active donors · 10 users (custom above)" },
      { t: "Moves management — prospect pipeline, stages, moves log, ask-vs-gift" },
      { t: "Officer portfolios + color mapping; Home Portfolio & Pipeline headers" },
      { t: "Per-officer monthly reports + solicitations report" },
      { t: "Multi-officer Week-in-Review breakdowns" },
      { t: "Full white-label — custom domain, remove Steward branding", soon: true },
      { t: "Founder-direct onboarding & support" },
    ],
  },
];

export default function Pricing() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const isAuthed = !!auth?.token;
  // A signed-in org still on its free trial already committed by signing up —
  // the primary path is into the product, not a card-first checkout (QA R1) —
  // but they can still pick a plan whenever they're ready (the plan buttons
  // start checkout below).
  const onTrial = isAuthed && (auth?.org?.plan === "trial" || auth?.org?.subscription_status === "trialing");

  // Current commercial tier (for the "Current plan" state). seed/founding roll
  // up to core; growth/impact to team — same mapping as orgPlanTier server-side.
  // Only an ACTIVE subscription counts as "current" — a canceled/read_only org
  // on the core plan should still be able to check out to reactivate it.
  const orgPlan = auth?.org?.plan;
  const currentTier = (orgPlan === "team" || orgPlan === "growth" || orgPlan === "impact") ? "team"
    : (orgPlan === "core" || orgPlan === "seed" || orgPlan === "founding") ? "core" : null;
  const subActive = auth?.org?.subscription_status === "active";
  const isCurrentPlan = (id) => subActive && currentTier === id;

  // ── Checkout wiring (BUILD-24 → this FIX) ──────────────────────────────────
  // A plan button starts a REAL Stripe Checkout (POST /billing/create-checkout,
  // which maps core→STRIPE_PRICE_CORE / team→STRIPE_PRICE_TEAM) and redirects
  // the browser to the returned session URL. success_url/cancel_url are set
  // server-side (→ /dashboard?subscribed=true / back to /pricing); the org's
  // tier actually flips via the billing webhook, not here.
  const [checkingOut, setCheckingOut] = useState(null); // plan id in flight
  const [checkoutErr, setCheckoutErr] = useState("");    // {id, msg}
  async function startCheckout(planId) {
    setCheckoutErr("");
    setCheckingOut(planId);
    try {
      const r = await apiFetch("/billing/create-checkout", { method: "POST", body: JSON.stringify({ plan: planId }) });
      if (!r?.url) throw new Error("Checkout is not available yet — please contact us.");
      window.location.href = r.url;
    } catch (e) {
      const code = e?.error || "";
      const raw = e?.message || "";
      // Turn the known backend states into human copy; never a dead button and
      // NEVER a raw 500 / Stripe internals. The typed billing-config errors
      // (plan_mode_mismatch / plan_not_configured) already carry clean,
      // admin-facing copy from the server — prefer it verbatim.
      const isConfig = code === "plan_mode_mismatch" || code === "plan_not_configured"
        || /plan_mode_mismatch|plan_not_configured|No Stripe price/i.test(raw);
      const msg = isConfig
        ? (raw || "Billing isn't configured correctly yet — reach out and we'll get you set up.")
        : code === "founding_forbidden"
        ? "That plan is assigned privately."
        : (e?.status === 403 || /admin/i.test(raw))
        ? "Only an admin can change the plan. Ask your workspace admin to upgrade."
        : /internal server error/i.test(raw)
        ? "Something went wrong starting checkout. Please try again, or reach out if it keeps happening."
        : (raw || "Could not start checkout. Please try again.");
      setCheckoutErr({ id: planId, msg });
      setCheckingOut(null);
    }
  }

  const CAL = "https://calendly.com/xjca2006/new-meeting";

  const cream = "#f0ede6", ink = "#0f1a12", sage = "#8fa896", gold = "#c9a84c";
  const panel = "#1a2e1f", panelBorder = "#2d4a35", green = "#1a6b4a", emerald = "#10b981";

  return (
    <div style={{ minHeight: "100vh", background: ink, display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 24px 72px", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Nav */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 56, background: ink, borderBottom: "1px solid #1a2e1f", zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <span style={{ fontSize: 20, fontWeight: 400, color: cream, fontFamily: "'DM Serif Display',Georgia,serif", letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        {isAuthed ? (
          <Link to="/dashboard" style={{ fontSize: 13, color: sage, textDecoration: "none", fontWeight: 600 }}>Go to dashboard →</Link>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link to="/login" style={{ fontSize: 13, color: sage, textDecoration: "none" }}>Sign in</Link>
            <Link to="/signup" style={{ fontSize: 13, color: ink, background: cream, borderRadius: 8, padding: "7px 16px", textDecoration: "none", fontWeight: 700 }}>Start free trial</Link>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 980, width: "100%", marginTop: 56 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: gold, textTransform: "uppercase", marginBottom: 12 }}>Pricing</div>
          <div style={{ fontSize: 38, fontWeight: 400, color: cream, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.15, marginBottom: 14 }}>
            Two plans, split on a real line.
          </div>
          <div style={{ fontSize: 15, color: sage, maxWidth: 560, margin: "0 auto", lineHeight: 1.55 }}>
            The question is simple: <span style={{ color: cream, fontWeight: 600 }}>do you have gift officers to manage?</span> If not, Core is the whole product. If you do — portfolios, a moves pipeline, per-officer oversight — that's Team.
          </div>
        </div>

        {/* Active-donor promise */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <span style={{ display: "inline-block", fontSize: 12.5, color: cream, background: panel, border: `1px solid ${panelBorder}`, borderRadius: 99, padding: "7px 16px" }}>
            Bands count <b>active donors</b> — the donors you're actually working, not every dead record on file.
          </span>
        </div>

        {onTrial && (
          <div style={{ marginBottom: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Link to="/dashboard" style={{ display: "inline-block", background: gold, color: ink, borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 800, textDecoration: "none" }}>
              Continue with your free trial →
            </Link>
            <div style={{ fontSize: 13, color: sage }}>
              You're on your free trial — no card needed. Pick a plan whenever you're ready.
            </div>
          </div>
        )}

        {/* Plan cards */}
        <div className="pricing-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 20, marginBottom: 28 }}>
          {PUBLIC_PLANS.map(plan => (
            <div key={plan.id} style={{
              background: plan.highlight ? cream : panel,
              border: plan.highlight ? `2px solid ${gold}` : `1px solid ${panelBorder}`,
              borderRadius: 18,
              padding: "30px 28px 32px",
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}>
              {plan.highlight && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: gold, color: ink, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 99, padding: "4px 12px", whiteSpace: "nowrap" }}>
                  Staffed offices
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: plan.highlight ? "#6b7c72" : sage, marginBottom: 8 }}>
                {plan.name}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 6 }}>
                <span style={{ fontSize: 40, fontWeight: 800, color: plan.highlight ? ink : cream, fontFamily: "'DM Serif Display',Georgia,serif" }}>${plan.price}</span>
                <span style={{ fontSize: 14, color: plan.highlight ? "#6b7c72" : sage }}>/month</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: plan.highlight ? ink : cream, marginBottom: 4 }}>{plan.tagline}</div>
              <div style={{ fontSize: 13, color: plan.highlight ? "#6b7c72" : sage, marginBottom: 22, lineHeight: 1.45 }}>
                {plan.forWho}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 26, flex: 1 }}>
                {plan.features.map(f => (
                  <div key={f.t} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ width: 18, height: 18, marginTop: 1, background: plan.highlight ? "#edf3ee" : ink, border: `1px solid ${emerald}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="9" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke={emerald} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <span style={{ fontSize: 13, color: plan.highlight ? ink : sage, lineHeight: 1.45 }}>
                      {f.t}
                      {f.soon && (
                        <span style={{ marginLeft: 7, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: gold, border: `1px solid ${plan.highlight ? "#d9c48a" : "#5a4d29"}`, borderRadius: 99, padding: "1px 7px", whiteSpace: "nowrap", verticalAlign: "middle" }}>Coming soon</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              {(() => {
                const base = {
                  background: plan.highlight ? green : "transparent",
                  border: plan.highlight ? "none" : `1px solid ${panelBorder}`,
                  borderRadius: 10, padding: "13px 20px",
                  color: plan.highlight ? "#fff" : sage,
                  fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.15s",
                };
                if (!isAuthed) {
                  return <button onClick={() => navigate("/signup")} style={base}>Start free trial →</button>;
                }
                if (isCurrentPlan(plan.id)) {
                  return (
                    <button disabled style={{ ...base, background: plan.highlight ? "#dfe8e2" : "transparent", color: plan.highlight ? "#6b7c72" : sage, cursor: "default", opacity: 0.85 }}>
                      Current plan
                    </button>
                  );
                }
                const busy = checkingOut === plan.id;
                const label = plan.id === "team" ? "Upgrade to Team →" : `Choose ${plan.name} →`;
                const err = checkoutErr && checkoutErr.id === plan.id ? checkoutErr.msg : null;
                return (
                  <>
                    <button
                      onClick={() => startCheckout(plan.id)}
                      disabled={busy}
                      style={{ ...base, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
                    >
                      {busy ? "Starting checkout…" : label}
                    </button>
                    {err && (
                      <div style={{ fontSize: 12, color: plan.highlight ? "#b8593f" : "#e0a893", marginTop: 10, lineHeight: 1.45 }}>{err}</div>
                    )}
                  </>
                );
              })()}
            </div>
          ))}
        </div>

        {/* Foundation Portal add-on */}
        <div style={{ background: panel, border: `1px solid ${panelBorder}`, borderRadius: 16, padding: "22px 26px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 40 }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: cream }}>Foundation Portal</span>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: gold, border: `1px solid #5a4d29`, borderRadius: 99, padding: "2px 8px" }}>Opt-in add-on · any plan</span>
            </div>
            <div style={{ fontSize: 13, color: sage, lineHeight: 1.5 }}>
              Bring your own foundation records plus full grant-lifecycle management — deadlines, LOIs, requested-vs-awarded, reporting. À la carte; turn it on when you decide to pursue foundation funding.
            </div>
          </div>
          <a href={CAL} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: cream, background: "transparent", border: `1px solid ${panelBorder}`, borderRadius: 10, padding: "11px 18px", textDecoration: "none", whiteSpace: "nowrap" }}>
            Ask about the add-on →
          </a>
        </div>

        {/* The answer to "free" */}
        <div style={{ background: "#12241a", border: `1px solid ${panelBorder}`, borderLeft: `3px solid ${gold}`, borderRadius: 14, padding: "26px 30px", marginBottom: 32 }}>
          <div style={{ fontSize: 15.5, color: cream, lineHeight: 1.65, fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400 }}>
            “Free platforms fund ‘free’ by asking your donors for a tip, or by locking the CRM you actually need behind an upgrade. Steward is a flat monthly price with everything a small shop needs included, cheaper than the real CRMs, your gifts land in your own account, and we count the donors you're actually working — not every dead record on file.”
          </div>
          <div style={{ fontSize: 14, color: gold, marginTop: 14, fontWeight: 700 }}>
            You keep every dollar. We just help you keep every donor.
          </div>
        </div>

        {/* Footer note */}
        <div style={{ textAlign: "center", fontSize: 13, color: sage }}>
          Every plan starts with a free trial — no card required.{" "}
          <a href={CAL} target="_blank" rel="noreferrer" style={{ color: cream, textDecoration: "none", fontWeight: 600 }}>
            Questions? Book a demo →
          </a>
        </div>
      </div>

      <style>{`@media (max-width: 720px){ .pricing-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
