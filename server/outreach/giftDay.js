// INPUT-1 item 4 · WHAT FOLLOWS A GIFT HAPPENS ON THE GIFT'S DAY.
//
// A gift dated after today is scheduled (TRUTH-6, gifts.scheduled_on): it
// counts nowhere until its day. What follows a gift did not wait: a gift dated
// three weeks ahead got its thank-you draft and its "Thank" task the moment it
// was typed (Jarvis's sweep, 25 Nov), thanking a donor for money that has not
// come. Now the steps that speak to or about the donor (the thank-you draft,
// the gift's thread and its task, journeys, sequences) are HELD: each handler
// asks `held` first, which writes one row here and returns true. Once an hour
// `releaseDueHolds` puts every hold whose day has come back on the outbox as a
// gift.recorded event naming only the held steps (`only`), so each runs once,
// on its day, through the same handler and its same idempotency. The totals
// and the after-change step are not held: they already leave a scheduled gift
// out until its day (shared/numbers/scheduled.js, server/numbers/cameDue.js).
//
// A gift deleted before its day releases nothing. A gift whose date was moved
// later waits for the new day; moved to today or earlier, it is released on
// the next tick.
"use strict";

const ACTOR = { id: "system:gift-day", name: "Steward (on the gift's day)" };

async function today(deps, orgId) {
  return deps.orgToday(await deps.orgTz(orgId));   // ORG_TZ_SEAM_OK
}

// True when this step must wait for the gift's day (and the wait is written).
async function held(p, deps, handler) {
  if (!p || !p.giftId || p.dayCame === true) return false;
  const [g] = await deps.query(`SELECT scheduled_on FROM gifts WHERE id = ? AND org_id = ?`, [p.giftId, p.orgId]);
  if (!g || !g.scheduled_on) return false;
  if (String(g.scheduled_on) <= await today(deps, p.orgId)) return false;
  const { eventId, orgId, donorIds, ready, only, ...payload } = p;
  await deps.query(
    `INSERT INTO gift_day_holds (gift_id, org_id, handler, due_on, payload, created_by, created_by_name)
     VALUES (?,?,?,?,?::jsonb,?,?) ON CONFLICT (gift_id, handler) DO NOTHING`,
    [p.giftId, p.orgId, handler, String(g.scheduled_on), JSON.stringify(payload), ACTOR.id, ACTOR.name]);
  return true;
}

// The hourly tick. Returns how many gifts' steps were put back on the outbox.
async function releaseDueHolds(deps, { orgId = null } = {}) {
  const OUTBOX = require("../shared/outbox");
  const orgs = await deps.query(
    `SELECT DISTINCT org_id FROM gift_day_holds
      WHERE released_at IS NULL AND due_on <= to_char(CURRENT_DATE + 1, 'YYYY-MM-DD') AND (?::text IS NULL OR org_id = ?)`,
    [orgId, orgId]);
  let released = 0;
  for (const { org_id } of orgs) {
    const t = await today(deps, org_id);
    const rows = await deps.query(
      `SELECT h.gift_id, h.handler, h.payload, h.due_on, g.id AS live, g.scheduled_on
         FROM gift_day_holds h LEFT JOIN gifts g ON g.id = h.gift_id AND g.org_id = h.org_id
        WHERE h.org_id = ? AND h.released_at IS NULL AND h.due_on <= ?`, [org_id, t]);
    const byGift = new Map();
    for (const r of rows) {
      if (!r.live) { await deps.query(`UPDATE gift_day_holds SET released_at = NOW() WHERE gift_id = ? AND handler = ?`, [r.gift_id, r.handler]); continue; }
      if (r.scheduled_on && String(r.scheduled_on) > t) {   // moved later: wait for the new day
        await deps.query(`UPDATE gift_day_holds SET due_on = ? WHERE gift_id = ? AND handler = ?`, [String(r.scheduled_on), r.gift_id, r.handler]);
        continue;
      }
      if (!byGift.has(r.gift_id)) byGift.set(r.gift_id, { payload: r.payload, only: [] });
      byGift.get(r.gift_id).only.push(r.handler);
    }
    for (const [giftId, h] of byGift) {
      const payload = typeof h.payload === "string" ? JSON.parse(h.payload) : (h.payload || {});
      const ev = OUTBOX.rowFor(org_id, "gift.recorded", { ...payload, giftId, dayCame: true, only: h.only },
        { donorIds: [payload.donorId], ready: true, actor: ACTOR, id: `ev_day_${giftId}`.slice(0, 64) });
      const ins = await deps.query(
        `INSERT INTO events_outbox (id, org_id, type, payload, donor_ids, ready, created_by, created_by_name)
         VALUES (?,?,?,?::jsonb,?::text[],?,?,?) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [ev.id, ev.orgId, ev.type, ev.payload, ev.donorIds, true, ACTOR.id, ACTOR.name]);
      await deps.query(`UPDATE gift_day_holds SET released_at = NOW() WHERE gift_id = ? AND handler = ANY(?::text[]) AND released_at IS NULL`, [giftId, h.only]);
      if (ins.length) {
        released++;
        // The server relays it now; a process with no handlers (a script, a test) leaves it to the server's sweep.
        if ((OUTBOX.handlers.get("gift.recorded") || []).length) OUTBOX.relaySoon(ev.id);
      }
    }
  }
  return { released };
}

module.exports = { held, releaseDueHolds, ACTOR };
