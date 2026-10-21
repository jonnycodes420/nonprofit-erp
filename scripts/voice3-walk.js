// scripts/voice3-walk.js · VOICE-3. Talk to Steward, at 1440 then 390, on the local stack.
//
// One mic, three kinds of talk: what happened (filed), something to do (the
// Agent's plan, waiting for Confirm), a question (Ask's answer), a memo that
// mixes them, and the "log this, or have Steward do it?" question. Then the
// "Before your meeting" card on the profile and on the calendar, for a lunch
// tomorrow. The model is a stand-in this script serves itself on STANDIN
// (boot the server with ANTHROPIC_BASE_URL pointing at it). Screenshots land
// in docs/voice-3/.
//   API=http://localhost:5861 APP=http://localhost:4271 STANDIN=5862 \
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_voice3 PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/voice3-walk.js
"use strict";
const path = require("path");
const http = require("http");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa"), "node_modules", "playwright"));
const API = process.env.API || "http://localhost:5861";
const APP = process.env.APP || "http://localhost:4271";
const STANDIN = Number(process.env.STANDIN || 5862);
const DB = process.env.DATABASE_URL || "";
const OUT = path.join(__dirname, "..", "docs", "voice-3");
// It files memos and plans on the scratch demo org, so it runs only against a local stack.
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || !/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(DB)
    || process.env.NODE_ENV === "production") { console.error("REFUSED: loopback only."); process.exit(1); }
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
const NAMES = ["Margaret Chen", "Margaret", "Tobias", "Halvorsen", "Rosa"];
function memoRead(user) {
  const said = (/"""\n?([\s\S]*?)\n?"""/.exec(user) || /memo[^:]*:\s*([^\n]+)/i.exec(user) || [])[1] || "";
  const first = said.split(/(?<=[.!?])\s+/)[0] || said;
  return { how: /coffee/i.test(said) ? "coffee" : /lunch/i.test(said) ? "lunch" : "", when: "", summary: first, people: NAMES.filter(n => said.includes(n)).slice(0, 1),
    follow_ups: [], interests: [], email: { subject: "", body: "" }, money: [], contact: [], sensitive: [] };
}
function planFor(user) {
  const said = (/Her instruction, verbatim: "([^"]*)"/.exec(user) || [])[1] || "";
  const people = [];
  for (const line of user.split("\n")) { const m = /^ {2}(\S+) \| ([^|]+) \|/.exec(line); if (m) people.push({ id: m[1], name: m[2].trim() }); }
  const base = { subject: null, body: null, note: null, stage: null, tag: null, label: null, due: null, dueDays: 3, priority: "medium", grantId: "", purpose: "" };
  return { steps: people.slice(0, 1).map(p => ({ ...base, tool: "create_task", donorId: p.id, citesRows: [p.id], title: said.replace(/^Remind me to /i, "").replace(/\.$/, "") })),
    sends: 0, headline: said.replace(/\.$/, ""), cannot: "" };
}
const standin = http.createServer((req, res) => {
  let body = ""; req.on("data", d => { body += d; });
  req.on("end", () => {
    let j = {}; try { j = JSON.parse(body); } catch { /* empty */ }
    const name = j.tools && j.tools[0] && j.tools[0].name;
    const user = (j.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    const input = name === "plan" ? planFor(user) : name === "memo_actions" ? memoRead(user) : name === "talk_intent" ? { happened: "", to_do: "", question: "" } : {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "msg_walk", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
      content: name ? [{ type: "tool_use", id: "tu", name, input }] : [{ type: "text", text: "" }] }));
  });
});

(async () => {
  await new Promise(r => standin.listen(STANDIN, r));
  const { Client } = require("pg");
  const pg = new Client({ connectionString: DB }); await pg.connect();
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const org = await fetch(API + "/org", { headers: { Authorization: "Bearer " + login.token } }).then(r => r.json());
  const [mc] = (await pg.query("SELECT id FROM donors WHERE org_id='org_b72demo' AND name='Margaret Chen' AND deleted_at IS NULL LIMIT 1")).rows;
  const [me] = (await pg.query("SELECT id FROM users WHERE email='director@harborlight.demo'")).rows;
  // A lunch with Margaret tomorrow at noon, on the director's calendar. The
  // demo's own 10 AM coffee comes first, so the card is for the coffee.
  await pg.query("DELETE FROM calendar_events WHERE id='ce_v3walk'");
  await pg.query(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by,created_by_name)
    VALUES ('ce_v3walk','org_b72demo',$1,'steward','ce_v3walk','Lunch',
      ((((NOW() AT TIME ZONE 'America/New_York')::date + 1) + time '12:00') AT TIME ZONE 'America/New_York'),
      ((((NOW() AT TIME ZONE 'America/New_York')::date + 1) + time '13:00') AT TIME ZONE 'America/New_York'),
      'The Boathouse',ARRAY[$2],$1,'walk')`, [me.id, mc.id]);

  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`\n── ${w} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 500, isMobile: w < 500 });
    // A browser with no speech recognition types (headless Chromium's own never hears).
    await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    const page = await ctx.newPage();
    const errors = [];
    // The stand-in model does not stream, so the profile's own AI panel (/ai/stream) 500s here and nowhere else; responses are checked below.
    page.on("console", m => { if (m.type() === "error" && !/status of 500/.test(m.text()) && !/favicon|fonts\.googleapis|_vercel/.test(m.location()?.url || "") && !/\[SW\]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("response", r => { if (r.status() >= 500 && !r.url().endsWith("/ai/stream")) errors.push(`${r.status()} ${r.url().replace(API, "")}`); });
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const shot = name => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
    const settle = (ms = 700) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" }); await settle(1500);
    const say = async (words) => {
      if (!(await page.locator('[data-testid="tell-steward-sheet"]').count())) { await page.click('[data-testid="tell-fab"]'); await settle(400); }
      else if (await page.getByRole("button", { name: "Tell another" }).count()) { await page.getByRole("button", { name: "Tell another" }).first().click(); await settle(300); }
      await page.locator('[data-testid="tell-text"]').fill(words);
      await page.click('[data-testid="tell-send"]');
      await page.waitForSelector('[data-testid="tell-results"], [data-testid="tell-plan"], [data-testid="tell-answer"], [data-testid="tell-unsure"], [data-testid="tell-plan-none"], [data-testid="tell-which"]', { timeout: 20000 }).catch(() => {});
      await settle(700);
      return page.locator('[data-testid="tell-steward-sheet"]').innerText().catch(() => "");
    };
    const close = async () => { await page.keyboard.press("Escape"); await settle(300); };

    await page.click('[data-testid="tell-fab"]'); await settle(400);
    const sheet = await page.locator('[data-testid="tell-steward-sheet"]').innerText();
    ok("the window has no meeting button", !/Listen to this meeting/.test(sheet), sheet.slice(0, 200));
    await shot("01-tell");

    const t1 = await say("Lunch with Margaret Chen, she loved the boathouse tour, circle back in March");
    ok("what happened is filed", /Done for you/i.test(t1) && /Margaret Chen/.test(t1), t1.slice(0, 300));
    await shot("02-log");

    let t2 = await say("Remind me to call Tobias Friday");
    // The demo has more than one Tobias: Steward asks which, and the plan is made on the one she picks.
    if (await page.locator('[data-testid="tell-which-choice"]').count()) {
      await shot("03a-do-which");
      const pick = page.locator('[data-testid="tell-which-choice"]', { hasText: "Fairweather" });
      await ((await pick.count()) ? pick.first() : page.locator('[data-testid="tell-which-choice"]').first()).click();
      await page.waitForSelector('[data-testid="tell-plan-confirm"]', { timeout: 20000 }).catch(() => {}); await settle(500);
      t2 = await page.locator('[data-testid="tell-steward-sheet"]').innerText().catch(() => "");
    }
    ok("something to do is a plan waiting for Confirm", await page.locator('[data-testid="tell-plan-confirm"]').count() === 1, t2.slice(0, 300));
    await shot("03-do-plan");
    await page.click('[data-testid="tell-plan-confirm"]'); await settle(800);
    ok("Confirm runs it", await page.locator('[data-testid="tell-plan-done"]').count() === 1, await page.locator('[data-testid="tell-plan"]').innerText().catch(() => ""));
    await shot("04-do-confirmed");

    const t3 = await say("Who should I call tomorrow?");
    ok("a question is answered by Ask", await page.locator('[data-testid="tell-answer"]').count() === 1, t3.slice(0, 300));
    await shot("05-ask");

    const t4 = await say("Coffee with Margaret Chen went great, remind me to send her the boat photos Friday");
    ok("a mixed memo files the coffee and plans the reminder", /Done for you/i.test(t4) && await page.locator('[data-testid="tell-plan-confirm"]').count() === 1 && /Margaret Chen the boat photos/i.test(t4), t4.slice(0, 400));
    await shot("06-mixed");

    const t5 = await say("Margaret boat photos Friday");
    ok("unsure: Steward asks log or do", /Did you mean to log this, or have Steward do it\?/.test(t5), t5.slice(0, 200));
    await shot("07-unsure");
    await close();

    await page.goto(`${APP}/donors/${encodeURIComponent(mc.id)}`, { waitUntil: "domcontentloaded" }); await settle(2000);
    const card = page.locator('[data-testid="before-meeting"]').first();
    await card.scrollIntoViewIfNeeded().catch(() => {});
    ok("the profile shows Before your meeting for tomorrow's lunch", await card.isVisible().catch(() => false), null);
    await settle(300);
    await shot("08-profile-before");

    await page.goto(`${APP}/app/calendar`, { waitUntil: "domcontentloaded" }); await settle(1800);
    if (w < 500) {   // the phone's agenda shows one day: tap tomorrow's chip
      const dom = String(new Date(new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getTime() + 864e5).getDate());
      await page.locator("button", { hasText: new RegExp(`^\\s*\\w{3}\\s*${dom}\\s*$`) }).first().click().catch(() => {}); await settle(800);
    }
    // The demo's own coffee with Margaret tomorrow (scripts/seed-demo.js), and the walk's lunch after it.
    const block = page.locator('text=/Coffee at Magee/').first();
    if (await block.count()) { await block.click().catch(() => {}); await settle(800); }
    ok("the calendar's lunch shows Before your meeting", await page.locator('[data-testid="cal-card"] [data-testid="before-meeting"]').isVisible().catch(() => false), null);
    await shot("09-calendar-before");
    ok("no console errors and no 5xx", errors.length === 0, errors);
    await ctx.close();
  }
  await browser.close();
  await pg.query("DELETE FROM calendar_events WHERE id='ce_v3walk'");
  await pg.end();
  standin.close();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); standin.close(); process.exit(1); });
