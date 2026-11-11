// tests/stage1-staging.test.js · STAGE-1. STAGING FIRST, AND ONLY A SUPER-ADMIN SHIPS.
//
// Guards security (who can put a commit in front of customers) and email
// (staging never reaches a real inbox). What would make each section fail:
//   §1 the door: a staff user or an org admin reaching Ship or Roll back
//      (opsOnly dropped from a route)                             → 404 becomes 200/409
//   §2 a press that ships while staging is not set up or not green
//      (the server trusting the page instead of re-reading)       → 202 instead of 409
//   §3 the rule: a red, walking or moving staging that may ship   → canShip true
//   §4 the lanes: a hotfix label with no written reason skipping staging
//   §5 ci.yml: STAGING_ENABLED unset changing today's deploy, or set and a
//      plain merge still deploying prod                          → the jobs' conditions
//   §6 mail on staging leaving the process, from any Resend client → the fake network sees a call
//   §7 a live Stripe key booting on staging, or its value printed
//   §8 a real name in the staging seed (scan against org_creo's people)
//   §9 the staging frontend's config still pointing at prod's API
//   §10 Roll back's target: the commit prod served before this one
//   §11 STAGE-2 drift: STEWARD_ENV (or any must-have) missing on staging
//       passing, a stray build command passing, or a variable's value printed
//   §12 STAGE-2 deploy-staging: a railway up without --environment staging,
//       or the staging build-env dropped / prod's deploy given it
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const ORG = "org_st1_hq", CUST = "org_st1_cust";
const ORGS = [ORG, CUST];
const PW = "loadtest1234";
const SHA_A = "a".repeat(40), SHA_B = "b".repeat(40), SHA_C = "c".repeat(40);

async function reset() {
  await q(`DELETE FROM user_sessions WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1)`, [ORGS]).catch(() => {});
}

// The `if:` of one job in a workflow file, read as text (no YAML parser in the repo).
function jobIf(yml, job) {
  const start = yml.indexOf(`\n  ${job}:\n`);
  if (start < 0) return null;
  const rest = yml.slice(start + 1);
  const next = rest.slice(3).search(/\n  [a-z][a-z0-9-]*:\n/);
  const block = next < 0 ? rest : rest.slice(0, next + 3);
  const m = /\n    if: ([\s\S]*?)\n    [a-z-]+:/.exec(block);
  return m ? { cond: m[1].replace(/\s*\n\s*/g, " ").trim(), block } : { cond: null, block };
}
// Evaluate a job condition for one push to main with a green battery.
function runs(cond, { staging, lane, vercel = "true" }) {
  if (cond == null) return true;
  const js = cond
    .replace(/always\(\)/g, "true")
    .replace(/github\.event_name == 'push'/g, "true").replace(/github\.ref == 'refs\/heads\/main'/g, "true")
    .replace(/needs\.combine\.result == 'success'/g, "true").replace(/needs\.tree-check\.outputs\.skip == 'true'/g, "false")
    .replace(/needs\.deploy-staging\.result == 'success'/g, "true").replace(/needs\.deploy-staging\.outputs\.deployed == 'true'/g, "true")
    .replace(/vars\.STAGING_ENABLED/g, JSON.stringify(staging)).replace(/needs\.lane\.outputs\.lane/g, JSON.stringify(lane))
    .replace(/vars\.VERCEL_DEPLOY_ENABLED/g, JSON.stringify(vercel))
    .replace(/'/g, '"');
  if (/[a-z]+\.[a-z]/i.test(js.replace(/"[^"]*"/g, ""))) throw new Error(`unread expression left in: ${js}`);
  return Function(`return (${js});`)();
}

(async () => {
  await reset();
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES
           ($1,'Stage HQ','st1-hq',1,'active','team','internal_test'), ($2,'Bramblewood Food Shelf','st1-cust',1,'active','team','customer')`, [ORG, CUST]);
  const user = (id, org, email, role, sup) => q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, hash, id, role, sup]);
  await user("u_st1_super", ORG, "st1-super@t.local", "admin", true);
  await user("u_st1_demoted", ORG, "st1-demoted@t.local", "admin", true);
  await user("u_st1_admin", CUST, "st1-admin@t.local", "admin", false);
  await user("u_st1_staff", CUST, "st1-staff@t.local", "staff", false);
  const sup = await login("st1-super@t.local", PW), demoted = await login("st1-demoted@t.local", PW);
  const admin = await login("st1-admin@t.local", PW), staff = await login("st1-staff@t.local", PW);
  await q(`UPDATE users SET is_super_admin = false WHERE id = 'u_st1_demoted'`);
  await require("../server/admin/shipSources").ensureTables(sql => q(sql, []));
  const shipsBefore = (await q(`SELECT COUNT(*)::int AS n FROM prod_ships`))[0].n;

  console.log("\n§1 · Ship and Roll back are super-admin only: everyone else gets 404");
  for (const [who, tok] of [["signed out", null], ["staff", staff], ["an org admin", admin], ["a demoted super-admin", demoted]]) {
    const g = await api("GET", "/ops/ship", tok);
    const s = await api("POST", "/ops/ship", tok, { sha: SHA_A });
    const r = await api("POST", "/ops/rollback", tok, { sha: SHA_A });
    ok(`${who}: GET /ops/ship, POST /ops/ship and POST /ops/rollback are all 404`, g.status === 404 && s.status === 404 && r.status === 404, [g.status, s.status, r.status]);
  }

  console.log("\n§2 · a super-admin sees the card; a press is re-checked on the server");
  const card = await api("GET", "/ops/ship", sup);
  ok("a super-admin gets the card", card.status === 200 && card.body && "canShip" in card.body, card.status);
  ok("with no staging configured, Ship is off and says why", card.body && card.body.canShip === false && /not set up/i.test(card.body.shipReason || ""), card.body && card.body.shipReason);
  const press = await api("POST", "/ops/ship", sup, { sha: SHA_A });
  ok("pressing Ship anyway is refused (409), nothing dispatched", press.status === 409 && press.body.error === "not_now", [press.status, press.body]);
  const bad = await api("POST", "/ops/ship", sup, { sha: "main" });
  ok("a press must name a full commit", bad.status === 400, bad.status);
  const back = await api("POST", "/ops/rollback", sup, { sha: SHA_A });
  ok("Roll back with no known previous commit is refused (409)", back.status === 409, [back.status, back.body]);
  ok("no ship row was written by any of it", (await q(`SELECT COUNT(*)::int AS n FROM prod_ships`))[0].n === shipsBefore);
  const health = await api("GET", "/health");
  ok("/health says this copy is production (STEWARD_ENV unset)", health.body && health.body.env === "production", health.body && health.body.env);

  console.log("\n§3 · the rule: Ship only on a still, green staging that is ahead of prod");
  const { decide } = require("../server/admin/shipSources");
  const green = { configured: true, env: "staging", web: SHA_B, worker: SHA_B, frontend: SHA_B };
  const base = { prodSha: SHA_A, staging: green, pending: { ahead: 2 }, walk: { state: "success" }, inFlight: null, ship: null, previous: SHA_C };
  const cases = [
    ["green, still and ahead", {}, true, null],
    ["the walk failed", { walk: { state: "failure", says: "1 of 9 failed. First: 4 record a gift" } }, false, /walk on bbbbbbb failed: 1 of 9 failed/],
    ["the walk is still running", { walk: { state: "pending" } }, false, /has not finished/],
    ["no walk at all", { walk: null }, false, /has not finished/],
    ["a merge is deploying to staging", { inFlight: { sha: SHA_C } }, false, /mid-deploy \(ccccccc\)/],
    ["web and worker on different commits", { staging: { ...green, worker: SHA_C } }, false, /mid-deploy: web bbbbbbb, worker ccccccc/],
    ["staging's API says production", { staging: { ...green, env: "production" } }, false, /does not say it is staging/],
    ["staging is what prod has", { prodSha: SHA_B }, false, /Nothing to ship/],
    ["a ship is already running", { ship: { status: "in_progress", title: "Ship bbbb" } }, false, /ship is running/],
    ["staging is unreachable", { staging: { ...green, error: "Staging's API did not answer." } }, false, /did not answer/],
  ];
  for (const [name, change, want, says] of cases) {
    const d = decide({ ...base, ...change });
    ok(`${name}: Ship is ${want ? "on" : "off"}${says ? ", and says why" : ""}`, d.canShip === want && (!says || says.test(d.shipReason || "")), d);
  }
  ok("Roll back is on with a known previous commit, off while a ship runs", decide(base).canRollback === true && decide({ ...base, ship: { status: "queued" } }).canRollback === false);

  console.log("\n§4 · the hotfix lane needs the label AND a written reason");
  const { laneFor } = require("../scripts/ci/deploy-lane");
  ok("label + reason → hotfix", laneFor([{ number: 9, labels: [{ name: "hotfix" }], body: "Fixes receipts.\nHotfix reason: receipts emailed twice since 9am" }]).lane === "hotfix");
  const noReason = laneFor([{ number: 9, labels: [{ name: "hotfix" }], body: "urgent" }]);
  ok("label without a reason → staging, with a warning", noReason.lane === "staging" && /no "Hotfix reason/.test(noReason.warning || ""), noReason);
  ok("a too-short reason → staging", laneFor([{ number: 9, labels: ["hotfix"], body: "Hotfix reason: fix" }]).lane === "staging");
  ok("no label → staging", laneFor([{ number: 9, labels: [], body: "Hotfix reason: receipts emailed twice since 9am" }]).lane === "staging");

  console.log("\n§5 · ci.yml: unset means today's flow; set means staging first");
  const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const jr = jobIf(yml, "deploy-railway"), jv = jobIf(yml, "deploy-vercel"), js = jobIf(yml, "deploy-staging"), jl = jobIf(yml, "lane"), jw = jobIf(yml, "staging-walk");
  ok("every job is found", jr && jv && js && jl && jw && jr.cond && jv.cond && js.cond && jl.cond);
  const at = (o) => ({ railway: runs(jr.cond, o), vercel: runs(jv.cond, o), staging: runs(js.cond, o) });
  const off = at({ staging: "", lane: "" });
  ok("STAGING_ENABLED unset: prod's Railway and Vercel jobs run on a merge, staging's do not", off.railway && off.vercel && !off.staging && !runs(jl.cond.replace(/github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && /, ""), { staging: "", lane: "" }), off);
  const on = at({ staging: "true", lane: "staging" });
  ok("STAGING_ENABLED true: a plain merge deploys staging and NOT prod", !on.railway && !on.vercel && on.staging, on);
  const hot = at({ staging: "true", lane: "hotfix" });
  ok("STAGING_ENABLED true, hotfix lane: prod deploys too", hot.railway && hot.vercel && hot.staging, hot);
  const lost = at({ staging: "true", lane: "" });
  ok("STAGING_ENABLED true and the lane job died: prod does NOT deploy", !lost.railway && !lost.vercel, lost);
  for (const line of ["railway up --service nonprofit-erp --ci", "node scripts/ci/deploy-turnstile.js --job deploy-railway --live-health https://nonprofit-erp-production.up.railway.app/health",
    "Verify prod is healthy at this commit", "node scripts/ci/prod-ai-smoke.js"])
    ok(`deploy-railway still runs "${line.slice(0, 60)}"`, jr.block.includes(line));
  ok("deploy-vercel still deploys prod with the same command", jv.block.includes(`npx vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" --build-env BUILD_SHA="$GITHUB_SHA"`));
  ok("the walk writes the staging/walk status Ship reads", jw.block.includes("context=staging/walk") && js.block.includes("context=staging/walk"));
  const ship = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ship.yml"), "utf8");
  ok("ship.yml checks staging serves the commit and its walk passed before it deploys",
    /\[ "\$web" = "\$SHIP_SHA" \]/.test(ship) && /select\(\.context=="staging\/walk"\)/.test(ship) && ship.indexOf("Check the commit may go out") < ship.indexOf("Deploy prod's web"));

  console.log("\n§6 · on staging every email lands in the capture sink, from any Resend client");
  const S = require("../server/shared/stagingEnv");
  const real = []; const fakeNet = async (u) => { real.push(String(u.url || u)); return new Response("{}", { status: 200 }); };
  const savedFetch = globalThis.fetch, savedEnv = process.env.STEWARD_ENV;
  process.env.STEWARD_ENV = "staging";
  globalThis.fetch = S.wrapFetch(fakeNet);
  const subject = `STAGE-1 capture ${Math.random().toString(36).slice(2)}`;
  let sent, batch, mbox, other;
  try {
    const { Resend } = require("resend");
    const client = new Resend("re_looks_real_but_staging");
    sent = await client.emails.send({ from: "Harborlight <hello@harborlight.demo>", to: ["a.real.person@gmail.com"], subject, html: "<p>Thank you</p>" });
    batch = await client.batch.send([{ from: "x@harborlight.demo", to: "b@yahoo.com", subject: subject + " b1", text: "1" }, { from: "x@harborlight.demo", to: "c@yahoo.com", subject: subject + " b2", text: "2" }]);
    mbox = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: "{}" });
    other = await fetch("https://example.org/ping");
  } finally { globalThis.fetch = savedFetch; if (savedEnv == null) delete process.env.STEWARD_ENV; else process.env.STEWARD_ENV = savedEnv; }
  ok("a send answers like Resend (an id, no error)", sent && !sent.error && sent.data && /^cap_/.test(sent.data.id), sent);
  ok("a batch send answers with an id per message", batch && !batch.error && batch.data && batch.data.data && batch.data.data.length === 2, batch);
  const caught = await q(`SELECT to_addresses, subject, via FROM staging_mail_capture WHERE subject LIKE $1 ORDER BY subject`, [subject + "%"]);
  ok("all three messages are in staging_mail_capture, with their recipients", caught.length === 3 && caught[0].to_addresses === "a.real.person@gmail.com", caught);
  ok("a send through a connected Gmail is refused, not sent", mbox.status === 403);
  ok("NOTHING reached the network but the one unrelated call", real.length === 1 && real[0] === "https://example.org/ping", real);
  ok("with STEWARD_ENV unset, install() does nothing", S.install() === false && S.envName({}) === "production");
  await q(`DELETE FROM staging_mail_capture WHERE subject LIKE $1`, [subject + "%"]);

  console.log("\n§7 · a live Stripe key stops a staging boot, and its value is never printed");
  const boot = env => spawnSync(process.execPath, ["-e", "require('./server/shared/stagingEnv').install()"], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  const live = boot({ STEWARD_ENV: "staging", STRIPE_SECRET_KEY: "sk_live_" + "Zq9".repeat(8) });
  ok("sk_live_ on staging: exit 1, naming the variable", live.status === 1 && /STRIPE_SECRET_KEY/.test(live.stderr), [live.status, live.stderr]);
  ok("…and never the key", !/Zq9Zq9/.test(live.stdout + live.stderr));
  const test = boot({ STEWARD_ENV: "staging", STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_BILLING_SECRET_KEY: "sk_test_def" });
  ok("test keys on staging boot", test.status === 0, [test.status, test.stderr]);
  const prod = boot({ STRIPE_SECRET_KEY: "sk_live_" + "Zq9".repeat(8) });
  ok("prod (STEWARD_ENV unset) is untouched by the rule", prod.status === 0, [prod.status, prod.stderr]);

  console.log("\n§8 · the staging seed holds no real name (scan against org_creo)");
  const SEED = require("../scripts/ops/staging-seed");
  const creoNames = (await q(`SELECT name FROM donors WHERE org_id = 'org_creo'`)).map(r => r.name);
  ok("org_creo has people to scan against", creoNames.length > 0, creoNames.length);
  const XLSX = require(path.join(ROOT, "client", "node_modules", "xlsx"));
  const R = await import("../shared/sheetRead.js");
  const fixturePeople = [];
  for (const f of SEED.FIXTURE_FILES) {
    for (const sh of R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "import", "real-shaped", f)), { type: "buffer", cellDates: true }), XLSX))
      for (const row of sh.grid) for (const cell of row) if (typeof cell === "string" && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(cell.trim())) fixturePeople.push({ name: cell.trim(), org_id: "fixtures" });
  }
  const seedPeople = [...SEED.WALK_PEOPLE.map(name => ({ name, org_id: "walk" })), ...fixturePeople];
  ok("the fixture files give names to scan", fixturePeople.length > 50, fixturePeople.length);
  const fiction = SEED.bootSeedFiction();
  ok("org_creo on this database is the boot seed's own fiction", creoNames.every(n => !/\s/.test(n) || fiction.has(n.trim().replace(/\s+/g, " ").toLowerCase())), creoNames.filter(n => !fiction.has(n.toLowerCase())).slice(0, 3));
  const hits = SEED.scanNames(seedPeople, { creoNames, customerNames: ["Bramblewood Food Shelf"], fiction });
  ok("no walk person and no fixture name is an org_creo person or a customer org", hits.length === 0, hits.slice(0, 5));
  const realOne = "Thaddeus Wrenfield";   // stands for a real CREO donor copied onto staging
  const planted = SEED.scanNames([{ name: realOne, org_id: "walk" }, { name: "Bramblewood Food Shelf", org_id: "fixtures" }],
    { creoNames: [...creoNames, realOne], customerNames: ["Bramblewood Food Shelf"], strayOrgs: [{ id: "org_x", name: "A customer" }], fiction });
  ok("the scan catches real CREO data on staging, a person with that name, a customer name and a stray org", planted.length === 4, planted);

  console.log("\n§9 · the staging frontend never calls prod's API");
  const { stagingConfig } = require("../scripts/ci/vercel-staging-config");
  const cfg = stagingConfig(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"), "https://web-staging.up.railway.app");
  ok("no prod API host is left in the staging config", !/nonprofit-erp-production|api\.stewardapp\.dev/.test(cfg));
  const parsed = JSON.parse(cfg);
  ok("the portal and unsubscribe rewrites go to staging", parsed.rewrites.filter(r => /^https:/.test(r.destination)).every(r => r.destination.startsWith("https://web-staging.up.railway.app/")), parsed.rewrites.length);
  let threw = false; try { stagingConfig("{}", "https://nonprofit-erp-production.up.railway.app"); } catch { threw = true; }
  ok("prod's API as staging's is refused", threw);

  console.log("\n§10 · Roll back's target is the commit prod served before this one");
  const SHIP = require("../server/admin/shipSources");
  const qq = (sql, args) => { let i = 0; return q(sql.replace(/\?/g, () => `$${++i}`), args); };
  await qq(`DELETE FROM deploy_history`, []);
  for (const s of [SHA_A, SHA_B, SHA_B]) await SHIP.noteBoot({ run: qq, sha: s });
  ok("two boots on one commit are one row", (await qq(`SELECT COUNT(*)::int AS n FROM deploy_history`, []))[0].n === 2);
  ok("on B, the previous is A", await SHIP.previousSha({ run: qq, query: qq, current: SHA_B }) === SHA_A);
  await SHIP.noteBoot({ run: qq, sha: SHA_A });
  ok("after rolling back to A, the previous is B (Roll back undoes the roll back)", await SHIP.previousSha({ run: qq, query: qq, current: SHA_A }) === SHA_B);
  await qq(`DELETE FROM deploy_history`, []);

  console.log("\n§11 · drift between prod and staging is caught, by name only (STAGE-2)");
  {
    const D = require("../scripts/ci/railway-drift");
    const SECRET = "sk_test_PLANTED_" + Math.random().toString(36).slice(2);
    const names = (...n) => n;
    const PROD_WEB = names("DATABASE_URL", "JWT_SECRET", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "CORS_ORIGIN", "SENTRY_DSN", "GOOGLE_CLIENT_ID", "OPS_SHIP_TOKEN", "DATABASE_PUBLIC_URL");
    const PROD_WORKER = names("DATABASE_URL", "JWT_SECRET", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "CORS_ORIGIN", "SENTRY_DSN");
    const STG_WEB = names("DATABASE_URL", "JWT_SECRET", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "CORS_ORIGIN", "STEWARD_ENV", "STEWARD_PROCESS", "DATABASE_PUBLIC_URL");
    const STG_WORKER = names("DATABASE_URL", "JWT_SECRET", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "CORS_ORIGIN", "STEWARD_ENV", "STEWARD_PROCESS");
    const envOf = (name, svcs) => ({
      name,
      serviceInstances: { edges: svcs.map(x => ({ node: { serviceId: name + x.n, serviceName: x.n, buildCommand: x.build ?? null, startCommand: x.start ?? null } })) },
      // The fake answers with a value on every variable, as if Railway leaked one: none may reach the output.
      variables: { edges: [...svcs.flatMap(x => x.vars.map(v => ({ node: { name: v, serviceId: name + x.n, value: SECRET } }))),
        { node: { name: "ORPHAN_SHARED", serviceId: null, value: SECRET } }] },
    });
    let world, healthEnv, seen = [];
    const fake = require("http").createServer((req, res) => {
      let body = ""; req.on("data", c => (body += c)).on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return res.end(JSON.stringify({ product: "steward", env: healthEnv, note: SECRET }));
        seen.push(body);
        const tok = req.headers["project-access-token"];
        const which = tok === "tok-prod" ? "prod" : tok === "tok-staging" ? "staging" : null;
        if (!which) return res.end(JSON.stringify({ errors: [{ message: "Not Authorized" }] }));
        const q = JSON.parse(body).query;
        if (/projectToken/.test(q)) return res.end(JSON.stringify({ data: { projectToken: { projectId: "p1", environmentId: which } } }));
        return res.end(JSON.stringify({ data: { environment: world[which] } }));
      });
    });
    await new Promise(r => fake.listen(0, "127.0.0.1", r));
    const port = fake.address().port;
    const fresh = () => ({
      prod: envOf("production", [{ n: "nonprofit-erp", start: "node server.js", vars: [...PROD_WEB] }, { n: "steward-worker", start: "node worker.js", vars: [...PROD_WORKER] }]),
      staging: envOf("staging", [{ n: "web", start: "node server.js", vars: [...STG_WEB] }, { n: "worker", start: "node server.js", vars: [...STG_WORKER] }]),
    });
    const run = async (mutate, extra = {}) => {
      world = fresh(); healthEnv = "staging"; seen = [];
      if (mutate) mutate(world);
      const lines = [];
      const code = await D.main({ RAILWAY_API_URL: `http://127.0.0.1:${port}/graphql/v2`, RAILWAY_PROD_TOKEN: "tok-prod", RAILWAY_STAGING_TOKEN: "tok-staging",
        STAGING_API_URL: `http://127.0.0.1:${port}`, ...extra }, l => lines.push(String(l)));
      return { code, out: lines.join("\n"), seen: seen.join("\n") };
    };
    const dropVar = (w, svc, v) => { w.staging.variables.edges = w.staging.variables.edges.filter(e => !(e.node.serviceId === "staging" + svc && e.node.name === v)); };
    const outs = [];
    try {
      const clean = await run();
      outs.push(clean);
      ok("staging matching prod (less the allowlist), worker on node server.js + STEWARD_PROCESS: no drift", clean.code === 0 && /No drift/.test(clean.out), clean.out);
      const noEnv = await run(w => { dropVar(w, "web", "STEWARD_ENV"); dropVar(w, "worker", "STEWARD_ENV"); });
      outs.push(noEnv);
      ok("STEWARD_ENV missing on staging fails, on web and worker", noEnv.code === 1 && /web .*staging must have STEWARD_ENV/.test(noEnv.out) && /worker .*staging must have STEWARD_ENV/.test(noEnv.out), noEnv.out);
      for (const v of ["DATABASE_URL", "CORS_ORIGIN", "RESEND_API_KEY"]) {
        const r = await run(w => dropVar(w, "worker", v)); outs.push(r);
        ok(`${v} missing on staging worker fails`, r.code === 1 && new RegExp(`worker .*${v}`).test(r.out), r.out);
      }
      const noPub = await run(w => dropVar(w, "web", "DATABASE_PUBLIC_URL")); outs.push(noPub);
      ok("DATABASE_PUBLIC_URL missing on staging web fails", noPub.code === 1 && /staging must have DATABASE_PUBLIC_URL/.test(noPub.out), noPub.out);
      const stray = await run(w => { w.staging.serviceInstances.edges[0].node.buildCommand = "npm run build"; }); outs.push(stray);
      ok("a stray build command on staging web fails, naming both sides", stray.code === 1 && /web .*build command differs: prod \(none\), staging "npm run build"/.test(stray.out), stray.out);
      const lost = await run(w => dropVar(w, "web", "STRIPE_SECRET_KEY")); outs.push(lost);
      ok("a name prod has and staging lacks fails (not in the allowlist)", lost.code === 1 && /prod has STRIPE_SECRET_KEY, staging does not/.test(lost.out), lost.out);
      ok("…and the allowlisted ones (SENTRY_DSN, GOOGLE_*, OPS_SHIP_TOKEN) don't", !/SENTRY_DSN|GOOGLE_CLIENT_ID|OPS_SHIP_TOKEN/.test(lost.out));
      const wstart = await run(w => { w.staging.variables.edges = w.staging.variables.edges.filter(e => !(e.node.serviceId === "stagingworker" && e.node.name === "STEWARD_PROCESS")); }); outs.push(wstart);
      ok("staging worker on node server.js WITHOUT STEWARD_PROCESS is a start-command drift", wstart.code === 1 && /worker .*start command differs/.test(wstart.out), wstart.out);
      const saysProd = await run(() => { healthEnv = "production"; }); outs.push(saysProd);
      ok("staging web's /health saying production fails (STEWARD_ENV's value)", saysProd.code === 1 && /says env "production"/.test(saysProd.out), saysProd.out);
      const refused = await run(null, { RAILWAY_STAGING_TOKEN: "tok-wrong" }); outs.push(refused);
      ok("a token that can't read the settings stops with exit 2 and says so", refused.code === 2 && /COULD NOT READ/.test(refused.out), refused.out);
      ok("the planted secret value appears in NO output", outs.every(o => !o.out.includes(SECRET)), outs.map(o => o.code));
      ok("no query asks for a value or the values-returning variables(...) root field",
        outs.every(o => !/\bvalue\b/.test(o.seen) && !/variables\s*\(\s*(projectId|environmentId|serviceId)/.test(o.seen)));
      const allow = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/ci/drift-allow.json"), "utf8"));
      ok("every allowlist entry carries a reason", allow.length > 0 && allow.every(e => e.name && String(e.reason || "").trim().length > 10));
      ok("the must-haves are never allowlisted", !allow.some(e => ["STEWARD_ENV", "DATABASE_URL", "CORS_ORIGIN", "RESEND_API_KEY", "DATABASE_PUBLIC_URL"].includes(e.name)));
    } finally { fake.close(); }
    const yml2 = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const jd = jobIf(yml2, "drift");
    ok("ci.yml's drift job runs on push to main, through drift.yml, and no job needs it",
      jd && /github\.event_name == 'push'/.test(jd.cond) && /uses: \.\/\.github\/workflows\/drift\.yml/.test(jd.block) && !/needs:[^\n]*\bdrift\b/.test(yml2));
    const dy = fs.readFileSync(path.join(ROOT, ".github", "workflows", "drift.yml"), "utf8");
    ok("drift.yml runs nightly, reads prod with RAILWAY_TOKEN and staging with RAILWAY_STAGING_TOKEN, and doesn't swallow a failure",
      /schedule:/.test(dy) && /RAILWAY_PROD_TOKEN: \$\{\{ secrets\.RAILWAY_TOKEN \}\}/.test(dy) && /RAILWAY_STAGING_TOKEN: \$\{\{ secrets\.RAILWAY_STAGING_TOKEN \}\}/.test(dy) && !/continue-on-error/.test(dy));
  }

  console.log("\n§12 · deploy-staging names staging and builds the staging strip (STAGE-2)");
  {
    const y = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const st = jobIf(y, "deploy-staging").block, pv = jobIf(y, "deploy-vercel").block, pr = jobIf(y, "deploy-railway").block;
    const ups = st.split("\n").filter(l => /^\s*railway up /.test(l));
    ok("both railway up lines in deploy-staging carry --environment staging", ups.length === 2 && ups.every(l => /--environment staging\b/.test(l)), ups);
    ok("staging's frontend is built with VITE_STEWARD_ENV=staging", /--build-env VITE_STEWARD_ENV=staging/.test(st));
    ok("prod's deploys never set VITE_STEWARD_ENV and never name an environment", !/VITE_STEWARD_ENV/.test(pv + pr) && !/--environment/.test(pr));
  }

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
