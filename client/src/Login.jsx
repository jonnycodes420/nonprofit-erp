import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("admin@creoarts.org");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      localStorage.setItem("npe_token", data.token);
      onLogin(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const inp = {
    width: "100%", background: "#111827", border: "1px solid #374151",
    borderRadius: 10, padding: "11px 14px", color: "#f3f4f6", fontSize: 14,
    outline: "none", fontFamily: "inherit",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#030712", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380, padding: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, background: "linear-gradient(135deg,#10b981,#3b82f6)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 22 }}>◈</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#f9fafb", letterSpacing: "-0.02em" }}>CREO Arts</div>
          <div style={{ fontSize: 12, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 4 }}>Development OS</div>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" required style={inp}
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" required style={inp}
          />
          {error && (
            <div style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 8, padding: "9px 12px", fontSize: 13, color: "#f87171" }}>
              {error}
            </div>
          )}
          <button
            type="submit" disabled={loading}
            style={{ background: loading ? "#1f2937" : "linear-gradient(135deg,#10b981,#3b82f6)", border: "none", borderRadius: 10, padding: "12px 16px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 4 }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#4b5563" }}>
          Demo: admin@creoarts.org / demo1234
        </div>
      </div>
    </div>
  );
}
