#!/usr/bin/env node
// QBO-IN, the walk. The stand-in QuickBooks company and fixture org from
// tests/qboin/standin.js (the ones the guard asserts on), driven through the
// screen at 1440 and 390: tick the donation account, read, review, pick the
// ambiguous donor, create the business, save, see the check on the donor's
// profile and in the thank-you queue, read again (nothing new), then undo.
// Screenshots to docs/qbo-in/. Loopback only.
//
//   BASE=http://localhost:6710 APP_URL=http://localhost:6714 BOOKKEEPING_MOCK_PORT=6715 \
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_qboin node scripts/qboin-walk.js
for (const [k, v] of [["BASE", process.env.BASE], ["APP_URL", process.env.APP_URL], ["DATABASE_URL", process.env.DATABASE_URL]]) {
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback (${v}).`); process.exit(2); }
}
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "qbo-in");
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
process.env.BASE = BASE;
const S = require("../tests/qboin/standin");
const { closeDb } = require("../tests/helpers");

let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log("  PASS  " + name); } else { fail++; console.log("  FAIL  " + name + (info ? " — " + JSON.stringify(info).slice(0, 300) : "")); } };

(async () => {
  const stub = await S.startStub();
  if (!stub) { console.error("the stand-in could not listen on", S.STUB_PORT); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();
  for (const [w, tag] of [[1440, "1440"], [390, "390"]]) {
    await S.reset();
    S.writes.length = 0;
    const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: S.ADMIN, password: "loadtest1234" }) });
    const auth = await r.json();
    if (!auth.token) { console.error("login failed"); process.exit(1); }
    const p = await browser.newPage({ viewport: { width: w, height: 1100 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const errors = [], bad = [];
    p.on("console", m => { if (m.type() === "error" && !/^\[SW\]|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    p.on("response", res => { if (res.status() >= 500 && !/\/ai\/stream/.test(res.url())) bad.push(res.status() + " " + res.url()); });
    await p.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    const shot = async name => p.screenshot({ path: path.join(OUT, `${name}-${tag}.png`), fullPage: true });
    const panel = async () => {
      await p.goto(`${APP}/app/settings?section=connections`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForSelector('[data-testid="conn-card"][data-key="quickbooks"]', { timeout: 30000 });
      await p.waitForTimeout(600);
      await p.locator('[data-testid="conn-card"][data-key="quickbooks"] [data-testid="conn-button"]').click();
      await p.waitForSelector('[data-testid="qbo-read"]', { timeout: 20000 });
      await p.waitForTimeout(800);
    };
    await panel();
    const read = p.locator('[data-testid="qbo-read"]');
    ok(`@${tag} with nothing ticked, the read is disabled and says so`,
      await p.locator('[data-testid="qbo-read-go"]').isDisabled() && /Steward reads nothing/.test(await read.innerText()));
    await p.locator('[data-testid="qbo-read-accounts"]').click();
    await p.waitForSelector('[data-testid="qbo-read-account"]', { timeout: 15000 });
    await p.locator('[data-testid="qbo-read-account"]', { hasText: "Contributed income" }).locator('input[type=checkbox]').check();
    await read.scrollIntoViewIfNeeded();
    await shot("1-donation-accounts");
    await p.locator('[data-testid="qbo-read-save-settings"]').click();
    await p.waitForSelector('[data-testid="qbo-read-msg"]', { timeout: 15000 });
    await p.locator('[data-testid="qbo-read-go"]').click();
    await p.waitForSelector('[data-testid="qbo-read-review"]', { timeout: 30000 });
    await p.waitForTimeout(500);
    const review = await p.locator('[data-testid="qbo-read-review"]').innerText();
    ok(`@${tag} the review shows four matched gifts, the ambiguous Sam and the new business`,
      (await p.locator('[data-testid="qbo-read-sample"]').count()) === 4 && /Sam Rivera/.test(review) && /Harbor Hardware/.test(review), review.slice(0, 400));
    ok(`@${tag} the review says what was left out in one line`, /1 transaction on other accounts was left out\./.test(review));
    ok(`@${tag} the skips are listed with their reasons`, /Steward sent this to QuickBooks itself/.test(review)
      && /payout from Stripe/i.test(review) && /already in Steward/i.test(review), review);
    await p.locator('[data-testid="qbo-read-review"]').scrollIntoViewIfNeeded();
    await shot("2-review");
    // A number on the review opens its lines.
    const giftFig = p.locator('[data-testid="qbo-read-count-gift"] button').first();
    if (await giftFig.count()) {
      await giftFig.click();
      await p.waitForTimeout(1200);
      await shot("3-number-opens");
      ok(`@${tag} the gift figure opens its lines`, /Ada Okafor/.test(await p.locator("body").innerText()));
      await p.keyboard.press("Escape");
      await p.waitForTimeout(400);
    } else ok(`@${tag} the gift figure opens its lines`, false, "no figure button");
    await p.locator('[data-testid="qbo-read-ambiguous"] select').selectOption("d_qi_sam2");
    await p.locator('[data-testid="qbo-read-unmatched"] input[type=checkbox]').check();
    await p.locator('[data-testid="qbo-read-save"]').click();
    await p.waitForSelector('[data-testid="qbo-read-undo"]', { timeout: 30000 });
    const msg = await p.locator('[data-testid="qbo-read-msg"]').innerText();
    ok(`@${tag} saving says six gifts and one organisation, and nothing sent to QuickBooks`,
      /6 gifts saved \(\$980\.00\)/.test(msg) && /1 person created/.test(msg) && /Nothing was sent to QuickBooks/.test(msg), msg);
    await shot("4-saved");
    // On Ada's profile.
    await p.goto(`${APP}/donors/d_qi_ada`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForTimeout(2500);
    const prof = await p.locator("body").innerText();
    ok(`@${tag} Ada's profile shows the $250 check`, /250/.test(prof) && /Ada Okafor/.test(prof));
    await shot("5-profile");
    // The thank-you queue on Home.
    await p.goto(`${APP}/app`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForTimeout(2500);
    const q = p.locator('[data-testid="thank-you-queue"]');
    const qText = (await q.count()) ? await q.innerText() : "";
    ok(`@${tag} the new check waits in the thank-you queue`, /Ada Okafor/.test(qText), qText.slice(0, 300));
    if (await q.count()) await q.scrollIntoViewIfNeeded();
    await shot("6-thank-you-queue");
    // Read again: nothing new.
    await panel();
    await p.locator('[data-testid="qbo-read-go"]').click();
    await p.waitForSelector('[data-testid="qbo-read-review"]', { timeout: 30000 });
    await p.waitForTimeout(500);
    ok(`@${tag} reading again finds nothing new`, (await p.locator('[data-testid="qbo-read-sample"]').count()) === 0
      && (await p.locator('[data-testid="qbo-read-count-already_read"]').count()) === 1);
    await p.locator('[data-testid="qbo-read-review"]').scrollIntoViewIfNeeded();
    await shot("7-read-again");
    // Undo the first read from the panel.
    await p.locator('[data-testid="qbo-read-run"] button', { hasText: "Undo" }).first().click();
    const yes = p.getByRole("button", { name: "Undo the read" });
    await yes.waitFor({ timeout: 10000 });
    await yes.click();
    await p.waitForTimeout(1500);
    const undone = await p.locator('[data-testid="qbo-read-msg"]').innerText().catch(() => "");
    ok(`@${tag} undo takes the whole read back`, /^Undone\. 6 gifts read from QuickBooks removed and 1 person this read created/.test(undone), undone);
    await shot("8-undone");
    ok(`@${tag} QuickBooks received no write`, S.writes.length === 0, S.writes);
    ok(`@${tag} no console errors`, errors.length === 0, errors);
    ok(`@${tag} no server errors`, bad.length === 0, bad);
    await p.close();
  }
  await browser.close();
  stub.close();
  await closeDb();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
