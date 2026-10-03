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

const routers = { r0: express.Router() };

function mount(ctx) {
const { whyAskLimiter, AGENT_MODEL, aiGate, anthropicFor, computeDriftForDonors, orgTime, orgToday, orgTz, query, requireAuth, run, wrap } = ctx;
const app = routers.r0;
let S = null;
const shape = async () => (S = S || await import("../shared/whyShape.js"));

async function logQuestion(text, topic, answered) {
  await run(`INSERT INTO question_log (surface, question, topic, answered) VALUES ('why', ?, ?, ?)`,
    [String(text).slice(0, 1000), topic, !!answered]).catch(() => {});
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

// POST /why/ask — { text } typed, or { key, campaign?, donor? } tapped.
// Writes the question to the log and nothing else.
app.post("/why/ask", whyAskLimiter, requireAuth, wrap(async (req, res) => {
  const Sx = await shape();
  const orgId = req.user.orgId;
  const body = req.body || {};
  const typed = String(body.text || "").trim().slice(0, 500);
  let key = Sx.QUESTION_KEYS.includes(body.key) ? body.key : (typed ? Sx.matchQuestion(typed) : null);
  let campaign = body.campaign ? String(body.campaign) : null, donor = body.donor ? String(body.donor) : null;
  if (key === "appeal" && !campaign) campaign = (typed && (await campaignNamedIn(orgId, typed)) || await WHY.defaultCampaign(orgId) || {}).id || null;
  if (key === "stopped" && !donor && typed) donor = ((await donorNamedIn(orgId, typed)) || {}).id || null;
  if (key === "appeal" && !campaign) key = null;
  if (key === "stopped" && !donor) key = null;
  // PROSPECT-1 — room to give is for admins and major gifts staff. Anyone else
  // who types the question is told plainly, and nothing about anybody is shown.
  if (key === "more" && !(await P.canSee(req.user.userId))) {
    await logQuestion(typed || "Who could give more?", "more", false);
    return res.status(403).json({ error: "major_gifts_only", answered: false,
      sentence: "Room to give is for admins and staff with the major gifts permission.", question: { text: typed } });
  }

  // The text that is logged: what she typed, or the tapped question's words
  // with the subject left generic (a donor's name is donor data).
  const logged = typed || Sx.QUESTIONS.find(q => q.key === body.key)?.ask() || "(empty)";
  if (!key) {
    await logQuestion(logged, "not covered", false);
    return res.json({ answered: false, sentence: Sx.CANT_ANSWER, question: { text: typed } });
  }
  const a = await WHY.answer(orgId, key, { campaign, donor, user: req.user.userId }, { computeDriftForDonors });
  if (!a) {
    await logQuestion(logged, key, false);
    return res.json({ answered: false, sentence: Sx.CANT_ANSWER, question: { text: typed } });
  }
  a.key = key;
  await logQuestion(logged, key, true);
  const params = { q: key, ...(campaign ? { campaign } : {}), ...(donor ? { donor } : {}), ...(key === "call" ? { user: req.user.userId } : {}) };
  const qText = typed || Sx.QUESTIONS.find(q => q.key === key).ask(a.campaign?.name || a.donor?.name);
  const s = await writeSentence(orgId, qText, a, Sx);
  const today = orgToday(await orgTz(orgId));
  const step = a.step ? { ...a.step, due: orgTime.addDays(today, a.step.dueIn || 1),
    ...(a.step.fallback ? { fallback: { ...a.step.fallback, due: orgTime.addDays(today, a.step.fallback.dueIn || 1) } } : {}) } : null;
  res.json({
    answered: true, question: { key, text: qText }, campaign: a.campaign || null, compare: a.compare || null, donor: a.donor || null,
    sentence: s.sentence, sentenceSource: s.source, template: s.template, aiOff: !!s.aiOff,
    reasons: (a.reasons || []).map(r => publicReason(r, params)),
    who: a.who || [], step, cantSee: a.cantSee || null,
    alsoSteps: (a.alsoSteps || []).map(x => ({ ...x, due: orgTime.addDays(today, x.dueIn || 7),
      ...(x.fallback ? { fallback: { ...x.fallback, due: orgTime.addDays(today, x.fallback.dueIn || 7) } } : {}) })),
  });
}));
}

module.exports = { routers, mount };
