import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const T = {
  cream:      "#f0ede6",
  cream2:     "#e8e4db",
  cream3:     "#ddd9d0",
  ink:        "#0f0f0f",
  ink2:       "#2a2a2a",
  ink3:       "#6b6b6b",
  warmInk:    "#3d2c1e",
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
      ctx.fillStyle = "#150f0a";
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
            // warm amber resting, dark green near cursor
            const r = Math.round(210 * (1 - greenness) + 26  * greenness);
            const g = Math.round(190 * (1 - greenness) + 107 * greenness);
            const b = Math.round(160 * (1 - greenness) + 74  * greenness);
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
          ? `rgba(26,107,74,${0.5 + glow * 0.5})`
          : `rgba(210,190,160,0.35)`;
        ctx.fill();
      });

      const gx = ctx.createRadialGradient(mx * w, my * h, 0, mx * w, my * h, w * 0.28);
      gx.addColorStop(0, "rgba(26,107,74,0.18)");
      gx.addColorStop(0.5, "rgba(180,140,90,0.05)");
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
        background: T.greenDark, color: T.cream, border: "none",
        padding: "13px 28px", borderRadius: 9, fontSize: 15, fontWeight: 500,
        cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "background .2s, box-shadow .2s",
        ...style,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "#154f38"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(26,107,74,0.28)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = style.background || T.greenDark; e.currentTarget.style.boxShadow = "none"; }}
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
        .feature-card:hover { background: #ece8e0 !important; box-shadow: 0 4px 20px rgba(61,44,30,0.07) !important; }
        .serve-card:hover { background: ${T.cream} !important; box-shadow: 0 4px 20px rgba(61,44,30,0.07) !important; }
        .footer-a:hover { opacity: 0.5; }
        .pill-btn:hover { background: ${T.cream2} !important; }
        .quote-card:hover { box-shadow: 0 6px 32px rgba(61,44,30,0.10) !important; }
        .serve-row:hover { background: #ede9e1 !important; }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.72); } }
        @media (max-width: 768px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .h1-hero { font-size: 42px !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .serve-grid { grid-template-columns: 1fr !important; }
          .consulting-grid { grid-template-columns: 1fr !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .quotes-grid { grid-template-columns: 1fr !important; }
          .nav-links { display: none !important; }
          .definition-block { padding-left: 20px !important; }
          .serve-row { grid-template-columns: 40px 1fr !important; }
          .serve-row-desc { display: none !important; }
        }
      `}</style>

      {showModal && <DemoModal onClose={() => setShowModal(false)} />}

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
        <nav style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 48px", height: 64,
          background: navShadow ? "rgba(240,237,230,0.94)" : T.cream,
          backdropFilter: "blur(10px)",
          borderBottom: navShadow ? `1px solid ${T.cream3}` : "1px solid transparent",
          position: "sticky", top: 0, zIndex: 100,
          transition: "background .3s, border-color .3s",
        }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: T.greenDark, letterSpacing: "-0.3px" }}>
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
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn-text" onClick={() => navigate("/login")} style={{
              background: "none", border: "none", fontSize: 15, color: T.ink2,
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
              transition: "opacity .2s", padding: "8px 4px",
            }}>Log in</button>
            <BookBtn style={{ padding: "10px 22px", fontSize: 15 }} />
          </div>
        </nav>

        {/* ── Hero ── */}
        <section style={{ padding: "100px 48px 96px", maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
          <div data-reveal style={{ marginBottom: 40, display: "flex", justifyContent: "center" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              fontSize: 15, color: T.warmInk,
              fontFamily: "'DM Serif Display',serif", fontStyle: "italic",
              border: `1.5px solid ${T.greenDark}`,
              background: T.cream,
              padding: "9px 24px", borderRadius: 99,
              letterSpacing: "0.02em",
              boxShadow: `0 2px 12px rgba(26,107,74,0.12)`,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: T.greenDark, display: "inline-block", flexShrink: 0,
                animation: "pulse-dot 2s ease-in-out infinite",
              }} />
              For nonprofits · churches · mission-driven orgs
            </span>
          </div>

          <div data-reveal style={{ marginBottom: 32 }}>
            <h1 className="h1-hero" style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(44px, 6vw, 78px)",
              lineHeight: 1.06, letterSpacing: "-2.5px", color: T.warmInk,
              fontWeight: 400,
            }}>
              Built for those who{" "}
              <em style={{ fontStyle: "italic" }}>steward</em>
              <br />
              <span style={{ textDecoration: "underline", textDecorationThickness: 3, textUnderlineOffset: 8, textDecorationColor: T.greenDark }}>what matters.</span>
            </h1>
          </div>

          <div data-reveal style={{ marginBottom: 48 }}>
            <p style={{ fontSize: 19, color: T.ink3, lineHeight: 1.85, fontWeight: 300, maxWidth: 600, margin: "0 auto" }}>
              Steward is more than software — it's a partner for nonprofits, churches, and mission-driven organizations who deserve tools as dedicated as they are.
            </p>
          </div>

          <div data-reveal style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <BookBtn style={{ padding: "15px 36px", fontSize: 16 }} />
            <p style={{ fontSize: 13, color: T.greenDark, fontStyle: "italic", fontFamily: "'DM Sans',sans-serif", opacity: 0.75 }}>
              No contracts. No pressure. Just a conversation.
            </p>
          </div>
        </section>

        {/* ── Dark animated mesh card ── */}
        <section style={{ padding: "0 32px 80px" }}>
          <div style={{
            position: "relative", borderRadius: 24, overflow: "hidden",
            maxWidth: 1200, margin: "0 auto",
            minHeight: 460, cursor: "crosshair",
          }}>
            <MeshCanvas />
            <div style={{ position: "relative", zIndex: 2, padding: "64px 64px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
              <div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "rgba(26,107,74,0.18)", border: "1px solid rgba(26,107,74,0.35)",
                  color: "#6ee7b7", fontSize: 12, fontWeight: 500,
                  padding: "4px 12px", borderRadius: 20, marginBottom: 24,
                }}>
                  <i className="ti ti-sparkles" style={{ fontSize: 12 }} aria-hidden="true" /> AI-powered pipeline
                </div>
                <h2 style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: "clamp(32px, 3.5vw, 48px)",
                  color: T.cream, lineHeight: 1.1, letterSpacing: "-1px", marginBottom: 18,
                }}>
                  Your donors.<br />
                  <em style={{ fontStyle: "italic", color: "#6ee7b7" }}>Always moving forward.</em>
                </h2>
                <p style={{ fontSize: 16, color: "rgba(240,237,230,0.55)", lineHeight: 1.7, fontWeight: 300, maxWidth: 380 }}>
                  Steward's AI watches every donor relationship and tells you exactly who to call, what to say, and when — before opportunities go cold.
                </p>
              </div>

              <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16, overflow: "hidden" }}>
                <div style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff6b6b" }} />
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffd93d" }} />
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6bcb77" }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: "auto", marginRight: "auto" }}>Steward — CREO Arts</span>
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
                    {[
                      { label: "YTD raised", value: "$84k", sub: "↑ 12%" },
                      { label: "Donors", value: "247", sub: "↑ 18 mo" },
                      { label: "Grants", value: "6", sub: "2 due" },
                    ].map(s => (
                      <div key={s.label} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 16, fontWeight: 500, color: T.cream }}>{s.value}</div>
                        <div style={{ fontSize: 9, color: "#6ee7b7" }}>{s.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {[
                      { title: "Prospect", name: "Maria Chen", ai: "Call script ready" },
                      { title: "Cultivate", name: "T. Okonkwo", ai: "High churn risk" },
                      { title: "Steward", name: "R. Patel", ai: "Renewal due" },
                    ].map(col => (
                      <div key={col.title} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>{col.title}</div>
                        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "7px 8px", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ fontSize: 10, fontWeight: 500, color: T.cream, marginBottom: 2 }}>{col.name}</div>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "rgba(26,107,74,0.22)", color: "#6ee7b7", fontSize: 8, padding: "2px 6px", borderRadius: 8 }}>
                            <i className="ti ti-sparkles" style={{ fontSize: 8 }} aria-hidden="true" /> {col.ai}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── The meaning of Steward ── */}
        <section style={{ padding: "140px 48px 150px", maxWidth: 860, margin: "0 auto" }}>
          <div
            className="definition-block"
            style={{
              borderLeft: `4px solid ${T.greenDark}`,
              paddingLeft: 44,
              marginBottom: 64,
            }}
          >
            <div style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(40px, 5.5vw, 64px)",
              color: T.warmInk,
              lineHeight: 1.05,
              letterSpacing: "-2px",
              marginBottom: 10,
            }}>
              stew·ard
            </div>
            <div style={{ fontSize: 17, color: T.ink3, fontStyle: "italic", marginBottom: 36, letterSpacing: "0.01em" }}>
              /ˈsto͞oərd/ · noun
            </div>
            <div style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(19px, 2.4vw, 26px)",
              color: T.ink2,
              lineHeight: 1.8,
            }}>
              A person who manages and protects something entrusted to their care.<br />
              One who serves others not for their own gain, but for the good of those they serve.
            </div>
          </div>
          <p style={{
            fontSize: "clamp(17px, 1.9vw, 20px)",
            color: T.ink3,
            lineHeight: 1.9,
            fontWeight: 300,
            maxWidth: 660,
          }}>
            That's who you are. Every donor call, every grant application, every late night balancing the books — you're not just running an organization. You're protecting something sacred.
          </p>
          <p style={{
            fontSize: "clamp(17px, 1.9vw, 20px)",
            color: T.greenDark,
            lineHeight: 1.9,
            fontWeight: 300,
            maxWidth: 660,
            marginTop: 20,
            fontStyle: "italic",
          }}>
            Steward was built to protect it with you.
          </p>
        </section>

        {/* ── What we do ── */}
        <section style={{ background: T.cream2, borderTop: `1px solid ${T.cream3}`, borderBottom: `1px solid ${T.cream3}`, padding: "100px 48px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ marginBottom: 56, maxWidth: 520 }}>
              <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 14 }}>What we do</div>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(34px, 4vw, 52px)", letterSpacing: "-1.5px", lineHeight: 1.1, color: T.warmInk }}>
                We built this for you.
              </h2>
            </div>
            <div className="serve-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
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
                  borderRadius: 22,
                  padding: "36px 32px",
                  transition: "background .2s, box-shadow .2s",
                  boxShadow: "0 2px 12px rgba(61,44,30,0.04)",
                }}>
                  <div style={{
                    width: 48, height: 48, background: T.greenDark + "14",
                    borderRadius: 14, display: "flex", alignItems: "center",
                    justifyContent: "center", marginBottom: 22,
                  }}>
                    <i className={`ti ${c.icon}`} style={{ fontSize: 24, color: T.greenDark }} aria-hidden="true" />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: T.warmInk, marginBottom: 12, lineHeight: 1.3 }}>{c.title}</div>
                  <div style={{ fontSize: 14, color: T.ink3, lineHeight: 1.75 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Relational, not transactional ── */}
        <section style={{ background: T.greenDark, padding: "130px 48px" }}>
          <div style={{ maxWidth: 820, margin: "0 auto", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "rgba(240,237,230,0.45)", fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 24 }}>Our commitment</div>
            <h2 style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: "clamp(36px, 5vw, 64px)",
              color: T.cream,
              lineHeight: 1.08,
              letterSpacing: "-2px",
              marginBottom: 32,
            }}>
              We don't just onboard you<br />and disappear.
            </h2>
            <p style={{ fontSize: "clamp(16px, 1.9vw, 19px)", color: "rgba(240,237,230,0.70)", lineHeight: 1.85, fontWeight: 300, marginBottom: 48, maxWidth: 680, margin: "0 auto 48px" }}>
              Every organization that joins Steward gets a real human partner — someone who learns your mission, understands your team, and stays with you. We offer hands-on consulting, setup support, and ongoing guidance because we believe the best technology is only as good as the people behind it.
            </p>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <button
                onClick={() => setShowModal(true)}
                style={{
                  background: "rgba(240,237,230,0.12)",
                  border: `1px solid rgba(240,237,230,0.30)`,
                  color: T.cream,
                  padding: "14px 32px",
                  borderRadius: 9,
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                  transition: "background .2s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(240,237,230,0.22)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(240,237,230,0.12)"}
              >
                Meet your Steward partner →
              </button>
              <p style={{ fontSize: 13, color: "rgba(240,237,230,0.45)", fontStyle: "italic", fontFamily: "'DM Sans',sans-serif" }}>
                We've been in the room. We know what it takes.
              </p>
            </div>
          </div>
        </section>

        {/* ── Who we serve ── */}
        <section style={{ background: T.cream, borderBottom: `1px solid ${T.cream3}`, padding: "110px 48px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ marginBottom: 72 }}>
              <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 16 }}>Who we serve</div>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(34px, 4vw, 52px)", letterSpacing: "-1.5px", lineHeight: 1.1, color: T.warmInk, maxWidth: 640 }}>
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
                    gridTemplateColumns: "72px 1fr 1fr",
                    alignItems: "center",
                    gap: "0 48px",
                    padding: "44px 0 44px 32px",
                    borderLeft: `6px solid ${T.greenDark}`,
                    borderBottom: i < arr.length - 1 ? `1px solid ${T.cream3}` : "none",
                    transition: "background .2s",
                    cursor: "default",
                  }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700, color: T.cream3, letterSpacing: "-0.5px", userSelect: "none", fontFamily: "'DM Serif Display',serif" }}>{row.num}</div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(28px, 3.2vw, 44px)", color: T.warmInk, letterSpacing: "-1.5px", lineHeight: 1.1 }}>{row.title}</div>
                  <div className="serve-row-desc" style={{ fontSize: 15, color: T.ink3, lineHeight: 1.8, fontWeight: 300, maxWidth: 480 }}>{row.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <div id="features" style={{ padding: "110px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 14 }}>Everything in one place</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", marginBottom: 56, alignItems: "end" }}>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 42, letterSpacing: "-1px", lineHeight: 1.1, color: T.warmInk }}>
              Everything your organization<br />
              needs.{" "}
              <span style={{ textDecoration: "underline", textDecorationColor: T.greenDark, textDecorationThickness: 2, textUnderlineOffset: 5 }}>Nothing it doesn't.</span>
            </h2>
            <p style={{ fontSize: 16, color: T.ink3, lineHeight: 1.75, fontWeight: 300 }}>Every tool built together, not bolted together — so your team spends less time on systems and more time on people.</p>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
            {[
              { icon: "users", title: "Know your donors deeply", desc: "A Kanban pipeline from Prospect to Steward. Track every touchpoint, interaction history, and next move.", badge: "AI next-move suggestions" },
              { icon: "file-text", title: "Never miss a grant", desc: "Track deadlines, draft LOIs, write reports, and discover new funders — all in one place.", badge: "AI LOI drafting" },
              { icon: "mail", title: "Stay in sync with your team", desc: "Segmented email campaigns with AI copywriting, open rate tracking, and SMTP delivery.", badge: "AI email copy" },
              { icon: "chart-bar", title: "Understand your finances", desc: "Budget tracking, grant allocation, YTD vs goal dashboards, and plain-language forecasting.", badge: "AI forecast" },
              { icon: "clipboard-list", title: "Celebrate your volunteers", desc: "Track hours, impact, and conversion to donors. Board management and candidate AI built in.", badge: "AI board reports" },
              { icon: "sparkles", title: "AI that works for your mission", desc: "Every AI feature in Steward is built around your context — your donors, your goals, your language.", badge: "Powered by Claude" },
            ].map(f => (
              <div key={f.title} className="feature-card" style={{
                background: T.cream, border: `1px solid ${T.cream3}`,
                borderRadius: 18, padding: 28, transition: "background .2s, box-shadow .2s",
              }}>
                <div style={{ width: 40, height: 40, background: T.greenDark + "12", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                  <i className={`ti ti-${f.icon}`} style={{ fontSize: 20, color: T.greenDark }} aria-hidden="true" />
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: T.warmInk, lineHeight: 1.3 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.7 }}>{f.desc}</div>
                {f.badge && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(26,107,74,0.08)", color: T.greenDark, fontSize: 11, padding: "3px 9px", borderRadius: 10, marginTop: 14, border: `1px solid rgba(26,107,74,0.18)` }}>
                    <i className="ti ti-sparkles" style={{ fontSize: 10 }} aria-hidden="true" /> {f.badge}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Consulting ── */}
        <div id="consulting" style={{ background: T.cream2, borderTop: `1px solid ${T.cream3}`, borderBottom: `1px solid ${T.cream3}`, padding: "110px 48px" }}>
          <div className="consulting-grid" style={{ maxWidth: 960, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 16 }}>Consulting</div>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(32px, 4vw, 50px)", letterSpacing: "-1.5px", lineHeight: 1.1, color: T.warmInk, marginBottom: 10 }}>
                Need more than software?
              </h2>
              <p style={{ fontSize: 15, color: T.greenDark, fontStyle: "italic", marginBottom: 20, fontFamily: "'DM Sans',sans-serif" }}>
                This isn't a sales pitch — it's an open door.
              </p>
              <p style={{ fontSize: 16, color: T.ink3, lineHeight: 1.8, fontWeight: 300, marginBottom: 32 }}>
                Our team works directly with nonprofits and churches on strategic planning, donor development, grant writing, and organizational systems. We sit with you, learn your story, and help you build something that lasts. Not a checklist — a real partnership.
              </p>
              <a
                href="mailto:jonathan@stewardapp.dev"
                style={{
                  display: "inline-block",
                  background: T.greenDark, color: T.cream,
                  padding: "13px 28px", borderRadius: 9,
                  fontSize: 15, fontWeight: 500,
                  fontFamily: "'DM Sans',sans-serif",
                  transition: "background .2s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#154f38"}
                onMouseLeave={e => e.currentTarget.style.background = T.greenDark}
              >
                Start a conversation →
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
                  borderRadius: 14, padding: "18px 22px",
                  boxShadow: "0 1px 8px rgba(61,44,30,0.04)",
                }}>
                  <div style={{ width: 38, height: 38, background: T.greenDark + "10", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`ti ${item.icon}`} style={{ fontSize: 18, color: T.greenDark }} aria-hidden="true" />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500, color: T.warmInk }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Social proof ── */}
        <div style={{ padding: "110px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ marginBottom: 56, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: T.greenDark, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 14 }}>In their words</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(32px, 4vw, 48px)", letterSpacing: "-1px", lineHeight: 1.1, color: T.warmInk }}>
              Trusted by organizations doing real good.
            </h2>
          </div>
          <div className="quotes-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22 }}>
            {[
              {
                quote: "I used to dread our monthly finance meetings. Nobody could read the spreadsheets, nobody agreed on the numbers. Steward changed that overnight. Our board actually trusts what they're seeing now.",
                name: "Marcus Webb",
                title: "Church Administrator",
                org: "Grace Fellowship Church",
              },
              {
                quote: "We were managing our donors in one system, our grants in another, and our finances in a third. Nothing talked to anything. Steward is the first tool that actually feels like it was built for how we work.",
                name: "Diane Okafor",
                title: "Executive Director",
                org: "Elevate Youth Foundation",
              },
              {
                quote: "What surprised me most wasn't the features — it was the onboarding. They actually learned about us before they showed us anything. That's rare. That's Steward.",
                name: "Robert Stein",
                title: "Program Director",
                org: "The Harlow Family Foundation",
              },
            ].map(q => (
              <div key={q.name} className="quote-card" style={{
                background: T.cream,
                border: `1px solid ${T.cream3}`,
                borderRadius: 20,
                padding: "36px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
                transition: "box-shadow .2s",
              }}>
                <div style={{ fontSize: 36, color: T.greenDark, lineHeight: 0.9, fontFamily: "'DM Serif Display',serif", opacity: 0.6 }}>"</div>
                <p style={{ fontSize: 14, color: T.ink2, lineHeight: 1.85, fontStyle: "italic", flex: 1 }}>{q.quote}</p>
                <div style={{ borderTop: `1px solid ${T.cream3}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.warmInk }}>{q.name}</div>
                  <div style={{ fontSize: 12, color: T.ink3, marginTop: 3 }}>{q.title}, {q.org}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing ── */}
        <div id="pricing" style={{ background: T.cream2, borderTop: `1px solid ${T.cream3}`, padding: "110px 48px" }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", marginBottom: 56, alignItems: "end" }}>
              <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 42, letterSpacing: "-1px", color: T.warmInk, lineHeight: 1.1 }}>
                Transparent,<br />flat-rate plans
              </h2>
              <p style={{ fontSize: 16, color: T.ink3, lineHeight: 1.75, fontWeight: 300 }}>No per-seat fees. No module unlocks. No surprises. Everything included from day one.</p>
            </div>
            <div className="pricing-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
              {[
                { tier: "Seed", price: "$149", desc: "Small orgs up to $500k annual budget", features: ["Up to 500 donors", "Donor + grants modules", "2 staff seats", "AI features included"], featured: false },
                { tier: "Growth", price: "$249", desc: "Growing orgs up to $2M annual budget", features: ["Unlimited donors", "All modules", "10 staff seats", "Priority AI + email", "CSV import"], featured: true },
                { tier: "Impact", price: "$399", desc: "Established orgs, multi-program", features: ["Everything in Growth", "Unlimited seats", "Custom domain email", "Dedicated onboarding", "SLA + priority support"], featured: false },
              ].map(p => (
                <div key={p.tier} style={{
                  background: p.featured ? T.greenDark : T.cream,
                  border: p.featured ? `2px solid ${T.greenDark}` : `1px solid ${T.cream3}`,
                  borderRadius: 18, padding: 28, position: "relative",
                }}>
                  {p.featured && (
                    <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: T.green, color: T.white, fontSize: 11, fontWeight: 500, padding: "4px 16px", borderRadius: 20, whiteSpace: "nowrap" }}>
                      Most popular
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 500, color: p.featured ? "rgba(240,237,230,0.45)" : T.ink3, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>{p.tier}</div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 44, color: p.featured ? T.cream : T.warmInk, letterSpacing: "-1.5px" }}>
                    {p.price}<span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 400, color: p.featured ? "rgba(240,237,230,0.4)" : T.ink3 }}>/mo</span>
                  </div>
                  <div style={{ fontSize: 13, color: p.featured ? "rgba(240,237,230,0.55)" : T.ink3, margin: "10px 0 20px", lineHeight: 1.5 }}>{p.desc}</div>
                  <hr style={{ border: "none", borderTop: p.featured ? "1px solid rgba(240,237,230,0.12)" : `1px solid ${T.cream3}`, margin: "20px 0" }} />
                  {p.features.map(f => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: p.featured ? "rgba(240,237,230,0.78)" : T.ink2, padding: "5px 0" }}>
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
                      color: p.featured ? T.cream : T.warmInk,
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
        <div style={{ padding: "130px 48px", textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(38px, 5.5vw, 68px)", letterSpacing: "-2px", color: T.warmInk, marginBottom: 24, lineHeight: 1.05 }}>
            You've given everything to your mission.{" "}
            <span style={{ textDecoration: "underline", textDecorationColor: T.greenDark, textDecorationThickness: 3, textUnderlineOffset: 8 }}>Let us give something back.</span>
          </h2>
          <p style={{ fontSize: 18, color: T.ink3, marginBottom: 48, fontWeight: 300, lineHeight: 1.75, maxWidth: 560, margin: "0 auto 48px" }}>
            Book a conversation. No pitch. No pressure. Just us, learning about you.
          </p>
          <BookBtn style={{ padding: "16px 44px", fontSize: 16 }} />
        </div>

        {/* ── Footer ── */}
        <footer style={{ background: T.cream, borderTop: `1px solid ${T.cream3}`, padding: "40px 48px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 24, maxWidth: 1100, margin: "0 auto" }}>
            <div>
              <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: T.greenDark, marginBottom: 8 }}>Steward</div>
              <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.65, maxWidth: 280, fontStyle: "italic" }}>
                Made with care for organizations that care.
              </div>
              <div style={{ marginTop: 10 }}>
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
          <div style={{ borderTop: `1px solid ${T.cream3}`, marginTop: 28, paddingTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, maxWidth: 1100, margin: "28px auto 0" }}>
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
