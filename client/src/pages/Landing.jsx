import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// ── Landing (BUILD-07 rebuild, 2026-07-17) ─────────────────────────────────
// Register: warm-serious, book-set, five-color palette only. Every number and
// capability on this page is cross-checked against CLAUDE.md reality — no
// invented testimonials, no implied scale, no marketing verbs. All product
// images are captures of the real deployed product (lp-home / lp-queue from
// prod at 2x; lp-receipt is the live GET /receipts/preview PDF rendered to
// PNG). The hero's goal-bar animation overlays the REAL bar's measured
// geometry and ends at its real value — it draws the true state, it doesn't
// invent one.

const C = {
  ink:    "#0f1a12",
  dark2:  "#1a2e1f",
  dark3:  "#2d4a35",
  cream:  "#f0ede6",
  cream2: "#e8e4db",
  cream3: "#ddd9d0",
  white:  "#ffffff",
  gold:   "#c9a84c",
  terra:  "#b8593f",
  sage:   "#8fa896",
  greenDk:"#0d5c3a",
  greenMd:"#1a6b4a",
  ink3:   "#6b6560",
};

const CALENDLY_URL = "https://calendly.com/xjca2006/new-meeting";
const FOUNDER_MAILTO = "mailto:jonathan@stewardapp.dev";

// Measured geometry of the goal progress bar inside lp-home.png (captured at
// 1440×900): track fill region x=281 y=204 w=149 h=11 → percentages of the
// image box. The overlay repaints exactly that region and animates the fill
// from empty to its true 22% — see .lp-goal-overlay in the style block.
const GOAL_OVERLAY = { left: "19.514%", top: "22.667%", width: "10.347%", height: "1.222%" };

function CalendlyModal({ onClose }) {
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const s = document.createElement("script");
    s.src = "https://assets.calendly.com/assets/external/widget.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,26,18,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div style={{
        background: C.cream, borderRadius: 18, width: "100%", maxWidth: 680,
        boxShadow: "0 24px 80px rgba(0,0,0,0.25)", border: `1px solid ${C.cream3}`, overflow: "hidden",
      }}>
        <div style={{ padding: "22px 26px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 23, color: C.ink }}>
            Pick a time — it's me you'll be talking to
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, color: C.ink3, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: "4px 26px 0", fontSize: 13, color: C.ink3 }}>
          Or just write: <a href={FOUNDER_MAILTO} style={{ color: C.greenDk, textDecoration: "underline", textUnderlineOffset: 3 }}>jonathan@stewardapp.dev</a>
        </div>
        <div className="calendly-inline-widget" data-url={CALENDLY_URL} style={{ minWidth: 320, height: 640 }} />
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [showCal, setShowCal] = useState(false);

  useEffect(() => {
    document.body.style.overflow = showCal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showCal]);

  const GoldBtn = ({ children, onClick, big }) => (
    <button onClick={onClick} className="lp-goldbtn" style={{
      background: C.gold, color: C.ink, border: "none",
      padding: big ? "15px 32px" : "13px 26px", borderRadius: 10,
      fontSize: big ? 16 : 15, fontWeight: 700, cursor: "pointer",
      fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.01em",
    }}>{children}</button>
  );
  const QuietBtn = ({ children, onClick, big, onDark }) => (
    <button onClick={onClick} className="lp-quietbtn" style={{
      background: "transparent", color: onDark ? C.cream : C.ink,
      border: `1.5px solid ${onDark ? C.dark3 : C.cream3}`,
      padding: big ? "14px 30px" : "12px 24px", borderRadius: 10,
      fontSize: big ? 16 : 15, fontWeight: 600, cursor: "pointer",
      fontFamily: "'DM Sans',sans-serif",
    }}>{children}</button>
  );
  const Eyebrow = ({ children, onDark }) => (
    <div style={{
      fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em",
      color: onDark ? C.gold : C.greenDk, marginBottom: 16, fontFamily: "'DM Sans',sans-serif",
    }}>{children}</div>
  );

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: ${C.cream}; overflow-x: hidden; }
        .lp { font-family: 'DM Sans', sans-serif; color: ${C.ink}; line-height: 1.65; overflow-x: hidden; }
        .lp a { text-decoration: none; color: inherit; }
        .lp ::selection { background: ${C.greenDk}22; }
        .lp-serif { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; letter-spacing: -0.02em; }
        .lp-goldbtn { transition: transform .12s ease, box-shadow .12s ease; box-shadow: 0 2px 14px rgba(201,168,76,0.35); }
        .lp-goldbtn:hover { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(201,168,76,0.45); }
        .lp-quietbtn { transition: border-color .15s, background .15s; }
        .lp-quietbtn:hover { border-color: ${C.gold}; }
        .lp-navlink { font-size: 14px; color: ${C.ink3}; transition: color .15s; }
        .lp-navlink:hover { color: ${C.ink}; }

        .lp-hero-grid { display: grid; grid-template-columns: 1.02fr 1fr; gap: 60px; align-items: center; }

        /* Hero screenshot frame + the one deliberate motion on the page:
           repaint the real goal bar's measured region and draw its fill in,
           ending exactly at the true value in the capture. ~6s loop; fades
           out to reveal the identical real pixels, so the loop reads as the
           bar quietly ticking up. Gone entirely under reduced motion. */
        .lp-shot-wrap { position: relative; }
        .lp-shot { width: 100%; display: block; border-radius: 14px; border: 1px solid ${C.cream3}; box-shadow: 0 24px 70px rgba(15,26,18,0.18), 0 4px 18px rgba(15,26,18,0.08); }
        .lp-goal-overlay { position: absolute; background: #0a120c; border-radius: 99px; overflow: hidden; animation: lpGoalFade 6s ease-in-out infinite; }
        .lp-goal-overlay i { position: absolute; top: 0; left: 0; bottom: 0; width: 0; background: linear-gradient(90deg, ${C.gold}, #c59749); border-radius: 99px; animation: lpGoalFill 6s ease-in-out infinite; }
        @keyframes lpGoalFade { 0% {opacity:0} 8% {opacity:1} 78% {opacity:1} 92% {opacity:0} 100% {opacity:0} }
        @keyframes lpGoalFill { 0%, 12% {width:0} 55% {width:100%} 100% {width:100%} }
        @media (prefers-reduced-motion: reduce) {
          .lp-goal-overlay, .lp-goal-overlay i { animation: none; display: none; }
          .lp-goldbtn, .lp-goldbtn:hover { transform: none; }
        }

        .lp-section { padding: 104px 64px; }
        .lp-narrow { max-width: 720px; margin: 0 auto; }
        .lp-wide { max-width: 1140px; margin: 0 auto; }

        /* Moments: alternating prose + real capture */
        .lp-moment { display: grid; grid-template-columns: 5fr 6fr; gap: 64px; align-items: center; }
        .lp-moment.lp-flip { grid-template-columns: 6fr 5fr; }
        .lp-moment.lp-flip .lp-moment-text { order: 2; }
        .lp-moment.lp-flip .lp-moment-media { order: 1; }
        .lp-moment + .lp-moment { margin-top: 120px; }
        .lp-moment-img { width: 100%; display: block; border-radius: 12px; border: 1px solid ${C.cream3}; box-shadow: 0 16px 48px rgba(15,26,18,0.12); }
        .lp-caption { font-size: 12px; color: ${C.ink3}; margin-top: 12px; }

        /* The real dunning email, set like an email */
        .lp-email { background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 12px; box-shadow: 0 16px 48px rgba(15,26,18,0.12); overflow: hidden; }
        .lp-email-head { padding: 16px 22px; border-bottom: 1px solid ${C.cream2}; font-size: 13px; color: ${C.ink3}; line-height: 1.7; }
        .lp-email-body { padding: 22px; font-size: 14px; color: #2d2d2d; line-height: 1.75; }
        .lp-email-body p + p { margin-top: 13px; }

        @media (max-width: 768px) {
          .lp-section { padding: 64px 22px; }
          .lp-hero-grid { grid-template-columns: 1fr; gap: 44px; }
          .lp-nav { padding: 0 22px !important; }
          .lp-nav-pricing { display: none; }
          .lp-h1 { font-size: 42px !important; }
          .lp-moment, .lp-moment.lp-flip { grid-template-columns: 1fr; gap: 28px; }
          .lp-moment.lp-flip .lp-moment-text { order: 1; }
          .lp-moment.lp-flip .lp-moment-media { order: 2; }
          .lp-moment + .lp-moment { margin-top: 72px; }
        }
      `}</style>

      {showCal && <CalendlyModal onClose={() => setShowCal(false)} />}

      <div className="lp">

        {/* ── Nav — quiet, not sticky; the page is the pitch ── */}
        <nav className="lp-nav" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 64px", height: 68, borderBottom: `1px solid ${C.cream2}`,
        }}>
          <span className="lp-serif" style={{ fontSize: 22, color: C.ink }}>Steward</span>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <a href="/pricing" className="lp-navlink lp-nav-pricing">Pricing</a>
            <a href="/login" className="lp-navlink">Log in</a>
            <GoldBtn onClick={() => navigate("/signup")}>Start free</GoldBtn>
          </div>
        </nav>

        {/* ── 1. Hero ── */}
        <section className="lp-section" style={{ paddingTop: 88, paddingBottom: 96 }}>
          <div className="lp-wide">
            <div className="lp-hero-grid">
              <div>
                <h1 className="lp-serif lp-h1" style={{ fontSize: "clamp(44px, 4.8vw, 72px)", lineHeight: 1.06, color: C.ink, marginBottom: 26 }}>
                  Donors don't leave.<br />
                  They drift.<br />
                  Steward{" "}
                  <span style={{ borderBottom: `4px solid ${C.gold}`, paddingBottom: 2 }}>notices.</span>
                </h1>
                <p style={{ fontSize: 17.5, color: "#2d2d2d", lineHeight: 1.75, maxWidth: 480, marginBottom: 34 }}>
                  <strong>0% platform fees</strong> — gifts settle in your own Stripe account.{" "}
                  <strong>One flat monthly price.</strong> And the <strong>20–30% of recurring giving</strong>{" "}
                  most nonprofits silently lose to failed cards — noticed, and recovered.
                </p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
                  <GoldBtn big onClick={() => navigate("/signup")}>Start free</GoldBtn>
                  <QuietBtn big onClick={() => setShowCal(true)}>Talk to the founder</QuietBtn>
                </div>
                <p style={{ fontSize: 13, color: C.ink3 }}>
                  30-day trial · no credit card · your data exports anytime
                </p>
              </div>
              <div className="lp-shot-wrap">
                <img
                  className="lp-shot"
                  src="/lp-home.png"
                  srcSet="/lp-home.png 1440w, /lp-home-2x.png 2880w"
                  sizes="(max-width: 768px) 92vw, 46vw"
                  width="1440" height="900"
                  alt="Steward's home screen: the quarter's fundraising goal, and a Needs Your Attention queue of donors to reach today"
                  fetchpriority="high"
                />
                <div className="lp-goal-overlay" style={GOAL_OVERLAY} aria-hidden="true"><i /></div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. The problem, told plainly ── */}
        <section className="lp-section" style={{ background: C.white, borderTop: `1px solid ${C.cream2}`, borderBottom: `1px solid ${C.cream2}` }}>
          <div className="lp-narrow" style={{ textAlign: "center" }}>
            <p className="lp-serif" style={{ fontSize: "clamp(24px, 2.6vw, 33px)", lineHeight: 1.5, color: C.ink }}>
              The average nonprofit keeps 43% of its donors from one year to the
              next. Not because people stop caring — because nobody noticed them
              going quiet. Every CRM can store your donors.{" "}
              <span style={{ borderBottom: `3px solid ${C.gold}` }}>Steward watches over them.</span>
            </p>
            <p style={{ fontSize: 12.5, color: C.ink3, marginTop: 26 }}>
              43% is the sector-average donor retention rate published in Bloomerang's annual benchmarks.
            </p>
          </div>
        </section>

        {/* ── 3. Three true product moments ── */}
        <section className="lp-section">
          <div className="lp-wide">

            {/* Moment 1 — the morning queue */}
            <div className="lp-moment">
              <div className="lp-moment-text">
                <Eyebrow>Tuesday, 8:04 am</Eyebrow>
                <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3vw, 40px)", color: C.ink, lineHeight: 1.15, marginBottom: 18 }}>
                  The morning queue
                </h2>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8 }}>
                  Steward opens with who needs you today: a donor about to cross a
                  milestone worth a handwritten note, a longtime giver going quiet,
                  a task you set for yourself last month. Each one arrives with its
                  reasons — last gift, what their file says, how long it's been —
                  and one action. It's rarely more than a handful. Work the list
                  over coffee.
                </p>
              </div>
              <div className="lp-moment-media">
                <img className="lp-moment-img" src="/lp-queue.png" loading="lazy" width="1636" height="1068"
                  alt="Steward's Needs Your Attention queue: six donors with reasons and a single action each" />
                <div className="lp-caption">The queue on Steward's home screen — a capture of the live product with sample data.</div>
              </div>
            </div>

            {/* Moment 2 — recovery. The money section; the email shown is the
                real default template from the product (server.js
                DEFAULT_DUNNING_BODY), tokens filled with visibly sample values. */}
            <div className="lp-moment lp-flip">
              <div className="lp-moment-text">
                <Eyebrow>Any night, 2:11 am</Eyebrow>
                <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3vw, 40px)", color: C.ink, lineHeight: 1.15, marginBottom: 18 }}>
                  The gift you didn't know you were losing
                </h2>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8, marginBottom: 14 }}>
                  20–30% of recurring giving is lost to nothing more dramatic than
                  an expired card. The donor never decided to stop — their bank
                  reissued some plastic, the charge failed at two in the morning,
                  and nobody ever asked them to fix it.
                </p>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8 }}>
                  When a recurring gift fails, Steward notices within the hour and
                  sends a warm note in your organization's name with a one-click,
                  no-login card update — then follows up on a gentle schedule until
                  it's resolved. You see the dollars at risk on your home screen,
                  and you see them come back.
                </p>
              </div>
              <div className="lp-moment-media">
                <div className="lp-email">
                  <div className="lp-email-head">
                    <div><span style={{ color: C.ink, fontWeight: 600 }}>From:</span> Riverbend Arts Collective</div>
                    <div><span style={{ color: C.ink, fontWeight: 600 }}>Subject:</span> A quick fix to keep your support going</div>
                  </div>
                  <div className="lp-email-body">
                    <p>Hi Maria,</p>
                    <p>Thank you again for your ongoing gift of $50 to Riverbend Arts Collective — support like yours is what makes our work possible.</p>
                    <p>We tried to process your latest gift and the card on file didn't go through. This happens most often when a card has expired or been reissued, and it only takes a minute to fix.</p>
                    <p style={{ textAlign: "center", margin: "22px 0" }}>
                      <span style={{ background: C.greenMd, color: "#fff", padding: "11px 26px", borderRadius: 8, fontWeight: 700, display: "inline-block" }}>Update my card</span>
                    </p>
                    <p>If you have any questions, just reply to this email — we're glad to help.</p>
                    <p>With gratitude,<br />Riverbend Arts Collective</p>
                  </div>
                </div>
                <div className="lp-caption">The actual email Steward sends when a card fails — its built-in template, shown with sample values. Orgs can rewrite every word.</div>
              </div>
            </div>

            {/* Moment 3 — receipts */}
            <div className="lp-moment">
              <div className="lp-moment-text">
                <Eyebrow>Audit season</Eyebrow>
                <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3vw, 40px)", color: C.ink, lineHeight: 1.15, marginBottom: 18 }}>
                  The receipt that sends itself
                </h2>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8 }}>
                  Every online gift gets an IRS-compliant receipt — numbered,
                  recorded, and sent the moment the payment lands. Offline gifts
                  are one click, never automatic, because you know which entries
                  are backfill. Year-end statements consolidate a donor's whole
                  year on demand. Your auditor stops asking.
                </p>
              </div>
              <div className="lp-moment-media">
                <img className="lp-moment-img" src="/lp-receipt.png" loading="lazy" width="1081" height="745"
                  alt="A numbered, IRS-compliant donation receipt PDF generated by Steward" />
                <div className="lp-caption">A receipt generated by the live product's preview endpoint — this is the real PDF, not a mock-up.</div>
              </div>
            </div>

          </div>
        </section>

        {/* ── 4. The money strip ── */}
        <section className="lp-section" style={{ background: C.ink }}>
          <div className="lp-narrow" style={{ textAlign: "center" }}>
            <Eyebrow onDark>Where the money goes</Eyebrow>
            <h2 className="lp-serif" style={{ fontSize: "clamp(32px, 3.6vw, 48px)", color: C.cream, lineHeight: 1.12, marginBottom: 24 }}>
              Your donors give to you. Only you.
            </h2>
            <p style={{ fontSize: 16.5, color: C.sage, lineHeight: 1.85, maxWidth: 620, margin: "0 auto 22px" }}>
              Donations settle directly into your organization's own Stripe
              account. Steward never touches the money and takes no percentage —
              0%, on every gift. Your donors are never asked to add a tip to
              cover somebody's software.
            </p>
            <p className="lp-serif" style={{ fontSize: 20, fontStyle: "italic", color: C.gold, lineHeight: 1.6, maxWidth: 560, margin: "0 auto 22px" }}>
              Free platforms are paid for by your donors' tips. Steward is paid
              for by you — flatly, transparently.
            </p>
            <p style={{ fontSize: 12.5, color: "#6b8f7a", maxWidth: 480, margin: "0 auto" }}>
              Stripe's standard card-processing fee still applies — that goes to
              Stripe, not to us. Plans are $99, $249, or $499 a month, flat.{" "}
              <a href="/pricing" style={{ color: C.sage, textDecoration: "underline", textUnderlineOffset: 3 }}>See pricing</a>.
            </p>
          </div>
        </section>

        {/* ── 5. Where Steward is today — the candor section stays; it IS the brand ── */}
        <section className="lp-section" style={{ background: C.white, borderBottom: `1px solid ${C.cream2}` }}>
          <div className="lp-narrow">
            <Eyebrow>Where Steward is today</Eyebrow>
            <h2 className="lp-serif" style={{ fontSize: "clamp(30px, 3.4vw, 44px)", color: C.ink, lineHeight: 1.15, marginBottom: 22 }}>
              This is new. I'd rather tell you the truth than sell you a testimonial.
            </h2>
            <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8, marginBottom: 26 }}>
              Steward is built and run by one person. There's no case-study wall
              and no customer count on this page, because it's early and I won't
              invent either. Here is what's actually true today:
            </p>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                "Live now: donor records and pipeline, Gmail sync, email campaigns and sequences, milestone drafts a human reviews before anything sends, failed-payment recovery, tax receipts and year-end statements, six board-ready reports, peer-to-peer fundraising pages.",
                "Load-tested to 25,000 donors and 200,000 gifts per organization.",
                "Errors are monitored in production; your data exports to a zip of clean CSVs in one click — including after you cancel. That's a promise, and it's already built.",
              ].map((t, i) => (
                <li key={i} style={{ display: "flex", gap: 12, fontSize: 15, color: "#2d2d2d", lineHeight: 1.7 }}>
                  <span style={{ color: C.greenDk, fontWeight: 800, flexShrink: 0 }}>—</span>{t}
                </li>
              ))}
            </ul>
            <div style={{ background: C.cream, border: `1px solid ${C.cream3}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 12, padding: "20px 24px" }}>
              <p style={{ fontSize: 15, color: C.ink, lineHeight: 1.75 }}>
                I'm looking for <strong>three to five founding partner
                organizations</strong> — nonprofits who'll use Steward for real,
                tell me what's missing, and shape what gets built next. Founding
                partners get a locked-in price and a direct line to me.{" "}
                <a href={`${FOUNDER_MAILTO}?subject=Founding%20partner`} style={{ color: C.greenDk, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3 }}>
                  Write to me
                </a>{" "}
                and tell me about your organization.
              </p>
            </div>
          </div>
        </section>

        {/* ── 6. A letter from the founder ──
            DRAFT — flagged for Jonathan's own edit before this ships as final
            copy; it has to sound like him, not like a website. Set as a
            letter: serif, cream, no card, no icon. */}
        <section className="lp-section">
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            <Eyebrow>A letter from the founder</Eyebrow>
            <div className="lp-serif" style={{ fontSize: 19, color: C.ink, lineHeight: 1.85 }}>
              <p style={{ marginBottom: 18 }}>
                I started Steward after watching a nonprofit I love run its donor
                program out of a spreadsheet. They didn't lose donors because they
                didn't care. They lost donors because caring at that scale needs a
                system, and every system they could afford treated them like a
                data-entry problem.
              </p>
              <p style={{ marginBottom: 18 }}>
                So I built the thing I kept wishing existed: software that notices
                what a good development director would notice — the anniversary,
                the quiet stretch, the failed card — and brings it to you while
                there's still time to do something about it.
              </p>
              <p style={{ marginBottom: 18 }}>
                Two promises. Your data is yours — export everything, anytime,
                even after you cancel. And when you email Steward, it's me who
                answers.
              </p>
              <p style={{ marginBottom: 26 }}>
                If you take care of donors for a living, I built this for you.
              </p>
              <p style={{ fontStyle: "italic", fontSize: 21 }}>— Jonathan</p>
            </div>
            <p style={{ fontSize: 13, color: C.ink3, marginTop: 18 }}>
              <a href={FOUNDER_MAILTO} style={{ color: C.greenDk, textDecoration: "underline", textUnderlineOffset: 3 }}>jonathan@stewardapp.dev</a>
            </p>
          </div>
        </section>

        {/* ── 7. Close ── */}
        <section className="lp-section" style={{ textAlign: "center" }}>
          <div className="lp-narrow">
            <h2 className="lp-serif" style={{ fontSize: "clamp(34px, 4vw, 52px)", color: C.ink, marginBottom: 30, lineHeight: 1.12 }}>
              See who needs you today.
            </h2>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 18 }}>
              <GoldBtn big onClick={() => navigate("/signup")}>Start free</GoldBtn>
              <QuietBtn big onClick={() => setShowCal(true)}>Talk to the founder</QuietBtn>
            </div>
            <p style={{ fontSize: 13, color: C.ink3 }}>
              30-day trial · no credit card · import your donors this afternoon
            </p>
          </div>
        </section>

        {/* ── Footer — real links only ── */}
        <footer style={{ background: C.ink, padding: "44px 64px" }}>
          <div className="lp-wide" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 18 }}>
            <div>
              <div className="lp-serif" style={{ fontSize: 20, color: C.cream, marginBottom: 4 }}>Steward</div>
              <div style={{ fontSize: 12, color: C.sage }}>© 2026 Steward · Donor retention for small nonprofits</div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
              <a href="/pricing" style={{ color: C.sage }} className="lp-navlink">Pricing</a>
              <a href="/login" style={{ color: C.sage }} className="lp-navlink">Log in</a>
              <a href={FOUNDER_MAILTO} style={{ color: C.sage }} className="lp-navlink">Contact</a>
              <a href="/terms" style={{ color: C.sage }} className="lp-navlink">Terms</a>
              <a href="/privacy" style={{ color: C.sage }} className="lp-navlink">Privacy</a>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
