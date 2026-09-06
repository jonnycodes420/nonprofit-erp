// BUILD-82 verification walk — the v3 workbook through the REAL UI on a fresh
// org: sheet roles with evidence, the signals questions with the legend
// quoted, the one-dropdown mapper (day-first said on the legacy sheet), the
// fully-accounted pre-write summary, the ONE import, and the timing.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build82-capture.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "build82", "steward-messy-25k-v3.xlsx");
const OUT = path.join(__dirname, "..", "docs", "build82");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 260)));
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
  const EMAIL = `b82walk_${stamp}@test.local`;
  let r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B82 Walk " + stamp, userName: "B82 Walker", email: EMAIL, password: "loadtest1234" }) }).then(r => r.json());
  if (!r.token) { console.error("register failed", r); process.exit(1); }
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token }, body: "{}" });
  r.org.onboarding_complete = 1;
  const token = r.token;
  const j = p => fetch(API + p, { headers: { Authorization: "Bearer " + token } }).then(x => x.json());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
  page.on("pageerror", e => { console.log("  [pageerror]", e.message); failures++; });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(r.user), JSON.stringify(r.org)]);

  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(800);

  const tTotal0 = Date.now();
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForSelector('[data-testid="wb-sheet-roles"]', { timeout: 300000 });
  const tParse = ((Date.now() - tTotal0) / 1000).toFixed(1);
  console.log(`— sheet roles rendered in ${tParse}s —`);

  // ── SCREEN 1: nine sheets, roles, evidence, decoy dollars, legend ──
  let body = await page.innerText("body");
  fs.writeFileSync(OUT + "/01-roles.txt", body);
  ok("nine sheets shown", /9 sheets/.test(body), null);
  ok("Donors → donors with the reason", /one row per person/.test(body), null);
  ok("BOTH gift sheets → gifts", (body.match(/one row per gift/g) || []).length >= 2, null);
  ok("Old export → superseded with the dollar warning", /Superseded copy/.test(body) && /\$4,342,760\.71/.test(body), null);
  ok("Cover and Summary → not data", (body.match(/cover page, summary or legend|computed summary/g) || []).length >= 2, null);
  ok("Sheet1 → empty", /nothing to import/.test(body), null);
  ok("counts are the REAL counts (56,177 / 36,050 / 25,300)", /56,177/.test(body) && /36,050/.test(body) && /25,300/.test(body), null);
  ok("subtotal rows listed by row number", /11,049|11049/.test(body) && /GRAND|total row/i.test(body), null);
  ok("the legend is quoted", /Yellow rows on the Donors tab = do not contact/.test(body) && /Hidden rows on the Donors tab = deceased/.test(body), null);
  ok("one-pass headline (donors + gift rows + pledges + recurring)", /one import: 25,300 donors \+ 92,227 gift rows \+ 60 pledges \+ 600 recurring/.test(body), body.match(/one import[^\n]*/)?.[0]);
  await shoot(page, "01-roles", true);

  // ── SCREEN 2: the signals ──
  await page.click('[data-testid="wb-continue"]');
  await page.waitForSelector('[data-testid="wb-signals"]', { timeout: 60000 });
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/02-signals.txt", body);
  ok("hidden rows question with the legend quoted", /40 rows on Donors are hidden/.test(body) && /hidden = deceased|deceased, left in for the auditors/i.test(body), null);
  ok("yellow rows question with the legend", /100 rows are highlighted yellow/.test(body) && /do not contact \(per Cheryl\)/i.test(body), null);
  ok("comments question with the count that matters", /40 names carry a comment/.test(body) && /mention deceased/.test(body), null);
  ok("hidden column named, not auto-mapped", /Column AD is hidden.*Internal Score/.test(body.replace(/\n/g, " ")), null);
  // answer: per the legend / per the legend / route
  for (const sel of ['[data-testid="wb-signal-hidden_rows"] label:has-text("per the legend")',
                     '[data-testid="wb-signal-filled_rows"] label:has-text("per the legend")',
                     '[data-testid="wb-signal-comments"] label:has-text("Flag the")']) {
    await page.click(sel);
    await page.waitForTimeout(150);
  }
  await shoot(page, "02-signals", true);

  // ── SCREEN 3: the mapper ──
  await page.click('[data-testid="wb-signals-continue"]');
  await page.waitForSelector('[data-testid="wb-mapper"]', { timeout: 120000 });
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/03-mapper.txt", body);
  ok("First/Last mapped as standard fields (no Unnamed:31 catastrophe)", /First name/.test(body) && /Last name/.test(body), null);
  ok("Constituent ID → Donor ID (standard, both sheets)", (body.match(/Donor ID/g) || []).length >= 2, null);
  ok("legacy sheet: day-first said with the impossible count", /day\/month\/year/.test(body) && /14,356/.test(body), null);
  ok("exclusion columns locked to flags, never custom", /safety flags/.test(body) && /locked/.test(body), null);
  ok("hidden column flagged on its row", /hidden column — not auto-mapped/i.test(body), null);
  ok("evidence says its sample on big columns", /of the first 3,000 \(of/.test(body), null);
  // ── Part 4.1: create a custom field INLINE from Internal Score ──
  await page.selectOption('[data-testid="wb-map-Internal Score"]', "__new__");
  await page.waitForSelector('[data-testid="wb-new-field"]');
  body = await page.innerText("body");
  ok("inline creator prefilled from the header with type evidence", /Create field/.test(body), null);
  await shoot(page, "03-mapper", true);
  await page.click('[data-testid="wb-create-field"]');
  await page.waitForTimeout(1200);
  body = await page.innerText("body");
  ok("the field exists the moment it's created, column mapped to it", /custom field “Internal Score”/.test(body), null);

  // ── SCREEN 4: the pre-write summary ──
  const tBuild0 = Date.now();
  await page.click('[data-testid="wb-review"]');
  await page.waitForSelector('[data-testid="wb-summary"]', { timeout: 300000 });
  const tBuild = ((Date.now() - tBuild0) / 1000).toFixed(1);
  console.log(`— pre-write summary built in ${tBuild}s —`);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/04-summary.txt", body);
  ok("25,034 donors after the fold, said with the fold", /25,034/.test(body) && /266 duplicate rows fold/.test(body), null);
  ok("88,967 gifts and the cash figure (721 repeated gift ids collapsed pre-write)", /88,967/.test(body) && /\$50,979,808\.17/.test(body) && /listed twice in the file/.test(body), null);
  ok("pledges as commitments, $0 in cash", /60 pledges as commitments/.test(body) && /\$0 in cash/.test(body), null);
  ok("recovery + stale sustainers stated", /100 failed sustainers to the recovery list/.test(body) && /60 stale/.test(body), null);
  ok("the 800 exclusions with hidden/yellow/comment provenance", /800/.test(body) && /rows carry an exclusion/.test(body) && /40 hidden rows, 100 highlighted, 40 from comments/.test(body), null);
  ok("per-sheet + workbook invariant balanced", /92,227 = 88,967 \+ 2,047 \+ 1,213 ✓ balanced/.test(body.replace(/ /g, " ")), body.match(/92,227[^\n]*/)?.[0]);
  ok("skip reasons itemised with downloads", /no donor match/.test(body) && /formula without a computed value/.test(body) && (body.match(/Download/g) || []).length >= 3, null);
  ok("percent-format flagged with its sentence", /stored as .*%, read as \$/.test(body), null);
  ok("TOTAL rows reconciled, legacy called stale", /32,523,933\.89/.test(body) && /19,852,987\.83/.test(body) && /stale/.test(body), null);
  ok("largest gifts are the real $25,000s, not the $32.5M subtotal", /\$25,000\.00/.test(body) && !/\$32,523,933\.89 · /.test(body), null);
  ok("merge review list with reasons + undo language", /folds into/.test(body) && /undo after import/i.test(body), null);
  ok("all-or-nothing said plainly", /one transaction/i.test(body) && /nothing lands/.test(body), null);
  await shoot(page, "04-summary", true);

  // ── THE IMPORT — timed click to done ──
  const tImport0 = Date.now();
  await page.click('[data-testid="wb-import"]');
  await page.waitForSelector('[data-testid="wb-result"]', { timeout: 900000 });
  const tImport = ((Date.now() - tImport0) / 1000).toFixed(1);
  console.log(`— import (click → summary) in ${tImport}s —`);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/05-result.txt", body);
  ok("result states created donors + gifts", /Imported: 25,034 donors created/.test(body) && /88,967 gifts recorded/.test(body), body.match(/Imported[^\n]*/)?.[0]);
  ok("pledges + merges recorded via semantics", /60 pledges recorded as commitments/.test(body), null);
  await shoot(page, "05-result", false);

  // ── verification 9: the LEGACY SHEET ALONE, into the org that now has the
  // donors — links by Donor ID, zero new donors, "map a name or email" dead ──
  {
    const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
    const src = XLSX.read(fs.readFileSync(FIXTURE), { type: "buffer", cellNF: true, cellFormula: true });
    const solo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(solo, src.Sheets["Gifts 2019-2022"], "Gifts 2019-2022");
    const soloPath = path.join(require("os").tmpdir(), "b82-legacy-alone.xlsx");
    XLSX.writeFile(solo, soloPath);

    const donorsBefore = (await j("/donors?limit=1")).total ?? (await j("/donors")).length ?? null;
    await page.click('[data-testid="wb-done"]');
    await page.waitForTimeout(2500);
    await page.click('button:has-text("Import & tools")');
    await page.waitForTimeout(400);
    await page.click('button:has-text("Import + History")');
    await page.waitForTimeout(800);
    await (await page.$('input[type="file"]')).setInputFiles(soloPath);
    await page.waitForSelector('[data-testid="wb-sheet-roles"]', { timeout: 120000 });
    body = await page.innerText("body");
    ok("gift sheet alone → 'link to your existing records' CTA", /link 36,050 gifts to your existing records/.test(body), body.match(/link [^\n]*/)?.[0]);
    await page.click('[data-testid="wb-continue"]');
    // no donors sheet → no signal questions on this file; straight to mapper
    await page.waitForSelector('[data-testid="wb-mapper"]', { timeout: 60000 });
    body = await page.innerText("body");
    ok("legacy ID → Donor ID (never 'map a name or email')", !/map at least one column to name or email/i.test(body) && /donor key|Donor ID/.test(body), null);
    await page.click('[data-testid="wb-review"]');
    await page.waitForSelector('[data-testid="wb-summary"]', { timeout: 300000 });
    body = await page.innerText("body");
    fs.writeFileSync(OUT + "/06-gift-alone.txt", body);
    ok("pre-write link preview from the server dryRun (by Donor ID)", /link to donors already in Steward/.test(body) && /by Donor ID/.test(body), body.match(/link to donors[^\n]*/)?.[0]);
    await shoot(page, "06-gift-alone", false);
    await page.click('[data-testid="wb-import"]');
    await page.waitForSelector('[data-testid="wb-result"]', { timeout: 600000 });
    await page.waitForTimeout(1000);
    const donorsAfter = (await j("/donors?limit=1")).total ?? (await j("/donors")).length ?? null;
    ok("ZERO new donors from the gift-sheet-alone import", donorsBefore !== null && donorsAfter === donorsBefore, { donorsBefore, donorsAfter });
    await shoot(page, "07-gift-alone-result", false);
    fs.unlinkSync(soloPath);
  }

  // ── server truth after the write ──
  const donorsCount = (await j("/donors/summaries?limit=1")).total ?? null;
  console.log("  server donor count:", donorsCount);
  const timing = { parse: +tParse, build: +tBuild, importWrite: +tImport, total: +(((Date.now() - tTotal0) / 1000).toFixed(1)) };
  fs.writeFileSync(OUT + "/timing.json", JSON.stringify(timing, null, 2));
  console.log("timing:", JSON.stringify(timing));

  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})();
