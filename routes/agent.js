// routes/agent.js — Steward Agent: the agent, AI helpers, workflows and sequences.
//
// FIX-1 split: these routes and the helpers only they use were moved here
// VERBATIM from server.js. Nothing in them changed.
//
// How it is wired, so it behaves exactly as it did inside server.js:
//   * Each router below is mounted in server.js with app.use(...) at the place
//     its first route used to be declared, so it keeps its place in the stack
//     (before or after the same middleware, before or after the same routes).
//   * server.js calls mount() once, at the end of boot, when every binding the
//     code below reads exists. `app` inside mount() is the current router, so
//     the unchanged `app.get(...)` lines register on it.
//   * `__dirname` is server.js's own, so every path built from it resolves as
//     before; a relative require()/import() reads "../x" because it resolves
//     against this file, one folder down (readSource reads it back as "./x").
// Tests read this file through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");

const routers = {
  r0: express.Router(),
};

function mount(ctx) {
const {
  AGENT_MODEL, ALL_PIPELINE_STAGES, Anthropic, SEQ_READY, WORKFLOW_RECIPE_MAP, actor, agentGate,
  aiGate, asJson, autoEnroll, checkWriteAccess, donorOnly, enrollInSequences, ensureWorkflows,
  fireWorkflows, orgOwns, orgTime, orgToday, orgTz, processSequences, processTrackedSequences,
  processWorkflowSweeps, query, requireAdmin, requireAuth, requirePlan, run, runTx,
  sequenceMergeValues, sequenceTimezoneGate, thresholdsMod, uuid, withTransaction, wrap,
} = ctx;
// server.js loads these ESM modules at boot and sets its own binding when each
// arrives; the code below reads them only after awaiting the same promise, so
// this module keeps its own binding, set from that promise the same way.
let SEQ = null;
SEQ_READY.then(m => { SEQ = m; });
let app = routers.r0;

// ── AI — streaming chat ────────────────────────────────────────────────────
app.post("/ai/stream", requireAuth, wrap(async (req, res) => {
  const { systemPrompt, userMessage } = req.body;
  if (!userMessage) return res.status(400).json({ error: "Message required" });

  // FOUND BY BUILD-99 Part 1's WALK, on a route BUILD-99 does not otherwise
  // touch: with no ANTHROPIC_API_KEY, `new Anthropic()` THROWS and this route
  // answered a 500 — a broken screen where the repo's own gate already has the
  // honest word for it (`aiGate` → `ai_no_key`: the control is ABSENT, which is
  // Steward's state, not the org's). It is the same non-200 the client already
  // handles, so nothing downstream changes; with a key set, this is a no-op.
  { const g = await aiGate(req.user.orgId);
    if (!g.ok) return res.status(503).json({ error: "ai_unavailable", reason: g.reason }); }

  await run(
    "INSERT INTO ai_log (id,org_id,user_id,type,prompt_summary) VALUES (?,?,?,?,?)",
    ["log_" + uuid().slice(0, 8), req.user.orgId, req.user.userId, "stream", userMessage.slice(0, 100)]
  );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt || "You are a helpful nonprofit development assistant.",
    messages: [{ role: "user", content: userMessage }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
    }
  }
  res.write("data: [DONE]\n\n");
  res.end();
}));

// ── AI — CSV column mapping ────────────────────────────────────────────────
app.post("/ai/column-map", requireAuth, wrap(async (req, res) => {
  const { headers, sample } = req.body;
  if (!headers?.length) return res.status(400).json({ error: "headers required" });

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: "You are a data mapping assistant for nonprofit CRM systems. Return only valid JSON, no explanation or markdown.",
    messages: [{
      role: "user",
      content: `Map these CSV column headers to donor fields. Available target fields: name, _firstName, _lastName, email, phone, total, lastAmount, lastGift, gifts, status, city, state, notes. Use empty string to skip a column. Use _firstName/_lastName when separate first/last name columns are present instead of a single name column.

RULES — follow these strictly:
1. Negation/flag columns: if a header signals a negation or opt-out ("do not email", "do not call", "do not mail", "opt out", "unsubscribe", "do not contact", or any similar phrasing), map it to "" (skip) or "notes" — NEVER to the contact field it negates (email, phone, etc.).
2. Email shape check: only map a column to "email" if the sample values actually look like email addresses (contain "@"). If the sample values are "Yes", "No", blank, or anything without "@", map to "" instead.
3. Phone shape check: only map a column to "phone" if the sample values contain digits that look like phone numbers.
4. Use the sample row values below to verify these shape rules before assigning a field.

Headers: ${JSON.stringify(headers)}
Sample row values: ${JSON.stringify(sample || {})}

Return ONLY a JSON object like: {"Original Header": "fieldName", "Another Header": ""}`,
    }],
  });

  try {
    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no json");
    res.json({ mapping: JSON.parse(jsonMatch[0]) });
  } catch {
    res.json({ mapping: {} });
  }
}));

// ── BUILD-97 Part 3 — THE AGENT SHE INSTRUCTS ──────────────────────────────
// BUILD-75 C.2's line does not move: agents read, draft and propose; a human
// commits anything that moves money or reaches a donor. What this adds is the
// half that was missing — she can TELL it what to do, in her own words.
//
// BUILD-94 Part 3 relaxed the rule exactly once, for sequences: "she wrote
// every word, she turned it on, and each send is hers." This applies that same
// relaxation to instructions and NO FURTHER. Every instruction defaults to
// "draft it and I'll send"; she may sign ONE instruction for sending, and every
// send then quotes that instruction in the log.
//
// MONEY NEVER GETS THAT FLIP — and not because a prompt says so. There is no
// executor for a money tool in AGENT_EXECUTORS below. The refusal is the
// ABSENCE of a code path, which is the only kind of refusal a model cannot
// argue with.
async function agentShapeMod() { return import("../shared/agentShape.js"); }

const AGENT_ACTOR = { id: "system:agent", name: "Steward (agent)" };

// ── WHAT THE AGENT IS ALLOWED TO SEE ───────────────────────────────────────
// The model gets the instruction, the org's vocabulary, and the rows STEWARD
// selected — never a database handle and never a query it wrote. This function
// is the entire surface, and it is org-scoped, capped, and excludes the people
// nothing may be drafted for.
async function agentReadPeople(orgId, { limit = 400 } = {}) {
  return query(
    `SELECT d.id, d.name, d.email, d.kind, d.stage, d.status, d.total_giving, d.gift_count,
            d.last_gift_date, d.last_gift_amount, d.deceased, d.do_not_contact, d.is_sample
       FROM donors d
      WHERE d.org_id = ? AND d.deleted_at IS NULL
      ORDER BY d.total_giving DESC NULLS LAST, d.id
      LIMIT ?`, [orgId, Math.min(Number(limit) || 400, 1000)]);
}

// Every agent write goes through HERE, so the undo ledger cannot be forgotten
// at a call site. `before` NULL means the row did not exist, which is how undo
// knows to delete rather than restore.
async function agentWrite(ctx, { tool, table, entityId, before, after, cites }) {
  const id = "aw_" + uuid().slice(0, 10);
  await runTx(ctx.client,
    `INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,after_row,cites)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, ctx.orgId, ctx.runId, ctx.instructionId || null, tool, table, entityId,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
     JSON.stringify(cites || [])]);
  return id;
}

// ── THE EXECUTORS ──────────────────────────────────────────────────────────
// ONE function per tool the agent may call, and NO function for any tool that
// moves money. That absence IS the safety model: agentRunPlan looks the tool up
// here, and a money tool is not here, so there is no path — not a disabled one,
// not a guarded one. tests/build97-agent.test.js asserts this table and
// shared/agentShape.js agree in both directions.
const AGENT_EXECUTORS = {
  async draft_note(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const id = "adr_" + uuid().slice(0, 10);
    await runTx(ctx.client,
      `INSERT INTO agent_drafts (id,org_id,run_id,instruction_id,donor_id,subject,body,cites)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, ctx.orgId, ctx.runId, ctx.instructionId || null, donor.id,
       String(step.subject || "").slice(0, 300), String(step.body || "").slice(0, 8000),
       JSON.stringify(step.citesRows || [])]);
    await agentWrite(ctx, { tool: "draft_note", table: "agent_drafts", entityId: id,
      before: null, after: { donor_id: donor.id }, cites: step.citesRows });
    return { id, donorId: donor.id, drafted: true };
  },

  async create_task(ctx, step) {
    const donor = step.donorId ? ctx.donorById(step.donorId) : null;
    if (step.donorId && !donor) return { skipped: "unknown_donor" };
    const id = "task_" + uuid().slice(0, 10);
    await runTx(ctx.client,
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,created_by,created_by_name)
       VALUES (?,?,?,?,?,'donor',0,?,?,?)`,
      [id, ctx.orgId, String(step.title || "Follow up").slice(0, 300), step.due || "",
       step.priority === "high" ? "high" : "medium", donor ? donor.id : null,
       AGENT_ACTOR.id, AGENT_ACTOR.name]);
    await agentWrite(ctx, { tool: "create_task", table: "tasks", entityId: id,
      before: null, after: { title: step.title }, cites: step.citesRows });
    return { id, donorId: donor ? donor.id : null };
  },

  async log_note(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const id = "int_" + uuid().slice(0, 10);
    await runTx(ctx.client,
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
       VALUES (?,?,?,'note',?,?,?,?)`,
      [id, ctx.orgId, donor.id, String(step.note || "").slice(0, 2000), ctx.today,
       AGENT_ACTOR.id, AGENT_ACTOR.name]);
    await agentWrite(ctx, { tool: "log_note", table: "interactions", entityId: id,
      before: null, after: { donor_id: donor.id }, cites: step.citesRows });
    return { id, donorId: donor.id };
  },

  async set_stage(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const to = String(step.stage || "");
    if (!ALL_PIPELINE_STAGES.includes(to)) return { skipped: "unknown_stage" };
    // The PREVIOUS stage is what makes this undoable, and it is read off the
    // ROW rather than taken from the model's idea of where the donor was.
    const [row] = await query("SELECT stage FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (!row) return { skipped: "unknown_donor" };
    if ((row.stage || null) === to) return { skipped: "already_there" };
    await runTx(ctx.client, "UPDATE donors SET stage=? WHERE id=? AND org_id=?", [to, donor.id, ctx.orgId]);
    await agentWrite(ctx, { tool: "set_stage", table: "donors", entityId: donor.id,
      before: { stage: row.stage }, after: { stage: to }, cites: step.citesRows });
    return { donorId: donor.id, from: row.stage, to };
  },

  async add_tag(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const tag = String(step.tag || "").trim().slice(0, 60);
    if (!tag) return { skipped: "no_tag" };
    const [row] = await query("SELECT tags FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (!row) return { skipped: "unknown_donor" };
    let tags = [];
    try { tags = Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || "[]"); } catch { tags = []; }
    if (tags.includes(tag)) return { skipped: "already_tagged" };
    const next = [...tags, tag];
    await runTx(ctx.client, "UPDATE donors SET tags=? WHERE id=? AND org_id=?",
      [JSON.stringify(next), donor.id, ctx.orgId]);
    await agentWrite(ctx, { tool: "add_tag", table: "donors", entityId: donor.id,
      before: { tags: JSON.stringify(tags) }, after: { tags: JSON.stringify(next) }, cites: step.citesRows });
    return { donorId: donor.id, tag };
  },

  async open_thread(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    // ONE OPEN THREAD PER DONOR is a database guarantee (threads_one_open). A
    // conflict here is the constraint working, not an error, and the run says
    // "already open" rather than failing.
    const id = "thr_" + uuid().slice(0, 10);
    const r = await runTx(ctx.client,
      `INSERT INTO threads (id,org_id,donor_id,owner_id,next_step_type,next_step_label,due_date,opened_on,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      [id, ctx.orgId, donor.id, ctx.userId || null, "follow_up",
       String(step.label || "Follow up").slice(0, 200), step.due || ctx.today, ctx.today,
       AGENT_ACTOR.id, AGENT_ACTOR.name]);
    if (r && r.changes === 0) return { skipped: "already_open" };
    await agentWrite(ctx, { tool: "open_thread", table: "threads", entityId: id,
      before: null, after: { donor_id: donor.id }, cites: step.citesRows });
    return { id, donorId: donor.id };
  },
};
const AGENT_RUNNABLE = Object.keys(AGENT_EXECUTORS);

// ── UNDO: A RESTORE, NOT A GUESS ───────────────────────────────────────────
// Only the columns the ledger recorded are restored — never a whole-row
// overwrite, which would also undo a HUMAN's later edit to a different field on
// the same record.
const AGENT_UNDO_DELETE_OK = new Set(["agent_drafts", "tasks", "interactions", "threads"]);

async function agentUndoWrite(w, orgId) {
  const table = w.entity_table;
  let before = w.before_row;
  if (typeof before === "string") { try { before = JSON.parse(before); } catch { before = null; } }
  if (!before) {
    if (!AGENT_UNDO_DELETE_OK.has(table)) return { ok: false, reason: "not_undoable" };
    await run(`DELETE FROM ${table} WHERE id=? AND org_id=?`, [w.entity_id, orgId]);
    return { ok: true, action: "deleted" };
  }
  const cols = Object.keys(before);
  if (!cols.length) return { ok: false, reason: "nothing_recorded" };
  const sets = cols.map(c => `${c}=?`).join(", ");
  await run(`UPDATE ${table} SET ${sets} WHERE id=? AND org_id=?`,
    [...cols.map(c => before[c]), w.entity_id, orgId]);
  return { ok: true, action: "restored", columns: cols };
}

// ── THE PLAN ───────────────────────────────────────────────────────────────
// Nothing runs until she has read one. The model is given the instruction, the
// org's own words, and a SUMMARY of the rows — never the rows' contents at plan
// time, because a plan is about shape, not about people.
async function agentBuildPlan(orgId, instructionText, { authorization }) {
  const A = await agentShapeMod();
  const people = await agentReadPeople(orgId);
  const V = await import("../shared/vocabulary.js");
  const [orgRow] = await query("SELECT vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const words = V.normalizeVocabulary(orgRow && orgRow.vocabulary_json);
  const client = new Anthropic();
  const toolList = A.AGENT_TOOLS
    .filter(t => A.PLANNABLE.includes(t.name))
    .map(t => `  ${t.name} — ${t.what}`).join("\n");

  const system = [
    "You are planning work inside a nonprofit's own CRM, for the person who runs it.",
    "",
    "You may ONLY use these tools:",
    toolList,
    "",
    "RULES, and they are not negotiable:",
    "- Produce a PLAN, not results. The plan is what she reads before anything happens.",
    "- Say how many people this will touch. It is an estimate and you say so.",
    authorization === A.AUTH_SEND
      ? "- This instruction is signed for sending, so `sends` may be greater than zero."
      : "- NOTHING may be sent. `sends` must be 0. Drafts go in her queue.",
    "- Never plan anything that moves money: no refunds, charges, pledges, receipts or recurring changes.",
    "- Use NO number that is not in the data you were given. Do not state rules about how giving works.",
  ].join("\n");

  const user = [
    `Her instruction, verbatim: "${String(instructionText).slice(0, 2000)}"`,
    "",
    `This organisation has ${people.length} people on file.`,
    words ? `It calls a giver a "${words.giver_singular}" and a fund a "${words.fund_singular}".` : "",
    "",
    "Plan the work.",
  ].filter(Boolean).join("\n");

  const msg = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: 1500,
    system,
    tools: [{ name: "plan", description: "The plan she will read before anything runs.",
              strict: true, input_schema: A.PLAN_SCHEMA }],
    tool_choice: { type: "tool", name: "plan" },
    messages: [{ role: "user", content: user }],
  });
  const block = (msg.content || []).find(b => b.type === "tool_use" && b.name === "plan");
  return { plan: block ? block.input : null, peopleCount: people.length, prompt: system + "\n\n" + user,
           response: JSON.stringify(block ? block.input : null) };
}

// ── RUNNING A CONFIRMED PLAN ───────────────────────────────────────────────
// `steps` come from the model, and EVERY ONE is checked here: the tool must be
// runnable, the donor must be this org's, and the action must cite rows Steward
// actually read. A step that fails any of those is WITHHELD and COUNTED.
async function agentRunPlan(orgId, instruction, { userId }) {
  const A = await agentShapeMod();
  const TH = await thresholdsMod();
  const runId = "arun_" + uuid().slice(0, 10);
  const people = await agentReadPeople(orgId);
  const byId = new Map(people.map(p => [p.id, p]));
  const knownRowIds = people.map(p => p.id);
  const today = orgToday(await orgTz(orgId));

  await run(`INSERT INTO agent_runs (id,org_id,instruction_id,status,plan,read_summary)
             VALUES (?,?,?,'running',?,?)`,
    [runId, orgId, instruction.id, JSON.stringify(instruction.plan || null),
     `${people.length} people`]);

  const client = new Anthropic();
  const plan = instruction.plan || {};
  const allowed = AGENT_RUNNABLE.filter(n => (plan.steps || []).some(s => s.tool === n));
  // The people a draft may never be written for, removed BEFORE the model sees
  // them rather than filtered after — the same rule getDraftFor has carried
  // since BUILD-83, and the incident's rule that fiction generates nothing.
  const reachable = people.filter(p => !p.deceased && !p.do_not_contact && !p.is_sample);

  const system = [
    "You are carrying out an instruction inside a nonprofit's own CRM.",
    "",
    "Return ACTIONS, one per person, using only these tools: " + (allowed.join(", ") || "none"),
    "",
    "RULES:",
    "- EVERY action must carry `citesRows`: the ids of the rows it came from. An action you cannot",
    "  point at a row for must not be returned at all.",
    "- Use NO number that is not in the rows below. Never state a rule about how giving works.",
    "- Write in plain words, as the person running this organisation would.",
  ].join("\n");

  const user = [
    `Her instruction, verbatim: "${instruction.text}"`,
    "",
    "The people, with their own giving:",
    ...reachable.slice(0, 200).map(p =>
      `  ${p.id} | ${p.name} | lifetime ${p.total_giving || 0} | ${p.gift_count || 0} gifts | last ${p.last_gift_date || "never"} | stage ${p.stage || "none"}`),
  ].join("\n");

  const ACTIONS_SCHEMA = {
    type: "object", additionalProperties: false, required: ["actions"],
    properties: { actions: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["tool", "donorId", "citesRows"],
      properties: {
        tool: { type: "string" },
        donorId: { type: ["string", "null"] },
        citesRows: { type: "array", items: { type: "string" } },
        subject: { type: ["string", "null"] }, body: { type: ["string", "null"] },
        title: { type: ["string", "null"] }, note: { type: ["string", "null"] },
        stage: { type: ["string", "null"] }, tag: { type: ["string", "null"] },
        label: { type: ["string", "null"] }, due: { type: ["string", "null"] },
        priority: { type: ["string", "null"] },
      } } } },
  };

  let actions = [];
  let promptLog = system + "\n\n" + user, responseLog = "";
  try {
    const msg = await client.messages.create({
      model: AGENT_MODEL, max_tokens: 8000, system,
      tools: [{ name: "act", description: "The actions to take.", strict: true, input_schema: ACTIONS_SCHEMA }],
      tool_choice: { type: "tool", name: "act" },
      messages: [{ role: "user", content: user }],
    });
    const block = (msg.content || []).find(b => b.type === "tool_use" && b.name === "act");
    actions = (block && Array.isArray(block.input.actions)) ? block.input.actions : [];
    responseLog = JSON.stringify(block ? block.input : null);
  } catch (e) {
    await run(`UPDATE agent_runs SET status='failed', finished_at=NOW(), error=? WHERE id=?`,
      [String(e && e.message || e).slice(0, 400), runId]);
    return { runId, status: "failed", error: "model_failed" };
  }

  // Every prompt and response, kept per org (agentShape.PROMPT_RETENTION_DAYS).
  await run(`INSERT INTO ai_log (id,org_id,user_id,type,prompt_summary,prompt_full,response_full,run_id)
             VALUES (?,?,?,'agent',?,?,?,?)`,
    ["log_" + uuid().slice(0, 8), orgId, userId || null,
     String(instruction.text).slice(0, 100), promptLog.slice(0, 200000),
     responseLog.slice(0, 200000), runId]);

  const groundedValues = reachable.flatMap(p => [p.total_giving, p.gift_count, p.last_gift_amount])
    .map(Number).filter(Number.isFinite);

  let drafted = 0, done = 0, withheld = 0, declined = 0;
  const withheldReasons = [];
  const taken = [];

  await withTransaction(async (txClient) => {
    const ctx = { client: txClient, orgId, runId, instructionId: instruction.id, userId, today,
                  donorById: id => byId.get(id) || null };
    for (const a of actions) {
      // 1 · a tool with no executor is refused. A money tool has no executor.
      if (!AGENT_RUNNABLE.includes(a.tool)) { declined++; withheldReasons.push(`no such tool: ${a.tool}`); continue; }
      // 2 · a donor that is not this org's is nobody. The agent cannot name a
      //     person in another org because it was never handed one.
      if (a.donorId && !byId.has(a.donorId)) { declined++; withheldReasons.push("names somebody not in this organisation"); continue; }
      // 3 · A DRAFT THAT CANNOT CITE A ROW IS NOT PRODUCED.
      const cite = A.citationProblems(a, { knownRowIds });
      if (cite.length) { withheld++; withheldReasons.push(cite[0]); continue; }
      // 4 · no invented rule reaches a screen (shared/thresholds.js).
      const text = [a.body, a.note, a.title, a.label, a.subject].filter(Boolean).join(" \n ");
      const ungrounded = TH.ungroundedClaims(text, { groundedValues });
      if (ungrounded.length) { withheld++; withheldReasons.push(TH.ungroundedSentence(ungrounded)); continue; }

      const r = await AGENT_EXECUTORS[a.tool](ctx, a);
      if (r && r.skipped) { declined++; withheldReasons.push(r.skipped); continue; }
      if (r && r.drafted) drafted++;
      done++;
      taken.push({ tool: a.tool, donorId: a.donorId || null, cites: a.citesRows });
    }
  });

  await run(`UPDATE agent_runs SET status='done', finished_at=NOW(), actions=?, drafted=?, sent=0,
             declined=?, withheld=?, withheld_reason=? WHERE id=?`,
    [JSON.stringify(taken), drafted, declined, withheld,
     withheldReasons.slice(0, 5).join(" · ").slice(0, 600) || null, runId]);

  // NOTHING IS SENT BY THIS PATH. `sent` is written as 0 above, deliberately
  // and unconditionally: the signed-for-sending half is still open,
  // because sending needs a Resend key that is currently an invalid sentinel by
  // deliberate incident containment, and shipping a send path that has never
  // once been walked is exactly the mistake that caused the incident.
  return { runId, status: "done", done, drafted, withheld, declined, sent: 0,
           withheldReason: withheldReasons.slice(0, 5) };
}

// ── ROUTES ─────────────────────────────────────────────────────────────────
// THE PLAN. Writes an instruction and a plan; runs NOTHING.
app.post("/agent/instructions", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "An instruction needs words." });
  if (text.length > 2000) return res.status(400).json({ error: "That instruction is too long to plan from." });

  // THE MONEY REFUSAL COMES FIRST, before the gate and before the model. It is
  // a sentence, not a route: "refund Margaret" is told no and told why, never
  // quietly turned into a task for somebody else, because a silent reroute
  // teaches her the instruction worked and she finds out it did not when
  // Margaret rings up.
  const money = A.moneyRefusal(text);
  if (money) return res.status(400).json({ error: "money_instruction", sentence: money.sentence, matched: money.matched });

  const gate = await agentGate(req.user.orgId);
  if (!gate.ok) return res.status(503).json({ error: gate.reason });

  const kind = req.body?.kind === A.KIND_STANDING ? A.KIND_STANDING : A.KIND_TASK;
  const trigger = kind === A.KIND_STANDING ? String(req.body?.trigger || "") : null;
  if (kind === A.KIND_STANDING && !A.TRIGGER_KEYS.includes(trigger))
    return res.status(400).json({ error: "A standing instruction needs to say when it runs." });

  // The flip is HERS and it is per instruction. It is read from the body, and
  // the DATABASE default is 'draft', so an instruction that arrives without one
  // drafts.
  const auth = req.body?.authorization === A.AUTH_SEND ? A.AUTH_SEND : A.AUTH_DRAFT;

  let built;
  try { built = await agentBuildPlan(req.user.orgId, text, { authorization: auth }); }
  catch (e) { console.error("[agent] plan failed", e?.message || e); return res.status(503).json({ error: "agent_unavailable" }); }

  const check = A.validatePlan(built.plan, { authorization: auth });
  if (!check.ok) return res.status(422).json({ error: "plan_refused", reasons: check.errors });

  const id = "ai_" + uuid().slice(0, 10);
  await run(`INSERT INTO agent_instructions (id,org_id,text,kind,trigger,status,send_authorization,plan,last_count,created_by,created_by_name)
             VALUES (?,?,?,?,?,'planned',?,?,?,?,?)`,
    [id, req.user.orgId, text, kind, trigger, auth, JSON.stringify(built.plan),
     built.plan.expectedCount || 0, actor(req).id, actor(req).name]);

  res.status(201).json({ id, kind, trigger, authorization: auth, plan: built.plan,
    // A standing instruction is never retroactive, and the screen says so with
    // the count it would have caught — so she can do those by hand rather than
    // find the gap in March (BUILD-94's enrolment rule, carried over).
    retroactive: kind === A.KIND_STANDING
      ? { none: true, sentence: "This starts from today. It will not reach back over people who already qualified." }
      : null });
}));

// SHE CONFIRMS THE PLAN. This is the only thing that runs work.
app.post("/agent/instructions/:id/confirm", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const [ins] = await query("SELECT * FROM agent_instructions WHERE id=? AND org_id=?",
    [req.params.id, req.user.orgId]);
  if (!ins) return res.status(404).json({ error: "Instruction not found" });
  const gate = await agentGate(req.user.orgId);
  if (!gate.ok) return res.status(503).json({ error: gate.reason });

  // "SHE TURNED IT ON" HAS TO BE TRUE. A super-admin may build an instruction
  // inside her org and leave it planned; only somebody who works there can
  // confirm it. BUILD-94's rule, carried over verbatim.
  if (req.user.isSuperAdmin) return res.status(403).json({ error: "turn_on_must_be_theirs",
    sentence: "Turning this on has to be done by somebody at this organisation." });

  await run(`UPDATE agent_instructions SET status='active', turned_on_by=?, turned_on_by_name=?,
             turned_on_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`,
    [actor(req).id, actor(req).name, ins.id, req.user.orgId]);

  const plan = typeof ins.plan === "string" ? JSON.parse(ins.plan || "null") : ins.plan;
  const result = await agentRunPlan(req.user.orgId,
    { id: ins.id, text: ins.text, plan, authorization: ins.send_authorization },
    { userId: req.user.userId });

  if (ins.kind === A.KIND_TASK)
    await run("UPDATE agent_instructions SET status='done' WHERE id=? AND org_id=?", [ins.id, req.user.orgId]);

  res.json(result);
}));

app.get("/agent/instructions", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, text, kind, trigger, status, send_authorization, plan, created_at,
            turned_on_by_name, turned_on_at, paused_at
       FROM agent_instructions WHERE org_id=? ORDER BY created_at DESC LIMIT 200`,
    [req.user.orgId]);
  const [org] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ instructions: rows, pausedAll: !!(org && org.agent_paused_at) });
}));

// PAUSE ANY INSTRUCTION WITH ONE BUTTON.
app.post("/agent/instructions/:id/pause", requireAuth, wrap(async (req, res) => {
  const r = await run(`UPDATE agent_instructions SET status='paused', paused_at=NOW(), paused_by=?
                       WHERE id=? AND org_id=?`, [actor(req).id, req.params.id, req.user.orgId]);
  if (r && r.changes === 0) return res.status(404).json({ error: "Instruction not found" });
  res.json({ ok: true, paused: true });
}));

app.post("/agent/instructions/:id/resume", requireAuth, wrap(async (req, res) => {
  const r = await run(`UPDATE agent_instructions SET status='active', paused_at=NULL, paused_by=NULL
                       WHERE id=? AND org_id=? AND status='paused'`, [req.params.id, req.user.orgId]);
  if (r && r.changes === 0) return res.status(404).json({ error: "Instruction not found" });
  res.json({ ok: true, paused: false });
}));

// PAUSE ALL — one switch on the ORG, because "stop everything" that works by
// updating N rows can half-fail.
app.post("/agent/pause-all", requireAuth, wrap(async (req, res) => {
  await run("UPDATE orgs SET agent_paused_at=NOW(), agent_paused_by=? WHERE id=?",
    [actor(req).id, req.user.orgId]);
  res.json({ ok: true, pausedAll: true });
}));
app.post("/agent/resume-all", requireAuth, wrap(async (req, res) => {
  await run("UPDATE orgs SET agent_paused_at=NULL, agent_paused_by=NULL WHERE id=?", [req.user.orgId]);
  res.json({ ok: true, pausedAll: false });
}));

// ── ONE ACTIVITY SCREEN ────────────────────────────────────────────────────
// Every instruction, every run, every write with its undo. Nothing the agent
// does is hidden from the person who asked for it.
app.get("/agent/activity", requireAuth, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const runs = await query(
    `SELECT r.id, r.instruction_id, r.started_at, r.finished_at, r.status, r.read_summary,
            r.drafted, r.sent, r.declined, r.withheld, r.withheld_reason, r.error,
            i.text AS instruction_text, i.kind
       FROM agent_runs r LEFT JOIN agent_instructions i ON i.id = r.instruction_id
      WHERE r.org_id=? ORDER BY r.started_at DESC LIMIT 50`, [req.user.orgId]);
  const writes = await query(
    `SELECT w.id, w.run_id, w.tool, w.entity_table, w.entity_id, w.cites, w.created_at,
            w.undone_at, w.undone_by_name
       FROM agent_writes w WHERE w.org_id=?
      ORDER BY w.created_at DESC LIMIT 300`, [req.user.orgId]);
  const cutoff = Date.now() - A.UNDO_DAYS * 86400000;
  const [counts] = await query(
    `SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending FROM agent_drafts WHERE org_id=?`,
    [req.user.orgId]);
  res.json({
    runs,
    writes: writes.map(w => ({ ...w,
      // Undoable while it is inside the window AND has not already been undone.
      undoable: !w.undone_at && new Date(w.created_at).getTime() >= cutoff })),
    undoDays: A.UNDO_DAYS,
    draftsWaiting: (counts && counts.pending) || 0,
  });
}));

// UNDO ANY AGENT WRITE, FOR THIRTY DAYS.
app.post("/agent/writes/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const [w] = await query("SELECT * FROM agent_writes WHERE id=? AND org_id=?",
    [req.params.id, req.user.orgId]);
  if (!w) return res.status(404).json({ error: "Not found" });
  if (w.undone_at) return res.status(409).json({ error: "already_undone" });
  const age = Date.now() - new Date(w.created_at).getTime();
  if (age > A.UNDO_DAYS * 86400000)
    return res.status(409).json({ error: "outside_undo_window", days: A.UNDO_DAYS });
  const r = await agentUndoWrite(w, req.user.orgId);
  if (!r.ok) return res.status(409).json({ error: r.reason });
  await run("UPDATE agent_writes SET undone_at=NOW(), undone_by=?, undone_by_name=? WHERE id=? AND org_id=?",
    [actor(req).id, actor(req).name, w.id, req.user.orgId]);
  res.json({ ok: true, ...r });
}));

// The drafts the agent wrote, waiting for her.
app.get("/agent/drafts", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT a.id, a.donor_id, a.subject, a.body, a.cites, a.status, a.created_at, d.name AS donor_name
       FROM agent_drafts a JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
      WHERE a.org_id=? AND a.status='pending' ORDER BY a.created_at DESC LIMIT 200`,
    [req.user.orgId]);
  res.json({ drafts: rows });
}));

// The daily line, for Home and the morning email.
app.get("/agent/daily-line", requireAuth, wrap(async (req, res) => {
  // BUILD-96 Part 3 — the box on Home asks this first, so a gated org gets one
  // sentence instead of an input that answers 503 when she presses it.
  const gate = await aiGate(req.user.orgId);
  if (!gate.ok) {
    return res.json({
      available: false,
      reason: gate.reason,
      line: null,
      message: gate.reason === "ai_disabled"
        ? "Steward's drafting is turned off for this organisation."
        : "Not enabled for this organization yet.",
    });
  }
  const A = await agentShapeMod();
  const [row] = await query(
    `SELECT COALESCE(SUM(drafted),0)::int AS drafted, COALESCE(SUM(sent),0)::int AS sent,
            COUNT(*)::int AS runs
       FROM agent_runs WHERE org_id=? AND started_at >= NOW() - INTERVAL '1 day'`, [req.user.orgId]);
  const [w] = await query(
    `SELECT COUNT(*)::int AS n FROM agent_writes WHERE org_id=? AND created_at >= NOW() - INTERVAL '1 day'`,
    [req.user.orgId]);
  const [d] = await query(
    `SELECT COUNT(*)::int AS n FROM agent_drafts WHERE org_id=? AND status='pending'`, [req.user.orgId]);
  res.json({ available: true,
             line: A.dailyLine({ did: (w && w.n) || 0, sent: (row && row.sent) || 0, waiting: (d && d.n) || 0 }),
             did: (w && w.n) || 0, sent: (row && row.sent) || 0, waiting: (d && d.n) || 0 });
}));

// How many people WOULD have been enrolled had this been on all year. Shown at
// the moment of turning it on, so she can decide to enroll them by hand rather
// than discovering the gap months later.
async function retroactiveCount(orgId, triggerKey) {
  const since = "NOW() - INTERVAL '365 days'";
  if (triggerKey === "first_gift") {
    const [r] = await query(
      `SELECT COUNT(*)::int AS n FROM donors d
        WHERE d.org_id = ? AND d.deleted_at IS NULL AND ${donorOnly("d")}
          AND d.first_gift_date IS NOT NULL AND d.first_gift_date::date >= (${since})::date`, [orgId]);
    return r ? r.n : 0;
  }
  if (triggerKey === "first_recurring") {
    const [r] = await query(
      `SELECT COUNT(DISTINCT donor_id)::int AS n FROM recurring_subscriptions
        WHERE org_id = ? AND created_at >= ${since}`, [orgId]);
    return r ? r.n : 0;
  }
  if (triggerKey === "added_volunteer") {
    const [r] = await query(
      `SELECT COUNT(*)::int AS n FROM donors
        WHERE org_id = ? AND deleted_at IS NULL AND person_types @> '["volunteer"]'::jsonb
          AND created_at >= ${since}`, [orgId]);
    return r ? r.n : 0;
  }
  return 0;
}

// ── Sequence routes ─────────────────────────────────────────────────────────

// ══ BUILD-94 Part 3 — the tracked-sequence routes ══════════════════════════
// SETUP FOR JUSTIN'S PLACE IS BY HAND AND IS JONATHAN'S. A super-admin can
// build a sequence inside her org and leave it OFF for her to read and turn
// on. NOTHING TURNS ON WITHOUT A USER IN HER ORG PRESSING IT — the turn-on
// route refuses a super-admin acting across orgs, by design, and says why.

// Everything a screen needs to build one: the closed trigger set, the track
// rules in the order they are tried, the merge fields (including this org's
// OWN custom fields), and whether this org may run sequences at all.
app.get("/sequences/builder", requireAuth, wrap(async (req, res) => {
  await SEQ_READY;
  const gate = await sequenceTimezoneGate(req.user.orgId);
  const defs = await query(
    `SELECT key, label FROM custom_field_defs WHERE org_id=? AND entity='donor' AND archived_at IS NULL ORDER BY label`,
    [req.user.orgId]).catch(() => []);
  const funds = await query(`SELECT DISTINCT name FROM fin_funds WHERE org_id=? ORDER BY name`, [req.user.orgId]).catch(() => []);
  res.json({
    triggers: SEQ.TRIGGERS,
    trackRules: SEQ.TRACK_RULE_KINDS.map(r => ({ key: r.key, label: r.label })),
    mergeFields: [...SEQ.MERGE_FIELDS, ...defs.map(d => ({ key: d.key, label: d.label, custom: true }))],
    stops: SEQ.STOPS,
    stopNote: SEQ.STOP_NOT_A_STOP,
    sendWindow: SEQ.SEND_WINDOW,
    funds: funds.map(f => f.name),
    timezone: gate.timezone,
    canRun: gate.ok,
    // NO TIMEZONE ON FILE, NO SEQUENCES — AND THE SCREEN SAYS WHY.
    blockedReason: gate.ok ? null : gate.message,
  });
}));

// Create or replace a whole sequence — tracks and steps together, because a
// track without its steps is a sequence that enrolls people and sends nothing.
async function writeTrackedSequence(req, res, existingId) {
  await SEQ_READY;
  const orgId = req.user.orgId;
  const body = req.body || {};
  const defs = await query(
    `SELECT key FROM custom_field_defs WHERE org_id=? AND entity='donor' AND archived_at IS NULL`, [orgId]).catch(() => []);
  const seq = {
    name: String(body.name || "").trim(),
    trigger: body.trigger,
    tracks: Array.isArray(body.tracks) ? body.tracks : [],
    steps: Array.isArray(body.steps) ? body.steps : [],
    customFieldKeys: defs.map(d => d.key),
  };
  const v = SEQ.validateSequence(seq);
  // A sequence that cannot be turned on says so BEFORE she tries.
  if (!v.ok) return res.status(400).json({ error: "invalid_sequence", problems: v.problems });

  const id = existingId || ("seq_" + uuid().slice(0, 8));
  const a = actor(req);
  if (existingId) {
    const r = await run(
      `UPDATE sequences SET name=?, trigger=?, tracks=?::jsonb WHERE id=? AND org_id=?`,
      [seq.name, seq.trigger, JSON.stringify(seq.tracks), id, orgId]);
    if (!r.changes) return res.status(404).json({ error: "Sequence not found" });
    await run(`DELETE FROM sequence_steps WHERE sequence_id=?`, [id]);
  } else {
    await run(
      // A NEW SEQUENCE IS OFF. Always. Turning it on is a separate, audited act
      // by a user in her org.
      `INSERT INTO sequences (id, org_id, name, trigger, status, tracks, created_by, created_by_name)
       VALUES (?,?,?,?, 'draft', ?::jsonb, ?, ?)`,
      [id, orgId, seq.name, seq.trigger, JSON.stringify(seq.tracks), a.id, a.name]);
  }
  // step_order is PER TRACK, not global. The engine reads a track's steps and
  // indexes into them, and sequence_sends keys idempotency on (sequence,
  // person, step_order) — a global counter would make "step 2" mean a
  // different thing on each track and read wrong on the timeline.
  const perTrack = {};
  for (const s2 of seq.steps) {
    const k = s2.trackKey;
    const order = (perTrack[k] = (perTrack[k] === undefined ? 0 : perTrack[k] + 1));
    await run(
      `INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body, track_key, send_even_after_gift)
       VALUES (?,?,?,?,?,?,?,?)`,
      ["sstep_" + uuid().slice(0, 8), id, order, parseInt(s2.dayOffset, 10) || 0,
       String(s2.subject), String(s2.body), k, s2.sendEvenAfterGift === true]);
  }
  const [row] = await query(`SELECT * FROM sequences WHERE id=?`, [id]);
  res.status(existingId ? 200 : 201).json({ ...row, steps: seq.steps, tracks: seq.tracks });
}

app.post("/sequences/tracked", requireAuth, requireAdmin, checkWriteAccess, wrap((req, res) => writeTrackedSequence(req, res, null)));
app.put("/sequences/tracked/:id", requireAuth, requireAdmin, checkWriteAccess, wrap((req, res) => writeTrackedSequence(req, res, req.params.id)));

app.get("/sequences/tracked/:id", requireAuth, wrap(async (req, res) => {
  const [seq] = await query(`SELECT * FROM sequences WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!seq) return res.status(404).json({ error: "Sequence not found" });
  const steps = await query(`SELECT * FROM sequence_steps WHERE sequence_id=? ORDER BY step_order ASC`, [seq.id]);
  const enr = await query(
    `SELECT status, COUNT(*)::int AS n FROM sequence_enrollments WHERE sequence_id=? GROUP BY status`, [seq.id]);
  res.json({ ...seq, steps, enrollments: Object.fromEntries(enr.map(e => [e.status, e.n])) });
}));

// WHAT SHE SEES BEFORE SHE TURNS IT ON. The retroactive count is the whole
// point of this route: enrollment is never retroactive, and the moment to say
// so is the moment of turning it on, with the number attached.
app.get("/sequences/tracked/:id/turn-on-preview", requireAuth, wrap(async (req, res) => {
  await SEQ_READY;
  const [seq] = await query(`SELECT * FROM sequences WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!seq) return res.status(404).json({ error: "Sequence not found" });
  const gate = await sequenceTimezoneGate(req.user.orgId);
  const n = await retroactiveCount(req.user.orgId, seq.trigger);
  res.json({
    canTurnOn: gate.ok,
    blockedReason: gate.ok ? null : gate.message,
    timezone: gate.timezone,
    retroactiveCount: n,
    retroactiveSentence: SEQ.retroactiveSentence(n, seq.trigger),
    stopNote: SEQ.STOP_NOT_A_STOP,
  });
}));

app.post("/sequences/tracked/:id/turn-on", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  await SEQ_READY;
  const [seq] = await query(`SELECT * FROM sequences WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!seq) return res.status(404).json({ error: "Sequence not found" });
  const gate = await sequenceTimezoneGate(req.user.orgId);
  if (!gate.ok) return res.status(400).json({ error: "no_timezone", message: gate.message });
  // NOTHING TURNS ON WITHOUT A USER IN HER ORG PRESSING IT. Allie asked
  // Jonathan to set it up, and he can — build it, write nothing, leave it off.
  // But a SUPER-ADMIN account may not be the one that flips it, because "she
  // turned it on" is the sentence the whole relaxed rule rests on, and it has
  // to be true. Enforced, not remembered.
  const [me] = await query("SELECT is_super_admin FROM users WHERE id = ?", [req.user.userId]);
  if (me && me.is_super_admin === true) {
    return res.status(403).json({
      error: "not_yours_to_turn_on",
      message: "A sequence is turned on by someone at the organisation, not by Steward. " +
               "Build it, leave it off, and let them read it and press it.",
    });
  }
  const a = actor(req);
  // The ACTOR stamp is the email (BUILD-75's convention, and it stays that).
  // `turned_on_by_name` is a DISPLAY string that ends up on a person's
  // timeline — "turned on by allie@justinsplace.org on 3 Oct" is a database
  // row talking, and "turned on by Allie Barnett" is a person.
  const [meRow] = await query("SELECT name, email FROM users WHERE id = ?", [req.user.userId]);
  const display = (meRow && String(meRow.name || "").trim()) || a.name;
  await run(
    `UPDATE sequences SET status='active', turned_on_by=?, turned_on_by_name=?, turned_on_at=NOW(), turned_off_at=NULL
      WHERE id=? AND org_id=?`, [a.id, display, seq.id, req.user.orgId]);
  res.json({ ok: true, status: "active", turnedOnBy: display });
}));

// TURNING IT OFF LEAVES THE ENROLLED WHERE THEY ARE AND SENDS NOTHING FURTHER.
// Not "cancels them" — she may turn it back on, and losing where five people
// were is not recoverable.
app.post("/sequences/tracked/:id/turn-off", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const r = await run(`UPDATE sequences SET status='paused', turned_off_at=NOW() WHERE id=? AND org_id=?`,
    [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Sequence not found" });
  res.json({ ok: true, status: "paused" });
}));

// THE PREVIEW RENDERS THE REAL EMAIL FOR A NAMED REAL PERSON, not a sample.
// A sample proves the template parses; a real person proves the sentence reads
// right with THEIR gift in it, which is the only thing worth checking.
app.get("/sequences/tracked/:id/preview", requireAuth, wrap(async (req, res) => {
  await SEQ_READY;
  const orgId = req.user.orgId;
  const [seq] = await query(`SELECT * FROM sequences WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!seq) return res.status(404).json({ error: "Sequence not found" });
  const steps = await query(`SELECT * FROM sequence_steps WHERE sequence_id=? ORDER BY step_order ASC`, [seq.id]);
  let donor = null;
  if (req.query.donorId) {
    [donor] = await query(`SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.query.donorId, orgId]);
  }
  if (!donor) {
    // The most recent real giver, so the preview is never a fiction.
    [donor] = await query(
      `SELECT * FROM donors d WHERE d.org_id=? AND d.deleted_at IS NULL AND ${donorOnly("d")}
         AND d.email IS NOT NULL AND d.email <> '' ORDER BY d.last_gift_date DESC NULLS LAST LIMIT 1`, [orgId]);
  }
  if (!donor) return res.json({ person: null, steps: [], note: "There is nobody with an email address to preview against yet." });
  const values = await sequenceMergeValues(donor, orgId);
  const trackKey = req.query.trackKey || null;
  const shown = trackKey ? steps.filter(s => s.track_key === trackKey) : steps;
  res.json({
    person: { id: donor.id, name: donor.name, email: donor.email },
    steps: shown.map(s => {
      const subj = SEQ.renderMerge(s.subject, values);
      const body = SEQ.renderMerge(s.body, values);
      return {
        stepOrder: s.step_order, trackKey: s.track_key, dayOffset: s.delay_days,
        subject: subj.text, body: body.text,
        sendEvenAfterGift: s.send_even_after_gift === true,
        // A field that renders blank is named, not hidden — a blank in a
        // preview is the one thing she can still fix.
        missing: [...new Set([...subj.missing, ...body.missing])],
      };
    }),
  });
}));

// Enroll one person by hand, from their profile. The fourth trigger, and the
// only one a human fires.
app.post("/sequences/tracked/:id/enroll/:donorId", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await SEQ_READY;
  const orgId = req.user.orgId;
  const [seq] = await query(`SELECT * FROM sequences WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!seq) return res.status(404).json({ error: "Sequence not found" });
  if (seq.status !== "active") return res.status(400).json({ error: "not_on", message: "Turn the sequence on first." });
  const [d] = await query(
    `SELECT id, last_gift_amount, stripe_subscription_status FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
    [req.params.donorId, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const r = await enrollInSequences(orgId, d.id, seq.trigger, {
    amount: Number(d.last_gift_amount) || null,
    recurring: !!d.stripe_subscription_status,
  }, actor(req));
  // A manual enrollment on a sequence whose trigger is not "manual" still
  // works — that IS the manual trigger, and refusing it would make the button
  // on the profile a lie.
  if (!r.enrolled && seq.trigger !== "manual") {
    await enrollOneManually(orgId, seq, d, actor(req));
  }
  res.json({ ok: true });
}));

async function enrollOneManually(orgId, seq, donor, a) {
  await SEQ_READY;
  const tracks = Array.isArray(seq.tracks) ? seq.tracks : JSON.parse(seq.tracks || "[]");
  const track = SEQ.chooseTrack(tracks, {
    amount: Number(donor.last_gift_amount) || null,
    recurring: !!donor.stripe_subscription_status,
  });
  if (!track) return;
  const steps = await query(
    `SELECT delay_days FROM sequence_steps WHERE sequence_id=? AND track_key=? ORDER BY step_order ASC LIMIT 1`,
    [seq.id, track.key]);
  if (!steps.length) return;
  const [dc] = await query(`SELECT gift_count FROM donors WHERE id=?`, [donor.id]);
  await run(
    `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at,
       track_key, enrolled_by, enrolled_by_name, gift_count_at_enroll)
     VALUES (?,?,?,?,0,'active', NOW() + INTERVAL '${parseInt(steps[0].delay_days, 10) || 0} days', ?,?,?,?)
     ON CONFLICT (sequence_id, donor_id) DO NOTHING`,
    ["se_" + uuid().slice(0, 8), seq.id, orgId, donor.id, track.key, a?.id || "system:sequence", a?.name || null,
     dc ? Number(dc.gift_count || 0) : null]);
}

// Remove someone from a sequence — the fourth STOP, and the one a human fires.
app.delete("/sequences/tracked/:id/enroll/:donorId", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // 404 IS THE ONE ANSWER for anything not in this org (BUILD-75 §3). The
  // first version answered 200 with removed:0 whatever it was handed, which
  // is a 200 on another tenant's resource — it tells a prober the id exists
  // somewhere, and the tenant matrix caught it before it shipped.
  const [enr] = await query(
    `SELECT id FROM sequence_enrollments WHERE sequence_id=? AND donor_id=? AND org_id=?`,
    [req.params.id, req.params.donorId, req.user.orgId]);
  if (!enr) return res.status(404).json({ error: "Not found" });
  const r = await run(
    `UPDATE sequence_enrollments SET status='stopped', stop_reason='removed', completed_at=NOW()
      WHERE id=? AND status='active'`, [enr.id]);
  res.json({ ok: true, removed: r.changes || 0 });
}));

// ONE LINE PER SEQUENCE, for Home. A failure is the end of the sentence, where
// she is already looking (BUILD-37 H2 — never swallowed).
app.get("/sequences/home", requireAuth, wrap(async (req, res) => {
  await SEQ_READY;
  const orgId = req.user.orgId;
  const gate = await sequenceTimezoneGate(orgId);
  const seqs = await query(
    `SELECT id, name, status, turned_on_by_name FROM sequences
      WHERE org_id=? AND tracks IS NOT NULL ORDER BY name`, [orgId]);
  const lines = [];
  for (const s of seqs) {
    const [counts] = await query(
      `SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,
              MIN(next_send_at) FILTER (WHERE status='active') AS next_at
         FROM sequence_enrollments WHERE sequence_id=?`, [s.id]);
    const [f] = await query(
      `SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=? AND status='failed'`, [s.id]);
    const nextCivil = counts?.next_at ? new Date(counts.next_at).toISOString().slice(0, 10) : null;
    lines.push({
      id: s.id, name: s.name, status: s.status,
      activeCount: counts?.active || 0, nextSend: nextCivil, failedCount: f?.n || 0,
      line: SEQ.homeSequenceLine({ name: s.name, activeCount: counts?.active || 0,
                                   nextSendCivil: nextCivil, failedCount: f?.n || 0 }),
    });
  }
  res.json({ sequences: lines, canRun: gate.ok, blockedReason: gate.ok ? null : gate.message });
}));

// The ops/test hook — drives the tracked engine for the caller's org NOW.
app.post("/sequences/tracked/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  // THE CLOCK IS A PARAMETER, and only under TEST_MODE. The send window is
  // weekday mornings, so a suite that drives this route at 3pm on a Saturday
  // correctly sends nothing — and would then fail for a reason that has
  // nothing to do with the code. Pinning the clock is how a clock-dependent
  // golden stays honest (the alternative, synchronising the assertion to
  // "whatever the window says right now", tests nothing).
  // Production never sends `now`; the tick calls the function with none.
  const pinned = (process.env.TEST_MODE === "1" && req.body && req.body.now) ? new Date(req.body.now) : undefined;
  res.json(await processTrackedSequences({
    orgId: req.user.orgId,
    ...(pinned && !isNaN(pinned) ? { now: pinned } : {}),
  }));
}));

app.post("/sequences/process", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processSequences();
  await autoEnroll();
  res.json({ success: true });
}));

app.get("/sequences", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT s.*,
     (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = s.id) AS step_count,
     (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') AS active_enrollments
     FROM sequences s
     WHERE s.org_id = ?
     ORDER BY s.created_at DESC`,
    [req.user.orgId]
  );
  res.json(rows);
}));

app.post("/sequences", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { name, trigger, triggerStage, steps = [] } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const id = "seq_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO sequences (id, org_id, name, trigger, trigger_stage, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, req.user.orgId, name, trigger || "manual", triggerStage || null, actor(req).id, actor(req).name]
  );
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await run(
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?, ?, ?, ?, ?, ?)",
      ["ss_" + uuid().slice(0, 8), id, i + 1, parseInt(s.delayDays || 0, 10), s.subject || "", s.body || ""]
    );
  }
  const created = await query("SELECT * FROM sequences WHERE id = ?", [id]);
  res.status(201).json(created[0]);
}));

app.get("/sequences/:id/steps", requireAuth, wrap(async (req, res) => {
  const seq = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!seq.length) return res.status(404).json({ error: "Not found" });
  const steps = await query("SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC", [req.params.id]);
  res.json(steps);
}));

app.get("/sequences/:id/enrollments", requireAuth, wrap(async (req, res) => {
  const seq = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!seq.length) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT se.*, d.name AS donor_name, d.email AS donor_email,
     (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = se.sequence_id) AS total_steps
     FROM sequence_enrollments se
     JOIN donors d ON se.donor_id = d.id AND d.org_id = ?
     WHERE se.sequence_id = ? AND se.org_id = ?
     ORDER BY se.enrolled_at DESC`,
    [req.user.orgId, req.params.id, req.user.orgId]
  );
  res.json(rows);
}));

// Enrolling a donor in a sequence from the profile is part of the Team
// portfolio/officer layer (donor-profile Core/Team split FIX). Viewing/CRUD of
// sequences in Communications is unaffected; only the per-donor enroll is gated.
app.post("/sequences/:id/enroll", requireAuth, requirePlan("team"), wrap(async (req, res) => {
  const { donorId } = req.body;
  if (!donorId) return res.status(400).json({ error: "donorId required" });
  const seq = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!seq.length) return res.status(404).json({ error: "Sequence not found" });
  const donorCheck = await query("SELECT id FROM donors WHERE id = ? AND org_id = ?", [donorId, req.user.orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  const existing = await query(
    "SELECT id, status FROM sequence_enrollments WHERE sequence_id = ? AND donor_id = ?",
    [req.params.id, donorId]
  );
  if (existing.length && existing[0].status === "active") return res.status(409).json({ error: "Already enrolled" });
  const steps = await query(
    "SELECT delay_days FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC LIMIT 1",
    [req.params.id]
  );
  const firstDelay = parseInt(steps[0]?.delay_days || 0, 10);
  if (existing.length) {
    await run(
      `UPDATE sequence_enrollments SET status='active', current_step=0, enrolled_at=NOW(), completed_at=NULL, next_send_at=NOW() + INTERVAL '${firstDelay} days' WHERE id=?`,
      [existing[0].id]
    );
  } else {
    const enrId = "se_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at)
       VALUES (?, ?, ?, ?, 0, 'active', NOW() + INTERVAL '${firstDelay} days')`,
      [enrId, req.params.id, req.user.orgId, donorId]
    );
  }
  res.json({ success: true });
}));

app.post("/sequences/:id/unenroll", requireAuth, wrap(async (req, res) => {
  const { donorId } = req.body;
  const { changes } = await run(
    "UPDATE sequence_enrollments SET status='unsubscribed' WHERE sequence_id=? AND donor_id=? AND org_id=?",
    [req.params.id, donorId, req.user.orgId]
  );
  if (!changes) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true });
}));

app.put("/sequences/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { name, trigger, triggerStage, status, steps } = req.body;
  const existing = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  await run(
    "UPDATE sequences SET name=?, trigger=?, trigger_stage=?, status=? WHERE id=? AND org_id=?",
    [name, trigger || "manual", triggerStage || null, status || "active", req.params.id, req.user.orgId]
  );
  if (Array.isArray(steps)) {
    await run("DELETE FROM sequence_steps WHERE sequence_id=?", [req.params.id]);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await run(
        "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?, ?, ?, ?, ?, ?)",
        ["ss_" + uuid().slice(0, 8), req.params.id, i + 1, parseInt(s.delayDays || 0, 10), s.subject || "", s.body || ""]
      );
    }
  }
  const updated = await query("SELECT * FROM sequences WHERE id = ?", [req.params.id]);
  res.json(updated[0]);
}));

app.patch("/sequences/:id/status", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { status } = req.body;
  if (!["active", "paused"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  const affected = await run(
    "UPDATE sequences SET status=? WHERE id=? AND org_id=?",
    [status, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
}));

app.delete("/sequences/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const existing = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  await run("DELETE FROM sequence_enrollments WHERE sequence_id=?", [req.params.id]);
  await run("DELETE FROM sequences WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// ── Workflow routes ─────────────────────────────────────────────────────────
app.get("/workflows", requireAuth, wrap(async (req, res) => {
  await ensureWorkflows(req.user.orgId);
  const rows = await query("SELECT * FROM workflows WHERE org_id=? ORDER BY created_at ASC", [req.user.orgId]);
  // Attach recent run counts + last run per workflow.
  const runCounts = await query(
    "SELECT workflow_id, COUNT(*)::int AS n, MAX(created_at) AS last FROM workflow_runs WHERE org_id=? GROUP BY workflow_id",
    [req.user.orgId]
  );
  const byWf = Object.fromEntries(runCounts.map(r => [r.workflow_id, r]));
  // BUILD-76 Part 7 (D.3 §2) — major_gift_alert gets an HONEST default
  // suggestion derived from the org's own file: the 95th percentile of the
  // trailing 12 months' gifts. Shown beside the config as a suggestion,
  // never silently applied.
  let suggestedThreshold = null;
  if (rows.some(w => w.recipe_key === "major_gift_alert")) {
    const yearAgo = orgTime.addDays(orgToday(await orgTz(req.user.orgId)), -365);   // ORG_TZ_SEAM_OK
    const pct = await query(
      `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY amount) AS p95, COUNT(*)::int AS n
         FROM gifts WHERE org_id = ? AND date >= ? AND amount > 0`,
      [req.user.orgId, yearAgo]);
    if ((pct[0]?.n || 0) >= 20 && pct[0].p95 != null) {
      suggestedThreshold = Math.round(parseFloat(pct[0].p95) / 50) * 50 || null;   // rounded to a sayable $50 step
    }
  }
  res.json(rows.map(w => ({
    ...w,
    conditions: asJson(w.conditions, []), actions: asJson(w.actions, []), config: asJson(w.config, {}),
    description: WORKFLOW_RECIPE_MAP[w.recipe_key]?.description || "",
    runCount: byWf[w.id]?.n || 0, lastRun: byWf[w.id]?.last || null,
    ...(w.recipe_key === "major_gift_alert" ? { suggestedThreshold } : {}),
  })));
}));

app.get("/workflows/:id/runs", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("workflows", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Workflow not found" });
  const runs = await query(
    "SELECT * FROM workflow_runs WHERE workflow_id=? AND org_id=? ORDER BY created_at DESC LIMIT 50",
    [req.params.id, req.user.orgId]
  );
  res.json(runs.map(r => ({ ...r, actions_taken: asJson(r.actions_taken, []) })));
}));

app.put("/workflows/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM workflows WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Workflow not found" });
  const { enabled, config } = req.body;
  const sets = [], params = [];
  if (enabled !== undefined) { sets.push("enabled=?"); params.push(!!enabled); }
  if (config !== undefined && config && typeof config === "object") {
    // Merge onto existing config; validate the two numeric knobs.
    const merged = { ...asJson(rows[0].config, {}), ...config };
    if (merged.threshold !== undefined) merged.threshold = Math.max(0, Number(merged.threshold) || 0);
    if (merged.lapseDays !== undefined) merged.lapseDays = Math.max(1, parseInt(merged.lapseDays, 10) || 365);
    if (merged.leadDays !== undefined) merged.leadDays = Math.max(1, parseInt(merged.leadDays, 10) || 14);   // BUILD-76 pledge_due_soon
    if (merged.notify !== undefined && !["ed", "owner", "both"].includes(merged.notify)) merged.notify = "both";
    sets.push("config=?"); params.push(JSON.stringify(merged));
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  sets.push("updated_at=NOW()");
  params.push(req.params.id, req.user.orgId);
  await run(`UPDATE workflows SET ${sets.join(", ")} WHERE id=? AND org_id=?`, params);
  const updated = await query("SELECT * FROM workflows WHERE id=?", [req.params.id]);
  const w = updated[0];
  res.json({ ...w, conditions: asJson(w.conditions, []), actions: asJson(w.actions, []), config: asJson(w.config, {}) });
}));

// Manual trigger for tests/ops — simulate one trigger event (admin-only).
app.post("/workflows/simulate", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { trigger, donorId, amount, isFirstGift, dedupKey } = req.body || {};
  if (!trigger) return res.status(400).json({ error: "trigger required" });
  if (donorId && !(await orgOwns("donors", donorId, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const result = await fireWorkflows(req.user.orgId, trigger, {
    dedupKey: dedupKey || `${trigger}:${donorId || "none"}:${Date.now()}`,
    donorId: donorId || null, amount, isFirstGift, entityType: donorId ? "donor" : null, entityId: donorId || null,
  });
  res.json(result);
}));

// Ops/test hook — run the donor_lapsed workflow sweep for the caller's org NOW
// (drives the exact scheduled path; same bar as /pipeline/run-auto-lapse and
// /sequences/process). Lets the P0 "imports fire zero workflows" guarantee be
// verified deterministically instead of waiting on the 5-min tick.
app.post("/workflows/run-sweeps", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processWorkflowSweeps(req.user.orgId);
  res.json({ success: true });
}));
}

module.exports = { routers, mount };
