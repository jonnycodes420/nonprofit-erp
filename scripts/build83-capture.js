// BUILD-83 verification walk — v3 through the REAL UI on a fresh org, at 1440
// and 390: four signal items and no bogus colour prompt, 800 exclusions on the
// summary AND read back from the database, zero duplicate/formula refusals,
// the cash figure, Home in its new order with none of the Sept-7 contradictions,
// the monthly-donors card, the drift row, Recurring's three facts, and Finance
// at $0. Records click-to-summary time.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build83-capture.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "build82", "steward-messy-25k-v3.xlsx");
const OUT = path.join(__dirname, "..", "docs", "build83");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 280)));
  if (!cond) failures++;
};
const shoot = async (page, name, mobile) => {
  await page.screenshot({ path: `${OUT}/${name}-1440.png`, fullPage: true });
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.waitForTimeout(400);
  }
};

(async () => {
  const stamp = Date.now().toString(36);
  let r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B83 Walk " + stamp, userName: "B83 Walker", email: `b83w_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token }, body: "{}" });
  r.org.onboarding_complete = 1;
  const token = r.token, orgId = r.org.id;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
  page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) { console.log("  [pageerror]", e.message); failures++; } });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(r.user), JSON.stringify(r.org)]);

  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(600);
  const t0 = Date.now();
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForSelector('[data-testid="wb-sheet-roles"]', { timeout: 300000 });
  await page.click('[data-testid="wb-continue"]');
  await page.waitForSelector('[data-testid="wb-signals"]', { timeout: 60000 });

  // ── §1 — the signal prompts ──
  let body = await page.innerText("body");
  fs.writeFileSync(OUT + "/01-signals.txt", body);
  const sigIds = await page.$$eval("[data-signal-id]", els => els.map(e => e.getAttribute("data-signal-id")));
  ok("exactly four items on Donors", sigIds.length === 4 && sigIds.every(i => i.startsWith("Donors|")), sigIds);
  ok("no prompt for a colour the legend never named (#DDEBF7 / #BDD7EE)",
     !sigIds.some(i => /DDEBF7|BDD7EE/i.test(i)) && !/DDEBF7|BDD7EE/i.test(body), sigIds);
  ok("the yellow prompt quotes the legend; the hidden prompt labels its import option",
     /shaded yellow/.test(body) && /do not contact \(per Cheryl\)/.test(body) && /treated as live donors/.test(body), null);
  await shoot(page, "01-signals", true);
  for (const id of sigIds) {
    const isComments = /\|comments$/.test(id);
    const sel = `[data-testid="wb-opt-${id}-${isComments ? "route" : "legend"}"]`;
    await page.click(sel).catch(() => {});
  }
  await page.click('[data-testid="wb-signals-continue"]');
  await page.waitForSelector('[data-testid="wb-mapper"]', { timeout: 60000 });
  await page.click('[data-testid="wb-review"]');
  await page.waitForSelector('[data-testid="wb-summary"]', { timeout: 300000 });
  const tSummary = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`— click-to-summary: ${tSummary}s —`);

  // ── §2 — the pre-write summary ──
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/02-summary.txt", body);
  ok("792 people excluded, from the 800 rows that carry one, with the 100 highlighted among them",
     /792 people carry an exclusion/.test(body) && /from 800 rows/.test(body)
     && /40 hidden rows, 100 highlighted, 40 from comments/.test(body),
     (body.match(/[\d,]+ people carry an exclusion[^\n]*/) || [])[0]);
  ok("no duplicate-gift refusal line, no formula refusal line",
     !/listed twice in the file/.test(body) && !/formula without a computed value/.test(body), null);
  ok("the flagged rows have their OWN line — they landed, they are not set aside",
     /imported with a flag/i.test(body) && /computed from formula/i.test(body) && /sharing a gift id/i.test(body), null);
  ok("the reconciliation reads in four terms with the residual named",
     /the file says .*imported .*refused .*routed/.test(body.replace(/\n/g, " ")) && /unexplained/.test(body), null);
  ok("the file's own total is never called stale", !/cached total is stale/.test(body), null);
  ok("the cash figure", /\$51,754,243\.82/.test(body), (body.match(/\$51,[\d,]+\.\d\d/) || [])[0]);
  await shoot(page, "02-summary", true);

  // ── §3 — the write, and the receipt ──
  const tImp = Date.now();
  await page.click('[data-testid="wb-import"]');
  await page.waitForSelector('[data-testid="wb-result"]', { timeout: 900000 });
  const tWrite = ((Date.now() - tImp) / 1000).toFixed(1);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/03-result.txt", body);
  ok("the completion screen shows the database read-back, and it MATCHES",
     /checked against the database after writing/i.test(body) && !/does not match/i.test(body)
     && !/not read back/i.test(body),
     (body.match(/[^\n]*does not match[^\n]*|[^\n]*not read back[^\n]*/i) || [])[0]);
  ok("the receipt carries the MONEY, read back from the database",
     /imported cash\s*\n?\s*\$51,754,243\.82 ✓/i.test(body.replace(/\n/g, " ")) || /imported cash[\s\S]{0,40}\$51,754,243\.82/i.test(body),
     (body.match(/imported cash[^\n]*\n?[^\n]*/i) || [])[0]);
  ok("the receipt carries the merge count — 266 folds, each with an undo record",
     /duplicate people folded \(undo recorded\)[\s\S]{0,30}266 ✓/i.test(body), (body.match(/duplicate people folded[^\n]*\n?[^\n]*/i) || [])[0]);
  ok("the receipt states pledges and their payments separately",
     /pledges recorded as commitments/i.test(body) && /pledge payments imported as gifts/i.test(body), null);
  ok("the receipt carries the set-aside list with downloads",
     /set aside, by reason/i.test(body) && /no donor match/i.test(body) && /download/i.test(body), null);
  ok("the two timings are named separately (item 5)",
     /time to summary:/i.test(body) && /time in the write:/i.test(body) && !/click to summary[^\n]*for the write/i.test(body),
     (body.match(/time (to summary|in the write)[^\n]*/gi) || []).join(" | "));
  ok("792 people excluded, read back from the database", /people excluded from every ask surface\s*792 ✓/.test(body.replace(/\n/g, " ")), (body.match(/people excluded[^\n]*\n?[^\n]*/) || [])[0]);
  await shoot(page, "03-result", false);

  // ── §4 — the database itself ──
  const { Client } = require(path.join(__dirname, "..", "node_modules", "pg"));
  const pg = new Client({ connectionString: "postgresql://steward@localhost:5544/steward_loadtest" });
  await pg.connect();
  const one = async sql => (await pg.query(sql.replace(/\$ORG/g, `'${orgId}'`))).rows[0];
  const db = await one(`SELECT
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND deleted_at IS NULL) donors,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND (deceased OR do_not_contact OR do_not_solicit OR do_not_mail OR do_not_email)) excluded,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND do_not_contact) dnc,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND stage IS NOT NULL) placed,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND suggested_stage IS NOT NULL) suggested,
    (SELECT COUNT(*)::int FROM fin_transactions WHERE org_id=$ORG) ledger,
    (SELECT COUNT(*)::int FROM fundraising_goals WHERE org_id=$ORG) goals,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND imported_sustainer) sust`);
  await pg.end();
  ok("exclusions in the DATABASE: 792 records, from the 800 rows the file carried", db.excluded === 792, db.excluded);
  ok("the do-not-contact rows the legend named are applied (100 rows → 99 surviving records)", db.dnc === 99, db.dnc);
  ok("Part 3.5: nothing is PLACED, everything is SUGGESTED", db.placed === 0 && db.suggested === db.donors, { placed: db.placed, suggested: db.suggested, donors: db.donors });
  ok("Part 6: the import posted NOTHING to the ledger", db.ledger === 0, db.ledger);
  ok("Part 3.2: no goal exists — nobody set one", db.goals === 0, db.goals);
  ok("600 sustainers detected from the file", db.sust === 600, db.sust);

  // ── §5 — Home ──
  await page.click('[data-testid="wb-done"]').catch(() => {});
  await page.waitForTimeout(3000);
  // 25,000 donors: Home keeps fetching well past networkidle's patience.
  await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded", timeout: 120000 });
  // Wait for the sections that fetch their own data, not just first paint: the
  // Thread, the checklist and the monthly-donors card each land on their own
  // request, and on a 25,000-donor org they land seconds apart.
  await page.waitForFunction(() => /The Thread/i.test(document.body.innerText), null, { timeout: 180000 }).catch(() => {});
  await page.waitForFunction(() => /set up steward/i.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => /your monthly donors/i.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/04-home.txt", body);
  const idx = s => body.indexOf(s);
  ok("Home order: the Thread before the monthly donors before Drift",
     idx("THE THREAD") >= 0 || idx("The Thread") >= 0
       ? (idx("YOUR MONTHLY DONORS") > Math.max(idx("THE THREAD"), idx("The Thread")) && idx("DRIFTING") > idx("YOUR MONTHLY DONORS"))
       : false,
     { thread: Math.max(idx("THE THREAD"), idx("The Thread")), monthly: idx("YOUR MONTHLY DONORS"), drift: idx("DRIFTING") });
  ok("Part 3.2: no auto-set goal on Home", !/Win back \$[\d,]+ in lapsed giving/.test(body), (body.match(/Win back[^\n]*/) || [])[0]);
  ok("Part 3.3: the quiet-donor cohort is gone", !/quiet donor/i.test(body) && !/38,748,624/.test(body), (body.match(/.{0,50}quiet donor.{0,30}/i) || [])[0]);
  ok("Part 3.1: the four zero-tiles are gone", !/NEED TO DO/i.test(body), null);
  ok("Part 3.1: no 'Today's Suggested Outreach' panel", !/Suggested Outreach/i.test(body), null);
  ok("Part 5.3: the monthly-donors card with the file's own numbers",
     /600 in your file/.test(body) && /160 stopped/.test(body) && /Send reconnect links/i.test(body),
     (body.match(/[^\n]*in your file[^\n]*/) || [])[0]);
  ok("Part 4: the drift figure is labelled at risk", /at risk/i.test(body) && /Log the call/.test(body), null);
  ok("the setup checklist offers the Move-your-monthly-donors step",
     /Move your monthly donors/i.test(body), (body.match(/\d of \d/) || [])[0]);
  await shoot(page, "04-home", true);

  // ── §6 — Recurring ──
  await page.click('button:has-text("Fundraising")');
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Recurring Giving")').catch(() => {});
  await page.waitForTimeout(2500);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/05-recurring.txt", body);
  ok("Part 5.1: three facts — 600 from the file, 440 giving, 160 stopped, none connected",
     /600 sustainers from your file/.test(body) && /440 giving/.test(body) && /160 stopped/.test(body),
     (body.match(/[^\n]*sustainers from your file[^\n]*/) || [])[0]);
  ok("Part 5.2: 'Nothing needs you' is absent while donors have stopped", !/Nothing needs you/.test(body), null);
  ok("Part 5.2: the stopped-giving tile exists", /stopped giving \(from your file\)/i.test(body), null);
  await shoot(page, "05-recurring", true);

  // ── §7 — Finance ──
  await page.click('button:has-text("Finance")');
  await page.waitForTimeout(2500);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/06-finance.txt", body);
  ok("Part 6: Finance shows no revenue from an import", !/\$1,010,106\.39/.test(body), (body.match(/\$1,0[\d,]+\.\d\d/) || [])[0]);
  await shoot(page, "06-finance", false);

  // Two different measurements, recorded separately (FIX item 5).
  fs.writeFileSync(OUT + "/timing.json", JSON.stringify({ timeToSummary: +tSummary, timeInWrite: +tWrite }, null, 2));
  console.log("timing:", JSON.stringify({ timeToSummary: +tSummary, timeInWrite: +tWrite }));
  ok("time to summary is under the 60s target", +tSummary < 60, tSummary);
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})();
