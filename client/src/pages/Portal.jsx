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
import { resolveAssetUrl } from "../lib/assetUrl";
import { PageRenderer } from "../components/PortalWidgets";
import PortalBanner, { PORTAL_HEADER_RATIO } from "../components/PortalBanner";
import { portalScaleVars } from "../lib/portalScale";

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
// BUILD-59 — every size/space here references the ONE portal scale
// (lib/portalScale.js) via CSS vars, so the count of distinct raw values drops
// hard (reported in FINDINGS). Buttons are one height/padding/label-case
// everywhere; body/inputs share the body step; line-height is the body token.
const S = {
  page: { minHeight: "100vh", background: "var(--pt-bg, #faf9f6)", color: "#1c1c1a", fontFamily: "var(--pt-sans, 'DM Sans',system-ui,sans-serif)", fontSize: "var(--pt-fs-body, 15px)", lineHeight: "var(--pt-lh-body, 1.55)" },
  wrap: { maxWidth: 860, margin: "0 auto", padding: "0 var(--pt-sp-5, 24px) var(--pt-sp-8, 64px)" },
  card: { background: "#fff", border: "var(--pt-card-border, 1px solid #e7e4dc)", borderRadius: "var(--pt-card-radius, 14px)", boxShadow: "var(--pt-card-shadow, none)", padding: "var(--pt-sp-5, 24px)", marginBottom: "var(--pt-sp-4, 16px)" },
  h2: { fontFamily: "var(--pt-serif, 'DM Serif Display',Georgia,serif)", fontWeight: 400, fontSize: "var(--pt-fs-h2, 22px)", lineHeight: "var(--pt-lh-display, 1.15)", margin: "0 0 var(--pt-sp-3, 12px)" },
  label: { fontSize: "var(--pt-fs-micro, 12px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b6b64", marginBottom: "var(--pt-sp-2, 8px)" },
  input: { width: "100%", boxSizing: "border-box", padding: "var(--pt-sp-3, 12px) var(--pt-sp-4, 16px)", fontSize: "var(--pt-fs-body, 15px)", border: "1px solid #d8d4c9", borderRadius: 10, outline: "none", fontFamily: "inherit" },
  btn: { background: "var(--pt-button, var(--pt-primary))", color: "var(--pt-button-fg, var(--pt-primary-fg))", border: "none", borderRadius: 10, padding: "var(--pt-sp-3, 12px) var(--pt-sp-5, 24px)", fontSize: "var(--pt-fs-body, 15px)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  btnQuiet: { background: "transparent", color: "#1c1c1a", border: "1px solid #d8d4c9", borderRadius: 10, padding: "var(--pt-sp-3, 12px) var(--pt-sp-4, 16px)", fontSize: "var(--pt-fs-body, 15px)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  muted: { fontSize: "var(--pt-fs-small, 13px)", color: "#6b6b64", lineHeight: "var(--pt-lh-body, 1.55)" },
};

// 2026-08-15 wide-width pass — explicit override of the BUILD-54 "the donor
// page is a letter, not a site" call (see audit/BUILD-54-FINDINGS.md): the
// portal now USES the width. The content column widens on a ladder
// (860 → 1140 at >=1280px → 1360 at >=1720px), the donor's own cards arrange
// into two columns at desktop, and published-page widgets flow into a
// two-track grid (full-width kinds span both tracks — the CSS lives here, the
// kind→span map lives in PortalWidgets so the editor preview stays
// single-column). 390 stays a single column; the full-bleed banner + band
// rhythm is untouched; no theme CSS-var logic changes. Portal.jsx previously
// had no media queries — this style block (the GivingStyles pattern) is the
// one home for them.
function PortalStyles() {
  return <style>{`
    .pt-col { max-width: 860px; margin: 0 auto; padding: 0 20px; }
    .pt-wrap { max-width: 860px; margin: 0 auto; padding: 0 20px 64px; }
    @media (min-width: 1280px) { .pt-col, .pt-wrap { max-width: 1140px; } }
    @media (min-width: 1720px) { .pt-col, .pt-wrap { max-width: 1360px; } }
    /* Giving summary at wide: the stats block sits BESIDE the year bars
       (a 2-column internal grid); single column below ~900px. */
    @media (min-width: 900px) {
      .pt-mygiving-grid { display: grid; grid-template-columns: minmax(200px, 250px) 1fr; gap: 4px 40px; align-items: start; }
      .pt-mygiving-statsrow { flex-direction: column; gap: 16px !important; }
    }
    /* Secondary cluster (recurring / give / pledges / receipts / household),
       campaign spotlights, impact updates, and published-page widgets:
       arranged into two columns at >=1280px, stacked below. */
    @media (min-width: 1280px) {
      .pt-cluster, .pt-campaigns { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
      .pt-cluster:not(:empty), .pt-campaigns:not(:empty) { margin-bottom: 18px; }
      .pt-cluster > *, .pt-campaigns > * { margin-bottom: 0 !important; }
      .pt-impactgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; }
      .pt-widgets { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; align-items: start; }
      .pt-widgets > * { min-width: 0; }
    }
  `}</style>;
}

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
    ...portalScaleVars(), // BUILD-59 — the one type + spacing scale
  };
}

// BUILD-54 §5 — the banner runs EDGE TO EDGE (never boxed in the content
// column), and the org's identity is consolidated onto it: one plaque (logo
// or monogram + name), no second identity block below. With no uploaded
// image the fallback is the DESIGNED treatment — a solid band in the org's
// own primary with monogram + name — never generated abstract shapes.
function Monogram({ theme, size = 52 }) {
  return (
    <div aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--pt-serif, Georgia,serif)", fontSize: size * 0.46, color: "var(--pt-primary-fg, #fff)", flexShrink: 0 }}>
      {(theme.displayName || "?").slice(0, 1)}
    </div>
  );
}

function PortalHeader({ theme }) {
  const plaque = (
    <div className="pt-col" style={{ display: "flex", alignItems: "center", gap: "var(--pt-sp-3, 14px)", paddingBottom: "var(--pt-sp-4, 18px)", paddingTop: "var(--pt-sp-5, 24px)" }}>
      {theme.logo
        ? <img src={resolveAssetUrl(theme.logo)} alt="" style={{ height: 46, maxWidth: 150, objectFit: "contain", background: "rgba(255,255,255,0.92)", borderRadius: 10, padding: "4px 8px" }} />
        : <Monogram theme={theme} />}
      <div style={{ fontFamily: "var(--pt-serif, 'DM Serif Display',Georgia,serif)", fontSize: "var(--pt-fs-display, clamp(26px, 3.4vw, 34px))", lineHeight: 1.1, color: "var(--pt-primary-fg, #fff)" }}>
        {theme.displayName}
      </div>
    </div>
  );
  return (
    <header style={{ marginBottom: "var(--pt-sp-6, 30px)" }}>
      {theme.headerImage ? (
        <PortalBanner
          url={theme.headerImage}
          focal={theme.headerFocal}
          bandColor="var(--pt-primary)"
          ratio={PORTAL_HEADER_RATIO}
          priority
          alt=""
        >
          {plaque}
        </PortalBanner>
      ) : (
        <div style={{ width: "100%", background: "var(--pt-primary)", padding: "clamp(30px, 5vw, 54px) 0" }}>{plaque}</div>
      )}
      <div className="pt-col">
        <div style={{ height: 3, background: "var(--pt-accent)", borderRadius: 2, marginTop: "var(--pt-sp-3, 14px)", width: 64 }} />
      </div>
    </header>
  );
}

// §5 fix 3 — the account row: quiet, SEPARATE from the org identity, and it
// carries the org-themed nav a donor needs without backing out (in-page
// anchors to the sections that exist; "All giving" appears on the /giving
// drill-down).
function AccountBar({ me, onSignOut }) {
  const inDrilldown = typeof window !== "undefined" && window.location.pathname.startsWith("/giving");
  const links = [];
  if (inDrilldown) links.push(["All giving", "/giving", false]);
  if ((me.recurring || []).length) links.push(["Recurring", "#recurring", true]);
  if ((me.receipts || []).length) links.push(["Receipts & tax", "#receipts", true]);
  return (
    <div className="pt-col" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
      <span style={{ fontSize: 14 }}>Welcome back{me.donorName ? `, ${me.donorName.split(" ")[0]}` : ""}.</span>
      <nav aria-label="Your giving" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {links.map(([label, href]) => (
          <a key={label} href={href} style={{ color: "var(--pt-button, var(--pt-primary))", fontSize: 13, fontWeight: 700, textDecoration: "none", borderBottom: "2px solid var(--pt-accent)", paddingBottom: 1 }}>{label}</a>
        ))}
      </nav>
      <button style={{ ...S.btnQuiet, padding: "6px 14px", fontSize: 13, marginLeft: "auto" }} onClick={onSignOut}>Sign out</button>
    </div>
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
        <div key={y.year} style={{ marginBottom: 14 }}>
          <div role="button" tabIndex={0} onClick={() => setOpenYear(openYear === y.year ? null : y.year)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenYear(openYear === y.year ? null : y.year); } }}
            style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ width: 44, fontSize: 13, fontWeight: 700 }}>{y.year}</div>
            <div style={{ flex: 1, height: 26, background: "#efece5", borderRadius: 6, overflow: "hidden" }}>
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

// BUILD-54 §2 — sanitized structured story blocks (server-validated typed
// data, never HTML; React renders the strings as text nodes).
function StoryBlocks({ blocks }) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  return (
    <div style={{ fontSize: 14, lineHeight: 1.7 }}>
      {blocks.map((b, i) => {
        if (b.type === "h2") return <div key={i} style={{ fontFamily: "var(--pt-serif, Georgia,serif)", fontSize: 18, margin: "14px 0 6px" }}>{b.text}</div>;
        if (b.type === "ul") return <ul key={i} style={{ margin: "8px 0", paddingLeft: 22 }}>{(b.items || []).map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{it}</li>)}</ul>;
        return <p key={i} style={{ margin: "8px 0" }}>{b.text}</p>;
      })}
    </div>
  );
}

// The donor's own giving cluster — one implementation for the legacy fixed
// layout AND the §4 "My Giving" widget (the org's page decides WHERE it sits,
// never WHAT it shows). includeGiveCta preserves the legacy card order
// exactly (pinned by the build45/48/50 capture contracts).
function MyGivingSection({ slug, me, reload, theme, includeGiveCta }) {
  const g = me.giving || {};
  return (
    <>
      {/* Giving summary — honest at every data size (§3.2): totals and real
          dates only; no streaks, no percentages, no invented milestones.
          2026-08-15 wide-width pass: at >=900px the card's internals become a
          2-column grid — stats block | year bars — instead of stacked
          (pt-mygiving-grid in PortalStyles); single column below. */}
      <div className="pt-mygiving" style={S.card}>
        <h2 style={S.h2}>Your giving</h2>
        <div className="pt-mygiving-grid">
          <div className="pt-mygiving-stats">
            <div className="pt-mygiving-statsrow" style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
              <div><div style={S.label}>This year</div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmtFull(g.ytd)}</div></div>
              <div><div style={S.label}>Lifetime</div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmtFull(g.lifetime)}</div></div>
              {/* §5 — a stat that merely repeats another reads as a bug: show the
                  largest gift only when it differs from both figures above,
                  otherwise substitute the gifts count. */}
              {g.largestGift > 0 && g.largestGift !== g.ytd && g.largestGift !== g.lifetime
                ? <div><div style={S.label}>Largest gift</div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmtFull(g.largestGift)}</div></div>
                : g.giftCount > 1 && <div><div style={S.label}>Gifts</div><div style={{ fontSize: 28, fontWeight: 700 }}>{g.giftCount}</div></div>}
            </div>
            {g.firstGiftDate && <div style={{ ...S.muted, marginBottom: 14 }}>Giving with {theme.displayName} since {String(g.firstGiftDate).slice(0, 4)}.</div>}
          </div>
          {(g.byYear || []).length > 0 && (
            <div className="pt-mygiving-bars"><YearBars byYear={g.byYear} gifts={me.gifts || []} /></div>
          )}
        </div>
      </div>

      {/* Secondary cluster — arranged (2-up grid at >=1280px via pt-cluster),
          not stacked; each card renders exactly as before below that. */}
      <div className="pt-cluster">
      {(me.recurring || []).length > 0 && (
        <div id="recurring" style={{ ...S.card, scrollMarginTop: 16 }}>
          <h2 style={S.h2}>Recurring giving</h2>
          {me.recurring.map(sub => <RecurringCard key={sub.id} slug={slug} sub={sub} theme={theme} onChanged={reload} />)}
        </div>
      )}
      {includeGiveCta && theme.giveSlug && (
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
        <div id="receipts" style={{ ...S.card, scrollMarginTop: 16 }}>
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
      </div>
    </>
  );
}

function Dashboard({ slug, me, reload, page }) {
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
  return (
    <>
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

      {/* BUILD-54 §2 — thank-you state: the donor's recent campaign gift with
          the org's OWN words about what that campaign is doing. Renders only
          when the org authored content — never generated, never filler. */}
      {me.thankYou && (
        <div style={{ ...S.card, borderLeft: "4px solid var(--pt-accent)" }}>
          <h2 style={S.h2}>Thank you</h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, margin: 0 }}>
            Your {fmtFull(me.thankYou.amount)} gift supports <strong>{me.thankYou.campaignName}</strong>.
          </p>
          <p style={{ ...S.muted, marginTop: 8, marginBottom: 0 }}>{me.thankYou.description}</p>
        </div>
      )}

      {/* BUILD-54 §4 — a PUBLISHED page replaces the fixed layout below.
          The org arranges the widgets; the donor's own data renders only
          through the My Giving widget (same MyGivingSection). The legacy
          fixed layout is byte-identical for orgs with no published page. */}
      {page ? (
        <PageRenderer page={page} ctx={{
          giveSlug: page.giveSlug || theme.giveSlug, me,
          renderMyGiving: () => <MyGivingSection slug={slug} me={me} reload={reload} theme={theme} includeGiveCta={false} />,
        }} />
      ) : (
      <>
      <MyGivingSection slug={slug} me={me} reload={reload} theme={theme} includeGiveCta={true} />

      {/* BUILD-54 §2 — campaign spotlights: what the campaigns this donor gave
          to are doing, in the org's own words. A campaign with no authored
          content never appears (its name still labels the gift rows above).
          2026-08-15 wide-width pass: 2-up at >=1280px when 2+ exist. */}
      <div className={(me.campaigns || []).length >= 2 ? "pt-campaigns" : undefined}>
      {(me.campaigns || []).map(c => (
        <div key={c.id} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          {c.heroImage && (
            <div style={{ maxHeight: 220, overflow: "hidden" }}>
              <img src={resolveAssetUrl(c.heroImage)} alt="" style={{ width: "100%", display: "block", objectFit: "cover" }} />
            </div>
          )}
          <div style={{ padding: "20px 22px" }}>
            <h2 style={{ ...S.h2, marginBottom: 6 }}>{c.name}</h2>
            {c.description && <p style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 8px", color: "#3a3a35" }}>{c.description}</p>}
            <StoryBlocks blocks={c.story} />
            {c.goal && c.goal.amount > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700 }}>{fmtFull(c.goal.raised)} raised</span>
                  <span style={S.muted}>of {fmtFull(c.goal.amount)}{c.goal.percent != null ? ` · ${c.goal.percent}%` : ""}</span>
                </div>
                <div style={{ height: 10, background: "#efece5", borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ width: `${Math.max(2, Math.min(100, c.goal.percent || 0))}%`, height: "100%", background: "var(--pt-primary)" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
      </div>

      {(me.impact || []).length > 0 && (
        <div style={S.card}>
          <h2 style={S.h2}>What your giving made possible</h2>
          {/* 2026-08-15 wide-width pass: updates flow 2-up at >=1280px. */}
          <div className="pt-impactgrid">
          {me.impact.map(u => (
            <div key={u.id} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{u.title}</div>
              {(u.photos || []).length > 0 && (
                <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
                  {u.photos.map((p, i) => <img key={i} src={resolveAssetUrl(p)} alt="" style={{ maxWidth: 200, maxHeight: 140, borderRadius: 8, objectFit: "cover" }} />)}
                </div>
              )}
              {u.body && <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{u.body}</div>}
              <div style={{ ...S.muted, marginTop: 4, fontSize: 12 }}>{String(u.date).slice(0, 10)}</div>
            </div>
          ))}
          </div>
        </div>
      )}
      </>
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
  const [page, setPage] = useState(null);      // BUILD-54 §4 — published page
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
      setPage(r.body.page || null);
      try { sessionStorage.setItem("pt_theme_" + orgSlug, JSON.stringify(r.body.theme)); } catch { /* full/blocked storage is fine */ }
      if (!isVerify) await loadMe(); else setChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  if (notFound) return (
    <div style={S.page}><PortalStyles /><div className="pt-wrap" style={{ paddingTop: 80, textAlign: "center" }}>
      <p style={{ fontSize: 16 }}>This page isn't available.</p>
    </div></div>
  );
  if (!theme || !checked) {
    if (theme) return ( // themed shell while the session check runs — the org's page from the first paint
      <div style={{ ...S.page, ...varsFor(theme) }}>
        <PortalStyles />
        <PortalHeader theme={theme} />
        <div className="pt-wrap"><p style={S.muted}>Loading…</p></div>
      </div>
    );
    return <div style={S.page}><PortalStyles /><div className="pt-wrap" style={{ paddingTop: 80 }}><p style={S.muted}>Loading…</p></div></div>;
  }

  const vars = varsFor(theme);
  const signOut = async () => { await pfetch(`/${orgSlug}/logout`, { method: "POST", body: {} }); window.location.reload(); };
  return (
    <div style={{ ...S.page, ...vars }}>
      <PortalStyles />
      <PortalHeader theme={theme} />
      {!isVerify && me && !me.empty && <AccountBar me={me} onSignOut={signOut} />}
      <div className="pt-wrap">
        {isVerify
          ? <Verify slug={orgSlug} onVerified={loadMe} />
          : me && !me.empty
            ? <Dashboard slug={orgSlug} me={me} reload={loadMe} page={page} />
            : page
              ? <>
                  <PageRenderer page={page} ctx={{
                    giveSlug: page.giveSlug, me: null,
                    renderMyGiving: () => <RequestLink slug={orgSlug} theme={theme} />,
                  }} />
                  {!page.widgets.some(w => w.type === "mygiving") && <RequestLink slug={orgSlug} theme={theme} />}
                </>
              : <RequestLink slug={orgSlug} theme={theme} />}
        <PortalFooter theme={theme} />
      </div>
    </div>
  );
}
