// pledgeWrite.js · FIX-60. THE ONE WRITER OF A PLEDGE AND ITS INSTALLMENTS.
//
// Every door that makes a pledge comes through writePledges: the profile's
// Add pledge (POST /donors/:id/pledges, which is also what an API caller
// uses), the file import (sheet-import, its event workbooks included), the
// history import's commitments and shells (POST /donors/import-semantics), To
// confirm, a proposal committed, a grant awarded, an unpaid event sponsorship
// and the expected employer match recordGift opens. The history route wrote its
// pledges with no installments (SWEEP-4), so recordGift had nothing to apply a
// payment to and its shells held payments no installment knew about.
//
// The rules, decided once here:
//   · a pledge is written WITH its installments, and they sum to the pledge to
//     the cent (a schedule that does not is refused before anything is written);
//   · with no schedule and no cadence it is one installment of the whole pledge
//     on its due date (SWEEP-4), or undated when the caller says there is no
//     date anybody wrote down (a shell);
//   · payments already linked to it are applied oldest first, each to its own
//     installment of exactly its amount: a payment equal to the next planned
//     installment is that installment; one that is not splits or joins the plan
//     so the paid part is the payment, to the cent. What is paid past the
//     pledge is surplus (recalcPledgePayment) and has no installment.
//
// Writes only rows that carry their actor (created_by is required). It never
// writes an audit row: the route's audit middleware records the request.
"use strict";
const { query, run, uuid } = require("./db");
const money = require("./money");

const depositMod = () => import("./shared/depositSheet.js");
const ISO = /^\d{4}-\d{2}-\d{2}/;
const day = v => (v && ISO.test(String(v)) ? String(v).slice(0, 10) : null);

// What the schedule IS, written nowhere: an explicit schedule (it must sum to
// the pledge), a cadence, or neither, which is ONE installment of the whole.
// `undatedOk` lets a row carry no due date (IMPORT-5's "No set due date", a
// shell's remainder); otherwise a row with no date is not a row.
async function planInstallments({ amountCents, schedule, frequency, count, firstDue, undatedOk = false }) {
  let rows = [];
  if (Array.isArray(schedule) && schedule.length) {
    rows = schedule.map((r, i) => ({
      seq: i + 1,
      dueDate: day(r.dueDate || r.due_date),
      amountCents: r.amountCents != null ? Math.round(Number(r.amountCents)) : (money.toCents(r.amount) ?? 0),
    })).filter(r => (r.dueDate || undatedOk) && r.amountCents > 0);
    const sum = rows.reduce((s, r) => s + r.amountCents, 0);
    if (rows.length && amountCents && sum !== amountCents) {
      const e = new Error(`a schedule must sum to the pledge: ${money.formatCents(sum)} of ${money.formatCents(amountCents)}`);
      e.code = "schedule_does_not_sum"; throw e;
    }
  } else if (frequency && count) {
    rows = (await depositMod()).generateInstallments({ amountCents, frequency, count, firstDue });
  }
  if (!rows.length && amountCents > 0 && (day(firstDue) || undatedOk)) {
    rows = [{ seq: 1, dueDate: day(firstDue), amountCents }];
  }
  return rows.map((r, i) => ({ seq: i + 1, dueDate: r.dueDate || null, amountCents: r.amountCents }));
}

// The planned rows with the payments applied, oldest payment first, to the
// cent. Pure: rows in, rows out (each with paidGiftId or null).
function applyPayments(plan, payments) {
  const open = plan.map(r => ({ ...r }));
  const out = [];
  let left = open.reduce((s, r) => s + r.amountCents, 0);
  const pays = [...payments].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.id).localeCompare(String(b.id)));
  for (const p of pays) {
    if (left <= 0) break;
    const need = Math.min(p.cents, left);
    if (need <= 0) continue;
    const head = open[0];
    const wholeRow = head && head.amountCents === need;
    let taken = 0;
    while (taken < need && open.length) {
      const h = open[0];
      const t = Math.min(h.amountCents, need - taken);
      taken += t; h.amountCents -= t;
      if (h.amountCents === 0) open.shift();
    }
    // exactly the next installment: it IS that one, on its own date; otherwise
    // the paid part is dated the day it was paid
    out.push({ dueDate: wholeRow ? head.dueDate : (day(p.date) || head.dueDate), amountCents: need, paidGiftId: p.id });
    left -= need;
  }
  for (const r of open) out.push({ dueDate: r.dueDate, amountCents: r.amountCents, paidGiftId: null });
  return out.map((r, i) => ({ ...r, seq: i + 1 }));
}

const PCOLS = ["id", "org_id", "donor_id", "amount", "due_date", "status", "notes", "idempotency_key", "frequency", "installment_count",
               "created_by", "created_by_name", "import_id", "event_id", "gift_type", "campaign_id", "is_match", "matches_gift_id"];

// writePledges(items) → [{ id, created, installments }], in the order given.
// Each item: { orgId, donorId, amountCents, dueDate, status, notes,
//   idempotencyKey, importId, eventId, giftType, campaignId, isMatch,
//   matchesGiftId, createdBy, createdByName, id?,
//   plan: { schedule, frequency, count, firstDue, undatedOk },
//   link?: async (pledgeId) => [giftId, …]   gifts to link once it is written }
// A pledge that conflicts with one already there (the same idempotency key,
// the same matched gift) is not written again: created false, nothing else.
// Plans every item before writing any, so a bad schedule writes nothing.
// opts: { door, history } names the after-change step (LIVE-1) run, a moment
// later and once, for the people whose pledges were written (recalc: false, a
// pledge is not money). A caller inside a transaction that runs the step itself
// after its commit (the file import) passes afterChange: false.
async function writePledges(items, opts = {}) {
  if (!items.length) return [];
  const prepared = [];
  for (const it of items) {
    if (!it.orgId || !it.donorId) throw new Error("writePledges: orgId and donorId are required");
    if (!it.createdBy) throw new Error("writePledges: the actor (createdBy) is required on every pledge");
    const amountCents = Math.round(Number(it.amountCents));
    if (!(amountCents > 0)) { const e = new Error("A positive amount is required"); e.code = "bad_amount"; throw e; }
    const p = it.plan || {};
    const firstDue = p.firstDue !== undefined ? p.firstDue : it.dueDate;
    const rows = await planInstallments({ amountCents, schedule: p.schedule, frequency: p.frequency, count: p.count,
                                          firstDue, undatedOk: !!p.undatedOk });
    prepared.push({ it, id: it.id || "pl_" + uuid().slice(0, 8), amountCents, rows,
                    frequency: p.frequency || it.frequency || null });
  }
  const BATCH = 200;
  const madeIds = new Set();
  for (let k = 0; k < prepared.length; k += BATCH) {
    const slice = prepared.slice(k, k + BATCH);
    const vals = slice.map(({ it, id, amountCents, rows, frequency }) => [
      id, it.orgId, it.donorId, money.toDollars(amountCents), day(it.dueDate),
      it.status || "open", it.notes ?? null, it.idempotencyKey || null, frequency, rows.length || null,
      it.createdBy, it.createdByName || it.createdBy, it.importId || null, it.eventId || null, it.giftType || null,
      it.campaignId || null, !!it.isMatch, it.matchesGiftId || null]);
    // no conflict target: an idempotency key or a matched gift already there
    // (both partial unique indexes) is the same pledge, and is not written twice
    const ins = await query(`INSERT INTO pledges (${PCOLS.join(",")}) VALUES ${vals.map(() => "(" + PCOLS.map(() => "?").join(",") + ")").join(",")}
                              ON CONFLICT DO NOTHING RETURNING id`, vals.flat());
    for (const r of ins) madeIds.add(r.id);
  }
  const inst = [];
  const out = [];
  for (const pr of prepared) {
    if (!madeIds.has(pr.id)) { out.push({ id: pr.id, created: false, installments: 0 }); continue; }
    let rows = pr.rows.map(r => ({ ...r, paidGiftId: null }));
    if (typeof pr.it.link === "function") {
      const linked = (await pr.it.link(pr.id)) || [];
      if (linked.length) {
        const pays = await query(
          `SELECT g.id, ROUND(g.amount::numeric * 100)::bigint AS cents, LEFT(g.date::text, 10) AS date FROM gifts g
            WHERE g.org_id=? AND g.id = ANY(?) AND g.pledge_id=?
              AND NOT EXISTS (SELECT 1 FROM pledge_installments i WHERE i.paid_gift_id = g.id)`,
          [pr.it.orgId, linked, pr.id]);
        rows = applyPayments(pr.rows, pays.map(p => ({ id: p.id, cents: Number(p.cents), date: p.date })));
      }
    }
    for (const r of rows) inst.push(["pli_" + uuid().slice(0, 10), pr.it.orgId, pr.id, r.seq, r.dueDate, money.toDollars(r.amountCents), r.paidGiftId]);
    if (rows.length !== pr.rows.length) await run("UPDATE pledges SET installment_count=? WHERE id=? AND org_id=?", [rows.length, pr.id, pr.it.orgId]);
    out.push({ id: pr.id, created: true, installments: rows.length });
  }
  const ICOLS = 7;
  for (let k = 0; k < inst.length; k += BATCH) {
    const slice = inst.slice(k, k + BATCH);
    await run(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount,paid_gift_id,paid_at)
               VALUES ${slice.map(() => "(?,?,?,?,?,?,?, CASE WHEN ?::text IS NULL THEN NULL ELSE NOW() END)").join(",")}`,
      slice.flatMap(r => [...r, r[ICOLS - 1]]));
  }
  if (opts.afterChange !== false) {
    const byOrg = new Map();
    prepared.forEach((pr, i) => { if (out[i].created) (byOrg.get(pr.it.orgId) || byOrg.set(pr.it.orgId, new Set()).get(pr.it.orgId)).add(pr.it.donorId); });
    for (const [orgId, ids] of byOrg)
      require("./afterChange").afterChangeSoon(orgId, [...ids], { door: opts.door || "pledge", history: !!opts.history, recalc: false });
  }
  return out;
}

const writePledge = async (item, opts) => (await writePledges([item], opts))[0];

module.exports = { writePledge, writePledges, planInstallments, applyPayments };
