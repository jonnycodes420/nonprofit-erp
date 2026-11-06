#!/usr/bin/env node
// Deploy drift-check. Read-only. Run: node scripts/ci/status.js
//
// Prints, and LOUDLY flags divergence between, the four things that must agree
// for "what I committed" to equal "what is live":
//   local HEAD  →  origin/main  →  PROD backend buildSha  →  PROD frontend build-sha
//
// Born from the incident that BUILD-65 Part 3b/3c sat committed-but-unpushed for
// three days while everyone believed it shipped — caught only by an incidental
// /health field, not a guard. This IS the guard: a green line means aligned, a
// red line names exactly where the chain breaks (unpushed / undeployed / split-brain).
//
// Hosts default to Steward's prod and are env-overridable so the same script
// works after the fork (STATUS_BACKEND_URL / STATUS_FRONTEND_URL).

const { execSync } = require("child_process");

const BACKEND = (process.env.STATUS_BACKEND_URL || "https://nonprofit-erp-production.up.railway.app").replace(/\/+$/, "");
const FRONTEND = (process.env.STATUS_FRONTEND_URL || "https://www.stewardapp.dev").replace(/\/+$/, "");

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const short = (s) => (s && /^[0-9a-f]{7,40}$/i.test(s) ? s.slice(0, 7) : s || "?");

function git(args) {
  try { return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

async function fetchText(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: e.name === "AbortError" ? "timeout" : e.message };
  } finally { clearTimeout(t); }
}

// FIX-47 · A MAILBOX THAT HAS NOT READ IS ITS OWN LINE, NOT A FAILED SMOKE.
// The smoke is the four routes; a stale mailbox is one person's connection
// that needs a reconnect, and it used to turn the whole smoke red while every
// route answered 200. Counts and providers only: no address leaves prod.
const PROVIDER_WORD = { google: "Gmail", gmail: "Gmail", microsoft: "Outlook", outlook: "Outlook" };
function agoWords(iso, now) {
  if (!iso) return null;
  const h = Math.floor((now - new Date(iso).getTime()) / 3600e3);
  return h >= 48 ? `${Math.floor(h / 24)} days ago` : h >= 1 ? `${h}h ago` : "under an hour ago";
}
function mailboxReport(mailboxSync, { now = Date.now(), backendUp = true } = {}) {
  if (!mailboxSync) return { ok: null, detail: backendUp ? "no mailboxSync on /health (older deploy)" : "backend unreachable", lines: [] };
  if (!mailboxSync.checkedAt) return { ok: null, detail: "no sync run since the deploy yet; re-run in a minute", lines: [] };
  const stale = Number(mailboxSync.stale) || 0;
  const lines = (mailboxSync.staleList || []).map(m => {
    const who = `${PROVIDER_WORD[String(m.provider || "").toLowerCase()] || m.provider || "A"} mailbox`;
    const when = agoWords(m.lastReadAt, now);
    return `${who} ${m.refused ? "lost its permission" : when ? `last read ${when}` : "has not read since it was connected"}, reconnect in Connections`;
  });
  if (stale > lines.length) lines.push(`${stale - lines.length} more mailbox(es) not read in 2 hours, reconnect in Connections`);
  return { ok: stale === 0, detail: `${mailboxSync.connections} connection(s), ${stale} not read in 2 hours · checked ${mailboxSync.checkedAt}`, lines };
}
// The smoke verdict is the routes' alone.
const smokeVerdict = (routesOk) => routesOk;

// DEPLOY-1 · the queue's oldest waiting job, by type and age: yellow past an
// hour, red past a day (jobQueue.queueLevel, the same rule /health uses), and
// running jobs gone silent.
function ageWords(s) {
  s = Number(s) || 0;
  return s >= 2 * 86400 ? `${Math.floor(s / 86400)} days` : s >= 3600 ? `${Math.floor(s / 3600)}h` : s >= 60 ? `${Math.floor(s / 60)} min` : `${s}s`;
}
function queueReport(queue) {
  if (!queue || queue.waiting == null) return { level: null, detail: queue ? "not read yet since the deploy; re-run in a minute" : "no queue on /health (older deploy)" };
  const level = queue.level || null;
  const o = queue.oldestWaiting;
  const parts = [`${queue.waiting} waiting, ${queue.running} running`];
  if (o) parts.push(`oldest waiting: ${o.name}, ${ageWords(o.seconds)}`);
  if (queue.stuckRunning) parts.push(`${queue.stuckRunning} running with no heartbeat`);
  if (level && level !== "ok") parts.push("scripts/sql/queue-status.sql says which; scripts/ops/queue-requeue.js clears them");
  return { level, detail: parts.join(" · ") };
}
// DEPLOY-1 · the worker: its heartbeat (read through the web's /health, since
// it has no public address) carries main's build and the role "worker".
function workerReport(worker, mainSha) {
  if (!worker) return { ok: false, detail: "no worker heard from in 2 minutes (no heartbeat on /health)" };
  const okSha = !!mainSha && worker.buildSha === mainSha, okRole = worker.role === "worker";
  return { ok: okSha && okRole,
    detail: `build ${worker.buildSha ? String(worker.buildSha).slice(0, 7) : "none"}${okSha ? "" : mainSha ? ` (main is ${String(mainSha).slice(0, 7)})` : ""}`
      + ` · role ${worker.role}${okRole ? "" : " (should read worker)"} · seen ${worker.seenSecondsAgo}s ago` };
}
// POOL-1 · THE CONNECTION BUDGET. During a deploy two webs and the worker
// hold connections at once; each process can open its DB_POOL_MAX plus the
// set-wise pool's share. 2 × web + worker must fit the pooler's size
// (POOLER_SIZE: Supabase → Database → Settings → Connection pooling → Pool
// Size, default 40). Yellow above 80% of it, red above 100%, and the sentence
// names the number to lower. The web's numbers are its /health.pool; the
// worker's come through its heartbeat (/health.worker.pool).
const POOLER_SIZE = () => Math.max(1, Number(process.env.POOLER_SIZE) || 40);
const setMaxFor = (m) => Math.min(3, Math.max(1, Math.floor(m / 3)));
function poolReport(webPool, workerPool, poolerSize = POOLER_SIZE()) {
  if (!webPool || webPool.max == null) return { level: null, detail: "no pool on /health (older deploy)" };
  if (!workerPool || workerPool.max == null) return { level: null, detail: "the worker's pool is not on /health yet (no heartbeat with it); re-run in a minute" };
  const web = webPool.max + (webPool.set ? webPool.set.max : 0), worker = workerPool.max + (workerPool.setMax || 0);
  const worst = 2 * web + worker, pct = Math.round((worst / poolerSize) * 100);
  const level = worst > poolerSize ? "red" : worst > 0.8 * poolerSize ? "yellow" : "ok";
  let detail = `web ${webPool.max}+${webPool.set ? webPool.set.max : 0}, worker ${workerPool.max}+${workerPool.setMax || 0}`
    + ` · deploy worst case 2 × ${web} + ${worker} = ${worst} of ${poolerSize} (${pct}%)`;
  if (level !== "ok") {
    // The largest web DB_POOL_MAX that brings the worst case to 80% with the
    // worker as it is; if none does, the worker's.
    const fit = Math.floor(0.8 * poolerSize);
    let m = null;
    for (let x = webPool.max - 1; x >= 2; x--) if (2 * (x + setMaxFor(x)) + worker <= fit) { m = x; break; }
    let k = null;
    if (m == null) for (let x = workerPool.max - 1; x >= 2; x--) if (2 * web + x + setMaxFor(x) <= fit) { k = x; break; }
    detail += m != null ? ` · lower DB_POOL_MAX on the web to ${m}, or raise the pooler's Pool Size`
      : k != null ? ` · lower DB_POOL_MAX on the worker to ${k}, or raise the pooler's Pool Size`
      : ` · raise the pooler's Pool Size, or lower DB_POOL_MAX on the web and the worker`;
    detail += level === "red" ? " (a deploy can run out of connections)" : "";
  }
  return { level, detail, worst, poolerSize };
}
// LOAD-1 · the last nightly load run (.github/workflows/load-nightly.yml):
// when it ran, pass or fail, and the slowest route, from the run and its
// load-summary artifact. `run` is gh's { conclusion, createdAt, url }.
function loadReport(run, summary, now = Date.now()) {
  if (!run) return { level: null, detail: "no nightly load run yet (gh workflow run load-nightly.yml)" };
  if (!run.conclusion) return { level: null, detail: `running since ${agoWords(run.createdAt, now)}` };
  const pass = run.conclusion === "success";
  const top = summary && Array.isArray(summary.rows) && summary.rows[0];
  const slowest = top ? `slowest ${top.route} p95 ${top.p95} ms` : "no summary kept";
  const profile = summary && summary.profile ? ` · profile open p95 ${summary.profile.p95} ms` : "";
  const misses = !pass && summary && summary.misses && summary.misses.length ? ` · misses: ${summary.misses.slice(0, 3).join("; ")}` : "";
  return { level: pass ? "ok" : "red", detail: `last run ${agoWords(run.createdAt, now)} · ${slowest}${profile}${misses}` };
}
function lastLoadRun() {
  const { execFileSync } = require("child_process");
  const gh = (args) => { try { return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }); } catch { return null; } };
  const runs = gh(["run", "list", "--workflow", "load-nightly.yml", "--limit", "1", "--json", "databaseId,conclusion,createdAt,url"]);
  const run = runs ? (JSON.parse(runs)[0] || null) : undefined;
  if (!run) return { run: run === undefined ? undefined : null, summary: null };
  const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "steward-load-"));
  let summary = null;
  if (gh(["run", "download", String(run.databaseId), "-n", "load-summary", "-D", dir]) !== null) {
    try { summary = JSON.parse(require("fs").readFileSync(require("path").join(dir, "load-summary.json"), "utf8")); } catch { /* no summary kept */ }
  }
  require("fs").rmSync(dir, { recursive: true, force: true });
  return { run, summary };
}
// STAGE-1 · STAGING, BESIDE PROD. Staging's API comes from STATUS_STAGING_API_URL
// (or STAGING_API_URL); unset means staging is not set up and the section says so.
// Once STAGING_ENABLED is on, origin/main ahead of prod is what staging is FOR
// (merged, walked, waiting for Ship on /ops), so it is no longer a flag; staging
// behind origin/main, or a red walk, is.
const ghCli = args => { try { return require("child_process").execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim(); } catch { return null; } };
const STAGING_API = () => (process.env.STATUS_STAGING_API_URL || process.env.STAGING_API_URL || "").replace(/\/+$/, "");
const STAGING_FRONTEND = () => (process.env.STATUS_STAGING_FRONTEND_URL || "https://staging.stewardapp.dev").replace(/\/+$/, "");
function stagingReport({ configured, enabled, web, worker, frontend, env, walk, originMain, prodSha }) {
  if (!configured) return { ok: null, detail: "not set up (STAGING_API_URL unset; docs/needs-jonathan/STAGE-1.md)", flags: [] };
  const flags = [];
  const s = x => (x ? String(x).slice(0, 7) : "?");
  if (env && env !== "staging") flags.push(`STAGING says env "${env}", not staging. Nothing should ship from it.`);
  if (web && (web !== worker || web !== frontend)) flags.push(`STAGING SPLIT: web ${s(web)}, worker ${s(worker)}, frontend ${s(frontend)}.`);
  if (enabled && originMain && web && web !== originMain) flags.push(`staging (${s(web)}) is behind origin/main (${s(originMain)}): merged but not on staging yet (CI running or failed).`);
  if (walk === "failure" || walk === "error") flags.push(`STAGING WALK FAILED on ${s(web)}: Ship stays off until a green walk.`);
  const waiting = web && prodSha && web !== prodSha ? "ahead of prod, waiting for Ship on /ops" : "same as prod";
  return { ok: flags.length === 0, detail: `web ${s(web)} · worker ${s(worker)} · frontend ${s(frontend)} · walk ${walk || "none"} · ${waiting}`, flags };
}
module.exports = { mailboxReport, smokeVerdict, queueReport, workerReport, poolReport, loadReport, stagingReport };

if (require.main === module) (async () => {
  // ── local + origin ─────────────────────────────────────────────────────────
  const localHead = git("rev-parse HEAD");
  const branch = git("rev-parse --abbrev-ref HEAD");
  git("fetch origin main --quiet");                       // best-effort; ls-remote is the source of truth below
  const remoteLine = git("ls-remote origin refs/heads/main");
  const originMain = remoteLine ? remoteLine.split(/\s+/)[0] : null;

  // commits on local main not yet on origin/main (unpushed), and origin ahead of local
  let unpushed = null, behindRemote = null;
  if (originMain) {
    const c = git(`rev-list --count ${originMain}..HEAD`);
    unpushed = c === null ? null : Number(c);
    const b = git(`rev-list --count HEAD..${originMain}`);
    behindRemote = b === null ? null : Number(b);
  }

  // ── prod surfaces ────────────────────────────────────────────────────────────
  const beRes = await fetchText(`${BACKEND}/health`);
  let backendSha = null, backendErr = null, mailboxSync = null, guards = null, queue = null, worker = null, webPool = null;
  if (beRes.ok) { try { const h = JSON.parse(beRes.text); backendSha = h.buildSha; mailboxSync = h.mailboxSync || null; guards = { ok: h.guardsOk, failed: h.guardsFailed }; queue = h.queue || null; worker = h.worker || null; webPool = h.pool || null; } catch { backendErr = "unparseable /health"; } }
  else backendErr = beRes.error || `HTTP ${beRes.status}`;

  const feRes = await fetchText(FRONTEND);
  let frontendSha = null, frontendErr = null;
  if (feRes.ok) {
    const m = feRes.text.match(/<meta\s+name=["']build-sha["']\s+content=["']([^"']*)["']/i);
    if (m) frontendSha = m[1];
    else frontendErr = /just a moment|checkpoint|challenge/i.test(feRes.text) ? "bot-challenge page (SHA hidden)" : "no build-sha meta";
  } else frontendErr = feRes.error || `HTTP ${feRes.status}`;

  // ── post-deploy smoke (BUILD-79 Part 7.3) ────────────────────────────────────
  // "Aligned" used to mean "the same commit is deployed" — it said nothing about
  // whether that commit WORKS. The Sept 5 incident: status.js reported aligned
  // while GET /donors/export/csv threw ERR_MODULE_NOT_FOUND in prod (a module
  // the deploy tarball never contained). The smoke drives the exact surface
  // that crashed — the dynamic import of shared/customFieldShape.js — via a
  // READ-ONLY export against the demo org. (A prod WRITE from a status check
  // would violate this repo's PROD_READONLY script discipline; the write-path
  // coverage lives in tests/deploy-shape.test.js + the custom-fields suite,
  // which prove the same module ships and validates.) Aligned now REQUIRES the
  // smoke; STATUS_SKIP_SMOKE=1 skips it (and the verdict says so).
  let smokeOk = null, smokeDetail = "";
  if (process.env.STATUS_SKIP_SMOKE === "1") {
    smokeDetail = "skipped (STATUS_SKIP_SMOKE=1)";
  } else if (backendSha) {
    try {
      const email = process.env.STATUS_SMOKE_EMAIL || "admin@creoarts.org";
      const password = process.env.STATUS_SMOKE_PASSWORD || "demo1234";
      const login = await fetch(`${BACKEND}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const auth = login.ok ? await login.json() : null;
      if (!auth?.token) { smokeOk = null; smokeDetail = `demo login failed (HTTP ${login.status}) — smoke unverifiable`; }
      else {
        const ex = await fetch(`${BACKEND}/donors/export/csv`, { headers: { Authorization: "Bearer " + auth.token } });
        const body = ex.ok ? await ex.text() : await ex.text().catch(() => "");
        const looksCsv = ex.ok && /^\uFEFF?Name,/.test(body);
        const cf = await fetch(`${BACKEND}/custom-fields?entity=donor`, { headers: { Authorization: "Bearer " + auth.token } });
        // FIX-32: where Checkout lands. The page loads, and the key-trade route
        // is deployed (its GET answers and writes nothing). A miss here means a
        // paying customer lands on nothing.
        const su = await fetchText(`${FRONTEND}/signed-up`);
        const cs = await fetchText(`${BACKEND}/public/checkout-signin`);
        const signupOk = su.ok && cs.ok && /"route":"checkout-signin"/.test(cs.text);
        smokeOk = looksCsv && cf.ok && signupOk;
        smokeDetail = smokeOk
          ? `export/csv 200 (${body.length}B) · custom-fields 200 · signed-up ${su.status} · checkout-signin ${cs.status}`
          : `export/csv ${ex.status}${ex.ok && !looksCsv ? " (not CSV-shaped)" : ""} · custom-fields ${cf.status} · signed-up ${su.status} · checkout-signin ${cs.status}${!ex.ok ? " — " + body.slice(0, 120) : ""}`;
      }
    } catch (e) { smokeOk = null; smokeDetail = `smoke errored: ${e.message}`; }
  } else smokeDetail = "backend unreachable — smoke not run";

  // HARDEN-1: one Ask and one Agent plan on the prod demo, saving nothing
  // (scripts/ci/prod-ai-smoke.js). STATUS_SKIP_AI=1 skips it.
  let aiOk = null, aiDetail = "";
  if (process.env.STATUS_SKIP_SMOKE === "1" || process.env.STATUS_SKIP_AI === "1") aiDetail = "skipped";
  else if (backendSha) {
    try { const r = await require("./prod-ai-smoke").runAiSmoke({ backend: BACKEND }); aiOk = r.ok; aiDetail = r.lines.join(" · "); }
    catch (e) { aiOk = false; aiDetail = `errored: ${e.message}`; }
  } else aiDetail = "backend unreachable, not run";

  // FIX-33: every live mailbox connection has read successfully in the last
  // two hours. FIX-47: reported on its own line per mailbox; the smoke stays
  // the routes' verdict.
  const mail = mailboxReport(mailboxSync, { backendUp: !!backendSha });
  const mailOk = mail.ok, mailDetail = mail.detail;
  smokeOk = smokeVerdict(smokeOk);

  // ── report ───────────────────────────────────────────────────────────────────
  const row = (label, val, note = "") => console.log(`  ${label.padEnd(18)} ${val}${note ? "  " + DIM + note + RESET : ""}`);
  console.log("\nDeploy status\n─────────────");
  row("branch", branch || "?");
  row("local HEAD", short(localHead));
  row("origin/main", short(originMain) + (originMain === null ? `  ${YELLOW}(unreachable)${RESET}` : ""));
  row("prod backend", backendSha ? short(backendSha) : `${YELLOW}${backendErr}${RESET}`, backendSha ? "" : BACKEND);
  row("prod frontend", frontendSha ? short(frontendSha) : `${YELLOW}${frontendErr}${RESET}`, frontendSha ? "" : FRONTEND);
  row("prod smoke", smokeOk === true ? `${GREEN}ok${RESET}` : smokeOk === false ? `${RED}FAILING${RESET}` : `${YELLOW}unverified${RESET}`, smokeDetail);
  row("mailbox sync", mailOk === true ? `${GREEN}ok${RESET}` : mailOk === false ? `${YELLOW}needs a reconnect${RESET}` : `${YELLOW}unverified${RESET}`, mailDetail);
  for (const l of mail.lines) console.log(`  ${"".padEnd(18)} ${YELLOW}${l}${RESET}`);
  // INT-PROD-1: guardsOk with the name of each guard that fails, so a false
  // never needs a hunt. Reported, not a smoke failure: a guard is a page.
  row("guards", !guards ? `${YELLOW}unverified${RESET}` : guards.ok === true ? `${GREEN}ok${RESET}` : `${RED}FALSE${RESET}`,
      guards && guards.ok !== true ? (Array.isArray(guards.failed) ? `failing: ${guards.failed.join(", ") || "none named"}` : "no guardsFailed on /health (older deploy)") : "");
  // JOBS-1: what follows a gift or a change (a thank-you draft, a journey, the
  // after-change step) that stopped after its last try. Reported, never silent;
  // the Admin console's failed jobs has each one, with its org and its error.
  const stopped = queue && Array.isArray(queue.stopped) ? queue.stopped : null;
  row("handlers", !stopped ? `${YELLOW}unverified${RESET}` : stopped.length ? `${RED}${stopped.reduce((a, s) => a + s.n, 0)} STOPPED${RESET}` : `${GREEN}ok${RESET}`,
      !stopped ? "no queue.stopped on /health (older deploy)" : stopped.length ? `${stopped.map(s => `${s.name} ×${s.n}`).join(", ")} this week · Admin → failed jobs` : `${queue.role || "?"} process answered`);
  row("prod AI smoke", aiOk === true ? `${GREEN}ok${RESET}` : aiOk === false ? `${RED}FAILING${RESET}` : `${YELLOW}unverified${RESET}`, aiDetail);
  const qr = queueReport(queue);
  row("queue", qr.level === "ok" ? `${GREEN}ok${RESET}` : qr.level === "yellow" ? `${YELLOW}waiting over an hour${RESET}` : qr.level === "red" ? `${RED}WAITING OVER A DAY${RESET}` : `${YELLOW}unverified${RESET}`, qr.detail);
  const wr = backendSha ? workerReport(worker, originMain) : { ok: null, detail: "backend unreachable" };
  row("worker", wr.ok === true ? `${GREEN}ok${RESET}` : wr.ok === false ? `${RED}NOT ALIGNED${RESET}` : `${YELLOW}unverified${RESET}`, wr.detail);
  const pr = backendSha ? poolReport(webPool, worker && worker.pool) : { level: null, detail: "backend unreachable" };
  const lr = (() => { const { run, summary } = lastLoadRun(); return run === undefined ? { level: null, detail: "gh could not list the runs" } : loadReport(run, summary); })();
  row("load", lr.level === "ok" ? `${GREEN}ok${RESET}` : lr.level === "red" ? `${RED}FAILING${RESET}` : `${YELLOW}unverified${RESET}`, lr.detail);
  row("db pool", pr.level === "ok" ? `${GREEN}ok${RESET}` : pr.level === "yellow" ? `${YELLOW}over 80% of the pooler${RESET}` : pr.level === "red" ? `${RED}OVER THE POOLER${RESET}` : `${YELLOW}unverified${RESET}`, pr.detail);

  // STAGE-1: staging, beside prod
  const stagingEnabled = (process.env.STAGING_ENABLED || (ghCli(["variable", "get", "STAGING_ENABLED"]) || "")).trim() === "true";
  let st = { configured: !!STAGING_API(), enabled: stagingEnabled, originMain, prodSha: backendSha };
  if (st.configured) {
    const sh = await fetchText(`${STAGING_API()}/health`);
    try { const h = JSON.parse(sh.text); Object.assign(st, { web: h.buildSha, worker: h.worker && h.worker.buildSha, env: h.env || "production" }); } catch { st.web = null; }
    const sf = await fetchText(STAGING_FRONTEND());
    st.frontend = ((sf.text || "").match(/<meta\s+name=["']build-sha["']\s+content=["']([^"']*)["']/i) || [])[1] || null;
    if (st.web) st.walk = (ghCli(["api", `repos/{owner}/{repo}/commits/${st.web}/status`, "--jq", '.statuses[] | select(.context=="staging/walk") | .state']) || "").split("\n")[0] || null;
  }
  const sr = stagingReport(st);
  row("staging", sr.ok === true ? `${GREEN}ok${RESET}` : sr.ok === false ? `${RED}CHECK${RESET}` : `${YELLOW}not set up${RESET}`, sr.detail);
  row("ships", stagingEnabled ? "from /ops (Ship to customers)" : "on merge (STAGING_ENABLED unset)");

  // ── divergence flags (loud) ───────────────────────────────────────────────────
  const flags = [...sr.flags];
  if (unpushed) flags.push(`${unpushed} commit(s) committed locally but NOT on origin/main — unpushed (the BUILD-65-3b/3c class).`);
  if (behindRemote) flags.push(`local main is ${behindRemote} commit(s) BEHIND origin/main — pull before you push.`);
  if (originMain && backendSha && originMain !== backendSha && !stagingEnabled) {
    const ahead = git(`rev-list --count ${backendSha}..${originMain}`);
    flags.push(`origin/main is ahead of PROD BACKEND${ahead ? ` by ${ahead} commit(s)` : ""} — pushed but NOT deployed (CI not run / cap / failed).`);
  }
  if (backendSha && frontendSha && backendSha !== frontendSha) {
    flags.push(`SPLIT-BRAIN: prod backend (${short(backendSha)}) and frontend (${short(frontendSha)}) are on DIFFERENT commits.`);
  }
  if (wr.ok === false) flags.push(`WORKER NOT ALIGNED: ${wr.detail}. Jobs run on the worker; check its Railway deployment.`);
  if (pr.level === "red") flags.push(`DB POOL: a deploy can open more connections than the pooler holds (${pr.detail}).`);
  if (qr.level === "red") flags.push(`QUEUE: a job has waited over a day (${qr.detail}).`);
  if (smokeOk === false) {
    flags.push(`PROD SMOKE FAILING: the deployed commit does not WORK — ${smokeDetail}. Aligned means nothing while this is red.`);
  }

  console.log("");
  if (flags.length) {
    for (const f of flags) console.log(`${RED}⚠ ${f}${RESET}`);
    console.log("");
    process.exit(1);
  }
  // STAGE-1: with staging on, prod lags main on purpose; aligned means prod's
  // halves agree and work, and staging serves origin/main.
  if (stagingEnabled && backendSha && frontendSha && backendSha === frontendSha && smokeOk === true && sr.ok === true && st.web === originMain) {
    console.log(`${GREEN}✓ aligned — prod backend == prod frontend (${short(backendSha)}) and the smoke passes; staging serves origin/main (${short(originMain)}).${RESET}\n`);
    return;
  }
  // fully aligned only if we could actually read every link
  if (originMain && backendSha && frontendSha && localHead === originMain && originMain === backendSha && backendSha === frontendSha && smokeOk === true) {
    console.log(`${GREEN}✓ aligned — local HEAD == origin/main == prod backend == prod frontend, and the smoke passes.${RESET}\n`);
  } else if (originMain && backendSha && frontendSha && localHead === originMain && originMain === backendSha && backendSha === frontendSha) {
    console.log(`${YELLOW}~ same commit everywhere, but the smoke is ${smokeOk === false ? "FAILING" : "unverified"} (${smokeDetail}) — aligned is not claimed until the deployed code WORKS.${RESET}\n`);
    process.exit(2);
  } else {
    console.log(`${YELLOW}~ no divergence flagged, but not every link could be read (see above) — verify the unreachable one by hand.${RESET}\n`);
    process.exit(2);
  }
})();
