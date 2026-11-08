#!/usr/bin/env node
// scripts/ops/demo-tidy.js · DEMO-TIDY-1. A CLEAN, BELIEVABLE DEMO BASELINE. JONATHAN RUNS IT.
//
// The QA fleet walks prod in the demo org, and kept tripping over the demo's
// own data, not the product: walk residue (people, saved views, groups,
// journeys, tasks, shifts, events and drafts named "QA …") and on Marlowe, a
// placeholder EIN and a signer nobody is, "General" beside "General
// Operating", no recurring donor, no grant with a report due, one email on two
// people, duplicate pending invites, a campaign "sent to 0". The steps are in
// scripts/ops/demoTidy/steps.js, one per brief item.
// REPAIR-1 added steps 6 to 10 (scripts/ops/demoTidy/repairSteps.js): rows
// written before SENDS-1, STALE-2 and PLEDGES-2 brought up to those rules. It
// also lets an apply that crashed before recording the plan payments finish:
// the missing payments join the run that made their plan.
//
// ONLY A DEMO ORG: it refuses any org whose org_kind is not "demo" or
// "internal_test" (canTidy below; DEMO-TIDY-2, because CREO is internal_test). This is the one script
// allowed to write org_creo, and nothing runs it at deploy.
//
// SAFE BY DEFAULT: the dry run prints every change with counts (demo names
// are made up and fine to print) and writes nothing. --apply makes the changes
// in ONE transaction, with one audit row per change and one for the run. The
// new demo gifts then go through recordGift, the one gift path, as history
// (no thank-you, no journey, nothing sends), so they come after the commit;
// the run's audit row names them. --undo=<run audit id> reverses the run,
// newest change first. A second --apply changes nothing.
//
//   node scripts/ops/demo-tidy.js --org=org_creo                   # dry run
//   node scripts/ops/demo-tidy.js --org=org_creo --apply           # write
//   node scripts/ops/demo-tidy.js --org=org_creo --undo=al_…       # put a run back
//   [--today=YYYY-MM-DD]  the org's day (tests set their clock); [--marlowe=<id>] when two people match
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const { Pool } = require("pg");
const { journal, reverse, rid } = require("./demoTidy/journal");
const { STEPS } = require("./demoTidy/steps");
const { printBaselines } = require("./demoTidy/baselines");

const ACTOR = { id: "system:scripts/ops/demo-tidy", name: "Demo tidy (DEMO-TIDY-1)", kind: "system" };
const PATH = "scripts/ops/demo-tidy.js";
const RUN_ACTION = "demo tidy run";

const audit = (c, row) => c.query(
  `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                              changes, before_fields, after_fields, summary, record_count, request_method, request_path)
   VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,NULL,NULL,$9,$10,'SCRIPT',$11)`,
  [row.id, row.orgId, ACTOR.id, ACTOR.name, ACTOR.kind, row.action, row.entity, JSON.stringify(row.changes), row.summary, row.count || 0, PATH]);

// DEMO-TIDY-2: CREO Arts (Demo), the org Muse walks, is internal_test on purpose,
// so the tidy accepts a demo OR an internal_test org. Every other kind (customer,
// prospect_trial, fixture, not set) is refused. Local on purpose: isDemoOrg stays
// "demo" only, because the mail gate and the console rely on it.
const TIDY_KINDS = new Set(["demo", "internal_test"]);
const canTidy = o => !!o && TIDY_KINDS.has(o.org_kind);

async function demoOrg(c, orgId) {
  const [o] = (await c.query(`SELECT id, name, org_kind, timezone FROM orgs WHERE id = $1`, [orgId])).rows;
  if (!o) throw new Error(`No org ${orgId}.`);
  if (!canTidy(o)) throw new Error(`${orgId} (${o.name}) is not a demo org (org_kind is ${o.org_kind || "not set"}). The tidy runs only on a demo org.`);
  return o;
}

// The app's own gift path, loaded once, in this process, only when a gift is written.
let APP = null;
function appWriters() {
  if (APP) return APP;
  process.env.STEWARD_PROCESS = "web";
  process.env.DISABLE_BACKGROUND_TICKS = "1";
  process.env.RESEND_API_KEY = "re_demo_tidy_sends_nothing";   // nothing this process does can send
  process.env.RESEND_BASE_URL = "http://127.0.0.1:9";
  process.env.PORT = process.env.DEMO_TIDY_PORT || "0";
  // REPAIR-1: the 8 Nov apply on org_creo crashed here ("JWT_SECRET is not
  // set. Steward will not start without it.", auth.js). This process loads the
  // app only to call recordGift: it serves no request and signs nothing a person
  // can use, so a random secret made now and thrown away with the process is
  // enough. It is never printed, and a real one in the environment is kept.
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = require("crypto").randomBytes(48).toString("hex");
  const app = require("../../server.js");
  APP = { recordGift: app.locals.recordGift };
  return APP;
}

async function plan(c, org, opts, log) {
  const ctx = { orgId: org.id, today: opts.today || require("../../orgTime").orgToday(org), now: new Date().toISOString(),
    actor: ACTOR, marlowe: opts.marlowe || null, gifts: [] };
  const sections = [];
  const entries = [];
  for (const [title, fn] of STEPS) {
    const J = journal(c, title);
    const lines = await fn(c, J, ctx);
    sections.push({ title, lines });
    entries.push(...J.entries);
  }
  for (const s of sections) {
    log(`\n${s.title}`);
    log(s.lines.length ? s.lines.map(l => `  · ${l}`).join("\n") : "  · nothing to change");
  }
  return { ctx, entries, changes: entries.length + ctx.gifts.length };
}

async function run({ client: c, orgId, apply = false, today = null, marlowe = null, log = console.log, writers = null }) {
  const org = await demoOrg(c, orgId);
  log(apply ? `MODE: APPLY on ${org.id} (${org.name}): one transaction, one audit row per change\n` : `MODE: DRY RUN on ${org.id} (${org.name}): nothing is written; add --apply\n`);
  await c.query("BEGIN");
  let result;
  try {
    result = await plan(c, org, { today, marlowe }, log);
    if (!apply || !result.changes) { await c.query("ROLLBACK"); }
    else if (!result.entries.length) { await c.query("COMMIT"); }   // REPAIR-1: only payments to record; they join the runs that made their plans
    else {
      const runId = rid("al_");
      const ids = [];
      for (const e of result.entries) {
        const id = rid("al_");
        ids.push(id);
        await audit(c, { id, orgId: org.id, action: `demo tidy: ${e.step}`, entity: e.table || e.op, changes: { run: runId, entry: e },
          summary: `Demo tidy ${e.op}: ${e.label}`, count: (e.rows || e.before || e.ids || [1]).length });
      }
      await audit(c, { id: runId, orgId: org.id, action: RUN_ACTION, entity: "org", changes: { entries: ids, gifts: [] },
        summary: `Demo tidy: ${result.entries.length} changes`, count: result.entries.length });
      await c.query("COMMIT");
      result.runId = runId;
    }
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  log(`\n${result.ctx.gifts.length} demo payment${result.ctx.gifts.length === 1 ? "" : "s"} ${apply ? "to record" : "would be recorded"} through recordGift.`);
  // Each payment joins a run: this one's for a plan it just made, or (REPAIR-1's
  // backfill) the earlier run that made the plan, so that run's --undo takes it out.
  const joined = [];
  if (apply && result.ctx.gifts.length && (result.runId || result.ctx.gifts.every(g => g.run))) {
    const W = writers || appWriters();
    const byRun = new Map();
    for (const g of result.ctx.gifts) { const r = g.run || result.runId; if (!byRun.has(r)) byRun.set(r, []); byRun.get(r).push(g); }
    for (const [runId, gifts] of byRun) {
      const done = [];
      for (const g of gifts) {
        const w = await W.recordGift({ orgId: org.id, donorId: g.donorId, giftId: g.id, amount: g.amount, date: g.date, type: "recurring",
          fundId: g.fundId, paymentMethod: g.method, notes: "Payment on a recurring plan recorded by staff.", recurring: true, applyInstallment: false,
          history: true, alreadyThanked: true, thankYou: false, actorId: ACTOR.id, actorName: ACTOR.name, source: "offline_plan" });
        if (w && w.gift) { await c.query(`UPDATE gifts SET offline_plan_id = $1 WHERE id = $2 AND org_id = $3`, [g.planId, g.id, org.id]); done.push(g.id); }
      }
      const donors = [...new Set(gifts.map(g => g.donorId))];
      const id = rid("al_");
      await audit(c, { id, orgId: org.id, action: "demo tidy: 4 Demo data", entity: "gift", changes: { run: runId, entry: { step: "4 Demo data", op: "gift", ids: done, donors, label: `${done.length} plan payments` } },
        summary: `Demo tidy: ${done.length} recurring plan payments recorded through recordGift`, count: done.length });
      await c.query("BEGIN");
      // The run's row is append-only; a second row says which gift row joined it.
      await audit(c, { id: rid("al_"), orgId: org.id, action: `${RUN_ACTION}: gifts`, entity: "org", changes: { run: runId, entries: [id] },
        summary: `Demo tidy run ${runId}: ${done.length} payments recorded`, count: done.length });
      await c.query("COMMIT");
      log(`${done.length} recorded${runId === result.runId ? "" : `, joined to run ${runId}`}.`);
      if (runId !== result.runId) joined.push(runId);
    }
  }
  if (apply) {
    if (result.runId) log(`\nApplied. Run ${result.runId}; undo with --undo=${result.runId}`);
    for (const r of joined) log(`${result.runId ? "" : "\nApplied. "}Payments joined run ${r}; undo them with that run: --undo=${r}`);
    if (!result.runId && !joined.length) log("\nNothing to change.");
  }
  await printBaselines(c, org, log);
  return result;
}

// The gifts recordGift wrote, and what it wrote beside them.
const EXTRA = {
  async gift(c, e) {
    const tables = (await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'gift_id' AND table_name <> 'gifts'`)).rows.map(r => r.table_name);
    for (const t of tables) await c.query(`DELETE FROM "${t}" WHERE gift_id = ANY($1::text[])`, [e.ids]).catch(() => {});
    await c.query(`DELETE FROM gifts WHERE id = ANY($1::text[])`, [e.ids]);
  },
  async fund_merge(c, e) {
    const [m] = (await c.query(`SELECT * FROM fund_merges WHERE id = $1`, [e.mergeId])).rows;
    if (!m || m.undone_at) return;
    const pg = s => { let i = 0; return s.replace(/\?/g, () => "$" + (++i)); };
    await require("../../server/finance/fundMerge").undoInTx(c, m.org_id, m, ACTOR,
      { queryTx: async (cl, s, a) => (await cl.query(pg(s), a)).rows, runTx: async (cl, s, a) => ({ changes: (await cl.query(pg(s), a)).rowCount }) });
  },
};

async function undo({ client: c, orgId, runId, log = console.log }) {
  await demoOrg(c, orgId);
  const [r] = (await c.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND org_id = $2 AND user_id = $3 AND action = $4`, [runId, orgId, ACTOR.id, RUN_ACTION])).rows;
  if (!r) throw new Error(`No demo tidy run ${runId} on ${orgId}.`);
  const [done] = (await c.query(`SELECT 1 FROM fin_audit_log WHERE org_id = $1 AND user_id = $2 AND action = 'demo tidy undo' AND changes->>'undoes' = $3`, [orgId, ACTOR.id, runId])).rows;
  if (done) throw new Error(`Run ${runId} was already undone.`);
  const rows = (await c.query(`SELECT id, changes FROM fin_audit_log WHERE org_id = $1 AND user_id = $2 AND action LIKE 'demo tidy: %' AND changes->>'run' = $3 ORDER BY created_at, id`, [orgId, ACTOR.id, runId])).rows;
  const ch = typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes;
  const order = new Map((ch.entries || []).map((id, i) => [id, i]));
  const parse = x => ({ id: x.id, e: (typeof x.changes === "string" ? JSON.parse(x.changes) : x.changes).entry });
  const all = rows.map(parse);
  const entries = all.map(x => x.e);
  // Newest first: the gifts (written after the commit), then the entries in
  // reverse of the order the run's row lists them (one transaction shares one clock).
  const gifts = all.filter(x => x.e.op === "gift").map(x => x.e);
  const rest = all.filter(x => x.e.op !== "gift").sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(x => x.e);
  await c.query("BEGIN");
  try {
    for (const e of [...gifts, ...rest.reverse()]) { await reverse(c, e, EXTRA); log(`  · undone: ${e.label}`); }
    await audit(c, { id: rid("al_"), orgId, action: "demo tidy undo", entity: "org", changes: { undoes: runId }, summary: `Demo tidy run ${runId} undone`, count: entries.length });
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  log(`\nRun ${runId} undone: ${entries.length} changes put back.`);
  return { count: entries.length };
}

async function main(argv = process.argv) {
  const arg = k => (argv.find(a => a.startsWith(`--${k}=`)) || "").slice(k.length + 3) || null;
  const orgId = arg("org");
  if (!orgId) throw new Error("Name the demo org: --org=org_creo");
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    if (arg("undo")) await undo({ client, orgId, runId: arg("undo") });
    else await run({ client, orgId, apply: argv.includes("--apply"), today: arg("today"), marlowe: arg("marlowe") });
  } finally { client.release(); await pool.end(); }
  if (APP) process.exit(0);   // the app loaded for recordGift keeps its own handles open
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { run, undo, ACTOR, RUN_ACTION };
