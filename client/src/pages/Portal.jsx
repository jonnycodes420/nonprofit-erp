// BUILD-45 — the donor portal (public, white-label). The org's identity, not
// Steward's: every color comes from the org's server-validated theme (CSS
// variables), the footer carries the org's text/EIN/contact, and "Powered by
// Steward" renders only when the org opted in.
//
// Auth is magic-link only (no passwords, ever). The session is an HttpOnly
// cookie the JS never reads — every fetch just sends credentials.
//
// Anti-patterns deliberately absent (the 2026-07-12 pivot lessons): no tiers,
// no badges, no leaderboards, no "you've given every year!" streak claims
// (§3.2 thin-data honesty), and no cancel friction (R-4: visible button, one
// confirmation, optional skippable reason).

import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { fmtFull } from "../lib/money";
import { resolvePairing, resolveCardStyle } from "../lib/portalTheme";

// Same-origin in production via the vercel.json /portal-api proxy (the cookie
// must be first-party); direct in dev (localhost ports are same-site).
// VITE_PORTAL_API is the local-capture override (a `vite build` for the
// scratch stack is still PROD to Vite, but has no /portal-api proxy).
const PORTAL_BASE = import.meta.env.VITE_PORTAL_API
  || (import.meta.env.PROD
    ? "/portal-api"
    : (import.meta.env.VITE_API_URL || "http://localhost:3001") + "/portal");

async function pfetch(path, opts = {}) {
  const r = await fetch(PORTAL_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body = null;
  try { body = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body };
}

// BUILD-48 theme depth: page background, fonts, card chrome, and button/link
// color all resolve through CSS variables set from the org's validated theme
// (varsFor below) — the fallbacks here match the designed defaults.
const S = {
  page: { minHeight: "100vh", background: "var(--pt-bg, #faf9f6)", color: "#1c1c1a", fontFamily: "var(--pt-sans, 'DM Sans',system-ui,sans-serif)" },
  wrap: { maxWidth: 720, margin: "0 auto", padding: "0 20px 64px" },
  card: { background: "#fff", border: "var(--pt-card-border, 1px solid #e7e4dc)", borderRadius: "var(--pt-card-radius, 14px)", boxShadow: "var(--pt-card-shadow, none)", padding: "20px 22px", marginBottom: 18 },
  h2: { fontFamily: "var(--pt-serif, 'DM Serif Display',Georgia,serif)", fontWeight: 400, fontSize: 22, margin: "0 0 12px" },
  label: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b6b64", marginBottom: 6 },
  input: { width: "100%", boxSizing: "border-box", padding: "12px 14px", fontSize: 15, border: "1px solid #d8d4c9", borderRadius: 10, outline: "none", fontFamily: "inherit" },
  btn: { background: "var(--pt-button, var(--pt-primary))", color: "var(--pt-button-fg, var(--pt-primary-fg))", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  btnQuiet: { background: "transparent", color: "#1c1c1a", border: "1px solid #d8d4c9", borderRadius: 10, padding: "10px 18px", fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  muted: { fontSize: 13, color: "#6b6b64", lineHeight: 1.6 },
};

// The org's validated theme → CSS variables. One implementation for the live
// page and the from-dashboard handoff shell (no neutral flash on drill-down).
function varsFor(theme) {
  const pairing = resolvePairing(theme.typePairing);
  const cs = resolveCardStyle(theme.cardStyle);
  return {
    "--pt-primary": theme.primary, "--pt-primary-fg": theme.primaryFg,
    "--pt-accent": theme.accent, "--pt-accent-fg": theme.accentFg,
    "--pt-button": theme.buttonColor || theme.primary,
    "--pt-button-fg": theme.buttonFg || theme.primaryFg,
    "--pt-bg": theme.backgroundTint || "#faf9f6",
    "--pt-serif": pairing.serif, "--pt-sans": pairing.sans,
    "--pt-card-radius": cs.radius + "px",
    "--pt-card-border": cs.borderWidth ? `${cs.borderWidth}px solid #e7e4dc` : "none",
    "--pt-card-shadow": cs.shadow,
  };
}

function PortalHeader({ theme }) {
  return (
    <header style={{ marginBottom: 26 }}>
      {theme.headerImage && (
        <div style={{ height: 160, borderRadius: "0 0 16px 16px", overflow: "hidden", marginBottom: 18 }}>
          <img src={theme.headerImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: theme.headerImage ? 0 : 28 }}>
        {theme.logo && <img src={theme.logo} alt="" style={{ height: 44, maxWidth: 140, objectFit: "contain" }} />}
        <div style={{ fontFamily: "var(--pt-serif, 'DM Serif Display',Georgia,serif)", fontSize: 24 }}>{theme.displayName}</div>
      </div>
      <div style={{ height: 3, background: "var(--pt-accent)", borderRadius: 2, marginTop: 12, width: 64 }} />
    </header>
  );
}

function PortalFooter({ theme }) {
  return (
    <footer style={{ ...S.muted, marginTop: 40, borderTop: "1px solid #e7e4dc", paddingTop: 18 }}>
      {theme.footerText && <div style={{ marginBottom: 6 }}>{theme.footerText}</div>}
      {theme.einLine && <div style={{ marginBottom: 6 }}>{theme.einLine}</div>}
      {theme.contactEmail && <div style={{ marginBottom: 6 }}>Questions? <a href={`mailto:${theme.contactEmail}`} style={{ color: "var(--pt-button, var(--pt-primary))" }}>{theme.contactEmail}</a></div>}
      {theme.poweredBy && <div style={{ marginTop: 10, fontSize: 12 }}>Powered by Steward</div>}
    </footer>
  );
}

function RequestLink({ slug, theme }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    await pfetch(`/${slug}/request-link`, { method: "POST", body: { email: email.trim() } });
    setBusy(false); setSent(true);
  };
  return (
    <div style={S.card}>
      <h2 style={S.h2}>Your giving with {theme.displayName}</h2>
      {sent ? (
        <p style={{ fontSize: 15, lineHeight: 1.7 }}>
          If we have this address on file, a sign-in link is on its way. It works once and expires in
          15 minutes — check your inbox.
        </p>
      ) : (
        <form onSubmit={submit}>
          <p style={{ ...S.muted, marginTop: 0 }}>
            Enter the email address you use for giving and we'll send you a secure sign-in link —
            this page signs you in by email, with no password to remember.
          </p>
          <div style={S.label}>Email address</div>
          <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)}
            autoComplete="email" placeholder="you@example.org" />
          <button type="submit" style={{ ...S.btn, marginTop: 14 }} disabled={busy}>
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
    </div>
  );
}

function Verify({ slug, onVerified }) {
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  useEffect(() => {
    const m = /token=([A-Za-z0-9_-]+)/.exec(window.location.hash || "");
    const token = m && m[1];
    // The token lives in the URL FRAGMENT (never sent to any server or in a
    // Referer); it is consumed by POST, once.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) { setErr("This link is incomplete — request a fresh one."); return; }
    (async () => {
      const r = await pfetch(`/${slug}/verify`, { method: "POST", body: { token } });
      // Refetch the session BEFORE navigating: /verify and the dashboard are
      // the same <Portal> instance (its mount effect keys on orgSlug only), so
      // an in-SPA navigate alone never re-ran loadMe and a freshly signed-in
      // donor landed back on the login form (found live on prod, 2026-08-11).
      if (r.status === 200) { if (onVerified) await onVerified(); navigate(`/portal/${slug}`, { replace: true }); }
      else setErr((r.body && r.body.message) || "That link has expired or was already used. Request a fresh one.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, navigate]);
  return (
    <div style={S.card}>
      {err ? (
        <>
          <h2 style={S.h2}>Link expired</h2>
          <p style={S.muted}>{err}</p>
          <button style={{ ...S.btn, marginTop: 10 }} onClick={() => navigate(`/portal/${slug}`, { replace: true })}>Request a new link</button>
        </>
      ) : <p style={S.muted}>Signing you in…</p>}
    </div>
  );
}

function YearBars({ byYear, gifts }) {
  const [openYear, setOpenYear] = useState(null);
  const max = Math.max(...byYear.map(y => y.total), 1);
  return (
    <div>
      {byYear.map(y => (
        <div key={y.year} style={{ marginBottom: 10 }}>
          <div role="button" tabIndex={0} onClick={() => setOpenYear(openYear === y.year ? null : y.year)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenYear(openYear === y.year ? null : y.year); } }}
            style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ width: 44, fontSize: 13, fontWeight: 700 }}>{y.year}</div>
            <div style={{ flex: 1, height: 18, background: "#efece5", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(4, (y.total / max) * 100)}%`, height: "100%", background: "var(--pt-primary)" }} />
            </div>
            <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 600 }}>{fmtFull(y.total)}</div>
          </div>
          {openYear === y.year && (
            <div style={{ margin: "8px 0 4px 56px" }}>
              {gifts.filter(g => (g.date || "").startsWith(y.year)).map(g => (
                <div key={g.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid #f0ede6" }}>
                  <span>{g.date}{g.campaign ? ` · ${g.campaign}` : g.fund ? ` · ${g.fund}` : ""}</span>
                  <span style={{ fontWeight: 600 }}>{fmtFull(g.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RecurringCard({ slug, sub, theme, onChanged }) {
  const [mode, setMode] = useState(null); // null | amount | pause | cancel
  const [amount, setAmount] = useState("");
  const [resumeDate, setResumeDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const act = async (path, body) => {
    setBusy(true); setErr("");
    const r = await pfetch(`/${slug}/recurring/${sub.id}/${path}`, { method: "POST", body: body || {} });
    setBusy(false);
    if (r.status === 200) { setMode(null); onChanged(); }
    else setErr((r.body && r.body.message) || "That didn't go through — please try again.");
    return r;
  };
  const statusLabel = { active: "Active", paused: "Paused", past_due: "Payment issue", recovering: "Payment issue", recovered: "Active", canceled: "Canceled" }[sub.status] || sub.status;
  return (
    <div style={{ borderTop: "1px solid #f0ede6", paddingTop: 14, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{fmtFull(sub.amount)}</span>
          <span style={S.muted}> / {sub.interval === "year" ? "year" : "month"}</span>
          <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: sub.status === "canceled" ? "#eee" : "#eef4ef", color: sub.status === "canceled" ? "#777" : "var(--pt-primary)" }}>{statusLabel}</span>
        </div>
        {sub.cardLast4 && <div style={S.muted}>Card ending {sub.cardLast4}</div>}
      </div>
      {sub.status === "paused" && <div style={{ ...S.muted, marginTop: 6 }}>Paused{sub.resumeAt ? ` — resumes automatically ${String(sub.resumeAt).slice(0, 10)}` : ""}. No charges while paused.</div>}
      {sub.nextChargeDate && sub.status !== "canceled" && sub.status !== "paused" && (
        <div style={{ ...S.muted, marginTop: 6 }}>Next charge: {sub.nextChargeDate}</div>
      )}
      {["past_due", "recovering"].includes(sub.status) && (
        <div style={{ marginTop: 10, padding: "10px 14px", background: "#fdf6ec", border: "1px solid #ecd9b0", borderRadius: 10, fontSize: 14 }}>
          Your last payment didn't go through — updating your card usually fixes it.
        </div>
      )}
      {sub.status !== "canceled" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {sub.status !== "paused" && <button style={S.btnQuiet} onClick={() => setMode(mode === "amount" ? null : "amount")}>Change amount</button>}
          {sub.status === "paused"
            ? <button style={S.btnQuiet} onClick={() => act("resume")} disabled={busy}>Resume giving</button>
            : <button style={S.btnQuiet} onClick={() => setMode(mode === "pause" ? null : "pause")}>Pause</button>}
          <button style={S.btnQuiet} onClick={async () => {
            const r = await pfetch(`/${slug}/recurring/${sub.id}/update-card`, { method: "POST", body: {} });
            if (r.status === 200 && r.body?.url) window.location.href = r.body.url;
          }}>Update payment method</button>
          <button style={{ ...S.btnQuiet, color: "#8a3a24", borderColor: "#eac6b8" }} onClick={() => setMode(mode === "cancel" ? null : "cancel")}>Cancel</button>
        </div>
      )}
      {mode === "amount" && (
        <div style={{ marginTop: 12 }}>
          <div style={S.label}>New amount (per {sub.interval === "year" ? "year" : "month"})</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...S.input, maxWidth: 140 }} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`${sub.amount}`} />
            <button style={S.btn} disabled={busy} onClick={() => {
              const dollars = parseFloat(String(amount).replace(/[$,]/g, ""));
              if (!isFinite(dollars) || dollars <= 0) { setErr("Enter a valid amount."); return; }
              act("amount", { amountCents: Math.round(dollars * 100) });
            }}>{busy ? "Saving…" : "Save"}</button>
          </div>
          <div style={{ ...S.muted, marginTop: 6 }}>Takes effect on your next scheduled charge.</div>
        </div>
      )}
      {mode === "pause" && (
        <div style={{ marginTop: 12 }}>
          <div style={S.label}>Resume automatically on (optional)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...S.input, maxWidth: 180 }} type="date" value={resumeDate} onChange={e => setResumeDate(e.target.value)} />
            <button style={S.btn} disabled={busy} onClick={() => act("pause", resumeDate ? { resumeDate } : {})}>{busy ? "Pausing…" : "Pause my gift"}</button>
          </div>
          <div style={{ ...S.muted, marginTop: 6 }}>No charges while paused. Resume anytime.</div>
        </div>
      )}
      {mode === "cancel" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>Cancel this recurring gift? You won't be charged again.</div>
          <div style={S.label}>Anything you'd like to share? (optional)</div>
          <input style={S.input} value={reason} onChange={e => setReason(e.target.value)} placeholder="Entirely optional" />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={{ ...S.btn, background: "#8a3a24", color: "#fff" }} disabled={busy}
              onClick={() => act("cancel", reason.trim() ? { reason: reason.trim() } : {})}>{busy ? "Canceling…" : "Yes, cancel my gift"}</button>
            <button style={S.btnQuiet} onClick={() => setMode(null)}>Keep giving</button>
          </div>
        </div>
      )}
      {err && <div style={{ marginTop: 10, color: "#8a3a24", fontSize: 14 }}>{err}</div>}
    </div>
  );
}

function Dashboard({ slug, me, reload }) {
  const theme = me.theme;
  const g = me.giving || {};
  const seenImpact = useMemo(() => new Set(), []);
  useEffect(() => {
    for (const u of me.impact || []) {
      if (!seenImpact.has(u.id)) {
        seenImpact.add(u.id);
        pfetch(`/${slug}/impact/${u.id}/viewed`, { method: "POST", body: {} }).catch(() => {});
      }
    }
  }, [me.impact, slug, seenImpact]);
  const logout = async () => { await pfetch(`/${slug}/logout`, { method: "POST", body: {} }); window.location.reload(); };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 15 }}>Welcome back{me.donorName ? `, ${me.donorName.split(" ")[0]}` : ""}.</div>
        <button style={{ ...S.btnQuiet, padding: "6px 14px", fontSize: 13 }} onClick={logout}>Sign out</button>
      </div>
      {/* BUILD-46 §1.3 — the migration nudge: prompted, never forced. Renders
          only when the server says accounts are live AND this org opted into
          donor-dashboard listing (me.account non-null — unlisted orgs' portals
          carry no mention of a cross-org account) and this donor hasn't
          finished setting one up. The signup link carries the donor's verified
          email in the URL FRAGMENT (never sent to any server). */}
      {me.account && !(me.account.exists && me.account.hasPassword) && (
        <div style={{ fontSize: 13, color: "#555", margin: "0 0 10px" }}>
          {me.account.exists
            ? <>Add a password to your giving account for one-step sign-in — use "Reset password" at <a href="/giving" style={{ color: "var(--pt-button, var(--pt-primary))" }}>your giving dashboard</a>.</>
            : <>See all your giving in one place — <a href={`/giving#signup&email=${encodeURIComponent(me.account.email || "")}&from=${encodeURIComponent(slug)}`} style={{ color: "var(--pt-button, var(--pt-primary))" }}>create a free account</a>. This page keeps working exactly as it does now.</>}
        </div>
      )}

      {/* Giving summary — honest at every data size (§3.2): totals and real
          dates only; no streaks, no percentages, no invented milestones. */}
      <div style={S.card}>
        <h2 style={S.h2}>Your giving</h2>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 16 }}>
          <div><div style={S.label}>This year</div><div style={{ fontSize: 26, fontWeight: 700 }}>{fmtFull(g.ytd)}</div></div>
          <div><div style={S.label}>Lifetime</div><div style={{ fontSize: 26, fontWeight: 700 }}>{fmtFull(g.lifetime)}</div></div>
          {g.largestGift > 0 && <div><div style={S.label}>Largest gift</div><div style={{ fontSize: 26, fontWeight: 700 }}>{fmtFull(g.largestGift)}</div></div>}
        </div>
        {g.firstGiftDate && <div style={{ ...S.muted, marginBottom: 14 }}>Giving with {theme.displayName} since {String(g.firstGiftDate).slice(0, 4)}.</div>}
        {(g.byYear || []).length > 0 && <YearBars byYear={g.byYear} gifts={me.gifts || []} />}
      </div>

      {(me.recurring || []).length > 0 && (
        <div style={S.card}>
          <h2 style={S.h2}>Recurring giving</h2>
          {me.recurring.map(sub => <RecurringCard key={sub.id} slug={slug} sub={sub} theme={theme} onChanged={reload} />)}
        </div>
      )}
      {theme.giveSlug && (
        <div style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 15 }}>Make a new gift to {theme.displayName}</div>
          <a href={`/give/${theme.giveSlug}?email=${encodeURIComponent(me.email)}`} style={{ ...S.btn, textDecoration: "none", display: "inline-block" }}>Give</a>
        </div>
      )}

      {(me.pledges || []).filter(p => p.status === "open").length > 0 && (
        <div style={S.card}>
          <h2 style={S.h2}>Pledges</h2>
          {me.pledges.filter(p => p.status === "open").map(p => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0", borderBottom: "1px solid #f0ede6" }}>
              <span>Pledged {fmtFull(p.amount)} · due {p.dueDate}</span>
              <span style={{ fontWeight: 600 }}>{p.paid > 0 ? `${fmtFull(p.paid)} paid · ${fmtFull(p.balance)} remaining` : `${fmtFull(p.balance)} remaining`}</span>
            </div>
          ))}
        </div>
      )}

      {(me.receipts || []).length > 0 && (
        <div style={S.card}>
          <h2 style={S.h2}>Tax receipts</h2>
          {me.receipts.map(r => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, padding: "8px 0", borderBottom: "1px solid #f0ede6" }}>
              <span>{r.type === "year_end" ? `${r.taxYear} year-end statement` : `Receipt #${r.number}`} · {fmtFull(r.amount)}</span>
              <a href={`${PORTAL_BASE}/${slug}/receipts/${r.id}/pdf`} style={{ color: "var(--pt-button, var(--pt-primary))", fontWeight: 600, fontSize: 13 }}>Download PDF</a>
            </div>
          ))}
        </div>
      )}

      {me.household && me.household.combined > 0 && (
        <div style={S.card}>
          <h2 style={S.h2}>Household giving</h2>
          <p style={{ ...S.muted, marginTop: 0 }}>
            Together, {me.household.name || "your household"} has given {fmtFull(me.household.combined)}.
            This combined figure is shown separately from your own totals above.
          </p>
        </div>
      )}

      {(me.impact || []).length > 0 && (
        <div style={S.card}>
          <h2 style={S.h2}>What your giving made possible</h2>
          {me.impact.map(u => (
            <div key={u.id} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{u.title}</div>
              {(u.photos || []).length > 0 && (
                <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
                  {u.photos.map((p, i) => <img key={i} src={p} alt="" style={{ maxWidth: 200, maxHeight: 140, borderRadius: 8, objectFit: "cover" }} />)}
                </div>
              )}
              {u.body && <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{u.body}</div>}
              <div style={{ ...S.muted, marginTop: 4, fontSize: 12 }}>{String(u.date).slice(0, 10)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function Portal() {
  const { orgSlug } = useParams();
  const location = useLocation();
  const isVerify = location.pathname.endsWith("/verify");
  // BUILD-48 seamless drill-down: the dashboard stashes the org's theme in
  // sessionStorage when opening this portal, so the first paint is already
  // the org's — no neutral flash. The /config fetch replaces + re-stashes it
  // (the stash is presentation-only and never trusted for anything else).
  const [theme, setTheme] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("pt_theme_" + orgSlug) || "null"); } catch { return null; }
  });
  const [notFound, setNotFound] = useState(false);
  const [me, setMe] = useState(null);
  const [checked, setChecked] = useState(false);

  const loadMe = async () => {
    const r = await pfetch(`/${orgSlug}/me`);
    if (r.status === 200) setMe(r.body);
    else setMe(null);
    setChecked(true);
  };
  useEffect(() => {
    (async () => {
      const r = await pfetch(`/${orgSlug}/config`);
      if (r.status !== 200) { setNotFound(true); setChecked(true); return; }
      setTheme(r.body.theme);
      try { sessionStorage.setItem("pt_theme_" + orgSlug, JSON.stringify(r.body.theme)); } catch { /* full/blocked storage is fine */ }
      if (!isVerify) await loadMe(); else setChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  if (notFound) return (
    <div style={S.page}><div style={{ ...S.wrap, paddingTop: 80, textAlign: "center" }}>
      <p style={{ fontSize: 16 }}>This page isn't available.</p>
    </div></div>
  );
  if (!theme || !checked) {
    if (theme) return ( // themed shell while the session check runs — the org's page from the first paint
      <div style={{ ...S.page, ...varsFor(theme) }}><div style={S.wrap}>
        <PortalHeader theme={theme} />
        <p style={S.muted}>Loading…</p>
      </div></div>
    );
    return <div style={S.page}><div style={{ ...S.wrap, paddingTop: 80 }}><p style={S.muted}>Loading…</p></div></div>;
  }

  const vars = varsFor(theme);
  return (
    <div style={{ ...S.page, ...vars }}>
      <div style={S.wrap}>
        <PortalHeader theme={theme} />
        {isVerify
          ? <Verify slug={orgSlug} onVerified={loadMe} />
          : me && !me.empty
            ? <Dashboard slug={orgSlug} me={me} reload={loadMe} />
            : <RequestLink slug={orgSlug} theme={theme} />}
        <PortalFooter theme={theme} />
      </div>
    </div>
  );
}
