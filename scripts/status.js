#!/usr/bin/env node
// Deploy drift-check. Read-only. Run: node scripts/status.js
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
// HARDEN-2 · THE NIGHTLY CHECK RAN. /health carries the last run (letters and
// counts only). A run more than 26 hours old is a red line AND a flag (exit 1):
// a job that quietly stopped is the failure it exists to catch. A check that
// never ran is a red line but not a flag: on the first deploy of this table
// nothing can have run until the next 3:30 AM in New York, and the push that
// deploys it should not read as broken. CI does not run this script (it runs
// prod-ai-smoke.js on its own), so the exit code is Jonathan's to read.
function nightlyReport(nc, { now = Date.now(), backendUp = true } = {}) {
  if (nc === undefined) return { ok: null, flag: false, detail: backendUp ? "no nightlyCheck on /health (older deploy)" : "backend unreachable" };
  if (nc === null) return { ok: null, flag: false, detail: "not read since the deploy yet; re-run in a minute" };
  if (nc.neverRan || !nc.lastRunAt) return { ok: false, flag: false, never: true, detail: "has NEVER run (it runs at 3:30 AM New York on the worker)" };
  const when = new Date(nc.lastRunAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
  const orgs = nc.orgsRead == null ? "" : ` · read ${nc.orgsRead} org${nc.orgsRead === 1 ? "" : "s"}`;
  const ago = agoWords(nc.lastRunAt, now);
  if (nc.stale) return { ok: false, flag: true, detail: `has NOT run in 26 hours: last ran ${when} (${ago})${orgs}` };
  const verdict = nc.ok ? "green" : `RED: check${(nc.red || []).length === 1 ? "" : "s"} ${(nc.red || []).join(", ") || "?"}`;
  return { ok: nc.ok === true, flag: false, red: !nc.ok, detail: `${verdict} · ran ${when} (${ago})${orgs}` };
}
// The smoke verdict is the routes' alone.
const smokeVerdict = (routesOk) => routesOk;
module.exports = { mailboxReport, nightlyReport, smokeVerdict };

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
  let backendSha = null, backendErr = null, mailboxSync = null, guards = null, nightlyCheck;
  if (beRes.ok) { try { const h = JSON.parse(beRes.text); backendSha = h.buildSha; mailboxSync = h.mailboxSync || null; guards = { ok: h.guardsOk, failed: h.guardsFailed }; nightlyCheck = h.nightlyCheck; } catch { backendErr = "unparseable /health"; } }
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
  // (scripts/prod-ai-smoke.js). STATUS_SKIP_AI=1 skips it.
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
  const nightly = nightlyReport(nightlyCheck, { backendUp: !!backendSha });

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
  row("nightly check", nightly.ok === true ? `${GREEN}ok${RESET}` : nightly.ok === false ? `${RED}${nightly.flag ? "STALE" : nightly.never ? "NEVER RAN" : "RED"}${RESET}` : `${YELLOW}unverified${RESET}`, nightly.detail);
  row("prod AI smoke", aiOk === true ? `${GREEN}ok${RESET}` : aiOk === false ? `${RED}FAILING${RESET}` : `${YELLOW}unverified${RESET}`, aiDetail);

  // ── divergence flags (loud) ───────────────────────────────────────────────────
  const flags = [];
  if (unpushed) flags.push(`${unpushed} commit(s) committed locally but NOT on origin/main — unpushed (the BUILD-65-3b/3c class).`);
  if (behindRemote) flags.push(`local main is ${behindRemote} commit(s) BEHIND origin/main — pull before you push.`);
  if (originMain && backendSha && originMain !== backendSha) {
    const ahead = git(`rev-list --count ${backendSha}..${originMain}`);
    flags.push(`origin/main is ahead of PROD BACKEND${ahead ? ` by ${ahead} commit(s)` : ""} — pushed but NOT deployed (CI not run / cap / failed).`);
  }
  if (backendSha && frontendSha && backendSha !== frontendSha) {
    flags.push(`SPLIT-BRAIN: prod backend (${short(backendSha)}) and frontend (${short(frontendSha)}) are on DIFFERENT commits.`);
  }
  if (nightly.flag) flags.push(`NIGHTLY CHECK STALE: it ${nightly.detail}. Look at the worker's runNightlyCheck tick.`);
  if (smokeOk === false) {
    flags.push(`PROD SMOKE FAILING: the deployed commit does not WORK — ${smokeDetail}. Aligned means nothing while this is red.`);
  }

  console.log("");
  if (flags.length) {
    for (const f of flags) console.log(`${RED}⚠ ${f}${RESET}`);
    console.log("");
    process.exit(1);
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
