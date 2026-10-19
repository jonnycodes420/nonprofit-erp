// scripts/voice1-walk.js · VOICE-1. Tap to done, at 390 then 1440, on the local stack.
//
// The phone leg puts a stand-in for the browser's speech recognition on the
// page (headless Chromium has none): it "hears" the memo a few words at a
// time, so the live transcript is what a person would see. The laptop leg
// types. Screenshots land in docs/voice-1/.
//   API=http://localhost:5761 APP=http://localhost:4183 PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/voice1-walk.js
"use strict";
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa"), "node_modules", "playwright"));
const API = process.env.API || "http://localhost:5761";
const APP = process.env.APP || "http://localhost:4183";
const OUT = path.join(__dirname, "..", "docs", "voice-1");
// It files memos, says yes to a card and undoes, so it runs only against a local stack.
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || process.env.NODE_ENV === "production") { console.error("REFUSED: loopback only."); process.exit(1); }
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };

const SPOKEN = ["Lunch with Margaret Chen,", " loved the tour of the second training boat,", " wants to give to the new boat,",
  " thinking about $5,000 for the boat.", " Her mother is in the hospital.", " Circle back in March."];
const FAKE_SR = `(() => {
  const words = ${JSON.stringify(SPOKEN)};
  class SR { constructor() { this.onresult = null; this.onend = null; this.onerror = null; this.t = []; }
    start() { let i = 0; const tick = () => { if (i >= words.length) return; const w = words[i++];
        const res = [{ 0: { transcript: w }, isFinal: true, length: 1 }]; this.onresult && this.onresult({ resultIndex: 0, results: res });
        this.t.push(setTimeout(tick, 250)); };
      this.t.push(setTimeout(tick, 250)); }
    stop() { this.t.forEach(clearTimeout); setTimeout(() => this.onend && this.onend(), 10); }
    abort() { this.stop(); } }
  window.webkitSpeechRecognition = SR; window.SpeechRecognition = SR;
})();`;

(async () => {
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const org = await fetch(API + "/org", { headers: { Authorization: "Bearer " + login.token } }).then(r => r.json());
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 844], [1440, 980]]) {
    console.log(`\n── ${w} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 500, isMobile: w < 500 });
    if (w < 500) await ctx.addInitScript(FAKE_SR);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/status of 500/.test(m.text()) && !/favicon|fonts\.googleapis|_vercel/.test(m.location()?.url || "") && !/\[SW\]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    // The local stand-in model does not stream, so /ai/stream (the profile's own AI panel) 500s here and nowhere else.
    page.on("response", r => { if (r.status() >= 500 && !r.url().endsWith("/ai/stream")) errors.push(`${r.status()} ${r.url().replace(API, "")}`); });
    const failed = [];
    page.on("requestfailed", r => failed.push(`${r.failure() && r.failure().errorText} ${r.url().replace(API, "")}`));
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const shot = name => page.screenshot({ path: path.join(OUT, `${String(name)}-${w}.png`) });
    const settle = (ms = 700) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" }); await settle(1500);
    ok("Home shows Tell Steward", await page.locator('[data-testid="tell-steward"]').isVisible(), null);
    await shot("01-home");
    await page.click('[data-testid="tell-steward"]'); await settle(500);
    ok("the sheet opens", await page.locator('[data-testid="tell-steward-sheet"]').isVisible(), null);
    if (w < 500) {
      ok("a phone with speech gets the microphone", await page.locator('[data-testid="tell-mic"]').isVisible(), null);
      await shot("02-sheet");
      await page.locator('[data-testid="tell-mic"]').tap(); await page.waitForTimeout(900);
      await shot("03-listening");
      await page.waitForTimeout(1300);
      await page.getByRole("button", { name: "Stop", exact: true }).click(); await page.waitForTimeout(300);
      const heard = await page.locator('[data-testid="tell-text"]').inputValue();
      ok("the live transcript is in the box, editable", /Margaret Chen/.test(heard) && /March/.test(heard), heard);
      await page.locator('[data-testid="tell-text"]').fill(heard.replace("the new boat", "the new boat"));
      await shot("04-heard");
    } else {
      ok("a laptop gets the text box", await page.locator('[data-testid="tell-text"]').isVisible() && !(await page.locator('[data-testid="tell-mic"]').count()), null);
      await page.locator('[data-testid="tell-text"]').fill(SPOKEN.join(""));
      await shot("02-typed");
    }
    await page.click('[data-testid="tell-send"]');
    await page.waitForSelector('[data-testid="tell-results"]', { timeout: 15000 }).catch(() => {});
    await settle(600);
    const results = await page.locator('[data-testid="tell-results"]').innerText().catch(() => "");
    ok("results: the lunch, the Thread step and the interest are done", /Lunch logged on Margaret Chen/.test(results) && /on the Thread for Mar/.test(results) && /Harbor Skills Boat/.test(results), results.slice(0, 400));
    ok("results: the email, the $5,000 and the personal detail wait for a yes", await page.locator('[data-testid="tell-card-draft"]').count() === 1
      && await page.locator('[data-testid="tell-card-money"]').count() === 1 && await page.locator('[data-testid="tell-card-sensitive"]').count() === 1, results.slice(0, 600));
    ok("the hospital sentence is not in the done list", !/hospital/i.test(results.split(/waiting for your yes/i)[0]), null);
    await shot("05-results");
    await page.locator('[data-testid="tell-card-money"] button', { hasText: "Yes" }).click(); await settle(500);
    await shot("06-money-yes");
    await page.locator('[data-testid="tell-card-sensitive"] button', { hasText: "Discard" }).click(); await settle(500);
    await page.locator('[data-testid="tell-results"]').evaluate(el => el.scrollIntoView({ block: "end" })).catch(() => {});
    await shot("07-decided");
    if (w >= 500) {
      await page.click('[data-testid="tell-undo"]'); await settle(700);
      const after = await page.locator('[data-testid="tell-results"]').innerText().catch(() => "");
      ok("Undo takes it all back and says the amount she confirmed stays", /Undone/.test(after) && /stays on the record/.test(after), after.slice(0, 300));
      await shot("08-undone");
    }
    await page.click('[data-testid="tell-done"]'); await settle(500);
    // The profile: the button, and the memo's conversation on the timeline.
    const [m] = await fetch(API + "/donors?search=Margaret%20Chen&limit=5", { headers: { Authorization: "Bearer " + login.token } }).then(r => r.json()).then(j => (j.donors || j.rows || j)).catch(() => []);
    const mid = m && m.id;
    if (mid) {
      await page.goto(APP + `/donors/${mid}`, { waitUntil: "domcontentloaded" }); await settle(1500);
      ok("the profile has Tell Steward", await page.locator('[data-testid="dp-tell-steward"]').isVisible(), null);
      await shot("09-profile");
      await page.click('[data-testid="dp-tell-steward"]'); await settle(500);
      const sub = await page.locator('[data-testid="tell-steward-sheet"]').locator("xpath=ancestor::*[@role='dialog']").innerText().catch(() => "");
      ok("from the profile the memo is about her, with her recent memos", /What happened with Margaret Chen/.test(sub) && /recent memos/i.test(sub), sub.slice(0, 300));
      await shot("10-profile-sheet");
      await page.keyboard.press("Escape");
    }
    if (w < 500) {
      await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" }); await settle(1000);
      const more = page.locator(".mobile-bottom-bar button").filter({ hasText: "More" }).first();
      if (await more.count()) { await more.click(); await settle(400); ok("the phone menu has Tell Steward", await page.locator('[data-testid="mobile-tell-steward"]').isVisible(), null); await shot("11-menu"); }
    }
    ok(`no console errors or 5xx at ${w}`, errors.length === 0, { errors, failed });
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
