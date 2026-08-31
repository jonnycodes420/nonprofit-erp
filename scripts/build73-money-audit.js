#!/usr/bin/env node
// BUILD-73 Part 2 — THE MONEY SOURCE SCAN. Pure static analysis: reads
// server.js off disk, touches no server, no database, no network.
//
// Built the same way scripts/build72-date-audit.js was, and for the same
// reason: BUILD-72 Part 4 established that an enumeration a test RUNS cannot
// drift, while an enumeration written into a findings file rots the first time
// someone adds a line. So the rule "no money value is ever rounded to a whole
// dollar" is enforced here, and tests/money-cents.test.js runs it.
//
// WHAT IT LOOKS FOR
//   Any `Math.round(...)` whose argument mentions a money-shaped identifier
//   (amount, amt, total, dollars, giving, goal, paid, balance, surplus, ask,
//   fee) and which is NOT multiplying by 100. Multiplying by 100 is a
//   dollars->cents conversion and is the correct direction; the defect is the
//   bare round, which lands on a whole dollar.
//
// Run standalone:  node scripts/build73-money-audit.js

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const FILES = ["server.js", "db.js"];

// Identifiers that name money. Deliberately broad — a false positive costs one
// allowlist entry with a stated reason, a false negative costs a donor.
const MONEY = /(amount|amt|dollars?|giving|goal|paid|balance|surplus|\bask\b|_fee|fee_|total)/i;

// Sites that are NOT money rounding, each with the reason it is exempt. An
// entry here is a claim someone can check, not a suppression.
const ALLOW = [
  // ── Conversions in the CORRECT direction ────────────────────────────────
  { re: /\*\s*100\s*\)/,                        why: "dollars -> integer cents; the correct direction" },

  // ── Percentages and ratios. A percentage is not money; rounding one to a
  //    whole percent (or to 1dp via the *1000/10 idiom) is the intent. ──────
  { re: /\*\s*1000\s*\)\s*\/\s*10/,             why: "a percentage to 1dp, not a money value" },
  { re: /(pct|percent|Pct|Percent|Rate|growthPct)\s*:/, why: "a percentage field, not a money value" },
  { re: /\/\s*(total|totalGiving|totalGoal|grand|goalAmount|priorTotal)\b/, why: "a share of a total — a ratio, not money" },

  // ── Durations and counts ────────────────────────────────────────────────
  { re: /LAPSE_DAYS|daysSinceGift|totalDays|touchTotalDays|elapsedMonths/, why: "days/months arithmetic, not money" },
  { re: /Math\.min\(10,/,                        why: "a 1-10 engagement score, not money" },

  // ── Display-only aggregates: computed per response, never stored, and
  //    never the figure a ledger or a receipt is reconciled against. An
  //    average gift of "$247" is the intended reading; "$247.13" is noise. ──
  { re: /avgGift|avgGiftAmt|avgDays|forecastOpen|runRate/, why: "display-only aggregate, never stored" },
  { re: /contribution\s*\*\s*10\s*\)\s*\/\s*10/,  why: "a contribution share to 1dp, not money" },
];

const findings = [];
for (const rel of FILES) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");        // a comment naming Math.round is not a call
    if (!/Math\.round\s*\(/.test(code)) return;
    if (!MONEY.test(code)) return;
    const exempt = ALLOW.find(a => a.re.test(code));
    if (exempt) return;
    findings.push({ file: rel, line: i + 1, text: line.trim() });
  });
}

// The seam must be the only converter, and it must actually be wired in.
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
// Strip line comments before the wiring checks: server.js documents what each
// former rounding site used to say, and a comment quoting `Math.round(...)` is
// not a call to it.
const serverCode = serverSrc.split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
const wiring = [
  { ok: /require\("\.\/money"\)/.test(serverSrc),
    msg: "server.js must require the money seam (./money)" },
  { ok: /parseMoneyOrThrow\(/.test(serverSrc),
    msg: "server.js must guard write paths with parseMoneyOrThrow()" },
  { ok: !/Math\.round\(Number\(amount\)\)/.test(serverCode),
    msg: "server.js must not round a money value to a whole dollar (Math.round(Number(amount)))" },
];

const failedWiring = wiring.filter(w => !w.ok);

if (require.main === module) {
  console.log(`scanned ${FILES.join(", ")}`);
  for (const w of wiring) console.log(`  ${w.ok ? "OK  " : "FAIL"}  ${w.msg}`);
  if (findings.length) {
    console.log(`\n${findings.length} unexplained money rounding site(s):`);
    for (const f of findings) console.log(`  ${f.file}:${f.line}  ${f.text}`);
  } else {
    console.log("\nno unexplained money rounding sites");
  }
  process.exit(findings.length || failedWiring.length ? 1 : 0);
}

module.exports = { findings, wiring, failedWiring, ALLOW, FILES };
