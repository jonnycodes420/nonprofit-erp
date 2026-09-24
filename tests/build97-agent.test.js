// BUILD-97 Part 3 — THE AGENT YOU CAN TELL WHAT TO DO.
//
// BUILD-75 C.2's line does not move: agents read, draft and propose; a human
// commits anything that moves money or reaches a donor. What this part adds is
// the half that was missing — she can TELL it what to do, in her own words.
//
//   §1  MONEY IS REFUSED BY ABSENCE, NOT BY POLICY. There is no executor for a
//       money tool. The refusal is a missing code path, which is the only kind
//       of refusal a model cannot argue with — and it is a SENTENCE, never a
//       quiet reroute to a task somebody else has to notice.
//
//   §2  THE PLAN COMES BEFORE THE RUN, and a plan that names a tool she did not
//       sign for is REFUSED, not trimmed. Trimming would run a plan she read a
//       different version of.
//
//   §3  NOTHING SENDS. `sends` is zero unless she signed the instruction, and
//       this build's run path writes `sent = 0` unconditionally (BLOCKED §9).
//
//   §4  EVERY WRITE HAS AN UNDO THAT RESTORES THE ROW — a restore from a
//       recorded `before`, never a guess, and never a whole-row overwrite that
//       would also undo a human's later edit.
//
//   §5  ONE ACTIVITY SCREEN, and the counts on it are real.
//
//   §6  PAUSE STOPS IT. One instruction, or all of them, with one switch.
//
//   §7  THE MODEL BOUNDARY. Without a key the agent is UNAVAILABLE by name, not
//       broken; the tool table and the executor table agree in BOTH directions;
//       and the model is handed rows, never a database.
//
// The routes that call a model are exercised only when ANTHROPIC_API_KEY is
// set — the rest is asserted without one, deliberately, because a safety
// property that can only be checked with a paid key is a safety property that
// does not get checked.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const root = path.join(__dirname, "..");
const ORG = "org_b97agent", OTHER = "org_b97agent2";
const PASS = "loadtest1234";
const ME = "agent@b97.example.org", THEM = "agent2@b97.example.org";
const HAVE_KEY = !!process.env.ANTHROPIC_API_KEY;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };

const CHILD = ["agent_writes", "agent_drafts", "agent_runs", "agent_instructions",
  "interactions", "threads", "tasks", "gifts", "donors", "users",
  "fin_transactions", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address)
   VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507')
   ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, [id, name, id.replace(/_/g, "-")]);
const mkUser = (id, org, email) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Director','admin')`,
  [id, org, email, bcrypt.hashSync(PASS, 4)]);
const mkDonor = (id, org, name, opts = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,last_gift_date,tags)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'[]')`,
  [id, org, name, `${id}@example.org`, opts.stage || "cultivate",
   opts.total || 500, opts.gifts || 2, opts.last || "2025-10-14"]);

(async () => {
  console.log("build97-agent");
  const A = await import("../shared/agentShape.js");
  const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");

  await reset();
  await mkOrg(ORG, "Her Organisation"); await mkOrg(OTHER, "Somebody Else");
  await mkUser("u_b97ag", ORG, ME); await mkUser("u_b97ag2", OTHER, THEM);
  await mkDonor("d_ag_1", ORG, "Allie Barnett", { total: 1250, gifts: 5, last: "2025-10-14" });
  await mkDonor("d_ag_2", ORG, "Marcus Reyes", { total: 300, gifts: 1, last: "2026-01-09" });
  await mkDonor("d_ag_x", OTHER, "Not Yours", { total: 9999 });
  const tok = await login(ME, PASS);
  const theirTok = await login(THEM, PASS);

  // ── §1 · MONEY IS REFUSED BY ABSENCE ─────────────────────────────────────
  console.log("\n— §1 · a model never decides a dollar —");

  // The tool table names the money tools so the REFUSAL has a name.
  ok("the money tools are named in the tool table",
     A.MONEY_TOOLS.length >= 5 && A.MONEY_TOOLS.includes("refund"), A.MONEY_TOOLS);
  ok("…and none of them is plannable", A.MONEY_TOOLS.every(t => !A.PLANNABLE.includes(t)));
  // THE POINT: not a policy, an ABSENCE. The executor table is read off the
  // source, and a money tool must not appear as a key in it.
  const execBlock = serverSrc.slice(serverSrc.indexOf("const AGENT_EXECUTORS = {"),
                                    serverSrc.indexOf("const AGENT_RUNNABLE ="));
  for (const t of A.MONEY_TOOLS) {
    ok(`there is NO executor for ${t} — the refusal is a missing code path`,
       !new RegExp(`\\basync ${t}\\s*\\(`).test(execBlock), t);
  }
  // And the mirror: every executor that DOES exist is a tool the shape module
  // knows about. A function here that the registry never declared is a tool
  // nobody reviewed.
  const execNames = [...execBlock.matchAll(/^\s{2}async (\w+)\(ctx/gm)].map(m => m[1]);
  ok("every executor is a declared tool", execNames.every(n => A.TOOL_NAMES.includes(n)), execNames);
  ok("…and every one of them is one the agent may run on its own",
     execNames.every(n => A.TOOLS_BY_NAME[n].needsHuman === "never"), execNames);
  ok("…and every one is undoable", execNames.every(n => A.UNDOABLE.includes(n)), execNames);

  // THE REFUSAL IS A SENTENCE, NOT A ROUTE. "Refund Margaret" is told no and
  // told why — never quietly turned into a task for somebody else, because a
  // silent reroute teaches her the instruction worked and she finds out it did
  // not when Margaret rings up.
  const money = await api("POST", "/agent/instructions", tok, { text: "Refund Margaret's gift from March" });
  ok("a money instruction is refused", money.status === 400, money.status);
  ok("…by name", money.body.error === "money_instruction", money.body);
  ok("…with a sentence that says what Steward WILL do",
     /will not do that/i.test(money.body.sentence || "") && /draft what to say/i.test(money.body.sentence || ""),
     money.body.sentence);
  // …and it is refused BEFORE anything is written. A refusal that leaves a row
  // behind is a reroute wearing a refusal's clothes.
  const after = await q(`SELECT COUNT(*)::int AS n FROM agent_instructions WHERE org_id=$1`, [ORG]);
  ok("…and nothing at all was written", after[0].n === 0, after[0]);
  const noTasks = await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1`, [ORG]);
  ok("…not even a task for somebody else to notice", noTasks[0].n === 0, noTasks[0]);

  // The whole family, not one phrasing.
  for (const text of ["cancel her monthly gift", "issue a receipt for that", "create a pledge for $500",
                      "charge the card again", "write off the balance"]) {
    const r = await api("POST", "/agent/instructions", tok, { text });
    ok(`"${text}" is refused`, r.status === 400 && r.body.error === "money_instruction", r.body);
  }
  // …and an ordinary instruction is NOT caught by the money net.
  ok("an ordinary instruction is not mistaken for a money one",
     A.moneyRefusal("Find everyone who gave last October and draft me a note to each") === null);

  // ── §2 · THE PLAN COMES BEFORE THE RUN ───────────────────────────────────
  console.log("\n— §2 · a plan she did not sign for is refused, not trimmed —");
  const draftAuth = { authorization: A.AUTH_DRAFT };
  const sendAuth = { authorization: A.AUTH_SEND };
  const sendingPlan = { reads: "412 donors", expectedCount: 31, sends: 31, summary: "Write and send each of them a note.",
    steps: [{ tool: "send_email", describes: "send the note" }] };
  ok("a plan that SENDS is refused when she has not signed for sending",
     !A.validatePlan(sendingPlan, draftAuth).ok, A.validatePlan(sendingPlan, draftAuth).errors);
  ok("…and the same plan is allowed once she has",
     A.validatePlan(sendingPlan, sendAuth).ok, A.validatePlan(sendingPlan, sendAuth).errors);
  const moneyPlan = { reads: "1 donor", expectedCount: 1, sends: 0, summary: "Refund the gift.",
    steps: [{ tool: "refund", describes: "refund it" }] };
  ok("a plan naming a money tool is refused at EVERY authorization level",
     !A.validatePlan(moneyPlan, draftAuth).ok && !A.validatePlan(moneyPlan, sendAuth).ok);
  ok("…and the reason says it moves money",
     A.validatePlan(moneyPlan, sendAuth).errors.some(e => /moves money/.test(e)));
  ok("a plan with no steps does nothing and is refused",
     !A.validatePlan({ reads: "x", expectedCount: 0, sends: 0, summary: "Do nothing at all.", steps: [] }, draftAuth).ok);
  ok("a plan a person cannot read is refused",
     !A.validatePlan({ reads: "x", expectedCount: 1, sends: 0, summary: "ok",
       steps: [{ tool: "draft_note", describes: "write" }] }, draftAuth).ok);
  ok("an unknown tool is refused by name",
     A.validatePlan({ reads: "x", expectedCount: 1, sends: 0, summary: "A plan that does something.",
       steps: [{ tool: "delete_everything", describes: "oh dear" }] }, draftAuth)
       .errors.some(e => /unknown tool/.test(e)));
  const good = { reads: "412 donors", expectedCount: 31, sends: 0,
    summary: "Look at 412 donors, find about 31, and write each a draft. Nothing sends.",
    steps: [{ tool: "draft_note", describes: "write each of them a draft" }] };
  ok("a good draft-only plan is accepted", A.validatePlan(good, draftAuth).ok, A.validatePlan(good, draftAuth).errors);

  // ── §3 · A DRAFT THAT CANNOT CITE A ROW IS NOT PRODUCED ──────────────────
  console.log("\n— §3 · every draft points at the rows it came from —");
  const known = ["d_ag_1", "d_ag_2"];
  ok("an action with no citation is a problem",
     A.citationProblems({ citesRows: [] }, { knownRowIds: known }).length > 0);
  ok("an action citing a row Steward never read is a WORSE problem, and named",
     A.citationProblems({ citesRows: ["d_invented"] }, { knownRowIds: known })
       .some(p => /never read/.test(p)));
  ok("an action citing a real row is fine",
     A.citationProblems({ citesRows: ["d_ag_1"] }, { knownRowIds: known }).length === 0);
  ok("the withheld count is a SENTENCE, not a silent gap",
     /3 of 31 withheld/.test(A.withheldSentence(3, 28)), A.withheldSentence(3, 28));
  ok("…and nothing withheld says nothing", A.withheldSentence(0, 28) === "");

  // ── §4 · STANDING INSTRUCTIONS FIRE ON THE TICK, NEVER RETROACTIVELY ─────
  console.log("\n— §4 · a standing instruction starts today —");
  ok("the triggers are a closed set", A.TRIGGER_KEYS.length >= 5 && A.TRIGGER_KEYS.includes("first_gift"));
  ok("a plan is re-shown when the shape changes by more than half",
     A.planNeedsReshowing(10, 16) === true && A.planNeedsReshowing(10, 12) === false,
     [A.planNeedsReshowing(10, 16), A.planNeedsReshowing(10, 12)]);
  ok("…and from zero, anything at all is a change", A.planNeedsReshowing(0, 1) === true);
  ok("…and zero to zero is not", A.planNeedsReshowing(0, 0) === false);

  // ── §5 · UNDO, PAUSE AND THE ACTIVITY SCREEN ─────────────────────────────
  // Seeded directly, because creating them through the routes calls a model and
  // a safety property must not depend on an API key being present.
  console.log("\n— §5 · every write has an undo that restores the row —");
  await q(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,plan)
           VALUES ($1,$2,$3,'task','active','draft','{"steps":[]}'::jsonb)`,
    ["ai_b97", ORG, "Move the Barn Buddies regulars into Steward stage"]);
  await q(`INSERT INTO agent_runs (id,org_id,instruction_id,status,drafted,sent,declined,withheld,read_summary)
           VALUES ($1,$2,$3,'done',2,0,1,1,'2 people')`, ["arun_b97", ORG, "ai_b97"]);
  // A stage move, with the PREVIOUS stage recorded — which is what makes it
  // undoable at all.
  await q(`UPDATE donors SET stage='steward' WHERE id='d_ag_1' AND org_id=$1`, [ORG]);
  await q(`INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,after_row,cites)
           VALUES ($1,$2,'arun_b97','ai_b97','set_stage','donors','d_ag_1',
                   '{"stage":"cultivate"}'::jsonb,'{"stage":"steward"}'::jsonb,'["d_ag_1"]'::jsonb)`,
    ["aw_stage", ORG]);
  // A created row, with NO before — undo deletes it.
  await q(`INSERT INTO tasks (id,org_id,title,done,created_by,created_by_name)
           VALUES ('task_b97',$1,'Call Allie about the barn',0,'system:agent','Steward (agent)')`, [ORG]);
  await q(`INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,cites)
           VALUES ($1,$2,'arun_b97','ai_b97','create_task','tasks','task_b97',NULL,'["d_ag_1"]'::jsonb)`,
    ["aw_task", ORG]);

  const act = await api("GET", "/agent/activity", tok);
  ok("the activity screen answers", act.status === 200, act.status);
  ok("…with the run and what it did", act.body.runs.length === 1
     && act.body.runs[0].drafted === 2 && act.body.runs[0].withheld === 1, act.body.runs[0]);
  ok("…and quotes HER INSTRUCTION back, which is the reason for every write",
     /Barn Buddies/.test(act.body.runs[0].instruction_text || ""), act.body.runs[0].instruction_text);
  ok("…and every write is listed", act.body.writes.length === 2, act.body.writes.length);
  ok("…each marked undoable inside the window", act.body.writes.every(w => w.undoable), act.body.writes);
  ok("…and the window is thirty days", act.body.undoDays === A.UNDO_DAYS && A.UNDO_DAYS === 30, act.body.undoDays);

  // UNDO RESTORES, it does not guess.
  const u1 = await api("POST", "/agent/writes/aw_stage/undo", tok, {});
  ok("undoing a stage move restores the PREVIOUS stage", u1.status === 200 && u1.body.action === "restored", u1.body);
  const [d1] = await q(`SELECT stage FROM donors WHERE id='d_ag_1' AND org_id=$1`, [ORG]);
  ok("…to the exact value it was before", d1.stage === "cultivate", d1);
  const u2 = await api("POST", "/agent/writes/aw_task/undo", tok, {});
  ok("undoing a created row deletes it", u2.status === 200 && u2.body.action === "deleted", u2.body);
  const [t1] = await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE id='task_b97'`);
  ok("…and it is gone", t1.n === 0, t1);
  const again = await api("POST", "/agent/writes/aw_stage/undo", tok, {});
  ok("undoing twice is refused rather than silently repeated", again.status === 409, again.body);

  // OUTSIDE THE WINDOW IS REFUSED, and the refusal says how long the window is.
  await q(`INSERT INTO agent_writes (id,org_id,run_id,tool,entity_table,entity_id,before_row,cites,created_at)
           VALUES ($1,$2,'arun_b97','set_stage','donors','d_ag_2','{"stage":"prospect"}'::jsonb,'[]'::jsonb,
                   NOW() - INTERVAL '31 days')`, ["aw_old", ORG]);
  const old = await api("POST", "/agent/writes/aw_old/undo", tok, {});
  ok("a write older than the window cannot be undone", old.status === 409
     && old.body.error === "outside_undo_window", old.body);
  ok("…and the refusal says how long the window is", old.body.days === 30, old.body);

  // ── §6 · PAUSE ───────────────────────────────────────────────────────────
  console.log("\n— §6 · pause stops it, one button —");
  const p1 = await api("POST", "/agent/instructions/ai_b97/pause", tok, {});
  ok("an instruction pauses", p1.status === 200, p1.body);
  const [ins] = await q(`SELECT status, paused_at FROM agent_instructions WHERE id='ai_b97'`);
  ok("…and the row says so", ins.status === "paused" && !!ins.paused_at, ins);
  const r1 = await api("POST", "/agent/instructions/ai_b97/resume", tok, {});
  ok("…and resumes", r1.status === 200, r1.body);

  const pa = await api("POST", "/agent/pause-all", tok, {});
  ok("pause-all answers", pa.status === 200 && pa.body.pausedAll === true, pa.body);
  // THE POINT OF PAUSE-ALL: nothing can start while it is on.
  const blocked = await api("POST", "/agent/instructions", tok, { text: "List my ten quietest donors" });
  ok("…and nothing can be planned while it is paused",
     blocked.status === 503 && ["agent_paused", "agent_unavailable"].includes(blocked.body.error), blocked.body);
  const list = await api("GET", "/agent/instructions", tok);
  ok("…and every screen can see that it is paused", list.body.pausedAll === true, list.body.pausedAll);
  await api("POST", "/agent/resume-all", tok, {});

  // ── §7 · THE WALL ────────────────────────────────────────────────────────
  // The tenant matrix probes these routes generically; this is the one that
  // matters in this part's own words.
  console.log("\n— §7 · an instruction naming somebody in another org finds nobody —");
  const theirs = await api("GET", "/agent/activity", theirTok);
  ok("the other org sees none of her runs", theirs.body.runs.length === 0, theirs.body.runs.length);
  ok("…and none of her writes", theirs.body.writes.length === 0, theirs.body.writes.length);
  const steal = await api("POST", "/agent/writes/aw_task/undo", theirTok, {});
  ok("…and cannot undo her writes", steal.status === 404, steal.status);
  const pauseHers = await api("POST", "/agent/instructions/ai_b97/pause", theirTok, {});
  ok("…nor pause her instructions", pauseHers.status === 404, pauseHers.status);

  // ── §8 · THE MODEL BOUNDARY ──────────────────────────────────────────────
  console.log("\n— §8 · the model gets rows, never a database —");
  const planFn = serverSrc.slice(serverSrc.indexOf("async function agentBuildPlan"),
                                 serverSrc.indexOf("async function agentRunPlan"));
  const runFn = serverSrc.slice(serverSrc.indexOf("async function agentRunPlan"),
                                serverSrc.indexOf("// ── ROUTES ──"));
  ok("the agent's reads are ONE org-scoped function",
     /WHERE d\.org_id = \? AND d\.deleted_at IS NULL/.test(serverSrc.slice(
       serverSrc.indexOf("async function agentReadPeople"), serverSrc.indexOf("async function agentWrite"))));
  ok("…and it is capped", /LIMIT \?/.test(serverSrc.slice(
       serverSrc.indexOf("async function agentReadPeople"), serverSrc.indexOf("async function agentWrite"))));
  const sqlLiterals = [...runFn.matchAll(/`([^`]*)`/g)].map(m => m[1])
    .filter(l => /\b(INSERT INTO|UPDATE |DELETE FROM|SELECT )/i.test(l));
  ok("the run path has SQL to check", sqlLiterals.length >= 1, sqlLiterals.length);
  const interpolated = sqlLiterals.filter(l => /\$\{/.test(l));
  ok("no model value is interpolated into SQL — every one is a bound parameter",
     interpolated.length === 0, interpolated.map(l => l.slice(0, 80)));
  ok("…and the executors are the same", (() => {
    const lits = [...execBlock.matchAll(/`([^`]*)`/g)].map(m => m[1])
      .filter(l => /\b(INSERT INTO|UPDATE |DELETE FROM|SELECT )/i.test(l));
    return lits.length > 0 && lits.every(l => !/\$\{/.test(l));
  })(), null);
  ok("the run path excludes deceased, do-not-contact and sample people BEFORE the model sees them",
     /!p\.deceased && !p\.do_not_contact && !p\.is_sample/.test(runFn));
  ok("every action is checked against the tools that HAVE an executor",
     /AGENT_RUNNABLE\.includes\(a\.tool\)/.test(runFn));
  ok("…and against this org's own donors",
     /byId\.has\(a\.donorId\)/.test(runFn));
  ok("…and against the citation rule", /citationProblems/.test(runFn));
  ok("…and against the invented-rule rule", /ungroundedClaims/.test(runFn));
  ok("the whole prompt and response are kept, per org",
     /INSERT INTO ai_log[\s\S]{0,200}prompt_full/.test(runFn));
  ok("NOTHING SENDS on this path: sent is written as 0 unconditionally",
     /sent=0/.test(runFn) || /sent = 0/.test(runFn), null);
  ok("…and the run reports sent: 0", /sent: 0/.test(runFn));

  // WITHOUT A KEY THE AGENT IS UNAVAILABLE BY NAME, not broken.
  if (!HAVE_KEY) {
    const noKey = await api("POST", "/agent/instructions", tok, { text: "List my ten quietest donors" });
    ok("with no ANTHROPIC_API_KEY the agent answers 503 agent_unavailable",
       noKey.status === 503 && noKey.body.error === "agent_unavailable", noKey.body);
    ok("…and it is not a 500", noKey.status !== 500, noKey.status);
    // The rest of the surface still works without a key — the Activity screen,
    // the undo and the pause are not the model's business.
    ok("…while the activity screen still answers", (await api("GET", "/agent/activity", tok)).status === 200);
    console.log("  (the plan/run legs need ANTHROPIC_API_KEY — see BLOCKED-build97.md §4)");
  } else {
    const planned = await api("POST", "/agent/instructions", tok,
      { text: "Find everyone who gave last October and has not given this year, and draft me a note to each." });
    ok("a real instruction produces a plan", planned.status === 201 && !!planned.body.plan, planned.body);
    ok("…and the plan sends NOTHING by default", planned.body.plan.sends === 0, planned.body.plan);
    ok("…and says what it will look at", (planned.body.plan.reads || "").length > 3, planned.body.plan.reads);
  }

  // The daily line, which is the sixth Home section.
  const daily = await api("GET", "/agent/daily-line", tok);
  ok("the daily line answers", daily.status === 200, daily.status);
  ok("…and with nothing to report it says nothing rather than filling a hole",
     A.dailyLine({ did: 0, sent: 0, waiting: 0 }) === "");
  ok("…and with something to report it says it plainly",
     /Steward did 14 things for you yesterday, sent 0, 6 drafts waiting\./
       .test(A.dailyLine({ did: 14, sent: 0, waiting: 6 })),
     A.dailyLine({ did: 14, sent: 0, waiting: 6 }));

  // ── §9 · THE BROWSER: OVERSIGHT IS A SCREEN, NOT A CLAIM ────────────────
  // "Nothing the agent does is hidden from the person who asked for it" is not
  // a sentence a product gets to say without a screen behind it. Every
  // assertion above is about the server; this is about what she can see.
  console.log("\n— §9 · the browser: she can see all of it, and stop it —");
  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    // Put the run, the writes and an instruction back — §5 undid two of them
    // and §6 left the instruction resumed.
    await q(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,plan,turned_on_by_name,turned_on_at)
             VALUES ($1,$2,$3,'standing','active','draft','{"steps":[]}'::jsonb,'Allie Barnett',NOW())
             ON CONFLICT (id) DO NOTHING`,
      ["ai_b97b", ORG, "Every Monday, list my ten quietest donors with what to say"]);
    await q(`INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,cites)
             VALUES ($1,$2,'arun_b97','ai_b97','log_note','interactions','int_x',NULL,'["d_ag_1"]'::jsonb)
             ON CONFLICT (id) DO NOTHING`, ["aw_note", ORG]);

    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    const errors = [];
    page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) errors.push(e.message.slice(0, 140)); });
    const lr = await page.request.post(require("./helpers").BASE + "/auth/login",
      { data: { email: ME, password: PASS } });
    const lj = await lr.json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(d => {
      localStorage.setItem("npe_token", d.token);
      localStorage.setItem("npe_user", JSON.stringify(d.user));
      localStorage.setItem("npe_org", JSON.stringify(d.org));
    }, lj);
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    // HOME: the box she types into, and the daily line.
    const box = page.locator('[data-testid="agent-box"]');
    ok("Home carries the 'Tell Steward what to do' box", await box.count() === 1, await box.count());

    // BUILD-96 Part 3 — THE BOX HAS TWO SHAPES NOW, and which one it takes is
    // the point. The agent sends this organisation's rows and vocabulary to
    // Anthropic, so a gated org gets ONE SENTENCE and nothing to press —
    // a textarea that answers 503 when pressed teaches her the product is
    // broken when the truth is that a key is not set. Below, the input is
    // asserted only where a key makes it real; where there is none, the
    // sentence is asserted instead, and the legs that need a live model stop
    // here rather than pass quietly.
    const gated = await page.locator('[data-testid="agent-unavailable"]').count() === 1;
    if (gated) {
      ok("with no ANTHROPIC_API_KEY, Home says so in one sentence",
         (await page.locator('[data-testid="agent-unavailable"]').innerText())
           .includes("Not enabled for this organization yet"), true);
      ok("…and offers NOTHING to press — absent, not broken",
         await page.locator('[data-testid="agent-input"]').count() === 0 &&
         await page.locator('[data-testid="agent-ask"]').count() === 0, true);
      console.log("  (the on-screen refusal leg needs ANTHROPIC_API_KEY — see BLOCKED-build95.md §4)");
    } else {
    ok("…with somewhere to type", await page.locator('[data-testid="agent-input"]').count() === 1);
    const boxText = (await box.count()) ? await box.innerText() : "";
    ok("…and it promises nothing happens until she says so",
       /Nothing happens until you say so/i.test(boxText), boxText.slice(0, 200));
    ok("…and the daily line is there",
       await page.locator('[data-testid="agent-daily-line"]').count() === 1, boxText.slice(0, 200));

    // THE REFUSAL, ON SCREEN. A money instruction is told no in words, on the
    // screen she typed it into — not swallowed into a console.
    await page.fill('[data-testid="agent-input"]', "Refund Margaret's gift from March");
    await page.click('[data-testid="agent-ask"]');
    await page.waitForTimeout(1800);
    const refusal = page.locator('[data-testid="agent-refusal"]');
    ok("a money instruction is refused ON SCREEN", await refusal.count() === 1, await refusal.count());
    const rt = (await refusal.count()) ? await refusal.innerText() : "";
    ok("…in words that say what Steward will do instead",
       /will not do that/i.test(rt) && /draft what to say/i.test(rt), rt.slice(0, 220));
    ok("…and no plan is offered", await page.locator('[data-testid="agent-plan"]').count() === 0);
    }

    // THE ACTIVITY SCREEN.
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.click('button:has-text("Settings")').catch(() => {});
    await page.waitForTimeout(1200);
    await page.click('button:has-text("Steward\'s activity")').catch(() => {});
    await page.waitForTimeout(1800);

    ok("the activity screen shows her instructions",
       await page.locator('[data-testid="agent-instruction"]').count() >= 1,
       await page.locator('[data-testid="agent-instruction"]').count());
    const instrText = await page.locator('[data-testid="agent-instruction"]').first().innerText();
    ok("…quoting HER WORDS back, not a tidied paraphrase",
       /quietest donors/.test(instrText) || /Barn Buddies/.test(instrText), instrText.slice(0, 160));
    ok("…and saying plainly that it only drafts",
       /drafts only/.test(await page.locator('[data-testid="agent-instruction-auth"]').first().innerText()),
       await page.locator('[data-testid="agent-instruction-auth"]').first().innerText());
    ok("…every run is listed", await page.locator('[data-testid="agent-run"]').count() >= 1);
    const runText = await page.locator('[data-testid="agent-run"]').first().innerText();
    ok("…with what it read, drafted, sent, declined AND withheld",
       /read/.test(runText) && /drafted/.test(runText) && /sent/.test(runText)
       && /declined/.test(runText) && /withheld/.test(runText), runText.slice(0, 220));
    ok("…every write is listed", await page.locator('[data-testid="agent-write"]').count() >= 1);
    ok("…with an undo on it", await page.locator('[data-testid="agent-undo"]').count() >= 1);

    // PAUSE ALL, FROM THE SCREEN.
    const state = page.locator('[data-testid="agent-pause-state"]');
    ok("the screen says whether Steward is running", await state.count() === 1);
    ok("…and it is running", /is running/i.test(await state.innerText()), await state.innerText());
    await page.click('[data-testid="agent-pause-all"]');
    await page.waitForTimeout(1500);
    ok("pressing pause stops it, and the screen says so",
       /is paused/i.test(await state.innerText()), await state.innerText());
    const [orgRow] = await q(`SELECT agent_paused_at FROM orgs WHERE id=$1`, [ORG]);
    ok("…and the database agrees", !!orgRow.agent_paused_at, orgRow);

    // UNDO, FROM THE SCREEN.
    await page.click('[data-testid="agent-pause-all"]');   // back on, so the row is clickable
    await page.waitForTimeout(1200);
    const undoBefore = await page.locator('[data-testid="agent-undo"]').count();
    await page.locator('[data-testid="agent-undo"]').first().click();
    await page.waitForTimeout(1800);
    ok("pressing undo removes that row's undo button",
       await page.locator('[data-testid="agent-undo"]').count() === undoBefore - 1,
       { before: undoBefore, after: await page.locator('[data-testid="agent-undo"]').count() });
    ok("…and the screen says it was undone",
       await page.locator('[data-testid="agent-write-undone"]').count() >= 1);

    ok("no page error on any of it", errors.length === 0, errors.slice(0, 2));
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
