// server/donors/householdSplit.js · HOUSEHOLD-1 item 5. UNDO A COUPLE MERGE.
//
// A pilot customer merged couples to see them as one line, which left one
// person's email, phone and photo behind. Data health's merge Undo restores
// both people exactly for 30 days (routes/dataHealth.js). This puts it on the
// merged person's profile and finishes the job in one step:
//
//   GET  /donors/:id/merged-from         the latest merge into this person that
//                                        is not undone: can it be split (30 days),
//                                        and the sentence that says so
//   POST /donors/:id/split-to-household  { mergeId } the merge's own Undo, then
//                                        the two people in one household, in one
//                                        transaction: both or neither
//
// The household: if neither person was in one, a new one named for the kept
// person's last name; if one was, the other joins it. If they were in two
// different households it refuses and changes nothing. Every gift goes back to
// the person who gave it (the Undo's own rule); nothing is sent.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");

const routers = { r1: express.Router() };
const DAY_MS = 86400000;

function mount(ctx) {
const { query, wrap, requireAuth, checkWriteAccess, withTransaction, withAdvisoryLock, queryTx, runTx, actor, staffWho, lastName } = ctx;
const app = routers.r1;
const DH = () => require("../../routes/dataHealth");
const fmtDay = d => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// The person, if they are in this org and theirs to see (ACCESS-2); else the same 404 as nobody.
async function personOf(req) {
  const vis = require("../auth/portfolio").visibleSql(req, "d");
  const [d] = await query(`SELECT d.id FROM donors d WHERE d.org_id = ? AND d.id = ? AND d.deleted_at IS NULL${vis.sql}`, [req.user.orgId, String(req.params.id), ...vis.args]);
  return d || null;
}

app.get("/donors/:id/merged-from", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (!(await personOf(req))) return res.status(404).json({ error: "Not found" });
  const [m] = await query(
    `SELECT id, merged_name, kept_name, created_at FROM donor_merges
      WHERE org_id = ? AND kept_id = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`, [orgId, String(req.params.id)]);
  if (!m) return res.json({ merge: null });
  const days = DH().UNDO_DAYS;
  const canSplit = Date.now() - new Date(m.created_at).getTime() <= days * DAY_MS;
  res.json({ merge: { id: m.id, mergedName: m.merged_name, keptName: m.kept_name, mergedOn: new Date(m.created_at).toISOString().slice(0, 10), canSplit,
    sentence: canSplit
      ? `This record was merged from two people (${m.merged_name} on ${fmtDay(m.created_at)}). Split them back into a household? Each gets back their own email, phone, photo and gifts.`
      : `This record was merged from two people (${m.merged_name} on ${fmtDay(m.created_at)}). A merge can be split back for ${days} days; this one is older, so Steward can't split it automatically. Add ${m.merged_name} again and group them into a household.` } });
}));

app.post("/donors/:id/split-to-household", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const mergeId = String((req.body && req.body.mergeId) || "");
  const keptId = String(req.params.id);
  if (!(await personOf(req))) return res.status(404).json({ error: "Not found" });
  const a = actor(req);
  const me = { id: a.id, name: a.name };
  let out;
  try {
    out = await withAdvisoryLock(`merge:${orgId}`, () => withTransaction(async client => {
      const [m] = await queryTx(client, "SELECT kept_id FROM donor_merges WHERE id = ? AND org_id = ?", [mergeId, orgId]);
      if (!m || m.kept_id !== keptId) { const e = new (DH().MergeRefused)("That merge isn't on file for this person."); e.status = 404; throw e; }
      const undone = await DH().undoMergeIn(client, orgId, mergeId, me);
      const both = await queryTx(client, "SELECT id, name, household_id FROM donors WHERE org_id = ? AND id = ANY(?::text[])", [orgId, [undone.keptId, undone.mergedId]]);
      const kept = both.find(d => d.id === undone.keptId), merged = both.find(d => d.id === undone.mergedId);
      const hh = [...new Set(both.map(d => d.household_id).filter(Boolean))];
      if (hh.length > 1) throw new (DH().MergeRefused)(`${kept.name} and ${merged.name} were in two different households before the merge, so nothing was changed. Undo the merge from Data health, then choose their household.`);
      let householdId = hh[0] || null, name = null, made = false;
      if (householdId) {
        const [h] = await queryTx(client, "SELECT name FROM households WHERE id = ? AND org_id = ?", [householdId, orgId]);
        name = h ? h.name : "their household";
      } else {
        const ln = lastName(kept.name);
        name = ln ? `The ${ln} Household` : "Household";
        householdId = newId("hh");
        made = true;
        await runTx(client, "INSERT INTO households (id, org_id, name, primary_donor_id, joint_acknowledgment, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)",
          [householdId, orgId, name, kept.id, true, a.id, a.name]);
      }
      const joined = both.filter(d => d.household_id !== householdId).map(d => d.id);
      if (joined.length) await runTx(client, "UPDATE donors SET household_id = ? WHERE org_id = ? AND id = ANY(?::text[])", [householdId, orgId, joined]);
      return { ...undone, householdId, householdName: name, made, joined, keptName: kept.name, mergedName: merged.name };
    }));
  } catch (e) {
    if (e instanceof DH().MergeRefused) return res.status(e.status || 409).json({ error: "split_refused", sentence: e.sentence });
    throw e;
  }
  // WIRE-1: joining a household is a line on the person (as POST /households writes it).
  const who = await staffWho(req);
  for (const donorId of out.joined)
    await require("../../timelineLine").timelineLine({ orgId, donorId, note: `Joined ${out.householdName}.`, actorId: who.id, actorName: who.name,
      metadata: { via: "household", household_id: out.householdId, change: "joined" } });
  req.audit = { ...(req.audit || {}), record: { donor_id: out.keptId, merged_id: out.mergedId, merge_id: mergeId, household_id: out.householdId } };
  require("../../routes/dataHealth").recheckSoon && require("../../routes/dataHealth").recheckSoon(orgId, "merge_undo");
  res.json({ ...out, sentence: `${out.keptName} and ${out.mergedName} are two people again, in ${out.householdName}. Each has their own email, phone, photo and gifts.` });
}));
}

module.exports = { routers, mount };
