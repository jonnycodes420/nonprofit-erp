// BUILD-90 90c — ONE DATE, THREE SURFACES.
// Pure file-level guard (no server, no DB):  node tests/one-date.test.js
//
// "December 31, 2026" was true in three places for a while: the pricing page's
// free-through line, the Terms' Free Trial clause, and the trial-end email —
// because the billing code really did grant free access through that date.
// BUILD-87 F.2 pinned those three survivors BY NAME rather than deleting them,
// on the grounds that copy must not contradict code and changing the code was
// money math. This build did the money math. So the survivors go to ZERO, and
// this suite is what stops the string, or the price it was attached to, from
// coming back.
//
// WHAT COUNTS AS A SURFACE. Anything a customer can read: the public pages,
// the authenticated app, the server's email and page templates, the shared
// template module, and index.html. Test fixtures, audit findings and build
// notes are NOT surfaces — `tests/import-reconciliation.test.js` legitimately
// names a "December 31 cluster" of fixture rows, and renaming a fixture to
// satisfy a copy guard would be the guard tampering with evidence.

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 500) : "")); }
};
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
// A guard that greps source for a forbidden string must strip COMMENTS first,
// or the file that explains WHY the string was removed fails the rule it
// documents. Same stripper the palette census and the legal-entity guard use.
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = rel => stripComments(read(rel));

// Every file that renders to a customer.
const SURFACE_DIRS = ["client/src", "shared"];
const SURFACE_FILES = ["server.js", "db.js", "trialEnd.js", "closeLink.js", "billingPlans.js", "client/index.html"];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walk(rel, out); continue; }
    if (/\.(js|jsx|mjs|cjs|html)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const SURFACES = [...SURFACE_DIRS.flatMap(d => walk(d)), ...SURFACE_FILES];

console.log("— §1 · the string is gone from every surface —");
const dec31 = SURFACES.filter(f => /December 31/.test(code(f)));
ok('no surface says "December 31" — the survivors list is now EMPTY', dec31.length === 0, dec31);
// And the free-through promise itself, in any wording.
const freeThrough = SURFACES.filter(f => /free through|FREE_THROUGH/i.test(code(f)));
ok("…nor any 'free through <date>' promise, in any casing", freeThrough.length === 0, freeThrough);

console.log("\n— §2 · the code path that granted it is removed —");
const te = read("trialEnd.js");
ok("trialEnd.js holds no free-through constant", !/FREE_THROUGH/.test(te));
ok("…and computes one span from one input", /signedAt\) \{\s*\n\s*return new Date\(toMs\(signedAt\) \+ THIRTY_DAYS_MS\);/.test(te), te.slice(te.indexOf("function computeTrialEnd"), te.indexOf("function computeTrialEnd") + 200));
ok("the one-off script that extended trials to that date is deleted",
   !fs.existsSync(path.join(root, "scripts/extend-trials-free-through-2026.js")));

console.log("\n— §3 · the three surfaces read the real date —");
const pricing = read("client/src/pages/Pricing.jsx");
ok("the pricing page tells a VISITOR the rule, not a date",
   /Nothing is charged for your first thirty days\./.test(pricing));
ok("…and tells a SIGNED-IN org where its own date lives",
   /Settings → Billing/.test(pricing));
const terms = read("client/src/pages/TermsPage.jsx");
ok("the Terms' Free Trial clause states thirty days from signing",
   /Free Trial.*thirty days are free/s.test(terms) && /thirty days after you sign up/.test(terms));
ok("…and states that nothing inside those thirty days moves the date",
   /importing your data, importing it again, or rescheduling onboarding/.test(terms));
ok("…and promises the seven-day reminder in writing",
   /Seven days before the first charge/.test(terms));
const settings = read("client/src/components/Settings.jsx");
ok("Settings → Billing renders the first-charge date from billing status",
   /First Charge/.test(settings) && /billing\.trialEndsAt/.test(settings));
ok("…with the same sentence the server composes, not a second copy of it",
   /billing\.firstChargeSentence/.test(settings));
ok("…and a cancel button that needs no phone call",
   /billing\.canCancel/.test(settings) && /\/billing\/cancel/.test(settings));

console.log("\n— §4 · one price list, and the retired prices are gone —");
const { CLOSE_PLANS } = require("../closeLink");
const priceOf = id => CLOSE_PLANS.find(p => p.id === id).monthlyUsd;
ok("closeLink.js is the price list: Founding $199 / Core $249 / Team $499",
   priceOf("founding") === 199 && priceOf("core") === 249 && priceOf("team") === 499, CLOSE_PLANS);

const server = read("server.js");
const mrr = /const PLAN_MRR = \{([^}]*)\}/.exec(server)[1];
ok("the server's MRR table carries the same three numbers",
   /core: 249/.test(mrr) && /team: 499/.test(mrr) && /founding: 199/.test(mrr), mrr);
const cost = /const PLAN_MONTHLY_COST = \{([^}]*)\}/.exec(server)[1];
ok("…and so does the plan-cost table the ROI line quotes",
   /core: 249/.test(cost) && /team: 499/.test(cost) && /founding: 199/.test(cost), cost);

// The pricing page renders ${plan.price}, so the literal "$149" never appeared
// in its source even while the page showed it (BUILD-87's guard had that hole).
// Check the DATA, not the string.
const publicPlans = /const PUBLIC_PLANS = \[([\s\S]*?)\n\];/.exec(pricing)[1];
ok("the public pricing cards render 249 and 499, not 149 and 299",
   /price: 249/.test(publicPlans) && /price: 499/.test(publicPlans)
   && !/price: 149/.test(publicPlans) && !/price: 299/.test(publicPlans), publicPlans.match(/price: \d+/g));
const checkoutPlans = /export const CHECKOUT_PLANS = \[([\s\S]*?)\n\];/.exec(pricing)[1];
ok("…and the in-app checkout picker quotes the same two",
   /price: 249/.test(checkoutPlans) && /price: 499/.test(checkoutPlans)
   && !/price: 149/.test(checkoutPlans) && !/price: 299/.test(checkoutPlans), checkoutPlans.match(/price: \d+/g));

const provision = read("scripts/create-billing-products.js");
ok("the Stripe provisioning script would create those exact prices in cents",
   /amount: 24900/.test(provision) && /amount: 49900/.test(provision) && /amount: 19900/.test(provision),
   provision.match(/amount: \d+/g));

// $149 is dead everywhere, as BUILD-87 F.2 established. $299 joins it.
const retired = SURFACES.filter(f => /\$149|149\/month|\$299\b/.test(code(f)));
ok("no surface quotes a retired price ($149 or $299)", retired.length === 0, retired);

console.log("\n— §5 · the contract the code matches —");
const agreementPath = "claude/steward-customer-agreement.md";
ok("the customer agreement exists", fs.existsSync(path.join(root, agreementPath)));
const agreement = read(agreementPath);
ok("…its §2 is the money section", /## 2\. Price, the first charge, and cancellation/.test(agreement));
ok("…it names the same three prices", /\$199/.test(agreement) && /\$249/.test(agreement) && /\$499/.test(agreement));
ok("…it says thirty days after signing", /first charge is thirty days after signing/i.test(agreement));
ok("…it says nothing moves that date", /Nothing moves that date/i.test(agreement));
ok("…it says cancel before it and you pay nothing", /Cancel before it and you pay nothing/i.test(agreement));
ok("…and it does not name December 31", !/December 31/.test(agreement));

// ── §6 · THE RENDERED PAGE, IN A BROWSER ───────────────────────────────────
// A source grep is not the last word and BUILD-87's guard proved it: it banned
// the literal "$149" from Pricing.jsx and the page went on rendering $149,
// because the price is interpolated from `price: 149` and the string never
// appears in the file. So the numbers are checked where a visitor sees them.
const FRONT = process.env.FRONT || "http://localhost:4173";
(async () => {
  const distDir = path.join(root, "client/dist");
  if (!fs.existsSync(distDir)) {
    console.log("  skip  browser checks — client/dist absent (CI does not build it)");
  } else {
    let chromium;
    try { chromium = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright")).chromium; }
    catch { console.log("  skip  browser checks — playwright not available here"); chromium = null; }
    if (chromium) {
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      for (const [route, label] of [["/pricing", "pricing"], ["/terms", "terms"]]) {
        await page.goto(FRONT + route, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        const text = await page.evaluate(() => document.body.innerText);
        ok(`${label}: the rendered page never says "December 31"`, !/December 31/.test(text),
           (text.match(/.{40}December 31.{40}/) || [])[0]);
        ok(`${label}: …nor quotes a retired price`, !/\$149|\$299\b/.test(text),
           (text.match(/.{30}\$(149|299).{30}/) || [])[0]);
      }
      await page.goto(FRONT + "/pricing", { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const pricingText = await page.evaluate(() => document.body.innerText);
      ok("pricing: a visitor is told the rule in one line",
         /Nothing is charged for your first thirty days\./.test(pricingText),
         pricingText.slice(0, 300));
      ok("pricing: …beside the two real prices", /\$249/.test(pricingText) && /\$499/.test(pricingText),
         (pricingText.match(/\$\d+/g) || []).slice(0, 8));
      await page.close();
      await browser.close();
    }
  }
  console.log(`\none-date: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
