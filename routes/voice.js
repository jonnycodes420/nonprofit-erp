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
const orgTime = require("../orgTime");
const ItemRefs = require("../itemRefs");   // THREAD-2: every name in a result is a link

const routers = { r0: express.Router() };
const MEMO_MIN = 4, MEMO_MAX = 4000;
const NOTES = "notes";

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, uuid, orgTz, orgToday, agentGate, recordGift, AGENT_MODEL } = ctx;
const app = routers.r0;
const VM = () => import("../shared/voiceMemo.js");
const VT = () => import("../shared/voiceTalk.js");
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

// THREAD-2 · EVERY NAME IS A LINK. Each line of "Done for you" carries the
// things it names: the person, and what was written (the conversation, the
// task, the gift, the group, the journey, the event), read from this org only.
const TOOL_REF = { log_conversation: "conversation", log_note: "note", draft_note: "note", create_task: "task",
  mark_gift_thanked: "gift", add_to_group: "group", remove_from_group: "group", start_journey: "journey",
  stop_journey: "journey", register_event: "event" };
async function withRefs(orgId, done, people) {
  const L = await ItemRefs.links();
  for (const p of people) p.name = L.nameOrFallback(p.name, p.email);
  const byId = new Map(people.map(p => [p.id, p]));
  const want = id => done.filter(d => TOOL_REF[d.tool] === id && d.entityId).map(d => String(d.entityId));
  const [tasks, groups, plans, events, ints] = await Promise.all([
    want("task").length ? query("SELECT id, title FROM tasks WHERE org_id=? AND id = ANY(?::text[])", [orgId, want("task")]) : [],
    want("group").length ? query("SELECT id, name FROM audiences WHERE org_id=? AND kind IS NOT NULL AND id = ANY(?::text[])", [orgId, want("group").map(x => x.split(":")[0])]) : [],
    want("journey").length ? query(`SELECT p.id, p.template_id, COALESCE(t.name, p.template_name) AS name FROM cultivation_plans p
        LEFT JOIN cultivation_templates t ON t.id = p.template_id AND t.org_id = p.org_id WHERE p.org_id=? AND p.id = ANY(?::text[])`, [orgId, want("journey")]) : [],
    want("event").length ? query(`SELECT a.id, e.id AS event_id, e.name FROM event_attendees a JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
        WHERE a.org_id=? AND a.id = ANY(?::text[])`, [orgId, want("event")]).catch(() => []) : [],
    [...want("conversation"), ...want("note")].length ? query("SELECT id, type FROM interactions WHERE org_id=? AND id = ANY(?::text[])", [orgId, [...want("conversation"), ...want("note")]]) : [],
  ]);
  const find = (rows, id) => rows.find(r => r.id === id);
  for (const d of done) {
    const refs = [];
    const person = d.donorId && byId.get(d.donorId);
    if (person) refs.push({ kind: "person", id: person.id, name: person.name, email: person.email || null });
    const k = TOOL_REF[d.tool], id = d.entityId ? String(d.entityId) : null;
    let act = null;
    if (k === "task" && find(tasks, id)) act = { kind: "task", id, donorId: d.donorId };
    else if (k === "group") { const g = find(groups, id.split(":")[0]); if (g) refs.push({ kind: "group", id: g.id, name: g.name }); }
    else if (k === "journey") { const pl = find(plans, id); if (pl && pl.template_id) refs.push({ kind: "journey", id: pl.template_id, name: pl.name }); }
    else if (k === "event") { const a = find(events, id); if (a) refs.push({ kind: "event", id: a.event_id, name: a.name }); }
    else if ((k === "conversation" || k === "note") && find(ints, id)) act = { kind: find(ints, id).type || "note", logged: true, id, donorId: d.donorId };
    else if (k === "gift" && id && d.donorId) act = { kind: "gift", id, donorId: d.donorId };
    d.refs = refs;
    d.actRef = act;
  }
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
        reason: o.reason || null, card: s.card || null, entityId: o.entityId || null });
    });
  }
  const cards = j(m.cards) || [];
  const draftIds = cards.filter(c => c.kind === "draft" && c.draftId).map(c => c.draftId);
  const drafts = draftIds.length ? await query("SELECT id, status FROM agent_drafts WHERE org_id=? AND id = ANY(?::text[])", [orgId, draftIds]) : [];
  const dState = new Map(drafts.map(d => [d.id, d.status]));
  const ids = j(m.donor_ids) || [];
  const people = ids.length ? await query("SELECT id, name, email FROM donors WHERE org_id=? AND id = ANY(?::text[])", [orgId, ids]) : [];
  await withRefs(orgId, done, people);
  return {
    id: m.id, status: m.status, ai: m.ai, source: m.source, text: m.text, preview: V.memoPreview(m.text, j(m.read)), createdAt: m.created_at, createdByName: m.created_by_name,
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

// ── VOICE-4 PART 2 · A MEETING SHE SAYS HAPPENED IS MARKED HAPPENED ─────────
// The memo's conversation is matched to that person's meeting today, else the
// most recent in the last two days that nobody has written up. Her words
// stay her words: a "lunch" still matches the 10 AM coffee when it is the only
// meeting with her that day. The match is what the calendar's own "how did it
// go" does (routes/finance.js /calendar/events/:id/log): the event is logged
// and linked to the conversation, its prep and after tasks are done, and the
// step it holds is answered (meetingEffects.meetingLogged). The Thread step
// and tasks due that day for her are done too ("Coffee tomorrow. Bring Lily's
// class schedule."). What it changed is kept, so Undo puts it back.
async function closeMeeting(req, { donorId, date, how, today, interactionId }) {
  const orgId = req.user.orgId;
  const tz = (await orgTz(orgId)).timezone || "America/New_York";
  const rows = await query(
    `SELECT id, title, starts_at, ((starts_at AT TIME ZONE ?)::date)::text AS day
       FROM calendar_events
      WHERE org_id=? AND ?=ANY(person_ids) AND logged_at IS NULL AND dismissed_at IS NULL
        AND (starts_at AT TIME ZONE ?)::date BETWEEN (?::date - 2) AND ?::date
      ORDER BY starts_at DESC`, [tz, orgId, donorId, tz, date, date > today ? date : today]);
  if (!rows.length) {
    // CHECK-2: the meeting was already written up on its card ("How did it
    // go") and she tells Steward about it too. Nothing is reopened or closed
    // twice; the memo's conversation says which meeting it was, so the
    // calendar draws that sitting once.
    const [done] = await query(
      `SELECT id, title FROM calendar_events WHERE org_id=? AND ?=ANY(person_ids) AND logged_at IS NOT NULL AND dismissed_at IS NULL
          AND (starts_at AT TIME ZONE ?)::date = ?::date ORDER BY starts_at DESC LIMIT 1`, [orgId, donorId, tz, date]);
    if (done) await run(`UPDATE interactions SET metadata = COALESCE(metadata,'{}'::jsonb) || ?::jsonb WHERE id=? AND org_id=?`,
      [JSON.stringify({ calendar_event_id: done.id, meeting_title: done.title }), interactionId, orgId]);
    return null;
  }
  const sameDay = rows.filter(r => r.day === date || r.day === today);
  const pool = sameDay.length ? sameDay : rows.filter(r => r.day < date).slice(0, 1);
  const word = new RegExp(`\\b${String(how || "").replace(/[^a-z]/gi, "")}\\b`, "i");
  const ev = pool.length === 1 ? pool[0] : (pool.find(r => how && word.test(r.title)) || null);
  if (!ev) return null;
  const who = actor(req);
  await run(`UPDATE calendar_events SET logged_at=NOW(), logged_by=?, interaction_id=?, updated_at=NOW() WHERE id=? AND org_id=? AND logged_at IS NULL`,
    [who.id, interactionId, ev.id, orgId]);
  await run(`UPDATE interactions SET metadata = COALESCE(metadata,'{}'::jsonb) || ?::jsonb WHERE id=? AND org_id=?`,
    [JSON.stringify({ calendar_event_id: ev.id, meeting_title: ev.title }), interactionId, orgId]);
  const effects = await query(`SELECT * FROM meeting_effects WHERE calendar_event_id=? AND org_id=?`, [ev.id, orgId]);
  await require("../meetingEffects").meetingLogged(ev.id, interactionId);
  // The step and tasks that were waiting on this meeting: tied to it, or due
  // that day (or the day before) and naming it ("Coffee tomorrow. Bring Lily's
  // class schedule." for the coffee). Another task due that day stays open.
  const MEET = new Set(["coffee", "lunch", "breakfast", "dinner", "drinks", "tea", "visit", "tour", "meeting", "meet", "walkthrough"]);
  const evWords = String(ev.title || "").toLowerCase().match(/[a-z]{3,}/g) || [];
  const names = new Set([...evWords.filter(w => MEET.has(w)), ...(MEET.has(String(how || "").toLowerCase()) ? [String(how).toLowerCase()] : [])]);
  const namesIt = label => (String(label || "").toLowerCase().match(/[a-z]{3,}/g) || []).some(w => names.has(w));
  const near = d => { const x = String(d || "").slice(0, 10); return x && x <= ev.day && x >= orgTime.addDays(ev.day, -1); };
  const openThreads = await query(`SELECT id, next_step_label, due_date, calendar_event_id FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL`, [orgId, donorId]);
  const threadIds = openThreads.filter(t => t.calendar_event_id === ev.id || (near(t.due_date) && namesIt(t.next_step_label))).map(t => t.id);
  if (threadIds.length) await run(`UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=? WHERE org_id=? AND id = ANY(?::text[]) AND closed_at IS NULL`,
    [interactionId, orgId, threadIds]);
  const openTasks = await query(`SELECT id, title, due, calendar_event_id, thread_id FROM tasks WHERE org_id=? AND donor_id=? AND done=0 AND voided_at IS NULL`, [orgId, donorId]);
  const taskIds = openTasks.filter(t => t.calendar_event_id === ev.id || threadIds.includes(t.thread_id) || (near(t.due) && namesIt(t.title))).map(t => t.id);
  if (taskIds.length) await run(`UPDATE tasks SET done=1, completed_at=COALESCE(completed_at,NOW()), completed_by_name=?, updated_at=NOW() WHERE org_id=? AND id = ANY(?::text[])`,
    [who.name, orgId, taskIds]);
  return { eventId: ev.id, title: ev.title, day: ev.day, interactionId, threadIds, taskIds,
    effects: effects.map(e => e.id) };
}
async function reopenMeeting(orgId, mt) {
  if (!mt || !mt.eventId) return;
  await run(`UPDATE calendar_events SET logged_at=NULL, logged_by=NULL, interaction_id=NULL, updated_at=NOW() WHERE id=? AND org_id=? AND interaction_id=?`, [mt.eventId, orgId, mt.interactionId]);
  // A step comes back only if nothing else has opened since (one open step per person).
  for (const tid of mt.threadIds || [])
    await run(`UPDATE threads t SET closed_at=NULL, close_kind=NULL, closing_interaction_id=NULL WHERE t.org_id=? AND t.id=?
                 AND NOT EXISTS (SELECT 1 FROM threads o WHERE o.org_id=t.org_id AND o.donor_id=t.donor_id AND o.closed_at IS NULL)`, [orgId, tid]);
  if ((mt.taskIds || []).length) await run(`UPDATE tasks SET done=0, completed_at=NULL, completed_by_name=NULL, updated_at=NOW() WHERE org_id=? AND id = ANY(?::text[])`, [orgId, mt.taskIds]);
}

// ── BUILD THE PLAN AND RUN IT ──────────────────────────────────────────────
async function finish(req, m, ids, read) {
  const orgId = req.user.orgId;
  const V = await VM(), A = await AS(), P = await PS(), T = await VT();
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
    // VOICE-4 Part 3: a memo only CREATES tasks. The first follow-up became
    // the Thread's next step through set_next_step, which REWRITES the open
    // step when there is one: "Log the gift" took over Sep 19's "Coffee
    // tomorrow" with its old note and "Edited by Dana". Now the next step is
    // set only when nothing is open; otherwise each follow-up is a new task.
    // "Log the gift" is never a task (the money is the card), and "send her
    // the receipt" is readied with the gift as one Confirm, so neither is one.
    const [openStep] = await query("SELECT id FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL", [orgId, primary]);
    const hasGift = (read.money || []).some(mo => mo.kind === "gift");
    let firstStep = !openStep;
    for (const f of read.followUps) {
      if (T.isMoneyChore(f.label)) continue;
      if (hasGift && T.isReceiptChore(f.label)) { read.receiptAsked = true; continue; }
      if (firstStep) {
        firstStep = false;
        steps.push({ tool: "set_next_step", donorId: primary, label: f.label, due: f.due, citesRows: cite(primary),
          line: `${f.label}, on the Thread for ${day(f.due)}${f.exact ? "" : " (you named no date, so two weeks)"}` });
      } else steps.push({ tool: "create_task", donorId: primary, title: f.label, due: f.due, citesRows: cite(primary), line: `${f.label}, a task for ${day(f.due)}` });
    }
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

  // VOICE-4 Part 2: the meeting closes itself.
  let meeting = null;
  if (!read.noteOnly && read.kind === "meeting") {
    const conv = (result.steps || []).find(st => st.tool === "log_conversation" && st.donorId === primary && st.entityId);
    if (conv) meeting = await closeMeeting(req, { donorId: primary, date: read.date, how: read.how, today, interactionId: conv.entityId }).catch(e => {
      console.error("[voice] meeting match:", String(e && e.message || e).slice(0, 160)); return null; });
  }

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
    // "then send her the receipt": its card waits beside the gift's, and goes
    // with it (it cannot go before the gift is recorded).
    const giftCard = cards.find(c => c.kind === "money" && c.moneyKind === "gift");
    if (giftCard && read.receiptAsked) cards.push({ id: cardId(), kind: "thanks", afterCard: giftCard.id, giftId: null, donorId: primary, cents: giftCard.cents,
      state: "waiting", title: `Send ${first(primary)} the receipt and thank-you`, detail: `For the ${V.cents$(giftCard.cents)} gift, once it is recorded` });
    for (const c of read.contact) cards.push({ id: cardId(), kind: "contact", field: c.field, value: c.value, donorId: primary, quote: c.quote, state: "waiting",
      title: `Change ${first(primary)}'s ${c.field} to ${c.value}?` });
  }
  for (const s of read.sensitive) cards.push({ id: cardId(), kind: "sensitive", category: s.category, neutral: s.neutral, quote: s.quote, donorId: primary, state: "waiting",
    title: s.neutral.replace(/\.$/, "") });

  await run(`UPDATE voice_memos SET status=?, donor_ids=?, cards=?, instruction_id=?, run_ids=?, read=? WHERE id=? AND org_id=?`,
    [read.noteOnly ? "note" : "done", JSON.stringify(order), JSON.stringify(cards), insId, JSON.stringify([result.runId]),
     JSON.stringify({ ...read, sensitive: read.sensitive.map(s => ({ category: s.category, neutral: s.neutral })), pending: null, meeting }), m.id, orgId]);
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

// ── VOICE-4 PART 1 · AFTER HER YES ON A GIFT ────────────────────────────────
// The gift is in. Tasks that only said to log it are done ("Log the gift" is
// the card, never a chore), a receipt task she asked for is tied to THIS gift
// so it shows "$5,000 gift, Oct 21" rather than whatever else is open, and the
// receipt and thank-you wait as one card: one Confirm sends both.
const dayWords = d => { const x = new Date(String(d).slice(0, 10) + "T12:00:00Z"); return x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };
async function giftFollowOn(req, m, card, gift, today) {
  const orgId = req.user.orgId, T = await VT(), V = await VM();
  const open = await query(`SELECT id, title, source_gift_id, created_at FROM tasks WHERE org_id=? AND donor_id=? AND done=0 AND voided_at IS NULL AND COALESCE(link_kind,'') <> 'next_step'`, [orgId, card.donorId]);
  const chores = open.filter(t => T.isMoneyChore(t.title)).map(t => t.id);
  if (chores.length) await run(`UPDATE tasks SET done=1, completed_at=COALESCE(completed_at,NOW()), completed_by_name=?, updated_at=NOW() WHERE org_id=? AND id = ANY(?::text[])`,
    [actor(req).name, orgId, chores]);
  const receiptTasks = open.filter(t => !t.source_gift_id && T.isReceiptChore(t.title) && new Date(t.created_at) >= new Date(m.created_at)).map(t => t.id);
  if (receiptTasks.length) await run(`UPDATE tasks SET source_gift_id=? WHERE org_id=? AND id = ANY(?::text[])`, [gift.id, orgId, receiptTasks]);
  const cards = j(m.cards) || [];
  if (cards.some(c => c.kind === "thanks" && c.giftId === gift.id)) return;
  const waitingFor = cards.find(c => c.kind === "thanks" && c.afterCard === card.id && !c.giftId);
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [card.donorId, orgId]);
  const first = String((d && d.name) || "").split(/\s+/)[0] || "them";
  const cents = Math.round(Number(gift.amount) * 100);
  const ready = { giftId: gift.id, donorId: card.donorId, cents, title: `Send ${first} the receipt and thank-you`,
    detail: `${V.cents$(cents)} gift, ${dayWords(gift.date || today)}`, closedTaskIds: chores, taskIds: receiptTasks };
  if (waitingFor) Object.assign(waitingFor, ready);
  else cards.push({ id: "vc_" + uuid().slice(0, 8), kind: "thanks", state: "waiting", ...ready });
  await run("UPDATE voice_memos SET cards=? WHERE id=? AND org_id=?", [JSON.stringify(cards), m.id, orgId]);
}

// ONE CONFIRM, TWO SENDS, BOTH HERS: the receipt through the receipt route
// (a transactional send, the org's own setting), and the drafted thank-you
// through a thank-you task's own Send (the one draft sender: every mail rule
// applied at the press). The task closes as it sends.
async function sendThanks(req, m, card) {
  const orgId = req.user.orgId;
  if (!card.giftId) return { status: 409, error: "gift_first", sentence: "Record the gift first, then the receipt and thank-you can go." };
  const [g] = await query("SELECT id, donor_id, amount, date FROM gifts WHERE id=? AND org_id=?", [card.giftId, orgId]);
  if (!g) return { status: 404, error: "gift_gone", sentence: "That gift is no longer on the record." };
  const drafts = await asHer(req, "GET", "/thank-yous");
  const draft = ((drafts.body && drafts.body.drafts) || []).find(x => x.giftId === g.id);
  let [task] = await query(`SELECT id FROM tasks WHERE org_id=? AND source_gift_id=? AND done=0 AND voided_at IS NULL ORDER BY created_at LIMIT 1`, [orgId, g.id]);
  if (!task) {
    const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [g.donor_id, orgId]);
    const t = await asHer(req, "POST", "/tasks", { title: `Thank ${String((d && d.name) || "them").split(/\s+/)[0]} for the ${(await VM()).cents$(Math.round(Number(g.amount) * 100))} gift`,
      due: orgToday(await orgTz(orgId)), donorId: g.donor_id, type: "thank" });
    if (t.status >= 300 || !t.body || !t.body.id) return { status: 409, error: "task_failed", sentence: "Steward could not ready the thank-you." };
    await run("UPDATE tasks SET source_gift_id=? WHERE id=? AND org_id=?", [g.id, t.body.id, orgId]);
    task = { id: t.body.id };
  }
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [g.donor_id, orgId]);
  const first = String((d && d.name) || "").split(/\s+/)[0];
  const body = draft ? draft.body : `Dear ${first},\n\nThank you for your gift.`;
  const sent = await asHer(req, "POST", `/tasks/${task.id}/thank`, { mode: "send", giftId: g.id, subject: `Thank you, ${first}`, body });
  if (sent.status >= 300) return { status: sent.status, error: "thanks_failed", sentence: (sent.body && (sent.body.sentence || sent.body.error)) || "The thank-you could not be sent." };
  // The thank-you went, so the receipt goes with it (never one without the other's chance).
  const [org] = await query("SELECT receipts_enabled FROM orgs WHERE id=?", [orgId]);
  let receiptSent = false, receiptId = null;
  if (org && org.receipts_enabled) {
    const r = await asHer(req, "POST", `/gifts/${g.id}/receipt`, {});
    if (r.status >= 300) return { status: r.status, error: "receipt_failed", sentence: `The thank-you was sent; the receipt was not: ${(r.body && (r.body.sentence || r.body.error)) || "it could not be issued"}.` };
    // The route answers with the receipt row itself (or { receipt } on a resend).
    const rec = r.body && (r.body.receipt || (r.body.receipt_number ? r.body : null));
    receiptSent = !!(rec && (rec.sent_to || r.body.emailSent));
    receiptId = rec ? rec.id : null;
  }
  return { receiptSent, receiptId, thankYouSent: true, taskId: task.id };
}

// Two things the Agent has no tool for, done on her tap and undone exactly.
async function applyDirect(req, card) {
  const orgId = req.user.orgId;
  if (card.kind === "flag") {
    const [was] = await query("SELECT do_not_email FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [card.donorId, orgId]);
    if (!was) return { status: 404, error: "not_found", sentence: "That person is not on file." };
    await run("UPDATE donors SET do_not_email=?, updated_at=NOW() WHERE id=? AND org_id=?", [card.value !== false, card.donorId, orgId]);
    return { before: { do_not_email: was.do_not_email === true } };
  }
  const [op] = await query(`SELECT id, target_amount FROM opportunities WHERE org_id=? AND donor_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`, [orgId, card.donorId]);
  if (!op) return { status: 409, error: "no_open_ask", sentence: "There is no open ask on file to change. Add one under Asks & pipeline." };
  const r = await asHer(req, "PUT", `/opportunities/${op.id}`, { targetAmount: card.cents / 100 });
  if (r.status >= 300) return { status: r.status, error: "ask_failed", sentence: (r.body && (r.body.sentence || r.body.error)) || "The ask could not be changed." };
  return { before: { target_amount: Number(op.target_amount) }, entityId: op.id };
}

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
      // VOICE-4: through the SAME route the Add Gift form calls, as her, so
      // the gift is everything a hand-entered one is (one gift path, its
      // hooks, the thank-you draft, the header's figures) and nothing more.
      const g = await asHer(req, "POST", `/donors/${card.donorId}/gifts`, { amount: Number(amount), date: today, type: "cash",
        notes: `From Tell Steward: "${String(card.quote).slice(0, 200)}"`,
        ...(card.fundId && (await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [card.fundId, orgId])).length ? { fund_id: card.fundId } : {}),
        idempotencyKey: `voice:${m.id}:${card.id}` });
      if (g.status >= 300 || !g.body || !g.body.gift) return res.status(g.status >= 400 ? g.status : 409).json(g.body || { error: "not_recorded" });
      if (g.body.duplicate) return res.status(409).json({ error: "not_recorded", sentence: "That gift was already recorded." });
      made = { giftId: g.body.gift.id, gift: g.body.gift };
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
    const gift = made.gift; delete made.gift;
    await setCard(orgId, m, card.id, { state: "saved", ...made, by: actor(req).name });
    if (gift) await giftFollowOn(req, await memoRow(orgId, m.id), card, gift, today);
  } else if (card.kind === "thanks") {
    const r = await sendThanks(req, m, card);
    if (r.error) return res.status(r.status || 409).json({ error: r.error, sentence: r.sentence });
    await setCard(orgId, await memoRow(orgId, m.id), card.id, { state: "saved", by: actor(req).name, receiptSent: r.receiptSent, receiptId: r.receiptId, thankYouSent: r.thankYouSent, taskId: r.taskId });
  } else if (card.kind === "flag" || card.kind === "ask") {
    const r = await applyDirect(req, card);
    if (r.error) return res.status(r.status || 409).json({ error: r.error, sentence: r.sentence });
    await setCard(orgId, m, card.id, { state: "saved", by: actor(req).name, before: r.before, entityId: r.entityId || null });
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

// ── VOICE-4 · DO ALL OF THIS ────────────────────────────────────────────────
// One tap does every card that is hers to say yes to, in order (the gift
// before its receipt), each through its own card's yes, and confirms the
// plan she was shown with it. A personal detail and an email draft are never
// part of it: each still takes its own tap.
const ALL_KINDS = ["money", "thanks", "contact", "flag", "ask"];
app.post("/voice/memos/:id/all", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  let m = await memoRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.undone_at) return res.status(409).json({ error: "memo_undone", sentence: "This memo was undone." });
  const failed = [];
  const tried = new Set();
  for (let i = 0; i < 12; i++) {
    const card = (j(m.cards) || []).find(c => c.state === "waiting" && ALL_KINDS.includes(c.kind) && !tried.has(c.id));
    if (!card) break;
    tried.add(card.id);
    const r = await asHer(req, "POST", `/voice/memos/${m.id}/cards/${card.id}/yes`, {});
    if (r.status >= 300) failed.push({ id: card.id, title: card.title, sentence: (r.body && (r.body.sentence || r.body.error)) || "it did not run" });
    m = await memoRow(orgId, m.id);
  }
  let ran = null;
  const insId = req.body && req.body.instructionId ? String(req.body.instructionId) : null;
  if (insId) {
    const r = await asHer(req, "POST", `/agent/instructions/${encodeURIComponent(insId)}/confirm`, {});
    if (r.status < 300 && r.body) {
      ran = r.body;
      if (r.body.runId) await run("UPDATE voice_memos SET run_ids = run_ids || ?::jsonb WHERE id=? AND org_id=?", [JSON.stringify([r.body.runId]), m.id, orgId]);
    } else failed.push({ id: insId, title: "The plan", sentence: (r.body && (r.body.sentence || r.body.error)) || "it did not run" });
  }
  res.json({ memo: await memoOut(orgId, await memoRow(orgId, m.id)), ran, failed });
}));

// A plan that ran on its own (low stakes) or was confirmed beside a memo is
// part of that memo, so the memo's one Undo reaches it too.
app.post("/voice/memos/:id/runs", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const m = await memoRow(orgId, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  const runId = String((req.body && req.body.runId) || "");
  const [r] = runId ? await query("SELECT id FROM agent_runs WHERE id=? AND org_id=?", [runId, orgId]) : [];
  if (!r) return res.status(404).json({ error: "run_not_found" });
  if (!(j(m.run_ids) || []).includes(r.id)) await run("UPDATE voice_memos SET run_ids = run_ids || ?::jsonb WHERE id=? AND org_id=?", [JSON.stringify([r.id]), m.id, orgId]);
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
  // VOICE-4: the one Undo covers the whole memo, her yeses included. The gift
  // she confirmed comes off through the gift's own delete, a changed flag or
  // ask goes back to what it was, and the meeting it marked happened is open
  // again. What was SENT cannot be unsent, and the sentence says so.
  let sentStays = false;
  // The receipt this memo issued is voided first: a gift with an active
  // receipt cannot be deleted, and the receipt was for this memo's gift.
  const savedCards = (j(m.cards) || []).filter(x => x.state === "saved").sort((a, b) => (a.kind === "thanks" ? 0 : 1) - (b.kind === "thanks" ? 0 : 1));
  for (const c of savedCards) {
    let ok = true;
    if (c.kind === "thanks" && c.receiptId) {
      const v = await asHer(req, "POST", `/receipts/${c.receiptId}/void`, { reason: "Undone from Tell Steward" });
      if (v.status >= 300) console.error("[voice] undo: the receipt was not voided:", v.status, JSON.stringify(v.body).slice(0, 200));
    }
    if (c.kind === "money" && c.giftId) {
      const d = await asHer(req, "DELETE", `/gifts/${c.giftId}`);
      ok = d.status < 300;
      if (!ok) console.error("[voice] undo: the gift was not removed:", d.status, JSON.stringify(d.body).slice(0, 200));
    }
    else if (c.kind === "money" && c.pledgeId) ok = (await asHer(req, "DELETE", `/pledges/${c.pledgeId}`)).status < 300;
    else if (c.kind === "flag" && c.before) await run("UPDATE donors SET do_not_email=?, updated_at=NOW() WHERE id=? AND org_id=?", [c.before.do_not_email === true, c.donorId, orgId]);
    else if (c.kind === "ask" && c.before && c.entityId) ok = (await asHer(req, "PUT", `/opportunities/${c.entityId}`, { targetAmount: c.before.target_amount })).status < 300;
    else if (c.kind === "thanks") sentStays = true;
    if (ok && c.kind !== "thanks") undone++; else if (!ok) failed.push(c.kind);
    if (c.kind === "thanks" && (c.closedTaskIds || []).length)
      await run(`UPDATE tasks SET done=0, completed_at=NULL, completed_by_name=NULL, updated_at=NOW() WHERE org_id=? AND id = ANY(?::text[])`, [orgId, c.closedTaskIds]);
  }
  const read = j(m.read) || {};
  if (read.meeting) { await reopenMeeting(orgId, read.meeting); undone++; }
  const cards = (j(m.cards) || []).map(c => (c.state === "waiting" ? { ...c, state: "discarded", quote: c.kind === "sensitive" ? null : c.quote }
    : c.state === "saved" && c.kind !== "thanks" ? { ...c, state: "undone" } : c));
  await run("UPDATE voice_memos SET cards=? WHERE id=? AND org_id=?", [JSON.stringify(cards), m.id, orgId]);
  res.json({ ok: true, undone, failed, memo: await memoOut(orgId, await memoRow(orgId, m.id)),
    sentence: `Undone: ${undone} ${undone === 1 ? "change" : "changes"} taken back.`
      + (sentStays ? " The receipt and thank-you already sent are not taken back." : "") });
}));

// ── VOICE-3 · TALK TO STEWARD ───────────────────────────────────────────────
// One mic for all of it. What happened is filed by fileMemo (above), exactly
// as a memo always was. Something to do goes to the Agent's own route, so it
// comes back as a PLAN that runs only when she presses Confirm
// (/agent/instructions/:id/confirm, her click). A question goes to Ask, which
// reads and writes nothing. A memo that holds more than one is split, and each
// part goes its own way (shared/voiceTalk.js decides, in code first).

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

// A "do" with no memo of its own gets one, so what it did is listed with the
// one Undo like everything else Tell Steward does.
async function memoFor(req, memo, text, source, person, instructionId = null) {
  if (memo && memo.id) return memo.id;
  const id = "vm_" + uuid().slice(0, 10);
  await run(`INSERT INTO voice_memos (id,org_id,text,source,status,ai,donor_ids,read,cards,run_ids,instruction_id,created_by,created_by_name)
             VALUES (?,?,?,?,'done','on',?,?,'[]','[]',?,?,?)`,
    [id, req.user.orgId, text, source, JSON.stringify(person ? [person.id] : []), JSON.stringify({ kind: "do" }), instructionId, actor(req).id, actor(req).name]);
  return id;
}
async function addCards(orgId, memoId, more) {
  const m = await memoRow(orgId, memoId);
  await run("UPDATE voice_memos SET cards=? WHERE id=? AND org_id=?", [JSON.stringify([...(j(m.cards) || []), ...more]), memoId, orgId]);
}
function directCard(d, person) {
  const first = String(person.name || "").split(/\s+/)[0];
  const usd = c => "$" + (c / 100).toLocaleString("en-US");
  return d.kind === "flag"
    ? { id: "vc_" + uuid().slice(0, 8), kind: "flag", field: d.field, value: d.value, donorId: person.id, state: "waiting", title: `Mark ${first} as do not email?` }
    : { id: "vc_" + uuid().slice(0, 8), kind: "ask", cents: d.cents, donorId: person.id, state: "waiting", title: `Change ${first}'s ask to ${usd(d.cents)}?` };
}
async function markReceiptAsked(orgId, memoId) {
  const m = await memoRow(orgId, memoId);
  const read = j(m.read) || {};
  await run("UPDATE voice_memos SET read=? WHERE id=? AND org_id=?", [JSON.stringify({ ...read, receiptAsked: true }), memoId, orgId]);
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

  // DO: the Agent's plan. Low-stakes steps (a group, a journey, a reminder, a
  // tag) run at once and are listed with Undo; anything else waits for her
  // Confirm and writes nothing before it.
  if (parts.do) {
    let doText = parts.do;
    if (!person && donorId) [person] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]);
    const named = await engine().agentNamedIn(orgId, doText, null);
    if (person) {
      // "send her the boat photos", after a memo about Margaret: the plan is on Margaret.
      if (!(named.scope || []).length && !named.ambiguous.length) doText = T.namePronouns(doText, person.name);
    } else if ((named.scope || []).length === 1 && !named.ambiguous.length) {
      [person] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [named.scope[0], orgId]);
    }
    const memoGift = out.memo && (out.memo.waiting || []).find(c => c.kind === "money" && c.moneyKind === "gift");
    const direct = T.directCards(doText);
    if (direct.length && !person) {
      // "Mark her as do not email" with nobody in view: ask who, never a task.
      out.plan = { sentence: "Who is this about? Say their name (\"Mark Margaret Chen as do not email\"), or say it from their profile." };
    } else if (memoGift && T.isReceiptChore(doText) && !T.targetIn(doText)) {
      // "then send her the receipt": readied with the gift, one Confirm for both.
      out.receiptReadied = true;
      await markReceiptAsked(orgId, out.memo.id);
      out.memo = await memoOut(orgId, await memoRow(orgId, out.memo.id));
    } else if (direct.length) {
      const memoId = await memoFor(req, out.memo, doText, source, person);
      await addCards(orgId, memoId, direct.map(d => directCard(d, person)));
      out.memo = await memoOut(orgId, await memoRow(orgId, memoId));
    } else {
      const t = T.targetIn(doText);
      let choose = null;
      if (t) {
        const rows = t.kind === "journey" ? await query("SELECT id, name FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY name", [orgId])
          : t.kind === "event" ? await query("SELECT id, name FROM events WHERE org_id=? ORDER BY date DESC NULLS LAST LIMIT 100", [orgId])
          : await query("SELECT id, name FROM audiences WHERE org_id=? AND kind='static' ORDER BY name", [orgId]);
        const mt = T.matchName(t.heard, rows);
        if (mt.exact) { if (mt.exact.name !== t.heard) doText = doText.replace(t.heard, mt.exact.name); }
        else choose = { kind: t.kind, heard: t.heard, text: doText, options: mt.options.map(o => ({ id: o.id, name: o.name })),
          sentence: `There is no ${t.kind === "event" ? "guest list" : t.kind} called "${t.heard}". Did you mean one of these? Steward never makes a new one without asking.` };
      }
      if (choose) out.plan = { choose };
      else {
        const r = await asHer(req, "POST", "/agent/instructions", { text: doText, ...(req.body.personId ? { personId: String(req.body.personId) } : {}) });
        out.plan = { status: r.status, text: doText, ...(r.body || {}) };
        if (r.status < 300 && r.body && r.body.id && r.body.plan && T.planRunsAlone(r.body.plan)) {
          const c = await asHer(req, "POST", `/agent/instructions/${encodeURIComponent(r.body.id)}/confirm`, {});
          if (!(c.status < 300 && c.body && c.body.runId)) console.error("[voice] low-stakes plan did not run:", c.status, JSON.stringify(c.body).slice(0, 300));
          if (c.status < 300 && c.body && c.body.runId) {
            const memoId = await memoFor(req, out.memo, doText, source, person, r.body.id);
            await run("UPDATE voice_memos SET run_ids = run_ids || ?::jsonb WHERE id=? AND org_id=?", [JSON.stringify([c.body.runId]), memoId, orgId]);
            out.plan = { ...out.plan, ran: c.body, ranAlone: true, memoId };
            out.memo = await memoOut(orgId, await memoRow(orgId, memoId));
          }
        }
      }
    }
  }
  res.status(out.memo ? 201 : 200).json(out);
}));
}

module.exports = { routers, mount };
