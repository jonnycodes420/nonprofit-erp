// BUILD-87 F.2 — THE PUBLIC SIGNUP IS CLOSED, AND THE PRICE IS REAL.
// Run: node tests/invitation-only.test.js   (needs client/dist + the preview)
//
// /signup was publicly reachable and still sold "Free through December 31,
// 2026, then $149/month". Neither has been true since August: pricing is Core
// $249, Team $499, founding partner $199, billing thirty days after the file is
// in — and BUILD-39 made Steward invitation-only, so a self-serve signup form
// contradicted the product it signed you up for.
//
// WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
//
// `$149` is asserted GONE from every rendered public surface: that price does
// not exist any more, anywhere, in any plan.
//
// "December 31, 2026" is NOT asserted gone, and that is a deliberate call, not
// an oversight. Three surfaces still say it — the pricing page's free-through
// line, the Terms' Free Trial clause, and the trial-end email — and all three
// are ACCURATE, because the billing code still grants free access through that
// date (server.js, the BUILD-50 item-1 promise). Deleting the sentence without
// changing the code would make the product's own Terms wrong about what it
// does; changing the code is money math, and money math is not a copy fix.
// So the survivors are pinned BY NAME below: they cannot grow, they cannot be
// silently lost, and the decision is written down where the next build reads.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const FRONT = process.env.FRONT || "http://localhost:4173";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 400) : "")); }
};

// ── §1 · the router decision, in the source ────────────────────────────────
const main = fs.readFileSync(path.join(root, "client/src/main.jsx"), "utf8");
ok("/signup resolves to /invitation — the decision is a REDIRECT, and it is asserted",
   /<Route path="\/signup"\s+element=\{<Navigate to="\/invitation" replace \/>\}/.test(main));
ok("the public signup page is DELETED, not merely unrouted",
   !fs.existsSync(path.join(root, "client/src/pages/SignupPage.jsx")));
ok("nothing imports it any more", !/SignupPage/.test(main));

// ── §2 · $149 is gone from the source of every public surface ──────────────
const PUBLIC = ["pages/Landing.jsx", "pages/Invitation.jsx", "pages/InvitePage.jsx",
                "pages/LoginPage.jsx", "pages/Pricing.jsx", "pages/TermsPage.jsx", "pages/PrivacyPage.jsx"]
  .filter(p => fs.existsSync(path.join(root, "client/src", p)));
const priced = PUBLIC.filter(p => /\$149|149\/month/.test(fs.readFileSync(path.join(root, "client/src", p), "utf8")));
ok("no public page quotes $149 — the price does not exist", priced.length === 0, priced);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
ok("…and neither does anything the server sends, nor any comment that would be copied from",
   (server.match(/\$149/g) || []).length === 0, (server.match(/.{60}\$149.{60}/g) || []).map(s => s.slice(0, 120)));

// ── §3 · the terms read where somebody accepts them ────────────────────────
const invite = fs.readFileSync(path.join(root, "client/src/pages/InvitePage.jsx"), "utf8");
ok("the accepted-invitation flow states the founding partner rate",
   /Founding partner rate \$199 a month/.test(invite));
ok("…and when billing starts", /Billing begins thirty days after[\s\S]{0,40}your donor file is in/.test(invite));
ok("…and that no card is needed today", /No card required today/.test(invite));
ok("…with no em dash in it", !/Founding partner rate \$199 a month[^<]*—/.test(invite));
const invitation = fs.readFileSync(path.join(root, "client/src/pages/Invitation.jsx"), "utf8");
ok("the invitation request page quotes the founding rate, not a retired one",
   /\$199 a month/.test(invitation) && !/\$149/.test(invitation));
ok("sign-in's door is the invitation, not a self-serve signup",
   /to="\/invitation"[\s\S]{0,200}Request an invitation/.test(fs.readFileSync(path.join(root, "client/src/pages/LoginPage.jsx"), "utf8")));

// ── §4 · the December-31 survivors, pinned by name ─────────────────────────
// Each of these is TRUE while the billing code honours the date. The list may
// SHRINK (when the code changes, the copy follows) and may never grow.
const DEC31_ALLOWED = {
  "client/src/pages/Pricing.jsx": "the free-through line beside the real $249/$499 plans — matches the billing code",
  "client/src/pages/TermsPage.jsx": "the Free Trial clause — a legal document describing what the code actually does",
  "server.js": "the BUILD-50 item-1 promise the billing path honours, plus the trial-end email that states it (its PRICE was corrected to $249; only the date survives)",
};
const dec31 = [];
for (const rel of [...PUBLIC.map(p => "client/src/" + p), "server.js"]) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  if (/December 31, 2026/.test(src)) dec31.push(rel);
}
ok("every surface still saying \"December 31, 2026\" is one the billing code makes true",
   dec31.every(r => DEC31_ALLOWED[r]), dec31.filter(r => !DEC31_ALLOWED[r]));
ok("…and the list has not grown", dec31.length <= Object.keys(DEC31_ALLOWED).length, dec31);

// ── §5 · the rendered pages, in a browser ──────────────────────────────────
// F.2 is a UI fix, so the last word is what a visitor actually gets.
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
      for (const [w, h, label] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto(FRONT + "/signup", { waitUntil: "networkidle" });
        await page.waitForTimeout(900);
        ok(`${label}: visiting /signup lands on /invitation`, new URL(page.url()).pathname === "/invitation", page.url());
        const text = await page.evaluate(() => document.body.innerText);
        ok(`${label}: the invitation page renders and does not quote $149`,
           /invitation/i.test(text) && !/\$149/.test(text), text.slice(0, 160));
        ok(`${label}: …and it states the founding partner rate`, /\$199 a month/.test(text), text.slice(0, 200));
        // Layout: the card is inside the viewport and the page never scrolls sideways.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        ok(`${label}: the invitation page never scrolls sideways`, overflow <= 1, overflow);
        await page.close();
      }
      await browser.close();
    }
  }
  console.log(`\ninvitation-only: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
