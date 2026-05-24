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

  // Lock body scroll when modal open
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
        .footer-a:hover { opacity: 0.5; }
        .pill-btn:hover { background: ${T.cream2} !important; }
        @media (max-width: 768px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .h1-hero { font-size: 42px !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .nav-links { display: none !important; }
          .demo-form-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {showModal && <DemoModal onClose={() => setShowModal(false)} />}

      <div className="steward">

        {/* ── Nav ── */}
        <nav style={{
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
            {["Features","Pricing","About"].map(l => (
              <a key={l} href={`#${l.toLowerCase()}`} className="nav-a"
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
        <section style={{ padding: "90px 48px 80px", maxWidth: 1200, margin: "0 auto" }}>
          <div data-reveal style={{ marginBottom: 52 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              fontSize: 13, color: T.ink3, border: `1px solid ${T.cream3}`,
              background: T.cream2, padding: "5px 14px", borderRadius: 20,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.green, display: "inline-block" }} />
              Nonprofit ERP · AI-native
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
                Run your{" "}
                <span style={{ textDecoration: "underline", textDecorationThickness: 3, textUnderlineOffset: 6, textDecorationColor: T.green }}>whole org</span>
                .<br />
                Not just your{" "}
                <span style={{ textDecoration: "underline", textDecorationThickness: 3, textUnderlineOffset: 6, textDecorationColor: T.green }}>CRM</span>
                .
              </h1>
            </div>

            <div data-reveal style={{ paddingTop: 12 }}>
              <p style={{ fontSize: 19, color: T.ink2, lineHeight: 1.7, fontWeight: 300, marginBottom: 36, maxWidth: 420 }}>
                Steward replaces Bloomerang, QuickBooks, and five spreadsheets — one platform for donors, grants, programs, finance, and your team.
              </p>
              <div style={{ marginBottom: 40 }}>
                <BookBtn style={{ padding: "13px 28px", fontSize: 15 }} />
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                {[
                  { icon: "ti-lock", text: "SOC 2 ready" },
                  { icon: "ti-credit-card", text: "No credit card" },
                  { icon: "ti-clock", text: "10-min setup" },
                ].map(({ icon, text }) => (
                  <div key={text} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: T.ink3 }}>
                    <i className={`ti ${icon}`} style={{ fontSize: 14, color: T.green }} aria-hidden="true" />
                    {text}
                  </div>
                ))}
              </div>
            </div>
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
                        <div style={{ fontSize: 16, fontWeight: 500, color: T.white }}>{s.value}</div>
                        <div style={{ fontSize: 9, color: T.green }}>{s.sub}</div>
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
                          <div style={{ fontSize: 10, fontWeight: 500, color: T.white, marginBottom: 2 }}>{col.name}</div>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "rgba(16,185,129,0.15)", color: T.green, fontSize: 8, padding: "2px 6px", borderRadius: 8 }}>
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

        {/* ── Logos ── */}
        <div style={{ borderTop: `1px solid ${T.cream3}`, borderBottom: `1px solid ${T.cream3}`, padding: "24px 48px", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: T.ink3, marginBottom: 16, letterSpacing: ".5px", textTransform: "uppercase" }}>Replaces your entire stack</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            {["Bloomerang", "QuickBooks", "Mailchimp", "GrantStation", "Spreadsheets"].map(l => (
              <div key={l} className="pill-btn" style={{ background: T.cream2, border: `1px solid ${T.cream3}`, borderRadius: 8, padding: "7px 18px", fontSize: 13, color: T.ink3, fontWeight: 500, transition: "background .2s" }}>{l}</div>
            ))}
          </div>
        </div>

        {/* ── Features ── */}
        <div id="features" style={{ padding: "100px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ fontSize: 11, color: T.green, fontWeight: 500, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 14 }}>Everything in one place</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", marginBottom: 56, alignItems: "end" }}>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 42, letterSpacing: "-1px", lineHeight: 1.1, color: T.ink }}>
              The full stack for<br />
              <span style={{ textDecoration: "underline", textDecorationColor: T.green, textDecorationThickness: 2, textUnderlineOffset: 5 }}>mission-driven</span> orgs
            </h2>
            <p style={{ fontSize: 16, color: T.ink3, lineHeight: 1.7, fontWeight: 300 }}>Every tool your nonprofit needs — built together, not bolted together. No integration taxes.</p>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              { icon: "users", title: "Donor moves management", desc: "Kanban pipeline from Prospect to Steward. Track every touchpoint and next move.", badge: "AI next-move suggestions" },
              { icon: "file-text", title: "Grants management", desc: "Track deadlines, draft LOIs, write reports, and discover new funders.", badge: "AI LOI drafting" },
              { icon: "mail", title: "Communications hub", desc: "Segmented email campaigns with AI copywriting, open rate tracking, and SMTP delivery.", badge: "AI email copy" },
              { icon: "chart-bar", title: "Finance & reporting", desc: "Budget tracking, grant allocation, YTD vs goal dashboards, and forecasting.", badge: "AI forecast" },
              { icon: "clipboard-list", title: "Program management", desc: "Track outcomes, measure impact, and generate funder-ready reports automatically.", badge: "AI impact reports" },
              { icon: "shield-check", title: "Role-based access", desc: "Admin and staff roles with fine-grained permissions. Board and volunteer management built in." },
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
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(16,185,129,0.1)", color: T.greenDark, fontSize: 11, padding: "3px 9px", borderRadius: 10, marginTop: 12, border: `1px solid rgba(16,185,129,0.2)` }}>
                    <i className="ti ti-sparkles" style={{ fontSize: 10 }} aria-hidden="true" /> {f.badge}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing ── */}
        <div id="pricing" style={{ background: T.cream2, borderTop: `1px solid ${T.cream3}`, padding: "100px 48px" }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 80px", marginBottom: 56, alignItems: "end" }}>
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

        {/* ── Bottom CTA ── */}
        <div style={{ padding: "120px 48px", textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(38px, 5vw, 62px)", letterSpacing: "-1.5px", color: T.ink, marginBottom: 20, lineHeight: 1.06 }}>
            Ready to run your org{" "}
            <span style={{ textDecoration: "underline", textDecorationColor: T.green, textDecorationThickness: 3, textUnderlineOffset: 6 }}>smarter</span>?
          </h2>
          <p style={{ fontSize: 17, color: T.ink3, marginBottom: 44, fontWeight: 300, lineHeight: 1.65 }}>
            See Steward live with your own data. 30-minute walkthrough, no pressure.
          </p>
          <BookBtn style={{ padding: "16px 40px", fontSize: 16 }} />
        </div>

        {/* ── Footer ── */}
        <footer style={{ borderTop: `1px solid ${T.cream3}`, padding: "24px 48px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>Steward</span>
          <p style={{ fontSize: 13, color: T.ink3 }}>© 2026 Steward. Built for nonprofits.</p>
          <div style={{ display: "flex", gap: 24 }}>
            {["Privacy","Terms","Contact"].map(l => (
              <a key={l} href="#" className="footer-a" style={{ fontSize: 13, color: T.ink3, transition: "opacity .2s" }}>{l}</a>
            ))}
          </div>
        </footer>

      </div>
    </>
  );
}
