// LOST & FOUND — THE DONOR FILE NEVER LEAVES THE COMPUTER.
//
// The one new test this build earns, and it earns it because the rule is
// DONOR DATA: a stranger uploads their whole donor list to a page on
// stewardapp.dev, and the promise printed beside the upload button is that
// none of it reaches us.
//
// It runs the REAL code path — the real fixture, the real parse, the real
// audit — with every way a browser can make a network call replaced by a
// recorder, and then it reads back what was recorded and what the routes
// will accept. Four parts:
//
//   §1  the audit runs, and gets the right answers on a messy real file
//   §2  running it made ZERO network calls of any kind
//   §3  the worker's source contains no way to make one
//   §4  the two routes that DO exist accept the seven allowed fields and
//       refuse everything else, including a field carrying a donor
//
// WHAT WOULD MAKE THIS FAIL (the guard-must-be-provable rule), all four
// planted and watched go red before this was trusted:
//   · add a `fetch(...)` of anything to the worker            → §2 and §3
//   · post the audit instead of `benchmarkPayload(...)`       → §4
//   · widen the benchmark route to accept an extra key        → §4
//   · break the parse so the audit reads zero gifts           → §1
//
//   BASE=http://localhost:5601 node tests/lf1-no-donor-data-leaves.test.js

const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:5601";
const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 400) : "")); }
};

// ── THE RECORDER ─────────────────────────────────────────────────────────
// Every way code in a page or a worker can reach the network, replaced
// before a line of the audit runs. Anything called is recorded with its
// arguments, and §2 asserts the list is empty.
const calls = [];
const realFetch = global.fetch;
global.fetch = (...a) => { calls.push({ how: "fetch", args: a }); return Promise.reject(new Error("blocked by the test")); };
global.XMLHttpRequest = function () { calls.push({ how: "XMLHttpRequest", args: [] }); };
global.WebSocket = function (...a) { calls.push({ how: "WebSocket", args: a }); };
global.EventSource = function (...a) { calls.push({ how: "EventSource", args: a }); };
global.navigator = { ...(global.navigator || {}), sendBeacon: (...a) => { calls.push({ how: "sendBeacon", args: a }); return true; } };
global.Image = function () { calls.push({ how: "Image", args: [] }); };

(async () => {
  console.log("lf1-no-donor-data-leaves");

  const LF = await import("../shared/lostAndFound.js");
  const IS = await import("../shared/importShape.js");

  // ── §1 · the audit, on a messy real file ───────────────────────────────
  // A title row above the header, a blank row, two name columns, money with
  // symbols and commas, m/d/yyyy dates, a mixed Recurring column, rows with
  // no amount at all, and a trailing TOTAL row.
  const csv = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "lost-and-found-messy.csv"), "utf8");
  const records = IS.parseCsvRecords(csv);
  const hdr = IS.detectHeaderRow(records);
  const headers = (records[hdr.index] || {}).cells.map(h => String(h || "").trim());
  ok("§1 the header row is found under the title and the blank row",
     hdr.index === 2 && headers.includes("Email") && headers.includes("Gift Date"), { index: hdr.index, headers });

  const map = LF.mapColumns(headers);
  ok("§1 the donor, the amount and the date are all mapped",
     LF.fileReadiness(map).ok, { map, readiness: LF.fileReadiness(map) });

  const body = records.slice(hdr.index + 1).map(r => r.cells).filter(r => r.some(c => String(c || "").trim() !== ""));
  const col = h => { const i = headers.indexOf(h); return i < 0 ? [] : body.map(r => r[i]); };
  const dateConv = IS.inferDateConvention(col(map.date));
  const amtConv = IS.inferAmountConvention(col(map.amount));
  const asObj = r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o; };
  const gifts = body.map(r => LF.giftFromRow(asObj(r), map, {
    dateConvention: dateConv && dateConv.convention, amountConvention: amtConv && amtConv.columnConvention,
  })).filter(Boolean);

  ok("§1 the gifts parse, and the junk rows do not", gifts.length > 250 && gifts.length < body.length,
     { gifts: gifts.length, rows: body.length });
  ok("§1 …no gift has a zero or negative amount", gifts.every(g => g.cents > 0));
  ok("§1 …and every gift has a real date", gifts.every(g => /^\d{4}-\d{2}-\d{2}$/.test(g.date)));

  const a = LF.audit(gifts, { today: "2026-09-28" });
  const sec = k => a.sections.find(s => s.key === k) || { count: 0 };
  // The fixture is 140 donors: 60 gave in both years (12 of them down 80%),
  // 45 gave in 2025 only, 15 gave only in 2023/2024, 10 monthly sustainers
  // stopped in 2025, and 10 monthly are still running.
  //
  // LAPSED IS 55, NOT 45 — the ten stopped sustainers gave in 2025 and not
  // in 2026, so they are lapsed AS WELL AS stopped. That is correct and it
  // is what the first version of this test got wrong: a donor can be in two
  // of these lists, and the lists are five ways of looking at the same
  // people rather than a partition of them.
  ok("§1 the fixture's 55 lapsed donors are found (45 plus the 10 who stopped)",
     sec("lapsed").count === 55, sec("lapsed").count);
  ok("§1 …its 12 drifting donors are found", sec("drifting").count === 12, sec("drifting").count);
  ok("§1 …its 10 stopped sustainers are found", sec("stopped").count === 10, sec("stopped").count);
  ok("§1 …quiet is a superset of lapsed (70 = 55 + the 15 who last gave in 2023/24)",
     sec("quiet").count === 70, sec("quiet").count);
  ok("§1 …somebody who stopped entirely is quiet, NOT drifting",
     sec("drifting").count === 12 && sec("quiet").count > sec("drifting").count);
  ok("§1 …the top-at-risk list is capped at 25", sec("atRisk").count === 25, sec("atRisk").count);
  // 115 gave in 2025 (60 + 45 + 10 sustainers); 60 of them gave again.
  ok("§1 …and retention is 60 of 115, which is 52%", a.headline.retentionPct === 52, a.headline.retentionPct);
  ok("§1 every section carries the sentence that defines it",
     a.sections.every(s => typeof s.definition === "string" && s.definition.length > 40));
  ok("§1 dollars at risk is a real number", a.headline.dollarsAtRiskCents > 0, a.headline.dollarsAtRisk);

  // ── §2 · NOTHING WENT ANYWHERE ─────────────────────────────────────────
  // The whole audit has now run on a file full of names, email addresses and
  // amounts, and the recorder is still empty.
  ok("§2 running the audit made ZERO network calls of any kind", calls.length === 0,
     calls.map(c => c.how + " " + String(c.args[0]).slice(0, 80)));

  // And nothing the audit PRODUCED for a server carries any of it. The
  // benchmark is the only thing that is ever built for one.
  const bench = LF.benchmarkPayload(a);
  const benchJson = JSON.stringify(bench);
  ok("§2 the benchmark payload has exactly four keys",
     Object.keys(bench).sort().join(",") === "donorBand,retentionPct,shareDriftingPct,shareLapsedPct", Object.keys(bench));
  // Every name, every email and every amount from the fixture, checked
  // against the one object that leaves. Not a sample: all of them.
  const names = [...new Set(gifts.map(g => g.name).filter(Boolean))];
  const emails = [...new Set(gifts.map(g => g.email).filter(Boolean))];
  const amounts = [...new Set(gifts.map(g => String(g.cents / 100)))];
  ok("§2 …and it contains no donor's name", !names.some(n => benchJson.includes(n)), names.slice(0, 3));
  ok("§2 …no donor's email", !emails.some(e => benchJson.includes(e)), emails.slice(0, 3));
  // NOT a substring search for amounts. "under 250" is a band label and
  // $250 is a common gift, so a substring check flags a payload that is
  // provably clean — the first version of this test did exactly that. The
  // real assertion is stronger anyway: every value is either one of the
  // five band labels or a whole percentage, so an amount CANNOT be in
  // there whatever it is.
  const BANDS = LF.DONOR_BANDS.map(b => b.label);
  ok("§2 …and every value is a band label or a whole percentage, so no amount can be in it",
     BANDS.includes(bench.donorBand)
       && ["retentionPct", "shareLapsedPct", "shareDriftingPct"].every(k => {
            const v = bench[k];
            return v === null || (Number.isInteger(v) && v >= 0 && v <= 100);
          }), bench);
  ok("§2 …the donor count is a BAND, never the count",
     bench.donorBand === LF.donorBand(a.totals.donors) && !/^\d+$/.test(String(bench.donorBand)),
     { band: bench.donorBand, donors: a.totals.donors });

  // ── §3 · THE WORKER HAS NO WAY TO MAKE A CALL ──────────────────────────
  // Source-level, because a runtime check only proves the paths it walked.
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const worker = strip(fs.readFileSync(path.join(ROOT, "client", "src", "lib", "lostAndFoundWorker.js"), "utf8"));
  const shared = strip(fs.readFileSync(path.join(ROOT, "shared", "lostAndFound.js"), "utf8"));
  for (const [what, src] of [["the worker", worker], ["the audit module", shared]]) {
    for (const bad of ["fetch(", "XMLHttpRequest", "sendBeacon", "new WebSocket", "EventSource", "new Image"]) {
      ok(`§3 ${what} contains no ${bad.replace(/[(]/, "")}`, !src.includes(bad), bad);
    }
    ok(`§3 ${what} imports nothing from ../api`, !/from\s+["'][^"']*\/api["']/.test(src));
  }

  // ── §4 · THE TWO ROUTES ────────────────────────────────────────────────
  // The only two doors, and what they will take.
  const health = await realFetch(BASE + "/health").then(r => r.json()).catch(() => null);
  if (!health || health.product !== "steward") {
    console.log("  SKIP-REFUSED: no scratch server on " + BASE + " — the route half cannot run");
    fail++;   // a skip in a donor-data guard is a hole, not a pass
  } else {
    const post = (p, b) => realFetch(BASE + p, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
    }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    const lead = await post("/lost-and-found/lead",
      { name: "Rosa Vale", email: "rosa@example.org", organization: "Harbour Trust", ref: "a-newsletter" });
    ok("§4 the lead route takes the three fields she typed", lead.status === 201, lead);
    const okBench = await post("/lost-and-found/benchmark", bench);
    ok("§4 the benchmark route takes the four aggregates", okBench.status === 201, okBench);

    // A FIELD CARRYING A DONOR IS REFUSED, not ignored. A page that started
    // sending more must fail loudly here rather than succeed quietly in
    // production.
    for (const [what, extra] of [
      ["a donor's email", { donorEmail: emails[0] }],
      ["a donor's name", { topDonor: names[0] }],
      ["the whole audit", { sections: a.sections }],
      ["a single amount", { largestGift: 500000 }],
    ]) {
      const r = await post("/lost-and-found/benchmark", { ...bench, ...extra });
      ok(`§4 the benchmark route REFUSES ${what}`, r.status === 400 && r.body.error === "unexpected_fields", r);
    }
    // The lead route takes only the four it names; anything else is dropped
    // rather than stored, which the table itself enforces (it has no column
    // that could hold a donor).
    const db = fs.readFileSync(path.join(ROOT, "db.js"), "utf8");
    const leadTable = (/CREATE TABLE IF NOT EXISTS lost_and_found_leads \(([\s\S]*?)\)`/.exec(db) || [])[1] || "";
    ok("§4 the leads table has no column that could hold a donor",
       !/donor|gift|amount|audit|rows/i.test(leadTable), leadTable.replace(/\s+/g, " ").slice(0, 200));
    const benchTable = (/CREATE TABLE IF NOT EXISTS lost_and_found_benchmarks \(([\s\S]*?)\)`/.exec(db) || [])[1] || "";
    ok("§4 the benchmarks table cannot be joined back to a lead",
       !/lead|email|organization|org_id/i.test(benchTable), benchTable.replace(/\s+/g, " ").slice(0, 200));
  }

  console.log(`\nlf1-no-donor-data-leaves: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
