// tests/int5-api-keys.test.js — INT-5. THE ONE GUARD THIS BUILD EARNED.
//
//     A READ-ONLY KEY CANNOT WRITE, AND A KEY FROM ORG A GETS NOTHING
//     FROM ORG B.
//
// Both halves are the same promise from two directions. A key is a credential
// an organisation hands to a third party: to Zapier, to a consultant for one
// afternoon, to a contractor's script. It has to do exactly what was ticked and
// reach exactly one organisation, because the person holding it is, by
// definition, not the person who has to live with the consequences.
//
// WHAT IS ASSERTED:
//   §1  a key made read-only is refused on every write, with a 403 that names
//       the permission it lacks rather than a bare failure
//   §2  a key with write:gifts may record a gift AND STILL cannot add a person
//       or write a note — one scope does not carry another
//   §3  an EXISTING key (the literal legacy scope `read`) reads everything it
//       always could and cannot write, which is what stops this build silently
//       granting write access to keys already in somebody's Zapier account
//   §4  org A's key reads and writes nothing of org B's, on every route, and
//       aiming it at org B's ids answers "not found" rather than acting
//   §5  a revoked key is refused immediately
//   §6  the call log records the refusals as well as the successes, and holds
//       no donor data beyond the ids
//   §7  a gift written through the API goes through recordGift: it lands on the
//       donor's totals, which is what "the same function the app uses" means
//
// HOW IT WOULD GO RED: default a new key to every scope; let `read` expand to
// the write scopes; check the scope but not the org on a write; log the filled
// path (which is a list of donor ids). Proven able to fail: making `allows`
// return true turns §1 and §2 red, and expanding the legacy scope to the write
// set turns §3 red.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_int5a", B = "org_int5b";
const PW = bcrypt.hashSync("loadtest1234", 10);
// ── THE TEARDOWN, ASKED OF THE DATABASE RATHER THAN REMEMBERED ────────────
//
// `recordGift` writes a ledger entry and a finance audit row against the org's
// chart of accounts, so `accounts` and `fin_audit_log` outlive the gifts and
// block `DELETE FROM orgs` with an FK error that reads like a product bug on
// the SECOND run. A hand-written list of tables is a list that is one table
// short the moment somebody adds a table, and this suite has already been bitten
// by exactly that twice today.
//
// So the list is not written down: it is every table that references `orgs`,
// asked of the schema, deleted repeatedly until nothing more will go. Adding a
// table to the product cannot break this teardown again.
async function purgeOrg(orgId) {
  const rows = await q(`
    SELECT DISTINCT tc.table_name AS t
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='orgs'`);
  const tables = rows.map(r => r.t);
  // Several passes, because these tables reference each other as well as orgs
  // and one pass leaves whatever was blocked by a sibling.
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM ${t} WHERE org_id=$1`, [orgId]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
}

async function reset() {
  for (const o of [A, B]) {
    await purgeOrg(o);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [o, `INT5 ${o}`, `int5-${o}`]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'Admin','admin')`, [`u_${o}`, o, `${o}@int5.local`, PW]);
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active',0,'system:test','test')`,
      [`d_${o}`, o, `Person ${o}`, `person@${o}.example`]);
  }
}

// A key, made through the real route so the stored shape is the real shape.
async function makeKey(token, name, scopes) {
  const r = await api("POST", "/api-keys", token, scopes === undefined ? { name } : { name, scopes });
  if (r.status !== 200) throw new Error(`key create failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.id, key: r.body.key, scopes: r.body.scopes };
}
async function callApi(method, path, key, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": key },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  await reset();
  const S = await import("../shared/apiScopes.js");
  const tokA = await login(`${A}@int5.local`);
  const tokB = await login(`${B}@int5.local`);

  const readOnly = await makeKey(tokA, "Read only");
  const giftsKey = await makeKey(tokA, "Gift recorder", ["read:people", "write:gifts"]);
  const keyB     = await makeKey(tokB, "Org B key", ["read:people", "read:gifts", "write:people", "write:gifts"]);

  // ── §1 · A READ-ONLY KEY CANNOT WRITE ───────────────────────────────────
  ok("§1 a key with no scopes asked for defaults to the READ set",
    readOnly.scopes.every(s => s.startsWith("read:")), JSON.stringify(readOnly.scopes));
  const w1 = await callApi("POST", "/api/v1/people", readOnly.key, { name: "Should Not Exist", email: "nope@example.com" });
  ok("§1 …and is refused on write:people", w1.status === 403, `status ${w1.status}`);
  ok("§1 …naming the permission it lacks", w1.body.required === "write:people", JSON.stringify(w1.body));
  const w2 = await callApi("POST", "/api/v1/gifts", readOnly.key, { personId: `d_${A}`, amount: 10, date: "2026-09-30" });
  ok("§1 …and on write:gifts", w2.status === 403 && w2.body.required === "write:gifts", JSON.stringify(w2.body));
  const w3 = await callApi("POST", "/api/v1/notes", readOnly.key, { personId: `d_${A}`, note: "no" });
  ok("§1 …and on write:notes", w3.status === 403 && w3.body.required === "write:notes", JSON.stringify(w3.body));
  const [noPerson] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND email='nope@example.com'`, [A]);
  ok("§1 …and nothing was written", Number(noPerson.n) === 0, `${noPerson.n} found`);
  const r1 = await callApi("GET", "/api/v1/people", readOnly.key);
  ok("§1 …while reading still works", r1.status === 200, `status ${r1.status}`);

  // ── §2 · ONE SCOPE DOES NOT CARRY ANOTHER ───────────────────────────────
  const g = await callApi("POST", "/api/v1/gifts", giftsKey.key, { personId: `d_${A}`, amount: 25, date: "2026-09-30" });
  ok("§2 write:gifts may record a gift", g.status === 201, `status ${g.status} ${JSON.stringify(g.body)}`);
  const p2 = await callApi("POST", "/api/v1/people", giftsKey.key, { name: "Nope", email: "nope2@example.com" });
  ok("§2 …and still cannot add a person", p2.status === 403, `status ${p2.status}`);
  const n2 = await callApi("POST", "/api/v1/notes", giftsKey.key, { personId: `d_${A}`, note: "no" });
  ok("§2 …and still cannot write a note", n2.status === 403, `status ${n2.status}`);

  // ── §3 · AN EXISTING KEY GAINS NOTHING ──────────────────────────────────
  // The literal legacy scope, exactly as every key issued before INT-5 holds it.
  await q(`UPDATE api_keys SET scopes='["read"]'::jsonb WHERE id=$1`, [readOnly.id]);
  // Compared as SETS: effectiveScopes sorts, READ_SCOPES is in declaration
  // order, and an order mismatch is not a permissions difference.
  ok("§3 the legacy scope expands to every READ scope",
    S.effectiveScopes(["read"]).join(",") === [...S.READ_SCOPES].sort().join(","),
    S.effectiveScopes(["read"]).join(","));
  ok("§3 …and to NO write scope",
    S.effectiveScopes(["read"]).every(s => !s.startsWith("write:")), S.effectiveScopes(["read"]).join(","));
  const legacyRead = await callApi("GET", "/api/v1/people", readOnly.key);
  ok("§3 a legacy key still reads", legacyRead.status === 200, `status ${legacyRead.status}`);
  const legacyWrite = await callApi("POST", "/api/v1/people", readOnly.key, { name: "No", email: "no3@example.com" });
  ok("§3 …and cannot write", legacyWrite.status === 403, `status ${legacyWrite.status}`);

  // ── §4 · ONE KEY REACHES ONE ORGANISATION ───────────────────────────────
  const crossRead = await callApi("GET", `/api/v1/people/d_${B}`, giftsKey.key);
  ok("§4 org A's key cannot read org B's person", crossRead.status === 404, `status ${crossRead.status}`);
  const crossWrite = await callApi("POST", "/api/v1/gifts", giftsKey.key,
    { personId: `d_${B}`, amount: 999, date: "2026-09-30" });
  ok("§4 …and cannot record a gift against them", crossWrite.status === 404, `status ${crossWrite.status}`);
  const [bGifts] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [B]);
  ok("§4 …and org B has no gift", Number(bGifts.n) === 0, `${bGifts.n} found`);
  const bList = await callApi("GET", "/api/v1/people", keyB.key);
  const bNames = (bList.body.data || []).map(p => p.name);
  ok("§4 org B's key sees only org B's people",
    bNames.length === 1 && bNames[0] === `Person ${B}`, JSON.stringify(bNames));
  const aList = await callApi("GET", "/api/v1/people", giftsKey.key);
  ok("§4 …and org A's sees only org A's",
    (aList.body.data || []).every(p => p.name === `Person ${A}`), JSON.stringify((aList.body.data||[]).map(p=>p.name)));

  // ── §5 · A REVOKED KEY IS DEAD IMMEDIATELY ──────────────────────────────
  const rev = await api("DELETE", `/api-keys/${giftsKey.id}`, tokA);
  ok("§5 the key revokes", rev.status === 200, `status ${rev.status}`);
  const afterRevoke = await callApi("GET", "/api/v1/people", giftsKey.key);
  ok("§5 …and is refused at once", afterRevoke.status === 401, `status ${afterRevoke.status}`);

  // ── §6 · THE CALL LOG RECORDS REFUSALS, AND HOLDS NO DONOR DATA ─────────
  const log = await api("GET", `/api-keys/${readOnly.id}/calls`, tokA);
  ok("§6 the call log loads", log.status === 200, `status ${log.status}`);
  const statuses = (log.body.calls || []).map(c => c.status);
  ok("§6 …and holds the 403 refusals, not only the successes",
    statuses.includes(403), JSON.stringify(statuses));
  ok("§6 …each with a sentence a person can read",
    (log.body.calls || []).every(c => typeof c.sentence === "string" && c.sentence.length > 5),
    JSON.stringify((log.body.calls || []).slice(0, 2)));
  const logged = JSON.stringify(log.body);
  ok("§6 …and no donor name or address is in it",
    !logged.includes(`Person ${A}`) && !logged.includes(`person@${A}.example`), "leaked");
  const [pathRows] = await q(
    `SELECT COUNT(*)::int n FROM api_call_log WHERE org_id=$1 AND path LIKE '%d\\_%'`, [A]);
  ok("§6 …and the stored path is the route, never a filled donor id",
    Number(pathRows.n) === 0, `${pathRows.n} rows carry an id in the path`);

  // ── §7 · A GIFT WRITTEN THROUGH THE API IS A REAL GIFT ──────────────────
  const [donor] = await q(`SELECT total_giving, gift_count FROM donors WHERE id=$1`, [`d_${A}`]);
  ok("§7 the gift reached the donor's lifetime total",
    Number(donor.total_giving) === 25, `total_giving=${donor.total_giving}`);
  ok("§7 …and their gift count", Number(donor.gift_count) === 1, `gift_count=${donor.gift_count}`);
  const [stamped] = await q(`SELECT created_by FROM gifts WHERE org_id=$1 LIMIT 1`, [A]);
  ok("§7 …and the actor names the key that wrote it",
    String(stamped.created_by || "").startsWith("system:api/"), String(stamped.created_by));

  // ── §8 · FUNDS: ITS OWN SCOPE, ONE ORGANISATION (FIX-13) ────────────────
  for (const o of [A, B]) await q(`INSERT INTO fin_funds (id,org_id,name) VALUES ($1,$2,$3)`, [`fund_${o}`, o, `Fund ${o}`]);
  const noFunds = await callApi("GET", "/api/v1/funds", keyB.key);
  ok("§8 a key without read:funds is refused the fund list",
    noFunds.status === 403 && noFunds.body.required === "read:funds", `status ${noFunds.status} ${JSON.stringify(noFunds.body)}`);
  const fundsKey = await makeKey(tokA, "Fund reader", ["read:funds"]);
  const fl = await callApi("GET", "/api/v1/funds", fundsKey.key);
  // Compared with the database, not a hand list: §7's gift made org A a default fund too.
  const aFunds = (await q(`SELECT id FROM fin_funds WHERE org_id=$1 ORDER BY id`, [A])).map(r => r.id);
  const got = (fl.body.data || []);
  ok("§8 a key with read:funds sees exactly its own org's funds, as id and name",
    fl.status === 200 && got.some(f => f.id === `fund_${A}` && f.name === `Fund ${A}`)
      && !got.some(f => f.id === `fund_${B}`)
      && got.map(f => f.id).sort().join(",") === aFunds.join(",")
      && got.every(f => Object.keys(f).sort().join(",") === "id,name"),
    `status ${fl.status} ${JSON.stringify(got)}`);

  for (const o of [A, B]) await purgeOrg(o);
  await closeDb();
  summary("INT-5 — a read-only key cannot write, and one key reaches one organisation");
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
