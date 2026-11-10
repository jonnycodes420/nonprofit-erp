// recordGifts.js · IMPORT-7. THE ONE GIFT PATH, A BATCH AT A TIME.
//
// recordGift (server.js) is still the one way a gift is written. This is its
// batch form, for an import inside its own transaction: the same rules, the
// same columns, the same conflict key, the same event and timeline line and
// rollup, written as one multi-row statement each instead of fifteen round
// trips a gift. On prod (about 17 ms a statement) a 5,010-gift file took over
// an hour one gift at a time.
//
// What it does, in order, for up to a batch of gifts:
//   · each named fund is checked against the org once, a grant award's
//     restricted fund is read once, the unrestricted fund once (Rule 1);
//   · one INSERT for the gifts, ON CONFLICT on the idempotency key, so a row
//     already here is a duplicate and nothing of it is written again;
//   · the people it touched: person_types and the totals, one statement each
//     (donorSummary.js, recomputed, never added to);
//   · one timeline line per gift (Rule 2), one statement;
//   · a pledge it paid is settled, and a gift that is a membership renewal is
//     applied, as recordGift does;
//   · one gift.recorded event per gift, ready, with its facts, in one
//     statement, then relayed once (JOBS-1). The after-change step is the
//     caller's, once, at the end.
//
// It takes only what an import passes. Every gift carries its run
// (`importId`), so no gift here fires a trigger (SEND-GATE-1: an import's
// gifts start nothing), which is why the facts are read once per person after
// the batch rather than gift by gift. Anything else (a ledger post, extras, a
// fundraiser page, a ticket, a recurring gift, an instalment to find) goes
// through recordGift, and asking for it here throws.
"use strict";
const HISTORY = require("./historyGifts");
const OUTBOX = require("./server/shared/outbox");
const { DONOR_SUMMARY_UPDATE } = require("./donorSummary");
const { newId } = require("./server/shared/newId");

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const COLS = ["id", "org_id", "donor_id", "amount", "date", "type", "campaign", "notes", "fund_id", "payment_method", "pledge_id",
  "idempotency_key", "created_by", "created_by_name", "import_id", "event_id", "gift_type",
  // ASKS-1: an auction purchase states what the item was worth, as recordGift does
  "deductible_amount", "quid_pro_quo_desc", "quid_pro_quo_value"];
const RESTRICTED = ["program_restricted", "capital", "time_restricted"];

function refuse(o) {
  if (!o.importId) return "every gift in a batch carries its import run";
  if (o.conflict !== "idempotency" || !o.idempotencyKey) return "a batch gift is keyed by its idempotency key";
  if (o.post !== false) return "a batch gift is not posted to the ledger";
  if (o.applyInstallment !== false) return "a batch gift names its instalment or none";
  if (o.extras || o.peerFundraiserId || o.recurring || o.liveRead) return "extras, fundraiser pages, recurring and live reads go through recordGift";
  if (!(o.undated === true && (o.date == null || o.date === "")) && (o.date == null || o.date === "")) return "a gift needs a date";
  return null;
}

// recordGifts(list, deps) → [{ giftId, duplicate, fundId }] in the order given.
async function recordGifts(list, deps) {
  const { query, run, ensureOrgLedger, onPledgeSettled, applyGiftAsMembershipRenewal, orgToday, orgTz, GIFT_METHOD_UNKNOWN } = deps;
  if (!list.length) return [];
  const orgId = list[0].orgId;
  for (const o of list) {
    const why = o.orgId !== orgId ? "one org a batch" : refuse(o);
    if (why) throw new Error(`recordGifts: ${why}`);
  }
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK

  // Rule 1 — a fund and a method, always (recordGift's two cases, read once)
  const asked = [...new Set(list.map(o => o.fundId).filter(Boolean))];
  const okFunds = new Set(asked.length ? (await query("SELECT id FROM fin_funds WHERE org_id=? AND id = ANY(?)", [orgId, asked])).map(r => r.id) : []);
  for (const f of asked) if (!okFunds.has(f)) console.error(`[gift] refused a fund id that is not this org's: ${f}`);
  const pledged = [...new Set(list.filter(o => o.pledgeId && !o.fundId).map(o => o.pledgeId))];
  const awardFund = new Map(pledged.length ? (await query(
    `SELECT award_pledge_id, fund_id FROM grants WHERE org_id=? AND award_pledge_id = ANY(?) AND fund_id IS NOT NULL AND restriction = ANY(?)`,
    [orgId, pledged, RESTRICTED])).map(r => [r.award_pledge_id, r.fund_id]) : []);
  let general;
  const unrestricted = async () => (general !== undefined ? general : (general = (await ensureOrgLedger(orgId, { heal: true })).genFundId || null));

  const rows = [];
  for (const o of list) {
    const undated = o.undated === true && (o.date == null || o.date === "");
    const date = undated ? null : o.date;
    let fundId = o.fundId || null;
    const fundRefused = !!fundId && !okFunds.has(fundId);
    if (fundRefused) fundId = null;
    if (!fundId && !fundRefused && o.pledgeId) fundId = awardFund.get(o.pledgeId) || null;
    if (!fundId && !fundRefused && o.defaultFund !== false) fundId = await unrestricted();
    const amount = round2(o.amount);
    rows.push({ o, id: o.giftId || newId("g"), amount, date, undated, fundId,
      paymentMethod: String(o.paymentMethod || "").trim() || GIFT_METHOD_UNKNOWN,
      oldHistory: undated || (o.history === true && HISTORY.isOldHistory(date, o.today || today)) });
  }

  // the gifts, one statement; a key already here is a duplicate, written once only
  const vals = rows.flatMap(r => [r.id, orgId, r.o.donorId, r.amount, r.date, r.o.type || "cash", r.o.campaign || "", r.o.notes || "", r.fundId,
    r.paymentMethod, r.o.pledgeId || null, r.o.idempotencyKey, r.o.actorId || null, r.o.actorName || null, r.o.importId, r.o.eventId || null,
    r.o.giftType || null,
    // recordGift's own rule: deductible is what was paid over the value received, never below zero
    r.o.quidProQuoValue != null ? round2(Math.max(0, r.amount - Number(r.o.quidProQuoValue))) : null,
    r.o.quidProQuoValue != null ? String(r.o.quidProQuoDesc || "").slice(0, 300) : null,
    r.o.quidProQuoValue != null ? round2(Number(r.o.quidProQuoValue)) : null]);
  const made = new Set((await query(
    `INSERT INTO gifts (${COLS.join(",")}) VALUES ${rows.map(() => "(" + COLS.map(() => "?").join(",") + ")").join(",")}
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`, vals)).map(r => r.id));
  const kept = rows.filter(r => made.has(r.id));
  if (kept.length) {
    const people = [...new Set(kept.map(r => r.o.donorId))];
    // the rollup, once per person (recordGift's person_types rule and donorSummary.js)
    await run(
      `UPDATE donors
          SET person_types = CASE
                WHEN person_types IS NULL THEN '["donor"]'::jsonb
                WHEN person_types @> '["donor"]'::jsonb THEN person_types
                ELSE (person_types - 'other') || '["donor"]'::jsonb
              END,
              updated_at = NOW()
        WHERE org_id = ? AND id = ANY(?)`, [orgId, people]);
    await run(DONOR_SUMMARY_UPDATE("AND d.id = ANY($2::text[])"), [orgId, people]);
    // Rule 2 — one timeline line a gift, linked, with no copy of the amount
    const lines = kept.filter(r => r.o.timeline !== false);
    if (lines.length) {
      await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
                 VALUES ${lines.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",")}`,
        lines.flatMap(r => [newId("int"), orgId, r.o.donorId, "gift", String(r.o.timelineNote || r.o.notes || "").slice(0, 2000), r.date,
          r.o.actorId || null, r.o.actorName || null, r.id, r.o.source ? JSON.stringify({ via: r.o.source }) : null]));
    }
    // a pledge it paid toward, settled once each (recordGift's `else if (o.pledgeId)`)
    for (const pid of new Set(kept.map(r => r.o.pledgeId).filter(Boolean))) {
      await onPledgeSettled(orgId, pid).catch(e => console.error("[pledge] settle:", e.message));
    }
    // BUILD-101: a dated gift from someone whose membership is due may be the renewal;
    // asked only of the people who hold a membership at all
    const members = new Set(await query(
      `SELECT DISTINCT donor_id FROM memberships WHERE org_id=? AND donor_id = ANY(?) AND status IN ('active','grace')`, [orgId, people])
      .then(rs => rs.map(r => r.donor_id)).catch(() => []));
    const renewed = new Set();
    for (const r of kept) {
      if (r.undated || !members.has(r.o.donorId) || r.o.membershipRenewal === false) continue;
      const m = await applyGiftAsMembershipRenewal({ orgId, donorId: r.o.donorId, giftId: r.id, amount: r.amount, actorId: r.o.actorId || null, actorName: r.o.actorName || null })
        .catch(e => { console.error("[membership] renewal auto-apply:", e.message); return null; });
      if (m) renewed.add(r.id);
    }
    // JOBS-1 — each gift's event, with the facts read once per person, ready, then relayed
    const facts = new Map((await query(
      `SELECT d.id, d.gift_count, d.stage, d.status, d.stripe_subscription_status,
              (SELECT COUNT(*)::int FROM gifts x WHERE x.org_id = d.org_id AND x.donor_id = d.id AND NOT (x.id = ANY(?))
                  AND (x.notes ILIKE '%recurring%' OR x.type = 'recurring')) AS prior_recurring_noted,
              (SELECT COUNT(*)::int FROM gifts x WHERE x.org_id = d.org_id AND x.donor_id = d.id AND NOT (x.id = ANY(?)) AND x.amount > 0
                  AND (x.recurring_subscription_id IS NOT NULL OR x.type = 'recurring')) AS prior_recurring
         FROM donors d WHERE d.org_id = ? AND d.id = ANY(?)`, [kept.map(r => r.id), kept.map(r => r.id), orgId, people])).map(f => [f.id, f]));
    const evs = kept.map(r => {
      const f = facts.get(r.o.donorId) || {};
      return OUTBOX.rowFor(orgId, "gift.recorded", {
        giftId: r.id, donorId: r.o.donorId, amount: r.amount, cents: Math.round(r.amount * 100), fundId: r.fundId, campaignId: null,
        importId: r.o.importId, type: r.o.type || "cash", recurring: false, recurringSubscriptionId: null, fundName: r.o.fundName || null,
        source: r.o.source || null, door: r.o.door || "gift_form", history: r.o.history === true, oldHistory: r.oldHistory,
        thankedElsewhere: r.o.alreadyThanked === true, fromImport: true, thankYou: r.o.thankYou !== false, afterChange: r.o.afterChange !== false,
        thread: null, tribute: null, armedSequences: null, armedJourneys: null,
        giftCount: f.gift_count != null ? Number(f.gift_count) : null, status: f.status || null, stage: f.stage || null,
        subscriptionStatus: f.stripe_subscription_status || null, priorRecurringNoted: f.prior_recurring_noted ?? null,
        priorRecurring: f.prior_recurring ?? null, appliedInstallment: false, appliedMembership: renewed.has(r.id),
      }, { donorIds: [r.o.donorId], ready: true, actor: r.o.actorId ? { id: r.o.actorId, name: r.o.actorName } : null });
    });
    await run(`INSERT INTO events_outbox (id, org_id, type, payload, donor_ids, ready, created_by, created_by_name)
               SELECT e.id, e.org, e.type, e.payload::jsonb, ARRAY[e.donor], TRUE, e.by, e.by_name
                 FROM unnest(?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[]) AS e(id, org, type, payload, donor, by, by_name)`,
      [evs.map(e => e.id), evs.map(e => e.orgId), evs.map(e => e.type), evs.map(e => e.payload), evs.map(e => e.donorIds[0]), evs.map(e => e.by), evs.map(e => e.byName)]);
    await OUTBOX.relay(evs.map(e => e.id)).catch(e => console.error("[gift] relay (the sweep will):", e.message));
  }
  return rows.map(r => ({ giftId: made.has(r.id) ? r.id : null, duplicate: !made.has(r.id), fundId: r.fundId }));
}

module.exports = { recordGifts };
