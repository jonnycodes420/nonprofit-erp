import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const T = {
  cream:      "#f0ede6",
  cream2:     "#e8e4db",
  cream3:     "#ddd9d0",
  ink:        "#0f0f0f",
  ink2:       "#2a2a2a",
  ink3:       "#6b6b6b",
  dark:       "#111111",
  dark2:      "#1a1a1a",
  darkBorder: "rgba(255,255,255,0.08)",
  green:      "#10b981",
  greenDark:  "#1a6b4a",
  greenGlow:  "rgba(16,185,129,0.18)",
  white:      "#ffffff",
};

const CALENDLY_URL = "https://calendly.com/xjca2006/new-meeting";

// ── Animated mesh canvas ───────────────────────────────────────────────────
function MeshCanvas() {
  const canvasRef = useRef(null);
  const mouseRef  = useRef({ x: 0.5, y: 0.5 });
  const animRef   = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const points = [];
    const cols = 18, rows = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const offX = r % 2 === 0 ? 0 : 0.5;
        points.push({
          bx: (c + offX) / (cols - 1),
          by: r / (rows - 1),
          vx: (Math.random() - 0.5) * 0.0004,
          vy: (Math.random() - 0.5) * 0.0004,
          ox: (c + offX) / (cols - 1),
          oy: r / (rows - 1),
        });
      }
    }

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = T.dark;
      ctx.fillRect(0, 0, w, h);

      points.forEach(p => {
        const dx = mx - p.bx;
        const dy = my - p.by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pull = Math.max(0, 0.18 - dist) * 0.08;
        p.bx += p.vx + dx * pull;
        p.by += p.vy + dy * pull;
        p.bx += (p.ox - p.bx) * 0.012;
        p.by += (p.oy - p.by) * 0.012;
      });

      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const pi = points[i], pj = points[j];
          const dx = pi.bx - pj.bx;
          const dy = pi.by - pj.by;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < 0.12) {
            const alpha = (1 - d / 0.12) * 0.55;
            const mdx = (pi.bx + pj.bx) / 2 - mx;
            const mdy = (pi.by + pj.by) / 2 - my;
            const md  = Math.sqrt(mdx * mdx + mdy * mdy);
            const greenness = Math.max(0, 1 - md / 0.22);
            const r = Math.round(255 * (1 - greenness) + 16  * greenness);
            const g = Math.round(255 * (1 - greenness) + 185 * greenness);
            const b = Math.round(255 * (1 - greenness) + 129 * greenness);
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pi.bx * w, pi.by * h);
            ctx.lineTo(pj.bx * w, pj.by * h);
            ctx.stroke();
          }
        }
      }

      points.forEach(p => {
        const dx = p.bx - mx, dy = p.by - my;
        const d = Math.sqrt(dx * dx + dy * dy);
        const glow = Math.max(0, 1 - d / 0.18);
        const r2 = 1.5 + glow * 2.5;
        ctx.beginPath();
        ctx.arc(p.bx * w, p.by * h, r2, 0, Math.PI * 2);
        ctx.fillStyle = glow > 0.1
          ? `rgba(16,185,129,${0.4 + glow * 0.6})`
          : `rgba(255,255,255,0.25)`;
        ctx.fill();
      });

      const gx = ctx.createRadialGradient(mx * w, my * h, 0, mx * w, my * h, w * 0.28);
      gx.addColorStop(0, "rgba(16,185,129,0.12)");
      gx.addColorStop(1, "transparent");
      ctx.fillStyle = gx;
      ctx.fillRect(0, 0, w, h);

      animRef.current = requestAnimationFrame(draw);
    };

    draw();

    const section = canvas.parentElement;
    const onMove = (e) => {
      const rect = section.getBoundingClientRect();
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top)  / rect.height,
      };
    };
    section.addEventListener("mousemove", onMove);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      section.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
  );
}

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
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div style={{
        background: T.cream, borderRadius: 20, width: "100%", maxWidth: 680,
        boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
        border: `1px solid ${T.cream3}`,
        overflow: "hidden",
      }}>
        <div style={{ padding: "24px 28px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 24, color: T.ink, letterSpacing: "-0.5px" }}>
            Book a Demo
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.ink3, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
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

// ── Main ───────────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const [navShadow, setNavShadow] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavShadow(window.scrollY > 10);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const els = document.querySelectorAll("[data-reveal]");
    els.forEach((el, i) => {
      el.style.opacity = 0;
      el.style.transform = "translateY(20px)";
      setTimeout(() => {
        el.style.transition = "opacity .9s cubic-bezier(.16,1,.3,1), transform .9s cubic-bezier(.16,1,.3,1)";
        el.style.opacity = 1;
        el.style.transform = "translateY(0)";
      }, 80 + i * 100);
    });
  }, []);

  useEffect(() => {
    document.body.style.overflow = showModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showModal]);

  const BookBtn = ({ children, style = {}, ...props }) => (
    <button
      onClick={() => setShowModal(true)}
      style={{
        background: T.ink, color: T.cream, border: "none",
        padding: "13px 28px", borderRadius: 9, fontSize: 15, fontWeight: 500,
        cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "background .2s",
        ...style,
      }}
      onMouseEnter={e => e.currentTarget.style.background = "#2a2a2a"}
      onMouseLeave={e => e.currentTarget.style.background = style.background || T.ink}
      {...props}
    >
      {children || "Book a Demo"}
    </button>
  );

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap" rel="stylesheet" />
      <link href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" rel="stylesheet" />

      <style>{`
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: ${T.cream}; }
        .steward { font-family: 'DM Sans', sans-serif; background: ${T.cream}; color: ${T.ink}; overflow-x: hidden; line-height: 1.6; }
        a { text-decoration: none; color: inherit; }
        .nav-a:hover { opacity: 0.6; }
        .btn-text:hover { opacity: 0.6; }
        .feature-card:hover { background: ${T.cream2} !important; }
        .serve-card:hover { background: ${T.cream} !important; }
        .footer-a:hover { opacity: 0.5; }
        .pill-btn:hover { background: ${T.cream2} !important; }
        .quote-card:hover { box-shadow: 0 4px 24px rgba(0,0,0,0.07) !important; }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.75); } }
        .lp-mobile-hamburger { display: none; background: none; border: none; font-size: 22px; cursor: pointer; color: ${T.ink}; padding: 4px; line-height: 1; }
        .lp-nav-cta { display: flex; }
        .lp-mobile-nav-overlay { display: none; position: fixed; inset: 0; z-index: 600; background: rgba(0,0,0,0.45); align-items: flex-end; }
        .lp-mobile-nav-open { display: flex !important; }
        .lp-mobile-nav-drawer { background: ${T.cream}; border-radius: 20px 20px 0 0; width: 100%; padding-bottom: env(safe-area-inset-bottom, 0px); }
        .lp-mobile-nav-handle { width: 36px; height: 4px; border-radius: 2px; background: ${T.cream3}; margin: 12px auto 8px; }
        .lp-mobile-nav-row { display: flex; align-items: center; padding: 16px 24px; font-family: 'DM Sans', sans-serif; font-size: 17px; color: ${T.ink}; border-bottom: 1px solid ${T.cream3}; text-decoration: none; width: 100%; background: none; border-left: none; border-right: none; border-top: none; cursor: pointer; text-align: left; }
        .lp-mobile-nav-row:hover { background: ${T.cream2}; }
        .mesh-section-mobile { display: none; }
        @media (max-width: 768px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .h1-hero { font-size: 36px !important; letter-spacing: -1px !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .serve-grid { grid-template-columns: 1fr !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .quotes-grid { grid-template-columns: 1fr !important; }
          .nav-links { display: none !important; }
          .definition-block { padding-left: 20px !important; }
          /* Hamburger + nav CTA visibility */
          .lp-mobile-hamburger { display: block !important; }
          .lp-nav-cta { display: none !important; }
          /* Section horizontal padding */
          .lp-section { padding-left: 16px !important; padding-right: 16px !important; }
          .landing-nav { padding: 0 16px !important; }
          /* Hero vertical padding */
          .hero-section { padding-top: 56px !important; padding-bottom: 48px !important; }
          /* Mesh section: swap dark for clean cream on mobile */
          .mesh-section-desktop { display: none !important; }
          .mesh-section-mobile { display: block !important; }
          /* Consulting inner grid: stack */
          .consulting-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
          /* Features + Pricing section headers: stack */
          .features-header { grid-template-columns: 1fr !important; gap: 12px !important; }
          .pricing-header { grid-template-columns: 1fr !important; gap: 12px !important; }
          /* Who we serve rows: stack to single column */
          .serve-row { grid-template-columns: 1fr !important; gap: 6px !important; padding: 24px 16px !important; }
          /* Footer */
          .landing-footer { padding: 28px 16px !important; }
        }
      `}</style>

      {showModal && <DemoModal onClose={() => setShowModal(false)} />}

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div className="lp-mobile-nav-overlay lp-mobile-nav-open" onClick={() => setMobileNavOpen(false)}>
          <div className="lp-mobile-nav-drawer" onClick={e => e.stopPropagation()}>
            <div className="lp-mobile-nav-handle" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 24px 12px" }}>
              <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>Steward</span>
              <button onClick={() => setMobileNavOpen(false)} style={{ background: "none", border: "none", fontSize: 24, color: T.ink3, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            {[["Features","#features"],["Pricing","#pricing"],["Consulting","#consulting"]].map(([l,h]) => (
              <a key={l} href={h} className="lp-mobile-nav-row" onClick={() => setMobileNavOpen(false)}>{l}</a>
            ))}
            <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => { navigate("/login"); setMobileNavOpen(false); }}
                style={{ width: "100%", padding: "13px", border: `1px solid ${T.cream3}`, borderRadius: 9, background: "transparent", fontSize: 15, fontWeight: 400, color: T.ink, fontFamily: "'DM Sans',sans-serif", cursor: "pointer" }}>
                Log in
              </button>
              <button onClick={() => { setShowModal(true); setMobileNavOpen(false); }}
                style={{ width: "100%", padding: "13px", border: "none", borderRadius: 9, background: T.ink, color: T.cream, fontSize: 15, fontWeight: 500, fontFamily: "'DM Sans',sans-serif", cursor: "pointer" }}>
                Book a Demo
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="steward">

        {/* ── Announcement bar ── */}
        <div style={{
          background: T.greenDark,
          color: T.cream,
          textAlign: "center",
          padding: "10px 24px",
          fontSize: 14,
          fontFamily: "'DM Sans',sans-serif",
          letterSpacing: "0.06em",
          fontWeight: 400,
        }}>
          Stewarding your mission, so you can focus on what matters.
        </div>

        {/* ── Nav ── */}
        <nav className="landing-nav" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 48px", height: 64,
          background: navShadow ? "rgba(240,237,230,0.92)" : T.cream,
          backdropFilter: "blur(10px)",
          borderBottom: navShadow ? `1px solid ${T.cream3}` : "1px solid transparent",
          position: "sticky", top: 0, zIndex: 100,
          transition: "background .3s, border-color .3s",
        }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: T.ink, letterSpacing: "-0.3px" }}>
            Steward
          </span>
          <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: 36 }}>
            {[["Features","#features"],["Pricing","#pricing"],["Consulting","#consulting"]].map(([l,h]) => (
              <a key={l} href={h} className="nav-a"
                style={{ fontSize: 15, color: T.ink2, transition: "opacity .2s" }}>
                {l}
              </a>
            ))}
          </div>
          <div className="lp-nav-cta" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn-text" onClick={() => navigate("/login")} style={{
              background: "none", border: "none", fontSize: 15, color: T.ink2,
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
              transition: "opacity .2s", padding: "8px 4px",
            }}>Log in</button>
            <BookBtn style={{ padding: "10px 22px", fontSize: 15 }} />
          </div>
          <button className="lp-mobile-hamburger" onClick={() => setMobileNavOpen(true)}>☰</button>
        </nav>

        {/* ── Hero ── */}
        <section className="hero-section lp-section" style={{ padding: "90px 48px 80px", maxWidth: 1200, margin: "0 auto" }}>
          <div data-reveal style={{ marginBottom: 52 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              fontSize: 15, color: T.ink,
              fontFamily: "'DM Serif Display',serif", fontStyle: "italic",
              border: `1.5px solid ${T.greenDark}`,
              background: T.cream,
              padding: "9px 24px", borderRadius: 99,
              letterSpacing: "0.02em",
              boxShadow: `0 1px 8px rgba(26,107,74,0.10)`,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: T.greenDark, display: "inline-block", flexShrink: 0,
                animation: "pulse-dot 2s ease-in-out infinite",
              }} />
              For nonprofits · churches · mission-driven orgs
            </span>
          </div>

          <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", alignItems: "start" }}>
            <div data-reveal>
              <h1 className="h1-hero" style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: "clamp(44px, 5.5vw, 72px)",
                lineHeight: 1.04, letterSpacing: "-2px", color: T.ink,
                fontWeight: 400,
              }}>
                Built for those who{" "}
                <em style={{ fontStyle: "italic" }}>steward</em>
                <br />
                <span style={{ textDecoration: "underline", textDecorationThickness: 3, textUnderlineOffset: 6, textDecorationColor: T.greenDark }}>what matters.</span>
              </h1>
            </div>

            <div data-reveal style={{ paddingTop: 12 }}>
              <p style={{ fontSize: 19, color: T.ink2, lineHeight: 1.7, fontWeight: 300, marginBottom: 36, maxWidth: 420 }}>
                Steward is more than software — it's a partner for nonprofits, churches, and mission-driven organizations who deserve tools as dedicated as they are.
              </p>
              <div style={{ marginBottom: 40 }}>
                <BookBtn style={{ padding: "13px 28px", fontSize: 15 }} />
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                {[
                  { icon: "ti-heart", text: "Built with mission in mind" },
                  { icon: "ti-users", text: "Real human support" },
                  { icon: "ti-clock", text: "10-min setup" },
                ].map(({ icon, text }) => (
                  <div key={text} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: T.ink3 }}>
                    <i className={`ti ${icon}`} style={{ fontSize: 14, color: T.greenDark }} aria-hidden="true" />
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Dark animated mesh card ── */}
        <section className="mesh-section mesh-section-desktop" style={{ padding: "0 32px 80px" }}>
          <div style={{
            position: "relative", borderRadius: 24, overflow: "hidden",
            maxWidth: 1200, margin: "0 auto",
            minHeight: 460, cursor: "crosshair",
          }}>
            <MeshCanvas />
            <div className="mesh-card-inner" style={{ position: "relative", zIndex: 2, padding: "64px 64px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
              <div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)",
                  color: T.green, fontSize: 12, fontWeight: 500,
                  padding: "4px 12px", borderRadius: 20, marginBottom: 24,
                }}>
                  <i className="ti ti-sparkles" style={{ fontSize: 12 }} aria-hidden="true" /> AI-powered pipeline
                </div>
                <h2 style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: "clamp(32px, 3.5vw, 48px)",
                  color: T.white, lineHeight: 1.1, letterSpacing: "-1px", marginBottom: 18,
                }}>
                  Your donors.<br />
                  <em style={{ fontStyle: "italic", color: T.green }}>Always moving forward.</em>
                </h2>
                <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, fontWeight: 300, maxWidth: 380 }}>
                  Steward's AI watches every donor relationship and tells you exactly who to call, what to say, and when — before opportunities go cold.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { icon: "ti-sparkles", label: "AI daily briefings", desc: "Who to call, what to say, and what's urgent — every morning." },
                  { icon: "ti-users", label: "Donor pipeline", desc: "Kanban stages from Prospect to Major Gift, with AI nudges." },
                  { icon: "ti-chart-bar", label: "Wealth scoring", desc: "Capacity tiers and churn risk scored on every relationship." },
                  { icon: "ti-file-text", label: "Grant management", desc: "LOI drafts, deadline tracking, and funder strategy in one place." },
                ].map(f => (
                  <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "13px 16px", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <i className={`ti ${f.icon}`} style={{ fontSize: 16, color: T.green }} aria-hidden="true" />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.white, marginBottom: 2 }}>{f.label}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Mobile stats section (replaces mesh section on mobile) ── */}
        <section className="mesh-section-mobile lp-section" style={{ padding: "64px 24px 72px", background: T.cream, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 40, marginBottom: 40, flexWrap: "wrap" }}>
            {[
              { num: "8+", label: "tools replaced\nby one" },
              { num: "100%", label: "built for\nnonprofits" },
              { num: "$0", label: "hidden\nfees" },
            ].map(s => (
              <div key={s.num}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 56, fontWeight: 400, color: T.greenDark, lineHeight: 1, letterSpacing: "-2px" }}>{s.num}</div>
                <div style={{ fontSize: 13, color: T.ink3, marginTop: 10, lineHeight: 1.5, whiteSpace: "pre-line" }}>{s.label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontFamily: "'DM Serif Display',serif", fontStyle: "italic", fontSize: 20, color: T.ink2, lineHeight: 1.55, maxWidth: 300, margin: "0 auto" }}>
            "Everything your organization runs on. Nothing it doesn't."
          </p>
        </section>

        {/* ── The meaning of Steward ── */}
        <section className="lp-section" style={{ padding: "120px 48px 130px", maxWidth: 860, margin: "0 auto" }}>
          <div
            className="definition-block"
            style={{
              borderLeft: `3px solid ${T.greenDark}`,
              paddingLeft: 36,
              marginBottom: 52,
            }}
          >
            <div style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(36px, 5vw, 58px)",
              color: T.ink,
              lineHeight: 1.1,
              letterSpacing: "-1.5px",
              marginBottom: 8,
            }}>
              stew·ard
            </div>
            <div style={{ fontSize: 17, color: T.ink3, fontStyle: "italic", marginBottom: 28, letterSpacing: "0.01em" }}>
              /ˈsto͞oərd/ · noun
            </div>
            <div style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(18px, 2.2vw, 24px)",
              color: T.ink2,
              lineHeight: 1.75,
            }}>
              A person who manages and protects something entrusted to their care.<br />
              One who serves others not for their own gain, but for the good of those they serve.
            </div>
          </div>
          <p style={{
            fontSize: "clamp(16px, 1.8vw, 19px)",
            color: T.ink3,
            lineHeight: 1.85,
            fontWeight: 300,
            maxWidth: 680,
          }}>
            That's who you are. Every donor call, every grant application, every late night balancing the books — you're not just running an organization. You're protecting something sacred. Steward was built to protect it with you.
          </p>
        </section>

        {/* ── What we do ── */}
        <section className="lp-section" style={{ background: T.cream2, borderTop: `1px solid ${T.cream3}`, borderBottom: `1px solid ${T.cream3}`, padding: "100px 48px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ marginBottom: 52, maxWidth: 520 }}>
              <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 14 }}>What we do</div>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(34px, 4vw, 52px)", letterSpacing: "-1.5px", lineHeight: 1.1, color: T.ink }}>
                We built this for you.
              </h2>
            </div>
            <div className="serve-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
              {[
                {
                  icon: "ti-heart-handshake",
                  title: "Love your donors well",
                  desc: "Every gift is an act of trust. Steward helps you remember the details, follow up with intention, and build relationships that last decades — not just donation cycles.",
                },
                {
                  icon: "ti-coin",
                  title: "Handle every dollar with integrity",
                  desc: "Your donors gave in faith. Honor that with finances you can actually see — fund accounting, budgets, and reports built the way nonprofits work.",
                },
                {
                  icon: "ti-plant",
                  title: "Built to keep you alive and thriving",
                  desc: "Most nonprofits don't fail because of bad missions — they fail because of broken systems. Steward gives you the operational foundation to grow, sustain, and outlast the hard seasons.",
                },
              ].map(c => (
                <div key={c.title} className="serve-card" style={{
                  background: T.cream2,
                  border: `1px solid ${T.cream3}`,
                  borderRadius: 18,
                  padding: "32px 28px",
                  transition: "background .2s, box-shadow .2s",
                }}>
                  <div style={{
                    width: 44, height: 44, background: T.greenDark + "14",
                    borderRadius: 12, display: "flex", alignItems: "center",
                    justifyContent: "center", marginBottom: 20,
                  }}>
                    <i className={`ti ${c.icon}`} style={{ fontSize: 22, color: T.greenDark }} aria-hidden="true" />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: T.ink, marginBottom: 10 }}>{c.title}</div>
                  <div style={{ fontSize: 14, color: T.ink3, lineHeight: 1.7 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Relational, not transactional ── */}
        <section className="lp-section" style={{ background: T.greenDark, padding: "110px 48px" }}>
          <div style={{ maxWidth: 780, margin: "0 auto", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "rgba(240,237,230,0.5)", fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 20 }}>Our commitment</div>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(32px, 4.5vw, 56px)",
              color: T.cream,
              lineHeight: 1.1,
              letterSpacing: "-1.5px",
              marginBottom: 28,
            }}>
              We don't just onboard you<br />and disappear.
            </h2>
            <p style={{ fontSize: "clamp(15px, 1.8vw, 18px)", color: "rgba(240,237,230,0.72)", lineHeight: 1.8, fontWeight: 300, marginBottom: 40 }}>
              Every organization that joins Steward gets a real human partner — someone who learns your mission, understands your team, and stays with you. We offer hands-on consulting, setup support, and ongoing guidance because we believe the best technology is only as good as the people behind it.
            </p>
            <button
              onClick={() => setShowModal(true)}
              style={{
                background: "rgba(240,237,230,0.12)",
                border: `1px solid rgba(240,237,230,0.28)`,
                color: T.cream,
                padding: "13px 28px",
                borderRadius: 9,
                fontSize: 15,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif",
                transition: "background .2s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(240,237,230,0.2)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(240,237,230,0.12)"}
            >
              Meet your Steward partner →
            </button>
          </div>
        </section>

        {/* ── Who we serve ── */}
        <section className="lp-section" style={{ background: T.cream, borderBottom: `1px solid ${T.cream3}`, padding: "100px 48px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ marginBottom: 64 }}>
              <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 16 }}>Who we serve</div>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(34px, 4vw, 52px)", letterSpacing: "-1.5px", lineHeight: 1.1, color: T.ink, maxWidth: 640 }}>
                The world runs on organizations like yours.
              </h2>
            </div>
            <div>
              {[
                {
                  num: "01",
                  title: "Nonprofits",
                  desc: "You're doing work the world needs. We built Steward so the weight of running an organization never gets in the way of the reason you started it.",
                },
                {
                  num: "02",
                  title: "Churches",
                  desc: "Your congregation is your community. We give you the tools to care for your people, manage your finances, and grow your ministry — without the corporate feel.",
                },
                {
                  num: "03",
                  title: "Mission-driven orgs",
                  desc: "Whatever you're building — if it exists to serve others, Steward exists to serve you. Full stop.",
                },
              ].map((row, i, arr) => (
                <div
                  key={row.num}
                  className="serve-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr 1fr",
                    alignItems: "center",
                    gap: "0 48px",
                    padding: "40px 0 40px 28px",
                    borderLeft: `4px solid ${T.greenDark}`,
                    borderBottom: i < arr.length - 1 ? `1px solid ${T.cream3}` : "none",
                    transition: "background .2s",
                    cursor: "default",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f7f4ef"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.cream3, letterSpacing: "0.05em", userSelect: "none" }}>{row.num}</div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(26px, 3vw, 40px)", color: T.ink, letterSpacing: "-1px", lineHeight: 1.1 }}>{row.title}</div>
                  <div style={{ fontSize: 15, color: T.ink3, lineHeight: 1.75, fontWeight: 300, maxWidth: 480 }}>{row.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <div id="features" className="lp-section" style={{ padding: "100px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 14 }}>Everything in one place</div>
          <div className="features-header" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", marginBottom: 56, alignItems: "end" }}>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 42, letterSpacing: "-1px", lineHeight: 1.1, color: T.ink }}>
              Everything your organization<br />
              needs.{" "}
              <span style={{ textDecoration: "underline", textDecorationColor: T.greenDark, textDecorationThickness: 2, textUnderlineOffset: 5 }}>Nothing it doesn't.</span>
            </h2>
            <p style={{ fontSize: 16, color: T.ink3, lineHeight: 1.7, fontWeight: 300 }}>Every tool built together, not bolted together — so your team spends less time on systems and more time on people.</p>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              { icon: "users", title: "Know your donors deeply", desc: "A Kanban pipeline from Prospect to Steward. Track every touchpoint, touchpoint history, and next move.", badge: "AI next-move suggestions" },
              { icon: "file-text", title: "Never miss a grant", desc: "Track deadlines, draft LOIs, write reports, and discover new funders — all in one place.", badge: "AI LOI drafting" },
              { icon: "mail", title: "Stay in sync with your team", desc: "Segmented email campaigns with AI copywriting, open rate tracking, and SMTP delivery.", badge: "AI email copy" },
              { icon: "chart-bar", title: "Understand your finances", desc: "Budget tracking, grant allocation, YTD vs goal dashboards, and plain-language forecasting.", badge: "AI forecast" },
              { icon: "clipboard-list", title: "Celebrate your volunteers", desc: "Track hours, impact, and conversion to donors. Board management and candidate AI built in.", badge: "AI board reports" },
              { icon: "sparkles", title: "AI that works for your mission", desc: "Every AI feature in Steward is built around your context — your donors, your goals, your language.", badge: "Powered by Claude" },
            ].map(f => (
              <div key={f.title} className="feature-card" style={{
                background: T.cream, border: `1px solid ${T.cream3}`,
                borderRadius: 14, padding: 24, transition: "background .2s",
              }}>
                <div style={{ width: 36, height: 36, background: T.cream2, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <i className={`ti ti-${f.icon}`} style={{ fontSize: 18, color: T.greenDark }} aria-hidden="true" />
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 7, color: T.ink }}>{f.title}</div>
                <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.65 }}>{f.desc}</div>
                {f.badge && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(26,107,74,0.08)", color: T.greenDark, fontSize: 11, padding: "3px 9px", borderRadius: 10, marginTop: 12, border: `1px solid rgba(26,107,74,0.18)` }}>
                    <i className="ti ti-sparkles" style={{ fontSize: 10 }} aria-hidden="true" /> {f.badge}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Consulting ── */}
        <div id="consulting" className="lp-section" style={{ background: T.cream2, borderTop: `1px solid ${T.cream3}`, borderBottom: `1px solid ${T.cream3}`, padding: "100px 48px" }}>
          <div className="consulting-grid" style={{ maxWidth: 860, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 16 }}>Consulting</div>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(32px, 4vw, 48px)", letterSpacing: "-1px", lineHeight: 1.1, color: T.ink, marginBottom: 20 }}>
                Need more than software?
              </h2>
              <p style={{ fontSize: 16, color: T.ink3, lineHeight: 1.75, fontWeight: 300, marginBottom: 32 }}>
                Our consulting team works directly with nonprofits and churches to help with strategic planning, donor development, grant writing support, and organizational systems. We've been in the room — we know what it takes.
              </p>
              <a
                href="mailto:jonathan@stewardapp.dev"
                style={{
                  display: "inline-block",
                  background: T.ink, color: T.cream,
                  padding: "13px 28px", borderRadius: 9,
                  fontSize: 15, fontWeight: 500,
                  fontFamily: "'DM Sans',sans-serif",
                  transition: "background .2s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#2a2a2a"}
                onMouseLeave={e => e.currentTarget.style.background = T.ink}
              >
                Learn about consulting →
              </a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { icon: "ti-map", label: "Strategic planning" },
                { icon: "ti-users", label: "Donor development" },
                { icon: "ti-file-text", label: "Grant writing support" },
                { icon: "ti-settings", label: "Organizational systems" },
              ].map(item => (
                <div key={item.label} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  background: T.cream, border: `1px solid ${T.cream3}`,
                  borderRadius: 12, padding: "16px 20px",
                }}>
                  <div style={{ width: 36, height: 36, background: T.greenDark + "12", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`ti ${item.icon}`} style={{ fontSize: 16, color: T.greenDark }} aria-hidden="true" />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Social proof ── */}
        <div className="lp-section" style={{ padding: "100px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ marginBottom: 52, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 14 }}>In their words</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(32px, 4vw, 48px)", letterSpacing: "-1px", lineHeight: 1.1, color: T.ink }}>
              Trusted by organizations doing real good.
            </h2>
          </div>
          <div className="quotes-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {[
              {
                quote: "Since we started using Steward, our board actually understands our donor pipeline for the first time. It feels like having a development director and a finance team in one tool.",
                name: "Sarah M.",
                title: "Executive Director",
                org: "Riverside Community Foundation",
              },
              {
                quote: "We used to spend two days every month pulling reports from three different systems. Now it takes twenty minutes. The time we've saved goes straight back to our programs.",
                name: "James T.",
                title: "Operations Director",
                org: "Hope Mission",
              },
              {
                quote: "The AI briefing every morning is remarkable. It actually understands what matters to our church and gives us a real game plan. It's like having an experienced fundraiser on the team.",
                name: "Rev. Lisa Chen",
                title: "Lead Pastor",
                org: "New Horizons Church",
              },
            ].map(q => (
              <div key={q.name} className="quote-card" style={{
                background: T.cream,
                border: `1px solid ${T.cream3}`,
                borderRadius: 18,
                padding: "32px 28px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
                transition: "box-shadow .2s",
              }}>
                <div style={{ fontSize: 28, color: T.greenDark, lineHeight: 1, fontFamily: "'DM Serif Display',serif" }}>"</div>
                <p style={{ fontSize: 14, color: T.ink2, lineHeight: 1.8, fontStyle: "italic", flex: 1 }}>{q.quote}</p>
                <div style={{ borderTop: `1px solid ${T.cream3}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{q.name}</div>
                  <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{q.title}, {q.org}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing ── */}
        <div id="pricing" className="lp-section" style={{ background: T.cream2, borderTop: `1px solid ${T.cream3}`, padding: "100px 48px" }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            <div className="pricing-header" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", marginBottom: 56, alignItems: "end" }}>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 42, letterSpacing: "-1px", color: T.ink, lineHeight: 1.1 }}>
                Transparent,<br />flat-rate plans
              </h2>
              <p style={{ fontSize: 16, color: T.ink3, lineHeight: 1.7, fontWeight: 300 }}>No per-seat fees. No module unlocks. No surprises. Everything included from day one.</p>
            </div>
            <div className="pricing-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
              {[
                { tier: "Seed", price: "$149", desc: "Small orgs up to $500k annual budget", features: ["Up to 500 donors", "Donor + grants modules", "2 staff seats", "AI features included"], featured: false },
                { tier: "Growth", price: "$249", desc: "Growing orgs up to $2M annual budget", features: ["Unlimited donors", "All modules", "10 staff seats", "Priority AI + email", "CSV import"], featured: true },
                { tier: "Impact", price: "$399", desc: "Established orgs, multi-program", features: ["Everything in Growth", "Unlimited seats", "Custom domain email", "Dedicated onboarding", "SLA + priority support"], featured: false },
              ].map(p => (
                <div key={p.tier} style={{
                  background: p.featured ? T.ink : T.cream,
                  border: p.featured ? `2px solid ${T.ink}` : `1px solid ${T.cream3}`,
                  borderRadius: 16, padding: 28, position: "relative",
                }}>
                  {p.featured && (
                    <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: T.green, color: T.white, fontSize: 11, fontWeight: 500, padding: "4px 16px", borderRadius: 20, whiteSpace: "nowrap" }}>
                      Most popular
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 500, color: p.featured ? "rgba(255,255,255,0.4)" : T.ink3, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>{p.tier}</div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 44, color: p.featured ? T.white : T.ink, letterSpacing: "-1.5px" }}>
                    {p.price}<span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 400, color: p.featured ? "rgba(255,255,255,0.4)" : T.ink3 }}>/mo</span>
                  </div>
                  <div style={{ fontSize: 13, color: p.featured ? "rgba(255,255,255,0.5)" : T.ink3, margin: "10px 0 20px", lineHeight: 1.5 }}>{p.desc}</div>
                  <hr style={{ border: "none", borderTop: p.featured ? "1px solid rgba(255,255,255,0.1)" : `1px solid ${T.cream3}`, margin: "20px 0" }} />
                  {p.features.map(f => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: p.featured ? "rgba(255,255,255,0.75)" : T.ink2, padding: "5px 0" }}>
                      <i className="ti ti-check" style={{ fontSize: 14, color: T.green, flexShrink: 0 }} aria-hidden="true" /> {f}
                    </div>
                  ))}
                  <button
                    onClick={() => setShowModal(true)}
                    style={{
                      width: "100%", marginTop: 24, padding: 12, borderRadius: 9,
                      fontSize: 14, fontWeight: 500, cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif", transition: "all .2s",
                      border: p.featured ? `1.5px solid ${T.green}` : `1.5px solid ${T.cream3}`,
                      color: p.featured ? T.white : T.ink,
                      background: p.featured ? T.green : "transparent",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = p.featured ? "#0ea371" : T.cream2; }}
                    onMouseLeave={e => { e.currentTarget.style.background = p.featured ? T.green : "transparent"; }}
                  >
                    Book a Demo
                  </button>
                </div>
              ))}
            </div>
            <p style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: T.ink3 }}>
              Replace <s>Bloomerang $199</s> + <s>QuickBooks $85</s> + <s>Mailchimp $60</s> with{" "}
              <span style={{ color: T.greenDark, fontWeight: 500 }}>Steward Growth at $249/mo</span>
            </p>
          </div>
        </div>

        {/* ── Final CTA ── */}
        <div className="lp-section" style={{ padding: "120px 48px", textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(38px, 5vw, 62px)", letterSpacing: "-1.5px", color: T.ink, marginBottom: 20, lineHeight: 1.06 }}>
            Your mission is worth it.{" "}
            <span style={{ textDecoration: "underline", textDecorationColor: T.greenDark, textDecorationThickness: 3, textUnderlineOffset: 6 }}>Let's build something together.</span>
          </h2>
          <p style={{ fontSize: 17, color: T.ink3, marginBottom: 44, fontWeight: 300, lineHeight: 1.65 }}>
            No pressure. No sales pitch. Just a conversation about what you need.
          </p>
          <BookBtn style={{ padding: "16px 40px", fontSize: 16 }} />
        </div>

        {/* ── Footer ── */}
        <footer className="landing-footer" style={{ borderTop: `1px solid ${T.cream3}`, padding: "32px 48px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 24 }}>
            <div>
              <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: T.ink, marginBottom: 6 }}>Steward</div>
              <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.6, maxWidth: 280 }}>
                Stewarding your mission, so you can focus on what matters.
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 11, color: T.ink3, letterSpacing: "0.05em" }}>Nonprofits · Churches · Consulting</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.ink3, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Product</div>
                {[["Features","#features"],["Pricing","#pricing"]].map(([l,h]) => (
                  <a key={l} href={h} className="footer-a" style={{ display: "block", fontSize: 13, color: T.ink3, marginBottom: 6, transition: "opacity .2s" }}>{l}</a>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.ink3, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Company</div>
                {[["Consulting","#consulting"],["Privacy","#"],["Terms","#"]].map(([l,h]) => (
                  <a key={l} href={h} className="footer-a" style={{ display: "block", fontSize: 13, color: T.ink3, marginBottom: 6, transition: "opacity .2s" }}>{l}</a>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.ink3, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Contact</div>
                <a href="mailto:jonathan@stewardapp.dev" className="footer-a" style={{ display: "block", fontSize: 13, color: T.ink3, marginBottom: 6, transition: "opacity .2s" }}>
                  jonathan@stewardapp.dev
                </a>
              </div>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${T.cream3}`, marginTop: 24, paddingTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <p style={{ fontSize: 12, color: T.ink3 }}>© 2026 Steward. Built for nonprofits.</p>
            <button onClick={() => setShowModal(true)} style={{ background: "none", border: "none", fontSize: 12, color: T.greenDark, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>
              Book a Demo →
            </button>
          </div>
        </footer>

      </div>
    </>
  );
}
