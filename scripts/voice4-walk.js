// scripts/voice4-walk.js · VOICE-4. Margaret Chen (Harborlight), at 1440 then 390, on the local stack.
//
// Jonathan's memo from prod, 21 Oct: "Lunch with Margaret went well, she gave
// $5000, log that, then send her the receipt", with her 10 AM coffee today and
// Sep 19's "Coffee tomorrow. Bring Lily's class schedule." open on her Thread.
// Before: the profile, the memo, Yes on the gift, and the profile again with
// no reload. After (MODE=after, this branch) adds "Put her in the Major donor
// journey", a journey name that is not one, and "Mark her as do not email".
// Each width puts Margaret back as she was (the memo's Undo, then the rows the
// walk touched) so 390 starts where 1440 did. The model is a stand-in this
// script serves itself on STANDIN (boot the server with ANTHROPIC_BASE_URL
// pointing at it). Screenshots land in docs/voice-4/<mode>-*.png.
//   MODE=after API=http://localhost:5871 APP=http://localhost:4281 STANDIN=5872 \
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_voice4 PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/voice4-walk.js
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa"), "node_modules", "playwright"));
const API = process.env.API || "http://localhost:5871";
const APP = process.env.APP || "http://localhost:4281";
const STANDIN = Number(process.env.STANDIN || 5872);
const DB = process.env.DATABASE_URL || "";
const MODE = process.env.MODE === "before" ? "before" : "after";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", "voice-4");
// It files memos and gifts on the scratch demo org, so it runs only against a local stack.
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || !/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(DB)
    || process.env.NODE_ENV === "production") { console.error("REFUSED: loopback only."); process.exit(1); }
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
function memoRead(user) {
  const said = (/"""\n?([\s\S]*?)\n?"""/.exec(user) || /memo[^:]*:\s*([^\n]+)/i.exec(user) || [])[1] || "";
  const gift = /gave \$?(\d[\d,]*)/i.exec(user);
  return { how: /coffee/i.test(said || user) ? "coffee" : /lunch/i.test(said || user) ? "lunch" : "", when: "", summary: "Lunch with Margaret went well.", people: ["Margaret Chen"],
    follow_ups: [{ label: "Log the gift", when: "", quote: "log that" }, ...(/receipt/i.test(user) ? [{ label: "Send Margaret the receipt", when: "", quote: "send her the receipt" }] : [])],
    interests: [], email: { subject: "", body: "" }, money: gift ? [{ kind: "gift", fund_words: "", quote: gift[0] }] : [], contact: [], sensitive: [] };
}
function planFor(user) {
  const said = (/Her instruction, verbatim: "([^"]*)"/.exec(user) || [])[1] || "";
  const people = [];
  for (const line of user.split("\n")) { const m = /^ {2}(d_\S+) \| ([^|]+) \|/.exec(line); if (m) people.push({ id: m[1], name: m[2].trim() }); }
  const journeys = [];
  for (const line of (user.split("JOURNEYS (journeyId):")[1] || "").split("\n").slice(1)) { const m = /^ {2}(\S+) \| (.+)$/.exec(line); if (!m) break; journeys.push({ id: m[1], name: m[2].trim() }); }
  const jy = journeys.find(x => said.toLowerCase().includes(x.name.toLowerCase()));
  const base = { subject: null, body: null, note: null, stage: null, tag: null, label: null, due: null, dueDays: 3, priority: "medium", grantId: "", purpose: "" };
  return { steps: people.slice(0, 1).map(p => (jy ? { ...base, tool: "start_journey", donorId: p.id, citesRows: [p.id], journeyId: jy.id }
    : { ...base, tool: "create_task", donorId: p.id, citesRows: [p.id], title: said.replace(/\.$/, "") })), sends: 0, headline: said.replace(/\.$/, ""), cannot: "" };
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
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => standin.listen(STANDIN, r));
  const { Client } = require("pg");
  const pg = new Client({ connectionString: DB }); await pg.connect();
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const H = { Authorization: "Bearer " + login.token, "Content-Type": "application/json" };
  const org = await fetch(API + "/org", { headers: H }).then(r => r.json());
  const [mc] = (await pg.query("SELECT id FROM donors WHERE org_id='org_b72demo' AND name='Margaret Chen' AND deleted_at IS NULL LIMIT 1")).rows;
  // As on prod on 21 Oct: the coffee is today at 10, and Sep 19's step is due today.
  await pg.query(`UPDATE calendar_events SET starts_at = (((NOW() AT TIME ZONE 'America/New_York')::date + time '10:00') AT TIME ZONE 'America/New_York'),
    ends_at = (((NOW() AT TIME ZONE 'America/New_York')::date + time '11:00') AT TIME ZONE 'America/New_York'), logged_at=NULL, interaction_id=NULL
    WHERE id='cal_b72_mc_coffee'`);
  await pg.query(`UPDATE threads SET due_date = ((NOW() AT TIME ZONE 'America/New_York')::date)::text WHERE org_id='org_b72demo' AND donor_id=$1 AND closed_at IS NULL`, [mc.id]);
  await pg.query(`UPDATE tasks SET due = ((NOW() AT TIME ZONE 'America/New_York')::date)::text WHERE org_id='org_b72demo' AND donor_id=$1 AND link_kind='next_step' AND done=0`, [mc.id]);
  const snap = {
    threads: (await pg.query("SELECT * FROM threads WHERE org_id='org_b72demo' AND donor_id=$1", [mc.id])).rows,
    tasks: (await pg.query("SELECT id, title, notes, done, completed_at, completed_by_name, edited_at, edited_by, edited_by_name, source_gift_id FROM tasks WHERE org_id='org_b72demo' AND donor_id=$1", [mc.id])).rows,
    plans: (await pg.query("SELECT id FROM cultivation_plans WHERE org_id='org_b72demo' AND donor_id=$1", [mc.id])).rows.map(r => r.id),
    dne: (await pg.query("SELECT do_not_email FROM donors WHERE id=$1", [mc.id])).rows[0].do_not_email,
  };
  // Put Margaret back as she was: the memos' own Undo first, then what is left.
  const restore = async since => {
    for (const m of (await pg.query("SELECT id FROM voice_memos WHERE org_id='org_b72demo' AND created_at >= $1 AND undone_at IS NULL", [since])).rows)
      await fetch(`${API}/voice/memos/${m.id}/undo`, { method: "POST", headers: H, body: "{}" });
    for (const g of (await pg.query("SELECT id FROM gifts WHERE org_id='org_b72demo' AND donor_id=$1 AND created_at >= $2", [mc.id, since])).rows)
      await fetch(`${API}/gifts/${g.id}`, { method: "DELETE", headers: H });
    await pg.query("DELETE FROM tasks WHERE org_id='org_b72demo' AND donor_id=$1 AND created_at >= $2", [mc.id, since]);
    await pg.query("DELETE FROM cultivation_plans WHERE org_id='org_b72demo' AND donor_id=$1 AND NOT (id = ANY($2::text[]))", [mc.id, snap.plans]);
    await pg.query("DELETE FROM threads WHERE org_id='org_b72demo' AND donor_id=$1 AND NOT (id = ANY($2::text[]))", [mc.id, snap.threads.map(t => t.id)]);
    for (const t of snap.threads) await pg.query("UPDATE threads SET next_step_label=$2, due_date=$3, closed_at=$4, close_kind=$5, closing_interaction_id=$6, edited_at=$7, edited_by_name=$8 WHERE id=$1",
      [t.id, t.next_step_label, t.due_date, t.closed_at, t.close_kind, t.closing_interaction_id, t.edited_at, t.edited_by_name]);
    for (const t of snap.tasks) await pg.query("UPDATE tasks SET title=$2, notes=$3, done=$4, completed_at=$5, completed_by_name=$6, edited_at=$7, edited_by=$8, edited_by_name=$9, source_gift_id=$10 WHERE id=$1",
      [t.id, t.title, t.notes, t.done, t.completed_at, t.completed_by_name, t.edited_at, t.edited_by, t.edited_by_name, t.source_gift_id]);
    await pg.query("UPDATE calendar_events SET logged_at=NULL, interaction_id=NULL, logged_by=NULL WHERE id='cal_b72_mc_coffee'");
    await pg.query("UPDATE donors SET do_not_email=$2 WHERE id=$1", [mc.id, snap.dne]);
  };

  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`\n── ${MODE} ${w} ──`);
    const since = (await pg.query("SELECT NOW() AS n")).rows[0].n;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 500, isMobile: w < 500 });
    await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/status of 500/.test(m.text()) && !/favicon|fonts\.googleapis|_vercel/.test(m.location()?.url || "") && !/\[SW\]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("response", r => { if (r.status() >= 500 && !r.url().endsWith("/ai/stream")) errors.push(`${r.status()} ${r.url().replace(API, "")}`); });
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const shot = (name, full) => page.screenshot({ path: path.join(OUT, `${MODE}-${name}-${w}.png`), fullPage: !!full });
    const settle = (ms = 700) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));
    const header = async () => (await page.locator('[data-testid^="dp-fig-"]').allInnerTexts().catch(() => [])).join(" | ").replace(/\?/g, "").replace(/\s+/g, " ");
    const say = async (words) => {
      if (!(await page.locator('[data-testid="tell-steward-sheet"]').count())) { await page.click('[data-testid="tell-fab"]'); await settle(400); }
      else if (await page.getByRole("button", { name: "Tell another" }).count()) { await page.getByRole("button", { name: "Tell another" }).first().click(); await settle(300); }
      await page.locator('[data-testid="tell-text"]').fill(words);
      await page.click('[data-testid="tell-send"]');
      const done = '[data-testid="tell-results"], [data-testid="tell-plan"], [data-testid="tell-plan-choose"], [data-testid="tell-answer"], [data-testid="tell-unsure"], [data-testid="tell-plan-none"]';
      await page.waitForSelector(`${done}, [data-testid="tell-which"]`, { timeout: 20000 }).catch(() => {});
      // The demo has two Margarets: she picks Margaret Chen, as Jonathan did.
      if (await page.locator('[data-testid="tell-which-choice"]').count()) {
        await page.locator('[data-testid="tell-which-choice"]', { hasText: "Margaret Chen" }).first().click();
        await page.waitForSelector(done, { timeout: 20000 }).catch(() => {});
      }
      await settle(700);
      return page.locator('[data-testid="tell-steward-sheet"]').innerText().catch(() => "");
    };
    const close = async () => { await page.keyboard.press("Escape"); await settle(500); };

    await page.goto(`${APP}/donors/${encodeURIComponent(mc.id)}`, { waitUntil: "domcontentloaded" }); await settle(2500);
    const h0 = await header();
    ok("Margaret before: Last gift $15,000, This year $40,000, Lifetime $187,500", /\$15,000/.test(h0) && /\$40,000/.test(h0) && /\$187,500/.test(h0), h0);
    await shot("01-profile");

    const t1 = await say("Lunch with Margaret went well, she gave $5000, log that, then send her the receipt");
    await shot("02-memo");
    if (MODE === "after") ok("the memo offers Do all of this, in one line", await page.locator('[data-testid="tell-do-all"]').count() === 1 && /Record \$5,000, send the receipt/.test(t1), t1.slice(0, 400));
    await page.locator('[data-testid="tell-card-money"] button', { hasText: /^Yes$/ }).first().click(); await settle(1200);
    const t2 = await page.locator('[data-testid="tell-steward-sheet"]').innerText().catch(() => "");
    await shot("03-gift-yes");
    if (MODE === "after") ok("the receipt and thank-you wait as one card for the $5,000 gift", /\$5,000 gift, Oct \d+/.test(t2) && /Send both/.test(t2), t2.slice(0, 500));
    await close();
    const h1 = await header();
    await shot("04-profile-after-yes");
    await shot("04b-profile-after-yes-full", true);
    if (MODE === "after") {
      ok("no reload: Last gift $5,000, This year $45,000, Lifetime $192,500", /\$5,000/.test(h1) && /\$45,000/.test(h1) && /\$192,500/.test(h1), h1);
      ok("no reload: Average is over 14 gifts", /of 14 gifts/.test(h1), h1);
      ok("the coffee is no longer upcoming with its brief", !(await page.locator('[data-testid="before-meeting"]').count())
        && !/TODAY · 10:00 AM|Coffee at Magee's on Main/i.test(await page.locator("main, body").first().innerText()), null);
      const rail = await page.locator("body").innerText();
      ok("no step reads \"Log the gift\", and nothing shows \"Edited by Dana\" on it", !/Log the gift/.test(rail), null);

      await say("Put Margaret Chen in the Major donor journey");
      const t5 = await page.locator('[data-testid="tell-steward-sheet"]').innerText().catch(() => "");
      ok("\"Put Margaret Chen in the Major donor journey\" is done, with Undo", /Done for you/i.test(t5) && /Major donor/.test(t5) && await page.locator('[data-testid="tell-undo"]').count() === 1, t5.slice(0, 400));
      await shot("05-journey");
      const t6 = await say("Put Margaret Chen in the Major gifts journey");
      ok("a journey that is not one: the closest two", await page.locator('[data-testid="tell-plan-choice"]').count() === 2, t6.slice(0, 300));
      await shot("06-closest-two");
      const t7 = await say("Mark Margaret Chen as do not email");
      ok("\"do not email\" waits for her yes", /Mark Margaret as do not email\?/.test(t7), t7.slice(0, 300));
      await shot("07-do-not-email");
      await close();
    }
    ok("no console errors and no 5xx", errors.length === 0, errors);
    await ctx.close();
    await restore(since);
  }
  await browser.close();
  await pg.end();
  standin.close();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); standin.close(); process.exit(1); });
