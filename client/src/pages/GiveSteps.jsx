// client/src/pages/GiveSteps.jsx — BUILD-102 (Steward Give) Part 2.
// THE THREE-STEP DONATION FORM.
//
// ── WHY THIS IS A SEPARATE COMPONENT AND NOT AN EDIT TO Donate.jsx ─────────
// An unconfigured giving page must render BYTE-FOR-FOR-BYTE what it always did —
// the BUILD-95 §5B rule ("an unbuilt page is byte-for-byte what it always was"),
// which is what made that build safe to ship. BUILD-60 tuned the existing single
// form deliberately (recurring is the hero, the second tier pre-selected, the
// ladder per frequency), and retro-fitting three steps onto every giving page
// that already exists would change a screen nobody asked to change.
//
// So: a page whose form somebody CONFIGURED renders this. Every other page is
// untouched, and Donate.jsx decides on `spec.configured`.
//
// ── THE STEPS ──────────────────────────────────────────────────────────────
// Amount and frequency · about you · payment. Three short screens rather than
// one long one, because a donor who has chosen an amount is committed in a way
// somebody staring down a single wall of fields is not. Payment is Stripe
// Checkout on the ORG's connected account, which is also where the wallets come
// from: Apple Pay and Google Pay appear on Stripe's own page when the device
// supports them, and no card field ever exists here.
//
// ── THE RULES LIVE IN shared/formConfig.js ─────────────────────────────────
// The amounts, the frequencies, the designation and the upsell arithmetic all
// come from the spec and from `upsellFor`. This file decides nothing about money;
// it draws what the shared module says and posts what the donor chose. The SERVER
// re-checks every one of those rules (Part 2's donate-route block), so a tampered
// request cannot buy anything this screen would not have offered.

import { useState, useMemo, useEffect, useRef } from "react";
import { upsellFor, upsellSentence, utmFrom } from "../../../shared/formConfig.js";
// The PUBLIC page's own tokens (BUILD-60: this page is the org's, and the tokens
// are the audited public set). No raw hex here — the palette census RATCHETS DOWN
// and it caught eleven literals in the first cut of this file.
import { T } from "./publicTheme";

// A refusal on this page is BRASS, never red. Nothing a donor typed is
// dangerous — it is just not what the form offers — and the standing design rule
// reserves red for a destructive confirm. Brass is the product's "look here".
const ERR = T.gold;
const MUTED = T.ink3;
const HAIRLINE = "rgba(0,0,0,0.14)";
const HAIRLINE_SOFT = "rgba(0,0,0,0.10)";

const fmtCents = c => {
  const v = Math.round(Number(c) || 0);
  return v % 100 === 0
    ? "$" + (v / 100).toLocaleString()
    : "$" + (v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// The decline is remembered for the SESSION, per form — not forever, and not
// across forms. A donor who said no this morning and comes back in March to a
// different appeal is a different conversation; a donor who said no ninety
// seconds ago is being nagged.
const declineKey = formId => `steward_give_upsell_declined_${formId || "form"}`;
function alreadyDeclined(formId) {
  try { return window.sessionStorage.getItem(declineKey(formId)) === "1"; } catch { return false; }
}
function rememberDecline(formId) {
  try { window.sessionStorage.setItem(declineKey(formId), "1"); } catch { /* a private window is still allowed to give */ }
}

// ── BUILD-102 Part 6 — TWO BEACONS, AND NOTHING ELSE ───────────────────────
// A view when the form is opened and a start when the donor gets past choosing an
// amount. No identifier travels: the server's `form_events` table has nowhere to
// put one, and this sends nothing it could. The COMPLETION is counted from the
// gift in the webhook, because a page cannot be trusted to know whether money
// moved.
//
// `keepalive` so a start still lands if the donor navigates immediately, and every
// failure is swallowed: a blocked beacon must never cost somebody their gift.
function countFormEvent(apiBase, formId, kind, variant) {
  if (!formId) return;
  try {
    fetch(`${apiBase}/forms/${encodeURIComponent(formId)}/event`, {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ kind, variant: variant || undefined }),
    }).catch(() => {});
  } catch { /* nothing here may ever cost a gift */ }
}

export default function GiveSteps({
  spec, formId, theme: th, coverFeesEnabled, upsellThresholdCents,
  onSubmit, submitting, submitErr, grossUpCents, styles, apiBase,
}) {
  const { card, inp, btn, quiet } = styles;
  const [step, setStep] = useState(0);
  const [frequency, setFrequency] = useState(spec.amount.defaultFrequency === "monthly" ? "monthly" : "once");
  const [amountCents, setAmountCents] = useState(spec.amount.amountsCents[1] ?? spec.amount.amountsCents[0] ?? null);
  const [isCustom, setIsCustom] = useState(!spec.amount.amountsCents.length);
  const [customAmt, setCustomAmt] = useState("");
  const [fundId, setFundId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [coverFees, setCoverFees] = useState(false);   // always opt-in, never pre-checked
  const [tributeType, setTributeType] = useState("");
  const [tributeName, setTributeName] = useState("");
  const [notifyName, setNotifyName] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [employer, setEmployer] = useState("");
  const [answers, setAnswers] = useState({});
  const [stepErr, setStepErr] = useState("");
  // THE UPSELL IS ASKED ONCE. `asked` is what makes that true within a render
  // tree; the session flag is what makes it true across a reload.
  const [upsellAsked, setUpsellAsked] = useState(() => alreadyDeclined(formId));
  const [upsellOpen, setUpsellOpen] = useState(false);
  // One view per mount, and one start per form — a donor who goes Back and
  // forward again has not started twice.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!apiBase || !formId) return;
    countFormEvent(apiBase, formId, "view", spec.variant);
  }, [apiBase, formId, spec.variant]);

  const chosenCents = isCustom ? Math.round((parseFloat(customAmt) || 0) * 100) : (amountCents || 0);
  const feeCents = chosenCents >= 100 && typeof grossUpCents === "function" ? grossUpCents(chosenCents) - chosenCents : 0;
  const showCoverFees = coverFeesEnabled && chosenCents >= 100;
  const chargedCents = showCoverFees && coverFees ? chosenCents + feeCents : chosenCents;

  const upsell = useMemo(
    () => upsellFor(chosenCents, {
      thresholdCents: upsellThresholdCents,
      offerMonthly: spec.amount.frequencies.includes("monthly"),
      frequency,
    }),
    [chosenCents, upsellThresholdCents, spec.amount.frequencies, frequency]
  );

  // Switching frequency never carries the amount across (BUILD-60's rule, kept):
  // a $250 one-time gift is a very different monthly ask.
  function switchFrequency(f) {
    if (f === frequency) return;
    setFrequency(f);
    setIsCustom(!spec.amount.amountsCents.length);
    setCustomAmt("");
    setAmountCents(spec.amount.amountsCents[1] ?? spec.amount.amountsCents[0] ?? null);
  }

  function goFromAmount() {
    setStepErr("");
    if (chosenCents < 100) { setStepErr("Choose an amount of at least $1."); return; }
    if (!spec.amount.allowOther && !spec.amount.amountsCents.includes(chosenCents)) {
      setStepErr("Choose one of the amounts above."); return;
    }
    if (spec.designation.mode === "choice" && !fundId) {
      setStepErr("Choose where your gift should go."); return;
    }
    // A START is the moment the donor commits to an amount and moves on, counted
    // ONCE per form: going Back and forward again is not a second start.
    if (!startedRef.current) {
      startedRef.current = true;
      if (apiBase) countFormEvent(apiBase, formId, "start", spec.variant);
    }
    // ASK ONCE, HERE — between choosing an amount and typing a name, which is
    // the only moment the question is not an interruption.
    if (upsell.offer && !upsellAsked) { setUpsellOpen(true); return; }
    setStep(1);
  }

  function acceptUpsell() {
    setUpsellAsked(true); setUpsellOpen(false);
    setFrequency("monthly");
    setIsCustom(false);
    setAmountCents(upsell.monthlyCents);
    setStep(1);
  }
  function declineUpsell() {
    setUpsellAsked(true); setUpsellOpen(false);
    rememberDecline(formId);
    setStep(1);
  }

  function goFromDetails() {
    setStepErr("");
    if (!firstName.trim() || !lastName.trim()) { setStepErr("Please give your name."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setStepErr("Please give an email we can send your receipt to."); return; }
    for (const q of spec.details.questions) {
      if (q.required && !String(answers[q.key] ?? "").trim()) { setStepErr(q.label); return; }
    }
    setStep(2);
  }

  function submit() {
    setStepErr("");
    // BUILD-102 Part 5 — the UTM tags off THIS page's own URL, read through the
    // one shared cleaner so the page and the server agree on what may be kept.
    // The server re-reads and re-cleans them; this is a carrier, not a decision.
    let utm = {};
    try { utm = utmFrom(Object.fromEntries(new URLSearchParams(window.location.search))); } catch { utm = {}; }
    onSubmit({
      utm,
      variant: spec.variant === "b" ? "b" : undefined,
      amount: chosenCents / 100,
      frequency: frequency === "monthly" ? "monthly" : "once",
      fundId: fundId || "",
      firstName, lastName, email,
      coverFees: showCoverFees && coverFees,
      tributeType: tributeType || undefined,
      tributeName: tributeName || undefined,
      notifyName: notifyName || undefined,
      notifyEmail: notifyEmail || undefined,
      employer: employer || undefined,
      answers,
    });
  }

  const stepLabel = spec.steps.map(s => s.label);
  const on = th.primary, onFg = th.primaryFg;

  return (
    <div className="give-steps" style={{ ...card, width: "100%", maxWidth: 480 }}>
      {/* THE PROGRESS IS THREE WORDS, NOT A PERCENTAGE. A donor does not need a
          number; they need to know how much is left. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }} aria-hidden="true">
        {stepLabel.map((l, i) => (
          <div key={l} style={{ flex: 1 }}>
            <div style={{ height: 3, borderRadius: 2, background: i <= step ? on : HAIRLINE_SOFT }} />
            <div style={{ fontSize: 11, marginTop: 6, color: i === step ? on : MUTED, fontWeight: i === step ? 700 : 500 }}>{l}</div>
          </div>
        ))}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{`Step ${step + 1} of 3: ${stepLabel[step]}`}</div>

      {spec.headline && step === 0 ? (
        <div style={{ fontFamily: th.serif, fontSize: 22, lineHeight: 1.25, marginBottom: 14 }}>{spec.headline}</div>
      ) : null}

      {/* ── STEP 1 · THE GIFT ───────────────────────────────────────────── */}
      {step === 0 && !upsellOpen ? (
        <>
          {spec.amount.frequencies.length > 1 ? (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {spec.amount.frequencies.map(f => (
                <button key={f} type="button" className="give-freq" data-freq={f}
                  aria-pressed={frequency === f}
                  onClick={() => switchFrequency(f)}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer",
                           border: "1px solid " + (frequency === f ? on : HAIRLINE),
                           background: frequency === f ? on : "transparent",
                           color: frequency === f ? onFg : "inherit", fontWeight: 600, fontSize: 14 }}>
                  {f === "monthly" ? "Monthly" : "One time"}
                </button>
              ))}
            </div>
          ) : null}

          {spec.amount.amountsCents.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginBottom: 10 }}>
              {spec.amount.amountsCents.map(c => (
                <button key={c} type="button" className="give-amt" data-cents={c}
                  aria-pressed={!isCustom && amountCents === c}
                  onClick={() => { setIsCustom(false); setAmountCents(c); }}
                  style={{ padding: "12px 0", borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 700,
                           border: "1px solid " + (!isCustom && amountCents === c ? on : HAIRLINE),
                           background: !isCustom && amountCents === c ? on : "transparent",
                           color: !isCustom && amountCents === c ? onFg : "inherit" }}>
                  {fmtCents(c)}
                </button>
              ))}
            </div>
          ) : null}

          {spec.amount.allowOther ? (
            <div style={{ marginBottom: 12 }}>
              <button type="button" className="give-other" onClick={() => setIsCustom(true)}
                style={{ ...quiet, display: isCustom ? "none" : "inline-block" }}>Another amount</button>
              {isCustom ? (
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Your amount</span>
                  <input className="give-custom" inputMode="decimal" value={customAmt}
                    onChange={e => setCustomAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0.00" style={{ ...inp, marginTop: 4 }} />
                </label>
              ) : null}
            </div>
          ) : null}

          {spec.designation.mode === "choice" ? (
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Where should it go?</span>
              <select className="give-fund" value={fundId} onChange={e => setFundId(e.target.value)} style={{ ...inp, marginTop: 4 }}>
                <option value="">Choose…</option>
                {spec.designation.options.map(o => <option key={o.fundId} value={o.fundId}>{o.fundName}</option>)}
              </select>
            </label>
          ) : null}
          {spec.designation.mode === "fixed" && spec.designation.fundName ? (
            <div className="give-fixed-fund" style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
              Your gift goes to {spec.designation.fundName}.
            </div>
          ) : null}

          {stepErr ? <div className="give-err" style={{ fontSize: 13, color: ERR, marginBottom: 10 }}>{stepErr}</div> : null}
          <button type="button" className="give-next" onClick={goFromAmount} style={btn}>Continue</button>
        </>
      ) : null}

      {/* ── THE UPSELL, ASKED ONCE ──────────────────────────────────────── */}
      {upsellOpen ? (
        <div className="give-upsell">
          <div style={{ fontFamily: th.serif, fontSize: 21, lineHeight: 1.3, marginBottom: 8 }}>
            Could this be {fmtCents(upsell.monthlyCents)} a month instead?
          </div>
          <div style={{ fontSize: 14, color: MUTED, marginBottom: 16 }}>
            {upsellSentence(upsell, fmtCents)}
          </div>
          <button type="button" className="give-upsell-yes" onClick={acceptUpsell} style={btn}>
            Yes, make it {fmtCents(upsell.monthlyCents)} monthly
          </button>
          <button type="button" className="give-upsell-no" onClick={declineUpsell}
            style={{ ...quiet, display: "block", marginTop: 12 }}>
            No, give {fmtCents(chosenCents)} once
          </button>
        </div>
      ) : null}

      {/* ── STEP 2 · ABOUT YOU ─────────────────────────────────────────── */}
      {step === 1 ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <label style={{ flex: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>First name</span>
              <input className="give-first" value={firstName} onChange={e => setFirstName(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
            <label style={{ flex: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>Last name</span>
              <input className="give-last" value={lastName} onChange={e => setLastName(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
          </div>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
            <input className="give-email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ ...inp, marginTop: 4 }} />
            <span style={{ fontSize: 12, color: MUTED }}>Your receipt goes here.</span>
          </label>

          {spec.details.tribute ? (
            <div className="give-tribute" style={{ marginBottom: 10 }}>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Is this gift in someone's honour?</span>
                <select className="give-tribute-type" value={tributeType} onChange={e => setTributeType(e.target.value)} style={{ ...inp, marginTop: 4 }}>
                  <option value="">No</option>
                  <option value="honor">In honour of</option>
                  <option value="memory">In memory of</option>
                </select>
              </label>
              {tributeType ? (
                <>
                  <label style={{ display: "block", marginTop: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Their name</span>
                    <input className="give-tribute-name" value={tributeName} onChange={e => setTributeName(e.target.value)} style={{ ...inp, marginTop: 4 }} />
                  </label>
                  {/* OPTIONAL, and it stays optional: a donor may dedicate a gift
                      without telling a family about it, and Steward never sends
                      this — it writes a draft somebody at the org reads first. */}
                  <label style={{ display: "block", marginTop: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Should we let someone know? (optional)</span>
                    <input className="give-notify-name" value={notifyName} placeholder="Their name"
                      onChange={e => setNotifyName(e.target.value)} style={{ ...inp, marginTop: 4 }} />
                  </label>
                  {notifyName ? (
                    <label style={{ display: "block", marginTop: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Their email</span>
                      <input className="give-notify-email" type="email" value={notifyEmail}
                        onChange={e => setNotifyEmail(e.target.value)} style={{ ...inp, marginTop: 4 }} />
                      <span style={{ fontSize: 12, color: MUTED }}>Someone at the organisation writes to them; this is never sent automatically.</span>
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {spec.details.employerMatch ? (
            <label className="give-employer-wrap" style={{ display: "block", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Where do you work?</span>
              <input className="give-employer" value={employer} onChange={e => setEmployer(e.target.value)} style={{ ...inp, marginTop: 4 }} />
              <span style={{ fontSize: 12, color: MUTED }}>Many employers match their staff's giving.</span>
            </label>
          ) : null}

          {spec.details.questions.map(q => (
            <label key={q.key} className="give-question" data-key={q.key} style={{ display: "block", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{q.label}</span>
              {q.type === "choice" ? (
                <select value={answers[q.key] || ""} onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))} style={{ ...inp, marginTop: 4 }}>
                  <option value="">Choose…</option>
                  {q.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : q.type === "yesno" ? (
                <span style={{ display: "block", marginTop: 4 }}>
                  <input type="checkbox" checked={answers[q.key] === true}
                    onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.checked }))} /> Yes
                </span>
              ) : (
                <input value={answers[q.key] || ""} onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))} style={{ ...inp, marginTop: 4 }} />
              )}
            </label>
          ))}

          {stepErr ? <div className="give-err" style={{ fontSize: 13, color: ERR, marginBottom: 10 }}>{stepErr}</div> : null}
          <button type="button" className="give-next" onClick={goFromDetails} style={btn}>Continue</button>
          <button type="button" className="give-back" onClick={() => { setStep(0); setStepErr(""); }} style={{ ...quiet, display: "block", marginTop: 10 }}>Back</button>
        </>
      ) : null}

      {/* ── STEP 3 · PAYMENT ───────────────────────────────────────────── */}
      {step === 2 ? (
        <>
          <div className="give-summary" style={{ fontSize: 15, marginBottom: 6 }}>
            <strong>{fmtCents(chargedCents)}</strong>{frequency === "monthly" ? " every month" : ""}
            {spec.designation.mode === "fixed" && spec.designation.fundName ? ` to ${spec.designation.fundName}` : ""}
            {spec.designation.mode === "choice" && fundId
              ? ` to ${(spec.designation.options.find(o => o.fundId === fundId) || {}).fundName || ""}` : ""}
          </div>
          {frequency === "monthly" ? (
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
              {fmtCents(chargedCents * 12)} over a year. You can change or stop it any time.
            </div>
          ) : null}

          {showCoverFees ? (
            <label className="give-cover" style={{ display: "block", fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={coverFees} onChange={e => setCoverFees(e.target.checked)} />{" "}
              Add {fmtCents(feeCents)} to cover the card fee, so all of {fmtCents(chosenCents)} reaches us.
            </label>
          ) : null}

          {/* NO CARD FIELD LIVES HERE, EVER. Payment happens on Stripe's own
              page on the org's connected account, which is also where Apple Pay
              and Google Pay come from on a device that has them. */}
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
            You will finish on Stripe's secure page, where you can pay by card, Apple Pay or Google Pay.
          </div>
          {submitErr ? <div className="give-err" style={{ fontSize: 13, color: ERR, marginBottom: 10 }}>{submitErr}</div> : null}
          <button type="button" className="give-pay" onClick={submit} disabled={submitting} style={{ ...btn, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Taking you to Stripe…" : `Give ${fmtCents(chargedCents)}${frequency === "monthly" ? " a month" : ""}`}
          </button>
          <button type="button" className="give-back" onClick={() => { setStep(1); setStepErr(""); }} style={{ ...quiet, display: "block", marginTop: 10 }}>Back</button>
        </>
      ) : null}

      <div className="give-trust" style={{ fontSize: 12, color: MUTED, marginTop: 16, lineHeight: 1.5 }}>
        {spec.trustLine}
      </div>
    </div>
  );
}
