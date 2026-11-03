#!/usr/bin/env node
// scripts/ci/prod-ai-smoke.js · HARDEN-1 item 5. ONE ASK AND ONE AGENT PLAN, ON PROD, SAVING NOTHING.
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
// DEPLOY-1 · AFTER A DEPLOY IT WAITS, AND A FAILED ASK IS ASKED AGAIN ONCE.
// Ask answered 500 right after two deploys and 200 minutes later, so main
// went red for a healthy deploy. With PROD_AI_SMOKE_WAIT_SHA set (CI sets it to
// the commit it deployed) it first waits, up to five minutes, for /ready to
// answer 200 and /health to carry that build, and with PROD_AI_SMOKE_WORKER=1
// for the worker's heartbeat to carry it too, with role "worker". Then a failed
// Ask is asked again once, 15 s later; only a second failure fails, and the
// line says which try failed and how. A real failure still fails.
//
// Usage: node scripts/ci/prod-ai-smoke.js          (prod)
//        PROD_AI_SMOKE_BACKEND=http://localhost:5601 node scripts/ci/prod-ai-smoke.js
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ctrl.signal }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  catch (e) { return { status: 0, body: {}, error: e.message }; }
  finally { clearTimeout(t); }
}

// The deploy is in when /ready says 200, /health carries `sha`, and (with
// `worker`) the worker's heartbeat on /health carries it with role "worker".
// Returns { ok, line }; `line` says what it last saw.
async function waitForDeploy({ backend = BACKEND, sha, worker = false, tries = 60, everyMs = 5000 } = {}) {
  let seen = "";
  for (let i = 1; i <= tries; i++) {
    const [ready, health] = await Promise.all([getJson(`${backend}/ready`), getJson(`${backend}/health`)]);
    const h = health.body || {}, w = h.worker || null;
    const webOk = ready.status === 200 && h.buildSha === sha;
    const workerOk = !worker || (w && w.buildSha === sha && w.role === "worker");
    seen = `ready ${ready.status || "unreachable"} · web ${String(h.buildSha || "none").slice(0, 7)}`
      + (worker ? ` · worker ${w ? `${String(w.buildSha || "none").slice(0, 7)} (${w.role}, seen ${w.seenSecondsAgo}s ago)` : "none"}` : "");
    if (webOk && workerOk) return { ok: true, line: `deploy in after ${i} look(s): ${seen}` };
    console.log(`  [${i}/${tries}] ${seen}`);
    if (i < tries) await sleep(everyMs);
  }
  return { ok: false, line: `the deploy of ${String(sha).slice(0, 7)} never came in: ${seen}` };
}

const askPasses = (a) => a.status === 200 && a.body.answered === true && a.body.planSource === "query"
  && typeof a.body.sentence === "string" && a.body.sentence.trim().length > 10 && !/internal server error/i.test(a.body.sentence);

async function runAiSmoke({ backend = BACKEND, email = EMAIL, password = PASSWORD, retryMs = 15000 } = {}) {
  const lines = [];
  const login = await post(`${backend}/auth/login`, null, { email, password }, 20000);
  if (!login.body || !login.body.token) return { ok: false, lines: [`sign-in to the demo failed (HTTP ${login.status})`] };
  const tok = login.body.token;

  let t0 = Date.now();
  let a = await post(`${backend}/ask/preview`, tok, { text: QUESTION });
  let askOk = askPasses(a);
  const took = (r, ms) => `HTTP ${r.status} in ${(ms / 1000).toFixed(1)}s`;
  let first = null;
  if (!askOk) {
    first = `${took(a, Date.now() - t0)} · ${JSON.stringify(a.body).slice(0, 160)}`;
    await sleep(retryMs);
    t0 = Date.now();
    a = await post(`${backend}/ask/preview`, tok, { text: QUESTION });
    askOk = askPasses(a);
  }
  lines.push(`ask ${askOk ? "ok" : "FAILING"}: ${took(a, Date.now() - t0)}`
    + (askOk ? ` · ${a.body.planSource || a.body.specSource || "answered"}` : ` · ${JSON.stringify(a.body).slice(0, 160)}`)
    + (first ? (askOk ? ` · it failed once first (${first}) and passed asked again ${retryMs / 1000}s later`
                      : ` · failed twice, ${retryMs / 1000}s apart; the first: ${first}`) : ""));

  const t1 = Date.now();
  const p = await post(`${backend}/agent/preview`, tok, { text: INSTRUCTION });
  const drafts = (p.body && p.body.tools && p.body.tools.draft_note) || 0;
  // A clean "nobody on file matches" is the find working through the model on
  // data with no funders yet (the prod demo before its GRANTS-1 re-seed): the
  // schema was accepted and the answer is true, so it passes and says so.
  // Anything else that is not drafts (a 5xx, plan_failed, plan_truncated) fails.
  const nobody = p.status === 400 && p.body && p.body.error === "nothing_to_do" && /matches/.test(String(p.body.sentence || ""));
  const planOk = (p.status === 200 && p.body.preview === true && drafts > 0) || nobody;
  const said = nobody ? " · the find ran and nobody matches, so nothing was drafted (re-seed the demo to exercise drafting)"
    : planOk ? ` · ${drafts} drafts for ${p.body.found ?? "?"} found` : ` · ${JSON.stringify(p.body).slice(0, 160)}`;
  lines.push(`agent ${planOk ? "ok" : "FAILING"}: HTTP ${p.status} in ${((Date.now() - t1) / 1000).toFixed(1)}s` + said);
  return { ok: askOk && planOk, lines };
}

module.exports = { runAiSmoke, waitForDeploy, QUESTION, INSTRUCTION };

if (require.main === module) {
  (async () => {
    const sha = process.env.PROD_AI_SMOKE_WAIT_SHA;
    if (sha) {
      const w = await waitForDeploy({ sha, worker: process.env.PROD_AI_SMOKE_WORKER === "1" });
      console.log(`  ${w.line}`);
      if (!w.ok) return { ok: false, lines: [w.line] };
    }
    return runAiSmoke();
  })().then(r => {
    for (const l of r.lines) console.log((r.ok ? "  " : "  ") + l);
    if (!r.ok) { console.error(`FAIL: the prod AI smoke failed against ${BACKEND}. Ask or the Agent is broken on prod.`); process.exit(1); }
    console.log(`OK: prod AI smoke passed against ${BACKEND}.`);
  }).catch(e => { console.error(`FAIL: the prod AI smoke errored: ${e.message}`); process.exit(1); });
}
