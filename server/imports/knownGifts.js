// server/imports/knownGifts.js · IMPORT-13. WHAT THE ORG ALREADY HOLDS DECIDES WHAT A FILE ADDS.
//
// The one reader (shared/sheetRead.js) knows one file; this knows the org. It
// runs on the preview and again on the commit (routes/sheetImport.js
// buildUnderstanding), after people are matched, so the preview and the write
// are one plan:
//   · A gift ID the org already holds is that gift (item 1). The same person,
//     amount and date is already here and is skipped at the write. A different
//     amount, date or person is "changed since your last import: ST-001 was
//     $250.00, the file now says $999.00", set aside by default; "Update to the
//     file's amount" (answers.changedGifts = "update") edits the one gift's
//     amount and date (summary_json.giftUpdates keeps the before, Undo puts it
//     back). A gift is never moved to another person by a file.
//   · Twins with no ID are counted, one rule everywhere (item 4): three
//     identical $125 rows when the org already holds two from an earlier import
//     is one more gift. The rows the org holds are skipped at the write.
//   · A refund the file cannot match finds its gift among the org's own (item
//     4): by source ID, otherwise the latest gift of that amount on or before
//     it, else the latest larger one with that much left. Still nothing is a
//     refund with no gift to match, listed by name and set aside.
"use strict";

const toCents = v => Math.round(Number(v || 0) * 100);
const fmt$ = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = d => (d ? String(d).slice(0, 10) : null);
const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// A plan row moved to the set-aside list, with the counts the button and the receipt read.
function moveAside(u, rows, why) {
  if (!rows.length) return;
  const out = new Set(rows);
  const c = u.counts || (u.counts = {});
  const sub = (k, n) => { if (typeof c[k] === "number") c[k] = Math.max(0, c[k] - n); };
  sub("gifts", rows.length); sub("giftCents", rows.reduce((n, g) => n + (g.cents || 0), 0)); sub("undatedGifts", rows.filter(g => !g.date).length);
  c.aside = (c.aside || 0) + rows.length;
  u.gifts = u.gifts.filter(g => !out.has(g));
  const L = u.rowLedger || (u.rowLedger = { setAside: [] });
  for (const g of rows) { const a = { sheet: g.sheet, line: g.line, who: g.who, cents: g.cents, ...why(g) }; u.aside.push(a); (L.setAside || (L.setAside = [])).push(a); }
}

async function applyKnownGifts({ query }, { orgId, u, idOf, answers = {} }) {
  const out = { changed: [], alreadyHere: 0, twinsHeld: 0, refundsMatched: 0 };
  const gifts = u.gifts.filter(g => g.kind === "gift");
  // ── 1. gift IDs the org already holds
  const ids = [...new Set(gifts.filter(g => g.externalId).map(g => String(g.externalId)))];
  const held = ids.length ? await query(
    `SELECT id, donor_id, external_id, amount::text AS amount, date::text AS date FROM gifts WHERE org_id=? AND external_id = ANY(?::text[])`, [orgId, ids]) : [];
  const byExt = new Map(held.map(h => [String(h.external_id), h]));
  const changed = [];
  for (const g of gifts) {
    const h = g.externalId && byExt.get(String(g.externalId));
    if (!h) continue;
    const pid = idOf(g.personKey);
    const was = toCents(h.amount), samePerson = !pid || pid === h.donor_id;
    if (samePerson && was === g.cents && day(h.date) === day(g.date)) { g.alreadyHere = true; out.alreadyHere++; continue; }
    const diffs = [];
    if (was !== g.cents) diffs.push(`was ${fmt$(was)}, the file now says ${fmt$(g.cents)}`);
    if (day(h.date) !== day(g.date)) diffs.push(`was dated ${day(h.date) || "no date"}, the file now says ${day(g.date) || "no date"}`);
    if (!samePerson) diffs.push("the file now gives it to someone else");
    changed.push({ g, h, was, samePerson, sentence: `${g.externalId} ${diffs.join("; ")}` });
  }
  const update = answers.changedGifts === "update";
  u.giftUpdates = update ? changed.filter(x => x.samePerson).map(x => ({ giftId: x.h.id, donorId: x.h.donor_id, externalId: x.g.externalId, sheet: x.g.sheet, line: x.g.line,
    before: { cents: x.was, date: day(x.h.date) }, after: { cents: x.g.cents, date: day(x.g.date) } })) : [];
  // an update is the one gift edited, never a new one; a gift for someone else is always set aside
  const updated = new Set(update ? changed.filter(x => x.samePerson).map(x => x.g) : []);
  if (updated.size) { u.gifts = u.gifts.filter(g => !updated.has(g)); const c = u.counts || {}; c.gifts = Math.max(0, (c.gifts || 0) - updated.size); c.giftCents = Math.max(0, (c.giftCents || 0) - [...updated].reduce((n, g) => n + g.cents, 0)); }
  const asideNow = changed.filter(x => !updated.has(x.g));
  moveAside(u, asideNow.map(x => x.g), g => {
    const x = changed.find(y => y.g === g);
    return { reason: `changed since your last import: ${x.sentence}`, changed: { giftId: x.h.id, externalId: g.externalId, wasCents: x.was, fileCents: g.cents, wasDate: day(x.h.date), fileDate: day(g.date), samePerson: x.samePerson } };
  });
  out.changed = changed.map(x => ({ sheet: x.g.sheet, line: x.g.line, who: x.g.who, externalId: x.g.externalId, wasCents: x.was, fileCents: x.g.cents, sentence: `${x.sentence}`,
    updated: updated.has(x.g), samePerson: x.samePerson }));
  if (changed.length) {
    const canUpdate = changed.some(x => x.samePerson);
    u.questions.push({ id: "changedGifts", kind: "changedGifts", optional: true, default: "aside", answer: update ? "update" : "aside", chosen: answers.changedGifts === "update" || answers.changedGifts === "aside",
      count: changed.length, rows: out.changed,
      text: `${plural(changed.length, "gift has", "gifts have")} changed since your last import: ${changed.slice(0, 3).map(x => x.sentence).join(". ")}${changed.length > 3 ? " …" : ""}.`,
      hint: "Set aside, the gift in Steward stays as it is and nothing new is added. Updated, the one gift takes the file's amount and date; Undo puts it back.",
      options: [{ key: "aside", label: "Set them aside" }, ...(canUpdate ? [{ key: "update", label: "Update to the file's amount" }] : [])] });
  }
  // ── 2. twins with no ID, counted against what the org holds from earlier imports
  const noId = u.gifts.filter(g => g.kind === "gift" && !g.externalId && g.date && idOf(g.personKey));
  if (noId.length) {
    const donors = [...new Set(noId.map(g => idOf(g.personKey)))];
    const rows = await query(`SELECT donor_id, amount::text AS amount, date::text AS date, COUNT(*)::int AS n FROM gifts
                               WHERE org_id=? AND donor_id = ANY(?::text[]) AND external_id IS NULL AND import_id IS NOT NULL AND amount > 0 AND date IS NOT NULL
                               GROUP BY 1, 2, 3`, [orgId, donors]);
    const hold = new Map(rows.map(r => [`${r.donor_id}|${toCents(r.amount)}|${day(r.date)}`, r.n]));
    for (const g of noId) {
      const k = `${idOf(g.personKey)}|${g.cents}|${day(g.date)}`;
      const left = hold.get(k) || 0;
      if (left > 0) { g.alreadyHere = true; hold.set(k, left - 1); out.twinsHeld++; }
    }
  }
  // ── 3. refunds the file could not match, against the org's own gifts
  const lone = u.aside.filter(a => a.refundUnmatched && idOf(a.personKey));
  if (lone.length) {
    const donors = [...new Set(lone.map(a => idOf(a.personKey)))];
    const gs = await query(`SELECT g.id, g.donor_id, g.external_id, g.amount::text AS amount, g.date::text AS date,
                              g.amount + COALESCE((SELECT SUM(r.amount) FROM gifts r WHERE r.org_id = g.org_id AND r.refund_of = g.id), 0) AS left_amount
                              FROM gifts g WHERE g.org_id=? AND g.donor_id = ANY(?::text[]) AND g.amount > 0 AND g.refund_of IS NULL
                               AND COALESCE(g.refunded_in_full, false) = false`, [orgId, donors]);
    const keys = lone.map(a => "sheet:" + a.rowId);
    const done = new Set((await query(`SELECT idempotency_key FROM gifts WHERE org_id=? AND idempotency_key = ANY(?::text[])`, [orgId, keys])).map(r => r.idempotency_key));
    const left = new Map(gs.map(x => [x.id, toCents(x.left_amount)]));
    const later = (a, b) => String(b.date || "").localeCompare(String(a.date || ""));
    const matched = [];
    for (const a of lone) {
      const want = -a.cents, pid = idOf(a.personKey);
      const ref = String(a.ref || "").trim().toLowerCase();
      const mine = gs.filter(x => x.donor_id === pid && (left.get(x.id) || 0) >= want && (!a.date || !x.date || day(x.date) <= a.date));
      const g = (ref && mine.find(x => x.external_id && String(x.external_id).toLowerCase() === ref)) || mine.filter(x => toCents(x.amount) === want).sort(later)[0] || mine.sort(later)[0];
      if (!g && !done.has("sheet:" + a.rowId)) continue;
      matched.push(a);
      const full = g ? left.get(g.id) === want : false;
      if (g) left.set(g.id, left.get(g.id) - want);
      (u.refunds || (u.refunds = [])).push({ rowId: a.rowId, sheet: a.sheet, line: a.line, personKey: a.personKey, who: a.who, cents: a.cents, date: a.date || day(g && g.date), undated: !(a.date || (g && g.date)),
        method: null, methodOriginal: null, fund: null, campaign: null, externalId: null, note: g ? `Refund of the ${fmt$(toCents(g.amount))} gift of ${day(g.date) || "no date"}` : "Refund",
        frequency: "unknown", frequencyOriginal: null, flags: [], kind: "refund", refundOfGiftId: g ? g.id : null, refundOf: null, full, alreadyHere: !g });
      out.refundsMatched++;
    }
    if (matched.length) {
      const m = new Set(matched);
      u.aside = u.aside.filter(a => !m.has(a));
      if (u.rowLedger && u.rowLedger.setAside) u.rowLedger.setAside = u.rowLedger.setAside.filter(a => !m.has(a) && !matched.some(x => x.sheet === a.sheet && x.line === a.line));
      if (u.counts) u.counts.aside = Math.max(0, (u.counts.aside || 0) - matched.length);
    }
  }
  u.knownGifts = out;
  if (u.rowChecks && out.changed.length) u.rowChecks.changed = { count: out.changed.length, updated: out.changed.some(x => x.updated), rows: out.changed.slice(0, 50) };
  return out;
}

// After the gifts are written: her "Update to the file's amount", the one gift
// edited, its before kept for Undo. The audit trail records the request.
async function applyGiftUpdates({ query }, { orgId, u }) {
  const done = [];
  for (const x of u.giftUpdates || []) {
    const r = await query(`UPDATE gifts SET amount=?, date=? WHERE id=? AND org_id=? AND donor_id=? RETURNING id`,
      [x.after.cents / 100, x.after.date, x.giftId, orgId, x.donorId]);
    if (r.length) done.push(x);
  }
  return done;
}

// Undo: each gift her update edited takes its amount and date back.
async function undoGiftUpdates({ query }, orgId, updates) {
  let n = 0;
  for (const x of updates || []) {
    const r = await query(`UPDATE gifts SET amount=?, date=? WHERE id=? AND org_id=? RETURNING donor_id`, [x.before.cents / 100, x.before.date, x.giftId, orgId]);
    n += r.length;
  }
  return n;
}

module.exports = { applyKnownGifts, applyGiftUpdates, undoGiftUpdates, moveAside };
