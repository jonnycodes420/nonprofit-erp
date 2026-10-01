// tests/fix11-job-audit.test.js — FIX-11 Part 6 tail. THE ONE GUARD IT EARNED.
//
//     EVERY BACKGROUND JOB EITHER LEAVES A TRAIL OR IS NAMED AS ONE THAT DOES
//     NOT, AND AN ACTION THE AGENT DREW IS LOGGED AS THE AGENT'S WITH THE
//     PERSON WHO APPROVED IT.
//
// Part 1 gave every ROUTE a trail it cannot forget, and its own census named
// the two holes that left:
//
//   · A PERIODIC SWEEP DOES NOT PASS THROUGH EXPRESS. The sweeps that logged
//     called `writeAuditLog` by hand — the same arrangement that left four
//     hundred and thirty-four routes unlogged for a year.
//   · AN ACTION A MODEL DRAFTED AND A PERSON APPROVED was logged as that
//     person's own work. The row was right about who authorised it and silent
//     about the fact a model wrote it, which is the one thing oversight of a
//     model exists to record.
//
// WHAT IS ASSERTED:
//   §1  every job the tick runner actually runs is classified in jobAudit.js,
//       in exactly one of the two lists, read out of routes/jobs.js rather
//       than from a list kept beside it. A job added tomorrow and not
//       classified fails here.
//   §2  a job in NEITHER list is refused rather than run, so forgetting is not
//       a silent option
//   §3  a writing job that reports its orgs leaves one audit row in each of
//       them, naming the job, and a read-only job leaves none
//   §4  every read-only job's entry says WHY it is read-only, so the list
//       cannot become a place to park a job nobody wants to think about
//   §5  an agent-approved action is logged as "Agent, approved by <name>",
//       with the person's name and not their email address
//   §6  an ordinary action by the same person is still logged as theirs, so
//       the agent label is not sprayed over everything
//
// HOW IT WOULD GO RED: add a `recordTick("somethingNew", …)` and not classify
// it (§1); let an unclassified job run (§2); stop writing the per-org rows
// (§3); leave a read-only entry blank (§4); drop agentApproved from the
// overrides (§5); apply it to every agent route (§6). Each was planted.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const fs = require("fs");
const path = require("path");
const JA = require("../jobAudit");
const A = require("../auditTrail");

const ORG = "org_f11job";
const PW = bcrypt.hashSync("loadtest1234", 10);

async function wipe(orgId) {
  const tables = await q(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' ORDER BY table_name`);
  for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
}

(async () => {
  console.log("fix11-job-audit (FIX-11 Part 6 tail)");

  // ── §1 · EVERY JOB THE RUNNER RUNS IS CLASSIFIED ────────────────────────
  // Read out of the source that schedules them, so the list cannot drift from
  // what actually runs.
  const jobsSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "jobs.js"), "utf8");
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const scheduled = [...new Set(
    [...(jobsSrc + serverSrc).matchAll(/recordTick\(\s*"([A-Za-z0-9_]+)"/g)].map(m => m[1]))].sort();
  ok("§1 the tick runner schedules jobs to classify", scheduled.length >= 15, { count: scheduled.length });
  const unclassified = scheduled.filter(n => !JA.jobKind(n));
  ok("§1 every scheduled job is classified in jobAudit.js", unclassified.length === 0,
    { unclassified, hint: "add it to JOB_WRITES and return its orgs, or to JOB_READS_ONLY with the reason" });
  const inBoth = scheduled.filter(n =>
    Object.prototype.hasOwnProperty.call(JA.JOB_WRITES, n) &&
    Object.prototype.hasOwnProperty.call(JA.JOB_READS_ONLY, n));
  ok("§1 …in exactly one of the two lists", inBoth.length === 0, { inBoth });
  console.log(`  …${scheduled.length} scheduled · ${Object.keys(JA.JOB_WRITES).length} declared writing · ${Object.keys(JA.JOB_READS_ONLY).length} declared read-only`);

  // ── §4 · AND THE READ-ONLY LIST SAYS WHY ───────────────────────────────
  const vagueReasons = Object.entries(JA.JOB_READS_ONLY)
    .filter(([, why]) => !why || String(why).trim().length < 15);
  ok("§4 every read-only job says why it is read-only", vagueReasons.length === 0, { vagueReasons });
  const vagueWrites = Object.entries(JA.JOB_WRITES)
    .filter(([, what]) => !what || String(what).trim().length < 15);
  ok("§4 …and every writing job says what it writes", vagueWrites.length === 0, { vagueWrites });

  // ── §2 · AN UNCLASSIFIED JOB IS REFUSED ────────────────────────────────
  // Structural: `recordTick` is not exported, so the refusal is asserted at
  // the one place that decides it. Driving it would mean booting a server with
  // a fabricated job in it.
  ok("§2 an unclassified name has no kind", JA.jobKind("somethingNobodyClassified") === null);
  ok("§2 …and recordTick refuses rather than running it",
    /is not classified in jobAudit\.js/.test(serverSrc) && /throw new Error\(msg\)/.test(serverSrc),
    { found: /is not classified/.test(serverSrc) });
  ok("§2 …before the job's own function is called",
    serverSrc.indexOf("not classified in jobAudit.js") < serverSrc.indexOf("const raw = await fn()"),
    { refusalAt: serverSrc.indexOf("not classified in jobAudit.js"), callAt: serverSrc.indexOf("const raw = await fn()") });

  // ── §3 · A WRITING JOB LEAVES ONE ROW PER ORG ──────────────────────────
  // The shapes `recordTick` reads, asserted on the pure normaliser so the
  // contract between a job and the runner is pinned without scheduling one.
  const asObj = JA.normalizeJobResult({ detail: "4 charged", orgs: ["org_a", "org_b", "org_a"], summary: "4 cards retried", counts: { charged: 4 } });
  ok("§3 a job's orgs are de-duplicated", asObj.orgs.length === 2, { orgs: asObj.orgs });
  ok("§3 …and its summary and counts ride along",
    asObj.summary === "4 cards retried" && asObj.counts.charged === 4, { asObj });
  const asString = JA.normalizeJobResult("nothing to do");
  ok("§3 a job that returns a plain string reports no orgs, which is the old shape unchanged",
    asString.orgs.length === 0 && asString.detail === "nothing to do", { asString });
  ok("§3 …and a job that returns nothing at all is not an error",
    JA.normalizeJobResult(undefined).orgs.length === 0);
  ok("§3 the actor is the job, named so a reader knows no person did it",
    /^Steward \(background job: processDunning\)$/.test(JA.jobActor("processDunning").name)
    && JA.jobActor("processDunning").id === "system:job:processDunning",
    JA.jobActor("processDunning"));
  // And the runner really does write one row per org, read out of the seam.
  ok("§3 recordTick writes a row for each org a writing job reports",
    /for \(const orgId of r\.orgs/.test(serverSrc) && /insertAuditRow/.test(serverSrc));
  ok("§3 …and writes none for a read-only job",
    /if \(kind === "writes" && r\.orgs\.length\)/.test(serverSrc));

  // ── §5 and §6 · THE AGENT IS THE ACTOR, THE PERSON APPROVED IT ─────────
  await wipe(ORG);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Job Audit','job-audit',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,'dana@f11job.local',$3,'Dana Reyes','admin')`, [`u_${ORG}`, ORG, PW]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ($1,$2,'Ada Petrossian','ada@f11job.local')`,
    [`d_${ORG}`, ORG]);

  const approve = A.describeRoute("POST", "/agent/waiting/thank_you/:id/approve");
  ok("§5 an agent-approved route is declared as one", approve.agentApproved === true, { approve });
  const plain = A.describeRoute("POST", "/agent/instructions");
  ok("§6 an instruction the person wrote is NOT", plain.agentApproved === false, { plain });
  const undo = A.describeRoute("POST", "/agent/writes/:id/undo");
  ok("§6 …nor is a person undoing the agent", undo.agentApproved === false, { undo });

  // Driven: the approve route, then read the row's actor back.
  const tok = await login("dana@f11job.local");
  const draftId = "ty_" + Date.now().toString(36);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           VALUES ($1,$2,$3,100,'2026-09-20','cash','u_test','Dana')`, [`g_${ORG}`, ORG, `d_${ORG}`]);
  // The real columns, and NOT swallowed: a fixture that fails silently makes
  // the assertion below look like a product defect. (It did, once.)
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body)
           VALUES ($1,$2,$3,$4,'Thank you so much.')`,
    [draftId, ORG, `d_${ORG}`, `g_${ORG}`]);
  const r = await api("POST", `/agent/waiting/thank_you/${draftId}/approve`, tok, {});
  await new Promise(x => setTimeout(x, 900));
  const rows = await q(
    `SELECT user_name, actor_kind, action, request_path FROM fin_audit_log
      WHERE org_id=$1 ORDER BY created_at DESC`, [ORG]);
  const agentRow = rows.find(x => /\/approve$/.test(String(x.request_path || "")));
  if (agentRow) {
    ok("§5 the row says the Agent did it, and who approved it",
      /^Agent, approved by Dana Reyes$/.test(String(agentRow.user_name)), { row: agentRow });
    ok("§5 …by NAME, not by email address",
      !/@/.test(String(agentRow.user_name)), { who: agentRow.user_name });
    ok("§5 …and its capacity is recorded as the agent's",
      agentRow.actor_kind === "agent", { kind: agentRow.actor_kind });
  } else {
    ok("§5 the row says the Agent did it, and who approved it", false,
      { approveStatus: r.status, approveBody: JSON.stringify(r.body).slice(0, 200), rows: rows.map(x => x.request_path) });
  }

  // The same person, an ordinary action, still theirs.
  await api("POST", "/donors", tok, { name: "Ordinary Person", email: "ord@f11job.local" });
  await new Promise(x => setTimeout(x, 700));
  const after = await q(
    `SELECT user_name, actor_kind, request_path FROM fin_audit_log
      WHERE org_id=$1 AND request_path='/donors' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  ok("§6 an ordinary action by the same person is logged as theirs",
    after.length === 1 && after[0].user_name === "dana@f11job.local" && after[0].actor_kind === "user",
    { row: after[0] });

  await wipe(ORG);
  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { await closeDb(); } catch { /* already closed */ }
  process.exit(1);
});
