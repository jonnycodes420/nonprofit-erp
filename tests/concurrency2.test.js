// BUILD-44 Part 5 — concurrency additions (extends tests/concurrency.test.js).
// TESTS ONLY. Four races the original suite didn't drive directly:
//   1. two SIMULTANEOUS edits to the same gift → a deterministic winner, and
//      donor total == gift row == LEDGER STAMP (the BUILD-43 sync must hold
//      under a race, not just sequentially)
//   2. two officers reassigning the same donor at once → one coherent owner,
//      portfolio counts reconcile to the donor table exactly
//   3. duplicate imports of the same file IN PARALLEL → each donor once, each
//      gift once (the advisory-lock guarantee, driven head-on)
//   4. a DOUBLE-SUBMITTED pledge payment (two identical gift POSTs racing
//      with the SAME idempotency key) — BUILD-45 §1.1 fixed FINDINGS F-3:
//      the key is enforced by uq_gifts_idem at the DB, so a double-tap now
//      records exactly ONE gift, and (§1.2 F-5) a $400 payment against a
//      $1,000 pledge leaves it OPEN with a $600 balance, applied once.
// Each racy scenario runs N times (races are probabilistic).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q } = require("./helpers");

const ORG = "org_conc44";
const ADMIN_ID = "u_c44_admin", ADMIN = "c44-admin@example.org";
const OFF2_ID = "u_c44_off2", OFF2 = "c44-off2@example.org";
const TODAY = new Date().toISOString().slice(0, 10);
const N = 6;

(async () => {
  for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "pledges", "tasks", "interactions",
    "fin_transactions", "fin_accounts", "accounts", "fin_funds", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status)
           VALUES ($1,'Conc44 Org','conc44',1,'team','active')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'C44 Admin','admin')`, [ADMIN_ID, ORG, ADMIN, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'C44 Off2','staff')`, [OFF2_ID, ORG, OFF2, hash]);
  const token = await login(ADMIN);
  const token2 = await login(OFF2);
  await api("POST", "/onboarding/complete", token, {}); // '4010' account → ledger stamps live

  const mkDonor = async (id, name) => q(
    `INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count)
     VALUES ($1,$2,$3,$4,'active','cultivate',0,0)`, [id, ORG, name, id + "@c44.local"]);

  // ── 1. parallel edits to the same gift ──
  {
    let coherent = 0, winners = new Set();
    for (let i = 0; i < N; i++) {
      const did = `d_c44_g${i}`;
      await mkDonor(did, "Race Gift " + i);
      await api("POST", `/donors/${did}/gifts`, token, { amount: 100, date: TODAY, type: "one-time", notes: "race-base" });
      const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, did]))[0].id;
      const [a, b] = await Promise.all([
        api("PUT", `/gifts/${gid}`, token, { amount: 700 }),
        api("PUT", `/gifts/${gid}`, token2, { amount: 900 }),
      ]);
      if (a.status !== 200 || b.status !== 200) continue;
      const gift = Number((await q(`SELECT amount FROM gifts WHERE id=$1`, [gid]))[0].amount);
      const donor = Number((await q(`SELECT total_giving FROM donors WHERE id=$1`, [did]))[0].total_giving);
      const ledger = Number((await q(`SELECT amount FROM fin_transactions WHERE gift_id=$1`, [gid]))[0]?.amount ?? NaN);
      winners.add(gift);
      if ((gift === 700 || gift === 900) && donor === gift && ledger === gift) coherent++;
    }
    ok(`parallel gift edits ×${N}: winner is always one of the two writes`, [...winners].every(w => w === 700 || w === 900), [...winners]);
    ok(`parallel gift edits ×${N}: donor total AND ledger stamp always equal the winning amount (no torn write, no double-count)`, coherent === N, { coherent, N });
  }

  // ── 2. two officers reassigning the same donor at once ──
  {
    let coherent = 0;
    for (let i = 0; i < N; i++) {
      const did = `d_c44_a${i}`;
      await mkDonor(did, "Race Assign " + i);
      await Promise.all([
        api("PATCH", `/donors/${did}/assign`, token, { assignedTo: ADMIN_ID }),
        api("PATCH", `/donors/${did}/assign`, token, { assignedTo: OFF2_ID }),
      ]);
      const a = (await q(`SELECT assigned_to FROM donors WHERE id=$1`, [did]))[0].assigned_to;
      if (a === ADMIN_ID || a === OFF2_ID) coherent++;
    }
    ok(`parallel reassign ×${N}: one coherent final owner every time`, coherent === N, coherent);
    // portfolio counts reconcile with the donor table exactly
    const off = await api("GET", "/portfolio/officers", token);
    for (const o of off.body.officers || []) {
      const dbCount = Number((await q(`SELECT COUNT(*) c FROM donors WHERE org_id=$1 AND assigned_to=$2 AND deleted_at IS NULL`, [ORG, o.id]))[0].c);
      ok(`portfolio count for ${o.name} equals the donor table (${dbCount})`, Number(o.portfolio_count) === dbCount, { api: o.portfolio_count, db: dbCount });
    }
  }

  // ── 3. duplicate imports of the same file, in parallel ──
  {
    const donors = Array.from({ length: 20 }, (_, i) => ({ name: `Dup Import ${i}`, email: `dup${i}@c44.local` }));
    const gifts = donors.map((_, i) => ({ donorIndex: i, amount: 100 + i, date: "2023-04-15" }));
    const [r1, r2] = await Promise.all([
      api("POST", "/donors/import-combined", token, { donors, gifts }),
      api("POST", "/donors/import-combined", token, { donors, gifts }),
    ]);
    ok("dup import: both requests succeed", r1.status === 200 && r2.status === 200, [r1.status, r2.status]);
    const dCount = Number((await q(`SELECT COUNT(*) c FROM donors WHERE org_id=$1 AND email LIKE 'dup%@c44.local'`, [ORG]))[0].c);
    const gCount = Number((await q(`SELECT COUNT(*) c FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND d.email LIKE 'dup%@c44.local'`, [ORG]))[0].c);
    ok("dup import: each donor exactly ONCE (advisory lock holds)", dCount === 20, dCount);
    ok("dup import: each gift exactly ONCE", gCount === 20, gCount);
  }

  // ── 4. double-submitted pledge payment ──
  {
    await mkDonor("d_c44_pl", "Pledge Racer");
    const pl = await api("POST", "/donors/d_c44_pl/pledges", token, { amount: 1000, dueDate: "2026-12-01" });
    ok("pledge created", pl.status === 200 || pl.status === 201, pl.body);
    const pid = (await q(`SELECT id FROM pledges WHERE org_id=$1 AND donor_id='d_c44_pl'`, [ORG]))[0].id;
    // BUILD-45 §1.1 (F-3 FIXED): the client mints one idempotency key per
    // form-open — a double-tap replays the SAME key, and uq_gifts_idem at the
    // DB guarantees exactly one gift no matter how the race lands.
    const idemKey = "c44-doubletap-" + Date.now();
    const pay = () => api("POST", "/donors/d_c44_pl/gifts", token, { amount: 400, date: TODAY, type: "one-time", pledgeId: pid, notes: "double-tap", idempotencyKey: idemKey });
    const [p1, p2] = await Promise.all([pay(), pay()]);
    ok("double-tap: both POSTs answered cleanly (one 201, one duplicate)",
      (p1.status === 200 || p1.status === 201) && (p2.status === 200 || p2.status === 201), [p1.status, p2.status]);
    ok("double-tap: exactly one CREATED, the other flagged duplicate",
      [p1, p2].filter(p => p.status === 201).length === 1 &&
      [p1, p2].filter(p => p.status === 200 && p.body && p.body.duplicate === true).length === 1,
      [p1.status, p2.status]);
    const gifts = await q(`SELECT amount FROM gifts WHERE org_id=$1 AND donor_id='d_c44_pl'`, [ORG]);
    const total = Number((await q(`SELECT total_giving FROM donors WHERE id='d_c44_pl'`, []))[0].total_giving);
    const stamps = Number((await q(`SELECT COUNT(*) c FROM fin_transactions WHERE org_id=$1 AND donor_id='d_c44_pl'`, [ORG]))[0].c);
    ok("double-tap: exactly ONE gift recorded (F-3 fixed at the DB)", gifts.length === 1, gifts.length);
    ok("double-tap: donor total moved once ($400)", total === 400, total);
    ok("double-tap: exactly one ledger stamp", stamps === 1, stamps);
    // §1.2 F-5: a $400 payment against the $1,000 pledge leaves it OPEN with
    // an honest $600 balance — applied exactly once despite the race.
    const prow = (await q(`SELECT status FROM pledges WHERE id=$1`, [pid]))[0];
    ok("double-tap: pledge stays OPEN with a partial balance (F-5)", prow.status === "open", prow);
    const paid = Number((await q(`SELECT COALESCE(SUM(amount),0) s FROM gifts WHERE pledge_id=$1`, [pid]))[0].s);
    ok("double-tap: pledge paid exactly $400 once", paid === 400, paid);
  }

  summary();
})().catch(e => { console.error(e); process.exit(1); });
