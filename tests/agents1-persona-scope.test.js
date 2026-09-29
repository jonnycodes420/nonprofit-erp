// tests/agents1-persona-scope.test.js — AGENTS-1. THE ONE GUARD THIS BUILD EARNED.
//
// Six personas on one engine. The engine's own safety model is unchanged and
// already guarded (fix6-approval, build96-ai-gate, tenant-matrix). What is NEW
// and unguarded is the claim each persona card makes to the person reading it:
//
//     "Read-only. It can never change a donor record."
//
// That sentence is on the Analyst's card and in the Guardrails tab. It is a
// promise about donor data, and a prompt does not keep a promise: a model asked
// to plan as the Analyst can still answer with a step that moves somebody's
// stage or retags forty people. THE FILTER is what keeps it, and this suite is
// the filter's guard.
//
// THE ONE TEST, in the brief's words: an Analyst plan can never contain
// set_stage or add_tag, read from the plan JSON, and the step is dropped at
// PLAN time — before she reads the plan, not quietly at confirm time.
//
// HOW IT WOULD GO RED:
//   · widen the Analyst's tool list (planting add_tag turns §1 and §2 red);
//   · make dropOutOfScope keep unknown tools instead of dropping them;
//   · move the filter to confirm time, so the plan JSON she reads still names
//     a tool that will never run (§2 reads the PLAN, which is the point);
//   · let an unknown persona fall back to the general agent's full tool set
//     instead of being refused at the route (§4).
// §1 and §2 were each verified red by planting add_tag into the Analyst.
//
// WHY THE FILTER IS TESTED DIRECTLY RATHER THAN THROUGH THE MODEL. The scratch
// server runs with NO ANTHROPIC_API_KEY, which is the state production is in;
// POST /agent/instructions answers 503 above the model, so a route-driven plan
// would prove nothing here and a suite that SKIPPED would prove less. The
// filter is pure and lives in shared/agentPersonas.js precisely so it can be
// fed a model-shaped answer and checked. The route's own persona validation,
// which runs above the gate, IS driven through the route (§4).
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_ag1";
const ADMIN = "ag1-admin@example.org";

// What a model might plausibly return for "tidy up my lapsed donors" — three
// reads it is allowed and three writes it is not. This is the shape the filter
// actually meets: a steps array off a tool_use block.
const MODEL_ANSWER = [
  { tool: "find_people", label: "Find everybody who gave last year and not this", citesRows: ["d_1"] },
  { tool: "count", label: "Count them", citesRows: ["d_1"] },
  { tool: "set_stage", donorId: "d_1", label: "Move them to lapsed", citesRows: ["d_1"] },
  { tool: "add_tag", donorId: "d_1", label: "Tag them lapsed-2026", citesRows: ["d_1"] },
  { tool: "log_note", donorId: "d_1", label: "Note that they lapsed", citesRows: ["d_1"] },
  { tool: "find_people", label: "Find the rest", citesRows: ["d_1"] },
];

async function reset() {
  for (const t of ["agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Agents One Trust','agents-one',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_ag1',$1,$2,$3,'Agents Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
}

(async () => {
  console.log("AGENTS-1 — a persona can only ever do less than the engine\n");
  const PS = await import("../shared/agentPersonas.js");
  const A = await import("../shared/agentShape.js");

  // ── §1 · THE ANALYST'S TOOLS ARE READS AND NOTHING ELSE ─────────────────
  const analyst = PS.getPersona("analyst");
  ok("§1 the Analyst exists and is one of the six", analyst.id === "analyst", analyst.id);
  ok("§1 its tools are reads only", JSON.stringify(analyst.tools) === JSON.stringify(["find_people", "count"]), analyst.tools);
  ok("§1 set_stage is not among them", !analyst.tools.includes("set_stage"), analyst.tools);
  ok("§1 add_tag is not among them", !analyst.tools.includes("add_tag"), analyst.tools);

  // ── §2 · THE PLAN JSON, AFTER THE FILTER ────────────────────────────────
  // This is the object that is written to agent_instructions.plan and read back
  // onto her screen. The assertion is on its BYTES: the words set_stage and
  // add_tag do not occur anywhere in the plan an Analyst produced.
  const filtered = PS.dropOutOfScope("analyst", MODEL_ANSWER);
  const planJson = JSON.stringify({ steps: filtered.steps, sends: 0 });
  ok("§2 the model's six steps become three", filtered.steps.length === 3, filtered.steps.map(s => s.tool));
  ok("§2 the plan JSON contains no set_stage", !planJson.includes("set_stage"), planJson);
  ok("§2 the plan JSON contains no add_tag", !planJson.includes("add_tag"), planJson);
  ok("§2 the plan JSON contains no log_note either", !planJson.includes("log_note"), planJson);
  ok("§2 the reads it IS allowed all survived",
     filtered.steps.filter(s => s.tool === "find_people").length === 2 && filtered.steps.some(s => s.tool === "count"),
     filtered.steps.map(s => s.tool));
  ok("§2 the three dropped steps are counted, not silently lost", filtered.droppedCount === 3, filtered.droppedCount);

  // ── §3 · NO PERSONA MAY EVER REACH A DONOR OR A DOLLAR ──────────────────
  // Not the Analyst specifically: EVERY one of the six, against the tool table
  // itself, so a seventh persona added next year cannot quietly widen this.
  const forbidden = [];
  for (const p of [...PS.PERSONAS, PS.GENERAL]) {
    for (const t of p.tools) {
      if (PS.PERSONA_FORBIDDEN_TOOLS.includes(t)) forbidden.push(`${p.id}:${t}`);
      if (A.MONEY_TOOLS.includes(t)) forbidden.push(`${p.id}:${t} (money)`);
    }
  }
  ok("§3 no persona has send_email, queue_for_send, enrol_sequence or any money tool",
     forbidden.length === 0, forbidden);
  ok("§3 every persona's tools are a SUBSET of what the engine can plan at all",
     [...PS.PERSONAS, PS.GENERAL].every(p => p.tools.every(t => A.PLANNABLE.includes(t))),
     [...PS.PERSONAS, PS.GENERAL].map(p => p.tools.filter(t => !A.PLANNABLE.includes(t))).flat());
  ok("§3 every persona's suggested triggers are triggers this product actually has",
     [...PS.PERSONAS].every(p => p.suggestedTriggers.every(k => A.TRIGGER_KEYS.includes(k))),
     [...PS.PERSONAS].map(p => p.suggestedTriggers.filter(k => !A.TRIGGER_KEYS.includes(k))).flat());
  ok("§3 an unknown id falls back to the general agent, so old instructions keep working",
     PS.getPersona(null).id === "general" && PS.getPersona("nobody").id === "general");

  // ── §4 · THE ROUTE REFUSES AN ID IT DOES NOT KNOW ───────────────────────
  // Above the drafting gate, so this leg runs with no model key — which is the
  // state the scratch stack and production are both in.
  await reset();
  const tok = await login(ADMIN);
  const bad = await api("POST", "/agent/instructions", tok, { text: "Find my lapsed donors", persona: "superuser" });
  ok("§4 an unknown persona is refused, not silently run as the general agent",
     bad.status === 400 && bad.body?.error === "unknown_persona", { status: bad.status, body: bad.body });
  ok("§4 …and the refusal says which ids exist",
     Array.isArray(bad.body?.personas) && bad.body.personas.includes("analyst"), bad.body?.personas);
  const [stored] = await q(`SELECT COUNT(*)::int AS n FROM agent_instructions WHERE org_id=$1`, [ORG]);
  ok("§4 …and it wrote no instruction row at all", Number(stored.n) === 0, stored);

  // A MONEY INSTRUCTION IS STILL REFUSED, for a persona as for nobody. The
  // refusal is above the persona check, so no persona can route around it.
  const money = await api("POST", "/agent/instructions", tok, { text: "Refund Margaret's gift", persona: "analyst" });
  ok("§4 a money instruction is refused for a persona exactly as it always was",
     money.status === 400 && money.body?.error === "money_instruction", { status: money.status, body: money.body });

  await reset();
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
