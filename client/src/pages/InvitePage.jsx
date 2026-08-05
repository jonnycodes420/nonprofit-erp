import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

// Brand tokens (BUILD-12 palette). The invite page follows the SAME PUBLIC auth
// convention as sign-in/reset (BUILD-36 B1): cream page, serif wordmark +
// headline, GOLD primary action with INK text (never white-on-gold), forest
// links, terracotta errors. It used to be a near-black navy card with the
// retired green button — a different product than the front door. Tokens only;
// guarded by tests/brand-glyph.test.js (§10, the auth-adjacent bucket).
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
  red:    "#8a3a24",   // deep terracotta — errors ride terracotta, never library red
};

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: T.cream, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <nav style={{ padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 21, color: T.ink, letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        <Link to="/login" style={{ fontSize: 14, color: T.ink2, textDecoration: "none" }}>
          Have an account? <span style={{ color: T.forest, fontWeight: 600 }}>Sign in</span>
        </Link>
      </nav>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>{children}</div>
      </div>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  border: `1px solid ${T.cream3}`,
  borderRadius: 16,
  padding: "32px 32px 28px",
  boxShadow: "0 2px 16px rgba(15,15,15,0.06)",
};

export default function InvitePage() {
  const { token } = useParams();

  const [invite, setInvite] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | accepted | error
  const [errMsg, setErrMsg] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState("");

  useEffect(() => {
    fetch(`${API}/auth/invite/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setErrMsg(data.error); setStatus("error"); }
        else { setInvite(data); setStatus("ready"); }
      })
      .catch(() => { setErrMsg("Could not reach the server. Please try again."); setStatus("error"); });
  }, [token]);

  async function handleAccept(e) {
    e.preventDefault();
    setFormErr("");
    if (!name.trim()) return setFormErr("Please enter your name.");
    if (password.length < 8) return setFormErr("Password must be at least 8 characters.");
    if (password !== confirm) return setFormErr("Passwords don't match.");

    setSubmitting(true);
    try {
      const r = await fetch(`${API}/auth/invite/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      const data = await r.json();
      if (!r.ok) { setFormErr(data.error || "Something went wrong."); setSubmitting(false); return; }

      localStorage.setItem("npe_token", data.token);
      localStorage.setItem("npe_user", JSON.stringify(data.user));
      localStorage.setItem("npe_org",  JSON.stringify(data.org));
      setStatus("accepted");
      setTimeout(() => { window.location.href = "/dashboard"; }, 1500);
    } catch {
      setFormErr("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <Shell>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: T.ink3 }}>Verifying your invitation…</div>
        </div>
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: "clamp(30px,5vw,40px)", fontWeight: 400, color: T.ink, lineHeight: 1.15, letterSpacing: "-0.02em", margin: "0 0 10px" }}>
            Invite{" "}<span style={{ borderBottom: `3px solid ${T.gold}`, paddingBottom: 2 }}>unavailable</span>
          </h1>
          <p style={{ fontSize: 15, color: T.ink3, margin: 0 }}>{errMsg}</p>
        </div>
        <div style={cardStyle}>
          <p style={{ fontSize: 14, color: T.ink2, margin: "0 0 16px" }}>
            This invitation may have expired or already been used. Ask your admin to send a new one.
          </p>
          <Link to="/login" style={{ color: T.forest, fontSize: 14, fontWeight: 700, textDecoration: "none" }}>Go to sign in →</Link>
        </div>
      </Shell>
    );
  }

  if (status === "accepted") {
    return (
      <Shell>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ width: 48, height: 48, background: "#f6eccf", border: `1px solid ${T.gold}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 22, color: T.forest }}>✓</div>
          <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, fontWeight: 400, color: T.ink, marginBottom: 8 }}>Welcome aboard</div>
          <div style={{ fontSize: 14, color: T.ink3 }}>Taking you to your workspace…</div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: "clamp(30px,5vw,42px)", fontWeight: 400, color: T.ink, lineHeight: 1.15, letterSpacing: "-0.02em", margin: "0 0 12px" }}>
          You're{" "}<span style={{ borderBottom: `3px solid ${T.gold}`, paddingBottom: 2 }}>invited</span>
        </h1>
        <p style={{ fontSize: 15, color: T.ink3, margin: 0 }}>
          Join <span style={{ color: T.ink2, fontWeight: 700 }}>{invite.orgName}</span> on Steward.
        </p>
        <div style={{ marginTop: 14, display: "inline-block", background: T.cream2, border: `1px solid ${T.cream3}`, borderRadius: 20, padding: "4px 14px", fontSize: 12.5, color: T.ink2, fontWeight: 600 }}>
          {invite.email} · {invite.role}
        </div>
      </div>

      <div style={cardStyle}>
        <form onSubmit={handleAccept} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Your name">
            <input style={inputStyle} type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Create password">
            <input style={inputStyle} type="password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password">
            <input style={inputStyle} type="password" placeholder="Repeat password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </Field>

          {formErr && (
            <div style={{ background: "#f6e3dd", border: `1px solid #eac6b8`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: T.red }}>
              {formErr}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 4,
              background: submitting ? T.cream3 : T.gold,
              border: "none",
              borderRadius: 10,
              padding: "13px 20px",
              color: submitting ? T.ink3 : T.ink,
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              transition: "background 0.15s",
              fontFamily: "inherit",
            }}
          >
            {submitting ? "Creating account…" : "Accept invitation →"}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 20, textAlign: "center", fontSize: 12.5, color: T.ink3 }}>
        Already have an account?{" "}
        <Link to="/login" style={{ color: T.forest, fontWeight: 600, textDecoration: "none" }}>Sign in</Link>
      </div>
    </Shell>
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
