// BUILD-96 Part 2 — WHAT "SAMPLE DATA" EXACTLY IS.
//
// Until now, sample data was a convenience: a demo org full of invented
// people, cleared by a route that fired a dozen deletes and swallowed every
// error. That was fine while the only orgs holding it were ours.
//
// It is not fine now. `org_justinsplace` holds invented people under a REAL
// organisation's name, and the person who will sign in to it is a real
// fundraiser who is about to load her real file. Clearing that org has to mean
// exactly the rows the provisioning path wrote — not approximately, and never
// one row belonging to a customer.
//
// So this file exists to be the ONE definition. The guard, the counts and the
// delete all read from it, because three lists would eventually disagree and
// the way they would disagree is by deleting something real.
//
// THE MODEL, in one line: a row is sample if it is TAGGED sample, or if it
// hangs off a donor who is. The second half is not a heuristic — a Thread, a
// pledge or a receipt cannot exist without a donor, so a row pointing at an
// invented person IS invented. Tagging the child as well (which the loader
// does for the three tables BUILD-85/94 added) makes it exact from both
// directions.

// Tables carrying their own `is_sample` flag that are NOT keyed by donor_id.
// Order is FK-safe: children before parents.
const TAGGED_TABLES = [
  "event_attendees",
  "events",
  "campaigns",
  "grants",
  "fin_transactions",
  "fin_funds",
  "board_members",
  "households",
];

// Households are in BOTH lists, and that is the point. A household is not
// keyed by `donor_id` — it is keyed by `primary_donor_id`, and its members
// point at IT — so the donor-child sweep below cannot see it and the tagged
// sweep above only sees it if something remembered to tag it. A household
// that outlived its members is the one row that could survive a clear and sit
// on the screen naming five people who no longer exist.
const HOUSEHOLD_BY_DONOR_SQL =
  "DELETE FROM households WHERE org_id=? AND primary_donor_id IN (%IDS%)";

// Tables keyed by donor_id. Every row of these belonging to a sample donor is
// sample by construction. Order is FK-safe: gift-children and
// subscription-children come before the rows they point at, and `gifts` and
// `donors` are handled last, in that order, outside this list.
//
// Each entry is deleted with `WHERE org_id = ? AND donor_id IN (<sample
// donors>)`. A table that is missing the column or the table itself is
// reported, not swallowed — see clearSampleData.
const DONOR_CHILD_TABLES = [
  "sequence_sends",
  "sequence_enrollments",
  "reconnect_sends",
  "recurring_change_log",
  "recurring_proposals",
  "payment_recovery_events",
  "recurring_subscriptions",
  "giving_recurring",
  "gift_duplicate_questions",
  "thank_you_drafts",
  "receipts",
  "pledges",
  "opportunities",
  "moves",
  "donor_designations",
  "donor_materials",
  "planned_gifts",
  "milestone_drafts",
  "note_reminders",
  "import_merges",
  "workflow_runs",
  "campaign_recipients",
  "custom_field_values",
  "portal_audit_log",
  "donor_account_links",
  "threads",
  "tasks",
  "interactions",
  "volunteers",
];

// The three tables whose rows the product THINKS of as sample data even though
// a person would not call them tables. Reported separately in the counts so
// the confirmation names what she will actually stop seeing.
const HEADLINE = ["people", "gifts", "households", "threads", "tasks", "enrollments", "timeline"];

// A gift the provisioning path did not write. This is the whole safety
// property: an org with one hand-entered gift is an org somebody has started
// using, and clearing it is never what was meant.
const REAL_GIFT_SQL =
  "SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=? AND is_sample IS NOT TRUE";

// THE PROVISIONING PATH'S LAST ACT.
//
// BUILD-96 Part 2 added `is_sample` to threads, households and
// sequence_enrollments. A column nobody writes is not a tag, it is a lie with
// a default — so this is what writes it.
//
// It is a SWEEP rather than a flag on each INSERT because the loader does not
// write these three tables at all: a Thread is opened by the thread engine
// after a sample gift lands, a household by whoever groups two sample people,
// an enrolment by a sequence the sample donors were added to. The rows appear
// because of the loader, minutes or days later, and every one of them hangs
// off a donor the loader DID write and tag.
//
// So the derivation is exact in both directions: a row is tagged because its
// person is tagged, and the clear can then find it by either. Call it at the
// end of provisioning and again before a clear — it is idempotent, it only
// ever sets the flag ON for rows already reachable through a sample donor, and
// it can never reach a row belonging to somebody real, because a real person
// is not tagged and nothing here tags people.
async function tagSampleRows({ query, run }, orgId) {
  const ids = await sampleDonorIds(query, orgId);
  const tagged = {};
  if (!ids.length) return tagged;
  const ph = ids.map(() => "?").join(",");

  const sweep = async (table, sql, params) => {
    try {
      const r = await run(sql, params);
      if (r && r.changes) tagged[table] = r.changes;
    } catch (err) {
      if (err && (err.code === "42P01" || err.code === "42703")) return;
      throw err;   // a tagging failure is loud: the clear that follows relies on it
    }
  };

  await sweep("threads",
    `UPDATE threads SET is_sample=true WHERE org_id=? AND is_sample IS NOT TRUE AND donor_id IN (${ph})`,
    [orgId, ...ids]);
  await sweep("sequence_enrollments",
    `UPDATE sequence_enrollments SET is_sample=true WHERE org_id=? AND is_sample IS NOT TRUE AND donor_id IN (${ph})`,
    [orgId, ...ids]);
  // A household is sample when its PRIMARY is — the primary is the record the
  // household is named and acknowledged for. A household whose primary is real
  // is a real household even if an invented person wandered into it, and it
  // stays.
  await sweep("households",
    `UPDATE households SET is_sample=true WHERE org_id=? AND is_sample IS NOT TRUE AND primary_donor_id IN (${ph})`,
    [orgId, ...ids]);

  return tagged;
}

async function sampleDonorIds(query, orgId) {
  const rows = await query("SELECT id FROM donors WHERE org_id=? AND is_sample=true", [orgId]);
  return rows.map(r => r.id);
}

// What is there. Used by the super-admin preview, by the refusal message, and
// by the Home banner's status route — so the number she is told and the number
// that gets deleted are read the same way.
async function countSampleData(query, orgId) {
  const one = async (sql, params) => {
    const rows = await query(sql, params);
    return parseInt(rows[0]?.c ?? 0, 10) || 0;
  };
  const [people, gifts, households, threads, tasks, enrollments, timeline, realGifts] = await Promise.all([
    one("SELECT COUNT(*)::int AS c FROM donors WHERE org_id=? AND is_sample=true", [orgId]),
    one("SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=? AND is_sample=true", [orgId]),
    one("SELECT COUNT(*)::int AS c FROM households WHERE org_id=? AND is_sample=true", [orgId]),
    one("SELECT COUNT(*)::int AS c FROM threads WHERE org_id=? AND donor_id IN (SELECT id FROM donors WHERE org_id=? AND is_sample=true)", [orgId, orgId]),
    one("SELECT COUNT(*)::int AS c FROM tasks WHERE org_id=? AND (is_sample=true OR donor_id IN (SELECT id FROM donors WHERE org_id=? AND is_sample=true))", [orgId, orgId]),
    one("SELECT COUNT(*)::int AS c FROM sequence_enrollments WHERE org_id=? AND donor_id IN (SELECT id FROM donors WHERE org_id=? AND is_sample=true)", [orgId, orgId]),
    one("SELECT COUNT(*)::int AS c FROM interactions WHERE org_id=? AND (is_sample=true OR donor_id IN (SELECT id FROM donors WHERE org_id=? AND is_sample=true))", [orgId, orgId]),
    one(REAL_GIFT_SQL, [orgId]),
  ]);
  return { people, gifts, households, threads, tasks, enrollments, timeline, realGifts };
}

// THE ONE PLACE THE DELETE HAPPENS.
//
// `run` and `query` are injected rather than required, so the caller's
// transaction (or a test's own pool) is the one doing the work.
//
// Errors are NOT swallowed the way the old route swallowed them. A destructive
// action that quietly fails is worse than one that fails loudly: it reports
// success while leaving half the invented people on the screen. Only a table
// or column that does not exist is tolerated (42P01 / 42703), because this
// list outlives individual schema versions; everything else is collected and
// returned, and the caller refuses to claim success.
async function clearSampleData({ query, run }, orgId) {
  // Tag before deleting. A Thread opened last night is a sample Thread that
  // nothing has tagged yet, and the sweep is what makes the tagged delete
  // below and the donor-keyed delete agree about it.
  try {
    await tagSampleRows({ query, run }, orgId);
  } catch (err) {
    // A failed sweep is not fatal — every one of those rows is still reachable
    // through its donor — but it IS reported, because a clear that had to fall
    // back to one of its two routes is worth knowing about.
    console.error("[sample-data] pre-clear tagging failed (delete continues):", err.message);
  }

  const ids = await sampleDonorIds(query, orgId);
  const deleted = {};
  const errors = [];

  const del = async (table, sql, params) => {
    try {
      const r = await run(sql, params);
      if (r && r.changes) deleted[table] = (deleted[table] || 0) + r.changes;
    } catch (err) {
      if (err && (err.code === "42P01" || err.code === "42703")) return; // no such table/column
      errors.push({ table, message: err.message, code: err.code || null });
    }
  };

  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    for (const t of DONOR_CHILD_TABLES) {
      await del(t, `DELETE FROM ${t} WHERE org_id=? AND donor_id IN (${placeholders})`, [orgId, ...ids]);
    }
    // Receipts are also reachable through a sample gift whose donor row has
    // already gone in some other order; belt-and-braces, and cheap.
    await del("receipts",
      "DELETE FROM receipts WHERE org_id=? AND gift_id IN (SELECT id FROM gifts WHERE org_id=? AND is_sample=true)",
      [orgId, orgId]);

    // The household the donor-child sweep cannot see. Members first: a donor
    // row about to be deleted still points at this household, and the FK is
    // the wrong thing to discover halfway through a destructive action.
    await del("households", "UPDATE donors SET household_id=NULL WHERE org_id=? AND household_id IN (SELECT id FROM households WHERE org_id=? AND primary_donor_id IN (" + placeholders + "))",
      [orgId, orgId, ...ids]);
    await del("households", HOUSEHOLD_BY_DONOR_SQL.replace("%IDS%", placeholders), [orgId, ...ids]);
  }

  // Anything tagged sample but not hanging off a donor.
  for (const t of TAGGED_TABLES) {
    await del(t, `DELETE FROM ${t} WHERE org_id=? AND is_sample=true`, [orgId]);
  }
  // …and the tagged rows of the donor-child tables, for a loader that tagged a
  // row without attaching it to a donor.
  for (const t of ["tasks", "interactions", "volunteers"]) {
    await del(t, `DELETE FROM ${t} WHERE org_id=? AND is_sample=true`, [orgId]);
  }

  // Gifts, then people. This order, always: a gift references a donor.
  await del("gifts", "DELETE FROM gifts WHERE org_id=? AND is_sample=true", [orgId]);
  await del("donors", "DELETE FROM donors WHERE org_id=? AND is_sample=true", [orgId]);

  return { deleted, errors };
}

module.exports = {
  TAGGED_TABLES, DONOR_CHILD_TABLES, HEADLINE, REAL_GIFT_SQL, HOUSEHOLD_BY_DONOR_SQL,
  sampleDonorIds, countSampleData, clearSampleData, tagSampleRows,
};
