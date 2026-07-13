import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FunnelChart from "../components/FunnelChart";

// Static demo numbers for the "How it works" funnel preview below — this is
// marketing, not live data, so a realistic-looking shape is enough; a
// logged-in user's actual Pipeline Funnel card renders through the exact
// same <FunnelChart> component.
const FUNNEL_PREVIEW_COUNTS = {
  prospect:  { count: 48, total: 0 },
  qualify:   { count: 34, total: 61000 },
  cultivate: { count: 22, total: 148000 },
  solicit:   { count: 11, total: 210000 },
  steward:   { count: 64, total: 890000 },
  lapsed:    { count: 9,  total: 42000 },
};

const C = {
  dark:    "#0f1a12",
  dark2:   "#1a2e1f",
  dark3:   "#2d4a35",
  cream:   "#f0ede6",
  cream2:  "#e8e4db",
  cream3:  "#ddd9d0",
  white:   "#ffffff",
  gold:    "#c9a84c",
  sage:    "#8fa896",
  green:   "#10b981",
  greenDk: "#0d5c3a",
  greenMd: "#1a6b4a",
  ink3:    "#6b6b6b",
};

const CALENDLY_URL = "https://calendly.com/xjca2006/new-meeting";

function DemoModal({ onClose }) {
  const calendlyLoaded = useRef(false);
  useEffect(() => {
    if (calendlyLoaded.current) return;
    calendlyLoaded.current = true;
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
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div style={{
        background: C.cream, borderRadius: 20, width: "100%", maxWidth: 680,
        boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
        border: `1px solid ${C.cream3}`, overflow: "hidden",
      }}>
        <div style={{ padding: "24px 28px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 24, color: C.dark, letterSpacing: "-0.5px" }}>
            Book a 15-min demo
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: C.ink3, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div className="calendly-inline-widget" data-url={CALENDLY_URL} style={{ minWidth: 320, height: 660 }} />
      </div>
    </div>
  );
}

// ── Feature icons ──────────────────────────────────────────────────────────
// Simple, consistent line icons (lucide-react isn't a project dependency, so
// these are hand-drawn to the same visual convention: 24x24 viewBox, ~1.7
// stroke, round caps/joins) in place of the emoji that used to sit here.
const IconWrap = ({ children }) => (
  <div style={{ marginBottom: 14 }}>
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={C.greenDk} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  </div>
);
const IconUsers = () => (
  <IconWrap>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20.5c0-3.6 2.7-6.3 6-6.3s6 2.7 6 6.3" />
    <circle cx="17.3" cy="9.2" r="2.4" />
    <path d="M15.8 14.3c2.6.5 4.6 2.7 4.7 5.6" />
  </IconWrap>
);
const IconFileText = () => (
  <IconWrap>
    <path d="M6.5 2.5h8l5 5v13.5a1 1 0 01-1 1h-12a1 1 0 01-1-1v-17.5a1 1 0 011-1z" />
    <path d="M14.5 2.5v5h5" />
    <path d="M9 13h6M9 16.5h6M9 9.5h2" />
  </IconWrap>
);
const IconMessageHistory = () => (
  <IconWrap>
    <path d="M4 5.5a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H9l-4.5 3.5V16.5H6a2 2 0 01-2-2v-9z" />
    <path d="M7.5 9h9M7.5 12h6" />
  </IconWrap>
);
const IconMail = () => (
  <IconWrap>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
    <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
  </IconWrap>
);
const IconSparkles = () => (
  <IconWrap>
    <path d="M12 2.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7 1.7-5z" />
    <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
  </IconWrap>
);
const IconSettings = () => (
  <IconWrap>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13.3a8 8 0 000-2.6l2-1.5-2-3.4-2.4 1a8 8 0 00-2.2-1.3L14.4 2.6h-4.8l-.4 2.9a8 8 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.5a8 8 0 000 2.6l-2 1.5 2 3.4 2.4-1c.6.6 1.4 1 2.2 1.3l.4 2.9h4.8l.4-2.9c.8-.3 1.6-.7 2.2-1.3l2.4 1 2-3.4-2-1.5z" />
  </IconWrap>
);

export default function Landing() {
  const navigate = useNavigate();
  const [showModal, setShowModal]         = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navScrolled, setNavScrolled]     = useState(false);
  const [donorCount, setDonorCount]       = useState(50);
  const [avgGift, setAvgGift]             = useState(500);
  const [retentionRate, setRetentionRate] = useState(43);

  const donorsLost       = Math.round(donorCount * (1 - retentionRate / 100));
  const revenueAtRisk    = Math.round(donorsLost * avgGift);
  const recoveredRevenue = Math.round(donorsLost * 0.20 * avgGift);
  const stewardCost      = 2988;
  const roi              = recoveredRevenue > 0 ? +(recoveredRevenue / stewardCost).toFixed(1) : 0;
  const fmtD = (n) => "$" + Math.round(n).toLocaleString();
  const fmtN = (n) => Math.round(n).toLocaleString();
  const sliderBg = `linear-gradient(to right, ${C.green} ${retentionRate}%, ${C.dark3} ${retentionRate}%)`;

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = showModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showModal]);

  const BookBtn = ({ children, small, outlined, style = {} }) => (
    <button
      onClick={() => setShowModal(true)}
      style={{
        background: outlined ? "transparent" : C.green,
        color: outlined ? C.cream : C.dark,
        border: outlined ? `1px solid ${C.cream}` : "none",
        padding: small ? "9px 20px" : "13px 28px",
        borderRadius: 9, fontSize: small ? 13 : 15, fontWeight: 700,
        cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
        transition: "opacity .15s", letterSpacing: "0.01em",
        ...style,
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
    >
      {children || "Book a 15-min demo →"}
    </button>
  );

  const Eyebrow = ({ children, dark = false }) => (
    <div style={{
      fontSize: 10, fontWeight: 800, textTransform: "uppercase",
      letterSpacing: "0.12em", color: dark ? C.gold : C.greenDk,
      marginBottom: 14, fontFamily: "'DM Sans',sans-serif",
    }}>{children}</div>
  );

  const NAV_LINKS = [
    ["Features",     "#features"],
    ["How it works", "#howitworks"],
    ["About",        "#about"],
    ["Pricing",      "#pricing"],
  ];

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <style>{`
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: ${C.cream}; overflow-x: hidden; }
        .lp { font-family: 'DM Sans', sans-serif; color: ${C.dark}; overflow-x: hidden; line-height: 1.6; }
        a { text-decoration: none; color: inherit; }
        .nav-a:hover { opacity: 0.6; transition: opacity .15s; }
        .footer-a:hover { opacity: 0.5; }
        .lp-hero-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
        .lp-feat-grid  { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
        .lp-pain-grid  { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
        .lp-price-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 20px; }
        .roi-grid      { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }
        .lp-card-hover:hover { transform: translateY(-2px); transition: transform .2s, box-shadow .2s; box-shadow: 0 8px 32px rgba(0,0,0,0.10) !important; }
        .lp-price-card-hover:hover { transform: translateY(-2px); transition: transform .2s; }
        /* How it works connector */
        .hw-steps { display: grid; grid-template-columns: repeat(4,1fr); gap: 24px; }
        .hw-step  { position: relative; }
        .hw-step:not(:last-child)::after {
          content: ''; position: absolute; top: 21px; right: -12px;
          width: 24px; height: 0; border-top: 2px dashed ${C.dark3}; z-index: 1;
        }
        /* ROI inputs */
        .roi-input { background: ${C.dark2}; border: 1px solid ${C.dark3}; border-radius: 8px; color: ${C.cream}; font-family: 'DM Sans',sans-serif; font-size: 16px; padding: 10px 14px; outline: none; width: 100%; }
        .roi-input:focus { border-color: ${C.green}; }
        .roi-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; outline: none; cursor: pointer; }
        .roi-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: ${C.green}; cursor: pointer; border: 2px solid ${C.dark}; box-shadow: 0 0 0 2px ${C.green}; }
        .roi-slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: ${C.green}; cursor: pointer; border: 2px solid ${C.dark}; }
        /* Mobile nav */
        .lp-hamburger { display: none; background: none; border: none; font-size: 22px; cursor: pointer; color: ${C.cream}; padding: 4px; line-height: 1; }
        .lp-nav-links { display: flex; }
        .lp-nav-cta   { display: flex; }
        .lp-mobile-nav-overlay { display: none; position: fixed; inset: 0; z-index: 600; background: rgba(0,0,0,0.55); align-items: flex-end; }
        .lp-mobile-nav-open    { display: flex !important; }
        .lp-mobile-nav-drawer  { background: ${C.dark}; border-radius: 20px 20px 0 0; width: 100%; padding-bottom: env(safe-area-inset-bottom, 0px); }
        .lp-mobile-nav-handle  { width: 36px; height: 4px; border-radius: 2px; background: ${C.dark2}; margin: 12px auto 8px; }
        .lp-mobile-nav-row     { display: flex; align-items: center; padding: 16px 24px; font-family: 'DM Sans',sans-serif; font-size: 17px; color: ${C.cream}; border-bottom: 1px solid ${C.dark2}; text-decoration: none; width: 100%; background: none; border-left: none; border-right: none; border-top: none; cursor: pointer; text-align: left; }
        .lp-mobile-nav-row:hover { background: ${C.dark2}; }
        @media (max-width: 768px) {
          .lp-hero-grid  { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lp-feat-grid  { grid-template-columns: 1fr !important; }
          .lp-price-grid { grid-template-columns: 1fr !important; }
          .lp-pain-grid  { grid-template-columns: 1fr !important; }
          .roi-grid      { grid-template-columns: 1fr !important; }
          .hw-steps      { grid-template-columns: 1fr !important; }
          .hw-step::after { display: none !important; }
          .lp-section    { padding-left: 20px !important; padding-right: 20px !important; }
          .lp-nav-links  { display: none !important; }
          .lp-nav-cta    { display: none !important; }
          .lp-hamburger  { display: block !important; }
          .lp-hero-mockup { display: none !important; }
          .lp-h1         { font-size: 38px !important; }
        }
      `}</style>

      {showModal && <DemoModal onClose={() => setShowModal(false)} />}

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div className="lp-mobile-nav-overlay lp-mobile-nav-open" onClick={() => setMobileNavOpen(false)}>
          <div className="lp-mobile-nav-drawer" onClick={e => e.stopPropagation()}>
            <div className="lp-mobile-nav-handle" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 24px 12px" }}>
              <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: C.cream }}>Steward</span>
              <button onClick={() => setMobileNavOpen(false)} style={{ background: "none", border: "none", fontSize: 24, color: C.sage, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            {NAV_LINKS.map(([l, h]) => (
              <a key={l} href={h} className="lp-mobile-nav-row" onClick={() => setMobileNavOpen(false)}>{l}</a>
            ))}
            <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={() => { navigate("/login"); setMobileNavOpen(false); }}
                style={{ width: "100%", padding: "13px", border: `1px solid ${C.dark2}`, borderRadius: 9, background: "transparent", fontSize: 15, fontWeight: 500, color: C.cream, fontFamily: "'DM Sans',sans-serif", cursor: "pointer" }}
              >Log in</button>
              <button
                onClick={() => { setShowModal(true); setMobileNavOpen(false); }}
                style={{ width: "100%", padding: "13px", border: "none", borderRadius: 9, background: C.green, color: C.dark, fontSize: 15, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", cursor: "pointer" }}
              >Book a 15-min demo →</button>
            </div>
          </div>
        </div>
      )}

      <div className="lp">

        {/* ── Nav ── */}
        <nav style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 48px", height: 60,
          background: navScrolled ? "rgba(15,26,18,0.96)" : C.dark,
          backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${navScrolled ? C.dark2 : "transparent"}`,
          position: "sticky", top: 0, zIndex: 100,
          transition: "border-color .3s",
        }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: C.cream, letterSpacing: "-0.3px" }}>Steward</span>
          <div className="lp-nav-links" style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {NAV_LINKS.map(([l, h]) => (
              <a key={l} href={h} className="nav-a" style={{ fontSize: 14, color: C.sage, transition: "opacity .15s" }}>{l}</a>
            ))}
          </div>
          <div className="lp-nav-cta" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="nav-a" onClick={() => navigate("/login")} style={{
              background: "none", border: "none", fontSize: 14, color: C.sage,
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
            }}>Log in</button>
            <BookBtn small outlined style={{ padding: "7px 16px", fontSize: 13 }}>Book a 15-min demo</BookBtn>
            <button onClick={() => navigate("/signup")} style={{
              background: C.green, border: "none", color: "#fff",
              padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
            }}>Start Free Trial →</button>
          </div>
          <button className="lp-hamburger" onClick={() => setMobileNavOpen(true)}>☰</button>
        </nav>

        {/* ── Hero ── */}
        <section className="lp-section" style={{ background: C.dark, padding: "96px 64px 80px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div className="lp-hero-grid">
              <div>
                <Eyebrow dark>Fundraising Intelligence</Eyebrow>
                <h1 className="lp-h1" style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: "clamp(42px, 5vw, 68px)",
                  fontWeight: 400, lineHeight: 1.05,
                  letterSpacing: "-0.02em", color: C.cream,
                  marginBottom: 24,
                }}>
                  Steward tells you who to call<br />
                  today, and{" "}
                  <span style={{ textDecoration: "underline", textDecorationColor: C.gold, textDecorationThickness: 3, textUnderlineOffset: 6 }}>what to say.</span>
                </h1>
                <p style={{ fontSize: 18, color: C.sage, lineHeight: 1.7, marginBottom: 36, maxWidth: 480 }}>
                  The fundraising OS for small nonprofits. Replace your spreadsheets with a system that remembers every donor, flags every lapse, and drafts every email — so you can focus on relationships, not admin.
                </p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
                  <button
                    onClick={() => navigate("/signup")}
                    style={{
                      background: C.green, border: "none",
                      color: "#fff", padding: "13px 28px", borderRadius: 9,
                      fontSize: 15, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >Start Free Trial →</button>
                  <BookBtn outlined>Book a 15-min demo →</BookBtn>
                </div>
                <p style={{ fontSize: 12, color: C.sage, letterSpacing: "0.02em", lineHeight: 1.6 }}>
                  Built for development teams doing more with less.
                </p>
              </div>
              <div className="lp-hero-mockup">
                <img
                  src="/hero-screenshot.png"
                  alt="Steward dashboard showing donor pipeline and daily briefing"
                  style={{
                    width: "100%", display: "block", borderRadius: 16,
                    border: `1px solid ${C.dark3}`,
                    boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Problem ── */}
        <section className="lp-section" style={{ background: C.cream, padding: "96px 64px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <Eyebrow>The Problem</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
              color: C.dark, marginBottom: 52, maxWidth: 700,
            }}>
              You're losing donors you worked years to build.
            </h2>
            <div className="lp-pain-grid">
              {[
                { num: "01", text: "The spreadsheet that runs your development program has 847 rows, 12 tabs, and is one accidental delete away from a crisis." },
                { num: "02", text: "Your top donor gave last March. It's now November. Nobody noticed. They just gave $10,000 to another org." },
                { num: "03", text: "Your ED asked for a board report on Friday afternoon. You spent your weekend building it in Excel." },
              ].map(c => (
                <div key={c.num} className="lp-card-hover" style={{
                  background: C.white, borderRadius: 14,
                  padding: "28px 24px 24px",
                  borderLeft: `3px solid ${C.gold}`,
                  boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                  transition: "transform .2s, box-shadow .2s",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>{c.num}</div>
                  <p style={{ fontSize: 16, color: C.dark, lineHeight: 1.65, fontFamily: "'DM Serif Display',serif", fontWeight: 400 }}>{c.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── About ── */}
        <section id="about" className="lp-section" style={{ background: C.dark, padding: "96px 64px", borderTop: `1px solid ${C.dark2}` }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <Eyebrow dark>Why Steward Exists</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(32px, 4vw, 50px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
              color: C.cream, marginBottom: 32,
            }}>
              Built by someone who felt the weight.
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <p style={{ fontSize: 17, color: C.sage, lineHeight: 1.8 }}>
                I built Steward after watching a nonprofit I cared about manage their entire donor program in Google Sheets.
              </p>
              <p style={{ fontSize: 17, color: C.sage, lineHeight: 1.8 }}>
                They had incredible relationships with their donors. Real, meaningful connections built over years. But they were losing people — not because the relationships weren't there, but because they couldn't keep track. A donor would lapse and nobody would notice until it was too late.
              </p>
              <p style={{ fontSize: 17, color: C.sage, lineHeight: 1.8 }}>
                I built Steward to be the tool I wished they had. Not another enterprise CRM with a 6-month implementation. Not another spreadsheet. Something that actually understands how development work happens — the relationships, the conversations, the follow-ups, the board reports at midnight.
              </p>
              <p style={{ fontSize: 17, color: C.sage, lineHeight: 1.8 }}>
                If you're a development officer doing more with less, Steward was built for you.
              </p>
            </div>
            <p style={{
              fontFamily: "'DM Serif Display',serif", fontStyle: "italic",
              fontSize: 22, color: C.gold, lineHeight: 1.5, marginTop: 40,
              paddingTop: 40, borderTop: `1px solid ${C.dark2}`,
            }}>
              "Your mission. Our pipeline."
            </p>
            <div style={{
              marginTop: 32, maxWidth: 480,
              background: C.dark2, borderRadius: 10,
              padding: "16px 20px", borderLeft: `3px solid ${C.gold}`,
            }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: C.gold }}>Steward</span>
                {"  "}
                <span style={{ fontSize: 12, fontStyle: "italic", color: C.sage }}>/ˈstjuːərd/</span>
                {"  "}
                <span style={{ fontSize: 11, color: C.sage }}>noun</span>
              </div>
              <p style={{ fontSize: 14, color: C.cream, lineHeight: 1.65, marginBottom: 6, fontFamily: "'DM Sans',sans-serif" }}>
                One who manages and protects something entrusted to their care.
              </p>
              <p style={{ fontSize: 13, color: C.sage, lineHeight: 1.6, fontFamily: "'DM Sans',sans-serif" }}>
                That's what great development officers do. That's what we help them do better.
              </p>
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section id="features" className="lp-section" style={{ background: C.white, padding: "96px 64px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <Eyebrow>What Steward Does</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
              color: C.dark, marginBottom: 16, maxWidth: 640,
            }}>
              The parts of development work that actually need a system behind them.
            </h2>
            <p style={{ fontSize: 15, color: C.ink3, marginBottom: 48, lineHeight: 1.7, maxWidth: 580 }}>
              Built by someone who watched a nonprofit struggle with spreadsheets. Designed for the one-person development shop and the five-person team alike.
            </p>
            <div className="lp-feat-grid">
              {[
                {
                  icon: <IconUsers />,
                  title: "Donor Relationships",
                  desc: "Know every donor by name, giving history, and what they care about. Never forget a follow-up. Never lose a relationship to a staff transition.",
                },
                {
                  icon: <IconFileText />,
                  title: "Grant Pipeline",
                  desc: "Track every grant from prospect to award. Get deadline reminders before it's too late. Draft your LOI in seconds with AI that knows your mission.",
                },
                {
                  icon: <IconMessageHistory />,
                  title: "Every Conversation, Remembered",
                  desc: "Connect your Gmail once. Every email you send or receive with a donor auto-logs to their timeline — nothing lost to a staff transition or buried in an old inbox thread.",
                },
                {
                  icon: <IconMail />,
                  title: "Smart Outreach",
                  desc: "Steward automatically reaches out to donors who are about to lapse — before they're gone. Personal, warm emails that sound like you wrote them.",
                },
                {
                  icon: <IconSparkles />,
                  title: "Daily Intelligence",
                  desc: "Every morning, Steward tells you who to call, what to say, and why it matters. Like having a senior fundraising consultant on staff — for $249/month.",
                },
                {
                  icon: <IconSettings />,
                  title: "Built for Your Mission",
                  desc: "Custom fields for your specific programs. Your terminology. Your workflows. Steward adapts to how you work, not the other way around.",
                },
              ].map(f => (
                <div key={f.title} className="lp-card-hover" style={{
                  background: C.cream, border: `1px solid ${C.cream3}`,
                  borderRadius: 14, padding: "24px",
                  transition: "transform .2s, box-shadow .2s",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                }}>
                  {f.icon}
                  <div style={{ fontSize: 18, fontFamily: "'DM Serif Display',serif", color: C.dark, marginBottom: 8, letterSpacing: "-0.01em" }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: C.ink3, lineHeight: 1.7 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="howitworks" className="lp-section" style={{ background: C.cream, padding: "96px 64px", borderTop: `1px solid ${C.cream3}` }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 64 }}>
              <Eyebrow>How it works</Eyebrow>
              <h2 style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: "clamp(32px, 4vw, 52px)",
                fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
                color: C.dark, maxWidth: 640, margin: "0 auto",
              }}>
                From spreadsheet chaos to fundraising clarity — in one afternoon.
              </h2>
            </div>
            <div style={{
              maxWidth: 440, margin: "0 auto 56px", background: C.white,
              border: `1px solid ${C.cream3}`, borderRadius: 16, padding: "24px 28px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.ink3, textAlign: "center", marginBottom: 16 }}>
                Your Pipeline, At A Glance
              </div>
              <FunnelChart counts={FUNNEL_PREVIEW_COUNTS} bandHeight={34}/>
            </div>
            <div className="hw-steps">
              {[
                {
                  n: "1",
                  title: "Import your donors",
                  desc: "Upload your spreadsheet. Steward maps your columns automatically and scores every donor in minutes.",
                },
                {
                  n: "2",
                  title: "Connect your tools",
                  desc: "Link your Gmail. Every email you send or receive with a donor auto-logs to their timeline. No manual entry.",
                },
                {
                  n: "3",
                  title: "Let Steward work",
                  desc: "Automated sequences reach out to lapsed donors. Deadline reminders fire before grants are due. Your AI briefing tells you what to do each morning.",
                },
                {
                  n: "4",
                  title: "Focus on your mission",
                  desc: "Stop managing spreadsheets. Start building relationships. That's why you got into this work.",
                },
              ].map(step => (
                <div key={step.n} className="hw-step" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%",
                    border: `2px solid ${C.gold}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "'DM Serif Display',serif", fontSize: 20, color: C.gold,
                    flexShrink: 0, background: C.cream, position: "relative", zIndex: 2,
                  }}>{step.n}</div>
                  <div>
                    <div style={{ fontSize: 17, fontFamily: "'DM Serif Display',serif", color: C.dark, marginBottom: 8, letterSpacing: "-0.01em" }}>{step.title}</div>
                    <div style={{ fontSize: 14, color: C.ink3, lineHeight: 1.7 }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Where Steward Is Today ── */}
        <section className="lp-section" style={{ background: C.dark, padding: "96px 64px", borderTop: `1px solid ${C.dark2}` }}>
          <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
            <Eyebrow dark>Where Steward Is Today</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(30px, 4vw, 46px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.18,
              color: C.cream, marginBottom: 28,
            }}>
              This is new. I'd rather tell you the truth than sell you a testimonial.
            </h2>
            <p style={{ fontSize: 17, color: C.sage, lineHeight: 1.8, marginBottom: 36, textAlign: "left", maxWidth: 620, marginLeft: "auto", marginRight: "auto" }}>
              Steward doesn't have a decade of case studies or a wall of logos. It's a new product, built by one person who spent time inside a nonprofit's donor spreadsheet and couldn't stop thinking about how much of it was fixable. If you sign on now, you're not getting a mature enterprise platform — you're getting something built specifically for the problems small development teams actually have, with a founder who reads every support email personally and builds what your team needs next.
            </p>
            <BookBtn>Book a 15-min demo and judge for yourself →</BookBtn>
          </div>
        </section>

        {/* ── ROI Calculator ── */}
        <section id="roi" className="lp-section" style={{ background: C.dark, padding: "96px 64px", borderTop: `1px solid ${C.dark2}` }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 52 }}>
              <h2 style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: "clamp(32px, 4vw, 52px)",
                fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
                color: C.cream, marginBottom: 16,
              }}>
                What is donor lapse costing you?
              </h2>
              <p style={{ fontSize: 16, color: C.sage, maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>
                Most nonprofits lose 57% of donors every year. Here's what that means for your org.
              </p>
            </div>
            <div className="roi-grid">
              {/* Inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.sage, marginBottom: 10 }}>
                    How many active donors do you have?
                  </label>
                  <input
                    type="number"
                    className="roi-input"
                    value={donorCount}
                    min={1}
                    onChange={e => setDonorCount(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.sage, marginBottom: 10 }}>
                    What's your average annual gift?
                  </label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.sage, fontSize: 16, pointerEvents: "none" }}>$</span>
                    <input
                      type="number"
                      className="roi-input"
                      style={{ paddingLeft: 28 }}
                      value={avgGift}
                      min={1}
                      onChange={e => setAvgGift(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.sage }}>
                      What's your current retention rate?
                    </label>
                    <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: C.green }}>{retentionRate}%</span>
                  </div>
                  <input
                    type="range"
                    className="roi-slider"
                    style={{ background: sliderBg }}
                    min={10} max={90}
                    value={retentionRate}
                    onChange={e => setRetentionRate(parseInt(e.target.value))}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dark3, marginTop: 6 }}>
                    <span>10%</span>
                    <span style={{ color: C.gold }}>43% industry avg</span>
                    <span>90%</span>
                  </div>
                </div>
              </div>
              {/* Output */}
              <div style={{
                background: C.dark2, border: `1px solid ${C.dark3}`,
                borderRadius: 16, padding: "32px",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, color: C.sage }}>Donors you'll lose this year</span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: C.cream, fontFamily: "'DM Serif Display',serif" }}>{fmtN(donorsLost)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, color: C.sage }}>Revenue at risk</span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "#f87171", fontFamily: "'DM Serif Display',serif" }}>{fmtD(revenueAtRisk)}</span>
                  </div>
                </div>
                <div style={{ borderTop: `1px solid ${C.dark3}`, paddingTop: 24, marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.sage, marginBottom: 14 }}>
                    If Steward recovers just 20% of those donors:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 13, color: C.sage }}>Recovered revenue</span>
                      <span style={{ fontSize: 22, fontWeight: 800, color: C.green, fontFamily: "'DM Serif Display',serif" }}>{fmtD(recoveredRevenue)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 13, color: C.sage }}>Steward costs</span>
                      <span style={{ fontSize: 14, color: C.ink3 }}>$2,988/year</span>
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "center", paddingTop: 20, borderTop: `1px solid ${C.dark3}`, marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.sage, marginBottom: 8 }}>Your ROI</div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 48, color: C.green, lineHeight: 1, letterSpacing: "-0.02em" }}>
                    {roi}x
                  </div>
                  {roi > 5 && (
                    <p style={{ fontFamily: "'DM Serif Display',serif", fontStyle: "italic", fontSize: 15, color: C.gold, marginTop: 12 }}>
                      Your mission can't afford not to.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => navigate("/signup")}
                  style={{
                    width: "100%",
                    background: C.green, border: "none", color: "#fff",
                    padding: "13px", borderRadius: 9,
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                >Start recovering donors →</button>
                <p style={{ fontSize: 11, color: C.dark3, textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
                  Based on Bloomerang's published industry average retention rate of 43%.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="lp-section" style={{ background: C.cream, padding: "96px 64px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <Eyebrow>Pricing</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
              color: C.dark, marginBottom: 16, maxWidth: 600,
            }}>
              Priced for nonprofits. Not for enterprise software budgets.
            </h2>
            <p style={{ fontSize: 15, color: C.ink3, marginBottom: 52, lineHeight: 1.7, maxWidth: 500 }}>
              One price. Everything included. No per-seat fees. No annual lock-in. Cancel anytime.
            </p>
            <div className="lp-price-grid" style={{ marginBottom: 20 }}>
              {/* Growth — hero */}
              <div className="lp-price-card-hover" style={{
                background: C.dark,
                border: `2px solid ${C.green}`,
                borderRadius: 16, padding: "36px 32px",
                display: "flex", flexDirection: "column",
                boxShadow: `0 12px 48px rgba(16,185,129,0.18)`,
                transition: "transform .2s",
                position: "relative",
              }}>
                <div style={{
                  position: "absolute", top: -14, left: 32,
                  background: C.gold, color: C.dark, fontSize: 10, fontWeight: 800,
                  textTransform: "uppercase", letterSpacing: "0.12em",
                  padding: "4px 14px", borderRadius: 99,
                }}>Most Popular</div>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: C.gold, marginBottom: 10 }}>Growth</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: 52, fontWeight: 800, color: C.cream, fontFamily: "'DM Serif Display',serif", lineHeight: 1, letterSpacing: "-0.02em" }}>$249</span>
                  <span style={{ fontSize: 14, color: C.sage }}>/mo</span>
                </div>
                <p style={{ fontSize: 14, color: C.sage, marginBottom: 20, lineHeight: 1.5 }}>Everything your development team needs</p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, marginBottom: 28, flex: 1 }}>
                  {[
                    "Unlimited donors",
                    "AI daily briefing + next move recommendations",
                    "Gmail sync — emails auto-log to donor timelines",
                    "Automated re-engagement sequences",
                    "Grant pipeline with deadline reminders",
                    "Finance & board reports",
                    "Custom fields + donor segmentation",
                    "Priority support from the founder",
                  ].map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: C.cream, lineHeight: 1.5 }}>
                      <span style={{ color: C.green, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate("/signup?plan=growth")}
                  style={{
                    background: C.green, border: "none", color: "#fff",
                    padding: "13px", borderRadius: 9,
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                >Start your 30-day free trial →</button>
                <p style={{ fontSize: 12, color: C.dark3, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
                  No credit card required. Full access. Cancel anytime.
                </p>
              </div>
              {/* Impact */}
              <div className="lp-price-card-hover" style={{
                background: C.white, border: `1px solid ${C.cream3}`,
                borderRadius: 16, padding: "36px 32px",
                display: "flex", flexDirection: "column",
                boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
                transition: "transform .2s",
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: C.greenDk, marginBottom: 10 }}>Impact</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: 52, fontWeight: 800, color: C.dark, fontFamily: "'DM Serif Display',serif", lineHeight: 1, letterSpacing: "-0.02em" }}>$499</span>
                  <span style={{ fontSize: 14, color: C.ink3 }}>/mo</span>
                </div>
                <p style={{ fontSize: 14, color: C.ink3, marginBottom: 20, lineHeight: 1.5 }}>For established orgs</p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, marginBottom: 28, flex: 1 }}>
                  {[
                    "Everything in Growth",
                    "Dedicated onboarding call",
                    "Custom data migration",
                    "Quarterly strategy call with founder",
                  ].map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: C.dark, lineHeight: 1.5 }}>
                      <span style={{ color: C.green, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate("/signup?plan=impact")}
                  style={{
                    background: "transparent", border: `1px solid ${C.cream3}`,
                    color: C.dark, padding: "13px", borderRadius: 9,
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                >Get started →</button>
              </div>
            </div>
            {/* Seed footnote */}
            <p style={{ fontSize: 13, color: C.ink3, marginBottom: 36, lineHeight: 1.7 }}>
              Just getting started?{" "}
              <a href="/signup?plan=seed" style={{ color: C.greenDk, textDecoration: "underline", textUnderlineOffset: 3 }}>
                Our Seed plan starts at $99/month
              </a>
              {" "}for orgs with under 200 donors.
            </p>
            {/* Closer */}
            <div style={{
              background: C.cream2, borderRadius: 14, padding: "28px 32px",
              borderLeft: `3px solid ${C.gold}`,
            }}>
              <p style={{ fontSize: 16, color: C.dark, lineHeight: 1.75, fontFamily: "'DM Serif Display',serif", fontWeight: 400 }}>
                Still deciding? One retained donor giving $2,500 covers ten months of Steward. Most of the cost of losing a donor happens quietly, before anyone notices.
              </p>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="lp-section" style={{ background: C.dark, padding: "112px 64px", textAlign: "center" }}>
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <Eyebrow dark>Get Started</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(36px, 5vw, 60px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.08,
              color: C.cream, marginBottom: 20,
            }}>
              Your donors are waiting to{" "}
              <span style={{ textDecoration: "underline", textDecorationColor: C.gold, textDecorationThickness: 3, textUnderlineOffset: 7 }}>hear from you.</span>
            </h2>
            <p style={{ fontSize: 17, color: C.sage, marginBottom: 44, lineHeight: 1.7 }}>
              Start your free 30-day trial. Import your donors this afternoon. Get your first AI briefing tomorrow morning.
            </p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
              <button
                onClick={() => navigate("/signup")}
                style={{
                  background: C.green, border: "none", color: "#fff",
                  padding: "15px 36px", borderRadius: 9, fontSize: 16, fontWeight: 700,
                  cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >Start Free Trial →</button>
              <BookBtn outlined style={{ padding: "15px 36px", fontSize: 16 }}>Book a 15-min demo →</BookBtn>
            </div>
            <p style={{ fontSize: 12, color: C.dark3, lineHeight: 1.8 }}>
              No credit card required · Full access for 30 days · Cancel anytime · Setup takes one afternoon
            </p>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="lp-section" style={{ background: C.dark, borderTop: `1px solid ${C.dark2}`, padding: "48px 64px 32px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 32, marginBottom: 40 }}>
              <div>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: C.cream, marginBottom: 6, letterSpacing: "-0.3px" }}>Steward</div>
                <div style={{ fontSize: 13, color: C.sage, lineHeight: 1.6, maxWidth: 240, marginBottom: 10 }}>
                  Fundraising intelligence for missions that matter.
                </div>
                <div style={{ fontSize: 11, color: C.dark3, letterSpacing: "0.06em", textTransform: "uppercase" }}>Built with care for the nonprofit sector.</div>
              </div>
              <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: C.sage, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Product</div>
                  {[["Features","#features"],["How it works","#howitworks"],["ROI Calculator","#roi"],["Pricing","#pricing"]].map(([l,h]) => (
                    <a key={l} href={h} className="footer-a" style={{ display: "block", fontSize: 13, color: C.sage, marginBottom: 8, transition: "opacity .15s" }}>{l}</a>
                  ))}
                  <button onClick={() => setShowModal(true)} className="footer-a" style={{ display: "block", fontSize: 13, color: C.sage, marginBottom: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", padding: 0 }}>Book a 15-min demo</button>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: C.sage, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Account</div>
                  <button onClick={() => navigate("/login")} className="footer-a" style={{ display: "block", fontSize: 13, color: C.sage, marginBottom: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", padding: 0 }}>Login</button>
                  <a href="mailto:jonathan@stewardapp.dev" className="footer-a" style={{ display: "block", fontSize: 13, color: C.sage, marginBottom: 8, transition: "opacity .15s" }}>Contact</a>
                </div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.dark2}`, paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <p style={{ fontSize: 12, color: C.dark3 }}>© 2025 Steward. Made for missions.</p>
              <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                <a href="/terms" style={{ fontSize: 12, color: C.dark3, textDecoration: "none", transition: "opacity .15s" }} className="footer-a">Terms</a>
                <a href="/privacy" style={{ fontSize: 12, color: C.dark3, textDecoration: "none", transition: "opacity .15s" }} className="footer-a">Privacy</a>
              </div>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
