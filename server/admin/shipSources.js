// STAGE-1 · WHAT IS ON STAGING AND NOT YET ON PROD, AND WHETHER IT MAY SHIP.
//
// /ops's "Ship to customers" card reads this. Every merge to main deploys to
// staging and is walked there (ci.yml: deploy-staging, staging-walk). The walk
// writes a commit status, `staging/walk`, on the commit it walked. Prod moves
// only when a super-admin presses Ship, which dispatches ship.yml for exactly
// the commit staging is serving; Roll back dispatches it for the commit prod
// served before this one.
//
// Read-only except for two small tables in this database:
//   deploy_history  one row each time a web process boots on a new commit (the
//                   previous prod commit, for Roll back)
//   prod_ships      one row per Ship or Roll back pressed: who, when, which
//                   commit, which builds (append-only to this code)
// The audit middleware writes the audit row for each press, as for any POST.
// No secret is kept or shown: the GitHub tokens are request headers only.
"use strict";

const REPO = () => process.env.OPS_GITHUB_REPO || "jonnycodes420/nonprofit-erp";
const GH_API = () => (process.env.OPS_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
const STAGING_API = () => (process.env.STAGING_API_URL || "").replace(/\/+$/, "");
const STAGING_FRONTEND = () => (process.env.STAGING_FRONTEND_URL || "https://staging.stewardapp.dev").replace(/\/+$/, "");
const SHIP_WORKFLOW = "ship.yml";
const WALK_CONTEXT = "staging/walk";
const HELD_CONTEXT = "staging/deploy";   // STAGE-3 (scripts/lib/stagingWindow.js)
const SHA = /^[0-9a-f]{40}$/;
const short = s => (s ? String(s).slice(0, 7) : "none");
const BUILD_RE = /^\s*\[?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/;
const buildOf = title => { const m = BUILD_RE.exec(title || ""); return m ? m[1] : null; };

class SourceError extends Error {}
async function within(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" }); }
  finally { clearTimeout(t); }
}
async function gh(path, { method = "GET", body = null, token = process.env.OPS_GITHUB_TOKEN || "" } = {}) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "steward-ops-ship" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try { res = await within(`${GH_API()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new SourceError("GitHub could not be reached."); }
  if (!res.ok) throw Object.assign(new SourceError(`GitHub answered ${res.status}.`), { status: res.status });
  return res.status === 204 ? {} : res.json();
}

// ── Staging, read from its public build stamps ───────────────────────────────
async function readStaging() {
  if (!STAGING_API()) return { configured: false };
  const out = { configured: true, api: STAGING_API(), frontendUrl: STAGING_FRONTEND(), web: null, worker: null, frontend: null, env: null, error: null };
  try {
    const h = await (await within(`${STAGING_API()}/health`)).json();
    out.web = h.buildSha || null; out.worker = (h.worker && h.worker.buildSha) || null; out.env = h.env || null;
  } catch { out.error = "Staging's API did not answer."; }
  try {
    const text = await (await within(STAGING_FRONTEND())).text();
    const m = /<meta\s+name=["']build-sha["']\s+content=["']([^"']*)["']/i.exec(text);
    out.frontend = m ? m[1] : null;
  } catch { out.error = out.error || "Staging's frontend did not answer."; }
  return out;
}

// ── GitHub: the commits between prod and staging, each with its walk ─────────
async function statusOf(sha, context) {
  const s = await gh(`/repos/${REPO()}/commits/${sha}/status`);
  const st = (s.statuses || []).find(x => x.context === context);
  return st ? { state: st.state, url: st.target_url || null, says: st.description || null } : { state: null, url: null, says: null };
}
const walkOf = sha => statusOf(sha, WALK_CONTEXT);
// STAGE-3 · merges on main that staging does not have yet because deploy-staging
// held them during the overnight walk (scripts/ci/staging-hold.js marks each
// `staging/deploy` pending "Held until 3:15 AM ET (overnight walk)").
async function heldBuilds(stagingSha) {
  if (!SHA.test(stagingSha || "")) return { until: null, rows: [] };
  const c = await gh(`/repos/${REPO()}/compare/${stagingSha}...main`);
  if (c.status !== "ahead") return { until: null, rows: [] };
  const rows = [];
  let until = null;
  for (const k of (c.commits || []).slice(-20).reverse()) {
    const st = await statusOf(k.sha, HELD_CONTEXT).catch(() => ({ state: null }));
    if (st.state !== "pending") continue;
    const m = /until (.+?) \(/.exec(st.says || "");
    until = until || (m ? m[1] : null);
    const title = String((k.commit && k.commit.message) || "").split("\n")[0];
    rows.push({ sha: k.sha, title, build: buildOf(title), url: st.url });
  }
  return { until, rows };
}
async function pendingBuilds(prodSha, stagingSha) {
  if (!SHA.test(prodSha || "") || !SHA.test(stagingSha || "") || prodSha === stagingSha) return { ahead: prodSha === stagingSha ? 0 : null, rows: [] };
  const c = await gh(`/repos/${REPO()}/compare/${prodSha}...${stagingSha}`);
  if (c.status !== "ahead") return { ahead: 0, behind: c.behind_by || 0, rows: [] };
  const commits = (c.commits || []).slice(-20).reverse();
  const rows = [];
  for (const k of commits) {
    const title = String((k.commit && k.commit.message) || "").split("\n")[0];
    rows.push({ sha: k.sha, title, build: buildOf(title), walk: await walkOf(k.sha).catch(() => ({ state: null })) });
  }
  return { ahead: c.ahead_by, rows };
}
// The latest push run on main: is it still deploying to or walking staging?
async function stagingInFlight() {
  const runs = await gh(`/repos/${REPO()}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=3`);
  for (const r of runs.workflow_runs || []) {
    if (r.status === "completed") continue;
    const jobs = await gh(`/repos/${REPO()}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`);
    const j = (jobs.jobs || []).find(x => (x.name === "deploy-staging" || x.name === "staging-walk") && x.status !== "completed");
    if (j || !(jobs.jobs || []).some(x => x.name === "deploy-staging")) return { sha: r.head_sha, url: r.html_url };
  }
  return null;
}
async function shipRuns() {
  // Before ship.yml is on main, GitHub has no such workflow: no ship yet, not an error.
  const runs = await gh(`/repos/${REPO()}/actions/workflows/${SHIP_WORKFLOW}/runs?per_page=5`).catch(e => { if (e.status === 404) return {}; throw e; });
  return (runs.workflow_runs || []).map(r => ({ id: r.id, title: r.display_title, status: r.status, conclusion: r.conclusion, url: r.html_url, at: r.created_at }));
}
async function dispatchShip({ sha, mode, reason, by }) {
  const token = process.env.OPS_SHIP_TOKEN || "";
  if (!token) throw new SourceError("OPS_SHIP_TOKEN is not set on this service, so the ship cannot start (docs/needs-jonathan/STAGE-1.md).");
  await gh(`/repos/${REPO()}/actions/workflows/${SHIP_WORKFLOW}/dispatches`, { method: "POST", token,
    body: { ref: "main", inputs: { sha, mode, reason: reason || "", requested_by: String(by || "").slice(0, 80) } } });
}

// ── The two small tables ─────────────────────────────────────────────────────
let _tables = null;
function ensureTables(run) {
  if (!_tables) _tables = Promise.all([
    run(`CREATE TABLE IF NOT EXISTS deploy_history (id BIGSERIAL PRIMARY KEY, sha TEXT NOT NULL, booted_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`, []),
    run(`CREATE TABLE IF NOT EXISTS prod_ships (id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('ship','rollback')), sha TEXT NOT NULL,
      from_sha TEXT, builds TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL)`, []),
  ]).catch(e => { _tables = null; throw e; });
  return _tables;
}
// A web process notes the commit it booted on, when it differs from the last one noted.
async function noteBoot({ run, sha }) {
  if (!SHA.test(sha || "")) return false;
  await ensureTables(run);
  await run(`INSERT INTO deploy_history (sha) SELECT ? WHERE ? IS DISTINCT FROM (SELECT sha FROM deploy_history ORDER BY id DESC LIMIT 1)`, [sha, sha]);
  return true;
}
// The commit prod served before the one it serves now.
async function previousSha({ run, query, current }) {
  await ensureTables(run);
  const rows = await query(`SELECT sha FROM deploy_history ORDER BY id DESC LIMIT 50`, []);
  const i = rows.findIndex(r => r.sha === current);
  const after = i >= 0 ? rows.slice(i) : rows;
  const prev = after.find(r => r.sha !== current);
  return prev ? prev.sha : null;
}

// ── The rule: may Ship and Roll back be pressed now? Pure, so the test holds it.
// The first reason that applies is the one shown on the disabled button.
function decide({ prodSha, staging, pending, walk, inFlight, ship, previous }) {
  const running = ship && ship.status !== "completed";
  let canShip = false, shipReason = null;
  if (!staging || !staging.configured) shipReason = "Staging is not set up yet (docs/needs-jonathan/STAGE-1.md).";
  else if (staging.error) shipReason = staging.error;
  else if (staging.env !== "staging") shipReason = "Staging's API does not say it is staging, so nothing ships from it.";
  else if (running) shipReason = `A ${/rollback/i.test(ship.title || "") ? "roll back" : "ship"} is running now.`;
  else if (inFlight) shipReason = `Staging is mid-deploy (${short(inFlight.sha)}). Ship when its walk is green.`;
  else if (!staging.web || staging.web !== staging.worker || staging.web !== staging.frontend)
    shipReason = `Staging is mid-deploy: web ${short(staging.web)}, worker ${short(staging.worker)}, frontend ${short(staging.frontend)}.`;
  else if (staging.web === prodSha || (pending && pending.ahead === 0)) shipReason = `Nothing to ship: customers already have ${short(prodSha)}.`;
  else if (!walk || !walk.state || walk.state === "pending") shipReason = `Staging's walk on ${short(staging.web)} has not finished.`;
  else if (walk.state !== "success") shipReason = `Staging's walk on ${short(staging.web)} failed${walk.says ? `: ${walk.says}` : ""}. Fix it on main first.`;
  else canShip = true;
  let canRollback = false, rollbackReason = null;
  if (running) rollbackReason = "A ship or roll back is running now.";
  else if (!previous) rollbackReason = "The commit prod served before this one is not known yet (it is noted from the next deploy on).";
  else canRollback = true;
  return { canShip, shipReason, canRollback, rollbackReason };
}

// Everything the card shows, read now. Each source fails on its own.
async function readCard({ run, query, prodSha }) {
  const errors = [];
  const settle = async (what, fn, dflt) => { try { return await fn(); } catch (e) { errors.push(`${what}: ${e instanceof SourceError ? e.message : "it could not be read."}`); return dflt; } };
  const staging = await readStaging();
  const pending = staging.configured && staging.web ? await settle("the builds on staging", () => pendingBuilds(prodSha, staging.web), null) : null;
  const walk = staging.web && SHA.test(staging.web) ? await settle("staging's walk", () => walkOf(staging.web), null) : null;
  const held = staging.web && SHA.test(staging.web) ? await settle("the held staging deploys", () => heldBuilds(staging.web), null) : null;
  const inFlight = staging.configured ? await settle("staging's deploys", stagingInFlight, null) : null;
  const ships = await settle("the ships", shipRuns, []);
  const previous = await settle("the previous prod commit", () => previousSha({ run, query, current: prodSha }), null);
  const verdict = decide({ prodSha, staging, pending, walk, inFlight, ship: ships[0] || null, previous });
  return { prodSha, previousSha: previous, staging, pending: pending ? pending.rows : [], walk, inFlight, held: held && held.rows.length ? held : null, lastShip: ships[0] || null, errors, ...verdict };
}

module.exports = { readCard, decide, heldBuilds, HELD_CONTEXT, dispatchShip, noteBoot, previousSha, ensureTables, buildOf, SourceError, WALK_CONTEXT, SHA };
