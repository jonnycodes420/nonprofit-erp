import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

export default function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();

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

  const card = {
    maxWidth: 420, margin: "80px auto", padding: "40px 36px",
    background: "#fff", borderRadius: 20,
    boxShadow: "0 4px 32px rgba(0,0,0,0.08)", fontFamily: "'DM Sans',sans-serif",
  };
  const inp = {
    width: "100%", boxSizing: "border-box",
    border: "1px solid #e5e7eb", borderRadius: 10, padding: "11px 14px",
    fontSize: 14, color: "#1a1a1a", outline: "none", marginTop: 6, background: "#fafaf9",
  };
  const btn = {
    width: "100%", background: "#10b981", border: "none", borderRadius: 10,
    padding: "13px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
    marginTop: 20, opacity: submitting ? 0.7 : 1,
  };
  const label = { fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginTop: 14 };

  if (status === "loading") {
    return (
      <div style={{ ...card, textAlign: "center", color: "#6b7280" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
        Verifying your invitation…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{ ...card, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>Invite unavailable</div>
        <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>{errMsg}</div>
        <a href="/login" style={{ color: "#10b981", fontSize: 14, fontWeight: 600 }}>Go to login →</a>
      </div>
    );
  }

  if (status === "accepted") {
    return (
      <div style={{ ...card, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>Welcome aboard!</div>
        <div style={{ fontSize: 14, color: "#6b7280" }}>Redirecting you to the dashboard…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fafaf9", display: "flex", alignItems: "flex-start" }}>
      <div style={card}>
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Steward
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a1a", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            You're invited to join
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#10b981", marginTop: 4 }}>
            {invite.orgName}
          </div>
          <div style={{ marginTop: 10, display: "inline-block", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "3px 12px", fontSize: 12, color: "#166534", fontWeight: 600 }}>
            {invite.email} · {invite.role}
          </div>
        </div>

        <form onSubmit={handleAccept}>
          <label style={label}>Your name</label>
          <input style={inp} type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} autoFocus />

          <label style={label}>Create password</label>
          <input style={inp} type="password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} />

          <label style={label}>Confirm password</label>
          <input style={inp} type="password" placeholder="Repeat password" value={confirm} onChange={e => setConfirm(e.target.value)} />

          {formErr && <div style={{ marginTop: 12, fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "9px 12px" }}>{formErr}</div>}

          <button type="submit" style={btn} disabled={submitting}>
            {submitting ? "Creating account…" : "Accept invitation →"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
          Already have an account? <a href="/login" style={{ color: "#10b981", fontWeight: 600 }}>Sign in</a>
        </div>
      </div>
    </div>
  );
}
