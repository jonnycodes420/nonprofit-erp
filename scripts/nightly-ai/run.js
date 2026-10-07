#!/usr/bin/env node
// HARDEN-1 item 4 · THE NIGHTLY REAL-AI RUN.
//
// Twenty FIXED questions against a server whose model calls go, through the
// counting proxy (scripts/nightly-ai/proxy.js), to the real API. Half are Agent
// instructions (POST /agent/instructions), half are Ask questions (POST /ask,
// the route the Ask box uses). Each answer is judged twice:
//
//   COMPLETE  2xx, no error / plan_failed / plan_truncated, no raw error text
//             ("undefined", "NaN", "[object Object]", a stack line), no text
//             cut off mid-sentence, and the kind of answer the question wants
//             (drafts, a plan, a read, people, a figure, a why).
//   IN SCOPE  every person id in the answer is a record of THIS org, and the
//             people match a truth set computed here straight from SQL (never
//             through the code under test): no outsiders, and the coverage or
//             the count the question names.
//
// It writes a JSON summary (OUT, default nightly-ai-summary.json) and exits 1
// when any question fails or the proxy's spend cap was reached. The workflow
// opens the GitHub issue from that summary (scripts/nightly-ai/issue.js).
//
// Env: BASE (default http://localhost:5601), DATABASE_URL, ORG (org_b72demo),
//      LOGIN_EMAIL / LOGIN_PASSWORD (the demo seed's director), PROXY
//      (http://localhost:6524, for /__spend), OUT, ONLY (comma list of ids).
// Offline: `node scripts/nightly-ai/run.js --recheck <summary.json>` re-judges
//      saved responses against today's truth sets without one model call.
"use strict";
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BASE = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const ORG = process.env.ORG || "org_b72demo";
const EMAIL = process.env.LOGIN_EMAIL || "director@harborlight.demo";
const PASSWORD = process.env.LOGIN_PASSWORD || "demo-harbor-2026";
const PROXY = (process.env.PROXY || "http://localhost:6524").replace(/\/+$/, "");
const OUT = process.env.OUT || "nightly-ai-summary.json";
const ONLY = (process.env.ONLY || "").split(",").map(s => s.trim()).filter(Boolean);
const RECHECK = process.argv.includes("--recheck") ? process.argv[process.argv.indexOf("--recheck") + 1] : null;

// ── THE TRUTH, IN SQL ───────────────────────────────────────────────────────
// Live people only. A gift counts when its amount is above zero. Dates are the
// org's civil dates (gifts.date is text YYYY-MM-DD), so "this month" is read in
// the org's own timezone.
function civil(tz) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // YYYY-MM-DD
}
const GIVERS = `FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
  WHERE g.org_id = $1 AND d.deleted_at IS NULL AND g.amount > 0`;
const MONTHLY = `EXISTS (SELECT 1 FROM recurring_subscriptions r WHERE r.org_id = d.org_id AND r.donor_id = d.id
  AND r.interval = 'month' AND r.status IN ('active','past_due','recovering','recovered'))`;

// kind: what a complete answer is.
//   drafts       an Agent plan whose steps are drafted notes
//   plan         an Agent plan of steps for people
//   read-list    an Agent read that lists people (writes nothing)
//   read-report  an Agent read that opens a report
//   people       an Ask answer that lists people with a count
//   figure       an Ask answer with one figure
//   why          an Ask answer that explains (a sentence, no people needed)
// truth(ctx) returns a Set of donor ids, or { value } for a figure.
// cover: the share of the truth set the answer must reach (agent plans).
// exact: an Ask answer's peopleCount must equal the truth set's size.
const QUESTIONS = [
  // ── Agent ────────────────────────────────────────────────────────────────
  { id: "A01", route: "agent", kind: "drafts", text: "Draft a thank-you to every donor who gave this month", cover: 0.9,
    truth: c => c.ids(`SELECT DISTINCT g.donor_id AS id ${GIVERS} AND g.date >= $2`, [c.monthStart]) },
  // "Active" is the product's own reading (a volunteer with recent activity), so
  // the truth is every volunteer and the plan must reach at least half of them.
  { id: "A02", route: "agent", kind: "plan", text: "Plan a call to every active volunteer", cover: 0.5,
    truth: c => c.ids(`SELECT id FROM donors d WHERE org_id = $1 AND deleted_at IS NULL AND person_types ? 'volunteer'`) },
  { id: "A03", route: "agent", kind: "drafts", text: "Draft a thank-you note to every grant funder", cover: 1,
    truth: c => c.ids(`SELECT DISTINCT funder_donor_id AS id FROM grants WHERE org_id = $1 AND funder_donor_id IS NOT NULL`) },
  { id: "A04", route: "agent", kind: "plan", text: "Plan a call to every monthly donor in Salem", cover: 1,
    truth: c => c.ids(`SELECT d.id FROM donors d WHERE d.org_id = $1 AND d.deleted_at IS NULL AND lower(trim(d.city)) = 'salem' AND ${MONTHLY}`) },
  { id: "A05", route: "agent", kind: "drafts", text: "Draft a thank-you to everyone registered for the Harbor Run 2026", cover: 1,
    truth: c => c.ids(`SELECT DISTINCT a.donor_id AS id FROM event_attendees a JOIN events e ON e.id = a.event_id
      WHERE e.org_id = $1 AND e.name = 'Harbor Run 2026' AND a.donor_id IS NOT NULL`) },
  { id: "A06", route: "agent", kind: "read-list", text: "Find donors in Salem I haven't reached out to",
    truth: c => c.ids(`SELECT id FROM donors WHERE org_id = $1 AND deleted_at IS NULL AND lower(trim(city)) = 'salem'`), superset: true },
  { id: "A07", route: "agent", kind: "read-report", text: "Open the LYBUNT report",
    truth: c => c.ids(`SELECT DISTINCT g.donor_id AS id ${GIVERS} AND LEFT(g.date, 4) = $2
      AND NOT EXISTS (SELECT 1 FROM gifts h WHERE h.org_id = g.org_id AND h.donor_id = g.donor_id AND h.amount > 0 AND LEFT(h.date, 4) = $3)`,
      [String(c.year - 1), String(c.year)]), superset: true },
  { id: "A08", route: "agent", kind: "drafts", text: "Draft a thank-you to everyone who gave more than $10,000 this year", cover: 0.9,
    truth: c => c.ids(`SELECT g.donor_id AS id ${GIVERS} AND g.date >= $2 GROUP BY g.donor_id HAVING SUM(g.amount) > 10000`, [c.yearStart]) },
  { id: "A09", route: "agent", kind: "plan", text: "Create a task to call every donor in Marblehead who gave more than $5,000 this year", cover: 0.9,
    truth: c => c.ids(`SELECT g.donor_id AS id ${GIVERS} AND g.date >= $2 AND d.city ILIKE '%marblehead%' GROUP BY g.donor_id HAVING SUM(g.amount) > 5000`, [c.yearStart]) },
  { id: "A10", route: "agent", kind: "plan", text: "Plan a call to everyone who gave for the first time this month", cover: 1,
    truth: c => c.ids(`SELECT donor_id AS id FROM (SELECT g.donor_id, MIN(g.date) f ${GIVERS} GROUP BY g.donor_id) x WHERE f >= $2`, [c.monthStart]) },
  // ── Ask ──────────────────────────────────────────────────────────────────
  { id: "Q01", route: "ask", kind: "people", text: "Who are our donors in Marblehead?", exact: true,
    truth: c => c.ids(`SELECT id FROM donors WHERE org_id = $1 AND deleted_at IS NULL AND city ILIKE '%marblehead%' AND person_types ? 'donor'`) },
  { id: "Q02", route: "ask", kind: "people", text: "Show me donors who gave last year but not this year", exact: true,
    truth: c => c.ids(`SELECT DISTINCT g.donor_id AS id ${GIVERS} AND LEFT(g.date, 4) = $2
      AND NOT EXISTS (SELECT 1 FROM gifts h WHERE h.org_id = g.org_id AND h.donor_id = g.donor_id AND h.amount > 0 AND LEFT(h.date, 4) = $3)`,
      [String(c.year - 1), String(c.year)]) },
  { id: "Q03", route: "ask", kind: "people", text: "Who are my top 20 donors this year?",
    truth: c => c.ids(`SELECT g.donor_id AS id ${GIVERS} AND g.date >= $2 GROUP BY g.donor_id ORDER BY SUM(g.amount) DESC LIMIT 25`, [c.yearStart]), superset: true },
  { id: "Q04", route: "ask", kind: "people", text: "Who gave over $500 but hasn't been thanked?", exact: true,
    truth: c => c.ids(`SELECT DISTINCT d.id ${GIVERS} AND g.amount > 500 AND g.acknowledgement_sent IS NOT TRUE AND g.disputed_at IS NULL`) },
  { id: "Q05", route: "ask", kind: "people", text: "Who gave for the first time this month?", exact: true,
    truth: c => c.ids(`SELECT donor_id AS id FROM (SELECT g.donor_id, MIN(g.date) f ${GIVERS} GROUP BY g.donor_id) x WHERE f >= $2`, [c.monthStart]) },
  { id: "Q06", route: "ask", kind: "people", text: "Who are our monthly donors in Salem?", exact: true,
    truth: c => c.ids(`SELECT d.id FROM donors d WHERE d.org_id = $1 AND d.deleted_at IS NULL AND lower(trim(d.city)) = 'salem' AND ${MONTHLY}`) },
  { id: "Q07", route: "ask", kind: "people", text: "Which donors gave more than $10,000 this year?", exact: true,
    truth: c => c.ids(`SELECT g.donor_id AS id ${GIVERS} AND g.date >= $2 GROUP BY g.donor_id HAVING SUM(g.amount) > 10000`, [c.yearStart]) },
  { id: "Q08", route: "ask", kind: "figure", text: "How many donors gave this year?",
    truth: async c => ({ value: Number((await c.one(`SELECT COUNT(DISTINCT g.donor_id) AS v ${GIVERS} AND g.date >= $2`, [c.yearStart])).v) }) },
  { id: "Q09", route: "ask", kind: "figure", text: "How much have we raised this year?",
    truth: async c => ({ value: Number((await c.one(`SELECT COALESCE(SUM(g.amount), 0)::numeric(14,2) AS v FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = $1 AND d.deleted_at IS NULL AND g.date >= $2`, [c.yearStart])).v) }) },
  { id: "Q10", route: "ask", kind: "why", text: "Why is retention down this year?",
    truth: c => c.ids(`SELECT id FROM donors WHERE org_id = $1 AND deleted_at IS NULL`), superset: true },
];

// ── CHECKS ──────────────────────────────────────────────────────────────────
const RAW_ERROR = /\bundefined\b|\bNaN\b|\[object Object\]|\bat [A-Za-z_.<>]+ \(.*:\d+:\d+\)|TypeError|ReferenceError|SyntaxError|ECONNREFUSED|stack trace/;
const BAD_ERRORS = /plan_failed|plan_truncated|plan_refused|ai_no_key|ai_disabled|agent_paused|agent_unavailable|rate_limit/;

// The prose a person reads as sentences, to judge for truncation: a drafted
// note's body, a plan's headline and its "cannot", an Ask answer's sentence.
// Labels, titles and filter words ("in Salem · not deceased") are not sentences.
function proseIn(q, body) {
  const out = [];
  if (!body || typeof body !== "object") return out;
  const add = (key, t) => { if (typeof t === "string" && t.trim().length >= 20) out.push({ key, text: t }); };
  if (body.plan) {
    add("plan.summary", body.plan.summary); add("plan.cannot", body.plan.cannot);
    for (const s of body.plan.steps || []) if (s.tool === "draft_note") add("draft body", s.body);
  }
  if (q.route === "ask") add("sentence", body.sentence);
  return out;
}
// A sentence ends in punctuation. A drafted note may end on its sign-off
// ("With thanks, Harborlight Youth Collective"): a closing word, a comma, a name.
const SIGN_OFF = /(thanks|thank you|gratitude|regards|warmly|sincerely|best|appreciation|love|together)[^.!?\n]{0,20},?\s+[A-Z][\w .,&'-]{2,80}$/i;
const endsWhole = t => { const s = t.trim(); return /[.!?)"'”’]$/.test(s) || SIGN_OFF.test(s); };

// Every donor id the answer carries, wherever it sits.
function donorIdsIn(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach(x => donorIdsIn(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (/^(donorId|donor_id|personId|readIds)$/.test(k)) [].concat(x).forEach(i => typeof i === "string" && out.add(i));
      else if (k === "people" && Array.isArray(x)) x.forEach(p => p && typeof p.id === "string" && out.add(p.id));
      donorIdsIn(x, out);
    }
  }
  return out;
}

// The people the answer is ABOUT (not every id it mentions in passing).
function peopleOf(q, body) {
  if (!body || typeof body !== "object") return [];
  if (q.route === "agent") {
    if (body.read) return (body.read.people || []).map(p => p.id).filter(Boolean);
    const steps = (body.plan && body.plan.steps) || [];
    return [...new Set(steps.map(s => s.donorId).filter(Boolean))];
  }
  return (body.people || []).map(p => p.donorId || p.id).filter(Boolean);
}

async function judge(q, r, c) {
  const why = [];
  const body = r.body;
  const text = typeof r.text === "string" ? r.text : JSON.stringify(body || "");
  // COMPLETE
  if (!(r.status >= 200 && r.status < 300)) why.push(`HTTP ${r.status}${body && body.error ? " " + body.error : ""}${body && body.sentence ? ": " + String(body.sentence).slice(0, 160) : ""}`);
  if (body && typeof body === "object" && body.error) why.push(`error: ${body.error}`);
  if (BAD_ERRORS.test(text)) why.push(`answer carries ${text.match(BAD_ERRORS)[0]}`);
  const raw = text.match(RAW_ERROR);
  if (raw) why.push(`raw error text in the answer: "${raw[0]}"`);
  const prose = proseIn(q, body);
  const cut = prose.filter(p => !endsWhole(p.text));
  if (cut.length) why.push(`${cut.length} piece(s) of text end mid-sentence, e.g. ${p80(cut[0].key)}: "...${cut[0].text.trim().slice(-60)}"`);
  if (body && typeof body === "object") {
    if (q.kind === "drafts" || q.kind === "plan") {
      const steps = (body.plan && body.plan.steps) || [];
      if (!body.plan) why.push(`expected a plan, got ${Object.keys(body).join("/")}${body.cannot ? ": " + body.cannot.sentence : ""}`);
      else if (!steps.length) why.push("the plan has no steps");
      if (q.kind === "drafts" && steps.length && !steps.every(s => s.tool === "draft_note")) why.push(`expected only drafted notes, got ${[...new Set(steps.map(s => s.tool))].join(", ")}`);
      if (q.kind === "drafts" && steps.length && steps.some(s => !String(s.body || s.text || s.note || "").trim())) why.push("a drafted note has no words");
    }
    if (q.kind === "read-list" && !(body.read && body.read.kind === "list")) why.push(`expected a read-only list, got ${body.read ? "read " + body.read.kind : Object.keys(body).join("/")}`);
    if (q.kind === "read-report" && !body.read) why.push(`expected a read (the report), got ${Object.keys(body).join("/")}`);
    if (q.route === "ask") {
      if (body.answered !== true) why.push(`not answered${body.sentence ? ": " + String(body.sentence).slice(0, 160) : ""}`);
      if (!String(body.sentence || "").trim()) why.push("no sentence");
      if (q.kind === "people" && !(Array.isArray(body.people) && body.people.length)) why.push("expected a list of people, got none");
    }
  }
  // IN SCOPE
  const ids = [...donorIdsIn(body)];
  if (ids.length) {
    const mine = new Set((await c.db.query(`SELECT id FROM donors WHERE org_id = $1 AND id = ANY($2)`, [ORG, ids])).rows.map(x => x.id));
    const outside = ids.filter(i => !mine.has(i));
    if (outside.length) why.push(`${outside.length} id(s) outside the org: ${outside.slice(0, 5).join(", ")}`);
  }
  const truth = await q.truth(c);
  const metrics = {};
  if (truth instanceof Set) {
    const people = peopleOf(q, body);
    const stray = people.filter(p => !truth.has(p));
    const hit = people.filter(p => truth.has(p)).length;
    metrics.truth = truth.size; metrics.people = people.length; metrics.stray = stray.length;
    if (stray.length) why.push(`${stray.length} of ${people.length} people are not in the truth set (e.g. ${stray.slice(0, 3).join(", ")})`);
    if (q.cover != null && truth.size) {
      metrics.cover = Math.round(hit / truth.size * 100) / 100;
      if (hit / truth.size < q.cover) why.push(`reached ${hit} of ${truth.size} people (needs ${Math.round(q.cover * 100)}%)`);
    }
    if (q.exact && body && typeof body === "object") {
      const n = body.peopleCount != null ? Number(body.peopleCount) : (body.people || []).length;
      metrics.count = n;
      if (n !== truth.size) why.push(`counted ${n}, the records hold ${truth.size}`);
    }
    if (q.kind === "read-list" && body && body.read) {
      metrics.count = body.read.count;
      if (!(Number(body.read.count) <= truth.size)) why.push(`listed ${body.read.count}, more than the ${truth.size} people in that place`);
    }
  } else if (truth && "value" in truth) {
    const vals = Object.values((body && body.figures) || {}).map(f => Number(f && f.value)).filter(Number.isFinite);
    metrics.truth = truth.value; metrics.figures = vals;
    if (!vals.some(v => Math.abs(v - truth.value) < 0.005)) why.push(`no figure equals ${truth.value} (got ${vals.join(", ") || "none"})`);
  }
  return { pass: why.length === 0, why, metrics };
}
const p80 = s => String(s).slice(0, 80);

// ── RUN ─────────────────────────────────────────────────────────────────────
async function call(method, p, token, body) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(300000) });
    const text = await r.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* the text is the answer */ }
    return { status: r.status, body: parsed, text, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, body: null, text: "request failed: " + e.message, ms: Date.now() - t0 }; }
}
async function spend() {
  try { const r = await fetch(PROXY + "/__spend", { signal: AbortSignal.timeout(5000) }); return await r.json(); } catch { return null; }
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const [org] = (await db.query(`SELECT timezone FROM orgs WHERE id = $1`, [ORG])).rows;
  if (!org) { console.error(`The org ${ORG} is not in this database; seed it first (scripts/seed-demo.js).`); process.exit(2); }
  const today = civil(org.timezone || "America/New_York");
  const c = {
    db, today, year: Number(today.slice(0, 4)), yearStart: today.slice(0, 4) + "-01-01", monthStart: today.slice(0, 8) + "01",
    ids: async (sql, a = []) => new Set((await db.query(sql, [ORG, ...a])).rows.map(r => r.id)),
    one: async (sql, a = []) => (await db.query(sql, [ORG, ...a])).rows[0],
  };
  const qs = QUESTIONS.filter(q => !ONLY.length || ONLY.includes(q.id));
  const saved = RECHECK ? JSON.parse(fs.readFileSync(RECHECK, "utf8")) : null;
  let token = null;
  if (!saved) {
    const login = await call("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    token = login.body && login.body.token;
    if (!token) { console.error(`Could not sign in to ${BASE} as ${EMAIL} (HTTP ${login.status}).`); process.exit(2); }
  }
  const startSpend = saved ? null : await spend();
  // AGENT-3: every AI call that fell back to the non-AI path during the run is
  // counted (ai_fallbacks); with AI on, any of them is a failure to look at.
  const startedAt = (await db.query("SELECT NOW() AS t")).rows[0].t;
  const results = [];
  for (const q of qs) {
    let r;
    if (saved) {
      const old = saved.results.find(x => x.id === q.id);
      if (!old) continue;
      r = old.response;
    } else {
      const before = await spend();
      r = q.route === "agent"
        ? await call("POST", "/agent/instructions", token, { text: q.text })
        : await call("POST", "/ask", token, { text: q.text });
      const after = await spend();
      r.usd = before && after ? Math.round((after.usd - before.usd) * 1e4) / 1e4 : null;
      r.modelCalls = before && after ? after.calls - before.calls : null;
    }
    const v = await judge(q, r, c);
    results.push({ id: q.id, route: q.route, kind: q.kind, text: q.text, pass: v.pass, why: v.why, metrics: v.metrics,
      status: r.status, ms: r.ms, usd: r.usd, modelCalls: r.modelCalls, response: { status: r.status, body: r.body, text: r.body ? undefined : r.text, ms: r.ms, usd: r.usd, modelCalls: r.modelCalls } });
    console.log(`${v.pass ? "PASS" : "FAIL"}  ${q.id}  ${q.text}  (${r.ms}ms${r.usd != null ? `, $${r.usd.toFixed(4)}` : ""})${v.pass ? "" : "\n        " + v.why.join("\n        ")}`);
  }
  const endSpend = saved ? saved.spend : await spend();
  const usd = saved ? saved.usd : endSpend && startSpend ? Math.round((endSpend.usd - startSpend.usd) * 1e4) / 1e4 : (endSpend ? endSpend.usd : null);
  const fallbacks = saved ? (saved.fallbacks || []) : (await db.query(
    `SELECT surface, reason, COUNT(*)::int AS n FROM ai_fallbacks WHERE org_id = $1 AND created_at >= $2 AND reason <> 'ai_off'
      GROUP BY surface, reason ORDER BY n DESC`, [ORG, startedAt]).catch(() => ({ rows: [] }))).rows;
  if (fallbacks.length) {
    results.push({ id: "fallbacks", route: "all", kind: "fallbacks", text: "No AI call fell back to the non-AI path", pass: false,
      why: fallbacks.map(f => `${f.n} × ${f.surface}: ${f.reason}`) });
    console.log(`FAIL  fallbacks  ${fallbacks.map(f => `${f.n} × ${f.surface} (${f.reason})`).join(", ")}`);
  }
  const failed = results.filter(r => !r.pass);
  const summary = {
    when: new Date().toISOString(), today, base: BASE, org: ORG, fallbacks,
    passed: results.length - failed.length, failed: failed.length, total: results.length,
    usd, cap: endSpend ? endSpend.cap : null, capReached: !!(endSpend && endSpend.capReached),
    spend: endSpend, results,
  };
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.total} passed · spend $${usd != null ? usd.toFixed(4) : "unknown"}${summary.capReached ? " · THE SPEND CAP WAS REACHED" : ""} · summary at ${OUT}`);
  await db.end();
  process.exit(failed.length || summary.capReached ? 1 : 0);
})().catch(e => { console.error("The nightly run could not finish:", e && e.message); process.exit(2); });
