import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../main";
import { GlobalStyles } from "../components/shared";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

export default function SignupPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const planParam = new URLSearchParams(location.search).get("plan");
  const [form, setForm] = useState({ orgName: "", userName: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverErr, setServerErr] = useState("");

  const set = (k) => (e) => { setForm(p => ({ ...p, [k]: e.target.value })); setErrors(p => ({ ...p, [k]: "" })); };

  function validate() {
    const e = {};
    if (!form.orgName.trim()) e.orgName = "Organization name is required";
    if (!form.userName.trim()) e.userName = "Your name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Enter a valid email address";
    if (!form.password) e.password = "Password is required";
    else if (form.password.length < 8) e.password = "Must be at least 8 characters";
    if (form.confirm !== form.password) e.confirm = "Passwords do not match";
    return e;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true); setServerErr("");
    try {
      const res = await fetch(API + "/auth/register-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName: form.orgName.trim(), userName: form.userName.trim(), email: form.email.trim(), password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      login(data);
      if (planParam && ["seed", "growth", "impact"].includes(planParam)) {
        const checkoutRes = await fetch(API + "/billing/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + data.token },
          body: JSON.stringify({ plan: planParam }),
        });
        const checkoutData = await checkoutRes.json();
        if (checkoutRes.ok && checkoutData.url) { window.location.href = checkoutData.url; return; }
      }
      navigate("/pricing", { replace: true });
    } catch (err) {
      setServerErr(err.message);
    }
    setLoading(false);
  }

  const INP = (k) => ({
    value: form[k],
    onChange: set(k),
    style: {
      width: "100%", background: errors[k] ? "#fff8f8" : "#f8f6f0",
      border: `1px solid ${errors[k] ? "#ef4444" : "#e8e4da"}`,
      borderRadius: 10, padding: "11px 14px", fontSize: 14, color: "#0f1a12",
      outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans',system-ui,sans-serif",
    }
  });

  const LBL = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#6b7c72", marginBottom: 5 };
  const ERR = { fontSize: 12, color: "#ef4444", marginTop: 4 };

  return (
    <div className="signup-shell" style={{ minHeight: "100vh", background: "#0f1a12", display: "flex", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <GlobalStyles/>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Left panel */}
      <div className="signup-left" style={{ width: "40%", minWidth: 280, display: "flex", flexDirection: "column", padding: "48px 40px", flexShrink: 0 }}>
        <div className="signup-left-top" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "auto" }}>
          <div style={{ width: 32, height: 32, background: "#1a6b4a", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#f0ede6"/></svg>
          </div>
          <Link to="/" style={{ fontSize: 16, fontWeight: 700, color: "#f0ede6", textDecoration: "none", fontFamily: "'DM Serif Display',Georgia,serif" }}>Steward</Link>
        </div>

        <div className="signup-left-hero" style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 30, fontWeight: 400, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.25, marginBottom: 16 }}>
            Start your free<br/>30-day trial.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              "No credit card required to start",
              "Import your donors in minutes",
              "Cancel anytime",
            ].map(t => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 20, height: 20, background: "#1a2e1f", border: "1px solid #2d4a35", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span style={{ fontSize: 14, color: "#8fa896" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#3d5245" }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "#8fa896", textDecoration: "none", fontWeight: 600 }}>Sign in →</Link>
        </div>
      </div>

      {/* Right panel */}
      <div className="signup-right" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 40px 40px 0", overflow: "auto" }}>
        <div className="signup-card" style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: 20, padding: "36px 40px", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f1a12", marginBottom: 6 }}>Create your account</div>
          <div style={{ fontSize: 13, color: "#6b7c72", marginBottom: 28 }}>Get your workspace set up in under two minutes.</div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={LBL}>Organization Name</label>
              <input {...INP("orgName")} placeholder="e.g. Riverside Arts Collective"/>
              {errors.orgName && <div style={ERR}>{errors.orgName}</div>}
            </div>
            <div>
              <label style={LBL}>Your Name</label>
              <input {...INP("userName")} placeholder="Full name"/>
              {errors.userName && <div style={ERR}>{errors.userName}</div>}
            </div>
            <div>
              <label style={LBL}>Email</label>
              <input {...INP("email")} type="email" placeholder="you@yourorg.org"/>
              {errors.email && <div style={ERR}>{errors.email}</div>}
            </div>
            <div>
              <label style={LBL}>Password</label>
              <input {...INP("password")} type="password" placeholder="8+ characters"/>
              {errors.password && <div style={ERR}>{errors.password}</div>}
            </div>
            <div>
              <label style={LBL}>Confirm Password</label>
              <input {...INP("confirm")} type="password" placeholder="Repeat your password"/>
              {errors.confirm && <div style={ERR}>{errors.confirm}</div>}
            </div>

            {serverErr && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>
                {serverErr}
              </div>
            )}

            <button type="submit" disabled={loading} style={{ background: loading ? "#6b7c72" : "#1a6b4a", border: "none", borderRadius: 12, padding: "14px 24px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginTop: 4 }}>
              {loading ? "Creating account…" : "Create your account →"}
            </button>
          </form>

          <div style={{ marginTop: 20, fontSize: 11, color: "#9ca896", textAlign: "center", lineHeight: 1.5 }}>
            By signing up you agree to our{" "}
            <Link to="/terms" style={{ color: "#8fa896", textDecoration: "underline" }}>Terms of Service</Link>
            {" "}and{" "}
            <Link to="/privacy" style={{ color: "#8fa896", textDecoration: "underline" }}>Privacy Policy</Link>.
          </div>
        </div>
      </div>
    </div>
  );
}
