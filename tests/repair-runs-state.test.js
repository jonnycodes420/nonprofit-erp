// FIX-30 Part 1 · the "runs" postal-state repair (scripts/repair-runs-state.js).
//
// Before HARDEN-1, an Agent contact update wrote "runs" into a person's postal
// state, and prod still holds those rows, including a real customer's. This
// suite seeds that exact pattern in the undo ledger (agent_writes) beside the
// cases the repair must NOT touch, then drives the script as Jonathan will:
// a dry run changes nothing, --apply restores exactly the right rows with an
// audit row each, a second run finds nothing, and --undo puts them back.
//
// What would make it fail: a repair that restores from the wrong write in a
// chain, overwrites a state a person changed later, writes on a dry run,
// skips the audit row, or crosses into an org it was not given.
const { execFileSync } = require("child_process");
const path = require("path");
const { ok, summary, q, closeDb } = require("./helpers");
const { decide } = require("../scripts/repair-runs-state");

const ORG = "org_fix30runs", OTHER = "org_fix30other";
const SCRIPT = path.join(__dirname, "..", "scripts", "repair-runs-state.js");
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";

function runScript(...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args],
    { env: { ...process.env, DATABASE_URL: DB, DB_SSL: "disable" }, encoding: "utf8" });
}

async function clean() {
  for (const o of [ORG, OTHER]) {
    await q(`DELETE FROM agent_writes WHERE org_id=$1`, [o]);
    await q(`DELETE FROM fin_audit_log WHERE org_id=$1`, [o]);
    await q(`DELETE FROM donors WHERE org_id=$1`, [o]);
    await q(`DELETE FROM orgs WHERE id=$1`, [o]);
  }
}

// One person, the state they have now, and the Agent writes behind it.
async function person(org, id, state) {
  await q(`INSERT INTO donors (id,org_id,name,state,stage,status,tags,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'donor','active','[]','system:test','fix30 suite')`, [id, org, "Person " + id, state]);
}
let n = 0;
async function agentWrote(org, id, before, minutesAgo, { undone = false } = {}) {
  await q(`INSERT INTO agent_writes (id,org_id,tool,entity_table,entity_id,before_row,after_row,cites,undone_at,created_at)
           VALUES ($1,$2,'update_contact','donors',$3,$4,$5,'[]',$6, NOW() - make_interval(mins => $7))`,
    ["aw_f30_" + (++n), org, id, JSON.stringify(before), JSON.stringify({ state: "runs", city: "Salem" }),
     undone ? new Date() : null, minutesAgo]);
}
async function personEdited(org, id, from, to, minutesAgo) {
  await q(`INSERT INTO fin_audit_log (id,org_id,user_id,user_name,actor_kind,action,entity_type,entity_id,before_fields,after_fields,created_at)
           VALUES ($1,$2,'u_f30','dana@example.org','user','update','donor',$3,$4,$5, NOW() - make_interval(mins => $6))`,
    ["al_f30_" + (++n), org, id, JSON.stringify({ state: from }), JSON.stringify({ state: to }), minutesAgo]);
}
const states = async () => Object.fromEntries((await q(
  `SELECT id, state FROM donors WHERE org_id IN ($1,$2) ORDER BY id`, [ORG, OTHER])).map(r => [r.id, r.state]));

(async () => {
  try {
    await clean();
    for (const o of [ORG, OTHER]) await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete) VALUES ($1,$2,$3,1)`, [o, o, o]);

    // The cases. RESTORE: a, b (blank before), e (two writes: the first holds the truth).
    await person(ORG, "f30_a", "runs");  await agentWrote(ORG, "f30_a", { state: "MA", city: "Boston" }, 60);
    await person(ORG, "f30_b", "runs");  await agentWrote(ORG, "f30_b", { state: null }, 60);
    await person(ORG, "f30_e", "runs");  await agentWrote(ORG, "f30_e", { state: "OR" }, 90); await agentWrote(ORG, "f30_e", { state: "runs" }, 30);
    // LEAVE ALONE: c (a person changed it since), d (a person touched it, then it read runs again),
    // f (runs with no Agent write), g (the write was already undone), h (never touched).
    await person(ORG, "f30_c", "CA");    await agentWrote(ORG, "f30_c", { state: "TX" }, 60); await personEdited(ORG, "f30_c", "runs", "CA", 10);
    await person(ORG, "f30_d", "runs");  await agentWrote(ORG, "f30_d", { state: "WA" }, 60); await personEdited(ORG, "f30_d", "WA", "runs", 5);
    await person(ORG, "f30_f", "runs");
    await person(ORG, "f30_g", "NY");    await agentWrote(ORG, "f30_g", { state: "NY" }, 60, { undone: true });
    await person(ORG, "f30_h", "VT");
    // Another org with one to restore, so --org is proven to stay inside its org.
    await person(OTHER, "f30_x", "runs"); await agentWrote(OTHER, "f30_x", { state: "ME" }, 60);

    console.log("\n§1 the decision, with no database");
    ok("one write: restore from its before", decide({ writes: [{ before_row: { state: "MA" } }], nowState: "runs" }).restoreTo === "MA");
    ok("a chain restores from the FIRST write", decide({ writes: [{ before_row: { state: "OR" } }, { before_row: { state: "runs" } }], nowState: "runs" }).restoreTo === "OR");
    ok("a state changed since is left alone", decide({ writes: [{ before_row: { state: "TX" } }], nowState: "CA" }).kind === "changed_after");
    ok("a later human edit is left alone even if it reads runs", decide({ writes: [{ before_row: { state: "WA" } }], nowState: "runs", laterHumanEdit: true }).kind === "changed_after");
    ok("runs with no Agent write is not guessed at", decide({ writes: [], nowState: "runs" }).kind === "no_agent_write");

    console.log("\n§2 the dry run changes nothing");
    const before = await states();
    const auditBefore = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id IN ($1,$2)`, [ORG, OTHER]))[0].n;
    const dry = runScript();
    console.log(dry.split("\n").filter(l => /f30_|org_fix30/.test(l)).map(l => "    | " + l).join("\n"));
    ok("dry run: every state is unchanged", JSON.stringify(await states()) === JSON.stringify(before));
    ok("dry run: no audit row written", (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id IN ($1,$2)`, [ORG, OTHER]))[0].n === auditBefore);
    ok("dry run names the org and its count", dry.includes(`${ORG}: 3 to restore`) && dry.includes(`${OTHER}: 1 to restore`), dry.slice(0, 600));
    ok("dry run: f30_a now runs, restore to MA", dry.includes("f30_a  now runs, restore to MA"));
    ok("dry run: f30_b restores to blank", dry.includes("f30_b  now runs, restore to (blank)"));
    ok("dry run: f30_e restores to OR, from the first write", dry.includes("f30_e  now runs, restore to OR"));
    ok("dry run lists the changed-since people separately", /LEFT ALONE[\s\S]*f30_c[\s\S]*f30_d/.test(dry) && /f30_f\s+reads runs, and no Agent write/.test(dry));
    ok("dry run says nothing about the undone or untouched", !/f30_g|f30_h/.test(dry));

    console.log("\n§3 --org stays inside its org");
    const one = runScript("--apply", `--org=${OTHER}`);
    const s1 = await states();
    ok("--org applied only to that org", s1.f30_x === "ME" && s1.f30_a === "runs", { s1, out: one.slice(0, 300) });

    console.log("\n§4 --apply restores exactly the right rows, each with an audit row");
    runScript("--apply", `--org=${ORG}`);
    const s2 = await states();
    ok("restored: a=MA, b=blank, e=OR", s2.f30_a === "MA" && s2.f30_b === null && s2.f30_e === "OR", s2);
    ok("untouched: c, d, f, g, h", s2.f30_c === "CA" && s2.f30_d === "runs" && s2.f30_f === "runs" && s2.f30_g === "NY" && s2.f30_h === "VT", s2);
    const audit = await q(`SELECT entity_id, user_id, actor_kind, before_fields, after_fields FROM fin_audit_log
                            WHERE org_id IN ($1,$2) AND action='repair runs state' ORDER BY entity_id`, [ORG, OTHER]);
    ok("one audit row per restore (4)", audit.length === 4 && audit.map(r => r.entity_id).join() === "f30_a,f30_b,f30_e,f30_x", audit.map(r => r.entity_id));
    ok("each audit row names the script and carries before/after",
      audit.every(r => r.user_id === "system:scripts/repair-runs-state" && r.actor_kind === "system" && r.before_fields.state === "runs"));

    console.log("\n§5 a second run finds nothing");
    const again = runScript();
    ok("second dry run: nothing to restore", !/f30_[abex]\s+now runs/.test(again) && !again.includes(`${OTHER}:`), again.slice(0, 400));
    runScript("--apply", `--org=${ORG}`); runScript("--apply", `--org=${OTHER}`);
    ok("second apply changes nothing", JSON.stringify(await states()) === JSON.stringify(s2));

    console.log("\n§6 --undo reverses exactly the repair");
    runScript("--undo", `--org=${ORG}`); runScript("--undo", `--org=${OTHER}`);
    const s3 = await states();
    ok("undo: a, b, e, x read runs again", ["f30_a", "f30_b", "f30_e", "f30_x"].every(k => s3[k] === "runs"), s3);
    ok("undo: the others did not move", s3.f30_c === "CA" && s3.f30_g === "NY" && s3.f30_h === "VT");
    const undoRows = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id IN ($1,$2) AND action='undo repair runs state'`, [ORG, OTHER]))[0].n;
    ok("undo leaves its own audit row per person (4)", undoRows === 4, undoRows);
    const redo = runScript();
    ok("after undo, the dry run offers the same four again", redo.includes(`${ORG}: 3 to restore`) && redo.includes(`${OTHER}: 1 to restore`));
  } catch (e) {
    ok("suite ran without throwing", false, e.stack || e.message);
  } finally {
    await clean().catch(() => {});
    await closeDb();
    summary();
  }
})();
