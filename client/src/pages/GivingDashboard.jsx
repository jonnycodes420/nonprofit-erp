// BUILD-46 §2 — the cross-org donor dashboard: Steward's CONSUMER surface.
// The donor sees their giving across every linked, listed org; each org's
// drill-down is the UNFORKED BUILD-45 portal (rendered by the /giving/orgs/
// route wrapping <Portal/>). Aggregations are read-time, donor-eyes-only.
//
// BUILD-47 adds "find your nonprofits": a searchable directory of LISTED
// orgs (the dashboard empty state leads with it; Home carries a persistent
// "Add organizations" affordance), a followed state for orgs with no
// verified-email match (zero history — no $0 rows pretending), and the
// /giving design pass (DM Serif Display + DM Sans; Ink/Cream/Brass/Emerald).
// Adding an org never, by itself, reveals or implies giving history —
// history appears only through the verified-email link machinery.
//
// BUILD-50 — consumer-surface design polish (composition only, no logic):
//   • the signed-out landing is a full-viewport page: ink hero (the header's
//     ink band bled down behind the hero), fluid-clamp display headline, a
//     compact auth card, a tightened value trio, and the org-blindness
//     promise as a FULL-BLEED ink band — cadence, not a stacked document;
//   • the single-org takeover opens with the org's header image as a real
//     banner (identity plaque against it; solid primary-color band fallback —
//     never bare cream), the follow-state card no longer restates the
//     identity the header just established, impact updates render their
//     photos in a two-column grid, and the footer reads like the org's own
//     site footer (full-bleed primary band).
//
// Brand: CONSUMER_BRAND is the placeholder pending the founder decision —
// every place the string lives is listed in BLOCKED-consumer-brand.md.
// Feature-flagged: the server's /network/config gates this page; with
// DONOR_ACCOUNTS_ENABLED off the page renders a quiet unavailable state.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resolvePairing, cardChrome } from "../lib/portalTheme";

export const CONSUMER_BRAND = "Steward"; // plain Steward (go-live 2026-08-12); rename = one commit (BLOCKED-consumer-brand.md)

// Same-origin in production via the vercel.json /account-api proxy (the
// session cookie must stay first-party); VITE_ACCOUNT_API is the local-
// capture override (Portal.jsx's PORTAL_BASE pattern).
const ACCOUNT_BASE = import.meta.env.VITE_ACCOUNT_API
  || (import.meta.env.PROD ? "/account-api" : "http://localhost:5601/account");
const NETWORK_BASE = import.meta.env.VITE_NETWORK_API
  || (import.meta.env.PROD ? "/network-api" : "http://localhost:5601/network");
// Read-only, public portal config — used ONLY for the pre-auth "you're
// connecting with [org]" courtesy theming (BUILD-48; cosmetic, server
// ignores the from= slug for all logic).
const PORTAL_CFG_BASE = import.meta.env.VITE_PORTAL_API
  || (import.meta.env.PROD ? "/portal-api" : "http://localhost:5601/portal");

async function afetch(path, { method = "GET", body } = {}) {
  const r = await fetch(ACCOUNT_BASE + path, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: parsed };
}
async function nfetch(path) {
  const r = await fetch(NETWORK_BASE + path, { credentials: "include" });
  let parsed = null; try { parsed = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: parsed };
}

// The /giving design language (same values as the app's T tokens — Ink,
// Cream, Brass, Emerald, the sage/pine ramp — no new colors).
const G = {
  ink: "#0f1a12", cream: "#f0ede6", brass: "#c9a84c", emerald: "#0d5c3a",
  sage: "#8fa896", sageDeep: "#6b8f7a", pineHair: "#2d4a35",
  white: "#faf8f4", hair: "#e8e4db", err: "#8a3a24",
};
const SERIF = "'DM Serif Display',Georgia,serif";
const SANS = "'DM Sans',Helvetica,Arial,sans-serif";

const S = {
  page: { minHeight: "100vh", background: G.cream, color: G.ink, fontFamily: SANS },
  wrap: { maxWidth: 880, margin: "0 auto", padding: "0 20px 60px" },
  card: { background: G.white, borderRadius: 12, padding: "22px 24px", margin: "14px 0", border: `1px solid ${G.hair}` },
  h2: { fontFamily: SERIF, fontSize: 22, fontWeight: 400, margin: 0 },
  eyebrow: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.09em", color: G.sageDeep, fontWeight: 700 },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.07em", color: G.sageDeep, margin: "12px 0 4px", fontWeight: 600 },
  input: { width: "100%", padding: "11px 12px", fontSize: 15, border: `1px solid ${G.hair}`, borderRadius: 8, background: G.white, color: G.ink, boxSizing: "border-box", fontFamily: SANS },
  btn: { background: G.brass, color: G.ink, border: "none", borderRadius: 8, padding: "12px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: SANS },
  btnSm: { background: G.brass, color: G.ink, border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: SANS },
  quiet: { background: "transparent", color: G.emerald, border: `1px solid ${G.emerald}`, borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS },
  ghost: { background: "transparent", color: G.sageDeep, border: "none", padding: "6px 4px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS },
  link: { background: "transparent", border: "none", padding: 0, color: G.emerald, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS },
  muted: { color: G.sageDeep, fontSize: 14, lineHeight: 1.55 },
  err: { color: G.err, fontSize: 14, marginTop: 8 },
  tabbtn: (on) => ({ background: "transparent", border: "none", borderBottom: on ? `3px solid ${G.brass}` : "3px solid transparent", padding: "10px 2px", marginRight: 22, fontSize: 14, fontWeight: on ? 700 : 500, color: on ? G.ink : G.sageDeep, cursor: "pointer", fontFamily: SANS }),
};

function fmtMoney(n) { return "$" + Math.round(n || 0).toLocaleString(); }
// Presentational only — "2026-04-14" reads mechanical in a serif stat cell.
function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

// Group account-wide rows (recurring, tax years) by org, preserving order —
// the multi-org tabs render neutral chrome with per-org themed GROUPS.
function groupBySlug(rows) {
  const out = [], idx = {};
  for (const r of rows) {
    if (!(r.orgSlug in idx)) { idx[r.orgSlug] = out.length; out.push({ orgSlug: r.orgSlug, orgName: r.orgName, rows: [] }); }
    out[idx[r.orgSlug]].rows.push(r);
  }
  return out;
}

// One shared stylesheet for the few things inline styles can't do (hover,
// fluid type, the responsive columns). Values stay within the token set above.
// BUILD-50 width strategy: the signed-in shells read at 1060px (1200 on very
// wide screens); the LANDING gets its own wider ladder — 1200 → 1460 (≥1600px
// viewports) → 1640 (≥2100px) — so a 2000px+ screen never strands a small
// centered composition in dead cream gutters.
function GivingStyles() {
  return <style>{`
    .gd-wrap { max-width: 1060px; margin: 0 auto; padding: 0 24px 60px; }
    .gd-headwrap { max-width: 1060px; margin: 0 auto; padding: 0 24px; }
    @media (min-width: 1600px) {
      .gd-wrap, .gd-headwrap { max-width: 1200px; }
    }
    .gd-orgcard { transition: box-shadow .15s ease, transform .15s ease; }
    .gd-orgcard:hover { box-shadow: 0 4px 18px rgba(15,26,18,0.10); transform: translateY(-1px); }
    .gd-dirrow:hover { background: ${G.cream}; }
    @media (max-width: 640px) {
      .gd-stats { flex-direction: column; align-items: flex-start !important; gap: 14px !important; padding: 22px 22px !important; }
      .gd-statdiv { display: none; }
      .gd-orgcard { flex-wrap: wrap; }
      .gd-orgnums { text-align: left !important; width: 100%; margin-top: 6px; padding-left: 58px; }
      .gd-sechead { flex-wrap: wrap; gap: 10px; }
    }
    /* BUILD-49/50 — the signed-out landing */
    .gd-landwrap { max-width: 1200px; margin: 0 auto; padding: 0 32px; }
    @media (min-width: 1600px) { .gd-landwrap { max-width: 1460px; } }
    @media (min-width: 2100px) { .gd-landwrap { max-width: 1640px; } }
    .gd-hero { display: flex; gap: 60px; align-items: center;
      min-height: calc(100vh - 140px); padding: 40px 0 72px; box-sizing: border-box; }
    .gd-landhero-copy { flex: 1; min-width: 0; }
    .gd-landtitle { font-size: clamp(40px, 4.8vw, 88px); }
    .gd-landsub { font-size: clamp(16px, 1.2vw, 19px); }
    .gd-landcard { width: 420px; flex-shrink: 0; }
    .gd-trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
    @media (max-width: 920px) {
      .gd-hero { flex-direction: column; align-items: stretch; min-height: 0; padding: 30px 0 56px; gap: 36px; }
      .gd-landcard { width: 100%; }
      .gd-landwrap { padding: 0 20px; }
    }
    @media (max-width: 720px) {
      .gd-trio { grid-template-columns: 1fr; }
    }
    /* BUILD-50 — the takeover banner + impact grid */
    .gd-tkbanner { height: 250px; overflow: hidden; }
    .gd-tkplaque { margin-top: -52px; position: relative; }
    @media (min-width: 1600px) { .gd-tkbanner { height: 300px; } }
    @media (max-width: 700px) {
      .gd-tkbanner { height: 140px; }
      .gd-tkplaque { margin-top: -30px; padding: 14px 18px !important; }
      .gd-tkname { font-size: 22px !important; }
    }
    .gd-imgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 900px) { .gd-imgrid { grid-template-columns: 1fr; } }
  `}</style>;
}

// flush: the signed-out landing's hero is the same ink field, so the header
// drops its brass rule and merges into it. wide: align to the landing wrap.
function Header({ onSignOut, flush, wide }) {
  return (
    <div style={{ background: G.ink, padding: "18px 0 16px", borderBottom: flush ? "none" : `3px solid ${G.brass}` }}>
      <div className={wide ? "gd-landwrap" : "gd-headwrap"} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span style={{ fontFamily: SERIF, fontSize: 26, letterSpacing: "-0.02em", color: G.cream }}>Steward</span>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: G.sage, marginLeft: 12, fontWeight: 600 }}>Your Giving</span>
        </div>
        {onSignOut && (
          <button onClick={onSignOut}
            style={{ background: "transparent", color: G.sage, border: `1px solid ${G.pineHair}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}

// The entry links (portal nudge, receipt emails, thank-you screens) arrive as
// /giving#signup&from=<slug>&email=… — the donor's already-verified address
// rides the URL FRAGMENT (never sent to any server, the TokenLanding
// convention), lands in signup mode prefilled.
export function initialAuthMode() {
  return /(^|[#&])signup(&|$)/.test(window.location.hash || "") ? "signup" : "login";
}

// BUILD-50 — compact by design: sign-in is email + password + one button;
// "Email me a sign-in link" and "Reset password" are small quiet links, and
// account CREATION lives in the hero (the card no longer repeats it).
function AuthCard({ onSignedIn, mode, setMode }) {
  const [email, setEmail] = useState(() => {
    const m = /email=([^&]+)/.exec(window.location.hash || "");
    try { return m ? decodeURIComponent(m[1]) : ""; } catch { return ""; }
  });
  // BUILD-48 — an on-ramp link from an org's portal may carry from=<org-slug>.
  // Purely a COURTESY: we fetch that org's public portal theme to show
  // "you're connecting with [org]". Cosmetic only — the server never reads
  // it, and the page chrome stays Steward-neutral (pre-auth can't know your
  // orgs; this is one contextual line, not a takeover).
  const [fromSlug] = useState(() => (/(?:^|[#&])from=([A-Za-z0-9-]{1,120})(?:&|$)/.exec(window.location.hash || "") || [])[1] || "");
  const [fromTheme, setFromTheme] = useState(null);
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => {
    if (!fromSlug) return;
    (async () => {
      try {
        const r = await fetch(`${PORTAL_CFG_BASE}/${fromSlug}/config`);
        if (r.ok) setFromTheme((await r.json()).theme || null);
      } catch { /* courtesy only — silently stay neutral */ }
    })();
  }, [fromSlug]);
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      if (mode === "login") {
        const r = await afetch("/login", { method: "POST", body: { email, password } });
        if (r.status === 200) return onSignedIn();
        setErr(r.body?.message || "That email and password don't match.");
      } else if (mode === "signup") {
        const r = await afetch("/signup", { method: "POST", body: { email, password, consent } });
        if (r.status === 200) setMsg("Check your email to verify your account.");
        else setErr(r.body?.error || "Something went wrong.");
      } else if (mode === "link") {
        // BUILD-49 — the password-free alternate: a one-time emailed sign-in link.
        const r = await afetch("/request-link", { method: "POST", body: { email } });
        if (r.status === 200) setMsg("If that address has an account, a sign-in link is on its way.");
        else setErr(r.body?.error || "Something went wrong.");
      } else {
        const r = await afetch("/request-reset", { method: "POST", body: { email } });
        if (r.status === 200) setMsg("If that address has an account, a reset link is on its way.");
        else setErr(r.body?.error || "Something went wrong.");
      }
    } finally { setBusy(false); }
  };
  return (
    <div style={{ ...S.card, margin: 0, padding: "26px 28px", boxShadow: "0 18px 50px rgba(15,26,18,0.35)" }}>
      {fromTheme && mode === "signup" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, marginBottom: 14, borderBottom: `2px solid ${fromTheme.accent || G.brass}` }}>
          {fromTheme.logo && <img src={fromTheme.logo} alt="" style={{ height: 30, maxWidth: 90, objectFit: "contain" }} />}
          <span style={{ ...S.muted, fontSize: 13 }}>You're connecting with <b style={{ color: G.ink }}>{fromTheme.displayName}</b></span>
        </div>
      )}
      <h2 style={{ ...S.h2, marginBottom: 8 }}>{mode === "login" ? "Sign in" : mode === "signup" ? "Create your giving account" : mode === "link" ? "Get a sign-in link" : "Reset your password"}</h2>
      {mode !== "login" && (
        <p style={{ ...S.muted, fontSize: 13.5, margin: "0 0 2px" }}>
          {mode === "signup"
            ? "One sign-in for your giving history, receipts, and recurring gifts across every organization you support."
            : mode === "reset" ? "We'll email you a one-time link."
            : "We'll email you a one-time sign-in link — no password to type."}
        </p>
      )}
      {mode === "signup" && (
        <p style={{ ...S.muted, fontSize: 13 }}>
          Each nonprofit sees only its own relationship with you. We never share
          your giving at one organization with another.
        </p>
      )}
      <div style={S.label}>Email address</div>
      <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
      {(mode === "login" || mode === "signup") && (<>
        <div style={S.label}>Password</div>
        <input style={S.input} type="password" value={password} onChange={e => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"} />
      </>)}
      {mode === "signup" && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: 13, color: G.sageDeep, cursor: "pointer" }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
          <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: G.emerald }}>Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: G.emerald }}>Privacy Policy</a>.</span>
        </label>
      )}
      <div style={{ marginTop: 16 }}>
        <button style={{ ...S.btn, width: "100%", opacity: mode === "signup" && !consent ? 0.5 : 1 }} disabled={busy || (mode === "signup" && !consent)} onClick={go}>
          {busy ? "Working…" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : mode === "link" ? "Email me a sign-in link" : "Email me a link"}
        </button>
      </div>
      {msg && <p style={{ ...S.muted, marginTop: 10 }}>{msg}</p>}
      {err && <p style={S.err}>{err}</p>}
      {/* Password is the primary path; the emailed sign-in link and reset are
          small quiet links (BUILD-50) — account creation lives in the hero. */}
      {mode === "login" ? (
        <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
          <button style={S.link} onClick={() => setMode("link")}>Email me a sign-in link</button>
          <button style={S.link} onClick={() => setMode("reset")}>Reset password</button>
        </div>
      ) : (
        <p style={{ ...S.muted, fontSize: 13, marginTop: 14, marginBottom: 0 }}>
          {mode === "signup" && "Already have an account? "}
          <button style={S.link} onClick={() => setMode("login")}>{mode === "signup" ? "Sign in" : "Back to sign in"}</button>
        </p>
      )}
    </div>
  );
}

// ── BUILD-49/50 — the donor front door ──────────────────────────────────────
// The signed-out /giving is a real landing page (the page donors will Google
// and the target of every entry-point link). BUILD-50 composition: the
// header's ink band bleeds down behind the whole hero (the first viewport is
// ink, cream serif, brass accents — never a flat cream field), the auth card
// floats on it, the value trio scans on cream, and the org-blindness promise
// gets a FULL-BLEED ink band of its own. Signed-in visitors never see this
// (the parent routes them straight to the dashboard).
function GivingLanding({ onSignedIn }) {
  const [mode, setMode] = useState(initialAuthMode);
  const cardRef = useRef(null);
  const goCard = (m) => {
    setMode(m);
    if (cardRef.current) cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const trio = [
    {
      title: "Every organization, together",
      body: "Your giving history with each nonprofit you support, side by side — the gifts, the years, the receipts.",
    },
    {
      title: "Recurring gifts, under control",
      body: "Change an amount, pause, or cancel a monthly gift yourself, on each organization's own page — no email chains.",
    },
    {
      title: "Tax time, already done",
      body: "Year-end totals per organization and every receipt, ready to download when you need them.",
    },
  ];
  return (
    <div>
      {/* HERO — the ink field fills the first viewport. */}
      <section style={{ background: G.ink }}>
        <div className="gd-landwrap gd-hero">
          <div className="gd-landhero-copy">
            <div style={{ ...S.eyebrow, color: G.brass, fontSize: 12 }}>Your giving account</div>
            <h1 className="gd-landtitle" style={{ fontFamily: SERIF, fontWeight: 400, lineHeight: 1.06, letterSpacing: "-0.015em", color: G.cream, margin: "16px 0 22px" }}>
              All of your giving.<br />One quiet place.
            </h1>
            <p className="gd-landsub" style={{ color: G.sage, lineHeight: 1.65, maxWidth: 540, margin: 0 }}>
              A free account for donors. Your giving history, tax receipts, and
              recurring gifts — across every organization you support — under one
              sign-in, without waiting for anyone to send you a link.
            </p>
            <div style={{ display: "flex", gap: 14, marginTop: 32, flexWrap: "wrap" }}>
              <button style={{ ...S.btn, padding: "14px 28px", fontSize: 16 }} onClick={() => goCard("signup")}>Create your free account</button>
              <button style={{ background: "transparent", color: G.cream, border: `1px solid ${G.pineHair}`, borderRadius: 8, padding: "13px 26px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}
                onClick={() => goCard("login")}>Sign in</button>
            </div>
            <div style={{ height: 3, width: 64, background: G.brass, borderRadius: 2, marginTop: 40 }} />
            <p style={{ color: G.sage, fontSize: 13, marginTop: 16, marginBottom: 0 }}>
              Already gave to an organization on Steward? Verify the email you gave
              under and your history connects automatically — nothing to import.
            </p>
          </div>
          <div className="gd-landcard" ref={cardRef}>
            <AuthCard onSignedIn={onSignedIn} mode={mode} setMode={setMode} />
          </div>
        </div>
      </section>
      {/* VALUE TRIO — cream, built to scan in two seconds. */}
      <section style={{ padding: "64px 0 26px" }}>
        <div className="gd-landwrap">
          <div className="gd-trio">
            {trio.map(t => (
              <div key={t.title} style={{ ...S.card, margin: 0, padding: "26px 26px 22px" }}>
                <div style={{ width: 34, height: 3, background: G.brass, borderRadius: 2, marginBottom: 16 }} />
                <div style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1.2, marginBottom: 8 }}>{t.title}</div>
                <p style={{ color: G.sageDeep, fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* The org-blindness promise, stated plainly — the trust foundation the
          whole network rests on, so it gets a full-bleed ink band, edge to
          edge, not a boxed card inside the column. */}
      <section style={{ background: G.ink, marginTop: 48, padding: "84px 0 88px" }}>
        <div className="gd-landwrap" style={{ textAlign: "center" }}>
          <div style={{ ...S.eyebrow, color: G.brass, fontSize: 12 }}>Our promise</div>
          <div style={{ fontFamily: SERIF, fontSize: "clamp(30px, 3.4vw, 48px)", color: G.cream, lineHeight: 1.2, margin: "14px auto 16px" }}>
            Your giving is yours.
          </div>
          <p style={{ color: G.sage, fontSize: 15.5, lineHeight: 1.7, margin: "0 auto", maxWidth: 660 }}>
            Each nonprofit sees only its own relationship with you. We never share
            your giving at one organization with another — and no organization ever
            learns what you give anywhere else. Creating an account changes nothing
            about what any nonprofit knows.
          </p>
        </div>
      </section>
    </div>
  );
}

// One handler for every emailed-token landing: /giving/verify, /giving/reset,
// /giving/confirm-email, /giving/confirm-alias, /giving/signin. The token
// rides the URL FRAGMENT (never sent in a Referer), same as the portal magic
// link.
function TokenLanding({ kind, onDone }) {
  const [err, setErr] = useState("");
  const [needPw] = useState(kind === "reset");
  const [pw, setPw] = useState("");
  const [token] = useState(() => (/token=([A-Za-z0-9_-]+)/.exec(window.location.hash || "") || [])[1] || "");
  useEffect(() => { window.history.replaceState(null, "", window.location.pathname); }, []);
  const submit = async () => {
    const path = kind === "verify" ? "/verify" : kind === "reset" ? "/reset"
      : kind === "signin" ? "/link-verify" // BUILD-49 emailed sign-in link
      : kind === "confirm-email" ? "/change-email/confirm" : "/aliases/verify";
    const r = await afetch(path, { method: "POST", body: kind === "reset" ? { token, password: pw } : { token } });
    if (r.status === 200) await onDone();
    else setErr(r.body?.message || "That link has expired or was already used.");
  };
  useEffect(() => { if (!needPw && token) submit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  if (!token) return <div style={S.card}><p style={S.muted}>This link is incomplete — request a fresh one.</p></div>;
  return (
    <div style={{ ...S.card, maxWidth: 440 }}>
      {err ? (<><h2 style={{ ...S.h2, marginBottom: 8 }}>Link expired</h2><p style={S.muted}>{err}</p></>)
        : needPw ? (<>
          <h2 style={{ ...S.h2, marginBottom: 8 }}>Choose a new password</h2>
          <div style={S.label}>New password</div>
          <input style={S.input} type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          <div style={{ marginTop: 14 }}><button style={S.btn} onClick={submit}>Set password</button></div>
        </>) : <p style={S.muted}>One moment…</p>}
    </div>
  );
}

function OrgAvatar({ org, size = 46 }) {
  return org.logo
    ? <img src={org.logo} alt="" style={{ width: size, height: size, borderRadius: 9, objectFit: "cover", flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: 9, background: org.primary || G.emerald, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontSize: Math.round(size * 0.46), flexShrink: 0 }}>{(org.orgName || org.name || "?")[0]}</div>;
}

// BUILD-48 — the small per-org theme resolution every card/section uses.
// theme comes server-validated (colors contrast-guarded, enums checked); the
// fallbacks here are the designed neutrals.
function orgTheme(org) {
  const t = org.theme || {};
  return {
    ...t,
    accent: t.accent || org.accent || org.primary || G.emerald,
    serif: resolvePairing(t.typePairing).serif,
    sans: resolvePairing(t.typePairing).sans,
    chrome: cardChrome(t.cardStyle, G.hair),
    button: t.buttonColor || t.primary || G.emerald,
    buttonFg: t.buttonFg || t.primaryFg || "#ffffff",
  };
}

// BUILD-50 — one impact-update card for every surface: photo(s) when the
// update carries them (the entity supports up to 4 — the first two render as
// a banner strip), then title + body. Theming stays the OWNING org's.
function ImpactCard({ u, t, eyebrow }) {
  const photos = Array.isArray(u.photos) ? u.photos.filter(Boolean) : [];
  return (
    <div style={{ ...S.card, ...(t.chrome || {}), margin: 0, padding: 0, overflow: "hidden", borderLeft: `3px solid ${t.accent || G.emerald}` }}>
      {photos.length > 0 && (
        <div style={{ height: 180, overflow: "hidden", display: "flex" }}>
          {photos.slice(0, 2).map((p, i) => (
            <img key={i} src={p} alt="" style={{ width: photos.length > 1 ? "50%" : "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ))}
        </div>
      )}
      <div style={{ padding: "16px 20px 18px" }}>
        {eyebrow && <div style={S.eyebrow}>{eyebrow}</div>}
        <div style={{ fontWeight: 700, margin: eyebrow ? "4px 0 5px" : "0 0 5px", fontSize: 15 }}>{u.title}</div>
        {u.body && <p style={{ ...S.muted, margin: 0 }}>{u.body}</p>}
      </div>
    </div>
  );
}

// A linked org: full history figures, the org's own FULL theme on its card —
// header-image banner, logo, accent edge, its type pairing and card style.
// The theme stays INSIDE this card (multi-org rule: one org's brand never
// sits above another org's data).
function OrgCard({ org, onOpen }) {
  const t = orgTheme(org);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} className="gd-orgcard"
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ ...S.card, ...t.chrome, padding: 0, overflow: "hidden", cursor: "pointer", borderLeft: `4px solid ${t.accent}` }}>
      {t.headerImage && (
        <div style={{ height: 68, overflow: "hidden" }}>
          <img src={t.headerImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 22px" }}>
        <OrgAvatar org={org} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: t.serif, fontSize: 18, lineHeight: 1.25 }}>{org.orgName}</div>
          <div style={{ ...S.muted, fontSize: 13, marginTop: 2 }}>
            {org.lastGiftDate ? `Last gift ${fmtDay(org.lastGiftDate)}` : "No gifts yet"}
            {org.recurringCount > 0 && ` · ${org.recurringCount} recurring`}
          </div>
        </div>
        <div className="gd-orgnums" style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtMoney(org.ytd)} <span style={{ ...S.muted, fontSize: 12 }}>this year</span></div>
          <div style={{ ...S.muted, fontSize: 13 }}>{fmtMoney(org.lifetime)} lifetime</div>
        </div>
      </div>
    </div>
  );
}

// A followed org in the MULTI-ORG shell: identity + give path + the honest
// connect-your-history prompt. Deliberately NO history figures — a follow has
// none to show. (In the single-org takeover the page header already carries
// the identity, so the takeover uses FollowStateBar instead.)
function FollowedCard({ org, onConnect, onUnfollow }) {
  const t = orgTheme(org);
  return (
    <div style={{ ...S.card, ...t.chrome, padding: 0, overflow: "hidden", borderLeft: `4px solid ${t.accent}` }}>
      {t.headerImage && (
        <div style={{ height: 68, overflow: "hidden" }}>
          <img src={t.headerImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
      <div style={{ padding: "18px 22px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <OrgAvatar org={org} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.eyebrow}>Following</div>
            <div style={{ fontFamily: t.serif, fontSize: 18, lineHeight: 1.25 }}>{org.orgName}</div>
            {org.description && <div style={{ ...S.muted, fontSize: 13, marginTop: 2 }}>{org.description}</div>}
          </div>
          <a href={`/give/${org.orgSlug}`} target="_blank" rel="noreferrer"
            style={{ ...S.btnSm, background: t.button, color: t.buttonFg, textDecoration: "none", flexShrink: 0 }}>Give</a>
        </div>
        <div style={{ borderTop: `1px solid ${G.hair}`, marginTop: 14, paddingTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ ...S.muted, fontSize: 13 }}>
            If you've given to {org.orgName} before, add the email you used and we'll connect your history.
          </span>
          <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button style={{ ...S.ghost, color: G.emerald }} onClick={onConnect}>Connect your history</button>
            <button style={S.ghost} onClick={onUnfollow}>Unfollow</button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── BUILD-48/50 — the single-org TAKEOVER ───────────────────────────────────
// Exactly one org (linked or followed): the org's theme owns the page.
// Steward reduces to ONE quiet "your giving account" line + the trust
// sentence; header image, logo, colors, fonts, card style, and footer
// identity are all the org's. BUILD-50: the page OPENS with the org's header
// image as a full-width banner (identity plaque set against it); an org with
// no header image gets a solid band in its primary color — never bare cream.

function TakeoverHeader({ org, onSignOut }) {
  const t = orgTheme(org);
  const primary = t.primary || G.emerald;
  const fg = t.primaryFg || "#ffffff";
  const name = t.displayName || org.orgName;
  const quietLine = (
    <div style={{ maxWidth: 1060, margin: "0 auto", padding: "10px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span data-testid="steward-quiet-line" style={{ fontSize: 12, color: "#6b6b64", fontFamily: SANS }}>
        <span style={{ fontFamily: SERIF, fontSize: 13 }}>Steward</span> · your giving account
      </span>
      {onSignOut && (
        <button onClick={onSignOut}
          style={{ background: "transparent", color: "#6b6b64", border: `1px solid ${G.hair}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}>
          Sign out
        </button>
      )}
    </div>
  );
  if (t.headerImage) {
    return (
      <div>
        {quietLine}
        <div className="gd-tkbanner" style={{ marginTop: 8 }}>
          <img src={t.headerImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
        <div style={{ maxWidth: 1060, margin: "0 auto", padding: "0 24px" }}>
          <div className="gd-tkplaque" style={{ ...t.chrome, background: G.white, borderBottom: `3px solid ${t.accent}`, display: "flex", alignItems: "center", gap: 18, padding: "20px 28px" }}>
            {t.logo && <img src={t.logo} alt="" style={{ height: 54, maxWidth: 160, objectFit: "contain", flexShrink: 0 }} />}
            <div className="gd-tkname" style={{ fontFamily: t.serif, fontSize: "clamp(24px, 2.6vw, 34px)", lineHeight: 1.15, minWidth: 0 }}>{name}</div>
          </div>
        </div>
      </div>
    );
  }
  // Fallback: a solid band in the org's primary color carrying the logo (or a
  // monogram) and the name — an org with no header image is never bare cream.
  return (
    <div>
      {quietLine}
      <div style={{ background: primary, borderBottom: `3px solid ${t.accent}`, marginTop: 8 }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", padding: "38px 24px 34px", display: "flex", alignItems: "center", gap: 18 }}>
          {t.logo
            ? <img src={t.logo} alt="" style={{ height: 54, maxWidth: 160, objectFit: "contain", flexShrink: 0 }} />
            : <div style={{ width: 54, height: 54, borderRadius: 10, border: `2px solid ${fg}`, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: t.serif, fontSize: 26, flexShrink: 0 }}>{(name || "?")[0]}</div>}
          <div className="gd-tkname" style={{ fontFamily: t.serif, fontSize: "clamp(26px, 2.8vw, 36px)", lineHeight: 1.15, color: fg, minWidth: 0 }}>{name}</div>
        </div>
      </div>
    </div>
  );
}

// BUILD-50 — the follow-only takeover state: the header above already carries
// the org's identity, so this bar carries only the STATE and its affordances
// (give, connect-your-history, unfollow) — no logo/name restated.
function FollowStateBar({ org, t, onConnect, onUnfollow }) {
  return (
    <div style={{ ...S.card, ...t.chrome, marginTop: 18, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={S.eyebrow}>Following</div>
          <div style={{ fontFamily: t.serif, fontSize: 18, margin: "4px 0 6px" }}>You follow this organization.</div>
          <p style={{ ...S.muted, fontSize: 13, margin: 0 }}>
            If you've given here before, add the email you used and we'll connect
            your history — gifts, receipts, and year-end totals.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
          <a href={`/give/${org.orgSlug}`} target="_blank" rel="noreferrer"
            style={{ ...S.btnSm, background: t.button, color: t.buttonFg, textDecoration: "none", padding: "10px 20px", fontSize: 14 }}>Give</a>
          <button style={{ ...S.quiet, color: t.button, borderColor: t.button }} onClick={onConnect}>Connect your history</button>
          <button style={S.ghost} onClick={onUnfollow}>Unfollow</button>
        </div>
      </div>
    </div>
  );
}

// The takeover Home body: the org's summary in the org's colors, its impact
// updates (photos included, two columns at desktop), and the quiet path to
// adding more organizations (which flips the page back to the neutral shell
// the moment a second org exists).
function TakeoverHome({ org, linked, impact, onOpen, onConnect, onUnfollow, loadDash }) {
  const t = orgTheme(org);
  const fg = t.primaryFg || "#ffffff";
  const [showDir, setShowDir] = useState(false);
  return (
    <div style={{ fontFamily: t.sans }}>
      {linked ? (<>
        <div className="gd-stats" style={{ background: t.primary || G.emerald, borderRadius: 14, padding: "32px 36px", margin: "18px 0", display: "flex", alignItems: "flex-end", gap: 54 }}>
          <div>
            <div style={{ ...S.eyebrow, color: fg, opacity: 0.8 }}>This year</div>
            <div style={{ fontFamily: t.serif, fontSize: 52, color: fg, lineHeight: 1.08, marginTop: 4 }}>{fmtMoney(org.ytd)}</div>
          </div>
          <div className="gd-statdiv" style={{ width: 1, alignSelf: "stretch", background: fg, opacity: 0.25 }} />
          <div>
            <div style={{ ...S.eyebrow, color: fg, opacity: 0.8 }}>Lifetime</div>
            <div style={{ fontFamily: t.serif, fontSize: 30, color: fg, lineHeight: 1.15, marginTop: 4 }}>{fmtMoney(org.lifetime)}</div>
          </div>
          {org.lastGiftDate && (<>
            <div className="gd-statdiv" style={{ width: 1, alignSelf: "stretch", background: fg, opacity: 0.25 }} />
            <div>
              <div style={{ ...S.eyebrow, color: fg, opacity: 0.8 }}>Last gift</div>
              <div style={{ fontFamily: t.serif, fontSize: 30, color: fg, lineHeight: 1.15, marginTop: 4 }}>{fmtDay(org.lastGiftDate)}</div>
            </div>
          </>)}
        </div>
        <div style={{ ...S.card, ...t.chrome, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: t.serif, fontSize: 17 }}>Your history with {t.displayName || org.orgName}</div>
            <div style={{ ...S.muted, fontSize: 13, marginTop: 3 }}>
              {org.lastGiftDate ? `Last gift ${fmtDay(org.lastGiftDate)}` : "No gifts yet"}
              {org.recurringCount > 0 && ` · ${org.recurringCount} recurring gift${org.recurringCount === 1 ? "" : "s"}`}
            </div>
          </div>
          <button onClick={onOpen}
            style={{ background: t.button, color: t.buttonFg, border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: t.sans, flexShrink: 0 }}>
            Gifts, receipts &amp; recurring →
          </button>
        </div>
      </>) : (
        <FollowStateBar org={org} t={t} onConnect={onConnect} onUnfollow={onUnfollow} />
      )}
      {impact.length > 0 && (<>
        <h2 style={{ ...S.h2, fontFamily: t.serif, fontSize: 24, marginTop: 34, marginBottom: 12 }}>What your giving made possible</h2>
        <div className="gd-imgrid">
          {impact.map(u => <ImpactCard key={u.orgSlug + u.id} u={u} t={t} />)}
        </div>
      </>)}
      <div style={{ marginTop: 30 }}>
        <button style={{ ...S.ghost, color: t.button, fontFamily: t.sans }} onClick={() => setShowDir(v => !v)}>
          {showDir ? "Close" : "+ Add another organization"}
        </button>
        {showDir && (
          <div style={{ ...S.card, background: "transparent", border: `1px solid ${G.hair}` }}>
            <DirectorySearch autoFocus onChanged={loadDash} btnBg={t.button} btnFg={t.buttonFg} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── BUILD-47 directory search — LISTED orgs only, server-side ──────────────
function DirectorySearch({ autoFocus, onChanged, btnBg, btnFg }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null); // last completed result
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState({}); // slug → true (this session)
  const timer = useRef(null);
  const seq = useRef(0);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) { setRes(null); setBusy(false); return; }
    setBusy(true);
    const mySeq = ++seq.current;
    timer.current = setTimeout(async () => {
      const r = await nfetch(`/directory?q=${encodeURIComponent(query)}`);
      if (mySeq !== seq.current) return; // a newer query superseded this one
      setBusy(false);
      setRes(r.status === 200 ? { q: query, ...r.body } : { q: query, results: [], total: 0 });
    }, 350);
    return () => timer.current && clearTimeout(timer.current);
  }, [q]);
  const add = async (row) => {
    const r = await afetch("/orgs/add", { method: "POST", body: { orgSlug: row.orgSlug } });
    if (r.status === 200) { setAdded(a => ({ ...a, [row.orgSlug]: true })); onChanged && onChanged(); }
  };
  const mailBody = encodeURIComponent(
    "I use Steward to keep my giving in one place — history, receipts, and recurring gifts.\n\n" +
    "It looks like your organization isn't on it yet. If you're curious: https://www.stewardapp.dev\n\n" +
    "Thanks for everything you do.");
  return (
    <div>
      <input
        style={{ ...S.input, fontSize: 16, padding: "13px 14px" }}
        placeholder="Search by name, city, or EIN"
        value={q} autoFocus={autoFocus}
        onChange={e => setQ(e.target.value)}
        aria-label="Search organizations"
      />
      {busy && <p style={{ ...S.muted, fontSize: 13, marginTop: 10 }}>Searching…</p>}
      {!busy && res && res.results.length > 0 && (
        <div style={{ marginTop: 10, border: `1px solid ${G.hair}`, borderRadius: 10, overflow: "hidden" }}>
          {res.results.map(row => (
            <div key={row.orgSlug} className="gd-dirrow" style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 14px", borderBottom: `1px solid ${G.hair}`, background: G.white }}>
              <OrgAvatar org={row} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{row.name}</div>
                <div style={{ ...S.muted, fontSize: 12.5 }}>
                  {[row.city, row.state].filter(Boolean).join(", ")}
                  {(row.city || row.state) && row.description ? " · " : ""}
                  {row.description || ""}
                </div>
              </div>
              {row.linked
                ? <span style={{ ...S.muted, fontSize: 13, flexShrink: 0 }}>In your dashboard ✓</span>
                : (row.followed || added[row.orgSlug])
                  ? <span style={{ ...S.muted, fontSize: 13, flexShrink: 0 }}>Added ✓</span>
                  : <button style={{ ...S.btnSm, background: btnBg || G.brass, color: btnFg || G.ink, flexShrink: 0 }} onClick={() => add(row)}>Add</button>}
            </div>
          ))}
        </div>
      )}
      {!busy && res && res.results.length === 0 && (
        <div style={{ marginTop: 10, padding: "16px 14px", border: `1px solid ${G.hair}`, borderRadius: 10, background: G.white }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Not on Steward yet</div>
          <p style={{ ...S.muted, fontSize: 13, margin: "6px 0 0" }}>
            We couldn't find "{res.q}" among the organizations on Steward.
            Want them here?{" "}
            <a href={`mailto:?subject=${encodeURIComponent("Have you seen Steward?")}&body=${mailBody}`} style={{ color: G.emerald, fontWeight: 600 }}>
              Tell them about Steward
            </a>
            {" "}— it's a note you send; we never contact anyone for you.
          </p>
        </div>
      )}
    </div>
  );
}

function Home({ me, dash, loadDash, takeover, onOpenOrg }) {
  const [tab, setTab] = useState("home"); // home | recurring | tax | account
  const [rec, setRec] = useState(null);
  const [tax, setTax] = useState(null);
  const [showDir, setShowDir] = useState(false);
  const [connectFor, setConnectFor] = useState(null); // org name for the alias-prefill context
  useEffect(() => {
    if (tab === "recurring" && !rec) (async () => setRec((await afetch("/recurring")).body))();
    if (tab === "tax" && !tax) (async () => setTax((await afetch("/tax-summary")).body))();
  }, [tab, rec, tax]);
  if (!dash) return <p style={{ ...S.muted, marginTop: 20 }}>Loading…</p>;
  const followed = dash.followed || [];
  const empty = dash.orgs.length === 0 && followed.length === 0;
  const unfollow = async (f) => { await afetch(`/follows/${f.followId}`, { method: "DELETE" }); loadDash(); };
  const connect = (f) => { setConnectFor(f.orgName); setTab("account"); };
  // In the takeover the tab chrome carries the org's accent + fonts; in the
  // multi-org shell it stays neutral (brass) — org theming lives on the
  // org's own sections only.
  const tt = takeover ? orgTheme(takeover) : null;
  const themeBySlug = {};
  for (const o of [...(dash.orgs || []), ...followed]) themeBySlug[o.orgSlug] = orgTheme(o);
  const tabbtn = (on) => tt
    ? { ...S.tabbtn(on), fontFamily: tt.sans, borderBottomColor: on ? tt.accent : "transparent", color: on ? G.ink : "#6b6b64" }
    : S.tabbtn(on);
  return (
    <div>
      <div style={{ borderBottom: `1px solid ${G.hair}`, marginBottom: 8 }}>
        <button style={tabbtn(tab === "home")} onClick={() => setTab("home")}>Home</button>
        <button style={tabbtn(tab === "recurring")} onClick={() => setTab("recurring")}>Recurring</button>
        <button style={tabbtn(tab === "tax")} onClick={() => setTab("tax")}>Receipts &amp; tax</button>
        <button style={tabbtn(tab === "account")} onClick={() => { setConnectFor(null); setTab("account"); }}>Account</button>
      </div>
      {tab === "home" && empty && (
        // The empty state IS the directory entry — search first, the
        // automatic-linking explanation as secondary copy.
        <div style={{ ...S.card, padding: "34px 28px" }}>
          <div style={S.eyebrow}>Get started</div>
          <h2 style={{ ...S.h2, fontSize: 28, margin: "6px 0 8px" }}>Find the organizations you give to</h2>
          <p style={{ ...S.muted, marginBottom: 16 }}>
            Search for a nonprofit you support and add it to your dashboard.
          </p>
          <DirectorySearch autoFocus onChanged={loadDash} />
          <p style={{ ...S.muted, fontSize: 13, marginTop: 16 }}>
            Gave under this email before? When an organization you support is on
            Steward under an email you've verified, your giving history connects
            automatically — nothing to search for. Give under a different email?
            Add it under Account.
          </p>
        </div>
      )}
      {tab === "home" && takeover && (
        <TakeoverHome org={takeover} linked={dash.orgs.length === 1} impact={dash.impact || []}
          onOpen={() => onOpenOrg(takeover)} onConnect={() => connect(takeover)}
          onUnfollow={() => unfollow(takeover)} loadDash={loadDash} />
      )}
      {tab === "home" && !empty && !takeover && (<>
        {/* No linked orgs yet (follows only) → no strip of $0s pretending to
            be history; the strip appears with the first connected org. */}
        {dash.orgs.length > 0 && (
        <div className="gd-stats" style={{ background: G.ink, borderRadius: 14, padding: "26px 30px", margin: "14px 0", display: "flex", alignItems: "flex-end", gap: 44 }}>
          <div>
            <div style={{ ...S.eyebrow, color: G.brass }}>This year</div>
            <div style={{ fontFamily: SERIF, fontSize: 42, color: G.cream, lineHeight: 1.1, marginTop: 4 }}>{fmtMoney(dash.totals.ytd)}</div>
          </div>
          <div className="gd-statdiv" style={{ width: 1, alignSelf: "stretch", background: G.pineHair }} />
          <div>
            <div style={{ ...S.eyebrow, color: G.sage }}>Lifetime</div>
            <div style={{ fontFamily: SERIF, fontSize: 26, color: G.cream, lineHeight: 1.15, marginTop: 4 }}>{fmtMoney(dash.totals.lifetime)}</div>
          </div>
          <div className="gd-statdiv" style={{ width: 1, alignSelf: "stretch", background: G.pineHair }} />
          <div>
            <div style={{ ...S.eyebrow, color: G.sage }}>Organizations</div>
            <div style={{ fontFamily: SERIF, fontSize: 26, color: G.cream, lineHeight: 1.15, marginTop: 4 }}>{dash.totals.orgCount}</div>
          </div>
        </div>
        )}
        <div className="gd-sechead" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 22 }}>
          <h2 style={S.h2}>Your organizations</h2>
          <button style={S.quiet} onClick={() => setShowDir(v => !v)}>{showDir ? "Close" : "+ Add organizations"}</button>
        </div>
        {showDir && (
          <div style={{ ...S.card, background: G.cream, border: `1px solid ${G.hair}` }}>
            <DirectorySearch autoFocus onChanged={loadDash} />
          </div>
        )}
        {dash.orgs.map(o => <OrgCard key={o.orgSlug} org={o} onOpen={() => onOpenOrg(o)} />)}
        {followed.map(f => <FollowedCard key={f.orgSlug} org={f} onConnect={() => connect(f)} onUnfollow={() => unfollow(f)} />)}
        {dash.impact.length > 0 && (<>
          <h2 style={{ ...S.h2, marginTop: 28, marginBottom: 12 }}>What your giving made possible</h2>
          {/* Per-org theming stays INSIDE the update it belongs to (accent
              edge + that org's card chrome) — never on the shell around it. */}
          <div className="gd-imgrid">
            {dash.impact.map(u => (
              <ImpactCard key={u.orgSlug + u.id} u={u} t={themeBySlug[u.orgSlug] || {}} eyebrow={u.orgName} />
            ))}
          </div>
        </>)}
      </>)}
      {tab === "recurring" && (
        <div style={{ ...S.card, ...(tt ? tt.chrome : {}) }}>
          <h2 style={{ ...S.h2, ...(tt ? { fontFamily: tt.serif } : {}), marginBottom: 10 }}>Recurring giving</h2>
          {!rec ? <p style={S.muted}>Loading…</p> : rec.recurring.length === 0 ? <p style={S.muted}>No recurring gifts.</p> :
            groupBySlug(rec.recurring).map(grp => (
              <div key={grp.orgSlug} style={tt ? {} : { borderLeft: `3px solid ${(themeBySlug[grp.orgSlug] || {}).accent || G.emerald}`, paddingLeft: 12, marginBottom: 14 }}>
                {!tt && <div style={{ ...S.eyebrow, marginTop: 6 }}>{grp.orgName}</div>}
                {grp.rows.map(r => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${G.hair}` }}>
                    <div><span style={S.muted}>{r.status}{r.pausedAt ? " (paused)" : ""}</span></div>
                    <div>{fmtMoney(r.amount)}/{r.interval}</div>
                  </div>
                ))}
              </div>
            ))}
          <p style={{ ...S.muted, fontSize: 13, marginTop: 10 }}>To change an amount, pause, or cancel, open that organization from Home — changes happen on its own page.</p>
        </div>
      )}
      {tab === "tax" && (
        <div style={{ ...S.card, ...(tt ? tt.chrome : {}) }}>
          <h2 style={{ ...S.h2, ...(tt ? { fontFamily: tt.serif } : {}), marginBottom: 10 }}>Receipts &amp; year-end totals</h2>
          {!tax ? <p style={S.muted}>Loading…</p> : (<>
            <p style={{ ...S.muted, fontSize: 13 }}>{tax.note}</p>
            {groupBySlug(tax.years).map(grp => (
              <div key={grp.orgSlug} style={tt ? {} : { borderLeft: `3px solid ${(themeBySlug[grp.orgSlug] || {}).accent || G.emerald}`, paddingLeft: 12, marginBottom: 14 }}>
                {!tt && <div style={{ ...S.eyebrow, marginTop: 6 }}>{grp.orgName}</div>}
                {grp.rows.map(y => (
                  <div key={y.year + y.orgSlug} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${G.hair}` }}>
                    <div><b>{y.year}</b>{tt ? null : <span style={S.muted}> · {y.orgName}</span>}</div>
                    <div>{fmtMoney(y.total)} <span style={S.muted}>({y.gifts} gift{y.gifts === 1 ? "" : "s"})</span></div>
                  </div>
                ))}
              </div>
            ))}
            <h2 style={{ ...S.h2, ...(tt ? { fontFamily: tt.serif } : {}), fontSize: 17, marginTop: 18 }}>Receipts</h2>
            {tax.receipts.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <div style={S.muted}>#{r.number} · {String(r.date).slice(0, 10)}</div>
                <div>{fmtMoney(r.amount)}</div>
              </div>
            ))}
          </>)}
        </div>
      )}
      {tab === "account" && <AccountPanel me={me} connectFor={connectFor} onOrgsChanged={loadDash} accent={tt ? tt.button : null} />}
    </div>
  );
}

function AccountPanel({ me, connectFor, onOrgsChanged, accent }) {
  const [aliasEmail, setAliasEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState(me);
  const aliasRef = useRef(null);
  useEffect(() => { if (connectFor && aliasRef.current) aliasRef.current.focus(); }, [connectFor]);
  const reload = async () => setInfo((await afetch("/me")).body);
  // In a takeover, the panel's action color follows the org theme (BUILD-50).
  const quiet = accent ? { ...S.quiet, color: accent, borderColor: accent } : S.quiet;
  return (
    <div style={S.card}>
      <h2 style={{ ...S.h2, marginBottom: 10 }}>Account</h2>
      <p style={S.muted}>Signed in as <b>{info.email}</b>{info.hasPassword ? "" : " (no password set — use Reset password to add one)"}.</p>
      <div style={S.label}>Linked email addresses</div>
      {connectFor && (
        <p style={{ ...S.muted, fontSize: 13, background: G.cream, border: `1px solid ${G.hair}`, borderRadius: 8, padding: "10px 12px" }}>
          Add the email you used when giving to <b>{connectFor}</b> — once you
          confirm it's yours, your history there connects automatically.
        </p>
      )}
      {info.aliases.map(a => (
        <div key={a.id} style={{ ...S.muted, padding: "3px 0" }}>{a.email} {a.verified ? "· verified" : "· awaiting confirmation"}</div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 420 }}>
        <input ref={aliasRef} style={S.input} placeholder="another-email@you.org" value={aliasEmail} onChange={e => setAliasEmail(e.target.value)} />
        <button style={quiet} onClick={async () => {
          const r = await afetch("/aliases", { method: "POST", body: { email: aliasEmail } });
          setMsg(r.body?.message || ""); setAliasEmail(""); reload();
        }}>Add</button>
      </div>
      <p style={{ ...S.muted, fontSize: 13 }}>Give under another email? Confirm it and that history appears here. Nothing links without your confirmation.</p>
      <div style={S.label}>Organizations</div>
      {info.links.map(l => (
        <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
          <div style={S.muted}>{l.orgName} · via {l.viaEmail}{l.unlinked ? " · hidden" : ""}{!l.listed && !l.unlinked ? " · not in dashboards yet" : ""}</div>
          <button style={quiet} onClick={async () => {
            await afetch(`/links/${l.id}/${l.unlinked ? "relink" : "unlink"}`, { method: "POST" });
            reload();
            // Hiding/showing an org changes the org COUNT — the takeover rule
            // must flip immediately (BUILD-48), so refresh the dashboard too.
            if (onOrgsChanged) onOrgsChanged();
          }}>{l.unlinked ? "Show again" : "Hide"}</button>
        </div>
      ))}
      <p style={{ ...S.muted, fontSize: 13 }}>
        Hiding an organization removes it from your dashboard. It never deletes
        that organization's own records of your giving — their records are theirs.
      </p>
      {msg && <p style={{ ...S.muted, marginTop: 8 }}>{msg}</p>}
    </div>
  );
}

export default function GivingDashboard({ landing }) {
  const navigate = useNavigate();
  const [flags, setFlags] = useState(null);
  const [me, setMe] = useState(null);
  const [checked, setChecked] = useState(false);
  // BUILD-48 — dash lives HERE (not in Home) so the takeover rule can own the
  // whole page: header, background, fonts, footer identity. loadDash replaces
  // state only when the fresh payload lands, so an add/remove re-renders the
  // new state directly — no neutral flash between states.
  const [dash, setDash] = useState(null);
  const loadDash = async () => setDash((await afetch("/dashboard")).body);
  const loadMe = async () => {
    const r = await afetch("/me");
    setMe(r.status === 200 ? r.body : null);
    setChecked(true);
    if (r.status === 200) await loadDash(); else setDash(null);
  };
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(NETWORK_BASE + "/config");
        setFlags(await r.json());
      } catch { setFlags({ donorAccounts: false }); }
      await loadMe();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // SPA navigations don't re-read giving.html's <head>, so keep the tab title
  // right when this page is reached client-side too (BUILD-49 SEO pass).
  useEffect(() => {
    const prev = document.title;
    document.title = "Your Giving — Steward";
    return () => { document.title = prev; };
  }, []);
  if (!flags || !checked) return <div style={S.page}><GivingStyles /><Header /><div style={S.wrap}><p style={{ ...S.muted, marginTop: 20 }}>Loading…</p></div></div>;
  if (!flags.donorAccounts) {
    return <div style={S.page}><GivingStyles /><Header /><div style={S.wrap}>
      <div style={S.card}><p style={S.muted}>This page isn't available.</p></div>
    </div></div>;
  }
  const signOut = async () => { await afetch("/logout", { method: "POST" }); setMe(null); setDash(null); };
  // Await the session refetch BEFORE navigating away from the token landing —
  // the component doesn't remount across the landing→home route change, so an
  // un-awaited loadMe let the dashboard render its signed-out AuthCard after a
  // successful verify/reset (found in the go-live prod drive, 2026-08-12; same
  // class as the Portal.jsx onVerified fix).
  const done = async () => { await loadMe(); navigate("/giving", { replace: true }); };
  // ── the takeover rule (BUILD-48) ──────────────────────────────────────────
  // 0 orgs → neutral shell · exactly 1 (linked or followed) → that org's FULL
  // takeover · 2+ → neutral shell with per-org theming scoped to each org's
  // own sections. Pre-auth and token landings are ALWAYS neutral (a sign-in
  // page can't know your orgs).
  const followed = (dash && dash.followed) || [];
  const takeover = !landing && me && dash && (dash.orgs.length + followed.length === 1)
    ? (dash.orgs[0] || followed[0]) : null;
  const tt = takeover ? orgTheme(takeover) : null;
  const tfg = tt ? (tt.primaryFg || "#ffffff") : null;
  const pageStyle = tt
    ? { ...S.page, background: tt.backgroundTint || "#faf9f6", fontFamily: tt.sans }
    : S.page;
  const showLanding = !landing && !me;
  // Drill-down handoff: stash the org's theme so the portal's first paint is
  // already the org's (Portal.jsx reads pt_theme_<slug>) — no neutral flash.
  const openOrg = (org) => {
    try {
      sessionStorage.setItem("pt_theme_" + org.orgSlug, JSON.stringify({
        orgSlug: org.orgSlug,
        displayName: (org.theme && org.theme.displayName) || org.orgName,
        logo: (org.theme && org.theme.logo) || org.logo || null,
        ...(org.theme || {}),
      }));
    } catch { /* storage full/blocked — the config fetch still themes it */ }
    navigate(`/giving/orgs/${org.orgSlug}`);
  };
  return (
    <div style={pageStyle}>
      <GivingStyles />
      {tt
        ? <TakeoverHeader org={takeover} onSignOut={me ? signOut : null} />
        : <Header onSignOut={me ? signOut : null} flush={showLanding} wide={showLanding} />}
      {landing ? (
        <div className="gd-wrap">
          <div style={{ paddingTop: 16 }}>
            <TokenLanding kind={landing} onDone={done} />
          </div>
        </div>
      ) : (
        <div className={me ? "gd-wrap" : undefined}>
          {me
            ? <Home me={me} dash={dash} loadDash={loadDash} takeover={takeover} onOpenOrg={openOrg} />
            : <GivingLanding onSignedIn={loadMe} />}
        </div>
      )}
      {/* Footer. In a takeover it reads like the ORG's own site footer — a
          full-bleed band in the org's primary color carrying its identity
          (footer text / EIN / contact) — with the trust line quiet below it;
          Steward stays that one line up top. Neutral states keep the plain
          hairline footer. */}
      {tt ? (
        <div style={{ marginTop: 44 }}>
          <div style={{ background: tt.primary || G.emerald, padding: "34px 0 30px" }}>
            <div style={{ maxWidth: 1060, margin: "0 auto", padding: "0 24px" }}>
              <div style={{ fontFamily: tt.serif, fontSize: 22, color: tfg }}>{tt.displayName || takeover.orgName}</div>
              {tt.footerText && <p style={{ color: tfg, opacity: 0.85, fontSize: 13, lineHeight: 1.6, margin: "8px 0 0", maxWidth: 560 }}>{tt.footerText}</p>}
              {tt.einLine && <p style={{ color: tfg, opacity: 0.85, fontSize: 12.5, margin: "8px 0 0" }}>{tt.einLine}</p>}
              {tt.contactEmail && (
                <p style={{ color: tfg, opacity: 0.85, fontSize: 12.5, margin: "6px 0 0" }}>
                  Questions? <a href={`mailto:${tt.contactEmail}`} style={{ color: tfg, fontWeight: 700 }}>{tt.contactEmail}</a>
                </p>
              )}
            </div>
          </div>
          <p style={{ color: "#6b6b64", fontFamily: tt.sans, fontSize: 12, lineHeight: 1.6, margin: 0, padding: "16px 24px 22px", textAlign: "center" }}>
            Each nonprofit sees only its own relationship with you. We never share
            your giving at one organization with another.
          </p>
        </div>
      ) : showLanding ? null : (
        // The landing needs no footer — its full-bleed promise band already
        // closes the page with this exact sentence at full size.
        <div className="gd-wrap">
          <div style={{ borderTop: `1px solid ${G.hair}`, marginTop: 34, paddingTop: 16, textAlign: "center" }}>
            <p style={{ ...S.muted, fontSize: 12, margin: 0 }}>
              Each nonprofit sees only its own relationship with you. We never share
              your giving at one organization with another.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// The org drill-down shell: a slim consumer-brand bar above the UNFORKED
// BUILD-45 portal (the route param is orgSlug, exactly what <Portal/> reads —
// the account-session cookie opens it via requirePortalSession's link path).
export function GivingOrgShell({ children }) {
  const navigate = useNavigate();
  return (
    <div>
      <div style={{ background: "#0f1a12", padding: "10px 20px" }}>
        <button onClick={() => navigate("/giving")}
          style={{ background: "transparent", border: "none", color: "#f0ede6", cursor: "pointer", fontSize: 14, fontFamily: "'DM Sans',Helvetica,Arial,sans-serif" }}>
          ← Your Giving
        </button>
      </div>
      {children}
    </div>
  );
}
