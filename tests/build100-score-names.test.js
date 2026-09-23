// BUILD-100 — A NUMBER BESIDE A PERSON'S NAME MAKES A CLAIM.
//
// The donor profile showed "Score 77/99". Every input to it is the org's own
// giving history — amount, recency, frequency — so a retired teacher giving
// $50 a month for ten years outscores a millionaire who gave once. That is
// correct, and it is the opposite of what an undefined "score" implies sitting
// next to somebody's name. Fundraisers read "score" and "capacity" as SCREENED
// data (property records, SEC filings, the DonorSearch sense). Nothing in this
// product looks outside your own tables. Nobody was screened.
//
// So the names say what the numbers are, and the definitions travel with them
// on the dashboards' hover convention (BUILD-86 C.3: a number nobody can
// define is a number nobody should be shown).
//
// And the "Urgency Score: X/10" in the Suggested panel is GONE. It was not
// computed — it was a literal line in the prompt template asking the model to
// emit one, printed as though it meant something. Ask twice, get two numbers.
// It was the only figure on that screen that could not answer "how is this
// arrived at?".

const fs = require("fs"), path = require("path");
const { BASE, ok, summary, closeDb } = require("./helpers");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const haveDeps = () => { try { require(path.join(PW, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };
const SRC = path.join(__dirname, "..", "client", "src", "components");

(async () => {
  console.log("build100-score-names");
  const donors = fs.readFileSync(path.join(SRC, "Donors.jsx"), "utf8");

  console.log("\n— §1 · the number says what it is —");
  ok('the profile tile is labelled "Giving strength"',
    /GIVING_STRENGTH_LABEL\s*=\s*"Giving strength"/.test(donors), null);
  const def = (donors.match(/const GIVING_STRENGTH_DEF = "([^"]+)"/) || [])[1] || "";
  ok("…and carries a definition", def.length > 40, def.slice(0, 60));
  // The whole point: it must deny the reading it used to invite.
  ok("…that says explicitly it is NOT an estimate of what they could give",
    /NOT an estimate/i.test(def), def);
  ok("…and that nothing looks outside the org's own records",
    /own records/i.test(def), def);

  console.log("\n— §2 · no surface still says 'wealth' —");
  for (const f of ["Donors.jsx", "Dashboard.jsx", "Reports.jsx", "Pipeline.jsx"]) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    // Rendered text only: a JSX text node or a string label, not an identifier
    // like WEALTH_SCORE_DEFINITION or an apiFetch("/donors/:id/wealth-score").
    const rendered = src.match(/>\s*Wealth Score\s*</gi) || [];
    ok(`${f} renders no "Wealth Score" label`, rendered.length === 0, rendered);
  }
  ok('the capacity filter is labelled "Proven capacity"', />Proven capacity</.test(donors), null);

  console.log("\n— §3 · the model is no longer asked to invent a number —");
  ok("the Suggested-move prompt does not ask for an Urgency Score",
    !/\*\*Urgency Score:\*\*/.test(donors), (donors.match(/.{0,60}Urgency Score.{0,40}/) || [])[0]);
  // The REAL urgency still exists and is still computed.
  const shared = fs.readFileSync(path.join(SRC, "shared.jsx"), "utf8");
  ok("moveUrgency still computes urgency from days against the stage threshold",
    /export function moveUrgency/.test(shared) && /STAGE_THRESH/.test(shared), null);
  ok("…and the profile still renders it on the Contact tile",
    /urg\.days.*urg\.urgencyColor/.test(donors), null);

  console.log("\n— §4 · the browser: the definition is reachable —");
  if (!haveDeps()) { console.log("  SKIP — no Playwright or client/dist"); await closeDb(); summary(); return; }
  const { chromium } = require(path.join(PW, "node_modules", "playwright"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const lr = await page.request.post(BASE + "/auth/login", { data: { email: "admin@creoarts.org", password: "demo1234" } });
  const lj = await lr.json();
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(d => { localStorage.setItem("npe_token", d.token); localStorage.setItem("npe_user", JSON.stringify(d.user)); localStorage.setItem("npe_org", JSON.stringify(d.org)); }, lj);
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("Donors")').first().click();
  await page.waitForTimeout(2200);
  const row = page.locator("text=Margaret Chen").first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(1800); }

  const found = await page.evaluate(() => {
    const labelled = [...document.querySelectorAll("div")].some(d => /GIVING STRENGTH/i.test(d.textContent || "") && d.children.length <= 2);
    const mark = [...document.querySelectorAll("[title]")].find(e => /how recently/i.test(e.getAttribute("title") || ""));
    return { labelled, hasDef: !!mark, tabbable: mark ? mark.getAttribute("tabindex") === "0" : false,
             aria: mark ? !!mark.getAttribute("aria-label") : false };
  });
  ok("the tile is labelled Giving strength on screen", found.labelled, found);
  ok("…the definition is on it", found.hasDef, found);
  // A tooltip nobody can reach is a definition that does not exist for half
  // the people who need it — the dashboards' own rule.
  ok("…reachable by keyboard", found.tabbable, found);
  ok("…and exposed to a screen reader", found.aria, found);
  await browser.close();

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
