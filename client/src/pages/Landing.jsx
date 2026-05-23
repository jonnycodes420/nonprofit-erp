import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const T = {
  ink:        "#0f1117",
  ink2:       "#3a3d4a",
  ink3:       "#6b7080",
  paper:      "#fafaf8",
  paper2:     "#f2f1ed",
  paper3:     "#e8e6df",
  green:      "#1a6b4a",
  greenLight: "#e8f5ee",
  greenMid:   "#2d9464",
  accent:     "#c8f53a",
};

const styles = {
  page: {
    fontFamily: "'DM Sans', sans-serif",
    background: T.paper,
    color: T.ink,
    lineHeight: 1.6,
    overflowX: "hidden",
    minHeight: "100vh",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 48px",
    borderBottom: `1px solid ${T.paper3}`,
    background: T.paper,
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  navLogo: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 22,
    color: T.green,
    letterSpacing: "-0.5px",
  },
  navLinks: { display: "flex", alignItems: "center", gap: 32 },
  navLink: { fontSize: 14, color: T.ink2, textDecoration: "none", fontWeight: 400 },
  navCta: {
    background: T.green,
    color: "#fff",
    border: "none",
    padding: "9px 20px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
  },
  hero: {
    padding: "100px 48px 80px",
    maxWidth: 1100,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 64,
    alignItems: "center",
  },
  eyebrow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: T.greenLight,
    color: T.green,
    fontSize: 12,
    fontWeight: 500,
    padding: "5px 12px",
    borderRadius: 20,
    marginBottom: 24,
    letterSpacing: ".3px",
  },
  eyebrowDot: { width: 6, height: 6, background: T.greenMid, borderRadius: "50%", display: "inline-block" },
  h1: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 52,
    lineHeight: 1.08,
    letterSpacing: "-1.5px",
    color: T.ink,
    margin: "0 0 20px",
  },
  heroSub: { fontSize: 17, color: T.ink2, lineHeight: 1.65, marginBottom: 36, fontWeight: 300, maxWidth: 420 },
  heroActions: { display: "flex", alignItems: "center", gap: 16 },
  btnPrimary: {
    background: T.green,
    color: "#fff",
    padding: "13px 28px",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
    display: "inline-block",
    textDecoration: "none",
  },
  btnGhost: {
    color: T.ink2,
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
  },
  heroTrust: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    marginTop: 36,
    paddingTop: 28,
    borderTop: `1px solid ${T.paper3}`,
  },
  trustItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: T.ink3 },
  heroVisual: {
    background: T.paper2,
    borderRadius: 20,
    border: `1px solid ${T.paper3}`,
    overflow: "hidden",
    boxShadow: "0 24px 80px rgba(0,0,0,.07)",
  },
  appBar: {
    background: "#fff",
    borderBottom: `1px solid ${T.paper3}`,
    padding: "12px 20px",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  appDot: { width: 10, height: 10, borderRadius: "50%", background: T.paper3 },
  appBarTitle: { fontSize: 12, color: T.ink3, marginLeft: "auto", marginRight: "auto" },
  appContent: { padding: 20 },
  statRow: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 },
  stat: { background: "#fff", borderRadius: 10, padding: 14, border: `1px solid ${T.paper3}` },
  statLabel: { fontSize: 10, color: T.ink3, marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: 500, color: T.ink },
  statSub: { fontSize: 10, color: T.greenMid, marginTop: 2 },
  kanban: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 },
  kanbanCol: { background: "#fff", borderRadius: 10, padding: 10, border: `1px solid ${T.paper3}` },
  kanbanColTitle: { fontSize: 9, fontWeight: 500, color: T.ink3, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 },
  kanbanCard: { background: T.paper2, borderRadius: 7, padding: "8px 10px", marginBottom: 6, border: `1px solid ${T.paper3}` },
  kanbanCardName: { fontSize: 11, fontWeight: 500, color: T.ink, marginBottom: 2 },
  kanbanCardSub: { fontSize: 10, color: T.ink3 },
  aiChip: {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: T.greenLight, color: T.green, fontSize: 9,
    padding: "2px 7px", borderRadius: 10, marginTop: 4,
  },
  logosBar: { borderTop: `1px solid ${T.paper3}`, borderBottom: `1px solid ${T.paper3}`, padding: "24px 48px", textAlign: "center" },
  logosLabel: { fontSize: 12, color: T.ink3, marginBottom: 16, letterSpacing: ".3px", textTransform: "uppercase" },
  logosRow: { display: "flex", justifyContent: "center", alignItems: "center", gap: 12, flexWrap: "wrap" },
  logoPill: { background: T.paper2, border: `1px solid ${T.paper3}`, borderRadius: 8, padding: "8px 20px", fontSize: 13, color: T.ink3, fontWeight: 500 },
  section: { padding: "80px 48px", maxWidth: 1100, margin: "0 auto" },
  sectionEyebrow: { fontSize: 12, fontWeight: 500, color: T.green, letterSpacing: ".5px", textTransform: "uppercase", marginBottom: 12 },
  h2: { fontFamily: "'DM Serif Display', serif", fontSize: 38, letterSpacing: "-1px", lineHeight: 1.15, marginBottom: 16, color: T.ink },
  sectionSub: { fontSize: 16, color: T.ink2, maxWidth: 500, lineHeight: 1.65, fontWeight: 300 },
  featuresGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24, marginTop: 48 },
  featureCard: { background: "#fff", border: `1px solid ${T.paper3}`, borderRadius: 12, padding: 28, transition: "border-color .2s, box-shadow .2s" },
  featureIcon: { width: 40, height: 40, background: T.greenLight, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  featureTitle: { fontSize: 15, fontWeight: 500, marginBottom: 6, color: T.ink },
  featureDesc: { fontSize: 13, color: T.ink3, lineHeight: 1.6 },
  featureBadge: { display: "inline-flex", alignItems: "center", gap: 4, background: T.greenLight, color: T.green, fontSize: 11, padding: "3px 9px", borderRadius: 10, marginTop: 10 },
  pricingSection: { background: T.paper2, borderTop: `1px solid ${T.paper3}`, borderBottom: `1px solid ${T.paper3}`, padding: "80px 48px" },
  pricingInner: { maxWidth: 900, margin: "0 auto" },
  pricingGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 48 },
  pricingCard: { background: "#fff", border: `1px solid ${T.paper3}`, borderRadius: 16, padding: 28, position: "relative" },
  pricingCardFeatured: { background: "#fff", border: `2px solid ${T.green}`, borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 8px 40px rgba(26,107,74,.12)" },
  pricingPopular: { position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: T.green, color: "#fff", fontSize: 11, fontWeight: 500, padding: "4px 14px", borderRadius: 20, whiteSpace: "nowrap" },
  pricingTier: { fontSize: 12, fontWeight: 500, color: T.ink3, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 },
  pricingPrice: { fontFamily: "'DM Serif Display', serif", fontSize: 40, color: T.ink, letterSpacing: "-1px" },
  pricingDesc: { fontSize: 13, color: T.ink3, margin: "8px 0 20px", lineHeight: 1.5 },
  pricingDivider: { border: "none", borderTop: `1px solid ${T.paper3}`, margin: "20px 0" },
  pricingFeature: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.ink2, padding: "5px 0" },
  pricingBtn: { width: "100%", marginTop: 24, padding: 11, borderRadius: 9, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", border: `1.5px solid ${T.green}`, color: T.green, background: "transparent" },
  pricingBtnFeatured: { width: "100%", marginTop: 24, padding: 11, borderRadius: 9, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", border: `1.5px solid ${T.green}`, color: "#fff", background: T.green },
  compare: { background: "#fff", borderTop: `1px solid ${T.paper3}`, padding: "32px 48px", textAlign: "center" },
  compareInner: { maxWidth: 640, margin: "0 auto" },
  ctaSection: { padding: "100px 48px", textAlign: "center", maxWidth: 700, margin: "0 auto" },
  footer: { borderTop: `1px solid ${T.paper3}`, padding: "24px 48px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  footerLinks: { display: "flex", gap: 24 },
  footerLink: { fontSize: 13, color: T.ink3, textDecoration: "none" },
};

function Eyebrow({ children, style }) {
  return (
    <div style={{ ...styles.eyebrow, ...style }}>
      <span style={styles.eyebrowDot} />
      {children}
    </div>
  );
}

function BtnPrimary({ children, onClick }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      style={{ ...styles.btnPrimary, background: hovered ? T.greenMid : T.green, transform: hovered ? "translateY(-1px)" : "none" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

function FeatureCard({ icon, title, desc, badge }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      style={{ ...styles.featureCard, borderColor: hovered ? T.greenMid : T.paper3, boxShadow: hovered ? "0 8px 32px rgba(26,107,74,.08)" : "none" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.featureIcon}>
        <i className={`ti ti-${icon}`} style={{ fontSize: 20, color: T.green }} aria-hidden="true" />
      </div>
      <div style={styles.featureTitle}>{title}</div>
      <div style={styles.featureDesc}>{desc}</div>
      {badge && (
        <div style={styles.featureBadge}>
          <i className="ti ti-sparkles" style={{ fontSize: 11 }} aria-hidden="true" /> {badge}
        </div>
      )}
    </div>
  );
}

function PricingCard({ tier, price, desc, features, featured, onSignup }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div style={featured ? styles.pricingCardFeatured : styles.pricingCard}>
      {featured && <div style={styles.pricingPopular}>Most popular</div>}
      <div style={styles.pricingTier}>{tier}</div>
      <div style={styles.pricingPrice}>
        {price}
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 400, color: T.ink3 }}>/mo</span>
      </div>
      <div style={styles.pricingDesc}>{desc}</div>
      <hr style={styles.pricingDivider} />
      {features.map((f, i) => (
        <div key={i} style={styles.pricingFeature}>
          <i className="ti ti-check" style={{ fontSize: 15, color: T.greenMid, flexShrink: 0 }} aria-hidden="true" />
          {f}
        </div>
      ))}
      <button
        style={featured
          ? { ...styles.pricingBtnFeatured, background: hovered ? T.greenMid : T.green }
          : { ...styles.pricingBtn, background: hovered ? T.greenLight : "transparent" }
        }
        onClick={onSignup}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        Get started
      </button>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const heroRef = useRef(null);

  useEffect(() => {
    const els = heroRef.current?.children;
    if (!els) return;
    Array.from(els).forEach((el, i) => {
      el.style.opacity = 0;
      el.style.transform = "translateY(20px)";
      el.style.transition = `opacity .6s ease ${i * 0.1}s, transform .6s ease ${i * 0.1}s`;
      requestAnimationFrame(() => {
        el.style.opacity = 1;
        el.style.transform = "translateY(0)";
      });
    });
  }, []);

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap" rel="stylesheet" />
      <link href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" rel="stylesheet" />

      <div style={styles.page}>

        <nav style={styles.nav}>
          <span style={styles.navLogo}>Steward</span>
          <div style={styles.navLinks}>
            <a href="#features" style={styles.navLink}>Features</a>
            <a href="#pricing" style={styles.navLink}>Pricing</a>
            <a href="#about" style={styles.navLink}>About</a>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={{ ...styles.navCta, background: "transparent", color: T.ink2, border: `1px solid ${T.paper3}` }} onClick={() => navigate("/login")}>Log in</button>
            <button style={styles.navCta} onClick={() => navigate("/signup")}>Start free trial</button>
          </div>
        </nav>

        <div style={styles.hero} ref={heroRef}>
          <div>
            <Eyebrow>Built for nonprofits</Eyebrow>
            <h1 style={styles.h1}>
              Run your whole org.<br />
              <em style={{ fontStyle: "italic", color: T.green }}>Not just your CRM.</em>
            </h1>
            <p style={styles.heroSub}>
              Steward replaces Bloomerang, QuickBooks, and five spreadsheets — one platform for donors, grants, programs, finance, and your team.
            </p>
            <div style={styles.heroActions}>
              <BtnPrimary onClick={() => navigate("/signup")}>Start free trial</BtnPrimary>
              <button style={styles.btnGhost}>Watch demo <i className="ti ti-arrow-right" aria-hidden="true" /></button>
            </div>
            <div style={styles.heroTrust}>
              <div style={styles.trustItem}><i className="ti ti-lock" style={{ color: T.greenMid }} aria-hidden="true" /> SOC 2 ready</div>
              <div style={styles.trustItem}><i className="ti ti-credit-card" style={{ color: T.greenMid }} aria-hidden="true" /> No credit card needed</div>
              <div style={styles.trustItem}><i className="ti ti-clock" style={{ color: T.greenMid }} aria-hidden="true" /> Setup in 10 min</div>
            </div>
          </div>

          <div style={styles.heroVisual}>
            <div style={styles.appBar}>
              <div style={{ ...styles.appDot, background: "#ff6b6b" }} />
              <div style={{ ...styles.appDot, background: "#ffd93d" }} />
              <div style={{ ...styles.appDot, background: "#6bcb77" }} />
              <div style={styles.appBarTitle}>Steward — CREO Arts</div>
            </div>
            <div style={styles.appContent}>
              <div style={styles.statRow}>
                {[
                  { label: "YTD raised", value: "$84k", sub: "↑ 12% vs goal" },
                  { label: "Active donors", value: "247", sub: "↑ 18 this month" },
                  { label: "Open grants", value: "6", sub: "2 due soon" },
                ].map((s) => (
                  <div key={s.label} style={styles.stat}>
                    <div style={styles.statLabel}>{s.label}</div>
                    <div style={styles.statValue}>{s.value}</div>
                    <div style={styles.statSub}>{s.sub}</div>
                  </div>
                ))}
              </div>
              <div style={styles.kanban}>
                <div style={styles.kanbanCol}>
                  <div style={styles.kanbanColTitle}>Prospect</div>
                  <div style={styles.kanbanCard}>
                    <div style={styles.kanbanCardName}>Maria Chen</div>
                    <div style={styles.kanbanCardSub}>$5k capacity</div>
                    <div style={styles.aiChip}><i className="ti ti-sparkles" style={{ fontSize: 9 }} aria-hidden="true" /> Call script ready</div>
                  </div>
                  <div style={styles.kanbanCard}>
                    <div style={styles.kanbanCardName}>J. Whitfield</div>
                    <div style={styles.kanbanCardSub}>Board referral</div>
                  </div>
                </div>
                <div style={styles.kanbanCol}>
                  <div style={styles.kanbanColTitle}>Cultivate</div>
                  <div style={styles.kanbanCard}>
                    <div style={styles.kanbanCardName}>T. Okonkwo</div>
                    <div style={styles.kanbanCardSub}>$12k capacity</div>
                    <div style={styles.aiChip}><i className="ti ti-sparkles" style={{ fontSize: 9 }} aria-hidden="true" /> High churn risk</div>
                  </div>
                </div>
                <div style={styles.kanbanCol}>
                  <div style={styles.kanbanColTitle}>Steward</div>
                  <div style={styles.kanbanCard}>
                    <div style={styles.kanbanCardName}>R. Patel</div>
                    <div style={styles.kanbanCardSub}>$25k · Major</div>
                    <div style={styles.aiChip}><i className="ti ti-sparkles" style={{ fontSize: 9 }} aria-hidden="true" /> Renewal due</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.logosBar}>
          <p style={styles.logosLabel}>Replaces your current stack</p>
          <div style={styles.logosRow}>
            {["Bloomerang", "QuickBooks", "Mailchimp", "GrantStation", "Spreadsheets"].map((l) => (
              <div key={l} style={styles.logoPill}>{l}</div>
            ))}
          </div>
        </div>

        <div id="features" style={styles.section}>
          <div style={styles.sectionEyebrow}>Everything in one place</div>
          <h2 style={styles.h2}>The full stack for<br />mission-driven orgs</h2>
          <p style={styles.sectionSub}>Every tool your nonprofit needs — built together, not bolted together.</p>
          <div style={styles.featuresGrid}>
            <FeatureCard icon="users" title="Donor moves management" desc="Kanban pipeline from Prospect to Steward. Track every touchpoint, interaction, and next move." badge="AI next-move suggestions" />
            <FeatureCard icon="file-text" title="Grants management" desc="Track deadlines, draft LOIs, write reports, and discover new funders — all AI-assisted." badge="AI LOI drafting" />
            <FeatureCard icon="mail" title="Communications hub" desc="Segmented email campaigns with AI copywriting, open rate tracking, and SMTP delivery." badge="AI email copy" />
            <FeatureCard icon="chart-bar" title="Finance & reporting" desc="Budget tracking, grant allocation, YTD vs goal dashboards, and AI-powered forecasting." badge="AI forecast" />
            <FeatureCard icon="clipboard-list" title="Program management" desc="Track outcomes, measure impact, and generate funder-ready reports automatically." badge="AI impact reports" />
            <FeatureCard icon="shield-check" title="Role-based access" desc="Admin and staff roles with fine-grained permissions. Board, volunteer, and team management built in." />
          </div>
        </div>

        <div id="pricing" style={styles.pricingSection}>
          <div style={styles.pricingInner}>
            <div style={{ textAlign: "center" }}>
              <div style={{ ...styles.sectionEyebrow, textAlign: "center" }}>Simple pricing</div>
              <h2 style={{ ...styles.h2, textAlign: "center" }}>Transparent, flat-rate plans</h2>
              <p style={{ ...styles.sectionSub, margin: "0 auto", textAlign: "center" }}>No per-seat fees. No module unlocks. Everything included.</p>
            </div>
            <div style={styles.pricingGrid}>
              <PricingCard tier="Seed" price="$149" desc="Small orgs up to $500k annual budget" features={["Up to 500 donors", "Donor + grants modules", "2 staff seats", "AI features included"]} onSignup={() => navigate("/signup")} />
              <PricingCard tier="Growth" price="$249" desc="Growing orgs up to $2M annual budget" features={["Unlimited donors", "All modules", "10 staff seats", "Priority AI + email", "CSV import"]} featured onSignup={() => navigate("/signup")} />
              <PricingCard tier="Impact" price="$399" desc="Established orgs, multi-program" features={["Everything in Growth", "Unlimited seats", "Custom domain email", "Dedicated onboarding", "SLA + priority support"]} onSignup={() => navigate("/signup")} />
            </div>
          </div>
        </div>

        <div style={styles.compare}>
          <div style={styles.compareInner}>
            <p style={{ fontSize: 14, color: T.ink3, marginBottom: 16 }}>Replace your entire stack for less than one tool costs today</p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ background: T.paper2, border: `1px solid ${T.paper3}`, borderRadius: 8, padding: "8px 16px", fontSize: 13, color: T.ink2 }}>
                <s style={{ color: T.ink3 }}>Bloomerang $199/mo</s> + <s style={{ color: T.ink3 }}>QuickBooks $85/mo</s> + <s style={{ color: T.ink3 }}>Mailchimp $60/mo</s> = <strong style={{ color: T.greenMid }}>$344+</strong>
              </div>
            </div>
            <p style={{ marginTop: 12, fontSize: 13, color: T.greenMid }}>Steward Growth: $249/mo. Everything included.</p>
          </div>
        </div>

        <div style={styles.ctaSection}>
          <Eyebrow style={{ justifyContent: "center", marginBottom: 20 }}>Free 14-day trial</Eyebrow>
          <h2 style={{ ...styles.h2, fontSize: 44, letterSpacing: "-1.5px" }}>Ready to run your org smarter?</h2>
          <p style={{ fontSize: 16, color: T.ink2, marginBottom: 36, fontWeight: 300 }}>No credit card. No spreadsheets. No switching headache.</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            <BtnPrimary onClick={() => navigate("/signup")}>Start your free trial</BtnPrimary>
            <button style={styles.btnGhost}>Book a demo <i className="ti ti-arrow-right" aria-hidden="true" /></button>
          </div>
        </div>

        <footer style={styles.footer}>
          <span style={{ ...styles.navLogo, fontSize: 18 }}>Steward</span>
          <p style={{ fontSize: 13, color: T.ink3 }}>© 2026 Steward. Built for nonprofits.</p>
          <div style={styles.footerLinks}>
            <a href="#" style={styles.footerLink}>Privacy</a>
            <a href="#" style={styles.footerLink}>Terms</a>
            <a href="#" style={styles.footerLink}>Contact</a>
          </div>
        </footer>

      </div>
    </>
  );
}
