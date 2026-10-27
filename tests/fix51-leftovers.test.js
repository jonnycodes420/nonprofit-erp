// FIX-51 · LEFTOVERS FROM FIX-49 AND GIVE-3.
//   §1 soft credit    a soft or matching credit row changes neither the
//                     profile's This year nor the census's hard-credit line
//                     (donorCreditTotals); it is the Soft credit figure
//   §2 one quiet rule Communications' "Lapsing or lapsed" segment is exactly
//                     the Lapsing people plus the Lapsed people (lapseRule.js),
//                     and the going-quiet suggestion fires only on Lapsing
//   §3 boot order     a boot job waits for the migrations (bootGate.js), and a
//                     fresh database boots, ticks on, with no "does not exist"
//   §4 S3             a put that fails once still lands in S3; a row an
//                     earlier failed put left in Postgres moves to S3 with its
//                     bytes checked; org_creo's row is never touched
// (mail-suppression §10b's race is the await in server.js; its proof is that
// suite run ten times, in the PR.)
// What turns it red, on main: This year and the census hard line count the
// credit row (§1); the segment is Drift's and names nobody with a stored last
// gift (§2); bootGate.js does not exist and the fresh boot logs
// `column o.org_kind does not exist` (§3); one failed put is a Postgres row
// for good and there is no move (§4).
// Runs against a booted server ($BASE) on the scratch database.
"use strict";
const http = require("http");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");

const SEED = crypto.randomBytes(4).toString("hex");
const ORG = `org_f51_${SEED}`;
const EMAIL = `f51-${SEED}@example.org`;
const sys = ["system:test", "test"];
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

async function wipe() {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE 'org_f51_%'`).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE 'org_f51_%'`).catch(() => {});
}

async function fixture() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'FIX-51 Leftovers',$2,1,'active','team','America/New_York',NOW(),false)`, [ORG, `f51-${SEED}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Fix Admin','admin')`,
    [`u_${ORG}`, ORG, EMAIL, bcrypt.hashSync("loadtest1234", 4)]);
  return (await api("POST", "/auth/login", null, { email: EMAIL, password: "loadtest1234" })).body.token;
}
const person = (id, name, email, stage, last) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,last_gift_date,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,$5,'active','["donor"]'::jsonb,$6,$7,$8)`, [id, ORG, name, email, stage, last, ...sys]);
const gift = (id, donor, amount, date, type) => q(
  `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,acknowledgement_sent,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,$5,$6,'check',true,$7,$8)`, [id, ORG, donor, amount, date, type, ...sys]);

async function softCredit(tok, today) {
  const ada = `d_f51_ada_${SEED}`, bo = `d_f51_bo_${SEED}`;
  await person(ada, "Ada Credited", `ada-${SEED}@f51.test`, "steward", null);
  await person(bo, "Bo Giver", `bo-${SEED}@f51.test`, "steward", null);
  await gift(`g_f51_a1_${SEED}`, ada, 100, today, "donation");
  const before = (await api("GET", `/donors/${ada}`, tok)).body;
  const census0 = (await api("GET", `/donors/${ada}/soft-credit`, tok)).body;
  // A soft credit row on her own record, and someone else's gift credited to her.
  await gift(`g_f51_a2_${SEED}`, ada, 40, today, "soft credit");
  await gift(`g_f51_b1_${SEED}`, bo, 250, today, "donation");
  await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,60,'soft_credit',$5,$6)`, [`sc_f51_${SEED}`, ORG, `g_f51_b1_${SEED}`, ada, ...sys])
    .catch(e => ok("§1 soft credit fixture", false, e.message));
  const after = (await api("GET", `/donors/${ada}`, tok)).body;
  const census = (await api("GET", `/donors/${ada}/soft-credit`, tok)).body;
  const ty = f => f && f.figures && f.figures.thisYear && Number(f.figures.thisYear.value);
  ok("§1 This year reads her own gift", ty(before) === 100, before && before.figures && before.figures.thisYear);
  ok("§1 a soft credit row does not change This year", ty(after) === 100, after && after.figures && after.figures.thisYear);
  ok("§1 …and its drawer opens her own gift only",
    after.figures && after.figures.thisYear && after.figures.thisYear.source && await api("GET", `/figures/donor-gifts-between/rows?${new URLSearchParams(after.figures.thisYear.source.params)}`, tok)
      .then(r => (r.body.rows || []).length === 1 && Number(r.body.value) === 100), after.figures && after.figures.thisYear);
  ok("§1 the census hard-credit line is her own giving, before and after", census0.ownGiving === 100 && census.ownGiving === 100, [census0.ownGiving, census.ownGiving]);
  ok("§1 the soft credit is its own figure: the $60 credited to her and her $40 credit row",
    census.giftSoftCredit === 100 && Number(after.figures.softCredit && after.figures.softCredit.value) === 100, [census.giftSoftCredit, after.figures.softCredit]);
  ok("§1 \"with soft credit\" is the two added, and no more", census.hardPlusGiftSoft === 200, census.hardPlusGiftSoft);
}

async function oneQuietRule(tok, today) {
  const L = require("../lapseRule");
  const b = L.bounds(today);
  const ppl = {
    giving:  [`d_f51_giv_${SEED}`, "Gia Giving", addDays(today, -30)],
    lapsing: [`d_f51_lsg_${SEED}`, "Lou Lapsing", addDays(b.lapsingOnOrBefore, -10)],
    edge:    [`d_f51_edg_${SEED}`, "Eve Edge", b.lapsingOnOrBefore],
    lapsed:  [`d_f51_lpd_${SEED}`, "Lee Lapsed", b.lapsedOnOrBefore],
    near:    [`d_f51_nr_${SEED}`, "Nia Nearly", addDays(b.lapsingOnOrBefore, 1)],   // 180+ days, not yet lapsing
  };
  for (const [k, [id, name, last]] of Object.entries(ppl)) {
    await person(id, name, `${k}-${SEED}@f51.test`, k === "lapsing" || k === "near" ? "cultivate" : "steward", last);
    await gift(`g_f51_${k}_${SEED}`, id, 50, last, "donation");
  }
  const aud = (await api("GET", "/communications/audience", tok)).body;
  const seg = (aud.segments || []).find(s => s.id === "lapsed") || {};
  const ids = (seg.rows || []).map(r => r.id).sort();
  const want = [ppl.lapsing[0], ppl.edge[0], ppl.lapsed[0]].sort();
  ok("§2 the segment is named for the rule", seg.label === "Lapsing or lapsed", seg.label);
  ok("§2 the segment is exactly Lapsing plus Lapsed (lapseRule.js), not 180 days", JSON.stringify(ids) === JSON.stringify(want), { ids, want });
  ok("§2 …and its definition says the rule", /9 to 12 months/.test(seg.definition || "") && /12 months/.test(seg.definition || ""), seg.definition);
  const sug = async id => ((await api("GET", `/donors/${id}/move-suggestions`, tok)).body.suggestions || []).map(s => s.signal);
  ok("§2 the going-quiet suggestion fires on a Lapsing donor", (await sug(ppl.lapsing[0])).includes("going_quiet"));
  ok("§2 …and not on one past 180 days who is not yet Lapsing", !(await sug(ppl.near[0])).includes("going_quiet"));
}

async function bootOrder() {
  // A boot job scheduled before the migrations finish waits for them.
  let gate = null;
  try { const p = require.resolve("../bootGate"); delete require.cache[p]; gate = require("../bootGate"); } catch { gate = null; }
  ok("§3 bootGate.js exists", !!gate);
  if (gate) {
    let ran = false;
    gate.afterMigrations(() => { ran = true; }, 0);
    await new Promise(r => setTimeout(r, 60));
    const early = ran;
    gate.markReady();
    await new Promise(r => setTimeout(r, 60));
    ok("§3 a boot job does not run before the migrations finish, and runs after", early === false && ran === true, { early, ran });
  }

  // A fresh database, booted with the background ticks on (the prod boot).
  const db = `steward_f51_fresh_${SEED}`;
  const baseUrl = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
  const url = baseUrl.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);
  await q(`CREATE DATABASE ${db}`);
  const port = await freePort(), dead = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url, PORT: String(port), DISABLE_BACKGROUND_TICKS: "", TEST_MODE: "1",
           RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: `http://localhost:${dead}`, STRIPE_API_BASE: `http://localhost:${dead}`,
           STRIPE_BILLING_API_BASE: `http://localhost:${dead}`, JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", SENTRY_DSN: "",
           PORTAL_ASSETS_S3_ENDPOINT: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  try {
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) { await new Promise(r => setTimeout(r, 1000)); ready = /Database ready/.test(log); }
    ok("§3 the fresh database booted", ready, log.slice(-400));
    // The conversion runs 4 s after the migrations; give every early boot job time.
    await new Promise(r => setTimeout(r, 9000));
    const missing = log.split("\n").filter(l => /does not exist/.test(l));
    ok("§3 a fresh boot logs no missing table or column", missing.length === 0, missing.slice(0, 5));
  } finally {
    child.kill("SIGTERM");
    await new Promise(r => { child.once("exit", r); setTimeout(r, 5000); });
    await q(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [db]).catch(() => {});
    await q(`DROP DATABASE IF EXISTS ${db}`).catch(e => console.error("drop", e.message));
  }
}

async function s3() {
  // A bucket on a local port: it refuses the next `failPuts` PUTs with a 503.
  const objects = new Map(); let failPuts = 0, puts = 0;
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c));
    req.on("end", () => {
      if (req.method === "PUT") {
        puts++;
        if (failPuts > 0) { failPuts--; res.writeHead(503); return res.end("SlowDown"); }
        objects.set(req.url, Buffer.concat(chunks)); res.writeHead(200); return res.end();
      }
      if (req.method === "GET") { const b = objects.get(req.url); if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(b); }
      res.writeHead(204); res.end();
    });
  });
  await new Promise(r => srv.listen(0, r));
  const env = { PORTAL_ASSETS_S3_ENDPOINT: `http://127.0.0.1:${srv.address().port}`, PORTAL_ASSETS_S3_KEY: "f51", PORTAL_ASSETS_S3_SECRET: "f51",
                PORTAL_ASSETS_S3_BUCKET: "f51", PORTAL_ASSETS_S3_URL_STYLE: "path" };
  const saved = {}; for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  const CREO = "org_creo";
  const creoRow = "pa_" + crypto.randomBytes(12).toString("hex");
  try {
    const AS = require("../assetStore");
    failPuts = 1;
    const put = await AS.putThemeAsset({ orgId: ORG, kind: "give_header", contentType: "image/png", buffer: crypto.randomBytes(80), isPublic: true });
    const [row] = await q(`SELECT storage, s3_fallback, data FROM portal_assets WHERE id=$1`, [put.id]);
    ok("§4 a put the bucket refuses once still lands in S3, not Postgres", row && row.storage === "s3" && row.s3_fallback === false && row.data == null, row);

    // A row an earlier failed put left in Postgres, and one in org_creo.
    const bytes = crypto.randomBytes(120);
    const left = "pa_" + crypto.randomBytes(12).toString("hex");
    for (const [id, org] of [[left, ORG], [creoRow, CREO]]) {
      await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data,is_public,s3_fallback)
               VALUES ($1,$2,'logo','image/png',$3,'db',$4,TRUE,TRUE)`, [id, org, bytes.length, bytes.toString("base64")]);
    }
    if (typeof AS.moveFallbackAssetsToS3 !== "function") { ok("§4 the move exists", false); return; }
    failPuts = 3;   // every try of the first pass fails: nothing may change
    const p1 = await AS.moveFallbackAssetsToS3();
    const [still] = await q(`SELECT storage, data FROM portal_assets WHERE id=$1`, [left]);
    ok("§4 a move whose put fails leaves the row exactly as it was", still.storage === "db" && still.data === bytes.toString("base64") && p1.moved === 0, { still: still.storage, p1 });
    const p2 = await AS.moveFallbackAssetsToS3();
    const [moved] = await q(`SELECT storage, s3_key, data, s3_fallback FROM portal_assets WHERE id=$1`, [left]);
    ok("§4 the next pass moves it to S3 and clears the Postgres copy", moved.storage === "s3" && moved.data == null && moved.s3_fallback === false
      && objects.get(`/f51/${moved.s3_key}`) && objects.get(`/f51/${moved.s3_key}`).equals(bytes), { moved, p2 });
    ok("§4 …and it still serves the same bytes at the same id", await AS.getThemeAsset(left).then(a => a && a.buffer.equals(bytes)));
    const [creo] = await q(`SELECT storage, data, s3_fallback FROM portal_assets WHERE id=$1`, [creoRow]);
    ok("§4 org_creo's row is never touched", creo.storage === "db" && creo.s3_fallback === true && !!creo.data && !(p2.orgs || []).includes(CREO), creo.storage);
    ok("§4 the pass says what it moved by kind and day, never a name", p2.moved === 1 && p2.byKind.logo === 1 && /^\d{4}-\d{2}-\d{2}$/.test(p2.oldest || ""), p2);
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await q(`DELETE FROM portal_assets WHERE id=$1`, [creoRow]).catch(() => {});
    srv.close();
  }
}

(async () => {
  console.log(`fix51-leftovers (FIX-51) · seed ${SEED}`);
  try {
    await wipe();
    const tok = await fixture();
    ok("§fixture signed in", !!tok);
    const today = civilToday();
    for (const [name, fn] of [["soft credit", () => softCredit(tok, today)], ["one quiet rule", () => oneQuietRule(tok, today)], ["boot order", bootOrder], ["s3", s3]]) {
      try { await fn(); } catch (e) { ok(`${name} ran to the end`, false, String(e && e.stack || e).slice(0, 400)); }
    }
  } finally {
    await wipe().catch(() => {});
    await closeDb().catch(() => {});
    summary();
  }
})();
