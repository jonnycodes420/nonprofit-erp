// routes/dataHealth.js · CLEAN-1. Clean data without the dread.
//
// After an import, or any Monday morning, a director opens Donors, Data
// health: one line per kind of mess, a count that opens its rows, a reason for
// each row, and one action per line. Steward suggests; staff apply. Nothing
// here sends anything to anybody.
//
//   GET  /data-health                      the lines and their counts
//   GET  /data-health/duplicates           likely pairs, reasons in words, high/medium/low
//   GET  /data-health/pair?a=&b=           both records side by side, the default choices,
//                                          and what would move
//   POST /data-health/merge                one pair, field by field
//   POST /data-health/pairs/dismiss        "Not a duplicate", remembered
//   GET  /data-health/bulk-preview         every high pair a bulk merge would take
//   POST /data-health/bulk-merge           those pairs, after the preview, one confirm
//   GET  /data-health/merges               merges that can still be undone (30 days)
//   POST /data-health/merges/:id/undo      both records and every moved row, exactly
//   GET  /data-health/addresses            proposed tidies, and the ones that can't be read
//   POST /data-health/addresses/apply      staff approve, in bulk or one by one
//   GET  /data-health/emails               bounced, invalid, typo domains, role addresses
//   POST /data-health/emails/fix           a person types or accepts the fix
//   POST /data-health/emails/clear-bounce  only after staff confirm
//   GET  /data-health/unreachable          no email, phone or mailable address
//   GET  /data-health/ncoa/file            the change-of-address file for a provider
//   POST /data-health/ncoa/results         the provider's returned file
//   GET  /data-health/ncoa/moves           the moves waiting for a person
//   POST /data-health/ncoa/apply|dismiss   staff approve, in bulk or one by one
//   GET  /data-health/notice               the one quiet Home item after a messy import
//
// The merge is the dangerous part, so it has one rule: every column in db.js
// that points at a person is in MERGE_REFS below or in NOT_MOVED with the
// reason. tests/clean1-merge.test.js reads db.js and fails on a column in
// neither, so a table added next month cannot be silently left behind.
"use strict";
const express = require("express");
const DH = require("../dataHealth");

const routers = { r0: express.Router() };

// Every column that points at a person, and what a merge does with it.
//   move       the merged person's rows now point at the kept person
//   refuse     the same, but if the kept person already has the one row this
//              table allows (an active membership, a year-end statement for
//              the same year, an open proposal for the same fund), the merge
//              stops and says which, because one of the two is a real record
//              a person has to end first
// A move that would break a unique key on any other table sets the merged
// person's row aside (the kept person's twin wins). Set-aside rows are kept
// whole on the merge record and come back on undo.
const MERGE_REFS = [
  ["agent_drafts", "donor_id"], ["auction_bidders", "donor_id"], ["auction_items", "donor_id"],
  ["auction_refund_flags", "donor_id"], ["bookkeeping_customers", "donor_id"], ["campaign_recipients", "donor_id"],
  ["cultivation_plans", "donor_id", "refuse"], ["custom_field_values", "donor_id"], ["donor_account_links", "donor_id"],
  ["donor_address_history", "donor_id"], ["donor_designations", "donor_id"], ["donor_materials", "donor_id"],
  ["donor_relationships", "donor_id_a"], ["donor_relationships", "donor_id_b"], ["donor_scores", "donor_id"],
  ["email_marketing_activity", "donor_id"], ["event_attendees", "donor_id"], ["fin_transactions", "donor_id"],
  ["gift_duplicate_questions", "donor_id"], ["gift_soft_credits", "donor_id"], ["gifts", "donor_id"],
  ["gifts", "tribute_donor_id"], ["gifts", "match_employer_id"], ["giving_recurring", "donor_id", "refuse"],
  ["grants", "funder_donor_id"], ["grant_sends", "funder_donor_id"], ["group_members", "donor_id"], ["group_sweep_seen", "donor_id"],
  ["households", "primary_donor_id"], ["import_merges", "donor_id"], ["interaction_attachments", "donor_id"],
  ["interactions", "donor_id"], ["memberships", "donor_id", "refuse"], ["milestone_drafts", "donor_id"],
  ["moves", "donor_id"], ["ncoa_moves", "donor_id"], ["note_reminders", "donor_id"],
  ["opportunities", "donor_id", "refuse"], ["payment_recovery_events", "donor_id"], ["peer_fundraisers", "person_id"],
  ["planned_gifts", "donor_id"], ["pledges", "donor_id"], ["portal_audit_log", "donor_id"], ["pos_sales", "person_id"],
  ["receipts", "donor_id", "refuse"], ["reconnect_sends", "donor_id"], ["recurring_change_log", "donor_id"],
  ["public_filings", "donor_id"], ["recurring_proposals", "donor_id"], ["recurring_subscriptions", "donor_id"],
  ["screening_results", "donor_id"], ["sequence_enrollments", "donor_id"],
  ["sequence_sends", "donor_id"], ["supporter_links", "person_id"], ["supporter_sessions", "person_id"],
  ["survey_responses", "donor_id"], ["tasks", "donor_id"], ["thank_you_drafts", "donor_id"], ["threads", "donor_id"],
  ["tribute_notices", "donor_id"], ["video_thanks", "donor_id"], ["volunteer_applications", "person_id"],
  ["volunteer_credentials", "person_id"], ["volunteer_group_members", "person_id"],
  ["volunteer_groups", "contact_person_id"], ["volunteer_magic_links", "person_id"], ["volunteer_notes", "person_id"],
  ["volunteer_qualifications", "person_id"], ["volunteer_shifts", "person_id"], ["volunteer_signups", "person_id"],
  ["volunteers", "donor_id"], ["workflow_runs", "donor_id"],
  // WIRE-1: a meeting's people, the Agent's undo ledger and custom field
  // history. Their shapes are in REF_SHAPE below.
  ["calendar_events", "person_ids"], ["agent_writes", "entity_id"], ["custom_field_events", "entity_id"],
];
// Pointers that are not a plain "column = person id".
//   array   the column holds several people (a meeting with two donors): the
//           merged id is replaced by the kept id, or dropped when the kept id
//           is already there, and undo puts the array back exactly
//   where   the column points at a person only on rows of one kind
const REF_SHAPE = {
  "calendar_events.person_ids": { array: true },
  "agent_writes.entity_id": { where: "entity_table='donors'" },
  "custom_field_events.entity_id": { where: "entity='donor'" },
};
// The WHERE clause that finds a person's rows in one pointer column. Takes the
// person id as its one placeholder.
function refMatch(t, c) {
  const s = REF_SHAPE[`${t}.${c}`] || {};
  if (s.array) return { sql: `?=ANY(${c})`, array: true };
  return { sql: `${c}=?${s.where ? ` AND ${s.where}` : ""}`, array: false };
}
// Columns whose names look like a person pointer but are not one.
const NOT_MOVED = {
  "donors.external_donor_id": "the person's id in the system they came from, a value not a pointer; it is a field the merge screen offers",
  "donors.external_donor_ids": "the person's ids in other systems, values not pointers; the merge unites both lists onto the kept record",
  "fin_audit_log.entity_id": "an append-only log of what happened to a record at the time; history is never rewritten",
  "workflow_runs.entity_id": "the run's dedupe key part; the person on a run is workflow_runs.donor_id, which moves",
  "asset_pointer_history.entity_id": "a log of photo and file pointer changes as they happened; history is never rewritten",
  "api_call_log.entity_id": "a log of public API calls as they were made; history is never rewritten",
};
// Tables with no `id` column: a row is found by these columns plus the pointer.
const KEY_COLS = { donor_scores: [], public_filings: [], group_members: ["group_id"], group_sweep_seen: ["group_id"] };
const REFUSE_WORDS = {
  memberships: "Both people have a current membership. End one of them on the person's record, then merge.",
  receipts: "Both people have a year-end statement for the same year. Void one, then merge.",
  opportunities: "Both people have an open proposal for the same fund. Close one, then merge.",
  cultivation_plans: "Both people are on an active cultivation plan. End one, then merge.",
  giving_recurring: "Both people have the same recurring gift from the same giving source. Look at the two in Recurring, then merge.",
};
const UNDO_DAYS = 30;

// Donors columns that follow a fixed rule rather than a choice.
const FILL_IF_EMPTY = ["stripe_customer_id", "stripe_subscription_id", "stripe_subscription_status", "wealth_score",
  "capacity_tier", "score_confidence", "score_last_updated", "score_rationale", "deceased_date", "photo_asset_id",
  "funder_ein", "funder_type", "express_pm_id", "express_pm_brand", "express_pm_last4", "express_pm_saved_at",
  "wealth_screen_source", "wealth_screen_rating", "wealth_screen_capacity", "wealth_screen_date", "suggested_stage",
  "external_household_id"];
const OR_FLAGS = ["deceased", "do_not_contact", "do_not_solicit", "do_not_mail", "do_not_email", "planned_giving",
  "board_member", "in_pipeline", "imported_sustainer"];

const cents = v => Math.round(Number(v || 0) * 100);
const dollars = c => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isEmpty = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const parseJson = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v); } catch { return d; } };

function mount(ctx) {
const { backgroundTicksDisabled, checkWriteAccess, markDonorsForGeocoding, orgToday, orgTz, query, recalcDonorSummary,
  recordTick, requireAuth, run, runTx, queryTx, uuid, withAdvisoryLock, withTransaction, wrap, openAdminTask } = ctx;
const app = routers.r0;

async function who(req) {
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  return { id: req.user.userId, name: (u && u.name) || req.user.email || "" };
}

// ── What the page reads ─────────────────────────────────────────────────────
const PERSON_COLS = `id, org_id, name, kind, email, email2, phone, mobile, address, address2, city, state, zip, country,
  employer, household_id, deceased, do_not_contact, do_not_mail, email_unreachable, email_unreachable_reason,
  address_unmailable, address_unmailable_reason, total_giving, gift_count, last_gift_date, created_at, updated_at,
  created_import_id, deleted_at, erased_at`;
const livePeople = orgId => query(`SELECT ${PERSON_COLS} FROM donors WHERE org_id=? AND deleted_at IS NULL AND erased_at IS NULL`, [orgId]);
async function dismissedKeys(orgId, kind) {
  const rows = await query("SELECT key FROM data_health_dismissals WHERE org_id=? AND kind=?", [orgId, kind]);
  return new Set(rows.map(r => r.key));
}
async function duplicatePairs(orgId, people) {
  return DH.findDuplicatePairs(people || await livePeople(orgId), { orgId, dismissed: await dismissedKeys(orgId, "pair") });
}
async function bounceMap(orgId, people) {
  const emails = [...new Set(people.map(d => String(d.email || "").trim().toLowerCase()).filter(Boolean))];
  const sup = emails.length ? await query(
    `SELECT DISTINCT ON (email) email, reason FROM email_suppressions
      WHERE (org_id IS NULL OR org_id=?) AND reason IN ('bounced','complained') AND email = ANY(?)
      ORDER BY email, created_at DESC`, [orgId, emails]) : [];
  return new Map(sup.map(s => [s.email, s.reason]));
}
async function emailRows(orgId, people) {
  const sup = await bounceMap(orgId, people);
  const dismissed = await dismissedKeys(orgId, "email");
  const out = [];
  for (const d of people) {
    const e = String(d.email || "").trim().toLowerCase();
    if (!e) continue;
    const bounced = d.email_unreachable ? (d.email_unreachable_reason === "complained" ? "complained" : "bounced") : sup.get(e) || null;
    const issues = DH.emailIssues(d, { bounced }).filter(i => !dismissed.has(`${d.id}:${e}:${i.kind}`));
    if (issues.length) out.push({ donorId: d.id, name: d.name, email: d.email, issues, bounced: !!bounced });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
async function addressRows(orgId, people) {
  const dismissed = await dismissedKeys(orgId, "address");
  const tidy = [], unreadable = [];
  for (const d of people) {
    const t = DH.tidyAddress(d);
    const key = `${d.id}:${DH.oneLine(t.current)}`;
    if (dismissed.has(key)) continue;
    if (t.status === "tidy") tidy.push({ donorId: d.id, name: d.name, current: t.current, proposed: t.proposed, currentLine: DH.oneLine(t.current), proposedLine: DH.oneLine(t.proposed) });
    if (t.status === "unreadable") unreadable.push({ donorId: d.id, name: d.name, current: t.current, currentLine: DH.oneLine(t.current), why: t.why });
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return { tidy: tidy.sort(byName), unreadable: unreadable.sort(byName) };
}
function unreachableRows(people) {
  return people.filter(d => !d.deceased
    && isEmpty(d.email) && isEmpty(d.phone) && isEmpty(d.mobile)
    && (isEmpty(d.address) || d.address_unmailable))
    .map(d => ({ donorId: d.id, name: d.name, why: d.address_unmailable ? "no email or phone, and the address is marked not mailable" : "no email, phone or address" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The counts, computed once. The page, the nightly run and the import hook
// all read this, so a count and the rows it opens cannot disagree.
async function healthCounts(orgId) {
  const people = await livePeople(orgId);
  const [pairs, addresses, emails, moves] = await Promise.all([
    duplicatePairs(orgId, people), addressRows(orgId, people), emailRows(orgId, people),
    query("SELECT COUNT(*)::int AS n FROM ncoa_moves WHERE org_id=? AND status='pending'", [orgId]),
  ]);
  const [{ n: ncoaFiles } = { n: 0 }] = await query("SELECT COUNT(*)::int AS n FROM ncoa_batches WHERE org_id=?", [orgId]);
  return {
    people: people.length,
    duplicates: pairs.length,
    duplicatesByConfidence: { high: pairs.filter(p => p.confidence === "high").length, medium: pairs.filter(p => p.confidence === "medium").length, low: pairs.filter(p => p.confidence === "low").length },
    addressesToTidy: addresses.tidy.length,
    addressesUnreadable: addresses.unreadable.length,
    moved: moves[0].n,
    hasNcoaFile: ncoaFiles > 0,
    emails: emails.length,
    unreachable: unreachableRows(people).length,
    _pairs: pairs, _people: people,
  };
}
const publicCounts = c => { const { _pairs, _people, ...rest } = c; return rest; };

// After an import, once a night, or by hand. Stores the counts as they stood
// and how many possible duplicates involve people the import created.
async function runDataHealth(orgId, { trigger, importId = null, actorId = "system:data-health", actorName = "Steward (data health)" }) {
  const c = await healthCounts(orgId);
  let fresh = 0;
  if (importId) {
    const [imp] = await query("SELECT started_at, committed_at FROM imports WHERE id=? AND org_id=?", [importId, orgId]);
    const since = imp && (imp.started_at || imp.committed_at);
    const isNew = d => d.created_import_id === importId || (since && new Date(d.created_at) >= new Date(since));
    const byId = new Map(c._people.map(d => [d.id, d]));
    fresh = c._pairs.filter(p => isNew(byId.get(p.a)) || isNew(byId.get(p.b))).length;
  }
  const id = "dhr_" + uuid().slice(0, 12);
  await run(`INSERT INTO data_health_runs (id, org_id, trigger, import_id, counts, new_duplicates, created_by, created_by_name)
             VALUES (?,?,?,?,?::jsonb,?,?,?)`,
    [id, orgId, trigger, importId, JSON.stringify(publicCounts(c)), fresh, actorId, actorName]);
  // WIRE-1: new duplicates from an import are a job for an admin, not a count
  // nobody opens. One task per run (the open-task check stops a repeat).
  let taskId = null;
  if (importId && fresh > 0 && openAdminTask) {
    taskId = await openAdminTask(orgId, {
      title: `Review ${fresh} possible duplicate${fresh === 1 ? "" : "s"} from the import in Data health`,
      actorId: `system:data-health/import/${importId}`, actorName,
    }).catch(e => { console.error("[data-health] duplicates task:", e.message); return null; });
  }
  return { id, counts: publicCounts(c), newDuplicates: fresh, taskId };
}
// Called by every import path once its run is recorded. Never blocks the
// import and never fails it: a health count is a read.
function afterImport(orgId, importId) {
  // MAIL-1: any import path, present or future, can be the first donor file.
  require("../onboarded").stampOnboardedFromImport(query, orgId, importId)
    .catch(e => console.error("[mail-1] onboarded stamp:", e.message));
  setImmediate(() => runDataHealth(orgId, { trigger: "import", importId }).catch(e => console.error("[data-health] after import:", e.message)));
}
async function runDataHealthNightly() {
  const orgs = await query(`SELECT DISTINCT org_id FROM donors WHERE deleted_at IS NULL`);
  for (const { org_id } of orgs) {
    try { await runDataHealth(org_id, { trigger: "nightly" }); }
    catch (e) { console.error("[data-health] nightly", org_id, e.message); }
  }
  return `checked ${orgs.length} orgs`;
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => recordTick("runDataHealthNightly", runDataHealthNightly).catch(console.error), 15 * 60 * 1000);
  setInterval(() => recordTick("runDataHealthNightly", runDataHealthNightly).catch(console.error), 24 * 60 * 60 * 1000);
}

app.get("/data-health", requireAuth, wrap(async (req, res) => {
  const c = await healthCounts(req.user.orgId);
  const [last] = await query("SELECT trigger, created_at FROM data_health_runs WHERE org_id=? ORDER BY created_at DESC LIMIT 1", [req.user.orgId]);
  const [org] = await query("SELECT id, is_demo_org FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ counts: publicCounts(c), lastRun: last || null, demo: require("../twoFactor").isDemoOrg(org),
    ncoaNote: "Steward does not run the change-of-address check itself yet. The file it prepares works with any USPS-licensed NCOA provider." });
}));
app.post("/data-health/run", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const me = await who(req);
  res.status(201).json(await runDataHealth(req.user.orgId, { trigger: "manual", actorId: me.id, actorName: me.name }));
}));

// ── The one quiet item on Home ──────────────────────────────────────────────
const NOTICE_THRESHOLD = 10;
app.get("/data-health/notice", requireAuth, wrap(async (req, res) => {
  const [r] = await query(
    `SELECT r.id, r.new_duplicates, r.created_at, i.name AS import_name
       FROM data_health_runs r LEFT JOIN imports i ON i.id = r.import_id AND i.org_id = r.org_id
      WHERE r.org_id=? AND r.trigger='import' AND r.dismissed_at IS NULL AND r.created_at > NOW() - INTERVAL '14 days'
      ORDER BY r.created_at DESC LIMIT 1`, [req.user.orgId]);
  if (!r || r.new_duplicates <= NOTICE_THRESHOLD) return res.json({ notice: null });
  res.json({ notice: { id: r.id, count: r.new_duplicates,
    sentence: `Your last import${r.import_name ? `, ${r.import_name},` : ""} left ${r.new_duplicates} possible duplicates.`,
    step: "Review them in Data health" } });
}));
app.post("/data-health/notice/:id/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await run("UPDATE data_health_runs SET dismissed_at=NOW() WHERE id=? AND org_id=? AND dismissed_at IS NULL", [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// ── Duplicates ─────────────────────────────────────────────────────────────
const brief = d => d && ({ id: d.id, name: d.name, email: d.email, phone: d.phone || d.mobile || null,
  place: [d.city, d.state].filter(Boolean).join(", ") || null, householdId: d.household_id || null,
  lifetimeCents: cents(d.total_giving), giftCount: Number(d.gift_count || 0), lastGiftDate: d.last_gift_date || null });
app.get("/data-health/duplicates", requireAuth, wrap(async (req, res) => {
  const people = await livePeople(req.user.orgId);
  const pairs = await duplicatePairs(req.user.orgId, people);
  const byId = new Map(people.map(d => [d.id, d]));
  // AGENT-2: a pair somebody PROPOSED (the Agent, on an instruction) comes
  // first, saying who proposed it and why. It is still a person who merges.
  const proposed = await query(`SELECT a, b, reason, created_by_name FROM merge_proposals WHERE org_id=? ORDER BY created_at DESC`, [req.user.orgId]);
  const key = (x, y) => [x, y].sort().join("|");
  const seen = new Map(pairs.map(p => [key(p.a, p.b), p]));
  const top = proposed.filter(m => byId.has(m.a) && byId.has(m.b)).map(m => ({
    ...(seen.get(key(m.a, m.b)) || { a: m.a, b: m.b, reasons: [] }),
    proposed: { by: m.created_by_name || "Somebody", reason: m.reason || null } }));
  const topKeys = new Set(top.map(p => key(p.a, p.b)));
  const all = [...top, ...pairs.filter(p => !topKeys.has(key(p.a, p.b)))];
  res.json({ pairs: all.map(p => ({ ...p, left: brief(byId.get(p.a)), right: brief(byId.get(p.b)) })) });
}));
// AGENT-2: propose that two people are one. Nothing merges here: the pair
// joins the duplicate queue above, and a person commits it with Merge.
app.post("/data-health/proposals", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { a, b } = req.body || {};
  if (!a || !b || a === b) return res.status(400).json({ error: "Two different people are needed." });
  const own = await query("SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL", [req.user.orgId, [String(a), String(b)]]);
  if (own.length !== 2) return res.status(404).json({ error: "Donor not found" });
  const [x, y] = [String(a), String(b)].sort();
  const me = await who(req);
  const id = "mp_" + uuid().slice(0, 12);
  const ins = await query(`INSERT INTO merge_proposals (id, org_id, a, b, reason, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)
                           ON CONFLICT (org_id, a, b) DO NOTHING RETURNING id`,
    [id, req.user.orgId, x, y, String(req.body.reason || "").slice(0, 300) || null, me.id, me.name]);
  res.status(ins.length ? 201 : 200).json({ id: ins.length ? id : null, already: !ins.length,
    sentence: `${own[0].name} and ${own[1].name} are at the top of the duplicate queue in Data health. Nothing is merged until somebody presses Merge there.` });
}));
app.post("/data-health/pairs/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { a, b } = req.body || {};
  if (!a || !b || a === b) return res.status(400).json({ error: "Two different people are needed." });
  const own = await query("SELECT id FROM donors WHERE org_id=? AND id = ANY(?)", [req.user.orgId, [a, b]]);
  if (own.length !== 2) return res.status(404).json({ error: "Donor not found" });
  const me = await who(req);
  await run(`INSERT INTO data_health_dismissals (id, org_id, kind, key, created_by, created_by_name) VALUES (?,?,?,?,?,?)
             ON CONFLICT (org_id, kind, key) DO NOTHING`,
    ["dhd_" + uuid().slice(0, 12), req.user.orgId, "pair", DH.pairKey(a, b), me.id, me.name]);
  res.status(201).json({ ok: true, key: DH.pairKey(a, b) });
}));

// What a merge would move, per table, so the side-by-side screen can say it.
async function movingCounts(orgId, personId) {
  const out = {};
  for (const [t, c] of MERGE_REFS) {
    const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id=? AND ${refMatch(t, c).sql}`, [orgId, personId]);
    if (n) out[`${t}.${c}`] = n;
  }
  return out;
}
app.get("/data-health/pair", requireAuth, wrap(async (req, res) => {
  const { a, b } = req.query;
  const rows = await query("SELECT * FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL", [req.user.orgId, [String(a), String(b)]]);
  const A = rows.find(d => d.id === a), B = rows.find(d => d.id === b);
  if (!A || !B) return res.status(404).json({ error: "Donor not found" });
  // The default kept record: the one with more gifts, then the older one.
  const keepA = Number(A.gift_count || 0) !== Number(B.gift_count || 0)
    ? Number(A.gift_count || 0) > Number(B.gift_count || 0)
    : new Date(A.created_at) <= new Date(B.created_at);
  const kept = keepA ? A : B, other = keepA ? B : A;
  const households = await query("SELECT id, name FROM households WHERE org_id=? AND id = ANY(?)", [req.user.orgId, [A.household_id, B.household_id].filter(Boolean)]).catch(() => []);
  const judged = DH.judgePair(A, B);
  res.json({
    keptId: kept.id, otherId: other.id,
    records: { [A.id]: A, [B.id]: B },
    fields: DH.MERGE_FIELDS.map(([key, label]) => ({ key, label })),
    choices: DH.defaultChoices(kept, other),
    households: Object.fromEntries(households.map(h => [h.id, h.name])),
    reasons: judged ? judged.reasons : [], confidence: judged ? judged.confidence : null,
    crossHousehold: !!A.household_id && !!B.household_id && A.household_id !== B.household_id,
    moving: { [A.id]: await movingCounts(req.user.orgId, A.id), [B.id]: await movingCounts(req.user.orgId, B.id) },
    lifetimeCents: { [A.id]: cents(A.total_giving), [B.id]: cents(B.total_giving) },
  });
}));

class MergeRefused extends Error { constructor(sentence) { super(sentence); this.sentence = sentence; } }
let donorColsCache = null;
async function donorCols() {
  if (!donorColsCache) {
    const rows = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='donors' AND column_name <> 'id' ORDER BY ordinal_position`);
    donorColsCache = rows.map(r => r.column_name);
  }
  return donorColsCache;
}
async function hasIdCol(client, table) {
  const r = await queryTx(client, `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND column_name='id'`, [table]);
  return r.length > 0;
}
const giftCentsTx = async (client, orgId, id) => {
  const [r] = await queryTx(client, "SELECT COALESCE(SUM(round(amount*100)),0)::bigint AS c FROM gifts WHERE org_id=? AND donor_id=?", [orgId, id]);
  return Number(r.c);
};

// THE MERGE. One transaction: snapshot both people, set aside the rows that
// would point a person at themselves, move every row in MERGE_REFS (setting
// aside a twin the kept person already has), write the chosen values onto the
// kept record, soft-delete the merged one, check the money foots to the cent,
// and record all of it so undo can put it back.
async function mergePeople(orgId, keptId, mergedId, { choices = null, me, confidence = null, reasons = null, bulk = false }) {
  if (!keptId || !mergedId || keptId === mergedId) throw new MergeRefused("Choose two different people.");
  return withAdvisoryLock(`merge:${orgId}`, () => withTransaction(async (client) => {
    const snap = await queryTx(client, `SELECT id, to_jsonb(d.*) AS j FROM donors d WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL FOR UPDATE`, [orgId, [keptId, mergedId]]);
    const keptJ = snap.find(r => r.id === keptId)?.j, mergedJ = snap.find(r => r.id === mergedId)?.j;
    if (!keptJ || !mergedJ) { const e = new MergeRefused("One of these people is no longer on file."); e.status = 404; throw e; }
    const keptCentsBefore = await giftCentsTx(client, orgId, keptId);
    const mergedCentsBefore = await giftCentsTx(client, orgId, mergedId);
    const moved = [], setAside = [];
    const pick = choices && typeof choices === "object" ? { ...DH.defaultChoices(keptJ, mergedJ), ...choices } : DH.defaultChoices(keptJ, mergedJ);
    for (const k of Object.keys(pick)) if (pick[k] !== "kept" && pick[k] !== "other") pick[k] = "kept";

    // 1. Rows that would make a person related to, or soft-credited on,
    //    themselves. Set aside whole, before anything moves.
    const selfRel = await queryTx(client,
      `SELECT to_jsonb(r.*) AS j FROM donor_relationships r WHERE org_id=? AND ((donor_id_a=? AND donor_id_b=?) OR (donor_id_a=? AND donor_id_b=?))`,
      [orgId, keptId, mergedId, mergedId, keptId]);
    const selfCredit = await queryTx(client,
      `SELECT to_jsonb(sc.*) AS j FROM gift_soft_credits sc JOIN gifts g ON g.id = sc.gift_id
        WHERE sc.org_id=? AND ((sc.donor_id=? AND g.donor_id=?) OR (sc.donor_id=? AND g.donor_id=?))`,
      [orgId, mergedId, keptId, keptId, mergedId]);
    for (const r of selfRel) { await runTx(client, "DELETE FROM donor_relationships WHERE id=? AND org_id=?", [r.j.id, orgId]); setAside.push({ table: "donor_relationships", why: "would relate the person to themselves", row: r.j }); }
    for (const r of selfCredit) { await runTx(client, "DELETE FROM gift_soft_credits WHERE id=? AND org_id=?", [r.j.id, orgId]); setAside.push({ table: "gift_soft_credits", why: "would soft-credit the person on their own gift", row: r.j }); }

    // 2. Every pointer, table by table. A bulk UPDATE first; if a unique key
    //    objects, row by row, and the merged person's twin is set aside.
    for (const [t, c, mode] of MERGE_REFS) {
      const withId = await hasIdCol(client, t);
      const keyCols = KEY_COLS[t] || [];
      const ref = refMatch(t, c);
      const rows = await queryTx(client, `SELECT to_jsonb(x.*) AS j FROM ${t} x WHERE org_id=? AND ${ref.sql}`, [orgId, mergedId]);
      if (!rows.length) continue;
      if (ref.array) {
        // Each row's array before the merge is kept on the merge record, so
        // undo restores it exactly (order and all), not by a reverse guess.
        await runTx(client,
          `UPDATE ${t} SET ${c} = CASE WHEN ?=ANY(${c}) THEN array_remove(${c}, ?) ELSE array_replace(${c}, ?, ?) END
            WHERE org_id=? AND ?=ANY(${c})`, [keptId, mergedId, mergedId, keptId, orgId, mergedId]);
        moved.push({ table: t, column: c, ids: rows.map(r => r.j.id), arrays: rows.map(r => ({ id: r.j.id, before: r.j[c] })) });
        continue;
      }
      const match = j => withId
        ? { sql: "id=?", vals: [j.id] }
        : { sql: [`org_id=?`, ...keyCols.map(k => `${k}=?`)].join(" AND "), vals: [orgId, ...keyCols.map(k => j[k])] };
      await client.query("SAVEPOINT dh_bulk");
      try {
        await runTx(client, `UPDATE ${t} SET ${c}=? WHERE org_id=? AND ${ref.sql}`, [keptId, orgId, mergedId]);
        await client.query("RELEASE SAVEPOINT dh_bulk");
        moved.push({ table: t, column: c, ids: withId ? rows.map(r => r.j.id) : null, keys: withId ? null : rows.map(r => Object.fromEntries(keyCols.map(k => [k, r.j[k]]))) });
        continue;
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT dh_bulk");
        if (e.code !== "23505") throw e;
      }
      const ids = [], keys = [];
      for (const r of rows) {
        const m = match(r.j);
        await client.query("SAVEPOINT dh_row");
        try {
          await runTx(client, `UPDATE ${t} SET ${c}=? WHERE ${m.sql} AND ${c}=?`, [keptId, ...m.vals, mergedId]);
          await client.query("RELEASE SAVEPOINT dh_row");
          if (withId) ids.push(r.j.id); else keys.push(Object.fromEntries(keyCols.map(k => [k, r.j[k]])));
        } catch (e) {
          await client.query("ROLLBACK TO SAVEPOINT dh_row");
          if (e.code !== "23505") throw e;
          if (mode === "refuse") throw new MergeRefused(REFUSE_WORDS[t] || `Both people have a record in ${t} that only one person may hold.`);
          await runTx(client, `DELETE FROM ${t} WHERE ${m.sql} AND ${c}=?`, [...m.vals, mergedId]);
          setAside.push({ table: t, column: c, why: "the kept person already has this one", row: r.j });
        }
      }
      moved.push({ table: t, column: c, ids: withId ? ids : null, keys: withId ? null : keys });
    }

    // 3. The kept record's values. Chosen fields, both emails and phones kept,
    //    system ids filled where empty, every restriction OR'd, tags, person
    //    types, old-system ids and custom fields united.
    const other = mergedJ, kept = keptJ;
    const { vals, leftovers } = DH.resolveMergedValues(kept, other, pick);
    for (const f of FILL_IF_EMPTY) if (isEmpty(kept[f]) && !isEmpty(other[f])) vals[f] = other[f];
    for (const f of OR_FLAGS) if (other[f] && !kept[f]) vals[f] = true;
    if (other.email_unreachable && vals.email && String(vals.email).toLowerCase() === String(other.email || "").toLowerCase()) {
      vals.email_unreachable = true; vals.email_unreachable_at = other.email_unreachable_at; vals.email_unreachable_reason = other.email_unreachable_reason;
    }
    const addrFrom = pick.address === "other" ? other : kept;
    vals.address_unmailable = !!addrFrom.address_unmailable;
    vals.address_unmailable_reason = addrFrom.address_unmailable_reason || null;
    vals.address_unmailable_at = addrFrom.address_unmailable_at || null;
    if (pick.assigned_to === "other") vals.assigned_to_name = other.assigned_to_name || null;
    const firsts = [kept.first_gift_date, other.first_gift_date].filter(Boolean).sort();
    if (firsts.length) vals.first_gift_date = firsts[0];
    const arr = v => { const p = parseJson(v, []); return Array.isArray(p) ? p : []; };
    vals.tags = JSON.stringify([...new Set([...arr(kept.tags), ...arr(other.tags)])]);
    const types = [...new Set([...arr(kept.person_types), ...arr(other.person_types)])];
    vals.person_types = JSON.stringify(types.length > 1 ? types.filter(t => t !== "other") : types);
    const obj = v => { const p = parseJson(v, null); return p && typeof p === "object" ? p : null; };
    const kx = obj(kept.external_donor_ids), ox = obj(other.external_donor_ids);
    if (kx || ox) vals.external_donor_ids = JSON.stringify(Array.isArray(kx) || Array.isArray(ox) ? [...new Set([...(kx || []), ...(ox || [])])] : { ...(ox || {}), ...(kx || {}) });
    const kcf = obj(kept.custom_fields) || {}, ocf = obj(other.custom_fields) || {};
    vals.custom_fields = JSON.stringify({ ...ocf, ...kcf });
    // The merged record lets go of anything unique first (an EIN), then is
    // soft-deleted; the kept record takes the values.
    await runTx(client, "UPDATE donors SET funder_ein=NULL, deleted_at=NOW() WHERE id=? AND org_id=?", [mergedId, orgId]);
    const jsonCols = new Set(["tags", "person_types", "external_donor_ids", "custom_fields"]);
    const sets = Object.keys(vals).map(k => jsonCols.has(k) && k !== "tags" ? `${k}=?::jsonb` : `${k}=?`);
    await runTx(client, `UPDATE donors SET ${sets.join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...Object.values(vals), keptId, orgId]);

    // 4. The money foots, to the cent, or nothing happened.
    const keptCentsAfter = await giftCentsTx(client, orgId, keptId);
    if (keptCentsAfter !== keptCentsBefore + mergedCentsBefore) {
      throw new Error(`merge did not foot: ${keptCentsBefore} + ${mergedCentsBefore} != ${keptCentsAfter}`);
    }
    const [agg] = await queryTx(client, `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS cnt, MAX(date) AS last_date FROM gifts WHERE org_id=? AND donor_id=?`, [orgId, keptId]);
    const [last] = agg.last_date ? await queryTx(client, `SELECT amount FROM gifts WHERE org_id=? AND donor_id=? AND date=? ORDER BY created_at DESC LIMIT 1`, [orgId, keptId, agg.last_date]) : [null];
    await runTx(client, `UPDATE donors SET total_giving=?, gift_count=?, last_gift_date=?, last_gift_amount=? WHERE id=? AND org_id=?`,
      [agg.total, agg.cnt, agg.last_date || null, last ? last.amount : 0, keptId, orgId]);

    // 5. One line on the kept person's timeline, and the record undo reads.
    const movedCount = moved.reduce((n, m) => n + (m.ids ? m.ids.length : m.keys.length), 0);
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const noteId = "int_" + uuid().slice(0, 8);
    const leftWords = leftovers.length ? ` Also on file for them: ${leftovers.join(", ")}.` : "";
    await runTx(client, "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      [noteId, orgId, keptId, "note",
       `Merged "${other.name}"${other.email ? ` <${other.email}>` : ""} into this record: ${movedCount} linked row${movedCount === 1 ? "" : "s"} moved${setAside.length ? `, ${setAside.length} set aside because this record already had them` : ""}. Lifetime giving ${dollars(keptCentsAfter)}.${leftWords} The merge can be undone for ${UNDO_DAYS} days from Data health.`,
       today, me.id, me.name]);
    const mergeId = "dm_" + uuid().slice(0, 12);
    await runTx(client,
      `INSERT INTO donor_merges (id, org_id, kept_id, merged_id, kept_name, merged_name, kept_before, merged_before, moved, set_aside,
                                 choices, note_id, confidence, reasons, bulk, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?,?,?::jsonb,?,?,?)`,
      [mergeId, orgId, keptId, mergedId, kept.name, other.name, JSON.stringify(keptJ), JSON.stringify(mergedJ),
       JSON.stringify(moved), JSON.stringify(setAside), JSON.stringify(pick), noteId, confidence, JSON.stringify(reasons || []), bulk, me.id, me.name]);
    return { mergeId, keptId, mergedId, moved: moved.map(m => ({ table: m.table, column: m.column, rows: m.ids ? m.ids.length : m.keys.length })).filter(m => m.rows),
      setAside: setAside.map(s => ({ table: s.table, why: s.why })),
      lifetime: { keptBeforeCents: keptCentsBefore, mergedBeforeCents: mergedCentsBefore, keptAfterCents: keptCentsAfter } };
  }));
}

async function afterMerge(orgId, keptId) {
  try { await markDonorsForGeocoding(orgId, { donorIds: [keptId] }); } catch (e) { console.error("[geocode] mark after merge failed:", e.message); }
}
function sendRefusal(res, e) {
  if (e instanceof MergeRefused) return res.status(e.status || 409).json({ error: "merge_refused", sentence: e.sentence });
  throw e;
}

app.post("/data-health/merge", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { keptId, mergedId, choices } = req.body || {};
  const me = await who(req);
  try {
    const [a, b] = await Promise.all([keptId, mergedId].map(id => query("SELECT * FROM donors WHERE id=? AND org_id=?", [id, req.user.orgId]).then(r => r[0])));
    const judged = a && b ? DH.judgePair(a, b) : null;
    const out = await mergePeople(req.user.orgId, keptId, mergedId, { choices, me, confidence: judged?.confidence || null, reasons: judged?.reasons || null });
    await afterMerge(req.user.orgId, keptId);
    req.audit = { ...(req.audit || {}), record: { donor_id: keptId, merged_id: mergedId, merge_id: out.mergeId } };
    res.status(201).json(out);
  } catch (e) { sendRefusal(res, e); }
}));

// Bulk: every HIGH pair, never two people from different households (those
// are merged one at a time, by hand), never one person in two pairs at once.
async function bulkCandidates(orgId) {
  const people = await livePeople(orgId);
  const byId = new Map(people.map(d => [d.id, d]));
  const pairs = (await duplicatePairs(orgId, people)).filter(p => p.confidence === "high" && !p.crossHousehold);
  const used = new Set(), out = [];
  for (const p of pairs) {
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a); used.add(p.b);
    const A = byId.get(p.a), B = byId.get(p.b);
    const keepA = Number(A.gift_count || 0) !== Number(B.gift_count || 0) ? Number(A.gift_count || 0) > Number(B.gift_count || 0) : new Date(A.created_at) <= new Date(B.created_at);
    out.push({ ...p, keptId: keepA ? A.id : B.id, mergedId: keepA ? B.id : A.id, kept: brief(keepA ? A : B), merged: brief(keepA ? B : A),
      lifetimeAfterCents: cents(A.total_giving) + cents(B.total_giving) });
  }
  return out;
}
app.get("/data-health/bulk-preview", requireAuth, wrap(async (req, res) => {
  const pairs = await bulkCandidates(req.user.orgId);
  res.json({ pairs, sentence: `${pairs.length} high-confidence pair${pairs.length === 1 ? "" : "s"} can be merged together. Pairs from two different households are left for you to merge one at a time.` });
}));
app.post("/data-health/bulk-merge", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String) : null;
  if (!keys || !keys.length) return res.status(400).json({ error: "Preview first, then confirm the pairs it listed." });
  const me = await who(req);
  // Re-decided now, not trusted from the preview: a pair that is no longer
  // high, or now spans two households, is skipped and named.
  const now = new Map((await bulkCandidates(req.user.orgId)).map(p => [p.key, p]));
  const merged = [], skipped = [];
  for (const k of keys) {
    const p = now.get(k);
    if (!p) { skipped.push({ key: k, why: "no longer a high-confidence pair" }); continue; }
    try {
      const out = await mergePeople(req.user.orgId, p.keptId, p.mergedId, { me, confidence: p.confidence, reasons: p.reasons, bulk: true });
      await afterMerge(req.user.orgId, p.keptId);
      merged.push({ key: k, mergeId: out.mergeId, keptId: p.keptId, mergedId: p.mergedId });
    } catch (e) {
      if (!(e instanceof MergeRefused)) throw e;
      skipped.push({ key: k, why: e.sentence });
    }
  }
  res.status(201).json({ merged, skipped });
}));

// ── Undo ───────────────────────────────────────────────────────────────────
app.get("/data-health/merges", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, kept_id, merged_id, kept_name, merged_name, confidence, reasons, bulk, created_by_name, created_at, undone_at, undone_by_name
       FROM donor_merges WHERE org_id=? AND created_at > NOW() - INTERVAL '${UNDO_DAYS} days'
      ORDER BY created_at DESC LIMIT 100`, [req.user.orgId]);
  res.json({ merges: rows, undoDays: UNDO_DAYS });
}));
app.post("/data-health/merges/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const me = await who(req);
  try {
    const out = await withAdvisoryLock(`merge:${orgId}`, () => withTransaction(async (client) => {
      const [m] = await queryTx(client, "SELECT * FROM donor_merges WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, orgId]);
      if (!m) { const e = new MergeRefused("That merge isn't on file."); e.status = 404; throw e; }
      if (m.undone_at) throw new MergeRefused("That merge was already undone.");
      if (Date.now() - new Date(m.created_at).getTime() > UNDO_DAYS * 86400000) throw new MergeRefused(`A merge can be undone for ${UNDO_DAYS} days. This one is older.`);
      const [kept] = await queryTx(client, "SELECT deleted_at FROM donors WHERE id=? AND org_id=? FOR UPDATE", [m.kept_id, orgId]);
      const [gone] = await queryTx(client, "SELECT deleted_at FROM donors WHERE id=? AND org_id=? FOR UPDATE", [m.merged_id, orgId]);
      if (!kept || kept.deleted_at) throw new MergeRefused(`${m.kept_name} has since been merged or deleted. Undo that first.`);
      if (!gone || !gone.deleted_at) throw new MergeRefused(`${m.merged_name} is already back on file.`);
      // Both people exactly as they were.
      const cols = await donorCols();
      const restore = (snap, id) => runTx(client,
        `UPDATE donors SET (${cols.join(", ")}) = (SELECT ${cols.map(c => "r." + c).join(", ")} FROM jsonb_populate_record(NULL::donors, ?::jsonb) r) WHERE id=? AND org_id=?`,
        [JSON.stringify(snap), id, orgId]);
      // The kept record first: it may be holding a unique value (an EIN) the
      // merged record has to take back.
      await restore(m.kept_before, m.kept_id);
      await restore(m.merged_before, m.merged_id);
      // Every moved row points back at the person it came from.
      for (const mv of m.moved || []) {
        if (mv.arrays && mv.arrays.length) {
          // An array pointer goes back to the exact array it held, if the row
          // still names the kept person (it was not edited away since).
          for (const a of mv.arrays) {
            await runTx(client, `UPDATE ${mv.table} SET ${mv.column}=?::text[] WHERE org_id=? AND id=? AND ?=ANY(${mv.column})`,
              [a.before, orgId, a.id, m.kept_id]);
          }
        } else if (mv.ids && mv.ids.length) {
          await runTx(client, `UPDATE ${mv.table} SET ${mv.column}=? WHERE org_id=? AND ${mv.column}=? AND id = ANY(?)`, [m.merged_id, orgId, m.kept_id, mv.ids]);
        } else if (mv.keys && mv.keys.length) {
          for (const k of mv.keys) {
            const cols2 = Object.keys(k);
            await runTx(client, `UPDATE ${mv.table} SET ${mv.column}=? WHERE org_id=? AND ${mv.column}=?${cols2.map(c => ` AND ${c}=?`).join("")}`,
              [m.merged_id, orgId, m.kept_id, ...cols2.map(c => k[c])]);
          }
        }
      }
      // Every row set aside comes back whole.
      for (const s of m.set_aside || []) {
        await runTx(client, `INSERT INTO ${s.table} SELECT * FROM jsonb_populate_record(NULL::${s.table}, ?::jsonb)`, [JSON.stringify(s.row)]);
      }
      if (m.note_id) await runTx(client, "DELETE FROM interactions WHERE id=? AND org_id=?", [m.note_id, orgId]);
      // Gifts given to the kept person since the merge stay with them; their
      // summary is recomputed only if the restored totals no longer foot.
      for (const id of [m.kept_id, m.merged_id]) {
        const snap = id === m.kept_id ? m.kept_before : m.merged_before;
        if (await giftCentsTx(client, orgId, id) !== cents(snap.total_giving)) {
          const [agg] = await queryTx(client, `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS cnt, MAX(date) AS last_date FROM gifts WHERE org_id=? AND donor_id=?`, [orgId, id]);
          await runTx(client, "UPDATE donors SET total_giving=?, gift_count=?, last_gift_date=? WHERE id=? AND org_id=?", [agg.total, agg.cnt, agg.last_date || null, id, orgId]);
        }
      }
      await runTx(client, "UPDATE donor_merges SET undone_at=NOW(), undone_by=?, undone_by_name=? WHERE id=? AND org_id=?", [me.id, me.name, m.id, orgId]);
      return { undone: true, keptId: m.kept_id, mergedId: m.merged_id };
    }));
    // No geocode re-mark: both records came back with the coordinates and
    // geocode state they had, which belong to the addresses they came back with.
    req.audit = { ...(req.audit || {}), record: { donor_id: out.keptId, merged_id: out.mergedId, merge_id: req.params.id } };
    res.json(out);
  } catch (e) { sendRefusal(res, e); }
}));

// ── Addresses ──────────────────────────────────────────────────────────────
app.get("/data-health/addresses", requireAuth, wrap(async (req, res) => {
  res.json(await addressRows(req.user.orgId, await livePeople(req.user.orgId)));
}));
app.post("/data-health/addresses/apply", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.donorIds) ? [...new Set(req.body.donorIds.map(String))].slice(0, 5000) : [];
  if (!ids.length) return res.status(400).json({ error: "Choose at least one address." });
  const me = await who(req);
  const orgId = req.user.orgId;
  // Re-decided from what is on file now, never from the screen.
  const rows = await query(`SELECT ${PERSON_COLS} FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL`, [orgId, ids]);
  const applied = [], skipped = [];
  await withTransaction(async (client) => {
    for (const d of rows) {
      const t = DH.tidyAddress(d);
      if (t.status !== "tidy") { skipped.push({ donorId: d.id, why: t.status === "unreadable" ? t.why : "already tidy" }); continue; }
      await runTx(client, `INSERT INTO donor_address_history (id, org_id, donor_id, source, before, after, created_by, created_by_name) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?)`,
        ["dah_" + uuid().slice(0, 12), orgId, d.id, "tidy", JSON.stringify(t.current), JSON.stringify(t.proposed), me.id, me.name]);
      await runTx(client, "UPDATE donors SET address=?, address2=?, city=?, state=?, zip=?, updated_at=NOW() WHERE id=? AND org_id=?",
        [t.proposed.address, t.proposed.address2 || null, t.proposed.city, t.proposed.state, t.proposed.zip, d.id, orgId]);
      applied.push(d.id);
    }
  });
  for (const id of ids) if (!rows.find(r => r.id === id)) skipped.push({ donorId: id, why: "not on file" });
  res.status(201).json({ applied: applied.length, skipped });
}));
app.post("/data-health/addresses/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [d] = await query(`SELECT ${PERSON_COLS} FROM donors WHERE org_id=? AND id=?`, [req.user.orgId, String(req.body?.donorId || "")]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const me = await who(req);
  await run(`INSERT INTO data_health_dismissals (id, org_id, kind, key, created_by, created_by_name) VALUES (?,?,?,?,?,?) ON CONFLICT (org_id, kind, key) DO NOTHING`,
    ["dhd_" + uuid().slice(0, 12), req.user.orgId, "address", `${d.id}:${DH.oneLine(DH.tidyAddress(d).current)}`, me.id, me.name]);
  res.status(201).json({ ok: true });
}));
app.get("/donors/:id/address-history", requireAuth, wrap(async (req, res) => {
  const rows = await query(`SELECT id, source, before, after, created_by_name, created_at FROM donor_address_history WHERE org_id=? AND donor_id=? ORDER BY created_at DESC`, [req.user.orgId, req.params.id]);
  res.json({ history: rows });
}));

// ── Emails ─────────────────────────────────────────────────────────────────
app.get("/data-health/emails", requireAuth, wrap(async (req, res) => {
  res.json({ rows: await emailRows(req.user.orgId, await livePeople(req.user.orgId)) });
}));
// A person types the address, or accepts the suggestion. The bounce mark
// stays until they confirm the new address separately.
app.post("/data-health/emails/fix", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const donorId = String(req.body?.donorId || ""), email = String(req.body?.email || "").trim();
  if (!DH.isValidEmail(email)) return res.status(400).json({ error: "invalid_email", sentence: "That isn't a valid email address." });
  const [d] = await query("SELECT id, email, email_unreachable FROM donors WHERE org_id=? AND id=? AND deleted_at IS NULL", [req.user.orgId, donorId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  await run("UPDATE donors SET email=?, updated_at=NOW() WHERE id=? AND org_id=?", [email, donorId, req.user.orgId]);
  const sup = await bounceMap(req.user.orgId, [{ email }]);
  res.json({ ok: true, email, stillMarkedBounced: !!d.email_unreachable,
    newAddressSuppressed: sup.has(email.toLowerCase()),
    sentence: d.email_unreachable ? "Saved. The bounce mark stays until you confirm the new address is right." : "Saved." });
}));
app.post("/data-health/emails/clear-bounce", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const donorId = String(req.body?.donorId || "");
  if (req.body?.confirm !== true) return res.status(400).json({ error: "confirm_required", sentence: "Confirm the new address is right before the bounce mark is cleared." });
  const r = await run("UPDATE donors SET email_unreachable=false, email_unreachable_at=NULL, email_unreachable_reason=NULL, updated_at=NOW() WHERE id=? AND org_id=? AND email_unreachable", [donorId, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "No bounce mark to clear." });
  res.json({ ok: true });
}));
app.post("/data-health/emails/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const donorId = String(req.body?.donorId || ""), kind = String(req.body?.kind || "");
  if (!["role", "typo"].includes(kind)) return res.status(400).json({ error: "Only a role address or a suspected typo can be marked as right." });
  const [d] = await query("SELECT id, email FROM donors WHERE org_id=? AND id=?", [req.user.orgId, donorId]);
  if (!d || !d.email) return res.status(404).json({ error: "Donor not found" });
  const me = await who(req);
  await run(`INSERT INTO data_health_dismissals (id, org_id, kind, key, created_by, created_by_name) VALUES (?,?,?,?,?,?) ON CONFLICT (org_id, kind, key) DO NOTHING`,
    ["dhd_" + uuid().slice(0, 12), req.user.orgId, "email", `${d.id}:${d.email.trim().toLowerCase()}:${kind}`, me.id, me.name]);
  res.status(201).json({ ok: true });
}));

app.get("/data-health/unreachable", requireAuth, wrap(async (req, res) => {
  res.json({ rows: unreachableRows(await livePeople(req.user.orgId)) });
}));

// ── People who moved (NCOA) ────────────────────────────────────────────────
// A GET that writes nothing: the file is built from what is on file now.
app.get("/data-health/ncoa/file", requireAuth, wrap(async (req, res) => {
  const people = await query(`SELECT id, name, kind, address, address2, city, state, zip, country, deceased, address_unmailable, deleted_at
                                FROM donors WHERE org_id=? AND deleted_at IS NULL AND erased_at IS NULL ORDER BY name`, [req.user.orgId]);
  const rows = people.filter(DH.mailable);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="address-update-file-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("X-Row-Count", String(rows.length));
  // FIX-25: the app reads this from another origin, and a browser hides every
  // header it is not told it may show. Unexposed, the count read as 0 on prod.
  res.setHeader("Access-Control-Expose-Headers", "X-Row-Count");
  res.send(DH.ncoaExportCsv(rows));
}));
app.post("/data-health/ncoa/results", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const text = String(req.body?.text || "");
  const read = DH.readNcoaReturn(text);
  if (read.error) return res.status(400).json({ error: "unreadable_file", sentence: read.error });
  const orgId = req.user.orgId;
  const me = await who(req);
  const ids = [...new Set(read.entries.map(e => e.recordId))];
  const people = ids.length ? await query(`SELECT ${PERSON_COLS} FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL`, [orgId, ids]) : [];
  const byId = new Map(people.map(d => [d.id, d]));
  const counts = { rows: read.entries.length, moves: 0, noForwarding: 0, noMove: 0, unmatched: 0 };
  const batchId = "ncb_" + uuid().slice(0, 12);
  await withTransaction(async (client) => {
    await runTx(client, `INSERT INTO ncoa_batches (id, org_id, filename, created_by, created_by_name) VALUES (?,?,?,?,?)`,
      [batchId, orgId, String(req.body?.filename || "").slice(0, 200) || null, me.id, me.name]);
    for (const e of read.entries) {
      const d = byId.get(e.recordId);
      if (!d) { counts.unmatched++; continue; }
      if (e.kind === "none") { counts.noMove++; continue; }
      if (e.kind === "move") counts.moves++; else counts.noForwarding++;
      const old = { address: d.address || "", address2: d.address2 || "", city: d.city || "", state: d.state || "", zip: d.zip || "" };
      await runTx(client, `INSERT INTO ncoa_moves (id, org_id, batch_id, donor_id, kind, code, words, move_type, move_date, old_address, new_address, created_by, created_by_name)
                           VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?,?)`,
        ["ncm_" + uuid().slice(0, 12), orgId, batchId, d.id, e.kind, e.code, e.words, e.moveType, e.moveDate,
         JSON.stringify(old), e.newAddress ? JSON.stringify(e.newAddress) : null, me.id, me.name]);
    }
    await runTx(client, `UPDATE ncoa_batches SET rows_in=?, moves=?, no_forwarding=?, no_move=?, unmatched=? WHERE id=? AND org_id=?`,
      [counts.rows, counts.moves, counts.noForwarding, counts.noMove, counts.unmatched, batchId, orgId]);
  });
  res.status(201).json({ batchId, counts,
    sentence: `${counts.rows} rows read: ${counts.moves} moved with a new address, ${counts.noForwarding} moved with no forwarding address, ${counts.noMove} not moved${counts.unmatched ? `, ${counts.unmatched} ${counts.unmatched === 1 ? "row that matches" : "rows that match"} nobody on file` : ""}. Nothing has changed yet; approve the moves below.` });
}));
app.get("/data-health/ncoa/moves", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT m.id, m.donor_id, d.name, m.kind, m.code, m.words, m.move_type, m.move_date, m.old_address, m.new_address, m.created_at
       FROM ncoa_moves m JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
      WHERE m.org_id=? AND m.status='pending' AND d.deleted_at IS NULL ORDER BY d.name`, [req.user.orgId]);
  res.json({ moves: rows.map(r => ({ ...r, oldLine: DH.oneLine(r.old_address), newLine: r.new_address ? DH.oneLine(r.new_address) : null })) });
}));
app.post("/data-health/ncoa/apply", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : [];
  if (!ids.length) return res.status(400).json({ error: "Choose at least one move." });
  const orgId = req.user.orgId;
  const me = await who(req);
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  let applied = 0;
  await withTransaction(async (client) => {
    const moves = await queryTx(client, `SELECT * FROM ncoa_moves WHERE org_id=? AND id = ANY(?) AND status='pending' FOR UPDATE`, [orgId, ids]);
    for (const m of moves) {
      const [d] = await queryTx(client, "SELECT id, address, address2, city, state, zip FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [m.donor_id, orgId]);
      if (!d) continue;
      const before = { address: d.address || "", address2: d.address2 || "", city: d.city || "", state: d.state || "", zip: d.zip || "" };
      const when = m.move_date ? ` (moved ${m.move_date})` : "";
      if (m.kind === "move") {
        const n = m.new_address;
        await runTx(client, `INSERT INTO donor_address_history (id, org_id, donor_id, source, before, after, ncoa_move_id, created_by, created_by_name) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?,?)`,
          ["dah_" + uuid().slice(0, 12), orgId, d.id, "ncoa", JSON.stringify(before), JSON.stringify(n), m.id, me.id, me.name]);
        await runTx(client, `UPDATE donors SET address=?, address2=?, city=?, state=?, zip=?, address_unmailable=false, address_unmailable_reason=NULL, address_unmailable_at=NULL, updated_at=NOW() WHERE id=? AND org_id=?`,
          [n.address, n.address2 || null, n.city, n.state, n.zip, d.id, orgId]);
        await runTx(client, "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
          ["int_" + uuid().slice(0, 8), orgId, d.id, "note", `Address updated from a change of address file${when}. Was: ${DH.oneLine(before)}.`, today, me.id, me.name]);
      } else {
        await runTx(client, `INSERT INTO donor_address_history (id, org_id, donor_id, source, before, after, ncoa_move_id, created_by, created_by_name) VALUES (?,?,?,?,?::jsonb,NULL,?,?,?)`,
          ["dah_" + uuid().slice(0, 12), orgId, d.id, "ncoa_unmailable", JSON.stringify(before), m.id, me.id, me.name]);
        await runTx(client, `UPDATE donors SET address_unmailable=true, address_unmailable_reason=?, address_unmailable_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`,
          [`Change of address file: ${m.words}${when}.`, d.id, orgId]);
        await runTx(client, "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
          ["int_" + uuid().slice(0, 8), orgId, d.id, "note", `Address marked not mailable from a change of address file: ${m.words}${when}. The address on file was kept.`, today, me.id, me.name]);
      }
      await runTx(client, "UPDATE ncoa_moves SET status='applied', decided_at=NOW(), decided_by=?, decided_by_name=? WHERE id=? AND org_id=?", [me.id, me.name, m.id, orgId]);
      applied++;
    }
  });
  res.status(201).json({ applied });
}));
app.post("/data-health/ncoa/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : [];
  const me = await who(req);
  const r = await run("UPDATE ncoa_moves SET status='dismissed', decided_at=NOW(), decided_by=?, decided_by_name=? WHERE org_id=? AND id = ANY(?) AND status='pending'", [me.id, me.name, req.user.orgId, ids]);
  res.json({ dismissed: r.changes });
}));

module.exports.afterImport = afterImport;
module.exports.runDataHealth = runDataHealth;
module.exports.mergePeople = mergePeople;
}

module.exports = { routers, mount, MERGE_REFS, NOT_MOVED, KEY_COLS, REF_SHAPE, refMatch, UNDO_DAYS };
