import { useState, useEffect, useMemo } from "react";
// GIVE-2 §5 — the one place the gross-up arithmetic lives, shared with the
// server (`routes/give.js` reads the same module for the charge).
import * as RATES from "../../../shared/processingRates.js";
import { useParams } from "react-router-dom";
import { API } from "../api";
import { T, fmtMoney } from "./publicTheme";
import { resolvePairing, cardChrome, THEME_DEFAULTS } from "../lib/portalTheme";
import { errorMessage } from "../lib/domainError";
// BUILD-95 §5B — the ONE widget renderer, shared with the portal.
import { PageRenderer } from "../components/PortalWidgets";
// BUILD-102 (Steward Give) Part 2 — the three-step form, rendered ONLY for a
// giving page whose form somebody configured. An unconfigured page renders
// byte-for-byte what it always did (the BUILD-95 §5B rule), which is what makes
// this safe to ship to every org that already has giving pages.
import GiveSteps from "./GiveSteps";
import { thankYouText } from "../../../shared/formConfig.js";
// BUILD-102 Part 6 — which side of an A/B this visitor is on, decided before the
// page's own fetch so the server can serve the right variant in one round trip.
import { assignVariant, currentVariant } from "../lib/abVariant";
import { displayDate } from "../../../shared/displayDate";

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

// `en-US`, NAMED — EVENTS-2's rule. `toLocaleString(undefined, …)` flips the
// separator in half of Europe, and `$25.000` beside a dollar sign reads as
// twenty-five dollars on the one page where that matters most.
function fmtAmt(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const whole = v % 1 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(v);
}

// ── GIVE-2 §5 — THE DISPLAY MATH IS THE ORG'S RATE NOW ────────────────────
// This was a hand-copied mirror of two constants in server.js, which is how it
// came to be wrong for every org not on Stripe's published card rate: an org on
// the nonprofit rate pays 2.2% and this page asked the donor to cover 2.9%.
//
// The arithmetic now comes from `shared/processingRates.js`, the same module the
// server grosses up with, and the RATE comes off the public payload
// (`org.feeRate`). Still display only: the server re-derives the charge from the
// base amount and the boolean, and never trusts a total a client computed.
// A payload without a rate falls back to the published default, which is what
// this function always used.
function grossUpWith(feeRate) {
  const rate = feeRate && Number.isFinite(Number(feeRate.pct)) ? feeRate : RATES.DEFAULT_RATES.card;
  return baseCents => RATES.grossUpCents(baseCents, rate);
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
  // BUILD-103 Part 1 — JOIN A TEAM, OR START ONE. One screen: the teams on
  // this campaign come back from a public read, and "on my own" is the first
  // option because most people are.
  const [teams, setTeams] = useState([]);
  const [teamChoice, setTeamChoice] = useState("");     // "" solo · id · "new"
  const [newTeam, setNewTeam] = useState({ name: "", goalAmount: "" });
  useEffect(() => {
    fetch(`${API}/org/${orgSlug}/giving-page/${pageSlug}/teams`)
      .then(r => r.ok ? r.json() : { teams: [] })
      .then(d => setTeams(d.teams || []))
      .catch(() => setTeams([]));
  }, [orgSlug, pageSlug]);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) { setErr("Please enter your name and email."); return; }
    setSaving(true); setErr("");
    try {
      const body = { ...form };
      if (teamChoice === "new") { body.teamName = newTeam.name; body.teamGoalAmount = newTeam.goalAmount; }
      else if (teamChoice) body.teamId = teamChoice;
      const r = await fetch(`${API}/org/${orgSlug}/giving-page/${pageSlug}/fundraisers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not start your fundraiser.");
      onCreated(d);
    } catch (e) {
      setErr(errorMessage(e));
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
          Get your own personal page to share with friends and family. No account needed.
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your name</div>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, marginBottom: 12 }} required />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your email</div>
        <div style={{ fontSize: 11, color: T.ink3, marginBottom: 4 }}>We'll send your "manage fundraiser" link here — keep it, there's no password.</div>
        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ ...inp, marginBottom: 12 }} required />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>A team (optional)</div>
        <select value={teamChoice} onChange={e => setTeamChoice(e.target.value)} style={{ ...inp, marginBottom: teamChoice === "new" ? 8 : 12 }}>
          <option value="">On my own</option>
          {teams.map(t => <option key={t.id} value={t.id}>Join {t.name}</option>)}
          <option value="new">Start a new team…</option>
        </select>
        {teamChoice === "new" && <>
          <input value={newTeam.name} onChange={e => setNewTeam(t => ({ ...t, name: e.target.value }))} placeholder="Team name" style={{ ...inp, marginBottom: 8 }} />
          <input type="number" value={newTeam.goalAmount} onChange={e => setNewTeam(t => ({ ...t, goalAmount: e.target.value }))} placeholder="Team goal ($, optional)" style={{ ...inp, marginBottom: 12 }} />
        </>}

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Personal goal ($, optional)</div>
        <input type="number" value={form.personalGoalAmount} onChange={e => setForm(f => ({ ...f, personalGoalAmount: e.target.value }))} placeholder="e.g. 500" style={{ ...inp, marginBottom: 12 }} />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your story (optional)</div>
        <textarea value={form.story} onChange={e => setForm(f => ({ ...f, story: e.target.value }))} rows={3} placeholder="Tell people why this cause matters to you." style={{ ...inp, resize: "vertical", marginBottom: 12 }} />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Photo URL (optional)</div>
        <input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" style={{ ...inp, marginBottom: 6 }} />

        {err && <div style={{ background: T.terra100, border: "1px solid "+T.terra200, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: T.terra700, marginTop: 10 }}>{err}</div>}

        <button type="submit" disabled={saving}
          style={{ width: "100%", marginTop: 14, background: saving ? T.bg3 : th.button, border: "none", borderRadius: 12, padding: "13px", color: saving ? T.ink3 : th.buttonFg, fontSize: 14, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Creating your page…" : "Create my fundraiser →"}
        </button>
      </form>
    </div>
  );
}


// BUILD-98 (switch) Part 4 — TICKETS. `/give/:orgSlug?event=<id>`. The page
// sends a LEVEL and a QUANTITY; the server prices them, so what is charged is
// the level's price and nothing the page computed. The deductible part is
// stated before she pays, because a receipt that surprises somebody afterwards
// is a receipt that gets a phone call.
function TicketsPage({ orgSlug, eventId, th, BASE, card }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [levelId, setLevelId] = useState("");
  const [qty, setQty] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${API}/org/${orgSlug}/event/${encodeURIComponent(eventId)}/public`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("This event is not open for tickets.")))
      .then(d => { setData(d); const first = (d.levels || []).find(l => l.remaining !== 0); if (first) setLevelId(first.id); })
      .catch(e => setErr(errorMessage(e, "This event is not open for tickets.")));
  }, [orgSlug, eventId]);
  if (err) return <div style={BASE}><div style={{ ...card, padding: 28, color: T.ink }}>{err}</div></div>;
  if (!data) return <div style={BASE}><div style={{ color: T.ink3, fontSize: 14 }}>Loading…</div></div>;
  const lvl = (data.levels || []).find(l => l.id === levelId);
  const total = lvl ? lvl.price * qty : 0, deductible = lvl ? lvl.deductible * qty : 0;
  const buy = async e => {
    e.preventDefault();
    if (!lvl || !firstName.trim() || !lastName.trim() || !email.trim()) { setErr(""); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API}/donate/${orgSlug}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventLevelId: lvl.id, quantity: qty, firstName, lastName, email, frequency: "once" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong.");
      window.location.href = j.url;
    } catch (e2) { setErr(errorMessage(e2, "Something went wrong. Please try again.")); setBusy(false); }
  };
  const inp = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, color: T.ink, background: T.pureWhite };
  return (
    <div style={BASE}>
      <form onSubmit={buy} style={{ ...card, width: "100%", maxWidth: 520, padding: 28, display: "flex", flexDirection: "column", gap: 14 }} data-testid="tickets-page">
        <div style={{ fontSize: 13, color: T.ink3 }}>{data.orgName}</div>
        <div style={{ fontSize: 26, color: T.ink, fontFamily: th.serif }}>{data.event.name}</div>
        <div style={{ fontSize: 14, color: T.ink3 }}>{displayDate(data.event.date)||data.event.date}{data.event.location ? ` · ${data.event.location}` : ""}</div>
        {data.event.description && <div style={{ fontSize: 15, color: T.ink, lineHeight: 1.6 }}>{data.event.description}</div>}
        {(data.levels || []).map(l => (
          <label key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", border: `1px solid ${levelId === l.id ? th.primary : T.bg3}`, borderRadius: 10, padding: "10px 12px", cursor: l.remaining === 0 ? "not-allowed" : "pointer", opacity: l.remaining === 0 ? 0.5 : 1 }}>
            <input type="radio" name="level" checked={levelId === l.id} disabled={l.remaining === 0} onChange={() => setLevelId(l.id)} />
            <span style={{ flex: 1, fontSize: 15, color: T.ink }}>{l.name}</span>
            <span style={{ fontSize: 15, color: T.ink, fontWeight: 700 }}>{l.remaining === 0 ? "Sold out" : fmtMoney(l.price)}</span>
          </label>))}
        <label style={{ fontSize: 14, color: T.ink, display: "flex", gap: 8, alignItems: "center" }}>How many
          <input type="number" min={1} max={50} value={qty} onChange={e => setQty(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} style={{ ...inp, width: 80 }} /></label>
        {lvl && <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.6 }} data-testid="tickets-deductible">
          {fmtMoney(total)} in all. {lvl.deductible < lvl.price
            ? `${fmtMoney(total - deductible)} of that is the value of what you receive, so ${fmtMoney(deductible)} is tax-deductible.`
            : "All of it is tax-deductible."}
        </div>}
        <div style={{ display: "flex", gap: 10 }}>
          <input placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} style={inp} />
          <input placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} style={inp} />
        </div>
        <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} />
        <button type="submit" disabled={busy || !lvl} style={{ background: th.primary, color: th.onPrimary || T.pureWhite, border: "none", borderRadius: 10, padding: "13px", fontSize: 16, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "One moment…" : lvl ? `Buy ${qty === 1 ? "ticket" : qty + " tickets"}` : "Choose a ticket"}
        </button>
      </form>
    </div>
  );
}

// BUILD-101 Part 4 — MEMBERSHIP. `/give/:orgSlug?membership=<levelId>`. Like
// tickets: the page sends a LEVEL, the server prices it, and the deductible
// part is stated before she pays. A 12-month level may renew itself each
// year; that is her choice, said plainly, and cancelling is hers too.
function MembershipPage({ orgSlug, levelId, th, BASE, card }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${API}/org/${orgSlug}/membership/${encodeURIComponent(levelId)}/public`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("This membership is not available.")))
      .then(setData)
      .catch(e => setErr(errorMessage(e, "This membership is not available.")));
  }, [orgSlug, levelId]);
  if (err && !data) return <div style={BASE}><div style={{ ...card, padding: 28, color: T.ink }}>{err}</div></div>;
  if (!data) return <div style={BASE}><div style={{ color: T.ink3, fontSize: 14 }}>Loading…</div></div>;
  const l = data.level;
  const join = async e => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/donate/${orgSlug}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipLevelId: l.id, firstName, lastName, email, frequency: autoRenew ? "annual" : "once" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong.");
      window.location.href = j.url;
    } catch (e2) { setErr(errorMessage(e2, "Something went wrong. Please try again.")); setBusy(false); }
  };
  const inp = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, color: T.ink, background: T.pureWhite };
  return (
    <div style={BASE}>
      <form onSubmit={join} style={{ ...card, width: "100%", maxWidth: 520, padding: 28, display: "flex", flexDirection: "column", gap: 14 }} data-testid="membership-page">
        <div style={{ fontSize: 13, color: T.ink3 }}>{data.orgName}</div>
        <div style={{ fontSize: 26, color: T.ink, fontFamily: th.serif }}>{l.name} membership</div>
        <div style={{ fontSize: 15, color: T.ink }}>{fmtMoney(l.price)} · {l.termLabel}{l.scope === "household" ? " · for your household" : ""}</div>
        {l.benefits.length > 0 && <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15, color: T.ink, lineHeight: 1.6 }}>{l.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.6 }} data-testid="membership-deductible">
          {l.fmv > 0 ? `${fmtMoney(l.fmv)} of that is the value of what you receive, so ${fmtMoney(l.deductible)} is tax-deductible.` : "All of it is tax-deductible."}
        </div>
        {l.autoRenew && <label style={{ fontSize: 14, color: T.ink, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} />
          <span>Renew automatically each year at {fmtMoney(l.price)}. You can cancel any time.</span></label>}
        <div style={{ display: "flex", gap: 10 }}>
          <input placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} style={inp} />
          <input placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} style={inp} />
        </div>
        <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} />
        {err && <div role="status" style={{ fontSize: 14, color: T.ink }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ background: th.primary, color: th.onPrimary || T.pureWhite, border: "none", borderRadius: 10, padding: "13px", fontSize: 16, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "One moment…" : `Join for ${fmtMoney(l.price)}`}
        </button>
      </form>
    </div>
  );
}

export default function Donate() {
  const { orgSlug, pageSlug, fundraiserSlug } = useParams();
  // BUILD-98 (switch) Part 4 — ?event=<id> turns this page into its tickets.
  const ticketEventId = useMemo(() => new URLSearchParams(window.location.search).get("event"), []);
  // BUILD-101 Part 4 — ?membership=<levelId> turns this page into that level.
  const membershipLevelId = useMemo(() => new URLSearchParams(window.location.search).get("membership"), []);
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
  const [justCreatedDemoNote, setJustCreatedDemoNote] = useState("");
  // ── GIVE-2 §4 — EXPRESS GIVING ───────────────────────────────────────────
  // A donor arriving on `?express=<token>` has already saved a card with THIS
  // organisation and asked for a one-tap link. The token is consumed by a POST
  // (a GET may never change state, and a mail client follows every link it is
  // given), which hands back a twenty-minute claim and the donor's own ladder.
  const [express, setExpress] = useState(null);      // null = not an express visit
  const [expressErr, setExpressErr] = useState("");
  const [expressAmt, setExpressAmt] = useState(null);
  const [expressCover, setExpressCover] = useState(false);   // opt-in, never pre-ticked
  const [expressBusy, setExpressBusy] = useState(false);
  const [expressDone, setExpressDone] = useState("");
  // ── GIVE-2 §8 — the employers this organisation knows match, shown on the
  // page the gift just landed on. Public information (each company's own
  // published policy and its own form link): no donor, no gift, no amount.
  const [matchEmployers, setMatchEmployers] = useState(null);

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
  // BUILD-103 — a donor's own choice about their first name reaching the
  // fundraiser. Unticked by default, and the default IS the decision.
  const [showNameToFundraiser, setShowNameToFundraiser] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [returning, setReturning] = useState(false); // signed-in donor prefill applied

  const th = resolveTheme(org?.theme);

  // BUILD-95 §5B — the built giving page. ONE renderer, shared with the portal:
  // a widget that drew differently on the two surfaces would eventually show
  // two different numbers for the same fund.
  const formPosition = givingPage?.formPosition === "bottom" ? "bottom" : "top";
  // FIX-15 Part 6 — A CAMPAIGN PAGE LEADS WITH THE NUMBER. Its title, its goal
  // bar and a give button sit together at the top, above the fold at 1440 and
  // at 390, and the story follows. The page's first hero widget IS its title,
  // so it is drawn in that top block and not a second time below.
  const isCampaignPage = !!givingPage?.campaignId;
  const [heroWidgets, restWidgets] = useMemo(() => {
    const w = Array.isArray(givingPage?.page) ? givingPage.page : [];
    if (!isCampaignPage) return [[], w];
    const i = w.findIndex(x => x && x.type === "hero");
    return i < 0 ? [[], w] : [[w[i]], w.filter((_, k) => k !== i)];
  }, [givingPage, isCampaignPage]);
  const builtHero = useMemo(() => {
    if (!heroWidgets.length) return null;
    return (
      <div className="pt-page" style={{ width: "100%", marginBottom: 14 }}>
        <PageRenderer page={{ widgets: heroWidgets }} ctx={{ me: null, theme: th, orgSlug: org?.org_slug || org?.slug }} />
      </div>
    );
  }, [heroWidgets, th, org]);
  const builtPage = useMemo(() => {
    if (!restWidgets.length) return null;
    return (
      <div className="pt-page" style={{ width: "100%", maxWidth: 480, marginBottom: 28 }}>
        <PageRenderer page={{ widgets: restWidgets }} ctx={{ me: null, theme: th, orgSlug: org?.org_slug || org?.slug }} />
      </div>
    );
  }, [restWidgets, th, org]);

  // BUILD-102 Part 2 — the form the server says this page offers. Declared HERE,
  // above every line that reads it: the TDZ class has cost this repo four builds,
  // and a `const` read above its declaration takes the whole screen to its error
  // boundary at runtime while every unit test passes.
  const giveSpec = givingPage?.form || null;
  // BUILD-102 Part 5 — the thank-you, from the ONE shared function so the editor's
  // preview and the screen a donor actually reaches cannot say different things.
  const thanks = thankYouText(giveSpec ? { thankYou: giveSpec.thankYou } : {}, { orgName: org?.name || "" });

  // BUILD-102 Part 5 — an optional redirect to the org's own page. THREE SECONDS
  // rather than instantly: a redirect that fires on load means the thank-you is
  // never read and the donor arrives somewhere unexplained. The link is shown too,
  // so a blocked or slow redirect is never a dead end.
  //
  // DECLARED HERE, above every early return, because a hook after one throws
  // "Rendered more hooks than during the previous render" on the loading→loaded
  // transition — the BUILD-30 defect, and the `rules-of-hooks` gate caught this
  // exact line before it could reach a browser.
  // GIVE-2 §8 — fetched only once a gift has landed, because it is only shown
  // then. A page a stranger opens from a flyer does not need it and should not
  // pay for it.
  useEffect(() => {
    if (!donated || matchEmployers !== null) return;
    fetch(`${API}/org/${orgSlug}/matching-employers`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMatchEmployers(d && Array.isArray(d.employers) ? d : { employers: [] }))
      .catch(() => setMatchEmployers({ employers: [] }));
  }, [donated, orgSlug, matchEmployers]);

  useEffect(() => {
    if (!donated || !thanks.redirectUrl) return;
    const t = setTimeout(() => { window.location.href = thanks.redirectUrl; }, 3000);
    return () => clearTimeout(t);
  }, [donated, thanks.redirectUrl]);

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
    // GIVE-2 §4 — the one-tap link. The token leaves the URL immediately: it is
    // single-use and already spent by the time this resolves, and a spent token
    // sitting in somebody's history or in a referrer header is nobody's friend.
    const ex = params.get("express");
    if (ex) {
      window.history.replaceState({}, "", basePath);
      fetch(`${API}/express/${orgSlug}/open`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: ex }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) { setExpressErr(d.message || "That link has expired. Ask for a fresh one."); setExpress(false); return; }
          setExpress(d);
          const i = Number.isInteger(d.defaultIndex) ? d.defaultIndex : 0;
          setExpressAmt((d.amountsCents || [])[i] ?? (d.amountsCents || [])[0] ?? null);
        })
        .catch(() => { setExpressErr("Steward could not reach the server. Please try the link again."); setExpress(false); });
    }
    if (params.get("fundraiser_created") === "true") {
      setJustCreatedEmailSent(params.get("email_sent") === "true");
      // FIX-7 Part 6.2 — the demonstration organisation mails nobody, and the
      // page says what would have arrived instead of showing a failed send.
      setJustCreatedDemoNote(params.get("demo_note") || "");
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
    // BUILD-102 Part 6 — a visitor who already has a side keeps it, and the server
    // serves that variant in ONE round trip. Somebody arriving for the first time
    // fetches without a side, and only if a test is actually running do we assign
    // one and fetch again — so a form with no test never sets a cookie at all.
    const had = currentVariant();
    const withV = v => (v ? url + (url.includes("?") ? "&" : "?") + "v=" + v : url);
    fetch(withV(had))
      .then(r => r.json())
      .then(async d => {
        if (!d.error && d.givingPage && d.givingPage.abRunning && !had) {
          const v = assignVariant(true);
          if (v === "b") {
            // Only B needs a second fetch: A is what the first one already returned.
            try {
              const again = await fetch(withV("b")).then(r => r.json());
              if (!again.error) d = again;
            } catch { /* keep A rather than showing nothing */ }
          }
        }
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

  // GIVE-2 §5 — this org's own gross-up, from the rate the public payload
  // carried. Declared above every line that reads it (the TDZ rule).
  const grossUpCents = grossUpWith(org?.feeRate);
  const effectiveAmount = isCustom ? parseFloat(customAmt) || 0 : (preset || 0);
  const baseCents = Math.round(effectiveAmount * 100);
  const feeCents = baseCents >= 100 ? grossUpCents(baseCents) - baseCents : 0;
  const showCoverFees = org?.coverFeesEnabled && baseCents >= 100;
  const chargedAmount = showCoverFees && coverFees ? (baseCents + feeCents) / 100 : effectiveAmount;

  const isRecurring = frequency !== "one-time";
  const perLabel = frequency === "monthly" ? "every month" : "every year";
  const annualTotal = frequency === "monthly" ? chargedAmount * 12 : chargedAmount;

  // BUILD-102 Part 2 — ONE POST for both forms. The step form hands over what the
  // donor chose; the existing form hands over its own state. Neither computes a
  // total the server will trust: the server re-derives the charge, re-checks the
  // amount against the form's own list, and decides the designation itself.
  const postDonation = async (payload) => {
    setSubmitting(true); setSubmitErr("");
    try {
      const r = await fetch(`${API}/donate/${orgSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          reconnectToken: reconnectToken || undefined,
          givingPageId: givingPage?.id, peerFundraiserId: peerFundraiser?.id,
          showNameToFundraiser: !!(peerFundraiser && showNameToFundraiser),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Something went wrong.");
      window.location.href = data.url;
    } catch (err) {
      setSubmitErr(errorMessage(err, "That did not go through. Please try again."));
      setSubmitting(false);
    }
  };

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
          showNameToFundraiser: !!(peerFundraiser && showNameToFundraiser),
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
      <div style={{ fontSize: 16, fontWeight: 700, color: T.terra700, marginBottom: 8 }}>Page not found</div>
      <div style={{ fontSize: 13, color: T.ink3 }}>{pageError}</div>
    </div>
  );

  // ── GIVE-2 §4 · THE ONE-TAP SCREEN ───────────────────────────────────────
  // It REPLACES the form rather than sitting beside it. A donor who followed a
  // one-tap link has already decided; a page that also shows them a three-step
  // form is a page that has not read its own link. There is no card field here
  // and there never will be: the card lives on the organisation's own Stripe
  // account and is charged by its id.
  if (express !== null && !donated) {
    const ex = express || {};
    const exBase = Math.round(Number(expressAmt) || 0);
    const exFee = exBase >= 100 ? grossUpCents(exBase) - exBase : 0;
    const exCharged = ex.coverFeesEnabled && expressCover ? exBase + exFee : exBase;
    const give = async () => {
      setExpressErr(""); setExpressBusy(true);
      try {
        const r = await fetch(`${API}/express/${orgSlug}/charge`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: ex.session, amount: exBase / 100, coverFees: !!(ex.coverFeesEnabled && expressCover) }),
        });
        const d = await r.json();
        if (!r.ok) { setExpressErr(d.message || "That did not go through."); return; }
        setExpressDone(d.message || "Thank you.");
      } catch { setExpressErr("Steward could not reach the server. Nothing has been charged."); }
      finally { setExpressBusy(false); }
    };
    return (
      <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
        <div className="express-card" style={{ ...card, width: "100%", maxWidth: 420, padding: "26px 24px", textAlign: "left" }}>
          {expressDone ? (
            <>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.ink, fontFamily: th.serif, marginBottom: 8 }}>Thank you.</div>
              <div className="express-done" style={{ fontSize: 14, color: T.ink2, lineHeight: 1.6 }}>{expressDone}</div>
              <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginTop: 10 }}>
                A receipt is on its way to your email.
              </div>
            </>
          ) : express === false ? (
            <>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, fontFamily: th.serif, marginBottom: 8 }}>
                That link has run out
              </div>
              <div className="express-expired" style={{ fontSize: 14, color: T.ink2, lineHeight: 1.6, marginBottom: 14 }}>
                {expressErr || "One-tap links work once, for fifteen minutes."}
              </div>
              <a href={basePath} style={{ display: "inline-block", background: th.primary, color: th.primaryFg,
                   textDecoration: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700 }}>
                Give the usual way
              </a>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: T.ink, fontFamily: th.serif, marginBottom: 6 }}>
                {ex.firstName ? `Welcome back, ${ex.firstName}.` : "Welcome back."}
              </div>
              <div style={{ fontSize: 14, color: T.ink2, lineHeight: 1.6, marginBottom: 16 }}>
                One tap gives to {ex.orgName || org?.name || "this organisation"} using
                {" "}{ex.card?.last4 ? `your ${ex.card.brand || "card"} ending ${ex.card.last4}` : "the card you saved"}.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginBottom: 8 }}>
                {(ex.amountsCents || []).map(c => (
                  <button key={c} type="button" className="express-amt" data-cents={c}
                    aria-pressed={expressAmt === c} onClick={() => setExpressAmt(c)}
                    style={{ padding: "12px 0", borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 700,
                             border: "1px solid " + (expressAmt === c ? th.primary : "rgba(0,0,0,0.14)"),
                             background: expressAmt === c ? th.primary : "transparent",
                             color: expressAmt === c ? th.primaryFg : T.ink }}>
                    {fmtAmt(c / 100)}
                  </button>
                ))}
              </div>
              {/* WHERE THESE AMOUNTS CAME FROM, in the server's words. */}
              {ex.amountsSentence ? (
                <div className="express-why" style={{ fontSize: 12, color: T.ink3, marginBottom: 12, lineHeight: 1.5 }}>
                  {ex.amountsSentence}
                </div>
              ) : null}
              {ex.coverFeesEnabled && exBase >= 100 ? (
                <label className="express-cover" style={{ display: "block", fontSize: 13, color: T.ink2, marginBottom: 14 }}>
                  <input type="checkbox" checked={expressCover} onChange={e => setExpressCover(e.target.checked)} />{" "}
                  Add {fmtAmt(exFee / 100)} to cover the card fee.
                  {ex.coverFeeRateSentence ? (
                    <span style={{ display: "block", fontSize: 12, color: T.ink3, marginTop: 3, marginLeft: 22 }}>
                      Card processing is {ex.coverFeeRateSentence}.
                    </span>
                  ) : null}
                </label>
              ) : null}
              {expressErr ? (
                <div className="express-err" style={{ fontSize: 13, color: T.gold, marginBottom: 10, lineHeight: 1.5 }}>{expressErr}</div>
              ) : null}
              <button type="button" className="express-give" onClick={give} disabled={expressBusy || !exBase}
                style={{ width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
                         cursor: expressBusy ? "default" : "pointer", background: th.primary, color: th.primaryFg,
                         fontSize: 16, fontWeight: 700, fontFamily: th.sans, opacity: expressBusy ? 0.6 : 1 }}>
                {expressBusy ? "One moment…" : `Give ${fmtAmt(exCharged / 100)}`}
              </button>
              <a href={basePath} className="express-other" style={{ display: "block", marginTop: 12, fontSize: 13,
                   color: th.primary, textAlign: "center" }}>
                Use a different card or amount
              </a>
              <div style={{ fontSize: 12, color: T.ink3, marginTop: 14, lineHeight: 1.5 }}>
                {ex.definition}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (donated) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 64, height: 64, background: th.primary, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 28, color: th.primaryFg }}>✓</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.ink, marginBottom: 10, fontFamily: th.serif }}>
        Thank you!
      </div>
      {/* BUILD-102 Part 5 — THE ORG'S OWN WORDS WHEN THEY WROTE ANY. A form's
          thank-you message is the one place a donor hears the organisation rather
          than the software, so it replaces Steward's sentence rather than sitting
          under it. With nothing written, the fallback says the one thing a donor
          wants to know next: that a receipt is coming. */}
      {thanks.fromTheOrg ? (
        <div className="thanks-own-words" style={{ fontSize: 16, color: T.ink2, maxWidth: 420, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {thanks.message}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 16, color: T.ink2, marginBottom: 6 }}>
            Your gift to <strong>{org.name}</strong> has been received.
          </div>
          <div className="thanks-fallback" style={{ fontSize: 14, color: T.ink3, maxWidth: 360, lineHeight: 1.6 }}>
            A receipt will be sent to your email. Thank you for your generosity — it makes a real difference.
          </div>
        </>
      )}
      {thanks.redirectUrl ? (
        <div className="thanks-redirect" style={{ marginTop: 18, fontSize: 13, color: T.ink3 }}>
          Taking you back to <a href={thanks.redirectUrl} style={{ color: T.greenDk }}>{new URL(thanks.redirectUrl).hostname}</a> in a moment.
        </div>
      ) : null}
      {/* ── GIVE-2 §8 · DOES YOUR EMPLOYER MATCH? ─────────────────────────
          The employers THIS organisation knows match, each with the company's
          own form link. Typed by staff: no vendor, no lookup service, no
          guessing, and nothing shown at all until an org has typed one.
          A donor who works at one of these can double the gift they just made
          in about two minutes, which is the highest-return thing this page can
          possibly say to them. */}
      {matchEmployers && matchEmployers.employers.length ? (
        <div className="thanks-match" style={{ marginTop: 28, padding: "16px 22px", background: T.white,
             border: `1px solid ${T.bg2}`, borderRadius: 12, maxWidth: 400, textAlign: "left" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 6 }}>
            {matchEmployers.heading || "Your gift could be worth twice as much"}
          </div>
          <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, marginBottom: 10 }}>
            These employers match their staff&rsquo;s gifts to {org.name}. If yours is one of them, their own form takes a couple of minutes.
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {matchEmployers.employers.map(e => (
              <li key={e.name} style={{ fontSize: 13, color: T.ink2, lineHeight: 1.7 }}>
                {e.form_url ? (
                  <a href={e.form_url} target="_blank" rel="noopener noreferrer"
                     style={{ color: T.greenDk, fontWeight: 600 }}>{e.name}</a>
                ) : <strong style={{ color: T.ink }}>{e.name}</strong>}
                {e.ratio ? <span style={{ color: T.ink3 }}> &middot; matches {e.ratio}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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

  if (ticketEventId) return <TicketsPage orgSlug={orgSlug} eventId={ticketEventId} th={th} BASE={BASE} card={card} />;
  if (membershipLevelId) return <MembershipPage orgSlug={orgSlug} levelId={membershipLevelId} th={th} BASE={BASE} card={card} />;

  // The goal bar, drawn once: at the top of a campaign page, or under the
  // story on any other giving page (FIX-15 Part 6).
  const goalBar = () => {
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
                  {/* CAMPAIGN-2 — WHAT THE BAR COUNTS, in the server's words.
                      A thermometer is the number a stranger is most likely to
                      doubt, and the two things people assume it leaves out are
                      the two it names: a cheque somebody posted, and a gift
                      given through a supporter's own fundraising page. */}
                  {givingPage.goalSentence && (
                    <div className="goal-sentence" style={{ fontSize: 12, color: T.ink3, marginTop: 6, lineHeight: 1.55 }}>
                      {givingPage.goalSentence}
                    </div>
                  )}
                </div>
              );
  };
  return (
    <div style={BASE}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>

      {showStartFundraiser && (
        <StartFundraiserModal
          orgSlug={orgSlug} pageSlug={pageSlug} th={th}
          onClose={() => setShowStartFundraiser(false)}
          onCreated={d => { window.location.href = `${d.publicUrl}?fundraiser_created=true&email_sent=${d.emailSent}`
            + (d.demoNote ? `&demo_note=${encodeURIComponent(d.demoNote)}` : ""); }}
        />
      )}

      {/* Header — hidden when embedded in an iframe. Three variants: a peer
          fundraiser's own personal page, a parent Giving Page, or the generic
          org-wide page — in that priority order. All carry the org's identity. */}
      {!isEmbed && (
        peerFundraiser ? (
          <div style={{ width: "100%", maxWidth: 480, marginBottom: 28 }}>
            {justCreatedEmailSent !== null && (
              justCreatedDemoNote ? (
                <div data-testid="fundraiser-demo-note" style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, padding: "10px 14px", fontSize: 12, color: T.ink2, marginBottom: 14 }}>
                  Your fundraiser is live. {justCreatedDemoNote}
                </div>
              ) : justCreatedEmailSent ? (
                <div style={{ background: th.primary + "10", border: "1px solid " + th.primary + "30", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: T.ink2, marginBottom: 14 }}>
                  Your fundraiser is live. Check your email for a link to manage it later: bookmark it, there is no password.
                </div>
              ) : (
                <div style={{ background: T.terra100, border: "1px solid "+T.terra200, borderRadius: 12, padding: "10px 14px", fontSize: 12, color: T.terra700, marginBottom: 14 }}>
                  Your fundraiser is live. We could not send your management email, so contact {org.name} directly if you need to update your page later.
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
          <>
          {isCampaignPage && (
            <div data-testid="campaign-top" style={{ width: "100%", maxWidth: 480, marginBottom: 20, order: 0 }}>
              {builtHero || (
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{org.name}</div>
                  <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: th.serif, letterSpacing: "-0.02em" }}>{givingPage.title}</h1>
                </div>
              )}
              {goalBar()}
              <a href="#give-form" data-testid="campaign-give"
                onClick={e => { const f = document.getElementById("give-form"); if (f) { e.preventDefault(); f.scrollIntoView({ behavior: "smooth", block: "start" }); } }}
                style={{ display: "block", textAlign: "center", marginTop: 12, background: th.button, color: th.buttonFg, borderRadius: 10,
                         padding: "13px 0", fontSize: 16, fontWeight: 700, textDecoration: "none", fontFamily: th.sans }}>
                Give now
              </a>
            </div>
          )}
          <div style={{ width: "100%", maxWidth: 480, marginBottom: 28, order: 2 }}>
            {builtPage}
            {!builtPage && givingPage.imageUrl && (
              <img src={givingPage.imageUrl} alt={givingPage.title}
                style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 16, marginBottom: 20, display: "block" }}
                onError={e => { e.target.style.display = "none"; }}
              />
            )}
            {!builtPage && (
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                {!isCampaignPage && <>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{org.name}</div>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: th.serif, letterSpacing: "-0.02em" }}>
                  {givingPage.title}
                </h1>
                </>}
                {givingPage.story && (
                  <p style={{ margin: "10px 0 0", fontSize: 14, color: T.ink2, lineHeight: 1.65, textAlign: "left" }}>{givingPage.story}</p>
                )}
              </div>
            )}
            {!isCampaignPage && goalBar()}

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
          </>
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

      {/* BUILD-95 §5B — THE BUILT PAGE, drawn by the SAME renderer as the
          portal. `builtPage` is null until she publishes one, and then this
          block is simply absent and the page reads exactly as it always did. */}
      {/* BUILD-102 Part 2 — A CONFIGURED FORM IS THREE STEPS. An unconfigured
          page falls through to the single form below, unchanged. `configured` is
          the whole switch, and it is false for every giving page that existed
          before this build. */}
      {giveSpec && giveSpec.configured ? (
        <div id="give-form" style={{ width: "100%", maxWidth: 480, order: formPosition === "top" ? 1 : 3,
                      display: "flex", justifyContent: "center", scrollMarginTop: 16 }}>
          <GiveSteps
            spec={giveSpec}
            formId={givingPage?.id}
            theme={th}
            coverFeesEnabled={org?.coverFeesEnabled}
            upsellThresholdCents={givingPage?.upsellThresholdCents}
            upsellMonthlyCents={givingPage?.upsellMonthlyCents}
            feeRateSentence={org?.feeRateSentence}
            showsRecentGifts={Array.isArray(givingPage?.page) && givingPage.page.some(w => w && w.type === "recentgifts")}
            grossUpCents={grossUpCents}
            submitting={submitting}
            submitErr={submitErr}
            onSubmit={postDonation}
            apiBase={API}
            styles={{
              card,
              inp,
              btn: { width: "100%", padding: "14px 0", borderRadius: 10, border: "none", cursor: "pointer",
                     background: th.primary, color: th.primaryFg, fontSize: 16, fontWeight: 700, fontFamily: th.sans },
              quiet: { background: "none", border: "none", padding: 0, cursor: "pointer",
                       color: th.primary, fontSize: 14, fontWeight: 600, textDecoration: "underline", fontFamily: th.sans },
            }}
          />
        </div>
      ) : null}

      {/* Form. FIXED — it is not a widget and cannot be removed, because a
          giving page that stopped taking gifts says nothing on screen. She
          chooses only whether it leads the page or follows the story. */}
      <form id={giveSpec && giveSpec.configured ? undefined : "give-form"} onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 480, scrollMarginTop: 16, display: giveSpec && giveSpec.configured ? "none" : "flex",
                                            flexDirection: "column", gap: 20,
                                            order: formPosition === "top" ? 1 : 3 }}>

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

        {/* BUILD-103 — WHETHER THE FUNDRAISER MAY SEE YOUR FIRST NAME. Off
            unless the donor ticks it. A gift through a friend's page is still
            a gift to the organisation, and the friend is not entitled to a
            list of who gave: the organisation has the record either way. */}
        {peerFundraiser && (
          <label style={{ ...card, padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={showNameToFundraiser} onChange={e => setShowNameToFundraiser(e.target.checked)}
              data-testid="show-name-to-fundraiser"
              style={{ marginTop: 3, width: 16, height: 16, accentColor: th.primary, cursor: "pointer", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
              Let {peerFundraiser.name.split(" ")[0]} see my first name, so they can thank me.
              {" "}Leave it unticked and they see the gift without a name. {org.name} has the full record either way.
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
          <div style={{ background: T.terra100, border: "1px solid "+T.terra200, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: T.terra700 }}>{submitErr}</div>
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
