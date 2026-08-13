// BUILD-46 §2 — the cross-org donor dashboard: Steward's CONSUMER surface.
// The donor sees their giving across every linked, listed org; each org's
// drill-down is the UNFORKED BUILD-45 portal (rendered by the /giving/orgs/
// route wrapping <Portal/>). Aggregations are read-time, donor-eyes-only.
//
// Brand: CONSUMER_BRAND is the placeholder pending the founder decision —
// every place the string lives is listed in BLOCKED-consumer-brand.md.
// Feature-flagged: the server's /network/config gates this page; with
// DONOR_ACCOUNTS_ENABLED off the page renders a quiet unavailable state.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, fmtMoney } from "./publicTheme";

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

const S = {
  page: { minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: "'DM Sans',Helvetica,Arial,sans-serif" },
  wrap: { maxWidth: 880, margin: "0 auto", padding: "28px 20px 60px" },
  wordmark: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, letterSpacing: "-0.02em", color: T.ink },
  sub: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: T.ink3, marginLeft: 10 },
  card: { background: T.white, borderRadius: 12, padding: "22px 24px", margin: "14px 0", border: `1px solid ${T.bg2}` },
  h2: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20, margin: "0 0 10px" },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, margin: "12px 0 4px" },
  input: { width: "100%", padding: "11px 12px", fontSize: 15, border: `1px solid ${T.bg3}`, borderRadius: 8, background: T.white, color: T.ink, boxSizing: "border-box" },
  btn: { background: T.gold, color: T.ink, border: "none", borderRadius: 8, padding: "12px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  quiet: { background: "transparent", color: T.greenDk, border: `1px solid ${T.greenDk}`, borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  muted: { color: T.ink3, fontSize: 14, lineHeight: 1.55 },
  statNum: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 30 },
  err: { color: "#8a3a24", fontSize: 14, marginTop: 8 },
  tabbtn: (on) => ({ background: "transparent", border: "none", borderBottom: on ? `3px solid ${T.gold}` : "3px solid transparent", padding: "8px 2px", marginRight: 20, fontSize: 14, fontWeight: on ? 700 : 500, color: T.ink, cursor: "pointer" }),
};

function Header({ onSignOut }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <span style={S.wordmark}>Steward</span>
        <span style={S.sub}>Your Giving</span>
      </div>
      {onSignOut && <button style={S.quiet} onClick={onSignOut}>Sign out</button>}
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
      <h2 style={S.h2}>{mode === "login" ? "See all your giving in one place" : mode === "signup" ? "Create your giving account" : "Reset your password"}</h2>
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
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: 13, color: T.ink3, cursor: "pointer" }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
          <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: T.greenDk }}>Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: T.greenDk }}>Privacy Policy</a>.</span>
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
  const [needPw, setNeedPw] = useState(kind === "reset");
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
      {err ? (<><h2 style={S.h2}>Link expired</h2><p style={S.muted}>{err}</p></>)
        : needPw ? (<>
          <h2 style={S.h2}>Choose a new password</h2>
          <div style={S.label}>New password</div>
          <input style={S.input} type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          <div style={{ marginTop: 14 }}><button style={S.btn} onClick={submit}>Set password</button></div>
        </>) : <p style={S.muted}>One moment…</p>}
    </div>
  );
}

function OrgCard({ org, onOpen }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ ...S.card, cursor: "pointer", display: "flex", alignItems: "center", gap: 16 }}>
      {org.logo
        ? <img src={org.logo} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
        : <div style={{ width: 44, height: 44, borderRadius: 8, background: org.primary || T.greenDk, color: "#faf8f4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20 }}>{(org.orgName || "?")[0]}</div>}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{org.orgName}</div>
        <div style={{ ...S.muted, fontSize: 13 }}>
          {org.lastGiftDate ? `Last gift ${org.lastGiftDate}` : "No gifts yet"}
          {org.recurringCount > 0 && ` · ${org.recurringCount} recurring`}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 700 }}>{fmtMoney(org.ytd)} <span style={{ ...S.muted, fontSize: 12 }}>this year</span></div>
        <div style={{ ...S.muted, fontSize: 13 }}>{fmtMoney(org.lifetime)} lifetime</div>
      </div>
    </div>
  );
}

function Home({ me, onOpenOrg }) {
  const [dash, setDash] = useState(null);
  const [tab, setTab] = useState("home"); // home | recurring | tax | account
  const [rec, setRec] = useState(null);
  const [tax, setTax] = useState(null);
  useEffect(() => { (async () => setDash((await afetch("/dashboard")).body))(); }, []);
  useEffect(() => {
    if (tab === "recurring" && !rec) (async () => setRec((await afetch("/recurring")).body))();
    if (tab === "tax" && !tax) (async () => setTax((await afetch("/tax-summary")).body))();
  }, [tab, rec, tax]);
  if (!dash) return <p style={S.muted}>Loading…</p>;
  return (
    <div>
      <div style={{ borderBottom: `1px solid ${T.bg2}`, marginBottom: 8 }}>
        <button style={S.tabbtn(tab === "home")} onClick={() => setTab("home")}>Home</button>
        <button style={S.tabbtn(tab === "recurring")} onClick={() => setTab("recurring")}>Recurring</button>
        <button style={S.tabbtn(tab === "tax")} onClick={() => setTab("tax")}>Receipts &amp; tax</button>
        <button style={S.tabbtn(tab === "account")} onClick={() => setTab("account")}>Account</button>
      </div>
      {tab === "home" && (<>
        <div style={{ ...S.card, display: "flex", gap: 40 }}>
          <div><div style={S.label}>This year</div><div style={S.statNum}>{fmtMoney(dash.totals.ytd)}</div></div>
          <div><div style={S.label}>Lifetime</div><div style={S.statNum}>{fmtMoney(dash.totals.lifetime)}</div></div>
          <div><div style={S.label}>Organizations</div><div style={S.statNum}>{dash.totals.orgCount}</div></div>
        </div>
        {dash.orgs.map(o => <OrgCard key={o.orgSlug} org={o} onOpen={() => onOpenOrg(o.orgSlug)} />)}
        {dash.orgs.length === 0 && (
          <div style={S.card}><p style={S.muted}>
            No linked organizations yet. When a nonprofit you support joins the
            network under the email you verified, it appears here automatically.
            Give under a different email? Add it under Account.
          </p></div>
        )}
        {dash.impact.length > 0 && (<>
          <h2 style={{ ...S.h2, marginTop: 24 }}>What your giving made possible</h2>
          {dash.impact.map(u => (
            <div key={u.orgSlug + u.id} style={S.card}>
              <div style={{ ...S.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{u.orgName}</div>
              <div style={{ fontWeight: 700, margin: "4px 0" }}>{u.title}</div>
              {u.body && <p style={{ ...S.muted, margin: 0 }}>{u.body}</p>}
            </div>
          ))}
        </>)}
      </>)}
      {tab === "recurring" && (
        <div style={S.card}>
          <h2 style={S.h2}>Recurring giving</h2>
          {!rec ? <p style={S.muted}>Loading…</p> : rec.recurring.length === 0 ? <p style={S.muted}>No recurring gifts.</p> :
            rec.recurring.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.bg2}` }}>
                <div><b>{r.orgName}</b> <span style={S.muted}>· {r.status}{r.pausedAt ? " (paused)" : ""}</span></div>
                <div>{fmtMoney(r.amount)}/{r.interval}</div>
              </div>
            ))}
          <p style={{ ...S.muted, fontSize: 13, marginTop: 10 }}>To change an amount, pause, or cancel, open that organization from Home — changes happen on its own page.</p>
        </div>
      )}
      {tab === "tax" && (
        <div style={S.card}>
          <h2 style={S.h2}>Receipts &amp; year-end totals</h2>
          {!tax ? <p style={S.muted}>Loading…</p> : (<>
            <p style={{ ...S.muted, fontSize: 13 }}>{tax.note}</p>
            {tax.years.map(y => (
              <div key={y.year + y.orgSlug} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.bg2}` }}>
                <div><b>{y.year}</b> <span style={S.muted}>· {y.orgName}</span></div>
                <div>{fmtMoney(y.total)} <span style={S.muted}>({y.gifts} gift{y.gifts === 1 ? "" : "s"})</span></div>
              </div>
            ))}
            <h2 style={{ ...S.h2, fontSize: 16, marginTop: 18 }}>Receipts</h2>
            {tax.receipts.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <div style={S.muted}>#{r.number} · {String(r.date).slice(0, 10)}</div>
                <div>{fmtMoney(r.amount)}</div>
              </div>
            ))}
          </>)}
        </div>
      )}
      {tab === "account" && <AccountPanel me={me} />}
    </div>
  );
}

function AccountPanel({ me }) {
  const [aliasEmail, setAliasEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState(me);
  const reload = async () => setInfo((await afetch("/me")).body);
  return (
    <div style={S.card}>
      <h2 style={S.h2}>Account</h2>
      <p style={S.muted}>Signed in as <b>{info.email}</b>{info.hasPassword ? "" : " (no password set — use Reset password to add one)"}.</p>
      <div style={S.label}>Linked email addresses</div>
      {info.aliases.map(a => (
        <div key={a.id} style={{ ...S.muted, padding: "3px 0" }}>{a.email} {a.verified ? "· verified" : "· awaiting confirmation"}</div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 420 }}>
        <input style={S.input} placeholder="another-email@you.org" value={aliasEmail} onChange={e => setAliasEmail(e.target.value)} />
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
  if (!flags || !checked) return <div style={S.page}><div style={S.wrap}><Header /><p style={S.muted}>Loading…</p></div></div>;
  if (!flags.donorAccounts) {
    return <div style={S.page}><div style={S.wrap}><Header />
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
      <div style={S.wrap}>
        <Header onSignOut={me ? signOut : null} />
        {landing
          ? <TokenLanding kind={landing} onDone={done} />
          : me
            ? <Home me={me} onOpenOrg={slug => navigate(`/giving/orgs/${slug}`)} />
            : <AuthCard onSignedIn={loadMe} />}
        <p style={{ ...S.muted, fontSize: 12, marginTop: 30 }}>
          Each nonprofit sees only its own relationship with you. We never share
          your giving at one organization with another.
        </p>
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
