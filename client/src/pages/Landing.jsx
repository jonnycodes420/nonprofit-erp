import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// ── Design tokens (landing-local, matches app palette) ─────────────────────
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

// ── Demo booking modal ─────────────────────────────────────────────────────
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
        border: `1px solid ${C.cream3}`,
        overflow: "hidden",
      }}>
        <div style={{ padding: "24px 28px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 24, color: C.dark, letterSpacing: "-0.5px" }}>
            Book a Demo
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: C.ink3, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div
          className="calendly-inline-widget"
          data-url={CALENDLY_URL}
          style={{ minWidth: 320, height: 660 }}
        />
      </div>
    </div>
  );
}

// ── Hero UI mockup — pure CSS, looks like the real app ─────────────────────
function HeroMockup() {
  const STAGES = [
    { label: "Prospect",  color: "#8b5cf6", count: 12 },
    { label: "Qualify",   color: "#3b82f6", count: 8  },
    { label: "Cultivate", color: "#f59e0b", count: 15 },
    { label: "Solicit",   color: "#10b981", count: 7  },
    { label: "Steward",   color: "#0d5c3a", count: 4  },
    { label: "Lapsed",    color: "#ef4444", count: 1  },
  ];
  const STATS = [
    { label: "Total Donors",   value: "47",       sub: "12 gave this year" },
    { label: "Active Grants",  value: "$340k",    sub: "pipeline value"    },
    { label: "Giving YTD",     value: "$127,450", sub: "vs $98k last year" },
    { label: "Open Tasks",     value: "12",       sub: "3 high priority"   },
  ];
  return (
    <div style={{
      background: C.dark, border: `1px solid ${C.dark3}`, borderRadius: 16,
      padding: "20px", fontFamily: "'DM Sans',sans-serif",
      boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
    }}>
      {/* Mini app header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.dark2}` }}>
        <div style={{ width: 22, height: 22, background: C.greenDk, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke={C.cream} strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill={C.cream}/></svg>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.cream, fontFamily: "'DM Serif Display',serif" }}>Creo Arts Organization</span>
        <span style={{ fontSize: 9, color: C.sage, textTransform: "uppercase", letterSpacing: "0.08em" }}>Steward</span>
        <div style={{ marginLeft: "auto", background: C.dark2, border: `1px solid ${C.dark3}`, borderRadius: 6, padding: "3px 10px", fontSize: 10, color: C.green, fontWeight: 700 }}>✦ Ask AI</div>
      </div>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
        {STATS.map(s => (
          <div key={s.label} style={{ background: C.dark2, border: `1px solid ${C.dark3}`, borderRadius: 10, padding: "10px 12px", borderLeft: `3px solid ${C.greenDk}` }}>
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.sage, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.cream, fontFamily: "'DM Serif Display',serif", lineHeight: 1, letterSpacing: "-0.02em" }}>{s.value}</div>
            <div style={{ fontSize: 9, color: C.sage, marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* Pipeline strip */}
      <div style={{ background: C.dark2, border: `1px solid ${C.dark3}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "7px 12px 5px", borderBottom: `1px solid ${C.dark3}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: C.sage }}>Donor Pipeline</span>
          <span style={{ fontSize: 8, color: C.sage }}>View all →</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)" }}>
          {STAGES.map((s, i) => (
            <div key={s.label} style={{ padding: "9px 8px", borderRight: i < 5 ? `1px solid ${C.dark3}` : "none", borderTop: `2px solid ${s.color}` }}>
              <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: s.color, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.cream, fontFamily: "'DM Serif Display',serif", lineHeight: 1 }}>{s.count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Health Score ring ──────────────────────────────────────────────────────
function HealthRing() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
      {/* Ring */}
      <div style={{ position: "relative", width: 200, height: 200 }}>
        <div style={{
          width: 200, height: 200, borderRadius: "50%",
          background: "conic-gradient(#10b981 0% 82%, #1a2e1f 82% 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 40px rgba(16,185,129,0.25)",
        }}>
          <div style={{
            width: 158, height: 158, borderRadius: "50%",
            background: C.dark, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 2,
          }}>
            <div style={{ fontSize: 56, fontWeight: 800, color: C.cream, fontFamily: "'DM Serif Display',serif", lineHeight: 1, letterSpacing: "-0.02em" }}>82</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.gold, letterSpacing: "0.04em" }}>B+</div>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: C.sage, fontWeight: 700, marginTop: 2 }}>Org Health</div>
          </div>
        </div>
      </div>
      {/* Risk flags */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 280 }}>
        {[
          { icon: "✓", label: "6 months runway",         color: C.green },
          { icon: "✓", label: "78% donor retention",     color: C.green },
          { icon: "⚠", label: "3 grants expiring soon",  color: C.gold  },
        ].map(f => (
          <div key={f.label} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: C.dark2, border: `1px solid ${C.dark3}`, borderRadius: 8,
            padding: "9px 14px",
          }}>
            <span style={{ fontSize: 13, color: f.color, fontWeight: 800, flexShrink: 0 }}>{f.icon}</span>
            <span style={{ fontSize: 12, color: C.cream, fontWeight: 500 }}>{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const [showModal, setShowModal]       = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navScrolled, setNavScrolled]   = useState(false);

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
      {children || "Book a Demo →"}
    </button>
  );

  const Eyebrow = ({ children, dark = false }) => (
    <div style={{
      fontSize: 10, fontWeight: 800, textTransform: "uppercase",
      letterSpacing: "0.12em", color: dark ? C.gold : C.greenDk,
      marginBottom: 14, fontFamily: "'DM Sans',sans-serif",
    }}>{children}</div>
  );

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
        .lp-hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
        .lp-feat-grid  { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
        .lp-price-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
        .lp-pain-grid  { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
        .lp-health-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
        .lp-quote-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
        .lp-card-hover:hover { transform: translateY(-2px); transition: transform .2s, box-shadow .2s; box-shadow: 0 8px 32px rgba(0,0,0,0.10) !important; }
        .lp-price-card-hover:hover { transform: translateY(-2px); transition: transform .2s; }
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
          .lp-hero-grid   { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lp-feat-grid   { grid-template-columns: 1fr !important; }
          .lp-price-grid  { grid-template-columns: 1fr !important; }
          .lp-pain-grid   { grid-template-columns: 1fr !important; }
          .lp-health-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lp-quote-grid  { grid-template-columns: 1fr !important; }
          .lp-section     { padding-left: 20px !important; padding-right: 20px !important; }
          .lp-nav-links   { display: none !important; }
          .lp-nav-cta     { display: none !important; }
          .lp-hamburger   { display: block !important; }
          .lp-hero-mockup { display: none !important; }
          .lp-h1          { font-size: 38px !important; }
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
            {[["Features","#features"],["About","#about"],["Pricing","#pricing"]].map(([l,h]) => (
              <a key={l} href={h} className="lp-mobile-nav-row" onClick={() => setMobileNavOpen(false)}>{l}</a>
            ))}
            <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => { navigate("/login"); setMobileNavOpen(false); }}
                style={{ width: "100%", padding: "13px", border: `1px solid ${C.dark2}`, borderRadius: 9, background: "transparent", fontSize: 15, fontWeight: 500, color: C.cream, fontFamily: "'DM Sans',sans-serif", cursor: "pointer" }}>
                Log in
              </button>
              <button onClick={() => { setShowModal(true); setMobileNavOpen(false); }}
                style={{ width: "100%", padding: "13px", border: "none", borderRadius: 9, background: C.green, color: C.dark, fontSize: 15, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", cursor: "pointer" }}>
                Book a Demo →
              </button>
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
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: C.cream, letterSpacing: "-0.3px" }}>
            Steward
          </span>
          <div className="lp-nav-links" style={{ display: "flex", alignItems: "center", gap: 32 }}>
            {[["Features","#features"],["About","#about"],["Pricing","#pricing"]].map(([l,h]) => (
              <a key={l} href={h} className="nav-a" style={{ fontSize: 14, color: C.sage, transition: "opacity .15s" }}>{l}</a>
            ))}
          </div>
          <div className="lp-nav-cta" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="nav-a" onClick={() => navigate("/login")} style={{
              background: "none", border: "none", fontSize: 14, color: C.sage,
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
            }}>Log in</button>
            <BookBtn small outlined style={{ padding: "7px 16px", fontSize: 13 }}>Book a Demo</BookBtn>
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
              {/* Left */}
              <div>
                <Eyebrow dark>Built for Nonprofits</Eyebrow>
                <h1 className="lp-h1" style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: "clamp(42px, 5vw, 68px)",
                  fontWeight: 400, lineHeight: 1.05,
                  letterSpacing: "-0.02em", color: C.cream,
                  marginBottom: 24,
                }}>
                  Your mission<br />
                  deserves better{" "}
                  <span style={{ textDecoration: "underline", textDecorationColor: C.gold, textDecorationThickness: 3, textUnderlineOffset: 6 }}>software.</span>
                </h1>
                <p style={{ fontSize: 18, color: C.sage, lineHeight: 1.7, marginBottom: 36, maxWidth: 480 }}>
                  Steward is the CRM, grant tracker, and finance tool built for development teams who are tired of duct-taping spreadsheets together.
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
                  >
                    Start Free Trial →
                  </button>
                  <BookBtn outlined>Book a Demo →</BookBtn>
                </div>
                <p style={{ fontSize: 12, color: C.sage, letterSpacing: "0.02em", lineHeight: 1.6 }}>
                  Used by arts organizations, social services nonprofits, and community foundations.
                </p>
              </div>
              {/* Right — UI mockup */}
              <div className="lp-hero-mockup">
                <HeroMockup />
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
              Nonprofits run on Salesforce licenses they can't afford and spreadsheets that don't scale.
            </h2>
            <div className="lp-pain-grid">
              {[
                {
                  num: "01",
                  text: "Bloomerang costs $500/mo and still can't track grants.",
                },
                {
                  num: "02",
                  text: "Your donor data lives in 4 different places.",
                },
                {
                  num: "03",
                  text: "Your ED asks for a board report and it takes you two days.",
                },
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

        {/* ── Features ── */}
        <section id="features" className="lp-section" style={{ background: C.white, padding: "96px 64px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <Eyebrow>What Steward Does</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
              color: C.dark, marginBottom: 52, maxWidth: 600,
            }}>
              One platform. Every tool your development team needs.
            </h2>
            <div className="lp-feat-grid">
              {[
                {
                  icon: "🎯",
                  title: "Donor CRM",
                  desc: "Pipeline stages, wealth scoring, relationship ownership, AI outreach drafts. Every donor relationship in one place.",
                },
                {
                  icon: "📋",
                  title: "Grant Management",
                  desc: "Kanban pipeline, deadline reminders, LOI drafting, AI fit analysis. Never miss a deadline or a funder.",
                },
                {
                  icon: "💰",
                  title: "Finance",
                  desc: "Full fund accounting, budget tracking, one-click board reports. A QuickBooks replacement built for nonprofits.",
                },
                {
                  icon: "📧",
                  title: "Communications",
                  desc: "Email campaigns, automated sequences, open tracking, donor segments. Stay in front of your donors.",
                },
                {
                  icon: "📊",
                  title: "Analytics",
                  desc: "Giving trends, retention curves, pipeline velocity, grant concentration risk. Know what's working.",
                },
                {
                  icon: "🤖",
                  title: "AI Throughout",
                  desc: "Daily briefings, next-move recommendations, wealth scoring, draft generation. Built on Claude.",
                },
              ].map(f => (
                <div key={f.title} className="lp-card-hover" style={{
                  background: C.cream, border: `1px solid ${C.cream3}`,
                  borderRadius: 14, padding: "24px",
                  transition: "transform .2s, box-shadow .2s",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                }}>
                  <div style={{ fontSize: 32, marginBottom: 14, lineHeight: 1 }}>{f.icon}</div>
                  <div style={{ fontSize: 18, fontFamily: "'DM Serif Display',serif", color: C.dark, marginBottom: 8, letterSpacing: "-0.01em" }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: C.ink3, lineHeight: 1.7 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Org Health Score ── */}
        <section className="lp-section" style={{ background: C.dark, padding: "96px 64px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div className="lp-health-grid">
              {/* Left */}
              <div>
                <Eyebrow dark>Org Health Score</Eyebrow>
                <h2 style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: "clamp(32px, 4vw, 52px)",
                  fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
                  color: C.cream, marginBottom: 24,
                }}>
                  Know exactly how healthy your organization is. In real time.
                </h2>
                <p style={{ fontSize: 16, color: C.sage, lineHeight: 1.75, marginBottom: 40, maxWidth: 460 }}>
                  Steward calculates a 1–100 health score from your donor retention, financial runway, grant concentration, and pipeline activity. You see risks before they become crises.
                </p>
                <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                  {[
                    { stat: "6 months", label: "runway" },
                    { stat: "78%",      label: "retention" },
                    { stat: "3",        label: "grants expiring soon" },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: 36, fontWeight: 800, color: C.gold, fontFamily: "'DM Serif Display',serif", lineHeight: 1, letterSpacing: "-0.02em" }}>{s.stat}</div>
                      <div style={{ fontSize: 12, color: C.sage, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Right — health ring mockup */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <HealthRing />
              </div>
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
              We've sat in those planning meetings.
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <p style={{ fontSize: 17, color: C.sage, lineHeight: 1.8 }}>
                Steward was built by people who've worked inside nonprofits — who've exported the same donor spreadsheet seventeen times, who've lost a grant because a deadline slipped through a shared inbox, who've spent a Sunday building a board report that should have taken twenty minutes.
              </p>
              <p style={{ fontSize: 17, color: C.sage, lineHeight: 1.8 }}>
                You're not running a small business. You're trying to change something. The software you use should understand that.
              </p>
            </div>
            <p style={{
              fontFamily: "'DM Serif Display',serif",
              fontStyle: "italic",
              fontSize: 22, color: C.gold,
              lineHeight: 1.5, marginTop: 40,
              paddingTop: 40, borderTop: `1px solid ${C.dark2}`,
            }}>
              "Your mission. Our pipeline."
            </p>
            {/* Definition block */}
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

        {/* ── Pricing ── */}
        <section id="pricing" className="lp-section" style={{ background: C.cream, padding: "96px 64px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <Eyebrow>Pricing</Eyebrow>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
              color: C.dark, marginBottom: 16, maxWidth: 540,
            }}>
              Transparent pricing. No per-seat surprises.
            </h2>
            <p style={{ fontSize: 15, color: C.ink3, marginBottom: 48, lineHeight: 1.7 }}>
              All plans include a 30-day free trial. No credit card required.
            </p>
            <div className="lp-price-grid">
              {[
                {
                  id: "seed",
                  name: "Seed",
                  price: "$99",
                  period: "/mo",
                  tagline: "For orgs just getting organized.",
                  features: ["Up to 500 donors", "All core features", "Donor CRM + Grants + Finance", "Email support"],
                  highlight: false,
                },
                {
                  id: "growth",
                  name: "Growth",
                  price: "$249",
                  period: "/mo",
                  tagline: "For active development teams.",
                  features: ["Unlimited donors", "Email sequences + analytics", "Board reports", "Priority support"],
                  highlight: true,
                },
                {
                  id: "impact",
                  name: "Impact",
                  price: "$499",
                  period: "/mo",
                  tagline: "For large orgs and multi-site.",
                  features: ["Everything in Growth", "Custom fields", "Board report PDF generation", "Dedicated onboarding"],
                  highlight: false,
                },
              ].map(p => (
                <div key={p.name} className="lp-price-card-hover" style={{
                  background: p.highlight ? C.dark : C.white,
                  border: p.highlight ? `2px solid ${C.green}` : `1px solid ${C.cream3}`,
                  borderRadius: 16,
                  padding: "32px 28px",
                  display: "flex", flexDirection: "column", gap: 0,
                  boxShadow: p.highlight ? `0 8px 40px rgba(16,185,129,0.18)` : "0 2px 12px rgba(0,0,0,0.05)",
                  transition: "transform .2s",
                  position: "relative",
                }}>
                  {p.highlight && (
                    <div style={{
                      position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
                      background: C.green, color: C.dark, fontSize: 10, fontWeight: 800,
                      textTransform: "uppercase", letterSpacing: "0.1em",
                      padding: "4px 14px", borderRadius: 99,
                    }}>Most Popular</div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: p.highlight ? C.gold : C.greenDk, marginBottom: 10 }}>{p.name}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginBottom: 8 }}>
                    <span style={{ fontSize: 52, fontWeight: 800, color: p.highlight ? C.cream : C.dark, fontFamily: "'DM Serif Display',serif", lineHeight: 1, letterSpacing: "-0.02em" }}>{p.price}</span>
                    <span style={{ fontSize: 14, color: p.highlight ? C.sage : C.ink3 }}>{p.period}</span>
                  </div>
                  <p style={{ fontSize: 13, color: p.highlight ? C.sage : C.ink3, marginBottom: 24, lineHeight: 1.5 }}>{p.tagline}</p>
                  <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, marginBottom: 32, flex: 1 }}>
                    {p.features.map(f => (
                      <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: p.highlight ? C.cream : C.dark, lineHeight: 1.5 }}>
                        <span style={{ color: C.green, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => navigate(`/signup?plan=${p.id}`)}
                    style={{
                      background: p.highlight ? C.green : "transparent",
                      border: p.highlight ? "none" : `1px solid ${C.cream3}`,
                      color: p.highlight ? "#fff" : C.dark,
                      padding: "11px", borderRadius: 9,
                      fontSize: 14, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >
                    Get started →
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Social proof ── */}
        <section className="lp-section" style={{ background: C.white, padding: "96px 64px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 52 }}>
              <Eyebrow>In Their Words</Eyebrow>
              <h2 style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: "clamp(28px, 3.5vw, 44px)",
                fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1,
                color: C.dark,
              }}>
                Trusted by organizations doing real good.
              </h2>
            </div>
            <div className="lp-quote-grid">
              {[
                {
                  quote: "Since we started using Steward, our board actually understands our donor pipeline for the first time. It feels like having a development director and a finance team in one tool.",
                  name: "Sarah M.", title: "Executive Director", org: "Riverside Community Foundation",
                },
                {
                  quote: "We used to spend two days every month pulling reports from three different systems. Now it takes twenty minutes. The time we've saved goes straight back to our programs.",
                  name: "James T.", title: "Operations Director", org: "Hope Mission",
                },
                {
                  quote: "The AI briefing every morning is remarkable. It actually understands what matters to our organization and gives us a real game plan. It's like having an experienced fundraiser on the team.",
                  name: "Rev. Lisa Chen", title: "Lead Pastor", org: "New Horizons Church",
                },
              ].map(q => (
                <div key={q.name} className="lp-card-hover" style={{
                  background: C.cream, border: `1px solid ${C.cream3}`,
                  borderRadius: 16, padding: "32px 28px",
                  display: "flex", flexDirection: "column", gap: 20,
                  transition: "transform .2s, box-shadow .2s",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                }}>
                  <div style={{ fontSize: 28, color: C.greenDk, fontFamily: "'DM Serif Display',serif", lineHeight: 1 }}>"</div>
                  <p style={{ fontSize: 14, color: C.dark, lineHeight: 1.8, fontStyle: "italic", flex: 1 }}>{q.quote}</p>
                  <div style={{ borderTop: `1px solid ${C.cream3}`, paddingTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.dark }}>{q.name}</div>
                    <div style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>{q.title}, {q.org}</div>
                  </div>
                </div>
              ))}
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
              Your mission is worth{" "}
              <span style={{ textDecoration: "underline", textDecorationColor: C.gold, textDecorationThickness: 3, textUnderlineOffset: 7 }}>better tools.</span>
            </h2>
            <p style={{ fontSize: 17, color: C.sage, marginBottom: 44, lineHeight: 1.7 }}>
              No pressure. No sales pitch. Just a conversation about what you need.
            </p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => navigate("/signup")}
                style={{
                  background: C.green, border: "none", color: "#fff",
                  padding: "15px 36px", borderRadius: 9, fontSize: 16, fontWeight: 700,
                  cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "opacity .15s",
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                Start Free Trial →
              </button>
              <BookBtn outlined style={{ padding: "15px 36px", fontSize: 16 }}>Book a Demo →</BookBtn>
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="lp-section" style={{ background: C.dark, borderTop: `1px solid ${C.dark2}`, padding: "48px 64px 32px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 32, marginBottom: 40 }}>
              <div>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: C.cream, marginBottom: 8, letterSpacing: "-0.3px" }}>Steward</div>
                <div style={{ fontSize: 13, color: C.sage, lineHeight: 1.6, maxWidth: 240 }}>
                  Your mission. Our pipeline.
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: C.dark3, letterSpacing: "0.06em", textTransform: "uppercase" }}>Built with care for the nonprofit sector.</div>
              </div>
              <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: C.sage, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Product</div>
                  {[["Features","#features"],["Pricing","#pricing"],["Book a Demo",""]].map(([l,h]) => (
                    h
                      ? <a key={l} href={h} className="footer-a" style={{ display: "block", fontSize: 13, color: C.sage, marginBottom: 8, transition: "opacity .15s" }}>{l}</a>
                      : <button key={l} onClick={() => setShowModal(true)} className="footer-a" style={{ display: "block", fontSize: 13, color: C.sage, marginBottom: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", padding: 0 }}>{l}</button>
                  ))}
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
              <p style={{ fontSize: 12, color: C.dark3 }}>Built with care for the nonprofit sector.</p>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
