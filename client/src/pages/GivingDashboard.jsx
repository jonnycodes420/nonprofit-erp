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
// Brand: CONSUMER_BRAND is the placeholder pending the founder decision —
// every place the string lives is listed in BLOCKED-consumer-brand.md.
// Feature-flagged: the server's /network/config gates this page; with
// DONOR_ACCOUNTS_ENABLED off the page renders a quiet unavailable state.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export const CONSUMER_BRAND = "Steward"; // plain Steward (go-live 2026-08-12); rename = one commit (BLOCKED-consumer-brand.md)

// Same-origin in production via the vercel.json /account-api proxy (the
// session cookie must stay first-party); VITE_ACCOUNT_API is the local-
// capture override (Portal.jsx's PORTAL_BASE pattern).
const ACCOUNT_BASE = import.meta.env.VITE_ACCOUNT_API
  || (import.meta.env.PROD ? "/account-api" : "http://localhost:5601/account");
const NETWORK_BASE = import.meta.env.VITE_NETWORK_API
  || (import.meta.env.PROD ? "/network-api" : "http://localhost:5601/network");

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
  muted: { color: G.sageDeep, fontSize: 14, lineHeight: 1.55 },
  err: { color: G.err, fontSize: 14, marginTop: 8 },
  tabbtn: (on) => ({ background: "transparent", border: "none", borderBottom: on ? `3px solid ${G.brass}` : "3px solid transparent", padding: "10px 2px", marginRight: 22, fontSize: 14, fontWeight: on ? 700 : 500, color: on ? G.ink : G.sageDeep, cursor: "pointer", fontFamily: SANS }),
};

function fmtMoney(n) { return "$" + Math.round(n || 0).toLocaleString(); }

// One shared stylesheet for the few things inline styles can't do (hover,
// the 390px stat-strip stack). Values stay within the token set above.
function GivingStyles() {
  return <style>{`
    .gd-orgcard { transition: box-shadow .15s ease, transform .15s ease; }
    .gd-orgcard:hover { box-shadow: 0 4px 18px rgba(15,26,18,0.10); transform: translateY(-1px); }
    .gd-dirrow:hover { background: ${G.cream}; }
    @media (max-width: 640px) {
      .gd-stats { flex-direction: column; gap: 14px !important; padding: 22px 22px !important; }
      .gd-statdiv { display: none; }
      .gd-orgcard { flex-wrap: wrap; }
      .gd-orgnums { text-align: left !important; width: 100%; margin-top: 6px; padding-left: 58px; }
      .gd-sechead { flex-wrap: wrap; gap: 10px; }
    }
  `}</style>;
}

function Header({ onSignOut }) {
  return (
    <div style={{ background: G.ink, padding: "18px 20px 16px", borderBottom: `3px solid ${G.brass}` }}>
      <div style={{ maxWidth: 840, margin: "0 auto", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
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

function AuthCard({ onSignedIn }) {
  // The portal's discovery link arrives as /giving#signup&email=… — the
  // donor's already-verified address rides the URL FRAGMENT (never sent to
  // any server, the TokenLanding convention), lands in signup mode prefilled.
  const [mode, setMode] = useState(() =>
    /(^|[#&])signup(&|$)/.test(window.location.hash || "") ? "signup" : "login"); // login | signup | reset
  const [email, setEmail] = useState(() => {
    const m = /email=([^&]+)/.exec(window.location.hash || "");
    try { return m ? decodeURIComponent(m[1]) : ""; } catch { return ""; }
  });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);
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
      } else {
        const r = await afetch("/request-reset", { method: "POST", body: { email } });
        if (r.status === 200) setMsg("If that address has an account, a reset link is on its way.");
        else setErr(r.body?.error || "Something went wrong.");
      }
    } finally { setBusy(false); }
  };
  return (
    <div style={{ ...S.card, maxWidth: 440 }}>
      <h2 style={{ ...S.h2, marginBottom: 10 }}>{mode === "login" ? "See all your giving in one place" : mode === "signup" ? "Create your giving account" : "Reset your password"}</h2>
      <p style={S.muted}>
        {mode === "signup"
          ? "One sign-in for your giving history, receipts, and recurring gifts across every organization you support."
          : mode === "reset" ? "We'll email you a one-time link." : "Sign in with your email and password."}
      </p>
      {mode === "signup" && (
        <p style={{ ...S.muted, fontSize: 13 }}>
          Each nonprofit sees only its own relationship with you. We never share
          your giving at one organization with another.
        </p>
      )}
      <div style={S.label}>Email address</div>
      <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
      {mode !== "reset" && (<>
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
        <button style={{ ...S.btn, opacity: mode === "signup" && !consent ? 0.5 : 1 }} disabled={busy || (mode === "signup" && !consent)} onClick={go}>
          {busy ? "Working…" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a link"}
        </button>
      </div>
      {msg && <p style={{ ...S.muted, marginTop: 10 }}>{msg}</p>}
      {err && <p style={S.err}>{err}</p>}
      <p style={{ ...S.muted, fontSize: 13, marginTop: 14 }}>
        {mode !== "login" && <button style={{ ...S.tabbtn(false), marginRight: 12 }} onClick={() => setMode("login")}>Sign in</button>}
        {mode !== "signup" && <button style={{ ...S.tabbtn(false), marginRight: 12 }} onClick={() => setMode("signup")}>Create an account</button>}
        {mode !== "reset" && <button style={S.tabbtn(false)} onClick={() => setMode("reset")}>Reset password</button>}
      </p>
    </div>
  );
}

// One handler for every emailed-token landing: /giving/verify, /giving/reset,
// /giving/confirm-email, /giving/confirm-alias. The token rides the URL
// FRAGMENT (never sent in a Referer), same as the portal magic link.
function TokenLanding({ kind, onDone }) {
  const [err, setErr] = useState("");
  const [needPw] = useState(kind === "reset");
  const [pw, setPw] = useState("");
  const [token] = useState(() => (/token=([A-Za-z0-9_-]+)/.exec(window.location.hash || "") || [])[1] || "");
  useEffect(() => { window.history.replaceState(null, "", window.location.pathname); }, []);
  const submit = async () => {
    const path = kind === "verify" ? "/verify" : kind === "reset" ? "/reset"
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

// A linked org: full history figures, the org's own accent on the card edge.
function OrgCard({ org, onOpen }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} className="gd-orgcard"
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ ...S.card, cursor: "pointer", display: "flex", alignItems: "center", gap: 16, borderLeft: `4px solid ${org.accent || org.primary || G.emerald}` }}>
      <OrgAvatar org={org} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1.25 }}>{org.orgName}</div>
        <div style={{ ...S.muted, fontSize: 13, marginTop: 2 }}>
          {org.lastGiftDate ? `Last gift ${org.lastGiftDate}` : "No gifts yet"}
          {org.recurringCount > 0 && ` · ${org.recurringCount} recurring`}
        </div>
      </div>
      <div className="gd-orgnums" style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtMoney(org.ytd)} <span style={{ ...S.muted, fontSize: 12 }}>this year</span></div>
        <div style={{ ...S.muted, fontSize: 13 }}>{fmtMoney(org.lifetime)} lifetime</div>
      </div>
    </div>
  );
}

// A followed org: identity + give path + the honest connect-your-history
// prompt. Deliberately NO history figures — a follow has none to show.
function FollowedCard({ org, onConnect, onUnfollow }) {
  return (
    <div style={{ ...S.card, borderLeft: `4px solid ${org.accent || org.primary || G.brass}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <OrgAvatar org={org} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.eyebrow}>Following</div>
          <div style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1.25 }}>{org.orgName}</div>
          {org.description && <div style={{ ...S.muted, fontSize: 13, marginTop: 2 }}>{org.description}</div>}
        </div>
        <a href={`/give/${org.orgSlug}`} target="_blank" rel="noreferrer" style={{ ...S.btnSm, textDecoration: "none", flexShrink: 0 }}>Give</a>
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
  );
}

// ── BUILD-47 directory search — LISTED orgs only, server-side ──────────────
function DirectorySearch({ autoFocus, onChanged }) {
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
                  : <button style={{ ...S.btnSm, flexShrink: 0 }} onClick={() => add(row)}>Add</button>}
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

function Home({ me, onOpenOrg }) {
  const [dash, setDash] = useState(null);
  const [tab, setTab] = useState("home"); // home | recurring | tax | account
  const [rec, setRec] = useState(null);
  const [tax, setTax] = useState(null);
  const [showDir, setShowDir] = useState(false);
  const [connectFor, setConnectFor] = useState(null); // org name for the alias-prefill context
  const loadDash = async () => setDash((await afetch("/dashboard")).body);
  useEffect(() => { loadDash(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (tab === "recurring" && !rec) (async () => setRec((await afetch("/recurring")).body))();
    if (tab === "tax" && !tax) (async () => setTax((await afetch("/tax-summary")).body))();
  }, [tab, rec, tax]);
  if (!dash) return <p style={{ ...S.muted, marginTop: 20 }}>Loading…</p>;
  const followed = dash.followed || [];
  const empty = dash.orgs.length === 0 && followed.length === 0;
  const unfollow = async (f) => { await afetch(`/follows/${f.followId}`, { method: "DELETE" }); loadDash(); };
  const connect = (f) => { setConnectFor(f.orgName); setTab("account"); };
  return (
    <div>
      <div style={{ borderBottom: `1px solid ${G.hair}`, marginBottom: 8 }}>
        <button style={S.tabbtn(tab === "home")} onClick={() => setTab("home")}>Home</button>
        <button style={S.tabbtn(tab === "recurring")} onClick={() => setTab("recurring")}>Recurring</button>
        <button style={S.tabbtn(tab === "tax")} onClick={() => setTab("tax")}>Receipts &amp; tax</button>
        <button style={S.tabbtn(tab === "account")} onClick={() => { setConnectFor(null); setTab("account"); }}>Account</button>
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
      {tab === "home" && !empty && (<>
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
        {dash.orgs.map(o => <OrgCard key={o.orgSlug} org={o} onOpen={() => onOpenOrg(o.orgSlug)} />)}
        {followed.map(f => <FollowedCard key={f.orgSlug} org={f} onConnect={() => connect(f)} onUnfollow={() => unfollow(f)} />)}
        {dash.impact.length > 0 && (<>
          <h2 style={{ ...S.h2, marginTop: 28, marginBottom: 4 }}>What your giving made possible</h2>
          {dash.impact.map(u => (
            <div key={u.orgSlug + u.id} style={S.card}>
              <div style={S.eyebrow}>{u.orgName}</div>
              <div style={{ fontWeight: 700, margin: "4px 0", fontSize: 15 }}>{u.title}</div>
              {u.body && <p style={{ ...S.muted, margin: 0 }}>{u.body}</p>}
            </div>
          ))}
        </>)}
      </>)}
      {tab === "recurring" && (
        <div style={S.card}>
          <h2 style={{ ...S.h2, marginBottom: 10 }}>Recurring giving</h2>
          {!rec ? <p style={S.muted}>Loading…</p> : rec.recurring.length === 0 ? <p style={S.muted}>No recurring gifts.</p> :
            rec.recurring.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${G.hair}` }}>
                <div><b>{r.orgName}</b> <span style={S.muted}>· {r.status}{r.pausedAt ? " (paused)" : ""}</span></div>
                <div>{fmtMoney(r.amount)}/{r.interval}</div>
              </div>
            ))}
          <p style={{ ...S.muted, fontSize: 13, marginTop: 10 }}>To change an amount, pause, or cancel, open that organization from Home — changes happen on its own page.</p>
        </div>
      )}
      {tab === "tax" && (
        <div style={S.card}>
          <h2 style={{ ...S.h2, marginBottom: 10 }}>Receipts &amp; year-end totals</h2>
          {!tax ? <p style={S.muted}>Loading…</p> : (<>
            <p style={{ ...S.muted, fontSize: 13 }}>{tax.note}</p>
            {tax.years.map(y => (
              <div key={y.year + y.orgSlug} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${G.hair}` }}>
                <div><b>{y.year}</b> <span style={S.muted}>· {y.orgName}</span></div>
                <div>{fmtMoney(y.total)} <span style={S.muted}>({y.gifts} gift{y.gifts === 1 ? "" : "s"})</span></div>
              </div>
            ))}
            <h2 style={{ ...S.h2, fontSize: 17, marginTop: 18 }}>Receipts</h2>
            {tax.receipts.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <div style={S.muted}>#{r.number} · {String(r.date).slice(0, 10)}</div>
                <div>{fmtMoney(r.amount)}</div>
              </div>
            ))}
          </>)}
        </div>
      )}
      {tab === "account" && <AccountPanel me={me} connectFor={connectFor} />}
    </div>
  );
}

function AccountPanel({ me, connectFor }) {
  const [aliasEmail, setAliasEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState(me);
  const aliasRef = useRef(null);
  useEffect(() => { if (connectFor && aliasRef.current) aliasRef.current.focus(); }, [connectFor]);
  const reload = async () => setInfo((await afetch("/me")).body);
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
        <button style={S.quiet} onClick={async () => {
          const r = await afetch("/aliases", { method: "POST", body: { email: aliasEmail } });
          setMsg(r.body?.message || ""); setAliasEmail(""); reload();
        }}>Add</button>
      </div>
      <p style={{ ...S.muted, fontSize: 13 }}>Give under another email? Confirm it and that history appears here. Nothing links without your confirmation.</p>
      <div style={S.label}>Organizations</div>
      {info.links.map(l => (
        <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
          <div style={S.muted}>{l.orgName} · via {l.viaEmail}{l.unlinked ? " · hidden" : ""}{!l.listed && !l.unlinked ? " · not in dashboards yet" : ""}</div>
          <button style={S.quiet} onClick={async () => {
            await afetch(`/links/${l.id}/${l.unlinked ? "relink" : "unlink"}`, { method: "POST" });
            reload();
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
  const loadMe = async () => {
    const r = await afetch("/me");
    setMe(r.status === 200 ? r.body : null);
    setChecked(true);
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
  if (!flags || !checked) return <div style={S.page}><GivingStyles /><Header /><div style={S.wrap}><p style={{ ...S.muted, marginTop: 20 }}>Loading…</p></div></div>;
  if (!flags.donorAccounts) {
    return <div style={S.page}><GivingStyles /><Header /><div style={S.wrap}>
      <div style={S.card}><p style={S.muted}>This page isn't available.</p></div>
    </div></div>;
  }
  const signOut = async () => { await afetch("/logout", { method: "POST" }); setMe(null); };
  // Await the session refetch BEFORE navigating away from the token landing —
  // the component doesn't remount across the landing→home route change, so an
  // un-awaited loadMe let the dashboard render its signed-out AuthCard after a
  // successful verify/reset (found in the go-live prod drive, 2026-08-12; same
  // class as the Portal.jsx onVerified fix).
  const done = async () => { await loadMe(); navigate("/giving", { replace: true }); };
  return (
    <div style={S.page}>
      <GivingStyles />
      <Header onSignOut={me ? signOut : null} />
      <div style={S.wrap}>
        <div style={{ paddingTop: 16 }}>
          {landing
            ? <TokenLanding kind={landing} onDone={done} />
            : me
              ? <Home me={me} onOpenOrg={slug => navigate(`/giving/orgs/${slug}`)} />
              : <AuthCard onSignedIn={loadMe} />}
        </div>
        <div style={{ borderTop: `1px solid ${G.hair}`, marginTop: 34, paddingTop: 16, textAlign: "center" }}>
          <p style={{ ...S.muted, fontSize: 12, margin: 0 }}>
            Each nonprofit sees only its own relationship with you. We never share
            your giving at one organization with another.
          </p>
        </div>
      </div>
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
