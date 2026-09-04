// BUILD-78 Part 0 — FAILS-FIRST REPRODUCTION (committed as the red record).
//
// The claim under test (spec Part 7, "the subtle one"): org A referencing
// org B's custom-field id on org A's OWN donor must be rejected with no row
// written. The pre-BUILD-78 route (POST /donors/:id/custom-fields) checks
// that the donor is yours but never that the FIELD is — so the write lands.
// Worse: the read-back join filters on cf.org_id = A, so the value that
// landed is invisible even to the org that wrote it. A write that succeeds
// and can never be read is the quietest kind of data loss.
//
// Run against the scratch stack (never prod): node scripts/build78-repro-crossorg-fieldid.js
// Hard refusal, own layer on top of tests/helpers' (two layers on purpose):
// this script seeds and writes; it must never point anywhere but loopback.
for (const [name, v] of [["DATABASE_URL", process.env.DATABASE_URL || ""], ["BASE", process.env.BASE || "http://localhost:5601"]]) {
  if (v && !/localhost|127\.0\.0\.1/.test(v)) {
    console.error(`REFUSED: ${name}=${v} is not loopback — this reproduction writes and never runs against a remote target.`);
    process.exit(1);
  }
}
const bcrypt = require("bcryptjs");
const { q, login, api, closeDb } = require("../tests/helpers");

const A = "org_b78reproA", B = "org_b78reproB";

(async () => {
  for (const org of [A, B]) {
    await q(`DELETE FROM custom_field_values WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM custom_fields WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["gifts", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [org, `B78 ${org}`, org.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'B78 Admin','admin')`,
      [`u_${org}`, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 10)]);
  }
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_b78reproA',$1,'Repro Donor A','repro-a@example.org')`, [A]);
  await q(`INSERT INTO custom_fields (id,org_id,label,field_type) VALUES ('cf_b78reproB',$1,'Org B Private Field','text')`, [B]);

  const tokA = await login(`${A}@test.local`);
  const res = await api("POST", "/donors/d_b78reproA/custom-fields", tokA,
    { fieldId: "cf_b78reproB", value: "written across the wall" });
  const rows = await q(
    `SELECT org_id, donor_id, field_id, value FROM custom_field_values WHERE donor_id='d_b78reproA' AND field_id='cf_b78reproB'`);

  console.log("POST status:", res.status, "body:", JSON.stringify(res.body));
  console.log("rows written with org B's field_id:", rows.length, rows[0] ? JSON.stringify(rows[0]) : "");
  if (res.status === 200 && rows.length === 1) {
    console.log("REPRODUCED: cross-org field_id reference was ACCEPTED and the row was written.");
  } else if (res.status === 404 && rows.length === 0) {
    console.log("FIXED: cross-org field_id rejected, no row written.");
  } else {
    console.log("UNEXPECTED state — inspect before trusting either verdict.");
  }
  await closeDb();
})();
