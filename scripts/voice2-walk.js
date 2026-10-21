// scripts/voice2-walk.js · VOICE-2. Tell Steward everywhere, at 1440 then 390, on the local stack.
//
// Headless Chromium has no speech recognition, so the walk puts a stand-in on
// the page: it "hears" a few words at a time and, like the real one, stops on
// its own every few phrases, so the page's restart and stitch are what get
// walked. A leg with no stand-in is Firefox: no listening, the text box, and
// the line that says so. Screenshots land in docs/voice-2/.
//   API=http://localhost:5781 APP=http://localhost:4193 DATABASE_URL=postgresql://steward@localhost:5544/steward_voice2 \
//     PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/voice2-walk.js
"use strict";
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa"), "node_modules", "playwright"));
const API = process.env.API || "http://localhost:5781";
const APP = process.env.APP || "http://localhost:4193";
const DB = process.env.DATABASE_URL || "";
const OUT = path.join(__dirname, "..", "docs", "voice-2");
// It files memos and a meeting and uploads a check, so it runs only against a local stack.
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || (DB && !/@(localhost|127\.0\.0\.1):/.test(DB)) || process.env.NODE_ENV === "production") {
  console.error("REFUSED: loopback only."); process.exit(1);
}
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };

const MEETING = ["Thanks for coming down to the boathouse, Margaret.", " The spring regatta is on April twelfth,", " and I will send you the details next Tuesday.",
  " You said you care most about the east side kids.", " Her mother had surgery last week.", " We should get you to the open day in March.",
  " I'd love to bring a friend to that.", " Wonderful, I will put you down for two."];
// Says one phrase every 300ms; after three phrases this session ends on its
// own (the real recognizer does after a silence or a minute), and the page
// must start a new one. The phrase index lives on window, across sessions.
const FAKE_SR = (phrases, perSession, interim = false) => `(() => {
  const words = ${JSON.stringify(phrases)};
  window.__srSessions = 0; window.__srI = 0;
  class SR { constructor() { this.t = []; this.res = []; }
    start() { window.__srSessions++; let n = 0; const tick = () => {
        if (window.__srI >= words.length || n >= ${perSession}) { this.t.push(setTimeout(() => this.onend && this.onend(), 50)); return; }
        const w = words[window.__srI++]; n++;
        this.res.push({ 0: { transcript: w }, isFinal: ${!interim}, length: 1 });
        this.onresult && this.onresult({ resultIndex: this.res.length - 1, results: this.res });
        this.t.push(setTimeout(tick, 300)); };
      this.t.push(setTimeout(tick, 300)); }
    stop() { this.t.forEach(clearTimeout); setTimeout(() => this.onend && this.onend(), 10); }
    abort() { this.stop(); } }
  window.webkitSpeechRecognition = SR; window.SpeechRecognition = SR;
})();`;

async function pg(sql, args) {
  if (!DB) return null;
  const { Client } = require("pg");
  const c = new Client({ connectionString: DB, ssl: false });
  await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}

(async () => {
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const H = { Authorization: "Bearer " + login.token, "Content-Type": "application/json" };
  const org = await fetch(API + "/org", { headers: H }).then(r => r.json());
  const browser = await chromium.launch();

  async function open(w, h, { speech = true, phrases = MEETING, perSession = 3, interim = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 500, isMobile: w < 500 });
    // Headless Chromium has a recognizer of its own (that never hears); the Firefox leg takes it away.
    await ctx.addInitScript(speech ? FAKE_SR(phrases, perSession, interim) : "(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {} window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; })();");
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/status of (404|500)/.test(m.text()) && !/\[SW\]|favicon|fonts/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("response", r => { if (r.status() >= 500 && !r.url().endsWith("/ai/stream")) errors.push(`${r.status()} ${r.url().replace(API, "")}`); });
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1000);
    const shot = name => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
    const tell = async () => { await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:tell", { detail: { donor: null } }))); await page.waitForSelector('[data-testid="tell-steward-sheet"]', { timeout: 5000 }); };
    return { ctx, page, errors, shot, tell };
  }

  for (const [w, h] of [[1440, 900], [390, 844]]) {
    console.log(`\n── ${w} ──`);
    // Part 1: a browser that can listen gets the microphone, on a computer too.
    let s = await open(w, h);
    await s.tell();
    ok(`${w} a browser with speech recognition gets the microphone`, await s.page.locator('[data-testid="tell-mic"]').isVisible(), null);
    await s.shot("01-listens");
    // Option B: the floating square mic, bottom right, at every width; the
    // big green Home button is gone and the rail (or the phone menu) keeps
    // its Tell Steward row.
    await s.page.click('[aria-label="Close"]').catch(() => {});
    await s.page.waitForSelector('[data-testid="tell-steward-sheet"]', { state: "detached", timeout: 4000 }).catch(() => {});
    const fab = s.page.locator('[data-testid="tell-fab"]');
    const box = await fab.boundingBox().catch(() => null);
    ok(`${w} the square mic floats at the bottom right`, !!box && Math.abs(box.width - box.height) < 1 && w - (box.x + box.width) <= 24 && box.y + box.height <= h && box.y > h - (w < 500 ? 160 : 100), box);
    ok(`${w} the big green Home button is gone`, await s.page.locator('[data-testid="tell-steward"], .home-tell').count() === 0, null);
    if (w > 500) ok(`${w} the rail keeps Tell Steward`, await s.page.locator('[data-testid="sidebar-tell-steward"]').isVisible(), null);
    await s.shot("11-mic-home");
    if (w < 500) {
      const bar = await s.page.locator(".mobile-bottom-bar").boundingBox();
      ok(`${w} the mic sits above the phone's tab bar`, !!bar && box.y + box.height <= bar.y, { box, bar });
    }
    await fab.click();
    await s.page.waitForSelector('[data-testid="tell-steward-sheet"]', { timeout: 5000 });
    ok(`${w} the mic opens Tell Steward, and hides while it is open`, await s.page.locator('[data-testid="tell-fab"]').count() === 0, null);
    await s.page.click('[aria-label="Close"]').catch(() => {});
    await s.page.goto(APP + "/app/calendar", { waitUntil: "domcontentloaded" });
    await s.page.waitForLoadState("networkidle").catch(() => {}); await s.page.waitForTimeout(800);
    const fab2 = await s.page.locator('[data-testid="tell-fab"]').boundingBox().catch(() => null);
    ok(`${w} the mic is on other screens too (Calendar)`, !!fab2, null);
    if (w < 500) {
      const add = await s.page.locator('[data-testid="cal-add"]').boundingBox().catch(() => null);
      ok(`${w} Calendar's + does not sit on the mic`, !!add && !!fab2 && add.y + add.height <= fab2.y, { add, fab2 });
    }
    await s.shot("12-mic-calendar");
    await s.page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await s.page.waitForLoadState("networkidle").catch(() => {}); await s.page.waitForTimeout(800);
    await s.tell();
    // Part 2: two shared names, picked by mouse (1440) or touch (390), then the keyboard.
    await s.page.fill('[data-testid="tell-text"]', "Lunch with Gideon and Nerissa, they loved the tour, send them the regatta date next week");
    await s.page.click('[data-testid="tell-send"]');
    await s.page.waitForSelector('[data-testid="tell-which"]', { timeout: 8000 });
    await s.shot("02-which");
    const firstSaid = await s.page.locator('[data-testid="tell-which"] p').innerText();
    const c1 = s.page.locator('[data-testid="tell-which-choice"]').first();
    if (w < 500) await c1.tap(); else await c1.click();
    await s.page.waitForTimeout(1500);
    const second = await s.page.locator('[data-testid="tell-which"] p').count() ? await s.page.locator('[data-testid="tell-which"] p').innerText() : "";
    ok(`${w} the first pick moves on to the other name`, !!second && second !== firstSaid, { firstSaid, second });
    const focused = await s.page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
    ok(`${w} the keyboard lands on the first choice`, focused === "tell-which-choice", focused);
    await s.page.keyboard.press("Enter");
    await s.page.waitForSelector('[data-testid="tell-results"]', { timeout: 10000 }).catch(() => {});
    ok(`${w} the second pick (keyboard) files the memo`, await s.page.locator('[data-testid="tell-results"]').isVisible(), null);
    await s.shot("03-which-filed");
    await s.page.click('[data-testid="tell-done"]');
    ok(`${w} no console errors so far`, s.errors.length === 0, s.errors);
    await s.ctx.close();

    // Part 2b: "Margaret" was still half-heard (not final) when she pressed
    // Send. Her click must answer the words that were asked about: it used to
    // re-send the box without them ("Tell Steward what happened first.").
    s = await open(w, h, { phrases: ["Lunch with Margaret about the boathouse"], perSession: 1, interim: true });
    await s.tell();
    await s.page.click('[data-testid="tell-mic"]');
    await s.page.waitForFunction(() => window.__srI >= 1, null, { timeout: 5000 });
    await s.page.waitForTimeout(200);
    await s.page.click('[data-testid="tell-send"]');
    await s.page.waitForSelector('[data-testid="tell-which"]', { timeout: 8000 });
    const half = s.page.locator('[data-testid="tell-which-choice"]').first();
    if (w < 500) await half.tap(); else await half.click();
    await s.page.waitForSelector('[data-testid="tell-results"]', { timeout: 10000 }).catch(() => {});
    const refused = await s.page.locator('[role="alert"]').count() ? await s.page.locator('[role="alert"]').innerText() : "";
    ok(`${w} a name still half-heard at Send: her pick files the memo`, await s.page.locator('[data-testid="tell-results"]').isVisible() && !refused, refused);
    await s.ctx.close();

    // Part 3: meeting mode.
    s = await open(w, h);
    await s.tell();
    await s.page.click('[data-testid="tell-meeting"]');
    await s.page.waitForSelector('[data-testid="meeting-mode"]');
    ok(`${w} the consent line is on screen before Start`, (await s.page.locator('[data-testid="meeting-consent"]').innerText()).includes("Let everyone know you're taking notes."), null);
    if (w > 500) ok(`${w} the screen says it hears the room, not the other side of a call`, (await s.page.locator('[data-testid="meeting-room-only"]').innerText()).includes("does not hear the other side"), null);
    await s.page.getByText("Pick the person").click();
    await s.page.fill('input[aria-label="Find the person"]', "Margaret Chen");
    await s.page.waitForSelector('[data-testid="tell-pick-choice"]', { timeout: 6000 });
    await s.page.locator('[data-testid="tell-pick-choice"]').first().click();
    await s.page.waitForSelector('[data-testid="meeting-brief"]', { timeout: 6000 }).catch(() => {});
    ok(`${w} the brief is there before going in`, await s.page.locator('[data-testid="meeting-brief"]').isVisible(), null);
    await s.page.fill('[data-testid="meeting-notes"]', "Ask about the east side kids");
    await s.shot("04-meeting-before");
    await s.page.click('[data-testid="meeting-start"]');
    await s.page.waitForSelector('[data-testid="meeting-bar"]');
    await s.page.waitForTimeout(1600);
    await s.shot("05-meeting-listening");
    await s.page.click('[data-testid="meeting-pause"]');
    await s.page.waitForTimeout(600);
    ok(`${w} Pause holds`, (await s.page.locator('[data-testid="meeting-bar"]').innerText()).includes("Paused"), null);
    await s.page.click('[data-testid="meeting-resume"]');
    await s.page.waitForFunction(() => window.__srI >= 8, null, { timeout: 15000 }).catch(() => {});
    await s.page.waitForTimeout(1200);
    const sessions = await s.page.evaluate(() => window.__srSessions);
    const heard = await s.page.locator('[data-testid="meeting-transcript"]').innerText();
    ok(`${w} the recognizer restarted (${sessions} sessions) and the transcript is whole`, sessions >= 3 && heard.includes("Thanks for coming down") && heard.includes("put you down for two"), { sessions, heard });
    // Ten minutes in.
    if (DB) await pg("UPDATE voice_meetings SET started_at = NOW() - interval '10 minutes' WHERE org_id='org_b72demo' AND status IN ('listening','paused')");
    await s.page.click('[data-testid="meeting-stop"]');
    await s.page.waitForSelector('[data-testid="tell-results"], [data-testid="tell-which"], [data-testid="tell-needs-people"]', { timeout: 15000 }).catch(() => {});
    ok(`${w} Stop files it`, await s.page.locator('[data-testid="tell-results"]').isVisible(), await s.page.locator('[data-testid="tell-steward-sheet"]').innerText().catch(() => ""));
    await s.page.waitForSelector('[data-testid="meeting-filed"]', { timeout: 6000 }).catch(() => {});
    const filed = await s.page.locator('[data-testid="meeting-filed"]').innerText().catch(() => "");
    ok(`${w} the summary shows, ten minutes, no surgery`, /about 10 minutes/i.test(filed) && !/surgery/i.test(filed), filed.slice(0, 300));
    await s.shot("06-meeting-filed");
    await s.page.click('[data-testid="meeting-show-transcript"]');
    const tx = await s.page.locator('[data-testid="meeting-transcript-text"]').innerText();
    ok(`${w} the saved transcript holds the personal detail back`, !/surgery/i.test(tx) && tx.includes("held back") && tx.includes("east side kids"), tx.slice(0, 200));
    await s.page.fill('[data-testid="meeting-ask"]', "What did I promise?");
    await s.page.locator('[data-testid="meeting-ask"]').press("Enter");
    await s.page.waitForSelector('[data-testid="meeting-answer"]', { timeout: 8000 }).catch(() => {});
    ok(`${w} one question about the meeting is answered from it`, await s.page.locator('[data-testid="meeting-answer"]').isVisible(), null);
    await s.page.locator('[data-testid="meeting-filed"]').scrollIntoViewIfNeeded();
    await s.shot("07-meeting-transcript-ask");
    const sheet = await s.page.locator('[data-testid="tell-results"]').innerText();
    ok(`${w} the personal detail waits as a card`, await s.page.locator('[data-testid="tell-card-sensitive"]').count() > 0, sheet.slice(0, 300));
    await s.page.locator('[data-testid="tell-results"]').scrollIntoViewIfNeeded();
    await s.shot("08-meeting-cards");
    await s.page.click('[data-testid="meeting-delete-transcript"]');
    await s.page.waitForSelector('[data-testid="meeting-transcript-deleted"]', { timeout: 5000 }).catch(() => {});
    ok(`${w} one click deletes the transcript`, await s.page.locator('[data-testid="meeting-transcript-deleted"]').isVisible(), null);
    ok(`${w} no console errors in the meeting`, s.errors.length === 0, s.errors);
    await s.ctx.close();

    // Firefox: nothing to listen with.
    s = await open(w, h, { speech: false });
    await s.tell();
    const noListen = await s.page.locator('[data-testid="tell-no-listen"]').innerText().catch(() => "");
    ok(`${w} without speech recognition: the text box and the line`, !(await s.page.locator('[data-testid="tell-mic"]').count()) &&
      noListen === (w < 500 ? "Use your keyboard's microphone to talk instead of typing." : "Your browser can't listen. Type it, or use your computer's dictation."), noListen);
    await s.shot("09-no-listen");
    await s.ctx.close();
  }

  // Part 4: a check made out to Captain Hook, read as $250.17.
  console.log("\n── the check ──");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const up = await fetch(API + "/capture/upload", { method: "POST", headers: H, body: JSON.stringify({ files: [{ name: "hook-check.png", dataUrl: png }], source: "photo" }) }).then(r => r.json());
  const card = up.cards && up.cards[0];
  ok("the check reads $250.17, settled", !!card && card.amount && card.amount.cents === 25017 && card.amount.settled === true, card && card.amount);
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const s = await open(w, h, { speech: false });
    // To confirm sits under Fundraising (the rail on a computer, More on a phone).
    await s.page.locator("button:visible, a:visible").filter({ hasText: /^Fundraising/ }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(800);
    await s.page.getByText(/^To confirm/).first().click().catch(() => {});
    await s.page.waitForLoadState("networkidle").catch(() => {}); await s.page.waitForTimeout(1200);
    const el = s.page.locator(`[data-card-id="${card && card.id}"]`);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const t = await el.innerText().catch(() => "");
    ok(`${w} the card says who the check is made out to`, t.includes("This check is made out to Captain Hook, not"), t.slice(0, 300));
    const confirm = el.getByRole("button", { name: /^(Confirm|Log it|Yes)/ }).first();
    ok(`${w} no one-tap confirm until Log it anyway`, await confirm.count() ? await confirm.isDisabled() : true, null);
    await s.page.screenshot({ path: path.join(OUT, `10-payee-${w}.png`) });
    await s.ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
