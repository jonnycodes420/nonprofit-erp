// BUILD-26 Part B3 — "recovered" is a RESERVED word.
// Local scratch server + Postgres (tests/README.md) + a source grep-guard.
//
// "Recovered" (and "recovery … won back") may attach ONLY to dollars the
// failed-card recovery workflow attributably won back (payment_recovery_events /
// impact.recoveredAmount). It must NEVER label ordinary incoming giving — a Home
// line reading "$169,557 recovered from 143 donors this week" for gifts Steward
// didn't recover overclaims what the product did. Two guards:
//   1. a source grep-guard forbidding the overclaim phrasings in user-facing code;
//   2. a live assertion that the "Win back … lapsed giving" goal counts ONLY
//      genuine re-engaged (>365-day-gap) gifts, not all incoming giving.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);
const A = "org_rr_a";

// Overclaim shapes: a figure/period labeled "recovered" that isn't the tracked
// recovery amount. Deliberately narrow so the LEGITIMATE uses still pass:
//   "the failed-card recovery workflow won back", "recovery rate",
//   "Steward has recovered $X in lapsing gifts" (impact.recoveredAmount).
const FORBIDDEN = [
  /\brecovered\s+from\b/i,                                   // "$X recovered from N donors"
  /\brecovered\s+(this|last)\s+(week|month|quarter|year)\b/i, // "recovered this week"
];

(async () => {
  // ── 1. Source grep-guard ──
  const repoRoot = path.join(__dirname, "..");
  const tracked = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  const inScope = f => /\.(jsx?|tsx?)$/.test(f) && !f.startsWith("tests/") && !f.startsWith("node_modules/")
    && (f.startsWith("client/src/") || f === "server.js" || f === "db.js" || f === "branding.js" || f === "auth.js");
  const files = tracked.filter(inScope);
  ok(`scanned a reasonable source set (${files.length})`, files.length > 20);
  const offenders = [];
  for (const rel of files) {
    let lines;
    try { lines = fs.readFileSync(path.join(repoRoot, rel), "utf8").split("\n"); } catch { continue; }
    lines.forEach((ln, i) => { if (FORBIDDEN.some(re => re.test(ln))) offenders.push(`${rel}:${i + 1}  ${ln.trim().slice(0, 90)}`); });
  }
  ok(`no non-attributable "recovered" phrasing in user-facing source (found ${offenders.length})`, offenders.length === 0);
  if (offenders.length) offenders.slice(0, 20).forEach(o => console.error("    " + o));

  // ── 2. Live: the win-back goal counts ONLY genuine re-engaged giving ──
  for (const t of ["fundraising_goals", "gifts", "interactions", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [A]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'RR Org','rr-a',1,'active','growth')`, [A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_rr',$1,'rr@rr.local',$2,'Admin','admin')`, [A, bcrypt.hashSync("loadtest1234", 10)]);
  const tA = await login("rr@rr.local");

  // Donor WB: last gave 500 days ago, then $1,000 today → a genuine win-back (>365d gap).
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,gift_count) VALUES ('d_wb',$1,'Winback Wanda','wb@rr.local','mid','lapsed',2)`, [A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ('g_wb_old',$1,'d_wb',200,$2)`, [A, daysAgo(500)]);
  // Donor RP: gave 30 days ago, then $5,000 today → an ordinary repeat gift (NO gap).
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,gift_count) VALUES ('d_rp',$1,'Repeat Rita','rp@rr.local','mid','steward',2)`, [A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ('g_rp_old',$1,'d_rp',300,$2)`, [A, daysAgo(30)]);

  // Both give a fresh gift today via the real route (updates last_gift_date).
  await api("POST", `/donors/d_wb/gifts`, tA, { amount: 1000, date: daysAgo(0) });
  await api("POST", `/donors/d_rp/gifts`, tA, { amount: 5000, date: daysAgo(0) });

  // A "Win back … lapsed giving" goal spanning the period.
  await api("POST", "/goals", tA, { label: "Win back $10,000 in lapsed giving", goalAmount: 10000, goalType: "lapsed_recovery", periodStart: daysAgo(60), periodEnd: daysAgo(-30) });
  const goal = (await api("GET", "/goals/active", tA)).body;
  ok("win-back goal active", goal && goal.goalType === "lapsed_recovery", goal);
  // currentAmount must be ONLY the $1,000 win-back — NOT the $5,000 repeat, NOT the $6,000 total.
  ok("win-back progress counts the re-engaged gift ($1,000)", Number(goal.currentAmount) === 1000, goal.currentAmount);
  ok("win-back progress EXCLUDES the ordinary repeat gift (not $5,000/$6,000)", Number(goal.currentAmount) !== 5000 && Number(goal.currentAmount) !== 6000);
  // The trailing-week momentum figure (what the Home line shows) is the same
  // attributable slice — so "came in from N donors" reports real win-back giving.
  ok("recent momentum figure is the re-engaged slice only", Number(goal.recentAmount) === 1000, goal.recentAmount);
  ok("recent momentum donor count is 1 (the winback donor)", Number(goal.recentDonorCount) === 1, goal.recentDonorCount);

  for (const t of ["fundraising_goals", "gifts", "interactions", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [A]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });
