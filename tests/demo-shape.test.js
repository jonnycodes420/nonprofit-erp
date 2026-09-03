// BUILD-73 Part 3.2 — THE DEMO'S SHAPE, ASSERTED.
//
// The demo is the pitch, and the pitch is a specific claim about WHICH donors
// matter: eleven quiet mid-level donors, never four hundred lapsed $50s. That
// difference is the entire differentiator. A seed that drifts toward a flat
// file — or toward one so top-heavy it reads as fake to anyone who has opened a
// real donor file — tells the lapsed-recapture story every other tool tells.
//
// BUILD-72 Part 5 built the shape and printed it once, at seed time, where
// nobody would see it again. This asserts it, so it cannot quietly regress.
//
// The contract is a set of RANGES, exported from the seed itself
// (scripts/seed-build72-demo.js SHAPE) rather than duplicated here — a copy
// would drift from the seed the first time either changed. Ranges, not exact
// numbers, because the tail is randomly generated on purpose: a test demanding
// an exact percentage would be pinning the random seed, not the shape.
//
// Skips cleanly when the demo org is not seeded, so run-all stays portable.
// Seed it with:
//   BASE=http://localhost:5606 node scripts/seed-build72-demo.js

const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { DRIFTED, SHAPE, ORG, ADMIN_EMAIL, ADMIN_PASSWORD } = require("../scripts/seed-build72-demo.js");

const pct = n => (n * 100).toFixed(1) + "%";

(async () => {
  const [present] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  if (!present || present.n === 0) {
    console.log("  SKIP — demo org not seeded (run scripts/seed-build72-demo.js)\n\n0 passed, 0 failed (suite skipped)");
    await closeDb(); process.exit(0);
  }

  // ── 1 · the file's shape ────────────────────────────────────────────────
  console.log("— §1 · the generated file's shape —");
  const donorTotals = await q(
    `SELECT d.id, d.name, COALESCE(SUM(g.amount), 0)::float AS total
       FROM donors d LEFT JOIN gifts g ON g.donor_id = d.id
      WHERE d.org_id = $1 AND d.deleted_at IS NULL
      GROUP BY d.id, d.name ORDER BY total DESC`, [ORG]);

  const donorCount = donorTotals.length;
  const revenue = donorTotals.reduce((s, r) => s + r.total, 0);
  ok(`donor count is in range (${donorCount})`,
     donorCount >= SHAPE.donorsMin && donorCount <= SHAPE.donorsMax, donorCount);
  ok("the file carries real money", revenue > 1_000_000, revenue);

  // THE FEP SHAPE. A real donor file is steeply concentrated; a generated one
  // that isn't reads as synthetic to a fundraiser on sight.
  const decileN = Math.max(1, Math.round(donorCount * 0.1));
  const topDecile = donorTotals.slice(0, decileN).reduce((s, r) => s + r.total, 0);
  const decileShare = topDecile / revenue;
  ok(`top decile (${decileN} donors) carries ${pct(decileShare)} of revenue — inside [${pct(SHAPE.topDecileShareMin)}, ${pct(SHAPE.topDecileShareMax)}]`,
     decileShare >= SHAPE.topDecileShareMin && decileShare <= SHAPE.topDecileShareMax, decileShare);

  const top200 = donorTotals.slice(0, 200).reduce((s, r) => s + r.total, 0);
  const top200Share = top200 / revenue;
  ok(`top 200 donors carry ${pct(top200Share)} — the FEP figure, inside [${pct(SHAPE.top200ShareMin)}, ${pct(SHAPE.top200ShareMax)}]`,
     top200Share >= SHAPE.top200ShareMin && top200Share <= SHAPE.top200ShareMax, top200Share);

  // The failure this guards against, stated as its own assertion so the
  // intent survives someone widening a range without reading the comment.
  ok("the file is NOT flat (a flat file is the shape of fake data)",
     decileShare > 0.5, decileShare);
  ok("the file is NOT absurdly top-heavy either (>95% in the top decile reads as fake too)",
     decileShare < 0.95, decileShare);

  // ── 2 · the eleven ──────────────────────────────────────────────────────
  console.log("\n— §2 · the eleven drifted mid-level donors —");
  const names = DRIFTED.map(([n]) => n);
  const rows = await q(
    `SELECT d.id, d.name, d.assigned_to, d.stage,
            COALESCE(SUM(g.amount),0)::float AS lifetime,
            MAX(g.date) AS last_gift,
            COUNT(g.id)::int AS gifts
       FROM donors d LEFT JOIN gifts g ON g.donor_id = d.id
      WHERE d.org_id = $1 AND d.name = ANY($2)
      GROUP BY d.id, d.name, d.assigned_to, d.stage`, [ORG, names]);

  ok(`all ${SHAPE.driftedCount} drifted donors are present (found ${rows.length})`,
     rows.length === SHAPE.driftedCount, rows.map(r => r.name));

  // MID-LEVEL, not major and not a $50 donor. This is the number that makes
  // the story Steward's rather than every other tool's.
  const midLevel = rows.filter(r => r.lifetime >= 5000 && r.lifetime <= 40000);
  ok(`all eleven are mid-level by lifetime giving (${midLevel.length}/${rows.length} in $5k–$40k)`,
     midLevel.length === rows.length,
     rows.map(r => `${r.name}: $${Math.round(r.lifetime).toLocaleString()}`));

  // CONSISTENT, then silent — that is what "drifted" means. A donor with one
  // gift who vanished is not a drift story, it is a lapsed prospect.
  const consistent = rows.filter(r => r.gifts >= 4);
  ok(`each has a multi-year giving history (${consistent.length}/${rows.length} with 4+ gifts)`,
     consistent.length === rows.length, rows.map(r => `${r.name}: ${r.gifts} gifts`));

  const today = new Date();
  const daysSince = r => Math.floor((today - new Date(r.last_gift)) / 86400000);
  const quiet = rows.filter(r => daysSince(r) > 180);
  ok(`each has gone quiet — no gift in over 180 days (${quiet.length}/${rows.length})`,
     quiet.length === rows.length, rows.map(r => `${r.name}: ${daysSince(r)}d`));

  // ...but NOT lapsed — still reachable. The boundary is the ENGINE's, not a
  // flat 365 days: a seasonal annual giver's window doesn't close until the
  // 24-month cap (month-aware drift, BUILD-76), and the flat-365 intuition
  // this assertion used to encode is exactly the thinking that mis-shaped
  // the old fixture (annual November givers "quiet since last year" who
  // weren't due yet). §4 below asserts the engine's verdict donor by donor;
  // this keeps the coarse sanity bound at the engine's own hard cap.
  const notYetLapsed = rows.filter(r => daysSince(r) < 730);
  ok(`and none has crossed the 24-month hard boundary — still reachable (${notYetLapsed.length}/${rows.length})`,
     notYetLapsed.length === rows.length, rows.map(r => `${r.name}: ${daysSince(r)}d`));

  const assigned = rows.filter(r => r.assigned_to);
  ok(`each is assigned to a person, so they sit in a real portfolio (${assigned.length}/${rows.length})`,
     assigned.length === rows.length, rows.map(r => `${r.name}: ${r.assigned_to || "UNASSIGNED"}`));

  // ── 3 · the first screen leads with them, not with the lapsed ──────────
  console.log("\n— §3 · the first screen —");
  const tok = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const impact = (await api("GET", "/impact", tok)).body;

  ok("the home hero leads with money AT RISK", typeof impact.atRiskAmount === "number" && impact.atRiskAmount > 0,
     impact.atRiskAmount);
  ok("the at-risk threshold is the 180-day GOING-QUIET line, not the 365-day lapse line",
     impact.quietSinceDays === 180, impact.quietSinceDays);

  // The eleven must be INSIDE the number the demo opens on. If the figure used
  // the lapse line they would be excluded — the demo would open on a set that
  // deliberately excludes its own thesis.
  const quietSince = new Date(today.getTime() - 180 * 86400000);
  const elevenAreQuiet = rows.every(r => new Date(r.last_gift) < quietSince);
  ok("the eleven are INSIDE the at-risk figure the demo opens on", elevenAreQuiet,
     rows.map(r => `${r.name}: ${r.last_gift}`));

  const [lapsedCount] = await q(
    `SELECT COUNT(*)::int AS n FROM donors d
      WHERE d.org_id=$1 AND d.deleted_at IS NULL AND d.total_giving > 0
        AND d.last_gift_date::date < (CURRENT_DATE - 365)`, [ORG]);
  ok(`the at-risk donor count (${impact.quietDonorCount}) is LARGER than the lapsed-only count (${lapsedCount.n}) — the figure is about drift, not recapture`,
     impact.quietDonorCount > lapsedCount.n, { atRisk: impact.quietDonorCount, lapsedOnly: lapsedCount.n });

  // And the drill-down agrees with the headline, as every aggregate must.
  ok("the at-risk drill-down is populated and ordered by lifetime giving",
     (impact.atRiskDonors || []).length > 0
     && impact.atRiskDonors.every((r, i, a) => i === 0 || a[i - 1].amount >= r.amount),
     (impact.atRiskDonors || []).slice(0, 3));

  // ── 4 · THE ENGINE'S VERDICT (BUILD-76 follow-up) ───────────────────────
  // §2's day-count checks are the old intuition; this section asks the real
  // question: does drift.js — the one definition every surface reads — call
  // the eleven drifting, at high confidence, TODAY? This is the assertion
  // that catches silent un-drifting, because it has now happened twice:
  // BUILD-73 caught two of the eleven carrying fresh pledge payments, and
  // BUILD-76's month-aware engine revealed seven more whose annual November
  // gifts made them simply not-due-yet rather than drifting.
  console.log("\n— §4 · the engine's verdict on the generated file —");
  const driftAll = (await api("GET", "/drift?all=1&includeMedium=1", tok)).body;
  const byName = Object.fromEntries(driftAll.list.map(r => [r.donorName, r]));
  for (const [name] of DRIFTED) {
    const r = byName[name];
    ok(`§4 ${name} is DRIFTING at HIGH confidence`, r && r.confidence === "high",
       r ? r.confidence : "not on the drift list at all");
  }
  ok(`§4 engine-drifting/high count inside [${SHAPE.driftingHighMin}, ${SHAPE.driftingHighMax}] (${driftAll.counts.driftingHigh})`,
     driftAll.counts.driftingHigh >= SHAPE.driftingHighMin && driftAll.counts.driftingHigh <= SHAPE.driftingHighMax,
     driftAll.counts);

  // THE CANONICAL EXAMPLE: Margaret Chen must be VISIBLE — on the capped
  // home list (not just the see-all view) — reading her own pattern in the
  // landing page's sentence form. She is the pitch; a bare follow-up task
  // with no reason is the exact failure this build fixes.
  const capped = (await api("GET", "/drift", tok)).body;
  const margaret = capped.list.find(r => r.donorName === "Margaret Chen");
  ok("§4 Margaret Chen is ON the capped home drift list", !!margaret,
     capped.list.map(r => r.donorName));
  ok("§4 …reading the landing page's sentence form ($2,000 every <Month> since <year>. Nothing for ~14 months.)",
     !!margaret && /^\$2,000 every [A-Z][a-z]+ since \d{4}\. Nothing for 1[2-6] months\.$/.test(margaret.reason),
     margaret && margaret.reason);

  // The failed card is Ondine's story, not a drift row: a past_due
  // subscription EXCLUDES her by design, and she lives in the
  // failed-payment path instead.
  ok("§4 Ondine Cinderhalt (failed card) is NOT on any drift surface",
     !driftAll.list.some(r => r.donorName === "Ondine Cinderhalt"), null);
  const [ondineSub] = await q(
    `SELECT rs.status FROM recurring_subscriptions rs JOIN donors d ON d.id = rs.donor_id
      WHERE rs.org_id = $1 AND d.name = 'Ondine Cinderhalt'`, [ORG]);
  ok("§4 …because her subscription sits in the failed-payment path (past_due)",
     ondineSub && ondineSub.status === "past_due", ondineSub);

  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });
