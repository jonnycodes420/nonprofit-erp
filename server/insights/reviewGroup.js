// server/insights/reviewGroup.js · ASKS-2 item 3. ONE DECISION FOR A GROUP OF ROWS, ONE UNDO.
//
// "Rows that may not be gifts" is grouped by the reason and the memo's pattern
// (shared/numbers/notGiftGroups.js). A group takes the three decisions a
// single row has, applied to every row in it, with one Undo:
//
//   POST /insights/review-preview          what the decision would change, read
//                                          live; changes nothing
//   POST /insights/review-group            the decision, on every row of the group
//   POST /insights/review-group/:batch/undo  every row the click decided, put back
//
// Body: { groupKey, giftIds, decision: keep|not_gift|partly, value (partly,
// dollars received per row), as }. The group is re-checked here, row by row:
// a row is decided only when it is this org's, still waiting for a decision,
// still reads as maybe-not-a-gift and still falls in `groupKey`. Any other id
// in the request is refused and left exactly as it was. Never auto-decided:
// a person clicks, and the click names the group. A raffle group is never
// partly a gift (the row's own rule). Each row is decided by the row's own
// code (server/insights/reviewDecide.js); the totals and the after-change step
// run once for everyone the group touched. Nothing sends.
"use strict";
const I = require("../../insights");
const { query, run } = require("../../db");
const { newId } = require("../shared/newId");
const DECIDE = require("./reviewDecide");
const NG = require("../../shared/numbers/notGiftGroups");
const { settleDonorRoles } = require("../../shared/numbers/donorType");
const { afterChange } = require("../../afterChange");

const DECISIONS = new Set(["keep", "not_gift", "partly"]);
const MAX_ROWS = 2000;

// The rows of `giftIds` that are in group `groupKey` now: { inGroup: [gift], outside: [id] }.
async function rowsOf(orgId, groupKey, giftIds) {
  const ids = [...new Set((Array.isArray(giftIds) ? giftIds : []).map(String))].slice(0, MAX_ROWS);
  if (!ids.length) return { inGroup: [], outside: [] };
  const rows = await query(`SELECT g.*, d.name AS donor_name FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                             WHERE g.org_id = ? AND g.id = ANY(?::text[]) AND g.amount > 0
                               AND NOT EXISTS (SELECT 1 FROM insight_reviews r WHERE r.org_id = g.org_id AND r.gift_id = g.id)`, [orgId, ids]);
  const inGroup = [];
  for (const g of rows) {
    const memo = [g.memo, g.notes].filter(Boolean).join(" · ");
    const sig = I.notAGift(memo);
    if (sig && NG.groupKey(sig.kind || "other", NG.patternOf(memo, [g.donor_name])) === String(groupKey || "")) inGroup.push(g);
  }
  const ok = new Set(inGroup.map(g => g.id));
  return { inGroup, outside: ids.filter(id => !ok.has(id)) };
}
const valueCentsOf = v => { const n = Number(String(v == null ? "" : v).replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
const countWords = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function mount(app, { wrap, requireAuth, checkWriteAccess, actor }) {
  const bad = b => (!DECISIONS.has(b.decision) ? "Pick Keep as gifts, Partly a gift or Not a gift."
    : !b.groupKey ? "Which group? Open the list again." : null);

  // What the click would change. Read only: a POST because it carries the group's ids.
  app.post("/insights/review-preview", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, b = req.body || {};
    const why = bad(b); if (why) return res.status(400).json({ error: "bad_request", sentence: why });
    const { inGroup, outside } = await rowsOf(orgId, b.groupKey, b.giftIds);
    const value = b.decision === "partly" ? valueCentsOf(b.value) : 0;
    if (b.decision === "partly" && !value) return res.status(400).json({ error: "need_value", sentence: "Enter the value each person received, in dollars." });
    const att = await DECIDE.attachedIds(orgId, inGroup.map(g => g.id), b.decision);
    const p = await NG.preview(query, orgId, inGroup.filter(g => !att.has(g.id)).map(g => g.id), b.decision, value);
    res.json({ ...p, outside: outside.length, attached: att.size,
      sentence: `${p.sentence}${att.size ? ` ${countWords(att.size, "row has", "rows have")} a receipt, a payment, a pledge or a thank-you attached and would be left for you to change from the gift itself.` : ""}` });
  }));

  app.post("/insights/review-group", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, b = req.body || {}, a = actor(req);
    const why = bad(b); if (why) return res.status(400).json({ error: "bad_request", sentence: why });
    const { inGroup, outside } = await rowsOf(orgId, b.groupKey, b.giftIds);
    if (!inGroup.length) return res.status(409).json({ error: "nothing", sentence: "None of these rows is waiting for a decision any more. Look at the list again." });
    if (b.decision === "partly" && inGroup.some(g => (I.notAGift([g.memo, g.notes].filter(Boolean).join(" · ")) || {}).kind === "raffle")) {
      return res.status(400).json({ error: "raffle", sentence: "Raffle tickets are never a gift, not even in part. Mark them Not a gift." });
    }
    const valueCents = b.decision === "partly" ? valueCentsOf(b.value) : 0;
    if (b.decision === "partly" && !valueCents) return res.status(400).json({ error: "need_value", sentence: "Enter the value each person received, in dollars." });
    const att = await DECIDE.attachedIds(orgId, inGroup.map(g => g.id), b.decision);
    const before = await NG.preview(query, orgId, inGroup.filter(g => !att.has(g.id)).map(g => g.id), b.decision, valueCents);
    const batchId = newId("rvb");
    const donorIds = [...new Set(inGroup.map(g => g.donor_id))];
    const rolesBefore = new Map((await query(`SELECT id, person_types FROM donors WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, donorIds])).map(r => [r.id, r.person_types]));
    let done = 0, cents = 0;
    const skipped = [];
    for (const g of inGroup) {
      const r = await DECIDE.decide(orgId, a, g, { decision: b.decision, as: b.as, value: valueCents ? (valueCents / 100).toFixed(2) : undefined, batchId });
      if (r.status === 200) { done++; cents += Math.round(Number(g.amount) * 100); } else skipped.push({ giftId: g.id, sentence: r.body && r.body.sentence });
    }
    // Not a gift: a person left with no gift is no longer a donor (donorType.js), and Undo gives the role back.
    let contacts = 0;
    if (b.decision === "not_gift" && done) {
      contacts = await settleDonorRoles(query, orgId, donorIds);
      const now = await query(`SELECT id, person_types FROM donors WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, donorIds]);
      for (const d of now) {
        const was = rolesBefore.get(d.id);
        if (JSON.stringify(was) !== JSON.stringify(d.person_types)) {
          await run(`UPDATE insight_reviews SET roles_prev = ?::jsonb WHERE org_id = ? AND batch_id = ? AND donor_id = ?`, [JSON.stringify(was == null ? ["donor"] : was), orgId, batchId, d.id]);
        }
      }
    }
    if (done && b.decision !== "keep") await afterChange(orgId, donorIds, { door: "gift_form" });
    if (req.audit) { req.audit.entity("insight_review_batch", batchId); req.audit.after({ decision: b.decision, groupKey: b.groupKey, rows: done, giftIds: inGroup.map(g => g.id), contacts }); }
    const what = b.decision === "keep" ? "kept as gifts" : b.decision === "partly" ? "marked partly a gift" : "marked not a gift";
    // what happened, read again now (the preview said what would)
    const now = await NG.preview(query, orgId, [], "keep");
    const usd = c => `$${Math.round(c / 100).toLocaleString("en-US")}`;
    const changed = `Lifetime giving went from ${usd(before.lifetimeBeforeCents)} to ${usd(now.lifetimeBeforeCents)}${contacts ? `; ${countWords(contacts, "person has", "people have")} no gifts left and ${contacts === 1 ? "is a contact" : "are contacts"} now` : ""}.`;
    res.json({ ok: true, batchId, decision: b.decision, done, cents, skipped, outside: outside.length, contacts,
      undo: `/insights/review-group/${batchId}/undo`,
      sentence: `${countWords(done, "row", "rows")} ${what}.${b.decision === "keep" ? "" : ` ${changed}`}${skipped.length ? ` ${countWords(skipped.length, "row has", "rows have")} something attached and ${skipped.length === 1 ? "was" : "were"} left for you to change from the gift itself.` : ""}${outside.length ? ` ${countWords(outside.length, "row was", "rows were")} not in this group and ${outside.length === 1 ? "was" : "were"} left as ${outside.length === 1 ? "it was" : "they were"}.` : ""}` });
  }));

  app.post("/insights/review-group/:batchId/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, batchId = String(req.params.batchId);
    const rows = await query(`SELECT * FROM insight_reviews WHERE org_id = ? AND batch_id = ?`, [orgId, batchId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    let undone = 0;
    const failed = [], donorIds = new Set(), roles = new Map();
    for (const r of rows) {
      if (r.roles_prev && r.donor_id) roles.set(r.donor_id, r.roles_prev);
      const u = await DECIDE.undo(orgId, r);
      if (u.status === 200) { undone++; if (u.donorId) donorIds.add(u.donorId); if (r.donor_id) donorIds.add(r.donor_id); }
      else failed.push({ giftId: r.gift_id, sentence: u.body && u.body.sentence });
    }
    // their gifts are back, so is the role a group's Not a gift took away
    for (const [id, was] of roles) {
      await run(`UPDATE donors SET person_types = ?::jsonb, updated_at = NOW() WHERE org_id = ? AND id = ? AND NOT (COALESCE(person_types, '[]'::jsonb) @> '["donor"]'::jsonb)`,
        [JSON.stringify(was), orgId, id]);
    }
    if (donorIds.size) await afterChange(orgId, [...donorIds], { door: "gift_form" });
    if (req.audit) { req.audit.entity("insight_review_batch", batchId); req.audit.after({ undone, giftIds: rows.map(r => r.gift_id) }); }
    res.json({ ok: true, undone, failed, sentence: failed.length ? `${countWords(undone, "row", "rows")} put back. ${failed[0].sentence}` : `Put back as ${undone === 1 ? "it was" : "they were"}: ${countWords(undone, "row", "rows")}.` });
  }));
}

module.exports = { mount, rowsOf };
