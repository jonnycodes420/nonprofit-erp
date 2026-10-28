// routes/insights.js · INSIGHTS-1. Who to call, why, and exactly what to say.
//
//   GET  /insights                   the ladder, the coverage line and the cards
//                                    (?view=first: the first look, 7 cards, no Home-only ones)
//   GET  /insights/donor/:id         one person: rung, status, signals, the next move
//   GET  /insights/worked            the "What worked" panel (Reports)
//   POST /insights/seen              the cards she was shown (the page posts it; a GET writes nothing)
//   POST /insights/outcome           Done, Not now (with a date), Doesn't fit (with a reason)
//   POST /insights/review/:giftId    Keep as gift, or Not a gift (a Finance revenue line typed a
//                                    purchase, tickets or a reimbursement; out of every giving total)
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

const routers = { r0: express.Router() };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATES = new Set(["done", "snoozed", "dismissed"]);
// Review: what a row that was not a gift was, its words, and its revenue account.
const AS_TYPE = { tickets: "ticket", ticket: "ticket", auction: "purchase", purchase: "purchase", reimbursement: "reimbursement", refund: "reimbursement" };
const TYPE_WORD = { purchase: "a purchase", ticket: "tickets", reimbursement: "a reimbursement" };
const TYPE_LABEL = { purchase: "Purchase", ticket: "Tickets", reimbursement: "Reimbursement" };
const ACCOUNT_FOR = { purchase: "4050", ticket: "4050", reimbursement: "4060" };

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, orgTz, orgToday, testMode, uuid, withTransaction, queryTx, runTx, recalcDonorSummary } = ctx;
const app = routers.r0;

async function asOfFor(req) {
  if (testMode() && DAY.test(String(req.query.asOf || req.body?.asOf || ""))) return String(req.query.asOf || req.body.asOf);
  return orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
}
// what a card carries to the page (the engine's internals stay here)
const cardOut = c => ({
  kind: c.kind, rung: c.rung, rungLabel: c.rungLabel, title: c.title, homeOnly: !!c.homeOnly, cents: c.cents, people: c.people, ids: c.ids,
  words: c.words, how: c.how, does: c.does, facts: c.facts, wordsFrom: "template",
  items: c.items.map(it => ({ key: it.key, name: it.name, ids: it.ids, lead: it.lead, cents: it.cents, facts: it.facts, how: it.how,
    giftId: it.giftId, reason: it.reason, memo: it.memo, date: it.date, members: it.members, reasons: it.reasons, pledgeId: it.pledgeId,
    installments: it.installments, state: it.state })),
});

app.get("/insights", requireAuth, wrap(async (req, res) => {
  const asOf = await asOfFor(req);
  const r = await D.insightsFor(req.user.orgId, asOf);
  const first = req.query.view === "first";
  // Review leads the first look (the totals in it wait on her); on Home it
  // follows the cards about people (Jonathan, 27 Oct).
  let cards = r.cards.filter(c => !(first && c.homeOnly));
  if (!first) cards = [...cards.filter(c => c.kind !== "review" && c.kind !== "family"), ...cards.filter(c => c.kind === "review"), ...cards.filter(c => c.kind === "family")];
  cards = cards.slice(0, first ? 7 : 20);
  // HOME-3: the first look says what each recent event raised, the way she
  // says it (received + pledged), from the one function Reports and the event page read.
  const events = first ? await require("../numbers").eventsRaised(req.user.orgId, { withMoney: true, limit: 3 }) : undefined;
  res.json({ events,
    asOf, coverage: r.coverage, majorLine: r.majorLine, ladder: r.ladder, centsSentence: r.centsSentence,
    stats: r.stats, cards: cards.map(cardOut),
    sentences: {
      ladder: "Each giving unit (a household, or a person on their own) sits on one rung, from their own giving. Planned sits beside a rung.",
      never: "Steward never sends anything for you. Every draft waits for your click.",
    },
  });
}));

app.get("/insights/donor/:id", requireAuth, wrap(async (req, res) => {
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const asOf = await asOfFor(req);
  const r = await D.insightsFor(req.user.orgId, asOf);
  const unit = r.units.find(u => u.ids.includes(d.id)) || null;
  const move = I.nextMoveFor(r, d.id);
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
  const notGifts = (await query(`SELECT gift_id, as_type, row_data->>'amount' AS amount, row_data->>'date' AS date FROM insight_reviews
                                  WHERE org_id=? AND decision='not_gift' AND donor_id = ANY(?) ORDER BY row_data->>'date' DESC NULLS LAST`, [req.user.orgId, ids]))
    .map(x => ({ giftId: x.gift_id, as: x.as_type, label: TYPE_LABEL[x.as_type] || x.as_type, cents: Math.round(Number(x.amount) * 100), date: x.date }));
  res.json({ asOf, coverage: r.coverage, majorLine: r.majorLine, unit, notGifts, move: move ? { ...move, item: cardOut({ ...move, items: [move.item], words: move.words, facts: [], does: [] }).items[0] } : null, combined,
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
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS cents FROM gifts g
                          WHERE g.org_id=s.org_id AND g.donor_id = ANY(s.donor_ids) AND g.amount > 0 AND g.date IS NOT NULL
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
  for (const k of keys) {
    await run(`INSERT INTO insight_outcomes (id, org_id, kind, item_key, donor_ids, state, until, reason, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ["io_" + uuid().slice(0, 12), req.user.orgId, String(b.kind).slice(0, 40), String(k).slice(0, 300), [...own], b.state,
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
app.post("/insights/review/:giftId", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, giftId = String(req.params.giftId);
  const b = req.body || {};
  if (b.decision !== "keep" && b.decision !== "not_gift") return res.status(400).json({ error: "bad_decision", sentence: "Pick Keep as gift or Not a gift." });
  const [g] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [giftId, orgId]);
  if (!g) return res.status(404).json({ error: "Not found" });
  const a = actor(req);
  if (b.decision === "keep") {
    await run(`INSERT INTO insight_reviews (org_id, gift_id, decision, donor_id, created_by, created_by_name) VALUES (?,?,?,?,?,?)
               ON CONFLICT (org_id, gift_id) DO UPDATE SET decision=EXCLUDED.decision, created_by=EXCLUDED.created_by, created_by_name=EXCLUDED.created_by_name, created_at=NOW()`,
      [orgId, giftId, "keep", g.donor_id, a.id, a.name]);
    return res.json({ ok: true, decision: "keep" });
  }
  const memo = [g.memo, g.notes].filter(Boolean).join(" · ");
  const type = AS_TYPE[String(b.as || "").toLowerCase()] || AS_TYPE[(I.notAGift(memo) || {}).kind] || "purchase";
  const [att] = await query(`SELECT
      (SELECT COUNT(*) FROM receipts WHERE gift_id=? AND org_id=? AND voided_at IS NULL)::int AS receipts,
      (SELECT COUNT(*) FROM threads WHERE opening_gift_id=? AND org_id=? AND closed_at IS NULL)::int AS threads,
      (SELECT COUNT(*) FROM tasks WHERE source_gift_id=? AND org_id=? AND voided_at IS NULL)::int AS tasks,
      (SELECT COUNT(*) FROM pledges WHERE fulfilled_gift_id=? AND org_id=?)::int AS pledges,
      (SELECT COUNT(*) FROM pledge_installments WHERE paid_gift_id=? AND org_id=?)::int AS installments`,
    [giftId, orgId, giftId, orgId, giftId, orgId, giftId, orgId, giftId, orgId]);
  if (g.stripe_payment_id || g.recurring_subscription_id || g.pledge_id || att.receipts || att.threads || att.tasks || att.pledges || att.installments) {
    return res.status(409).json({ error: "attached", sentence: "This gift has a receipt, a payment, a pledge or a thank-you attached, so it is changed from the gift itself. Open it from the person's profile." });
  }
  const [acct] = await query("SELECT id FROM accounts WHERE org_id=? AND code=? LIMIT 1", [orgId, ACCOUNT_FOR[type]]);
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [g.donor_id, orgId]);
  const description = `${TYPE_LABEL[type]}, not a gift${memo ? `: ${memo}` : ""}`.slice(0, 500);
  let finId = null;
  try {
    await withTransaction(async client => {
      const [stamp] = await queryTx(client, "SELECT * FROM fin_transactions WHERE gift_id=? AND org_id=? FOR UPDATE", [giftId, orgId]);
      if (stamp) {
        finId = stamp.id;
        await runTx(client, `UPDATE fin_transactions SET gift_id=NULL, account_id=COALESCE(?, account_id), description=?, donor_id=?, source='not_a_gift' WHERE id=?`,
          [acct ? acct.id : null, description, g.donor_id, stamp.id]);
      } else {
        finId = "ft_" + uuid().slice(0, 12);
        await runTx(client, `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,created_by,created_by_name)
                             VALUES (?,?,?,?,?,?,'income',?,?,?,'not_a_gift',?,?)`,
          [finId, orgId, g.date || null, description, d ? d.name : null, g.amount, acct ? acct.id : null, g.fund_id || null, g.donor_id, a.id, a.name]);
      }
      await runTx(client, `INSERT INTO insight_reviews (org_id, gift_id, decision, as_type, row_data, fin_id, fin_prev, donor_id, created_by, created_by_name)
                           SELECT ?, ?, 'not_gift', ?, to_jsonb(t), ?, ?::jsonb, ?, ?, ? FROM gifts t WHERE t.id=? AND t.org_id=?
                           ON CONFLICT (org_id, gift_id) DO UPDATE SET decision=EXCLUDED.decision, as_type=EXCLUDED.as_type, row_data=EXCLUDED.row_data,
                             fin_id=EXCLUDED.fin_id, fin_prev=EXCLUDED.fin_prev, donor_id=EXCLUDED.donor_id, created_by=EXCLUDED.created_by,
                             created_by_name=EXCLUDED.created_by_name, created_at=NOW()`,
        [orgId, giftId, type, finId, stamp ? JSON.stringify(stamp) : null, g.donor_id, a.id, a.name, giftId, orgId]);
      await runTx(client, "DELETE FROM gifts WHERE id=? AND org_id=?", [giftId, orgId]);
    });
  } catch (e) {
    if (e.code === "23503") return res.status(409).json({ error: "attached", sentence: "Something else in Steward points at this gift, so it is changed from the gift itself. Open it from the person's profile." });
    throw e;
  }
  await moved(orgId, g.donor_id);
  if (req.audit) { req.audit.entity("gift", giftId); req.audit.before(g); req.audit.after({ finance_line: finId, as: type }); }
  res.json({ ok: true, decision: "not_gift", as: type, finId, undo: `/insights/review/${giftId}/undo`, undoSeconds: 60,
    sentence: `Marked as ${TYPE_WORD[type]}: ${I.money(Math.round(Number(g.amount) * 100))} is no longer anyone's giving, and stays in Finance as revenue.` });
}));

app.post("/insights/review/:giftId/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, giftId = String(req.params.giftId);
  const [r] = await query("SELECT * FROM insight_reviews WHERE org_id=? AND gift_id=?", [orgId, giftId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  await withTransaction(async client => {
    if (r.decision === "not_gift" && r.row_data) {
      // back on the person the review now points at (a merge since moves it, dataHealth.js MERGE_REFS)
      await runTx(client, "INSERT INTO gifts SELECT * FROM jsonb_populate_record(NULL::gifts, ?::jsonb)", [JSON.stringify({ ...r.row_data, donor_id: r.donor_id || r.row_data.donor_id })]);
      if (r.fin_prev) {
        const f = r.fin_prev;
        await runTx(client, "UPDATE fin_transactions SET gift_id=?, account_id=?, description=?, donor_id=?, source=? WHERE id=? AND org_id=?",
          [f.gift_id, f.account_id, f.description, f.donor_id, f.source, f.id, orgId]);
      } else if (r.fin_id) {
        await runTx(client, "DELETE FROM fin_transactions WHERE id=? AND org_id=? AND source='not_a_gift'", [r.fin_id, orgId]);
      }
    }
    await runTx(client, "DELETE FROM insight_reviews WHERE org_id=? AND gift_id=?", [orgId, giftId]);
  });
  if (r.decision === "not_gift" && r.donor_id) await moved(orgId, r.donor_id);
  if (req.audit) { req.audit.entity("gift", giftId); req.audit.after(r.decision === "not_gift" ? r.row_data : null); }
  res.json({ ok: true, sentence: "Put back as it was." });
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
      const id = "rel_" + uuid().slice(0, 12);
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
