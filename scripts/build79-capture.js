// BUILD-79 verification walk — the same file that broke Steward eight ways on
// Sept 5, back through the real UI on a FRESH org, at 1440 and 390. Asserts
// Parts 1–6 on-screen and writes the walk record into docs/build79/.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build79-capture.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED) — scratch stack
// on :5601/:4173 per tests/README.md + scripts/build-local-dist.sh.
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "build79", "steward-messy-2500-v2.csv");
const OUT = path.join(__dirname, "..", "docs", "build79");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 300)));
  if (!cond) failures++;
};

(async () => {
  const stamp = Date.now().toString(36);
  const EMAIL = `b79walk_${stamp}@test.local`;
  let r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B79 Walk " + stamp, userName: "B79 Walker", email: EMAIL, password: "loadtest1234" }) }).then(r => r.json());
  if (!r.token) { console.error("register failed", r); process.exit(1); }
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token }, body: "{}" });
  r.org.onboarding_complete = 1;
  const token = r.token;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.on("pageerror", e => {
    // local-preview artifact: /_vercel/insights/script.js 404s as HTML and the
    // browser reports "Unexpected token '<'" — prod serves the real script.
    if (/Unexpected token '<'/.test(e.message)) return;
    console.log("  [pageerror]", e.message); failures++;
  });
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
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForTimeout(6000);

  // ── Verification 1 — header on line 4, chrome shown, 2,500 everywhere ────
  let body = await page.innerText("body");
  ok("header found on LINE 4, said on screen", /found on line 4/.test(body));
  ok("chrome above the header named verbatim", /We skipped 3 lines above your column headers/.test(body) && /Donor Giving History Report/.test(body));
  ok("excluded rows listed by kind and line", /page marker \(line 743\)/.test(body) && /the report's own TOTAL row \(line 2852\)/.test(body));
  ok("2,500 rows — the one count", /2,500 rows/.test(body) && !/2,510|2,438|2,853/.test(body));
  ok("the file's own TOTAL surfaced pre-import", /total row says \$2,035,978\.52/.test(body));
  ok("Windows-1252 names named", /Windows-1252 characters and were converted/.test(body));
  ok("shape detected as individual gifts, with evidence", /individual gifts/.test(body) && /no lifetime-total column|same donor repeats/.test(body));
  await page.screenshot({ path: OUT + "/01-mapper-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "/01-mapper-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(400);

  // ── Verification 2 — totals mode refuses this file ───────────────────────
  await page.selectOption("select", "aggregate").catch(() => {});
  await page.waitForTimeout(1200);
  body = await page.innerText("body");
  ok("totals mode REFUSES: the collapse evidence is on screen", /rows collapse onto a donor already in this file/.test(body));
  ok("the refusal offers the one-click flip", /Treat as individual gifts/.test(body));
  const findImportBtn = async () => {
    for (const b of await page.$$("button")) {
      const t = ((await b.textContent()) || "").trim();
      if (/^Import [\d,]+ donor/.test(t) || /^Importing/.test(t)) return b;
    }
    return null;
  };
  const impBtnAgg = await findImportBtn();
  const impEnabledAgg = impBtnAgg ? await impBtnAgg.isEnabled() : null;
  ok("the import button is disabled in refused totals mode", impEnabledAgg === false, impEnabledAgg);
  await page.screenshot({ path: OUT + "/02-totals-refused-1440.png", fullPage: true });
  await page.click('button:has-text("Treat as individual gifts")');
  await page.waitForTimeout(1500);

  // ── decide every column (a hurried ED discards the unclaimed) ────────────
  for (let pass = 0; pass < 3; pass++) {
    const cards = await page.$$("[data-cf-col]");
    for (const card of cards) {
      const discard = await card.$('button:has-text("Discard")');
      if (discard) {
        const txt = (await discard.textContent()).trim();
        if (/^Discard$/.test(txt)) { await discard.click().catch(() => {}); await page.waitForTimeout(120); }
      }
    }
    body = await page.innerText("body");
    if (!/still needs? a decision/i.test(body)) break;
  }
  const importBtn = await findImportBtn();
  ok("import button armed after decisions", importBtn && await importBtn.isEnabled());
  await importBtn.click();
  await page.waitForTimeout(45000);
  await page.waitForLoadState("networkidle").catch(() => {});

  // ── Verification 3 — the summary earns its green, and reconciles the TOTAL
  body = await page.innerText("body");
  ok("import completed", /Import complete|Imported — with gaps/.test(body));
  ok("dollars are NOT $0 anywhere on the summary", !/·\s*\$0\b/.test(body.split("EVERY")[1] || body));
  ok("the file's own TOTAL row reconciled on the result screen", /Your file's own total row \(line 2852\) says \$2,035,978\.52/.test(body));
  ok("difference explained, not hidden", /difference \$/.test(body));
  ok("refused rows downloadable with lines + reasons", /Download the .* rows that were not imported/.test(body));
  await page.screenshot({ path: OUT + "/03-summary-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "/03-summary-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.click('button:has-text("Done")');
  await page.waitForTimeout(2500);

  // ── Verification 4/5 — DB truth: dates, names ────────────────────────────
  const j = p => fetch(API + p, { headers: { Authorization: "Bearer " + token } }).then(x => x.json());
  const sums = await j("/donors/summaries");
  const today = new Date().toISOString().slice(0, 10);
  const stampedToday = sums.filter(d => String(d.last_gift_date || "") === today);
  ok(`no donor stamped with an import-day last gift they didn't earn (${stampedToday.length} ≤ 1 file-supported)`, stampedToday.length <= 1, stampedToday.slice(0, 3).map(d => d.name));
  const phoneNames = sums.filter(d => /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(String(d.name || "").trim()));
  ok("ZERO donors whose display name is a phone number", phoneNames.length === 0, phoneNames.slice(0, 5).map(d => d.name));
  const emailNames = sums.filter(d => String(d.name || "").includes("@"));
  ok("ZERO donors whose display name is an email address", emailNames.length === 0, emailNames.slice(0, 5).map(d => d.name));
  const unnamed = sums.filter(d => /^Unnamed donor \(line \d+\)$/.test(d.name));
  ok(`the nameless are honest 'Unnamed donor (line N)' records (${unnamed.length})`, unnamed.every(d => /needs-name/.test(String(d.tags || ""))), unnamed.slice(0, 3));
  const totalDollars = sums.reduce((s, d) => s + (parseFloat(d.total_giving) || 0), 0);
  ok(`imported dollars are real (Σ donor totals $${Math.round(totalDollars).toLocaleString()}, not $0)`, totalDollars > 1000000, totalDollars);

  await page.screenshot({ path: OUT + "/04-donorlist-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "/04-donorlist-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1400 });

  // ── Verification 6 — home surfaces trust an import that EARNED it ────────
  await page.goto(APP + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  body = await page.innerText("body");
  ok("Needs Your Attention carries no phone-number identities", !/\(\d{3}\) \d{3}-\d{4}\s*\n\s*(New prospect|Gave)/.test(body));
  ok("drift speaks about real patterns now (no zero-gift lie)", !/No giving history on file yet/.test(body));
  await page.screenshot({ path: OUT + "/05-home-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "/05-home-390.png", fullPage: true });

  // ── Verification 7 — export succeeds on the imported org ─────────────────
  const ex = await fetch(API + "/donors/export/csv", { headers: { Authorization: "Bearer " + token } });
  ok("GET /donors/export/csv → 200 on the imported org", ex.status === 200, ex.status);
  const exText = await ex.text();
  const exLines = exText.split("\n").length;
  ok("export bytes are CSV with the imported records", exText.slice(0, 8).includes("Name,") && exLines > 500, { bytes: exText.length, lines: exLines });

  console.log(`\nbuild79-capture: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"} — screenshots in docs/build79/`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
