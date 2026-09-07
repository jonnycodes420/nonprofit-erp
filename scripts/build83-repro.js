// BUILD-83 Part 0 — REPRODUCE. Fresh org, v3, Jonathan's Sept-7 answer pattern:
// Treat-per-legend on hidden and yellow, Flag-the-40 on comments, and
// Import-as-normal on the BOGUS blue prompt (the gift sheet's shaded subtotal
// rows). Because prompt state is keyed by KIND, the blue answer clobbers the
// yellow one: exclusions land at 700, 0 highlighted. Capture the pre-write
// exclusion line, the DB truth after commit, Recurring, Home at 1440, and
// Finance → Accounts. Record click-to-summary time (missing from Sept 7).
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build83-repro.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "build82", "steward-messy-25k-v3.xlsx");
const OUT = path.join(__dirname, "..", "docs", "build83", "repro");
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = s => { console.log(s); log.push(s); };

(async () => {
  const stamp = Date.now().toString(36);
  let r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B83 Repro " + stamp, userName: "B83", email: `b83r_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token }, body: "{}" });
  r.org.onboarding_complete = 1;
  const token = r.token;
  const orgId = r.org.id;
  say("org: " + orgId);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
  page.on("pageerror", e => say("  [pageerror] " + e.message));
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

  // ── the signals screen: how many prompts, and which carry legend text ──
  let body = await page.innerText("body");
  fs.writeFileSync(OUT + "/01-signals.txt", body);
  const fillPrompts = await page.$$('[data-testid="wb-signal-filled_rows"]');
  say(`fill prompts on screen: ${fillPrompts.length} (expected defect: 2 — yellow + the subtotal-row blue)`);
  say(/DDEBF7|#DDEBF7/i.test(body) || fillPrompts.length > 1 ? "  the bogus blue prompt renders" : "  (no second fill prompt?)");
  say(/highlighted yellow/.test(body) ? "  yellow prompt quotes the legend" : "  yellow prompt missing");
  // Jonathan's answers, in his order: hidden=legend, yellow=legend, comments=route…
  await page.click('[data-testid="wb-signal-hidden_rows"] label:has-text("per the legend")');
  await fillPrompts[0].$('label:has-text("per the legend")').then(l => l.click());
  await page.click('[data-testid="wb-signal-comments"] label:has-text("Flag the")');
  // …then Import-as-normal on the LAST (blue) prompt — the clobber
  if (fillPrompts.length > 1) {
    await fillPrompts[fillPrompts.length - 1].$('label:has-text("Import as normal")').then(l => l.click());
    say("  answered the blue prompt Import-as-normal (after answering yellow per-legend)");
  }
  await page.screenshot({ path: OUT + "/01-signals-1440.png", fullPage: true });
  await page.click('[data-testid="wb-signals-continue"]');
  await page.waitForSelector('[data-testid="wb-mapper"]', { timeout: 60000 });
  await page.click('[data-testid="wb-review"]');
  await page.waitForSelector('[data-testid="wb-summary"]', { timeout: 300000 });
  const tSummary = ((Date.now() - t0) / 1000).toFixed(1);
  say(`click-to-summary: ${tSummary}s (upload → fully-accounted pre-write summary)`);

  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/02-summary.txt", body);
  const exclLine = body.split("\n").find(l => /carry an exclusion/.test(l)) || "(no exclusion line)";
  say("pre-write exclusion line: " + exclLine.trim());
  await page.screenshot({ path: OUT + "/02-summary-1440.png", fullPage: true });

  // ── import ──
  const tImp = Date.now();
  await page.click('[data-testid="wb-import"]');
  await page.waitForSelector('[data-testid="wb-result"]', { timeout: 900000 });
  say(`import write: ${((Date.now() - tImp) / 1000).toFixed(1)}s`);
  await page.screenshot({ path: OUT + "/03-result-1440.png", fullPage: true });

  // ── THE DB TRUTH after commit (the read-back the product doesn't do yet) ──
  const { Client } = require(path.join(__dirname, "..", "node_modules", "pg"));
  const pg = new Client({ connectionString: "postgresql://steward@localhost:5544/steward_loadtest" });
  await pg.connect();
  const q = async sql => (await pg.query(sql.replace(/\$ORG/g, `'${orgId}'`))).rows[0];
  const excl = await q(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER (WHERE deceased)::int deceased,
    COUNT(*) FILTER (WHERE do_not_contact)::int dnc,
    COUNT(*) FILTER (WHERE do_not_solicit)::int dns,
    COUNT(*) FILTER (WHERE do_not_mail)::int dnm
    FROM donors WHERE org_id=$ORG AND (deceased OR do_not_contact OR do_not_solicit OR do_not_mail OR do_not_email)`);
  const base = await q(`SELECT (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND deleted_at IS NULL) donors,
    (SELECT COUNT(*)::int FROM gifts WHERE org_id=$ORG) gifts,
    (SELECT COALESCE(SUM(amount),0)::numeric FROM gifts WHERE org_id=$ORG) cash,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND imported_sustainer) sust,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND tags::text LIKE '%card-failed%') failed,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND tags::text LIKE '%stale-frequency%') stale,
    (SELECT COUNT(*)::int FROM pledges WHERE org_id=$ORG) pledges,
    (SELECT COUNT(*)::int FROM fin_transactions WHERE org_id=$ORG) ledger,
    (SELECT COALESCE(SUM(amount),0)::numeric FROM fin_transactions WHERE org_id=$ORG AND type='income') ledgerIncome,
    (SELECT COUNT(*)::int FROM fundraising_goals WHERE org_id=$ORG) goals`);
  await pg.end();
  say(`DB after commit: donors ${base.donors} · gifts ${base.gifts} · cash $${Number(base.cash).toLocaleString()} · exclusion records ${excl.total} (deceased ${excl.deceased}, dnc ${excl.dnc}, dns ${excl.dns}, dnm ${excl.dnm}) · sustainers ${base.sust} (failed ${base.failed}, stale ${base.stale}) · pledges ${base.pledges} · LEDGER ROWS ${base.ledger} ($${Number(base.ledgerincome ?? base.ledgerIncome ?? 0).toLocaleString()} income) · goals ${base.goals}`);
  say(excl.dnc < 100 ? `>>> THE CLOBBER REPRODUCED: do_not_contact from fill = ${excl.dnc} (the 100 yellow rows were chosen per-legend and NOT applied)` : "clobber did not reproduce");

  // ── the after-screens: Recurring, Home, Finance → Accounts ──
  await page.click('[data-testid="wb-done"]');
  await page.waitForTimeout(3000);
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: OUT + "/04-home-1440.png", fullPage: true });
  fs.writeFileSync(OUT + "/04-home.txt", await page.innerText("body"));
  await page.click('button:has-text("Fundraising")');
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Recurring Giving")').catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + "/05-recurring-1440.png", fullPage: true });
  fs.writeFileSync(OUT + "/05-recurring.txt", await page.innerText("body"));
  await page.click('button:has-text("Finance")');
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Accounts")').catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: OUT + "/06-finance-accounts-1440.png", fullPage: true });
  fs.writeFileSync(OUT + "/06-finance.txt", await page.innerText("body"));

  fs.writeFileSync(OUT + "/repro-log.txt", log.join("\n"));
  await browser.close();
  console.log("done — docs/build83/repro/");
})();
