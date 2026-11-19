// server/onboard/firstSession.js · ONBOARD-3 item 2. "YOUR FIRST 30 MINUTES".
//
// The first time a director opens Home after "Looks right", Home opens on
// three steps, on one screen:
//   1. People worth a call before December 31 (or the fiscal year's end when
//      that is sooner): up to ten, in the order Home's moves show them, each
//      with the reason line Home already wrote. No new ranking: the list is
//      movesInHomeOrder over the same deck Home draws (insightsFor).
//   2. Connect how gifts come in: Stripe and QuickBooks, each in its real state
//      (ONBOARD-2's signals: Stripe's own charges_enabled, an active books link).
//   3. Make one call or write one note now: Log a touch from the list, which is
//      what ONBOARD-2's kickoff gate reads (interactions.metadata.from_move).
// Step 1 is done once the list has been shown. When all three are done the
// screen says so once, and Home returns to normal. Dismissed, it comes back
// from Home until it is done.
"use strict";
const FY = require("../../shared/numbers/fiscalYear");
const SIGNALS = require("./signals");
const { lastGifts } = require("../../shared/numbers/lastGift");

const LIST_MAX = 10;
const ACTOR = "system:onboard/first-session";

// Home's moves, in Home's order: the open tab first, then the rest, one row per
// person. The one picker for "Who to call tomorrow" (5) and this list (10).
function movesInHomeOrder(deck, max) {
  if (!deck || !Array.isArray(deck.tabs)) return [];
  const tabs = [...deck.tabs.filter(t => t.key === deck.open), ...deck.tabs.filter(t => t.key !== deck.open)];
  const seen = new Set(), picks = [];
  for (const t of tabs) for (const m of t.moves || []) {
    if (!m.lead || seen.has(m.lead) || picks.length >= max) continue;
    seen.add(m.lead); picks.push(m);
  }
  return picks;
}

// December 31, or the last day of the fiscal year when that comes first.
function deadline(org, today) {
  const dec31 = `${today.slice(0, 4)}-12-31`;
  const fyEnd = FY.yearStarting(FY.startYearOf(today, FY.startMonth(org)), FY.startMonth(org)).end;
  return fyEnd < dec31 ? { day: fyEnd, why: "the end of your fiscal year" } : { day: dec31, why: "December 31" };
}

async function stateRow(query, orgId) {
  const [r] = await query(`SELECT seen_at, dismissed_at, done_at, done_told_at FROM onboard_first_session WHERE org_id = ?`, [orgId]);
  return r || null;
}
async function ensure(run, orgId, who) {
  await run(`INSERT INTO onboard_first_session (org_id, created_by, created_by_name) VALUES (?,?,?) ON CONFLICT (org_id) DO NOTHING`,
    [orgId, who.id || ACTOR, who.name || "Steward"]);
}

// Is it Home's first screen right now? After "Looks right", until "done" was said.
async function active(query, orgId) {
  const [o] = await query(`SELECT o.data_in_at, (SELECT 1 FROM onboard_totals_checks c WHERE c.org_id = o.id LIMIT 1) AS checked
      FROM orgs o WHERE o.id = ?`, [orgId]);
  if (!o || !o.data_in_at || !o.checked) return false;
  const s = await stateRow(query, orgId);
  return !(s && s.done_told_at);
}

async function read({ query, run }, org, today, insightsFor) {
  const orgId = org.id;
  const s = (await stateRow(query, orgId)) || {};
  const facts = (await SIGNALS.readFacts(query, [orgId]))[orgId] || {};
  const got = await insightsFor(orgId, today);
  const preparing = !!(got.preparing || !got.result || !got.result.deck);
  const picks = preparing ? [] : movesInHomeOrder(got.result.deck, LIST_MAX);
  const last = await lastGifts(query, orgId, picks.map(m => m.lead));
  const dl = deadline(org, today);
  const stripe = facts.stripeOkAt ? { state: "connected", words: "Stripe is connected and taking gifts." }
    : facts.stripeAccount ? { state: "started", words: "Stripe is started, not yet taking gifts: finish its questions." }
      : { state: "none", words: "Not connected." };
  const qbAt = (facts.connected || {}).quickbooks;
  const quickbooks = qbAt ? { state: "connected", words: "QuickBooks is connected." } : { state: "none", words: "Not connected." };
  const k = facts.kickoff || {};
  const steps = [
    { id: "list", done: !!s.seen_at, words: `People worth a call before ${dl.day}` },
    { id: "connect", done: stripe.state === "connected" || quickbooks.state === "connected", words: "Connect how gifts come in" },
    { id: "touch", done: !!k.loggedAt, words: "Make one call or write one note now" },
  ];
  const allDone = steps.every(x => x.done);
  if (allDone && !s.done_at) {
    await ensure(run, orgId, {});
    await run(`UPDATE onboard_first_session SET done_at = NOW() WHERE org_id = ? AND done_at IS NULL`, [orgId]);
  }
  return {
    show: !s.done_told_at, dismissed: !!s.dismissed_at && !allDone, allDone, preparing,
    deadline: dl, steps, doneCount: steps.filter(x => x.done).length,
    people: picks.map(m => ({ id: m.lead, name: m.name, why: m.why || null, what: m.what || null, label: m.label || null, lastGift: last.get(m.lead) || null })),
    sentence: `Up to ${LIST_MAX} people from your moves on Home, in the order Home shows them, each with the reason Home gives.`,
    connections: { stripe, quickbooks },
    touch: k.loggedAt ? { at: k.loggedAt, by: k.loggedOn || null } : null,
  };
}

async function mark({ run }, orgId, what, who) {
  await ensure(run, orgId, who);
  const col = { seen: "seen_at = COALESCE(seen_at, NOW())", dismiss: "dismissed_at = NOW()", reopen: "dismissed_at = NULL",
    told: "done_told_at = COALESCE(done_told_at, NOW())" }[what];
  if (!col) return false;
  await run(`UPDATE onboard_first_session SET ${col} WHERE org_id = ?${what === "told" ? " AND done_at IS NOT NULL" : ""}`, [orgId]);
  return true;
}

module.exports = { movesInHomeOrder, deadline, active, read, mark, LIST_MAX };
