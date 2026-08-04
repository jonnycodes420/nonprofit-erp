// DSF3 screenshots for the Finance entity-routing FIX — the smart routing
// prompt on the Mellon case (manual $60k money-in naming a foundation with an
// open ask) and the Grants board after accepting (moved to Awarded, income
// booked once via the award stamp).
//
// Run against a LOCAL stack (never prod):
//   1. scratch server on :5601 booted with CORS_ORIGIN=http://localhost:4173
//   2. client built with VITE_API_URL=http://localhost:5601, `vite preview` on :4173
//   3. the finance-entity-routing suite run once (seeds org_froute_a —
//      froute-a@test.local / loadtest1234), then this script resets the Mellon
//      grant to an open ask via the API before driving the flow
//   PLAYWRIGHT_DIR=~/steward-qa node scripts/finance-entity-routing-capture.js
const path = require("path");
const fs = require("fs");

const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa");
const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://localhost:4173";
const API = process.env.API || "http://localhost:5601";
const EMAIL = process.env.EMAIL || "froute-a@test.local";
const PASSWORD = process.env.PASSWORD || "loadtest1234";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", "finance-entity-routing-2026-08-04");

(async () => {
  if (!/localhost/.test(BASE) || !/localhost/.test(API)) throw new Error("local stack only");
  fs.mkdirSync(OUT, { recursive: true });

  const login = await fetch(API + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then(r => r.json());
  if (!login.token) throw new Error("login failed: " + JSON.stringify(login));
  const auth = { Authorization: "Bearer " + login.token, "Content-Type": "application/json" };

  // Reset the scenario: Mellon back to an open $60k ask, ledger cleared of any
  // prior award/manual rows for a clean drive (API + direct, org-scoped).
  const grants = await fetch(API + "/grants", { headers: auth }).then(r => r.json());
  const mellon = grants.find(g => g.funder === "Mellon Foundation");
  if (!mellon) throw new Error("run tests/finance-entity-routing.test.js first (seeds the Mellon grant)");
  await fetch(API + "/grants/" + mellon.id, {
    method: "PUT", headers: auth,
    body: JSON.stringify({ funder: mellon.funder, program: mellon.program, amount: 60000, received: 0, status: "prospecting", deadline: mellon.deadline || "", reportDue: "", officer: "", notes: "", description: "", requirements: "" }),
  });
  const txns = await fetch(API + "/finance/transactions", { headers: auth }).then(r => r.json());
  for (const t of txns.filter(t => t.grant_id === mellon.id || t.vendor_donor === "Mellon Foundation"))
    await fetch(API + "/finance/transactions/" + t.id, { method: "DELETE", headers: auth });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
  await page.goto(BASE + "/login");
  await page.evaluate(([t, u, o]) => {
    localStorage.setItem("npe_token", t);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [login.token, login.user, login.org]);
  await page.goto(BASE + "/dashboard");
  await page.waitForTimeout(2500);

  // Finance → Transactions → + Add transaction
  await page.getByRole("button", { name: "Finance" }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Transactions" }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "+ Add transaction" }).first().click();
  await page.waitForTimeout(400);

  // The Mellon case: $60,000 money-in free-typed as "Mellon Foundation".
  await page.getByPlaceholder("0.00").fill("60000");
  await page.getByPlaceholder("What is this for?").fill("Grant check received");
  const vendor = page.getByPlaceholder("Start typing — donors and open grants link automatically");
  await vendor.fill("Mellon Foundation");
  await page.waitForTimeout(600); // debounce + lookup — the type-ahead shows the open ask
  await page.locator(".modal-sheet-inner").screenshot({ path: path.join(OUT, "modal-typeahead.png") });
  await page.getByRole("button", { name: "Save transaction" }).click();
  await page.waitForSelector("text=open ask", { timeout: 10000 });
  await page.locator(".modal-sheet-inner").screenshot({ path: path.join(OUT, "smart-prompt-mellon.png") });

  // Accept → the existing award flow books the income once.
  await page.getByRole("button", { name: "Yes — mark awarded" }).click();
  await page.waitForTimeout(2000);

  // Ledger shows ONE row, badged Grant · Award.
  await page.screenshot({ path: path.join(OUT, "ledger-after-award.png"), fullPage: false });

  // Grants board: Mellon now sits in Awarded, open-asks cleared.
  await page.getByRole("button", { name: "Grants" }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "grants-board-awarded.png"), fullPage: false });

  await browser.close();
  console.log("Screenshots written to " + OUT);
})();
