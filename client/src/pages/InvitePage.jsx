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
      setTimeout(() => { window.location.href = "/today"; }, 1500);
    } catch {
      setFormErr("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const wrap = { minHeight:"100vh", background:"#030712", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif", padding:"24px 16px" };
  const card = { width:"100%", maxWidth:440, background:"#111827", border:"1px solid #1f2937", borderRadius:16, padding:"36px 32px" };
  const inp  = { width:"100%", boxSizing:"border-box", background:"#0d1117", border:"1px solid #374151", borderRadius:10, padding:"11px 14px", color:"#f3f4f6", fontSize:14, outline:"none", fontFamily:"inherit" };
  const lbl  = { fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#6b7280", marginBottom:4, display:"block" };

  if (status === "loading") {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign:"center" }}>
          <div style={{ fontSize:14, color:"#6b7280" }}>Verifying your invitation…</div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign:"center" }}>
          <div style={{ fontSize:18, fontWeight:700, color:"#f9fafb", marginBottom:8 }}>Invite unavailable</div>
          <div style={{ fontSize:14, color:"#6b7280", marginBottom:24 }}>{errMsg}</div>
          <a href="/login" style={{ color:"#10b981", fontSize:14, fontWeight:600, textDecoration:"none" }}>Go to login →</a>
        </div>
      </div>
    );
  }

  if (status === "accepted") {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign:"center" }}>
          <div style={{ width:48, height:48, background:"#10b98118", border:"1px solid #10b98140", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", fontSize:22, color:"#10b981" }}>◈</div>
          <div style={{ fontSize:18, fontWeight:700, color:"#f9fafb", marginBottom:8 }}>Welcome aboard!</div>
          <div style={{ fontSize:14, color:"#6b7280" }}>Redirecting you to the dashboard…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ marginBottom:28, textAlign:"center" }}>
          <div style={{ width:48, height:48, background:"linear-gradient(135deg,#10b981,#3b82f6)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", fontSize:22 }}>◈</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#f9fafb", letterSpacing:"-0.02em", lineHeight:1.2 }}>
            You've been invited
          </div>
          <div style={{ fontSize:14, color:"#6b7280", marginTop:6 }}>
            to join <span style={{ color:"#10b981", fontWeight:600 }}>{invite.orgName}</span>
          </div>
          <div style={{ marginTop:12, display:"inline-block", background:"#10b98118", border:"1px solid #10b98140", borderRadius:20, padding:"3px 12px", fontSize:12, color:"#34d399", fontWeight:600 }}>
            {invite.email} · {invite.role}
          </div>
        </div>

        <form onSubmit={handleAccept} style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <span style={lbl}>Your name</span>
            <input style={inp} type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <span style={lbl}>Create password</span>
            <input style={inp} type="password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Confirm password</span>
            <input style={inp} type="password" placeholder="Repeat password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>

          {formErr && (
            <div style={{ background:"#ef444422", border:"1px solid #ef444444", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#f87171" }}>{formErr}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{ background: submitting ? "#1f2937" : "linear-gradient(135deg,#10b981,#3b82f6)", border:"none", borderRadius:12, padding:"13px 16px", color:"#fff", fontSize:15, fontWeight:700, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? "Creating account…" : "Accept invitation →"}
          </button>
        </form>

        <div style={{ marginTop:20, textAlign:"center", fontSize:12, color:"#6b7280" }}>
          Already have an account?{" "}
          <a href="/login" style={{ color:"#10b981", fontWeight:600, textDecoration:"none" }}>Sign in</a>
        </div>
      </div>
    </div>
  );
}
