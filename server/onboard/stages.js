// server/onboard/stages.js · ONBOARD-2. THE ONBOARDING STAGE MODEL (pure).
//
// A customer counts when they are billing, and the stretch from a yes to
// billing is onboarding. Five stages, each a GATE read from real signals:
//
//   1 paper        a signature AND a card on file (orgs.paper_done_at, ONBOARD-1)
//   2 data         the customer accepted the import (orgs.data_in_at, ONBOARD-1)
//   3 connections  Stripe Connect charges_enabled on the org's own account, a
//                  giving page Live with the org's name and logo, and each
//                  source the org named connected or kept as a monthly statement
//   4 kickoff      the champion signed in, opened Home, and logged a call or
//                  note from a Steward move
//   5 first_month  a first gift recorded or synced through Steward, and the
//                  first invoice paid on an active subscription
//
// then `billing`. The stage is the first gate not met. NOTHING HERE READS A
// STAGE SOMEONE TYPED: the only hand-entered facts are the verbal-yes date
// (which starts the paper clock) and "Waiting on" (words, shown, never a gate).
//
// The red windows (Jonathan's): paper over 3 days from the verbal yes, data
// over 10 days from paper, kickoff over 7 days from data in. The first month
// has its own check: day 14 from data in with no first gift is flagged, and a
// failed payment is flagged; neither goes to the customer.
"use strict";

const DAY = 86400000;
const STAGES = ["paper", "data", "connections", "kickoff", "first_month"];
const ALL = [...STAGES, "billing"];
const TITLE = { paper: "Paper", data: "Data in", connections: "Connections", kickoff: "Kickoff", first_month: "First month", billing: "Billing" };
const WINDOW_DAYS = { paper: 3, data: 10, kickoff: 7 };
const FIRST_GIFT_DAY = 14;

const t = v => (v ? new Date(v).getTime() : null);
const iso = v => (v ? new Date(v).toISOString() : null);
const maxIso = (...v) => { const n = v.map(t).filter(Number.isFinite); return n.length ? new Date(Math.max(...n)).toISOString() : null; };
const daysSince = (at, now) => (at ? Math.max(0, Math.floor((now - t(at)) / DAY)) : null);
const dayOf = v => (v ? iso(v).slice(0, 10) : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Nov 1, 2026": a day in words (the instant's UTC day, the same day the board's dates use).
// The org's own day for an instant (a gift at 9 PM in New York is still that day).
let TZ = "America/New_York";
const civil = (v, tz = TZ) => { if (!v) return null; const d = new Date(v); if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); };
const words = v => { const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : civil(v); if (!d) return null;
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`; };

// Sources the org names (setup's "How you take gifts") and what connects each.
// `checks` needs no connection (a cheque is recorded by hand); `other` names nothing.
const SOURCE_NAMES = { stripe: "Stripe", paypal: "PayPal", zeffy: "Zeffy", givebutter: "Givebutter", square: "Square", quickbooks: "QuickBooks" };

// One org's facts (signals.js) -> each gate with its evidence.
function gates(f) {
  const g = {};
  g.paper = { met: !!f.paperDoneAt, at: iso(f.paperDoneAt),
    evidence: f.signature ? `Signed by ${f.signature.name}${f.signature.title ? `, ${f.signature.title}` : ""}, ${words(f.signature.at)}` : (f.paperDoneAt ? "Signed and a card on file" : null),
    card: f.cardOnFile ? `Card on file${f.cardLast4 ? ` ending ${f.cardLast4}` : ""}` : null };
  g.data = { met: !!f.dataInAt, at: iso(f.dataInAt),
    evidence: f.dataInAt ? `Import accepted ${words(f.dataInAt)}${f.importFooting ? `: ${f.importFooting}` : ""}` : (f.stagedAt ? `Import staged ${words(f.stagedAt)}, not accepted yet` : null) };

  // Connections: every part must hold; the gate's date is the last part's.
  const parts = [];
  parts.push({ key: "stripe", label: "Stripe Connect", ok: !!f.stripeOkAt, at: iso(f.stripeOkAt),
    says: f.stripeOkAt ? "Charges are on, on the org's own Stripe account" : f.stripeAccount ? "Started, but Stripe has not turned charges on" : "Not connected" });
  parts.push({ key: "page", label: "Giving page", ok: !!(f.pageLiveAt && f.hasLogo), at: f.pageLiveAt && f.hasLogo ? iso(f.pageLiveAt) : null,
    says: !f.pageLiveAt ? "No giving page is live" : !f.hasLogo ? "Live, but without the org's logo" : `Live with ${f.name}'s name and logo` });
  for (const s of f.namedSources || []) {
    if (s === "stripe" || s === "checks" || s === "other" || !SOURCE_NAMES[s]) continue;   // Stripe is the part above
    const live = (f.connected || {})[s];
    parts.push({ key: `source:${s}`, label: SOURCE_NAMES[s], ok: !!live, at: iso(live), says: live ? "Connected" : "Named at setup, not connected" });
  }
  for (const name of f.statementSources || []) parts.push({ key: `statement:${name.toLowerCase()}`, label: name, ok: true, at: null, says: "Statement monthly" });
  const allOk = parts.every(p => p.ok);
  g.connections = { met: allOk, at: allOk ? maxIso(...parts.map(p => p.at)) : null, parts };

  const k = f.kickoff || {};
  g.kickoff = { met: !!(k.signedInAt && k.homeAt && k.loggedAt), at: k.signedInAt && k.homeAt && k.loggedAt ? maxIso(k.signedInAt, k.homeAt, k.loggedAt) : null,
    parts: [
      { key: "signin", label: "Signed in", ok: !!k.signedInAt, at: iso(k.signedInAt), says: k.signedInAt ? `${k.who || "The champion"} signed in ${words(k.signedInAt)}` : "No sign-in yet" },
      { key: "home", label: "Opened Home", ok: !!k.homeAt, at: iso(k.homeAt), says: k.homeAt ? `Opened Home ${words(k.homeAt)}` : "Has not opened Home" },
      { key: "call", label: "Logged a call from a move", ok: !!k.loggedAt, at: iso(k.loggedAt), says: k.loggedAt ? `First call logged ${words(k.loggedAt)}${k.loggedOn ? ` (${k.loggedOn})` : ""}` : "No call or note logged from a move" },
    ] };

  const paid = f.firstPaidAt && f.subscriptionStatus === "active";
  g.first_month = { met: !!(f.firstGiftAt && paid), at: f.firstGiftAt && paid ? maxIso(f.firstGiftAt, f.firstPaidAt) : null,
    parts: [
      { key: "gift", label: "First gift through Steward", ok: !!f.firstGiftAt, at: iso(f.firstGiftAt), says: f.firstGiftAt ? `First gift ${words(f.firstGiftAt)}` : "No gift recorded or synced yet" },
      { key: "paid", label: "First invoice paid", ok: !!paid, at: paid ? iso(f.firstPaidAt) : null,
        says: paid ? `Paid ${words(f.firstPaidAt)}` : f.paymentFailed ? "The payment failed" : f.firstChargeOn ? `First charge ${words(f.firstChargeOn)}` : "No charge scheduled" },
    ] };
  return g;
}

// The whole answer for one org at `now` (ms). `manual` = { verbalYesOn, waitingOn }.
function compute(f, now, manual = {}) {
  TZ = f.tz || "America/New_York";
  const g = gates(f);
  for (const k of STAGES) g[k].day = civil(g[k].at);   // the day each gate was met, in the org's time zone
  const stage = STAGES.find(s => !g[s].met) || "billing";
  const idx = ALL.indexOf(stage);
  // Entered each stage when every gate before it was met (signals can land
  // out of order; the stage still moves only forward through the gates).
  const entered = {};
  entered.paper = manual.verbalYesOn ? `${manual.verbalYesOn}T12:00:00.000Z` : iso(f.createdAt);
  for (let i = 1; i < ALL.length; i++) {
    const before = STAGES.slice(0, i);
    entered[ALL[i]] = before.every(s => g[s].met) ? maxIso(...before.map(s => g[s].at)) : null;
  }
  const since = entered[stage];
  const days = daysSince(since, now);

  // Red: past the stage's window. Paper's clock is the verbal yes alone.
  let red = false, redWhy = null;
  if (stage === "paper" && manual.verbalYesOn) {
    const d = daysSince(`${manual.verbalYesOn}T12:00:00.000Z`, now);
    if (d > WINDOW_DAYS.paper) { red = true; redWhy = `Paper is ${d} days from the verbal yes; the window is ${WINDOW_DAYS.paper}.`; }
  }
  // Data counts from paper and kickoff from data in, whatever else landed in between
  // (a kickoff that waited on Stripe is still a kickoff that never ran).
  const fromPaper = daysSince(f.paperDoneAt, now), fromData = daysSince(f.dataInAt, now);
  if (stage === "data" && fromPaper > WINDOW_DAYS.data) { red = true; redWhy = `Data is ${fromPaper} days from paper; the window is ${WINDOW_DAYS.data}.`; }
  if (stage === "kickoff" && fromData > WINDOW_DAYS.kickoff) { red = true; redWhy = `Kickoff is ${fromData} days from data in; the window is ${WINDOW_DAYS.kickoff}.`; }

  // The first-month checks: day 14 from data in with no first gift, a failed payment.
  const flags = [];
  const dayN = daysSince(f.dataInAt, now);
  if (f.dataInAt && !f.firstGiftAt && dayN >= FIRST_GIFT_DAY) flags.push({ key: "no_first_gift", says: `Day ${dayN} since data in and no first gift through Steward.` });
  if (f.paymentFailed) flags.push({ key: "payment_failed", says: "The Steward payment failed. Settings shows her the update-card link; nothing is locked." });
  if (flags.length && stage !== "billing") red = true;
  if (flags.length && !redWhy) redWhy = flags[0].says;

  const blockers = [];
  for (const s of STAGES) if (!g[s].met) for (const p of (g[s].parts || [])) if (!p.ok) blockers.push(`${TITLE[s]}: ${p.label}, ${p.says.charAt(0).toLowerCase()}${p.says.slice(1)}`);

  // The Days column counts on the same clock as the stage's window, so "late"
  // never sits beside "0 days": paper from the verbal yes, data from paper,
  // kickoff and the first month from data in.
  const clock = stage === "paper" ? (manual.verbalYesOn ? daysSince(`${manual.verbalYesOn}T12:00:00.000Z`, now) : days)
    : stage === "data" ? fromPaper : stage === "kickoff" || stage === "first_month" ? fromData : days;
  return { stage, stageIndex: idx, title: TITLE[stage], enteredAt: entered, daysInStage: clock, red, redWhy, flags,
    gates: g, blockers, next: nextAction(stage, g, f, days, manual, now) };
}

// The next action, in Jonathan's words.
function nextAction(stage, g, f, days, manual, now) {
  if (stage === "paper") {
    // SALES-3: a signed quote is a signature with no start link; what's missing is the card.
    if (f.signature && !f.cardOnFile && (!f.startLink || f.startLink.signedAt)) return "Signed, no card yet: chase the card";
    if (!f.startLink) return "Send start link";
    if (f.startLink.status === "expired" || (f.startLink.expiresAt && t(f.startLink.expiresAt) < now && !f.startLink.signedAt)) return "The start link expired: send a new one";
    if (!f.startLink.signedAt) return `Chase the signature: link sent ${daysSince(f.startLink.createdAt, now)} days ago`;
    return "Signed, no card yet: chase the card";
  }
  if (stage === "data") {
    if (f.stagedAt) return `Ask her to check the import and press These match (staged ${words(f.stagedAt)})`;
    const d = daysSince(f.paperDoneAt, now);
    return `Chase the export: day ${d}${d >= 7 ? ", call today" : ""}`;
  }
  if (stage === "connections") {
    const miss = g.connections.parts.filter(p => !p.ok).map(p => p.label);
    return `Connect ${miss.join(", ")}`;
  }
  if (stage === "kickoff") {
    const k = g.kickoff.parts;
    if (!k[0].ok) return "Book kickoff";
    if (!k[1].ok) return "She has signed in but not opened Home: book kickoff";
    return "Kickoff: make the first call from her list together";
  }
  if (stage === "first_month") {
    if (f.paymentFailed) return "Payment failed: send the update-card link";
    if (!f.firstGiftAt) return `No first gift yet: day ${daysSince(f.dataInAt, now)}, call her`;
    return f.firstChargeOn ? `Waiting on the first charge, ${words(f.firstChargeOn)}` : "No charge scheduled: check the price";
  }
  return "Billing";
}

module.exports = { words, civil, STAGES, ALL, TITLE, WINDOW_DAYS, FIRST_GIFT_DAY, SOURCE_NAMES, gates, compute, nextAction };
