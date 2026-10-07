// tests/clean1-merge.test.js · CLEAN-1, Test 1. A MERGE MOVES EVERYTHING,
// FOOTS TO THE CENT, AND UNDOES EXACTLY.
//
// The July merge moved a hand-kept list of about twenty tables, and every
// table added since had to remember to join it. Most didn't. So this suite
// does not trust the list: it reads db.js, finds every column that points at
// a person (a REFERENCES donors(id), or a name like donor_id / person_id /
// *_donor_id / *_person_id), and
//
//   §1  every one of them is in MERGE_REFS or in NOT_MOVED with a reason, and
//       so is every foreign key to donors the live database actually has
//   §2  a row is planted in EVERY one of those tables pointing at the person
//       being merged away; after the merge none still points at them and every
//       one points at the kept person (the twins the kept person already had
//       are set aside, never lost)
//   §3  the kept person's lifetime giving equals the two before, to the cent
//   §4  undo puts back both people and every row in every table, byte for byte
//   §5  a merge that would leave one person with two current memberships is
//       refused, and refusing changes nothing
//
// HOW IT WOULD GO RED. Add a table with a donor_id to db.js and leave it out
// of MERGE_REFS (§1). Drop a table from MERGE_REFS (§2: its planted row still
// points at the merged person). Lose a gift in the move, or sum in floats
// (§3). Restore one of the donor rows from a JS Date instead of the stored
// text, or forget a set-aside row (§4: microseconds and the row differ).
// Planted: removing "volunteer_magic_links" from MERGE_REFS turned §1
// red; skipping the set-aside re-insert turned §4 red. WIRE-1: removing
// "calendar_events.person_ids" from MERGE_REFS turned §1 red (the widened
// pattern now sees TEXT[] person_ids and entity_id) and §2's two-person
// meeting red; restored, green.
//
// Standard scratch stack (tests/README.md). It plants rows with foreign-key
// checks off in ITS OWN session only (session_replication_role), so a table's
// other required columns can hold placeholders; the server's own work runs
// with every check on.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const { MERGE_REFS, NOT_MOVED, KEY_COLS, refMatch } = require("../routes/dataHealth");

const ORG = "org_clean1m";
const A = "dn_c1m_kept", B = "dn_c1m_gone", C = "dn_c1m_other", D = "dn_c1m_d", E = "dn_c1m_e";
const ME = "u_c1m";

// ── §1 source: every person pointer in db.js ────────────────────────────────
function personColumnsInDbJs() {
  const src = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const out = new Set();
  let cur = null;
  // WIRE-1: an array of people (person_ids TEXT[]) and a generic entity_id
  // are pointers too. The old pattern saw neither, so a merge left meetings,
  // the Agent's undo ledger and custom field history on the merged-away id.
  const isPointer = (col, rest) => /REFERENCES donors\(id\)/i.test(rest) || /^(donor_id|person_id|donor_id_[ab]|match_employer_id|entity_id)$/.test(col)
    || /_(donor|person)_id$/.test(col) || /^(donor|person)_ids$/.test(col) || /_(donor|person)_ids$/.test(col)
    // FIX-33: the people an unsure calendar event might be with.
    || col === "candidate_ids";
  for (const line of src.split("\n")) {
    const m = line.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
    if (m) cur = m[1];
    const alt = line.match(/ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)\s+([^`]*)/i);
    if (alt) { if (isPointer(alt[2], alt[3])) out.add(`${alt[1]}.${alt[2]}`); continue; }
    if (cur) {
      const c = line.match(/^\s+(\w+)\s+(TEXT|VARCHAR)\b(.*)$/i);
      if (c && isPointer(c[1], c[3])) out.add(`${cur}.${c[1]}`);
      if (/^\s*\)\s*;?\s*`?\s*\)?\s*;?\s*$/.test(line) || /`\s*\)\s*;/.test(line)) cur = null;
    }
  }
  return [...out].sort();
}

// A pointer that means a person only on one kind of row is planted as that kind.
const PLANT_AS = { "agent_writes.entity_id": { entity_table: "donors" }, "custom_field_events.entity_id": { entity: "donor" } };

// A dedicated connection for planting, with FK checks off for this session.
const planter = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", ssl: false, max: 1 });

async function colsOf(table) {
  return q(`SELECT column_name, data_type, udt_name, is_nullable, column_default, is_generated
              FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
}
const PERSON_COL = c => /^(donor_id|person_id|donor_id_[ab])$/.test(c) || /_(donor|person)_id$/.test(c);
function placeholder(c, n) {
  const t = c.udt_name;
  if (c.column_name === "id") return `c1m_${n}_${Math.random().toString(36).slice(2, 10)}`;
  if (/^int|numeric|float/.test(t)) return 1;
  if (t === "bool") return false;
  if (t === "jsonb" || t === "json") return "{}";
  if (t === "date") return "2026-01-15";
  if (/^timestamp/.test(t)) return "2026-01-15T12:00:00Z";
  if (t.startsWith("_")) return "{}";
  // A TEXT column named like a date holds a date: other code casts these
  // across every org (the demo seed does), and a word there breaks it.
  if (/(^|_)(date|day|month|on)$|_date_|^due|_at$/.test(c.column_name)) return "2026-01-15";
  return `c1m_${n}_${Math.random().toString(36).slice(2, 8)}`;
}
// One row in `table` with `col` = B. Required columns get placeholders; a
// CHECK that refuses a placeholder is read and its first allowed value used.
async function plant(client, table, col, n, overrides = {}) {
  const cols = await colsOf(table);
  const row = {};
  for (const c of cols) {
    if (c.is_generated === "ALWAYS") continue;
    if (c.column_name === col) row[c.column_name] = c.udt_name.startsWith("_") ? [B] : B;
    else if (c.column_name === "org_id") row.org_id = ORG;
    else if (PERSON_COL(c.column_name) && c.is_nullable === "NO") row[c.column_name] = C;
    else if (c.column_name === "id" || (c.is_nullable === "NO" && c.column_default == null)) row[c.column_name] = placeholder(c, n);
  }
  Object.assign(row, overrides);
  for (let attempt = 0; attempt < 8; attempt++) {
    const keys = Object.keys(row);
    try {
      await client.query("SAVEPOINT p");
      await client.query(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map(k => row[k]));
      await client.query("RELEASE SAVEPOINT p");
      return true;
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT p");
      if (e.code !== "23514" || !e.constraint) throw new Error(`${table}.${col}: ${e.message}`);
      const [{ def }] = (await client.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass`, [e.constraint, table])).rows;
      const m = def.match(/\(?(\w+)\)?\s*(?:=\s*ANY\s*\(\s*\(?ARRAY\[|IN\s*\()'([^']*)'/i);
      if (!m) throw new Error(`${table}.${col}: cannot satisfy ${def}`);
      row[m[1]] = m[2];
    }
  }
  throw new Error(`${table}.${col}: gave up`);
}

// Every row of every table the merge touches, for this org, as stored text.
async function snapshot() {
  const tables = [...new Set(MERGE_REFS.map(([t]) => t)), "donors"];
  const out = {};
  for (const t of tables) {
    const rows = await q(`SELECT to_jsonb(x.*)::text AS j FROM ${t} x WHERE org_id=$1`, [ORG]);
    out[t] = rows.map(r => r.j).sort();
  }
  return out;
}
const centsOf = async id => Number((await q(`SELECT round(total_giving*100)::bigint AS c FROM donors WHERE id=$1`, [id]))[0].c);
const giftCents = async id => Number((await q(`SELECT COALESCE(SUM(round(amount*100)),0)::bigint AS c FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, id]))[0].c);

async function wipe(c0) {
  const c = c0 || await planter.connect();
  try {
    await c.query("SET session_replication_role = replica");
    const tables = [...new Set(MERGE_REFS.map(([t]) => t)), "donor_merges", "data_health_dismissals", "data_health_runs",
      "ncoa_batches", "audiences", "custom_fields", "donors"];
    for (const t of tables) await c.query(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await c.query("SET session_replication_role = origin");
  } finally { if (!c0) c.release(); }
}
async function reset() {
  const c = await planter.connect();
  try {
    await wipe(c);
    // The org and its admin are reused, never deleted: the audit log that
    // points at them is append-only.
    await c.query(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Clean One Merge Trust','clean1-merge',1,'active','growth')
                   ON CONFLICT (id) DO NOTHING`, [ORG]);
    await c.query(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,'c1m@test.local',$3,'Merge Admin','admin')
                   ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin'`, [ME, ORG, bcrypt.hashSync("loadtest1234", 10)]);
    const person = (id, name, email, extra = "") => c.query(
      `INSERT INTO donors (id,org_id,name,email,phone,employer,tags,created_at,updated_at${extra ? "," + extra.split("=")[0] : ""})
       VALUES ($1,$2,$3,$4,$5,'Harbor Supply','["board"]',NOW() - INTERVAL '400 days', NOW() - INTERVAL '3 days'${extra ? ",'" + extra.split("=")[1] + "'" : ""})`,
      [id, ORG, name, email, "207-555-0101"]);
    await person(A, "Margaret Chen", "margaret@example.org");
    await person(B, "Margaret A. Chen", "mchen@example.org", "funder_ein=12-3456789");
    await person(C, "Someone Else", "else@example.org");
    await person(D, "Dana Ruiz", "dana@example.org");
    await person(E, "Dana Ruiz", "dana.ruiz@example.org");
  } finally { c.release(); }
}

(async () => {
  console.log("CLEAN-1 Test 1: a merge moves every row, foots to the cent, and undoes exactly\n");

  // §1 ─────────────────────────────────────────────────────────────────────
  const inDb = personColumnsInDbJs();
  const covered = new Set(MERGE_REFS.map(([t, c]) => `${t}.${c}`));
  const missing = inDb.filter(k => !covered.has(k) && !NOT_MOVED[k]);
  ok(`db.js names ${inDb.length} person pointers, and every one is moved or named as not moved`, missing.length === 0, missing.join(", "));
  ok("the list found the tables July's merge never moved (a sanity floor, not a count to chase)", inDb.length >= 60, inDb.length);
  const stale = [...covered].filter(k => !inDb.includes(k));
  ok("MERGE_REFS names nothing db.js does not have", stale.length === 0, stale.join(", "));
  const fks = await q(`SELECT c.conrelid::regclass::text AS t, a.attname AS col
                         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey)
                        WHERE c.contype='f' AND c.confrelid='donors'::regclass`);
  const fkMissing = fks.map(r => `${r.t}.${r.col}`).filter(k => !covered.has(k) && !NOT_MOVED[k]);
  ok(`the live database's ${fks.length} foreign keys to donors are all covered`, fkMissing.length === 0, fkMissing.join(", "));

  // §2 ─────────────────────────────────────────────────────────────────────
  await reset();
  const c = await planter.connect();
  let planted = 0;
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    let n = 0;
    for (const [t, col] of MERGE_REFS) {
      if (t === "gifts" && col === "donor_id") continue;      // real gifts below
      await plant(c, t, col, ++n, PLANT_AS[`${t}.${col}`] || {}); planted++;
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); ok("every table takes a planted row", false, e.message); }
  finally { c.release(); }
  // Real money, in cents that a float sum gets wrong.
  const gift = (id, donor, amt) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,'2026-03-02','cash')`, [id, ORG, donor, amt]);
  await gift("g_c1m_a1", A, "100.10"); await gift("g_c1m_a2", A, "0.20");
  await gift("g_c1m_b1", B, "50.05"); await gift("g_c1m_b2", B, "1234.67"); await gift("g_c1m_b3", B, "0.01");
  // Twins the kept person already has: a static group both are in, and a
  // relationship and a soft credit that would point a person at themselves.
  await q(`INSERT INTO audiences (id,org_id,name,kind,segment) VALUES ('aud_c1m',$1,'Board circle','static','{}')`, [ORG]).catch(e => ok("a real group for the twin row", false, e.message));
  await q(`INSERT INTO group_members (group_id,org_id,donor_id,added_by) VALUES ('aud_c1m',$1,$2,'u_c1m'),('aud_c1m',$1,$3,'u_c1m')`, [ORG, A, B]).catch(e => ok("both in one group", false, e.message));
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type) VALUES ('rel_c1m',$1,$2,$3,'spouse')`, [ORG, B, A]).catch(e => ok("a relationship between the two", false, e.message));
  await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount) VALUES ('sc_c1m',$1,'g_c1m_a1',$2,100.10)`, [ORG, B]).catch(e => ok("a soft credit for B on A's gift", false, e.message));
  // A meeting with both people on it: after the merge the kept person is on it
  // once, and undo puts the array back exactly, order and all.
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by)
           VALUES ('ce_c1m_both',$1,'u_c1m','google','ev_c1m_both','Coffee','2026-03-02T15:00:00Z','2026-03-02T16:00:00Z',$2,'u_c1m')`, [ORG, [B, C, A]])
    .catch(e => ok("a meeting with both people", false, e.message));
  // FIX-31: every thread has its task, written by a trigger the planter's
  // session turned off. Touch the planted thread with triggers on, so the
  // fixture is in the state every real org is in before the merge.
  await q(`UPDATE threads SET due_date = due_date WHERE org_id=$1`, [ORG]);
  for (const id of [A, B]) await q(`UPDATE donors SET total_giving=(SELECT COALESCE(SUM(amount),0) FROM gifts WHERE org_id=$1 AND donor_id=$2) WHERE id=$2`, [ORG, id]);
  ok(`a row is planted in every one of the ${MERGE_REFS.length - 1} other pointer columns`, planted === MERGE_REFS.length - 1, planted);

  const before = await snapshot();
  const keptCents = await centsOf(A), goneCents = await centsOf(B);
  ok("the two lifetimes are $100.30 and $1,284.73 before", keptCents === 10030 && goneCents === 128473, `${keptCents} ${goneCents}`);

  const login = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "c1m@test.local", password: "loadtest1234" }) }).then(r => r.json());
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
  const merge = await fetch(BASE + "/data-health/merge", { method: "POST", headers: H, body: JSON.stringify({ keptId: A, mergedId: B }) });
  const mj = await merge.json().catch(() => ({}));
  ok("the merge succeeds", merge.status === 201, `${merge.status} ${JSON.stringify(mj).slice(0, 300)}`);

  const stillB = [];
  for (const [t, col] of MERGE_REFS) {
    const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id=$1 AND ${refMatch(t, col).sql.replace("?", "$2")}`, [ORG, B]);
    if (n) stillB.push(`${t}.${col}=${n}`);
  }
  ok("no row in any table still points at the merged person", stillB.length === 0, stillB.join(", "));
  const notMoved = [];
  for (const [t, col] of MERGE_REFS) {
    const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id=$1 AND ${refMatch(t, col).sql.replace("?", "$2")}`, [ORG, A]);
    if (!n) notMoved.push(`${t}.${col}`);
  }
  ok("every table now has a row pointing at the kept person", notMoved.length === 0, notMoved.join(", "));
  const [both] = await q(`SELECT person_ids FROM calendar_events WHERE id='ce_c1m_both'`);
  ok("a meeting with both people names the kept person once, the merged one not at all",
    JSON.stringify(both?.person_ids) === JSON.stringify([C, A]), JSON.stringify(both?.person_ids));
  const m = (await q(`SELECT * FROM donor_merges WHERE org_id=$1`, [ORG]))[0];
  const asideTables = (m?.set_aside || []).map(s => s.table).sort();
  ok("the twins are set aside, not lost: the group row, the self-relationship and the self-credit",
    JSON.stringify(asideTables) === JSON.stringify(["donor_relationships", "gift_soft_credits", "group_members"]), asideTables.join(","));
  const [kept] = await q(`SELECT * FROM donors WHERE id=$1`, [A]);
  const [gone] = await q(`SELECT * FROM donors WHERE id=$1`, [B]);
  ok("the merged record is soft-deleted, not destroyed", !!gone.deleted_at);
  ok("both emails are kept, the other one as the second email", kept.email && kept.email2 && new Set([kept.email, kept.email2]).size === 2, `${kept.email} / ${kept.email2}`);
  ok("the EIN came across to the kept record", kept.funder_ein === "12-3456789" && gone.funder_ein == null);

  // §3 ─────────────────────────────────────────────────────────────────────
  ok("the kept person's lifetime giving is $1,385.03, the two before to the cent", await centsOf(A) === keptCents + goneCents, await centsOf(A));
  ok("and the gifts behind it foot to the same cent", await giftCents(A) === keptCents + goneCents);
  ok("the route reports the same footing", mj.lifetime && mj.lifetime.keptAfterCents === 138503 && mj.lifetime.keptBeforeCents + mj.lifetime.mergedBeforeCents === 138503, JSON.stringify(mj.lifetime));

  // §4 ─────────────────────────────────────────────────────────────────────
  const undo = await fetch(BASE + `/data-health/merges/${mj.mergeId}/undo`, { method: "POST", headers: H, body: "{}" });
  ok("undo succeeds", undo.status === 200, `${undo.status} ${(await undo.text()).slice(0, 300)}`);
  const after = await snapshot();
  const diff = Object.keys(before).filter(t => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
  ok("every row in every table, both people included, is exactly as it was", diff.length === 0, diff.map(t => {
    const b = new Set(before[t]), a = new Set(after[t]);
    return `${t}: -${[...b].filter(x => !a.has(x)).join(" ").slice(0, 3000)} +${[...a].filter(x => !b.has(x)).join(" ").slice(0, 3000)}`;
  }).join(" | "));
  const again = await fetch(BASE + `/data-health/merges/${mj.mergeId}/undo`, { method: "POST", headers: H, body: "{}" });
  ok("a second undo is refused", again.status === 409);

  // §5 ─────────────────────────────────────────────────────────────────────
  for (const [id, who] of [["mem_c1m_d", D], ["mem_c1m_e", E]]) {
    const cc = await planter.connect();
    try { await cc.query("BEGIN"); await cc.query("SET LOCAL session_replication_role = replica");
      await plant(cc, "memberships", "donor_id", id, { id, donor_id: who, status: "active" }); await cc.query("COMMIT"); }
    catch (e) { await cc.query("ROLLBACK"); ok("two current memberships planted", false, e.message); }
    finally { cc.release(); }
  }
  const beforeRefuse = await snapshot();
  const refused = await fetch(BASE + "/data-health/merge", { method: "POST", headers: H, body: JSON.stringify({ keptId: D, mergedId: E }) });
  const rj = await refused.json().catch(() => ({}));
  ok("two current memberships: the merge is refused with a sentence", refused.status === 409 && /membership/i.test(rj.sentence || ""), `${refused.status} ${JSON.stringify(rj)}`);
  const afterRefuse = await snapshot();
  ok("and refusing changed nothing", JSON.stringify(beforeRefuse) === JSON.stringify(afterRefuse));

  // Leave nothing behind for the next suite or the demo seed to trip on.
  await wipe();
  await planter.end();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await planter.end(); await closeDb(); } catch {} process.exit(1); });
