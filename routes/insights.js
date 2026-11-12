// routes/insights.js · INSIGHTS-1. Who to call, why, and exactly what to say.
//
//   GET  /insights                   the ladder, the coverage line and the cards
//                                    (?view=first: the first look, 7 cards, no Home-only ones)
//   GET  /insights/donor/:id         one person: rung, status, signals, the next move
//   GET  /insights/worked            the "What worked" panel (Reports)
//   POST /insights/seen              the cards she was shown (the page posts it; a GET writes nothing)
//   POST /insights/outcome           Done, Not now (with a date), Doesn't fit (with a reason)
//   POST /insights/review/:giftId    Keep as gift, Partly a gift (the value received leaves giving
//                                    and is a Finance revenue line; the rest stays a gift), or Not a
//                                    gift (a Finance revenue line typed a purchase, tickets or a
//                                    reimbursement; out of every giving total)
//   POST /insights/review/:giftId/undo  put the row back as it was
//   POST /insights/link              Link a suggested family or network, or Not related
//
// The facts come from insights.js (pure) over insightsData.js (reads). The
// words are the template, written from those facts. Nothing here sends,
// emails or charges anything: every "Steward does" is a draft, a task, a group
// or a briefing, made by her click on the page (SEND-GATE-1 is untouched).
//
// TEST_MODE only: `?asOf=YYYY-MM-DD` reads as of that day. Everywhere else
// asOf is the org's own today.
"use strict";
const express = require("express");
const I = require("../insights");
const D = require("../insightsData");
const NMONEY = require("../shared/numbers/money");   // NUMBERS-5
const { newId } = require("../server/shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = { r0: express.Router() };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATES = new Set(["done", "snoozed", "dismissed"]);
// PERF-2: how many moves a tab carries in Home's first read of the deck: the
// card she sees, and the next, so Next is there before the rest arrives.
const DECK_FIRST = 2;
const DRIFT_FIRST = 5;   // HOME-6: drifting people on Home before "Show all"
const DRIFT_PEOPLE = require("../server/insights/driftPeople");
// Review: what a row that was not a gift was, in words (ASKS-2: the decisions are server/insights/reviewDecide.js).
const { TYPE_LABEL } = require("../server/insights/reviewDecide");

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, orgTz, orgToday, testMode, uuid, withTransaction, queryTx, runTx, recalcDonorSummary } = ctx;
const app = routers.r0;

// INSIGHTS-2: a day a TEST_MODE read named is built for that day (its own job key).
const explicitDay = req => testMode() && DAY.test(String(req.query.asOf || req.body?.asOf || ""));
// INSIGHTS-2: after an Insights button (Done, Not now, Doesn't fit, a Review or
// a Link), the answer waits for the worker's build of the org's Insights
// (bounded, store.refreshAndWait), so the panel she reloads no longer shows
// what she just closed. The request computes nothing itself.
const STORE = require("../server/insights/store");
app.use(["/insights/outcome", "/insights/review", "/insights/review-group", "/insights/link"], (req, res, next) => {
  if (req.method !== "POST") return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 300 || !req.user || !req.user.orgId) return json(body);
    asOfFor(req).then(day => STORE.refreshAndWait(req.user.orgId, day, { explicitDay: explicitDay(req) }))
      .catch(e => console.error("[insights] after a button:", e.message)).then(() => json(body));
    return res;
  };
  next();
});

async function asOfFor(req) {
  if (testMode() && DAY.test(String(req.query.asOf || req.body?.asOf || ""))) return String(req.query.asOf || req.body.asOf);
  return orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
}
// what a card carries to the page (the engine's internals stay here)
const cardOut = c => ({
  kind: c.kind, rung: c.rung, rungLabel: c.rungLabel, title: c.title, homeOnly: !!c.homeOnly, cents: c.cents, people: c.people, ids: c.ids,
  words: c.words, how: c.how, does: c.does, facts: c.facts, wordsFrom: "template", groups: c.groups,
  items: c.items.map(it => ({ key: it.key, name: it.name, ids: it.ids, lead: it.lead, cents: it.cents, facts: it.facts, how: it.how, taskDue: it.taskDue,
    giftId: it.giftId, reason: it.reason, memo: it.memo, date: it.date, partly: it.partly, members: it.members, reasons: it.reasons, pledgeId: it.pledgeId,
    installments: it.installments, state: it.state, down: it.down, levels: it.levels, what: it.what })),
});

// HOME-4: Home has no Drift section, so the deck carries Drift's people
// (insights.js withDrift) and Drift's counts for the chip under it. Drift's
// list is GET /drift's own answer, read in this process as the person asking.
async function deckWithDrift(req, deck, asOf) {
  let drift = null;
  try {
    const r = await require("../inProcess").get("/drift?all=1&includeMedium=1", { headers: req.headers, remoteAddress: req.socket && req.socket.remoteAddress });
    if (r.status === 200) drift = JSON.parse(r.body);
  } catch { /* the deck stands without Drift */ }
  // IMPORT-5: the guests who came and didn't give are Grow moves
  try {
    const events = await require("../shared/numbers/events").eventFigures(query, req.user.orgId, { asOf });
    const outs = await query(`SELECT DISTINCT ON (item_key) item_key, state, until::text AS until FROM insight_outcomes
                               WHERE org_id=? AND kind='came_no_gift' ORDER BY item_key, created_at DESC`, [req.user.orgId]);
    const gone = new Set(outs.filter(o => o.state !== "snoozed" || (o.until && o.until > asOf)).map(o => o.item_key));
    deck = I.withEventGuests(deck, events, { asOf, gone });
  } catch (e) { console.error("[insights] came-didn't-give:", e.message); }
  if (!drift) return deck;
  const outs = await query(`SELECT DISTINCT ON (item_key) item_key, state, until::text AS until FROM insight_outcomes
                             WHERE org_id=? AND kind='drift' ORDER BY item_key, created_at DESC`, [req.user.orgId]);
  const gone = new Set(outs.filter(o => o.state !== "snoozed" || (o.until && o.until > asOf)).map(o => o.item_key));
  const c = drift.counts || {};
  // HOME-6: Home lists the same people (server/insights/driftPeople.js), with
  // each one's last gift from the person record.
  const ids = (drift.list || []).map(r => r && r.donorId).filter(Boolean);
  const lastRows = ids.length ? await query(`SELECT id, last_gift_amount AS amount, last_gift_date::text AS date FROM donors WHERE org_id=? AND id = ANY(?)`, [req.user.orgId, ids]) : [];
  const people = DRIFT_PEOPLE.driftPeople(drift.list, { gone, asOf, last: new Map(lastRows.map(r => [r.id, r])) });
  return { ...I.withDrift(deck, drift.list || [], { asOf, gone }),
    drift: { high: Number(c.driftingHigh) || 0, medium: Number(c.driftingMedium) || 0, count: people.length, people } };
}

app.get("/insights", requireAuth, wrap(async (req, res) => {
  const asOf = await asOfFor(req);
  const got = await D.insightsFor(req.user.orgId, asOf, { explicitDay: explicitDay(req) });
  // INSIGHTS-2: none stored yet: the panel says so; nothing else waits.
  if (got.preparing) return res.json({ asOf, preparing: true, stale: false, sentence: got.sentence, cards: [],
    ladder: [], stats: {}, deck: req.query.view === "first" ? undefined : { tabs: [], preparing: true } });
  const r = got.result;
  const first = req.query.view === "first";
  // HOME-4: ?view=deck is Home's: the deck without the cards (the cards are
  // most of the bytes, and Home reads them only when a panel opens).
  const deckOnly = req.query.view === "deck";
  // Review leads the first look (the totals in it wait on her); on Home it
  // follows the cards about people (Jonathan, 27 Oct).
  let cards = r.cards.filter(c => !(first && c.homeOnly));
  if (!first) cards = [...cards.filter(c => c.kind !== "review" && c.kind !== "family"), ...cards.filter(c => c.kind === "review"), ...cards.filter(c => c.kind === "family")];
  cards = cards.slice(0, first ? 7 : 20);
  // HOME-3: the first look says what each recent event raised, the way she
  // says it (received + pledged), from the one function Reports and the event page read.
  const events = first ? await require("../numbers").eventsRaised(req.user.orgId, { withMoney: true, limit: 3 }) : undefined;
  // FLOWS-6: a deck stored before its moves carried a why gets one on the read (actionWhy.fillWhy).
  let deck = first ? undefined : require("../server/insights/actionWhy").fillWhy(await deckWithDrift(req, r.deck, asOf));
  // PERF-2: Home's first read of the deck carries what its first card draws:
  // each tab's own figures, its first DECK_FIRST moves and how many it carries
  // in all (`carried`), and the moves Home records as shown (`seen`, the same
  // first 50 a tab that Home always posted). The rest (?view=deck&moves=all)
  // loads when the deck comes into view or she moves through it. The ladder is
  // not drawn by the deck, so neither deck read carries it.
  if (deckOnly && req.query.moves !== "all") deck = {
    ...deck, partial: true,
    seen: deck.tabs.flatMap(t => t.moves.slice(0, 50).map(m => ({ kind: m.kind, itemKey: m.itemKey, donorIds: m.ids }))),
    tabs: deck.tabs.map(t => ({ ...t, carried: t.moves.length, moves: t.moves.slice(0, DECK_FIRST) })),
    // HOME-6: the first five drifting people; "Show all" reads the rest with every move
    ...(deck.drift && deck.drift.people ? { drift: { ...deck.drift, people: deck.drift.people.slice(0, DRIFT_FIRST) } } : {}),
  };
  res.json({ events, stale: got.stale,
    asOf, coverage: r.coverage, majorLine: r.majorLine, ladder: deckOnly ? undefined : r.ladder, centsSentence: r.centsSentence,
    stats: r.stats, cards: deckOnly ? [] : cards.map(cardOut), deck,
    sentences: {
      ladder: "Each giving unit (a household, or a person on their own) sits on one rung, from their own giving. Planned sits beside a rung.",
      never: "Steward never sends these notes for you. Every draft waits for your click.",
    },
  });
}));

app.get("/insights/donor/:id", requireAuth, wrap(async (req, res) => {
  const [d] = await query("SELECT id, deceased FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const asOf = await asOfFor(req);   // PEOPLE-1: no next move is suggested for someone marked deceased (below)
  const got = await D.insightsFor(req.user.orgId, asOf, { explicitDay: explicitDay(req) });
  // INSIGHTS-2: the first build for this org is queued; this panel says so and
  // the rest of the profile is unaffected.
  if (got.preparing) return res.json({ asOf, preparing: true, stale: false, sentence: got.sentence, unit: null, notGifts: [], move: null, combined: null, rungSentence: null });
  const r = got.result;
  const unit = r.units.find(u => u.ids.includes(d.id)) || null;
  let move = d.deceased === true ? null : I.nextMoveFor(r, d.id);
  // PLEDGES-2 (W-1107-Finance-18X): a stored answer the worker has not rebuilt yet never
  // asks to collect a pledge that was deleted, written off or paid since.
  if (move && move.item && move.item.pledgeId) {
    const [live] = await query("SELECT status FROM pledges WHERE id=? AND org_id=?", [move.item.pledgeId, req.user.orgId]);
    if (!live || live.status !== "open") move = null;
  }
  // linked records (a family or network she linked) show what they give together
  const rel = await query(`SELECT donor_id_a, donor_id_b FROM donor_relationships WHERE org_id=? AND (donor_id_a=? OR donor_id_b=?) AND relationship_type IN ('family','network')`,
    [req.user.orgId, d.id, d.id]);
  const linkedIds = [...new Set(rel.map(x => (x.donor_id_a === d.id ? x.donor_id_b : x.donor_id_a)))];
  const linkedUnits = r.units.filter(u => u.ids.some(i => linkedIds.includes(i)) && u !== unit);
  const combined = linkedUnits.length ? {
    cents: (unit ? unit.lifetimeCents : 0) + linkedUnits.reduce((n, u) => n + u.lifetimeCents, 0),
    names: linkedUnits.map(u => u.name),
    sentence: "What this person and the records linked to them have given, together, over all time.",
  } : null;
  // what this giver paid that was not a gift (Review), in Finance as revenue
  const ids = unit ? unit.ids : [d.id];
  // (HOME-3: a row marked Partly a gift lists the value received, its part that was not a gift)
  const notGifts = (await query(`SELECT gift_id, decision, as_type, CASE WHEN decision='partly' THEN received::text ELSE row_data->>'amount' END AS amount,
                                        row_data->>'date' AS date FROM insight_reviews
                                  WHERE org_id=? AND decision IN ('not_gift','partly') AND donor_id = ANY(?) ORDER BY row_data->>'date' DESC NULLS LAST`, [req.user.orgId, ids]))
    .map(x => ({ giftId: x.gift_id, as: x.as_type, label: TYPE_LABEL[x.as_type] || x.as_type, partly: x.decision === "partly", cents: Math.round(Number(x.amount) * 100), date: x.date }));
  res.json({ asOf, stale: got.stale, coverage: r.coverage, majorLine: r.majorLine, unit, notGifts, move: move ? { ...move, item: cardOut({ ...move, items: [move.item], words: move.words, facts: [], does: [] }).items[0] } : null, combined,
    rungSentence: unit ? I.RUNG_SENTENCE[unit.rung] : null });
}));

// "What worked": per insight, shown, acted on, and gifts (or pledge payments)
// from those people within 60 days of the card being shown. Recorded only:
// nothing learns from it in this build.
app.get("/insights/worked", requireAuth, wrap(async (req, res) => {
  const rows = await query(`
    SELECT s.kind, COUNT(*)::int AS shown,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM insight_outcomes o WHERE o.org_id=s.org_id AND o.kind=s.kind AND o.item_key=s.item_key AND o.state='done'))::int AS acted,
           COUNT(*) FILTER (WHERE f.n > 0)::int AS followed,
           COALESCE(SUM(f.cents),0)::bigint AS cents
      FROM insight_shown s
      -- NUMBERS-5: who gave is a gift (money above zero); how much is money, a refund off (money.js).
      LEFT JOIN LATERAL (SELECT (COUNT(*) FILTER (WHERE g.amount > 0))::int AS n, ${NMONEY.MONEY_CENTS("g")} AS cents FROM gifts g
                          WHERE g.org_id=s.org_id AND g.donor_id = ANY(s.donor_ids) AND ${NMONEY.MONEY("g")} AND g.date IS NOT NULL
                            AND LEFT(g.date,10) >= s.first_shown_on::text AND LEFT(g.date,10) <= (s.first_shown_on + ${I.OUTCOME_DAYS})::text) f ON true
     WHERE s.org_id=? GROUP BY s.kind ORDER BY s.kind`, [req.user.orgId]);
  res.json({ days: I.OUTCOME_DAYS, rows: rows.map(r => ({ ...r, cents: Number(r.cents) })),
    sentence: `For each kind of card: how many givers it showed, how many you marked Done, and how many gave (a gift or a pledge payment) within ${I.OUTCOME_DAYS} days of first seeing it, and how much. It counts what followed; it does not claim the card caused it.` });
}));

app.post("/insights/seen", requireAuth, wrap(async (req, res) => {
  const asOf = await asOfFor(req);
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
  const own = await ownIds(req.user.orgId, items.flatMap(i => i.donorIds || []));
  const a = actor(req);
  let n = 0;
  for (const it of items) {
    if (!it || !it.kind || !it.itemKey) continue;
    const ids = (it.donorIds || []).filter(id => own.has(id));
    await run(`INSERT INTO insight_shown (org_id, kind, item_key, donor_ids, first_shown_on, created_by, created_by_name) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      [req.user.orgId, String(it.kind).slice(0, 40), String(it.itemKey).slice(0, 300), ids, asOf, a.id, a.name]);
    n++;
  }
  res.json({ ok: true, recorded: n });
}));

async function ownIds(orgId, ids) {
  const list = [...new Set((ids || []).map(String))].slice(0, 2000);
  if (!list.length) return new Set();
  return new Set((await query("SELECT id FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, list])).map(r => r.id));
}

app.post("/insights/outcome", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  if (!STATES.has(b.state)) return res.status(400).json({ error: "bad_state", sentence: "Pick Done, Not now or Doesn't fit." });
  if (b.state === "snoozed" && !DAY.test(String(b.until || ""))) return res.status(400).json({ error: "need_date", sentence: "Pick the day it should come back." });
  const keys = (Array.isArray(b.itemKeys) ? b.itemKeys : [b.itemKey]).filter(Boolean).slice(0, 500);
  if (!b.kind || !keys.length) return res.status(400).json({ error: "need_item" });
  const own = await ownIds(req.user.orgId, b.donorIds || []);
  const a = actor(req);
  // SENDS-1 (W-1107-Donors-04): a move can carry a person's Drifting sign folded
  // into it (insights.js withDrift, `also`). Done recorded the move alone, so on
  // the next read the same person rose again as a Drift move and Done looked
  // like it did nothing. Done is done for the person: the folded sign goes too.
  const rows = keys.map(k => [String(b.kind).slice(0, 40), String(k).slice(0, 300)]);
  const lead = b.lead && own.has(String(b.lead)) ? String(b.lead) : null;
  if (b.state === "done" && lead && b.kind !== "drift") rows.push(["drift", lead]);
  for (const [kind, k] of rows) {
    await run(`INSERT INTO insight_outcomes (id, org_id, kind, item_key, donor_ids, state, until, reason, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [newId("io"), req.user.orgId, kind, k, [...own], b.state,
       b.state === "snoozed" ? b.until : null, b.reason ? String(b.reason).slice(0, 500) : null, a.id, a.name]);
  }
  res.json({ ok: true, recorded: keys.length });
}));

// REVIEW. Keep as gift: recorded, the row leaves the card. Not a gift
// (Jonathan, 27 Oct; the INT-POS rule: a sale is never a gift row): the money
// stays in Finance as revenue, typed as what it was (a purchase, tickets or a
// reimbursement), on a ledger line with the person, the date, the amount and
// the memo, in Special Events Revenue (4050) or Other Revenue (4060). The gift
// row leaves `gifts`, so it is out of every giving total by construction, and
// is kept whole in insight_reviews.row_data; Undo puts it back exactly, ledger
// line and all. A row with anything attached (a receipt, a payment, a pledge,
// an open thank-you) is changed from the gift itself.
async function moved(orgId, donorId) {
  await recalcDonorSummary(donorId, orgId);
  // a staff click on a page: the gift-form door (afterChange.js DOORS)
  await require("../afterChange").afterChange(orgId, [donorId], { door: "gift_form", recalc: false });
}
// ASKS-2: the decisions themselves live in server/insights/reviewDecide.js
// (moved whole), so a group of rows (server/insights/reviewGroup.js) does to
// each row exactly what the row's own button does.
const DECIDE = require("../server/insights/reviewDecide");
require("../server/insights/reviewGroup").mount(app, { wrap, requireAuth, checkWriteAccess, actor, moved });
app.post("/insights/review/:giftId", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, giftId = String(req.params.giftId);
  const b = req.body || {};
  if (b.decision !== "keep" && b.decision !== "not_gift" && b.decision !== "partly") return res.status(400).json({ error: "bad_decision", sentence: "Pick Keep as gift, Partly a gift or Not a gift." });
  const [g] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [giftId, orgId]);
  if (!g) return res.status(404).json({ error: "Not found" });
  const r = await DECIDE.decide(orgId, actor(req), g, { decision: b.decision, as: b.as, value: b.value });
  if (r.status === 200 && r.donorId) await moved(orgId, r.donorId);
  if (r.audit && req.audit) { req.audit.entity("gift", giftId); req.audit.before(r.audit.before); req.audit.after(r.audit.after); }
  res.status(r.status).json(r.body);
}));

app.post("/insights/review/:giftId/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, giftId = String(req.params.giftId);
  const [row] = await query("SELECT * FROM insight_reviews WHERE org_id=? AND gift_id=?", [orgId, giftId]);
  if (!row) return res.status(404).json({ error: "Not found" });
  const r = await DECIDE.undo(orgId, row);
  if (r.status === 200 && r.donorId) await moved(orgId, r.donorId);
  if (r.audit && req.audit) { req.audit.entity("gift", giftId); if (r.audit.before) req.audit.before(r.audit.before); req.audit.after(r.audit.after); }
  res.status(r.status).json(r.body);
}));

// LINK. A suggested family or network becomes "family" relationships from the
// first record to each of the others. Not related: the suggestion goes.
app.post("/insights/link", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const orgId = req.user.orgId, a = actor(req);
  if (!b.networkKey || (b.decision !== "link" && b.decision !== "not_related")) return res.status(400).json({ error: "bad_request" });
  const own = [...(await ownIds(orgId, b.leadIds || []))];
  const relIds = [];
  if (b.decision === "link") {
    if (own.length < 2) return res.status(400).json({ error: "need_two", sentence: "A link needs two records or more." });
    const [first, ...rest] = (b.leadIds || []).filter(id => own.includes(id));
    for (const other of rest) {
      const [have] = await query(`SELECT id FROM donor_relationships WHERE org_id=? AND ((donor_id_a=? AND donor_id_b=?) OR (donor_id_a=? AND donor_id_b=?))`, [orgId, first, other, other, first]);
      if (have) continue;
      const id = newId("rel");
      await run(`INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, notes) VALUES (?,?,?,?,?,?)`,
        [id, orgId, first, other, "family", "Linked from a Steward suggestion"]);
      relIds.push(id);
    }
  }
  await run(`INSERT INTO insight_links (org_id, network_key, decision, relationship_ids, created_by, created_by_name) VALUES (?,?,?,?,?,?)
             ON CONFLICT (org_id, network_key) DO UPDATE SET decision=EXCLUDED.decision, relationship_ids=EXCLUDED.relationship_ids, created_by=EXCLUDED.created_by, created_by_name=EXCLUDED.created_by_name, created_at=NOW()`,
    [orgId, String(b.networkKey).slice(0, 1000), b.decision, relIds, a.id, a.name]);
  res.json({ ok: true, decision: b.decision, linked: relIds.length });
}));
}

module.exports = { routers, mount };
