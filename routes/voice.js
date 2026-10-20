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
  if (read.meetingId) await linkMeeting(orgId, read.meetingId, m.id, result.runId);
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

// ONE MEMO PATH. A spoken or typed memo, and (VOICE-2) a meeting's summary,
// are filed by this one function: who, the one short read, the plan, the cards.
async function fileMemo(req, res, { text, source, donorId = null, picks = null, meetingId = null, heldDetails = [] }) {
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
  // The person she is on (or chose for the meeting) answers "which Margaret?"
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
    const m = await save("planned", { meetingId, noteOnly: true, note: n.note, sensitive: n.sensitive.map(s => ({ ...s, category: s.category || "family" })), followUps: [], interests: [], money: [], contact: [], email: null }, "off");
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
  const read = { ...V.normalizeMemo(raw, text, { today, funds }), meetingId };
  // A meeting's personal details were held back from its summary; each waits as a card.
  for (const h of heldDetails) if (read.sensitive.length < 4 && !read.sensitive.some(x => x.category === h.category)) read.sensitive.push(h);

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

// ── VOICE-2 · MEETING MODE ──────────────────────────────────────────────────
// "Listen to this meeting": the page listens through the microphone, restarts
// the browser's recognizer whenever it stops on its own, and saves the words
// here as they come (PUT), so a closed tab or a dropped connection loses
// nothing. At Stop, one short call writes the summary, and the summary is
// filed through fileMemo, the same path as a spoken memo. The transcript is
// kept on the conversation, screened, and deleted with one click.
const MT = () => import("../shared/voiceMeeting.js");
const MEETING_OPEN = ["listening", "paused"];

async function meetingRow(orgId, id) {
  const [m] = await query("SELECT * FROM voice_meetings WHERE id=? AND org_id=?", [id, orgId]);
  return m || null;
}
async function meetingOut(orgId, m, { withTranscript = true } = {}) {
  const ids = j(m.donor_ids) || [];
  const people = ids.length ? await query("SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?::text[])", [orgId, ids]) : [];
  const T = await MT();
  return {
    id: m.id, status: m.status, ai: m.ai, segments: m.segments, held: m.held,
    people: ids.map(id => people.find(p => p.id === id)).filter(Boolean),
    startedAt: m.started_at, stoppedAt: m.stopped_at, updatedAt: m.updated_at,
    minutes: T.minutesBetween(m.started_at, m.stopped_at || m.updated_at),
    notes: m.notes || "", transcript: withTranscript ? (m.transcript || "") : undefined,
    transcriptChars: String(m.transcript || "").length,
    transcriptDeletedAt: m.transcript_deleted_at || null,
    summary: j(m.summary) ? (({ held: _h, ...rest }) => rest)(j(m.summary)) : null, memoId: m.memo_id || null,
    interactionIds: j(m.interaction_ids) || [],
  };
}
const mine = (req, m) => m && m.created_by === actor(req).id;

// After the memo path filed the summary: the conversation(s) it logged carry
// the meeting, so the transcript is on the conversation.
async function linkMeeting(orgId, meetingId, memoId, runId) {
  const rows = runId ? await query("SELECT entity_id FROM agent_writes WHERE org_id=? AND run_id=? AND tool IN ('log_conversation','log_note') AND entity_id IS NOT NULL", [orgId, runId]) : [];
  const ints = rows.map(r => r.entity_id);
  if (ints.length) await run(`UPDATE interactions SET metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb WHERE org_id=? AND id = ANY(?::text[])`,
    [JSON.stringify({ meetingId }), orgId, ints]);
  await run("UPDATE voice_meetings SET memo_id=?, interaction_ids=?, status='filed', summary = summary - 'held', updated_at=NOW() WHERE id=? AND org_id=?",
    [memoId, JSON.stringify(ints), meetingId, orgId]);
}

// Start. She has been shown the consent line; the request says so.
app.post("/voice/meetings", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (req.body.consent !== true) return res.status(400).json({ error: "consent_first", sentence: "Let everyone know you're taking notes, then press Start." });
  const T = await MT();
  let ids = [];
  if (req.body.donorId) {
    const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(req.body.donorId), orgId]);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    ids = [d.id];
  }
  const refusedFor = await clientRefusal(orgId, ids);
  if (refusedFor) return res.status(409).json({ error: "client", sentence: refusedFor });
  const id = "vmt_" + uuid().slice(0, 10);
  await run(`INSERT INTO voice_meetings (id,org_id,status,donor_ids,notes,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)`,
    [id, orgId, "listening", JSON.stringify(ids), String(req.body.notes || "").slice(0, 20000), actor(req).id, actor(req).name]);
  res.status(201).json({ meeting: await meetingOut(orgId, await meetingRow(orgId, id)), consentLine: T.CONSENT_LINE });
}));

// BEFORE THE MEETING: the same brief Home's meeting card shows (giving, the
// last time, the open ask, their last email, a gift not yet thanked), and her
// meetings today with people on file, to pick from.
app.get("/voice/meetings/brief", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const fin = require("./finance");
  let brief = null;
  if (req.query.donorId) {
    const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(req.query.donorId), orgId]);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    if (await clientRefusal(orgId, [d.id])) return res.json({ brief: null, today: [] });
    brief = await fin.meetingBrief(orgId, d.id, new Date().toISOString());
  }
  let today = [];
  try {
    const t = await fin.composeTodayMeetings(orgId, req.user.userId);
    const priv = await require("../clientSafe").privacyFor(orgId);   // CLIENT-SAFE-1: a client's meeting is never offered
    today = (t.meetings || []).filter(mt => (mt.people || []).length && !(priv.on && mt.people.some(p => priv.clientIds.has(p.id))) && (!mt.endsAt || new Date(mt.endsAt).getTime() > Date.now() - 2 * 3600e3))
      .map(mt => ({ id: mt.id, title: mt.title, startsAt: mt.startsAt, location: mt.location, people: mt.people.map(p => ({ id: p.id, name: p.name })) })).slice(0, 4);
  } catch { today = []; }
  res.json({ brief, today });
}));

// Her meeting still running (a tab that closed mid-meeting comes back to it).
app.get("/voice/meetings/open", requireAuth, wrap(async (req, res) => {
  const [m] = await query(`SELECT * FROM voice_meetings WHERE org_id=? AND created_by=? AND status = ANY(?::text[]) ORDER BY updated_at DESC LIMIT 1`,
    [req.user.orgId, actor(req).id, MEETING_OPEN]);
  res.json({ meeting: m ? await meetingOut(req.user.orgId, m) : null });
}));

app.get("/voice/meetings/:id", requireAuth, wrap(async (req, res) => {
  const m = await meetingRow(req.user.orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json({ meeting: await meetingOut(req.user.orgId, m) });
}));

// Saved as it comes. The page sends the whole transcript so far (idempotent);
// a stale save never shortens what is already kept.
app.put("/voice/meetings/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const T = await MT();
  const m = await meetingRow(orgId, req.params.id);
  if (!m || !mine(req, m)) return res.status(404).json({ error: "Not found" });
  if (!MEETING_OPEN.includes(m.status)) return res.status(409).json({ error: "meeting_stopped", sentence: "This meeting has already stopped." });
  const transcript = String(req.body.transcript == null ? m.transcript : req.body.transcript).slice(0, T.TRANSCRIPT_MAX);
  const keep = transcript.length >= String(m.transcript || "").length ? transcript : m.transcript;
  const status = req.body.status === "paused" ? "paused" : req.body.status === "listening" ? "listening" : m.status;
  await run("UPDATE voice_meetings SET transcript=?, notes=?, segments=GREATEST(segments, ?), status=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [keep, String(req.body.notes == null ? m.notes : req.body.notes).slice(0, 20000), Math.max(0, Number(req.body.segments) || 0), status, m.id, orgId]);
  res.json({ ok: true, savedChars: keep.length });
}));

// Throw a running meeting away: nothing is filed and the words are gone.
app.post("/voice/meetings/:id/discard", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const m = await meetingRow(orgId, req.params.id);
  if (!m || !mine(req, m)) return res.status(404).json({ error: "Not found" });
  if (!MEETING_OPEN.includes(m.status)) return res.status(409).json({ error: "meeting_stopped" });
  await run("UPDATE voice_meetings SET status='discarded', transcript='', notes='', stopped_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?", [m.id, orgId]);
  res.json({ ok: true });
}));

// AI OFF (or the summary could not be written): the transcript is saved as a
// note on the person she chose, and nothing else happens.
async function meetingAsNote(req, res, m, T, why) {
  const orgId = req.user.orgId;
  const ids = j(m.donor_ids) || [];
  if (!ids.length) return res.json({ meeting: await meetingOut(orgId, m, { withTranscript: false }),
    pick: { ai: "off", sentence: `${why} Pick who the meeting was with, and Steward saves the transcript as a note on them.` } });
  const screened = T.screenTranscript(m.transcript);
  const D = await import("../shared/displayDate.js");
  const today = orgToday(await orgTz(orgId));
  const mins = T.minutesBetween(m.started_at, m.stopped_at);
  const note = [`Meeting notes, ${D.displayDateShort(today, today)}${mins ? `, about ${mins} minutes` : ""}.`,
    String(m.notes || "").trim() ? `Your notes: ${String(m.notes).trim()}` : "",
    screened.text ? `Transcript: ${screened.text}` : "Nothing was heard."].filter(Boolean).join("\n\n");
  const r = await asHer(req, "POST", `/donors/${ids[0]}/interactions`, { type: "note", date: today, note, metadata: { meetingId: m.id, via: "tell_steward_meeting" } });
  if (r.status >= 300) return res.status(r.status).json(r.body || { error: "note_failed" });
  await run("UPDATE voice_meetings SET status='note', ai='off', transcript=?, held=?, interaction_ids=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [screened.text, screened.held, JSON.stringify([r.body && r.body.id].filter(Boolean)), m.id, orgId]);
  return res.status(201).json({ meeting: await meetingOut(orgId, await meetingRow(orgId, m.id)), note: `${why} The transcript is saved as a note on the person, and nothing else was done.` });
}

// File the summary through the one memo path. Called at Stop, and again when
// she answers "which one?" or "who was it?".
async function fileMeeting(req, res, m, { picks = null, donorId = null } = {}) {
  const orgId = req.user.orgId;
  const sum = j(m.summary) || {};
  const ids = j(m.donor_ids) || [];
  const chosen = donorId || ids[0] || null;
  // fileMemo answers through res; catch its answer to add the meeting to it.
  const out = await new Promise((resolve, reject) => {
    const cap = { status(code) { cap.code = code; return cap; }, json(body) { resolve({ code: cap.code || 200, body }); return cap; } };
    fileMemo(req, cap, { text: sum.memoText || "A meeting.", source: "meeting", donorId: chosen, picks, meetingId: m.id, heldDetails: sum.held || [] }).catch(reject);
  });
  const fresh = await meetingRow(orgId, m.id);
  return res.status(out.code).json({ ...out.body, meeting: await meetingOut(orgId, fresh, { withTranscript: false }) });
}

app.post("/voice/meetings/:id/stop", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const T = await MT();
  let m = await meetingRow(orgId, req.params.id);
  if (!m || !mine(req, m)) return res.status(404).json({ error: "Not found" });
  if (!MEETING_OPEN.includes(m.status)) return res.status(409).json({ error: "meeting_stopped", sentence: "This meeting has already stopped." });
  // The last words from the page, then the meeting is closed to more.
  const last = req.body.transcript == null ? m.transcript : String(req.body.transcript).slice(0, T.TRANSCRIPT_MAX);
  const transcript = last.length >= String(m.transcript || "").length ? last : m.transcript;
  const notes = String(req.body.notes == null ? m.notes : req.body.notes).slice(0, 20000);
  const took = await run(`UPDATE voice_meetings SET transcript=?, notes=?, segments=GREATEST(segments, ?), status='stopped', stopped_at=NOW(), updated_at=NOW()
                           WHERE id=? AND org_id=? AND status = ANY(?::text[])`,
    [transcript, notes, Math.max(0, Number(req.body.segments) || 0), m.id, orgId, MEETING_OPEN]);
  if (!took || took.changes === 0) return res.status(409).json({ error: "meeting_stopped", sentence: "This meeting has already stopped." });
  m = await meetingRow(orgId, m.id);
  if (String(m.transcript || "").trim().length + String(m.notes || "").trim().length < 4)
    return res.status(400).json({ error: "nothing_heard", sentence: "Steward did not hear anything in this meeting, so nothing was filed.", meeting: await meetingOut(orgId, m) });

  const gate = await agentGate(orgId);
  if (!gate.ok) return meetingAsNote(req, res, m, T, "Steward's AI is off for this organization.");

  // ONE SHORT CALL: the summary.
  const ids = j(m.donor_ids) || [];
  const onFile = ids.length ? await engine().agentReadPeople(orgId, { ids }) : [];
  const today = orgToday(await orgTz(orgId));
  const prompt = T.buildMeetingPrompt({ transcript: T.screenTranscript(m.transcript).text, notes: m.notes, people: onFile.map(p => p.name), today,
    minutes: T.minutesBetween(m.started_at, m.stopped_at) });
  let raw = null;
  try {
    const msg = await anthropicFor(orgId).messages.create({
      model: AGENT_MODEL, max_tokens: 1500, thinking: { type: "disabled" },
      system: prompt.system, messages: prompt.messages,
      tools: [{ name: T.MEETING_TOOL.name, description: T.MEETING_TOOL.description, strict: true, input_schema: T.MEETING_TOOL.input_schema }],
      tool_choice: { type: "tool", name: T.MEETING_TOOL.name },
    });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === T.MEETING_TOOL.name);
    raw = use && use.input ? use.input : null;
  } catch (e) {
    console.error("[voice] meeting summary failed:", e && e.status ? e.status : "", String(e && e.message || e).slice(0, 120));
    await recordAiFallback(orgId, "voice_meeting", e).catch(() => {});
  }
  if (!raw) return meetingAsNote(req, res, m, T, "Steward could not write the summary just now.");
  const screened = T.screenTranscript(m.transcript);
  // `held` rides only until the summary is filed (linkMeeting drops it).
  const sum = { ...T.normalizeMeeting(raw, { people: onFile.map(p => p.name) }), held: screened.details.slice(0, 4) };
  // The transcript as kept is the screened one, from here on.
  await run("UPDATE voice_meetings SET summary=?, ai='on', transcript=?, held=? WHERE id=? AND org_id=?",
    [JSON.stringify(sum), screened.text, screened.held, m.id, orgId]);
  return fileMeeting(req, res, await meetingRow(orgId, m.id));
}));

// She answered "which one?" or picked the person: file the same summary.
app.post("/voice/meetings/:id/file", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const T = await MT();
  const m = await meetingRow(orgId, req.params.id);
  if (!m || !mine(req, m)) return res.status(404).json({ error: "Not found" });
  if (m.status !== "stopped") return res.status(409).json({ error: "already_filed", sentence: "This meeting has already been filed." });
  if (req.body.donorId) {
    const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(req.body.donorId), orgId]);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    const refusedFor = await clientRefusal(orgId, [d.id]);
    if (refusedFor) return res.status(409).json({ error: "client", sentence: refusedFor });
    await run("UPDATE voice_meetings SET donor_ids=? WHERE id=? AND org_id=?", [JSON.stringify([d.id]), m.id, orgId]);
  }
  const fresh = await meetingRow(orgId, m.id);
  if (!j(fresh.summary)) return meetingAsNote(req, res, fresh, T, "Steward's AI is off for this organization.");
  return fileMeeting(req, res, fresh, { picks: Array.isArray(req.body.picks) ? req.body.picks : null, donorId: req.body.donorId || null });
}));

// One click: the transcript is gone. The summary and what it filed stay.
app.delete("/voice/meetings/:id/transcript", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const m = await meetingRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  await run("UPDATE voice_meetings SET transcript='', transcript_deleted_at=NOW(), transcript_deleted_by=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [actor(req).id, m.id, orgId]);
  res.json({ meeting: await meetingOut(orgId, await meetingRow(orgId, m.id)), sentence: "The transcript is deleted. The summary and what it filed stay." });
}));

// ASK ABOUT THIS MEETING: one question, answered from this transcript only.
app.post("/voice/meetings/:id/ask", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const T = await MT();
  const m = await meetingRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  const question = String(req.body.question || "").trim();
  if (question.length < 3) return res.status(400).json({ error: "ask_empty", sentence: "Ask a question about the meeting." });
  if (!String(m.transcript || "").trim() && !String(m.notes || "").trim()) return res.status(409).json({ error: "no_transcript", sentence: "This meeting's transcript was deleted, so there is nothing to ask about." });
  const gate = await agentGate(orgId);
  if (!gate.ok) return res.status(503).json({ error: "ai_off", sentence: "Questions about a meeting need Steward's AI, which is off. The transcript is below." });
  const prompt = T.buildAskPrompt({ question, transcript: m.transcript, notes: m.notes });
  try {
    const msg = await anthropicFor(orgId).messages.create({
      model: AGENT_MODEL, max_tokens: 600, thinking: { type: "disabled" }, system: prompt.system, messages: prompt.messages,
      tools: [{ name: T.ASK_TOOL.name, description: T.ASK_TOOL.description, strict: true, input_schema: T.ASK_TOOL.input_schema }],
      tool_choice: { type: "tool", name: T.ASK_TOOL.name },
    });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === T.ASK_TOOL.name);
    const a = (use && use.input) || {};
    res.json({ answer: String(a.answer || "").replace(/\u2014/g, ",").slice(0, 800) || "The meeting did not cover that.",
      quotes: T.groundedQuotes(a.quotes, m.transcript, m.notes) });
  } catch (e) {
    await recordAiFallback(orgId, "voice_meeting_ask", e).catch(() => {});
    res.status(503).json({ error: "ask_failed", sentence: "Steward could not answer just now. The transcript is below." });
  }
}));
}

module.exports = { routers, mount };
