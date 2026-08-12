// BUILD-46 §3 — nonprofit self-serve signup for the Portal tier. GATED: the
// org that signs up here is invisible to donors and un-giftable until (1) its
// EIN verifies against the IRS list, (2) Stripe Connect onboarding completes,
// and (3) a human approves the listing. This page is honest about all three.
// Feature-flagged via /network/config (NETWORK_SIGNUP_ENABLED); renders a
// quiet unavailable state when off.
import React, { useEffect, useState } from "react";
import { T } from "./publicTheme";

const NETWORK_BASE = import.meta.env.VITE_NETWORK_API
  || (import.meta.env.PROD ? "/network-api" : "http://localhost:5601/network");

const S = {
  page: { minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: "'DM Sans',Helvetica,Arial,sans-serif" },
  wrap: { maxWidth: 560, margin: "0 auto", padding: "36px 20px 60px" },
  wordmark: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, letterSpacing: "-0.02em" },
  card: { background: T.white, borderRadius: 12, padding: "24px 26px", margin: "16px 0", border: `1px solid ${T.bg2}` },
  h1: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, margin: "14px 0 6px" },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, margin: "12px 0 4px" },
  input: { width: "100%", padding: "11px 12px", fontSize: 15, border: `1px solid ${T.bg3}`, borderRadius: 8, background: T.white, color: T.ink, boxSizing: "border-box" },
  btn: { background: T.gold, color: T.ink, border: "none", borderRadius: 8, padding: "12px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 16 },
  muted: { color: T.ink3, fontSize: 14, lineHeight: 1.55 },
  err: { color: "#8a3a24", fontSize: 14, marginTop: 8 },
  step: { display: "flex", gap: 10, margin: "8px 0", fontSize: 14 },
};

export default function JoinNetwork() {
  const [flags, setFlags] = useState(null);
  const [f, setF] = useState({ orgName: "", ein: "", email: "", password: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      try { setFlags(await (await fetch(NETWORK_BASE + "/config")).json()); }
      catch { setFlags({ networkSignup: false }); }
    })();
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(NETWORK_BASE + "/signup", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, consent }),
      });
      const body = await r.json().catch(() => null);
      if (r.status === 201) {
        // Same localStorage handoff the normal staff login uses.
        localStorage.setItem("npe_token", body.token);
        localStorage.setItem("npe_user", JSON.stringify(body.user));
        localStorage.setItem("npe_org", JSON.stringify(body.org));
        setDone(body);
      } else setErr(body?.error === "email_in_use" ? body.message : (body?.error || "Something went wrong."));
    } finally { setBusy(false); }
  };
  if (!flags) return <div style={S.page}><div style={S.wrap}><span style={S.wordmark}>Steward</span><p style={S.muted}>Loading…</p></div></div>;
  if (!flags.networkSignup) {
    return <div style={S.page}><div style={S.wrap}><span style={S.wordmark}>Steward</span>
      <div style={S.card}><p style={S.muted}>This page isn't available.</p></div></div></div>;
  }
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <span style={S.wordmark}>Steward</span>
        <h1 style={S.h1}>Give your donors a portal.</h1>
        <p style={S.muted}>
          A white-label donor portal: giving history, receipts, recurring
          self-service, and your impact updates — under your name, into your
          own Stripe account. Not the full CRM; upgrade anytime, your data
          comes with you.
        </p>
        {done ? (
          <div style={S.card}>
            <h2 style={{ ...S.h1, fontSize: 20, marginTop: 0 }}>Application received.</h2>
            <p style={S.muted}>Before donors can see or give to {done.org.name}, three things happen — in order:</p>
            <div style={S.step}><span>1.</span><span>We verify your EIN against the IRS tax-exempt list.</span></div>
            <div style={S.step}><span>2.</span><span>You complete Stripe onboarding (Settings → Giving after signing in) — gifts settle only into your own verified Stripe account.</span></div>
            <div style={S.step}><span>3.</span><span>A human reviews and approves your listing. No exceptions, no auto-approval — that review is what donors trust.</span></div>
            <p style={S.muted}><a href="/dashboard" style={{ color: T.greenDk }}>Continue to your workspace →</a></p>
          </div>
        ) : (
          <div style={S.card}>
            <div style={S.label}>Organization name</div>
            <input style={S.input} value={f.orgName} onChange={set("orgName")} />
            <div style={S.label}>EIN</div>
            <input style={S.input} value={f.ein} onChange={set("ein")} placeholder="12-3456789" />
            <div style={S.label}>Website</div>
            <input style={S.input} value={f.website} onChange={set("website")} placeholder="https://your-org.org" />
            <div style={S.label}>Your work email</div>
            <input style={S.input} type="email" value={f.email} onChange={set("email")} />
            <div style={S.label}>Password</div>
            <input style={S.input} type="password" value={f.password} onChange={set("password")} autoComplete="new-password" />
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, fontSize: 13, color: T.ink3, cursor: "pointer" }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
              <span>I am authorized to act for this organization and agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: T.greenDk }}>Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: T.greenDk }}>Privacy Policy</a>.</span>
            </label>
            <button style={{ ...S.btn, opacity: consent ? 1 : 0.5 }} disabled={busy || !consent} onClick={submit}>{busy ? "Submitting…" : "Apply to join"}</button>
            {err && <p style={S.err}>{err}</p>}
            <p style={{ ...S.muted, fontSize: 13, marginTop: 12 }}>
              Your listing goes live only after EIN verification, Stripe
              onboarding, and human review — donors never see an unverified
              organization.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
