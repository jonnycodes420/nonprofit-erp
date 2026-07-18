// BUILD-14 Parts 2-3 — Constituent designations / planned-giving tagging.
// Local scratch server + Postgres (tests/README.md recipe).
//
// Covers: designation CRUD (estate / planned_confirmed / planned_prospect),
// idempotent add, unknown-kind 400, donor-list filtering (planned-giving as a
// first-class reportable segment), foreign-donor IDOR (orgOwns) on read/write/
// delete, checkWriteAccess gating (read_only 402, DELETE ungated, reads 200),
// and two-way org isolation.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_dsg_a", B = "org_dsg_b", RO = "org_dsg_ro";
const today = new Date().toISOString().slice(0, 10);

async function reset() {
  for (const org of [A, B, RO]) {
    for (const t of ["donor_designations", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag, subStatus = "active") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,'growth')`,
    [o, `DSG ${tag}`, `dsg-${tag}`, subStatus]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [`u_${o}`, o, `${tag}@dsg.local`, hash, `Admin ${tag}`]);
}
async function seedDonor(o, id, name) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date)
           VALUES ($1,$2,$3,$4,'mid','cultivate',100,1,$5)`, [id, o, name, `${id}@dsg.local`, today]);
}

(async () => {
  await reset();
  await seedOrg(A, "a"); await seedOrg(B, "b"); await seedOrg(RO, "ro", "trial_expired");
  await seedDonor(A, "dsg_1", "Planned Patty");
  await seedDonor(A, "dsg_2", "Estate Ed");
  await seedDonor(A, "dsg_3", "Regular Rick");
  await seedDonor(B, "dsg_bx", "Foreign Fran");
  await seedDonor(RO, "dsg_ro", "RO Rita");

  const tokenA = await login("a@dsg.local");
  const tokenB = await login("b@dsg.local");
  const tokenRO = await login("ro@dsg.local");

  // ── Add designations ──────────────────────────────────────────────────────
  ok("POST planned_confirmed → 201", (await api("POST", "/donors/dsg_1/designations", tokenA, { kind: "planned_confirmed" })).status === 201);
  ok("POST estate → 201", (await api("POST", "/donors/dsg_2/designations", tokenA, { kind: "estate" })).status === 201);
  ok("POST planned_prospect on d_1 (second designation) → 201", (await api("POST", "/donors/dsg_1/designations", tokenA, { kind: "planned_prospect" })).status === 201);

  // idempotent
  await api("POST", "/donors/dsg_1/designations", tokenA, { kind: "planned_confirmed" });
  const dsgRows = await q("SELECT COUNT(*)::int AS n FROM donor_designations WHERE donor_id='dsg_1'");
  ok("re-adding same designation is idempotent (2 rows, not 3)", dsgRows[0].n === 2, dsgRows[0].n);

  ok("POST unknown kind → 400", (await api("POST", "/donors/dsg_1/designations", tokenA, { kind: "vip_banana" })).status === 400);

  // ── List ──────────────────────────────────────────────────────────────────
  const list = (await api("GET", "/donors/dsg_1/designations", tokenA)).body;
  ok("GET designations returns both with labels", list.length === 2 && list.every(x => x.label), list);

  // ── Filter donor list (planned giving as a segment) ───────────────────────
  const plannedList = (await api("GET", "/donors?designation=planned_confirmed", tokenA)).body;
  ok("filter designation=planned_confirmed → only d_1", plannedList.length === 1 && plannedList[0].id === "dsg_1", plannedList.map(d => d.id));
  const estateList = (await api("GET", "/donors?designation=estate", tokenA)).body;
  ok("filter designation=estate → only d_2", estateList.length === 1 && estateList[0].id === "dsg_2");
  const paged = (await api("GET", "/donors?designation=planned_confirmed&limit=50", tokenA)).body;
  ok("filter works in paginated shape too", paged.total === 1 && paged.donors[0].id === "dsg_1", paged.total);
  const noneList = (await api("GET", "/donors?designation=planned_prospect", tokenA)).body;
  ok("filter designation=planned_prospect → only d_1", noneList.length === 1 && noneList[0].id === "dsg_1");

  // ── Remove ────────────────────────────────────────────────────────────────
  ok("DELETE designation → 200", (await api("DELETE", "/donors/dsg_1/designations/planned_prospect", tokenA)).status === 200);
  ok("d_1 now has 1 designation", (await q("SELECT COUNT(*)::int AS n FROM donor_designations WHERE donor_id='dsg_1'"))[0].n === 1);
  ok("filter planned_prospect now empty", (await api("GET", "/donors?designation=planned_prospect", tokenA)).body.length === 0);

  // ── IDOR / org isolation ──────────────────────────────────────────────────
  ok("POST on foreign donor → 404", (await api("POST", "/donors/dsg_bx/designations", tokenA, { kind: "estate" })).status === 404);
  ok("GET on foreign donor → 404", (await api("GET", "/donors/dsg_bx/designations", tokenA)).status === 404);
  ok("DELETE on foreign donor → 404", (await api("DELETE", "/donors/dsg_bx/designations/estate", tokenA)).status === 404);
  ok("no designation planted on foreign donor", (await q("SELECT COUNT(*)::int AS n FROM donor_designations WHERE donor_id='dsg_bx'"))[0].n === 0);
  // org B can't see A's designations via its own filter
  ok("org B designation filter sees none of A's", (await api("GET", "/donors?designation=planned_confirmed", tokenB)).body.length === 0);

  // ── checkWriteAccess ──────────────────────────────────────────────────────
  ok("read_only POST designation → 402", (await api("POST", "/donors/dsg_ro/designations", tokenRO, { kind: "estate" })).status === 402);
  ok("read_only GET designations → 200", (await api("GET", "/donors/dsg_ro/designations", tokenRO)).status === 200);
  // seed a designation directly, confirm DELETE is ungated even for read_only
  await q("INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES ('dsg_ro1',$1,'dsg_ro','estate')", [RO]);
  ok("read_only DELETE designation → 200 (DELETE ungated)", (await api("DELETE", "/donors/dsg_ro/designations/estate", tokenRO)).status === 200);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
