// routes/voice.js · VOICE-1. "TELL STEWARD": TALK FOR 30 SECONDS, AND THE PAPERWORK IS DONE.
//
// One memo, one short model call, and one screen of results at two speeds
// (CAPTURE-1's pattern):
//   DONE FOR YOU, WITH UNDO  the conversation logged on each person, the
//                            follow-up on the Thread with its date, interests
//                            noted. These run through the Agent's own runner
//                            (agentRunPlan) as a plan with the Notes persona,
//                            so every write is on agent_writes and one Undo
//                            loops over them.
//   WAITING FOR YOUR YES     the drafted email (an agent_draft, never sent),
//                            every amount (a card; nothing is written until
//                            she presses yes, and the yes is her own click on
//                            the ordinary gift, pledge or proposal route), a
//                            contact change, and every sensitive detail.
//
// People are matched in code (agentNamedIn): one match acts, several ask
// which, a heard name nobody on file has is offered as a new person. With AI
// off the memo is a logged note on the person she picks, and nothing else.
// Audio never reaches this file: the browser hands the page text.
"use strict";
const express = require("express");
const { anthropicFor, recordAiFallback } = require("../aiClient");

const routers = { r0: express.Router() };
const MEMO_MIN = 4, MEMO_MAX = 4000;
const NOTES = "notes";

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, uuid, orgTz, orgToday, agentGate, recordGift, AGENT_MODEL } = ctx;
const app = routers.r0;
const VM = () => import("../shared/voiceMemo.js");
const AS = () => import("../shared/agentShape.js");
const PS = () => import("../shared/agentPersonas.js");
const engine = () => require("./agent").routers.engine;

// Her own click on one of Steward's routes, in-process, with her session. Not
// marked as the Agent: a yes on a card is hers.
async function asHer(req, method, path, body) {
  const port = process.env.PORT || 3001;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method,
    headers: { "content-type": "application/json", authorization: req.headers.authorization || "" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let out = null; try { out = await r.json(); } catch { out = null; }
  return { status: r.status, body: out };
}
const j = v => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

async function orgFunds(orgId) {
  const funds = await query("SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY name LIMIT 200", [orgId]).catch(() => []);
  const camps = await query("SELECT id, name FROM campaigns WHERE org_id=? ORDER BY created_at DESC LIMIT 100", [orgId]).catch(() => []);
  return [...funds.map(f => ({ ...f, kind: "fund" })), ...camps.map(c => ({ ...c, kind: "campaign" }))];
}

// Which one? agentWhich's list, plus when each was last in contact.
async function which(orgId, group) {
  const w = await engine().agentWhich(orgId, group);
  const ids = w.people.map(p => p.id);
  const last = ids.length ? await query(
    `SELECT donor_id, MAX(LEFT(date,10)) AS d FROM interactions WHERE org_id=? AND donor_id = ANY(?::text[]) AND type IN ('call','meeting','email','note') GROUP BY donor_id`,
    [orgId, ids]) : [];
  const byId = new Map(last.map(r => [r.donor_id, r.d]));
  return { ...w, sentence: `More than one person is called ${group.said}. Which ${group.said} was it? Nothing is written until you pick.`,
    people: w.people.map(p => ({ ...p, detail: p.detail + (byId.get(p.id) ? ` · last contact ${byId.get(p.id)}` : " · no contact logged") })) };
}

async function memoRow(orgId, id) {
  const [m] = await query("SELECT * FROM voice_memos WHERE id=? AND org_id=?", [id, orgId]);
  return m || null;
}

// The results screen, from the rows as they are now.
async function memoOut(orgId, m) {
  const V = await VM();
  const runIds = j(m.run_ids) || [];
  const runs = runIds.length ? await query("SELECT id, plan, actions FROM agent_runs WHERE org_id=? AND id = ANY(?::text[]) ORDER BY started_at", [orgId, runIds]) : [];
  const done = [];
  for (const r of runs) {
    const plan = j(r.plan) || {}, acts = j(r.actions) || [];
    (plan.steps || []).forEach((s, i) => {
      if (s.tool === "draft_note") return;   // the draft is in the yes column
      const o = acts[i] || {};
      done.push({ tool: s.tool, donorId: s.donorId || null, line: s.line || s.describes, outcome: o.outcome || null,
        reason: o.reason || null, card: s.card || null });
    });
  }
  const cards = j(m.cards) || [];
  const draftIds = cards.filter(c => c.kind === "draft" && c.draftId).map(c => c.draftId);
  const drafts = draftIds.length ? await query("SELECT id, status FROM agent_drafts WHERE org_id=? AND id = ANY(?::text[])", [orgId, draftIds]) : [];
  const dState = new Map(drafts.map(d => [d.id, d.status]));
  const ids = j(m.donor_ids) || [];
  const people = ids.length ? await query("SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?::text[])", [orgId, ids]) : [];
  return {
    id: m.id, status: m.status, ai: m.ai, source: m.source, text: m.text, createdAt: m.created_at, createdByName: m.created_by_name,
    undoneAt: m.undone_at, undoneByName: m.undone_by_name,
    people: ids.map(id => people.find(p => p.id === id)).filter(Boolean),
    done: m.undone_at ? [] : done.filter(d => !d.card),
    waiting: cards.map(c => {
      const out = { ...c };
      if (c.kind === "draft") out.state = dState.get(c.draftId) === "pending" ? "waiting" : dState.has(c.draftId) ? (dState.get(c.draftId) === "skipped" ? "discarded" : "saved") : "discarded";
      if (c.kind === "sensitive" && c.state !== "waiting") delete out.quote;   // decided: the words are gone
      if (c.kind === "money") out.amount = V.cents$(c.cents);
      return out;
    }),
    pending: m.status === "needs_people" ? (j(m.read) || {}).pending || null : null,
  };
}

// ── BUILD THE PLAN AND RUN IT ──────────────────────────────────────────────
async function finish(req, m, ids, read) {
  const orgId = req.user.orgId;
  const V = await VM(), A = await AS(), P = await PS();
  const E = engine();
  const people = await E.agentReadPeople(orgId, { ids });
  const byId = new Map(people.map(p => [p.id, p]));
  const order = ids.filter(id => byId.has(id));
  if (!order.length) return { error: 400, body: { error: "memo_needs_person", sentence: "Steward could not find that record." } };
  const primary = order[0];
  const first = id => String(byId.get(id).name || "").split(/\s+/)[0];
  const D = await import("../shared/displayDate.js");
  const today = orgToday(await orgTz(orgId));
  const day = d => D.displayDateShort(String(d).slice(0, 10), today);
  const howLabel = V.HOW_LABEL[read.how] || "Conversation";
  const steps = [];
  const cite = id => [id];

  if (read.noteOnly) {
    steps.push({ tool: "log_note", donorId: primary, note: read.note, citesRows: cite(primary),
      line: `Your memo saved as a note on ${byId.get(primary).name}` });
  } else {
    for (const id of order) {
      const others = order.filter(x => x !== id);
      steps.push({ tool: "log_conversation", donorId: id, kind: read.kind, how: read.how, date: read.date,
        // "Lunch. ..." unless her summary already opens with the word (no "Lunch. Lunch with Margaret").
        note: (new RegExp(`^${read.how}\\b`, "i").test(read.summary) && !others.length ? read.summary
          : `${howLabel}${others.length ? ` with ${others.map(o => byId.get(o).name).join(" and ")}` : ""}. ${read.summary}`).slice(0, 2000),
        memoId: m.id, linkedDonorIds: others, citesRows: cite(id),
        line: `${howLabel} logged on ${byId.get(id).name}, ${day(read.date)}${others.length ? `, linked to ${others.map(first).join(" and ")}` : ""}` });
    }
    read.followUps.forEach((f, i) => {
      const line = `${f.label}, on the Thread for ${day(f.due)}${f.exact ? "" : " (you named no date, so two weeks)"}`;
      if (i === 0) steps.push({ tool: "set_next_step", donorId: primary, label: f.label, due: f.due, citesRows: cite(primary), line });
      else steps.push({ tool: "create_task", donorId: primary, title: f.label, due: f.due, citesRows: cite(primary), line: `${f.label}, a task for ${day(f.due)}` });
    });
    for (const it of read.interests) {
      if (it.fundName) steps.push({ tool: "add_tag", donorId: primary, tag: `Interest: ${it.fundName}`.slice(0, 60), citesRows: cite(primary),
        line: `Interest in the ${it.fundName} noted on ${first(primary)} ("${it.words}")` });
      else steps.push({ tool: "log_note", donorId: primary, note: `Interested in ${it.words}. From the memo: "${it.quote}"`, citesRows: cite(primary),
        line: `Interest in ${it.words} noted on ${first(primary)} (no fund or campaign by that name, so a note)` });
    }
    // Last, after the Thread step, so the draft does not take the Thread's place.
    if (read.email) steps.push({ tool: "draft_note", donorId: primary, subject: read.email.subject, body: read.email.body, citesRows: cite(primary),
      line: `Email to ${first(primary)} drafted` });
  }

  const allowed = P.personaToolSet(NOTES);
  const kept = steps.filter(s => allowed.has(s.tool));
  const plan = A.compilePlan(kept, { people, reads: `your memo about ${order.map(o => byId.get(o).name).join(" and ")}`,
    headline: read.noteOnly ? "Your memo, saved as a note" : `${howLabel} with ${order.map(first).join(" and ")}, filed` });
  const check = A.validatePlan(plan, { authorization: A.AUTH_DRAFT });
  if (!check.ok) return { error: 422, body: { error: "plan_refused", reasons: check.errors } };

  const insId = "ai_" + uuid().slice(0, 10);
  await run(`INSERT INTO agent_instructions (id,org_id,text,kind,trigger,status,send_authorization,persona,plan,last_count,created_by,created_by_name,turned_on_by,turned_on_by_name,turned_on_at)
             VALUES (?,?,?,?,NULL,'done',?,?,?,?,?,?,?,?,NOW())`,
    [insId, orgId, m.text, A.KIND_TASK, A.AUTH_DRAFT, NOTES, JSON.stringify(plan), plan.expectedCount || 0,
     actor(req).id, actor(req).name, actor(req).id, actor(req).name]);
  const result = await E.agentRunPlan(orgId, { id: insId, text: m.text, plan, authorization: A.AUTH_DRAFT, grounded: m.text },
    { userId: req.user.userId, auth: req.headers.authorization || null });

  // The yes column.
  const cards = [];
  const cardId = () => "vc_" + uuid().slice(0, 8);
  const draftStep = (result.steps || []).find(s => s.tool === "draft_note");
  if (draftStep && draftStep.entityId) cards.push({ id: cardId(), kind: "draft", draftId: draftStep.entityId, donorId: primary,
    title: `Email to ${first(primary)}`, subject: read.email.subject, body: read.email.body, state: "waiting" });
  if (!read.noteOnly) {
    for (const mo of read.money) {
      const what = mo.kind === "gift" ? "Record a" : mo.kind === "pledge" ? "Record a pledge of" : "Log interest in a";
      cards.push({ id: cardId(), kind: "money", moneyKind: mo.kind, cents: mo.cents, fundId: mo.fundId, fundName: mo.fundName, donorId: primary,
        quote: mo.quote, state: "waiting",
        title: mo.kind === "pledge" ? `${what} ${V.cents$(mo.cents)}${mo.fundName ? ` to the ${mo.fundName}` : ""} from ${first(primary)}?`
          : `${what} ${V.cents$(mo.cents)} gift${mo.fundName ? ` to the ${mo.fundName}` : ""}${mo.kind === "gift" ? ` from ${first(primary)}` : ""}?` });
    }
    for (const c of read.contact) cards.push({ id: cardId(), kind: "contact", field: c.field, value: c.value, donorId: primary, quote: c.quote, state: "waiting",
      title: `Change ${first(primary)}'s ${c.field} to ${c.value}?` });
  }
  for (const s of read.sensitive) cards.push({ id: cardId(), kind: "sensitive", category: s.category, neutral: s.neutral, quote: s.quote, donorId: primary, state: "waiting",
    title: s.neutral.replace(/\.$/, "") });

  await run(`UPDATE voice_memos SET status=?, donor_ids=?, cards=?, instruction_id=?, run_ids=?, read=? WHERE id=? AND org_id=?`,
    [read.noteOnly ? "note" : "done", JSON.stringify(order), JSON.stringify(cards), insId, JSON.stringify([result.runId]),
     JSON.stringify({ ...read, sensitive: read.sensitive.map(s => ({ category: s.category, neutral: s.neutral })), pending: null }), m.id, orgId]);
  if (req.audit) req.audit.summary(`Tell Steward: ${result.done || 0} done, ${cards.length} waiting for a yes`, { count: (result.steps || []).length });
  return { body: { memo: await memoOut(orgId, await memoRow(orgId, m.id)) } };
}

// ── THE MEMO ────────────────────────────────────────────────────────────────
// CLIENT-SAFE-1: the sentence when any person the memo is about is a client.
async function clientRefusal(orgId, ids) {
  if (!ids || !ids.length) return null;
  const p = await require("../clientSafe").privacyFor(orgId);
  const hit = p.on ? ids.find(id => p.clientIds.has(id)) : null;
  if (!hit) return null;
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [hit, orgId]);
  return (await import("../shared/clientSafe.js")).MEMO_REFUSED(d && d.name);
}
app.post("/voice/memos", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const V = await VM();
  const text = String((req.body && req.body.text) || "").replace(/\s+/g, " ").trim();
  if (text.length < MEMO_MIN) return res.status(400).json({ error: "memo_empty", sentence: "Tell Steward what happened first." });
  if (text.length > MEMO_MAX) return res.status(400).json({ error: "memo_too_long", sentence: "That memo is too long. Say it in a few sentences." });
  const source = req.body.source === "speech" ? "speech" : "typed";
  return fileMemo(req, res, { text, source, donorId: req.body.donorId, picks: req.body.picks || null });
}));

// ONE MEMO PATH. A spoken or typed memo is filed by this one function: who,
// the one short read, the plan, the cards.
async function fileMemo(req, res, { text, source, donorId = null, picks = null }) {
  const orgId = req.user.orgId;
  const V = await VM();
  const [org] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [orgId]);
  if (org && org.agent_paused_at) return res.status(503).json({ error: "agent_paused", sentence: "The Agent is paused for this organization, so Steward filed nothing." });

  // WHO: the profile she is on, and the names in her words, matched in code.
  const E = engine();
  // Only picks that answer one of THIS memo's questions count. A pick left
  // over from an earlier memo, or one whose name dropped out of the words,
  // used to refuse every click ("That is not one of the records"); now it is
  // dropped, and a pick can still only be one of the records a name matched.
  if (picks && picks.length) {
    const asked = new Set((await E.agentNamedIn(orgId, text, null)).ambiguous.flatMap(g => g.ids));
    picks = [].concat(picks).map(String).filter(id => asked.has(id));
  }
  let named = await E.agentNamedIn(orgId, text, picks);
  // The person she is on answers "which Margaret?"
  // for the name that matches them: a memo about Margaret Chen, from her
  // profile, never asks which Margaret.
  if (donorId && !named.badPick && named.ambiguous.some(g => g.ids.includes(String(donorId))))
    named = await E.agentNamedIn(orgId, text, [...(picks || []), String(donorId)]);
  if (named.badPick) return res.status(400).json({ error: "not_one_of_them", sentence: "That is not one of the records that name matches. Pick one from the list." });
  if (named.ambiguous.length) return res.json({ which: await which(orgId, named.ambiguous[0]) });
  let ids = [...(named.scope || [])];
  if (donorId) {
    const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(donorId), orgId]);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    ids = [d.id, ...ids.filter(x => x !== d.id)];
  }

  // CLIENT-SAFE-1: a memo about a person marked as a client is not logged,
  // not read by the model and not kept.
  const refusedFor = await clientRefusal(orgId, ids);
  if (refusedFor) return res.status(409).json({ error: "client", sentence: refusedFor });

  const gate = await agentGate(orgId);
  const today = orgToday(await orgTz(orgId));
  const save = async (status, read, aiState) => {
    const id = "vm_" + uuid().slice(0, 10);
    await run(`INSERT INTO voice_memos (id,org_id,text,source,status,ai,donor_ids,read,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, orgId, read.filedMemo || read.note || text, source, status, aiState, JSON.stringify(ids), JSON.stringify(read), actor(req).id, actor(req).name]);
    return memoRow(orgId, id);
  };

  // AI OFF: a logged note on the one person, and nothing else.
  const noteOnly = async (why) => {
    // VOICE-2: the person she picked IS the one. Before, a memo that named two
    // people kept both, so every pick asked her to pick again.
    if (donorId && ids.length > 1) ids = [ids[0]];
    if (ids.length !== 1) return res.json({ pick: { ai: "off", sentence: `${why} Steward will save your memo as a note on the person you pick.${ids.length > 1 ? " It names more than one person, so pick one." : ""}` } });
    const n = V.memoAsNote(text);
    const m = await save("planned", { noteOnly: true, note: n.note, sensitive: n.sensitive.map(s => ({ ...s, category: s.category || "family" })), followUps: [], interests: [], money: [], contact: [], email: null }, "off");
    const out = await finish(req, m, ids, j(m.read) && { ...j(m.read), sensitive: n.sensitive });
    return out.error ? res.status(out.error).json(out.body) : res.status(201).json(out.body);
  };
  if (!gate.ok) return noteOnly("Steward's AI is off for this organization, so nothing is read from the memo.");

  // ONE SHORT CALL.
  const funds = await orgFunds(orgId);
  const onFile = ids.length ? await E.agentReadPeople(orgId, { ids }) : [];
  const prompt = V.buildMemoPrompt(text, { people: onFile.map(p => ({ name: p.name })), today, funds });
  let raw = null;
  try {
    const msg = await anthropicFor(orgId).messages.create({
      model: AGENT_MODEL, max_tokens: 1500, thinking: { type: "disabled" },
      system: prompt.system, messages: prompt.messages,
      tools: [{ name: V.MEMO_TOOL.name, description: V.MEMO_TOOL.description, strict: true, input_schema: V.MEMO_TOOL.input_schema }],
      tool_choice: { type: "tool", name: V.MEMO_TOOL.name },
    });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === V.MEMO_TOOL.name);
    raw = use && use.input ? use.input : null;
  } catch (e) {
    console.error("[voice] read failed:", e && e.status ? e.status : "", String(e && e.message || e).slice(0, 120));
    await recordAiFallback(orgId, "voice_memo", e).catch(() => {});
  }
  if (!raw) return noteOnly("Steward could not read the memo just now.");
  const read = V.normalizeMemo(raw, text, { today, funds });

  // A NAME NOBODY ON FILE HAS: offer to add them, and wait.
  const heardNew = read.people.filter(h => !V.heardIsMatched(h, onFile));
  if (heardNew.length || !ids.length) {
    const m = await save("needs_people", { ...read, pending: { names: heardNew, needsPerson: !ids.length } }, "on");
    return res.json({ needsPeople: { memoId: m.id, names: heardNew, needsPerson: !ids.length,
      sentence: heardNew.length
        ? `${heardNew.join(" and ")} ${heardNew.length === 1 ? "is" : "are"} not on file. Add ${heardNew.length === 1 ? "them" : "each one"} as a new person, pick who you meant, or leave them out.`
        : "Who was this about? Pick the person and Steward will file it." } });
  }
  const m = await save("planned", read, "on");
  const out = await finish(req, m, ids, read);
  return out.error ? res.status(out.error).json(out.body) : res.status(201).json(out.body);
}

// She answers "who?": add a heard name as a new person, pick somebody, or leave a name out.
app.post("/voice/memos/:id/people", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const m = await memoRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.status !== "needs_people") return res.status(409).json({ error: "already_filed", sentence: "This memo has already been filed." });
  const read = j(m.read) || {};
  let ids = j(m.donor_ids) || [];
  for (const pid of (Array.isArray(req.body.pick) ? req.body.pick : []).map(String).slice(0, 6)) {
    const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [pid, orgId]);
    if (!d) return res.status(400).json({ error: "not_found", sentence: "That person is not on file." });
    if (!ids.includes(d.id)) ids.push(d.id);
  }
  const names = (read.pending && read.pending.names) || [];
  for (const name of (Array.isArray(req.body.add) ? req.body.add : []).map(String).slice(0, 6)) {
    if (!names.includes(name)) return res.status(400).json({ error: "not_heard", sentence: "Steward did not hear that name in the memo." });
    const r = await asHer(req, "POST", "/donors", { name, stage: "prospect", source: "Tell Steward" });
    if (r.status >= 300 || !r.body || !r.body.id) return res.status(r.status >= 400 ? r.status : 400).json({ error: "add_failed", sentence: (r.body && (r.body.sentence || r.body.error)) || "Steward could not add that person." });
    ids.push(r.body.id);
  }
  if (!ids.length) return res.status(400).json({ error: "memo_needs_person", sentence: "Pick who the memo is about." });
  const refusedFor = await clientRefusal(orgId, ids);
  if (refusedFor) {
    await run("DELETE FROM voice_memos WHERE id=? AND org_id=? AND status='needs_people'", [m.id, orgId]);
    return res.status(409).json({ error: "client", sentence: refusedFor });
  }
  await run("UPDATE voice_memos SET donor_ids=?, status='planned' WHERE id=? AND org_id=? AND status='needs_people'", [JSON.stringify(ids), m.id, orgId]);
  const out = await finish(req, { ...m, donor_ids: ids }, ids, read);
  return out.error ? res.status(out.error).json(out.body) : res.status(201).json(out.body);
}));

app.get("/voice/memos", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const did = req.query.donorId ? String(req.query.donorId) : null;
  const rows = await query(`SELECT * FROM voice_memos WHERE org_id=? AND status <> 'needs_people'${did ? " AND donor_ids @> ?::jsonb" : ""} ORDER BY created_at DESC LIMIT 20`,
    did ? [orgId, JSON.stringify([did])] : [orgId]);
  const out = [];
  for (const m of rows) out.push(await memoOut(orgId, m));
  res.json({ memos: out });
}));

app.get("/voice/memos/:id", requireAuth, wrap(async (req, res) => {
  const m = await memoRow(req.user.orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json({ memo: await memoOut(req.user.orgId, m) });
}));

// ── YES OR NO ON A CARD ─────────────────────────────────────────────────────
async function setCard(orgId, m, cardId, patch) {
  const cards = (j(m.cards) || []).map(c => (c.id === cardId ? { ...c, ...patch } : c));
  await run("UPDATE voice_memos SET cards=? WHERE id=? AND org_id=?", [JSON.stringify(cards), m.id, orgId]);
}

app.post("/voice/memos/:id/cards/:cardId/yes", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const m = await memoRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.undone_at) return res.status(409).json({ error: "memo_undone", sentence: "This memo was undone." });
  const card = (j(m.cards) || []).find(c => c.id === req.params.cardId);
  if (!card) return res.status(404).json({ error: "Not found" });
  if (card.state !== "waiting") return res.status(409).json({ error: "already_decided", sentence: "You have already answered this one." });
  const today = orgToday(await orgTz(orgId));
  const A = await AS();

  if (card.kind === "money") {
    // HER yes, through the route a person's click calls, in her name.
    let r, made = {};
    const amount = (card.cents / 100).toFixed(2);
    if (card.moneyKind === "gift") {
      const w = await recordGift({ orgId, donorId: card.donorId, amount: card.cents / 100, date: today, type: "cash", notes: `From Tell Steward: "${String(card.quote).slice(0, 200)}"`,
        fundId: card.fundId && !String(card.fundId).startsWith("cmp") ? card.fundId : undefined,
        idempotencyKey: `voice:${m.id}:${card.id}`, conflict: "idempotency", actorId: actor(req).id, actorName: actor(req).name, source: "voice_memo" });
      if (!w || !w.gift) return res.status(409).json({ error: "not_recorded", sentence: "That gift was already recorded." });
      made = { giftId: w.gift.id };
      await require("../afterChange").afterChange(orgId, [card.donorId], { door: "gift_form" }).catch(() => {});
    } else if (card.moneyKind === "pledge") {
      const read = j(m.read) || {};
      const due = (read.followUps && read.followUps[0] && read.followUps[0].due) || today;
      r = await asHer(req, "POST", `/donors/${card.donorId}/pledges`, { amount, dueDate: due, notes: `From Tell Steward: "${String(card.quote).slice(0, 200)}"` });
      if (r.status >= 300) return res.status(r.status).json(r.body || { error: "pledge_failed" });
      made = { pledgeId: r.body && (r.body.id || (r.body.pledge && r.body.pledge.id)) };
    } else {
      r = await asHer(req, "POST", `/donors/${card.donorId}/proposals`, { purpose: card.fundName || "A gift", askAmount: amount, stage: "identified" });
      if (r.status < 300) made = { proposalId: r.body && (r.body.id || (r.body.proposal && r.body.proposal.id)) };
      else {
        // No pipeline on this plan: the interest is a logged note instead, still hers.
        const n = await asHer(req, "POST", `/donors/${card.donorId}/interactions`, { type: "note", date: today,
          note: `Interest in a ${(await VM()).cents$(card.cents)} gift${card.fundName ? ` to the ${card.fundName}` : ""}. From the memo: "${String(card.quote).slice(0, 200)}"` });
        if (n.status >= 300) return res.status(n.status).json(n.body || { error: "note_failed" });
        made = { interactionId: n.body && n.body.id };
      }
    }
    await setCard(orgId, m, card.id, { state: "saved", ...made, by: actor(req).name });
  } else if (card.kind === "contact" || card.kind === "sensitive") {
    // Through the Agent's runner, so the memo's Undo reaches it too.
    const step = card.kind === "contact"
      ? { tool: "update_contact", donorId: card.donorId, [card.field]: card.value, citesRows: [card.donorId], line: card.title }
      : { tool: "log_note", donorId: card.donorId, note: card.neutral, citesRows: [card.donorId], line: `${card.neutral} Saved as a note.` };
    const E = engine();
    const people = await E.agentReadPeople(orgId, { ids: [card.donorId] });
    const plan = A.compilePlan([step], { people, reads: "your memo" });
    const out = await E.agentRunPlan(orgId, { id: m.instruction_id, text: m.text, plan, authorization: A.AUTH_DRAFT, grounded: m.text },
      { userId: req.user.userId, auth: req.headers.authorization || null });
    const o = (out.steps || [])[0] || {};
    if (o.outcome !== A.OUTCOME_DONE) return res.status(409).json({ error: "not_done", sentence: `Steward could not do that: ${o.reason || "it did not run"}.` });
    await run("UPDATE voice_memos SET run_ids = run_ids || ?::jsonb WHERE id=? AND org_id=?", [JSON.stringify([out.runId]), m.id, orgId]);
    const fresh = await memoRow(orgId, m.id);
    // A decided sensitive card keeps no quote: the neutral words are what was filed.
    await setCard(orgId, fresh, card.id, { state: "saved", by: actor(req).name, ...(card.kind === "sensitive" ? { quote: null } : {}) });
  } else if (card.kind === "draft") {
    return res.status(400).json({ error: "open_the_draft", sentence: "Open the draft to read it and send it yourself." });
  }
  res.json({ memo: await memoOut(orgId, await memoRow(orgId, m.id)) });
}));

app.post("/voice/memos/:id/cards/:cardId/no", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const m = await memoRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  const card = (j(m.cards) || []).find(c => c.id === req.params.cardId);
  if (!card) return res.status(404).json({ error: "Not found" });
  if (card.state !== "waiting") return res.status(409).json({ error: "already_decided" });
  if (card.kind === "draft") await run("UPDATE agent_drafts SET status='skipped' WHERE id=? AND org_id=? AND status='pending'", [card.draftId, orgId]);
  await setCard(orgId, m, card.id, { state: "discarded", by: actor(req).name, ...(card.kind === "sensitive" ? { quote: null } : {}) });
  res.json({ memo: await memoOut(orgId, await memoRow(orgId, m.id)) });
}));

// ── UNDO: EVERYTHING THE MEMO DID ───────────────────────────────────────────
app.post("/voice/memos/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const A = await AS();
  const m = await memoRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.undone_at) return res.status(409).json({ error: "already_undone" });
  if (Date.now() - new Date(m.created_at).getTime() > A.UNDO_DAYS * 86400000) return res.status(409).json({ error: "outside_undo_window", days: A.UNDO_DAYS });
  const took = await run("UPDATE voice_memos SET undone_at=NOW(), undone_by=?, undone_by_name=?, status='undone' WHERE id=? AND org_id=? AND undone_at IS NULL",
    [actor(req).id, actor(req).name, m.id, orgId]);
  if (!took || took.changes === 0) return res.status(409).json({ error: "already_undone" });
  const runIds = j(m.run_ids) || [];
  const writes = runIds.length ? await query("SELECT * FROM agent_writes WHERE org_id=? AND run_id = ANY(?::text[]) AND undone_at IS NULL ORDER BY created_at DESC, id DESC", [orgId, runIds]) : [];
  let undone = 0;
  const failed = [];
  for (const w of writes) {
    const r = await engine().agentUndoWrite(w, orgId);
    if (r.ok) { undone++; await run("UPDATE agent_writes SET undone_at=NOW(), undone_by=?, undone_by_name=? WHERE id=? AND org_id=?", [actor(req).id, actor(req).name, w.id, orgId]); }
    else failed.push(w.tool);
  }
  const cards = (j(m.cards) || []).map(c => (c.state === "waiting" ? { ...c, state: "discarded", quote: c.kind === "sensitive" ? null : c.quote } : c));
  await run("UPDATE voice_memos SET cards=? WHERE id=? AND org_id=?", [JSON.stringify(cards), m.id, orgId]);
  const kept = cards.filter(c => c.kind === "money" && c.state === "saved");
  res.json({ ok: true, undone, failed, memo: await memoOut(orgId, await memoRow(orgId, m.id)),
    sentence: `Undone: ${undone} ${undone === 1 ? "change" : "changes"} taken back.`
      + (kept.length ? ` The ${kept.length === 1 ? "amount" : "amounts"} you confirmed yourself ${kept.length === 1 ? "stays" : "stay"} on the record; remove ${kept.length === 1 ? "it" : "them"} from the person's giving if ${kept.length === 1 ? "it was" : "they were"} wrong.` : "") });
}));

// ── VOICE-3 · TALK TO STEWARD ───────────────────────────────────────────────
// One mic for all of it. What happened is filed by fileMemo (above), exactly
// as a memo always was. Something to do goes to the Agent's own route, so it
// comes back as a PLAN that runs only when she presses Confirm
// (/agent/instructions/:id/confirm, her click). A question goes to Ask, which
// reads and writes nothing. A memo that holds more than one is split, and each
// part goes its own way (shared/voiceTalk.js decides, in code first).
const VT = () => import("../shared/voiceTalk.js");

// fileMemo answers through res; catch its answer so the talk can add to it.
function captured(fn) {
  return new Promise((resolve, reject) => {
    const cap = { status(code) { cap.code = code; return cap; }, json(body) { resolve({ code: cap.code || 200, body }); return cap; } };
    Promise.resolve(fn(cap)).catch(reject);
  });
}

// The words carry no sign of which it is: one short call, through the AI
// switch. With AI off, or when the model cannot tell, the screen asks her.
async function modelSplit(orgId, text, T) {
  const gate = await agentGate(orgId);
  if (!gate.ok) return { kind: null };
  try {
    const msg = await anthropicFor(orgId).messages.create({
      model: AGENT_MODEL, max_tokens: 400, thinking: { type: "disabled" }, system: T.INTENT_SYSTEM,
      messages: [{ role: "user", content: `What she said: ${text}` }],
      tools: [{ name: T.INTENT_TOOL.name, description: T.INTENT_TOOL.description, strict: true, input_schema: T.INTENT_TOOL.input_schema }],
      tool_choice: { type: "tool", name: T.INTENT_TOOL.name },
    });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === T.INTENT_TOOL.name);
    return T.readIntent(use && use.input, text);
  } catch (e) {
    await recordAiFallback(orgId, "voice_talk", e).catch(() => {});
    return { kind: null };
  }
}

app.post("/voice/talk", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const T = await VT();
  const text = String((req.body && req.body.text) || "").replace(/\s+/g, " ").trim();
  if (text.length < MEMO_MIN) return res.status(400).json({ error: "memo_empty", sentence: "Tell Steward what happened, what to do, or what you want to know." });
  if (text.length > MEMO_MAX) return res.status(400).json({ error: "memo_too_long", sentence: "That is too long. Say it in a few sentences." });
  const source = req.body.source === "speech" ? "speech" : "typed";
  const donorId = req.body.donorId ? String(req.body.donorId) : null;

  // Her answer to "log this, or have Steward do it?" decides it outright.
  const as = ["log", "do", "ask"].includes(req.body.as) ? req.body.as : null;
  let parts = as ? { kind: as, log: as === "log" ? text : "", do: as === "do" ? text : "", ask: as === "ask" ? text : "" } : T.splitTalk(text);
  if (!parts.kind) parts = await modelSplit(orgId, text, T);
  if (!parts.kind) return res.json({ talk: { kind: "unsure", sentence: T.UNSURE_LINE } });
  const out = { talk: { kind: parts.kind, log: parts.log, do: parts.do, ask: parts.ask } };

  // ASK: answered by Ask, with its rows. Nothing is written.
  if (parts.ask) {
    const r = await asHer(req, "POST", "/ask", { text: parts.ask });
    out.answer = r.status < 300 && r.body ? r.body
      : { answered: false, sentence: (r.body && r.body.sentence) || "Steward could not answer that just now." };
  }

  // LOG: the memo path, as before.
  let person = null;
  if (parts.log) {
    const m = await captured(cap => fileMemo(req, cap, { text: parts.log, source, donorId, picks: req.body.picks || null }));
    if (m.code >= 400) return res.status(m.code).json({ ...m.body, ...out });
    Object.assign(out, m.body);
    if (m.body.memo) person = (m.body.memo.people || [])[0] || null;
    else if (parts.do) {
      // She answers "which one?" or "who?" first; the to-do waits for that.
      out.then = { do: parts.do };
      return res.json(out);
    }
  }

  // DO: the Agent's plan. It waits for her Confirm and writes nothing before it.
  if (parts.do) {
    let doText = parts.do;
    if (!person && donorId) [person] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]);
    if (person) {
      // "send her the boat photos", after a memo about Margaret: the plan is on Margaret.
      const named = await engine().agentNamedIn(orgId, doText, null);
      if (!(named.scope || []).length && !named.ambiguous.length) doText = T.namePronouns(doText, person.name);
    }
    const r = await asHer(req, "POST", "/agent/instructions", { text: doText, ...(req.body.personId ? { personId: String(req.body.personId) } : {}) });
    out.plan = { status: r.status, text: doText, ...(r.body || {}) };
  }
  res.status(out.memo ? 201 : 200).json(out);
}));
}

module.exports = { routers, mount };
