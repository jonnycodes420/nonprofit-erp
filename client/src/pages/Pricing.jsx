import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../main";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

const PLANS = [
  {
    id: "seed",
    name: "Seed",
    price: 99,
    tagline: "For small orgs just getting started.",
    features: [
      "Up to 500 donors",
      "All core features",
      "Email campaigns",
      "Email support",
    ],
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: 249,
    tagline: "Most popular for growing nonprofits.",
    features: [
      "Unlimited donors",
      "Email sequences & automation",
      "Analytics dashboard",
      "Priority support",
    ],
    highlight: true,
  },
  {
    id: "impact",
    name: "Impact",
    price: 499,
    tagline: "Full-featured for established orgs.",
    features: [
      "Everything in Growth",
      "Custom donor fields",
      "Board reports (PDF)",
      "Dedicated onboarding call",
    ],
    highlight: false,
  },
];

export default function Pricing() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(null);
  const isAuthed = !!auth?.token;

  async function selectPlan(planId) {
    if (!isAuthed) { navigate("/signup"); return; }
    setLoading(planId);
    try {
      const res = await fetch(API + "/billing/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + auth.token,
        },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start checkout");
      window.location.href = data.url;
    } catch (err) {
      alert(err.message);
      setLoading(null);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f1a12", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Nav */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 56, background: "#0f1a12", borderBottom: "1px solid #1a2e1f", zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div style={{ width: 28, height: 28, background: "#1a6b4a", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#f0ede6"/></svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif" }}>Steward</span>
        </Link>
        {isAuthed ? (
          <Link to="/dashboard" style={{ fontSize: 13, color: "#8fa896", textDecoration: "none", fontWeight: 600 }}>Go to dashboard →</Link>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link to="/login" style={{ fontSize: 13, color: "#8fa896", textDecoration: "none" }}>Sign in</Link>
            <Link to="/signup" style={{ fontSize: 13, color: "#0f1a12", background: "#f0ede6", borderRadius: 8, padding: "7px 16px", textDecoration: "none", fontWeight: 700 }}>Start free trial</Link>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 960, width: "100%", marginTop: 56 }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#c9a84c", textTransform: "uppercase", marginBottom: 12 }}>Pricing</div>
          <div style={{ fontSize: 36, fontWeight: 400, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.2, marginBottom: 12 }}>
            Choose your plan
          </div>
          <div style={{ fontSize: 15, color: "#8fa896", maxWidth: 420, margin: "0 auto" }}>
            Every plan includes a 30-day free trial. No credit card required until you're ready.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginBottom: 40 }}>
          {PLANS.map(plan => (
            <div key={plan.id} style={{
              background: plan.highlight ? "#f0ede6" : "#1a2e1f",
              border: plan.highlight ? "2px solid #c9a84c" : "1px solid #2d4a35",
              borderRadius: 16,
              padding: "28px 28px 32px",
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}>
              {plan.highlight && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#c9a84c", color: "#0f1a12", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 99, padding: "4px 12px" }}>
                  Most Popular
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: plan.highlight ? "#6b7c72" : "#8fa896", marginBottom: 8 }}>
                {plan.name}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                <span style={{ fontSize: 38, fontWeight: 800, color: plan.highlight ? "#0f1a12" : "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif" }}>${plan.price}</span>
                <span style={{ fontSize: 14, color: plan.highlight ? "#6b7c72" : "#8fa896" }}>/month</span>
              </div>
              <div style={{ fontSize: 13, color: plan.highlight ? "#6b7c72" : "#8fa896", marginBottom: 24, lineHeight: 1.4 }}>
                {plan.tagline}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28, flex: 1 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 18, height: 18, background: plan.highlight ? "#e8f5ef" : "#1a2e1f", border: `1px solid ${plan.highlight ? "#10b981" : "#2d4a35"}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="9" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <span style={{ fontSize: 13, color: plan.highlight ? "#0f1a12" : "#8fa896" }}>{f}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => selectPlan(plan.id)}
                disabled={loading === plan.id}
                style={{
                  background: plan.highlight ? "#1a6b4a" : "transparent",
                  border: plan.highlight ? "none" : "1px solid #2d4a35",
                  borderRadius: 10, padding: "13px 20px",
                  color: plan.highlight ? "#fff" : "#8fa896",
                  fontSize: 14, fontWeight: 700,
                  cursor: loading === plan.id ? "not-allowed" : "pointer",
                  opacity: loading === plan.id ? 0.7 : 1,
                  transition: "all 0.15s",
                }}
              >
                {loading === plan.id ? "Loading…" : isAuthed ? "Start this plan →" : "Start free trial →"}
              </button>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", fontSize: 13, color: "#3d5245" }}>
          All plans include a 30-day free trial.{" "}
          <a href="https://calendly.com/xjca2006/new-meeting" target="_blank" rel="noreferrer" style={{ color: "#8fa896", textDecoration: "none", fontWeight: 600 }}>
            Questions? Book a demo →
          </a>
        </div>
      </div>
    </div>
  );
}
