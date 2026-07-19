#!/usr/bin/env node
// BUILD-23 Part 1 — cross-surface consistency / reconciliation audit.
//
// The backward sweep: scan ONE org's real data and report every place a single
// object (a gift, a fund, a goal, a donor) is represented inconsistently across
// the surfaces that read it. This is the answer to "are we sure it actually
// works?" — the gift double-log (BUILD-21) passed every per-build test because
// no test followed one gift across ALL surfaces and asserted they agree. This
// script does exactly that against live data.
//
// READ-ONLY. It never writes, deletes, or mutates anything — it only fetches
// through existing authenticated endpoints (org-scoped by the admin login) and
// reconciles client-side. Safe to run against prod. It exits 0 always (a report,
// not a gate); pass --strict to exit 1 when any ERROR-level finding is present.
//
// The canonical invariants it checks (see CLAUDE.md "Consistency invariants"):
//   - one gift → one of everything (exactly one ledger stamp per gift; no dupes)
//   - donor lifetime == Σ(that donor's gifts)
//   - Finance Cash on Hand == Σ(ledger)  ;  Σ(fund balances) == Cash on Hand
//   - each fund balance == Σ(its transactions)
//   - a goal's raised == Σ(attributed gifts) ; roll-up == Σ(children)
//   - Home / Reports / Fundraising / Finance report the SAME period totals
//   - no orphans: ledger/gift rows never point at a missing donor/fund/campaign
//   - idempotency ledgers intact (gift_id stamps unique)
//
// Findings are graded:
//   ERROR — a true correctness defect with a clear root cause (fix it).
//   WARN  — a reconciliation gap that is usually a seed/manual-data artifact but
//           a human should eyeball (e.g. manual income with no fund designation).
//   INFO  — expected-by-design divergence, surfaced for transparency
//           (e.g. imported lifetime giving with no gift rows).
//   OK    — an invariant that holds.
//
// Usage:
//   node scripts/consistency-audit.js                 # audit prod CREO, write report
//   node scripts/consistency-audit.js --strict         # exit 1 on any ERROR
//   node scripts/consistency-audit.js --no-report       # console only, no file
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/consistency-audit.js

const fs = require("fs");
const path = require("path");
const { findManualDupes } = require("./dedupe-finance-gift-stamps");

const BASE = process.env.BASE || "https://nonprofit-erp-production.up.railway.app";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@creoarts.org";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "demo1234";
const STRICT = process.argv.includes("--strict");
const NO_REPORT = process.argv.includes("--no-report");

const num = v => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));
const money = v => "$" + num(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
// Money reconciliation tolerance — NUMERIC/rounding noise, not a real gap.
const EPS = 1;
const close = (a, b) => Math.abs(num(a) - num(b)) <= EPS;

const findings = [];
function add(level, code, summary, detail) {
  findings.push({ level, code, summary, detail });
}

async function main() {
  // ── auth ──
  const loginRes = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const login = await loginRes.json();
  if (!login.token) { console.error("Login failed:", login); process.exit(1); }
  const auth = { Authorization: "Bearer " + login.token };
  const get = async p => {
    const r = await fetch(BASE + p, { headers: auth });
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
  };

  // ── gather every surface once ──
  const [exp, sumF, sumC, gsF, gsC, fr, home, top] = await Promise.all([
    get("/org/export"),
    get("/finance/summary?yearMode=fiscal"),
    get("/finance/summary?yearMode=calendar"),
    get("/reports/giving-summary?yearMode=fiscal"),
    get("/reports/giving-summary?yearMode=calendar"),
    get("/fundraising/overview"),
    get("/dashboard/home?scope=all"),
    get("/reports/top-donors?scope=lifetime&limit=1000"),
  ]);
  if (exp.status !== 200) { console.error("export failed", exp.status, exp.body); process.exit(1); }

  const E = exp.body;
  const donors = E.donors || [];
  const gifts = E.gifts || [];
  const txns = E.transactions || [];
  const interactions = E.interactions || [];
  const campaigns = E.campaigns || [];
  const orgName = E.org?.name || ADMIN_EMAIL;
  const summaryF = sumF.body, summaryC = sumC.body;

  const donorById = new Map(donors.map(d => [d.id, d]));
  const campaignById = new Map(campaigns.map(c => [c.id, c]));
  const fundIds = new Set((summaryF.fundBalances || []).map(f => f.id));

  // ══ Check 1 — one gift → exactly one ledger stamp (the double-log class) ══
  {
    const byGid = new Map();
    for (const t of txns) if (t.gift_id) byGid.set(t.gift_id, (byGid.get(t.gift_id) || 0) + 1);
    const dupes = [...byGid.entries()].filter(([, n]) => n > 1);
    if (dupes.length) add("ERROR", "gift-double-stamp",
      `${dupes.length} gift(s) have MORE THAN ONE fin_transaction (the double-stamp bug)`,
      dupes.slice(0, 10).map(([gid, n]) => `${gid}: ${n} rows`).join(", "));
    else add("OK", "gift-double-stamp", "Every stamped gift has exactly one fin_transaction (no double-stamp)");

    // Legacy manual "Gift from …" twins that dedupe-finance-gift-stamps.js would remove.
    const manualDupes = findManualDupes(txns);
    if (manualDupes.length) add("ERROR", "manual-gift-twin",
      `${manualDupes.length} legacy manual "Gift from …" ledger row(s) duplicate a gift-sourced twin`,
      "Fixable: node scripts/dedupe-finance-gift-stamps.js --apply · e.g. " + manualDupes.slice(0, 5).map(d => d.id).join(", "));
    else add("OK", "manual-gift-twin", "No legacy manual gift-twin ledger rows");

    // Gifts with NO ledger stamp — expected for imported/seed gifts inserted
    // directly, so INFO not ERROR; the presence of the stamp is what matters.
    const stampedGiftIds = new Set(txns.filter(t => t.gift_id).map(t => t.gift_id));
    const unstamped = gifts.filter(g => !stampedGiftIds.has(g.id));
    if (unstamped.length) add("INFO", "gift-no-stamp",
      `${unstamped.length}/${gifts.length} gift row(s) have no fin_transaction stamp (typical of imported/seed gifts)`,
      "Not a defect: gift_id stamping is enforced going forward; historical rows predate it.");

    // Non-manual ledger rows with a null gift_id (legacy gift-sourced rows before
    // gift_id existed — can't participate in the idempotency guard).
    const legacyNull = txns.filter(t => t.source && t.source !== "manual" && !t.gift_id);
    if (legacyNull.length) add("INFO", "ledger-null-giftid",
      `${legacyNull.length} non-manual ledger row(s) have a null gift_id (legacy, pre gift_id stamping)`,
      legacyNull.slice(0, 5).map(t => `${t.id} [${t.source}]`).join(", "));
  }

  // ══ Check 2 — one gift → one interaction touchpoint ══
  // gift↔interaction is not FK-linked (a type='gift' interaction shares donor_id
  // but carries no gift_id), so this is a per-donor count reconciliation, not a
  // row-level 1:1. Reported as INFO — seed gifts often lack interactions.
  {
    const giftIntByDonor = new Map();
    for (const i of interactions) if (i.type === "gift") giftIntByDonor.set(i.donor_id, (giftIntByDonor.get(i.donor_id) || 0) + 1);
    const giftRowByDonor = new Map();
    for (const g of gifts) giftRowByDonor.set(g.donor_id, (giftRowByDonor.get(g.donor_id) || 0) + 1);
    let mism = 0;
    for (const [d, gc] of giftRowByDonor) if ((giftIntByDonor.get(d) || 0) !== gc) mism++;
    add(mism ? "INFO" : "OK", "gift-interaction",
      mism ? `${mism} donor(s) have a gift-count ≠ gift-interaction-count (expected for imported/seed gifts)`
           : "Gift interactions reconcile 1:1 with gift rows per donor");
  }

  // ══ Check 3 — donor lifetime == Σ(their gifts) ══
  {
    const giftSum = new Map(), giftRows = new Map();
    for (const g of gifts) {
      giftSum.set(g.donor_id, num(giftSum.get(g.donor_id)) + num(g.amount));
      giftRows.set(g.donor_id, (giftRows.get(g.donor_id) || 0) + 1);
    }
    const mismatches = [];   // real: gift rows exist but don't sum to total_giving
    const imported = [];     // benign: total_giving set but fewer/no gift rows (import)
    for (const d of donors) {
      const sum = num(giftSum.get(d.id)), rows = giftRows.get(d.id) || 0, tg = num(d.total_giving);
      if (close(sum, tg)) continue;
      if (tg > sum && num(d.gift_count) > rows) imported.push({ d, sum, tg, rows });
      else mismatches.push({ d, sum, tg, rows });
    }
    if (mismatches.length) add("WARN", "donor-lifetime",
      `${mismatches.length} donor(s): total_giving ≠ Σ(gift rows) and NOT explained by import`,
      mismatches.slice(0, 8).map(m => `${m.d.name}: total ${money(m.tg)} vs Σgifts ${money(m.sum)} (${m.rows} rows)`).join(" · "));
    else add("OK", "donor-lifetime", "Every donor's total_giving reconciles with Σ(gift rows) (or is explained by import)");
    if (imported.length) add("INFO", "donor-lifetime-import",
      `${imported.length} donor(s) carry imported lifetime giving with fewer/no gift rows (by design — Top Donors reads total_giving)`);
  }

  // ══ Check 4 — Cash on Hand == Σ(ledger) ══
  {
    let inc = 0, exps = 0;
    for (const t of txns) (t.type === "income" ? (inc += num(t.amount)) : (exps += num(t.amount)));
    const ledgerNet = inc - exps;
    if (close(summaryF.cashOnHand, ledgerNet)) add("OK", "cash-on-hand",
      `Cash on Hand ${money(summaryF.cashOnHand)} == Σ(ledger) ${money(ledgerNet)}`);
    else add("ERROR", "cash-on-hand",
      `Cash on Hand ${money(summaryF.cashOnHand)} ≠ Σ(ledger income−expense) ${money(ledgerNet)}`,
      `income ${money(inc)} − expense ${money(exps)}`);
    // Cash on Hand is basis-independent (all-time) — fiscal and calendar must agree.
    if (!close(summaryF.cashOnHand, summaryC.cashOnHand)) add("ERROR", "cash-basis",
      `Cash on Hand differs by year basis: fiscal ${money(summaryF.cashOnHand)} vs calendar ${money(summaryC.cashOnHand)}`);
  }

  // ══ Check 5 — Σ(fund balances) == Cash on Hand, and each fund == Σ(its txns) ══
  {
    const perFund = new Map(); let noFund = 0;
    for (const t of txns) {
      const signed = (t.type === "income" ? 1 : -1) * num(t.amount);
      if (t.fund_id) perFund.set(t.fund_id, num(perFund.get(t.fund_id)) + signed);
      else noFund += signed;
    }
    const fb = summaryF.fundBalances || [];
    const fbSum = fb.reduce((s, f) => s + num(f.balance), 0);
    // Per-fund: server's reported balance vs recomputed-from-ledger.
    let perFundBad = 0;
    for (const f of fb) if (!close(f.balance, perFund.get(f.id))) perFundBad++;
    add(perFundBad ? "ERROR" : "OK", "fund-balance-perfund",
      perFundBad ? `${perFundBad} fund(s): reported balance ≠ Σ(its ledger rows)`
                 : "Every fund's reported balance == Σ(its ledger transactions)");
    // Σ funds vs cash — the BUILD-10 reconcile-by-construction invariant.
    if (close(fbSum, summaryF.cashOnHand)) add("OK", "fund-balance-total",
      `Σ(fund balances) ${money(fbSum)} == Cash on Hand ${money(summaryF.cashOnHand)}`);
    else add("WARN", "fund-balance-total",
      `Σ(fund balances) ${money(fbSum)} ≠ Cash on Hand ${money(summaryF.cashOnHand)} — ${money(noFund)} of ledger net has no fund designation`,
      "Root cause: manual/seed transactions posted with no fund_id don't roll into any fund. Not a code bug; designate a fund on those entries to reconcile.");
    // Negative fund balances render fine (BUILD-21) but flag for a human.
    const neg = fb.filter(f => num(f.balance) < 0);
    if (neg.length) add("INFO", "fund-negative",
      `${neg.length} fund(s) carry a negative balance (renders as terracotta — verify it's intended)`,
      neg.map(f => `${f.name}: ${money(f.balance)}`).join(", "));
  }

  // ══ Check 6 — cross-surface period totals AGREE ══
  // Finance and Reports/Fundraising slice different tables over the SAME window:
  //  - Reports giving-summary.total & Fundraising period.raised = Σ(gifts) in window
  //  - Finance ytdRevenue = Σ(fin_transactions income) in window
  // The gift-sourced portion of the ledger MUST equal the gift total; any excess
  // is non-gift income (grants/manual), which is legitimate but must be explained.
  {
    // (a) Reports FY total === Fundraising period.raised (both Σ gifts, same FY).
    const repFY = num(gsF.body?.total);
    const frRaised = num(fr.body?.period?.raised);
    if (close(repFY, frRaised)) add("OK", "period-reports-fundraising",
      `Reports FY gift total ${money(repFY)} == Fundraising this-period raised ${money(frRaised)}`);
    else add("ERROR", "period-reports-fundraising",
      `Reports FY gift total ${money(repFY)} ≠ Fundraising this-period raised ${money(frRaised)}`);

    // (b) Finance FY revenue reconciles to gift-sourced FY ledger + non-gift FY ledger.
    const fyFrom = gsF.body?.from, fyTo = gsF.body?.to;
    const inWin = t => t.type === "income" && t.date >= fyFrom && t.date <= fyTo;
    let fyGiftLedger = 0, fyNonGiftLedger = 0;
    for (const t of txns) {
      if (!inWin(t)) continue;
      if (t.gift_id || ["gift", "online", "import", "event"].includes(t.source)) fyGiftLedger += num(t.amount);
      else fyNonGiftLedger += num(t.amount);
    }
    const finFY = num(summaryF.ytdRevenue);
    if (!close(finFY, fyGiftLedger + fyNonGiftLedger)) add("WARN", "finance-fy-reconcile",
      `Finance FY revenue ${money(finFY)} ≠ Σ(FY ledger income) ${money(fyGiftLedger + fyNonGiftLedger)} — check date-window handling`);
    if (close(fyGiftLedger, repFY)) add("OK", "period-finance-gift",
      `Gift-sourced FY ledger income ${money(fyGiftLedger)} == Reports FY gift total ${money(repFY)}`);
    else add("WARN", "period-finance-gift",
      `Gift-sourced FY ledger income ${money(fyGiftLedger)} ≠ Reports FY gift total ${money(repFY)} — some FY gifts aren't stamped to the ledger (or vice-versa)`,
      `Non-gift FY ledger income (grants/manual, legitimate): ${money(fyNonGiftLedger)}. Finance FY revenue ${money(finFY)} = gift ${money(fyGiftLedger)} + non-gift ${money(fyNonGiftLedger)}.`);
  }

  // ══ Check 7 — goal raised == Σ(attributed gifts) ; roll-up == Σ(children) ══
  {
    const goal = fr.body?.goal;
    if (goal && goal.goalAmount) {
      // The single-goal hero's currentAmount is a live SUM; we can't reproduce its
      // exact attribution window here, so we assert it's non-negative & ≤ a sane
      // ceiling of total org giving, and surface it for the eyeball.
      const orgGiving = donors.reduce((s, d) => s + num(d.total_giving), 0);
      if (num(goal.currentAmount) < 0) add("ERROR", "goal-negative", `Active goal raised is negative: ${money(goal.currentAmount)}`);
      else add("OK", "goal-nonneg", `Active goal "${goal.label}": ${money(goal.currentAmount)} of ${money(goal.goalAmount)} (${goal.percent}%)`);
      if (num(goal.currentAmount) > orgGiving + EPS) add("WARN", "goal-exceeds-giving",
        `Active goal raised ${money(goal.currentAmount)} exceeds Σ(all donor lifetime giving) ${money(orgGiving)}`);
    }
    const rollup = fr.body?.rollup, goals = fr.body?.goals || [];
    if (rollup && goals.length) {
      const topLevel = goals.filter(g => !g.parentGoalId);
      const rolledSum = topLevel.reduce((s, g) => s + num(g.rolledRaised ?? g.raised), 0);
      if (close(rolledSum, rollup.totalRaised)) add("OK", "goal-rollup",
        `Roll-up header ${money(rollup.totalRaised)} == Σ(top-level goals' rolled raised) ${money(rolledSum)}`);
      else add("ERROR", "goal-rollup",
        `Roll-up header ${money(rollup.totalRaised)} ≠ Σ(top-level rolled raised) ${money(rolledSum)} (double-counted children?)`);
    } else {
      add("INFO", "goal-rollup", "No typed roll-up goal portfolio configured (single-goal hero only)");
    }
  }

  // ══ Check 8 — no orphans ══
  {
    // Ledger rows whose donor_id doesn't resolve to a live donor (export excludes
    // soft-deleted donors, so this can be a purge-trash remnant — WARN + caveat).
    const orphanTxns = txns.filter(t => t.donor_id && !donorById.has(t.donor_id));
    if (orphanTxns.length) add("WARN", "orphan-ledger-donor",
      `${orphanTxns.length} ledger row(s) reference a donor_id not in the live donor set`,
      "Usually a purge-trash remnant (fin_transactions is deliberately left when a donor is purged) or a soft-deleted donor — verify none are cross-org. e.g. " + orphanTxns.slice(0, 5).map(t => `${t.id}→${t.donor_id}`).join(", "));
    else add("OK", "orphan-ledger-donor", "No ledger row references a missing donor");

    const orphanGiftDonor = gifts.filter(g => g.donor_id && !donorById.has(g.donor_id));
    if (orphanGiftDonor.length) add("ERROR", "orphan-gift-donor",
      `${orphanGiftDonor.length} gift(s) reference a donor_id not in the live donor set`,
      orphanGiftDonor.slice(0, 5).map(g => `${g.id}→${g.donor_id}`).join(", "));
    else add("OK", "orphan-gift-donor", "Every gift references a live donor");

    const orphanGiftFund = gifts.filter(g => g.fund_id && !fundIds.has(g.fund_id));
    if (orphanGiftFund.length) add("WARN", "orphan-gift-fund",
      `${orphanGiftFund.length} gift(s) reference a fund_id that isn't a current fund`,
      orphanGiftFund.slice(0, 5).map(g => `${g.id}→${g.fund_id}`).join(", "));

    const orphanGiftCampaign = gifts.filter(g => g.campaign_id && !campaignById.has(g.campaign_id));
    if (orphanGiftCampaign.length) add("INFO", "orphan-gift-campaign",
      `${orphanGiftCampaign.length} gift(s) reference a campaign_id that isn't a current campaign (tolerated dangling reference)`);

    const orphanTxnFund = txns.filter(t => t.fund_id && !fundIds.has(t.fund_id));
    if (orphanTxnFund.length) add("WARN", "orphan-ledger-fund",
      `${orphanTxnFund.length} ledger row(s) reference a fund_id that isn't a current fund`);
  }

  // ══ Check 9 — Home / pipeline / top-donors agree on portfolio value ══
  {
    const orgGiving = donors.reduce((s, d) => s + num(d.total_giving), 0);
    const pipeValue = num(home.body?.pipeline?.value);
    const topSum = (top.body?.rows || []).reduce((s, r) => s + num(r.total), 0);
    // Home pipeline value groups the same donors by stage — its total must equal
    // Σ(all donor total_giving) and the lifetime Top-Donors sum.
    if (home.body?.pipeline) {
      if (close(pipeValue, orgGiving)) add("OK", "home-pipeline-value",
        `Home pipeline value ${money(pipeValue)} == Σ(donor lifetime giving) ${money(orgGiving)}`);
      else add("WARN", "home-pipeline-value",
        `Home pipeline value ${money(pipeValue)} ≠ Σ(donor lifetime giving) ${money(orgGiving)}`);
    }
    if (top.body?.rows) {
      if (close(topSum, orgGiving)) add("OK", "top-donors-total",
        `Top-Donors (lifetime) Σ ${money(topSum)} == Σ(donor lifetime giving) ${money(orgGiving)}`);
      else add("WARN", "top-donors-total",
        `Top-Donors (lifetime) Σ ${money(topSum)} ≠ Σ(donor lifetime giving) ${money(orgGiving)} (some donors excluded?)`);
    }
  }

  // ── render ──
  const order = { ERROR: 0, WARN: 1, INFO: 2, OK: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  const counts = findings.reduce((c, f) => ((c[f.level] = (c[f.level] || 0) + 1), c), {});
  const stamp = new Date().toISOString();

  console.log(`\nConsistency audit — ${orgName} — ${BASE}`);
  console.log(`donors ${donors.length} · gifts ${gifts.length} · ledger rows ${txns.length} · interactions ${interactions.length}\n`);
  const icon = { ERROR: "✗", WARN: "!", INFO: "·", OK: "✓" };
  for (const f of findings) {
    console.log(`  [${icon[f.level]}] ${f.level.padEnd(5)} ${f.code} — ${f.summary}`);
    if (f.detail && f.level !== "OK") console.log(`            ${f.detail}`);
  }
  console.log(`\n${counts.ERROR || 0} ERROR · ${counts.WARN || 0} WARN · ${counts.INFO || 0} INFO · ${counts.OK || 0} OK`);

  if (!NO_REPORT) {
    const date = stamp.slice(0, 10);
    const outDir = path.join(__dirname, "..", "docs", `build23-${date}`);
    fs.mkdirSync(outDir, { recursive: true });
    const md = renderMarkdown({ orgName, stamp, counts, donors, gifts, txns, interactions });
    const outFile = path.join(outDir, "CONSISTENCY_REPORT.md");
    fs.writeFileSync(outFile, md);
    console.log(`\nReport written to ${path.relative(path.join(__dirname, ".."), outFile)}`);
  }

  if (STRICT && counts.ERROR) process.exit(1);
  process.exit(0);
}

function renderMarkdown({ orgName, stamp, counts, donors, gifts, txns, interactions }) {
  const groups = { ERROR: [], WARN: [], INFO: [], OK: [] };
  for (const f of findings) groups[f.level].push(f);
  const section = (level, title) => {
    if (!groups[level].length) return "";
    let s = `\n## ${title} (${groups[level].length})\n\n`;
    for (const f of groups[level]) {
      s += `- **${f.code}** — ${f.summary}\n`;
      if (f.detail) s += `  - ${f.detail}\n`;
    }
    return s;
  };
  return `# BUILD-23 — Cross-surface consistency report

- **Org:** ${orgName}
- **Source:** ${BASE}
- **Run:** ${stamp}
- **Scope:** donors ${donors.length} · gifts ${gifts.length} · ledger rows ${txns.length} · interactions ${interactions.length}
- **Result:** ${counts.ERROR || 0} ERROR · ${counts.WARN || 0} WARN · ${counts.INFO || 0} INFO · ${counts.OK || 0} OK

This is the backward sweep (BUILD-23 Part 1): a read-only reconciliation of one
org's live data against the canonical consistency invariants. Generated by
\`scripts/consistency-audit.js\`. **ERROR** = a correctness defect with a clear
root cause; **WARN** = a reconciliation gap to eyeball (usually a seed/manual
artifact); **INFO** = expected-by-design divergence; **OK** = invariant holds.
${section("ERROR", "Errors — correctness defects")}${section("WARN", "Warnings — reconcile / eyeball")}${section("INFO", "Info — expected by design")}${section("OK", "OK — invariants that hold")}
---
_Re-run: \`node scripts/consistency-audit.js\`. The forward guardrail against this
whole class is \`tests/consistency-e2e.test.js\` (BUILD-23 Part 2)._
`;
}

module.exports = { findings };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
