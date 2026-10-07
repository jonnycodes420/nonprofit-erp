#!/usr/bin/env node
// scripts/prod-ai-smoke.js · HARDEN-1 item 5. ONE ASK AND ONE AGENT PLAN, ON PROD, SAVING NOTHING.
//
// FIX-29 reached prod because every test runs with AI off: the Agent's
// find-people schema was refused by the API for two days and nothing that
// runs after a deploy ever asked the model anything. This does, once per
// deploy, on the prod demo organisation (Harborlight), through the two
// read-only twins of the real routes:
//   POST /ask/preview     the Ask box's own handler; the question log is skipped
//   POST /agent/preview   agentBuildPlan, the same find + model + checks; no
//                         instruction row, no ai_log, no trial count
// Both are declared read-only in auditTrail.READ_ONLY_POSTS. Signing in is the
// one thing that leaves a mark (a session row), as any demo sign-in does.
//
// It FAILS LOUDLY: a 5xx, a refused or truncated plan, an answer with no
// sentence, or no draft for the funders is a red line and exit 1. CI runs it
// after the deploy is verified healthy; `npm run status` prints it as a row.
//
// Usage: node scripts/prod-ai-smoke.js          (prod)
//        PROD_AI_SMOKE_BACKEND=http://localhost:5601 node scripts/prod-ai-smoke.js
const BACKEND = (process.env.PROD_AI_SMOKE_BACKEND || process.env.STATUS_BACKEND_URL || "https://nonprofit-erp-production.up.railway.app").replace(/\/+$/, "");
const EMAIL = process.env.PROD_AI_SMOKE_EMAIL || "director@harborlight.demo";
const PASSWORD = process.env.PROD_AI_SMOKE_PASSWORD || "demo-harbor-2026";
// A question no template reads, so the model's query plan must answer it
// (planSource "query"; a template answer would prove nothing about the
// model), and an instruction that exercises the find (filter_spec, the FIX-29
// schema) and a batch of drafts, kept small: Harborlight has three funders.
const QUESTION = "Who are our supporters who run a fundraising page?";
const INSTRUCTION = "Draft a thank-you note to every grant funder";

async function post(url, token, body, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } finally { clearTimeout(t); }
}

async function runAiSmoke({ backend = BACKEND, email = EMAIL, password = PASSWORD } = {}) {
  const lines = [];
  const login = await post(`${backend}/auth/login`, null, { email, password }, 20000);
  if (!login.body || !login.body.token) return { ok: false, lines: [`sign-in to the demo failed (HTTP ${login.status})`] };
  const tok = login.body.token;

  const t0 = Date.now();
  const a = await post(`${backend}/ask/preview`, tok, { text: QUESTION });
  const askOk = a.status === 200 && a.body.answered === true && a.body.planSource === "query"
    && typeof a.body.sentence === "string" && a.body.sentence.trim().length > 10 && !/internal server error/i.test(a.body.sentence);
  lines.push(`ask ${askOk ? "ok" : "FAILING"}: HTTP ${a.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s` + (askOk ? ` · ${a.body.planSource || a.body.specSource || "answered"}` : ` · ${JSON.stringify(a.body).slice(0, 160)}`));

  const t1 = Date.now();
  const p = await post(`${backend}/agent/preview`, tok, { text: INSTRUCTION });
  const drafts = (p.body && p.body.tools && p.body.tools.draft_note) || 0;
  const planOk = p.status === 200 && p.body.preview === true && drafts > 0;
  lines.push(`agent ${planOk ? "ok" : "FAILING"}: HTTP ${p.status} in ${((Date.now() - t1) / 1000).toFixed(1)}s` + (planOk ? ` · ${drafts} drafts for ${p.body.found ?? "?"} found` : ` · ${JSON.stringify(p.body).slice(0, 160)}`));
  return { ok: askOk && planOk, lines };
}

module.exports = { runAiSmoke, QUESTION, INSTRUCTION };

if (require.main === module) {
  runAiSmoke().then(r => {
    for (const l of r.lines) console.log((r.ok ? "  " : "  ") + l);
    if (!r.ok) { console.error(`FAIL: the prod AI smoke failed against ${BACKEND}. Ask or the Agent is broken on prod.`); process.exit(1); }
    console.log(`OK: prod AI smoke passed against ${BACKEND}.`);
  }).catch(e => { console.error(`FAIL: the prod AI smoke errored: ${e.message}`); process.exit(1); });
}
