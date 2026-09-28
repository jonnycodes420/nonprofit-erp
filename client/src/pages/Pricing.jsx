import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../main";
import { apiFetch } from "../api";
// The catalogue, read straight out of the JSON the server prices against.
// See pricing.js for why it is JSON and not a module: it is the one file both
// the bundle and the Node process can read without a build plugin.
import PRICING from "../../../pricing.json";

const TIERS = PRICING.tiers;
const TALK_TO_US = PRICING.talkToUs;
const INCLUDED = PRICING.included;
const TERMS_STRIP = PRICING.termsStrip;
const YEARLY_NOTE = PRICING.yearlyNote;
const ACTIVE_DONOR_SENTENCE = PRICING.activeDonorSentence;

// ── GTM-1a 1 · ONE PLAN, PRICED BY HOW MANY DONORS YOU WORK ────────────────
//
// The old page sold two plans "split on a real line" — Core for a small shop,
// Team if you have gift officers. That line stopped being real: Moves
// management, officer portfolios and the Agent are what a small shop most
// needs, and putting them behind the bigger number meant the orgs Steward is
// for could not have them. So there is one plan, everything is in it,
// unlimited users, and the only thing that changes with size is the price.
//
// EVERY NUMBER ON THIS PAGE COMES FROM shared/pricing.js, which is the same
// list the signup route prices against and the same list `closeLink.js` builds
// its Stripe plans from. A price on a public page that disagrees with the
// price on the card is the exact defect BUILD-90 shipped a Stripe price-check
// for, and the way not to have it twice is to have one list.
//
// WHAT THIS PAGE MUST NEVER GROW (the landing page's rule, and it applies
// here for the same reason): invented social proof. No logos, no review
// scores, no testimonials, no customer counts, no "trusted by". Steward has
// real customers and can name them when they say yes; until then the page
// says what the software does and what it costs.

// FIX-2 C — this surface's colours, named once (it keeps its own palette;
// see tests/fix2-c-hex.test.js for why a public surface does).
const PAL = {
  panel: "#1a2e1f",
  sageGrey: "#6b7c72",
  mist: "#edf3ee",
  white: "#ffffff",
  mistEdge: "#dfe8e2",
  terracotta: "#b8593f",
  terraLight: "#e0a893",
};

const CREAM = "#f0ede6", INK = "#0f1a12", SAGE = "rgba(240,237,230,0.7)";
const GOLD = "#c9a84c", PANEL_BORDER = "#2d4a35", EMERALD = "#0d5c3a";

const CAL = "https://calendly.com/xjca2006/new-meeting";

// ── Live-billing plans (BUILD-24 cutover, superseded by GTM-1a) ────────────
// CHECKOUT_PLANS and BILLING_PLANS below are LEGACY and are exported because
// the in-app PlanPicker and the upgrade modal still read them for an org that
// is on one of those prices today. Nothing on THIS page renders from them any
// more. Do not add to them; add a band to shared/pricing.js.
export const CHECKOUT_PLANS = [
  {
    id: "core",
    name: "Core",
    price: 249,
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
    price: 499,
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
// pre-cutover org reactivating on its old price.
export const BILLING_PLANS = [
  {
    id: "seed",
    name: "Seed",
    price: 99,
    tagline: "For solo founders and tiny teams.",
    features: ["1 user seat", "Up to 1,000 donor records", "Full platform — CRM, grants, finance, AI", "Email support"],
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: 249,
    tagline: "For teams ready to grow.",
    features: ["Up to 5 user seats", "Up to 10,000 donor records", "Everything in the platform — nothing locked", "Priority support"],
    highlight: true,
  },
  {
    id: "impact",
    name: "Impact",
    price: 499,
    tagline: "For established orgs at scale.",
    features: ["Unlimited user seats", "Unlimited donor records", "Everything in Growth", "Dedicated onboarding call"],
    highlight: false,
  },
];

const usd = n => "$" + Number(n).toLocaleString("en-US");

function Tick() {
  return (
    <span style={{ width: 18, height: 18, marginTop: 2, background: PAL.mist, border: `1px solid ${EMERALD}`,
                   borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="9" height="7" viewBox="0 0 10 8" fill="none" aria-hidden="true">
        <path d="M1 4l3 3 5-6" stroke={EMERALD} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

export default function Pricing() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const isAuthed = !!auth?.token;
  const onTrial = isAuthed && (auth?.org?.plan === "trial" || auth?.org?.subscription_status === "trialing");

  // Monthly is the default because it is the smaller commitment and the page
  // should not push the bigger one. Yearly is one tap away and says plainly
  // what it saves.
  const [interval, setInterval] = useState("monthly");
  const yearly = interval === "yearly";

  // An org already paying should see which band it is on rather than four
  // buttons that all read "Start now". `plan` is `<tier>_<cadence>`.
  const orgPlan = String(auth?.org?.plan || "");
  const currentTier = orgPlan.includes("_") ? orgPlan.split("_")[0] : null;
  const subActive = auth?.org?.subscription_status === "active";

  const [checkingOut, setCheckingOut] = useState(null);
  const [checkoutErr, setCheckoutErr] = useState("");
  async function startCheckout(tierId) {
    setCheckoutErr("");
    setCheckingOut(tierId);
    try {
      const r = await apiFetch("/billing/create-checkout", {
        method: "POST", body: JSON.stringify({ plan: `${tierId}_${interval}` }),
      });
      if (!r?.url) throw new Error("Checkout is not available yet — please contact us.");
      window.location.href = r.url;
    } catch (e) {
      const code = e?.error || "";
      const raw = e?.message || "";
      const isConfig = code === "plan_mode_mismatch" || code === "plan_not_configured"
        || /plan_mode_mismatch|plan_not_configured|No Stripe price/i.test(raw);
      const msg = isConfig
        ? (raw || "Billing isn't configured correctly yet — reach out and we'll get you set up.")
        : (e?.status === 403 || /admin/i.test(raw))
        ? "Only an admin can change the plan. Ask your workspace admin to upgrade."
        : /internal server error/i.test(raw)
        ? "Something went wrong starting checkout. Please try again, or reach out if it keeps happening."
        : (raw || "Could not start checkout. Please try again.");
      setCheckoutErr({ id: tierId, msg });
      setCheckingOut(null);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: INK, display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 24px 72px", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Nav */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 56, background: INK, borderBottom: "1px solid "+PAL.panel, zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <span style={{ fontSize: 20, fontWeight: 400, color: CREAM, fontFamily: "'DM Serif Display',Georgia,serif", letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        {isAuthed ? (
          <Link to="/dashboard" style={{ fontSize: 13, color: SAGE, textDecoration: "none", fontWeight: 600 }}>Go to dashboard →</Link>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link to="/login" style={{ fontSize: 13, color: SAGE, textDecoration: "none" }}>Sign in</Link>
            <Link to="/signup" data-testid="pricing-nav-start" style={{ fontSize: 13, color: INK, background: CREAM, borderRadius: 8, padding: "7px 16px", textDecoration: "none", fontWeight: 700 }}>Start now</Link>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 980, width: "100%", marginTop: 56 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 12 }}>Pricing</div>
          <h1 data-testid="pricing-headline" style={{ fontSize: 38, fontWeight: 400, color: CREAM, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.15, margin: "0 0 14px" }}>
            One plan. Everything is in it.
          </h1>
          <div style={{ fontSize: 15, color: SAGE, maxWidth: 600, margin: "0 auto", lineHeight: 1.55 }}>
            The donor CRM, Volunteers and the Agent, with as many users as you like.
            No platform fee, no donor tip prompt, month to month. What you pay depends
            only on how many donors you are actually working.
          </div>
          <div data-testid="pricing-trial-line" style={{ fontSize: 13.5, color: GOLD, maxWidth: 560, margin: "16px auto 0", lineHeight: 1.55, fontWeight: 600 }}>
            Nothing is charged for your first thirty days.
          </div>
        </div>

        {onTrial && (
          <div style={{ marginBottom: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Link to="/dashboard" style={{ display: "inline-block", background: GOLD, color: INK, borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 800, textDecoration: "none" }}>
              Continue with your free trial →
            </Link>
            <div style={{ fontSize: 13, color: SAGE }}>
              You're inside your first thirty days — nothing has been charged. Your first charge date is in Settings → Billing.
            </div>
          </div>
        )}

        {/* Monthly / yearly */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 26 }}>
          <div role="group" aria-label="Billing period" data-testid="pricing-interval"
            style={{ display: "inline-flex", background: PAL.panel, border: `1px solid ${PANEL_BORDER}`, borderRadius: 99, padding: 4 }}>
            {[["monthly", "Monthly"], ["yearly", "Yearly"]].map(([id, label]) => (
              <button key={id} onClick={() => setInterval(id)} aria-pressed={interval === id}
                data-testid={"pricing-interval-" + id}
                style={{ background: interval === id ? CREAM : "transparent", color: interval === id ? INK : SAGE,
                         border: "none", borderRadius: 99, padding: "8px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 13, color: yearly ? GOLD : SAGE, fontWeight: yearly ? 700 : 400 }}>{YEARLY_NOTE}</div>
        </div>

        {/* THE ONE CARD. The bands are rows inside it, not competing plans —
            they are the same product at three sizes, and three cards would
            read as three things to choose between. */}
        <div style={{ background: CREAM, borderRadius: 18, padding: "30px 28px 28px", marginBottom: 20 }}>
          <div className="pricing-cols" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>

            {/* Left: the bands */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: PAL.sageGrey, marginBottom: 14 }}>
                What it costs
              </div>
              <div data-testid="pricing-bands" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {TIERS.map(t => {
                  const amount = yearly ? t.yearlyUsd : t.monthlyUsd;
                  const isCurrent = subActive && currentTier === t.id;
                  const busy = checkingOut === t.id;
                  const err = checkoutErr && checkoutErr.id === t.id ? checkoutErr.msg : null;
                  return (
                    <div key={t.id} data-testid={"pricing-band-" + t.id}
                      style={{ border: `1px solid ${PAL.mistEdge}`, borderRadius: 12, padding: "14px 16px", background: PAL.white }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{t.band}</span>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                          <span data-testid={"pricing-amount-" + t.id}
                            style={{ fontSize: 26, fontWeight: 800, color: INK, fontFamily: "'DM Serif Display',Georgia,serif" }}>{usd(amount)}</span>
                          <span style={{ fontSize: 13, color: PAL.sageGrey }}>{yearly ? "/year" : "/month"}</span>
                        </span>
                      </div>
                      {isAuthed && (
                        <div style={{ marginTop: 10 }}>
                          {isCurrent ? (
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: PAL.sageGrey }}>Your current plan</span>
                          ) : (
                            <button onClick={() => startCheckout(t.id)} disabled={busy}
                              style={{ background: EMERALD, border: "none", borderRadius: 9, padding: "9px 16px",
                                       color: PAL.white, fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}>
                              {busy ? "Starting checkout…" : "Choose this band →"}
                            </button>
                          )}
                          {err && <div style={{ fontSize: 12, color: PAL.terracotta, marginTop: 8, lineHeight: 1.45 }}>{err}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div data-testid="pricing-band-talk"
                  style={{ border: `1px dashed ${PAL.mistEdge}`, borderRadius: 12, padding: "14px 16px", background: "transparent",
                           display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{TALK_TO_US.band}</span>
                  <a href={CAL} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 700, color: EMERALD, textDecoration: "underline" }}>
                    {TALK_TO_US.copy}
                  </a>
                </div>
              </div>

              {/* The definition, in ONE sentence, right under the thing it
                  defines. Every number has a sentence. */}
              <p data-testid="pricing-active-donor-sentence"
                style={{ fontSize: 13, color: PAL.sageGrey, lineHeight: 1.6, margin: "14px 0 0" }}>
                {ACTIVE_DONOR_SENTENCE}
              </p>
            </div>

            {/* Right: what is in it */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: PAL.sageGrey, marginBottom: 14 }}>
                What you get, on every band
              </div>
              <div data-testid="pricing-included" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {INCLUDED.map(f => (
                  <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <Tick />
                    <span style={{ fontSize: 13.5, color: INK, lineHeight: 1.45 }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* The two actions, side by side, exactly as on the landing page. */}
          {!isAuthed && (
            <div className="pricing-ctas" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
              <button onClick={() => navigate("/signup")} data-testid="pricing-start"
                style={{ background: EMERALD, border: "none", borderRadius: 10, padding: "14px 28px", color: PAL.white, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                Start now →
              </button>
              <a href={CAL} target="_blank" rel="noreferrer" data-testid="pricing-book"
                style={{ background: "transparent", border: `1px solid ${PAL.mistEdge}`, borderRadius: 10, padding: "14px 28px", color: INK, fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
                Book a call
              </a>
            </div>
          )}
        </div>

        {/* Footer strip — short items, no sentences (BUILD-49). */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "8px 14px", fontSize: 13, color: SAGE }}>
          {[...TERMS_STRIP, "Gifts settle in your own Stripe", "Export your data anytime"].map((item, i) => (
            <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: "14px" }}>
              {i > 0 && <span aria-hidden="true" style={{ color: PANEL_BORDER }}>·</span>}
              {item}
            </span>
          ))}
        </div>
      </div>

      <style>{`@media (max-width: 760px){ .pricing-cols{ grid-template-columns: 1fr !important; gap: 26px !important; } .pricing-ctas > *{ width: 100%; text-align: center; } }`}</style>
    </div>
  );
}
