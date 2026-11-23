// server/finance/ledgerPost.js · LEDGER-3 item 3. A WAITING GIFT CAN ACTUALLY POST.
//
// TRUTH-3's ledger line said a waiting gift "posts with its deposit". Nothing
// did that: imports never post (BUILD-83 Part 6, by design), the imported-
// deposited route only stamps `deposited_on`, and no route posted a waiting
// gift. On prod's demo 33 of 4,238 gifts were posted, so a fund with six
// figures of receipts read $0 on Finance.
//
// Now Finance has "Post to the books": the waiting gifts (shared/numbers/
// ledgerStatus.js, `waiting`) grouped by deposit (`deposit_ref`, else the day
// it was deposited, else "no deposit on file"), each group with its count and
// total, and she confirms the groups she means. Every row is written by
// postGiftRow, the same helper recordGift's Rule 3 calls, so a live gift and
// a posted one can never be booked two ways. One batch, one Undo, which removes
// exactly the rows that batch wrote (fin_transactions.post_batch_id).
//
// Never posted here: history (an import dated before this fiscal year, whose
// books are closed), a gift with no date (recordGift does not post those
// either), and anything when the org posts through its accounting system
// (orgs.ledger_posting_enabled = false). Imports still never post on their own.
//
//   GET  /finance/ledger-post            the waiting gifts by deposit, and recent batches
//   POST /finance/ledger-post            { groups: [{ key, rows, cents }] } or { all: { rows, cents } }  post them; { batchId }
//   POST /finance/ledger-post/:id/undo   remove exactly that batch's rows
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");
const DF = require("../../shared/numbers/defaultFund");
const { formatCentsPlain: usd } = require("../../money");

const routers = { r1: express.Router() };

// THE ONE WRITE of a gift's ledger row. `q(sql, params)` returns rows (`?`
// placeholders; inside withAmbientTransaction it is the transaction's). One
// row per gift, ever (uq_fin_txns_gift): a second call writes nothing.
// postGiftRows writes many in one statement per 400; postGiftRow is one of them.
// Returns the gift ids it wrote a row for.
const COLS = 15;
async function postGiftRows(q, list) {
  const wrote = new Set();
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    const rows = await q(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id,created_by,created_by_name,post_batch_id)
       VALUES ${part.map(() => `(${Array(COLS).fill("?").join(",")})`).join(",")}
       ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING RETURNING gift_id`,
      part.flatMap(r => [newId("ft"), r.orgId, r.date, r.description || `Gift from ${r.donorName || "Donor"}`, r.donorName || "", r.amount, "income",
        r.accountId, r.fundId, r.donorId, r.source || "gift", r.giftId, r.actorId, r.actorName, r.batchId || null]));
    for (const r of rows) wrote.add(r.gift_id);
  }
  return wrote;
}
async function postGiftRow(q, r) { return (await postGiftRows(q, [r])).size > 0; }

const { GROUP_KEY, groupLabel, fyFromOf, waitingGifts, groupsFor } = require("../../shared/numbers/waitingToPost");

function mount(ctx) {
  const { query, requireAuth, checkWriteAccess, wrap, actor } = ctx;
  const { withAmbientTransaction, withAdvisoryLock } = require("../../db");
  const app = routers.r1;
  const gate = checkWriteAccess || ((req, res, next) => next());

  app.get("/finance/ledger-post", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [org] = await query("SELECT ledger_posting_enabled FROM orgs WHERE id = ?", [orgId]);
    const off = !!org && org.ledger_posting_enabled === false;
    const { groups, undated } = await groupsFor(query, orgId);
    const recent = await query(
      `SELECT id, gift_count, cents, created_at, created_by_name FROM ledger_post_batches
        WHERE org_id = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 5`, [orgId]);
    const n = groups.reduce((a, g) => a + g.n, 0), cents = groups.reduce((a, g) => a + g.cents, 0);
    res.json({
      postingOff: off,
      groups: groups.map(g => ({ ...g, amount: g.cents / 100 })),
      waiting: { n, cents, amount: cents / 100 },
      undated: { ...undated, amount: undated.cents / 100 },
      recent: recent.map(b => ({ id: b.id, n: b.gift_count, cents: Number(b.cents), amount: Number(b.cents) / 100, at: b.created_at, by: b.created_by_name })),
      sentence: off
        ? "This organization posts through its accounting system, so Steward does not post gifts to its own books."
        : n
          ? `${n.toLocaleString("en-US")} ${n === 1 ? "gift is" : "gifts are"} waiting to post (${usd(cents)}), in ${groups.length} ${groups.length === 1 ? "deposit" : "deposits"}. Each gift posts as revenue to its own fund, dated the day it was given.`
          : "Nothing is waiting to post.",
      definition: "A waiting gift is recorded in Steward and not on the books yet. Gifts imported from before this fiscal year are history and never post.",
      ...(undated.n ? { undatedSentence: `${undated.n} waiting ${undated.n === 1 ? "gift has" : "gifts have"} no date, so ${undated.n === 1 ? "it" : "they"} cannot post until a date is added.` } : {}),
    });
  }));

  app.post("/finance/ledger-post", requireAuth, gate, wrap(async (req, res) => {
    const orgId = req.user.orgId, who = actor(req);
    const every = req.body && req.body.all && typeof req.body.all === "object" ? { rows: Number(req.body.all.rows), cents: Number(req.body.all.cents) } : null;
    const asked = every ? [] : (Array.isArray(req.body && req.body.groups) ? req.body.groups : []).slice(0, 2000)
      .map(g => ({ key: String((g && g.key) || ""), rows: Number(g && g.rows), cents: Number(g && g.cents) })).filter(g => g.key);
    if (!every && !asked.length) return res.status(400).json({ error: "pick_groups", sentence: "Pick at least one deposit to post." });
    const [org] = await query("SELECT ledger_posting_enabled FROM orgs WHERE id = ?", [orgId]);
    if (org && org.ledger_posting_enabled === false) return res.status(409).json({ error: "posting_off", sentence: "This organization posts through its accounting system, so nothing was posted here." });

    const out = await withAdvisoryLock("ledgerpost:" + orgId, () => withAmbientTransaction(async () => {
      const fyFrom = await fyFromOf(query, orgId);
      const gifts = await waitingGifts(query, orgId, fyFrom, every ? null : asked.map(g => g.key));
      // What she saw is what posts: a group that changed since she looked is refused, whole.
      if (every) {
        const c = gifts.reduce((s, g) => s + Math.round(Number(g.amount) * 100), 0);
        if (gifts.length !== every.rows || c !== every.cents) return { status: 409, body: { error: "changed", sentence: `The waiting gifts changed since this list was read: ${gifts.length} can post now (${usd(c)}). Nothing was posted. Read the list again.` } };
        const keys = new Map();
        for (const g of gifts) { const k = keys.get(g.gkey) || { key: g.gkey, rows: 0, cents: 0 }; k.rows++; k.cents += Math.round(Number(g.amount) * 100); keys.set(g.gkey, k); }
        asked.push(...keys.values());
      }
      for (const a of (every ? [] : asked)) {
        const mine = gifts.filter(g => g.gkey === a.key);
        const c = mine.reduce((s, g) => s + Math.round(Number(g.amount) * 100), 0);
        if (mine.length !== a.rows || c !== a.cents) {
          return { status: 409, body: { error: "changed", sentence: `${groupLabel(a.key)} changed since this list was read: it now holds ${mine.length} ${mine.length === 1 ? "gift" : "gifts"} (${usd(c)}). Nothing was posted. Read the list again.` } };
        }
      }
      const ledger = await ctx.ensureOrgLedger(orgId, { heal: true });
      const fallback = await DF.ensureDefaultFund(query, (sql, p) => query(sql, p), orgId) || ledger.genFundId;
      const batchId = newId("lpb");
      const wrote = await postGiftRows(query, gifts.map(g => ({
        orgId, giftId: g.id, date: g.date, amount: Number(g.amount), fundId: g.fund_id || fallback, donorId: g.donor_id, donorName: g.donor_name,
        accountId: ledger.contribAcctId, description: Number(g.amount) < 0 ? `Refund: ${g.donor_name || "gift"}` : undefined,
        source: "post", actorId: who.id, actorName: who.name, batchId,
      })));
      let n = 0, cents = 0;
      for (const g of gifts) if (wrote.has(g.id)) { if (g.counted) n++; cents += Math.round(Number(g.amount) * 100); }
      await query(
        `INSERT INTO ledger_post_batches (id, org_id, groups, gift_count, cents, created_by, created_by_name)
         VALUES (?,?,?::jsonb,?,?,?,?) RETURNING id`,
        [batchId, orgId, JSON.stringify(asked.map(a => ({ key: a.key, label: groupLabel(a.key), rows: a.rows, cents: a.cents }))), n, cents, who.id, who.name]);
      return { status: 201, body: { batchId, n, cents, amount: cents / 100,
        sentence: `${n.toLocaleString("en-US")} ${n === 1 ? "gift" : "gifts"} posted to the books (${usd(cents)}), each to its own fund. Undo takes exactly these rows back off.` } };
    }));
    if (out.status === 201) {
      req.audit && req.audit.entity && req.audit.entity("ledger_post", out.body.batchId, `${out.body.n} gifts posted`);
      req.audit && req.audit.action && req.audit.action(`posted ${out.body.n} waiting gifts (${usd(out.body.cents)}) to the books`);
    }
    res.status(out.status).json(out.body);
  }));

  app.post("/finance/ledger-post/:id/undo", requireAuth, gate, wrap(async (req, res) => {
    const orgId = req.user.orgId, who = actor(req), id = String(req.params.id);
    const out = await withAdvisoryLock("ledgerpost:" + orgId, () => withAmbientTransaction(async () => {
      const [b] = await query("SELECT * FROM ledger_post_batches WHERE id = ? AND org_id = ? FOR UPDATE", [id, orgId]);
      if (!b) return { status: 404, body: { error: "not_found", sentence: "That posting is not one of yours." } };
      if (b.undone_at) return { status: 409, body: { error: "already_undone", sentence: "That posting was already undone." } };
      const gone = await query(
        `DELETE FROM fin_transactions WHERE org_id = ? AND post_batch_id = ? RETURNING ROUND(amount * 100)::bigint AS c`, [orgId, id]);
      await query("UPDATE ledger_post_batches SET undone_at = NOW(), undone_by = ?, undone_by_name = ? WHERE id = ? AND org_id = ? RETURNING id", [who.id, who.name, id, orgId]);
      const cents = gone.reduce((s, r) => s + Number(r.c), 0);
      return { status: 200, body: { undone: gone.length, cents, amount: cents / 100,
        sentence: `Undone. ${gone.length.toLocaleString("en-US")} ${gone.length === 1 ? "gift is" : "gifts are"} off the books again (${usd(cents)}) and back under Waiting to post.` } };
    }));
    if (out.status === 200) req.audit && req.audit.action && req.audit.action(`undid posting ${id}: ${out.body.undone} gifts off the books`);
    res.status(out.status).json(out.body);
  }));
}

module.exports = { routers, mount, postGiftRow, postGiftRows };
