// routes/why.js — WHY-1. Ask Steward why, and who to call tomorrow.
//
// One question in, one answer out, in the shape shared/whyShape.js describes.
// The FACTS are why.js's (deterministic, on the org's own data). The SENTENCE
// is the template's, or the model's when AI is on and the sentence passes the
// number check: every number in it must be one Steward computed, or the
// template is shown instead. The model is reached only through aiClient.js.
//
// Nothing here sends, texts or charges anybody. The step an answer recommends
// is taken by a person, through the routes that already exist (a Thread step,
// a journey, Log a conversation).
//
// THE QUESTION LOG. Every question asked here, typed or tapped, is written to
// HELP-1's question_log: the question text only (never a donor's data, never
// the answer), with whether Steward could answer it. Super-admin reads the
// unanswered ones grouped by topic; that list is the roadmap.
const { recordAiFallback } = require("../aiClient");   // AGENT-3: no silent fallbacks
const express = require("express");
const WHY = require("../why");
const AW = require("../appealWhy");
const P = require("../prospect");
const GR = require("../groups");
const FS = require("../figureSources");

const routers = { r0: express.Router() };
// ASK-3: money and small numbers in the words of a list answer.
const fmtUsd = c => "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "them";
const spellN = n => (["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] || String(n));


function mount(ctx) {
const { whyAskLimiter, AGENT_MODEL, aiGate, anthropicFor, computeDriftForDonors, computeRetentionRate, orgTime, orgToday, orgTz, query, requireAuth, run, wrap } = ctx;
const app = routers.r0;
let S = null, SMm = null;
const shape = async () => (S = S || await import("../shared/whyShape.js"));
const showMod = async () => (SMm = SMm || await import("../shared/showMe.js"));
let AGm = null;
const guide = async () => (AGm = AGm || await import("../shared/askGuide.js"));

// ASK-2: the org is kept with the question, so the box's suggestions are the
// org's own most-asked questions and never another organisation's.
// HARDEN-1: POST /ask/preview answers exactly as /ask does and writes nothing.
// The prod smoke after each deploy asks one real question through it, so the
// one write the Ask path makes (this log) is skipped inside a preview.
const { AsyncLocalStorage } = require("async_hooks");
const ASK_PREVIEW = new AsyncLocalStorage();
async function logQuestion(orgId, text, topic, answered) {
  if (ASK_PREVIEW.getStore()) return;
  await run(`INSERT INTO question_log (surface, question, topic, answered, org_id) VALUES ('why', ?, ?, ?, ?)`,
    [String(text).slice(0, 1000), topic, !!answered, orgId || null]).catch(() => {});
}

// A typed question that names a campaign or a person: matched against the
// org's own names, longest first, so "Spring Appeal 2026" beats "Spring".
const stripYear = n => String(n || "").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim().toLowerCase();
async function campaignNamedIn(orgId, text) {
  const s = String(text || "").toLowerCase();
  const rows = await query(`SELECT id, name, start_date::text AS start_date FROM campaigns WHERE org_id = ? AND sent_at IS NULL
      AND COALESCE(subject,'') = '' ORDER BY start_date DESC NULLS LAST`, [orgId]);
  const exact = rows.filter(c => s.includes(String(c.name).toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  if (exact) return exact;
  return rows.find(c => stripYear(c.name).length > 2 && s.includes(stripYear(c.name))) || null;
}
async function donorNamedIn(orgId, text) {
  const [d] = await query(`SELECT id, name FROM donors WHERE org_id = ? AND deleted_at IS NULL AND LENGTH(name) > 3
      AND POSITION(LOWER(name) IN LOWER(?)) > 0 ORDER BY LENGTH(name) DESC LIMIT 1`, [orgId, String(text || "")]);
  return d || null;
}

// The facts the sentence may use: the question's own facts (which name at
// most the first person on the list) and the reasons' labels and sums. Nothing
// else reaches the model, and nothing else passes the number check.
function sentenceFacts(a) {
  return {
    ...a.facts,
    reasons: (a.reasons || []).map(r => ({ label: r.label, cents: r.cents, count: r.count })),
  };
}

async function writeSentence(orgId, questionText, a, Sx) {
  const template = Sx.templateSentence(a.key, a.facts);
  const gate = await aiGate(orgId);
  if (!gate.ok) return { sentence: template, source: "template", template, aiOff: gate.reason === "ai_disabled" };
  const facts = sentenceFacts(a);
  try {
    // ASK-3: one sentence needs no thinking. With the model's default thinking
    // on, the 200 tokens went to thinking and the sentence came back cut off
    // mid-word ("…strong room to give and") or empty. A reply that did not
    // finish is never shown.
    const out = await anthropicFor(orgId).messages.create({
      model: AGENT_MODEL, max_tokens: 300, thinking: { type: "disabled" },
      messages: [{ role: "user", content: Sx.sentencePrompt(questionText, facts) }],
    });
    if (out.stop_reason && out.stop_reason !== "end_turn") { recordAiFallback(orgId, "ask.sentence", "unfinished"); return { sentence: template, source: "template", template, aiOff: false, refused: "unfinished" }; }
    const text = (out.content || []).filter(b => b.type === "text").map(b => b.text).join(" ").replace(/\s+/g, " ").trim();
    const G = await guide();
    // ASK-3: complete, plain, about the donor's world, and every number Steward's own.
    if (text && Sx.sentencePasses(text, facts) && G.sentenceIsPlain(text)) return { sentence: text, source: "ai", template, aiOff: false };
    const refused = !text ? "empty" : Sx.sentencePasses(text, facts) ? "plain" : "numbers";
    recordAiFallback(orgId, "ask.sentence", refused);
    return { sentence: template, source: "template", template, aiOff: false, refused };
  } catch (e) {
    recordAiFallback(orgId, "ask.sentence", e);
    return { sentence: template, source: "template", template, aiOff: e && e.code === "ai_off" };
  }
}

// What the client is given for a reason: never the rows themselves (they open
// through the figure source, paged, the same way every number opens).
function publicReason(r, params) {
  return { key: r.key, label: r.label, cents: r.cents, count: r.count, measure: r.measure, definition: r.definition,
    source: { key: "why", params: { ...params, part: r.key } } };
}

// GET /why/questions — the one-tap questions for Home: "Who should I call
// tomorrow?" and the org's most recent campaign that has a year to compare.
app.get("/why/questions", requireAuth, wrap(async (req, res) => {
  const Sx = await shape();
  const c = await WHY.defaultCampaign(req.user.orgId);
  const taps = [{ key: "call", text: Sx.QUESTIONS.find(q => q.key === "call").ask() }];
  if (c) taps.push({ key: "appeal", campaign: c.id, text: Sx.QUESTIONS.find(q => q.key === "appeal").ask(c.name) });
  // PROSPECT-1 — the eighth question is a one-tap for admins and major gifts staff, and nobody else.
  const mg = await P.canSee(req.user.userId);
  if (mg) taps.push({ key: "more", text: Sx.QUESTIONS.find(q => q.key === "more").ask() });
  res.json({ taps, all: Sx.QUESTIONS.filter(q => mg || !q.restricted).map(q => ({ key: q.key, needs: q.needs, text: q.ask() })) });
}));

// GET /donors/:id/journey-suggestion — WHY-1 Part 7. The journey the donor's
// rail suggests, chosen from simple facts on their record, first that fits:
//   monthly        an active recurring gift              -> Monthly giver
//   lapsed         past their usual gap (drift.js: drifting or lapsed), or
//                  marked lapsed                          -> Welcome back
//   first year     their first gift in the last 365 days  -> New donor, first year
//   major prospect generosity score 80 or more            -> Major donor
//   recently met   a meeting logged in the last 30 days   -> Major donor
// Only a journey the org has (by its catalogue key, not archived) is offered.
// Read-only; starting it is POST /journeys/:id/apply, a person's choice.
const SUGGEST_ORDER = [["monthly", "monthly_giver"], ["lapsed", "welcome_back"], ["firstYear", "new_donor_first_year"],
  ["major", "major_donor"], ["met", "major_donor"]];
const SUGGEST_WHY = {
  monthly: "They give every month.",
  lapsed: "They are past their usual gap between gifts.",
  firstYear: "Their first gift was this past year.",
  major: "Their giving puts them among your most generous.",
  met: "You met them in the last month.",
};
app.get("/donors/:id/journey-suggestion", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT id, stage FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));
  const [[sub], [first], [score], [met]] = await Promise.all([
    query(`SELECT 1 AS y FROM recurring_subscriptions WHERE org_id = ? AND donor_id = ? AND status IN ('active','past_due','recovering','recovered') LIMIT 1`, [orgId, d.id]),
    query(`SELECT MIN(LEFT(date,10)) AS first FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0`, [orgId, d.id]),
    query(`SELECT generosity FROM donor_scores WHERE org_id = ? AND donor_id = ?`, [orgId, d.id]),
    query(`SELECT 1 AS y FROM interactions WHERE org_id = ? AND donor_id = ? AND type = 'meeting' AND LEFT(date,10) >= ? LIMIT 1`, [orgId, d.id, orgTime.addDays(today, -30)]),
  ]);
  let drift = null;
  try { const { map } = await computeDriftForDonors(orgId, { donorIds: [d.id] }); drift = map.get(d.id) || null; } catch { drift = null; }
  const facts = {
    monthly: !!sub,
    lapsed: d.stage === "lapsed" || !!(drift && (drift.state === "drifting" || drift.state === "lapsed")),
    firstYear: !!(first && first.first && first.first >= orgTime.addDays(today, -365)),
    major: !!(score && Number(score.generosity) >= 80),
    met: !!met,
  };
  const journeys = await query(`SELECT id, name, preset_key, steps FROM cultivation_templates
     WHERE org_id = ? AND archived_at IS NULL AND preset_key IS NOT NULL ORDER BY created_at`, [orgId]);
  const J = await import("../shared/journeyShape.js");
  for (const [fact, key] of SUGGEST_ORDER) {
    if (!facts[fact]) continue;
    const j = journeys.find(x => x.preset_key === key && x.id !== String(req.query.exclude || ""));
    if (!j) continue;
    const steps = (typeof j.steps === "string" ? JSON.parse(j.steps) : j.steps) || [];
    let prev = null;
    const shaped = steps.map(st => { const r = J.resolveTiming(st, prev); prev = r.offsetDays; return { label: st.label, offsetDays: r.offsetDays, when: J.timingWord(r.timing, r.offsetDays) }; });
    return res.json({ suggestion: { journeyId: j.id, name: j.name, why: SUGGEST_WHY[fact], fact, steps: shaped.slice(0, 3), total: shaped.length } });
  }
  res.json({ suggestion: null });
}));

// ── PARITY-4 Part 3 · SHOW ME ───────────────────────────────────────────────
// A "show me" or "who" question answered with a LIST. The question becomes a
// filter spec (shared/showMe.js): the model fills a form whose fields are the
// donor list's own filters, or with AI off the templates read it. Either way
// checkSpec refuses anything outside groups.js RULE_KEYS ("Steward can't
// filter by that yet"); the list is buildDonorFilter's, so it is the same rows
// the Donors list, its export and a Group saved from it show. Nothing is
// written but the question log.
async function showMe(req, res, typed, preset = null) {
  const SM = await showMod();
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));
  const [events, campaigns] = await Promise.all([
    query(`SELECT id, name, date::text AS date FROM events WHERE org_id = ? ORDER BY date DESC LIMIT 200`, [orgId]),
    query(`SELECT id, name, start_date::text AS "startDate" FROM campaigns WHERE org_id = ? ORDER BY start_date DESC NULLS LAST LIMIT 200`, [orgId]),
  ]);
  const ctx = { today, events, campaigns };
  let spec = preset, specSource = "template", aiOff = false;
  // HARDEN-1: a question the donor list's own filters read in full (preset)
  // is answered from them exactly; the model is not asked.
  const gate = preset ? { ok: false, reason: null } : await aiGate(orgId);
  if (gate.ok) {
    try {
      const out = await anthropicFor(orgId).messages.create({
        model: AGENT_MODEL, max_tokens: 600, tools: [SM.specTool()], tool_choice: { type: "tool", name: "filter_spec" },
        messages: [{ role: "user", content: SM.specPrompt(typed, ctx) }],
      });
      spec = SM.readToolSpec(out.content);
      if (spec) specSource = "ai";
    } catch (e) {
      // FIX-29: the templates read it instead, and the failure is logged (a
      // rejected schema hid here for two days).
      spec = null; aiOff = !!(e && e.code === "ai_off");
      recordAiFallback(orgId, "ask.show_me", e);
    }
  } else aiOff = gate.reason === "ai_disabled";
  if (!spec) spec = SM.templateSpec(typed, ctx);
  const refuse = async what => {
    const q = await tryQuery(req, typed);
    if (q && q.answer) return res.json(q.answer);
    await logQuestion(req.user.orgId, typed, "show me", false);
    return res.json({ answered: false, kind: "list", refused: true, sentence: SM.refusalSentence(what), specSource, aiOff, question: { key: "show", text: typed } });
  };
  const chk = SM.checkSpec(spec, { normalizeRules: GR.normalizeRules, ruleKeys: GR.RULE_KEYS, events, campaigns });
  if (!chk.ok) return refuse(chk.refused);
  const f = await GR.buildDonorFilter(orgId, chk.rules);
  if (f.badRole || f.badStatus) return refuse("a value Steward does not know");
  const [rows, [cnt]] = await Promise.all([
    query(`SELECT id, name, city, total_giving, last_gift_date FROM donors WHERE ${f.whereSql} ORDER BY ${f.orderBy} LIMIT 50`, f.params),
    query(`SELECT COUNT(*)::int AS c FROM donors WHERE ${f.whereSql}`, f.params),
  ]);
  await logQuestion(req.user.orgId, typed, "show me", true);
  const count = Number(cnt.c) || 0;
  // FIX-27 Part 2b · "and what should I ask them?" Each person carries the
  // suggested ask from their own gifts (engagement.suggestedAsk, the profile's
  // own) and, for a viewer allowed to see it, their Room to give word. The
  // step is planning the ask; nothing is sent.
  const asking = !!(spec.withAsk || chk.rules.noAsk);
  let asks = new Map(), room = new Map(), maySee = false;
  if (asking && rows.length) {
    const E = require("../engagement");
    maySee = await P.canSee(req.user.userId);
    const ids = rows.map(r => r.id);
    const screens = maySee ? await P.latestScreening(orgId, ids) : new Map();
    const [askList, rtg] = await Promise.all([
      Promise.all(ids.map(id => E.suggestedAsk(query, orgId, id, maySee ? { screening: screens.get(id) || null } : {}).catch(() => null))),
      maySee ? P.roomToGive(orgId, ids) : Promise.resolve(new Map()),
    ]);
    ids.forEach((id, i) => asks.set(id, askList[i]));
    room = rtg;
  }
  const RTW = asking && maySee ? await import("../shared/roomToGive.js") : null;
  res.json({
    withAsk: asking,
    askStep: asking ? { label: "Plan the ask", dueIn: 14, sentence: "Planning an ask adds a step to that person's Thread, due in two weeks. Nothing is sent." } : null,
    answered: true, kind: "list", question: { key: "show", text: typed }, specSource, aiOff,
    rules: chk.rules, words: SM.filterWords(chk.rules, ctx), sentence: SM.listSentence(count),
    count, countSource: { key: "show-me", params: { rules: JSON.stringify(chk.rules) } },
    countDefinition: "Everyone on file these filters find today, the same rows the Donors list shows for them.",
    groupSentence: GR.rulesSentence(chk.rules),
    rows: rows.map(r => {
      const a = asks.get(r.id), w = room.get(r.id);
      return { donorId: r.id, name: r.name, city: r.city || "", cents: Math.round(Number(r.total_giving || 0) * 100), lastGift: r.last_gift_date || null,
        ...(asking ? { ask: a ? { cents: a.askCents, sentence: a.sentence } : null } : {}),
        ...(asking && RTW && w ? { room: { word: w.word, label: RTW.LABELS[w.word] || w.word } } : {}) };
    }),
  });
}

// POST /why/ask — { text } typed, or { key, campaign?, donor? } tapped.
// Writes the question to the log and nothing else.
async function whyAskHandler(req, res) {
  const Sx = await shape();
  const orgId = req.user.orgId;
  const body = req.body || {};
  const typed = String(body.text || "").trim().slice(0, 500);
  // PARITY-4: a list question: "show me…", "donors who…", or a "who"
  // question none of the eight takes.
  if (typed && !body.key) {
    const SM = await showMod();
    if (body.mode === "show" || SM.listFirst(typed) || (!Sx.matchQuestion(typed) && SM.isShowMe(typed))) return showMe(req, res, typed);
  }
  let key = Sx.QUESTION_KEYS.includes(body.key) ? body.key : (typed ? Sx.matchQuestion(typed) : null);
  let campaign = body.campaign ? String(body.campaign) : null, donor = body.donor ? String(body.donor) : null;
  if (key === "appeal" && !campaign) campaign = (typed && (await campaignNamedIn(orgId, typed)) || await WHY.defaultCampaign(orgId) || {}).id || null;
  if (key === "stopped" && !donor && typed) donor = ((await donorNamedIn(orgId, typed)) || {}).id || null;
  if (key === "appeal" && !campaign) key = null;
  if (key === "stopped" && !donor) key = null;
  // PROSPECT-1 — room to give is for admins and major gifts staff. Anyone else
  // who types the question is told plainly, and nothing about anybody is shown.
  if (key === "more" && !(await P.canSee(req.user.userId))) {
    await logQuestion(req.user.orgId, typed || "Who could give more?", "more", false);
    return res.status(403).json({ error: "major_gifts_only", answered: false,
      sentence: "Room to give is for admins and staff with the major gifts permission.", question: { text: typed } });
  }

  // The text that is logged: what she typed, or the tapped question's words
  // with the subject left generic (a donor's name is donor data).
  const logged = typed || Sx.QUESTIONS.find(q => q.key === body.key)?.ask() || "(empty)";
  if (!key) {
    const q = typed ? await tryQuery(req, typed) : null;
    if (q && q.answer) return res.json(q.answer);
    await logQuestion(req.user.orgId, logged, "not covered", false);
    return res.json({ answered: false, sentence: Sx.CANT_ANSWER, question: { text: typed } });
  }
  const a = await WHY.answer(orgId, key, { campaign, donor, user: req.user.userId }, { computeDriftForDonors });
  if (!a) {
    await logQuestion(req.user.orgId, logged, key, false);
    return res.json({ answered: false, sentence: Sx.CANT_ANSWER, question: { text: typed } });
  }
  a.key = key;
  await logQuestion(req.user.orgId, logged, key, true);
  const params = { q: key, ...(campaign ? { campaign } : {}), ...(donor ? { donor } : {}), ...(key === "call" ? { user: req.user.userId } : {}) };
  const G = await guide();
  const canSeeMore = await P.canSee(req.user.userId);
  // ASK-3: one part of the appeal's breakdown ("Who are the 11 who haven't
  // given?"): the same reason, its own people, the template sentence only.
  const partKey = key === "appeal" && body.part ? String(body.part) : null;
  if (partKey) {
    const r = (a.reasons || []).find(x => x.key === partKey);
    if (!r || !a.compare) return res.json({ answered: false, sentence: Sx.CANT_ANSWER, question: { text: typed } });
    const by = new Map();
    for (const x of r.rows) {
      const p = by.get(x.donor_id) || { donorId: x.donor_id, name: x.name, cents: 0, reason: x.detail || "" };
      p.cents += Math.abs(Math.round(Number(x.amount || 0) * 100)); by.set(x.donor_id, p);
    }
    const who = [...by.values()].sort((m, n) => Math.abs(n.cents) - Math.abs(m.cents) || m.name.localeCompare(n.name));
    const text = Sx.partSentence(partKey, { count: r.count, cents: r.cents, campaignName: a.campaign.name, compareName: a.compare.name });
    const answer = {
      answered: true, part: partKey, question: { key, text: typed || G.partQuestion(partKey, r.count) }, campaign: a.campaign, compare: a.compare, donor: null,
      sentence: text, sentenceSource: "template", template: text, aiOff: false,
      reasons: [publicReason(r, params)], who: who.slice(0, 50),
      step: who.length ? { kind: "plan", label: `Plan calls to the top ${Math.min(5, who.length) === 5 ? "five" : Math.min(5, who.length)}`,
        items: who.slice(0, 5).map(p => ({ donorId: p.donorId, name: p.name, label: "Call" })), dueIn: 1, due: orgTime.addDays(orgToday(await orgTz(orgId)), 1) } : null,
      cantSee: a.cantSee || null,
    };
    return res.json({ ...answer, followUps: G.followUpsFor(answer, { canSeeMore }) });
  }
  const qText = typed || Sx.QUESTIONS.find(q => q.key === key).ask(a.campaign?.name || a.donor?.name);
  // ASK-4 HARDENING: the model writes the sentence for the question these
  // facts answer, never for her words, so it cannot stretch the facts to fit
  // a question they do not answer ("came to the gala AND volunteered").
  const answered = Sx.QUESTIONS.find(q => q.key === key).ask(a.campaign?.name || a.donor?.name);
  const s = await writeSentence(orgId, answered, a, Sx);
  const today = orgToday(await orgTz(orgId));
  const step = a.step ? { ...a.step, due: orgTime.addDays(today, a.step.dueIn || 1),
    ...(a.step.fallback ? { fallback: { ...a.step.fallback, due: orgTime.addDays(today, a.step.fallback.dueIn || 1) } } : {}) } : null;
  const out = {
    answered: true, question: { key, text: qText }, campaign: a.campaign || null, compare: a.compare || null, donor: a.donor || null,
    sentence: s.sentence, sentenceSource: s.source, template: s.template, aiOff: !!s.aiOff,
    reasons: (a.reasons || []).map(r => publicReason(r, params)),
    who: a.who || [], step, cantSee: a.cantSee || null,
    alsoSteps: (a.alsoSteps || []).map(x => ({ ...x, due: orgTime.addDays(today, x.dueIn || 7),
      ...(x.fallback ? { fallback: { ...x.fallback, due: orgTime.addDays(today, x.fallback.dueIn || 7) } } : {}) })),
  };
  res.json({ ...out, followUps: G.followUpsFor(out, { canSeeMore }) });
}
app.post("/why/ask", whyAskLimiter, requireAuth, wrap(whyAskHandler));

// ── ASK-2 · ASK ANYTHING ABOUT YOUR OWN FILE ───────────────────────────────
// POST /ask { text, previous?, scope? } or { plan } (a pinned answer, re-run).
// The question becomes a typed plan (shared/askCatalog.js): a follow-up on the
// last plan, the templates, or (AI on) the model's form. Steward validates it
// and runs it (askEngine.js). A why or who question goes to Ask why and Show
// me unchanged. Anything outside the catalog is refused in one sentence and
// logged. Nothing is written but the question log.
let ACm = null;
const askCat = async () => (ACm = ACm || await import("../shared/askCatalog.js"));
const AE = require("../askEngine");
const AQ = require("../askQuery");

// ── ASK-4 · ANY QUESTION ABOUT THE ORG'S OWN RECORDS ───────────────────────
// When the catalog of ASK-2 and the eight why questions cannot take a
// question, and AI is on, the model fills askQuery.js's query form (any record
// the org keeps, any field of it). Steward validates it, runs it read-only and
// org-scoped, and writes the sentence itself: every number in it is a figure
// with the source "query", which opens the same rows. Nothing is written but
// the question log.
const qsrc = (plan, cell) => ({ key: "query", params: { plan: JSON.stringify(plan), cell } });
function queryAnswerShape(plan, r) {
  const E = AQ.ENTITIES[plan.entity];
  const m = plan.measure;
  const fd = m.field ? E.fields[m.field] : null;
  const isMoney = fd ? fd.type === "money" : false;
  const kindOf = isMoney ? "money" : "count";
  const words = AQ.queryWords(plan);
  const conds = words.split(" · ").slice(1).join(" · ");
  const defn = `${words}. Counted from the org's own records, read today.`;
  const fig = (value, cell, label) => ({ value: value == null ? 0 : value, kind: kindOf, label, definition: defn, source: qsrc(plan, cell) });
  const countFig = (n, cell, label) => ({ value: n, kind: "count", label, definition: defn, source: qsrc({ ...plan, measure: { fn: m.fn === "count_people" ? "count_people" : "count", field: null } }, cell) });
  const figures = {};
  const parts = [];
  const noun = m.fn === "count_people" ? (r.value === 1 ? "person" : "people") : (r.value === 1 ? E.label : E.plural);
  const tail = conds ? ` (${conds})` : "";
  if (plan.groupBy && r.groups && r.groups.length) {
    // The sentence names the LARGEST group (or the smallest, when asked), never
    // simply the first row of a calendar-ordered breakdown.
    const pick = r.groups.reduce((b, g, i) => ((plan.sort && plan.sort.dir === "asc" ? Number(g.value) < Number(r.groups[b].value) : Number(g.value) > Number(r.groups[b].value)) ? i : b), 0);
    figures.value = fig(r.value, "value", words);
    figures.group0 = fig(r.groups[pick].value, "g" + pick, `${r.groups[pick].key}`);
    const gl = plan.groupBy.bucket || E.fields[plan.groupBy.field].label;
    parts.push(m.fn === "sum" ? "" : "", { fig: "value" }, m.fn === "sum" ? ` in all${tail}; ` : ` ${noun}${tail}; `,
      `${r.groups[pick].key} ${plan.sort && plan.sort.dir === "asc" ? "is lowest at" : "leads with"} `, { fig: "group0" }, `, of ${r.groups.length} ${r.groups.length === 1 ? gl : gl === "fund" ? "funds" : gl + "s"}.`);
  } else if (["min", "max"].includes(m.fn)) {
    const top = (r.list || [])[0];
    figures.value = fig(r.value, "value", words);
    parts.push(`The ${m.fn === "max" ? "largest" : "smallest"} ${fd.label} is `, { fig: "value" },
      top ? `, ${top.name}${top.date ? ` on ${AQ.dayWords(String(top.date).slice(0, 10))}` : ""}${tail}.` : `${tail}.`);
  } else if (m.fn === "sum") {
    figures.value = fig(r.value, "value", words);
    figures.n = countFig(r.rows, "value", `${E.plural} counted`);
    parts.push({ fig: "value" }, fd.type === "money" ? " in " : ` ${fd.label} across `, { fig: "n" }, ` ${r.rows === 1 ? E.label : E.plural}${tail}.`);
  } else if (m.fn === "avg") {
    figures.value = { ...fig(r.value == null ? 0 : Math.round(r.value * 100) / 100, "value", words), kind: isMoney ? "money" : "count" };
    figures.n = countFig(r.rows, "value", `${E.plural} counted`);
    parts.push(`The average ${fd.label} is `, { fig: "value" }, " across ", { fig: "n" }, ` ${r.rows === 1 ? E.label : E.plural}${tail}.`);
  } else {
    figures.value = { ...fig(r.value, "value", words), kind: "count" };
    parts.push({ fig: "value" }, ` ${noun}${tail ? (r.value === 1 ? " matches" : " match") + tail : " on file"}`,
      r.list && r.list[0] && plan.list ? `; ${r.list[0].name} first.` : ".");
  }
  const table = plan.groupBy && r.groups ? {
    dimension: plan.groupBy.bucket ? plan.groupBy.bucket : E.fields[plan.groupBy.field].label, compareLabel: null,
    valueLabel: m.fn === "sum" ? `Total ${fd.label}` : m.fn === "count_people" ? "People" : m.fn === "avg" ? `Average ${fd.label}` : E.plural.charAt(0).toUpperCase() + E.plural.slice(1),
    rows: r.groups.map((g, i) => ({ label: g.key, value: { ...fig(g.value, "g" + i, g.key), kind: m.fn === "avg" || m.fn === "sum" ? kindOf : "count" }, compare: null, i })),
  } : null;
  const personRows = (r.list || []).filter(x => x.donor_id);
  const people = personRows.length ? personRows.map(x => ({ donorId: x.donor_id, name: x.name, cents: Math.round(Number(x.amount || 0) * 100) })) : null;
  const recordTable = !people && r.list && r.list.length ? { dimension: E.label, compareLabel: null, valueLabel: E.row.amount !== "NULL::numeric" ? "Amount" : "Date",
    rows: r.list.map((x, i) => ({ label: `${x.name}${x.detail ? ` · ${x.detail}` : ""}`, value: { value: x.amount != null ? Number(x.amount) : 0, kind: x.amount != null && E.amountKind !== "count" ? "money" : "count",
      label: x.name, definition: "This one record.", source: qsrc(plan, "value") }, compare: null, i })) } : null;
  const steps = [];
  if (people && people.length) steps.push({ kind: "plan", label: `Plan calls to the top ${Math.min(5, people.length) === 5 ? "five" : Math.min(5, people.length)}`,
    items: people.slice(0, 5).map(p => ({ donorId: p.donorId, name: p.name, label: "Call" })), dueIn: 1 });
  // The plain sentence (logs, the follow-up box, screen readers) carries the
  // same numbers the figures draw.
  const plainNum = k => { const g = figures[k]; if (!g) return ""; const v = Number(g.value) || 0;
    return g.kind === "money" ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) : v.toLocaleString("en-US", { maximumFractionDigits: 2 }); };
  return { answered: true, kind: "answer", plan: null, qplan: plan, planWords: words, sentence: parts.map(x => (typeof x === "string" ? x : plainNum(x.fig))).join(""),
    sentenceParts: parts.filter(x => x !== ""), figures, parts: null, table: table || recordTable, chart: table && plan.groupBy.bucket ? "bars" : null,
    people, peopleCount: people ? (m.fn === "count_people" || plan.entity === "people" ? r.value : people.length) : null,
    peopleSource: people ? qsrc(plan.entity === "people" ? plan : { ...plan, measure: { fn: "count_people", field: null } }, "value") : null,
    counted: `${words}. Steward read this from your own records and wrote nothing.`, steps };
}


function scoped(plan, scope, C) {
  if (!plan || !scope) return plan;
  const m = C.METRICS[plan.metric];
  if (!m || m.base !== "gifts") return plan;
  const f = { ...(plan.filters || {}) };
  if (scope.campaign && !f.campaign && !f.event) f.campaign = String(scope.campaign);
  if (scope.donor && !f.donor) f.donor = String(scope.donor);
  // A question asked on a campaign's page or a person's record means all of
  // it unless it names a period; on the calendar, the dates on screen.
  if (!plan.period && (scope.campaign || scope.donor)) plan = { ...plan, period: { kind: "all_time" } };
  if (!plan.period && scope.from && scope.to) plan = { ...plan, period: { kind: "custom", from: String(scope.from), to: String(scope.to) } };
  return Object.keys(f).length ? { ...plan, filters: f } : plan;
}

async function askAnswer(orgId, plan, ctx, C) {
  const a = await AE.runPlan(orgId, plan, ctx, { computeRetentionRate, computeDriftForDonors });
  if (plan.also) {
    const b = await AE.runPlan(orgId, { kind: "metric", metric: plan.also, period: { kind: "today" } }, ctx, { computeRetentionRate, computeDriftForDonors });
    a.also = b; a.alsoFig = b.value;
  }
  const s = C.answerSentence(a, plan, ctx);
  const steps = [];
  const f = plan.filters || {};
  if (plan.kind === "who" && a.people && a.people.length)
    steps.push({ kind: "plan", label: `Plan calls to the top ${Math.min(5, a.people.length) === 1 ? "one" : Math.min(5, a.people.length) === 5 ? "five" : Math.min(5, a.people.length)}`,
      items: a.people.slice(0, 5).map(p => ({ donorId: p.donorId, name: p.name, label: "Call" })), dueIn: 1 });
  else if (C.METRICS[plan.metric].base === "gifts" && plan.metric !== "first_year_retention" && !f.donor) steps.push({ kind: "ask", label: "Who are they?", text: "Who are they?" });
  else if (["lapsed_count", "recurring_donors", "volunteer_count"].includes(plan.metric)) steps.push({ kind: "ask", label: "Who are they?", text: "Who are they?" });
  if (f.campaign || plan.metric === "campaign_progress") steps.push({ kind: "open", label: "Open the campaign", href: `/app/fundraising?fr=campaigns&campaign=${encodeURIComponent(f.campaign || "")}` });
  if (plan.metric === "retention_rate") steps.push({ kind: "ask", label: "Why is retention down?", text: "Why is retention down this year?" });
  const table = a.groups ? { dimension: C.DIMENSIONS[plan.groupBy], compareLabel: a.comparePeriod ? a.comparePeriod.label : null,
    rows: a.groups.map((g, i) => ({ label: g.key, value: g.value, compare: g.compare || null, i })) } : null;
  return { answered: true, kind: "answer", plan, planWords: a.words, sentence: s.plain, sentenceParts: s.parts,
    figures: { value: a.value, compare: a.compare || null, change: a.changeFig || null, also: a.alsoFig || null,
      part0: (a.parts || [])[0] || null, part1: (a.parts || [])[1] || null, group0: a.groups && a.groups[0] ? a.groups[0].value : null },
    parts: a.parts || null, table, chart: table && ["month", "quarter", "year"].includes(plan.groupBy) ? "bars" : null,
    people: a.people || null, peopleCount: a.peopleCount ?? null, peopleSource: a.peopleSource || null,
    counted: a.counted, steps };
}

// ASK-4: the query layer, for a question nothing above could take. Returns the
// answer to send, or null (AI off, the model could not read it, or the catalog
// cannot express it; the caller then refuses as before).
function queryFollowUps(plan) {
  const E = AQ.ENTITIES[plan.entity];
  const out = [];
  if (E.person && !plan.list && plan.measure.fn !== "min" && plan.measure.fn !== "max")
    out.push({ text: plan.entity === "gifts" ? "Who gave them?" : "Who are they?",
      go: { via: "ask", qplan: { ...plan, list: true, groupBy: null, measure: plan.entity === "people" ? { fn: "count", field: null } : { fn: "count_people", field: null } } } });
  const dateField = plan.entity === "people" ? null : Object.keys(E.fields).find(k => E.fields[k].type === "date");
  if (!plan.groupBy && dateField && !plan.list) out.push({ text: "By month", go: { via: "ask", qplan: { ...plan, groupBy: { field: dateField, bucket: "month" } } } });
  if (!plan.groupBy && dateField && !plan.list) out.push({ text: "By year", go: { via: "ask", qplan: { ...plan, groupBy: { field: dateField, bucket: "year" } } } });
  return out.slice(0, 3);
}
async function runQueryPlan(req, plan, typed, source) {
  const today = orgToday(await orgTz(req.user.orgId));
  const r = await AQ.runQuery(req.user.orgId, plan, today);
  if (source !== "replay") await logQuestion(req.user.orgId, typed || "(query)", `query: ${plan.entity}`, true);
  const a = queryAnswerShape(plan, r);
  return { ...a, question: { text: typed }, planSource: source, followUps: queryFollowUps(plan) };
}
async function tryQuery(req, typed, previousQuery = null) {
  if (!typed) return null;
  const orgId = req.user.orgId;
  const gate = await aiGate(orgId);
  if (!gate.ok) return null;
  try {
    const today = orgToday(await orgTz(orgId));
    const catalog = AQ.catalogText(await AQ.catalogValues(orgId));
    const prev = previousQuery && typeof previousQuery === "object" ? AQ.validateQuery(previousQuery) : null;
    const out = await anthropicFor(orgId).messages.create({
      model: AGENT_MODEL, max_tokens: 1500, tools: [AQ.queryTool()], tool_choice: { type: "tool", name: "query_plan" },
      messages: [{ role: "user", content: AQ.queryPrompt(typed, { today, catalog, previous: prev && prev.ok ? prev.plan : null }) }],
    });
    const raw = AQ.readQueryTool(out.content);
    if (!raw || raw.answerable === false) return { refused: raw && raw.unsupported ? String(raw.unsupported).slice(0, 120) : null };
    const chk = AQ.validateQuery(raw);
    if (!chk.ok) return { refused: chk.refused };
    return { answer: await runQueryPlan(req, chk.plan, typed, "query") };
  } catch (e) {
    recordAiFallback(orgId, "ask.query_layer", e);
    return null;
  }
}

async function askRefuse(req, res, typed, what, C, extra = {}, sentence = null) {
  await logQuestion(req.user.orgId, typed || "(plan)", "ask: refused", false);
  // ASK-3: never a neighbouring list; the three closest questions it can answer.
  const G = await guide();
  const [campaigns, canSeeMore] = await Promise.all([WHY.comparableCampaigns(req.user.orgId), P.canSee(req.user.userId)]);
  const followUps = G.closestQuestions(typed, G.guidedLists({ campaigns, canSeeMore }));
  return res.json({ answered: false, refused: true, kind: "answer", sentence: sentence || C.refusalSentence(what), question: { text: typed }, followUps, ...extra });
}

// ── ASK-3 · ONE PERSON ──────────────────────────────────────────────────────
// The person answer (why.js `person`), in Ask why's own shape, so every reason
// opens her rows through the figure source `why`.
const INTENT_WORDS = { ask: "what to ask for", next: "the next step", changed: "this year against last", stopped: "why they stopped" };
async function personAnswer(req, res, { donor, intent, campaign, typed }) {
  const Sx = await shape();
  const G = await guide();
  const orgId = req.user.orgId;
  if (intent === "stopped") { req.body = { key: "stopped", donor, ...(typed ? { text: typed } : {}) }; return whyAskHandler(req, res); }
  if (intent === "done") return personActivity(req, res, { donor, typed });
  const a = await WHY.answer(orgId, "person", { donor, intent, campaign, user: req.user.userId }, { computeDriftForDonors });
  if (!a) return res.status(404).json({ error: "Donor not found" });
  a.key = "person";
  const generic = { ask: "What should I ask this person for?", next: "What's the next step with this person?", changed: "Why did this person's giving change?" }[a.intent];
  await logQuestion(orgId, typed || generic, "person", true);
  const qText = typed || generic.replace("this person", a.donor.name);
  const s = await writeSentence(orgId, generic.replace("this person", a.donor.name), a, Sx);
  const today = orgToday(await orgTz(orgId));
  const params = { q: "person", donor: a.donor.id, intent: a.intent, user: req.user.userId, ...(campaign ? { campaign } : {}) };
  const st = a.facts.stand;
  const out = {
    answered: true, question: { key: "person", text: qText }, donor: a.donor, campaign: null, compare: null,
    person: { id: a.donor.id, name: a.donor.name, intent: a.intent, lapsed: a.reasons.some(r => r.key === "drift"), ...(campaign ? { campaign } : {}) },
    readAs: [a.donor.name, INTENT_WORDS[a.intent], st && (st.thenCents || st.nowCents) ? st.campaignName : null].filter(Boolean).join(" · "),
    sentence: s.sentence, sentenceSource: s.source, template: s.template, aiOff: !!s.aiOff,
    reasons: a.reasons.map(r => publicReason(r, params)), who: a.who, cantSee: a.cantSee,
    step: a.step ? { ...a.step, due: orgTime.addDays(today, a.step.dueIn || 1) } : null,
    alsoSteps: (a.alsoSteps || []).map(x => ({ ...x, due: orgTime.addDays(today, x.dueIn || 7),
      ...(x.fallback ? { fallback: { ...x.fallback, due: orgTime.addDays(today, x.fallback.dueIn || 7) } } : {}) })),
  };
  res.json({ ...out, followUps: G.followUpsFor(out, { canSeeMore: await P.canSee(req.user.userId) }) });
}

// WIRE-1 · "What has Rafael done with us this year?" One line per kind of
// involvement, each a figure that opens its rows: gifts and hours through the
// profile's own sources, everything else through donor-activity. The period is
// this year, last year, or (when the question names neither) their whole
// history. The sentence is a template built from the same numbers, so there is
// nothing for a model to get wrong and nothing to check.
const ACTIVITY_LINES = [
  // [key, label, source key, measure, singular, plural]
  ["gifts", "Gave", "donor-gifts-between", "sum", "gift", "gifts"],
  ["hours", "Volunteered", "volunteer-hours", "hours", "shift", "shifts"],
  ["events", "Events", "donor-activity", "count", "event", "events"],
  ["memberships", "Membership", "donor-activity", "count", "membership", "memberships"],
  ["fundraising", "Raised on their peer-to-peer page", "donor-activity", "sum", "page", "pages"],
  ["auction", "Bid at an auction", "donor-activity", "count", "item", "items"],
  ["pledges", "Pledged", "donor-activity", "sum", "pledge", "pledges"],
  ["conversations", "Conversations and meetings", "donor-activity", "count", "conversation", "conversations"],
  ["journeys", "Journeys", "donor-activity", "count", "journey", "journeys"],
];
async function personActivity(req, res, { donor, typed }) {
  const G = await guide();
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT id, name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [donor, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));
  const y = today.slice(0, 4);
  const t = String(typed || "");
  const period = /\blast year\b/i.test(t) ? { from: `${+y - 1}-01-01`, to: `${+y - 1}-12-31`, words: "last year" }
    : /\b(ever|all time|always|history)\b/i.test(t) || !/\bthis year\b|\byear\b/i.test(t) && typed ? { from: "1900-01-01", to: today, words: "in all their history with you" }
    : { from: `${y}-01-01`, to: today, words: "this year" };
  const lines = [];
  for (const [key, label, src, measure, one, many] of ACTIVITY_LINES) {
    const params = { donor: d.id, from: period.from, to: period.to, ...(src === "donor-activity" ? { part: key } : {}) };
    const f = await FS.figure(orgId, { key: src, params }, {}, { rows: false });
    if (!f || !f.totalRows) continue;
    const def = await FS.figureSentence({ key: src, params });
    const amount = measure === "sum" ? f.cents : measure === "hours" ? Number(f.value) || 0 : null;
    lines.push({ key, label, count: f.totalRows, cents: measure === "sum" ? f.cents : 0, hours: measure === "hours" ? amount : null,
      measure: measure === "sum" ? "sum" : "count", unit: f.totalRows === 1 ? one : many, definition: def, source: { key: src, params } });
  }
  const f = firstName(d.name);
  const bits = lines.slice(0, 4).map(l => l.key === "gifts" ? `gave ${fmtUsd(l.cents)} in ${spellN(l.count)} ${l.unit}`
    : l.key === "hours" ? `volunteered ${l.hours} ${l.hours === 1 ? "hour" : "hours"} over ${spellN(l.count)} ${l.unit}`
    : l.key === "events" ? `was at or registered for ${spellN(l.count)} ${l.unit}`
    : l.key === "memberships" ? "held a membership"
    : l.key === "fundraising" ? `raised ${fmtUsd(l.cents)} on a peer-to-peer page`
    : l.key === "auction" ? `bid on ${spellN(l.count)} auction ${l.unit}`
    : l.key === "pledges" ? `pledged ${fmtUsd(l.cents)}`
    : l.key === "conversations" ? `had ${spellN(l.count)} ${l.unit} with you`
    : `was on ${spellN(l.count)} ${l.unit}`);
  const sentence = lines.length
    ? `${period.words === "this year" ? "This year" : period.words === "last year" ? "Last year" : "Over all their history with you"}, ${d.name} ${bits.length > 1 ? bits.slice(0, -1).join(", ") + " and " + bits[bits.length - 1] : bits[0]}${lines.length > 4 ? ", and more below" : ""}.`
    : `${d.name} has nothing on their record ${period.words} yet: no gifts, hours, events, memberships or conversations.`;
  await logQuestion(orgId, typed || "What has this person done with us?", "person: done", true);
  const out = {
    answered: true, question: { key: "person", text: typed || `What has ${d.name} done with us ${period.words}?` }, donor: { id: d.id, name: d.name },
    campaign: null, compare: null, person: { id: d.id, name: d.name, intent: "done" },
    readAs: `${d.name} · everything they have done with you, ${period.words}`,
    sentence, sentenceSource: "template", template: sentence, aiOff: false,
    reasons: lines, who: [{ donorId: d.id, name: d.name, cents: null, reason: `Open ${f}'s record for the whole timeline.` }],
    cantSee: "This reads what is on their record in Steward. Time they gave that nobody logged is not here.",
    step: null, alsoSteps: [],
  };
  res.json({ ...out, followUps: G.followUpsFor(out, { canSeeMore: await P.canSee(req.user.userId) }) });
}

// "What should I ask them for?" / "the top five": the people the last answer
// named, in its order, each with the suggested ask from their own gifts.
async function peopleAsks(req, res, { typed, list, n }) {
  const orgId = req.user.orgId;
  const G = await guide();
  const E = require("../engagement");
  const ids = list.slice(0, Math.min(n, 20)).map(p => String(p.id));
  const rows = await query(`SELECT id, name FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL`, [orgId, ids]);
  const byId = new Map(rows.map(r => [r.id, r]));
  const people = ids.map(id => byId.get(id)).filter(Boolean);
  if (!people.length) return askRefuse(req, res, typed, "that question", await askCat());
  const asks = await Promise.all(people.map(p => E.suggestedAsk(query, orgId, p.id).catch(() => null)));
  const who = people.map((p, i) => ({ donorId: p.id, name: p.name, cents: asks[i] ? asks[i].askCents : null,
    reason: asks[i] ? `Suggested ask ${fmtUsd(asks[i].askCents)}, from their own gifts.` : "No suggested ask; there are no gifts on their record." }));
  await logQuestion(orgId, typed, "person: the list", true);
  const firstAsk = who.find(w => w.cents);
  const today = orgToday(await orgTz(orgId));
  const out = {
    answered: true, question: { key: "people", text: typed }, campaign: null, compare: null, donor: null,
    readAs: `${who.length === 1 ? "One person" : `The first ${who.length}`} from the last answer · suggested asks`,
    sentence: firstAsk ? `Here ${who.length === 1 ? "is the suggested ask" : `are suggested asks for ${spellN(who.length)} people`} from the last answer, each from their own gifts; ${firstAsk.name} is first at ${fmtUsd(firstAsk.cents)}.`
      : "None of these people has a gift on file to suggest an ask from.",
    sentenceSource: "template", reasons: [], who, cantSee: "A suggested ask is worked out from their own gifts only; it is a starting point for your judgment.",
    step: { kind: "plan", label: `Plan calls to ${who.length === 1 ? "them" : `all ${spellN(who.length)}`}`, items: who.map(w => ({ donorId: w.donorId, name: w.name, label: w.cents ? `Ask for ${fmtUsd(w.cents)}` : "Call" })), dueIn: 1, due: orgTime.addDays(today, 1) },
    alsoSteps: [],
  };
  res.json({ ...out, followUps: G.followUpsFor({ ...out, part: "list" }, { canSeeMore: await P.canSee(req.user.userId) }) });
}

// Who a typed question is about. The thread first (anyone named in the last
// answer), then the org. One clear match, several (she picks), or none.
async function orgWordsFor(orgId) {
  const rows = await query(`SELECT name FROM campaigns WHERE org_id = ? UNION SELECT name FROM events WHERE org_id = ?
     UNION SELECT name FROM fin_funds WHERE org_id = ?`, [orgId, orgId, orgId]);
  const w = new Set();
  for (const r of rows) for (const t of String(r.name || "").toLowerCase().split(/[^a-z']+/)) if (t.length > 2) w.add(t);
  return w;
}
async function candidatesFor(orgId, ids) {
  if (!ids.length) return [];
  const rows = await query(`SELECT d.id, d.name, d.city, (SELECT g.amount FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount > 0 ORDER BY g.date DESC LIMIT 1) AS last_amount,
       (SELECT LEFT(MAX(g.date),10) FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount > 0) AS last_date
     FROM donors d WHERE d.org_id = ? AND d.id = ANY(?) AND d.deleted_at IS NULL LIMIT 8`, [orgId, ids]);
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id) - order.get(b.id));
  return rows.map(r => ({ donorId: r.id, name: r.name, city: r.city || "", lastGift: r.last_amount != null ? { cents: Math.round(Number(r.last_amount) * 100), date: r.last_date } : null }));
}
async function resolvePerson(orgId, text, context, G) {
  const people = Array.isArray(context && context.people) ? context.people.filter(p => p && p.id && p.name).slice(0, 60) : [];
  const lc = String(text || "").toLowerCase();
  // A full name, in the thread and then on file.
  const inThread = people.filter(p => p.name.length > 3 && lc.includes(p.name.toLowerCase()));
  if (inThread.length) return { kind: "one", donor: inThread.sort((a, b) => b.name.length - a.name.length)[0] };
  const full = await query(`SELECT id, name FROM donors WHERE org_id = ? AND deleted_at IS NULL AND LENGTH(name) > 3
      AND POSITION(LOWER(name) IN LOWER(?)) > 0 ORDER BY LENGTH(name) DESC LIMIT 6`, [orgId, String(text || "")]);
  if (full.length) {
    const best = full.filter(d => d.name.length === full[0].name.length && d.name.toLowerCase() === full[0].name.toLowerCase());
    return best.length === 1 ? { kind: "one", donor: best[0] } : { kind: "many", ids: best.map(d => d.id), word: full[0].name };
  }
  const orgWords = await orgWordsFor(orgId);
  // A full name typed (two capitalised words together) that matches nobody, in
  // the thread or on file: say so, never offer the other people with that first name.
  const pair = (String(text || "").match(/\b([A-Z][a-z'-]{2,}) ([A-Z][a-z'-]{2,})\b/g) || [])
    .filter(x => x.split(" ").every(w => G.capitalisedNames("x " + w, orgWords).length === 1));
  if (pair.length) return { kind: "none", word: pair[0] };
  for (const tok of G.nameTokens(text, orgWords)) {
    const t = tok.toLowerCase();
    const part = n => String(n).toLowerCase().split(/\s+/);
    const hits = people.filter(p => { const w = part(p.name); return w[0] === t || w[w.length - 1] === t; });
    if (hits.length === 1) return { kind: "one", donor: hits[0] };
    if (hits.length > 1) return { kind: "many", ids: hits.map(h => h.id), word: tok };
    const rows = await query(`SELECT d.id, d.name, COUNT(*) OVER () AS n FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL
        AND (LOWER(split_part(d.name, ' ', 1)) = ? OR LOWER(regexp_replace(d.name, '^.* ', '')) = ?)
        ORDER BY (SELECT MAX(g.date) FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount > 0) DESC NULLS LAST, d.name LIMIT 6`, [orgId, t, t]);
    if (rows.length === 1) return { kind: "one", donor: rows[0] };
    if (rows.length > 1) return { kind: "many", ids: rows.map(r => r.id), word: tok, total: Number(rows[0].n) };
  }
  const unknown = G.capitalisedNames(text, orgWords);
  if (unknown.length) return { kind: "none", word: unknown.join(" ") };
  // No name: "her" / "him" means the person the thread is on.
  if (G.PRONOUN_ONE.test(text)) {
    if (context && context.lastPerson && context.lastPerson.id) return { kind: "one", donor: context.lastPerson };
    if (people.length === 1) return { kind: "one", donor: people[0] };
    if (people.length > 1) return { kind: "many", ids: people.slice(0, 6).map(p => p.id), word: "that" };
  }
  return null;
}

// ASK-3: questions Steward has no computation for yet, refused by name and
// logged, never answered with a neighbouring question. They go to the next build.
const NOT_YET = [
  [/\b(behind|short of|under|below|off) (its |the |our )?(goal|target)\b|\bmiss(ed|ing)? (its |the |our )?goal\b/i, "why a campaign is behind its goal"],
  [/\bwhy did\b.*\b(event|gala|dinner|run|auction|supper|lunch|breakfast)\b.*\braise\b|\bwhy did\b.*\b(event|gala)\b/i, "why an event raised what it did"],
  [/\b(monthly|recurring)\b.*\b(drop|down|fell|fall|declin|lower|less)\w*|\bwhy\b.*\b(monthly|recurring) giving\b/i, "why monthly giving changed"],
];

app.post("/ask", whyAskLimiter, requireAuth, wrap((req, res) => askHandler(req, res)));
app.post("/ask/preview", whyAskLimiter, requireAuth, wrap((req, res) => ASK_PREVIEW.run(true, () => askHandler(req, res))));
async function askHandler(req, res) {
  const C = await askCat();
  const Sx = await shape();
  const SM = await showMod();
  const orgId = req.user.orgId;
  const body = req.body || {};
  const typed = String(body.text || "").trim().slice(0, 500);
  const prev = body.previous && typeof body.previous === "object" && !Array.isArray(body.previous) ? body.previous : null;
  const scope = body.scope && typeof body.scope === "object" ? body.scope : null;
  const ctx = await AE.askContext(orgId);
  let raw = null, source = "template", restatement = null, person = null;
  const G = await guide();
  const canSeeMore = await P.canSee(req.user.userId);

  // ASK-3: a question about one person, from the Why and What rail.
  if (body.person && typeof body.person === "object") {
    const [d] = await query(`SELECT id, name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [String(body.person.donor || ""), orgId]);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    const intent = String(body.person.intent || "");
    const campaign = body.person.campaign ? String(body.person.campaign) : null;
    if (["ask", "next", "changed", "stopped", "done"].includes(intent)) return personAnswer(req, res, { donor: d.id, intent, campaign, typed });
    if (intent !== "given") return askRefuse(req, res, typed || "(person)", "that question about one person", C);
    raw = { kind: "metric", metric: "raised", period: { kind: "all_time" }, groupBy: "campaign", filters: { donor: d.id } };
    source = "guided"; person = { id: d.id, name: d.name, intent };
  }
  // ASK-3: a typed question about one person, read against the thread.
  const context = body.context && typeof body.context === "object" ? body.context : null;
  if (!raw && typed && !body.plan) {
    const nope = NOT_YET.find(([re]) => re.test(typed));
    if (nope) return askRefuse(req, res, typed, nope[1], C);
    let intent = G.personIntent(typed);
    const follow = G.isNameFollowUp(typed);
    // "the top five", "what should I ask them for": the last answer's people.
    const topOnly = G.topN(typed) && /\bthe top\b/i.test(typed) && !/\b(donors?|givers?|year|month|quarter|fund|campaign|gifts?)\b/i.test(typed);
    const list = context && Array.isArray(context.list) ? context.list : context && Array.isArray(context.people) ? context.people : [];
    if (list.length > 1 && !G.PRONOUN_ONE.test(typed)
        && (topOnly || (G.PRONOUN_MANY.test(typed) && intent === "ask"))) {
      return peopleAsks(req, res, { typed, list, n: G.topN(typed) || 5 });
    }
    if (intent || follow || G.PRONOUN_ONE.test(typed)) {
      const who = await resolvePerson(orgId, typed, context, G);
      if (who && !intent) intent = (context && context.lastPerson && context.lastPerson.intent) || "ask";
      const campaign = context && context.campaign ? String(context.campaign) : null;
      if (who && who.kind === "one") {
        if (intent === "given") { raw = { kind: "metric", metric: "raised", period: { kind: "all_time" }, groupBy: "campaign", filters: { donor: who.donor.id } }; source = "guided"; person = { id: who.donor.id, name: who.donor.name, intent }; }
        else return personAnswer(req, res, { donor: who.donor.id, intent, campaign, typed });
      } else if (who && who.kind === "many") {
        await logQuestion(orgId, typed, "person: which one", false);
        const cands = await candidatesFor(orgId, who.ids);
        return res.json({ answered: false, kind: "choose", question: { text: typed },
          sentence: who.word === "that" ? "Which person do you mean?"
            : (who.total || cands.length) > cands.length ? `Steward has ${who.total} people named ${who.word}; here are the ${spellN(cands.length)} who gave most recently. Which one do you mean?`
            : `Steward has ${spellN(cands.length)} people named ${who.word}. Which one do you mean?`,
          candidates: cands.map(c => ({ ...c, go: { via: "person", donor: c.donorId, intent, ...(campaign ? { campaign } : {}) } })) });
      } else if (who && who.kind === "none") {
        return askRefuse(req, res, typed, null, C, {}, `Steward has no one named ${who.word} on file.`);
      }
    }
  }
  if (body.qplan && typeof body.qplan === "object") {
    const chk = AQ.validateQuery(body.qplan);
    if (!chk.ok) return askRefuse(req, res, typed || "(query)", chk.refused, C);
    return res.json(await runQueryPlan(req, chk.plan, typed, "replay"));
  }
  if (body.plan && typeof body.plan === "object") { raw = body.plan; source = "saved"; }
  if (!raw && prev && typed) { raw = C.followUp(prev, typed, ctx); if (raw) source = "follow-up"; }
  let t = null;
  if (!raw && typed) {
    t = C.templatePlan(typed, ctx);
    if (t.plan) raw = t.plan;
    else if (t.named) {
      const q = await tryQuery(req, typed, body.previousQuery);
      if (q && q.answer) return res.json(q.answer);
      return askRefuse(req, res, typed, (q && q.refused) || t.unsupported, C);
    }
  }
  // ASK-4 · WHAT WAS ASKED, NOT THE NEAREST QUESTION. With AI on, a question
  // that is not asking WHY and not asking for a RECOMMENDATION goes to the query
  // layer first, which answers exactly the conditions it names. The why answers
  // keep "why…" and "who should I call / ask / thank", "who could give more",
  // "who is about to lapse"; the catalog model below keeps what the query layer
  // cannot express (retention, medians, pledges). Before this, "how many people
  // made their first gift in 2026" was answered as "which first-time donors
  // need a second ask", and "recurring AND volunteers" as monthly donors.
  // HARDEN-1 · A "WHO" QUESTION IS ANSWERED WITH PEOPLE. "Who gave over $500
  // but hasn't been thanked?" went to the query layer, whose model planned it
  // over GIFTS ("26 gifts match", 23 people on file). When the donor list's
  // own filters read every word of a who/which question, that filter is the
  // exact answer and the list of people is what she asked for.
  if (!raw && typed && /^\s*(who|which)\b/i.test(typed) && !Sx.matchQuestion(typed) && SM.isShowMe(typed)) {
    const ts = SM.templateSpec(typed, { today: ctx.today, events: ctx.events, campaigns: ctx.campaigns });
    if (Object.keys(ts.rules).length && !ts.unsupported) return showMe(req, res, typed, ts);
  }
  const RECOMMEND = /^\s*why\b|\b(should|could|ought to|need to|needs?|about to|at risk|likely to|going to)\b|\bwho (do|can) i (call|ask|thank)\b/i;
  if (!raw && typed && !RECOMMEND.test(typed)) {
    const q = await tryQuery(req, typed, body.previousQuery);
    if (q && q.answer) return res.json(q.answer);
  }
  // A why or who question: Ask why and Show me, unchanged.
  if (!raw && typed && (Sx.matchQuestion(typed) || SM.listFirst(typed) || SM.isShowMe(typed))) {
    req.body = { text: typed, ...(scope && scope.campaign ? { campaign: scope.campaign } : {}), ...(scope && scope.donor ? { donor: scope.donor } : {}) };
    return whyAskHandler(req, res);
  }
  // AI on: the model fills the plan's form. It never writes a number.
  if (!raw && typed) {
    const gate = await aiGate(orgId);
    if (gate.ok) {
      try {
        const out = await anthropicFor(orgId).messages.create({
          model: AGENT_MODEL, max_tokens: 700, tools: [C.planTool({ ruleKeys: GR.RULE_KEYS })], tool_choice: { type: "tool", name: "ask_plan" },
          messages: [{ role: "user", content: C.planPrompt(typed, ctx, prev) }],
        });
        const m = C.readPlanTool(out.content);
        if (m) {
          // ASK-3: the model's "read as" line is shown only if it is plain and
          // every number in it is one the person typed or the plan holds.
          const r = String(m.restatement || "").trim(), allowed = Sx.allowedNumbers({ q: typed, plan: JSON.stringify(m) });
          restatement = r && G.sentenceIsPlain(r) && Sx.numbersIn(r).every(n => allowed.has(Math.round(n * 100) / 100)) ? r : null;
          delete m.restatement; raw = m; source = "ai";
        }
      } catch (e) { recordAiFallback(orgId, "ask.plan", e); /* the template's reading stands, and is counted */ }
    }
  }
  if (!raw) {
    const q = await tryQuery(req, typed, body.previousQuery);
    if (q && q.answer) return res.json(q.answer);
    return askRefuse(req, res, typed, (q && q.refused) || (t && t.unsupported) || "that question", C);
  }
  const chk = C.validatePlan(scoped(raw, scope, C), ctx);
  if (!chk.ok) {
    if (typed && source !== "saved") {
      const q = await tryQuery(req, typed, body.previousQuery);
      if (q && q.answer) return res.json(q.answer);
    }
    return askRefuse(req, res, typed, chk.refused, C, { planSource: source });
  }
  const plan = { ...chk.plan, ...(raw.also && C.METRICS[raw.also] ? { also: raw.also } : {}) };
  const answer = await askAnswer(orgId, plan, ctx, C);
  // A follow-up is logged as one, so "who are they?" is never offered as a question on its own.
  if (source !== "saved") await logQuestion(req.user.orgId, typed || "(plan)", `ask: ${plan.metric}${source === "follow-up" ? " (follow-up)" : ""}`, true);
  const out = { ...answer, question: { text: typed }, planSource: source, restatement, ...(person ? { person } : {}) };
  res.json({ ...out, followUps: G.followUpsFor(out, { canSeeMore }) });
}

// ── PINNED TO HOME ─────────────────────────────────────────────────────────
// The plan is kept, never the answer: Home re-runs it every time it opens, so
// a pinned number is always today's. Mine only.
app.get("/ask/pins", requireAuth, wrap(async (req, res) => {
  const rows = await query(`SELECT id, question, plan, created_at FROM ask_pins WHERE org_id = ? AND user_id = ? ORDER BY created_at LIMIT 12`,
    [req.user.orgId, req.user.userId]);
  res.json({ pins: rows.map(r => ({ id: r.id, question: r.question, plan: typeof r.plan === "string" ? JSON.parse(r.plan) : r.plan })) });
}));
app.post("/ask/pins", requireAuth, wrap(async (req, res) => {
  const C = await askCat();
  const ctx = await AE.askContext(req.user.orgId);
  const chk = C.validatePlan((req.body || {}).plan, ctx);
  if (!chk.ok) return res.status(400).json({ error: "plan_refused", sentence: C.refusalSentence(chk.refused) });
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM ask_pins WHERE org_id = ? AND user_id = ?`, [req.user.orgId, req.user.userId]);
  if (n >= 12) return res.status(400).json({ error: "too_many", sentence: "Home holds twelve pinned answers. Unpin one first." });
  const id = "pin_" + require("crypto").randomBytes(6).toString("hex");
  const plan = { ...chk.plan, ...(req.body.plan.also && C.METRICS[req.body.plan.also] ? { also: req.body.plan.also } : {}) };
  await run(`INSERT INTO ask_pins (id, org_id, user_id, question, plan, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)`,
    [id, req.user.orgId, req.user.userId, String((req.body || {}).question || "").slice(0, 300), JSON.stringify(plan), req.user.userId, req.user.name || req.user.email || "staff"]);
  res.status(201).json({ id, sentence: "Pinned to Home. It is worked out again every time Home opens." });
}));
app.delete("/ask/pins/:id", requireAuth, wrap(async (req, res) => {
  const out = await run(`DELETE FROM ask_pins WHERE id = ? AND org_id = ? AND user_id = ?`, [req.params.id, req.user.orgId, req.user.userId]);
  res.json({ ok: true, removed: out && out.changes !== undefined ? out.changes : null });
}));

// ── SAVED TO A DASHBOARD (REPORTS-3) ───────────────────────────────────────
// The answer's headline figure becomes a tile on one of her own dashboards:
// the figure source "ask" with this plan, worked out again every time the
// dashboard (or the board pack) is drawn. Only the dashboard's owner edits it.
app.post("/ask/save-to-dashboard", requireAuth, wrap(async (req, res) => {
  const C = await askCat();
  const b = req.body || {};
  const ctx = await AE.askContext(req.user.orgId);
  const chk = C.validatePlan(b.plan, ctx);
  if (!chk.ok) return res.status(400).json({ error: "plan_refused", sentence: C.refusalSentence(chk.refused) });
  const m = C.METRICS[chk.plan.metric];
  if (m.base !== "gifts" && m.base !== "donors") return res.status(400).json({ error: "not_a_tile", sentence: `${m.label} already has its own figure in Reports; add that one to the dashboard.` });
  const [d] = await query("SELECT id, tiles FROM saved_dashboards WHERE id = ? AND org_id = ? AND owner_id = ?", [String(b.dashboardId || ""), req.user.orgId, req.user.userId]);
  if (!d) return res.status(404).json({ error: "Not found", sentence: "Only the person who made a dashboard can add to it." });
  const tiles = typeof d.tiles === "string" ? JSON.parse(d.tiles || "[]") : (d.tiles || []);
  if (tiles.length >= 24) return res.status(400).json({ error: "too_many", sentence: "That dashboard is full. Take a tile off first." });
  const cell = chk.plan.top ? "top" : m.base === "donors" ? "cur" : "cur";
  tiles.push({ kind: "figure", source: "ask", label: String(b.label || "").slice(0, 120) || C.planWords(chk.plan, ctx).slice(0, 120), params: { plan: JSON.stringify(chk.plan), cell } });
  await run("UPDATE saved_dashboards SET tiles = ?, updated_at = NOW() WHERE id = ? AND org_id = ?", [JSON.stringify(tiles), d.id, req.user.orgId]);
  res.json({ ok: true, tiles: tiles.length });
}));

// ── ASK-3 · WHY AND WHAT ───────────────────────────────────────────────────
// GET /ask/guided?donor= — the questions behind the two buttons, written from
// the org's own names, and whether the free box shows (AI on). Read-only.
app.get("/ask/guided", requireAuth, wrap(async (req, res) => {
  const G = await guide();
  const orgId = req.user.orgId;
  let donor = null;
  if (req.query.donor) {
    const [d] = await query(`SELECT id, name, (SELECT MAX(LEFT(date,10)) FROM gifts g WHERE g.org_id = donors.org_id AND g.donor_id = donors.id AND g.amount > 0) AS last
       FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [String(req.query.donor), orgId]);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    // "Why did they stop?" is offered only to someone who has: no gift in a year.
    const today = orgToday(await orgTz(orgId));
    donor = { id: d.id, name: d.name, gave: !!d.last, lapsed: !!d.last && d.last < orgTime.addDays(today, -365) };
  }
  const [campaigns, canSeeMore, gate] = await Promise.all([
    donor ? [] : WHY.comparableCampaigns(orgId), P.canSee(req.user.userId), aiGate(orgId)]);
  res.json({ ...G.guidedLists({ campaigns, canSeeMore, donor }), ai: !!gate.ok });
}));

// The questions under the box: the org's own most-asked, answered ones.
app.get("/ask/suggestions", requireAuth, wrap(async (req, res) => {
  const C = await askCat();
  const rows = await query(
    `SELECT question, COUNT(*)::int AS n FROM question_log
      WHERE surface = 'why' AND answered IS TRUE AND org_id = ? AND question NOT IN ('(empty)', '(plan)', '(saved answer)')
        AND COALESCE(topic, '') NOT LIKE '%(follow-up)'
        AND LENGTH(question) BETWEEN 8 AND 120
      GROUP BY question ORDER BY n DESC, MAX(created_at) DESC LIMIT 6`, [req.user.orgId]).catch(() => []);
  const asked = rows.map(r => r.question);
  const out = [...asked, ...C.STARTERS.filter(q => !asked.includes(q))].slice(0, 6);
  res.json({ suggestions: out, fromLog: asked.length });
}));
}

module.exports = { routers, mount };
