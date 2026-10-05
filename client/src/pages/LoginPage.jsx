import { useState } from "react";
import { Link } from "react-router-dom";
import { API } from "../api";
import { safeNext } from "../lib/appUrls";
// FIX-13 Part 6 — a deep link that needed a sign-in (or two-factor) returns
// to that exact page afterwards: ?next= is set by the route guard and by the
// expired-session handler, and only a same-origin path is honoured.
function landingFor(user) {
  if (user?.isSuperAdmin) return "/admin";
  let next = null;
  try { next = safeNext(new URLSearchParams(window.location.search).get("next")); } catch { /* no query */ }
  return next || "/dashboard";
}

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
  greenDark: "#0d5c3a",
  red:    "#8a3a24",  // deep terracotta — errors ride terracotta, never library red
  // FIX-2 C — named here once, where they were inline.
  white: "#ffffff",
  mist: "#edf3ee",
  green200: "#dce7df",
  terra100: "#f6e3dd",
  terra200: "#eac6b8",
};

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState(popAuthNotice);
  const [loading, setLoading]   = useState(false);
  // BUILD-98 (switch) Part 8 — two-step sign-in.
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode]         = useState("");
  const [setup, setSetup]       = useState(null);   // {token, secret, otpauthUrl}
  const [setupCode, setSetupCode] = useState("");
  // SEC-1 — "trust this browser for 30 days" (off by default), and the
  // recovery codes shown once at the end of a forced setup.
  const [trust, setTrust]       = useState(false);
  const [recovery, setRecovery] = useState(null);   // {codes, sentence, data}
  const trustKey = () => "npe_trust_" + String(email || "").trim().toLowerCase();

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
        body: JSON.stringify({ email, password,
          ...(needCode ? { code, trustBrowser: trust } : {}),
          trustToken: (() => { try { return localStorage.getItem(trustKey()) || undefined; } catch { return undefined; } })() }),
      });
      // Prefer the server's SENTENCE over its code. A deactivated account now
      // answers {error:"account_deactivated", message:"This account has been
      // deactivated. Contact your workspace admin."} and rendering `error`
      // would put the machine word on the screen. The older paths send only
      // `error` (already a sentence: "Invalid credentials"), so it stays the
      // fallback.
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.error === "mfa_required") { setNeedCode(true); setNotice(d.message); setLoading(false); return; }
        if (d.error === "mfa_locked") { setNeedCode(true); setError(d.message); setLoading(false); return; }
        throw new Error(d.message || d.error || "Login failed");
      }
      const data = await res.json();
      if (data.mfaSetupRequired) {
        const s0 = await fetch(`${API}/me/mfa/setup`, { method: "POST", headers: { Authorization: "Bearer " + data.token } });
        const sd = await s0.json().catch(() => ({}));
        if (!s0.ok) throw new Error(sd.error || "Two-step setup is not available right now.");
        setSetup({ token: data.token, method: "totp", secret: sd.secret, otpauthUrl: sd.otpauthUrl, qr: sd.qr });
        setNotice(data.message); setLoading(false); return;
      }
      if (data.trustToken) { try { localStorage.setItem(trustKey(), data.trustToken); } catch { /* private window */ } }
      localStorage.setItem("npe_token", data.token);
      localStorage.setItem("npe_user", JSON.stringify(data.user));
      localStorage.setItem("npe_org",  JSON.stringify(data.org));
      window.location.href = landingFor(data.user);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const finishSetup = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/me/mfa/enable`, { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + setup.token },
        body: JSON.stringify({ code: setupCode, method: setup.method }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || "That code did not match.");
      // The recovery codes are shown ONCE, here, before anything else.
      if (d.recoveryCodes?.length && !recovery) { setRecovery({ codes: d.recoveryCodes, sentence: d.recoverySentence, data: d }); setLoading(false); return; }
      localStorage.setItem("npe_token", d.token);
      localStorage.setItem("npe_user", JSON.stringify(d.user));
      localStorage.setItem("npe_org",  JSON.stringify(d.org));
      window.location.href = landingFor(d.user);
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  const useEmailInstead = async () => {
    setError("");
    const r = await fetch(`${API}/me/mfa/setup`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + setup.token }, body: JSON.stringify({ method: "email" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.message || d.error || "Could not send a code."); return; }
    setSetup(x => ({ ...x, method: "email", secret: null, qr: null, otpauthUrl: null })); setNotice(d.sentence);
  };
  const continueAfterCodes = () => {
    const d = recovery.data;
    localStorage.setItem("npe_token", d.token);
    localStorage.setItem("npe_user", JSON.stringify(d.user));
    localStorage.setItem("npe_org",  JSON.stringify(d.org));
    window.location.href = landingFor(d.user);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.cream, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      {/* Nav */}
      <nav style={{ padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 21, color: T.ink, letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        {/* FIX-10 F — SIGNUP IS OPEN, AND THIS LINK STILL SAID IT WAS NOT.
            BUILD-87 F.2 pointed it at the invitation request because self-serve
            signup did not exist. BUILD-90 built it: /signup mints a close link,
            hands over the same Checkout, the same thirty days from signing and
            the same two-click cancel. Sending somebody who wants an account to
            a form that waits for a reply was the last invitation-only door left
            in the product. /invitation stays, for somebody who wants to talk
            first, and its own page offers this door too. */}
        <Link to="/signup" style={{ fontSize: 14, color: T.ink2, textDecoration: "none" }}>
          No account? <span style={{ color: T.forest, fontWeight: 600 }}>Start 30 days free</span>
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
              Everyone who believes in your work is right where you left them.
            </p>
          </div>

          {/* Card */}
          <div style={{
            background: T.white,
            border: `1px solid ${T.cream3}`,
            borderRadius: 16,
            padding: "32px 32px 28px",
            boxShadow: "0 2px 16px rgba(15,15,15,0.06)",
          }}>
            {notice && (
              <div style={{
                background: T.mist,
                border: `1px solid ${T.green200}`,
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: T.greenDark,
                marginBottom: 16,
              }}>
                {notice}
              </div>
            )}
            {recovery && (
              <div data-testid="mfa-recovery" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Your recovery codes</div>
                <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>{recovery.sentence}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 15, color: T.ink }}>
                  {recovery.codes.map(c => <span key={c}>{c}</span>)}
                </div>
                <button type="button" onClick={() => navigator.clipboard?.writeText(recovery.codes.join("\n"))} style={{ ...inputStyle, cursor: "pointer" }}>Copy them</button>
                <button type="button" onClick={continueAfterCodes} style={{ ...inputStyle, cursor: "pointer", fontWeight: 700 }}>I have saved them. Continue</button>
              </div>
            )}
            {setup && !recovery && (
              <form data-testid="mfa-setup" onSubmit={finishSetup} style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                {setup.method === "email" ? (
                  <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>Type the six-digit code we emailed you.</div>
                ) : <>
                  <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>
                    Scan this with your authenticator app, or type the key, then enter the six-digit code it shows.
                  </div>
                  {setup.qr && <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ alignSelf: "center" }}/>}
                  <code style={{ fontSize: 13, wordBreak: "break-all", color: T.ink }}>{setup.secret}</code>
                  <a href={setup.otpauthUrl} style={{ fontSize: 12, color: T.forest }}>Open in an authenticator app on this device</a>
                  <button type="button" onClick={useEmailInstead} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: T.forest, cursor: "pointer", textAlign: "left" }}>No authenticator app? Use a code by email instead</button>
                </>}
                <input value={setupCode} onChange={e => setSetupCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
                  placeholder="123456" aria-label="Six-digit code" required style={inputStyle} />
                {error && <div role="alert" style={{ fontSize: 13, color: T.red }}>{error}</div>}
                <button type="submit" disabled={loading} style={{ ...inputStyle, cursor: "pointer", fontWeight: 700 }}>Turn on two-factor</button>
              </form>
            )}
            {!setup && !recovery && <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

              {needCode && (
                <Field label="Six-digit code">
                  <input value={code} onChange={e => setCode(e.target.value)} inputMode="text" autoComplete="one-time-code"
                    placeholder="123456" required autoFocus style={inputStyle} />
                  <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>Lost your phone? Type one of your recovery codes instead.</div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink2, marginTop: 10 }}>
                    <input type="checkbox" checked={trust} onChange={e => setTrust(e.target.checked)} data-testid="trust-browser"/>
                    Trust this browser for 30 days
                  </label>
                </Field>
              )}

              {error && (
                <div style={{
                  background: T.terra100,
                  border: `1px solid ${T.terra200}`,
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
            </form>}
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
