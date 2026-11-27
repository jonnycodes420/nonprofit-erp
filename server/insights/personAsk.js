// server/insights/personAsk.js · ONE-MOVE-1 item 1. ONE ASK PER PERSON, THE SAME ON EVERY SCREEN.
//
// 27 Nov: Home said "Ask $50,000: largest gift $50,000, last 3 averaged $25,000" for a lapsing
// $10,000 donor while her profile's Next move said "No money ask", and the Giving tab said
// "Suggested one-time ask: $50,000". Three engines: the Insights deck (Home, the Activity
// banner), engagement.suggestedAsk (the Giving tab, /threads rows) and profileStatus's ladder.
//
// Now the ask is the person's one move's ask (insights.js nextMoveFor, the lead Home shows),
// read from the stored Insights once per call. A move that asks no money (Planned) says so
// and gives no amount. Only a person with no move falls back to engagement.suggestedAsk,
// which also keeps the monthly ask ("ask about monthly giving") it alone sizes.
"use strict";
const I = require("../../insights");
const D = require("../../insightsData");

// The move's ask in engagement.suggestedAsk's shape, so every screen can show either.
function askOfMove(move) {
  const a = move && move.item && move.item.how && move.item.how.ask;
  if (!a) return null;
  if (a.cents == null) return { askCents: null, noAsk: true, sentence: a.words, rule: a.rule, monthly: false, from: "move", kind: move.kind };
  return { askCents: a.cents, sentence: a.words, rule: a.rule, monthly: false, from: "move", kind: move.kind, gift: a.gift || null };
}

// donorId -> the ask (or null), for several people, from one read of the org's Insights.
async function asksFor(query, orgId, donorIds, asOf) {
  const out = new Map();
  const got = await D.insightsFor(orgId, asOf).catch(() => ({ preparing: true }));
  if (got.preparing || !got.result) return { preparing: true, asks: out };
  for (const id of donorIds) {
    const m = I.nextMoveFor(got.result, id);
    if (m) out.set(id, { move: m, ask: askOfMove(m) });
  }
  return { preparing: false, asks: out };
}

// One person: the move's ask, else engagement's (the same call the screens made before).
async function askFor(query, orgId, donorId, asOf, fallback) {
  const { asks } = await asksFor(query, orgId, [donorId], asOf);
  const hit = asks.get(donorId);
  if (hit) return { ...hit, fromMove: true };
  return { move: null, ask: fallback ? await fallback() : null, fromMove: false };
}

module.exports = { asksFor, askFor, askOfMove };
