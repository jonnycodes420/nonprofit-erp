// tests/nightly-check.test.js · HARDEN-1 item 5. THE NIGHTLY CHECK READS,
// AND MAILS ONLY JONATHAN, ONLY WHEN SOMETHING IS WRONG.
//
//   §1 static: nightlyCheck.js sends nothing itself (its one way out is
//      deps.opsAlert), and opsAlert sends to FOUNDER_EMAIL and nobody else.
//   §2 the 3:30 AM window is New York's, through both daylight-saving
//      changes, and the night is claimed once however many ticks race for it.
//   §3 a clean org (an import previewed in its own org, a group, an event,
//      someone deleted the right way): every check green, no mail at all.
//   §4 one planted defect per check, each turning THAT check red and sending
//      exactly one alert, to the founder address, with the check's sentence:
//        a. someone deleted by hand is back on the list (deleted_at cleared
//           with the trash row unrestored: FIX-54's shape)
//        b. an import's receipt one cent off its gifts
//        c. a receipt logged as sent through the gate to a person whose
//           Automatic emails switch is off
//        d. the Donors list and Home disagree (an archived person: the list
//           leaves them out, Home's people count keeps them)
//        e. a file previewed in another org first, then imported into a
//           Customer org
//   §5 the job wrote nothing: every table's content is the same before and
//      after a red run (bar the trigger request's own audit row and the
//      alert's hourly mark), and a write inside the check's transaction is
//      refused.
//   §6 nobody but the founder address received anything, ever, in this suite.
//
// Planted defects that turned it red: opsAlert's `to` read from the org's
// staff instead of FOUNDER_EMAIL (§1, §6); the read-only transaction's
// `SET TRANSACTION READ ONLY` and the write refusal removed (§5); each check's
// comparison inverted (§3 red for that check).
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, waitFor } = require("./helpers");

// §2 and §5 load nightlyCheck.js and db.js in this process, against the
// suite's own scratch database and never anything else (db.js reads .env,
// which must not get the chance to supply a DATABASE_URL).
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
process.env.DB_SSL = process.env.DB_SSL || "disable";
if (!/@(localhost|127\.0\.0\.1):5544\//.test(process.env.DATABASE_URL)) { console.error("Refusing to run: DATABASE_URL must be the local scratch Postgres"); process.exit(1); }
const ROOT = path.join(__dirname, "..");
const ORG = "org_nightly_a", ORG2 = "org_nightly_b", HQ = "org_nightly_hq";
const PW = "loadtest1234";
const FOUNDER = String(process.env.FOUNDER_EMAIL || "jonathan@stewardapp.dev").toLowerCase();

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        let j = {}; try { j = JSON.parse(body); } catch { /* not json */ }
        captured.push({ to: [].concat(j.to || [], j.cc || [], j.bcc || []).join(",").toLowerCase(), subject: j.subject || "", html: j.html || "" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.once("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}

async function reset() {
  const tables = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name NOT IN ('orgs','fin_audit_log')`);
  for (let pass = 0; pass < 2; pass++) for (const r of tables) for (const o of [ORG, ORG2, HQ]) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [o]).catch(() => {});
  for (const o of [ORG, ORG2, HQ]) await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
}
async function makeOrg(id, name, kind, email) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ($1,$2,$3,1,'active','team',$4)`,
    [id, name, id.replace(/_/g, "-"), kind]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Nia Check','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PW, 4)]);
  return login(email, PW);
}
async function sheetImport(tok, grid, fileName) {
  const body = { fileName, sheets: [{ name: "Sheet1", grid }] };
  const u = await api("POST", "/sheet-import/understand", tok, body);
  const c = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  let end = null;
  for (let i = 0; i < 400 && c.status === 202; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(c.body.importId)}`, tok);
    if (j.body.status !== "running") { end = j.body; break; }
    await new Promise(r => setTimeout(r, 150));
  }
  return { u, c, end, importId: c.body && c.body.importId };
}

// Each run's nights are its own, so opsAlert's once-an-hour mark (per kind,
// and the kind carries the night) never swallows an alert of a re-run.
let superTok = null, night = 0;
const RUN_TAG = require("crypto").randomBytes(4).toString("hex");
async function runCheck() {
  night++;
  const before = captured.length;
  const r = await api("POST", "/admin/nightly-check/run", superTok, { night: `2031-01-0${night}-${RUN_TAG}`, orgIds: [ORG, ORG2] });
  // the alert is awaited inside the route; give the sink a moment to record it
  if (r.body && r.body.alert && r.body.alert.sent) await waitFor(() => captured.length > before, { timeout: 5000 });
  return { r, body: r.body || {}, mail: captured.slice(before) };
}
const redKeys = b => (b.results || []).filter(x => !x.ok).map(x => x.key);

// Every table's content, as one hash each: the zero-write proof.
async function snapshot() {
  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).map(r => r.table_name);
  const out = {};
  for (const t of tables) {
    const [r] = await q(`SELECT COUNT(*)::int AS n, md5(COALESCE(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) AS h FROM "${t}" x`);
    out[t] = r.n + ":" + r.h;
  }
  return out;
}

async function main() {
  // ── §1 · static ─────────────────────────────────────────────────────────
  const src = fs.readFileSync(path.join(ROOT, "nightlyCheck.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  ok("§1 nightlyCheck.js sends no mail of its own (no Resend, no emails.send)", !/emails\.send|require\(["']resend["']\)|_rawResend|\bresend\b/.test(src));
  ok("§1 its one way out is deps.opsAlert", /deps\.opsAlert\(/.test(src) && (src.match(/opsAlert\(/g) || []).length === 1);
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const ops = server.slice(server.indexOf("async function opsAlert"), server.indexOf("// A 5xx burst."));
  ok("§1 opsAlert sends to FOUNDER_EMAIL and to nobody else", /const to = process\.env\.FOUNDER_EMAIL;/.test(ops)
     && /to, subject:/.test(ops) && !/\bcc\b|\bbcc\b|org_id|donors|users/.test(ops));
  const jobs = fs.readFileSync(path.join(ROOT, "routes/jobs.js"), "utf8");
  ok("§1 scheduled on the queue, off on a test boot, through recordTick",
     /if \(!backgroundTicksDisabled\(\)\) \{\s*every\("runNightlyCheck", 5 \* 60 \* 1000, \(\) => recordTick\("runNightlyCheck"/.test(jobs));
  ok("§1 classified as a job that only reads", !!require("../jobAudit").JOB_READS_ONLY.runNightlyCheck);

  // ── §2 · the window, and once a night ───────────────────────────────────
  const NC = require("../nightlyCheck");
  const w = iso => NC.inWindow(new Date(iso));
  ok("§2 3:30 AM EDT (07:30Z in October) opens it", w("2026-10-27T07:30:00Z").open && w("2026-10-27T07:30:00Z").night === "2026-10-27");
  ok("§2 3:29 AM EDT does not", !w("2026-10-27T07:29:00Z").open);
  ok("§2 after the fall change, 3:30 AM EST is 08:30Z, and 07:30Z (2:30 AM) is closed", w("2026-11-02T08:30:00Z").open && !w("2026-11-02T07:30:00Z").open);
  ok("§2 after the spring change, 3:30 AM EDT is 07:30Z again", w("2027-03-15T07:30:00Z").open && !w("2027-03-15T07:29:00Z").open && !w("2027-03-10T08:29:00Z").open);
  ok("§2 the window closes at 5:00 AM New York", w("2026-10-27T08:59:00Z").open && !w("2026-10-27T09:00:00Z").open);
  ok("§2 midday is outside", (await NC.tick(new Date("2026-10-27T16:00:00Z"))) === "outside the 3:30 AM window");
  // Several instances, one night: the claim lets exactly one run. The runs
  // here have no server to call, so the stub records the attempt only.
  const tries = [];
  NC.configure({ opsAlert: async (...a) => { tries.push(a); return { stub: true }; }, signInternalToken: async () => null });
  const raceAt = new Date("2031-06-10T07:45:00Z");   // 3:45 AM EDT on a night no other run uses
  await q(`DELETE FROM ops_alert_marks WHERE hour_key = 'nightly-check-ran:2031-06-10'`);
  const race = await Promise.all([1, 2, 3, 4].map(() => NC.tick(raceAt).catch(e => "threw " + e.message)));
  ok("§2 four ticks racing for one night: one runs, three say it already ran",
     race.filter(x => /^already ran for 2031-06-10$/.test(x)).length === 3 && race.filter(x => !/^already ran/.test(x)).length === 1, race);
  await q(`DELETE FROM ops_alert_marks WHERE hour_key = 'nightly-check-ran:2031-06-10'`);

  // ── setup ───────────────────────────────────────────────────────────────
  const sink = await startSink();
  if (!sink) { ok("setup: the mail sink is listening on " + SINK_PORT, false); return; }
  await reset();
  const tok = await makeOrg(ORG, "Nightly Check Customer", "customer", "nightly-a@test.local");
  const tok2 = await makeOrg(ORG2, "Nightly Check Other", "internal_test", "nightly-b@test.local");
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ($1,'Nightly HQ','nightly-hq',1,'active','team','internal_test')`, [HQ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_nightly_super',$1,'nightly-super@test.local',$2,'Jonathan','admin',true)`, [HQ, bcrypt.hashSync(PW, 4)]);
  superTok = await login("nightly-super@test.local", PW);

  const grid = [["Date", "Donor", "Email", "Amount", "Memo"]];
  for (let i = 0; i < 12; i++) grid.push([`2026-09-${String(1 + i).padStart(2, "0")}`, `Orla Nightfield${i}`, `orla${i}@nightly.test`, String(40 + i), "Annual fund"]);
  const imp = await sheetImport(tok, grid, "nightly-gifts.csv");
  ok("setup: an import previewed and committed in its own org", imp.end && imp.end.status === "done", JSON.stringify(imp.end || imp.c.body).slice(0, 300));
  const people = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY name`, [ORG]);
  const grp = await api("POST", "/groups", tok, { name: "Nightly regulars", kind: "static" });
  await api("POST", `/groups/${grp.body.id}/members`, tok, { donorIds: people.map(p => p.id) });
  const ev = await api("POST", "/events", tok, { name: "Night market", eventType: "gala", date: "2026-09-20" });
  await api("POST", `/events/${ev.body.id}/attendees`, tok, { donorIds: people.slice(0, 6).map(p => p.id) });
  // someone deleted the right way: off every list, a trash row kept for Undo
  const gone = people[0].id;
  const del = await api("POST", "/donors/bulk-delete", tok, { ids: [gone], count: 1 });
  ok("setup: one person deleted through Delete", del.status === 200 && del.body.deleted === 1, del.status + " " + JSON.stringify(del.body).slice(0, 200));

  // ── §3 · clean ──────────────────────────────────────────────────────────
  const clean = await runCheck();
  ok("§3 the five checks ran", clean.r.status === 200 && (clean.body.results || []).length === 5, clean.r.status + " " + JSON.stringify(clean.body).slice(0, 400));
  ok("§3 every check is green on a clean org", redKeys(clean.body).length === 0, (clean.body.results || []).filter(x => !x.ok));
  await new Promise(r => setTimeout(r, 1500));
  ok("§3 a clean night sends nothing to anyone", clean.mail.length === 0 && clean.body.alert === null, clean.mail.map(m => m.to + " " + m.subject));

  // ── §4 · one defect per check ───────────────────────────────────────────
  async function planted(key, sentence, plant, unplant) {
    await plant();
    const run = await runCheck();
    const reds = redKeys(run.body);
    ok(`§4${key} that defect turns check ${key} red, and only ${key}`, reds.length === 1 && reds[0] === key, reds.length ? run.body.results.filter(x => !x.ok) : run.body);
    ok(`§4${key} exactly one alert, to the founder address`, run.mail.length === 1 && run.mail[0].to === FOUNDER, run.mail.map(m => m.to + " " + m.subject));
    const m = run.mail[0] || {};
    ok(`§4${key} the alert carries the check's sentence`, /Nightly check/.test(m.subject) && sentence.test(m.html), [m.subject, String(m.html).slice(0, 600)]);
    if (unplant) await unplant();
    return run;
  }
  // a · deleted by hand, back on the list without an Undo
  await planted("a", /deleted (person|people) on the Donors list/,
    () => q(`UPDATE donors SET deleted_at=NULL WHERE id=$1`, [gone]),
    () => q(`UPDATE donors SET deleted_at=NOW() WHERE id=$1`, [gone]));
  // b · a receipt one cent off
  await planted("b", /says 12 gifts, \$[\d,.]+; the gifts that carry its id are 12 gifts/,
    () => q(`UPDATE imports SET dollars_created = dollars_created + 0.01 WHERE id=$1`, [imp.importId]),
    () => q(`UPDATE imports SET dollars_created = dollars_created - 0.01 WHERE id=$1`, [imp.importId]));
  // c · an automatic receipt through the gate to someone whose switch is off
  const off = people[1].id;
  await planted("c", /automatic message.*went to 1 person whose Automatic emails switch is off/,
    () => q(`INSERT INTO email_log (id,org_id,recipient_domain,kind,subject,status,gate,donor_ids) VALUES ('eml_nightly_plant',$1,'nightly.test','receipt','Your receipt','sent','auto_email_on',ARRAY[$2])`, [ORG, off]),
    () => q(`DELETE FROM email_log WHERE id='eml_nightly_plant'`));
  // d · archive is not a defect: off the Donors list, still in her file, so Home counts them
  const arch = people[2].id;
  const a = await api("POST", `/donors/${arch}/archive`, tok);
  const archRun = await runCheck();
  ok("§4d archiving someone keeps check d green (the list plus the archived list is Home's count)",
    a.status === 200 && !redKeys(archRun.body).includes("d") && archRun.mail.length === 0, (archRun.body.results || []).filter(x => !x.ok));
  await api("POST", `/donors/${arch}/unarchive`, tok);
  // d · a stale Home: the stored answer she is shown says one more person than the file holds
  await planted("d", /the Donors list says 11, Home says 12/,
    async () => {
      const h = await api("GET", "/org/setup-status", tok);   // she opens Home: the answer is stored
      if (h.status !== 200) throw new Error("setup-status " + h.status);
      const rows = await q(`SELECT key, body FROM org_summary WHERE org_key=$1 AND key LIKE 'setup-status|%'`, [ORG]);
      if (!rows.length) throw new Error("no stored Home answer to make stale");
      for (const r of rows) {
        const b = JSON.parse(r.body);
        for (const it of b.items || []) if (it.key === "donors") it.count = Number(it.count) + 1;
        await q(`UPDATE org_summary SET body=$1 WHERE org_key=$2 AND key=$3`, [JSON.stringify(b), ORG, r.key]);
      }
    },
    () => q(`DELETE FROM org_summary WHERE org_key=$1 AND key LIKE 'setup-status|%'`, [ORG]));
  // e · a file opened in another org first, then imported into the customer
  const grid2 = [["Date", "Donor", "Email", "Amount"], ["2026-09-03", "Pell Crossfile", "pell@nightly.test", "75"], ["2026-09-04", "Ruth Crossfile", "ruth@nightly.test", "80"]];
  await planted("e", /made 2 people and 2 gifts from a file first previewed in Nightly Check Other/,
    async () => {
      const p2 = await api("POST", "/sheet-import/understand", tok2, { fileName: "crossfile.csv", sheets: [{ name: "Sheet1", grid: grid2 }] });
      if (p2.status !== 200) throw new Error("preview in the other org " + p2.status);
      const i2 = await sheetImport(tok, grid2, "crossfile.csv");
      if (!i2.end || i2.end.status !== "done") throw new Error("import " + JSON.stringify(i2.end || i2.c.body).slice(0, 200));
    });

  // ── §5 · zero writes ────────────────────────────────────────────────────
  // A red run (check e is still planted), so the alert path runs too.
  const BOOKKEEPING = new Set(["fin_audit_log", "ops_alert_marks", "rate_limit_hits", "user_sessions", "api_call_log", "tick_log"]);
  // Drift's stored answers cleared first, so the Donors list route the checks
  // call WILL try to store them on the way: that write must be refused.
  await q(`DELETE FROM donor_drift WHERE org_id = ANY($1)`, [[ORG, ORG2]]);
  await q(`DELETE FROM org_summary WHERE org_key = ANY($1)`, [[ORG, ORG2]]).catch(() => {});
  const auditBefore = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log`))[0].n;
  const s0 = await snapshot();
  const red = await runCheck();
  const s1 = await snapshot();
  const changed = Object.keys({ ...s0, ...s1 }).filter(t => s0[t] !== s1[t] && !BOOKKEEPING.has(t));
  ok("§5 a red run (with its alert) changed no table's content", redKeys(red.body).join() === "e" && changed.length === 0, { red: redKeys(red.body), changed });
  const newAudit = await q(`SELECT request_path FROM fin_audit_log ORDER BY created_at DESC LIMIT $1`, [Math.max(0, (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log`))[0].n - auditBefore)]);
  ok("§5 the only audit row added is the trigger request's own", newAudit.every(r => r.request_path === "/admin/nightly-check/run"), newAudit);
  const refused = (red.body.results || []).reduce((n, x) => n + (x.refusedWrites || 0), 0);
  ok("§5 the writes the routes tried on the way (their caches) were refused, and counted", refused >= 1, (red.body.results || []).map(x => [x.key, x.refusedWrites]));
  // a write inside the check's transaction fails, at the database too
  const db = require("../db");
  let refusedHere = null, refusedAtDb = null;
  await db.withReadOnlyTransaction(async (client) => {
    refusedHere = await db.run(`UPDATE orgs SET name=name WHERE id=?`, [ORG]).then(() => "wrote", e => e.code);
  }).catch(e => { refusedHere = "outer " + e.message; });
  await db.withReadOnlyTransaction(async (client) => {
    refusedAtDb = await client.query(`/* not caught by the pattern */ select 1; `).then(() => client.query(`UPDATE orgs SET name=name WHERE id=$1`, [ORG])).then(() => "wrote", e => e.code);
  }).catch(e => { refusedAtDb = "outer " + e.message; });
  ok("§5 a write inside the check is refused before it is sent", refusedHere === "25006", refusedHere);
  ok("§5 and one sent straight to the client fails in the database (read-only transaction)", refusedAtDb === "25006", refusedAtDb);

  // ── §6 · nobody else ────────────────────────────────────────────────────
  const others = captured.filter(c => c.to !== FOUNDER);
  ok("§6 every message in this suite went to the founder address alone", captured.length >= 6 && others.length === 0, others.map(c => c.to + " " + c.subject));
  ok("§6 no donor and no staff address appears on any of them", !captured.some(c => /nightly\.test|test\.local/.test(c.to)));

  await reset();
  sink.close();
}

main().catch(e => { ok("suite ran to the end", false, e.stack || e.message); })
  .finally(async () => { await closeDb().catch(() => {}); summary(); });
