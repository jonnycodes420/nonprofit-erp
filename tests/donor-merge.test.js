// BUILD-08 Phase C — duplicate detection + merge verification.
// Local scratch server + Postgres only (tests/README.md recipe). No Stripe.
//
// Proves: same-email and similar-name candidate detection; a merge moves
// every child-table row to the primary in one transaction (including the
// unique-constrained tables, where the primary's own row wins a conflict);
// blank primary fields fill from the secondary (never overwriting non-blank
// ones); tags union; the secondary is soft-deleted (trash, not gone); a
// merge-note interaction lands on the primary; aggregates are recalculated;
// cross-org merges 404 both ways; read_only orgs get 402.

const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb } = require("./helpers");

const ORG = "org_test_merge";
const ORG_B = "org_test_merge_b";
const ORG_RO = "org_test_merge_ro";

async function fixture() {
  for (const org of [ORG, ORG_B, ORG_RO]) {
    for (const t of ["receipts", "pledges", "gifts", "interactions", "milestone_drafts", "note_reminders",
      "donor_materials", "planned_gifts", "payment_recovery_events", "recurring_subscriptions", "tasks",
      "volunteers", "campaign_recipients", "custom_field_values", "custom_field_defs", "sequence_enrollments", "event_attendees",
      "donor_relationships", "sequences", "events", "custom_fields", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id, name, onboarding_complete) VALUES ($1,'Merge Fixture Org',1)`, [ORG]);
  await q(`INSERT INTO orgs (id, name, onboarding_complete) VALUES ($1,'Merge Fixture Org B',1)`, [ORG_B]);
  await q(`INSERT INTO orgs (id, name, onboarding_complete, subscription_status) VALUES ($1,'Merge RO Org',1,'trial_expired')`, [ORG_RO]);
  await q(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES
    ('u_mrg_staff',$1,'mrg-staff@test.local',$2,'Mel Staff','staff'),
    ('u_mrg_b',$3,'mrg-b@test.local',$2,'Bea Admin','admin'),
    ('u_mrg_ro',$4,'mrg-ro@test.local',$2,'Ro Admin','admin')`, [ORG, hash, ORG_B, ORG_RO]);

  // The duplicate pair: same email, different casing. Primary has blanks the
  // secondary fills (phone, city) and a non-blank field the secondary must
  // NOT overwrite (notes). Distinct tags to prove the union.
  await q(`INSERT INTO donors (id, org_id, name, email, phone, city, state, notes, tags, status, stage, total_giving, gift_count)
    VALUES ('d_mrg_p',$1,'Jordan Rivers','JORDAN@rivers.example',NULL,NULL,NULL,'Longtime supporter.','["board"]','mid','steward',100,1),
           ('d_mrg_s',$1,'Jordan Rivers','jordan@rivers.example','555-0100','Portland','OR','','["arts","board"]','new','cultivate',40,1)`, [ORG]);
  // Similar-name pair (no shared email) for tier-2 detection.
  await q(`INSERT INTO donors (id, org_id, name, email, status, stage) VALUES
    ('d_mrg_n1',$1,'Katherine Willoughby','kw1@example.com','new','prospect'),
    ('d_mrg_n2',$1,'Katharine Willoughby','kw2@example.com','new','prospect')`, [ORG]);
  // Org-B donor for the cross-org attempt.
  await q(`INSERT INTO donors (id, org_id, name, email, status, stage) VALUES ('d_mrg_bx',$1,'Foreign Donor','fx@example.com','new','prospect')`, [ORG_B]);
  // Read-only-org pair.
  await q(`INSERT INTO donors (id, org_id, name, email, status, stage) VALUES
    ('d_mrg_ro1',$1,'Ro Dupe','ro@example.com','new','prospect'),
    ('d_mrg_ro2',$1,'Ro Dupe','RO@example.com','new','prospect')`, [ORG_RO]);

  // Children under BOTH donors, across every table the merge touches.
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date) VALUES
    ('g_mrg_p1',$1,'d_mrg_p',100,'2026-01-10'),
    ('g_mrg_s1',$1,'d_mrg_s',25,'2026-02-05'),
    ('g_mrg_s2',$1,'d_mrg_s',15.50,'2026-03-01')`, [ORG]);
  await q(`INSERT INTO interactions (id, org_id, donor_id, type, note, date) VALUES
    ('i_mrg_p1',$1,'d_mrg_p','call','Spoke about spring gala','2026-01-11'),
    ('i_mrg_s1',$1,'d_mrg_s','email','Sent welcome note','2026-02-06')`, [ORG]);
  await q(`INSERT INTO pledges (id, org_id, donor_id, amount, due_date, status) VALUES ('pl_mrg_s',$1,'d_mrg_s',500,'2026-09-01','open')`, [ORG]);
  await q(`INSERT INTO receipts (id, org_id, donor_id, gift_id, type, receipt_number, amount, deductible_amount, snapshot)
    VALUES ('rc_mrg_s',$1,'d_mrg_s','g_mrg_s1','gift','2026-00001',25,25,'{}')`, [ORG]);
  await q(`INSERT INTO milestone_drafts (id, org_id, donor_id, milestone_key, subject, body, status) VALUES ('md_mrg_s',$1,'d_mrg_s','threshold_500','sub','body','pending_review')`, [ORG]);
  await q(`INSERT INTO note_reminders (id, org_id, donor_id, milestone_key, talking_points, status) VALUES ('nr_mrg_s',$1,'d_mrg_s','anniversary_year_1','[]','pending')`, [ORG]);
  await q(`INSERT INTO donor_materials (id, org_id, donor_id, file_name, file_type) VALUES ('dm_mrg_s',$1,'d_mrg_s','deck.pdf','application/pdf')`, [ORG]);
  await q(`INSERT INTO planned_gifts (id, org_id, donor_id, type, estimated_value) VALUES ('pg_mrg_s',$1,'d_mrg_s','bequest',10000)`, [ORG]);
  await q(`INSERT INTO payment_recovery_events (id, org_id, donor_id, type) VALUES ('pre_mrg_s',$1,'d_mrg_s','payment_failed')`, [ORG]);
  await q(`INSERT INTO recurring_subscriptions (id, org_id, donor_id, stripe_subscription_id, amount, status) VALUES ('rs_mrg_s',$1,'d_mrg_s','sub_mrg_test',25,'active')`, [ORG]);
  await q(`INSERT INTO tasks (id, org_id, donor_id, title, priority, done) VALUES ('t_mrg_s',$1,'d_mrg_s','Call Jordan','high',0)`, [ORG]);
  await q(`INSERT INTO volunteers (id, org_id, donor_id, name) VALUES ('v_mrg_s',$1,'d_mrg_s','Jordan Rivers')`, [ORG]);
  await q(`INSERT INTO campaign_recipients (id, org_id, donor_id, email) VALUES ('cr_mrg_s',$1,'d_mrg_s','jordan@rivers.example')`, [ORG]);

  // Unique-constrained children with a CONFLICT on each: both donors have a
  // value for field cf1 / an enrollment in seq1 / attendance at ev1 (the
  // primary's row must win), plus a secondary-only row that must move.
  // BUILD-78: custom values ride the donor row (JSONB keyed by field key).
  await q(`INSERT INTO custom_field_defs (id, org_id, entity, key, label, type) VALUES
    ('cf_mrg_1',$1,'donor','preferred_name','Preferred Name','text'),
    ('cf_mrg_2',$1,'donor','t_shirt_size','T-Shirt Size','text')`, [ORG]);
  await q(`UPDATE donors SET custom_fields='{"preferred_name":"Jordy"}'::jsonb WHERE id='d_mrg_p'`);
  await q(`UPDATE donors SET custom_fields='{"preferred_name":"J.","t_shirt_size":"L"}'::jsonb WHERE id='d_mrg_s'`);
  await q(`INSERT INTO sequences (id, org_id, name, trigger, status) VALUES ('sq_mrg_1',$1,'Lapsed win-back','lapsed_90','active'),('sq_mrg_2',$1,'New donor','new_donor','active')`, [ORG]);
  await q(`INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, status) VALUES
    ('se_mrg_p1','sq_mrg_1',$1,'d_mrg_p','active'),
    ('se_mrg_s1','sq_mrg_1',$1,'d_mrg_s','active'),
    ('se_mrg_s2','sq_mrg_2',$1,'d_mrg_s','active')`, [ORG]);
  await q(`INSERT INTO events (id, org_id, name, event_type, date, status) VALUES ('ev_mrg_1',$1,'Gala','gala','2026-05-01','completed'),('ev_mrg_2',$1,'Tour','cultivation','2026-06-01','completed')`, [ORG]);
  await q(`INSERT INTO event_attendees (id, event_id, org_id, donor_id, name, status) VALUES
    ('ea_mrg_p1','ev_mrg_1',$1,'d_mrg_p','Jordan Rivers','attended'),
    ('ea_mrg_s1','ev_mrg_1',$1,'d_mrg_s','Jordan Rivers','invited'),
    ('ea_mrg_s2','ev_mrg_2',$1,'d_mrg_s','Jordan Rivers','attended')`, [ORG]);
  // A relationship that becomes self-referencing after the merge, plus one to
  // a third party that must survive re-pointed.
  await q(`INSERT INTO donors (id, org_id, name, email, status, stage) VALUES ('d_mrg_t',$1,'Third Party','tp@example.com','new','prospect')`, [ORG]);
  await q(`INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type) VALUES
    ('dr_mrg_1',$1,'d_mrg_p','d_mrg_s','spouse'),
    ('dr_mrg_2',$1,'d_mrg_s','d_mrg_t','friend')`, [ORG]);
}

(async () => {
  await fixture();
  console.log("fixture ready\n");
  const login = async (email) => (await api("POST", "/auth/login", null, { email, password: "loadtest1234" })).body?.token;
  const token = await login("mrg-staff@test.local");
  ok("staff login (merge is staff-level, not admin-only)", !!token);

  // ── Detection ──
  const dup = await api("GET", "/donors/duplicates", token);
  ok("GET /donors/duplicates 200", dup.status === 200, dup.body);
  const emailGroup = (dup.body.groups || []).find(g => g.tier === "email" && g.donors.some(d => d.id === "d_mrg_p"));
  ok("same-email pair detected (case-insensitive)", !!emailGroup && emailGroup.donors.length === 2);
  const nameGroup = (dup.body.groups || []).find(g => g.tier === "name" && g.donors.some(d => d.id === "d_mrg_n1"));
  ok("similar-name pair detected (Katherine/Katharine)", !!nameGroup && nameGroup.donors.some(d => d.id === "d_mrg_n2"));

  // ── Pre-merge child counts across every table ──
  const CHILD_COUNTS = [
    ["gifts", 3], ["interactions", 2], ["pledges", 1], ["receipts", 1], ["milestone_drafts", 1],
    ["note_reminders", 1], ["donor_materials", 1], ["planned_gifts", 1], ["payment_recovery_events", 1],
    ["recurring_subscriptions", 1], ["tasks", 1], ["volunteers", 1], ["campaign_recipients", 1],
  ];
  const countBoth = async (t) => parseInt((await q(`SELECT COUNT(*) c FROM ${t} WHERE org_id=$1 AND donor_id IN ('d_mrg_p','d_mrg_s')`, [ORG]))[0].c, 10);
  for (const [t, n] of CHILD_COUNTS) ok(`fixture sanity: ${t} has ${n} rows across the pair`, (await countBoth(t)) === n);

  // ── Bad requests ──
  ok("merge donor into itself → 400", (await api("POST", "/donors/merge", token, { primaryId: "d_mrg_p", secondaryId: "d_mrg_p" })).status === 400);
  ok("missing ids → 400", (await api("POST", "/donors/merge", token, { primaryId: "d_mrg_p" })).status === 400);

  // ── The merge ──
  const m = await api("POST", "/donors/merge", token, { primaryId: "d_mrg_p", secondaryId: "d_mrg_s" });
  ok("merge → 200", m.status === 200, m.body);

  // Every child row now under the primary; none left under the secondary.
  for (const [t, n] of CHILD_COUNTS) {
    const underP = parseInt((await q(`SELECT COUNT(*) c FROM ${t} WHERE org_id=$1 AND donor_id='d_mrg_p'`, [ORG]))[0].c, 10);
    const underS = parseInt((await q(`SELECT COUNT(*) c FROM ${t} WHERE org_id=$1 AND donor_id='d_mrg_s'`, [ORG]))[0].c, 10);
    // interactions gains the merge note (+1)
    const expected = t === "interactions" ? n + 1 : n;
    ok(`${t}: all ${expected} under primary, 0 under secondary`, underP === expected && underS === 0, { underP, underS });
  }

  // Unique-constrained tables: primary's row won each conflict, extras moved.
  const [cfRow] = await q(`SELECT custom_fields FROM donors WHERE id='d_mrg_p'`);
  ok("custom fields: primary's conflicting value kept ('Jordy'), secondary-only value moved",
    cfRow.custom_fields?.preferred_name === "Jordy" && cfRow.custom_fields?.t_shirt_size === "L", cfRow.custom_fields);
  const se = await q(`SELECT id, sequence_id FROM sequence_enrollments WHERE org_id=$1 AND donor_id='d_mrg_p' ORDER BY sequence_id`, [ORG]);
  ok("enrollments: primary's kept for seq1, secondary's seq2 moved, no dupes", se.length === 2 && se.find(r => r.sequence_id === "sq_mrg_1")?.id === "se_mrg_p1", se);
  const ea = await q(`SELECT id, event_id FROM event_attendees WHERE org_id=$1 AND donor_id='d_mrg_p' ORDER BY event_id`, [ORG]);
  ok("event attendance: primary's gala row kept, tour attendance moved", ea.length === 2 && ea.find(r => r.event_id === "ev_mrg_1")?.id === "ea_mrg_p1", ea);

  // Relationships: self-relation dropped, third-party re-pointed.
  const dr = await q(`SELECT * FROM donor_relationships WHERE org_id=$1`, [ORG]);
  ok("self-relationship dropped, third-party relationship re-pointed to primary", dr.length === 1 && dr[0].donor_id_a === "d_mrg_p" && dr[0].donor_id_b === "d_mrg_t", dr);

  // Fill-blanks + preserve + union.
  const [p] = await q(`SELECT * FROM donors WHERE id='d_mrg_p'`, []);
  ok("blank phone filled from secondary", p.phone === "555-0100", p.phone);
  ok("blank city/state filled", p.city === "Portland" && p.state === "OR");
  ok("non-blank notes NOT overwritten", p.notes === "Longtime supporter.", p.notes);
  const tags = JSON.parse(p.tags || "[]");
  ok("tags unioned (board + arts)", tags.includes("board") && tags.includes("arts") && tags.length === 2, tags);
  ok("aggregates recalced: total 140.50 across 3 gifts", parseFloat(p.total_giving) === 140.5 && p.gift_count === 3, { total: p.total_giving, count: p.gift_count });
  ok("last gift date/amount from merged history", p.last_gift_date === "2026-03-01" && parseFloat(p.last_gift_amount) === 15.5, { d: p.last_gift_date, a: p.last_gift_amount });

  // Secondary soft-deleted (trash), not hard-deleted; merge note on primary.
  const [s] = await q(`SELECT deleted_at FROM donors WHERE id='d_mrg_s'`, []);
  ok("secondary soft-deleted (in trash, recoverable)", !!s && s.deleted_at !== null);
  const note = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_mrg_p' AND note LIKE 'Merged duplicate record%'`, [ORG]);
  ok("merge note logged as interaction on primary", note.length === 1 && /Jordan Rivers/.test(note[0].note), note);

  // Merged-away donor no longer appears in duplicates or the directory.
  const dup2 = await api("GET", "/donors/duplicates", token);
  ok("pair gone from duplicates after merge", !(dup2.body.groups || []).some(g => g.donors.some(d => d.id === "d_mrg_s")));

  // ── Cross-org isolation: 404 both directions, nothing changed ──
  const tokenB = await login("mrg-b@test.local");
  ok("cross-org: B's admin merging A's donors → 404", (await api("POST", "/donors/merge", tokenB, { primaryId: "d_mrg_n1", secondaryId: "d_mrg_n2" })).status === 404);
  ok("cross-org: A staff with B's donor as secondary → 404", (await api("POST", "/donors/merge", token, { primaryId: "d_mrg_n1", secondaryId: "d_mrg_bx" })).status === 404);
  const [bx] = await q(`SELECT deleted_at FROM donors WHERE id='d_mrg_bx'`, []);
  ok("B's donor untouched", bx.deleted_at === null);

  // ── read_only org → 402 (checkWriteAccess) ──
  const tokenRo = await login("mrg-ro@test.local");
  const ro = await api("POST", "/donors/merge", tokenRo, { primaryId: "d_mrg_ro1", secondaryId: "d_mrg_ro2" });
  ok("trial_expired org merge → 402 subscription_required", ro.status === 402 && ro.body?.error === "subscription_required", { status: ro.status, body: ro.body });

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
