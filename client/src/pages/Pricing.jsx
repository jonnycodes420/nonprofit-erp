import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../main";
import { apiFetch } from "../api";
// The catalogue, read straight out of the JSON the server prices against.
// See pricing.js for why it is JSON and not a module: it is the one file both
// the bundle and the Node process can read without a build plugin.
import PRICING from "../../../pricing.json";

const TIERS = PRICING.tiers;
const TALK_TO_US = PRICING.talkToUs;
const INCLUDED_GROUPS = PRICING.includedGroups;
const EXTRAS = PRICING.extras;
const YEARLY_NOTE = PRICING.yearlyNote;
const ACTIVE_DONOR_SENTENCE = PRICING.activeDonorSentence;
const COPY = {
  headline: PRICING.headline, lede: PRICING.lede, yearlyPill: PRICING.yearlyPill,
  monthToMonth: PRICING.monthToMonth, featuredBadge: PRICING.featuredBadge,
  startCta: PRICING.startCta, includedHeading: PRICING.includedHeading,
};

// ── FIX-4 6 · THE APPROVED PRICING SECTION ─────────────────────────────────
//
// This page is `docs/landing/pricing-mockup.html`, in React, with the live
// checkout wiring kept. What changed from the page it replaces, and why each
// change is the point rather than a preference:
//
//   · CREAM GROUND, not ink. The pricing page was the only public surface
//     painted dark, so the moment somebody clicked Pricing the product
//     appeared to change brand. The rest of the ground rules are unchanged:
//     ink text, emerald for the one action, brass for emphasis only.
//   · THREE CARDS, NOT THREE ROWS IN ONE CARD. The old page argued that
//     three cards would read as three products. They do not — they read as
//     three sizes, which is what they are — and the row layout made the
//     middle band, where most organisations land, the least visible thing on
//     the page. Sapling is the featured card and says so on its face.
//   · THE TIERS HAVE NAMES. Seed, Sapling, Orchard, Forest, with the donor
//     count UNDER the name everywhere. A band sentence is a specification;
//     a name is something somebody can say on a call.
//   · FOREST IS A BAR, NOT A CARD. Above the top band there is no price,
//     there is a conversation, and giving that its own card would imply a
//     fourth thing to compare.
//
// WHAT IT MUST NEVER GROW (the landing page's rule, and it applies here for
// the same reason): invented social proof. No logos, no review scores, no
// testimonials, no customer counts, no "trusted by".
//
// EVERY NUMBER COMES FROM pricing.json, which is the same list the signup
// route prices against and the same list closeLink.js builds its Stripe
// plans from. A price on a public page that disagrees with the price on the
// card is the exact defect BUILD-90 shipped a Stripe price-check for.

// FIX-2 C — this surface's colours, named once (it keeps its own palette;
// a public surface does, and the brand allowlist documents each one).
const INK = "#0f1a12";
const CREAM = "#f0ede6";
const GROUND = "#f7f5f0";        // the page ground — T.ground's value
const CREAM_EDGE = "#e8e4db";    // card hairline
const TOGGLE_BG = "#ece8df";     // the toggle's tray
const PILL_BG = "#f3e9cc";       // the brass wash behind "two months free"
const PILL_INK = "#5c4710";      // AA on that wash
const GREY = "#5a554f";          // the landing page's muted grey
const EXTRA_INK = "#3e3a35";     // the terms strip
const BRASS = "#c9a84c";
const EMERALD = "#0d5c3a";
const WHITE = "#ffffff";
const TERRACOTTA = "#b8593f";

const CAL = "https://calendly.com/xjca2006/new-meeting";

const SERIF = "'DM Serif Display',Georgia,serif";

// FIX-32: the retired Core/Team and Seed/Growth/Impact lists that lived
// here are gone. pricing.json is the one price list; PlanPicker reads it too.

const usd = n => "$" + Number(n).toLocaleString("en-US");

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

  // THE PAGE OWNS ITS GROUND. index.html paints `body` ink, which was right
  // while every public page was ink; this one is cream, and on a phone the
  // overscroll rubber-band showed a black bar above and below a cream page.
  // Restored on unmount so the authenticated shell — whose sidebar IS ink —
  // is unaffected.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = GROUND;
    return () => { document.body.style.background = prev; };
  }, []);

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
      if (!r?.url) throw new Error("Checkout is not available yet, please contact us.");
      window.location.href = r.url;
    } catch (e) {
      const code = e?.error || "";
      const raw = e?.message || "";
      const isConfig = code === "plan_mode_mismatch" || code === "plan_not_configured"
        || /plan_mode_mismatch|plan_not_configured|No Stripe price/i.test(raw);
      const msg = isConfig
        ? (raw || "Billing isn't configured correctly yet, reach out and we'll get you set up.")
        : (e?.status === 403 || /admin/i.test(raw))
        ? "Only an admin can change the plan. Ask your workspace admin to upgrade."
        : /internal server error/i.test(raw)
        ? "Something went wrong starting checkout. Please try again, or reach out if it keeps happening."
        : (raw || "Could not start checkout. Please try again.");
      setCheckoutErr({ id: tierId, msg });
      setCheckingOut(null);
    }
  }

  // The card's money line. Yearly shows the year's figure with the monthly
  // equivalent underneath, because "$2,990" without "that is $249 a month"
  // is a number people have to do arithmetic on before they can compare it.
  const amountFor = t => (yearly ? t.yearlyUsd : t.monthlyUsd);
  const perFor = () => (yearly ? "a year" : "a month");
  const subFor = t => (yearly
    ? `$${Math.round(t.yearlyUsd / 12)} a month, billed yearly`
    : COPY.monthToMonth);

  function Card({ t }) {
    const featured = !!t.featured;
    const isCurrent = subActive && currentTier === t.id;
    const busy = checkingOut === t.id;
    const err = checkoutErr && checkoutErr.id === t.id ? checkoutErr.msg : null;
    const dim = featured ? "rgba(240,237,230,0.72)" : GREY;
    return (
      <div data-testid={"pricing-band-" + t.id}
        style={{
          padding: "36px 34px 34px", borderRadius: 22, display: "flex", flexDirection: "column", gap: 10,
          background: featured ? INK : WHITE, color: featured ? CREAM : INK,
          border: featured ? "none" : `1px solid ${CREAM_EDGE}`,
          boxShadow: featured ? "0 30px 60px -24px rgba(15,26,18,.45)" : "none",
        }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 28, gap: 10 }}>
          <span data-testid={"pricing-name-" + t.id}
            style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, letterSpacing: "-0.4px" }}>{t.name}</span>
          {featured && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 99, background: BRASS, color: INK, whiteSpace: "nowrap" }}>
              {COPY.featuredBadge}
            </span>
          )}
        </div>
        {/* THE DONOR COUNT, ALWAYS UNDER THE NAME. */}
        <span data-testid={"pricing-band-label-" + t.id} style={{ fontSize: 16, fontWeight: 600 }}>{t.band}</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, paddingTop: 8, flexWrap: "wrap" }}>
          <span data-testid={"pricing-amount-" + t.id}
            style={{ fontFamily: SERIF, fontSize: 64, fontWeight: 600, letterSpacing: "-1.6px", lineHeight: 1 }}>
            {usd(amountFor(t))}
          </span>
          <span style={{ fontSize: 15, color: dim }}>{perFor()}</span>
        </div>
        <span style={{ fontSize: 15, color: dim }}>{subFor(t)}</span>

        {isAuthed && !isCurrent && (
          <button onClick={() => startCheckout(t.id)} disabled={busy} data-testid={"pricing-choose-" + t.id}
            style={{
              marginTop: 22, textAlign: "center", padding: 16, borderRadius: 12, fontSize: 16, fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1,
              background: featured ? EMERALD : "transparent", color: featured ? WHITE : INK,
              border: featured ? `1.5px solid ${EMERALD}` : `1.5px solid ${INK}`,
            }}>
            {busy ? "Starting checkout…" : "Choose " + t.name}
          </button>
        )}
        {isAuthed && isCurrent && (
          <span style={{ marginTop: 22, textAlign: "center", padding: 16, fontSize: 15, fontWeight: 700, color: dim }}>
            Your current plan
          </span>
        )}
        {!isAuthed && (
          <Link to="/signup" data-testid={"pricing-start-" + t.id}
            style={{
              marginTop: 22, textAlign: "center", padding: 16, borderRadius: 12, fontSize: 16, fontWeight: 600,
              textDecoration: "none",
              background: featured ? EMERALD : "transparent", color: featured ? WHITE : INK,
              border: featured ? `1.5px solid ${EMERALD}` : `1.5px solid ${INK}`,
            }}>
            {COPY.startCta}
          </Link>
        )}
        {err && <div style={{ fontSize: 13, color: featured ? "#e0a893" : TERRACOTTA, marginTop: 10, lineHeight: 1.45 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: GROUND, color: INK, fontFamily: "'Figtree','DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Nav — cream, like the rest of the page. */}
      <div className="pr-nav" style={{ position: "sticky", top: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "0 32px", height: 56, background: GROUND, borderBottom: `1px solid ${CREAM_EDGE}`, zIndex: 100, gap: 12 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none", flexShrink: 0 }}>
          <span style={{ fontSize: 20, fontWeight: 400, color: INK, fontFamily: SERIF, letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        {isAuthed ? (
          <Link to="/dashboard" style={{ fontSize: 13, color: GREY, textDecoration: "none", fontWeight: 600 }}>Go to dashboard →</Link>
        ) : (
          <div className="pr-navwrap" style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
            <Link to="/login" style={{ fontSize: 13, color: GREY, textDecoration: "none", whiteSpace: "nowrap" }}>Sign in</Link>
            <a href={CAL} target="_blank" rel="noreferrer" data-testid="pricing-nav-book" className="pr-nav-book"
              style={{ fontSize: 13, color: INK, border: `1px solid ${INK}`, borderRadius: 8, padding: "6px 15px", textDecoration: "none", fontWeight: 700, whiteSpace: "nowrap" }}>
              Book a call
            </a>
            <Link to="/signup" data-testid="pricing-nav-start"
              style={{ fontSize: 13, color: CREAM, background: INK, borderRadius: 8, padding: "7px 16px", textDecoration: "none", fontWeight: 700, whiteSpace: "nowrap" }}>
              Start now
            </Link>
          </div>
        )}
      </div>

      <section id="pricing" data-testid="pricing-section"
        style={{ maxWidth: 1200, margin: "0 auto", padding: "112px 24px 96px",
                 display: "flex", flexDirection: "column", alignItems: "center", gap: 56 }}>

        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, textAlign: "center", maxWidth: 880 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "1.8px", textTransform: "uppercase", color: GREY }}>Pricing</span>
          <h2 data-testid="pricing-headline" className="pr-h2"
            style={{ margin: 0, fontFamily: SERIF, fontSize: 64, lineHeight: 1.04, fontWeight: 600, letterSpacing: "-1.4px" }}>
            {COPY.headline}
          </h2>
          <p style={{ margin: 0, fontSize: 19, lineHeight: 1.55, color: GREY, maxWidth: 680 }}>{COPY.lede}</p>
          <div data-testid="pricing-trial-line" style={{ fontSize: 15, color: PILL_INK, fontWeight: 700 }}>
            Nothing is charged for your first thirty days.
          </div>
        </div>

        {onTrial && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Link to="/dashboard" style={{ display: "inline-block", background: EMERALD, color: WHITE, borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
              Continue with your free trial →
            </Link>
            <div style={{ fontSize: 13, color: GREY }}>
              You&apos;re inside your first thirty days, and nothing has been charged. Your first charge date is in Settings, under Billing.
            </div>
          </div>
        )}

        {/* Monthly / yearly — centred, and the selected tab is ink. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div role="group" aria-label="Billing period" data-testid="pricing-interval"
            style={{ display: "flex", padding: 5, background: TOGGLE_BG, borderRadius: 14 }}>
            {[["monthly", "Monthly"], ["yearly", "Yearly"]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setInterval(id)} aria-pressed={interval === id}
                data-testid={"pricing-interval-" + id}
                style={{ padding: "11px 26px", border: "none", borderRadius: 10, cursor: "pointer",
                         fontFamily: "inherit", fontSize: 15, fontWeight: 600,
                         background: interval === id ? INK : "transparent",
                         color: interval === id ? CREAM : GREY }}>
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, padding: "6px 12px", borderRadius: 99, background: PILL_BG, color: PILL_INK }}>
            {COPY.yearlyPill}
          </span>
        </div>

        {/* The three cards. */}
        <div className="pr-cards" data-testid="pricing-bands"
          style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 20 }}>
          {TIERS.map(t => <Card key={t.id} t={t} />)}
        </div>

        {/* Forest — a bar, because above the top band there is no price. */}
        <div className="pr-forest" data-testid="pricing-band-talk"
          style={{ width: "100%", padding: "26px 32px", borderRadius: 18, background: WHITE, border: `1px solid ${CREAM_EDGE}`,
                   display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
            <span data-testid="pricing-name-talk" style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600 }}>{TALK_TO_US.name}</span>
            <span style={{ fontSize: 17, color: GREY }}>{TALK_TO_US.line}</span>
          </div>
          <a href={CAL} target="_blank" rel="noreferrer" data-testid="pricing-book"
            style={{ padding: "14px 22px", borderRadius: 12, fontSize: 16, fontWeight: 600, textDecoration: "none",
                     border: `1.5px solid ${INK}`, color: INK, whiteSpace: "nowrap" }}>
            {TALK_TO_US.cta}
          </a>
        </div>

        {/* What is in it — four groups, on every plan. */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 28, paddingTop: 24 }}>
          <h3 style={{ margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 600, textAlign: "center" }}>{COPY.includedHeading}</h3>
          <div className="pr-groups" data-testid="pricing-included"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 20 }}>
            {INCLUDED_GROUPS.map(g => (
              <div key={g.name} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 18, borderTop: `2px solid ${INK}` }}>
                <b style={{ fontSize: 18 }}>{g.name}</b>
                <span style={{ fontSize: 15, lineHeight: 1.55, color: GREY }}>{g.copy}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "12px 36px", fontSize: 15, color: EXTRA_INK }}>
            {EXTRAS.map(x => <span key={x}>{x}</span>)}
          </div>
        </div>

        {/* The definition, in ONE sentence. Every number has a sentence, and
            "active donors" is the number this whole page is priced on. */}
        <p data-testid="pricing-active-donor-sentence"
          style={{ fontSize: 14, color: GREY, lineHeight: 1.6, margin: 0, maxWidth: 680, textAlign: "center" }}>
          {ACTIVE_DONOR_SENTENCE} {YEARLY_NOTE}
        </p>

        {!isAuthed && (
          <div className="pr-ctas" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => navigate("/signup")} data-testid="pricing-start"
              style={{ background: EMERALD, border: "none", borderRadius: 12, padding: "16px 30px", color: WHITE, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Start now →
            </button>
            <a href={CAL} target="_blank" rel="noreferrer" data-testid="pricing-book-bottom"
              style={{ background: "transparent", border: `1.5px solid ${INK}`, borderRadius: 12, padding: "16px 30px", color: INK, fontSize: 16, fontWeight: 600, textDecoration: "none" }}>
              Book a call
            </a>
          </div>
        )}
      </section>

      <style>{`
        /* The header at 390. Three controls and a wordmark do not fit in
           390px at desktop sizes, and they were overlapping: the wordmark sat
           on top of "Sign in". Book a call comes out of the bar (it is on the
           Forest row and in the bottom pair, twice more on the same page) and
           the rest tighten. Sign in STAYS, because a returning customer on a
           phone is exactly who needs it. */
        @media (max-width: 560px){
          .pr-nav{ padding: 0 16px !important; gap: 8px !important; }
          .pr-navwrap{ gap: 10px !important; }
          .pr-nav-book{ display: none !important; }
        }
        @media (max-width: 900px){
          .pr-h2{ font-size: 44px !important; letter-spacing: -0.8px !important; }
          .pr-cards, .pr-groups{ grid-template-columns: 1fr !important; }
          .pr-forest{ flex-direction: column; align-items: flex-start !important; }
          .pr-ctas > *{ width: 100%; text-align: center; box-sizing: border-box; }
        }
      `}</style>
    </div>
  );
}
