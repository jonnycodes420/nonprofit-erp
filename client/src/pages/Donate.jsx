import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";
import { T, fmtMoney } from "./publicTheme";
import { resolvePairing, cardChrome, THEME_DEFAULTS } from "../lib/portalTheme";

// BUILD-60 — THE GIVING PAGE IS THE ORG'S PAGE.
// Every control, color, logo, type pairing, banner and name on this page comes
// from the org's own portal theme (org.theme, from the server's giveThemePayload
// — the SAME theme the donor portal already reads). Steward's mark, wordmark and
// brand emerald never appear: the org's logo (or a monogram in its
// own primary color) stands in for the old serif "S", and "Powered by Steward"
// is OFF unless the org opts in (theme.poweredBy). This is the one page where
// trust converts directly into money, so the white-label promise is absolute.

// Fallback ladders mirror the server (GIVE_ONETIME_DEFAULT / GIVE_MONTHLY_DEFAULT).
const ONETIME_FALLBACK = [25, 50, 100, 250, 500];
const MONTHLY_FALLBACK = [10, 25, 50, 100, 250];

// BUILD-61 Part 4 — the portal-session API base (first-party via the vercel.json
// /portal-api proxy in prod; direct in dev). ONLY used to read a SIGNED-IN
// donor's own existing arrangement — the anonymous give page never touches it,
// so it can never reveal that an email is a donor.
const PORTAL_BASE = import.meta.env.VITE_PORTAL_API
  || (import.meta.env.PROD ? "/portal-api" : (import.meta.env.VITE_API_URL || "http://localhost:3001") + "/portal");

// The pre-selected tier of the active ladder. The spec's "middle tier — $50
// one-time, $25 monthly" lands on the SECOND tier of the default 5-item
// ladders (index 1), so that is the low-friction default we honor, re-selected
// whenever the frequency (and therefore the ladder) changes. See BUILD-60 notes.
function defaultTierIndex(ladder) {
  return ladder.length > 1 ? 1 : 0;
}

function fmtAmt(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v % 1 === 0 ? "$" + v.toLocaleString() : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Donor-covers-fees display math — MUST mirror coverFeesGrossUpCents in
// server.js (2.9% + 30¢ standard card rate). Display only: the server
// re-derives the charged amount from the base + boolean and never trusts
// a client-computed total.
function grossUpCents(baseCents) {
  return Math.ceil((baseCents + 30) / (1 - 0.029));
}

// Resolve the org's theme into concrete colors/fonts. Called with org?.theme,
// which is null on the loading/error screens (before the org loads) — every
// value then falls back to the DESIGNED NEUTRAL default (THEME_DEFAULTS), never
// a Steward brand color.
function resolveTheme(theme) {
  const t = theme || {};
  const primary = t.primary || THEME_DEFAULTS.primary;
  const primaryFg = t.primaryFg || THEME_DEFAULTS.primaryFg;
  const pairing = resolvePairing(t.typePairing);
  return {
    primary,
    primaryFg,
    button: t.buttonColor || primary, // interactive controls (selected tiers, submit, CTAs)
    buttonFg: t.buttonFg || primaryFg,
    accent: t.accent || THEME_DEFAULTS.accent,
    accentFg: t.accentFg || THEME_DEFAULTS.accentFg,
    serif: pairing.serif,
    sans: pairing.sans,
    pageBg: t.backgroundTint || T.bg,
    cardStyle: t.cardStyle || "rounded",
    displayName: t.displayName || null,
    logo: t.logo || null,
    headerImage: t.headerImage || null,
    headerFocal: t.headerFocal || { x: 0.5, y: 0.5 },
    footerText: t.footerText || null,
    poweredBy: t.poweredBy === true,
    onetimeAmounts: Array.isArray(t.onetimeAmounts) && t.onetimeAmounts.length ? t.onetimeAmounts : ONETIME_FALLBACK,
    monthlyAmounts: Array.isArray(t.monthlyAmounts) && t.monthlyAmounts.length ? t.monthlyAmounts : MONTHLY_FALLBACK,
  };
}

const baseInp = {
  width: "100%", boxSizing: "border-box",
  background: T.bg, border: "1px solid " + T.bg3,
  borderRadius: 10, padding: "11px 14px",
  color: T.ink, fontSize: 14, outline: "none", fontFamily: "inherit",
};

// A "Start your own fundraiser" modal, shown only on a parent Giving Page
// (never the org-wide page, never an existing personal fundraiser page —
// peer_fundraisers always belong to exactly one giving_pages row). Zero
// account setup by design: on success the supporter is redirected straight
// to their new live page, and a "manage your fundraiser" link is emailed
// as the entire auth model for editing it later (see ManageFundraiser.jsx).
function StartFundraiserModal({ orgSlug, pageSlug, th, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", email: "", personalGoalAmount: "", story: "", imageUrl: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const inp = { ...baseInp };

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) { setErr("Please enter your name and email."); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch(`${API}/org/${orgSlug}/giving-page/${pageSlug}/fundraisers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not start your fundraiser.");
      onCreated(d);
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} style={{ background: T.white, borderRadius: 18, padding: "26px 24px", width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: th.serif }}>Start your own fundraiser</div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ink3, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 18, lineHeight: 1.5 }}>
          Get your own personal page to share with friends and family — no account needed.
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your name</div>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, marginBottom: 12 }} required />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your email</div>
        <div style={{ fontSize: 11, color: T.ink3, marginBottom: 4 }}>We'll send your "manage fundraiser" link here — keep it, there's no password.</div>
        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ ...inp, marginBottom: 12 }} required />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Personal goal ($, optional)</div>
        <input type="number" value={form.personalGoalAmount} onChange={e => setForm(f => ({ ...f, personalGoalAmount: e.target.value }))} placeholder="e.g. 500" style={{ ...inp, marginBottom: 12 }} />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your story (optional)</div>
        <textarea value={form.story} onChange={e => setForm(f => ({ ...f, story: e.target.value }))} rows={3} placeholder="Tell people why this cause matters to you." style={{ ...inp, resize: "vertical", marginBottom: 12 }} />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Photo URL (optional)</div>
        <input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" style={{ ...inp, marginBottom: 6 }} />

        {err && <div style={{ background: "#f6e3dd", border: "1px solid #eac6b8", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#8a3a24", marginTop: 10 }}>{err}</div>}

        <button type="submit" disabled={saving}
          style={{ width: "100%", marginTop: 14, background: saving ? T.bg3 : th.button, border: "none", borderRadius: 12, padding: "13px", color: saving ? T.ink3 : th.buttonFg, fontSize: 14, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Creating your page…" : "Create my fundraiser →"}
        </button>
      </form>
    </div>
  );
}

export default function Donate() {
  const { orgSlug, pageSlug, fundraiserSlug } = useParams();
  const [org, setOrg] = useState(null);
  const [givingPage, setGivingPage] = useState(null);
  const [peerFundraiser, setPeerFundraiser] = useState(null);
  const [peerFundraisersSummary, setPeerFundraisersSummary] = useState(null);
  const [funds, setFunds] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [donated, setDonated] = useState(false);
  const [cardUpdated, setCardUpdated] = useState(false);
  const [showStartFundraiser, setShowStartFundraiser] = useState(false);
  const [justCreatedEmailSent, setJustCreatedEmailSent] = useState(null);

  // BUILD-60 Part 2 — RECURRING IS THE HERO. Frequency comes first and Monthly
  // is pre-selected; the amount ladder is per-frequency; the second tier of the
  // active ladder is pre-selected; switching frequency re-selects the second
  // tier of the NEW ladder (never carries an amount across).
  const [frequency, setFrequency] = useState("monthly");
  const [reconnectToken, setReconnectToken] = useState(null);   // BUILD-77 Part 6 — stitches the new subscription to the imported donor
  const [preset, setPreset] = useState(null);   // the selected ladder amount (null until org loads)
  const [customAmt, setCustomAmt] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [fundId, setFundId] = useState("");
  const [coverFees, setCoverFees] = useState(false); // always opt-in, never pre-checked
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [returning, setReturning] = useState(false); // signed-in donor prefill applied

  const th = resolveTheme(org?.theme);
  const activeLadder = frequency === "monthly" ? th.monthlyAmounts : th.onetimeAmounts;

  const basePath = fundraiserSlug ? `/give/${orgSlug}/${pageSlug}/${fundraiserSlug}`
    : pageSlug ? `/give/${orgSlug}/${pageSlug}`
    : `/give/${orgSlug}`;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("donated") === "true") {
      setDonated(true);
      window.history.replaceState({}, "", basePath);
    }
    if (params.get("card_updated") === "true") {
      setCardUpdated(true);
      window.history.replaceState({}, "", basePath);
    }
    if (params.get("fundraiser_created") === "true") {
      setJustCreatedEmailSent(params.get("email_sent") === "true");
      window.history.replaceState({}, "", basePath);
    }
    // BUILD-77 Part 6 — the reconnect link: an imported sustainer arriving
    // from the reconnect email lands with their historical amount and
    // frequency prefilled, and the signed token rides the checkout so the
    // new subscription stitches to their EXISTING record (26 months of
    // history stays attached; lifetime value does not reset).
    const rq = params.get("reconnect");
    if (rq) {
      setReconnectToken(rq);
      const rAmt = parseFloat(params.get("amount"));
      const rFreq = params.get("frequency") === "annual" ? "annual" : "monthly";
      setFrequency(rFreq);
      if (rAmt > 0) { setIsCustom(true); setCustomAmt(String(rAmt)); setPreset(null); }
    }
    const url = fundraiserSlug
      ? `${API}/org/${orgSlug}/giving-page/${pageSlug}/fundraiser/${fundraiserSlug}/public`
      : pageSlug
        ? `${API}/org/${orgSlug}/giving-page/${pageSlug}/public`
        : `${API}/org/${orgSlug}/public`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setPageError(d.error); }
        else {
          setOrg(d.org);
          setFunds(d.funds || []);
          // Pre-select the second tier of the active (monthly) ladder now that
          // the org's ladders are known.
          const ladder = (d.org?.theme?.monthlyAmounts && d.org.theme.monthlyAmounts.length) ? d.org.theme.monthlyAmounts : MONTHLY_FALLBACK;
          setPreset(ladder[defaultTierIndex(ladder)]);
          if (d.givingPage) {
            setGivingPage(d.givingPage);
            if (d.givingPage.fundId) setFundId(d.givingPage.fundId);
          }
          // BUILD-55 — ?fund=<id> preselects a designation.
          const qFund = params.get("fund");
          if (qFund && !d.givingPage?.fundId && (d.funds || []).some(f => f.id === qFund)) setFundId(qFund);
          if (d.peerFundraiser) setPeerFundraiser(d.peerFundraiser);
          if (d.peerFundraisers) setPeerFundraisersSummary(d.peerFundraisers);
        }
        setPageLoading(false);
      })
      .catch(() => { setPageError("Could not load this donation page."); setPageLoading(false); });
  }, [orgSlug, pageSlug, fundraiserSlug]);

  // BUILD-61 Part 4 — a SIGNED-IN returning donor defaults to their existing
  // arrangement. Identity is established by the portal session (first-party
  // cookie via the /portal-api proxy); this is a donor reading THEIR OWN
  // history. Anonymous visitors get 401 here → no change, so the public page
  // is byte-identical whether or not the email behind it has ever given.
  useEffect(() => {
    if (!org || pageSlug) return; // org-wide give page only
    let cancelled = false;
    fetch(`${PORTAL_BASE}/${orgSlug}/give-default`, { credentials: "include", headers: { "Content-Type": "application/json" } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d || !d.arrangement) return;
        const { frequency: f, amount } = d.arrangement;
        const ladder = f === "monthly" ? (org.theme?.monthlyAmounts || MONTHLY_FALLBACK) : (org.theme?.onetimeAmounts || ONETIME_FALLBACK);
        setFrequency(f);
        if (ladder.includes(amount)) { setPreset(amount); setIsCustom(false); setCustomAmt(""); }
        else { setIsCustom(true); setCustomAmt(String(amount)); setPreset(null); }
        setReturning(true);
      })
      .catch(() => { /* anonymous / no proxy — ignore */ });
    return () => { cancelled = true; };
  }, [org, orgSlug, pageSlug]);

  // Frequency switch: re-select the second tier of the NEW ladder (never carry
  // the old amount across — a $250 one-time gift is a very different monthly ask).
  function switchFrequency(f) {
    const ladder = f === "monthly" ? th.monthlyAmounts : th.onetimeAmounts;
    setFrequency(f);
    setPreset(ladder[defaultTierIndex(ladder)]);
    setIsCustom(false);
    setCustomAmt("");
  }

  const effectiveAmount = isCustom ? parseFloat(customAmt) || 0 : (preset || 0);
  const baseCents = Math.round(effectiveAmount * 100);
  const feeCents = baseCents >= 100 ? grossUpCents(baseCents) - baseCents : 0;
  const showCoverFees = org?.coverFeesEnabled && baseCents >= 100;
  const chargedAmount = showCoverFees && coverFees ? (baseCents + feeCents) / 100 : effectiveAmount;

  const isRecurring = frequency !== "one-time";
  const perLabel = frequency === "monthly" ? "every month" : "every year";
  const annualTotal = frequency === "monthly" ? chargedAmount * 12 : chargedAmount;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setSubmitErr("Please fill in your name and email."); return;
    }
    if (effectiveAmount < 1) { setSubmitErr("Please enter a valid amount."); return; }
    setSubmitting(true); setSubmitErr("");
    try {
      const r = await fetch(`${API}/donate/${orgSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: effectiveAmount, fundId, frequency, firstName, lastName, email,
          reconnectToken: reconnectToken || undefined,
          givingPageId: givingPage?.id, peerFundraiserId: peerFundraiser?.id,
          coverFees: showCoverFees && coverFees,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Something went wrong.");
      window.location.href = data.url;
    } catch (e) {
      setSubmitErr(e.message);
      setSubmitting(false);
    }
  };

  const isEmbed = window.self !== window.top;

  const BASE = {
    minHeight: "100vh", background: th.pageBg,
    fontFamily: th.sans,
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: isEmbed ? "20px 16px 40px" : "40px 16px 80px",
  };

  // One card chrome from the org's card-style key (rounded/square/soft-shadow).
  const card = { background: T.white, ...cardChrome(th.cardStyle, T.bg3), padding: "22px 24px" };
  const inp = { ...baseInp, fontFamily: th.sans };

  const monogram = (th.displayName || org?.name || "?").trim().charAt(0).toUpperCase();

  if (pageLoading) return (
    <div style={{ ...BASE, justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 32, height: 32, border: "3px solid " + T.bg3, borderTopColor: th.primary, borderRadius: "50%", animation: "sp 0.7s linear infinite" }} />
    </div>
  );

  if (pageError) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ fontSize: 16, fontWeight: 700, color: "#8a3a24", marginBottom: 8 }}>Page not found</div>
      <div style={{ fontSize: 13, color: T.ink3 }}>{pageError}</div>
    </div>
  );

  if (donated) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 64, height: 64, background: th.primary, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 28, color: th.primaryFg }}>✓</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.ink, marginBottom: 10, fontFamily: th.serif }}>
        Thank you!
      </div>
      <div style={{ fontSize: 16, color: T.ink2, marginBottom: 6 }}>
        Your gift to <strong>{org.name}</strong> has been received.
      </div>
      <div style={{ fontSize: 14, color: T.ink3, maxWidth: 360, lineHeight: 1.6 }}>
        A receipt will be sent to your email. Thank you for your generosity — it makes a real difference.
      </div>
      {org.givingAccount && (
        <div style={{ marginTop: 28, padding: "16px 22px", background: T.white, border: `1px solid ${T.bg2}`, borderRadius: 12, maxWidth: 400 }}>
          <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>
            Want your giving history, receipts, and recurring gifts in one place — for
            every organization you support?
          </div>
          <a href={`/giving#signup&from=${org.slug}`}
            style={{ display: "inline-block", marginTop: 10, background: th.accent, color: th.accentFg, textDecoration: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>
            Create your free giving account
          </a>
        </div>
      )}
    </div>
  );

  if (cardUpdated) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 64, height: 64, background: th.primary, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 28, color: th.primaryFg }}>✓</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.ink, marginBottom: 10, fontFamily: th.serif }}>
        Card updated — thank you!
      </div>
      <div style={{ fontSize: 14, color: T.ink3, maxWidth: 360, lineHeight: 1.6 }}>
        Your recurring gift to <strong>{org.name}</strong> will continue as scheduled. We're grateful for your ongoing support.
      </div>
    </div>
  );

  // A ladder button (per-frequency).
  const ladderBtn = (amt, selected, onClick) => (
    <button key={amt} type="button" onClick={onClick}
      style={{
        background: selected ? th.button : T.bg,
        border: `1.5px solid ${selected ? th.button : T.bg3}`,
        borderRadius: 10, padding: "12px 4px",
        color: selected ? th.buttonFg : T.ink2,
        fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.12s",
      }}>
      ${amt.toLocaleString()}{frequency === "monthly" ? <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>/mo</span> : ""}
    </button>
  );

  return (
    <div style={BASE}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>

      {showStartFundraiser && (
        <StartFundraiserModal
          orgSlug={orgSlug} pageSlug={pageSlug} th={th}
          onClose={() => setShowStartFundraiser(false)}
          onCreated={d => { window.location.href = `${d.publicUrl}?fundraiser_created=true&email_sent=${d.emailSent}`; }}
        />
      )}

      {/* Header — hidden when embedded in an iframe. Three variants: a peer
          fundraiser's own personal page, a parent Giving Page, or the generic
          org-wide page — in that priority order. All carry the org's identity. */}
      {!isEmbed && (
        peerFundraiser ? (
          <div style={{ width: "100%", maxWidth: 480, marginBottom: 28 }}>
            {justCreatedEmailSent !== null && (
              justCreatedEmailSent ? (
                <div style={{ background: th.primary + "10", border: "1px solid " + th.primary + "30", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: T.ink2, marginBottom: 14 }}>
                  Your fundraiser is live! Check your email for a link to manage it later — bookmark it, there's no password.
                </div>
              ) : (
                <div style={{ background: "#f6e3dd", border: "1px solid #eac6b8", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: "#8a3a24", marginBottom: 14 }}>
                  Your fundraiser is live! We couldn't send your management email though — contact {org.name} directly if you need to update your page later.
                </div>
              )
            )}
            {givingPage && (
              <a href={`/give/${orgSlug}/${pageSlug}`} style={{ display: "inline-block", fontSize: 12, fontWeight: 700, color: th.primary, textDecoration: "none", marginBottom: 10 }}>
                ← Part of {givingPage.title}
              </a>
            )}
            {peerFundraiser.imageUrl && (
              <img src={peerFundraiser.imageUrl} alt={peerFundraiser.name}
                style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 16, marginBottom: 20, display: "block" }}
                onError={e => { e.target.style.display = "none"; }}
              />
            )}
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Fundraising for {org.name}</div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: th.serif, letterSpacing: "-0.02em" }}>
                {peerFundraiser.name}'s Fundraiser
              </h1>
              {peerFundraiser.story && (
                <p style={{ margin: "10px 0 0", fontSize: 14, color: T.ink2, lineHeight: 1.65, textAlign: "left" }}>{peerFundraiser.story}</p>
              )}
            </div>
            <div style={{ ...card, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: th.primary, fontFamily: th.serif }}>{fmtMoney(peerFundraiser.raisedAmount)}</div>
                {peerFundraiser.personalGoalAmount > 0 && <div style={{ fontSize: 13, color: T.ink3 }}>of {fmtMoney(peerFundraiser.personalGoalAmount)} goal</div>}
              </div>
              {peerFundraiser.personalGoalAmount > 0 && (
                <div style={{ background: T.bg, borderRadius: 99, height: 10, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(100, Math.round((peerFundraiser.raisedAmount / peerFundraiser.personalGoalAmount) * 100))}%`,
                    background: th.primary, borderRadius: 99, transition: "width 0.6s ease",
                  }} />
                </div>
              )}
            </div>
          </div>
        ) : givingPage ? (
          <div style={{ width: "100%", maxWidth: 480, marginBottom: 28 }}>
            {givingPage.imageUrl && (
              <img src={givingPage.imageUrl} alt={givingPage.title}
                style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 16, marginBottom: 20, display: "block" }}
                onError={e => { e.target.style.display = "none"; }}
              />
            )}
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{org.name}</div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: th.serif, letterSpacing: "-0.02em" }}>
                {givingPage.title}
              </h1>
              {givingPage.story && (
                <p style={{ margin: "10px 0 0", fontSize: 14, color: T.ink2, lineHeight: 1.65, textAlign: "left" }}>{givingPage.story}</p>
              )}
            </div>
            {(() => {
              const linked = !!givingPage.campaignId;
              const shownRaised = linked && givingPage.campaignRaised != null ? givingPage.campaignRaised : givingPage.raisedAmount;
              const shownGoal = linked ? givingPage.campaignGoal : givingPage.goalAmount;
              return (
                <div style={{ ...card, padding: "18px 22px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: th.primary, fontFamily: th.serif }}>{fmtMoney(shownRaised)}</div>
                    {shownGoal > 0 && <div style={{ fontSize: 13, color: T.ink3 }}>of {fmtMoney(shownGoal)} goal</div>}
                  </div>
                  {shownGoal > 0 && (
                    <div style={{ background: T.bg, borderRadius: 99, height: 10, overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${Math.min(100, Math.round((shownRaised / shownGoal) * 100))}%`,
                        background: th.primary, borderRadius: 99, transition: "width 0.6s ease",
                      }} />
                    </div>
                  )}
                  {linked && givingPage.campaignName && (
                    <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>Gifts here count toward <strong style={{ color: T.ink2 }}>{givingPage.campaignName}</strong>.</div>
                  )}
                </div>
              );
            })()}

            <div style={{ background: th.primary + "10", border: "1px solid " + th.primary + "30", borderRadius: 16, padding: "16px 20px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
                Want to help more? <strong>Start your own fundraiser</strong> and share it with your own network.
              </div>
              <button onClick={() => setShowStartFundraiser(true)}
                style={{ background: th.button, border: "none", borderRadius: 10, padding: "9px 16px", color: th.buttonFg, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                Start fundraising →
              </button>
            </div>

            {peerFundraisersSummary && peerFundraisersSummary.count > 0 && (
              <div style={{ ...card, padding: "18px 22px", marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                  {peerFundraisersSummary.count} Fundraiser{peerFundraisersSummary.count !== 1 ? "s" : ""} Raising For This
                </div>
                {peerFundraisersSummary.leaderboard.map((f, i) => (
                  <a key={f.id} href={`/give/${orgSlug}/${pageSlug}/${f.slug}`}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i > 0 ? "1px solid " + T.bg3 : "none", textDecoration: "none" }}>
                    <div style={{ width: 22, fontSize: 12, fontWeight: 800, color: i < 3 ? th.accent : T.ink3, flexShrink: 0 }}>#{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: th.primary, flexShrink: 0 }}>{fmtMoney(f.raisedAmount)}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Org-wide page identity. There is ALWAYS a designed identity band —
          // the org's banner (with its focal point), or, on day one when an org
          // has no logo and no photo (the most common state, and the one seen
          // least), a SOLID COLOR BAND carrying an intentional serif monogram.
          // Never an empty header, a grey box, a placeholder photo, or generated
          // art (standing rule) — the unthemed default must read as chosen.
          <div style={{ width: "100%", maxWidth: 480, marginBottom: 32 }}>
            {th.headerImage ? (
              // (a) real banner photo → image band, then a small identity chip.
              <>
                <img src={th.headerImage} alt={th.displayName || org.name}
                  style={{ width: "100%", height: "min(30vh, 220px)", objectFit: "cover", objectPosition: `${th.headerFocal.x * 100}% ${th.headerFocal.y * 100}%`, borderRadius: 16, marginBottom: 18, display: "block" }}
                  onError={e => { e.target.style.display = "none"; }}
                />
                <div style={{ textAlign: "center" }}>
                  {th.logo ? (
                    <img src={th.logo} alt={th.displayName || org.name}
                      style={{ maxHeight: 52, maxWidth: 220, objectFit: "contain", margin: "0 auto 14px", display: "block" }}
                      onError={e => { e.target.style.display = "none"; }} />
                  ) : (
                    <div style={{ width: 46, height: 46, background: th.primary, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                      <span style={{ fontFamily: th.serif, fontSize: 24, fontWeight: 700, color: th.primaryFg, lineHeight: 1 }}>{monogram}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              // (b) the designed neutral: a solid identity band in the org's own
              // color carries a logo, or a large serif monogram in a soft ring.
              <div style={{ width: "100%", height: 156, borderRadius: 18, background: th.primary, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22, boxShadow: "inset 0 -40px 60px -40px rgba(0,0,0,0.28)" }}>
                {th.logo ? (
                  <img src={th.logo} alt={th.displayName || org.name}
                    style={{ maxHeight: 72, maxWidth: 260, objectFit: "contain", display: "block" }}
                    onError={e => { e.target.style.display = "none"; }} />
                ) : (
                  <div style={{ width: 84, height: 84, borderRadius: 22, border: `2px solid ${th.primaryFg}59`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: th.serif, fontSize: 44, fontWeight: 700, color: th.primaryFg, lineHeight: 1 }}>{monogram}</span>
                  </div>
                )}
              </div>
            )}
            <div style={{ textAlign: "center" }}>
              <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, color: T.ink, fontFamily: th.serif, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                Give to {org.name}
              </h1>
              {org.mission && (
                <p style={{ margin: "10px auto 0", fontSize: 14.5, color: T.ink3, maxWidth: 400, lineHeight: 1.65 }}>{org.mission}</p>
              )}
            </div>
          </div>
        )
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Frequency — FIRST, above the amount. Monthly is pre-selected. */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>How often</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[["monthly", "Monthly"], ["one-time", "One-time"], ["annual", "Annual"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => switchFrequency(v)}
                style={{
                  position: "relative",
                  background: frequency === v ? th.button : T.bg,
                  border: `1.5px solid ${frequency === v ? th.button : T.bg3}`,
                  borderRadius: 10, padding: "13px 8px",
                  color: frequency === v ? th.buttonFg : T.ink2,
                  fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.12s",
                }}>
                {l}
              </button>
            ))}
          </div>
          {returning ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.ink2, lineHeight: 1.5 }}>
              Welcome back — we've set this to your current gift to {org.name}. Change anything you like.
            </div>
          ) : frequency === "monthly" && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.ink2, lineHeight: 1.5 }}>
              Monthly giving is the steadiest way to support {org.name} — and you can change or stop it anytime.
            </div>
          )}
        </div>

        {/* Amount — the per-frequency ladder, second tier pre-selected. */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            {frequency === "monthly" ? "Monthly amount" : frequency === "annual" ? "Annual amount" : "Donation amount"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(activeLadder.length, 5)}, 1fr)`, gap: 8, marginBottom: 12 }}>
            {activeLadder.map(p => ladderBtn(p, !isCustom && preset === p, () => { setPreset(p); setIsCustom(false); setCustomAmt(""); }))}
          </div>
          <input
            type="number" placeholder={frequency === "monthly" ? "Custom monthly amount ($)" : "Custom amount ($)"}
            value={customAmt}
            onChange={e => { setCustomAmt(e.target.value); setIsCustom(true); }}
            onFocus={() => setIsCustom(true)}
            style={{ ...inp, border: `1.5px solid ${isCustom ? th.button : T.bg3}`, fontWeight: 700, fontSize: 16 }}
            min="1" step="1"
          />
        </div>

        {/* Donor-covers-fees — optional, always unchecked by default. */}
        {showCoverFees && (
          <label style={{ ...card, padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={coverFees} onChange={e => setCoverFees(e.target.checked)}
              style={{ marginTop: 3, width: 16, height: 16, accentColor: th.primary, cursor: "pointer", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
              Add <strong>${(feeCents / 100).toFixed(2)}</strong> to help cover card-processing costs
              {isRecurring ? ` on each ${frequency === "monthly" ? "monthly" : "annual"} gift` : ""},
              so {org.name} receives your full ${effectiveAmount.toFixed(2)}.
            </span>
          </label>
        )}

        {/* Fund selector — hidden when the page already designates a fund. */}
        {funds.length > 0 && !givingPage?.fundId && (
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Designate My Gift (optional)</div>
            <select value={fundId} onChange={e => setFundId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Where it's needed most</option>
              {funds.map(f => (
                <option key={f.id} value={f.id}>{f.name}{f.restricted ? " (Restricted)" : ""}</option>
              ))}
            </select>
          </div>
        )}

        {/* Contact info */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Your Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <input placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} style={inp} required />
            <input placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} style={inp} required />
          </div>
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} style={inp} required />
        </div>

        {submitErr && (
          <div style={{ background: "#f6e3dd", border: "1px solid #eac6b8", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#8a3a24" }}>{submitErr}</div>
        )}

        {/* Submit — the button STATES the commitment in full. */}
        <button type="submit" disabled={submitting}
          style={{
            background: submitting ? T.bg3 : th.button,
            border: "none", borderRadius: 14, padding: "16px",
            color: submitting ? T.ink3 : th.buttonFg, fontSize: 16, fontWeight: 800,
            cursor: submitting ? "not-allowed" : "pointer",
            letterSpacing: "-0.01em", transition: "background 0.15s",
          }}>
          {submitting
            ? "Redirecting to Stripe…"
            : effectiveAmount > 0
              ? (isRecurring ? `Give ${fmtAmt(chargedAmount)} ${perLabel}` : `Give ${fmtAmt(chargedAmount)}`)
              : "Enter an amount"}
        </button>

        {/* The recurring disclosure — immediately adjacent to the button, in
            body text a donor actually reads. Nothing about the recurring
            nature is smaller, lighter, or lower-contrast than the amount. */}
        {isRecurring && effectiveAmount > 0 && (
          <div style={{ fontSize: 14, color: T.ink2, lineHeight: 1.6, textAlign: "center", marginTop: -6 }}>
            {frequency === "monthly"
              ? <><strong>{fmtAmt(chargedAmount)} every month until you cancel — {fmtAmt(annualTotal)} a year.</strong> Cancel anytime from your donor account.</>
              : <><strong>{fmtAmt(chargedAmount)} every year until you cancel.</strong> Cancel anytime from your donor account.</>}
          </div>
        )}

        <div style={{ textAlign: "center", fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
          {th.footerText ? <>{th.footerText}<br /></> : null}
          Payments are processed securely by Stripe. {org.name} never stores your card details.
          {th.poweredBy && <><br />Powered by Steward</>}
        </div>
      </form>
    </div>
  );
}
