import { useState, useEffect, useRef } from "react";
import { T } from "../components/shared";

// FIX-32 · WHERE CHECKOUT LANDS. She has just paid; she is signed in here and
// sent to onboarding, in this browser, without a password. The key in the URL
// is traded once, server-side, against Stripe's own record of the session
// (POST /public/checkout-signin). If the webhook has not made her organisation
// yet the page says so and checks again for up to WAIT_MS. It never shows a
// bare sign-in form: the fallback is a link by email.

const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";
const WAIT_MS = 30000;
const EVERY_MS = 2000;

export default function SignedUpPage() {
  const params = useRef(null);
  if (!params.current) {
    const p = new URLSearchParams(window.location.search);
    params.current = { sessionId: p.get("session_id") || "", key: p.get("k") || "" };
  }
  const [state, setState] = useState({ phase: "waiting", orgName: "" });
  const [mail, setMail] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // The key has done its job once it is in memory; keep it out of history.
    try { window.history.replaceState(null, "", "/signed-up"); } catch { /* old browser */ }
    const { sessionId, key } = params.current;
    if (!sessionId || !key) { setState({ phase: "invalid", orgName: "" }); return; }
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      let r, d = {};
      try {
        r = await fetch(`${API}/public/checkout-signin`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, key }),
        });
        d = await r.json().catch(() => ({}));
      } catch { r = null; }
      if (stopped) return;
      if (r && r.status === 200 && d.token) {
        localStorage.setItem("npe_token", d.token);
        localStorage.setItem("npe_user", JSON.stringify(d.user));
        localStorage.setItem("npe_org", JSON.stringify(d.org));
        window.location.href = Number(d.org && d.org.onboarding_complete) ? "/dashboard" : "/welcome";
        return;
      }
      if (r && r.status === 410) { setState({ phase: "invalid", orgName: d.orgName || "" }); return; }
      if (d.orgName) setState(s => ({ ...s, orgName: d.orgName }));
      if (Date.now() - started >= WAIT_MS) { setState(s => ({ ...s, phase: "slow" })); return; }
      setTimeout(tick, EVERY_MS);
    };
    tick();
    return () => { stopped = true; };
  }, []);

  const emailMe = async () => {
    setSending(true);
    try {
      const r = await fetch(`${API}/public/checkout-signin/email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.current),
      });
      const d = await r.json().catch(() => ({}));
      setMail(d.message || "We could not send that just now. Try again in a minute.");
    } catch {
      setMail("We could not send that just now. Try again in a minute.");
    }
    setSending(false);
  };

  const name = state.orgName || "your organization";
  return (
    <div style={{ minHeight: "100vh", background: T.cream || T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div data-testid="signed-up" style={{ background: T.white || "#fff", borderRadius: 16, padding: "36px 32px", maxWidth: 460, width: "100%", textAlign: "center", color: T.ink }}>
        <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 26, marginBottom: 18 }}>Steward</div>
        {state.phase === "waiting" && (
          <>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Setting up {name}...</h1>
            <p style={{ color: T.ink2, margin: 0 }}>This takes a few seconds. You will be signed in when it is ready.</p>
          </>
        )}
        {state.phase !== "waiting" && (
          <>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
              {state.phase === "slow" ? `${name} is taking longer than usual to set up.` : "This sign-in link has already been used or has expired."}
            </h1>
            <p style={{ color: T.ink2, margin: "0 0 20px" }}>We can email you a link to sign in.</p>
            {mail
              ? <p data-testid="signed-up-mail" style={{ color: T.ink, margin: 0 }}>{mail}</p>
              : <button onClick={emailMe} disabled={sending}
                  style={{ background: T.green, color: T.white || "#fff", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                  {sending ? "Sending..." : "Email me a sign-in link"}
                </button>}
          </>
        )}
      </div>
    </div>
  );
}
