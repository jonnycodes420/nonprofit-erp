// IDS-1 · Every new id is long enough never to collide.
// Run: node tests/ids1-new-ids.test.js   (boots server.js in-process on MATRIX_PORT)
//
// On 3 Nov a battery hit `duplicate key value violates unique constraint
// "threads_pkey"`: ids were "th_" + uuid().slice(0, 8), and 8 hex characters
// are even odds of a repeat at ~77,000 rows. server/shared/newId.js makes every
// new row id prefix + "_" + 20 hex from crypto.randomBytes.
//
// §1 newId's shape, and 1,000,000 ids with no duplicate.
// §2 FAILS ON MAIN: crypto.randomUUID is pinned so every UUID starts with the
//    same 8 characters, then two threads are opened for two donors. On main the
//    second insert throws threads_pkey (500); with newId it cannot.
// §3 Old ids still work: an email template with a 12-hex id loads, and a
//    widget with an 8-hex id keeps it.
// §4 The arch-check's short-ids rule goes red on a planted uuid().slice(0, 8).

"use strict";

// §2's seam: installed BEFORE server.js loads (db.js takes randomUUID at require
// time). It passes through until PIN is set.
const crypto = require("crypto");
const realUUID = crypto.randomUUID.bind(crypto);
let PIN = null;
crypto.randomUUID = (...a) => { const u = realUUID(...a); return PIN ? PIN + u.slice(8) : u; };

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.MATRIX_PORT || 5698);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
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
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";

const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { newId } = require("../server/shared/newId");

const ROOT = path.join(__dirname, "..");
const O = "org_ids1test";
const EMAIL = "ada.quill@ids1.example";
const sys = "'system:test','test'";
const TABLES = ["threads", "interactions", "tasks", "email_templates", "portal_pages", "donors", "user_sessions", "users"];

async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [O]).catch(() => {});
}

(async () => {
  console.log("ids1-new-ids (IDS-1)");

  // §1 ─────────────────────────────────────────────────────────────────────
  const one = newId("th");
  ok("§1 newId gives the prefix, an underscore and 20 lowercase hex", /^th_[0-9a-f]{20}$/.test(one), one);
  ok("§1 a prefix with an underscore of its own is kept as written", /^task_mp_[0-9a-f]{20}$/.test(newId("task_mp")));
  ok("§1 the separator can be kept as it was (none, for imp_qbo)", /^imp_qbo[0-9a-f]{20}$/.test(newId("imp_qbo", "")));
  const N = 1000000, seen = new Set();
  for (let i = 0; i < N; i++) seen.add(newId("g"));
  ok("§1 1,000,000 ids contain no duplicate", seen.size === N, `${N - seen.size} duplicate(s)`);
  seen.clear();

  // §2 ─────────────────────────────────────────────────────────────────────
  require("../server.js");
  await require("./helpers").untilReady();
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Ids One Trust','ids1-trust',1,'active','team','America/New_York',NOW()) ON CONFLICT (id) DO NOTHING`, [O]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ids1test',$1,$2,$3,'Ada Quill','admin')`, [O, EMAIL, pw]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES
           ('d_ids1_a',$1,'Wren Halloway','wren@ids1.example','active',${sys}),
           ('d_ids1_b',$1,'Otto Brisk','otto@ids1.example','active',${sys})`, [O]);
  const tok = await login(EMAIL);
  ok("§2 the test admin signs in", !!tok);

  PIN = "deadbeef";   // every UUID from here starts with the same 8 characters
  const due = "2031-04-01";
  const a = await api("POST", "/donors/d_ids1_a/threads", tok, { label: "Call to say thank you", due });
  const b = await api("POST", "/donors/d_ids1_b/threads", tok, { label: "Call to say thank you", due });
  PIN = null;
  ok("§2 the first thread opens", a.status === 201, JSON.stringify(a.body).slice(0, 300));
  ok("§2 the second thread opens too, though every UUID began 'deadbeef' (main: 500 threads_pkey)",
    b.status === 201, JSON.stringify(b.body).slice(0, 300));
  const ids = (await q(`SELECT id FROM threads WHERE org_id=$1 ORDER BY id`, [O])).map(r => r.id);
  ok("§2 two threads, each th_ + 20 hex", ids.length === 2 && ids.every(i => /^th_[0-9a-f]{20}$/.test(i)), JSON.stringify(ids));

  // §3 ─────────────────────────────────────────────────────────────────────
  const OLD_ET = "et_0123456789ab";
  await q(`INSERT INTO email_templates (id,org_id,name,purpose,subject,blocks,created_by,created_by_name)
           VALUES ($1,$2,'Spring letter','appeal','Spring at the trust','[]'::jsonb,${sys})`, [OLD_ET, O]);
  const et = await api("GET", `/email-templates/${OLD_ET}/usage`, tok);
  ok("§3 an email template with an old 12-hex id still loads", et.status === 200, JSON.stringify(et.body).slice(0, 200));
  const NEW_ET = newId("et");
  await q(`INSERT INTO email_templates (id,org_id,name,purpose,subject,blocks,created_by,created_by_name)
           VALUES ($1,$2,'Autumn letter','appeal','Autumn at the trust','[]'::jsonb,${sys})`, [NEW_ET, O]);
  const et2 = await api("GET", `/email-templates/${NEW_ET}/usage`, tok);
  ok("§3 …and one with a new 20-hex id loads", et2.status === 200, JSON.stringify(et2.body).slice(0, 200));

  const OLD_WID = "wid_1a2b3c4d", NEW_WID = newId("wid");
  const w = await api("PUT", "/portal-page/draft", tok, { widgets: [
    { id: OLD_WID, type: "richtext", blocks: [] },
    { id: NEW_WID, type: "richtext", blocks: [] },
    { id: "wid_not-an-id", type: "richtext", blocks: [] },
  ] });
  const got = (w.body && w.body.draft || []).map(x => x.id);
  ok("§3 a widget with an old 8-hex id keeps it", w.status === 200 && got[0] === OLD_WID, JSON.stringify(w.body).slice(0, 300));
  ok("§3 a widget with a new 20-hex id keeps it", got[1] === NEW_WID, JSON.stringify(got));
  ok("§3 a widget with a malformed id is given a new 20-hex one", /^wid_[0-9a-f]{20}$/.test(got[2] || ""), JSON.stringify(got));

  // §4 ─────────────────────────────────────────────────────────────────────
  // A tree holding the real baselines and one route with a short id: the
  // short-ids rule must go red and name the file (proven able to fail).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ids1-arch-"));
  try {
    fs.cpSync(path.join(ROOT, "docs", "architecture", "baseline"), path.join(tmp, "docs", "architecture", "baseline"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "routes"));
    const plant = (body) => {
      fs.writeFileSync(path.join(tmp, "routes", "planted.js"), body);
      execFileSync("git", ["init", "-q"], { cwd: tmp });
      execFileSync("git", ["add", "-A"], { cwd: tmp });
      try { return { code: 0, out: execFileSync("node", [path.join(ROOT, "scripts", "ci", "arch-check.js"), "--root", tmp], { encoding: "utf8", stdio: "pipe" }) }; }
      catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; }
    };
    const clean = plant(`const { newId } = require("../server/shared/newId");\nconst id = newId("th");\n`);
    ok("§4 a route that uses newId passes the short-ids rule", clean.code === 0 && /✓ short-ids/.test(clean.out), clean.out);
    const red = plant(`const { randomUUID: uuid } = require("crypto");\nconst id = "th_" + uuid().slice(0, 8);\n`);
    ok("§4 a planted uuid().slice(0, 8) turns short-ids red, naming the file (proven able to fail)",
      red.code === 1 && /✗ short-ids/.test(red.out) && /routes\/planted\.js/.test(red.out), red.out);
    const red2 = plant(`const id = "th_" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);\n`);
    ok("§4 …and so does a dash-stripped UUID cut to 10 hex", red2.code === 1 && /✗ short-ids/.test(red2.out), red2.out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  await reset();
})().catch(e => ok("ids1-new-ids crashed", false, e.stack)).finally(async () => {
  await closeDb().catch(() => {});
  summary();
});
