import { useState } from "react";
import { Link } from "react-router-dom";
import { API } from "../api";

// Message set by api.js handleAuthFailure when a stale/invalid token is cleared.
function popAuthNotice() {
  try {
    const m = sessionStorage.getItem("steward_auth_message");
    if (m) sessionStorage.removeItem("steward_auth_message");
    return m || "";
  } catch { return ""; }
}

// Brand tokens (BUILD-12 palette). Public auth pages follow the PUBLIC brand
// convention — gold primary action + gold title underline (matching the
// landing's "Start free" and the onboarding CTA), forest-green links/accents.
// The off-brand Tailwind emerald-500 was retired here (FIX 2026-07-30);
// it's grep-guarded by tests/brand-glyph.test.js so it can't return.
const T = {
  cream:  "#f0ede6",
  cream2: "#e8e4db",
  cream3: "#ddd9d0",
  ink:    "#0f0f0f",
  ink2:   "#2a2a2a",
  ink3:   "#6b6b6b",
  gold:   "#c9a84c",   // gold500 — primary action + title underline (ink text on it)
  forest: "#0d5c3a",   // greenDk — standard link/accent, WCAG AA on cream
  greenDark: "#1a6b4a",
  red:    "#8a3a24",  // deep terracotta — errors ride terracotta, never library red
};

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState(popAuthNotice);
  const [loading, setLoading]   = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(""); setNotice("");
    try {
      // API resolves to the same Railway URL in production; the previously
      // hardcoded prod URL ignored VITE_API_URL, which made logging in against
      // a local backend (dev/E2E stacks) impossible.
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Login failed"); }
      const data = await res.json();
      localStorage.setItem("npe_token", data.token);
      localStorage.setItem("npe_user", JSON.stringify(data.user));
      localStorage.setItem("npe_org",  JSON.stringify(data.org));
      window.location.href = data.user.isSuperAdmin ? "/admin" : "/dashboard";
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.cream, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      {/* Nav */}
      <nav style={{ padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 21, color: T.ink, letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        <Link to="/signup" style={{ fontSize: 14, color: T.ink2, textDecoration: "none" }}>
          No account? <span style={{ color: T.forest, fontWeight: 600 }}>Sign up free</span>
        </Link>
      </nav>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          {/* Heading */}
          <div style={{ marginBottom: 40 }}>
            <h1 style={{
              fontFamily: "'DM Serif Display',Georgia,serif",
              fontSize: "clamp(32px,5vw,44px)",
              fontWeight: 400,
              color: T.ink,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              margin: "0 0 12px",
            }}>
              Welcome{" "}
              <span style={{
                borderBottom: `3px solid ${T.gold}`,
                paddingBottom: 2,
              }}>
                back
              </span>
            </h1>
            <p style={{ fontSize: 15, color: T.ink3, margin: 0 }}>
              Sign in to your Steward workspace.
            </p>
          </div>

          {/* Card */}
          <div style={{
            background: "#fff",
            border: `1px solid ${T.cream3}`,
            borderRadius: 16,
            padding: "32px 32px 28px",
            boxShadow: "0 2px 16px rgba(15,15,15,0.06)",
          }}>
            {notice && (
              <div style={{
                background: "#edf3ee",
                border: `1px solid #dce7df`,
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: T.greenDark,
                marginBottom: 16,
              }}>
                {notice}
              </div>
            )}
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Field label="Email address">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@org.com"
                  required
                  style={inputStyle}
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={inputStyle}
                />
                <div style={{ textAlign: "right", marginTop: 4 }}>
                  <Link to="/forgot-password" style={{ fontSize: 12, color: T.ink3, textDecoration: "none" }}>
                    Forgot your password?
                  </Link>
                </div>
              </Field>

              {error && (
                <div style={{
                  background: "#f6e3dd",
                  border: `1px solid #eac6b8`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: T.red,
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 4,
                  background: loading ? T.cream3 : T.gold,
                  border: "none",
                  borderRadius: 10,
                  padding: "13px 20px",
                  color: loading ? T.ink3 : T.ink,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "background 0.15s",
                  fontFamily: "inherit",
                }}
              >
                {loading ? "Signing in…" : "Sign In →"}
              </button>
            </form>
          </div>

          {/* Demo hint — LOCAL DEV ONLY. This is the public front door; beta
              users land here, so the demo credentials must never render in a
              production build (same reason demo-cred logging was pulled from
              server startup). Vite strips this branch from prod bundles. */}
          {import.meta.env.DEV && (
            <p style={{ marginTop: 20, fontSize: 12, color: T.ink3, textAlign: "center" }}>
              Demo: <span style={{ fontFamily: "monospace", background: T.cream2, padding: "2px 6px", borderRadius: 4 }}>admin@creoarts.org</span>{" "}
              / <span style={{ fontFamily: "monospace", background: T.cream2, padding: "2px 6px", borderRadius: 4 }}>demo1234</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: T.ink2 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: T.cream,
  border: `1px solid ${T.cream3}`,
  borderRadius: 8,
  padding: "11px 14px",
  color: T.ink,
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};
