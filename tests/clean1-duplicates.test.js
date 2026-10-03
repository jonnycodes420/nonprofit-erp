// tests/clean1-duplicates.test.js · CLEAN-1, Test 2. A DUPLICATE IS ONE
// ORG'S, AND "NOT A DUPLICATE" STAYS SAID.
//
// Two organisations can have the same person on file (the same name, email,
// phone and street), and those are two separate people as far as either org
// is concerned. A merge across that line would hand one org's gifts to the
// other. And a director who said "these two are not the same person" should
// never have to say it again after the next import.
//
//   §1  two orgs with identical people: each org's duplicate list names only
//       its own people, and pairs the two it has, never one from each org
//   §2  the pure finder refuses rows from another org rather than pairing them
//   §3  a pair marked "Not a duplicate" is gone from the list, the count and
//       the bulk preview, and stays gone after a real import (the import's
//       own Data health run included), even when the import brings in a
//       third record of the same person, which IS a new pair
//   §4  merging across orgs is a 404 that writes nothing
//
// HOW IT WOULD GO RED. Drop `org_id=?` from livePeople (§1 pairs across orgs);
// drop the dismissed set from duplicatePairs, or key it by name instead of by
// the two ids (§3). Planted: removing the dismissed filter turned §3 red.
//
// Standard scratch stack (tests/README.md).
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const DH = require("../dataHealth");

const ORGS = ["org_clean1x", "org_clean1y"];
const people = org => [
  { id: `${org}_a`, name: "Theodore Okafor", email: "ted.okafor@example.org", phone: "207-555-0199", address: "14 Wharf St", zip: "04101" },
  { id: `${org}_b`, name: "Ted Okafor", email: "ted.okafor@example.org", phone: "207-555-0199", address: "14 Wharf Street", zip: "04101" },
  { id: `${org}_c`, name: "Lucia Moreno", email: "lucia@example.org", phone: "207-555-0142" },
  { id: `${org}_d`, name: "Lucia M. Moreno", email: "lmoreno@example.org", phone: "207-555-0142" },
];

async function reset() {
  for (const org of ORGS) {
    for (const t of ["data_health_dismissals", "data_health_runs", "donor_merges", "interactions", "gifts", "imports"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1`, [org]).catch(e => ok(`clean ${org}`, false, e.message));
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth') ON CONFLICT (id) DO NOTHING`,
      [org, `Clean One ${org.slice(-1).toUpperCase()}`, org.replace("_", "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Clean Admin','admin')
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin'`,
      [`u_${org}`, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 10)]);
    for (const p of people(org)) {
      await q(`INSERT INTO donors (id,org_id,name,email,phone,address,zip,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days')`,
        [p.id, org, p.name, p.email, p.phone, p.address || null, p.zip || null]);
    }
  }
}
async function token(org) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${org}@test.local`, password: "loadtest1234" }) });
  return (await r.json()).token;
}
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } return null; };

(async () => {
  console.log("CLEAN-1 Test 2: duplicates stay inside one org, and \"Not a duplicate\" stays said\n");
  await reset();
  const [X, Y] = ORGS;
  const tx = await token(X), ty = await token(Y);

  // §1 ─────────────────────────────────────────────────────────────────────
  for (const [org, tok, other] of [[X, tx, Y], [Y, ty, X]]) {
    const r = await call(tok, "GET", "/data-health/duplicates");
    const ids = r.body.pairs.flatMap(p => [p.a, p.b]);
    ok(`${org}: its duplicate list loads`, r.status === 200 && Array.isArray(r.body.pairs), r.status);
    ok(`${org}: every person in every pair is its own`, ids.length > 0 && ids.every(id => id.startsWith(org + "_")), ids.join(","));
    ok(`${org}: no pair reaches into ${other}`, !ids.some(id => id.startsWith(other + "_")));
    const keys = r.body.pairs.map(p => p.key).sort();
    ok(`${org}: exactly its two pairs, Ted/Theodore and the two Lucias`, JSON.stringify(keys) === JSON.stringify([DH.pairKey(`${org}_a`, `${org}_b`), DH.pairKey(`${org}_c`, `${org}_d`)]), keys.join(" "));
    const ted = r.body.pairs.find(p => p.key === DH.pairKey(`${org}_a`, `${org}_b`));
    ok(`${org}: the pair says why in words, with a confidence and no number`, ted && ted.confidence === "high" && ted.reasons.some(x => /same email/.test(x)) && typeof ted.confidence === "string", JSON.stringify(ted && ted.reasons));
  }

  // §2 ─────────────────────────────────────────────────────────────────────
  const both = [...people(X).map(p => ({ ...p, org_id: X })), ...people(Y).map(p => ({ ...p, org_id: Y }))];
  let threw = false;
  try { DH.findDuplicatePairs(both, { orgId: X }); } catch { threw = true; }
  ok("the finder refuses a list that holds another org's people", threw);

  // §3 ─────────────────────────────────────────────────────────────────────
  const tedKey = DH.pairKey(`${X}_a`, `${X}_b`);
  const dis = await call(tx, "POST", "/data-health/pairs/dismiss", { a: `${X}_b`, b: `${X}_a` });
  ok("\"Not a duplicate\" is recorded", dis.status === 201 && dis.body.key === tedKey, JSON.stringify(dis));
  const after = await call(tx, "GET", "/data-health/duplicates");
  ok("the pair is gone from the list at once", !after.body.pairs.some(p => p.key === tedKey));
  const yStill = await call(ty, "GET", "/data-health/duplicates");
  ok("and saying it in one org says nothing about the other's", yStill.body.pairs.some(p => p.key === DH.pairKey(`${Y}_a`, `${Y}_b`)));

  // A real import: three rows through the donor import, then the run record
  // the screen writes, which is what runs Data health.
  const imp = await call(tx, "POST", "/donors/import", { donors: [
    { name: "Theodore Okafor", email: "t.okafor@work.example.org", phone: "(207) 555-0199" },
    { name: "Priya Shah", email: "priya@example.org" },
    { name: "Owen Hart", email: "owen@example.org" },
  ] });
  ok("the import goes through", imp.status === 200 || imp.status === 201, `${imp.status} ${JSON.stringify(imp.body).slice(0, 200)}`);
  const run = await call(tx, "POST", "/imports", { name: "CLEAN-1 test import", sourceFilename: "clean1.csv", shape: "donors", rowsIn: 3, donorsCreated: 3 });
  ok("the import's run is recorded", run.status === 201 || run.status === 200, `${run.status} ${JSON.stringify(run.body).slice(0, 200)}`);
  const healthRun = await waitFor(async () => (await q(`SELECT * FROM data_health_runs WHERE org_id=$1 AND trigger='import'`, [X]))[0]);
  ok("Data health ran after the import", !!healthRun);
  const post = await call(tx, "GET", "/data-health/duplicates");
  ok("the dismissed pair did not come back after the import", !post.body.pairs.some(p => p.key === tedKey), post.body.pairs.map(p => p.key).join(" "));
  const third = (await q(`SELECT id FROM donors WHERE org_id=$1 AND email='t.okafor@work.example.org'`, [X]))[0];
  ok("the import's third Theodore is a NEW pair with each of the two, which is right", third && post.body.pairs.some(p => p.key === DH.pairKey(third.id, `${X}_a`)), third && third.id);
  const counts = (await call(tx, "GET", "/data-health")).body.counts;
  ok("the count on the page agrees with the list it opens", counts.duplicates === post.body.pairs.length, `${counts.duplicates} vs ${post.body.pairs.length}`);
  const bulk = await call(tx, "GET", "/data-health/bulk-preview");
  ok("and the bulk preview never offers the dismissed pair", !bulk.body.pairs.some(p => p.key === tedKey));
  ok("the health run's own count left the dismissed pair out too", healthRun && healthRun.counts.duplicates === post.body.pairs.length, healthRun && healthRun.counts.duplicates);

  // §4 ─────────────────────────────────────────────────────────────────────
  const before = await q(`SELECT to_jsonb(d.*)::text AS j FROM donors d WHERE id = ANY($1) ORDER BY id`, [[`${X}_c`, `${Y}_c`]]);
  const cross = await call(tx, "POST", "/data-health/merge", { keptId: `${X}_c`, mergedId: `${Y}_c` });
  ok("a merge reaching into another org is a 404", cross.status === 404, `${cross.status} ${JSON.stringify(cross.body)}`);
  const afterCross = await q(`SELECT to_jsonb(d.*)::text AS j FROM donors d WHERE id = ANY($1) ORDER BY id`, [[`${X}_c`, `${Y}_c`]]);
  ok("and wrote nothing", JSON.stringify(before) === JSON.stringify(afterCross));
  const crossDismiss = await call(tx, "POST", "/data-health/pairs/dismiss", { a: `${X}_c`, b: `${Y}_c` });
  ok("so is marking a cross-org pair", crossDismiss.status === 404);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
