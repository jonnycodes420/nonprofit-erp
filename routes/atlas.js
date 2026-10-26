// routes/atlas.js · AGENT-5. ATLAS DOES THE WHOLE JOB, AND LEAVES A NOTE WHERE IT ACTED.
//
// One door for everything she says to Steward (Home's box, the mic, Tell
// Steward): POST /atlas. It
//   READS     her words into steps (shared/atlas.js): the model through the AI
//             switch, or the plain shapes in code with AI off;
//   RESOLVES  every name to a row, in code: people with donorMatch.js plus
//             first names, nicknames, families and near-misses; events,
//             journeys and groups with matchName; amounts and dates in words;
//   ASKS      everything it needs at once ("Which Undine?", "Which journey?"),
//             one click each, and nothing is written before the answers;
//   RUNS      every step for the people she picked. Low-stakes steps run at
//             once, each its own Agent run (so each has its own Undo); money,
//             the receipt and a held-back detail wait as one tap each, on
//             Tell Steward's own cards (/voice/memos/:id/cards/:cardId/yes).
// Each thing it did or readied is one row in atlas_actions: who, what, where,
// Undo. The page notes, the bell, and Recent changes read that table.
//
// THE UNDINE BUG (21 Oct): Home sent her words to the Agent page, which asked
// "which Undine?" and then planned ONLY from the words with the pick, through
// one model call whose plan had no tool for attendance and waited for a
// separate Confirm on a page she had been moved to. Here the request is kept
// with its steps, a pick answers its question, and the run picks up every step.
"use strict";
const express = require("express");
const { anthropicFor, recordAiFallback } = require("../aiClient");
const DM = require("../donorMatch");

const routers = { r0: express.Router() };
const TEXT_MIN = 3, TEXT_MAX = 4000;
// The read is one short structured call; the faster model keeps a request
// like Undine's under ten seconds. ATLAS_MODEL overrides it.
const ATLAS_MODEL = () => process.env.ATLAS_MODEL || "claude-sonnet-4-6";

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, uuid, orgTz, orgToday, agentGate } = ctx;
const app = routers.r0;
const AT = () => import("../shared/atlas.js");
const VM = () => import("../shared/voiceMemo.js");
const AS = () => import("../shared/agentShape.js");
const VT = () => import("../shared/voiceTalk.js");
const engine = () => require("./agent").routers.engine;
const atlasName = () => String(process.env.ATLAS_NAME || "").trim() || "Atlas";
const j = v => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
const first = name => String(name || "").split(/\s+/)[0];

// Her own click on one of Steward's routes, in-process, with her session.
async function asHer(req, method, path, body) {
  const port = process.env.PORT || 3001;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method,
    headers: { "content-type": "application/json", authorization: req.headers.authorization || "" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let out = null; try { out = await r.json(); } catch { out = null; }
  return { status: r.status, body: out };
}

// ── WHO SHE MEANT ───────────────────────────────────────────────────────────
// { state: "matched", id } | { state: "choices", options } | { state: "none" }.
// A whole name goes to donorMatch (same last name, then first name, nickname
// or initial). One word is a first name, a nickname of one, or a last name.
// "the Halvorsens" is a family: their household, or the one record of that
// name. A near miss ("Undine" for Ondine) is offered, never taken.
function lev(a, b) {
  const p = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    let prev = p[0]; p[0] = i;
    for (let k = 1; k <= b.length; k++) { const t = p[k]; p[k] = Math.min(p[k] + 1, p[k - 1] + 1, prev + (a[i - 1] === b[k - 1] ? 0 : 1)); prev = t; }
  }
  return p[b.length];
}
const near = (a, b) => a.length >= 4 && b.length >= 4 && a[0] === b[0] ? lev(a, b) <= (a.length >= 6 ? 2 : 1) : a.length >= 5 && lev(a, b) === 1;
async function people(orgId) {
  return query(`SELECT d.id, d.name, d.household_id, h.name AS household, h.primary_donor_id, d.total_giving
                  FROM donors d LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
                 WHERE d.org_id=? AND d.deleted_at IS NULL AND COALESCE(d.is_sample,false) = false ORDER BY d.total_giving DESC NULLS LAST, d.id LIMIT 20000`, [orgId]);
}
async function resolvePerson(orgId, said, all) {
  const raw = String(said || "").replace(/[’]/g, "'").replace(/'s$/i, "").replace(/^(mr|mrs|ms|dr)\.?\s+/i, "").trim();
  if (!raw) return { state: "none" };
  const fam = raw.match(/^the\s+([a-z'-]+?)(?:e?s)$/i);
  const toks = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const parsed = all.map(p => ({ p, n: DM.parseName(p.name) || { first: "", last: "" } }));
  const opts = list => ({ state: list.length === 1 ? "matched" : list.length ? "choices" : "none", id: list.length === 1 ? list[0].id : null, options: list });
  if (fam) {
    const last = fam[1].toLowerCase();
    const kin = parsed.filter(x => x.n.last === last || x.n.last === last + "s").map(x => x.p);
    const hh = new Set(kin.map(p => p.household_id).filter(Boolean));
    if (hh.size === 1 && kin.every(p => p.household_id)) {
      const h = kin[0];
      return { state: "matched", id: h.primary_donor_id && kin.some(p => p.id === h.primary_donor_id) ? h.primary_donor_id : kin[0].id, family: h.household };
    }
    return opts(kin);
  }
  if (toks.length >= 2) {
    const m = await DM.matchDonor(orgId, { name: raw });
    if (m.state === "matched") return { state: "matched", id: m.selectedId };
    if (m.state === "choices") return { state: "choices", options: m.choices.map(c => all.find(p => p.id === c.id) || { id: c.id, name: c.name }) };
    // A typo in either half: first and last each within a letter or two.
    const [f, l] = [toks[0], toks[toks.length - 1]];
    const close = parsed.filter(x => (x.n.first === f || DM.sameFirst(f, x.n.first) || near(f, x.n.first)) && (x.n.last === l || near(l, x.n.last))).map(x => x.p);
    return { ...opts(close), ...(close.length === 1 ? { state: "choices", id: null } : {}), near: true };
  }
  const w = toks[0];
  const byFirst = parsed.filter(x => x.n.first === w).map(x => x.p);
  if (byFirst.length) return opts(byFirst);
  const byNick = parsed.filter(x => x.n.first && DM.sameFirst(w, x.n.first)).map(x => x.p);
  if (byNick.length) return opts(byNick);
  const byLast = parsed.filter(x => x.n.last === w).map(x => x.p);
  if (byLast.length) return opts(byLast);
  const close = parsed.filter(x => near(w, x.n.first) || near(w, x.n.last)).map(x => x.p);
  // A near miss is always a question, even when only one record is close.
  return close.length ? { state: "choices", options: close, near: true } : { state: "none" };
}

// What tells two people apart: their email, last gift, and when last in touch.
async function personOptions(orgId, list, today) {
  const ids = list.slice(0, 8).map(p => p.id);
  const rows = ids.length ? await query(`SELECT id, name, email, last_gift_amount, last_gift_date, city FROM donors WHERE org_id=? AND id = ANY(?::text[])`, [orgId, ids]) : [];
  const AT_ = await AT();
  return ids.map(id => rows.find(r => r.id === id)).filter(Boolean).map(r => ({ id: r.id, name: r.name,
    detail: [r.city, r.email, Number(r.last_gift_amount) > 0 ? `last gift ${AT_.usd(Math.round(Number(r.last_gift_amount) * 100))}, ${AT_.dayWords(String(r.last_gift_date).slice(0, 10), today)}` : "no gifts yet"].filter(Boolean).join(" · ") }));
}

// ── WHERE IT HAPPENED: EVENTS, JOURNEYS, GROUPS ─────────────────────────────
const TARGET_SQL = {
  event: "SELECT id, name, LEFT(date::text,10) AS date FROM events WHERE org_id=? ORDER BY date DESC NULLS LAST LIMIT 200",
  journey: "SELECT id, name FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY name",
  group: "SELECT id, name FROM audiences WHERE org_id=? AND kind='static' ORDER BY name",
};
async function resolveTarget(orgId, kind, heard, today) {
  const T = await VT();
  const rows = await query(TARGET_SQL[kind], [orgId]);
  const clean = String(heard || "").replace(/\b(event|journey|group|list|guest list|the|our)\b/gi, " ").replace(/\b(donors|gifts|givers)\b/gi, m => m.slice(0, -1)).replace(/\s+/g, " ").trim();
  if (!clean) return { state: "choices", options: rows.slice(0, 4) };
  // "Harbor Run" when there is a Harbor Run each year: the latest one that has happened.
  if (kind === "event") {
    const words = clean.toLowerCase().split(" ");
    const all = rows.filter(r => words.every(w => ` ${String(r.name).toLowerCase()} `.includes(` ${w} `) || String(r.name).toLowerCase().includes(w)));
    if (all.length > 1) { const past = all.filter(r => !r.date || r.date <= today); return { state: "matched", row: past[0] || all[all.length - 1] }; }
  }
  const m = T.matchName(clean, rows);
  if (m.exact) return { state: "matched", row: m.exact };
  // A singular or plural apart ("major donors" for Major donor).
  const sing = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").map(w => w.replace(/s$/, "")).join(" ");
  const one = rows.filter(r => sing(r.name) === sing(clean));
  if (one.length === 1) return { state: "matched", row: one[0] };
  return { state: "choices", options: m.options };
}

// ── THE ACTIVITY LOG: WHO, WHAT, WHERE, UNDO ────────────────────────────────
async function logAction(req, a) {
  const id = "aa_" + uuid().slice(0, 12);
  const who = actor(req);
  await run(`INSERT INTO atlas_actions (id,org_id,request_id,card_id,run_id,kind,state,line,donor_id,place,place_id,link,waits,undoable,actor_id,actor_name,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, a.requestId || null, a.cardId || null, a.runId || null, a.kind, a.state, String(a.line).slice(0, 400),
     a.donorId || null, a.place || null, a.placeId || null, JSON.stringify(a.link || null), !!a.waits, !!a.undoable,
     "system:atlas", atlasName(), who.id, who.name]);
  return id;
}
function actionOut(r) {
  return { id: r.id, requestId: r.request_id, kind: r.kind, state: r.state, line: r.line, donorId: r.donor_id, place: r.place, placeId: r.place_id,
    link: j(r.link), waits: r.waits === true && r.state === "waiting", undoable: r.undoable === true && r.state === "done", by: r.actor_name,
    forName: r.created_by_name, at: r.created_at, seenAt: r.seen_at };
}
async function requestOut(orgId, id) {
  const [m] = await query("SELECT * FROM voice_memos WHERE id=? AND org_id=?", [id, orgId]);
  if (!m) return null;
  const rows = await query("SELECT * FROM atlas_actions WHERE org_id=? AND request_id=? ORDER BY created_at, id", [orgId, id]);
  const read = j(m.read) || {};
  const lines = rows.map(actionOut);
  const waiting = lines.filter(l => l.waits).length;
  const AT_ = await AT();
  return { id: m.id, text: m.text, status: m.status, ai: m.ai, questions: m.status === "needs_answers" ? (read.atlas && read.atlas.questions) || [] : [],
    lines, waiting, spoke: m.status === "needs_answers" ? (read.atlas && read.atlas.spoke) || "" : (read.atlas && read.atlas.spoke) || (waiting ? `${AT_.SPOKE.done} ${AT_.SPOKE.waiting(waiting)}` : AT_.SPOKE.done),
    timings: read.atlas && read.atlas.timings, undoneAt: m.undone_at };
}

// ── READ, RESOLVE, ASK ──────────────────────────────────────────────────────
const PRONOUN = /^(she|her|he|him|they|them|hers|his|their)$/i;
const NEEDS_PERSON = new Set(["came_to_event", "register_for_event", "gift", "pledge", "add_to_journey", "remove_from_journey", "add_to_group",
  "remove_from_group", "draft_email", "log_conversation", "note", "send_receipt", "send_now", "recurring_change", "personal_detail", "find", "merge"]);
// A reminder may name someone or nobody ("remind me to call Ingrid", "remind me to order shirts").
const MAY_PERSON = new Set(["reminder"]);
const TARGET_KIND = { came_to_event: "event", register_for_event: "event", add_to_journey: "journey", remove_from_journey: "journey", add_to_group: "group", remove_from_group: "group" };

async function readSteps(orgId, text, { today, onPage }) {
  const AT_ = await AT();
  const gate = await agentGate(orgId);
  if (gate.ok) {
    const prompt = AT_.buildAtlasPrompt(text, { today, onPage });
    try {
      const msg = await anthropicFor(orgId).messages.create({
        model: ATLAS_MODEL(), max_tokens: 2000, thinking: { type: "disabled" }, system: prompt.system, messages: prompt.messages,
        tools: [{ name: AT_.ATLAS_TOOL.name, description: AT_.ATLAS_TOOL.description, strict: true, input_schema: AT_.ATLAS_TOOL.input_schema }],
        tool_choice: { type: "tool", name: AT_.ATLAS_TOOL.name },
      });
      const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === AT_.ATLAS_TOOL.name);
      if (use && use.input) {
        const steps = AT_.normalizeRead(use.input, text);
        // A conversation code can read for certain ("lunch with Margaret went
        // well") stays logged when the model dropped it (a "scratch that"
        // after it took back nothing that happened). Never one still ahead.
        const firstOf = w => String(w || "").toLowerCase().split(/\s+/)[0];
        for (const c of AT_.readInCode(text).filter(x => x.kind === "log_conversation").reverse()) {
          const when = AT_.whenFromWords(c.whenWords, today);
          if (when && when.date > today) continue;
          if (!steps.some(x => x.kind === "log_conversation" && firstOf(x.who) === firstOf(c.who))) steps.unshift(c);
        }
        return { ai: "on", steps };
      }
    } catch (e) {
      console.error("[atlas] read failed:", e && e.status ? e.status : "", String(e && e.message || e).slice(0, 160));
      await recordAiFallback(orgId, "atlas", e).catch(() => {});
    }
    return { ai: "failed", steps: AT_.readInCode(text) };
  }
  return { ai: "off", steps: AT_.readInCode(text) };
}

// The email's words: the model when AI is on, else the template. Never a
// fact: the run's own check refuses a draft that states one she did not say.
async function writeDraft(orgId, { firstName, words, month, thanks, meet }) {
  const AT_ = await AT();
  const template = { subject: thanks ? `Thank you, ${firstName}` : `Hello from us, ${firstName}`,
    body: [`Dear ${firstName},`, "", thanks ? "Thank you so much for your generosity. It means a great deal to all of us." : "I wanted to reach out.",
      ...(meet ? ["", `I would love to meet${month ? ` in ${month}` : ""} to share what your support makes possible. Would that work for you?`] : []), "", "With gratitude,"].join("\n") };
  const gate = await agentGate(orgId);
  if (!gate.ok) return template;
  try {
    const prompt = AT_.buildDraftPrompt({ firstName, words, month });
    const msg = await anthropicFor(orgId).messages.create({ model: ATLAS_MODEL(), max_tokens: 400, thinking: { type: "disabled" }, system: prompt.system, messages: prompt.messages,
      tools: [{ name: AT_.DRAFT_TOOL.name, description: AT_.DRAFT_TOOL.description, strict: true, input_schema: AT_.DRAFT_TOOL.input_schema }],
      tool_choice: { type: "tool", name: AT_.DRAFT_TOOL.name } });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === AT_.DRAFT_TOOL.name);
    const out = use && use.input;
    // The month she asked to meet in must be in it; otherwise the template is.
    if (out && out.body && out.subject && (!meet || !month || out.body.includes(month))) return { subject: String(out.subject).slice(0, 200), body: String(out.body).replace(/\s+—\s+|—/g, ", ").slice(0, 4000) };
  } catch (e) {
    console.error("[atlas] draft failed:", e && e.status ? e.status : "", String(e && e.message || e).slice(0, 160));
    await recordAiFallback(orgId, "atlas.draft", e).catch(() => {});
  }
  return template;
}

// Every name and place in the steps, resolved; the questions it leaves.
async function resolveAll(orgId, steps, { today, onPage, answers = {} }) {
  const all = await people(orgId);
  let lastWho = onPage ? onPage.name : "";
  const whoCache = new Map();
  const questions = [];
  const ask = (q) => { if (!questions.some(x => x.id === q.id)) questions.push(q); };
  for (const [i, st] of steps.entries()) {
    if (NEEDS_PERSON.has(st.kind) || (MAY_PERSON.has(st.kind) && st.who)) {
      if (!st.who || PRONOUN.test(st.who)) st.who = lastWho || st.who;
      if (st.who && !PRONOUN.test(st.who)) lastWho = st.who;
      const key = String(st.who || "").toLowerCase();
      if (key && !PRONOUN.test(key)) {
        if (!whoCache.has(key)) {
          let r = onPage && (key === onPage.name.toLowerCase() || key === first(onPage.name).toLowerCase()) ? { state: "matched", id: onPage.id } : await resolvePerson(orgId, st.who, all);
          // The person she is on answers "which Margaret?" for the name that matches them.
          if (r.state === "choices" && onPage && r.options.some(o => o.id === onPage.id)) r = { state: "matched", id: onPage.id };
          whoCache.set(key, r);
        }
        const r = whoCache.get(key);
        const qid = `p:${key}`;
        if (r.state === "matched") st.donorId = r.id;
        else if (r.state === "choices") {
          if (answers[qid] && r.options.some(o => o.id === answers[qid])) st.donorId = answers[qid];
          else ask({ id: qid, kind: "person", said: st.who, sentence: `Which ${st.who}?`, options: await personOptions(orgId, r.options, today),
            more: Math.max(0, r.options.length - 8), nearMiss: !!r.near });
        } else st.notFound = true;
      } else st.noWho = true;
      if (st.kind === "merge" && st.target) {
        const r2 = await resolvePerson(orgId, st.target, all);
        if (r2.state === "matched") st.otherId = r2.id;
      }
    }
    const tk = TARGET_KIND[st.kind];
    if (tk) {
      const r = await resolveTarget(orgId, tk, st.target, today);
      const qid = `${tk}:${String(st.target || "").toLowerCase()}`;
      if (r.state === "matched") { st.targetId = r.row.id; st.targetName = r.row.name; st.targetDate = r.row.date || null; }
      else if (answers[qid] && r.options.some(o => o.id === answers[qid])) { const o = r.options.find(x => x.id === answers[qid]); st.targetId = o.id; st.targetName = o.name; st.targetDate = o.date || null; }
      else if (r.options && r.options.length) ask({ id: qid, kind: tk, said: st.target, sentence: `Which ${tk}${st.target ? ` did you mean by "${st.target}"` : ""}?`,
        options: r.options.map(o => ({ id: o.id, name: o.name, detail: o.date ? o.date : "" })) });
      else st.targetMissing = true;
    }
    st.index = i;
  }
  return { steps, questions };
}

// ── RUN EVERYTHING ──────────────────────────────────────────────────────────
// One instruction row per request (the runs hang off it), one run per step.
async function runStep(req, m, insId, step) {
  const orgId = req.user.orgId;
  const A = await AS();
  const E = engine();
  const ppl = await E.agentReadPeople(orgId, { ids: [step.donorId, step.otherDonorId].filter(Boolean) });
  const plan = A.compilePlan([step], { people: ppl, reads: "your words" });
  const out = await E.agentRunPlan(orgId, { id: insId, text: m.text, plan, authorization: A.AUTH_DRAFT, grounded: m.text },
    { userId: req.user.userId, auth: req.headers.authorization || null });
  await run("UPDATE voice_memos SET run_ids = run_ids || ?::jsonb WHERE id=? AND org_id=?", [JSON.stringify([out.runId]), m.id, orgId]);
  const o = (out.steps || [])[0] || {};
  return { runId: out.runId, outcome: o.outcome, reason: o.reason, entityId: o.entityId || null, ok: o.outcome === A.OUTCOME_DONE || o.outcome === A.OUTCOME_WAITING };
}

async function addCard(orgId, memoId, card) {
  const [m] = await query("SELECT cards FROM voice_memos WHERE id=? AND org_id=?", [memoId, orgId]);
  await run("UPDATE voice_memos SET cards=? WHERE id=? AND org_id=?", [JSON.stringify([...(j(m.cards) || []), card]), memoId, orgId]);
  return card;
}

async function execute(req, m, steps, { today, ai }) {
  const orgId = req.user.orgId;
  const AT_ = await AT(), V = await VM();
  const clientSafe = await require("../clientSafe").privacyFor(orgId);
  const CS = await import("../shared/clientSafe.js");
  const names = new Map((await query("SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?::text[])",
    [orgId, [...new Set(steps.flatMap(s => [s.donorId, s.otherId]).filter(Boolean))]])).map(r => [r.id, r.name]));
  const nm = id => names.get(id) || "them";
  const insId = "ai_" + uuid().slice(0, 10);
  await run(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,persona,created_by,created_by_name,turned_on_by,turned_on_by_name,turned_on_at)
             VALUES (?,?,?,'task','done','draft','atlas',?,?,?,?,NOW())`, [insId, orgId, m.text, actor(req).id, actor(req).name, actor(req).id, actor(req).name]);
  await run("UPDATE voice_memos SET instruction_id=? WHERE id=? AND org_id=?", [insId, m.id, orgId]);
  const base = { requestId: m.id };
  const cardId = () => "vc_" + uuid().slice(0, 8);
  const log = a => logAction(req, { ...base, ...a });
  const refusedClients = new Set();
  const missing = new Set();
  let giftCard = null;
  const drafted = [];
  const reminders = steps.filter(s => s.kind === "reminder");
  const person = (id, extra = {}) => ({ donorId: id, link: { tab: "donor", donorId: id, ...extra } });
  const heldFor = new Set();   // one held-back card per person and kind of detail
  const holdBack = async (id, words) => {
    const cat = V.sensitiveCategory(words) || "family";
    if (heldFor.has(`${id}:${cat}`)) return;
    heldFor.add(`${id}:${cat}`);
    const c = await addCard(orgId, m.id, { id: cardId(), kind: "sensitive", category: cat, neutral: V.NEUTRAL[cat], quote: words, donorId: id, state: "waiting", title: V.NEUTRAL[cat].replace(/\.$/, "") });
    await log({ kind: "held_back", state: "waiting", waits: true, cardId: c.id, line: `I held back a personal detail about ${first(nm(id))}. Keep it as a note?`, ...person(id), place: "person", placeId: id });
  };

  // Every email starts writing at once, beside the other steps.
  const drafts = new Map();
  for (const st of steps) if ((st.kind === "draft_email" || st.kind === "send_now") && st.donorId && !(clientSafe.on && clientSafe.clientIds.has(st.donorId))) {
    const when = AT_.whenFromWords(st.whenWords, today);
    drafts.set(st, writeDraft(orgId, { firstName: first(nm(st.donorId)), words: st.words, month: when ? AT_.monthWord(when.date) : "",
      thanks: /\bthank/i.test(st.words), meet: /\bmeet|meeting|lunch|coffee|visit|sit down\b/i.test(st.words) }));
  }
  for (const st of steps) {
    const id = st.donorId;
    // A client in privacy mode: nothing about them is written, kept or read.
    if (id && clientSafe.on && clientSafe.clientIds.has(id)) {
      if (!refusedClients.has(id)) { refusedClients.add(id); await log({ kind: "refused", state: "refused", line: AT_.REFUSE.client(nm(id)) }); }
      continue;
    }
    if ((NEEDS_PERSON.has(st.kind) || (MAY_PERSON.has(st.kind) && st.notFound)) && !id) {
      // Somebody not in Steward is said once, however many steps name them.
      const key = String(st.who || "").toLowerCase();
      if (!missing.has(key)) {
        missing.add(key);
        if (st.notFound) await log({ kind: "not_found", state: "refused", line: AT_.REFUSE.not_found(st.who) });
        else if (!["merge"].includes(st.kind)) await log({ kind: "not_found", state: "refused", line: AT_.REFUSE.no_who });
      }
      if (st.kind !== "merge") continue;
    }
    if (TARGET_KIND[st.kind] && !st.targetId) {
      await log({ kind: "not_found", state: "refused", line: `I couldn't find a ${TARGET_KIND[st.kind]} called "${st.target}", so I left that out.` });
      continue;
    }
    const held = V.sensitiveCategory(st.words) && ["note", "log_conversation", "other", "personal_detail"].includes(st.kind);
    if (st.kind === "personal_detail" || (held && st.kind === "note")) { await holdBack(id, st.words); continue; }
    switch (st.kind) {
      case "came_to_event":
      case "register_for_event": {
        const happened = !st.targetDate || st.targetDate <= today;
        // She says they came to an event that is still ahead: it can't be marked yet.
        if (st.kind === "came_to_event" && !happened) {
          await log({ kind: "attended", state: "refused", line: `${st.targetName} is on ${AT_.dayWords(st.targetDate, today)} and hasn't happened yet, so I didn't mark ${first(nm(id))} as attended.`,
            donorId: id, place: "event", placeId: st.targetId, link: { tab: "events", eventId: st.targetId } });
          break;
        }
        const attend = st.kind === "came_to_event";
        const r = await runStep(req, m, insId, { tool: attend ? "mark_attended" : "register_event", donorId: id, eventId: st.targetId, eventName: st.targetName, citesRows: [id] });
        const line = r.ok ? (attend ? `Marked ${nm(id)} as attended at ${st.targetName}.` : `Added ${nm(id)} to the ${st.targetName} guest list.`)
          : `I couldn't ${attend ? "mark" : "add"} ${first(nm(id))} ${attend ? "at" : "to"} ${st.targetName}: ${r.reason || "it did not run"}.`;
        await log({ kind: attend ? "attended" : "registered", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok, line, donorId: id,
          place: "event", placeId: st.targetId, link: { tab: "events", eventId: st.targetId } });
        break;
      }
      case "gift":
      case "pledge": {
        const cents = AT_.amountFromWords(st.amountWords || st.words);
        if (!cents) { await log({ kind: "not_found", state: "refused", line: `I didn't catch the amount ${first(nm(id))} ${st.kind === "gift" ? "gave" : "pledged"}, so I left it for you.` }); break; }
        const c = await addCard(orgId, m.id, { id: cardId(), kind: "money", moneyKind: st.kind, cents, fundId: null, fundName: null, donorId: id, quote: st.words, state: "waiting",
          title: st.kind === "gift" ? `Record a ${AT_.usd(cents)} gift from ${first(nm(id))}?` : `Record a pledge of ${AT_.usd(cents)} from ${first(nm(id))}?` });
        if (st.kind === "gift") giftCard = c;
        await log({ kind: st.kind, state: "waiting", waits: true, cardId: c.id, line: `${AT_.usd(cents)} ${st.kind} from ${nm(id)}: tap to record.`, donorId: id,
          place: "gifts", placeId: id, link: { tab: "donor", donorId: id, section: "giving" } });
        break;
      }
      case "send_receipt": {
        if (!giftCard) { await log({ kind: "not_found", state: "refused", line: "I need the gift first, then the receipt can go. Tell me the amount." }); break; }
        const c = await addCard(orgId, m.id, { id: cardId(), kind: "thanks", afterCard: giftCard.id, giftId: null, donorId: id, cents: giftCard.cents, state: "waiting",
          title: `Send ${first(nm(id))} the receipt and thank-you`, detail: `For the ${AT_.usd(giftCard.cents)} gift, once it is recorded` });
        await log({ kind: "receipt", state: "waiting", waits: true, cardId: c.id, line: `Receipt and thank-you to ${first(nm(id))}: tap to send, after the gift.`, donorId: id,
          place: "gifts", placeId: id, link: { tab: "donor", donorId: id, section: "giving" } });
        break;
      }
      case "send_now":
      case "draft_email": {
        const when = AT_.whenFromWords(st.whenWords, today);
        const meet = /\bmeet|meeting|lunch|coffee|visit|sit down\b/i.test(st.words);
        const thanks = /\bthank/i.test(st.words);
        const month = when ? AT_.monthWord(when.date) : "";
        const fn = first(nm(id));
        const { subject, body } = await drafts.get(st);
        const r = await runStep(req, m, insId, { tool: "draft_note", donorId: id, subject, body, purpose: thanks ? "thank_you" : undefined, citesRows: [id] });
        const what = thanks ? "a thank-you" : "an email";
        if (r.ok && r.entityId) {
          const c = await addCard(orgId, m.id, { id: cardId(), kind: "draft", draftId: r.entityId, donorId: id, title: `Email to ${fn}`, subject, body, state: "waiting" });
          drafted.push({ id, when, meet });
          await log({ kind: "draft", state: "waiting", waits: true, runId: r.runId, cardId: c.id, undoable: false,
            line: `Drafted ${what} to ${fn}${meet ? ` asking to meet${month ? ` in ${month}` : ""}` : ""}. Review and send.`, donorId: id,
            place: "communications", placeId: r.entityId, link: { tab: "communications", draftId: r.entityId, donorId: id } });
        } else await log({ kind: "draft", state: "failed", line: `I couldn't draft ${what} to ${fn}: ${r.reason || "it did not run"}.` });
        if (st.kind === "send_now") await log({ kind: "refused", state: "refused", line: AT_.REFUSE.send_now });
        break;
      }
      case "reminder": {
        const when = AT_.whenFromWords(st.whenWords || st.words, today) || { date: AT_.addDays(today, 7) };
        // Her words without the when ("the first week of January"), and a
        // pronoun said as the person ("thank him" is "Thank Henrik").
        let label = String(st.words || "Follow up").replace(/^remind me (to\s+)?/i, "")
          .replace(/\s*\b((the|in the|by the|on the)\s+)?(in the new year|new year|after thanksgiving|next week|tomorrow|in \w+ (days?|weeks?|months?)|on \w+day|(first week of |early |mid |late |end of )?(january|february|march|april|may|june|july|august|september|october|november|december)( \d+)?)\b.*$/i, "").trim() || "Follow up";
        if (id) label = label.replace(/\b(him|her|them)\b/i, first(nm(id)));
        const lbl = label[0].toUpperCase() + label.slice(1);
        const r = await runStep(req, m, insId, { tool: "create_task", donorId: id || undefined, title: lbl, due: when.date, citesRows: id ? [id] : [] });
        await log({ kind: "reminder", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok, line: r.ok ? `Reminder for ${AT_.dayWords(when.date, today)}: ${lbl.replace(/\.$/, "")}.` : `I couldn't set that reminder: ${r.reason}.`,
          donorId: id || null, place: "tasks", placeId: r.entityId, link: id ? { tab: "donor", donorId: id, section: "thread" } : { tab: "tasks" } });
        break;
      }
      case "add_to_journey":
      case "remove_from_journey": {
        const start = st.kind === "add_to_journey";
        const r = await runStep(req, m, insId, { tool: start ? "start_journey" : "stop_journey", donorId: id, journeyId: st.targetId, journeyName: st.targetName, citesRows: [id] });
        await log({ kind: start ? "journey_added" : "journey_removed", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok,
          line: r.ok ? (start ? `Added ${first(nm(id))} to ${st.targetName}.` : `Took ${first(nm(id))} out of ${st.targetName}.`) : `I couldn't ${start ? "add" : "take"} ${first(nm(id))} ${start ? "to" : "out of"} ${st.targetName}: ${r.reason}.`,
          donorId: id, place: "journey", placeId: st.targetId, link: { tab: "journeys", journeyId: st.targetId } });
        break;
      }
      case "add_to_group":
      case "remove_from_group": {
        const add = st.kind === "add_to_group";
        const r = await runStep(req, m, insId, { tool: add ? "add_to_group" : "remove_from_group", donorId: id, groupId: st.targetId, groupName: st.targetName, citesRows: [id] });
        await log({ kind: add ? "group_added" : "group_removed", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok,
          line: r.ok ? (add ? `Added ${first(nm(id))} to ${st.targetName}.` : `Took ${first(nm(id))} out of ${st.targetName}.`) : `I couldn't change ${st.targetName}: ${r.reason}.`,
          donorId: id, place: "group", placeId: st.targetId, link: { tab: "groups", groupId: st.targetId } });
        break;
      }
      case "log_conversation": {
        const V2 = V.conversationKind(st.how, st.words);
        const when = AT_.whenFromWords(st.whenWords, today);
        const date = when && when.date <= today ? when.date : today;
        const keep = V.stripSensitive(st.words);
        const label = V.HOW_LABEL[V2.how] || "Conversation";
        const r = await runStep(req, m, insId, { tool: "log_conversation", donorId: id, kind: V2.kind, how: V2.how, date, memoId: m.id,
          note: (new RegExp(`^${label}\\b`, "i").test(keep.text) ? keep.text : `${label}. ${keep.text}`).slice(0, 2000), citesRows: [id] });
        await log({ kind: "logged", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok,
          line: r.ok ? `Logged the ${label.toLowerCase()} with ${nm(id)}, ${AT_.dayWords(date, today)}.` : `I couldn't log that: ${r.reason}.`,
          ...person(id, { section: "timeline" }), place: "person", placeId: id });
        for (const h of keep.held) await holdBack(id, h);
        break;
      }
      case "note": {
        const r = await runStep(req, m, insId, { tool: "log_note", donorId: id, note: st.words, citesRows: [id] });
        await log({ kind: "note", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok, line: r.ok ? `Noted on ${nm(id)}: "${String(st.words).slice(0, 80)}".` : `I couldn't save that note: ${r.reason}.`,
          ...person(id, { section: "timeline" }), place: "person", placeId: id });
        break;
      }
      case "merge": {
        if (id && st.otherId && id !== st.otherId) {
          const r = await runStep(req, m, insId, { tool: "propose_merge", donorId: id, otherDonorId: st.otherId, citesRows: [id, st.otherId] });
          await log({ kind: "refused", state: "refused", runId: r.runId, line: r.ok ? AT_.REFUSE.merge : AT_.REFUSE.merge_one, link: { tab: "data-health" }, place: "data_health" });
        } else await log({ kind: "refused", state: "refused", line: AT_.REFUSE.merge_one, link: { tab: "data-health" } });
        break;
      }
      case "recurring_change":
        await log({ kind: "refused", state: "refused", line: AT_.REFUSE.recurring_change(id ? nm(id) : ""), ...(id ? person(id, { section: "giving" }) : {}) });
        break;
      case "find":
        await log({ kind: "found", state: "done", line: `Here's ${nm(id)}.`, ...person(id) });
        break;
      case "question": {
        const r = await asHer(req, "POST", "/ask", { text: st.target || st.words });
        const said = r.status < 300 && r.body && (r.body.sentence || (r.body.answer && r.body.answer.sentence) || r.body.headline);
        await log({ kind: "answer", state: "done", line: said ? String(said) : "I couldn't answer that just now.", link: { tab: "ask", text: st.target || st.words } });
        break;
      }
      case "undo": {
        const [prev] = await query(`SELECT id FROM voice_memos WHERE org_id=? AND created_by=? AND id<>? AND source LIKE 'atlas%' AND undone_at IS NULL AND status='done' ORDER BY created_at DESC LIMIT 1`,
          [orgId, actor(req).id, m.id]);
        if (!prev) { await log({ kind: "undo", state: "refused", line: "There's nothing of mine to undo." }); break; }
        const u = await undoRequest(req, prev.id);
        await log({ kind: "undo", state: "done", line: `Undid ${u.undone} ${u.undone === 1 ? "change" : "changes"} from "${String(u.text).slice(0, 60)}".` });
        break;
      }
      default:
        await log({ kind: "cant", state: "refused", line: ai === "on" ? AT_.CANT_LINE(st.words) : AT_.AI_OFF_LINE });
    }
  }
  // A meeting asked for in the email gets its reminder to book it, on the day.
  for (const d of drafted) {
    if (!d.meet || !d.when || reminders.length) continue;
    const lbl = "Book the meeting";
    const r = await runStep(req, m, insId, { tool: "create_task", donorId: d.id, title: `${lbl} with ${nm(d.id)}`, due: d.when.date, citesRows: [d.id] });
    await log({ kind: "reminder", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok, line: r.ok ? `Reminder for ${AT_.dayWords(d.when.date, today)}: book the meeting.` : `I couldn't set the reminder: ${r.reason}.`,
      donorId: d.id, place: "tasks", placeId: r.entityId, link: { tab: "donor", donorId: d.id, section: "thread" } });
  }
}

// ── THE DOOR ────────────────────────────────────────────────────────────────
app.get("/atlas/status", requireAuth, wrap(async (req, res) => {
  const AT_ = await AT();
  const gate = await agentGate(req.user.orgId);
  res.json({ name: atlasName(), ai: gate.ok ? "on" : "off", reason: gate.ok ? null : gate.reason, rules: AT_.ATLAS_RULES, aiOffLine: gate.ok ? null : AT_.AI_OFF_LINE });
}));

app.post("/atlas", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const t0 = Date.now();
  const orgId = req.user.orgId;
  const text = String((req.body && req.body.text) || "").replace(/\s+/g, " ").trim();
  if (text.length < TEXT_MIN) return res.status(400).json({ error: "empty", sentence: "Tell me what happened, what to do, or what you want to know." });
  if (text.length > TEXT_MAX) return res.status(400).json({ error: "too_long", sentence: "That's too long for me. Say it in a few sentences." });
  const [org] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [orgId]);
  if (org && org.agent_paused_at) return res.status(503).json({ error: "paused", sentence: `${atlasName()} is paused for this organization, so I did nothing.` });
  const today = orgToday(await orgTz(orgId));
  let onPage = null;
  if (req.body.donorId) [onPage] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(req.body.donorId), orgId]);
  const read = await readSteps(orgId, text, { today, onPage: onPage ? onPage.name : null });
  const t1 = Date.now();
  const { steps, questions } = await resolveAll(orgId, read.steps, { today, onPage });
  const id = "vm_" + uuid().slice(0, 10);
  const source = req.body.source === "speech" ? "atlas_speech" : "atlas";
  const spoke = questions.length ? (questions.length === 1 ? "One question first, then I'll do all of it." : `${questions.length} questions first, then I'll do all of it.`) : null;
  await run(`INSERT INTO voice_memos (id,org_id,text,source,status,ai,donor_ids,read,cards,run_ids,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,'[]','[]',?,?)`,
    [id, orgId, text, source, questions.length ? "needs_answers" : "planned", read.ai === "on" ? "on" : "off",
     JSON.stringify([...new Set(steps.map(s => s.donorId).filter(Boolean))]),
     JSON.stringify({ atlas: { steps, questions, spoke, onPage: onPage ? onPage.id : null, timings: { readMs: t1 - t0 } } }), actor(req).id, actor(req).name]);
  if (questions.length) return res.json({ request: await requestOut(orgId, id) });
  const [m] = await query("SELECT * FROM voice_memos WHERE id=? AND org_id=?", [id, orgId]);
  await execute(req, m, steps, { today, ai: read.ai });
  await finishRequest(orgId, id, steps, { readMs: t1 - t0, totalMs: Date.now() - t0 });
  if (req.audit) req.audit.summary(`${atlasName()}: ${steps.length} steps`, { count: steps.length });
  res.status(201).json({ request: await requestOut(orgId, id) });
}));

async function finishRequest(orgId, id, steps, timings) {
  const [m] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [id, orgId]);
  const read = j(m && m.read) || {};
  await run("UPDATE voice_memos SET status='done', donor_ids=?, read=? WHERE id=? AND org_id=?",
    [JSON.stringify([...new Set(steps.map(s => s.donorId).filter(Boolean))]), JSON.stringify({ ...read, atlas: { ...(read.atlas || {}), steps, questions: [], spoke: null, timings } }), id, orgId]);
}

// Her answers: every question at once. Then every step runs.
app.post("/atlas/:id/answer", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const t0 = Date.now();
  const orgId = req.user.orgId;
  const [m] = await query("SELECT * FROM voice_memos WHERE id=? AND org_id=? AND source LIKE 'atlas%'", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.status !== "needs_answers") return res.status(409).json({ error: "already_done", sentence: "I've already done this one." });
  const read = j(m.read) || {};
  const answers = req.body && typeof req.body.answers === "object" && req.body.answers ? req.body.answers : {};
  const today = orgToday(await orgTz(orgId));
  const onPage = read.atlas && read.atlas.onPage ? (await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [read.atlas.onPage, orgId]))[0] : null;
  const fresh = (read.atlas.steps || []).map(s => ({ kind: s.kind, who: s.who, target: s.target, amountWords: s.amountWords, whenWords: s.whenWords, how: s.how,
    words: s.words }));
  const { steps, questions } = await resolveAll(orgId, fresh, { today, onPage, answers });
  if (questions.length) {
    await run("UPDATE voice_memos SET read=? WHERE id=? AND org_id=?", [JSON.stringify({ ...read, atlas: { ...read.atlas, questions } }), m.id, orgId]);
    return res.status(400).json({ error: "unanswered", sentence: "Pick one for each question.", request: await requestOut(orgId, m.id) });
  }
  const took = await run("UPDATE voice_memos SET status='planned' WHERE id=? AND org_id=? AND status='needs_answers'", [m.id, orgId]);
  if (!took || took.changes === 0) return res.status(409).json({ error: "already_done" });
  await execute(req, { ...m, status: "planned" }, steps, { today, ai: m.ai });
  await finishRequest(orgId, m.id, steps, { ...(read.atlas.timings || {}), answerMs: Date.now() - t0 });
  res.status(201).json({ request: await requestOut(orgId, m.id) });
}));

app.get("/atlas/:id", requireAuth, wrap(async (req, res, next) => {
  if (["activity", "notes", "status"].includes(req.params.id)) return next();
  const out = await requestOut(req.user.orgId, req.params.id);
  if (!out) return res.status(404).json({ error: "Not found" });
  res.json({ request: out });
}));

// ── ONE TAP, AND DO ALL OF THIS ─────────────────────────────────────────────
// A tap is her yes on the card behind the line, through Tell Steward's own
// card route (the Add Gift route for money, the receipt route for a receipt).
async function actionRow(orgId, id) { const [a] = await query("SELECT * FROM atlas_actions WHERE id=? AND org_id=?", [id, orgId]); return a || null; }
async function syncFromCards(orgId, requestId) {
  const [m] = await query("SELECT cards FROM voice_memos WHERE id=? AND org_id=?", [requestId, orgId]);
  const cards = j(m && m.cards) || [];
  const AT_ = await AT();
  for (const c of cards) {
    if (c.state === "waiting") continue;
    const state = c.state === "saved" ? "done" : c.state === "discarded" ? "discarded" : c.state;
    const line = c.state === "saved" && c.kind === "money" ? `Recorded the ${AT_.usd(c.cents)} ${c.moneyKind === "pledge" ? "pledge" : "gift"}.`
      : c.state === "saved" && c.kind === "thanks" ? `Sent the receipt and thank-you.` : c.state === "saved" && c.kind === "sensitive" ? "Kept the detail as a note." : null;
    await run(`UPDATE atlas_actions SET state=?, waits=false, undoable=?, line=COALESCE(?, line), updated_at=NOW() WHERE org_id=? AND request_id=? AND card_id=? AND state='waiting'`,
      [state, c.state === "saved" && c.kind === "money", line, orgId, requestId, c.id]);
  }
}
app.post("/atlas/actions/:id/yes", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await actionRow(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  if (a.state !== "waiting" || !a.card_id) return res.status(409).json({ error: "not_waiting", sentence: "This one isn't waiting for you." });
  if (a.kind === "draft") return res.status(400).json({ error: "open_the_draft", sentence: "Open the draft to read it and send it yourself." });
  const r = await asHer(req, "POST", `/voice/memos/${a.request_id}/cards/${a.card_id}/yes`, {});
  if (r.status >= 300) return res.status(r.status).json(r.body || { error: "not_done" });
  await syncFromCards(orgId, a.request_id);
  res.json({ request: await requestOut(orgId, a.request_id) });
}));
app.post("/atlas/actions/:id/no", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await actionRow(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  if (a.state !== "waiting" || !a.card_id) return res.status(409).json({ error: "not_waiting" });
  const r = await asHer(req, "POST", `/voice/memos/${a.request_id}/cards/${a.card_id}/no`, {});
  if (r.status >= 300) return res.status(r.status).json(r.body || { error: "not_done" });
  await syncFromCards(orgId, a.request_id);
  res.json({ request: await requestOut(orgId, a.request_id) });
}));
app.post("/atlas/:id/all", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT id FROM voice_memos WHERE id=? AND org_id=? AND source LIKE 'atlas%'", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  const r = await asHer(req, "POST", `/voice/memos/${m.id}/all`, {});
  await syncFromCards(orgId, m.id);
  res.status(r.status < 300 ? 200 : r.status).json({ request: await requestOut(orgId, m.id), failed: (r.body && r.body.failed) || [] });
}));

// ── UNDO: ONE LINE, OR THE WHOLE REQUEST ────────────────────────────────────
async function undoAction(req, a) {
  const orgId = req.user.orgId;
  const who = actor(req);
  let undone = 0;
  if (a.run_id) {
    const writes = await query("SELECT * FROM agent_writes WHERE org_id=? AND run_id=? AND undone_at IS NULL ORDER BY created_at DESC, id DESC", [orgId, a.run_id]);
    for (const w of writes) {
      const r = await engine().agentUndoWrite(w, orgId);
      if (r.ok) { undone++; await run("UPDATE agent_writes SET undone_at=NOW(), undone_by=?, undone_by_name=? WHERE id=? AND org_id=?", [who.id, who.name, w.id, orgId]); }
    }
  } else if (a.card_id && a.kind === "gift") {
    const [m] = await query("SELECT cards FROM voice_memos WHERE id=? AND org_id=?", [a.request_id, orgId]);
    const c = (j(m.cards) || []).find(x => x.id === a.card_id);
    if (c && c.giftId) { const d = await asHer(req, "DELETE", `/gifts/${c.giftId}`); if (d.status < 300) undone++; }
  }
  await run("UPDATE atlas_actions SET state='undone', undoable=false, undone_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?", [a.id, orgId]);
  return undone;
}
async function undoRequest(req, requestId) {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT id, text FROM voice_memos WHERE id=? AND org_id=?", [requestId, orgId]);
  const rows = await query("SELECT * FROM atlas_actions WHERE org_id=? AND request_id=? AND state='done' AND undoable=true ORDER BY created_at DESC", [orgId, requestId]);
  let undone = 0;
  for (const a of rows) undone += (await undoAction(req, a)) ? 1 : 0;
  await run("UPDATE atlas_actions SET state='discarded', waits=false WHERE org_id=? AND request_id=? AND state='waiting'", [orgId, requestId]);
  await run("UPDATE voice_memos SET undone_at=NOW(), undone_by=?, undone_by_name=?, status='undone' WHERE id=? AND org_id=?", [actor(req).id, actor(req).name, requestId, orgId]);
  return { undone, text: m ? m.text : "" };
}
app.post("/atlas/actions/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const A = await AS();
  const a = await actionRow(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  if (a.state !== "done" || a.undoable !== true) return res.status(409).json({ error: "not_undoable", sentence: "That one can't be undone." });
  if (Date.now() - new Date(a.created_at).getTime() > A.UNDO_DAYS * 86400000) return res.status(409).json({ error: "outside_undo_window" });
  await undoAction(req, a);
  res.json({ ok: true, request: await requestOut(orgId, a.request_id), action: actionOut(await actionRow(orgId, a.id)) });
}));
app.post("/atlas/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT id, undone_at FROM voice_memos WHERE id=? AND org_id=? AND source LIKE 'atlas%'", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.undone_at) return res.status(409).json({ error: "already_undone" });
  const u = await undoRequest(req, m.id);
  res.json({ ok: true, undone: u.undone, request: await requestOut(orgId, m.id) });
}));

// ── THE BELL AND THE NOTES ──────────────────────────────────────────────────
// The bell: everything, newest first; its count is only what waits on a person.
app.get("/atlas/activity", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = await query(`SELECT * FROM atlas_actions WHERE org_id=? ORDER BY created_at DESC, id DESC LIMIT 60`, [orgId]);
  const [n] = await query(`SELECT COUNT(*)::int AS n FROM atlas_actions WHERE org_id=? AND waits=true AND state='waiting'`, [orgId]);
  res.json({ name: atlasName(), waiting: n ? n.n : 0, items: rows.map(actionOut) });
}));
// The notes on one page: what Atlas did there that nobody has seen yet, and
// anything still waiting there. Reading never marks them seen (a GET changes
// nothing); the page posts /atlas/notes/seen once it has shown them.
const PLACES = new Set(["event", "journey", "group", "communications", "gifts", "person", "tasks", "data_health", "home"]);
app.get("/atlas/notes", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const place = String(req.query.place || "");
  if (!PLACES.has(place)) return res.status(400).json({ error: "bad_place" });
  const pid = req.query.id ? String(req.query.id) : null;
  const params = [orgId];
  let where = "org_id=? AND state <> 'undone'";
  if (place === "person") { where += " AND donor_id=?"; params.push(pid); }
  else if (place === "gifts") { where += " AND place='gifts'"; }
  else if (place === "communications") { where += " AND place='communications'"; }
  else if (place === "home") { where += " AND waits=true AND state='waiting'"; }
  else { where += " AND place=?"; params.push(place); if (pid) { where += " AND place_id=?"; params.push(pid); } }
  const rows = await query(`SELECT * FROM atlas_actions WHERE ${where} AND (seen_at IS NULL OR (waits=true AND state='waiting')) ORDER BY created_at DESC LIMIT 20`, params);
  res.json({ name: atlasName(), notes: rows.map(actionOut) });
}));
app.post("/atlas/notes/seen", requireAuth, wrap(async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 50);
  if (ids.length) await run("UPDATE atlas_actions SET seen_at=COALESCE(seen_at, NOW()) WHERE org_id=? AND id = ANY(?::text[])", [req.user.orgId, ids]);
  res.json({ ok: true });
}));
}

module.exports = { routers, mount };
