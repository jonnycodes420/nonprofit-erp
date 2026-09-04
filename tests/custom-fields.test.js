// BUILD-78 Parts 1 + 5.3 + 6.3 — custom fields, grown up.
//
//   §1  the closed type set through the ONE seam: every type's coercion and
//       refusal, money to the cent, no value ever falls through to a default
//   §2  limits are clear messages, never silent truncation (40 / 100 / 2,000)
//   §3  the key is immutable and never derived from the label: rename
//       resolves every stored value; type is immutable after creation
//   §4  archive, never delete: export excludes, record hides, STORED VALUE
//       COUNT UNCHANGED; restore brings every value back BY VALUE, and the
//       word for it is "restored" — there is no DELETE route at all
//   §5  cross-org: another org's field key / field id buys nothing, and no
//       row is written (the Part 0 red run, now green)
//   §6  the legacy EAV migration: typed where clean, raw where not, zero
//       loss, idempotent re-run
//   §7  Part 9 — every definition change and value write is an audit event
//       with an actor identity
//
// Local scratch server + Postgres (tests/README.md recipe).

// §6 drives the migration IN-PROCESS through db.js's own pool; the scratch
// PG has no SSL, so mirror tenant-matrix's loopback toggle BEFORE the require.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { migrateLegacyCustomFields } = require("../customFields.js");

const A = "org_b78cf", B = "org_b78cfB", M = "org_b78cfmig";

async function resetOrg(org, { plan = "team" } = {}) {
  for (const t of ["custom_field_events", "custom_field_defs", "custom_field_values", "custom_fields",
    "fin_audit_log", "fin_transactions", "budgets", "accounts", "fin_funds", "metric_snapshots",
    "gifts", "interactions", "tasks", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,$2,$3,1,'active',$4)`, [org, `B78 ${org}`, org.replace(/_/g, "-"), plan]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'CF Admin','admin')`,
    [`u_${org}`, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 10)]);
}

(async () => {
  console.log("custom-fields (BUILD-78 Parts 1/5.3/6.3)");
  await resetOrg(A); await resetOrg(B); await resetOrg(M);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES
    ('d_cf1',$1,'Marta Reyes','marta@example.org'),
    ('d_cf2',$1,'Sam Okafor','sam@example.org')`, [A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES
    ('g_cf1',$1,'d_cf1',100,'2026-01-15','cash')`, [A]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_cfB',$1,'Bea Private','bea@zzmarkb.example')`, [B]);
  const tok = await login(`${A}@test.local`);
  const tokB = await login(`${B}@test.local`);

  // ── §1 · the closed type set through the seam ─────────────────────────────
  console.log("\n— §1 · type matrix through the one seam —");
  const mk = (label, type, extra = {}) => api("POST", "/custom-fields", tok, { entity: "donor", label, type, ...extra });
  const fText = (await mk("Preferred Name", "text")).body;
  const fLong = (await mk("Bio", "long_text")).body;
  const fNum = (await mk("Household Size", "number")).body;
  const fMoney = (await mk("Pledged Capacity", "money")).body;
  const fDate = (await mk("Last Contact", "date")).body;
  const fSel = (await mk("Gift Level", "select", { options: ["Bronze", "Silver", "Gold"] })).body;
  const fMulti = (await mk("Interests", "multi_select", { options: ["Gala", "Newsletter", "Volunteering"] })).body;
  const fCheck = (await mk("Board Member", "checkbox")).body;
  ok("eight fields created with keys", [fText, fLong, fNum, fMoney, fDate, fSel, fMulti, fCheck].every(f => f && f.key), fText);
  ok("key is a slug of the label at creation", fCheck.key === "board_member", fCheck.key);

  const w1 = await api("PUT", "/donors/d_cf1/custom-fields", tok, { values: {
    preferred_name: "  Marti  ", bio: "Long-time supporter.", household_size: "4",
    pledged_capacity: "USD 1,234.56", last_contact: "03-16-2020", gift_level: "gold ",
    interests: "gala; NEWSLETTER", board_member: "Y",
  } });
  ok("typed write accepted", w1.status === 200, w1.body);
  const [row1] = await q(`SELECT custom_fields FROM donors WHERE id='d_cf1'`);
  const v = row1.custom_fields;
  ok("text trimmed", v.preferred_name === "Marti", v.preferred_name);
  ok("number is a Number", v.household_size === 4, v.household_size);
  ok("money stored as integer CENTS through the money seam", v.pledged_capacity === 123456, v.pledged_capacity);
  ok("date stored as ISO civil date (mm-dd-yyyy parsed explicitly)", v.last_contact === "2020-03-16", v.last_contact);
  ok("select stored as the canonical option after trim+case-fold", v.gift_level === "Gold", v.gift_level);
  ok("multi-select stored as canonical option array", JSON.stringify(v.interests) === JSON.stringify(["Gala", "Newsletter"]), v.interests);
  ok("checkbox 'Y' is boolean true", v.board_member === true, v.board_member);

  // refusals — nothing falls through to a default
  for (const [values, why] of [
    [{ board_member: "maybe" }, "checkbox 'maybe' is an error, not false"],
    [{ last_contact: "2/30/2024" }, "calendar-invalid date refused"],
    [{ last_contact: "left message" }, "non-date refused, never stored as text"],
    [{ gift_level: "Platinum" }, "unknown select option refused"],
    [{ household_size: "several" }, "non-numeric number refused"],
    [{ bio: "x".repeat(2001) }, "over-cap long text is an error, not a truncation"],
    [{ nonexistent_key: "hi" }, "unknown key refused"],
  ]) {
    const r = await api("PUT", "/donors/d_cf1/custom-fields", tok, { values });
    ok(`${why} (422)`, r.status === 422 && Array.isArray(r.body.errors) && r.body.errors.length === 1, `${r.status} ${JSON.stringify(r.body)}`);
  }
  const [row1b] = await q(`SELECT custom_fields FROM donors WHERE id='d_cf1'`);
  ok("refused writes changed nothing", JSON.stringify(row1b.custom_fields) === JSON.stringify(v), row1b.custom_fields);

  // blank clears
  const wClear = await api("PUT", "/donors/d_cf1/custom-fields", tok, { values: { preferred_name: "" } });
  ok("blank clears the key", wClear.status === 200 && wClear.body.customFields.preferred_name === undefined, wClear.body);

  // gift entity through the same seam
  const gf = (await api("POST", "/custom-fields", tok, { entity: "gift", label: "Appeal Code", type: "text" })).body;
  ok("gift-entity field created in the same table", gf.entity === "gift" && gf.key === "appeal_code", gf);
  const wg = await api("PUT", "/gifts/g_cf1/custom-fields", tok, { values: { appeal_code: "FY26-SPRING" } });
  const [grow] = await q(`SELECT custom_fields FROM gifts WHERE id='g_cf1'`);
  ok("gift value lands on the gift row", wg.status === 200 && grow.custom_fields.appeal_code === "FY26-SPRING", grow.custom_fields);
  const wgx = await api("PUT", "/gifts/g_cf1/custom-fields", tok, { values: { preferred_name: "nope" } });
  ok("a donor field key is unknown on the gift entity", wgx.status === 422, wgx.body);

  // ── §2 · limits are clear messages ────────────────────────────────────────
  console.log("\n— §2 · limits —");
  const opt101 = Array.from({ length: 101 }, (_, i) => `Opt ${i}`);
  const rOpt = await api("POST", "/custom-fields", tok, { entity: "donor", label: "Too Many", type: "select", options: opt101 });
  ok("101 options refused, message names the cap", rOpt.status === 400 && /100/.test(rOpt.body.error), rOpt.body);
  // fill donor entity to the 40 cap (8 exist)
  for (let i = 0; i < 32; i++) await mk(`Filler ${i}`, "text");
  const r41 = await mk("One Too Many", "text");
  ok("41st live field refused, message names the cap and the way out", r41.status === 400 && /40/.test(r41.body.error) && /[Aa]rchive/.test(r41.body.error), r41.body);
  const filler0 = (await api("GET", "/custom-fields?entity=donor", tok)).body.find(f => f.label === "Filler 0");
  await api("POST", `/custom-fields/${filler0.id}/archive`, tok, {});
  const rAfter = await mk("Fits Now", "text");
  ok("archiving frees a slot", rAfter.status === 200, rAfter.body);

  // ── §3 · immutability ─────────────────────────────────────────────────────
  console.log("\n— §3 · the key never moves; the type never changes —");
  const ren = await api("PUT", `/custom-fields/${fCheck.id}`, tok, { label: "Trustee? (…renamed, in ANY encoding ☃)" });
  ok("label renamed", ren.status === 200 && ren.body.label.includes("Trustee"), ren.body);
  ok("key unchanged by rename", ren.body.key === "board_member", ren.body.key);
  const [rowK] = await q(`SELECT custom_fields FROM donors WHERE id='d_cf1'`);
  ok("stored value still resolves through the key", rowK.custom_fields.board_member === true, rowK.custom_fields);
  const tchg = await api("PUT", `/custom-fields/${fCheck.id}`, tok, { type: "text" });
  ok("type change refused with the archive-and-recreate answer", tchg.status === 400 && /archive/i.test(tchg.body.error), tchg.body);
  const kchg = await api("PUT", `/custom-fields/${fCheck.id}`, tok, { key: "other_key" });
  ok("key change refused", kchg.status === 400, kchg.body);
  const oRem = await api("PUT", `/custom-fields/${fSel.id}`, tok, { options: ["Bronze", "Silver"] });
  ok("removing an in-use option refused (values still point at it)", oRem.status === 400 && /Gold/.test(oRem.body.error), oRem.body);
  const oAdd = await api("PUT", `/custom-fields/${fSel.id}`, tok, { options: ["Bronze", "Silver", "Gold", "Platinum"] });
  ok("adding an option allowed", oAdd.status === 200 && oAdd.body.options.length === 4, oAdd.body);

  // ── §4 · archive, never delete ────────────────────────────────────────────
  console.log("\n— §4 · archive proves prevention —");
  await api("PUT", "/donors/d_cf2/custom-fields", tok, { values: { gift_level: "Bronze" } });
  const countVals = async () => (await q(
    `SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND custom_fields ? 'gift_level'`, [A]))[0].n;
  const before = await countVals();
  ok("two donors hold a Gift Level value", before === 2, before);

  const arch = await api("POST", `/custom-fields/${fSel.id}/archive`, tok, {});
  ok("archived", arch.status === 200 && arch.body.archivedAt, arch.body);
  const list = (await api("GET", "/custom-fields?entity=donor", tok)).body;
  ok("archived field hidden from the default list", !list.some(f => f.id === fSel.id), list.length);
  const rec = (await api("GET", "/donors/d_cf1/custom-fields", tok)).body;
  ok("archived field hidden from the record", !rec.some(f => f.id === fSel.id), rec.length);
  const csv = await api("GET", "/donors/export/csv", tok);
  ok("archived field excluded from the CSV export header", !csv.text.split("\n")[0].includes("Gift Level"), csv.text.split("\n")[0]);
  ok("STORED VALUE COUNT UNCHANGED through archive", (await countVals()) === before, await countVals());

  const rest = await api("POST", `/custom-fields/${fSel.id}/restore`, tok, {});
  ok("restored (and the word is 'restored')", rest.status === 200 && !rest.body.archivedAt, rest.body);
  const [r1] = await q(`SELECT custom_fields->>'gift_level' AS g FROM donors WHERE id='d_cf1'`);
  const [r2] = await q(`SELECT custom_fields->>'gift_level' AS g FROM donors WHERE id='d_cf2'`);
  ok("every value returns BY VALUE, not only by count", r1.g === "Gold" && r2.g === "Bronze", [r1.g, r2.g]);
  const csv2 = await api("GET", "/donors/export/csv", tok);
  ok("restored field back in the export with its values", csv2.text.split("\n")[0].includes("Gift Level") && csv2.text.includes("Gold"), csv2.text.split("\n")[0]);

  const del = await api("DELETE", `/custom-fields/${fSel.id}`, tok);
  ok("there is NO hard-delete route in this build", del.status === 404, del.status);

  // ── §5 · cross-org buys nothing ───────────────────────────────────────────
  console.log("\n— §5 · the wall (Part 0 red run, now green) —");
  const bField = (await api("POST", "/custom-fields", tokB, { entity: "donor", label: "Org B Private Field", type: "text" })).body;
  const xw = await api("PUT", "/donors/d_cf1/custom-fields", tok, { values: { [bField.key]: "written across the wall" } });
  ok("org B's field key is 'no such field' at org A", xw.status === 422 && /no such field/.test(JSON.stringify(xw.body.errors)), xw.body);
  const [rowX] = await q(`SELECT custom_fields FROM donors WHERE id='d_cf1'`);
  ok("and NO value landed", rowX.custom_fields[bField.key] === undefined, rowX.custom_fields);
  for (const [method, path] of [["PUT", `/custom-fields/${bField.id}`], ["POST", `/custom-fields/${bField.id}/archive`], ["POST", `/custom-fields/${bField.id}/restore`]]) {
    const r = await api(method, path, tok, { label: "hijack" });
    ok(`${method} ${path.replace(bField.id, ":bId")} → 404, empty body`, r.status === 404 && !JSON.stringify(r.body).includes("Private"), r.body);
  }
  const [bRow] = await q(`SELECT label, archived_at FROM custom_field_defs WHERE id=$1`, [bField.id]);
  ok("org B's field untouched and still live", bRow.label === "Org B Private Field" && !bRow.archived_at, bRow);
  const xg = await api("PUT", "/donors/d_cfB/custom-fields", tok, { values: {} });
  ok("org A writing on org B's donor → 404", xg.status === 404, xg.status);

  // ── §6 · the legacy EAV migration ─────────────────────────────────────────
  console.log("\n— §6 · legacy migration: typed where clean, raw where not, zero loss —");
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_cfm1',$1,'Legacy One','l1@example.org'),('d_cfm2',$1,'Legacy Two','l2@example.org')`, [M]);
  await q(`INSERT INTO custom_fields (id,org_id,label,field_type,options,field_order) VALUES
    ('ocf_a',$1,'Alma Mater','text','[]',1),
    ('ocf_b',$1,'Grad Year','number','[]',2),
    ('ocf_c',$1,'Region','dropdown','["East","West"]',3)`, [M]);
  await q(`INSERT INTO custom_field_values (id,org_id,donor_id,field_id,value) VALUES
    ('ocv_1',$1,'d_cfm1','ocf_a','Berea College'),
    ('ocv_2',$1,'d_cfm1','ocf_b','1998'),
    ('ocv_3',$1,'d_cfm2','ocf_b','unknown-ish'),
    ('ocv_4',$1,'d_cfm2','ocf_c','East')`, [M]);
  await migrateLegacyCustomFields();
  const defs = await q(`SELECT * FROM custom_field_defs WHERE org_id=$1 ORDER BY position`, [M]);
  ok("three defs migrated with generated keys", defs.length === 3 && defs.map(d => d.key).join(",") === "alma_mater,grad_year,region", defs.map(d => d.key));
  ok("dropdown became select", defs[2].type === "select", defs[2].type);
  const [m1] = await q(`SELECT custom_fields FROM donors WHERE id='d_cfm1'`);
  const [m2] = await q(`SELECT custom_fields FROM donors WHERE id='d_cfm2'`);
  ok("clean values typed (number 1998 is a Number)", m1.custom_fields.alma_mater === "Berea College" && m1.custom_fields.grad_year === 1998, m1.custom_fields);
  ok("garbage number preserved RAW, never dropped", m2.custom_fields.grad_year === "unknown-ish", m2.custom_fields);
  ok("select value carried", m2.custom_fields.region === "East", m2.custom_fields);
  const again = await migrateLegacyCustomFields();
  const defs2 = await q(`SELECT COUNT(*)::int AS n FROM custom_field_defs WHERE org_id=$1`, [M]);
  ok("re-run creates nothing new (idempotent)", defs2[0].n === 3 && again.defs === 0, again);

  // ── §7 · the audit trail carries an actor ─────────────────────────────────
  console.log("\n— §7 · Part 9: events with identities —");
  const evs = await q(`SELECT event, created_by, created_by_name FROM custom_field_events WHERE org_id=$1 ORDER BY created_at`, [A]);
  const kinds = new Set(evs.map(e => e.event));
  ok("definition events distinct from value events",
    ["definition_created", "definition_renamed", "definition_archived", "definition_restored", "values_written"].every(k => kinds.has(k)),
    [...kinds]);
  ok("every event carries an actor identity, never null", evs.every(e => e.created_by && e.created_by_name), evs.filter(e => !e.created_by).slice(0, 3));
  ok("the actor is the human who did it", evs[0].created_by === `u_${A}`, evs[0]);

  await summary();
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
