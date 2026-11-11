#!/usr/bin/env node
// STAGE-2 · DRIFT BETWEEN PROD AND STAGING, CAUGHT BEFORE IT BITES.
//
// Staging went live on 11 Nov after five walls, and every one was a setting
// that differed between prod and staging: a stray build command, missing
// DATABASE_URL / RESEND_API_KEY / CORS_ORIGIN, and STEWARD_ENV=staging absent,
// so staging would have booted believing it was prod. This reads both
// environments' Railway settings and says what differs.
//
// Each environment is read with ITS OWN existing project token (prod's
// RAILWAY_TOKEN, staging's RAILWAY_STAGING_TOKEN). No cross-environment
// credential exists or is made.
//
// VALUES ARE NEVER FETCHED. Variables are read through Railway's
// Environment.variables connection, whose Variable type has a name and a
// service but no value field. The only value checked is STEWARD_ENV, and only
// through staging web's public /health (`env: "staging"`, which is
// STEWARD_ENV as the running server read it).
//
// Compared, web↔web (nonprofit-erp↔web) and worker↔worker (steward-worker↔worker):
//   · build command and start command. Prod's worker runs `node worker.js`;
//     staging's runs `node server.js` with STEWARD_PROCESS=worker. Those are equal.
//   · variable NAMES: any name prod has that staging lacks fails, unless it
//     is in scripts/ci/drift-allow.json (each entry with its reason).
//   · staging's must-haves, whatever prod has (MUST_HAVE below).
//
// usage (CI's `drift` job): RAILWAY_PROD_TOKEN=… RAILWAY_STAGING_TOKEN=… \
//   [STAGING_API_URL=https://…] node scripts/ci/railway-drift.js
// Exit 0 no drift, 1 drift, 2 could not read (a token missing or refused).
"use strict";
const fs = require("fs");
const path = require("path");

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const PAIRS = [
  { role: "web", prod: "nonprofit-erp", staging: "web" },
  { role: "worker", prod: "steward-worker", staging: "worker" },
];
const MUST_HAVE = {
  web: ["STEWARD_ENV", "DATABASE_URL", "CORS_ORIGIN", "RESEND_API_KEY", "DATABASE_PUBLIC_URL"],
  worker: ["STEWARD_ENV", "DATABASE_URL", "CORS_ORIGIN", "RESEND_API_KEY"],
};

// Only Railway's own API, or a loopback fake in the test. Tokens go nowhere else.
function apiUrl(env) {
  const u = String(env.RAILWAY_API_URL || RAILWAY_API);
  if (u !== RAILWAY_API && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(u)) throw new Error(`RAILWAY_API_URL must be Railway's API or loopback, not ${u}`);
  return u;
}

async function gql(url, token, query, variables = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "Project-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  // Railway's error messages name the field, never a variable's value.
  if (!r.ok || !body || body.errors) {
    const why = body && body.errors ? body.errors.map(e => e.message).join("; ") : `HTTP ${r.status}`;
    const e = new Error(why); e.unreadable = true; throw e;
  }
  return body.data;
}

const Q_TOKEN = `query { projectToken { projectId environmentId } }`;
const Q_ENV = `query ($id: String!) { environment(id: $id) { name
  serviceInstances(first: 100) { edges { node { serviceId serviceName buildCommand startCommand } } }
  variables(first: 1000) { edges { node { name serviceId } } } } }`;

// One environment's services: { [serviceName]: { build, start, names:Set } }.
// Variables are names only; Railway's Variable type carries no value.
async function readEnvironment(url, token) {
  const t = await gql(url, token, Q_TOKEN);
  const envId = t && t.projectToken && t.projectToken.environmentId;
  if (!envId) { const e = new Error("the token did not name an environment (is it a project token?)"); e.unreadable = true; throw e; }
  const d = await gql(url, token, Q_ENV, { id: envId });
  const env = d && d.environment;
  if (!env) { const e = new Error("the environment could not be read"); e.unreadable = true; throw e; }
  const out = {};
  for (const { node: s } of (env.serviceInstances && env.serviceInstances.edges) || [])
    out[s.serviceName] = { id: s.serviceId, build: s.buildCommand ?? null, start: s.startCommand ?? null, names: new Set() };
  const byId = Object.fromEntries(Object.values(out).map(s => [s.id, s]));
  for (const { node: v } of (env.variables && env.variables.edges) || [])
    if (v && v.serviceId && byId[v.serviceId]) byId[v.serviceId].names.add(String(v.name));   // shared, unreferenced: not in the service
  return { name: env.name, services: out };
}

function loadAllow(file) {
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  const bad = list.filter(e => !e || !e.name || !String(e.reason || "").trim());
  if (bad.length) throw new Error(`every entry in ${path.basename(file)} needs a name and a one-line reason`);
  return list.map(e => ({ ...e, re: new RegExp("^" + String(e.name).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$") }));
}

const norm = c => String(c || "").trim().replace(/\s+/g, " ");
// Prod's worker `node worker.js` ≡ staging's `node server.js` + STEWARD_PROCESS=worker.
function sameStart(role, prod, staging) {
  const p = norm(prod.start), s = norm(staging.start);
  if (p === s) return true;
  return role === "worker" && p === "node worker.js" && s === "node server.js" && staging.names.has("STEWARD_PROCESS");
}

// The comparison itself: pure, so the test can drive it. Returns problem lines (names only).
function compare(prod, staging, allow) {
  const problems = [];
  for (const pair of PAIRS) {
    const p = prod.services[pair.prod], s = staging.services[pair.staging];
    const tag = `${pair.role} (prod ${pair.prod} ↔ staging ${pair.staging})`;
    if (!p) { problems.push(`${tag}: prod has no service named ${pair.prod}`); continue; }
    if (!s) { problems.push(`${tag}: staging has no service named ${pair.staging}`); continue; }
    if (norm(p.build) !== norm(s.build))
      problems.push(`${tag}: build command differs: prod ${p.build ? `"${norm(p.build)}"` : "(none)"}, staging ${s.build ? `"${norm(s.build)}"` : "(none)"}`);
    if (!sameStart(pair.role, p, s))
      problems.push(`${tag}: start command differs: prod ${p.start ? `"${norm(p.start)}"` : "(none)"}, staging ${s.start ? `"${norm(s.start)}"` : "(none)"}`);
    const missing = [...p.names].filter(n => !s.names.has(n) && !allow.some(a => a.re.test(n))).sort();
    for (const n of missing) problems.push(`${tag}: prod has ${n}, staging does not (add it, or put it in scripts/ci/drift-allow.json with a reason)`);
    for (const n of MUST_HAVE[pair.role]) if (!s.names.has(n)) problems.push(`${tag}: staging must have ${n} and does not`);
  }
  return problems;
}

// STEWARD_ENV's value, the one value looked at, as staging web's server reads it.
async function stagingSaysStaging(base) {
  try {
    const r = await fetch(String(base).replace(/\/+$/, "") + "/health", { signal: AbortSignal.timeout(10000) });
    const h = await r.json();
    return h && h.env === "staging" ? null : `staging web's /health says env "${(h && h.env) || "<unset>"}", not "staging" (STEWARD_ENV)`;
  } catch (e) { return `staging web's /health could not be read (${e.message})`; }
}

async function main(env = process.env, log = console.log) {
  const url = apiUrl(env);
  if (!env.RAILWAY_PROD_TOKEN || !env.RAILWAY_STAGING_TOKEN) {
    log("railway-drift: RAILWAY_PROD_TOKEN and RAILWAY_STAGING_TOKEN are both needed (prod's RAILWAY_TOKEN, staging's RAILWAY_STAGING_TOKEN).");
    return 2;
  }
  let prod, staging;
  try {
    prod = await readEnvironment(url, env.RAILWAY_PROD_TOKEN);
    staging = await readEnvironment(url, env.RAILWAY_STAGING_TOKEN);
  } catch (e) {
    if (!e.unreadable) throw e;
    log(`railway-drift: COULD NOT READ the service settings with a project token: ${e.message}`);
    log("A project token that can't read service settings is a stop, not a workaround (STAGE-2). Nothing was compared.");
    return 2;
  }
  const allow = loadAllow(env.DRIFT_ALLOW || path.join(__dirname, "drift-allow.json"));
  const problems = compare(prod, staging, allow);
  if (env.STAGING_API_URL) { const p = await stagingSaysStaging(env.STAGING_API_URL); if (p) problems.push(`web: ${p}`); }
  else log("railway-drift: STAGING_API_URL not set, so STEWARD_ENV's value was not checked (its name still is).");
  log(`railway-drift: prod "${prod.name}" vs staging "${staging.name}", ${PAIRS.length} service pairs.`);
  if (!problems.length) { log("No drift: build and start commands match, and staging has every variable name prod has (less the allowlist) and every must-have."); return 0; }
  log(`DRIFT (${problems.length}):`);
  for (const p of problems) log("  · " + p);
  return 1;
}

if (require.main === module) {
  main().then(code => process.exit(code), e => { console.error(`railway-drift crashed: ${e.message}`); process.exit(2); });
}
module.exports = { compare, readEnvironment, loadAllow, sameStart, main, PAIRS, MUST_HAVE };
