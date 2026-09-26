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
// "December 31, 2026" WAS deliberately left alive here. Three surfaces said it
// — the pricing page's free-through line, the Terms' Free Trial clause, and
// the trial-end email — and all three were ACCURATE, because the billing code
// really did grant free access through that date. Deleting the sentence
// without changing the code would have made the product's own Terms wrong
// about what it does; changing the code was money math, and money math is not
// a copy fix. So the survivors were pinned BY NAME, with the note that the
// list could shrink and could never grow.
//
// BUILD-90 did the money math. The rule is now thirty days from signing, the
// free-through code path is deleted, and the list has shrunk to ZERO — which
// is what §4 below now asserts. The string's own guard moved to
// tests/one-date.test.js, which owns the whole surface sweep; what stays here
// is the narrower promise this suite was always about: the door is closed and
// the price on it is real.
const fs = require("fs");
const path = require("path");
const { readSource } = require("../scripts/lib/readSource");
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
const server = readSource("server.js");
ok("…and neither does anything the server sends, nor any comment that would be copied from",
   (server.match(/\$149/g) || []).length === 0, (server.match(/.{60}\$149.{60}/g) || []).map(s => s.slice(0, 120)));

// ── §3 · the terms read where somebody accepts them ────────────────────────
const invite = fs.readFileSync(path.join(root, "client/src/pages/InvitePage.jsx"), "utf8");
ok("the accepted-invitation flow states the founding partner rate",
   /Founding partner rate \$199 a month/.test(invite));
// BUILD-90: thirty days from SIGNING, not from the file being in. A date a
// customer can move by doing ordinary work is not a date a contract can name.
ok("…and when billing starts", /The first charge is thirty days[\s\S]{0,30}after you sign\./.test(invite));
ok("…and that cancelling before then costs nothing",
   /Cancel any time before then and you pay nothing\./.test(invite));
// BUILD-90 replaced "No card required today". The card DOES go in, in the
// room, at signing — what makes that safe is the promise beside it, which is
// asserted above: cancel before the first charge and you pay nothing.
ok("…and it does not promise that no card is needed, because one is",
   !/No card required today/.test(invite));
ok("…with no em dash in it", !/Founding partner rate \$199 a month[^<]*—/.test(invite));
const invitation = fs.readFileSync(path.join(root, "client/src/pages/Invitation.jsx"), "utf8");
ok("the invitation request page quotes the founding rate, not a retired one",
   /\$199 a month/.test(invitation) && !/\$149/.test(invitation));
ok("sign-in's door is the invitation, not a self-serve signup",
   /to="\/invitation"[\s\S]{0,200}Request an invitation/.test(fs.readFileSync(path.join(root, "client/src/pages/LoginPage.jsx"), "utf8")));

// ── §4 · the December-31 survivors: there are none ─────────────────────────
// This list was three entries long and allowed to shrink only. BUILD-90 shrank
// it to nothing by changing the code it described. The comment stripper is not
// needed here: these are RENDERED pages, and a comment mentioning the retired
// promise on one of them would still be wrong.
const DEC31_ALLOWED = {};
const dec31 = [];
for (const rel of [...PUBLIC.map(p => "client/src/" + p), "server.js"]) {
  const src = readSource(path.join(root, rel));
  if (/December 31, 2026/.test(src)) dec31.push(rel);
}
ok("no surface says \"December 31, 2026\" any more — the survivors list is empty",
   dec31.length === 0, dec31);
ok("…and the allowlist that held them is empty too", Object.keys(DEC31_ALLOWED).length === 0);

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
