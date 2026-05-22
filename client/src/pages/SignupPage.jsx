import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../main";

export default function SignupPage() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [form, setForm] = useState({ orgName:"", mission:"", ein:"", email:"", password:"", name:"" });
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const data = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email:      form.email,
          password:   form.password,
          name:       form.name,
          orgName:    form.orgName,
          orgMission: form.mission,
          ein:        form.ein,
        }),
      });
      login(data);
      navigate("/welcome", { replace: true });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const inp = { width:"100%", background:"#111827", border:"1px solid #374151", borderRadius:10, padding:"11px 14px", color:"#f3f4f6", fontSize:14, outline:"none", fontFamily:"inherit" };
  const label = { fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#6b7280", marginBottom:4, display:"block" };

  return (
    <div style={{ minHeight:"100vh", background:"#030712", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif", padding:"24px 16px" }}>
      <div style={{ width:"100%", maxWidth:480 }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ width:48, height:48, background:"linear-gradient(135deg,#10b981,#3b82f6)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", fontSize:22 }}>◈</div>
          <div style={{ fontSize:24, fontWeight:800, color:"#f9fafb", letterSpacing:"-0.02em" }}>Welcome to Steward</div>
          <div style={{ fontSize:13, color:"#6b7280", marginTop:6 }}>Manage what matters. Get your organization set up in minutes.</div>
        </div>

        <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:16 }}>

          <div style={{ background:"#111827", border:"1px solid #1f2937", borderRadius:14, padding:20, display:"flex", flexDirection:"column", gap:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#10b981", letterSpacing:"0.08em", textTransform:"uppercase" }}>Organization</div>
            <div>
              <span style={label}>Organization Name *</span>
              <input value={form.orgName} onChange={set("orgName")} placeholder="e.g. Riverside Arts Collective" required style={inp} />
            </div>
            <div>
              <span style={label}>Mission Statement</span>
              <textarea value={form.mission} onChange={set("mission")} placeholder="What does your organization do and for whom?" rows={3}
                style={{ ...inp, resize:"vertical", lineHeight:1.5 }} />
            </div>
            <div>
              <span style={label}>EIN (optional)</span>
              <input value={form.ein} onChange={set("ein")} placeholder="XX-XXXXXXX" style={inp} />
            </div>
          </div>

          <div style={{ background:"#111827", border:"1px solid #1f2937", borderRadius:14, padding:20, display:"flex", flexDirection:"column", gap:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#3b82f6", letterSpacing:"0.08em", textTransform:"uppercase" }}>Your Account</div>
            <div>
              <span style={label}>Your Name</span>
              <input value={form.name} onChange={set("name")} placeholder="Full name" style={inp} />
            </div>
            <div>
              <span style={label}>Email *</span>
              <input type="email" value={form.email} onChange={set("email")} placeholder="you@yourorg.org" required style={inp} />
            </div>
            <div>
              <span style={label}>Password *</span>
              <input type="password" value={form.password} onChange={set("password")} placeholder="8+ characters" required minLength={8} style={inp} />
            </div>
          </div>

          {error && (
            <div style={{ background:"#ef444422", border:"1px solid #ef444444", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#f87171" }}>{error}</div>
          )}

          <button type="submit" disabled={loading} style={{ background:loading?"#1f2937":"linear-gradient(135deg,#10b981,#3b82f6)", border:"none", borderRadius:12, padding:"14px 16px", color:"#fff", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
            {loading ? "Creating workspace…" : "Create Workspace →"}
          </button>
        </form>

        <div style={{ textAlign:"center", marginTop:20, fontSize:13, color:"#6b7280" }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color:"#10b981", textDecoration:"none", fontWeight:600 }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
