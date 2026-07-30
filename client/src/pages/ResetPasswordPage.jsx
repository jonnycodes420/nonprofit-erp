import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (t) setToken(t);
  }, []);

  function validate() {
    const e = {};
    if (!password) e.password = "Password is required";
    else if (password.length < 8) e.password = "Must be at least 8 characters";
    if (confirm !== password) e.confirm = "Passwords do not match";
    return e;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true); setServerErr("");
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setSuccess(true);
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (err) {
      setServerErr(err.message);
    }
    setLoading(false);
  }

  const INP = (k) => ({
    value: k === "password" ? password : confirm,
    onChange: e => { if (k === "password") setPassword(e.target.value); else setConfirm(e.target.value); setErrors(p => ({ ...p, [k]: "" })); },
    style: {
      width: "100%", background: errors[k] ? "#fff8f8" : "#f8f6f0",
      border: `1px solid ${errors[k] ? "#ef4444" : "#e8e4da"}`,
      borderRadius: 10, padding: "11px 14px", fontSize: 14, color: "#0f1a12",
      outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans',system-ui,sans-serif",
    },
  });

  const LBL = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#6b7c72", marginBottom: 5 };
  const ERR = { fontSize: 12, color: "#ef4444", marginTop: 4 };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1a12", display: "flex", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {/* Left panel */}
      <div style={{ width: "40%", minWidth: 260, display: "flex", flexDirection: "column", padding: "48px 40px", flexShrink: 0 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none", marginBottom: "auto" }}>
          <span style={{ fontSize: 22, fontWeight: 400, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif", letterSpacing: "-0.02em" }}>Steward</span>
        </Link>

        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 30, fontWeight: 400, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.25, marginBottom: 12 }}>
            Set a new<br/>password.
          </div>
          <div style={{ fontSize: 14, color: "#8fa896", lineHeight: 1.6 }}>
            Choose something strong and memorable.
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#3d5245" }}>
          <Link to="/login" style={{ color: "#8fa896", textDecoration: "none", fontWeight: 600 }}>← Back to login</Link>
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 40px 40px 0" }}>
        <div style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: 20, padding: "36px 40px", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
          {success ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 48, height: 48, background: "#e8f5ef", border: "2px solid #0d5c3a33", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
                  <path d="M1 9l7 7L21 1" stroke="#0d5c3a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f1a12", marginBottom: 10 }}>Password updated!</div>
              <div style={{ fontSize: 14, color: "#6b7c72" }}>Redirecting to login…</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0f1a12", marginBottom: 6 }}>Create new password</div>
              <div style={{ fontSize: 13, color: "#6b7c72", marginBottom: 28 }}>Must be at least 8 characters.</div>

              {!token && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 20 }}>
                  Missing reset token. Use the link from your email.
                </div>
              )}

              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label style={LBL}>New Password</label>
                  <input type="password" placeholder="8+ characters" {...INP("password")}/>
                  {errors.password && <div style={ERR}>{errors.password}</div>}
                </div>
                <div>
                  <label style={LBL}>Confirm Password</label>
                  <input type="password" placeholder="Repeat your password" {...INP("confirm")}/>
                  {errors.confirm && <div style={ERR}>{errors.confirm}</div>}
                </div>

                {serverErr && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>
                    {serverErr}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !token}
                  style={{ background: loading || !token ? "#6b7c72" : "#1a6b4a", border: "none", borderRadius: 12, padding: "13px 24px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading || !token ? "not-allowed" : "pointer", marginTop: 4 }}
                >
                  {loading ? "Updating…" : "Set new password →"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
