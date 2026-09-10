// BUILD-26 Part B3, replaced by BUILD-73 Part 3 — the OUTCOME-CLAIM BAN.
//
// B3 made "recovered" a RESERVED word: it could attach only to dollars the
// failed-card workflow attributably won back. That was the right rule and it
// was not enough. On the demo org — a decade of seeded history — the Home hero
// rendered "$2M re-engaged from 610 lapsed donors", every word of which passed
// B3, and which nobody reads as a description of the ORGANIZATION'S past. It
// reads as money STEWARD brought in, on the first screen a prospect sees. That
// is invented social proof, and if a prospect later works out the number is
// synthetic, everything else said in that meeting becomes suspect.
//
// THE RULE NOW: the value math describes the SIZE OF THE PROBLEM and never
// Steward's results. The product shows money AT RISK, never money recovered.
//
// So this suite bans the FAMILY, not one exact string — "recovered",
// "re-engaged"/"reengaged" as a past-tense outcome, "recaptured", "won back",
// "brought back" — everywhere a user can read it: app copy, emails, PDFs, CSV
// headers, the demo seed and the landing page.
//
// WHAT IS DELIBERATELY STILL ALLOWED, and why the scan can tell the difference:
// the words survive as IDENTIFIERS — `recoveredAmount`, `recovered_at`,
// `payment_recovered`, the `recovered` subscription status, the
// `recovered_thankyou` template key. Renaming a database column does not make a
// claim to anybody. The scan therefore reads STRING LITERALS and JSX TEXT — the
// things that reach a screen — and ignores identifiers, snake_case keys, SQL
// and console output.
//
// Three guards:
//   1. the family scan over user-facing copy;
//   2. a live assertion that GET /impact leads with at-risk and that its
//      payload carries no banned label;
//   3. the original B3 assertion, kept: the win-back goal counts ONLY genuine
//      >365-day-gap giving, not all incoming giving.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, textMatch } = require("./helpers");

const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);
const A = "org_rr_a";

// THE FAMILY. Asserted on the shape of the claim, not on one spelling.
const FAMILY = [
  { re: /\brecovered\b/i,       name: "recovered" },
  { re: /\bre-?engaged\b/i,     name: "re-engaged / reengaged" },
  { re: /\brecaptured\b/i,      name: "recaptured" },
  { re: /\bwon\s+back\b/i,      name: "won back" },
  { re: /\bbrought\s+back\b/i,  name: "brought back" },
];

// DELIBERATELY NOT BANNED: "recovery" and "recovering" as PROCESS nouns —
// "failed-card recovery", "recovery emails", "Needs recovery", the
// `lapsed_recovery` goal type. Those name a workflow Steward actually runs;
// they are not a claim about money it brought in. The banned words above are
// all PAST-TENSE OUTCOMES, which is the shape that reads as a results claim.
// Drawing the line at tense rather than at the root keeps a feature honestly
// nameable while making the overclaim unshippable.

// A chunk is NOT user-facing copy when it is one of these. Each entry is a
// claim a reader can check, not a blanket suppression.
const NOT_COPY = [
  { re: /^[a-z0-9_.]+$/,                       why: "a snake_case identifier, key or column name" },
  { re: /^[a-zA-Z0-9_.]+$/,                    why: "a bare identifier or field name" },
  { re: /\b(SELECT|UPDATE|INSERT|DELETE|FROM|WHERE|JOIN|COALESCE|GROUP BY)\b/, why: "SQL" },
  { re: /^\[[a-z-]+\]/,                        why: "a console log prefix" },
  { re: /^https?:\/\//,                        why: "a URL" },
];

function chunksOf(line) {
  // Interpolated expressions are CODE, not copy: `Donors: ${fund.recovered}`
  // reads a field whose name nobody sees. Strip them before testing, or every
  // template literal that touches an identifier becomes a false positive.
  line = line.replace(/\$\{[^}]*\}/g, " ");
  const out = [];
  // Quoted string literals of all three kinds.
  for (const m of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g))
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  // JSX text between tags — the copy that never sits in quotes at all.
  for (const m of line.matchAll(/>([^<>{}]{3,})</g)) out.push(m[1]);
  return out.map(c => c.trim()).filter(Boolean);
}

(async () => {
  // ── 1. The family scan over user-facing copy ──
  const repoRoot = path.join(__dirname, "..");
  const tracked = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  // Every surface the brief names: app copy, emails, PDFs, the demo seed, the
  // landing page. tests/ is excluded (this file has to be able to say the words).
  const inScope = f => /\.(jsx?|tsx?)$/.test(f)
    && !f.startsWith("tests/") && !f.startsWith("node_modules/") && !f.startsWith("client/dist/")
    && (f.startsWith("client/src/") || f.startsWith("scripts/seed-") || f.startsWith("scripts/demo")
        || f === "server.js" || f === "db.js" || f === "branding.js" || f === "auth.js");
  const files = tracked.filter(inScope);
  ok(`scanned every user-facing surface (${files.length} files)`, files.length > 20, files.length);

  const offenders = [];
  for (const rel of files) {
    let lines;
    try { lines = fs.readFileSync(path.join(repoRoot, rel), "utf8").split("\n"); } catch { continue; }
    lines.forEach((raw, i) => {
      const line = raw.replace(/\/\/.*$/, "");                 // a comment may name the ban
      if (/^\s*(\*|\/\*)/.test(raw)) return;                    // block-comment body
      if (/console\.(log|error|warn)/.test(line)) return;      // operator output, not copy
      for (const chunk of chunksOf(line)) {
        if (NOT_COPY.some(n => n.re.test(chunk))) continue;
        const hit = FAMILY.find(f => f.re.test(chunk));
        if (hit) offenders.push(`${rel}:${i + 1}  [${hit.name}]  ${chunk.slice(0, 80)}`);
      }
    });
  }
  ok(`no outcome-claim language in user-facing copy (found ${offenders.length})`, offenders.length === 0);
  if (offenders.length) offenders.slice(0, 25).forEach(o => console.error("    " + o));

  // The scan must be capable of failing — a guard nobody has watched fail is a
  // guess. Drive the exact sentence the demo used to open on.
  const sampleBad = `line: <>Steward has re-engaged <strong>$2M</strong> from 610 lapsed donors</>`;
  ok("the scan CATCHES the sentence the demo used to open on",
     chunksOf(sampleBad).concat(["Steward has re-engaged $2M from 610 lapsed donors"])
       .some(c => !NOT_COPY.some(n => n.re.test(c)) && FAMILY.some(f => f.re.test(c))));
  ok("...and does NOT flag an identifier like recoveredAmount or recovered_at",
     ["recoveredAmount", "recovered_at", "payment_recovered", "recovered_thankyou"]
       .every(c => NOT_COPY.some(n => n.re.test(c))));

  // BUILD-76 LANGUAGE decision, recorded as an assertion instead of an
  // accident: the FORWARD-LOOKING process noun ("re-engagement email",
  // "At-Risk Re-Engagement") names a workflow, not a result, and is
  // DELIBERATELY allowed — the ban is drawn at past-tense outcomes. The home
  // screen's "AI-drafted re-engagement email ready for review" is legal on
  // purpose, not missed.
  ok("forward-looking 're-engagement' (process noun) is deliberately ALLOWED",
     ["AI-drafted re-engagement email ready for review", "At-Risk Re-Engagement", "Re-engage {donor} — lapsing"]
       .every(c => !FAMILY.some(f => f.re.test(c))));
  ok("…while the past-tense outcome 're-engaged' stays banned",
     FAMILY.some(f => f.re.test("we re-engaged 610 donors")));

  // ── 2. Live: the win-back goal counts ONLY genuine re-engaged giving ──
  for (const t of ["fundraising_goals", "gifts", "interactions", "fin_transactions", "budgets", "accounts", "fin_funds", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
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

  // ── 3. Live: GET /impact carries the attributable figures, and NOT a
  // lifetime-giving "at risk" cohort ──────────────────────────────────────
  // CONTRACT CHANGE, BUILD-83 Part 3.3 (deliberate, reviewed): the quiet-donor
  // cohort is DELETED. It summed the LIFETIME giving of every donor with no
  // gift in six months, which on a real file is most of the file — "$38.7M at
  // risk across 19,855 quiet donors" was 79% of a 25,000-donor import, and it
  // is the number that makes an ED close the laptop. At risk is the NEXT gift,
  // not the lifetime, and the donors at risk are the ones past their OWN
  // pattern — which is Drift, donor by donor, with a sentence. So this section
  // now asserts the cohort is GONE and that /impact still carries the honest,
  // attributable figures it was always allowed to claim.
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,gift_count,total_giving) VALUES ('d_quiet',$1,'Quiet Quinn','quiet@rr.local','mid','lapsed',1,2400)`, [A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ('g_quiet',$1,'d_quiet',2400,$2)`, [A, daysAgo(800)]);
  const impact = (await api("GET", "/impact", tA)).body;

  ok("/impact no longer publishes a lifetime-giving at-risk headline",
     impact.atRiskAmount === undefined && impact.quietDonorCount === undefined,
     { atRiskAmount: impact.atRiskAmount, quietDonorCount: impact.quietDonorCount });
  ok("the re-engagement LIST survives (a list of people to call is not a headline dollar figure)",
     Array.isArray(impact.reengageCandidates) && impact.reengageCandidates.some(r => r.id === "d_quiet"),
     impact.reengageCandidates);
  ok("the attributable figures are still there and still separate",
     typeof impact.recoveredAmount === "number" && typeof impact.reengagedAmount === "number"
     && impact.platformFeesPaid === 0, { r: impact.recoveredAmount, re: impact.reengagedAmount });
  ok("the quiet threshold is still stated in the payload, not implied",
     impact.quietSinceDays === 180, impact.quietSinceDays);

  // And nothing in the payload carries a banned LABEL (field names are fine).
  // BUILD-84 census — the payload is WALKED for its string LEAVES, instead of
  // being serialised and scraped with a quoted-run regex (which also caught
  // KEY names and any punctuation the serialiser happened to add).
  const labels = [];
  (await textMatch()).findLeaf(impact, v => { if (typeof v === "string" && v.length >= 6) labels.push(v); return false; });
  const badLabel = labels.filter(l => !/^[a-zA-Z0-9_]+$/.test(l) && FAMILY.some(f => f.re.test(l)));
  ok(`no outcome-claim label in the /impact payload (found ${badLabel.length})`,
     badLabel.length === 0, badLabel.slice(0, 5));

  for (const t of ["fundraising_goals", "gifts", "interactions", "fin_transactions", "budgets", "accounts", "fin_funds", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [A]).catch(() => {});
  // ── 4. The copy cannot contradict the figure ──
  // This shipped wrong for exactly one build: the Home chip read "544 quiet
  // donors · no gift in over a year" while the server's threshold was 180 days.
  // The number and the sentence were maintained in different files. Every
  // surface now derives the phrase from the payload, and this pins it.
  const { quietPhrase } = await import("../client/src/lib/money.js");
  ok("quietPhrase(180) reads '6 months' — matching QUIET_DAYS, not 'a year'",
     quietPhrase(180) === "6 months", quietPhrase(180));
  ok("quietPhrase(365) reads 'a year'", quietPhrase(365) === "a year", quietPhrase(365));
  ok("quietPhrase(730) reads '2 years'", quietPhrase(730) === "2 years", quietPhrase(730));
  ok("quietPhrase degrades on junk rather than rendering NaN",
     quietPhrase(null) === "a while" && quietPhrase(0) === "a while" && quietPhrase("x") === "a while",
     [quietPhrase(null), quietPhrase(0), quietPhrase("x")]);
  ok("the phrase the app renders matches the threshold the server reports",
     quietPhrase(impact.quietSinceDays) === "6 months", impact.quietSinceDays);
  // And the surfaces derive it rather than hardcoding a duration.
  const dashSrc = fs.readFileSync(path.join(repoRoot, "client/src/components/Dashboard.jsx"), "utf8");
  ok("the Home chip derives its duration from the payload, never a literal",
     /quietPhrase\(impact\?\.quietSinceDays\)/.test(dashSrc) && !/no gift in over a year/.test(dashSrc),
     null);

  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });
