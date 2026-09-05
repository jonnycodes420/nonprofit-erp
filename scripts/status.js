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

(async () => {
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
  let backendSha = null, backendErr = null;
  if (beRes.ok) { try { backendSha = JSON.parse(beRes.text).buildSha; } catch { backendErr = "unparseable /health"; } }
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
        smokeOk = looksCsv && cf.ok;
        smokeDetail = smokeOk
          ? `export/csv 200 (${body.length}B) · custom-fields 200`
          : `export/csv ${ex.status}${ex.ok && !looksCsv ? " (not CSV-shaped)" : ""} · custom-fields ${cf.status}${!ex.ok ? " — " + body.slice(0, 120) : ""}`;
      }
    } catch (e) { smokeOk = null; smokeDetail = `smoke errored: ${e.message}`; }
  } else smokeDetail = "backend unreachable — smoke not run";

  // ── report ───────────────────────────────────────────────────────────────────
  const row = (label, val, note = "") => console.log(`  ${label.padEnd(18)} ${val}${note ? "  " + DIM + note + RESET : ""}`);
  console.log("\nDeploy status\n─────────────");
  row("branch", branch || "?");
  row("local HEAD", short(localHead));
  row("origin/main", short(originMain) + (originMain === null ? `  ${YELLOW}(unreachable)${RESET}` : ""));
  row("prod backend", backendSha ? short(backendSha) : `${YELLOW}${backendErr}${RESET}`, backendSha ? "" : BACKEND);
  row("prod frontend", frontendSha ? short(frontendSha) : `${YELLOW}${frontendErr}${RESET}`, frontendSha ? "" : FRONTEND);
  row("prod smoke", smokeOk === true ? `${GREEN}ok${RESET}` : smokeOk === false ? `${RED}FAILING${RESET}` : `${YELLOW}unverified${RESET}`, smokeDetail);

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
