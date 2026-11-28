// server/connections/status.js · HONEST-1 item 1. ONE STATUS PER CONNECTION, COMPUTED ONCE.
//
// The sweep of 25 Nov found Connections saying "Connected" about doors nothing was coming
// through: Stripe "Connected" and "Healthy" while the giving pages were off and no donor could
// pay; QuickBooks "Connected" and "Healthy" with nothing ever sent and 273 gifts waiting behind
// two unmapped funds. "Connected" answered whether a key was on file. A person reading it asks
// a different question: is anything flowing?
//
// So every connection card carries one `flow`, from THIS function, and the card's badge, the
// Settings detail, the summary line over the page and the line on Home all read it. Four states:
//
//   working        something flowed, and the line says what and when
//   waiting        connected, but nothing has flowed yet, and the line says what is missing
//   needs_you      a person has to do one thing, and the step says which
//   not_connected  Steward is not reading it (or, `unavailable`, it cannot be connected yet)
//
// Pure: the card (routes/give.js → server/connections/cards.js built it) and a few facts in,
// one object out. No DB, no clock, no JSX. The client shows `flow`; it never recomputes it.
"use strict";

const STATES = {
  working: { label: "Working", definition: "Something came through it recently. The line says what and when." },
  waiting: { label: "Connected, nothing flowing yet", definition: "It is connected, but nothing has come through it yet. The line says what is missing." },
  needs_you: { label: "Needs you", definition: "Something has stopped or is stuck, and one step from a person starts it again." },
  not_connected: { label: "Not connected", definition: "Steward is not reading this one." },
  unavailable: { label: "Not available yet", definition: "Steward cannot connect to this one yet." },
};
// HONEST-2 item 1 (W-1126-Integrations-01): in the demo, a connection is a made-up example and
// connecting is off, so its badge says that, never "Connected" or "Working". Its line still tells the
// example's story (the demo shows what a real account would see), after the word Example.
const EXAMPLE = { label: "Example", sentence: "Example: connecting is off in the demo.",
  definition: "A made-up connection in the demo. Connecting is off in the demo, so nothing real comes through it." };

const plural = (n, one, many = one + "s") => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;
const money = cents => "$" + (Math.round(Number(cents) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const list = xs => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const agoWords = days => days == null ? "" : days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
const daysSince = (date, today) => {
  const d = String(date || "").slice(0, 10), t = String(today || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return Math.max(0, Math.round((Date.parse(t + "T00:00:00Z") - Date.parse(d + "T00:00:00Z")) / 86400000));
};

// The usual rhythm, said the way a person would: "Usually about 5.6 a week." for a busy door,
// "Usually one every 9 days." for a slow one. From shared/connections.js rhythmOf.
function usualWords(rhythm, noun = "gift") {
  if (!rhythm || rhythm.meanGapDays == null) return "";
  const per = rhythm.perWeek == null ? null : Math.round(rhythm.perWeek * 10) / 10;
  if (per != null && per >= 1) return `Usually about ${per} a week.`;
  return `Usually one every ${Math.max(1, Math.round(rhythm.meanGapDays))} days.`;
}

// The quiet sentence, ONE wording for the card, Home and the task (item 2).
// HONEST-4 item 6: a sentence that is STORED (a task's title) names the day it went quiet, never a
// count of days, which would be wrong tomorrow: Givebutter read 69 days on Settings, 68 on Home and 67
// on the task written two days before. Live surfaces count from the org's own today; stored ones say since.
const sinceWords = d => { const t = new Date(String(d).slice(0, 10) + "T12:00:00Z");
  return isNaN(t) ? "" : t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
function quietSentence({ label, silentDays, rhythm, noun = "gift", lastDate = null, stored = false }) {
  if (stored && lastDate) return `${label} hasn't sent a ${noun} since ${sinceWords(lastDate)}. ${usualWords(rhythm, noun)}`.trim();
  return `${label} hasn't sent a ${noun} in ${silentDays} days. ${usualWords(rhythm, noun)}`.trim();
}

const step = (label, to) => ({ label, to });
const out = (state, sentence, extra = {}) => ({ state, label: STATES[state].label, definition: STATES[state].definition, sentence, ...extra });

/**
 * The one status of one connection card.
 * @param card  a card from buildConnectionCards (kind, provider, connected, status, …)
 * @param facts { today, oauthReady?: boolean|null, qbo?: { pendingCount, pendingCents, gapFunds, noDeposit, sentEver, lastSentAt, figureSource } }
 */
function flowOf(card, facts = {}) {
  const f = flowOfReal(card, facts);
  if (!facts.demo || !card.connected || card.kind === "statements") return f;
  return { ...f, example: true, label: EXAMPLE.label, definition: EXAMPLE.definition,
    sentence: `${EXAMPLE.sentence} ${f.sentence || ""}`.trim() };
}
function flowOfReal(card, facts = {}) {
  const { today = null } = facts;
  const focus = card.kind === "own_stripe" ? "stripe" : card.kind === "statements" ? "statements" : card.provider;
  const check = label => step(label, { section: "connections", focus });

  if (!card.connected) {
    if (card.oauthProvider && facts.oauthReady === false)
      return out("unavailable", `${card.label} isn't available in Steward yet.`, { step: { label: "Tell us you need it", ask: card.provider } });
    return out("not_connected", card.sentence || STATES.not_connected.definition);
  }
  if (card.status === "broken")
    return out("needs_you", String(card.sentence || "The last check failed."), { step: check("Fix it") });

  // ── STRIPE: two halves. The pages take gifts only when Stripe is set up for them. ────────
  if (card.kind === "own_stripe") {
    if (card.takesGifts === false)
      return out("waiting", "Connected, but giving pages are off, so no one can give yet.",
        { step: step("Turn on giving pages", { section: "connections", focus: "stripe" }), lastFlow: lastGift(card, today) });
  }

  // ── QUICKBOOKS: what is waiting to go, and what is stopping it. ──────────────────────────
  // HONEST-4 item 2: the headline is the waiting count and dollars; each reason after it is its own
  // sentence and a link to the control that fixes it (`fixes`, the panel's anchors). A pause leads.
  if (card.kind === "bookkeeping" && card.provider === "quickbooks" && facts.qbo) {
    const q = facts.qbo;
    const fixes = [];
    const fix = (words, anchor) => fixes.push({ words, anchor });
    if (q.paused) fix(`Needs attention: ${q.paused.words}.`, "qbo-try-again");
    if (q.autoSync === false && (q.pendingCount || !q.sentEver)) fix("Auto-sync is off.", "qbo-auto");
    if (q.gapFunds && q.gapFunds.length) fix(`${plural(q.gapFunds.length, "fund")} ${q.gapFunds.length === 1 ? "isn't" : "aren't"} mapped (${list(q.gapFunds)}).`, "qbo-map-open");
    if (q.noDeposit) fix("The account the money lands in isn't chosen.", "qbo-map-open");
    const head = q.pendingCount ? `${plural(q.pendingCount, "gift")} (${money(q.pendingCents)}) waiting.` : "Nothing is waiting.";
    const figure = q.pendingCount ? { value: q.pendingCents / 100, kind: "money", source: q.figureSource, count: q.pendingCount } : null;
    const sentence = [head, ...fixes.map(f => f.words)].join(" ");
    const extra = { figure, head, fixes };
    if (q.paused) return out("needs_you", sentence, { ...extra, step: step("Try again", { section: "connections", focus: "quickbooks" }) });
    const blocked = (q.gapFunds && q.gapFunds.length) || q.noDeposit;
    if (blocked) return out(q.sentEver ? "needs_you" : "waiting", sentence, { ...extra, step: step("Map them", { section: "connections", focus: "quickbooks" }) });
    if (!q.sentEver)
      return out("waiting", `${sentence} Everything is mapped; nothing has been sent yet.`,
        { ...extra, step: step("Send to QuickBooks", { section: "connections", focus: "quickbooks" }) });
    return out("working", `Last sent to QuickBooks ${agoWords(daysSince(q.lastSentAt, today))}. ${sentence}`,
      { ...extra, head: `Last sent to QuickBooks ${agoWords(daysSince(q.lastSentAt, today))}. ${head}`, lastFlow: { what: "sent to QuickBooks", at: q.lastSentAt } });
  }
  if (card.kind === "bookkeeping") {
    if (card.sends === false) return out("waiting", card.sentence || "Connected. Sending is not available yet.");
    if (card.lastSentAt) return out("working", `Last sent ${agoWords(daysSince(card.lastSentAt, today))}.`, { lastFlow: { what: "sent", at: card.lastSentAt } });
    return out("waiting", "Connected. Nothing has been sent yet.");
  }

  // ── THE EMAIL TOOL: an audience to read, and campaigns read back. ────────────────────────
  if (card.kind === "email_marketing") {
    if (!card.mapped)
      return out("waiting", `Connected, and reading nothing yet. Choose which ${card.audienceNoun || "audience"} to read from.`,
        { step: check(`Choose the ${card.audienceNoun || "audience"}`) });
    if (card.status === "quiet")
      return out("needs_you", card.sentence, { step: check("Check it") });
    return card.lastCampaignDate
      ? out("working", card.sentence, { lastFlow: { what: "campaign read back", at: card.lastCampaignDate } })
      : out("waiting", "Connected. Nothing has been sent from it yet, so there is nothing to read back.");
  }

  // ── A DOOR MONEY COMES IN THROUGH (sources, registers, files, Stripe) ────────────────────
  if (card.status === "quiet") {
    const noun = card.kind === "pos" ? "sale" : "gift";
    return out("needs_you", quietSentence({ label: card.label, silentDays: card.silentDays, rhythm: card.rhythm, noun }),
      { step: check("Check it"), silentDays: card.silentDays, lastFlow: lastGift(card, today) });
  }
  if (card.kind === "statements")
    return card.lastGiftDate
      ? out("working", `The last file was brought in ${agoWords(daysSince(card.lastGiftDate, today))}.`, { lastFlow: { what: "file brought in", at: card.lastGiftDate } })
      : out("not_connected", card.sentence);
  if (card.kind === "pos" && card.sales30)
    return out("working", card.sentence, { lastFlow: { what: "sale", at: card.lastGiftDate } });
  const last = lastGift(card, today);
  if (last)
    return out("working", `The last gift came through ${agoWords(last.days)}.${card.rhythm ? " " + usualWords(card.rhythm) : ""}`.trim(), { lastFlow: last });
  return out("waiting", "Connected. Nothing has come through it yet.");
}

function lastGift(card, today) {
  if (!card.lastGiftDate) return null;
  return { what: "gift", at: card.lastGiftDate, days: daysSince(card.lastGiftDate, today) };
}

// The summary over the page, from the flows alone, so it can never disagree with a card.
// HONEST-4 item 3: an example connection is not a connection, so no count includes it.
function summarize(cards) {
  const n = s => cards.filter(c => c.flow && c.flow.state === s && !c.example && !c.flow.example).length;
  const counts = { working: n("working"), waiting: n("waiting"), needs_you: n("needs_you") };
  const needs = cards.filter(c => c.flow && c.flow.state === "needs_you" && !c.example && !c.flow.example);
  return { counts,
    sentence: needs.length ? `${needs.length} ${needs.length === 1 ? "connection needs" : "connections need"} you: ${needs.map(c => c.label).join(", ")}.` : null };
}

module.exports = { STATES, EXAMPLE, flowOf, summarize, quietSentence, usualWords };
