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
// FIX-12 Part 3: the one door to a model (asks the org's AI switch on every call).
const { anthropicFor, AI_OFF_MESSAGE } = require("../aiClient");

const routers = {
  r0: express.Router(),
};

function mount(ctx) {
const {
  AGENT_MODEL, ALL_PIPELINE_STAGES, SEQ_READY, WORKFLOW_RECIPE_MAP, actor, agentGate, agentTrialAllowance,
  aiGate, asJson, autoEnroll, checkWriteAccess, donorOnly, enrollInSequences, ensureWorkflows,
  fireWorkflows, markVolunteer, orgOwns, orgTime, orgToday, orgTz, processSequences, processTrackedSequences,
  processWorkflowSweeps, query, recordGift, requireAdmin, requireAuth, requirePlan, run, runTx,
  sequenceMergeValues, sequenceTimezoneGate, thresholdsMod, uuid, withTransaction, wrap,
  requireSuperAdmin, resend,   // HELP-1
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
    if (!g.ok) return g.reason === "ai_disabled"
      ? res.status(403).json({ error: AI_OFF_MESSAGE, code: "ai_off", reason: g.reason })
      : res.status(503).json({ error: "ai_unavailable", reason: g.reason }); }

  await run(
    "INSERT INTO ai_log (id,org_id,user_id,type,prompt_summary) VALUES (?,?,?,?,?)",
    ["log_" + uuid().slice(0, 8), req.user.orgId, req.user.userId, "stream", userMessage.slice(0, 100)]
  );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const client = anthropicFor(req.user.orgId);
  const stream = await client.messages.stream({
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

// ── FIX-27 Part 7 · A DRAFTED EMAIL, CHECKED BEFORE SHE SEES IT ────────────
// Communications' "Draft with AI" (a campaign) and "Write with AI" (a
// sequence step) streamed the model's words straight into the editor. One
// draft said "I recorded a short video" with a watch link, for a video nobody
// recorded. Now the server writes the draft, checks every claim in it against
// the record (shared/suggestionGuard.js guardDraft: a video, a link, a gift
// amount, a date, a meeting, an event), and a draft that fails is the
// template sentence instead. A segment email has no one person behind it, so
// it may claim nothing personal; the merge tags carry their own facts.
const DRAFT_TEMPLATES = {
  campaign: { subject: "Thank you from {{org_name}}",
    body: "<p>Dear {{first_name}},</p><p>Thank you for your support of {{org_name}}. Your gifts keep this work going, and we are grateful for every one of them.</p><p>With thanks,</p>" },
  sequence: { subject: "Thank you from {{org_name}}",
    body: "Dear {{donor_name}},\n\nThank you for your support of {{org_name}}. We are glad to have you with us.\n\nWarmly," },
};
app.post("/ai/draft-email", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const purpose = b.purpose === "sequence" ? "sequence" : "campaign";
  const tpl = { ...DRAFT_TEMPLATES[purpose], ...(b.subjectHint ? { subject: String(b.subjectHint).slice(0, 200) } : {}) };
  const g = await aiGate(req.user.orgId);
  if (!g.ok) return res.json({ ...tpl, source: "template", aiOff: true, reasons: [g.reason === "ai_disabled" ? "AI is turned off for your organization." : "Drafting is not available right now."] });
  const [org] = await query("SELECT name, mission FROM orgs WHERE id=?", [req.user.orgId]);
  const DC = require("../draftCheck");
  const prompt = purpose === "campaign"
    ? `Write a donor email for ${org.name}.\nMission: ${org.mission || "serving our community"}\nSegment: ${JSON.stringify(b.segment || {}).slice(0, 600)}\nSubject hint: ${b.subjectHint || "(generate a compelling one)"}\n\nUse these merge tags: {{first_name}}, {{org_name}}, {{gift_amount}}, {{total_giving}}\n\nFormat: first line "Subject: [subject line]", blank line, then the email body as HTML <p> tags.`
    : `Write a fundraising email for ${org.name} (mission: ${org.mission || "serving our community"}).\nContext: ${String(b.context || "").slice(0, 300)}.\nThis is step ${Number(b.step) || 1} of a ${Number(b.steps) || 1}-step sequence.\n${b.subjectHint ? `Subject: ${String(b.subjectHint).slice(0, 200)}` : "Also generate a subject line: put it on the first line as 'Subject: ...' then the body."}\nUse {{donor_name}} to address them personally. Use {{org_name}} for the org name. Keep it under 150 words. Plain text only, no HTML.`;
  let text = "";
  try {
    const msg = await anthropicFor(req.user.orgId).messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 1024, thinking: { type: "disabled" },   // FIX-28: the ASK-3 rule
      system: "You are an expert nonprofit development writer. Write warm, authentic, mission-driven donor emails. Max 250 words. "
        + "Never mention a video, a recording, a link, a meeting, an event, a date or a gift amount: you do not know any. Use the merge tags for the facts.",
      messages: [{ role: "user", content: prompt }],
    });
    // FIX-28: a draft that did not finish is never shown; the template is.
    text = msg.stop_reason && msg.stop_reason !== "end_turn" ? "" : ((msg.content || []).find(x => x.type === "text") || {}).text || "";
  } catch (e) {
    if (e && e.code === "ai_off") return res.json({ ...tpl, source: "template", aiOff: true, reasons: ["AI is turned off for your organization."] });
    return res.json({ ...tpl, source: "template", reasons: ["The draft could not be written just now."] });
  }
  const lines = text.split("\n");
  const subj = (lines.find(l => /^Subject:/i.test(l)) || "").replace(/^Subject:\s*/i, "").trim();
  const body = lines.filter(l => !/^Subject:/i.test(l)).join("\n").trim();
  const chk = await DC.checkDraft(`${subj}\n${body}`, await DC.draftRecord(req.user.orgId, null));
  if (!chk.ok || !body) {
    console.warn(`[draft-email] fell back to the template: ${chk.reasons.join(" · ") || "empty"}`);
    return res.json({ ...tpl, source: "template", reasons: chk.reasons });
  }
  res.json({ subject: subj || tpl.subject, body, source: "ai", reasons: [] });
}));

// ── AI — CSV column mapping ────────────────────────────────────────────────
app.post("/ai/column-map", requireAuth, wrap(async (req, res) => {
  const { headers, sample } = req.body;
  if (!headers?.length) return res.status(400).json({ error: "headers required" });

  const client = anthropicFor(req.user.orgId);
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    thinking: { type: "disabled" },   // FIX-28: the ASK-3 rule
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
    if (msg.stop_reason && msg.stop_reason !== "end_turn") throw new Error("unfinished");   // FIX-28
    const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
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
// AGENTS-1 — the six personas, loaded the same way the shape module is. The
// registry is data: this file names no persona id anywhere.
async function agentPersonasMod() { return import("../shared/agentPersonas.js"); }

const AGENT_ACTOR = { id: "system:agent", name: "Steward (agent)" };

// ── WHAT THE AGENT IS ALLOWED TO SEE ───────────────────────────────────────
// The model gets the instruction, the org's vocabulary, and the rows STEWARD
// selected — never a database handle and never a query it wrote. This function
// is the entire surface, and it is org-scoped, capped, and excludes the people
// nothing may be drafted for.
async function agentReadPeople(orgId, { limit = 400, ids = null } = {}) {
  // FIX-1 §A — READS ARE SCOPED. `ids` is the people an instruction names (or
  // a run's steps name); null is the whole organisation, and only an
  // instruction that names nobody reads that. The walk's run "read 400
  // people" for an instruction about one foundation.
  const only = Array.isArray(ids) && ids.length ? ids.map(String) : null;
  return query(
    `SELECT d.id, d.name, d.email, d.kind, d.funder_type, d.stage, d.status, d.total_giving, d.gift_count,
            d.last_gift_date, d.last_gift_amount, d.deceased, d.do_not_contact, d.is_sample, d.person_types,
            d.first_gift_date, d.phone, d.household_id, d.assigned_to, d.assigned_to_name
       FROM donors d
      WHERE d.org_id = ? AND d.deleted_at IS NULL
        AND (?::text[] IS NULL OR d.id = ANY(?::text[]))
      ORDER BY d.total_giving DESC NULLS LAST, d.id
      LIMIT ?`, [orgId, only, only, Math.min(Number(limit) || 400, 1000)]);
}

// FIX-27 Part 2a · FIND_PEOPLE READS THE ONE FILTER. "Plan calls to everyone
// who gave to last year's spring appeal but not this year's": the model was
// shown the top 200 people by giving with no campaign on any row, and said so.
// Now the WHO in her words is read the way Show me reads a question
// (shared/showMe.js: the templates, then the model's filter form when the
// templates leave something over), checked against the shared rules
// (groups.js), and the people are the Donors list's own rows for that filter.
// The model never writes the filter's SQL and never sees anyone else.
// FIX-29: "a thank-you NOTE to…" takes the second noun too; it used to leave
// "note to every grant funder", which no filter reads, and the plan was made
// from everybody instead of the funders.
const AGENT_ACTION_LEAD = /^\s*(please\s+)?(plan|make|create|schedule|set up|add|draft|write|open|start|book|log|give me|build)\b[^.]*?\b(calls?|tasks?|notes?|emails?|letters?|thank[- ]?yous?|visits?|asks?|steps?|follow[- ]?ups?|meetings?|a call plan|call plan|plan)\b(\s+(notes?|letters?|emails?|calls?|cards?|messages?)\b)?\s*(to|for|with|of)?\s*(the\s+people\s+|people\s+)?/i;
// AI-FIX: the words with "Steward," (or "Hey Steward") taken off the front.
function agentUnaddressed(text) { return String(text || "").replace(/^\s*(hey |hi |ok |okay )?steward\s*[,:!-]?\s*/i, ""); }
// FIX-29: when a model call fails, she reads one plain sentence and no plan;
// the error itself goes to the log, never to her screen.
const AGENT_PLAN_FAILED = "Steward couldn't build that plan just now, so nothing was planned. Please try again in a minute.";
function agentPlanFailed(where, e) {
  console.error(`[agent] ${where} failed`, e && e.status ? e.status : "", (e && e.message) || e);
  return Object.assign(new Error("plan failed"), { refuse: { error: "plan_failed", sentence: AGENT_PLAN_FAILED } });
}
async function agentFindPeople(orgId, text, today, { client = null } = {}) {
  const SM = await import("../shared/showMe.js");
  const GR = require("../groups");
  // AI-FIX: "Steward, find donors…" is addressed to Steward; the name is not the ask.
  const said = agentUnaddressed(text);
  const FIND_LEAD = /^\s*(please\s+)?(find|show( me)?|list|pull up|look up|who are)\b\s*(me\s+)?(all\s+)?(the\s+)?/i;
  const who = said.replace(AGENT_ACTION_LEAD, "").replace(FIND_LEAD, "").replace(/[,;]?\s*(due|by|within|in the next)\b.*$/i, "").trim();
  if (!who || who === said.trim()) return null;
  const [events, campaigns] = await Promise.all([
    query(`SELECT id, name, date::text AS date FROM events WHERE org_id = ? ORDER BY date DESC LIMIT 200`, [orgId]),
    query(`SELECT id, name, start_date::text AS "startDate" FROM campaigns WHERE org_id = ? ORDER BY start_date DESC NULLS LAST LIMIT 200`, [orgId]),
  ]);
  const ctx = { today, events, campaigns };
  let spec = SM.templateSpec(who, ctx);
  // The model's form is asked only when her words name something the people
  // rows cannot show (a campaign, an event, an ask); every other instruction
  // is planned exactly as before.
  // AI-FIX: the model's form whenever the templates could not read every word
  // (it used to be asked only for a campaign, an event or an ask, so "in North
  // Carolina" fell through to a planner that had no states to look at).
  if ((spec.unsupported || !Object.keys(spec.rules).length) && client) {
    try {
      const out = await client.messages.create({ model: AGENT_MODEL, max_tokens: 600, tools: [SM.specTool()],
        tool_choice: { type: "tool", name: "filter_spec" }, messages: [{ role: "user", content: SM.specPrompt(who, ctx) }] });
      spec = SM.readToolSpec(out.content) || spec;
    } catch (e) {
      // AI off: the template's reading stands, and is refused below if it is
      // incomplete. FIX-29: any other failure (the API refusing the request)
      // is logged and stops the plan, because a find that quietly failed
      // plans for everybody instead of the people she named.
      if (!(e && e.code === "ai_off")) throw agentPlanFailed("find people", e);
    }
  }
  const chk = SM.checkSpec(spec, { normalizeRules: GR.normalizeRules, ruleKeys: GR.RULE_KEYS, events, campaigns });
  if (!chk.ok) {
    // ASK-4: words the donor list's filters cannot express ("came to the gala
    // and volunteered over ten hours") go to the query layer, people only.
    try { const q = await require("../askQuery").peopleForWords(orgId, who, client, AGENT_MODEL); if (q) return q; }
    catch (e) { if (!(e && e.code === "ai_off")) throw agentPlanFailed("query layer", e); }
    return null;
  }
  const f = await GR.buildDonorFilter(orgId, chk.rules);
  if (f.badRole || f.badStatus) return null;
  const rows = await query(`SELECT id FROM donors WHERE ${f.whereSql} ORDER BY ${f.orderBy} LIMIT 1001`, f.params);
  return { rules: chk.rules, words: SM.filterWords(chk.rules, ctx), ids: rows.map(r => r.id) };
}

// PARITY-1 Part F: THE GIFTS IN A WINDOW. Org-scoped, Steward's own query,
// never the model's: gifts dated from..to (civil, the org's calendar), on a
// live record, not sample, with a positive amount. `ids` narrows it to the
// people her words named.
async function agentReadGifts(orgId, win, ids = null) {
  const only = Array.isArray(ids) && ids.length ? ids.map(String) : null;
  return query(
    `SELECT g.id, g.donor_id, g.amount, g.date, d.name AS donor_name, d.deceased, d.do_not_contact, d.is_sample
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL AND COALESCE(g.is_sample, false) = false
        AND g.amount > 0 AND LEFT(g.date, 10) >= ? AND LEFT(g.date, 10) <= ?
        AND (?::text[] IS NULL OR g.donor_id = ANY(?::text[]))
      ORDER BY LEFT(g.date, 10), g.id
      LIMIT 1000`, [orgId, win.from, win.to, only, only]);
}

// "Create thank-you calls for every gift this week, due in a week." No model
// enumerates anything: the gifts are read, and the plan is one task per gift
// with the civil due date she will read before saying yes. Returns a plan, or
// { refuse } with the sentence to show.
async function agentGiftTaskPlan(orgId, shape, scope = null) {
  const A = await agentShapeMod();
  const D = await import("../shared/displayDate.js");
  const today = orgToday(await orgTz(orgId));
  const win = shape.window;
  const all = await agentReadGifts(orgId, win, scope);
  const gifts = all.filter(g => !g.deceased && !g.do_not_contact && !g.is_sample);
  const leftOut = all.length - gifts.length;
  const range = win.from === win.to ? D.displayDateShort(win.from, today)
    : `${D.displayDateShort(win.from, today)} to ${D.displayDateShort(win.to, today)}`;
  if (!gifts.length) return { refuse: { error: "nothing_to_do",
    sentence: `No gifts dated ${win.words} (${range}) are on file${leftOut ? `, apart from ${leftOut} from records that say not to contact them` : ""}, so there is nothing to make a task for.` } };
  if (gifts.length > A.MAX_PLAN_STEPS) return { refuse: { error: "too_many",
    sentence: `${gifts.length} gifts are dated ${win.words} (${range}). That is more tasks than one plan can show you before you say yes (${A.MAX_PLAN_STEPS}). Narrow the window and try again.` } };
  const due = shape.dueDays != null ? agentCivil(today, shape.dueDays) : null;
  const people = await agentReadPeople(orgId, { ids: [...new Set(gifts.map(g => g.donor_id))], limit: 1000 });
  const steps = gifts.map(g => {
    const day = String(g.date).slice(0, 10);
    return { tool: "create_task", donorId: g.donor_id, giftId: g.id, citesRows: [g.donor_id, g.id],
      title: A.giftTaskTitle(shape.kind, g.donor_name, Math.round(Number(g.amount) * 100), D.displayDateShort(day, today)),
      due: due ? due.ymd : null, dueDays: shape.dueDays, priority: "medium",
      detail: due ? `Due ${D.displayDateShort(due.ymd, today)}` : "No due date" };
  });
  const plan = A.compilePlan(steps, { people, reads: `the ${gifts.length} gift${gifts.length === 1 ? "" : "s"} dated ${win.words} (${range})` });
  plan.readIds = null;
  plan.readDetail = `Gifts dated ${range}, one task each`
    + (leftOut ? `. ${leftOut} left out: the record says not to contact them` : "");
  plan.giftWindow = { from: win.from, to: win.to, words: win.words };
  plan.confirmLabel = A.confirmLabel(plan);
  return plan;
}

// WHO AN INSTRUCTION NAMES. Only the records whose name appears in her words
// come back from the database (ids, names and kinds, nothing else), and
// agentShape.namedIn keeps the ones named by whole words. This is how "the
// Sunrise Foundation" reads one record instead of the organisation.
//
// FIX-3 B — and how "ada just became a volunteer" reads Ada: a record whose
// FIRST name is one of her words is a candidate too, and namedIn decides (whole
// tokens; an ordinary-word first name only when capitalised). When one name
// matches several records (two Adas) it is `ambiguous`, and the route asks
// which BEFORE planning. `pick` is her answer (one id, or one per ambiguous
// name): each must be one of the records its name matched, so it cannot reach
// another organisation's row.
async function agentNamedIn(orgId, text, pick = null) {
  const A = await agentShapeMod();
  const candidates = await query(
    `SELECT id, name, kind, funder_type FROM donors
      WHERE org_id = ? AND deleted_at IS NULL AND length(name) >= 3
        AND (position(lower(regexp_replace(name, '^the[[:space:]]+', '', 'i')) in lower(?)) > 0
             OR lower(substring(btrim(name) from '^[A-Za-z0-9]+')) = ANY(?::text[]))
      ORDER BY length(name) DESC, id LIMIT 200`, [orgId, String(text || ""), A.nameWords(text)]);
  const n = A.namedIn(text, candidates);
  let ids = n.ids, ambiguous = n.ambiguous, badPick = false;
  // One pick per ambiguous name ("Margaret and Robert" may need two).
  const picks = (Array.isArray(pick) ? pick : pick != null && pick !== "" ? [pick] : []).map(String).slice(0, 10);
  for (const one of picks) {
    const g = ambiguous.find(x => x.ids.includes(one));
    if (!g) { badPick = true; break; }
    ids = ids.filter(id => !g.ids.includes(id) || id === one);
    ambiguous = ambiguous.filter(x => x !== g);
  }
  return { scope: ids.length ? ids : null, candidates, ambiguous, badPick };
}

// WHICH ONE DID SHE MEAN? A question, not a plan: nothing is written. Each
// record says enough to tell them apart (email, last gift, roles).
async function agentWhich(orgId, group) {
  const V = await import("../shared/vocabulary.js");
  const D = await import("../shared/displayDate.js");
  const A = await agentShapeMod();
  const today = orgToday(await orgTz(orgId));
  const rows = await agentReadPeople(orgId, { ids: group.ids.slice(0, 12) });
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  const more = group.ids.length - rows.length;
  return {
    said: group.said,
    sentence: `More than one record is called ${group.said}. Which ${group.said} do you mean? Pick one and Steward will plan it for that record alone.`
      + (more > 0 ? ` ${more} more match; write the whole name to narrow it.` : ""),
    people: rows.map(p => {
      const types = Array.isArray(p.person_types) ? p.person_types : [];
      const bits = [];
      if (p.email) bits.push(p.email);
      bits.push(p.last_gift_date && Number(p.last_gift_amount) > 0
        ? `last gift ${A.formatCents(Math.round(Number(p.last_gift_amount) * 100))}, ${D.displayDateShort(String(p.last_gift_date).slice(0, 10), today)}`
        : "no gift on file");
      if (types.includes("volunteer")) bits.push("volunteer");
      return { id: p.id, name: p.name, giverWord: V.giverWordFor(p, null), detail: bits.join(" · ") };
    }),
  };
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
// AGENT-2: the screens' own routes (agentCall.js), and a route's refusal as a reason.
const AC = require("../agentCall");
const TLa = require("../timelineLine");   // WIRE-1-ADDENDUM: an approved draft lands on the timeline
function refusal(r) {
  const b = r.body || {};
  const said = b.sentence || b.message || (typeof b.error === "string" && b.error.length > 12 ? b.error : null);
  return said ? String(said).replace(/\.$/, "") : `Steward was refused (${r.status}${b.error ? ", " + b.error : ""})`;
}
const AGENT_EXECUTORS = {
  async draft_note(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const id = "adr_" + uuid().slice(0, 10);
    const thanks = step.purpose === "thank_you";
    const giftIds = Array.isArray(step.giftIds) ? step.giftIds.map(String) : [];
    // WIRE-1-ADDENDUM rule 7: A DRAFT LIVES ON THE PERSON. It used to be a row
    // in Drafts to review and nowhere else, so their profile said "Nothing is
    // open" beside four gifts "Not thanked yet". Now the same run puts it on
    // their Thread as the next step and on their timeline as a draft. One open
    // thread per person (threads_one_open): an open thank-you step is
    // relabelled to point at the draft; any other open step is left alone.
    const label = thanks ? "Thank-you draft ready, review and send" : "Draft ready, review and send";
    let threadId = null;
    const [open] = await require("../db").queryTx(ctx.client,
      "SELECT id, next_step_type, next_step_label FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL", [ctx.orgId, donor.id]);
    if (!open) {
      threadId = "thr_" + uuid().slice(0, 10);
      const r = await runTx(ctx.client,
        `INSERT INTO threads (id,org_id,donor_id,owner_id,next_step_type,next_step_label,due_date,opened_on,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        [threadId, ctx.orgId, donor.id, donor.assigned_to || ctx.userId || null, thanks ? "thank_you_note" : "follow_up", label,
         orgTime.addDays(ctx.today, 2), ctx.today, AGENT_ACTOR.id, AGENT_ACTOR.name]);
      if (r && r.changes === 0) threadId = null;
      else await agentWrite(ctx, { tool: "draft_note", table: "threads", entityId: threadId, before: null, after: { donor_id: donor.id }, cites: step.citesRows });
    } else if (["thank", "thank_you_note"].includes(open.next_step_type)) {
      threadId = open.id;
      await runTx(ctx.client, "UPDATE threads SET next_step_label=? WHERE id=? AND org_id=?", [label, open.id, ctx.orgId]);
      await agentWrite(ctx, { tool: "draft_note", table: "threads", entityId: open.id,
        before: { next_step_label: open.next_step_label }, after: { next_step_label: label }, cites: step.citesRows });
    }
    await runTx(ctx.client,
      `INSERT INTO agent_drafts (id,org_id,run_id,instruction_id,donor_id,subject,body,cites,gift_ids,thread_id,purpose)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, ctx.orgId, ctx.runId, ctx.instructionId || null, donor.id,
       String(step.subject || "").slice(0, 300), String(step.body || "").slice(0, 8000),
       JSON.stringify(step.citesRows || []), JSON.stringify(giftIds), threadId, thanks ? "thank_you" : null]);
    await agentWrite(ctx, { tool: "draft_note", table: "agent_drafts", entityId: id,
      before: null, after: { donor_id: donor.id }, cites: step.citesRows });
    // The timeline line (timelineLine.js's shape: type 'activity', keyed), in
    // this run's transaction so an undone or failed run leaves no line.
    const lineId = "i_" + uuid().slice(0, 10);
    await runTx(ctx.client,
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
       VALUES (?,?,?,'activity',?,?,?,?,?)`,
      [lineId, ctx.orgId, donor.id,
       `${thanks ? "Thank-you drafted" : "Note drafted"} by Steward, waiting for your review${step.subject ? `: "${String(step.subject).slice(0, 120)}"` : ""}.`,
       ctx.today, AGENT_ACTOR.id, AGENT_ACTOR.name,
       JSON.stringify({ line_key: `agent_draft:${id}`, agentDraftId: id, draft: true, giftIds })]);
    await agentWrite(ctx, { tool: "draft_note", table: "interactions", entityId: lineId, before: null, after: { donor_id: donor.id }, cites: step.citesRows });
    return { id, donorId: donor.id, drafted: true };
  },

  async create_task(ctx, step) {
    const donor = step.donorId ? ctx.donorById(step.donorId) : null;
    if (step.donorId && !donor) return { skipped: "unknown_donor" };
    const id = "task_" + uuid().slice(0, 10);
    // PARITY-1 Part F: `due` is a CIVIL DATE or nothing. The plan she read
    // carries the date it showed her; a step with only `dueDays` is resolved
    // here from the org's own today. Free text ("next Friday") is not a date
    // the task list can sort or call overdue, so it is dropped.
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(step.due || "")) ? String(step.due)
      : Number.isInteger(step.dueDays) && step.dueDays >= 0 && step.dueDays <= 365 ? orgTime.addDays(ctx.today, step.dueDays) : "";
    await runTx(ctx.client,
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,created_by,created_by_name)
       VALUES (?,?,?,?,?,'donor',0,?,?,?)`,
      [id, ctx.orgId, String(step.title || "Follow up").slice(0, 300), due,
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
    // AGENT-2: "Cultivate" is cultivate: the walk's "that stage does not
    // exist" was the capital letter.
    const to = String(step.stage || "").trim().toLowerCase();
    if (!ALL_PIPELINE_STAGES.includes(to)) return { skipped: "unknown_stage" };
    // The PREVIOUS stage is what makes this undoable, and it is read off the
    // ROW rather than taken from the model's idea of where the donor was.
    const [row] = await query("SELECT stage FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (!row) return { skipped: "unknown_donor" };
    if ((row.stage || null) === to) return { skipped: "already_there" };
    // AGENT-2: the screen's own stage route, so the timeline says so too.
    const r = await AC.call(ctx, "PATCH", `/donors/${donor.id}/stage`, { stage: to });
    if (r.status >= 300) return { failed: refusal(r) };
    const [now] = await query("SELECT stage FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (!now || now.stage !== to) return { failed: "their stage has not changed when Steward looks" };
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

  // FIX-3 B — the Volunteer role, on the ONE record (markVolunteer, the same
  // write a logged shift makes). The roles it had before are the undo.
  async mark_volunteer(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const [row] = await query("SELECT person_types FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (!row) return { skipped: "unknown_donor" };
    let had = row.person_types;
    if (typeof had === "string") { try { had = JSON.parse(had); } catch { had = null; } }
    if (Array.isArray(had) && had.includes("volunteer")) return { skipped: "already_volunteer" };
    await markVolunteer(ctx.orgId, donor.id, ctx.client);
    await agentWrite(ctx, { tool: "mark_volunteer", table: "donors", entityId: donor.id,
      before: { person_types: Array.isArray(had) ? JSON.stringify(had) : null },
      after: { person_types: "+volunteer" }, cites: step.citesRows });
    return { donorId: donor.id };
  },

  // FIX-3 B — a volunteer INTERNAL note (volunteer_notes), the table the
  // Volunteers hub reads and nothing on the giving side does. Never an
  // interaction. Written only onto somebody who carries the Volunteer role by
  // now (the step before it in the same run gives it).
  async note_volunteer(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const body = String(step.note || "").trim().slice(0, 2000);
    if (!body) return { skipped: "no_note" };
    const kind = ["training", "background_check", "availability"].includes(step.kind) ? step.kind : "note";
    const id = "vn_" + uuid().slice(0, 12);
    const r = await runTx(ctx.client,
      `INSERT INTO volunteer_notes (id,org_id,person_id,kind,body,note_date,created_by,created_by_name)
       SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL
                                            AND person_types @> '["volunteer"]'::jsonb)`,
      [id, ctx.orgId, donor.id, kind, body, ctx.today, AGENT_ACTOR.id, AGENT_ACTOR.name, donor.id, ctx.orgId]);
    if (!r || r.changes === 0) return { skipped: "not_a_volunteer" };
    await agentWrite(ctx, { tool: "note_volunteer", table: "volunteer_notes", entityId: id,
      before: null, after: { person_id: donor.id, kind }, cites: step.citesRows });
    return { id, donorId: donor.id };
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

  // ── AGENT-2 · REAL ACTIONS ───────────────────────────────────────────────
  // Each executor calls the ROUTE a person's click calls (agentCall.js), as
  // the person who confirmed, so the screen's own checks, plan gates and audit
  // apply. Then it LOOKS: the claimed result is read back from the database,
  // and only a result that is there is Done. Anything else is { failed } with
  // the reason (routes refuse in sentences; that sentence is the reason).
  // `before` is what undo puts back; null means undo removes what was made.
  async update_contact(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const body = {};
    for (const f of ["email", "phone", "address", "city", "state", "zip"]) {
      const v = String(step[f] || "").trim();
      if (v && !/^(none|n\/a|null|unknown|-)$/i.test(v)) body[f] = v;
    }
    if (!Object.keys(body).length) return { failed: "there was no new email, phone or address in it" };
    const r = await AC.call(ctx, "PATCH", `/donors/${donor.id}/contact`, body);
    if (r.status >= 300) return { failed: refusal(r) };
    if (r.body.unchanged) return { skipped: "already_there" };
    const [now] = await query(`SELECT ${r.body.changed.join(", ")} FROM donors WHERE id=? AND org_id=?`, [donor.id, ctx.orgId]);
    const ok = now && r.body.changed.every(k => String(now[k] || "").toLowerCase() === String(k === "email" ? body.email.toLowerCase() : body[k] || "").toLowerCase());
    if (!ok) return { failed: "the record does not show the new details" };
    await agentWrite(ctx, { tool: "update_contact", table: "donors", entityId: donor.id, before: r.body.before, after: now, cites: step.citesRows });
    return { donorId: donor.id, id: donor.id };
  },

  async set_owner(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const [u] = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [String(step.ownerUserId || ""), ctx.orgId]);
    if (!u) return { failed: "that colleague is not on this organisation's team" };
    const [was] = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (was.assigned_to === u.id) return { skipped: "already_there" };
    const r = await AC.call(ctx, "PATCH", "/donors/bulk-assign", { ids: [donor.id], assignedTo: u.id });
    if (r.status >= 300) return { failed: refusal(r) };
    const [now] = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (!now || now.assigned_to !== u.id) return { failed: "the record does not show the new owner" };
    await agentWrite(ctx, { tool: "set_owner", table: "donors", entityId: donor.id, before: was, after: now, cites: step.citesRows });
    return { donorId: donor.id, id: donor.id };
  },

  async add_to_group(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const gid = String(step.groupId || "");
    const r = await AC.call(ctx, "POST", `/groups/${encodeURIComponent(gid)}/members`, { donorIds: [donor.id] });
    if (r.status >= 300) return { failed: refusal(r) };
    if (r.body && r.body.added === 0) return { skipped: "already_there" };
    const [m] = await query("SELECT 1 AS y FROM group_members WHERE org_id=? AND group_id=? AND donor_id=?", [ctx.orgId, gid, donor.id]);
    if (!m) return { failed: "they are not in the group when Steward looks" };
    await agentWrite(ctx, { tool: "add_to_group", table: "group_members", entityId: `${gid}:${donor.id}`, before: null, after: { group_id: gid, donor_id: donor.id }, cites: step.citesRows });
    return { donorId: donor.id, id: gid };
  },

  async remove_from_group(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const gid = String(step.groupId || "");
    const [had] = await query("SELECT group_id, donor_id, added_by, added_by_name FROM group_members WHERE org_id=? AND group_id=? AND donor_id=?", [ctx.orgId, gid, donor.id]);
    if (!had) return { skipped: "not_in_group" };
    const r = await AC.call(ctx, "POST", `/groups/${encodeURIComponent(gid)}/members/remove`, { donorIds: [donor.id] });
    if (r.status >= 300) return { failed: refusal(r) };
    const [m] = await query("SELECT 1 AS y FROM group_members WHERE org_id=? AND group_id=? AND donor_id=?", [ctx.orgId, gid, donor.id]);
    if (m) return { failed: "they are still in the group when Steward looks" };
    await agentWrite(ctx, { tool: "remove_from_group", table: "group_members", entityId: `${gid}:${donor.id}`, before: had, after: { removed: true }, cites: step.citesRows });
    return { donorId: donor.id, id: gid };
  },

  async add_to_household(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const hid = String(step.householdId || "");
    const [h] = await query("SELECT * FROM households WHERE id=? AND org_id=?", [hid, ctx.orgId]);
    if (!h) return { failed: "that household is not on file" };
    const members = (await query("SELECT id, household_id FROM donors WHERE org_id=? AND household_id=? AND deleted_at IS NULL", [ctx.orgId, hid])).map(x => x.id);
    if (members.includes(donor.id)) return { skipped: "already_there" };
    const [was] = await query("SELECT household_id FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    const r = await AC.call(ctx, "PUT", `/households/${encodeURIComponent(hid)}`, { name: h.name, memberIds: [...members, donor.id],
      primaryDonorId: h.primary_donor_id || members[0], jointAcknowledgment: h.joint_acknowledgment });
    if (r.status >= 300) return { failed: refusal(r) };
    const [now] = await query("SELECT household_id FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    if (!now || now.household_id !== hid) return { failed: "the record does not show the household" };
    await agentWrite(ctx, { tool: "add_to_household", table: "donors", entityId: donor.id, before: { household_id: was ? was.household_id : null }, after: now, cites: step.citesRows });
    return { donorId: donor.id, id: hid };
  },

  async log_conversation(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const kind = ["call", "meeting", "email"].includes(step.kind) ? step.kind : null;
    if (!kind) return { failed: "a conversation is a call, a meeting or an email" };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(step.date || "")) ? step.date : ctx.today;
    if (date > ctx.today) return { failed: "a conversation that has not happened yet is a next step, not a log" };
    const r = await AC.call(ctx, "POST", `/donors/${donor.id}/interactions`, { type: kind, note: String(step.note || "").slice(0, 2000), date });
    if (r.status >= 300) return { failed: refusal(r) };
    const id = r.body && r.body.id;
    const [row] = id ? await query("SELECT id FROM interactions WHERE id=? AND org_id=? AND donor_id=? AND type=?", [id, ctx.orgId, donor.id, kind])
      : await query("SELECT id FROM interactions WHERE org_id=? AND donor_id=? AND type=? AND LEFT(date,10)=? ORDER BY created_at DESC LIMIT 1", [ctx.orgId, donor.id, kind, date]);
    if (!row) return { failed: "the conversation is not on their timeline when Steward looks" };
    await agentWrite(ctx, { tool: "log_conversation", table: "interactions", entityId: row.id, before: null, after: { donor_id: donor.id, type: kind, date }, cites: step.citesRows });
    return { donorId: donor.id, id: row.id };
  },

  async set_next_step(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const label = String(step.label || step.title || "").trim().slice(0, 200);
    if (!label) return { failed: "a next step needs words" };
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(step.due || "")) ? step.due : orgTime.addDays(ctx.today, 7);
    const [open] = await query("SELECT id, next_step_label, due_date FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL", [ctx.orgId, donor.id]);
    const r = open ? await AC.call(ctx, "PUT", `/threads/${open.id}`, { label, due })
      : await AC.call(ctx, "POST", `/donors/${donor.id}/threads`, { label, due });
    if (r.status >= 300) return { failed: refusal(r) };
    const [now] = await query("SELECT id, next_step_label, due_date FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL", [ctx.orgId, donor.id]);
    if (!now || now.next_step_label !== label) return { failed: "the next step on their record is not the new one" };
    await agentWrite(ctx, { tool: "set_next_step", table: "threads", entityId: now.id,
      before: open ? { next_step_label: open.next_step_label, due_date: open.due_date } : null, after: { next_step_label: label, due_date: now.due_date }, cites: step.citesRows });
    return { donorId: donor.id, id: now.id };
  },

  async make_volunteer(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const [p] = await query("SELECT person_types FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    const [had] = await query(`SELECT id, hours_per_week, availability, roles FROM volunteer_applications WHERE org_id=? AND person_id=? AND status='approved' ORDER BY decided_at DESC NULLS LAST LIMIT 1`, [ctx.orgId, donor.id]);
    const body = {};
    if (Number(step.hoursPerWeek) > 0) body.hoursPerWeek = Number(step.hoursPerWeek);
    if (Array.isArray(step.availability) && step.availability.length) body.availability = step.availability;
    if (Array.isArray(step.roles) && step.roles.length) body.roles = step.roles;
    const r = await AC.call(ctx, "POST", `/donors/${donor.id}/make-volunteer`, body);
    if (r.status >= 300) return { failed: refusal(r) };
    const [rec] = await query(`SELECT id, hours_per_week FROM volunteer_applications WHERE org_id=? AND person_id=? AND status='approved' ORDER BY decided_at DESC NULLS LAST LIMIT 1`, [ctx.orgId, donor.id]);
    const [types] = await query("SELECT person_types FROM donors WHERE id=? AND org_id=?", [donor.id, ctx.orgId]);
    const isVol = types && JSON.stringify(types.person_types || []).includes("volunteer");
    if (!rec || !isVol || (body.hoursPerWeek != null && Number(rec.hours_per_week) !== Number(body.hoursPerWeek)))
      return { failed: "their volunteer record is not there as asked when Steward looks" };
    const was = p && p.person_types;
    await agentWrite(ctx, { tool: "make_volunteer", table: "donors", entityId: donor.id,
      before: { person_types: typeof was === "string" ? was : JSON.stringify(was || ["other"]) }, after: { person_types: "+volunteer" }, cites: step.citesRows });
    await agentWrite(ctx, { tool: "make_volunteer", table: "volunteer_applications", entityId: rec.id,
      before: had ? { hours_per_week: had.hours_per_week, availability: JSON.stringify(had.availability || []), roles: JSON.stringify(had.roles || []) } : null,
      after: { hours_per_week: rec.hours_per_week }, cites: step.citesRows });
    return { donorId: donor.id, id: rec.id };
  },

  async sign_up_shift(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const slotId = String(step.slotId || "");
    const r = await AC.call(ctx, "POST", "/volunteer-hub/signups", { slotId, personId: donor.id, ...(step.roleId ? { roleId: step.roleId } : {}) });
    if (r.status >= 300) return { failed: refusal(r) };
    const [su] = await query("SELECT id, status FROM volunteer_signups WHERE org_id=? AND slot_id=? AND person_id=? ORDER BY created_at DESC LIMIT 1", [ctx.orgId, slotId, donor.id]);
    if (!su || !["confirmed", "waitlisted"].includes(su.status)) return { failed: "they are not on the shift when Steward looks" };
    await agentWrite(ctx, { tool: "sign_up_shift", table: "volunteer_signups", entityId: su.id, before: null, after: { slot_id: slotId, status: su.status }, cites: step.citesRows });
    return { donorId: donor.id, id: su.id, note: su.status === "waitlisted" ? "the shift was full, so they are on its waiting list" : null };
  },

  async log_hours(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const h = Number(step.hours);
    if (!(h > 0 && h <= 24)) return { failed: "hours are more than 0 and at most 24 for one shift" };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(step.date || "")) ? step.date : ctx.today;
    const whole = Math.floor(h), minutes = Math.round((h - whole) * 60);
    const r = await AC.call(ctx, "POST", `/donors/${donor.id}/volunteer-hours`, { date, hours: String(whole), minutes: String(minutes), ...(step.opportunityId ? { opportunityId: step.opportunityId } : {}) });
    if (r.status >= 300) return { failed: refusal(r) };
    const [row] = await query("SELECT id, hours FROM volunteer_shifts WHERE id=? AND org_id=? AND person_id=?", [r.body && r.body.id, ctx.orgId, donor.id]);
    if (!row) return { failed: "the hours are not on their record when Steward looks" };
    await agentWrite(ctx, { tool: "log_hours", table: "volunteer_shifts", entityId: row.id, before: null, after: { hours: row.hours, date }, cites: step.citesRows });
    return { donorId: donor.id, id: row.id };
  },

  async start_journey(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const jid = String(step.journeyId || "");
    const r = await AC.call(ctx, "POST", `/journeys/${encodeURIComponent(jid)}/apply`, { donorIds: [donor.id] });
    if (r.status >= 300) return { failed: refusal(r) };
    const [pl] = await query("SELECT id FROM cultivation_plans WHERE org_id=? AND donor_id=? AND template_id=? AND status='active' ORDER BY applied_on DESC, id DESC LIMIT 1", [ctx.orgId, donor.id, jid]);
    if (!pl) {
      const why = r.body && r.body.detail && r.body.detail.skipped && r.body.detail.skipped[0];
      return { failed: (why && (why.sentence || why.reason)) || "they are not in the journey when Steward looks" };
    }
    await agentWrite(ctx, { tool: "start_journey", table: "cultivation_plans", entityId: pl.id, before: null, after: { status: "active" }, cites: step.citesRows });
    return { donorId: donor.id, id: pl.id };
  },

  async stop_journey(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const jid = String(step.journeyId || "");
    const [pl] = await query(`SELECT id, status, closed_at FROM cultivation_plans WHERE org_id=? AND donor_id=? AND status='active' ${jid ? "AND template_id=?" : ""} ORDER BY applied_on DESC LIMIT 1`,
      jid ? [ctx.orgId, donor.id, jid] : [ctx.orgId, donor.id]);
    if (!pl) return { skipped: "not_in_journey" };
    const r = await AC.call(ctx, "POST", `/plans/${pl.id}/stop`, {});
    if (r.status >= 300) return { failed: refusal(r) };
    const [now] = await query("SELECT status FROM cultivation_plans WHERE id=? AND org_id=?", [pl.id, ctx.orgId]);
    if (!now || now.status === "active") return { failed: "the journey is still running for them when Steward looks" };
    await agentWrite(ctx, { tool: "stop_journey", table: "cultivation_plans", entityId: pl.id, before: { status: "active", closed_at: null }, after: { status: now.status }, cites: step.citesRows });
    return { donorId: donor.id, id: pl.id };
  },

  async register_event(ctx, step) {
    const donor = ctx.donorById(step.donorId);
    if (!donor) return { skipped: "unknown_donor" };
    const eid = String(step.eventId || "");
    const [ev] = await query("SELECT * FROM events WHERE id=? AND org_id=?", [eid, ctx.orgId]);
    if (!ev) return { failed: "that event is not on file" };
    if (Number(ev.cost || ev.ticket_price || 0) > 0) return { failed: "it is a paid event, and selling a ticket is a person's to do" };
    const r = await AC.call(ctx, "POST", `/events/${encodeURIComponent(eid)}/attendees`, { donorIds: [donor.id] });
    if (r.status >= 300) return { failed: refusal(r) };
    const [a] = await query("SELECT id FROM event_attendees WHERE event_id=? AND donor_id=? ORDER BY id DESC LIMIT 1", [eid, donor.id]);
    if (!a) return { failed: "they are not on the guest list when Steward looks" };
    await agentWrite(ctx, { tool: "register_event", table: "event_attendees", entityId: a.id, before: null, after: { event_id: eid, donor_id: donor.id }, cites: step.citesRows });
    return { donorId: donor.id, id: a.id };
  },

  async mark_gift_thanked(ctx, step) {
    const gid = String(step.giftId || "");
    const [g] = await query("SELECT id, donor_id, acknowledgement_sent, acknowledgement_sent_at, acknowledged_by, acknowledged_by_name, acknowledged_via FROM gifts WHERE id=? AND org_id=?", [gid, ctx.orgId]);
    if (!g) return { failed: "that gift is not on file" };
    if (g.acknowledgement_sent === true) return { skipped: "already_thanked" };
    const via = ["letter", "email", "phone", "in_person", "receipt"].includes(step.method) ? step.method : "email";
    const r = await AC.call(ctx, "POST", "/acknowledgments/mark", { giftIds: [gid], via });
    if (r.status >= 300) return { failed: refusal(r) };
    const [now] = await query("SELECT acknowledgement_sent FROM gifts WHERE id=? AND org_id=?", [gid, ctx.orgId]);
    if (!now || now.acknowledgement_sent !== true) return { failed: "the gift does not show as thanked when Steward looks" };
    const { id: _i, donor_id: _d, ...before } = g;
    await agentWrite(ctx, { tool: "mark_gift_thanked", table: "gifts", entityId: gid, before, after: { acknowledgement_sent: true, acknowledged_via: via }, cites: step.citesRows });
    return { donorId: g.donor_id, id: gid };
  },

  async propose_merge(ctx, step) {
    const a = ctx.donorById(step.donorId), b = ctx.donorById(step.otherDonorId);
    if (!a || !b || a.id === b.id) return { failed: "a merge needs two different records" };
    const r = await AC.call(ctx, "POST", "/data-health/proposals", { a: a.id, b: b.id, reason: ctx.instructionText });
    if (r.status >= 300) return { failed: refusal(r) };
    if (r.body && r.body.already) return { skipped: "already_proposed" };
    const [x, y] = [a.id, b.id].sort();
    const [row] = await query("SELECT id FROM merge_proposals WHERE org_id=? AND a=? AND b=?", [ctx.orgId, x, y]);
    if (!row) return { failed: "the pair is not in the duplicate queue when Steward looks" };
    await agentWrite(ctx, { tool: "propose_merge", table: "merge_proposals", entityId: row.id, before: null, after: { a: x, b: y }, cites: step.citesRows });
    return { donorId: a.id, id: row.id };
  },

};
const AGENT_RUNNABLE = Object.keys(AGENT_EXECUTORS);

// ── UNDO: A RESTORE, NOT A GUESS ───────────────────────────────────────────
// Only the columns the ledger recorded are restored — never a whole-row
// overwrite, which would also undo a HUMAN's later edit to a different field on
// the same record.
const AGENT_UNDO_DELETE_OK = new Set(["agent_drafts", "tasks", "interactions", "threads", "volunteer_notes",
  // AGENT-2: rows the Agent made through a screen's route, undone by removing them.
  "volunteer_applications", "volunteer_shifts", "volunteer_signups", "event_attendees", "merge_proposals"]);

async function agentUndoWrite(w, orgId) {
  const table = w.entity_table;
  let before = w.before_row;
  if (typeof before === "string") { try { before = JSON.parse(before); } catch { before = null; } }
  // AGENT-2: two kinds of row the generic restore cannot put back.
  if (table === "group_members") {
    const [gid, did] = String(w.entity_id).split(":");
    if (!before) { await run("DELETE FROM group_members WHERE org_id=? AND group_id=? AND donor_id=?", [orgId, gid, did]); return { ok: true, action: "deleted" }; }
    await run(`INSERT INTO group_members (org_id, group_id, donor_id, added_by, added_by_name) VALUES (?,?,?,?,?) ON CONFLICT (group_id, donor_id) DO NOTHING`,
      [orgId, gid, did, before.added_by || null, before.added_by_name || null]);
    return { ok: true, action: "restored" };
  }
  if (table === "cultivation_plans" && !before) {
    // A journey the Agent started is stopped, not deleted: its drafts and
    // reminders keep their history.
    await run("UPDATE cultivation_plans SET status='abandoned', closed_at=NOW() WHERE id=? AND org_id=? AND status='active'", [w.entity_id, orgId]);
    return { ok: true, action: "stopped" };
  }
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
// Nothing runs until she has read one.
//
// FIX-1 §A — THE PLAN IS COMPILED FROM THE STEPS THAT WILL RUN. The model
// returns STEPS (each a tool, a person, and the rows it came from), never a
// headline; Steward writes the headline from those steps (compilePlan), and
// the run executes exactly those steps. The model sees only the rows the
// instruction names, or the organisation when it names nobody.
// AGENT-2: WHAT THE REAL ACTIONS CAN POINT AT. Steward's own reads, org
// scoped and capped: the staff, the groups kept by hand, households, journeys,
// shifts coming up, events, and the gifts of the people she named. The model
// may use an id only from these lists; the plan drops a step that names one
// that is not here.
async function agentContext(orgId, { today, scope, allowed }) {
  const want = t => allowed.has(t);
  const safe = p => p.catch(() => []);
  const ctx = {};
  if (want("set_owner")) ctx.staff = await safe(query("SELECT id, name FROM users WHERE org_id=? ORDER BY name LIMIT 50", [orgId]));
  if (want("add_to_group") || want("remove_from_group"))
    ctx.groups = await safe(query("SELECT id, name FROM audiences WHERE org_id=? AND kind='static' ORDER BY name LIMIT 100", [orgId]));
  if (want("add_to_household")) ctx.households = await safe(query("SELECT id, name FROM households WHERE org_id=? ORDER BY name LIMIT 100", [orgId]));
  if (want("start_journey") || want("stop_journey"))
    ctx.journeys = await safe(query("SELECT id, name FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY name LIMIT 50", [orgId]));
  if (want("sign_up_shift") || want("log_hours")) {
    ctx.shifts = await safe(query(`SELECT s.id, s.date, s.start_time, s.end_time, s.name, s.opportunity_id, o.name AS opportunity
        FROM volunteer_slots s LEFT JOIN volunteer_opportunities o ON o.id = s.opportunity_id AND o.org_id = s.org_id
       WHERE s.org_id=? AND s.cancelled_at IS NULL AND s.date >= ? AND s.date <= ? ORDER BY s.date, s.start_time LIMIT 60`,
      [orgId, orgTime.addDays(today, -14), orgTime.addDays(today, 60)]));
    const ids = ctx.shifts.map(x => x.id);
    const roles = ids.length ? await safe(query("SELECT id, slot_id, name FROM volunteer_slot_roles WHERE slot_id = ANY(?::text[])", [ids])) : [];
    for (const sh of ctx.shifts) sh.roles = roles.filter(r => r.slot_id === sh.id);
    ctx.opportunities = await safe(query("SELECT id, name FROM volunteer_opportunities WHERE org_id=? ORDER BY name LIMIT 50", [orgId]));
  }
  if (want("register_event")) ctx.events = (await safe(query("SELECT * FROM events WHERE org_id=? ORDER BY date DESC LIMIT 30", [orgId])))
    .map(e => ({ id: e.id, name: e.name, date: String(e.date || "").slice(0, 10), paid: Number(e.cost || e.ticket_price || 0) > 0 }));
  if (want("mark_gift_thanked")) ctx.gifts = scope && scope.length
    ? await safe(query(`SELECT id, donor_id, amount, LEFT(date,10) AS date, acknowledgement_sent FROM gifts WHERE org_id=? AND donor_id = ANY(?::text[]) AND amount > 0 ORDER BY date DESC LIMIT 40`, [orgId, scope]))
    : await safe(query(`SELECT id, donor_id, amount, LEFT(date,10) AS date, acknowledgement_sent FROM gifts WHERE org_id=? AND amount > 0 AND acknowledgement_sent IS NOT TRUE AND LEFT(date,10) >= ? ORDER BY date DESC LIMIT 40`, [orgId, orgTime.addDays(today, -90)]));
  return ctx;
}
function agentContextLines(c) {
  const out = [];
  const sec = (title, rows, fmt) => { if (rows && rows.length) out.push("", title, ...rows.map(fmt)); };
  sec("STAFF (ownerUserId):", c.staff, u => `  ${u.id} | ${u.name}`);
  sec("GROUPS kept by hand (groupId):", c.groups, g => `  ${g.id} | ${g.name}`);
  sec("HOUSEHOLDS (householdId):", c.households, h => `  ${h.id} | ${h.name}`);
  sec("JOURNEYS (journeyId):", c.journeys, j => `  ${j.id} | ${j.name}`);
  sec("SHIFTS (slotId; roleId when it has roles):", c.shifts, x => `  ${x.id} | ${x.date} ${x.start_time || ""}-${x.end_time || ""} | ${x.name || x.opportunity || "Shift"} | opportunity ${x.opportunity_id || "none"} ${x.opportunity || ""}${x.roles.length ? " | roles " + x.roles.map(r => `${r.id} ${r.name}`).join(", ") : ""}`);
  sec("VOLUNTEER OPPORTUNITIES (opportunityId):", c.opportunities, o => `  ${o.id} | ${o.name}`);
  sec("EVENTS (eventId):", c.events, e => `  ${e.id} | ${e.name} | ${e.date} | ${e.paid ? "paid" : "free"}`);
  sec("GIFTS (giftId):", c.gifts, g => `  ${g.id} | giver ${g.donor_id} | amount ${Number(g.amount)} | ${g.date} | ${g.acknowledgement_sent ? "thanked" : "not thanked"}`);
  if (c.days) out.push("", `DAYS (availability, exactly these words): ${c.days.join(", ")}`);
  return out;
}

// ── WIRE-1-ADDENDUM · DRAFTS, TEN AT A TIME ───────────────────────────────
// The gifts a draft may speak of: the ones in the window her words name ("who
// gave this month"), or else each person's latest gift. Org-scoped, Steward's
// own query; the model reads these rows and nothing else about money.
async function agentDraftGifts(orgId, A, text, today, people) {
  const ids = people.map(p => String(p.id));
  if (!ids.length) return [];
  const win = A.giftWindowFromInstruction(text, today);
  if (win) return (await agentReadGifts(orgId, win, ids)).filter(g => !g.deceased && !g.do_not_contact && !g.is_sample);
  return query(
    `SELECT DISTINCT ON (g.donor_id) g.id, g.donor_id, g.amount, g.date
       FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND g.amount > 0 AND COALESCE(g.is_sample, false) = false
      ORDER BY g.donor_id, LEFT(g.date, 10) DESC, g.id`, [orgId, ids]);
}
// One lean call per batch of ten, three at a time. A batch the model cut short
// refuses the whole plan (PARITY-1 Part F: never a plan that stops at an
// arbitrary person); a person the model skipped is simply not drafted for, and
// the plan counts them as withheld like any other dropped step.
async function agentDraftInBatches({ A, V, words, client, orgId, userId, who, instructionText, today, people, gifts, dryRun = false }) {
  const thanks = A.isThankYouInstruction(instructionText);
  const [org] = await query("SELECT name FROM orgs WHERE id=?", [orgId]);
  const orgName = (org && org.name) || "the organisation";
  // Money and days in the words a letter uses ("$4,722", "October 2, 2026"),
  // so a draft never says "4722 on 2026-10-02".
  const longDay = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "never"; };
  const giftsBy = new Map();
  for (const g of gifts) { if (!giftsBy.has(g.donor_id)) giftsBy.set(g.donor_id, []); giftsBy.get(g.donor_id).push(g); }
  const system = [
    who.systemPrompt,
    "",
    "Write one draft for each person listed, using the drafts tool. Nothing is sent: each draft waits for a person to read it.",
    "RULES, and they are not negotiable:",
    "- Use NO number that is not in that person's lines. Never state a rule about how giving works.",
    "- Call each person what their line calls them. An organisation is a foundation, church or business.",
    `- Plain sentences. No markdown. No placeholders in brackets. Sign off as ${orgName}.`,
    "- Write money and dates as they are given (\"$4,722\", \"October 2, 2026\").",
    "- Never add up, average or compute an amount. Use only the amounts written in that person's lines.",
    "- Keep each draft under 120 words, warm and specific to the person.",
    `- Today is ${today} in this organisation's own calendar.`,
  ].join("\n");
  const batches = A.draftBatches(people);
  const out = new Array(batches.length);
  let next = 0, cut = null;
  const one = async () => {
    while (next < batches.length && !cut) {
      const i = next++;
      const batch = batches[i];
      const user = [
        `Her instruction, verbatim: "${String(instructionText).slice(0, 2000)}"`,
        "",
        `The ${batch.length} people to draft for:`,
        ...batch.flatMap(p => [
          `  ${p.id} | ${p.name} | ${V.giverWordFor(p, words)} | lifetime ${A.formatCents(Math.round(Number(p.total_giving || 0) * 100))} | ${p.gift_count || 0} gifts | first ${longDay(p.first_gift_date)} | last ${longDay(p.last_gift_date)}`,
          ...(giftsBy.get(p.id) || []).map(g => `      gift ${g.id} | ${A.formatCents(Math.round(Number(g.amount) * 100))} | ${longDay(g.date)}`),
        ]),
      ].join("\n");
      const msg = await client.messages.create({
        model: AGENT_MODEL, max_tokens: 4000, system,
        tools: [{ name: "drafts", description: "One draft for each person listed.", strict: true, input_schema: A.DRAFTS_SCHEMA }],
        tool_choice: { type: "tool", name: "drafts" },
        messages: [{ role: "user", content: user }],
      });
      if (msg.stop_reason === "max_tokens") { cut = { batch: i }; break; }
      const block = (msg.content || []).find(b => b.type === "tool_use" && b.name === "drafts");
      out[i] = (block && block.input && Array.isArray(block.input.drafts) ? block.input.drafts : []);
      if (!dryRun) await run(`INSERT INTO ai_log (id,org_id,user_id,type,prompt_summary,prompt_full,response_full)
                 VALUES (?,?,?,'agent_plan',?,?,?)`,
        ["log_" + uuid().slice(0, 8), orgId, userId || null, `${String(instructionText).slice(0, 80)} (drafts ${i + 1}/${batches.length})`,
         (system + "\n\n" + user).slice(0, 200000), JSON.stringify(out[i]).slice(0, 200000)]);
    }
  };
  await Promise.all([one(), one(), one()]);
  if (cut) {
    console.warn(`[agent] a draft batch hit max_tokens (batch ${cut.batch + 1} of ${batches.length})`);
    throw Object.assign(new Error("plan truncated"), { truncated: true, stepsReturned: 0 });
  }
  const ids = new Set(people.map(p => p.id));
  const seen = new Set();
  const steps = [];
  for (const d of out.flat()) {
    const id = String((d && d.donorId) || "");
    if (!ids.has(id) || seen.has(id) || !String(d.body || "").trim()) continue;
    seen.add(id);
    const giftIds = (giftsBy.get(id) || []).map(g => g.id);
    steps.push({ tool: "draft_note", donorId: id, subject: String(d.subject || "").slice(0, 300), body: String(d.body),
      citesRows: [id, ...giftIds], giftIds: thanks ? giftIds : [], purpose: thanks ? "thank_you" : null });
  }
  return { steps, sends: 0, headline: null, cannot: null };
}

async function agentBuildPlan(orgId, instructionText, { authorization, scope = null, userId = null, persona = null, dryRun = false }) {
  const A = await agentShapeMod();
  const TH = await thresholdsMod();
  // AGENTS-1 — THE PERSONA NARROWS; IT NEVER WIDENS. `getPersona` answers with
  // the general agent for null and for anything it does not recognise, so this
  // function behaves exactly as it did before when no persona was chosen.
  const PS = await agentPersonasMod();
  const who = PS.getPersona(persona);
  const allowed = new Set(who.tools);
  // ── FIX-8 Part D.1 · WHERE THE TIME GOES ────────────────────────────────
  // Jonathan typed "Make a thank you note to everyone that gave in the last 3
  // months in my voice" and sat on "Planning..." for a long time. Before
  // changing anything, the wait is SPLIT and logged, because "it feels slow"
  // and "the model spends 40 seconds writing 200 notes nobody has read yet"
  // call for different fixes.
  //
  // Three numbers, every plan, on one line:
  //   rows    reading the org's people out of Postgres
  //   model   the single Anthropic call
  //   filter  citation, threshold and persona checks over what came back
  // and, because it is the thing actually suspected, how many of the returned
  // steps carry a DRAFTED BODY. A plan that drafts two hundred notes before
  // she has said yes is the cost, and this is the line that proves it.
  const _t0 = Date.now();
  const client = anthropicFor(orgId);
  const today = orgToday(await orgTz(orgId));
  const found = scope ? null : await agentFindPeople(orgId, instructionText, today, { client });
  if (found && found.ids.length > A.MAX_PLAN_STEPS) {
    throw Object.assign(new Error("too many found"), { refuse: { error: "too_many",
      sentence: `${found.ids.length > 1000 ? "More than 1,000" : found.ids.length} people match (${found.words.join(" · ")}). That is more than one plan can show you before you say yes (${A.MAX_PLAN_STEPS}). Narrow it and try again.` } });
  }
  if (found && !found.ids.length) {
    throw Object.assign(new Error("nobody found"), { refuse: { error: "nothing_to_do",
      sentence: `Nobody on file matches (${found.words.join(" · ")}), so there is nothing to plan.` } });
  }
  const people = await agentReadPeople(orgId, { ids: found ? found.ids : scope, limit: found ? 1000 : 400 });
  const _tRows = Date.now();
  const V = await import("../shared/vocabulary.js");
  const [orgRow] = await query("SELECT vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const words = V.normalizeVocabulary(orgRow && orgRow.vocabulary_json);
  // The people a draft may never be written for are removed BEFORE the model
  // sees them (BUILD-83's rule: fiction and the no-ask family generate nothing).
  const reachable0 = people.filter(p => !p.deceased && !p.do_not_contact && !p.is_sample);
  // PARITY-1 Part F: TODAY, AND THE GIFTS SHE MEANT. The prompt had no date,
  // so "this week" and "due in a week" were guesses; and it had donor rows
  // only, so "every gift this week" became "every donor". Now the org's own
  // today is in the prompt, and when her words name a window of time and
  // gifts, the gift rows in that window are read (org-scoped, Steward's query)
  // and shown, with their givers among the people even when they are not in
  // the top 200 by giving.
  const win = !found && /\b(gifts?|donations?|gave|given|donated)\b/i.test(String(instructionText)) ? A.giftWindowFromInstruction(instructionText, today) : null;
  const windowGifts = win ? await agentReadGifts(orgId, win, scope) : [];
  const shownIds = new Set(reachable0.slice(0, 200).map(p => p.id));
  const giverIds = [...new Set(windowGifts.map(g => g.donor_id))].filter(id => !shownIds.has(id));
  const extraGivers = giverIds.length && !scope
    ? (await agentReadPeople(orgId, { ids: giverIds, limit: 1000 })).filter(p => !p.deceased && !p.do_not_contact && !p.is_sample) : [];
  const reachable = found ? reachable0 : [...reachable0.slice(0, 200), ...extraGivers];
  const reachableIds = new Set(reachable.map(p => p.id));
  const giftRows = windowGifts.filter(g => reachableIds.has(g.donor_id));
  // The model is shown the persona's OWN tools, not the whole table. An
  // Analyst that is never offered set_stage rarely asks for it; the filter
  // below is what guarantees it, and this is what makes the plan sensible.
  const toolList = A.AGENT_TOOLS
    .filter(t => A.PLANNABLE.includes(t.name) && allowed.has(t.name))
    .map(t => `  ${t.name} — ${t.what}`).join("\n");

  const system = [
    // AGENTS-1 — the persona's own words, first. The general persona's line is
    // the sentence that used to be hard-coded here, verbatim, so an instruction
    // with no persona builds from a byte-identical prompt.
    who.systemPrompt,
    "",
    "You may ONLY use these tools:",
    toolList,
    "",
    "RULES, and they are not negotiable:",
    "- Return STEPS: every action you will take, one per person, in order. Nothing else will run.",
    "- EVERY step must carry `citesRows`: the ids of the rows it came from. A step you cannot",
    "  point at a row for must not be returned at all.",
    authorization === A.AUTH_SEND
      ? "- This instruction is signed for sending, so `sends` may be greater than zero."
      : "- NOTHING may be sent. `sends` must be 0. Drafts go in her queue.",
    "- Never plan anything that moves money: no gifts, refunds, charges, pledges, receipts or recurring changes.",
    "- Use NO number that is not in the rows below. Never state a rule about how giving works.",
    "- Call each person what the row calls them. An organisation is a foundation, church or business, never a donor's word.",
    "- Plain sentences. No markdown.",
    `- Today is ${today} in this organisation's own calendar. A date you write is YYYY-MM-DD.`,
    "- A task's due date goes in `dueDays`: whole days from today (a week is 7). Leave `due` null.",
    "- When the rows include GIFTS and she asks for something per gift, return one step per gift, citing the gift id and the giver's id.",
    // AGENT-2: DO THE THING, OR SAY IT CANNOT BE DONE.
    "- Do what she asked with the tool that does it. NEVER put a note, a tag or a task in place of an action a tool above can do.",
    "- If no tool can do part of what she asked, leave that part out and say so in `cannot`, in one plain sentence. Do not invent a substitute.",
    "- Write `cannot` about her donors and her work. Never mention rows, data, columns, lists or what you were shown.",
    "- The people listed are the people she meant. Never create a task or note asking which person she meant.",
    "- A conversation she says already happened is log_conversation with its date (today is " + today + "; yesterday is " + orgTime.addDays(today, -1) + "). Anything still to do is set_next_step with a due date.",
    "- Use an id only from the lists below (people, STAFF, GROUPS, HOUSEHOLDS, JOURNEYS, SHIFTS, EVENTS, GIFTS). `citesRows` holds the person's id, and the gift id for a gift step.",
    "- A gift she says arrived is prepare_gift (amount in dollars). You never record money.",
    "- `headline`: one short sentence, under 90 characters, saying what the plan does.",
    "- Add nothing she did not ask for, except one draft she would plainly want (a welcome to a new volunteer).",
  ].join("\n");

  const actx = await agentContext(orgId, { today, scope, allowed });
  if (allowed.has("make_volunteer")) actx.days = (await import("../shared/volunteerApply.js")).AVAILABILITY;
  // Who "me" is, for "make me her owner".
  const [meRow] = userId ? await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [userId, orgId]) : [];
  const user = [
    `Her instruction, verbatim: "${String(instructionText).slice(0, 2000)}"`,
    ...(meRow ? [`She is ${meRow.name} (${meRow.id}).`] : []),
    "",
    `Today: ${today}`,
    "",
    scope ? "The records she named:" : found
      ? `The people find_people found for her words (${found.words.join(" · ")}), ${reachable.length}. These are exactly the people she meant: one step for each of them, and nobody else.`
      : `The people on file (${reachable.length}):`,
    ...reachable.map(p =>
      `  ${p.id} | ${p.name} | ${V.giverWordFor(p, words)} | lifetime ${p.total_giving || 0} | ${p.gift_count || 0} gifts | first ${p.first_gift_date ? String(p.first_gift_date).slice(0, 10) : "never"} | last ${p.last_gift_date || "never"} | stage ${p.stage || "none"}${scope ? ` | email ${p.email || "none"} | phone ${p.phone || "none"} | household ${p.household_id || "none"} | owner ${p.assigned_to_name || "none"}` : ""}`),
    ...agentContextLines(actx),
    ...(win ? ["", `The gifts dated ${win.words} (${win.from} to ${win.to}), ${giftRows.length}:`,
      ...giftRows.map(g => `  ${g.id} | giver ${g.donor_id} | ${g.donor_name} | amount ${Number(g.amount)} | date ${String(g.date).slice(0, 10)}`)] : []),
  ].join("\n");

  // WIRE-1-ADDENDUM: a drafting instruction over a known set of people is
  // written in batches of ten with a lean schema (agentDraftInBatches), so a
  // plan of any size finishes. Everything else is one plan call, as before.
  const drafting = (found || scope) && allowed.has("draft_note") && A.isDraftingInstruction(instructionText) && reachable.length > 0;
  const draftGifts = drafting ? await agentDraftGifts(orgId, A, instructionText, today, reachable) : [];
  let raw, _truncated = false;
  if (drafting) {
    raw = await agentDraftInBatches({ A, V, words, client, orgId, userId, who, instructionText, today, people: reachable, gifts: draftGifts, dryRun });
  } else {
  const msg = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: 8000,
    system,
    tools: [{ name: "plan", description: "The steps she will read before anything runs.",
              strict: true, input_schema: A.PLAN_SCHEMA }],
    tool_choice: { type: "tool", name: "plan" },
    messages: [{ role: "user", content: user }],
  });
  const block = (msg.content || []).find(b => b.type === "tool_use" && b.name === "plan");
  raw = block && block.input ? block.input : { steps: [], sends: 0 };
  // A truncated tool_use block is a real failure mode here and it looks like a
  // bad plan rather than a full one: max_tokens is 8000, and one step per
  // person WITH a body is far past that for a few hundred people. Say so.
  _truncated = msg.stop_reason === "max_tokens";
  if (_truncated) console.warn(`[agent] the model hit max_tokens: the plan is TRUNCATED (${(raw.steps || []).length} steps returned)`);
  // PARITY-1 Part F: A TRUNCATED PLAN IS REFUSED, not run in part. It was
  // only warned about, so she could confirm a plan that stopped at an
  // arbitrary person and never learn who was left out.
  if (_truncated) throw Object.assign(new Error("plan truncated"), { truncated: true, stepsReturned: (raw.steps || []).length });
  if (!dryRun) await run(`INSERT INTO ai_log (id,org_id,user_id,type,prompt_summary,prompt_full,response_full)
             VALUES (?,?,?,'agent_plan',?,?,?)`,
    ["log_" + uuid().slice(0, 8), orgId, userId || null, String(instructionText).slice(0, 100),
     (system + "\n\n" + user).slice(0, 200000), JSON.stringify(raw).slice(0, 200000)]);
  }
  const _tModel = Date.now();

  // A step that cannot be run as written is left out HERE, before she reads the
  // plan, and COUNTED on it; the run never meets a step she did not read. A
  // tool she has not signed for stays in, so validatePlan REFUSES the plan
  // rather than trimming it.
  const byId = new Map(reachable.map(p => [p.id, p]));
  const knownRowIds = [...reachable.map(p => p.id), ...giftRows.map(g => g.id), ...(actx.gifts || []).map(g => g.id), ...draftGifts.map(g => g.id)];
  const groundedValues = [...reachable.flatMap(p => [p.total_giving, p.gift_count, p.last_gift_amount]),
    ...giftRows.map(g => g.amount), ...draftGifts.map(g => g.amount)].map(Number).filter(Number.isFinite);
  const steps = [];
  let withheld = 0;
  let outOfScope = 0;
  const idIn = (list, id) => (list || []).find(x => x.id === id) || null;
  const giftIds = new Set((actx.gifts || []).map(g => g.id));
  // FIX-27 Part 7: a drafted body claims only what the person's record holds
  // (shared/suggestionGuard.js guardDraft). Their ready video and their
  // logged conversations are read once for everyone a step drafts for.
  const draftFor = [...new Set((Array.isArray(raw.steps) ? raw.steps : []).filter(x => x && x.body && x.donorId).map(x => String(x.donorId)))];
  const SG = await import("../shared/suggestionGuard.js");
  const { publicAppUrl } = require("../publicUrl");
  const [dVideos, dMeets, dEvents] = draftFor.length ? await Promise.all([
    query(`SELECT DISTINCT ON (donor_id) donor_id, token FROM video_thanks WHERE org_id = ? AND donor_id = ANY(?::text[]) AND asset_id IS NOT NULL ORDER BY donor_id, created_at DESC`, [orgId, draftFor]),
    query(`SELECT donor_id, date, type FROM interactions WHERE org_id = ? AND donor_id = ANY(?::text[]) AND type IN ('meeting','call','visit','event')`, [orgId, draftFor]),
    query(`SELECT name FROM events WHERE org_id = ? LIMIT 200`, [orgId]),
  ]) : [[], [], []];
  const draftProblems = st => {
    if (!st.body || !st.donorId) return [];
    const v = dVideos.find(x => x.donor_id === st.donorId);
    // WIRE-1-ADDENDUM: the gifts a batched draft was shown are on its record.
    return SG.guardDraft(`${st.subject || ""}\n${st.body}`, { donor: byId.get(st.donorId) || {}, orgName: "",
      rows: draftGifts.filter(g => g.donor_id === st.donorId).map(g => ({ amount: Number(g.amount), date: String(g.date).slice(0, 10) })),
      video: v ? { ready: true, url: `${publicAppUrl()}/v/${v.token}` } : null,
      meetings: dMeets.filter(x => x.donor_id === st.donorId), events: dEvents.map(e => e.name) }).reasons;
  };
  for (const s0 of Array.isArray(raw.steps) ? raw.steps : []) {
    let s = s0;
    // AGENT-2: "which Ada did you mean" is asked BEFORE a plan, never left as work.
    if (["create_task", "log_note"].includes(s.tool) && /\b(which|confirm|check)\b[^.]{0,40}\b(one|record|person|mean|meant|right)\b/i.test(`${s.title || ""} ${s.note || ""}`)) { withheld++; continue; }
    // AGENT-2: the ids a real action points at must be Steward's own, and the
    // step carries the name so the plan reads in words.
    const bad = (s.tool === "set_owner" && !(s.ownerName = (idIn(actx.staff, s.ownerUserId) || {}).name))
      || (["add_to_group", "remove_from_group"].includes(s.tool) && !(s.groupName = (idIn(actx.groups, s.groupId) || {}).name))
      || (s.tool === "add_to_household" && !(s.householdName = (idIn(actx.households, s.householdId) || {}).name))
      || (s.tool === "start_journey" && !(s.journeyName = (idIn(actx.journeys, s.journeyId) || {}).name))
      || (s.tool === "stop_journey" && s.journeyId && !(s.journeyName = (idIn(actx.journeys, s.journeyId) || {}).name))
      || (s.tool === "sign_up_shift" && !(s.shiftName = (() => { const x = idIn(actx.shifts, s.slotId); return x && `${x.name || x.opportunity || "the shift"} on ${x.date}`; })()))
      || (s.tool === "register_event" && !(s.eventName = (idIn(actx.events, s.eventId) || {}).name))
      || (s.tool === "mark_gift_thanked" && !giftIds.has(s.giftId))
      || (s.tool === "propose_merge" && (!byId.has(s.otherDonorId) || s.otherDonorId === s.donorId));
    if (bad) { withheld++; continue; }
    if (s.tool === "mark_gift_thanked") {
      const g = idIn(actx.gifts, s.giftId);
      s = { ...s, donorId: s.donorId || g.donor_id, giftWords: `${A.formatCents(Math.round(Number(g.amount) * 100))}, ${g.date}`, citesRows: [g.donor_id, g.id] };
    }
    if (s.tool === "prepare_gift") {
      // The money stays human: it becomes the ONE prepared card she records.
      const cents = Math.round(Number(s.amount) * 100);
      if (!(cents > 0) || !byId.has(s.donorId)) { withheld++; continue; }
      s = { tool: "record_gift", donorId: s.donorId, amountCents: cents, preparedBy: "steward", method: s.method || null,
            date: /^\d{4}-\d{2}-\d{2}$/.test(String(s.date || "")) ? s.date : today, citesRows: [s.donorId],
            detail: [s.method || "method: you fill it in", s.date || today].join(" · ") };
      steps.push(s); continue;
    }
    // A real action cites its person (and gift); a list id is not a row read.
    if (s.donorId && A.TOOLS_BY_NAME[s.tool] && !["draft_note", "create_task", "open_thread", "log_note", "add_tag"].includes(s.tool))
      s = { ...s, citesRows: [...new Set([s.donorId, ...(s.otherDonorId ? [s.otherDonorId] : []), ...(s.citesRows || []).filter(id => byId.has(id) || giftIds.has(id))])] };
    // AGENTS-1 — A STEP OUTSIDE THE PERSONA'S TOOLS IS DROPPED AT PLAN TIME,
    // not at confirm time. She must never read a plan that says the Analyst
    // will move somebody's stage and then watch that step quietly not happen:
    // the plan she reads is the plan that runs.
    if (PS.dropOutOfScope(who.id, [s]).droppedCount) { outOfScope++; withheld++; continue; }
    if (!A.PLANNABLE.includes(s.tool)) { steps.push(s); continue; }
    if (s.donorId && !byId.has(s.donorId)) { withheld++; continue; }
    if (A.citationProblems(s, { knownRowIds }).length) { withheld++; continue; }
    const text = [s.body, s.note, s.title, s.label, s.subject].filter(Boolean).join(" \n ");
    if (TH.ungroundedClaims(text, { groundedValues }).length) { withheld++; continue; }
    if (draftProblems(s).length) { console.warn(`[agent] a draft for ${s.donorId} was withheld: ${draftProblems(s).join(" · ")}`); withheld++; continue; }
    // A task's due date: whole days from today, resolved HERE to the civil date
    // she reads on the plan. A `due` that is not a date is dropped.
    if (s.tool === "create_task") {
      const dd = Number.isInteger(s.dueDays) && s.dueDays >= 0 && s.dueDays <= 365 ? s.dueDays : null;
      s.due = /^\d{4}-\d{2}-\d{2}$/.test(String(s.due || "")) ? String(s.due) : dd != null ? orgTime.addDays(today, dd) : null;
    }
    steps.push(s);
  }
  const _tEnd = Date.now();
  const drafted = steps.filter(x => x && typeof x.body === "string" && x.body.trim().length > 0).length;
  console.log(`[agent-timing] org=${orgId} people=${reachable.length} steps=${steps.length} drafted=${drafted}`
    + ` | rows ${_tRows - _t0}ms · model ${_tModel - _tRows}ms · filter ${_tEnd - _tModel}ms · total ${_tEnd - _t0}ms`
    + (_truncated ? " | TRUNCATED at max_tokens" : ""));
  return { steps, sends: Number(raw.sends) || 0, withheld, outOfScope, persona: who.id, people: reachable, found,
           headline: raw.headline || null, cannot: raw.cannot || null,
           timing: { rowsMs: _tRows - _t0, modelMs: _tModel - _tRows, filterMs: _tEnd - _tModel,
                     totalMs: _tEnd - _t0, people: reachable.length, steps: steps.length, drafted,
                     truncated: _truncated } };
}

// ── A GIFT SHE TELLS IT ABOUT ──────────────────────────────────────────────
// No model. Steward parsed the amount and found the one record she named; the
// plan is the gift PREPARED for her to confirm, and a follow-up that waits for
// it. What the detail column says is read from the rows, never guessed.
function agentCivil(ymd, addDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return { ymd: null, long: "" };
  // The civil arithmetic goes through the seam (orgTime.addDays); the Date
  // below only spells the already-civil day, pinned to UTC so it cannot move.
  const day = orgTime.addDays(m[0], addDays);
  const [y, mo, d] = day.split("-").map(Number);
  return { ymd: day, long: new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) };
}
async function agentPreparedGiftPlan(orgId, text, donor) {
  const A = await agentShapeMod();
  const V = await import("../shared/vocabulary.js");
  const today = orgToday(await orgTz(orgId));
  const [fund] = await query(
    "SELECT name FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [orgId]);
  const method = A.methodFromInstruction(text);
  const day = agentCivil(today), due = agentCivil(today, 2);
  // FIX-2 — the one display format: "Sep 25" this year, "Sep 25, 2025" before.
  const D = await import("../shared/displayDate.js");
  const say = c => D.displayDateShort(c.ymd, today);
  const who = A.nameInSentence(donor);
  const gift = A.preparedGiftFromInstruction(text, [donor]);
  const steps = [
    { tool: "record_gift", donorId: donor.id, amountCents: gift.amountCents, preparedBy: "steward",
      method, date: day.ymd, citesRows: [donor.id],
      detail: [(fund && fund.name) || "General Operating", method || "method: you fill it in", say(day)].join(" · ") },
    { tool: "open_thread", donorId: donor.id, label: "Thank " + who, after: "record_gift", due: due.ymd,
      citesRows: [donor.id], detail: `Due ${say(due)} · you` },
  ];
  const plan = A.compilePlan(steps, { people: [donor], reads: `${who}'s record` });
  const last = donor.last_gift_date && Number(donor.last_gift_amount) > 0
    ? `Last gift ${A.formatCents(Math.round(Number(donor.last_gift_amount) * 100))}, ${say(agentCivil(donor.last_gift_date))}`
    : "No gift on file yet";
  plan.readIds = [donor.id];
  plan.readDetail = last;
  plan.giverWord = V.giverWordFor(donor, null);
  plan.prepared = true;
  plan.confirmLabel = A.confirmLabel(plan);
  return plan;
}

// ── FIX-3 B · SOMEBODY BECAME A VOLUNTEER ──────────────────────────────────
// No model. Steward recognised the news (agentShape.volunteerNews) and found
// the one record she named; the plan is the Volunteer role, her availability as
// a volunteer internal note, and one welcome DRAFT in her voice when she has
// taught Steward it (shared/draftNote.js). It reads that one record.
async function agentVolunteerPlan(orgId, text, personId) {
  const A = await agentShapeMod();
  const D = await import("../shared/draftNote.js");
  const [p] = await agentReadPeople(orgId, { ids: [personId] });
  if (!p) return null;
  const [org] = await query("SELECT name, voice_samples FROM orgs WHERE id=?", [orgId]);
  let samples = org && org.voice_samples;
  if (typeof samples === "string") { try { samples = JSON.parse(samples || "[]"); } catch { samples = []; } }
  const welcome = D.volunteerWelcomeDraft({ personName: p.name, orgName: org && org.name,
    voice: D.voiceFrom(Array.isArray(samples) ? samples : []) });
  const steps = A.volunteerSteps(p, A.volunteerNews(text), { instruction: text, welcome });
  const who = A.nameInSentence(p);
  if (!steps.length) return { nothing: `${who} is already a volunteer, and Steward found nothing else in that to do.` };
  const plan = A.compilePlan(steps, { people: [p], reads: `${who}'s record` });
  plan.readIds = [p.id];
  plan.readDetail = "This record only, not the whole file";
  plan.confirmLabel = A.confirmLabel(plan);
  return plan;
}

// ── RUNNING A CONFIRMED PLAN ───────────────────────────────────────────────
// THE RUN IS THE PLAN. It executes the plan's own steps, in the plan's order,
// and nothing else: there is no second model call to come up with different
// actions. Each step is still checked here, because a stored plan is data: the
// tool must have an executor, the donor must be this org's, and the step must
// cite rows Steward read. A money step is never executed here: the PERSON
// recorded it in the confirm route (`confirmed`), and the run says so.
async function agentRunPlan(orgId, instruction, { userId, confirmed = {}, auth = null }) {
  const A = await agentShapeMod();
  const TH = await thresholdsMod();
  const runId = "arun_" + uuid().slice(0, 10);
  const plan = instruction.plan || {};
  const planSteps = Array.isArray(plan.steps) ? plan.steps : [];
  // READS ARE SCOPED: the run reads the people its steps name, and nobody else.
  // AGENT-2: a merge proposal names a second person too.
  const named = [...new Set(planSteps.flatMap(s => [s.donorId, s.otherDonorId]).filter(Boolean))];
  const people = named.length ? await agentReadPeople(orgId, { ids: named }) : [];
  const byId = new Map(people.map(p => [p.id, p]));
  // PARITY-1 Part F: a step may cite a GIFT as well as its giver. A cited
  // gift counts as read only when it is this org's and that giver's.
  const citedGiftIds = [...new Set(planSteps.flatMap(s => (Array.isArray(s.citesRows) ? s.citesRows : []).map(String))
    .filter(id => !byId.has(id)))].slice(0, 2000);
  const citedGifts = citedGiftIds.length && named.length
    ? await query(`SELECT id, donor_id, amount FROM gifts WHERE org_id = ? AND id = ANY(?::text[]) AND donor_id = ANY(?::text[])`,
        [orgId, citedGiftIds, named]) : [];
  const knownRowIds = [...people.map(p => p.id), ...citedGifts.map(g => g.id)];
  // Deceased, do-not-contact and sample people get no work, whatever the plan
  // says (BUILD-83; the incident's rule that fiction generates nothing).
  const reachable = people.filter(p => !p.deceased && !p.do_not_contact && !p.is_sample);
  const reachableIds = new Set(reachable.map(p => p.id));
  const today = orgToday(await orgTz(orgId));
  const readSummary = plan.reads
    || (people.length === 1 ? `${A.nameInSentence(people[0])}'s record` : `${people.length} records`);

  await run(`INSERT INTO agent_runs (id,org_id,instruction_id,status,plan,read_summary)
             VALUES (?,?,?,'running',?,?)`,
    [runId, orgId, instruction.id, JSON.stringify(plan), String(readSummary).slice(0, 300)]);

  // Every run is kept per org beside the prompts (agentShape.PROMPT_RETENTION_DAYS):
  // the plan it carried out, verbatim, and what came of each step below.
  await run(`INSERT INTO ai_log (id,org_id,user_id,type,prompt_summary,prompt_full,response_full,run_id)
             VALUES (?,?,?,'agent',?,?,?,?)`,
    ["log_" + uuid().slice(0, 8), orgId, userId || null, String(instruction.text).slice(0, 100),
     JSON.stringify({ instruction: instruction.text, steps: planSteps }).slice(0, 200000), "", runId]);

  const groundedValues = [...reachable.flatMap(p => [p.total_giving, p.gift_count, p.last_gift_amount]),
    ...citedGifts.map(g => g.amount)].map(Number).filter(Number.isFinite);
  const SKIPPED = { already_open: "a follow-up was already open", unknown_donor: "the record is not there",
    unknown_stage: "that stage does not exist", already_there: "they were already at that stage",
    no_tag: "there was no tag to add", already_tagged: "they already had that tag",
    already_volunteer: "they were already a volunteer", not_a_volunteer: "they are not marked as a volunteer",
    no_note: "there was nothing to note", not_in_group: "they were not in that group",
    not_in_journey: "they were not in that journey", already_thanked: "that gift was already marked thanked",
    already_proposed: "that pair was already in the duplicate queue" };

  let drafted = 0, done = 0, withheld = 0, declined = 0;
  const withheldReasons = [];
  const outcomes = [];
  const outcome = (a, o, reason, extra) => outcomes.push({ tool: a.tool, donorId: a.donorId || null,
    describes: a.describes || null, state: a.state || null, outcome: o, reason: reason || null, ...(extra || {}) });

  try {
    // AGENT-2: NO RUN-WIDE TRANSACTION. Each step commits on its own and is
    // its own undo, because the steps now write through the screens' routes
    // (on the pool) and a transaction held around them would lock the rows
    // those routes wait for. A step that fails is said, and the ones before it
    // stay done and undoable.
    await require("../db").withClient(async (txClient) => {
      const ctx = { client: txClient, orgId, runId, instructionId: instruction.id, userId, today,
                    auth, instructionText: String(instruction.text || "").slice(0, 240),
                    donorById: id => byId.get(id) || null };
      for (let i = 0; i < planSteps.length; i++) {
        const a = planSteps[i];
        // THE PERSON'S STEP. Recorded by her before this run began, or not at all.
        if (a.state === A.STEP_CONFIRM) {
          const c = confirmed[i];
          // AGENT-2: DONE MEANS THE GIFT IS THERE: read back, to the cent.
          const [g] = c && c.giftId ? await query("SELECT id, amount FROM gifts WHERE id=? AND org_id=? AND donor_id=?", [c.giftId, orgId, a.donorId]) : [];
          if (g && Math.round(Number(g.amount) * 100) === Number(a.amountCents)) { done++; outcome(a, A.OUTCOME_DONE, null, { giftId: c.giftId, by: c.by || null }); }
          else if (c && c.reason === "it was already recorded") outcome(a, A.OUTCOME_NOT_DONE, c.reason);
          else { declined++; outcome(a, A.OUTCOME_FAILED, (c && c.reason) || (c && c.giftId ? "the gift is not on file as prepared" : "it was not confirmed")); }
          continue;
        }
        // A step that waits on another runs only when that one was done.
        if (a.after) {
          const dep = outcomes.find(o => o.tool === a.after);
          if (!dep || dep.outcome !== A.OUTCOME_DONE) {
            outcome(a, A.OUTCOME_NOT_DONE, a.after === "record_gift" ? "the gift was not recorded" : "the step before it did not run");
            continue;
          }
        }
        // 1 · a tool with no executor is refused. A money tool has no executor.
        if (!AGENT_RUNNABLE.includes(a.tool)) { declined++; withheldReasons.push(`no such tool: ${a.tool}`); outcome(a, A.OUTCOME_NOT_DONE, "Steward has no way to do that"); continue; }
        // 2 · a donor that is not this org's is nobody.
        if (a.donorId && !byId.has(a.donorId)) { declined++; withheldReasons.push("names somebody not in this organisation"); outcome(a, A.OUTCOME_NOT_DONE, "that record is not in this organisation"); continue; }
        if (a.donorId && !reachableIds.has(a.donorId)) { declined++; withheldReasons.push("deceased, do-not-contact or sample"); outcome(a, A.OUTCOME_NOT_DONE, "the record says not to contact them"); continue; }
        // 3 · A STEP THAT CANNOT CITE A ROW IS NOT TAKEN.
        const cite = A.citationProblems(a, { knownRowIds });
        if (cite.length) { withheld++; withheldReasons.push(cite[0]); outcome(a, A.OUTCOME_NOT_DONE, "Steward could not point at the record it came from"); continue; }
        // 4 · no invented rule reaches a screen (shared/thresholds.js).
        const text = [a.body, a.note, a.title, a.label, a.subject].filter(Boolean).join(" \n ");
        const ungrounded = TH.ungroundedClaims(text, { groundedValues });
        if (ungrounded.length) { withheld++; withheldReasons.push(TH.ungroundedSentence(ungrounded)); outcome(a, A.OUTCOME_NOT_DONE, "it said something the record does not"); continue; }

        const r = await AGENT_EXECUTORS[a.tool](ctx, a);
        if (r && r.skipped) { declined++; withheldReasons.push(r.skipped); outcome(a, A.OUTCOME_NOT_DONE, SKIPPED[r.skipped] || r.skipped); continue; }
        // AGENT-2: it ran, and what it claimed is not there: Failed, never Done.
        if (r && r.failed) { declined++; withheldReasons.push(r.failed); outcome(a, A.OUTCOME_FAILED, r.failed); continue; }
        if (r && r.drafted) { drafted++; done++; outcome(a, A.OUTCOME_WAITING, "the draft is waiting for you", { entityId: r.id || null }); continue; }
        done++;
        outcome(a, A.OUTCOME_DONE, (r && r.note) || null, { entityId: (r && r.id) || null });
      }
    });
  } catch (e) {
    // A run that broke still ENDS: the server's row says failed, so no screen
    // can sit on "Running…" for a run that is over.
    await run(`UPDATE agent_runs SET status='failed', finished_at=NOW(), actions=?, error=? WHERE id=?`,
      [JSON.stringify(outcomes), String(e && e.message || e).slice(0, 400), runId]);
    return { runId, status: "failed", error: "run_failed", steps: outcomes, sent: 0 };
  }

  await run(`UPDATE agent_runs SET status='done', finished_at=NOW(), actions=?, drafted=?, sent=0,
             declined=?, withheld=?, withheld_reason=? WHERE id=?`,
    [JSON.stringify(outcomes), drafted, declined, withheld,
     withheldReasons.slice(0, 5).join(" · ").slice(0, 600) || null, runId]);

  // NOTHING IS SENT BY THIS PATH. `sent` is written as 0 above, deliberately
  // and unconditionally: the signed-for-sending half is still open,
  // because sending needs a Resend key that is currently an invalid sentinel by
  // deliberate incident containment, and shipping a send path that has never
  // once been walked is exactly the mistake that caused the incident.
  return { runId, status: "done", done, drafted, withheld, declined, sent: 0,
           steps: outcomes, withheldReason: withheldReasons.slice(0, 5) };
}

// ── FIX-2 D · THE READS ────────────────────────────────────────────────────
// A report is opened by the id Reports already deep-links; its count is the
// report's own (the same handler GET /reports/:key runs), never a second
// computation. A person is found by the same naming rule the plans use.
async function agentAnswerRead(A, orgId, read, named) {
  const note = "Steward read this and wrote nothing.";
  if (read.kind === "find") {
    const ids = named.scope || [];
    if (!ids.length) return null;
    const people = await agentReadPeople(orgId, { ids });
    if (!people.length) return null;
    if (people.length === 1) return { kind: "person", donorId: people[0].id, name: people[0].name,
      sentence: `${people[0].name}'s record.`, note };
    return { kind: "people", people: people.slice(0, 8).map(p => ({ id: p.id, name: p.name })),
      sentence: `${people.length} records match that name. Open the one you meant.`, note };
  }
  const out = { kind: read.kind === "explain" ? "explain" : "report", report: read.report, name: read.name,
    savedReport: read.savedReport, sentence: read.sentence, count: null, note };
  if (read.kind !== "explain" && (read.report === "lybunt" || read.report === "sybunt")) {
    const { reportHooks } = require("./crm");
    const data = await reportHooks.run(orgId, read.report, { yearMode: "fiscal" });
    const n = ((data && data.rows) || []).length;
    out.count = n;
    out.answer = read.report === "lybunt"
      ? `${n} ${n === 1 ? "person gave" : "people gave"} last year and ${n === 1 ? "has" : "have"} not yet given this year.`
      : `${n} ${n === 1 ? "person has" : "people have"} given in an earlier year and not yet this year.`;
  }
  return out;
}

// WHETHER DRAFTING IS ON, AND IF NOT, WHY AND WHO CAN TURN IT ON. A read: the
// room draws its drafting line from this, and a GET changes nothing.
app.get("/agent/status", requireAuth, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const orgId = req.user.orgId;
  const [org] = await query("SELECT ai_enabled, agent_paused_at FROM orgs WHERE id=?", [orgId]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const [me] = await query("SELECT role FROM users WHERE id=? AND org_id=?", [req.user.userId, orgId]);
  const admins = (await query(
    `SELECT name, email FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 12`,
    [orgId])).map(u => u.name || u.email).filter(Boolean);
  const configured = !!process.env.ANTHROPIC_API_KEY;
  const enabled = org.ai_enabled !== false;
  const isAdmin = !!(me && me.role === "admin");
  res.json({ configured, enabled, paused: !!org.agent_paused_at, isAdmin, admins,
    ...A.draftingState({ configured, enabled, paused: !!org.agent_paused_at, isAdmin, admins }) });
}));

// ── AGENTS-1 · THE SIX, AS DATA ────────────────────────────────────────────
// The Ask tab's cards, the badges and the Guardrails list all read THIS. The
// client holds no persona list of its own, so a seventh persona is one entry
// in shared/agentPersonas.js and nothing else. A read: it writes nothing and
// touches no org row, but it stays behind requireAuth because it describes
// what this product's agent can do.
app.get("/agent/personas", requireAuth, wrap(async (req, res) => {
  const PS = await agentPersonasMod();
  res.json({
    personas: PS.PERSONAS.map(p => ({ id: p.id, name: p.name, tagline: p.tagline,
      description: p.description, tools: p.tools, suggestedTriggers: p.suggestedTriggers,
      guardrailNote: p.guardrailNote })),
    // Said once, here, so the Guardrails tab states the real mechanisms and
    // nothing else: no thresholds, no auto-pause, no managed no-contact list.
    guardrails: [
      "Every instruction shows you its plan before anything runs, and nothing runs until you confirm it.",
      "Drafts are drafts. Steward writes them into your queue and you press send.",
      "Every write the agent makes is logged with the instruction that caused it, and can be undone for thirty days.",
      "Anybody the record marks deceased or do-not-contact is removed before the agent sees them.",
      "No agent can move money. There is no tool for it, not a setting that turns it off.",
    ],
    sentence: "Six agents, one engine. Each one can do less than the engine can, never more.",
  });
}));

// ── ROUTES ─────────────────────────────────────────────────────────────────
// THE PLAN. Writes an instruction and a plan; runs NOTHING.
// ═══ HELP-1 · ASK STEWARD, THE QUESTION LOG, AND ASK A PERSON ══════════════
// Ask Steward is the engine's help persona (shared/agentPersonas.js HELP): it
// has NO tools, and its prompt is built ONLY by buildHelpPrompt from the
// question and the help articles search found. This route reads no table but
// the question log it writes, and never a donor, org or user row.
const helpArticlesMod = () => import("../shared/helpArticles.js");
const helpSearchMod = () => import("../shared/helpSearch.js");
const SUPPORT_EMAIL = () => process.env.SUPPORT_EMAIL || "support@stewardapp.dev";
const REPLY_PROMISE = () => process.env.SUPPORT_REPLY_PROMISE || "within one business day";
// The question, and only the question, kept twelve months for "what should we
// build next". Never the answer, never anything the person did not type.
async function logQuestion(surface, question, topic) {
  await run(`INSERT INTO question_log (surface, question, topic) VALUES (?,?,?)`, [surface, String(question).slice(0, 1000), topic || null]).catch(() => {});
  await run(`DELETE FROM question_log WHERE created_at < NOW() - INTERVAL '12 months'`).catch(() => {});
}

app.post("/help/ask", requireAuth, wrap(async (req, res) => {
  const question = String(req.body?.question || "").trim().slice(0, 1000);
  if (!question) return res.status(400).json({ error: "Ask a question in a few words." });
  const { HELP_ARTICLES } = await helpArticlesMod();
  const HS = await helpSearchMod();
  const found = HS.searchArticles(HELP_ARTICLES, question, 3);
  await logQuestion("help", question, found[0]?.slug || "not covered");
  const cite = found.map(a => ({ slug: a.slug, title: a.title, summary: a.summary }));
  if (!found.length) return res.json({ covered: false, answer: null, articles: [],
    sentence: "The help centre does not cover that yet. Ask a person and we will answer " + REPLY_PROMISE() + "." });
  const gate = await aiGate(req.user.orgId);
  if (!gate.ok) return res.json({ covered: true, answer: null, articles: cite, aiOff: gate.reason === "ai_disabled",
    sentence: gate.reason === "ai_disabled" ? AI_OFF_MESSAGE + ". Here is what the help centre says." : "Here is what the help centre says." });
  const PS = await agentPersonasMod();
  const prompt = HS.buildHelpPrompt(question, found, PS.HELP.systemPrompt);
  let answer = null;
  try {
    const client = anthropicFor(req.user.orgId);
    // No `tools`: the help persona has none, so the model has nothing to call.
    // FIX-28: the ASK-3 bug in its other place. A short answer needs no
    // thinking, and with the model's default thinking on it could eat the 700
    // tokens. An answer that did not finish is never shown; the articles are.
    const r = await client.messages.create({ model: AGENT_MODEL, max_tokens: 700, thinking: { type: "disabled" }, system: prompt.system, messages: prompt.messages });
    answer = r.stop_reason && r.stop_reason !== "end_turn" ? null
      : (r.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim() || null;
  } catch (e) { console.error("[help] ask:", e.message); }
  res.json({ covered: true, answer, articles: cite, sentence: answer ? null : "Here is what the help centre says." });
}));

app.get("/help/settings", requireAuth, wrap(async (req, res) => {
  res.json({ replyPromise: REPLY_PROMISE(), supportEmail: SUPPORT_EMAIL() });
}));

// "Did this help?" A slug and a yes or no. Nobody is identified.
app.post("/help/feedback", wrap(async (req, res) => {
  const slug = String(req.body?.slug || "").replace(/[^a-z0-9-]/g, "").slice(0, 80);
  if (!slug || typeof req.body?.helpful !== "boolean") return res.status(400).json({ error: "slug and helpful are required" });
  req.audit && req.audit.skip("anonymous article feedback");
  await run(`INSERT INTO help_feedback (slug, helpful) VALUES (?,?)`, [slug, req.body.helpful]);
  res.json({ ok: true });
}));

// ASK A PERSON. The ticket carries the screen and browser, never donor data.
async function mailSupport(to, subject, text) {
  if (!process.env.RESEND_API_KEY) { console.warn("[help] RESEND_API_KEY not set; not sent:", subject); return false; }
  const { isBlockedAddress } = require("../mailBlock");
  if (isBlockedAddress(to)) return false;
  // FIX-15 Part 3: a refusal comes back as { error }, not a throw. (And the
  // SDK's field is `replyTo`; `reply_to` was silently dropped.)
  try {
    const out = await resend.emails.send({ from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev", to, replyTo: SUPPORT_EMAIL(), subject, text });
    if (out && out.error) { console.error("[help] mail refused:", out.error.message); return false; }
    return true;
  } catch (e) { console.error("[help] mail:", e.message); return false; }
}
app.post("/help/tickets", requireAuth, wrap(async (req, res) => {
  const body = String(req.body?.body || "").trim().slice(0, 6000);
  if (!body) return res.status(400).json({ error: "Tell us what you need, in a sentence or two." });
  const subject = (String(req.body?.subject || "").trim() || body.split("\n")[0]).slice(0, 140);
  const screen = String(req.body?.screen || "").slice(0, 80) || null;
  const browser = String(req.headers["user-agent"] || "").slice(0, 300);
  const [u] = await query(`SELECT id, name, email FROM users WHERE id=?`, [req.user.userId]);
  const [o] = await query(`SELECT name FROM orgs WHERE id=?`, [req.user.orgId]);
  const id = "tkt_" + uuid().slice(0, 10), who = actor(req);
  await run(`INSERT INTO support_tickets (id,org_id,user_id,user_email,user_name,subject,screen,browser,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, u.id, u.email, u.name, subject, screen, browser, who.id, who.name]);
  await run(`INSERT INTO support_ticket_messages (id,ticket_id,from_kind,body,created_by,created_by_name) VALUES (?,?,?,?,?,?)`,
    ["tkm_" + uuid().slice(0, 10), id, "customer", body, who.id, who.name]);
  // The ticket is stored either way, so "Sent" is true of the ticket; the
  // alert to support is what can fail, and that is logged where support looks.
  const alerted = await mailSupport(SUPPORT_EMAIL(), `[${id}] ${subject}`,
    `${u.name || u.email} at ${o?.name || req.user.orgId} asked:\n\n${body}\n\nScreen: ${screen || "not given"}\nBrowser: ${browser}\nReply from the super-admin ticket list so it reaches them.`);
  if (!alerted) console.error(`[help] ticket ${id} stored, but the alert email to support was not delivered`);
  res.status(201).json({ id, sentence: `Sent. A person will reply to ${u.email} ${REPLY_PROMISE()}.` });
}));
app.get("/admin/tickets", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const rows = await query(`SELECT t.*, o.name AS org_name FROM support_tickets t LEFT JOIN orgs o ON o.id=t.org_id ORDER BY (t.status='closed'), t.updated_at DESC LIMIT 200`);
  for (const t of rows) t.messages = await query(`SELECT from_kind, body, created_at, created_by_name FROM support_ticket_messages WHERE ticket_id=? ORDER BY created_at`, [t.id]);
  res.json({ tickets: rows });
}));
app.post("/admin/tickets/:id/reply", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [t] = await query(`SELECT * FROM support_tickets WHERE id=?`, [req.params.id]);
  if (!t) return res.status(404).json({ error: "No such ticket." });
  const body = String(req.body?.body || "").trim().slice(0, 6000);
  const status = ["open", "waiting", "closed"].includes(req.body?.status) ? req.body.status : (body ? "waiting" : t.status);
  const who = actor(req);
  let emailed = null;   // null: no reply text, so nothing to email
  if (body) {
    await run(`INSERT INTO support_ticket_messages (id,ticket_id,from_kind,body,created_by,created_by_name) VALUES (?,?,?,?,?,?)`,
      ["tkm_" + uuid().slice(0, 10), t.id, "support", body, who.id, who.name]);
    emailed = await mailSupport(t.user_email, `Re: ${t.subject}`, `${body}\n\nReply to this email and it reaches us.`);
  }
  await run(`UPDATE support_tickets SET status=?, updated_at=NOW() WHERE id=?`, [status, t.id]);
  res.json({ ok: true, status, emailed });
}));
app.get("/admin/questions", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const groups = await query(`SELECT surface, COALESCE(topic,'unsorted') AS topic, COUNT(*)::int AS n,
                                     (ARRAY_AGG(question ORDER BY created_at DESC))[1:5] AS recent
                                FROM question_log WHERE created_at > NOW() - INTERVAL '12 months'
                               GROUP BY 1,2 ORDER BY n DESC LIMIT 200`);
  // WHY-1 — the questions Steward could not answer, grouped by topic. This is
  // the roadmap: what people asked "why" about that none of the seven covers.
  const unanswered = await query(`SELECT surface, COALESCE(topic,'unsorted') AS topic, COUNT(*)::int AS n,
                                         (ARRAY_AGG(question ORDER BY created_at DESC))[1:8] AS recent
                                    FROM question_log WHERE created_at > NOW() - INTERVAL '12 months' AND answered = false
                                   GROUP BY 1,2 ORDER BY n DESC LIMIT 100`);
  res.json({ groups, unanswered, sentence: "The question text people typed into Ask Steward, Ask why, the Agent and the Analyst, grouped by topic, kept twelve months. Never answers, never donor data." });
}));

// HARDEN-1 · A PLAN THAT IS NEVER KEPT. The prod smoke after each deploy
// builds one real plan through the same agentBuildPlan the instruction route
// runs (the find, the model, the checks), and nothing is written: no
// instruction row, no ai_log, no trial count. Declared read-only in
// auditTrail.READ_ONLY_POSTS (/agent/preview). It answers what the plan would
// do, in counts; the steps' words stay out of the response.
app.post("/agent/preview", requireAuth, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const text = String((req.body && req.body.text) || "").trim().slice(0, 2000);
  if (text.length < 4) return res.status(400).json({ error: "text_required", sentence: "Say what to plan." });
  const gate = await agentGate(req.user.orgId);
  if (!gate.ok) return res.status(503).json({ error: gate.reason, sentence: "The Agent is not available for this organisation." });
  let built;
  try { built = await agentBuildPlan(req.user.orgId, text, { authorization: A.AUTH_DRAFT, userId: req.user.userId, dryRun: true }); }
  catch (e) {
    if (e && e.truncated) return res.status(422).json({ error: "plan_truncated", sentence: A.TRUNCATED_SENTENCE });
    if (e && e.refuse) return res.status(e.refuse.error === "plan_failed" ? 503 : 400).json(e.refuse);
    console.error("[agent] preview failed", e?.status || "", e?.message || e);
    return res.status(503).json({ error: "plan_failed", sentence: AGENT_PLAN_FAILED });
  }
  const tools = {};
  for (const st of built.steps) tools[st.tool] = (tools[st.tool] || 0) + 1;
  res.json({ preview: true, steps: built.steps.length, tools, withheld: built.withheld, found: built.found ? built.found.ids.length : null,
    words: built.found ? built.found.words : null, timing: built.timing ? { totalMs: built.timing.totalMs } : null });
}));

app.post("/agent/instructions", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "An instruction needs words." });
  if (text.length > 2000) return res.status(400).json({ error: "That instruction is too long to plan from." });
  // HELP-1 — what people ask the Agent and the Analyst, the text only.
  await logQuestion(req.body?.persona === "analyst" ? "analyst" : "agent", text, req.body?.persona || "general");

  // THE MONEY REFUSAL COMES FIRST, before the gate and before the model. It is
  // a sentence, not a route: "refund Margaret" is told no and told why, never
  // quietly turned into a task for somebody else, because a silent reroute
  // teaches her the instruction worked and she finds out it did not when
  // Margaret rings up.
  const money = A.moneyRefusal(text);
  if (money) return res.status(400).json({ error: "money_instruction", sentence: money.sentence, matched: money.matched });

  // PAUSE STOPS EVERYTHING, the gift she tells it about included.
  const [pauseRow] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [req.user.orgId]);
  if (pauseRow && pauseRow.agent_paused_at) return res.status(503).json({ error: "agent_paused" });

  const kind = req.body?.kind === A.KIND_STANDING ? A.KIND_STANDING : A.KIND_TASK;
  const trigger = kind === A.KIND_STANDING ? String(req.body?.trigger || "") : null;
  if (kind === A.KIND_STANDING && !A.TRIGGER_KEYS.includes(trigger))
    return res.status(400).json({ error: "A standing instruction needs to say when it runs." });

  // The flip is HERS and it is per instruction. It is read from the body, and
  // the DATABASE default is 'draft', so an instruction that arrives without one
  // drafts.
  const auth = req.body?.authorization === A.AUTH_SEND ? A.AUTH_SEND : A.AUTH_DRAFT;

  // AGENTS-1 — WHICH OF THE SIX. Optional: absent means the general agent, and
  // an instruction that arrives without one behaves exactly as it did before
  // this build. An id the registry does not know is a 400 rather than a silent
  // fallback, because silently planning as somebody else is worse than a
  // refusal she can read.
  const PS = await agentPersonasMod();
  const rawPersona = req.body?.persona == null || req.body.persona === "" ? null : String(req.body.persona);
  if (rawPersona !== null && !PS.isValidPersona(rawPersona))
    return res.status(400).json({ error: "unknown_persona",
      sentence: `Steward has no agent called "${rawPersona.slice(0, 40)}".`,
      personas: PS.PERSONA_IDS });
  const persona = rawPersona;

  // FIX-1 §A — WHO SHE NAMED decides what is read. FIX-3 B: `personId` is her
  // answer to "which one?", and it must be one of the records the name matched.
  const named = await agentNamedIn(req.user.orgId, text, req.body?.personId);
  if (named.badPick) return res.status(400).json({ error: "not_one_of_them",
    sentence: "That is not one of the records that name matches. Pick one from the list." });

  const giftNews = kind === A.KIND_TASK && A.isGiftNews(text) && !!A.parseAmountCents(text);
  const read = kind === A.KIND_TASK && !giftNews ? A.readIntent(agentUnaddressed(text)) : null;
  // FIX-3 B — MORE THAN ONE ADA: ASK WHICH, BEFORE ANY PLAN. The walk's plan
  // carried a task "Confirm which Ada"; the question belongs before the plan,
  // and asking it writes nothing. A read ("find ada") lists them itself.
  if (named.ambiguous.length && !read)
    return res.json({ which: await agentWhich(req.user.orgId, named.ambiguous[0]) });

  let plan;
  const volunteer = kind === A.KIND_TASK && !giftNews ? A.volunteerNews(text) : null;
  if (giftNews) {
    // A GIFT SHE TELLS IT ABOUT is prepared for her to confirm. No model is
    // asked, so no key is needed: Steward parsed it and found the record.
    const giverId = named.scope && named.scope.length === 1 ? named.scope[0] : null;
    const [donor] = giverId ? await agentReadPeople(req.user.orgId, { ids: [giverId] }) : [];
    if (!donor) {
      return res.status(400).json({ error: "gift_needs_giver",
        sentence: named.scope && named.scope.length > 1
          ? "That names more than one record. Tell Steward about one gift at a time, with the giver as they are written on their record."
          : "Steward could not tell who gave it. Name the giver as they are written on their record, and Steward will prepare the gift for you to confirm." });
    }
    plan = await agentPreparedGiftPlan(req.user.orgId, text, donor);
  } else if (volunteer) {
    // FIX-3 B — SOMEBODY BECAME A VOLUNTEER. No model, so no key: Steward
    // recognised the news and found the one record she named.
    const ids = named.scope || [];
    if (ids.length !== 1) {
      return res.status(400).json({ error: "volunteer_needs_person",
        sentence: ids.length > 1
          ? "That names more than one person. Tell Steward about one new volunteer at a time."
          : "Steward could not find who that is on file. Name them as they are written on their record, or add them to Donors first, and Steward will plan it." });
    }
    plan = await agentVolunteerPlan(req.user.orgId, text, ids[0]);
    if (!plan) return res.status(400).json({ error: "volunteer_needs_person", sentence: "Steward could not find that record." });
    if (plan.nothing) return res.status(400).json({ error: "nothing_to_do", sentence: plan.nothing });
  } else {
    // FIX-2 D — A READ NEEDS NO DRAFTING. Opening a report, finding a person,
    // counting and explaining a number are answered here, without a model and
    // without the drafting switch, and they WRITE NOTHING: no instruction row,
    // no run, no audit. The answer says so.
    if (read) {
      // AI-FIX: "find donors in North Carolina I haven't reached out to" is a
      // filtered list, answered from the donor list's own filters and read-only.
      if (read.kind === "find" && !(named.scope && named.scope.length)) {
        const g = await agentGate(req.user.orgId);
        const today = orgToday(await orgTz(req.user.orgId));
        let found;
        try { found = await agentFindPeople(req.user.orgId, text, today, { client: g.ok ? anthropicFor(req.user.orgId) : null }); }
        catch (e) { if (e && e.refuse) return res.status(503).json(e.refuse); throw e; }
        if (found) {
          const n = found.ids.length > 1000 ? 1000 : found.ids.length;
          const people = n ? await agentReadPeople(req.user.orgId, { ids: found.ids.slice(0, 12) }) : [];
          return res.json({ read: { kind: "list", count: n, words: found.words,
            title: n === 0 ? "Nobody matches" : n === 1 ? "One person matches" : `${found.ids.length > 1000 ? "More than 1,000" : n.toLocaleString("en-US")} people match`,
            sentence: n === 0 ? `Nobody on file matches (${found.words.join(" · ")}).` : found.words.join(" · "),
            people: people.map(p => ({ id: p.id, name: p.name })), more: found.ids.length > 1000 ? 0 : Math.max(0, n - people.length),
            note: "Steward read this and wrote nothing. To act on them, say what to do, for example \"plan a call to each of them\"." } });
        }
      }
      const answer = await agentAnswerRead(A, req.user.orgId, read, named);
      if (answer) return res.json({ read: answer });
    }
    const gate = await agentGate(req.user.orgId);
    if (!gate.ok) {
      // The reason says WHICH: Steward's missing key is never told to her as
      // her organisation's setting (agentGate calls it agent_unavailable; the
      // error keeps that name, the reason says what it is).
      const reason = gate.reason === "agent_unavailable" ? "ai_no_key" : gate.reason;
      const st = A.draftingState({ configured: reason !== "ai_no_key", enabled: reason !== "ai_disabled", paused: reason === "agent_paused" });
      const lead = A.looksLikeRead(text)
        ? "Steward needs drafting to answer that one; without it, it opens reports by name (LYBUNT, SYBUNT, Retention, Top Donors), finds a person by name, counts and explains. "
        : "";
      return res.status(503).json({ error: gate.reason, reason, sentence: lead + st.sentence });
    }
    // GTM-1b 2 — THE TRIAL ALLOWANCE, CHECKED BEFORE THE MODEL IS CALLED.
    // Twenty-five plans in the free thirty days; no cap at all once the first
    // charge has landed. It refuses HERE, above agentBuildPlan, because the
    // point of a cap is not to spend the call — a refusal after the model has
    // answered has already cost what the cap exists to prevent.
    const allow = await agentTrialAllowance(req.user.orgId);
    if (allow.capped && allow.exhausted) {
      return res.status(402).json({
        error: "agent_trial_allowance",
        used: allow.used, allowance: allow.allowance,
        sentence: `You have used all ${allow.allowance} Agent plans included in your free thirty days. `
          + `The Agent comes back without a limit the moment your first charge goes through — nothing else `
          + `about Steward is affected, and every plan you have already written is still here.`,
      });
    }
    // PARITY-1 Part F: "a task for every gift this week, due in a week" is
    // planned by Steward from the gift rows, behind the same switch and the
    // same plan sheet: she reads every task before one is created.
    const giftTasks = kind === A.KIND_TASK ? A.giftTaskShape(text, orgToday(await orgTz(req.user.orgId))) : null;
    if (giftTasks && (!persona || PS.getPersona(persona).tools.includes("create_task"))) {
      const p = await agentGiftTaskPlan(req.user.orgId, giftTasks, named.scope);
      if (p.refuse) return res.status(400).json(p.refuse);
      plan = p;
    } else {
    let built;
    try { built = await agentBuildPlan(req.user.orgId, text, { authorization: auth, scope: named.scope, userId: req.user.userId, persona }); }
    catch (e) {
      if (e && e.truncated) return res.status(422).json({ error: "plan_truncated", sentence: A.TRUNCATED_SENTENCE });
      if (e && e.refuse) return res.status(e.refuse.error === "plan_failed" ? 503 : 400).json(e.refuse);
      console.error("[agent] plan failed", e?.status || "", e?.message || e);
      return res.status(503).json({ error: "plan_failed", sentence: AGENT_PLAN_FAILED });
    }
    const readNames = named.scope
      ? built.people.map(p => A.nameInSentence(p)).join(", ") + (built.people.length === 1 ? "'s record" : "'s records")
      : built.found ? `the ${built.people.length === 1 ? "one person" : built.people.length + " people"} who match: ${built.found.words.join(" · ")}`
      : `your ${built.people.length} people`;
    // AGENT-2: find and count are reads with no executor: as a step they ran
    // as "Done · 0". They are left out, and an instruction that is only a
    // question is told so rather than given a plan that does nothing.
    // AI-FIX: a "cannot" that talks about Steward's insides ("the rows in front
    // of me") is not shown; she gets a plain sentence instead.
    if (built.cannot && /\b(rows?|in front of me|data ?set|the data|columns?|fields?|json|records? (shown|provided|given)|i was (shown|given))\b/i.test(built.cannot))
      built.cannot = "Steward can't do that part yet. Try naming who you mean, for example by state, city or when they last gave.";
    const runnable = built.steps.filter(x => !["find_people", "count"].includes(x.tool));
    const readOnly = built.steps.length - runnable.length;
    plan = A.compilePlan(runnable, { people: built.people, reads: readNames, withheld: built.withheld,
      headline: built.headline, cannot: built.cannot || (readOnly && !runnable.length
        ? "That is a question rather than work. Steward answers it in Reports (or try \"open the retention report\"); a plan here would change nothing" : null) });
    if (!plan.steps.length) return res.json({ cannot: { sentence: plan.cannot || "Steward found nothing it can do for that, so nothing was planned." } });
    if (built.timing) plan.timing = built.timing;   // FIX-8 Part D.1
    plan.sends = Math.max(plan.sends, built.sends);
    plan.readIds = named.scope || null;
    plan.confirmLabel = A.confirmLabel(plan);
    }
  }

  const check = A.validatePlan(plan, { authorization: auth });
  if (!check.ok) return res.status(422).json({ error: "plan_refused", reasons: check.errors });

  const id = "ai_" + uuid().slice(0, 10);
  await run(`INSERT INTO agent_instructions (id,org_id,text,kind,trigger,status,send_authorization,persona,plan,last_count,created_by,created_by_name)
             VALUES (?,?,?,?,?,'planned',?,?,?,?,?,?)`,
    [id, req.user.orgId, text, kind, trigger, auth, persona, JSON.stringify(plan),
     plan.expectedCount || 0, actor(req).id, actor(req).name]);

  res.status(201).json({ id, kind, trigger, authorization: auth, plan,
    persona, personaName: PS.getPersona(persona).name,
    // FIX-8 Part D.1 — the split, on the response, so the number can be read
    // without shell access to a production log.
    ...(plan && plan.timing ? { timing: plan.timing } : {}),
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
  const orgId = req.user.orgId;
  const [ins] = await query("SELECT * FROM agent_instructions WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!ins) return res.status(404).json({ error: "Instruction not found" });
  // The run no longer asks a model anything (the plan IS the run), so the only
  // gate here is pause.
  const [pauseRow] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [orgId]);
  if (pauseRow && pauseRow.agent_paused_at) return res.status(503).json({ error: "agent_paused" });

  // "SHE TURNED IT ON" HAS TO BE TRUE. A super-admin may build an instruction
  // inside her org and leave it planned; only somebody who works there can
  // confirm it. BUILD-94's rule, carried over verbatim.
  if (req.user.isSuperAdmin) return res.status(403).json({ error: "turn_on_must_be_theirs",
    sentence: "Turning this on has to be done by somebody at this organisation." });

  // ONCE. The row moves out of 'planned' in the same statement that checks it,
  // so two presses cannot both run it and a gift cannot be recorded twice.
  const took = await run(`UPDATE agent_instructions SET status='active', turned_on_by=?, turned_on_by_name=?,
             turned_on_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=? AND status='planned'`,
    [actor(req).id, actor(req).name, ins.id, orgId]);
  if (!took || took.changes === 0) return res.status(409).json({ error: "already_run",
    sentence: "This plan has already been run or set aside." });

  const plan = typeof ins.plan === "string" ? JSON.parse(ins.plan || "null") : ins.plan;

  // THE MONEY IS HERS. A step the agent may not do alone was PREPARED; pressing
  // confirm is her recording it, through the one gift path, in her name.
  const confirmed = {};
  const today = orgToday(await orgTz(orgId));
  for (const [i, s] of ((plan && plan.steps) || []).entries()) {
    if (s.state !== A.STEP_CONFIRM || s.tool !== "record_gift") continue;
    const [donor] = await query("SELECT id, stage FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [s.donorId, orgId]);
    if (!donor || !(Number(s.amountCents) > 0)) { confirmed[i] = { reason: "the record is no longer there" }; continue; }
    const written = await recordGift({
      orgId, donorId: donor.id, amount: Number(s.amountCents) / 100, date: s.date || today,
      type: "cash", paymentMethod: s.method || undefined, notes: "",
      idempotencyKey: `agent:${ins.id}:${i}`, conflict: "idempotency",
      actorId: actor(req).id, actorName: actor(req).name, source: "agent_confirm",
    });
    if (!written || written.duplicate || !written.gift) { confirmed[i] = { reason: "it was already recorded" }; continue; }
    confirmed[i] = { giftId: written.gift.id, by: actor(req).name };
    // What the gift form does after a person records a gift (routes/crm.js
    // giftHooks): the wealth score moves, and a lapsed donor who just gave is
    // not lapsed any more.
    const { giftHooks } = require("./crm");
    giftHooks.calcWealthScore(donor.id, orgId).catch(e => console.error("score recalc:", e.message));
    await giftHooks.autoUnlapseOnGift(orgId, donor.id, donor.stage).catch(e => console.error("[smart-move] unlapse:", e.message));
    // The same live event the gift form fires: a person just recorded a gift.
    const [after] = await query("SELECT gift_count FROM donors WHERE id=? AND org_id=?", [donor.id, orgId]);
    fireWorkflows(orgId, "gift_received", {
      dedupKey: `gift:${written.gift.id}`, donorId: donor.id, giftId: written.gift.id, amount: Number(s.amountCents) / 100,
      isFirstGift: ((after && after.gift_count) || 0) === 1, entityType: "gift", entityId: written.gift.id,
    }).catch(e => console.error("[workflow] gift_received:", e.message));
  }

  const result = await agentRunPlan(orgId,
    { id: ins.id, text: ins.text, plan, authorization: ins.send_authorization },
    { userId: req.user.userId, confirmed, auth: req.headers.authorization || null });
  // AGENT-2: this request's own audit row names the instruction it ran.
  // Each write inside it has its own row, the Agent as actor (agentCall.js).
  if (req.audit) req.audit.summary(`Ran the instruction "${String(ins.text).slice(0, 200)}": ${result.done || 0} done${result.steps && result.steps.some(x => x.outcome === A.OUTCOME_FAILED) ? ", some failed" : ""}`,
    { count: (result.steps || []).length });

  if (ins.kind === A.KIND_TASK)
    await run("UPDATE agent_instructions SET status='done' WHERE id=? AND org_id=?", [ins.id, orgId]);

  res.json(result);
}));

app.get("/agent/instructions", requireAuth, wrap(async (req, res) => {
  const PS = await agentPersonasMod();
  const rows = await query(
    `SELECT id, text, kind, trigger, status, send_authorization, persona, plan, created_at,
            turned_on_by_name, turned_on_at, paused_at
       FROM agent_instructions WHERE org_id=? ORDER BY created_at DESC LIMIT 200`,
    [req.user.orgId]);
  const [org] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [req.user.orgId]);
  // AGENTS-1 — the badge's words come from the registry, not from the row, so
  // renaming a persona renames it everywhere at once.
  res.json({ instructions: rows.map(r => ({ ...r, personaName: r.persona ? PS.getPersona(r.persona).name : null })),
             pausedAll: !!(org && org.agent_paused_at) });
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
            i.text AS instruction_text, i.kind, i.persona
       FROM agent_runs r LEFT JOIN agent_instructions i ON i.id = r.instruction_id
      WHERE r.org_id=? ORDER BY r.started_at DESC LIMIT 50`, [req.user.orgId]);
  const PSa = await agentPersonasMod();
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
    runs: runs.map(r => ({ ...r, personaName: r.persona ? PSa.getPersona(r.persona).name : null })),
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

// ── FIX-1 §A — THE RUN STATE IS THE SERVER'S ───────────────────────────────
// The screen asks HERE whether a run is still going. The walk's button sat on
// "Running..." after the run had finished because it believed its own last
// guess; a run with a finish time is over, whatever the screen thought.
function agentRunOut(A, r, drafts = new Map()) {
  let steps = r.actions;
  if (typeof steps === "string") { try { steps = JSON.parse(steps); } catch { steps = []; } }
  steps = (Array.isArray(steps) ? steps : []).map(s => {
    // WIRE-1-ADDENDUM: a draft step reads its draft as it is NOW. Approved
    // (or sent) is done; skipped is not done; pending is still waiting.
    const d = s && s.outcome === A.OUTCOME_WAITING && s.entityId ? drafts.get(s.entityId) : null;
    const t = !d ? s : ["approved", "sent"].includes(d) ? { ...s, outcome: A.OUTCOME_DONE, reason: null }
      : d === "skipped" || d === "dismissed" ? { ...s, outcome: A.OUTCOME_NOT_DONE, reason: "you skipped the draft" } : s;
    return { ...t, label: A.outcomeLabel(t) };
  });
  const { actions: _a, ...rest } = r;
  return { ...rest, steps, progress: A.runProgress(steps), live: A.runIsLive(r) };
}
// The live status of every draft the given runs made, in one read.
async function agentDraftStates(orgId, runs) {
  const ids = [];
  for (const r of runs) {
    let a = r && r.actions;
    if (typeof a === "string") { try { a = JSON.parse(a); } catch { a = []; } }
    for (const s of Array.isArray(a) ? a : []) if (s && s.entityId && String(s.entityId).startsWith("adr_")) ids.push(String(s.entityId));
  }
  if (!ids.length) return new Map();
  const rows = await query("SELECT id, status FROM agent_drafts WHERE org_id=? AND id = ANY(?::text[])", [orgId, ids]);
  return new Map(rows.map(x => [x.id, x.status]));
}
app.get("/agent/runs/:id", requireAuth, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const [r] = await query(
    `SELECT r.id, r.instruction_id, r.status, r.started_at, r.finished_at, r.read_summary, r.actions,
            r.drafted, r.sent, r.declined, r.withheld, r.withheld_reason, r.error, i.text AS instruction_text
       FROM agent_runs r LEFT JOIN agent_instructions i ON i.id = r.instruction_id AND i.org_id = r.org_id
      WHERE r.id=? AND r.org_id=?`, [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json({ run: agentRunOut(A, r, await agentDraftStates(req.user.orgId, [r])) });
}));

// EVERY PLAN, WITH ITS RUN. The Plans view: her words, the plan she read, and
// what each step came to.
app.get("/agent/plans", requireAuth, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const PSp = await agentPersonasMod();
  const rows = (await query(
    `SELECT id, text, kind, trigger, status, send_authorization, persona, plan, created_at, created_by_name,
            turned_on_by_name, turned_on_at
       FROM agent_instructions WHERE org_id=? ORDER BY created_at DESC LIMIT 100`, [req.user.orgId]))
    // AGENTS-1 — the badge's words, from the registry.
    .map(r => ({ ...r, personaName: r.persona ? PSp.getPersona(r.persona).name : null }));
  const runs = await query(
    `SELECT DISTINCT ON (instruction_id) id, instruction_id, status, started_at, finished_at, read_summary,
            actions, drafted, sent, declined, withheld, withheld_reason, error
       FROM agent_runs WHERE org_id=? AND instruction_id IS NOT NULL
      ORDER BY instruction_id, started_at DESC`, [req.user.orgId]);
  const byIns = new Map(runs.map(r => [r.instruction_id, r]));
  const draftStates = await agentDraftStates(req.user.orgId, runs);
  const [org] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [req.user.orgId]);

  // GTM-1b 2 — BEFORE THE IMPORT, THE AGENT SHOWS ITSELF ON HARBORLIGHT.
  // An org with no donors opens this page to an empty room, and "write an
  // instruction" is a poor prompt when there is nobody to write it about. So
  // it shows a WORKED EXAMPLE on the demo organisation instead.
  //
  // Three properties make this honest rather than a mock-up:
  //   · the people in it are REAL rows from Harborlight, read live, so the
  //     example cannot drift from what the demo actually contains;
  //   · it calls NO model — it costs nothing and spends none of the trial
  //     allowance, which would be a strange thing to charge for a tour;
  //   · it is labelled as Harborlight's, not theirs, by the route, not by
  //     copy the page could forget to render.
  let showcase = null;
  const [mine] = await query(
    "SELECT COUNT(*)::int AS c FROM donors WHERE org_id=? AND deleted_at IS NULL", [req.user.orgId]);
  if (!Number(mine && mine.c)) {
    const demo = await query(
      `SELECT d.name, d.total_giving, d.last_gift_date
         FROM donors d
        WHERE d.org_id='org_b72demo' AND d.deleted_at IS NULL AND d.last_gift_date IS NOT NULL
        ORDER BY d.total_giving DESC NULLS LAST LIMIT 3`, []).catch(() => []);
    if (demo.length) {
      showcase = {
        orgName: "Harborlight Youth Collective",
        isDemoData: true,
        why: "You have not imported anyone yet, so this is what the Agent would do on the demo organisation's real records — not yours, and not invented.",
        instruction: "Thank everyone who gave in the last month, in my voice, and tell me who I should call.",
        people: demo.map(d => ({
          name: d.name,
          total: Number(d.total_giving) || 0,
          lastGift: d.last_gift_date ? String(d.last_gift_date).slice(0, 10) : null,
        })),
        steps: [
          { verb: "Read", detail: `${demo.length} people at Harborlight who gave recently, with their history.` },
          { verb: "Draft", detail: "One thank-you each, in the words you have already used on this kind of gift." },
          { verb: "Hold", detail: "Nothing is sent. Every draft waits for you to read it and press send." },
        ],
        // The one sentence that is true of every plan, shown here first.
        promise: "The Agent reads and drafts. A person signs anything that reaches a donor.",
      };
    }
  }

  const allowance = await agentTrialAllowance(req.user.orgId);

  res.json({
    pausedAll: !!(org && org.agent_paused_at),
    showcase,
    // What is left of the free thirty days' allowance, so the screen can say
    // it before she writes the twenty-sixth plan rather than after.
    allowance,
    plans: rows.map(p => {
      const plan = typeof p.plan === "string" ? JSON.parse(p.plan || "null") : p.plan;
      const r = byIns.get(p.id);
      return { ...p, plan: plan ? { ...plan, confirmLabel: plan.confirmLabel || A.confirmLabel(plan) } : null,
               run: r ? agentRunOut(A, r, draftStates) : null };
    }),
  });
}));

// NOT THIS ONE. A plan she read and does not want is set aside; nothing ran and
// nothing is recorded. Kept, because what she was offered is part of the record.
app.post("/agent/instructions/:id/discard", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await run(`UPDATE agent_instructions SET status='set_aside', updated_at=NOW()
                       WHERE id=? AND org_id=? AND status='planned'`, [req.params.id, req.user.orgId]);
  if (!r || r.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, status: "set_aside" });
}));

// ── WAITING FOR YOU — ONE QUEUE, OLDEST FIRST ──────────────────────────────
// Everything Steward prepared that waits on a person: thank-you drafts, tribute
// notices, renewal and reminder notes on a thread, notes the agent drafted, and
// gifts to confirm. Read-only: each item is acted on where it already lives.
app.get("/agent/waiting", requireAuth, wrap(async (req, res) => {
  const A = await agentShapeMod();
  const G = await import("../shared/suggestionGuard.js");
  const V = await import("../shared/vocabulary.js");
  const orgId = req.user.orgId;
  const [org] = await query("SELECT vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const words = org && org.vocabulary_json;
  const items = [];
  const PSw = await agentPersonasMod();
  const ins = await query(
    `SELECT id, text, plan, persona, created_at, created_by_name FROM agent_instructions
      WHERE org_id=? AND status='planned' ORDER BY created_at ASC LIMIT 200`, [orgId]);
  const giftDonors = new Map();
  for (const i of ins) {
    const plan = typeof i.plan === "string" ? JSON.parse(i.plan || "null") : i.plan;
    const g = ((plan && plan.steps) || []).find(s => s.state === A.STEP_CONFIRM && s.tool === "record_gift");
    if (g) giftDonors.set(i.id, { plan, g });
  }
  const donorIds = [...new Set([...giftDonors.values()].map(x => x.g.donorId))];
  const drows = donorIds.length ? await agentReadPeople(orgId, { ids: donorIds }) : [];
  const dById = new Map(drows.map(d => [d.id, d]));
  for (const i of ins) {
    const x = giftDonors.get(i.id);
    if (!x) continue;
    const d = dById.get(x.g.donorId);
    if (!d) continue;
    items.push({ kind: "gift_to_confirm", id: i.id, createdAt: i.created_at, donorId: d.id,
      persona: i.persona || null, personaName: i.persona ? PSw.getPersona(i.persona).name : null,
      title: `A gift of ${A.formatCents(x.g.amountCents)} from ${A.nameInSentence(d)}, to confirm`,
      who: `${d.name} · ${V.giverWordFor(d, words)}`, body: `“${G.plainText(i.text)}”`,
      confirmLabel: A.confirmLabel(x.plan) });
  }
  const ty = await query(
    `SELECT t.id, t.donor_id, t.body, t.created_at, d.name, d.kind, d.funder_type
       FROM thank_you_drafts t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id=? AND t.sent_at IS NULL AND t.skipped_at IS NULL AND d.deleted_at IS NULL
      ORDER BY t.created_at ASC LIMIT 200`, [orgId]);
  for (const t of ty) items.push({ kind: "thank_you", id: t.id, createdAt: t.created_at, donorId: t.donor_id,
    title: `A thank-you to ${t.name}`, who: `${t.name} · ${V.giverWordFor(t, words)}`, body: G.plainText(t.body) });
  const tn = await query(
    `SELECT t.id, t.donor_id, t.tribute_type, t.honouree_name, t.notify_name, t.body, t.created_at, d.name
       FROM tribute_notices t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id=? AND t.status='waiting' AND d.deleted_at IS NULL ORDER BY t.created_at ASC LIMIT 200`, [orgId]);
  for (const t of tn) items.push({ kind: "tribute_notice", id: t.id, createdAt: t.created_at, donorId: t.donor_id,
    title: `A tribute notice: ${t.tribute_type === "honour" || t.tribute_type === "honor" ? "in honour of" : "in memory of"} ${t.honouree_name}`,
    who: `From ${t.name}${t.notify_name ? ", to " + t.notify_name : ""}`, body: G.plainText(t.body) });
  const th = await query(
    `SELECT t.id, t.donor_id, t.next_step_label, t.draft_note, t.created_at, d.name
       FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id=? AND t.closed_at IS NULL AND t.draft_note IS NOT NULL AND t.draft_note <> ''
        AND d.deleted_at IS NULL ORDER BY t.created_at ASC LIMIT 200`, [orgId]);
  for (const t of th) items.push({ kind: "renewal_note", id: t.id, createdAt: t.created_at, donorId: t.donor_id,
    title: G.plainText(t.next_step_label), who: t.name, body: G.plainText(t.draft_note) });
  // AGENTS-1 — a draft says which of the six wrote it, through the instruction
  // it came from. LEFT JOIN, because a draft from before this build (and one
  // written by the general agent) has no persona and shows no badge.
  const ad = await query(
    `SELECT a.id, a.donor_id, a.subject, a.body, a.created_at, a.instruction_id, a.purpose, a.gift_ids, d.name, i.persona
       FROM agent_drafts a JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
       LEFT JOIN agent_instructions i ON i.id = a.instruction_id AND i.org_id = a.org_id
      WHERE a.org_id=? AND a.status='pending' AND d.deleted_at IS NULL ORDER BY a.created_at ASC LIMIT 200`, [orgId]);
  for (const a of ad) items.push({ kind: "agent_draft", id: a.id, createdAt: a.created_at, donorId: a.donor_id,
    instructionId: a.instruction_id || null, purpose: a.purpose || null, subject: a.subject || "",
    giftCount: Array.isArray(a.gift_ids) ? a.gift_ids.length : 0,
    persona: a.persona || null, personaName: a.persona ? PSw.getPersona(a.persona).name : null,
    title: `A note Steward drafted for ${a.name}${a.subject ? ": " + G.plainText(a.subject) : ""}`, who: a.name,
    body: G.plainText(a.body) });
  items.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
  res.json({ count: items.length, items,
    definition: "Everything Steward prepared that waits on a person, oldest first. Nothing here has been sent or recorded." });
}));

// ── FIX-6 item 1 · APPROVE AND SKIP, ON EVERY KIND ───────────────────────
//
// THE DEFECT: the queue showed each item's words, "Why this matters" and
// "What Steward changed", and then the only control was "Open the record".
// Everything except a gift to confirm was a dead end. Five kinds reach this
// queue and only one of them could be acted on, and two of the other four had
// no server route at all.
//
// THE SHAPE OF THE FIX: one dispatcher, and it DOES NOT CONTAIN A SEND. Each
// kind is handed to the path that already exists for it, so there is no second
// place a thank-you can be marked sent and no new way for words to reach a
// donor. What this route adds is the door, not the thing behind it.
//
// WHAT "APPROVE" MEANS PER KIND, said out loud because it differs:
//   thank_you      — the existing mark-sent path: it LOGS that she sent it and
//                    closes the thank-you thread. Steward does not mail it.
//   tribute_notice — the existing mark-sent path, same reasoning.
//   renewal_note   — the drafted note becomes a logged interaction in HER
//                    name, and the thread closes as an outcome.
//   agent_draft    — marked approved. It is a note SHE will send; approving it
//                    is her saying the words are right.
//   gift_to_confirm— refused here. A gift is confirmed through the instruction
//                    route, which runs a plan, and routing money through a
//                    generic approve button is exactly the shortcut that rule
//                    exists to prevent.
//
// NOTHING HERE MAILS ANYBODY. Every branch writes a row that says a human did
// something; not one of them calls Resend. tests/fix6-approval.test.js is the
// guard, and it asserts the sink stayed empty across the whole queue.
const WAITING_KINDS = new Set(["thank_you", "tribute_notice", "renewal_note", "agent_draft"]);

async function approveWaitingItem(req, kind, id) {
  const orgId = req.user.orgId, who = actor(req);
  const today = orgToday(await orgTz(orgId));                        // ORG_TZ_SEAM_OK
  // Her NAME on the row, not her email: a colleague reading the timeline is
  // reading about a person.
  const [me] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, orgId]);
  const actorName = (me && me.name) || who.name;

  if (kind === "thank_you") {
    const [d] = await query("SELECT * FROM thank_you_drafts WHERE id=? AND org_id=?", [id, orgId]);
    if (!d) return { status: 404, body: { error: "Not found" } };
    if (d.sent_at) return { status: 200, body: { ok: true, alreadyDone: true, sentence: "That thank-you was already marked as sent." } };
    const intId = "int_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [intId, orgId, d.donor_id, "stewardship", "Thank-you sent.", today, who.id, actorName, d.gift_id,
       JSON.stringify({ via: "approval_queue", draftId: d.id })]);
    await run("UPDATE thank_you_drafts SET sent_at=NOW(), opened_at=COALESCE(opened_at,NOW()) WHERE id=? AND org_id=?", [d.id, orgId]);
    await run("UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()) WHERE id=? AND org_id=?", [d.gift_id, orgId]);
    await query(
      `UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=?
        WHERE org_id=? AND donor_id=? AND closed_at IS NULL AND next_step_type IN ('thank','thank_you_note') RETURNING id`,
      [intId, orgId, d.donor_id]);
    return { status: 200, body: { ok: true, sentence: "Marked as sent, and logged on their record in your name." } };
  }

  if (kind === "tribute_notice") {
    const { changes } = await run(
      `UPDATE tribute_notices SET status='sent', sent_at=NOW(), sent_by=?, sent_by_name=?
        WHERE id=? AND org_id=? AND status='waiting'`, [who.id, actorName, id, orgId]);
    if (!changes) return { status: 404, body: { error: "Not found" } };
    return { status: 200, body: { ok: true, sentence: "Marked as sent." } };
  }

  if (kind === "renewal_note") {
    const [t] = await query(
      "SELECT id, donor_id, next_step_label, draft_note FROM threads WHERE id=? AND org_id=? AND closed_at IS NULL", [id, orgId]);
    if (!t) return { status: 404, body: { error: "Not found" } };
    const intId = "int_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [intId, orgId, t.donor_id, "stewardship", t.draft_note, today, who.id, actorName,
       JSON.stringify({ via: "approval_queue", threadId: t.id })]);
    await run(
      `UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=? WHERE id=? AND org_id=?`,
      [intId, t.id, orgId]);
    return { status: 200, body: { ok: true, sentence: "Logged on their record in your name, and the follow-up is closed." } };
  }

  if (kind === "agent_draft") {
    const [d] = await query(
      `UPDATE agent_drafts SET status='approved', reviewed_at=NOW(), reviewed_by=?, reviewed_by_name=?
        WHERE id=? AND org_id=? AND status='pending' RETURNING id, donor_id, subject, gift_ids, thread_id, purpose`, [who.id, actorName, id, orgId]);
    if (!d) return { status: 404, body: { error: "Not found" } };
    // WIRE-1-ADDENDUM: approving a thank-you is her saying it is right and
    // hers to send, so the gifts it thanks are marked thanked ("Not thanked
    // yet" clears), its step on the Thread closes, and the timeline says who
    // approved it. Steward still sends nothing.
    const giftIds = Array.isArray(d.gift_ids) ? d.gift_ids.map(String) : [];
    // Only the gifts THIS approval marks are remembered, so Undo puts back
    // exactly those and never un-thanks a gift somebody thanked another way.
    const marked = giftIds.length ? (await query(
      "SELECT id FROM gifts WHERE org_id=? AND donor_id=? AND id = ANY(?) AND acknowledgement_sent IS NOT TRUE", [orgId, d.donor_id, giftIds])).map(g => g.id) : [];
    if (giftIds.length) {
      await run(
        `UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()),
                          acknowledged_by=COALESCE(acknowledged_by, ?), acknowledged_by_name=COALESCE(acknowledged_by_name, ?),
                          acknowledged_via=COALESCE(acknowledged_via, 'email')
          WHERE org_id=? AND donor_id=? AND id = ANY(?)`, [who.id, actorName, orgId, d.donor_id, giftIds]);
      await run("UPDATE thank_you_drafts SET sent_at=COALESCE(sent_at, NOW()) WHERE org_id=? AND gift_id = ANY(?) AND sent_at IS NULL AND skipped_at IS NULL", [orgId, giftIds]).catch(() => {});
    }
    const line = await TLa.timelineLine({ orgId, donorId: d.donor_id, actorId: who.id, actorName, date: today, key: `agent_draft_approved:${d.id}`,
      note: `${d.purpose === "thank_you" ? "Thank-you" : "Note"} approved to send by ${actorName}${d.subject ? `: "${String(d.subject).slice(0, 120)}"` : ""}.`,
      metadata: { agentDraftId: d.id, giftIds } });
    // A thread closes as an outcome only with the line that closed it (the
    // threads check constraint), so no line means it stays open.
    if (d.thread_id && line && line.id) await run(
      `UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=? WHERE id=? AND org_id=? AND closed_at IS NULL`,
      [line.id, d.thread_id, orgId]);
    await run("UPDATE agent_drafts SET marked_gift_ids=?, approved_line_id=? WHERE id=? AND org_id=?",
      [JSON.stringify(marked), line && line.id ? line.id : null, d.id, orgId]);
    return { status: 200, body: { ok: true, giftsThanked: giftIds.length, undoable: true,
      sentence: giftIds.length ? "Approved, and the gift is marked thanked. It is yours to send; Steward will not send it for you."
        : "Approved. It is yours to send, and Steward will not send it for you." } };
  }
  return { status: 400, body: { error: "unknown_kind" } };
}

async function skipWaitingItem(req, kind, id, reason) {
  const orgId = req.user.orgId, who = actor(req);
  const why = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  if (kind === "thank_you") {
    const { changes } = await run(
      "UPDATE thank_you_drafts SET skipped_at=NOW() WHERE id=? AND org_id=? AND sent_at IS NULL", [id, orgId]);
    if (!changes) return { status: 404, body: { error: "Not found" } };
  } else if (kind === "tribute_notice") {
    const { changes } = await run(
      "UPDATE tribute_notices SET status='skipped' WHERE id=? AND org_id=? AND status='waiting'", [id, orgId]);
    if (!changes) return { status: 404, body: { error: "Not found" } };
  } else if (kind === "renewal_note") {
    // The THREAD stays open and only the DRAFT goes. Skipping the words
    // Steward wrote is not the same as deciding the follow-up does not need
    // doing, and closing it here would silently do the second.
    const { changes } = await run(
      "UPDATE threads SET draft_note=NULL WHERE id=? AND org_id=? AND closed_at IS NULL", [id, orgId]);
    if (!changes) return { status: 404, body: { error: "Not found" } };
    return { status: 200, body: { ok: true,
      sentence: "The draft is gone. The follow-up itself is still open on their record." } };
  } else if (kind === "agent_draft") {
    const [d] = await query(
      `UPDATE agent_drafts SET status='skipped', reviewed_at=NOW(), reviewed_by=?, skip_reason=?
        WHERE id=? AND org_id=? AND status='pending' RETURNING id, donor_id, thread_id, purpose`, [who.id, why, id, orgId]);
    if (!d) return { status: 404, body: { error: "Not found" } };
    // The WORDS go; the thank-you itself is still owed, so its step stays open
    // and stops pointing at a draft that is gone (the renewal_note rule).
    if (d.thread_id) await run(
      "UPDATE threads SET next_step_label=? WHERE id=? AND org_id=? AND closed_at IS NULL",
      [d.purpose === "thank_you" ? "Send thank-you note" : "Follow up", d.thread_id, orgId]);
  } else {
    return { status: 400, body: { error: "unknown_kind" } };
  }
  return { status: 200, body: { ok: true, sentence: why ? `Skipped: ${why}` : "Skipped." } };
}

// WIRE-1-ADDENDUM · UNDO A REVIEW. The shared Undo toast calls this after an
// Agent draft is approved or skipped: the draft is pending again, the gifts
// that approval marked are not thanked again, its timeline line goes, and its
// step on the Thread is open again and points at the draft.
app.post("/agent/waiting/agent_draft/:id/reopen", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT * FROM agent_drafts WHERE id=? AND org_id=? AND status IN ('approved','skipped')", [String(req.params.id || ""), orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const marked = Array.isArray(d.marked_gift_ids) ? d.marked_gift_ids.map(String) : [];
  if (d.status === "approved" && marked.length) await run(
    `UPDATE gifts SET acknowledgement_sent=false, acknowledgement_sent_at=NULL, acknowledged_by=NULL, acknowledged_by_name=NULL, acknowledged_via=NULL
      WHERE org_id=? AND donor_id=? AND id = ANY(?)`, [orgId, d.donor_id, marked]);
  if (d.approved_line_id) await run("DELETE FROM interactions WHERE id=? AND org_id=?", [d.approved_line_id, orgId]);
  const label = d.purpose === "thank_you" ? "Thank-you draft ready, review and send" : "Draft ready, review and send";
  if (d.thread_id) {
    // The thread comes back open unless the person has opened another since.
    const [other] = await query("SELECT id FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL AND id<>?", [orgId, d.donor_id, d.thread_id]);
    if (!other) await run(
      "UPDATE threads SET closed_at=NULL, close_kind=NULL, closing_interaction_id=NULL, next_step_label=? WHERE id=? AND org_id=?",
      [label, d.thread_id, orgId]);
  }
  await run(`UPDATE agent_drafts SET status='pending', reviewed_at=NULL, reviewed_by=NULL, reviewed_by_name=NULL, skip_reason=NULL,
              marked_gift_ids='[]'::jsonb, approved_line_id=NULL WHERE id=? AND org_id=?`, [d.id, orgId]);
  res.json({ ok: true, sentence: "Put back. The draft is waiting for you again." });
}));

app.post("/agent/waiting/:kind/:id/approve", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const kind = String(req.params.kind || "");
  if (kind === "gift_to_confirm") {
    return res.status(400).json({ error: "wrong_door",
      message: "A gift is confirmed by running its plan, not by a general approval. Open it and press the confirm button on the plan." });
  }
  if (!WAITING_KINDS.has(kind)) return res.status(400).json({ error: "unknown_kind", message: "There is nothing of that kind in the queue." });
  const r = await approveWaitingItem(req, kind, String(req.params.id || ""));
  res.status(r.status).json(r.body);
}));

app.post("/agent/waiting/:kind/:id/skip", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const kind = String(req.params.kind || "");
  if (kind === "gift_to_confirm") {
    return res.status(400).json({ error: "wrong_door",
      message: "A gift is set aside on its own plan, not here." });
  }
  if (!WAITING_KINDS.has(kind)) return res.status(400).json({ error: "unknown_kind", message: "There is nothing of that kind in the queue." });
  const r = await skipWaitingItem(req, kind, String(req.params.id || ""), (req.body || {}).reason);
  res.status(r.status).json(r.body);
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

// EMAIL-1 — START FROM A TEMPLATE. The draft's subject and words become the
// template's text, with this person's fields in it, and the draft remembers
// the template. Still a draft she sends herself; Undo is /restore.
app.post("/agent/drafts/:id/from-template", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const emailCompose = require("../emailCompose");
  const orgId = req.user.orgId;
  const [d] = await query("SELECT * FROM agent_drafts WHERE id=? AND org_id=? AND status='pending'", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const t = await emailCompose.templateFor(orgId, req.body && req.body.templateId);
  if (!t) return res.status(404).json({ error: "template_not_found", message: "That template is not one of yours." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [d.donor_id, orgId]);
  const words = await emailCompose.templateTextFor(orgId, t, donor || null);
  if (!words.body) return res.status(400).json({ error: "template_empty", message: "That template has no words in it yet." });
  await run("UPDATE agent_drafts SET subject=?, body=?, template_id=? WHERE id=? AND org_id=? AND status='pending'",
    [words.subject || d.subject, words.body, t.id, d.id, orgId]);
  res.json({ ok: true, subject: words.subject || d.subject, body: words.body, templateId: t.id,
    previous: { subject: d.subject, body: d.body, templateId: d.template_id || null },
    sentence: `The draft now starts from ${t.name}. Read it before you send it.` });
}));

app.post("/agent/drafts/:id/restore", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const emailCompose = require("../emailCompose");
  const { subject, body, templateId } = req.body || {};
  if (!body) return res.status(400).json({ error: "body required" });
  const tid = templateId ? ((await emailCompose.templateFor(req.user.orgId, templateId)) || {}).id || null : null;
  const { changes } = await run("UPDATE agent_drafts SET subject=?, body=?, template_id=? WHERE id=? AND org_id=? AND status='pending'",
    [subject == null ? null : String(subject), String(body), tid, req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
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
        ? AI_OFF_MESSAGE + "."
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
  if (!donorId) return res.status(400).json({ error: "A donor is needed." });
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
