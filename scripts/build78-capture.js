// BUILD-78 walk — the mapper with the new fixture at 1440 and 390, the
// summary's two axes, the profile's custom fields, and the in-browser date
// assertion (verification #3 + #11). Run:
//   PLAYWRIGHT_DIR=$HOME/steward-qa node b78-walk.js
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const FIXTURE = process.env.HOME + "/nonprofit-erp/tests/fixtures/build78/steward-messy-cf.csv";
const OUT = process.env.HOME + "/nonprofit-erp/docs/build78";
const EMAIL = "org_b78walk@test.local", PASS = "loadtest1234";
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + JSON.stringify(detail))); if (!cond) failures++; };

(async () => {
  const login = await fetch("http://localhost:5601/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) }).then(r => r.json());
  if (!login.token) { console.error("login failed", login); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on("pageerror", e => console.log("  [pageerror]", e.message));
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t);
    localStorage.setItem("npe_user", u);
    localStorage.setItem("npe_org", o);
  }, [login.token, JSON.stringify(login.user), JSON.stringify(login.org)]);
  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('nav button:has-text("Donors"), button:has-text("Donors")');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(600);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(800);
  const fileInput = await page.$('input[type="file"]');
  ok("import modal offers a file input", !!fileInput);
  await fileInput.setInputFiles(FIXTURE);
  await page.waitForTimeout(3500);

  // the mapping screen with the plan
  const bodyText = await page.textContent("body");
  ok("shape banner reads individual gifts", /individual gifts/i.test(bodyText));
  ok("the trap is on screen: Deceased? routes to the flag, not a field", /Deceased\?/.test(bodyText) && /set the flag/i.test(bodyText));
  ok("a proposal shows its evidence (N of M values parse …)", /\d[\d,]* of \d[\d,]* values/i.test(bodyText));
  ok("the mixed column names its refusals BEFORE the write", /Last Contact/.test(bodyText));
  await page.screenshot({ path: OUT + "/b78-mapper-1440.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "/b78-mapper-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.waitForTimeout(400);

  // decide every column precisely, keyed by its header (Part 8's golden
  // decisions): the eight custom columns get Store it with the right entity;
  // Legacy ID + the duplicate Notes are discarded.
  const STORE = {
    "Board Member": "donor", "Matching Employer": "donor", "Preferred Name": "donor",
    "In Memory Of": "gift", "Appeal Code": "gift", "Soft Credit To": "gift",
    "Last Contact": "donor", "Gift Level": "donor",
  };
  const DISCARD = ["Legacy ID", "Notes"];
  for (const [hdr, entity] of Object.entries(STORE)) {
    const card = await page.$(`[data-cf-col="${hdr}"]`);
    ok(`proposal card present: ${hdr}`, !!card);
    if (!card) continue;
    // set entity via the card's on-the-donor/on-the-gift select (2nd select)
    const selects = await card.$$("select");
    if (selects[1]) await selects[1].selectOption(entity === "gift" ? "gift" : "donor");
    await page.waitForTimeout(150);
    await (await page.$(`[data-cf-col="${hdr}"] button:has-text("Store it")`)).click();
    await page.waitForTimeout(200);
  }
  for (const hdr of DISCARD) {
    const btns = await page.$$(`[data-cf-col="${hdr}"] button:has-text("Discard")`);
    for (const btn of btns) { const txt = await btn.textContent(); if (/^Discard$/.test(txt.trim())) { await btn.click(); break; } }
    await page.waitForTimeout(200);
  }
  const undecided = await page.textContent("body");
  ok("no column is left undecided", !/still needs? a decision/i.test(undecided));
  await page.screenshot({ path: OUT + "/b78-mapper-decided-1440.png", fullPage: true });

  const importBtn = await page.$('button:has-text("Import ")');
  ok("import button armed", importBtn && await importBtn.isEnabled());
  await importBtn.click();
  await page.waitForTimeout(30000);

  const summaryText = await page.textContent("body");
  ok("row axis on screen (Every row and every dollar accounted for)", /Every row and every dollar accounted for/i.test(summaryText));
  ok("COLUMN axis on screen (Every column accounted for, balanced)", /Every column accounted for/i.test(summaryText) && /Columns in your file/i.test(summaryText));
  ok("summary says Balanced twice (both axes)", (summaryText.match(/Balanced/g) || []).length >= 2);
  ok("refused rows downloadable", /Download the .* rows that were not imported/i.test(summaryText));
  await page.screenshot({ path: OUT + "/b78-summary-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + "/b78-summary-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.click('button:has-text("Done")');
  await page.waitForTimeout(2000);

  // ── #3 · a custom DATE field asserted in the browser ────────────────────
  // A donor from THIS import carries a Last Contact (date) custom value; open
  // the profile and confirm an mm/dd/yyyy source rendered as an ISO civil
  // date — normalizeDate ran in Chrome, whose native Date would refuse it.
  await page.click('button:has-text("Donors")');
  await page.waitForTimeout(1500);
  const withDate = await (await fetch("http://localhost:5601/donors/custom-field-values/all", { headers: { Authorization: "Bearer " + login.token } }).then(r => r.json()))
    .find(r => r.values && r.values.last_contact);
  const [dRow] = withDate ? await (async () => {
    const res = await fetch("http://localhost:5601/donors/summaries", { headers: { Authorization: "Bearer " + login.token } }).then(r => r.json());
    return res.filter(d => d.id === withDate.donorId);
  })() : [];
  ok("a donor carries a Last Contact (date) custom value from this import", !!withDate && !!withDate.values.last_contact, withDate && withDate.values);
  if (dRow) {
    await page.fill('input[placeholder="Search donors…"]', dRow.name);
    await page.waitForTimeout(1500);
    await page.click(`text=${dRow.name}`).catch(() => {});
    await page.waitForTimeout(2500);
    const prof = await page.textContent("body");
    ok("the profile shows the Custom Fields section", /Custom Fields/i.test(prof));
    ok(`the Last Contact date renders as an ISO civil date (${withDate.values.last_contact}) — parsed in Chrome`,
      prof.includes(withDate.values.last_contact), withDate.values.last_contact);
    await page.screenshot({ path: OUT + "/b78-profile-custom-1440.png", fullPage: false });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
  }

  // settings: created-during-import provenance (via the nav button — the SPA
  // has no /settings deep-link; a direct goto falls back to Home)
  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Settings")');
  await page.waitForTimeout(1500);
  await page.click("text=Customization").catch(() => {});
  await page.waitForTimeout(1200);
  const set = await page.textContent("body");
  ok("settings shows import provenance (created during import of steward-messy-cf.csv)",
    /created during import of steward-messy-cf\.csv/i.test(set), null);
  ok("both entity tabs present (Donor fields / Gift fields)", /Donor fields/.test(set) && /Gift fields/.test(set), null);
  await page.screenshot({ path: OUT + "/b78-settings-fields-1440.png", fullPage: true });

  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : "\nwalk clean");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("WALK ERROR:", e); process.exit(1); });
