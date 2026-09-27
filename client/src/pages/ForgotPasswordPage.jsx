import { useState } from "react";
import { Link } from "react-router-dom";

// FIX-2 C — this surface's colours, named once (it keeps its own palette;
// see tests/fix2-c-hex.test.js for why a public surface does).
const PAL = {
  field: "#f8f6f0",
  fieldEdge: "#e8e4da",
  ink: "#0f1a12",
  cream: "#f0ede6",
  pineMuted: "#3d5245",
  white: "#ffffff",
  mist: "#edf3ee",
  emerald: "#0d5c3a",
  sageGrey: "#6b7c72",
  terra100: "#f6e3dd",
  terra200: "#eac6b8",
  terra700: "#8a3a24",
};


const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

const INP = (extra = {}) => ({
  style: {
    width: "100%", background: PAL.field, border: "1px solid "+PAL.fieldEdge,
    borderRadius: 10, padding: "11px 14px", fontSize: 14, color: PAL.ink,
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
    <div style={{ minHeight: "100vh", background: PAL.ink, display: "flex", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Left panel */}
      <div style={{ width: "40%", minWidth: 260, display: "flex", flexDirection: "column", padding: "48px 40px", flexShrink: 0 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none", marginBottom: "auto" }}>
          <span style={{ fontSize: 22, fontWeight: 400, color: PAL.cream, fontFamily: "'DM Serif Display',Georgia,serif", letterSpacing: "-0.02em" }}>Steward</span>
        </Link>

        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 30, fontWeight: 400, color: PAL.cream, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.25, marginBottom: 12 }}>
            Forgot your<br/>password?
          </div>
          <div style={{ fontSize: 14, color: "rgba(240,237,230,0.7)", lineHeight: 1.6 }}>
            We'll send you a reset link.
          </div>
        </div>

        <div style={{ fontSize: 12, color: PAL.pineMuted }}>
          Remember it?{" "}
          <Link to="/login" style={{ color: "rgba(240,237,230,0.7)", textDecoration: "none", fontWeight: 600 }}>Sign in →</Link>
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 40px 40px 0" }}>
        <div style={{ width: "100%", maxWidth: 440, background: PAL.white, borderRadius: 20, padding: "36px 40px", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 48, height: 48, background: PAL.mist, border: "2px solid "+PAL.emerald+"33", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
                  <path d="M1 9l7 7L21 1" stroke={PAL.emerald} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: PAL.ink, marginBottom: 10 }}>Check your email</div>
              <div style={{ fontSize: 14, color: PAL.sageGrey, lineHeight: 1.6, marginBottom: 24 }}>
                We sent a reset link to <strong style={{ color: PAL.ink }}>{email}</strong>.<br/>
                It expires in 1 hour.
              </div>
              <Link to="/login" style={{ fontSize: 13, color: PAL.emerald, textDecoration: "none", fontWeight: 600 }}>
                ← Back to login
              </Link>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, color: PAL.ink, marginBottom: 6 }}>Reset your password</div>
              <div style={{ fontSize: 13, color: PAL.sageGrey, marginBottom: 28 }}>
                Enter your account email and we'll send a reset link.
              </div>

              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: PAL.sageGrey, marginBottom: 5 }}>
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
                  <div style={{ background: PAL.terra100, border: "1px solid "+PAL.terra200, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: PAL.terra700 }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{ background: loading ? PAL.sageGrey : PAL.emerald, border: "none", borderRadius: 12, padding: "13px 24px", color: PAL.white, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginTop: 4 }}
                >
                  {loading ? "Sending…" : "Send reset link →"}
                </button>
              </form>

              <div style={{ marginTop: 20, textAlign: "center" }}>
                <Link to="/login" style={{ fontSize: 13, color: "rgba(240,237,230,0.7)", textDecoration: "none" }}>
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
