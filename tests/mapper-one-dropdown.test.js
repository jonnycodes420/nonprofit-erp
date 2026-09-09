// FIX (2026-09-09) — THE COLUMN-TARGET DROPDOWN IS ONE COMPONENT.
// Every importer asks the same question of every column — "what does this
// become?" — and three screens used to answer it three ways. The CSV donor
// mapper showed a FLAT list of 17 internal keys: a 30-column prospect-research
// export had no destination for 26 of its columns and no way to make one
// without leaving the import. This renders the mapper for EACH ENTRY SHAPE in a
// real browser and asserts all four carry the same three groups, including
// "＋ New custom field".
//
// It also pins the two rules the flat list had no way to enforce:
//   · two columns cannot map to one target (item 2)
//   · a guess that duplicates an already-taken target is dropped, and a
//     low-confidence contents guess defaults to skip (item 3)
//
// Browser suite conventions (BUILD-44 Part 6): SKIP cleanly without Playwright
// or a localhost-API dist; the app must be served from :4173 (the API's CORS
// allowlist); seed auth from the REAL /auth/login payload.
const path = require("path");
const fs = require("fs");
const { ok, summary, api, q, closeDb, BASE } = require("./helpers");
const bcrypt = require("bcryptjs");

const APP = "http://localhost:4173";
const ORG = "org_mapdrop";
const FIXTURE = path.join(__dirname, "fixtures", "mapper", "prospect-research-30col.csv");

let chromium;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { console.log("  SKIP  Playwright not found (set PLAYWRIGHT_DIR)\n\n0 passed, 0 failed (skipped)"); process.exit(0); }

const openImporter = async (page, button) => {
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(400);
  await page.click(`button:has-text("${button}")`);
  await page.waitForTimeout(700);
};
// Every mapper's dropdown must offer the same three groups.
const assertThreeGroups = async (page, label, sel) => {
  const groups = await page.$$eval(sel, els => {
    const s = els[0];
    if (!s) return null;
    return {
      optgroups: [...s.querySelectorAll("optgroup")].map(g => g.label),
      hasNew: [...s.querySelectorAll("option")].some(o => /New custom field/i.test(o.textContent)),
      hasIgnore: [...s.querySelectorAll("option")].some(o => /Don't import this column/i.test(o.textContent)),
      standardCount: [...s.querySelectorAll('optgroup[label="Standard fields"] option')].length,
    };
  }).catch(() => null);
  ok(`${label}: the column dropdown exists`, !!groups, groups);
  if (!groups) return;
  ok(`${label}: it has a Standard fields group`, groups.optgroups.includes("Standard fields"), groups.optgroups);
  ok(`${label}: it offers ＋ New custom field`, groups.hasNew, groups);
  ok(`${label}: it offers "Don't import this column"`, groups.hasIgnore, groups);
  ok(`${label}: the standard group is not empty`, groups.standardCount > 0, groups.standardCount);
};

(async () => {
  console.log("mapper-one-dropdown (FIX 2026-09-09)");
  if (!fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html"))) {
    console.log("  SKIP  client/dist not built\n\n0 passed, 0 failed (skipped)"); process.exit(0);
  }
  for (const t of ["gifts", "interactions", "fin_transactions", "budgets", "accounts", "fin_funds", "custom_field_values", "custom_fields", "custom_field_defs", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Mapper Drop','mapper-drop',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,'mapdrop@t.local',$3,'Map Drop','admin')`, ["u_" + ORG, ORG, bcrypt.hashSync("loadtest1234", 10)]);
  const login = await api("POST", "/auth/login", null, { email: "mapdrop@t.local", password: "loadtest1234" });
  ok("login ok", login.status === 200, login.status);
  const auth = login.body;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) { console.log("  [pageerror]", e.message.slice(0, 160)); } });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
  await page.goto(APP + "/donors", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1000);

  // ── SHAPE 1 · single CSV, donor totals (the shape that was flat) ─────────
  await openImporter(page, "Import + History");
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForTimeout(3000);
  // the 30-column research export is shape-ambiguous; choose donor totals
  // the shape select takes a plain string label, not a regex
  await page.selectOption("select", { label: "One row per donor (totals)" }).catch(async () => {
    await page.$$eval("select", els => { const s = els[0]; const o = [...s.options].find(x => /totals/i.test(x.textContent));
      if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); } });
  });
  await page.waitForTimeout(800);
  let body = await page.innerText("body");
  ok("the donor-totals mapper renders its columns", /contact_confidence/.test(body), body.slice(0, 200));
  await assertThreeGroups(page, "single CSV (donor totals)", '[data-testid="donor-map-contact_confidence"]');

  // ── item 3 · the guess never duplicates a target, and the wrong ones are gone
  const guessed = await page.$$eval("[data-testid^='donor-map-']", els =>
    Object.fromEntries(els.map(e => [e.getAttribute("data-testid").replace("donor-map-", ""), e.value])));
  const stdTargets = Object.entries(guessed).filter(([, v]) => String(v).startsWith("std:")).map(([h, v]) => [h, v.slice(4)]);
  const byTarget = {};
  for (const [h, t] of stdTargets) (byTarget[t] = byTarget[t] || []).push(h);
  const dupes = Object.entries(byTarget).filter(([, hs]) => hs.length > 1);
  ok("no two columns are auto-mapped to the same target", dupes.length === 0, dupes);
  ok("contact_confidence is NOT guessed as the name column",
     (guessed.contact_confidence || "ignore") !== "std:name", guessed.contact_confidence);
  ok("capacity_estimate is NOT guessed as city (it contains the letters of 'city')",
     (guessed.capacity_estimate || "ignore") !== "std:city", guessed.capacity_estimate);
  ok("region_code is NOT guessed as state", (guessed.region_code || "ignore") !== "std:state", guessed.region_code);
  ok("contact_name IS still guessed as the name column", guessed.contact_name === "std:name", guessed.contact_name);

  // ── item 2 · two columns cannot map to one target ────────────────────────
  const nameTaken = await page.$eval('[data-testid="donor-map-org_affiliation"]', s =>
    [...s.querySelectorAll('optgroup[label="Standard fields"] option')]
      .filter(o => /full name/i.test(o.textContent)).map(o => o.disabled)[0]);
  ok("a target another column already holds is disabled in the dropdown", nameTaken === true, nameTaken);

  // ── the inline creator really creates a field ────────────────────────────
  await page.selectOption('[data-testid="donor-map-wealth_indicator"]', "__new__");
  await page.waitForSelector('[data-testid="ct-new-field"]', { timeout: 5000 });
  await page.click('[data-testid="ct-create-field"]');
  await page.waitForTimeout(1500);
  const made = await q(`SELECT label, entity, type, options FROM custom_field_defs WHERE org_id=$1`, [ORG]);
  ok("＋ New custom field creates the field from the mapper, prefilled from the header",
     made.some(m => /wealth_indicator/i.test(m.label)), made.map(m => m.label));
  // The proposal's OPTIONS must ride with its type: this column's three
  // distinct values propose a `select`, and the seam refuses a select with no
  // options — which is exactly how this silently 400'd before the guard.
  const sel = made.find(m => /wealth_indicator/i.test(m.label));
  ok("a proposed choice field is created WITH its options, not an empty select",
     sel && (sel.type !== "select" || (Array.isArray(sel.options) ? sel.options.length : JSON.parse(sel.options || "[]").length) > 0),
     sel && { type: sel.type, options: sel.options });
  const nowOffered = await page.$eval('[data-testid="donor-map-propensity"]', s =>
    [...s.querySelectorAll("optgroup")].map(g => g.label));
  ok("…and it immediately appears as an existing custom field on every other column",
     nowOffered.includes("Your custom fields"), nowOffered);

  await page.click('button:has-text("✕ Close")').catch(() => {});
  await page.waitForTimeout(600);

  // ── SHAPE 2 · single CSV, report export (one row per gift) ───────────────
  {
    const txCsv = path.join(require("os").tmpdir(), "mapdrop-report-export.csv");
    fs.writeFileSync(txCsv, "Donor Name,Email,Amount,Gift Date,Solicitation Code,Batch Ref\n" +
      Array.from({ length: 40 }, (_, i) => `Donor ${i},d${i}@x.org,${100 + i},2025-03-0${(i % 9) + 1},SC-${i},B${i}`).join("\n"));
    await openImporter(page, "Import + History");
    await (await page.$('input[type="file"]')).setInputFiles(txCsv);
    await page.waitForTimeout(3500);
    body = await page.innerText("body");
    ok("the report-export mapper renders its unrecognised columns", /Solicitation Code/i.test(body), body.slice(0, 200));
    await assertThreeGroups(page, "single CSV (report export)", '[data-testid="tx-map-Solicitation Code"]');
    await page.click('button:has-text("✕ Close")').catch(() => {});
    await page.waitForTimeout(600);
    fs.unlinkSync(txCsv);
  }

  // ── SHAPES 3 + 4 · the workbook's donors sheet and gift sheet ────────────
  {
    const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Constituent ID", "Last", "First", "Email", "Loyalty Tier"],
      ...Array.from({ length: 30 }, (_, i) => [String(1000 + i), `Last${i}`, `First${i}`, `w${i}@x.org`, "gold"]),
    ]), "Donors");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Gift ID", "Constituent ID", "Gift Date", "Gift Amount", "Batch Code"],
      ...Array.from({ length: 40 }, (_, i) => [`G${i}`, String(1000 + (i % 30)), "2025-04-01", 50 + i, `BX-${i}`]),
    ]), "Gifts");
    const wbPath = path.join(require("os").tmpdir(), "mapdrop-workbook.xlsx");
    XLSX.writeFile(wb, wbPath);
    await openImporter(page, "Import + History");
    await (await page.$('input[type="file"]')).setInputFiles(wbPath);
    await page.waitForSelector('[data-testid="wb-sheet-roles"]', { timeout: 60000 });
    await page.click('[data-testid="wb-continue"]');
    await page.waitForSelector('[data-testid="wb-mapper"]', { timeout: 30000 });
    await assertThreeGroups(page, "workbook donors sheet", '[data-testid="wb-map-Loyalty Tier"]');
    await assertThreeGroups(page, "workbook gift sheet", '[data-testid="wb-map-Batch Code"]');
    fs.unlinkSync(wbPath);
  }

  await browser.close();
  await closeDb();
  summary("mapper-one-dropdown");
})();
