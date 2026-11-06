// DEVBOARD-1 · WHAT /ops READS FROM OUTSIDE THE PROCESS.
//
// GitHub (pull requests, CI, the nightly load run), the frontend's build-sha
// meta, and the live orgs. The worker collects them every five minutes
// (`opsBoardRefresh`, jobQueue) into ONE row of ops_snapshots, so the page is a
// single indexed read and never waits on GitHub. Each source is collected on
// its own: one that fails says so in its own section and the rest still land.
//
// Nothing secret is kept: no token, no connection string, no address, no donor.
// The GitHub token (OPS_GITHUB_TOKEN, read-only) is only ever a request header.
"use strict";
const zlib = require("zlib");
const ORG_KIND = require("../../orgKind");
const STATUS = require("../../scripts/ci/status");   // the same checks as npm run status

const REPO = () => process.env.OPS_GITHUB_REPO || "jonnycodes420/nonprofit-erp";
const GH_API = () => (process.env.OPS_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
const FRONTEND = () => (process.env.STATUS_FRONTEND_URL || "https://www.stewardapp.dev").replace(/\/+$/, "");
const TOKEN = () => process.env.OPS_GITHUB_TOKEN || "";
const QUIET_MS = 45 * 60 * 1000;
const PARKED_MS = 7 * 24 * 3600e3;   // no push or CI for a week: parked, not a tab gone quiet
// Without a token GitHub allows 60 calls an hour from an address, so the
// GitHub part refreshes every 30 minutes instead of every 5.
const GH_EVERY_MS = () => (TOKEN() ? 5 : 30) * 60 * 1000;
const TIMEOUT_MS = 8000;

async function fetchWithin(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" }); }
  finally { clearTimeout(t); }
}
class SourceError extends Error {}
async function gh(path, { raw = false } = {}) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "steward-ops-board" };
  if (TOKEN()) headers.Authorization = `Bearer ${TOKEN()}`;
  let res;
  try { res = await fetchWithin(`${GH_API()}${path}`, { headers }); }
  catch (e) { throw new SourceError(e.name === "AbortError" ? "GitHub did not answer within 8 seconds." : "GitHub could not be reached."); }
  if (res.status === 403 || res.status === 429) throw new SourceError(`GitHub refused the request (${res.status}${TOKEN() ? "" : ", the hourly limit without a token; set OPS_GITHUB_TOKEN"}).`);
  if (!res.ok) throw new SourceError(`GitHub answered ${res.status}.`);
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

// The one file in a GitHub artifact zip (the load summary), read from the
// zip's central directory. Stored or deflated, nothing else.
function unzipOne(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    if (name === want || name.endsWith("/" + want)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.slice(start, start + size);
      return method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    }
    p += 46 + nameLen + extra + comment;
  }
  return null;
}

const BUILD_RE = /^\s*\[?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/;
const buildOf = title => { const m = BUILD_RE.exec(title || ""); return m ? m[1] : null; };
const ms = iso => (iso ? new Date(iso).getTime() : 0);

// One PR's state from its latest CI run. Pure, so the test can hold it.
function prState(pr, run, { now, deployedHas }) {
  if (pr.merged_at) {
    const live = deployedHas === true;
    return { state: live ? "live" : "merged", since: pr.merged_at, quiet: null,
      note: deployedHas == null ? "could not tell whether it is deployed" : null };
  }
  let state, since;
  if (!run) { state = "building"; since = pr.created_at; }
  else if (run.status !== "completed") { state = "ci running"; since = run.run_started_at || run.created_at; }
  else if (run.conclusion === "success") { state = "green"; since = run.updated_at; }
  else { state = "red"; since = run.updated_at; }
  const last = Math.max(ms(pr.updated_at), run ? ms(run.updated_at) : 0);
  if (now - last > PARKED_MS) return { state: "parked", since: new Date(last).toISOString(), quiet: null, note: null };
  const quiet = state !== "ci running" && now - last > QUIET_MS ? Math.round((now - last) / 60000) : null;
  return { state, since, quiet, note: null };
}

async function collectBuilds({ now, deployedSha }) {
  const R = REPO();
  let [open, closed] = await Promise.all([
    gh(`/repos/${R}/pulls?state=open&per_page=30`),
    gh(`/repos/${R}/pulls?state=closed&sort=updated&direction=desc&per_page=15`),
  ]);
  const isBot = p => p.user && (p.user.type === "Bot" || /\[bot\]$/.test(p.user.login || ""));
  const bots = open.filter(isBot).length;
  open = open.filter(p => !isBot(p));
  const recent = closed.filter(p => p.merged_at && now - ms(p.merged_at) < 72 * 3600e3).slice(0, 8);
  const rows = [];
  for (const pr of open) {
    const runs = await gh(`/repos/${R}/actions/workflows/ci.yml/runs?head_sha=${encodeURIComponent(pr.head.sha)}&per_page=1`);
    const run = (runs.workflow_runs || [])[0] || null;
    rows.push({ pr, run, ...prState(pr, run, { now }) });
  }
  for (const pr of recent) {
    let deployedHas = null;
    if (deployedSha && pr.merge_commit_sha) {
      if (deployedSha === pr.merge_commit_sha) deployedHas = true;
      else {
        try { const c = await gh(`/repos/${R}/compare/${pr.merge_commit_sha}...${deployedSha}`); deployedHas = c.status === "ahead" || c.status === "identical"; }
        catch { deployedHas = null; }
      }
    }
    rows.push({ pr, run: null, ...prState(pr, null, { now, deployedHas }) });
  }
  const order = { red: 0, "ci running": 1, building: 2, green: 3, merged: 4, live: 5, parked: 6 };
  rows.sort((a, b) => order[a.state] - order[b.state] || ms(b.since) - ms(a.since));
  return { bots, rows: rows.map(r => ({
    number: r.pr.number, title: r.pr.title, build: buildOf(r.pr.title), url: r.pr.html_url, branch: r.pr.head && r.pr.head.ref,
    state: r.state, since: r.since, quietMinutes: r.quiet, note: r.note, ciUrl: r.run ? r.run.html_url : null,
  })) };
}

// The latest push to main: its post-deploy smoke and AI smoke steps.
async function collectCi() {
  const R = REPO();
  const runs = await gh(`/repos/${R}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=1`);
  const run = (runs.workflow_runs || [])[0];
  if (!run) return { sha: null, smoke: null, aiSmoke: null, url: null };
  const jobs = await gh(`/repos/${R}/actions/runs/${run.id}/jobs?per_page=50`);
  const deploy = (jobs.jobs || []).find(j => j.name === "deploy-railway");
  const step = re => { const s = deploy && (deploy.steps || []).find(x => re.test(x.name)); return s ? (s.conclusion || s.status) : null; };
  // STAGE-1: with staging on, prod moves in ship.yml (Ship on /ops), not on the push.
  if (!deploy || deploy.conclusion === "skipped") {
    const ships = await gh(`/repos/${R}/actions/workflows/ship.yml/runs?per_page=1`).catch(() => ({}));
    const sr = (ships.workflow_runs || [])[0];
    if (sr) {
      const sj = ((await gh(`/repos/${R}/actions/runs/${sr.id}/jobs?per_page=10`)).jobs || []).find(j => j.name === "ship");
      const sstep = re => { const x = sj && (sj.steps || []).find(y => re.test(y.name)); return x ? (x.conclusion || x.status) : null; };
      return { sha: sr.head_sha, at: sr.updated_at, url: sr.html_url, run: sr.status === "completed" ? sr.conclusion : sr.status,
        smoke: sstep(/Prod serves this commit/i), aiSmoke: sstep(/AI smoke/i), via: "ship" };
    }
  }
  return { sha: run.head_sha, at: run.updated_at, url: run.html_url, run: run.status === "completed" ? run.conclusion : run.status,
    smoke: step(/Verify prod is healthy/i), aiSmoke: step(/AI smoke/i) };
}

// The nightly load run, and its slowest route from the load-summary artifact
// (the artifact needs the token; without it the run's verdict alone).
async function collectLoad({ now }) {
  const R = REPO();
  const runs = await gh(`/repos/${R}/actions/workflows/load-nightly.yml/runs?per_page=1`);
  const r = (runs.workflow_runs || [])[0];
  if (!r) return STATUS.loadReport(null, null, now);
  const run = { conclusion: r.status === "completed" ? r.conclusion : null, createdAt: r.created_at, url: r.html_url };
  let summary = null;
  if (TOKEN() && run.conclusion) {
    try {
      const arts = await gh(`/repos/${R}/actions/runs/${r.id}/artifacts`);
      const a = (arts.artifacts || []).find(x => x.name === "load-summary" && !x.expired);
      const buf = a ? unzipOne(await gh(`/repos/${R}/actions/artifacts/${a.id}/zip`, { raw: true }), "load-summary.json") : null;
      if (buf) summary = JSON.parse(buf.toString("utf8"));
    } catch { /* the verdict without its slowest route */ }
  }
  const report = STATUS.loadReport(run, summary, now);
  if (!summary && !TOKEN()) report.detail = report.detail.replace("no summary kept", "the slowest route needs OPS_GITHUB_TOKEN");
  return { ...report, url: run.url, at: run.createdAt };
}

async function collectFrontend() {
  let res;
  try { res = await fetchWithin(FRONTEND(), { headers: { "User-Agent": "steward-ops-board" } }); }
  catch { throw new SourceError("The frontend could not be reached."); }
  const text = await res.text();
  const m = /<meta\s+name=["']build-sha["']\s+content=["']([^"']*)["']/i.exec(text);
  if (!m) throw new SourceError(res.ok ? "The frontend page has no build-sha." : `The frontend answered ${res.status}.`);
  return { sha: m[1] };
}

// One row per live org: a customer by its Kind (orgKind.js, the console's one
// rule), not archived. Its name and last sign-in only; no person, no money.
// DEVBOARD-3: the same rule picks the Journey tab's orgs (customerOrgs).
async function customerOrgs(query) {
  const [orgs, users, pays, real] = await Promise.all([
    query(`SELECT id, name, org_slug, org_kind, is_demo_org, subscription_status, archived_at, created_at FROM orgs`, []),
    query(`SELECT org_id, email FROM users WHERE deactivated_at IS NULL`, []),
    query(`SELECT org_id, COUNT(*) AS c FROM platform_payments GROUP BY org_id`, []),
    query(`SELECT org_id, COUNT(*) AS c FROM donors WHERE deleted_at IS NULL AND COALESCE(is_sample,false) = false GROUP BY org_id`, []),
  ]);
  const group = new Map();
  for (const u of users) { if (!group.has(u.org_id)) group.set(u.org_id, []); group.get(u.org_id).push({ email: u.email }); }
  const pay = new Map(pays.map(r => [r.org_id, r])), realN = new Map(real.map(r => [r.org_id, Number(r.c)]));
  return orgs.filter(o => !o.archived_at).filter(o => ORG_KIND.inferKind(o, {
    users: group.get(o.id) || [], payments: Number(pay.get(o.id)?.c || 0), realDonors: realN.get(o.id) || 0,
  }).kind === "customer");
}
async function collectCustomers(query) {
  const [orgs, logins] = await Promise.all([customerOrgs(query),
    query(`SELECT s.org_id, MAX(s.created_at) AS t FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id GROUP BY s.org_id`, [])]);
  const last = new Map(logins.map(r => [r.org_id, r.t]));
  return orgs.map(o => ({ name: o.name, slug: o.org_slug, lastLogin: last.get(o.id) ? new Date(last.get(o.id)).toISOString() : null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const settle = async fn => { try { return { ok: true, ...(await fn()) }; } catch (e) { return { ok: false, error: e instanceof SourceError ? e.message : "This could not be read." }; } };

// The worker's five-minute job: collect, then write the one row.
async function refreshSnapshot({ query, run, buildSha = null, now = Date.now() }) {
  const prev = await readSnapshot(query).catch(() => null);
  const prevGh = prev && prev.body && prev.body.github;
  const ghFresh = prevGh && prevGh.collectedAt && now - ms(prevGh.collectedAt) < GH_EVERY_MS() - 30000 && prevGh.builds && prevGh.builds.ok;
  const github = ghFresh ? prevGh : {
    collectedAt: new Date(now).toISOString(),
    builds: await settle(() => collectBuilds({ now, deployedSha: buildSha })),
    ci: await settle(collectCi),
    load: await settle(() => collectLoad({ now })),
  };
  const body = {
    github,
    frontend: await settle(collectFrontend),
    customers: await settle(async () => ({ rows: await collectCustomers(query) })),
    collectedBy: buildSha,
  };
  // The table is this module's own (db.js is at its size limit); one row, no donor data.
  await run(`CREATE TABLE IF NOT EXISTS ops_snapshots (key TEXT PRIMARY KEY, body JSONB NOT NULL, refreshed_at TIMESTAMPTZ NOT NULL)`, []);
  await run(`INSERT INTO ops_snapshots (key, body, refreshed_at) VALUES ('ops', ?::jsonb, ?)
             ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, refreshed_at = EXCLUDED.refreshed_at`,
    [JSON.stringify(body), new Date(now).toISOString()]);
  return body;
}
async function readSnapshot(query) {
  const [row] = await query(`SELECT body, refreshed_at FROM ops_snapshots WHERE key = 'ops'`, []);
  return row ? { body: row.body, refreshedAt: new Date(row.refreshed_at).toISOString() } : null;
}

module.exports = { refreshSnapshot, readSnapshot, customerOrgs, prState, buildOf, unzipOne, QUIET_MS };
