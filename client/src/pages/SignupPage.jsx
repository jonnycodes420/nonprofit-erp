import { useEffect, useState } from "react";
// FIX-10 F — the users answer, from shared/seats.js.
import { USERS_PHRASE } from "../../../shared/seats";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
// The same catalogue the server prices against (pricing.js says why JSON).
import PRICING from "../../../pricing.json";

const TIERS = PRICING.tiers;
const TALK_TO_US = PRICING.talkToUs;
const ACTIVE_DONOR_SENTENCE = PRICING.activeDonorSentence;
const YEARLY_NOTE = PRICING.yearlyNote;
const TERMS_STRIP = PRICING.termsStrip;

// ── GTM-1a 2 + 5 · SIGNUP, REOPENED ───────────────────────────────────────
//
// BUILD-87 closed /signup and turned it into a redirect, for a good reason:
// the form sold a price that no longer existed and a self-serve door the
// product had shut, and a signup form that contradicts the product it signs
// you up for is worse than no form.
//
// It reopens as the SAME path Jonathan walks in the room. There is no second
// way to create an organisation: this page mints a close link for the visitor
// and hands them straight to the same Stripe Checkout, with the same thirty
// days from signing, the same seven-day heads-up email and the same two-click
// cancel. Nothing exists in Steward until Checkout completes — not an org,
// not a user, not a Stripe customer.
//
// WHAT THIS PAGE ASKS FOR, AND WHY EACH ONE:
//   · the organisation's name  — it goes on the agreement and on the org
//   · your name                — the agreement records WHO accepted it
//   · your email               — it becomes the first admin account
//   · how many active donors   — it picks the band, and it is an ESTIMATE:
//     Steward counts for itself after the import and says so if it differs
//     (GTM-1b 1). Nobody is punished for guessing.
//   · monthly or yearly
//   · the agreement, read and ticked. The version is sent back with the
//     acceptance so a page left open across a deploy cannot record a consent
//     to words that are no longer the words.

const CREAM = "#f0ede6", INK = "#0f1a12", SAGE = "rgba(240,237,230,0.7)";
const GOLD = "#c9a84c", PANEL = "#1a2e1f", PANEL_BORDER = "#2d4a35", EMERALD = "#0d5c3a";
const WHITE = "#ffffff", MIST_EDGE = "#dfe8e2", SAGE_GREY = "#6b7c72", TERRA = "#b8593f";

const CAL = "https://calendly.com/xjca2006/new-meeting";
const usd = n => "$" + Number(n).toLocaleString("en-US");

function bandFor(n) {
  const c = Number(n);
  if (!Number.isFinite(c) || c < 0) return null;
  return TIERS.find(t => c <= t.maxDonors) || null;
}

const labelStyle = { fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: SAGE_GREY, display: "block", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "11px 13px", fontSize: 14.5, borderRadius: 9, border: `1.5px solid ${MIST_EDGE}`, background: WHITE, color: INK, fontFamily: "inherit" };

export default function SignupPage() {
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [donors, setDonors] = useState("");
  const [interval, setIntervalChoice] = useState("monthly");
  const [accepted, setAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const [agreement, setAgreement] = useState(null);   // { version, markdown }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The agreement is fetched, not bundled: the words somebody accepts must be
  // the words the server is about to record the sha256 of.
  useEffect(() => {
    let live = true;
    apiFetch("/public/agreement")
      .then(a => { if (live) setAgreement(a); })
      .catch(() => { if (live) setAgreement({ error: true }); });
    return () => { live = false; };
  }, []);

  const estimate = donors === "" ? null : Number(donors);
  const band = estimate === null ? null : bandFor(estimate);
  const overTop = estimate !== null && Number.isFinite(estimate) && estimate >= 0 && !band;
  const amount = band ? (interval === "yearly" ? band.yearlyUsd : band.monthlyUsd) : null;

  const ready = !!orgName.trim() && !!contactName.trim() && /.+@.+\..+/.test(contactEmail)
    && !!band && accepted && !!agreement?.version && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setErr(""); setBusy(true);
    try {
      const r = await apiFetch("/public/signup", {
        method: "POST",
        body: JSON.stringify({
          orgName: orgName.trim(), contactName: contactName.trim(),
          contactEmail: contactEmail.trim().toLowerCase(),
          estimatedDonors: Math.round(estimate), interval,
          acceptTerms: true, termsVersion: agreement.version,
        }),
      });
      if (!r?.url) throw new Error("Checkout could not be started. Nothing has been created.");
      window.location.href = r.url;
    } catch (e2) {
      // Every refusal from the route carries copy written for the person
      // reading it, so prefer it verbatim over anything invented here.
      setErr(e2?.message || "Something went wrong. Nothing has been created.");
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: INK, padding: "60px 24px 72px", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      <div style={{ position: "fixed", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 56, background: INK, borderBottom: `1px solid ${PANEL}`, zIndex: 100 }}>
        <Link to="/" style={{ textDecoration: "none" }}>
          <span style={{ fontSize: 20, color: CREAM, fontFamily: "'DM Serif Display',Georgia,serif", letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        <Link to="/login" style={{ fontSize: 13, color: SAGE, textDecoration: "none" }}>Already have an account? Sign in</Link>
      </div>

      <div style={{ maxWidth: 620, margin: "56px auto 0" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 data-testid="signup-headline" style={{ fontSize: 34, fontWeight: 400, color: CREAM, fontFamily: "'DM Serif Display',Georgia,serif", lineHeight: 1.15, margin: "0 0 12px" }}>
            Start with one conversation.
          </h1>
          <p style={{ fontSize: 15, color: SAGE, lineHeight: 1.6, margin: 0 }}>
            Your card goes in now and <strong style={{ color: GOLD }}>nothing is charged for thirty days</strong>.
            We email you a week before the first charge, and cancelling takes two clicks.
          </p>
        </div>

        <form onSubmit={submit} style={{ background: CREAM, borderRadius: 18, padding: "28px 26px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            <div>
              <label style={labelStyle} htmlFor="su-org">Your organization</label>
              <input id="su-org" data-testid="signup-org" style={inputStyle} value={orgName}
                onChange={e => setOrgName(e.target.value)} placeholder="Harborlight Youth Collective" autoComplete="organization" />
            </div>

            <div className="su-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle} htmlFor="su-name">Your name</label>
                <input id="su-name" data-testid="signup-name" style={inputStyle} value={contactName}
                  onChange={e => setContactName(e.target.value)} placeholder="Maria Alvarez" autoComplete="name" />
              </div>
              <div>
                <label style={labelStyle} htmlFor="su-email">Your email</label>
                <input id="su-email" data-testid="signup-email" type="email" style={inputStyle} value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)} placeholder="you@yourorg.org" autoComplete="email" />
              </div>
            </div>

            <div>
              <label style={labelStyle} htmlFor="su-donors">Roughly how many active donors?</label>
              <input id="su-donors" data-testid="signup-donors" type="number" min="0" step="1" style={inputStyle}
                value={donors} onChange={e => setDonors(e.target.value)} placeholder="850" />
              <p data-testid="signup-active-donor-sentence" style={{ fontSize: 12.5, color: SAGE_GREY, lineHeight: 1.55, margin: "7px 0 0" }}>
                {ACTIVE_DONOR_SENTENCE} An estimate is fine — Steward counts for itself after your import and tells you
                before anything about your price changes.
              </p>
            </div>

            <div>
              <span style={labelStyle}>Billing</span>
              <div role="group" aria-label="Billing period" style={{ display: "inline-flex", background: WHITE, border: `1px solid ${MIST_EDGE}`, borderRadius: 99, padding: 4 }}>
                {[["monthly", "Monthly"], ["yearly", "Yearly"]].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setIntervalChoice(id)} aria-pressed={interval === id}
                    data-testid={"signup-interval-" + id}
                    style={{ background: interval === id ? INK : "transparent", color: interval === id ? CREAM : SAGE_GREY,
                             border: "none", borderRadius: 99, padding: "8px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
                    {label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 12.5, color: SAGE_GREY, marginLeft: 12 }}>{YEARLY_NOTE}</span>
            </div>

            {/* WHAT IT WILL COST, before the card and not after it. */}
            {band && (
              <div data-testid="signup-quote" style={{ background: WHITE, border: `1px solid ${MIST_EDGE}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  {/* FIX-4 6 — THE NAME, WITH THE DONOR COUNT UNDER IT. The
                      quote named the band and not the plan, so the one screen
                      that takes a card never said what she was buying. */}
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span data-testid="signup-plan-name" style={{ fontSize: 19, fontWeight: 700, color: INK, fontFamily: "'DM Serif Display',Georgia,serif" }}>{band.name}</span>
                    <span style={{ fontSize: 13, color: SAGE_GREY }}>{band.band}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span style={{ fontSize: 24, fontWeight: 800, color: INK, fontFamily: "'DM Serif Display',Georgia,serif" }}>{usd(amount)}</span>
                    <span style={{ fontSize: 13, color: SAGE_GREY }}>{interval === "yearly" ? "/year" : "/month"}</span>
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: SAGE_GREY, marginTop: 6, lineHeight: 1.5 }}>
                  Everything is included and there is {USERS_PHRASE}. Nothing is charged for thirty days.
                </div>
              </div>
            )}

            {overTop && (
              <div data-testid="signup-talk" style={{ background: WHITE, border: `1px solid ${MIST_EDGE}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: INK, marginBottom: 2, fontFamily: "'DM Serif Display',Georgia,serif" }}>{TALK_TO_US.name}</div>
                <div style={{ fontSize: 13, color: SAGE_GREY, marginBottom: 6 }}>{TALK_TO_US.band}</div>
                <div style={{ fontSize: 13, color: SAGE_GREY, lineHeight: 1.55 }}>
                  That is a conversation rather than a checkout — at your size the import and the setup matter more than the price.{" "}
                  <a href={CAL} target="_blank" rel="noreferrer" style={{ color: EMERALD, fontWeight: 700 }}>Book a call</a> and we will size it with you.
                </div>
              </div>
            )}

            {/* ── THE AGREEMENT ──────────────────────────────────────────── */}
            <div style={{ borderTop: `1px solid ${MIST_EDGE}`, paddingTop: 16 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" data-testid="signup-accept" checked={accepted}
                  onChange={e => setAccepted(e.target.checked)} style={{ marginTop: 3, width: 17, height: 17, accentColor: EMERALD }} />
                <span style={{ fontSize: 13.5, color: INK, lineHeight: 1.55 }}>
                  I have read and accept the{" "}
                  <button type="button" onClick={() => setShowTerms(v => !v)} data-testid="signup-terms-toggle"
                    style={{ background: "none", border: "none", padding: 0, color: EMERALD, fontWeight: 700, fontSize: 13.5, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
                    Steward Customer Agreement
                  </button>
                  {agreement?.version && (
                    <span data-testid="signup-terms-version" style={{ color: SAGE_GREY }}> (version {agreement.version})</span>
                  )}
                  . Your acceptance is recorded with your name, the time, and the exact words you agreed to.
                </span>
              </label>

              {showTerms && (
                <div data-testid="signup-terms-body"
                  style={{ marginTop: 12, maxHeight: 280, overflowY: "auto", background: WHITE, border: `1px solid ${MIST_EDGE}`,
                           borderRadius: 10, padding: "14px 16px", fontSize: 12.5, color: INK, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                  {agreement?.markdown || (agreement?.error
                    ? "The agreement could not be loaded. Do not accept it until you can read it — reload the page, or write to us."
                    : "Loading…")}
                </div>
              )}
            </div>

            {err && (
              <div data-testid="signup-error" role="alert" style={{ fontSize: 13, color: TERRA, lineHeight: 1.5 }}>{err}</div>
            )}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button type="submit" data-testid="signup-submit" disabled={!ready}
                style={{ background: ready ? EMERALD : MIST_EDGE, border: "none", borderRadius: 10, padding: "14px 28px",
                         color: ready ? WHITE : SAGE_GREY, fontSize: 15, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed" }}>
                {busy ? "Opening checkout…" : "Continue to card →"}
              </button>
              <a href={CAL} target="_blank" rel="noreferrer" data-testid="signup-book"
                style={{ background: "transparent", border: `1px solid ${MIST_EDGE}`, borderRadius: 10, padding: "14px 28px", color: INK, fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
                Book a call
              </a>
            </div>
          </div>
        </form>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 14px", fontSize: 12.5, color: SAGE, marginTop: 20 }}>
          {TERMS_STRIP.map((item, i) => (
            <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
              {i > 0 && <span aria-hidden="true" style={{ color: PANEL_BORDER }}>·</span>}
              {item}
            </span>
          ))}
        </div>
      </div>

      <style>{`@media (max-width: 620px){ .su-two{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
