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
const express = require("express");
const WHY = require("../why");
const AW = require("../appealWhy");
const P = require("../prospect");
const GR = require("../groups");

const routers = { r0: express.Router() };

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
async function logQuestion(orgId, text, topic, answered) {
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
    const out = await anthropicFor(orgId).messages.create({
      model: AGENT_MODEL, max_tokens: 200,
      messages: [{ role: "user", content: Sx.sentencePrompt(questionText, facts) }],
    });
    const text = (out.content || []).filter(b => b.type === "text").map(b => b.text).join(" ").replace(/\s+/g, " ").trim();
    if (text && Sx.sentencePasses(text, facts)) return { sentence: text, source: "ai", template, aiOff: false };
    return { sentence: template, source: "template", template, aiOff: false, refused: text ? "numbers" : "empty" };
  } catch (e) {
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
async function showMe(req, res, typed) {
  const SM = await showMod();
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));
  const [events, campaigns] = await Promise.all([
    query(`SELECT id, name, date::text AS date FROM events WHERE org_id = ? ORDER BY date DESC LIMIT 200`, [orgId]),
    query(`SELECT id, name, start_date::text AS "startDate" FROM campaigns WHERE org_id = ? ORDER BY start_date DESC NULLS LAST LIMIT 200`, [orgId]),
  ]);
  const ctx = { today, events, campaigns };
  let spec = null, specSource = "template", aiOff = false;
  const gate = await aiGate(orgId);
  if (gate.ok) {
    try {
      const out = await anthropicFor(orgId).messages.create({
        model: AGENT_MODEL, max_tokens: 600, tools: [SM.specTool()], tool_choice: { type: "tool", name: "filter_spec" },
        messages: [{ role: "user", content: SM.specPrompt(typed, ctx) }],
      });
      spec = SM.readToolSpec(out.content);
      if (spec) specSource = "ai";
    } catch (e) { spec = null; aiOff = !!(e && e.code === "ai_off"); }
  } else aiOff = gate.reason === "ai_disabled";
  if (!spec) spec = SM.templateSpec(typed, ctx);
  const refuse = async what => {
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
  const s = await writeSentence(orgId, qText, a, Sx);
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

async function askRefuse(req, res, typed, what, C, extra = {}) {
  await logQuestion(req.user.orgId, typed || "(plan)", "ask: refused", false);
  return res.json({ answered: false, refused: true, kind: "answer", sentence: C.refusalSentence(what), question: { text: typed }, ...extra });
}

app.post("/ask", whyAskLimiter, requireAuth, wrap(async (req, res) => {
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
    if (intent === "stopped") { req.body = { key: "stopped", donor: d.id }; return whyAskHandler(req, res); }
    const by = { changed: "year", given: "campaign" }[intent];
    if (!by) return askRefuse(req, res, typed || "(person)", "that question about one person", C);
    raw = { kind: "metric", metric: "raised", period: { kind: "all_time" }, groupBy: by, filters: { donor: d.id } };
    source = "guided"; person = { id: d.id, name: d.name, intent };
  }
  if (body.plan && typeof body.plan === "object") { raw = body.plan; source = "saved"; }
  if (!raw && prev && typed) { raw = C.followUp(prev, typed, ctx); if (raw) source = "follow-up"; }
  let t = null;
  if (!raw && typed) {
    t = C.templatePlan(typed, ctx);
    if (t.plan) raw = t.plan;
    else if (t.named) return askRefuse(req, res, typed, t.unsupported, C);
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
        if (m) { restatement = m.restatement || null; delete m.restatement; raw = m; source = "ai"; }
      } catch { /* the template's reading stands */ }
    }
  }
  if (!raw) return askRefuse(req, res, typed, (t && t.unsupported) || "that question", C);
  const chk = C.validatePlan(scoped(raw, scope, C), ctx);
  if (!chk.ok) return askRefuse(req, res, typed, chk.refused, C, { planSource: source });
  const plan = { ...chk.plan, ...(raw.also && C.METRICS[raw.also] ? { also: raw.also } : {}) };
  const answer = await askAnswer(orgId, plan, ctx, C);
  // A follow-up is logged as one, so "who are they?" is never offered as a question on its own.
  if (source !== "saved") await logQuestion(req.user.orgId, typed || "(plan)", `ask: ${plan.metric}${source === "follow-up" ? " (follow-up)" : ""}`, true);
  const out = { ...answer, question: { text: typed }, planSource: source, restatement, ...(person ? { person } : {}) };
  res.json({ ...out, followUps: G.followUpsFor(out, { canSeeMore }) });
}));

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
