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

        @media (max-width: 768px) {
          .lp-section { padding: 64px 22px; }
          .lp-hero-grid { grid-template-columns: 1fr; gap: 44px; }
          .lp-nav { padding: 0 22px !important; }
          .lp-nav-pricing { display: none; }
          .lp-h1 { font-size: 42px !important; }
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
