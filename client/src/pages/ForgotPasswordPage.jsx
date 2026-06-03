import { useState } from "react";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

const INP = (extra = {}) => ({
  style: {
    width: "100%", background: "#f8f6f0", border: "1px solid #e8e4da",
    borderRadius: 10, padding: "11px 14px", fontSize: 14, color: "#0f1a12",
    outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans',system-ui,sans-serif",
    ...extra,
  },
});

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) { setError("Email is required"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f1a12", display: "flex", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Left panel */}
      <div style={{ width: "40%", minWidth: 260, display: "flex", flexDirection: "column", padding: "48px 40px", flexShrink: 0 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", marginBottom: "auto" }}>
          <div style={{ width: 32, height: 32, background: "#1a6b4a", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" strokeWidth="1.5" fill="none"/>
              <circle cx="8" cy="8" r="2" fill="#f0ede6"/>
            </svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif" }}>Steward</span>
        </Link>

        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 30, fontWeight: 400, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.25, marginBottom: 12 }}>
            Forgot your<br/>password?
          </div>
          <div style={{ fontSize: 14, color: "#8fa896", lineHeight: 1.6 }}>
            We'll send you a reset link.
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#3d5245" }}>
          Remember it?{" "}
          <Link to="/login" style={{ color: "#8fa896", textDecoration: "none", fontWeight: 600 }}>Sign in →</Link>
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 40px 40px 0" }}>
        <div style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: 20, padding: "36px 40px", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 48, height: 48, background: "#f0fdf4", border: "2px solid #bbf7d0", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
                  <path d="M1 9l7 7L21 1" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f1a12", marginBottom: 10 }}>Check your email</div>
              <div style={{ fontSize: 14, color: "#6b7c72", lineHeight: 1.6, marginBottom: 24 }}>
                We sent a reset link to <strong style={{ color: "#0f1a12" }}>{email}</strong>.<br/>
                It expires in 1 hour.
              </div>
              <Link to="/login" style={{ fontSize: 13, color: "#1a6b4a", textDecoration: "none", fontWeight: 600 }}>
                ← Back to login
              </Link>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0f1a12", marginBottom: 6 }}>Reset your password</div>
              <div style={{ fontSize: 13, color: "#6b7c72", marginBottom: 28 }}>
                Enter your account email and we'll send a reset link.
              </div>

              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#6b7c72", marginBottom: 5 }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(""); }}
                    placeholder="you@org.com"
                    required
                    {...INP()}
                  />
                </div>

                {error && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{ background: loading ? "#6b7c72" : "#1a6b4a", border: "none", borderRadius: 12, padding: "13px 24px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginTop: 4 }}
                >
                  {loading ? "Sending…" : "Send reset link →"}
                </button>
              </form>

              <div style={{ marginTop: 20, textAlign: "center" }}>
                <Link to="/login" style={{ fontSize: 13, color: "#8fa896", textDecoration: "none" }}>
                  ← Back to login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
