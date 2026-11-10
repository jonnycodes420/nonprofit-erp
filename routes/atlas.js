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
const { newId } = require("../server/shared/newId");   // IDS-1: every new row id is prefix + 20 hex
const AN = require("../server/atlas/answers");   // ATLAS-3: lists, people, an unrecorded gift, a link
const PG = require("../server/atlas/progress");   // ATLAS-3: the status line, one step at a time
const DS = require("../server/atlas/draftStream");   // SPEED-3: a draft's words as they are written
const GT = require("../server/atlas/givingTotal");   // TRUTH-3: amounts and counts in code, each person resolved
const WT = require("../server/atlas/waiting");   // ATLAS-5: every waiting item can be let go
const ADm = () => import("../shared/atlasDates.js");   // ATLAS-5: dates in code, in the org's day

const routers = { r0: express.Router() };
// ATLAS-3: the profile's Call script rides on Atlas's router (server.js is at its size ceiling).
routers.r0.use(require("./atlasMore").routers.r0);
// Set by mount(); the after-change step settles waiting lines through it.
let settleForDonors = async () => 0;
const TEXT_MIN = 3, TEXT_MAX = 4000;
// The read is one short structured call; the faster model keeps a request
// like Undine's under ten seconds. ATLAS_MODEL overrides it.
const ATLAS_MODEL = () => process.env.ATLAS_MODEL || "claude-sonnet-4-6";
// ATLAS-5 (W-1107-Atlas-23): reading her words into steps is routing, so it goes
// to the smaller, faster model. The draft keeps ATLAS_MODEL. ATLAS_ROUTE_MODEL overrides.
const ATLAS_ROUTE_MODEL = () => process.env.ATLAS_ROUTE_MODEL || "claude-haiku-4-5-20251001";
// The shapes code reads for certain, answered from shared/numbers with no read by
// the model: a person's summary, finding someone, and a question for Ask.
const CODE_SHAPES = new Set(["about", "find", "question", "top100"]);   // TOP100-1: the Top 100 asks
// ATLAS-4 · ATLAS ANSWERS IN GOOD TIME. Feel 1 (Muse): one answer took about
// 60 s. A question goes to /ask, which can ask a model three times in a row
// (the plan, then the query form, then the sentence), each with the SDK's
// ten-minute timeout and two retries. Atlas now gives the read 12 s (then
// reads in code) and a question 20 s, then answers with what it has and where
// the full answer will finish.
const ATLAS_READ_MS = () => Number(process.env.ATLAS_READ_MS) || 12000;
const ATLAS_ANSWER_MS = () => Number(process.env.ATLAS_ANSWER_MS) || 20000;

const PROP = require("../server/atlas/proposal");   // SENDS-1: Atlas proposes, she saves
function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, uuid, orgTz, agentGate } = ctx;
require("./atlasMore").mount({ query, wrap, requireAuth, agentGate });   // ATLAS-3
const app = routers.r0;
const AT = () => import("../shared/atlas.js");
const VM = () => import("../shared/voiceMemo.js");
const AS = () => import("../shared/agentShape.js");
const VT = () => import("../shared/voiceTalk.js");
const engine = () => require("./agent").routers.engine;
const atlasName = () => String(process.env.ATLAS_NAME || "").trim() || "Atlas";
const j = v => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
const first = name => String(name || "").split(/\s+/)[0];
// ATLAS-5: the org's civil today, from its own timezone (shared/atlasDates.js todayIn).
const atlasToday = async (orgId, tz = null) => (await ADm()).todayIn((tz || await orgTz(orgId)).timezone);

// Her own click on one of Steward's routes, in-process, with her session.
async function asHer(req, method, path, body, { signal } = {}) {
  const port = process.env.PORT || 3001;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, signal,
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
  // TRUTH-3: each match says its lifetime (shared/numbers/lifetime.js), so "Which Walter?" tells them apart.
  const rows = ids.length ? await query(`SELECT d.id, d.name, d.email, d.last_gift_amount, d.last_gift_date, d.city, ROUND(${require("../shared/numbers/lifetime").LIFETIME("d")} * 100)::bigint AS life_cents
                                           FROM donors d WHERE d.org_id=? AND d.id = ANY(?::text[])`, [orgId, ids]) : [];
  const AT_ = await AT();
  return ids.map(id => rows.find(r => r.id === id)).filter(Boolean).map(r => ({ id: r.id, name: r.name, lifetimeCents: Number(r.life_cents) || 0,
    detail: [r.city, r.email, Number(r.life_cents) > 0 ? `lifetime ${AT_.usd(Number(r.life_cents))}` : null, Number(r.last_gift_amount) > 0 ? `last gift ${AT_.usd(Math.round(Number(r.last_gift_amount) * 100))}, ${AT_.dayWords(String(r.last_gift_date).slice(0, 10), today)}` : "no gifts yet"].filter(Boolean).join(" · ") }));
}

// ── WHERE IT HAPPENED: EVENTS, JOURNEYS, GROUPS ─────────────────────────────
const TARGET_SQL = {
  event: "SELECT id, name, LEFT(date::text,10) AS date FROM events WHERE org_id=? ORDER BY date DESC NULLS LAST LIMIT 200",
  journey: "SELECT id, name FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY name",
  group: "SELECT id, name FROM audiences WHERE org_id=? AND kind='static' ORDER BY name",
};
async function resolveTarget(orgId, kind, heard, today, ahead = false) {
  const T = await VT();
  const rows = await query(TARGET_SQL[kind], [orgId]);
  const clean = String(heard || "").replace(/\b(event|journey|group|list|guest list|the|our)\b/gi, " ").replace(/\b(donors|gifts|givers)\b/gi, m => m.slice(0, -1)).replace(/\s+/g, " ").trim();
  if (!clean) return { state: "choices", options: rows.slice(0, 4) };
  // "Harbor Run" when there is a Harbor Run each year. FIX-49: someone who
  // went, came or attended was at the latest one that has happened; someone
  // put on a guest list goes to the soonest one still ahead (`ahead`). Rows
  // come newest first.
  if (kind === "event") {
    const words = clean.toLowerCase().split(" ");
    const all = rows.filter(r => words.every(w => ` ${String(r.name).toLowerCase()} `.includes(` ${w} `) || String(r.name).toLowerCase().includes(w)));
    if (all.length > 1) {
      const past = all.filter(r => !r.date || r.date <= today);
      const coming = all.filter(r => r.date && r.date >= today);
      const row = ahead ? coming[coming.length - 1] || past[0] : past[0] || all[all.length - 1];
      return { state: "matched", row };
    }
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
  const id = newId("aa");
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
  const saved = read.answers || {};
  const lines = rows.map(r => ({ ...actionOut(r), ...(saved[r.id] ? { answer: AN.publicAnswer(saved[r.id]) } : {}) }));
  const waiting = lines.filter(l => l.waits).length;
  const AT_ = await AT();
  return { id: m.id, text: m.text, status: m.status, ai: m.ai, questions: m.status === "needs_answers" ? (read.atlas && read.atlas.questions) || [] : [],
    lines, waiting, spoke: m.status === "needs_answers" ? (read.atlas && read.atlas.spoke) || "" : (read.atlas && read.atlas.spoke) || AT_.spokeFor(lines, waiting),   // MONEY-3: "Here's what I found." over an answer
    timings: read.atlas && read.atlas.timings, undoneAt: m.undone_at, follows: (read.atlas && read.atlas.follows) || null,   // ATLAS-3: the request this one followed
    proposal: read.atlas && read.atlas.proposal ? read.atlas.proposal : null };   // SENDS-1: what Save will write, or what it wrote
}

// ── READ, RESOLVE, ASK ──────────────────────────────────────────────────────
const PRONOUN = /^(she|her|he|him|they|them|hers|his|their)$/i;
const NEEDS_PERSON = new Set(["came_to_event", "register_for_event", "gift", "pledge", "add_to_journey", "remove_from_journey", "add_to_group",
  "remove_from_group", "draft_email", "log_conversation", "note", "send_receipt", "send_now", "recurring_change", "personal_detail", "find", "merge", "about", "link"]);
// A reminder may name someone or nobody ("remind me to call Ingrid", "remind me to order shirts").
const MAY_PERSON = new Set(["reminder"]);
const TARGET_KIND = { came_to_event: "event", register_for_event: "event", add_to_journey: "journey", remove_from_journey: "journey", add_to_group: "group", remove_from_group: "group" };

async function readSteps(orgId, text, { today, onPage, gateP = null }) {
  const AT_ = await AT();
  const gate = await (gateP || agentGate(orgId));
  // ATLAS-5: a known shape skips the model's read (each clause read in code, all of them known).
  const inCode = AT_.readInCode(text);
  if (inCode.length && inCode.every(x => CODE_SHAPES.has(x.kind) && (x.kind === "question" || x.kind === "top100" || x.who))) return { ai: gate.ok ? "on" : "off", steps: inCode, code: true };
  if (gate.ok) {
    const prompt = AT_.buildAtlasPrompt(text, { today, onPage });
    try {
      const msg = await anthropicFor(orgId).messages.create({
        model: ATLAS_ROUTE_MODEL(), max_tokens: 2000, thinking: { type: "disabled" }, system: prompt.system, messages: prompt.messages,
        tools: [{ name: AT_.ATLAS_TOOL.name, description: AT_.ATLAS_TOOL.description, strict: true, input_schema: AT_.ATLAS_TOOL.input_schema }],
        tool_choice: { type: "tool", name: AT_.ATLAS_TOOL.name },
      }, { timeout: ATLAS_READ_MS(), maxRetries: 0 });
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
async function writeDraft(orgId, { firstName, opening, words, month, thanks, meet, aboutThem = "", onWords = null, ctx = null }) {
  // SPEED-3: the voice, the switch and the module are read at once, not in turn.
  // ATLAS-5: once per request (ctx), however many emails it drafts.
  const c = ctx || {};
  const [AT_, voice, gate] = await Promise.all([AT(), c.voice || (c.voice = orgVoice(orgId)), c.gate || (c.gate = agentGate(orgId))]);   // ATLAS-3: in the org's voice
  const template = { subject: thanks ? `Thank you, ${firstName}` : `Hello from us, ${firstName}`,
    body: [opening || `Dear ${firstName},`, "", thanks ? "Thank you so much for your generosity. It means a great deal to all of us." : "I wanted to reach out.",
      ...(meet ? ["", `I would love to meet${month ? ` in ${month}` : ""} to share what your support makes possible. Would that work for you?`] : []), "", `${voice.signoff || "With gratitude"},`, ...(voice.signature ? [voice.signature] : [])].join("\n") };
  if (!gate.ok) return template;
  try {
    const prompt = AT_.buildDraftPrompt({ firstName, words, month, aboutThem, signoff: voice.signoff || "" });
    const args = { model: ATLAS_MODEL(), max_tokens: 400, thinking: { type: "disabled" }, system: prompt.system, messages: prompt.messages,
      tools: [{ name: AT_.DRAFT_TOOL.name, description: AT_.DRAFT_TOOL.description, strict: true, input_schema: AT_.DRAFT_TOOL.input_schema }],
      tool_choice: { type: "tool", name: AT_.DRAFT_TOOL.name } };
    const timeout = Math.max(5000, ATLAS_ANSWER_MS() - 5000);   // ATLAS-4: the template past 15 s
    // SPEED-3: streamed, so her first words show while the rest is written. The same call and answer.
    const msg = onWords ? await DS.streamTool(anthropicFor(orgId), args, { timeout, onWords })
      : await anthropicFor(orgId).messages.create(args, { timeout, maxRetries: 0 });
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

// ATLAS-3: the greeting and sign-off the org taught Steward (Settings, its
// writing samples; shared/draftNote.js voiceFrom). Not ready: none.
async function orgVoice(orgId) {
  const [o] = await query("SELECT voice_samples FROM orgs WHERE id=?", [orgId]);
  let s = o && o.voice_samples;
  if (typeof s === "string") { try { s = JSON.parse(s || "[]"); } catch { s = []; } }
  const D = await import("../shared/draftNote.js");
  const v = D.voiceFrom(Array.isArray(s) ? s : []);
  return v.ready ? v : { signoff: null, signature: null };
}

// Every name and place in the steps, resolved; the questions it leaves.
async function resolveAll(orgId, steps, { today, onPage, answers = {}, all: allP = null }) {
  const all = await (allP || people(orgId));   // SPEED-3: POST /atlas reads them beside the model
  let lastWho = onPage ? onPage.name : "";
  const whoCache = new Map();
  const questions = [];
  const ask = (q) => { if (!questions.some(x => x.id === q.id)) questions.push(q); };
  for (const [i, st] of steps.entries()) {
    // TRUTH-3: each name in a giving question is its own person. A name that
    // matches several people asks "Which Walter?" with each one's lifetime;
    // it never adds them together.
    if (st.kind === "giving_total") {
      st.donorIds = []; st.missing = [];
      for (const who of st.whos || []) {
        const key = String(who).toLowerCase();
        if (!whoCache.has(key)) whoCache.set(key, onPage && (key === onPage.name.toLowerCase() || key === first(onPage.name).toLowerCase()) ? { state: "matched", id: onPage.id } : await resolvePerson(orgId, who, all));
        const r = whoCache.get(key), qid = `p:${key}`;
        if (r.state === "matched") st.donorIds.push(r.id);
        else if (r.state === "choices") {
          if (answers[qid] && r.options.some(o => o.id === answers[qid])) st.donorIds.push(answers[qid]);
          else ask({ id: qid, kind: "person", said: who, sentence: `Which ${who}?`, options: await personOptions(orgId, r.options, today),
            more: Math.max(0, r.options.length - 8), nearMiss: !!r.near });
        } else st.missing.push(who);
      }
      st.donorIds = [...new Set(st.donorIds)];
      st.index = i;
      continue;
    }
    // ATLAS-3: "link Stephen and Margaret" is two people related, never a merge,
    // whatever the read said. A merge is only ever her word for one.
    if (st.kind === "merge" && !/\b(merge|combine|duplicates?|same person)\b/i.test(st.words) && /\b(link|connect|related|married|spouses?|partners?)\b/i.test(st.words)) st.kind = "link";
    // ATLAS-3: "remind me to call her" names the person she was just talking about.
    if (MAY_PERSON.has(st.kind) && !st.who && lastWho && /\b(her|him|them|she|he|they)\b/i.test(st.words)) st.who = lastWho;
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
      if ((st.kind === "merge" || st.kind === "link") && st.target) {
        const r2 = await resolvePerson(orgId, st.target, all);
        if (r2.state === "matched") st.otherId = r2.id;
        // ATLAS-3: "which Margaret?" for the second person of a link, asked like the first.
        else if (st.kind === "link" && r2.state === "choices") {
          const q2 = `p:${String(st.target).toLowerCase()}`;
          if (answers[q2] && r2.options.some(o => o.id === answers[q2])) st.otherId = answers[q2];
          else ask({ id: q2, kind: "person", said: st.target, sentence: `Which ${st.target}?`, options: await personOptions(orgId, r2.options, today), more: Math.max(0, r2.options.length - 8), nearMiss: !!r2.near });
        }
      }
      // ATLAS-3: the relation, from her words; when they don't say, one click.
      if (st.kind === "link") {
        st.relation = AN.linkKind(st.words);
        const q3 = `rel:${String(st.who).toLowerCase()}:${String(st.target).toLowerCase()}`;
        if (!st.relation && answers[q3] && AN.LINK_WORD[answers[q3]]) st.relation = answers[q3];
        else if (!st.relation && st.target) ask({ id: q3, kind: "relation", said: st.words, sentence: `How are ${st.who} and ${st.target} related?`,
          options: AN.LINK_CHOICES.map(([id, name, detail]) => ({ id, name, detail })) });
      }
    }
    const tk = TARGET_KIND[st.kind];
    if (tk) {
      const r = await resolveTarget(orgId, tk, st.target, today, st.kind === "register_for_event");
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

// ATLAS-3: what a line answered (a list, a person), kept with the request.
async function saveAnswer(orgId, memoId, actionId, answer) {
  const [x] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [memoId, orgId]);
  const read = j(x && x.read) || {};
  read.answers = { ...(read.answers || {}), [actionId]: answer };
  await run("UPDATE voice_memos SET read=? WHERE id=? AND org_id=?", [JSON.stringify(read), memoId, orgId]);
}

async function execute(req, m, steps, { today, ai, prior = null }) {
  const orgId = req.user.orgId;
  // SPEED-3: what execute needs before its first step is read at once, not in turn.
  const [AT_, V, AN4, clientSafe, CS, nameRows] = await Promise.all([AT(), VM(), import("../shared/atlasNote.js"), require("../clientSafe").privacyFor(orgId),
    import("../shared/clientSafe.js"), query("SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?::text[])",
      [orgId, [...new Set(steps.flatMap(s => [s.donorId, s.otherId]).filter(Boolean))]])]);
  { // ATLAS-4: a labelled line kept in a conversation's note ("Notes: …") is not a step of its own.
    // ATLAS-5: nor is a trailing line kept in a note ("QA A5"): the whole message is the note.
    for (const x of steps) if (x.kind === "note") x.noteText = AN4.noteText(m.text, x);
    const notes = steps.map(x => (x.kind === "log_conversation" ? AN4.conversationNote(m.text, x) : x.kind === "note" ? x.noteText : "")).filter(Boolean).map(n => n.toLowerCase());
    const inNote = x => x.words && notes.some(n => n.includes(String(x.words).toLowerCase().replace(/[.!?;]+$/, "")));
    steps = steps.filter(x => !(["other", "question"].includes(x.kind) && inNote(x)));
    // A second note whose words the first one already holds is the same note.
    const kept = [];
    steps = steps.filter(x => { if (x.kind !== "note") return true; const dup = kept.some(n => n.includes(String(x.words || "").toLowerCase().replace(/[.!?;]+$/, ""))); if (!dup) kept.push(x.noteText.toLowerCase()); return !dup; });
    // ATLAS-5 (W-1108-Atlas-02X): one answer per person, however many times the read asked.
    const seen = new Set();
    steps = steps.filter(x => x.kind !== "about" || !x.donorId || (!seen.has(x.donorId) && seen.add(x.donorId)));
  }
  const names = new Map(nameRows.map(r => [r.id, r.name]));
  const nm = id => names.get(id) || "them";
  const insId = newId("ai");
  const base = { requestId: m.id };
  // ACCESS-1: a viewer's Atlas answers questions and does nothing else. The
  // steps that would log, draft or change are said once and left out, before
  // any of them starts (the server refuses their writes too, in auth.js).
  if (req.user.role === "viewer") {
    const VO = await import("../shared/viewOnly.js");
    const kept = steps.filter(x => VO.ATLAS_READ_KINDS.has(x.kind));
    if (kept.length < steps.length) await logAction(req, { ...base, kind: "refused", state: "refused", line: VO.VIEWER_ATLAS_SENTENCE });
    steps = kept;
  }
  const cardId = () => newId("vc");
  const log = a => logAction(req, { ...base, ...a });
  const refusedClients = new Set();
  const missing = new Set();
  let giftCard = null;
  const propose = [];       // SENDS-1: what Save will write
  let signature = null;
  const person = (id, extra = {}) => ({ donorId: id, link: { tab: "donor", donorId: id, ...extra } });
  const heldFor = new Set();   // one held-back card per person and kind of detail
  const holdBack = async (id, words) => {
    const cat = V.sensitiveCategory(words) || "family";
    if (heldFor.has(`${id}:${cat}`)) return;
    heldFor.add(`${id}:${cat}`);
    const c = await addCard(orgId, m.id, { id: cardId(), kind: "sensitive", category: cat, neutral: V.NEUTRAL[cat], quote: words, donorId: id, state: "waiting", title: V.NEUTRAL[cat].replace(/\.$/, "") });
    await log({ kind: "held_back", state: "waiting", waits: true, cardId: c.id, line: `I held back a personal detail about ${first(nm(id))}. Keep it as a note?`, ...person(id), place: "person", placeId: id });
  };

  // ATLAS-3: a thank-you for an amount she named that is not on record (and
  // not in this request) waits for the gift first; no email is written for it.
  // SPEED-3: each person's check at once.
  await Promise.all(steps.filter(st => (st.kind === "draft_email" || st.kind === "send_now") && st.donorId && !steps.some(x => ["gift", "pledge"].includes(x.kind) && x.donorId === st.donorId))
    .map(async st => { st.unrecorded = await AN.unrecordedAmount({ query, orgId, donorId: st.donorId, words: st.words, amountFromWords: AT_.amountFromWords }); }));
  const say = PG.sayer(req, steps.length);
  // Every email starts writing at once, beside the other steps, before
  // anything else is written (SPEED-3: the draft is the slowest call Atlas makes).
  // Its words show on the status line as they come, the first unfinished email's.
  const drafts = new Map();
  const shown = [];
  const showNext = () => { const nx = shown.find(x => !x.done); if (nx && nx.words) PG.words(req, nx.words); };
  for (const st of steps) if ((st.kind === "draft_email" || st.kind === "send_now") && st.donorId && !st.unrecorded && !(clientSafe.on && clientSafe.clientIds.has(st.donorId))) {
    const when = AT_.whenFromWords(st.whenWords, today);
    const me = { done: false, words: "" };
    shown.push(me);
    const onWords = w => { me.words = w; if (shown.find(x => !x.done) === me) PG.words(req, w); };
    drafts.set(st, (async () => {
      const [[ab], G] = await Promise.all([query("SELECT about_them FROM donors WHERE id=? AND org_id=?", [st.donorId, orgId]), import("../shared/greeting.js")]);
      return writeDraft(orgId, { aboutThem: (ab && ab.about_them) || "", firstName: first(nm(st.donorId)), opening: G.greetingLine({ name: nm(st.donorId) }), words: st.words, month: when ? AT_.monthWord(when.date) : "",
        thanks: /\bthank/i.test(st.words), meet: /\bmeet|meeting|lunch|coffee|visit|sit down\b/i.test(st.words), onWords, ctx: req.atlasCtx || (req.atlasCtx = {}) });
    })().finally(() => { me.done = true; showNext(); }));
    drafts.get(st).catch(() => {});   // awaited at its step; never an unhandled rejection before then
  }
  await Promise.all([
    run(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,persona,created_by,created_by_name,turned_on_by,turned_on_by_name,turned_on_at)
             VALUES (?,?,?,'task','done','draft','atlas',?,?,?,?,NOW())`, [insId, orgId, m.text, actor(req).id, actor(req).name, actor(req).id, actor(req).name]),
    run("UPDATE voice_memos SET instruction_id=? WHERE id=? AND org_id=?", [insId, m.id, orgId]),
  ]);
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
    say(st, id ? nm(id) : "");
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
        if (st.unrecorded) {
          const c = await addCard(orgId, m.id, { id: cardId(), kind: "money", moneyKind: "gift", cents: st.unrecorded, fundId: null, fundName: null, donorId: id, quote: st.words, state: "waiting",
            title: `Record a ${AT_.usd(st.unrecorded)} gift from ${fn}?` });
          giftCard = c;
          await log({ kind: "gift", state: "waiting", waits: true, cardId: c.id, line: AN.recordFirstLine(AT_.usd(st.unrecorded), nm(id)), donorId: id,
            place: "gifts", placeId: id, link: { tab: "donor", donorId: id, section: "giving" } });
          break;
        }
        const { subject, body } = await drafts.get(st);
        // SENDS-1: proposed, signed, written only on Save. The email is the draft alone; "remind me" is her tick.
        if (signature == null) signature = await PROP.signatureFor(orgId, req.user.userId).catch(() => "");
        propose.push({ pid: newId("pi"), kind: "draft", donorId: id, name: nm(id), subject, body: PROP.withSignature(body, signature), thanks, meet, month,
          remindMe: false, remindDue: when ? when.date : AT_.addDays(today, 7), remindTitle: meet ? `Book the meeting with ${nm(id)}` : `Follow up with ${nm(id)} about the email` });
        if (st.kind === "send_now") await log({ kind: "refused", state: "refused", line: AT_.REFUSE.send_now });
        break;
      }
      case "reminder": {
        const when = AT_.whenFromWords(st.whenWords || st.words, today) || AT_.whenFromWords(st.words, today) || { date: AT_.addDays(today, 7) };
        // Her words without the when ("the first week of January"), and a
        // pronoun said as the person ("thank him" is "Thank Henrik").
        // ATLAS-5: the words that named the day come out wherever they sit ("Remind me next Tuesday to call Sterling").
        const said = when.said ? new RegExp(`\\s*\\b${String(when.said).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s*`, "i") : null;
        let label = String(st.words || "Follow up").replace(said || /$^/, " ").replace(/\s+/g, " ").trim().replace(/^(remind me\s+)?(to\s+)?/i, "")
          .replace(/\s*\b((the|in the|by the|on the|in|by|on)\s+)?(in the new year|new year|after thanksgiving|next week|tomorrow|in \w+ (days?|weeks?|months?)|on \w+day|(first week of |early |mid |late |end of )?(january|february|march|april|may|june|july|august|september|october|november|december)( \d+)?)\b.*$/i, "").trim() || "Follow up";
        if (id) label = label.replace(/\b(him|her|them)\b/i, first(nm(id)));
        const lbl = label[0].toUpperCase() + label.slice(1);
        propose.push({ pid: newId("pi"), kind: "follow_up", donorId: id || null, name: id ? nm(id) : null, title: lbl, due: when.date });   // SENDS-1
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
        // ATLAS-4: the note is her words as typed, labels and all (shared/atlasNote.js).
        const keep = V.stripSensitive((await import("../shared/atlasNote.js")).conversationNote(m.text, st));
        const label = V.HOW_LABEL[V2.how] || "Conversation";
        // SENDS-1: proposed; logged only on Save.
        propose.push({ pid: newId("pi"), kind: "call", donorId: id, name: nm(id), label, how: V2.how, convKind: V2.kind, date,
          note: (new RegExp(`\\b${label}\\b`, "i").test(keep.text) || /\b(call|lunch|coffee|meeting|visit|tour|dinner|breakfast|met|spoke|talked)\b/i.test(keep.text) ? keep.text : `${label}. ${keep.text}`).slice(0, 2000) });
        for (const h of keep.held) await holdBack(id, h);
        break;
      }
      case "note": {
        propose.push({ pid: newId("pi"), kind: "note", donorId: id, name: nm(id), note: String(st.noteText || st.words || "") });   // SENDS-1; ATLAS-5: her whole message
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
      case "giving_total": {
        // TRUTH-3: every figure from shared/numbers, the sum in code.
        const ppl = await GT.figuresFor(query, orgId, st.donorIds || []);
        const miss = (st.missing || []).length ? ` I couldn't find ${st.missing.join(" or ")} in Steward, so ${st.missing.length === 1 ? "that name is" : "those names are"} not in it.` : "";
        const ans = ppl.length ? GT.answerFor(ppl, { together: /\btogether|combined|between them\b/i.test(st.words || "") }) : null;
        await log({ kind: "answer", state: "done", line: ans ? ans.sentence + miss : `I couldn't find ${(st.whos || []).join(" or ") || "them"} in Steward.`,
          ...(ppl.length === 1 ? person(ppl[0].id, { section: "giving" }) : {}) });
        break;
      }
      case "top100": await log(await require("../server/majorGifts/top100Atlas").answer({ req, query, step: st, today, top100Rows: require("../server/majorGifts/top100").top100Rows })); break;   // TOP100-1
      case "about": {
        // ATLAS-3: what Steward knows about them, not only their numbers.
        const pa = await AN.personAnswer({ query, orgId, donorId: id, today });
        const aid = await log({ kind: "answer", state: "done", line: pa ? pa.spoke : `I couldn't read ${nm(id)}'s record just now.`, ...person(id) });
        if (pa) await saveAnswer(orgId, m.id, aid, { type: "person", ...pa });
        break;
      }
      case "link": {
        if (!st.otherId) { await log({ kind: "not_found", state: "refused", line: st.target ? AT_.REFUSE.not_found(st.target) : "Who should I link them to? Say both names." }); break; }
        const r = await asHer(req, "POST", `/donors/${id}/relationships`, { relatedDonorId: st.otherId, relationshipType: st.relation });
        const ok2 = r.status === 201 || r.status === 409;
        await log({ kind: "linked", state: ok2 ? "done" : "failed", donorId: id, place: "person", placeId: id, link: { tab: "donor", donorId: id },
          line: r.status === 201 ? `Linked ${nm(id)} and ${nm(st.otherId)} (${AN.LINK_WORD[st.relation]}).` : r.status === 409 ? `${nm(id)} and ${nm(st.otherId)} are already linked.`
            : `I couldn't link ${first(nm(id))} and ${first(nm(st.otherId))}: ${(r.body && r.body.error) || "it did not go through"}.` });
        break;
      }
      case "question": {
        // ATLAS-5: something Steward does not keep is said plainly, at once, with no lookup.
        const ck = AT_.cantKnow(st.target || st.words);
        if (ck) { await log({ kind: "answer", state: "done", line: ck }); break; }
        const ctl = new AbortController();
        const budget = setTimeout(() => ctl.abort(), ATLAS_ANSWER_MS());
        const r = await asHer(req, "POST", "/ask", { text: st.target || st.words, ...(prior && prior.context ? { context: prior.context } : {}) }, { signal: ctl.signal })
          .catch(e => ({ status: 504, body: null, timedOut: ctl.signal.aborted, error: e }))
          .finally(() => clearTimeout(budget));
        if (r.timedOut) {
          await log({ kind: "answer", state: "done", link: { tab: "ask", text: st.target || st.words },
            line: `I stopped after ${Math.round(ATLAS_ANSWER_MS() / 1000)} seconds: looking that up took longer than it should. Open it in Ask, where the full answer will finish.` });
          break;
        }
        const said0 = r.status < 300 && r.body && (r.body.sentence || (r.body.answer && r.body.answer.sentence) || r.body.headline);
        const said = AT_.plainCant(st.target || st.words, said0) || said0;   // ATLAS-5: plain words when Ask can't answer
        if (said) PG.words(req, String(said));   // SPEED-3: the answer's sentence shows while the list is read
        // ATLAS-3: a set of people comes back as the people, with the count and why each matched.
        const list = r.status < 300 ? await AN.listAnswer({ ask: r.body, query, orgId, asHer, req, today }).catch(e => { console.error("[atlas] list:", e.message); return null; }) : null;
        const aid = await log({ kind: "answer", state: "done", line: said ? String(said) : "I couldn't answer that just now.", link: { tab: "ask", text: st.target || st.words } });
        if (list) await saveAnswer(orgId, m.id, aid, { type: "list", question: st.target || st.words, ...list });
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
  // SENDS-1: everything she would have had written is one proposal, saved only by her Save.
  // (A meeting asked for in an email is the draft's "remind me" box, off until she ticks it.)
  if (propose.length) {
    await PROP.storeProposal(orgId, m.id, propose);
    const who = (propose.find(x => x.donorId) || {}).donorId || null;   // the line opens the person it is about
    await log({ kind: "proposal", state: "waiting", waits: true, line: PROP.proposalLine(propose),
      ...(who ? { donorId: who, link: { tab: "donor", donorId: who }, place: "person", placeId: who } : { link: { tab: "tasks" } }) });
  }
}

// SENDS-1 · SAVE. The claim first (server/atlas/proposal.js), then one write per item.
async function saveProposal(req, m, items) {
  const orgId = req.user.orgId;
  const [AT_, AD] = await Promise.all([AT(), ADm()]);
  const today = await atlasToday(orgId);
  const insId = m.instruction_id;
  const log = a => logAction(req, { requestId: m.id, ...a });
  const person = (id, extra = {}) => ({ donorId: id, link: { tab: "donor", donorId: id, ...extra } });
  const fnOf = it => first(it.name || "them");
  let wrote = 0;
  for (const it of items) {
    if (it.skip) { await log({ kind: it.kind === "call" ? "logged" : it.kind === "follow_up" ? "reminder" : it.kind, state: "refused", line: `Left out, as you asked: ${it.kind === "draft" ? `the email to ${fnOf(it)}` : it.kind === "follow_up" ? `"${it.title}"` : `the ${it.kind} for ${fnOf(it)}`}.` }); continue; }
    if (it.kind === "call") {
      const r = await runStep(req, m, insId, { tool: "log_conversation", donorId: it.donorId, kind: it.convKind, how: it.how, date: it.date <= today ? it.date : today, memoId: m.id, note: it.note, citesRows: [it.donorId] });
      await log({ kind: "logged", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok,
        line: r.ok ? `Logged the ${String(it.label || "conversation").toLowerCase()} with ${it.name}, ${AD.dayWithWeekday(it.date, today)}.` : `I couldn't log that: ${r.reason}.`,
        ...person(it.donorId, { section: "timeline" }), place: "person", placeId: it.donorId });
      if (r.ok) wrote++;
    } else if (it.kind === "note") {
      const r = await runStep(req, m, insId, { tool: "log_note", donorId: it.donorId, note: it.note, citesRows: [it.donorId] });
      await log({ kind: "note", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok, line: r.ok ? `Noted on ${it.name}: "${String(it.note).slice(0, 80)}".` : `I couldn't save that note: ${r.reason}.`,
        ...person(it.donorId, { section: "timeline" }), place: "person", placeId: it.donorId });
      if (r.ok) wrote++;
    } else if (it.kind === "follow_up") {
      const r = await runStep(req, m, insId, { tool: "create_task", donorId: it.donorId || undefined, title: it.title, due: it.due, citesRows: it.donorId ? [it.donorId] : [] });
      await log({ kind: "reminder", state: r.ok ? "done" : "failed", runId: r.runId, undoable: r.ok, line: r.ok ? `Reminder for ${AD.dayWithWeekday(it.due, today)}: ${String(it.title).replace(/\.$/, "")}.` : `I couldn't set that reminder: ${r.reason}.`,
        donorId: it.donorId || null, place: "tasks", placeId: r.entityId, link: it.donorId ? { tab: "donor", donorId: it.donorId, section: "thread" } : { tab: "tasks" } });
      if (r.ok) wrote++;
    } else if (it.kind === "draft") {
      const r = await runStep(req, m, insId, { tool: "draft_note", donorId: it.donorId, subject: it.subject, body: it.body, purpose: it.thanks ? "thank_you" : undefined, noThread: true, citesRows: [it.donorId] });
      const what = it.thanks ? "a thank-you" : "an email";
      if (r.ok && r.entityId) {
        await log({ kind: "draft", state: "waiting", waits: true, runId: r.runId, undoable: false,
          line: `Drafted ${what} to ${fnOf(it)}${it.meet ? ` asking to meet${it.month ? ` in ${it.month}` : ""}` : ""}. Review and send.`, donorId: it.donorId,
          place: "communications", placeId: r.entityId, link: { tab: "communications", draftId: r.entityId, donorId: it.donorId } });
        wrote++;
      } else await log({ kind: "draft", state: "failed", line: `I couldn't draft ${what} to ${fnOf(it)}: ${r.reason || "it did not run"}.` });
      if (it.remindMe) {
        const t = await runStep(req, m, insId, { tool: "create_task", donorId: it.donorId, title: it.remindTitle, due: it.remindDue, citesRows: [it.donorId] });
        await log({ kind: "reminder", state: t.ok ? "done" : "failed", runId: t.runId, undoable: t.ok, line: t.ok ? `Reminder for ${AD.dayWithWeekday(it.remindDue, today)}: ${it.meet ? "book the meeting" : String(it.remindTitle).replace(/\.$/, "")}.` : `I couldn't set the reminder: ${t.reason}.`,
          donorId: it.donorId, place: "tasks", placeId: t.entityId, link: { tab: "donor", donorId: it.donorId, section: "thread" } });
        if (t.ok) wrote++;
      }
    }
  }
  await run("UPDATE atlas_actions SET state='done', waits=false, line=? WHERE org_id=? AND request_id=? AND kind='proposal' AND state='waiting'",
    [`Saved ${wrote === 1 ? "one thing" : `${wrote} things`}.`, orgId, m.id]);
  return wrote;
}

// ── THE DOOR ────────────────────────────────────────────────────────────────
app.get("/atlas/status", requireAuth, wrap(async (req, res) => {
  const AT_ = await AT();
  const gate = await agentGate(req.user.orgId);
  res.json({ name: atlasName(), ai: gate.ok ? "on" : "off", reason: gate.ok ? null : gate.reason, rules: AT_.ATLAS_RULES, aiOffLine: gate.ok ? null : AT_.AI_OFF_LINE });
}));

app.post("/atlas", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const t0 = Date.now();
  req.atlasT0 = t0;
  const orgId = req.user.orgId;
  const text = String((req.body && req.body.text) || "").replace(/\s+/g, " ").trim();
  if (text.length < TEXT_MIN) return res.status(400).json({ error: "empty", sentence: "Tell me what happened, what to do, or what you want to know." });
  if (text.length > TEXT_MAX) return res.status(400).json({ error: "too_long", sentence: "That's too long for me. Say it in a few sentences." });
  PG.set(req, "Reading what you asked");
  // SPEED-3: the four reads before the model are independent, so they go at once.
  const [[org], tz, onPage0, prior] = await Promise.all([
    query("SELECT agent_paused_at FROM orgs WHERE id=?", [orgId]),
    orgTz(orgId),
    req.body.donorId ? query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(req.body.donorId), orgId]).then(r => r[0] || null) : null,
    // ATLAS-3 · Tell me more: the request before this one carries who it was about.
    AN.priorContext({ query, orgId, userId: actor(req).id, followsId: req.body.followsId, parse: j }),
  ]);
  if (org && org.agent_paused_at) return res.status(503).json({ error: "paused", sentence: `${atlasName()} is paused for this organization, so I did nothing.` });
  const today = await atlasToday(orgId, tz);
  let onPage = onPage0;
  if (!onPage && prior && prior.onPage) onPage = prior.onPage;
  PG.lap(req, "setup");
  // SPEED-3: everyone a name could match is read while the model reads her words.
  const all = people(orgId);
  all.catch(() => {});
  // ATLAS-5: the org's context once per request: the AI switch, the voice (writeDraft).
  req.atlasCtx = { gate: agentGate(orgId) };
  req.atlasCtx.gate.catch(() => {});
  const read = await readSteps(orgId, text, { today, onPage: onPage ? onPage.name : null, gateP: req.atlasCtx.gate });
  // TRUTH-3: "how much did Marlowe and Renee give together" is one question
  // about each named person, answered in code (server/atlas/givingTotal.js),
  // whatever the read made of it. Never /ask with the names run together.
  const gq = GT.parseGivingQuestion(text);
  if (gq) read.steps = [{ kind: "giving_total", who: gq.names.join(" and "), whos: gq.names, words: text }];
  const t1 = Date.now();
  PG.lap(req, "read");
  const { steps, questions } = await resolveAll(orgId, read.steps, { today, onPage, all });
  PG.lap(req, "resolve");
  const id = newId("vm");
  const source = req.body.source === "speech" ? "atlas_speech" : "atlas";
  const spoke = questions.length ? (questions.length === 1 ? "One question first, then I'll do all of it." : `${questions.length} questions first, then I'll do all of it.`) : null;
  await run(`INSERT INTO voice_memos (id,org_id,text,source,status,ai,donor_ids,read,cards,run_ids,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,'[]','[]',?,?)`,
    [id, orgId, text, source, questions.length ? "needs_answers" : "planned", read.ai === "on" ? "on" : "off",
     JSON.stringify([...new Set(steps.map(s => s.donorId).filter(Boolean))]),
     JSON.stringify({ atlas: { steps, questions, spoke, onPage: onPage ? onPage.id : null, follows: prior ? prior.id : null, timings: { readMs: t1 - t0 } } }), actor(req).id, actor(req).name]);
  if (questions.length) return res.json({ request: await requestOut(orgId, id) });
  const [m] = await query("SELECT * FROM voice_memos WHERE id=? AND org_id=?", [id, orgId]);
  await execute(req, m, steps, { today, ai: read.ai, prior });
  PG.lap(req, "run");
  await finishRequest(orgId, id, steps, { readMs: t1 - t0, totalMs: Date.now() - t0, laps: req.atlasLaps || [] });
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
  const today = await atlasToday(orgId);
  const onPage = read.atlas && read.atlas.onPage ? (await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [read.atlas.onPage, orgId]))[0] : null;
  const fresh = (read.atlas.steps || []).map(s => ({ kind: s.kind, who: s.who, target: s.target, amountWords: s.amountWords, whenWords: s.whenWords, how: s.how,
    words: s.words, ...(s.whos ? { whos: s.whos } : {}) }));
  const { steps, questions } = await resolveAll(orgId, fresh, { today, onPage, answers });
  if (questions.length) {
    await run("UPDATE voice_memos SET read=? WHERE id=? AND org_id=?", [JSON.stringify({ ...read, atlas: { ...read.atlas, questions } }), m.id, orgId]);
    return res.status(400).json({ error: "unanswered", sentence: "Pick one for each question.", request: await requestOut(orgId, m.id) });
  }
  const took = await run("UPDATE voice_memos SET status='planned' WHERE id=? AND org_id=? AND status='needs_answers'", [m.id, orgId]);
  if (!took || took.changes === 0) return res.status(409).json({ error: "already_done" });
  const prior = await AN.priorContext({ query, orgId, userId: actor(req).id, followsId: read.atlas.follows, parse: j });
  await execute(req, { ...m, status: "planned" }, steps, { today, ai: m.ai, prior });
  await finishRequest(orgId, m.id, steps, { ...(read.atlas.timings || {}), answerMs: Date.now() - t0 });
  res.status(201).json({ request: await requestOut(orgId, m.id) });
}));

// SENDS-1 · SAVE THE PROPOSAL. Nothing Atlas proposed is written before this.
// The body names the proposal it saves (and her edits); a second Save of the
// same proposal writes nothing and answers with what the first one did.
app.post("/atlas/:id/save", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT * FROM voice_memos WHERE id=? AND org_id=? AND source LIKE 'atlas%'", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  const proposal = ((j(m.read) || {}).atlas || {}).proposal;
  const pid = String((req.body && req.body.proposalId) || "");
  if (!proposal || proposal.id !== pid) return res.status(404).json({ error: "no_proposal", sentence: "There's nothing waiting to be saved here." });
  if (m.undone_at) return res.status(409).json({ error: "undone", sentence: "This was undone, so there's nothing to save." });
  if (proposal.discardedAt) return res.status(409).json({ error: "discarded", sentence: "You discarded this one, so nothing was saved." });
  if (!(await PROP.claimProposal(orgId, m.id, pid, new Date().toISOString()))) {
    return res.status(200).json({ already: true, sentence: "Already saved.", request: await requestOut(orgId, m.id) });
  }
  const items = PROP.mergeEdits(proposal.items, req.body && req.body.items);
  // What was saved is what she saw, edits and all.
  await run(`UPDATE voice_memos SET read = jsonb_set(read, '{atlas,proposal,items}', ?::jsonb) WHERE id=? AND org_id=?`, [JSON.stringify(items), m.id, orgId]);
  const wrote = await saveProposal(req, m, items);
  if (req.audit) req.audit.summary(`${atlasName()}: saved ${wrote} of ${items.length}`, { count: wrote });
  res.status(201).json({ request: await requestOut(orgId, m.id) });
}));

// ATLAS-3 · the status line while she waits: what Atlas is doing right now.
app.get("/atlas/progress/:key", requireAuth, wrap(async (req, res) => {
  res.json({ progress: PG.get(req.user.orgId, req.user.userId, req.params.key) });
}));

// ATLAS-3 · OPEN LIST: the same people, every time. The first click keeps
// this answer's people as a group (POST /groups and its members route, so the
// actor stamp and the audit row are theirs); every click after opens it.
app.post("/atlas/actions/:id/list", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await actionRow(orgId, req.params.id);
  if (!a || !a.request_id) return res.status(404).json({ error: "Not found" });
  const [m] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [a.request_id, orgId]);
  const read = j(m && m.read) || {};
  const ans = (read.answers || {})[a.id];
  if (!ans || ans.type !== "list" || !Array.isArray(ans.ids) || !ans.ids.length) return res.status(409).json({ error: "no_list", sentence: "That answer has no list of people to open." });
  if (ans.groupId) {
    const [g] = await query("SELECT id, name FROM audiences WHERE id=? AND org_id=?", [ans.groupId, orgId]);
    if (g) return res.json({ groupId: g.id, name: g.name, count: ans.ids.length, made: false });
  }
  const today = await atlasToday(orgId);
  let made = null;
  for (let n = 0; n < 4 && !made; n++) {
    const name = AN.groupName(ans.question, today) + (n ? ` ${n + 1}` : "");
    const r = await asHer(req, "POST", "/groups", { name, kind: "static", description: `The people Atlas found for "${String(ans.question).slice(0, 200)}".` });
    if (r.status === 201 && r.body && r.body.id) made = r.body;
    else if (r.status !== 409) return res.status(r.status || 500).json(r.body || { error: "group_failed" });
  }
  if (!made) return res.status(409).json({ error: "group_name_taken" });
  // TIDY-1: marked as Atlas's, so Groups shows it under "From Atlas" and it
  // goes after 30 days unless somebody renames, pins or sends to it.
  await run("UPDATE audiences SET made_by='atlas' WHERE id=? AND org_id=?", [made.id, orgId]);
  for (let i = 0; i < ans.ids.length; i += 500) {
    const r = await asHer(req, "POST", `/groups/${made.id}/members`, { donorIds: ans.ids.slice(i, i + 500) });
    if (r.status >= 300) return res.status(r.status).json(r.body || { error: "members_failed" });
  }
  await saveAnswer(orgId, a.request_id, a.id, { ...ans, groupId: made.id });
  res.status(201).json({ groupId: made.id, name: made.name, count: ans.ids.length, made: true });
}));

app.get("/atlas/:id", requireAuth, wrap(async (req, res, next) => {
  if (["activity", "notes", "status", "progress"].includes(req.params.id)) return next();
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
// ── DONE ELSEWHERE, GONE EVERYWHERE (POLISH-3) ──────────────────────────────
// A waiting line asks for a yes on one card. The same thing can be done
// another way: the gift typed on the Add Gift form, the receipt sent from the
// gift, the draft sent from Communications, or the card answered in Tell
// Steward. Margaret Chen's $10,000 was recorded and Home still said "tap to
// record", and a late tap would have recorded it twice. settledElsewhere
// READS what each waiting line asks for and whether it already exists (a GET
// shows the answer without writing it); settleWaiting writes it down, from a
// POST or from the one after-change step.
async function settledElsewhere(orgId, rows) {
  const out = new Map();
  const waiting = rows.filter(r => r.state === "waiting" && r.waits === true && r.request_id && r.card_id);
  if (!waiting.length) return out;
  const memos = await query("SELECT id, cards FROM voice_memos WHERE org_id=? AND id = ANY(?::text[])", [orgId, [...new Set(waiting.map(r => r.request_id))]]);
  const cardsOf = new Map(memos.map(m => [m.id, j(m.cards) || []]));
  const AT_ = await AT();
  const day = d => new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  // A gift for this person, of this amount, written since (or just before) she said it.
  const giftFor = async (a, c) => {
    if (c.giftId) { const [g] = await query("SELECT id, date, thanked_at, idempotency_key FROM gifts WHERE id=? AND org_id=?", [c.giftId, orgId]); return g || null; }
    const [g] = await query(`SELECT id, date, thanked_at, idempotency_key FROM gifts WHERE org_id=? AND donor_id=? AND ROUND(amount*100)=? AND created_at >= ?::timestamptz - interval '2 days'
                             AND LEFT(date::text, 10) >= to_char(?::timestamptz - interval '3 days', 'YYYY-MM-DD') ORDER BY created_at LIMIT 1`, [orgId, c.donorId, c.cents, a.created_at, a.created_at]);
    return g || null;
  };
  for (const a of waiting) {
    const cards = cardsOf.get(a.request_id) || [];
    const c = cards.find(x => x.id === a.card_id);
    if (!c) continue;
    if (c.state !== "waiting") { out.set(a.id, { card: c, cardDecided: true }); continue; }
    if (c.kind === "money" && c.moneyKind === "gift") {
      const g = await giftFor(a, c);
      // The tap's own gift passes through the after-change step before its
      // card is marked: that one is this line's own yes, with its Undo.
      const own = g && g.idempotency_key === `voice:${a.request_id}:${c.id}`;
      if (g) out.set(a.id, { card: c, patch: { state: "saved", giftId: g.id, ...(own ? {} : { by: "Recorded elsewhere" }) }, undoable: own,
        line: own ? `Recorded the ${AT_.usd(c.cents)} gift.` : `Already recorded: the ${AT_.usd(c.cents)} gift on ${day(g.date)}.` });
    } else if (c.kind === "money" && c.moneyKind === "pledge") {
      const [p] = await query(`SELECT id FROM pledges WHERE org_id=? AND donor_id=? AND ROUND(amount*100)=? AND created_at >= ?::timestamptz - interval '2 days' ORDER BY created_at LIMIT 1`,
        [orgId, c.donorId, c.cents, a.created_at]);
      if (p) out.set(a.id, { card: c, patch: { state: "saved", pledgeId: p.id, by: "Recorded elsewhere" }, line: `Already recorded: the ${AT_.usd(c.cents)} pledge.` });
    } else if (c.kind === "thanks") {
      const giftCard = cards.find(x => x.id === c.afterCard);
      const g = giftCard ? await giftFor(a, giftCard) : null;
      if (!g) continue;
      const [rc] = await query("SELECT id FROM receipts WHERE org_id=? AND gift_id=? AND voided_at IS NULL LIMIT 1", [orgId, g.id]);
      if (rc || g.thanked_at) out.set(a.id, { card: c, patch: { state: "saved", receiptId: rc ? rc.id : null, by: "Done elsewhere" }, line: "Already thanked." });
    } else if (c.kind === "draft" && c.draftId) {
      const [d] = await query("SELECT status FROM agent_drafts WHERE id=? AND org_id=?", [c.draftId, orgId]);
      if (d && d.status !== "pending") out.set(a.id, { card: c, patch: { state: d.status === "sent" ? "saved" : "discarded", by: "Done elsewhere" },
        line: d.status === "sent" ? "Sent." : null, state: d.status === "sent" ? "done" : "discarded" });
    }
  }
  return out;
}
// What a reader is shown for a line that was settled elsewhere (nothing written).
function asSettled(r, s) {
  if (!s) return r;
  if (s.cardDecided) {
    const st = s.card.state === "saved" ? "done" : s.card.state;
    return { ...r, state: st, waits: false };
  }
  return { ...r, state: s.state || "done", waits: false, undoable: s.undoable === true, line: s.line || r.line };
}
async function settleWaiting(orgId, rows) {
  const found = await settledElsewhere(orgId, rows);
  const memos = new Set();
  for (const [id, s] of found) {
    const a = rows.find(r => r.id === id);
    memos.add(a.request_id);
    if (s.cardDecided) continue;
    const [m] = await query("SELECT cards FROM voice_memos WHERE id=? AND org_id=?", [a.request_id, orgId]);
    const cards = (j(m && m.cards) || []).map(c => (c.id === a.card_id && c.state === "waiting" ? { ...c, ...s.patch } : c));
    await run("UPDATE voice_memos SET cards=? WHERE id=? AND org_id=?", [JSON.stringify(cards), a.request_id, orgId]);
    await run(`UPDATE atlas_actions SET state=?, waits=false, undoable=?, line=COALESCE(?, line), updated_at=NOW() WHERE id=? AND org_id=? AND state='waiting'`,
      [s.state || "done", s.undoable === true, s.line || null, id, orgId]);
  }
  for (const rid of memos) await syncFromCards(orgId, rid);
  return found.size;
}
// The one after-change step calls this for the people it touched.
settleForDonors = async (orgId, donorIds) => {
  const ids = [...new Set(donorIds || [])].filter(Boolean);
  if (!ids.length) return 0;
  const rows = await query("SELECT * FROM atlas_actions WHERE org_id=? AND state='waiting' AND waits=true AND donor_id = ANY(?::text[])", [orgId, ids]);
  return rows.length ? settleWaiting(orgId, rows) : 0;
};
app.post("/atlas/actions/:id/yes", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  let a = await actionRow(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  // Done another way since it was asked: write that down, and never do it twice.
  if (a.state === "waiting" && await settleWaiting(orgId, [a])) a = await actionRow(orgId, a.id);
  if (a.state !== "waiting" || !a.card_id) return res.status(409).json({ error: "not_waiting", sentence: a.state === "done" ? "This one is already done." : "This one isn't waiting for you." });
  if (a.kind === "draft") return res.status(400).json({ error: "open_the_draft", sentence: "Open the draft to read it and send it yourself." });
  const r = await asHer(req, "POST", `/voice/memos/${a.request_id}/cards/${a.card_id}/yes`, {});
  // The card may have been decided even when the answer is an error (the gift
  // was recorded and a follow-on failed): the line follows the card either way.
  await syncFromCards(orgId, a.request_id);
  if (r.status >= 300) return res.status(r.status).json(r.body || { error: "not_done" });
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

// ── ATLAS-5 · LET IT GO (W-1108-Atlas-08X) ──────────────────────────────────
// Discard a proposal (nothing is written), or dismiss any waiting line: the
// proposal's, a tap's (the card's own No), or an unanswered question.
app.post("/atlas/:id/discard", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT id FROM voice_memos WHERE id=? AND org_id=? AND source LIKE 'atlas%'", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  await WT.discardProposal({ query, run }, orgId, m.id);
  res.json({ request: await requestOut(orgId, m.id) });
}));
app.post("/atlas/:id/dismiss-question", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT id, status FROM voice_memos WHERE id=? AND org_id=? AND source LIKE 'atlas%'", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (!(await WT.dismissQuestion({ run }, orgId, m.id))) return res.status(409).json({ error: "not_waiting", sentence: "That question isn't waiting any more." });
  res.json({ ok: true });
}));
app.post("/atlas/actions/:id/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await actionRow(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  if (a.state !== "waiting") return res.status(409).json({ error: "not_waiting", sentence: "This one isn't waiting for you." });
  if (a.kind === "proposal") await WT.discardProposal({ query, run }, orgId, a.request_id);
  else if (a.card_id) {
    const r = await asHer(req, "POST", `/voice/memos/${a.request_id}/cards/${a.card_id}/no`, {});
    if (r.status >= 300) return res.status(r.status).json(r.body || { error: "not_done" });
    await syncFromCards(orgId, a.request_id);
  } else if (a.kind === "draft") return res.status(400).json({ error: "dismiss_the_draft", sentence: "Use the draft's own × to dismiss it." });
  else await run("UPDATE atlas_actions SET state='discarded', waits=false, updated_at=NOW() WHERE id=? AND org_id=? AND state='waiting'", [a.id, orgId]);
  res.json({ ok: true, action: actionOut(await actionRow(orgId, a.id)), request: a.request_id ? await requestOut(orgId, a.request_id) : null });
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
  const waitingRows = await query(`SELECT * FROM atlas_actions WHERE org_id=? AND waits=true AND state='waiting'`, [orgId]);
  const [settled, asking] = await Promise.all([settledElsewhere(orgId, waitingRows), WT.openQuestions(query, orgId, actor(req).id)]);   // ATLAS-5: her open questions wait too
  const items = [...asking.map(x => ({ ...x, by: atlasName() })), ...rows.map(r => actionOut(asSettled(r, settled.get(r.id))))];
  res.json({ name: atlasName(), waiting: waitingRows.length - settled.size + asking.length, items,
    changes: await require("../server/shared/changeMarks").changeMarks(query, orgId) });
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
  const settled = await settledElsewhere(orgId, rows);
  const shown = rows.map(r => asSettled(r, settled.get(r.id)))
    // Home lists only what waits; a page keeps a settled line it has not shown yet.
    .filter(r => (place === "home" ? r.waits === true && r.state === "waiting" : r.seen_at == null || (r.waits === true && r.state === "waiting")));
  res.json({ name: atlasName(), notes: shown.map(actionOut) });
}));
app.post("/atlas/notes/seen", requireAuth, wrap(async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 50);
  if (ids.length) await run("UPDATE atlas_actions SET seen_at=COALESCE(seen_at, NOW()) WHERE org_id=? AND id = ANY(?::text[])", [req.user.orgId, ids]);
  res.json({ ok: true });
}));
}

module.exports = { routers, mount, settleForDonors: (...a) => settleForDonors(...a) };
