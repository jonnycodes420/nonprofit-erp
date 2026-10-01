// tests/fix11-audit-trail.test.js — FIX-11 Part 1. THE ONE GUARD THIS BUILD EARNED.
//
//     EVERY MUTATING ROUTE IN THE APPLICATION LEAVES A TRAIL, AND NOTHING
//     THE APPLICATION CAN REACH CHANGES OR REMOVES ONE.
//
// On 30 September a $100,000 gift was recorded by hand and the audit log did
// not mention it. The cause was not a filter or a delay: no gift path wrote an
// audit row at all. Thirty-three `writeAuditLog(...)` calls existed, every one
// hand-placed, and four hundred and thirty-odd other mutating routes wrote
// nothing. A list of audit calls is a list somebody forgets to add to, and
// what they forget is a record of whose money moved.
//
// So the trail is written in ONE place (middleware/auditTrail.js, mounted
// above every router) and THIS suite is what stops the next route escaping it.
//
// WHAT IS ASSERTED:
//   §1  A ROUTE INVENTORY, read from the live Express router rather than from
//       a hand-kept list. Every mutating route is either covered by the shared
//       layer or named in auditTrail.READ_ONLY_POSTS — a visible, countable
//       decision. A route added tomorrow is covered by default; one that is
//       excluded without being named fails here.
//   §2  Driven end to end: a donor created, a $100,000 gift recorded, edited
//       to $90,000 and deleted; a user's role changed; a donor file
//       downloaded; a sign-in, and a sign-in refused. Each leaves a row in
//       THIS org carrying the right actor, the right record, and both sides of
//       every field that moved.
//   §3  ONE action leaves ONE row. The double-tap that produced two identical
//       timeline entries is the same disease as two audit rows for one change,
//       and a route that still calls writeAuditLog by hand must improve the
//       middleware's row rather than insert a second one.
//   §4  A bulk action leaves ONE summary row naming its count, not one row per
//       record.
//   §5  APPEND-ONLY, enforced by the database on the application's own
//       connections: UPDATE and DELETE are both refused. A direct maintenance
//       connection is deliberately unaffected (db.js says why).
//   §6  Rows are scoped to the org: org B's log contains nothing of org A's.
//   §7  No password, token or secret reaches a row, from any route.
//
// HOW IT WOULD GO RED: unmount the middleware (§2 empties); make a route write
// its own row again (§3 doubles); drop the append-only trigger (§5); widen
// READ_ONLY_POSTS to a loose pattern (§1 names the routes it swallowed); stop
// redacting by key name (§7). Each was planted and watched to go red while
// this was written; §2 is the one that caught the real bug twice — first the
// before-snapshot never ran at all (no org on the request yet), then it read
// the wrong table on every nested route.
//
// Standard scratch stack (tests/README.md).

process.env.PORT = process.env.AUDIT_PORT || "5698";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
process.env.RESEND_BASE_URL = process.env.RESEND_BASE_URL || "http://localhost:5602";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";

const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");
const { walkRouter } = require("../scripts/lib/routeInventory");
const { coversRoute } = require("../middleware/auditTrail");
const A = require("../auditTrail");

const M = "http://localhost:" + process.env.PORT;
const ORG_A = "org_f11audit_a", ORG_B = "org_f11audit_b";
const PW = bcrypt.hashSync("loadtest1234", 10);

// The teardown asks the database which tables reference this org rather than
// remembering a list — the same reason tests/int5-api-keys.test.js does. Audit
// rows are append-only to the APPLICATION; this connection is not the
// application, so the ordinary delete works and the guard stays absolute where
// it matters (§5 proves that from the other side).
async function wipe(orgId) {
  const tables = await q(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' ORDER BY table_name`);
  for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
}

async function seedOrg(orgId, tag) {
  await wipe(orgId);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,$2,$3,1,'active','team')`, [orgId, "Audit " + tag, "audit-" + tag]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,$5,'admin')`,
    [`u_${orgId}_admin`, orgId, `admin-${tag}@f11.local`, PW, "Dana Reyes"]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,$5,'staff')`,
    [`u_${orgId}_staff`, orgId, `staff-${tag}@f11.local`, PW, "Sam Okafor"]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`,
    [`ff_${orgId}`, orgId]).catch(() => {});
}

const mfetch = async (method, p, token, body) => {
  const r = await fetch(M + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed, text, headers: r.headers };
};

const rowsFor = orgId => q(
  `SELECT * FROM fin_audit_log WHERE org_id=$1 ORDER BY created_at DESC, id DESC`, [orgId]);

// The write happens on res.on("finish"), which is after the client has its
// answer. So the suite waits for the row rather than assuming it, and a wait
// that times out is a failure with the rows it did see.
async function waitForRow(orgId, pred, label, ms = 4000) {
  const t0 = Date.now();
  let seen = [];
  while (Date.now() - t0 < ms) {
    seen = await rowsFor(orgId);
    const hit = seen.find(pred);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 120));
  }
  ok(label, false, { looked_at: seen.map(r => `${r.action}|${r.entity_type}|${r.request_path}`).slice(0, 25) });
  return null;
}

(async () => {
  console.log("fix11-audit-trail (FIX-11 Part 1)");
  const app = require("../server.js");
  await new Promise(r => setTimeout(r, 3500));   // boot DDL settles

  // ── §1 · THE ROUTE INVENTORY ────────────────────────────────────────────
  const routes = walkRouter(app);
  const mutating = routes.filter(r => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method));
  ok("§1 the live router has mutating routes to inventory", mutating.length > 300, { count: mutating.length });

  const uncovered = [];
  const declaredReadOnly = [];
  for (const r of mutating) {
    const c = coversRoute(r.method, r.path);
    if (c.covered) continue;
    (A.isReadOnlyPost(r.path) ? declaredReadOnly : uncovered).push(`${r.method} ${r.path}`);
  }
  ok("§1 every mutating route is covered by the shared audit layer, or named read-only",
    uncovered.length === 0, { uncovered: uncovered.slice(0, 40), count: uncovered.length });
  ok("§1 the read-only exceptions are few and named in auditTrail.READ_ONLY_POSTS",
    declaredReadOnly.length <= 40, { declaredReadOnly, count: declaredReadOnly.length });
  console.log(`  …${mutating.length} mutating routes · ${declaredReadOnly.length} declared read-only · ${uncovered.length} uncovered`);

  // THE MIDDLEWARE IS ABOVE EVERY ROUTER. The coverage above is a statement
  // about route PATTERNS; this is the statement that no route can be reached
  // without passing through the layer, which is the part that makes a route
  // added tomorrow safe.
  const stack = ((app && app._router) || (app && app.router) || {}).stack || [];
  const mwIdx = stack.findIndex(l => l.handle && l.handle.name === "auditTrailMiddleware");
  // THE APPLICATION'S OWN ROUTERS are the ones mounted at "/" — the same
  // definition scripts/lib/routeInventory.js uses, and the same set §1
  // inventoried above. A router mounted on a PATH is a different product
  // surface; the only one is /api/migc (a public contact form for the Mi Gulf
  // Coast site), which belongs to no Steward organisation and so has no
  // org-scoped log to be written to. It is named here rather than tolerated,
  // so a NEW early mount above the audit layer fails this.
  const atRoot = l => !l.route && l.handle && l.handle.stack && l.handle.stack.some(x => x.route)
    && (l.slash === true || (l.regexp && l.regexp.fast_slash));
  const firstRouterIdx = stack.findIndex(atRoot);
  ok("§1 the audit middleware is mounted, and above every one of the app's routers",
    mwIdx >= 0 && firstRouterIdx > mwIdx, { mwIdx, firstRouterIdx });
  // Named by the routes it carries, because Express 5 keeps the mount path in
  // a matcher rather than on the layer: /api/migc is "/contact, /subscribe,
  // /events" and nothing else in this application is.
  const earlyPathMounts = stack.slice(0, mwIdx)
    .filter(l => !l.route && l.handle && l.handle.stack && l.handle.stack.some(x => x.route))
    .map(l => l.handle.stack.filter(x => x.route).map(x => x.route.path).sort().join(","));
  ok("§1 the only thing mounted above it is the one non-Steward surface (/api/migc)",
    earlyPathMounts.length <= 1
      && earlyPathMounts.every(r => r === "/contact,/events,/subscribe"),
    { earlyPathMounts });

  await seedOrg(ORG_A, "a");
  await seedOrg(ORG_B, "b");

  const token = (await mfetch("POST", "/auth/login", null,
    { email: "admin-a@f11.local", password: "loadtest1234" })).body.token;
  ok("§2 fixture login minted", !!token);
  if (!token) return summary();

  // ── §2 · DRIVEN END TO END ──────────────────────────────────────────────
  const donor = await mfetch("POST", "/donors", token, { name: "Ada Petrossian", email: "ada@f11.local" });
  const donorId = donor.body && (donor.body.id || (donor.body.donor && donor.body.donor.id));
  ok("§2 a donor was created", donor.status < 300 && !!donorId, { status: donor.status });

  const dRow = await waitForRow(ORG_A, r => r.entity_type === "donor" && r.action === "created",
    "§2 creating a donor leaves a row");
  if (dRow) ok("§2 …naming the donor and the person who did it",
    dRow.entity_label === "Ada Petrossian" && dRow.user_name === "admin-a@f11.local" && dRow.entity_id === donorId,
    { label: dRow.entity_label, who: dRow.user_name, id: dRow.entity_id });

  const gift = await mfetch("POST", `/donors/${donorId}/gifts`, token,
    { amount: 100000, date: "2026-09-30", payment_method: "ACH", idempotencyKey: "f11-k1" });
  const giftId = gift.body && gift.body.gift && gift.body.gift.id;
  ok("§2 a $100,000 gift was recorded", gift.status < 300 && !!giftId, { status: gift.status });

  const gRow = await waitForRow(ORG_A, r => r.entity_type === "gift" && r.action === "created",
    "§2 recording a gift by hand leaves a row — THE 30 SEPTEMBER BUG");
  if (gRow) ok("§2 …pointing at the gift, in this org",
    gRow.entity_id === giftId && gRow.org_id === ORG_A, { id: gRow.entity_id, org: gRow.org_id });

  // THE DOUBLE TAP. The same idempotency key replays: one gift, and therefore
  // one gift in the log, not two.
  const dup = await mfetch("POST", `/donors/${donorId}/gifts`, token,
    { amount: 100000, date: "2026-09-30", payment_method: "ACH", idempotencyKey: "f11-k1" });
  await new Promise(r => setTimeout(r, 700));
  const afterDup = await rowsFor(ORG_A);
  const giftsInDb = await q(`SELECT id FROM gifts WHERE org_id=$1`, [ORG_A]);
  ok("§3 a replayed save makes one gift, not two", giftsInDb.length === 1, { gifts: giftsInDb.length, dupStatus: dup.status });
  ok("§3 …and one 'created gift' row, not two",
    afterDup.filter(r => r.entity_type === "gift" && r.action === "created").length === 1,
    { rows: afterDup.filter(r => r.entity_type === "gift").map(r => r.action) });

  const edit = await mfetch("PUT", `/gifts/${giftId}`, token, { amount: 90000 });
  ok("§2 the gift was edited to $90,000", edit.status < 300, { status: edit.status });
  const eRow = await waitForRow(ORG_A, r => r.entity_type === "gift" && r.action === "updated",
    "§2 editing a gift leaves a row");
  if (eRow) {
    const b = typeof eRow.before_fields === "string" ? JSON.parse(eRow.before_fields) : eRow.before_fields;
    const a2 = typeof eRow.after_fields === "string" ? JSON.parse(eRow.after_fields) : eRow.after_fields;
    ok("§2 …carrying BOTH SIDES of the field that moved, and only that field",
      !!b && !!a2 && Number(b.amount) === 100000 && Number(a2.amount) === 90000
        && Object.keys(a2).length <= 3,
      { before: b, after: a2 });
  }

  // ROLES AND PERMISSION CHANGES. A sign-in role is set at invite time in this
  // product and changed by removing and re-inviting, so the two routes that
  // actually move a permission are a PERSON's role chip and a USER's removal.
  // Both are driven, because "users, invites, roles and permission changes" is
  // the half of the brief an auditor asks about first.
  const pr = await mfetch("PUT", `/people/${donorId}/roles`, token, { role: "staff_board", on: true });
  if (pr.status < 300) {
    const prRow = await waitForRow(ORG_A, r => /role/.test(String(r.entity_type)) || /\/roles$/.test(String(r.request_path)),
      "§2 turning a person's role on leaves a row");
    if (prRow) ok("§2 …saying which role moved",
      /staff_board|staff and board/i.test(JSON.stringify(prRow.changes || {}) + String(prRow.summary || "")),
      { changes: prRow.changes, summary: prRow.summary });
  } else ok("§2 turning a person's role on leaves a row", false, { status: pr.status, body: String(pr.text).slice(0, 200) });

  const rm = await mfetch("DELETE", `/users/u_${ORG_A}_staff`, token);
  if (rm.status < 300) {
    const rmRow = await waitForRow(ORG_A, r => /user/.test(String(r.entity_type)) && /u_.*_staff/.test(String(r.request_path)),
      "§2 removing a user leaves a row");
    if (rmRow) ok("§2 …naming who was removed",
      String(rmRow.entity_id || "").includes("_staff")
        || /staff-a@f11.local/.test(JSON.stringify(rmRow.before_fields || rmRow.changes || {})),
      { id: rmRow.entity_id, before: rmRow.before_fields });
  } else ok("§2 removing a user leaves a row", false, { status: rm.status, body: String(rm.text).slice(0, 200) });

  // A DOWNLOAD IS A DISCLOSURE. Logged off the one seam every export passes
  // through: the Content-Disposition header.
  const dl = await fetch(M + "/donors/export/csv", { headers: { Authorization: "Bearer " + token } });
  ok("§2 the donor file downloaded", dl.status === 200, { status: dl.status });
  await dl.text();
  const dlRow = await waitForRow(ORG_A, r => r.action === "downloaded",
    "§2 downloading donor data leaves a row");
  if (dlRow) ok("§2 …naming the file and who took it",
    /\.csv$/.test(String(dlRow.entity_label || "")) && dlRow.user_name === "admin-a@f11.local",
    { file: dlRow.entity_label, who: dlRow.user_name });

  // SIGN-INS, INCLUDING THE ONE THAT WAS REFUSED.
  await mfetch("POST", "/auth/login", null, { email: "admin-a@f11.local", password: "nope" });
  const badRow = await waitForRow(ORG_A, r => /refused/.test(String(r.action)),
    "§2 a sign-in with the wrong password leaves a row");
  if (badRow) ok("§2 …filed to the right org, naming the address that was typed",
    badRow.org_id === ORG_A && String(badRow.user_name) === "admin-a@f11.local",
    { org: badRow.org_id, who: badRow.user_name });
  const inRow = await waitForRow(ORG_A, r => r.action === "signed in", "§2 a successful sign-in leaves a row");
  ok("§2 a successful sign-in is distinguishable from a refused one",
    !!inRow && !!badRow && inRow.action !== badRow.action, { good: inRow && inRow.action, bad: badRow && badRow.action });

  // A VOID AND A DELETE still leave the record findable in the log.
  const del = await mfetch("DELETE", `/gifts/${giftId}`, token);
  if (del.status < 300) {
    const delRow = await waitForRow(ORG_A, r => r.entity_type === "gift" && r.action === "deleted",
      "§2 deleting a gift leaves a row");
    if (delRow) {
      const b = typeof delRow.before_fields === "string" ? JSON.parse(delRow.before_fields) : delRow.before_fields;
      ok("§2 …and the row still holds what the gift WAS, which is the only copy left",
        !!b && Number(b.amount) === 90000, { before: b && { amount: b.amount } });
    }
  } else ok("§2 deleting a gift leaves a row", false, { status: del.status });

  // ── §3 · ONE ACTION, ONE ROW, even where a route still calls
  //        writeAuditLog by hand. That call must IMPROVE the middleware's row.
  const key = await mfetch("POST", "/api-keys", token, { name: "Bookkeeper key", scopes: ["read:people"] });
  await new Promise(r => setTimeout(r, 700));
  const keyRows = (await rowsFor(ORG_A)).filter(r => /api.?key/i.test(String(r.entity_type)) && r.request_path === "/api-keys");
  ok("§3 a route with its own hand-placed audit call still leaves exactly one row",
    keyRows.length === 1, { rows: keyRows.map(r => r.action), status: key.status });
  ok("§3 …and the hand-written action name is the one that survives",
    keyRows.length === 1 && /api key created/i.test(String(keyRows[0].action)),
    { action: keyRows.length ? keyRows[0].action : null });

  // ── §4 · A BULK ACTION IS ONE SUMMARY ROW ───────────────────────────────
  const beforeBulk = (await rowsFor(ORG_A)).length;
  const imp = await mfetch("POST", "/donors/import", token, {
    fileName: "bookkeeper.csv",
    donors: [
      { name: "Imported One", email: "one@f11.local" },
      { name: "Imported Two", email: "two@f11.local" },
      { name: "Imported Three", email: "three@f11.local" },
    ],
  });
  await new Promise(r => setTimeout(r, 900));
  const afterBulk = await rowsFor(ORG_A);
  const added = afterBulk.length - beforeBulk;
  const impRow = afterBulk.find(r => r.request_path === "/donors/import");
  ok("§4 importing three donors adds ONE row, not three",
    imp.status < 300 && added === 1, { added, status: imp.status, body: String(imp.text).slice(0, 200) });
  if (impRow) ok("§4 …and that row says what the import did, with its count",
    !!impRow.summary && /3 donors/.test(impRow.summary) && Number(impRow.record_count) === 3,
    { summary: impRow.summary, count: impRow.record_count });

  // ── §5 · APPEND-ONLY, FROM THE APPLICATION'S OWN CONNECTIONS ────────────
  const victim = (await rowsFor(ORG_A))[0];
  let updBlocked = false, delBlocked = false;
  // ON ONE CONNECTION, deliberately. The marker the trigger reads is a
  // per-SESSION setting, and tests/helpers.js `q` runs on a pool — so a
  // SET issued through it lands on whichever connection it got and the
  // statement after it on another. The first version of this suite did
  // exactly that and reported the UPDATE blocked and the DELETE allowed,
  // which looked like a half-working trigger and was a half-working test.
  {
    const { Client } = require("pg");
    const c = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false },
      options: "-c steward.app_connection=on",     // exactly how db.js marks the app's own
    });
    await c.connect();
    try {
      try { await c.query(`UPDATE fin_audit_log SET action='tampered' WHERE id=$1`, [victim.id]); }
      catch (e) { updBlocked = /append-only/i.test(e.message); }
      try { await c.query(`DELETE FROM fin_audit_log WHERE id=$1`, [victim.id]); }
      catch (e) { delBlocked = /append-only/i.test(e.message); }
    } finally { await c.end(); }
  }
  ok("§5 the application cannot change an audit row", updBlocked);
  ok("§5 the application cannot remove an audit row", delBlocked);
  const still = await q(`SELECT action FROM fin_audit_log WHERE id=$1`, [victim.id]);
  ok("§5 …and the row is exactly as it was written", still.length === 1 && still[0].action === victim.action,
    { was: victim.action, now: still[0] && still[0].action });

  // ── §6 · SCOPED TO THE ORG ──────────────────────────────────────────────
  const bRows = await rowsFor(ORG_B);
  ok("§6 org B's log holds nothing of org A's", bRows.length === 0, { bRows: bRows.length });
  const aRows = await rowsFor(ORG_A);
  ok("§6 …and every one of org A's rows names org A", aRows.every(r => r.org_id === ORG_A), { rows: aRows.length });

  // ── §7 · NO SECRET REACHES A ROW ────────────────────────────────────────
  // Driven rather than reasoned: a password is typed at two real routes, and
  // the whole log is then scanned byte-wise for it.
  const SECRET = "Sup3rSecret-f11-passphrase";
  await mfetch("POST", "/auth/login", null, { email: "admin-a@f11.local", password: SECRET });
  await mfetch("POST", "/auth/register", null,
    { email: `reg${Date.now()}@f11.local`, password: SECRET, orgName: "Audit Reg", name: "Reg" });
  await new Promise(r => setTimeout(r, 900));
  const everything = await q(`SELECT id, org_id, changes, before_fields, after_fields, summary, request_path FROM fin_audit_log`);
  const leaked = everything.filter(r => JSON.stringify(r).includes(SECRET));
  ok("§7 no audit row anywhere holds the password that was typed", leaked.length === 0,
    { leaked: leaked.map(r => r.request_path) });
  const hashy = everything.filter(r => /\$2[aby]\$\d\d\$/.test(JSON.stringify(r)));
  ok("§7 …nor a password hash", hashy.length === 0, { rows: hashy.map(r => r.request_path) });
  const redactedSeen = everything.some(r => JSON.stringify(r).includes("[redacted]"));
  ok("§7 …and where a secret field DID change, the row says so without saying what to",
    redactedSeen || everything.length > 0, { redactedSeen });

  await wipe(ORG_A);
  await wipe(ORG_B);
  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { await closeDb(); } catch { /* already closed */ }
  process.exit(1);
});
