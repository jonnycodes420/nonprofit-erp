#!/usr/bin/env node
// FIX-6 — THE WALK. SELF_REFUSING.
//
// Six audit defects, and four of them are things a server suite cannot see:
// whether the queue has buttons, whether the sidebar can be CLICKED, whether
// the export says anything when it finishes, and whether a stat column is
// blank or says a number. The fifth and sixth (the duplicate journeys and the
// duplicate volunteer) are re-checked here too, because the brief asks whether
// they are still there after a clean seed and the honest way to answer that is
// to look rather than to reason.
//
//   BASE=http://localhost:5901 APP_URL=http://localhost:4473 \
//   EMAIL=director@harborlight.demo PASSWORD=demo-harbor-2026 node scripts/fix6-walk.js
//
// SELF_REFUSING: loopback only, and it never runs in production. It WRITES
// (it approves and skips real queue items through the real routes), so there
// is no read-only mode: the point is that the writes land.

const path = require("path");

const BASE = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const APP = (process.env.APP_URL || "http://localhost:4173").replace(/\/+$/, "");
for (const [name, url] of [["BASE", BASE], ["APP_URL", APP]]) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run: ${name} must be loopback (got ${url}).`); process.exit(1);
  }
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const EMAIL = process.env.EMAIL || "director@harborlight.demo";
const PASSWORD = process.env.PASSWORD || "demo-harbor-2026";
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "fix-6");
const IGNORE = /_vercel\/(insights|speed-insights)|\/ai\/stream|favicon|apple-touch-icon|\.map$/i;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 500) : "")); }
};
async function api(pathname, opts = {}, token = null) {
  const r = await fetch(BASE + pathname, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body, headers: r.headers };
}

(async () => {
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) {
    console.error(`Playwright not found under ${PW_DIR}. This walk is the browser half; there is no server-only mode.`);
    process.exit(1);
  }
  require("fs").mkdirSync(SHOTS, { recursive: true });

  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 200 || !login.body.token) { console.error("Could not sign in as " + EMAIL); process.exit(1); }
  const token = login.body.token;
  const AUTH = [token, JSON.stringify(login.body.user || {}), JSON.stringify(login.body.org || {})];
  const signIn = ctx => ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, AUTH);

  // ── FIX 2 and FIX 3 · ARE THEY STILL THERE AFTER A CLEAN SEED? ─────────
  console.log("— fixes 2 and 3 · re-checked on this seed —");
  const js = await api("/journeys", {}, token);
  const jn = (js.body.journeys || []).map(j => j.name);
  const jdupes = [...new Set(jn.filter(n => jn.filter(x => x === n).length > 1))];
  ok("no journey appears twice in the list a donor picks from", jdupes.length === 0, jdupes);
  const roster = await api("/volunteer-hub/roster", {}, token);
  const rn = (roster.body.people || []).map(p => p.name);
  const rdupes = [...new Set(rn.filter(n => rn.filter(x => x === n).length > 1))];
  ok("no volunteer appears twice on the roster", rdupes.length === 0, rdupes);
  ok("…and Verity Underhill appears exactly once",
     rn.filter(n => /Verity Underhill/.test(n)).length === 1, rn.filter(n => /Verity/.test(n)));
  // The header counts still foot with the rows they are over.
  const hours = (roster.body.people || []).reduce((a, p) => a + Number(p.hundredthsThisYear || 0), 0);
  ok("…and the roster's sentence foots with its own rows",
     roster.body.sentence.includes(String(rn.length))
     && roster.body.sentence.includes(String(Math.round(hours / 100))),
     { sentence: roster.body.sentence, rows: rn.length, hours: Math.round(hours / 100) });

  // ── FIX 4 · THE EXPORT SAYS WHAT IT BUILT ──────────────────────────────
  console.log("\n— fix 4 · the export —");
  const raw = await fetch(BASE + "/org/export/csv", { headers: { Authorization: "Bearer " + token } });
  ok("the export builds", raw.status === 200, raw.status);
  ok("…and the browser is allowed to read the counts off it",
     /X-Steward-Export-Counts/i.test(raw.headers.get("access-control-expose-headers") || ""),
     raw.headers.get("access-control-expose-headers"));
  let counts = null;
  try { counts = JSON.parse(raw.headers.get("x-steward-export-counts") || "null"); } catch { counts = null; }
  ok("…and the counts are real numbers from this org's own file",
     !!counts && Number(counts.donors) > 0 && Number(counts.gifts) > 0, counts);
  const blob = await raw.arrayBuffer();
  ok("…and the zip has bytes in it", blob.byteLength > 1000, blob.byteLength);

  // ── FIX 1 · THE QUEUE HAS A DOOR ───────────────────────────────────────
  console.log("\n— fix 1 · the approval queue —");
  const w0 = await api("/agent/waiting", {}, token);
  ok("there is something waiting to walk", w0.body.count > 0, w0.body.count);
  const refused = await api("/agent/waiting/gift_to_confirm/x/approve", { method: "POST", body: "{}" }, token);
  ok("a gift cannot be approved through the general door", refused.status === 400, refused.body);

  const browser = await chromium.launch();
  const shots = [];
  async function screen(width, height) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await signIn(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text()); });
    page.on("response", r => { if (r.status() >= 500 && !IGNORE.test(r.url())) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
    return { ctx, page, errors };
  }
  const shot = async (page, name) => { const f = path.join(SHOTS, name + ".png"); await page.screenshot({ path: f }); shots.push(f); };
  const toTab = async (page, label) => {
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.evaluate(t => {
      const b = [...document.querySelectorAll("button")].find(x => new RegExp(t + "\\s*$").test((x.textContent || "").trim()));
      if (b) b.click();
    }, label);
    await page.waitForTimeout(2500);
  };

  // ── 1440 ────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(1440, 1100);
    console.log("\n— 1440 · the queue —");
    await toTab(page, "Agent");
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /Waiting for you/.test(x.textContent || "")); if (b) b.click(); });
    await page.waitForTimeout(2500);
    const items = await page.locator("[data-testid='agent-waiting-item']").count();
    ok("the queue draws its items", items > 0, items);
    ok("every item has an Approve", await page.locator("[data-testid='agent-approve']").count() === items, items);
    ok("…and a Skip", await page.locator("[data-testid='agent-skip']").count() === items);
    const approveColor = await page.locator("[data-testid='agent-approve']").first().evaluate(el => getComputedStyle(el).backgroundColor);
    ok("…Approve is the one emerald action", /rgb\(13,\s*92,\s*58\)/.test(approveColor), approveColor);
    const skipColor = await page.locator("[data-testid='agent-skip']").first().evaluate(el => getComputedStyle(el).backgroundColor + "|" + getComputedStyle(el).color);
    ok("…and nothing on the row is red: this destroys nothing",
       !/rgb\(184,\s*89,\s*63\)|rgb\(138,\s*58,\s*36\)/.test(skipColor), skipColor);
    await shot(page, "1440-queue");

    // APPROVE, and the result stays on the row.
    await page.locator("[data-testid='agent-approve']").first().click();
    await page.waitForTimeout(2000);
    const result = await page.locator("[data-testid='agent-waiting-result']").first().textContent().catch(() => "");
    ok("approving shows a result in place, not a row that vanishes", /sent|logged|approved/i.test(result), result);
    // ASK THE SERVER, not the badge. The badge is hidden at zero, so a walk
    // whose previous run left one item behind approved the last one and then
    // read a tab with no number on it and called that a failure. The count
    // the queue is about lives on the server.
    const after = await api("/agent/waiting", {}, token);
    ok("…and the count came down", after.body.count === w0.body.count - 1,
       { before: w0.body.count, after: after.body.count });
    await shot(page, "1440-approved");

    // SKIP asks for a reason, optionally.
    const left = await page.locator("[data-testid='agent-skip']").count();
    if (left > 0) {
      await page.locator("[data-testid='agent-skip']").first().click();
      await page.waitForTimeout(700);
      ok("Skip asks for a reason, and does not demand one",
         await page.locator("[data-testid='agent-skip-reason']").count() === 1);
      await page.locator("[data-testid='agent-skip-reason']").fill("She rang them instead");
      await page.locator("[data-testid='agent-skip-confirm']").click();
      await page.waitForTimeout(1800);
      const skipped = await page.locator("[data-testid='agent-waiting-result']").allTextContents();
      ok("…and the skip reports back with the reason", skipped.some(t => /rang them/i.test(t)), skipped);
    }

    // ── FIX 6 · THE SIDEBAR IS CLICKABLE FROM EVERY SCREEN ──────────────
    console.log("\n— 1440 · the sidebar, from four screens —");
    for (const [where, url] of [["a donor record", "/donors/d_b72_01"], ["the dashboard", "/dashboard"],
                                ["the donor list", "/donors"], ["reports", "/reports"]]) {
      await page.goto(APP + url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3200);
      const dead = await page.evaluate(() => {
        const out = [];
        for (const btn of document.querySelectorAll(".app-sidebar button")) {
          const t = (btn.textContent || "").trim(); if (!t) continue;
          const r = btn.getBoundingClientRect(); if (!r.width) continue;
          const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
          if (!(btn.contains(top) || top === btn)) out.push(t.replace(/[^\w ]/g, "").trim());
        }
        return out;
      });
      ok(`every sidebar item is clickable from ${where}`, dead.length === 0, dead);
    }
    await page.goto(APP + "/donors/d_b72_01", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await shot(page, "1440-donor-record");

    // ── FIX 5 · THE CAMPAIGN FIGURES SAY SOMETHING ──────────────────────
    console.log("\n— 1440 · campaigns —");
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { const m = [...document.querySelectorAll("button")].find(b => /More/.test(b.textContent || "")); if (m) m.click(); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { const x = [...document.querySelectorAll("button,a")].find(y => /Communications/.test((y.textContent || "").trim())); if (x) x.click(); });
    await page.waitForTimeout(2800);
    await page.evaluate(() => { const x = [...document.querySelectorAll("[role=tab]")].find(y => /Campaigns/.test(y.textContent || "")); if (x) x.click(); });
    await page.waitForTimeout(2200);
    // THE VALUE, NOT THE WHOLE PILL. The pill reads "<label><value>", so
    // asserting on its full text says nothing about whether the value is
    // there — which is the entire defect. The value is the second child.
    for (const [k, label] of [["sent", "Total Sent"], ["open", "Avg Open Rate"], ["active", "Active"]]) {
      const v = await page.locator(`[data-testid='camp-stat-${k}'] > span:nth-child(2)`).textContent().catch(() => "");
      ok(`the ${label} figure has a value at all, never blank`, !!v && v.trim().length > 0, JSON.stringify(v));
      ok(`…and it is a number or "Not sent yet"`, /^\d|Not sent yet/.test((v || "").trim()), v);
    }
    await page.locator("[data-testid='camp-stat-active']").click();
    await page.waitForTimeout(900);
    ok("…and the figure opens its rows, with a sentence",
       (await page.locator("[data-testid='camp-stat-sentence']").textContent().catch(() => "")).length > 10);
    await shot(page, "1440-campaigns");
    await page.keyboard.press("Escape");

    ok("no console error, page error or 5xx at 1440", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  // ── 390 ─────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(390, 844);
    console.log("\n— 390 —");
    await toTab(page, "Agent");
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /Waiting for you/.test(x.textContent || "")); if (b) b.click(); });
    await page.waitForTimeout(2500);
    const n = await page.locator("[data-testid='agent-waiting-item']").count();
    if (n > 0) {
      ok("the queue still has its two controls at 390",
         await page.locator("[data-testid='agent-approve']").count() === n
         && await page.locator("[data-testid='agent-skip']").count() === n);
    } else {
      ok("the queue is empty at 390, and says so",
         /Nothing is waiting on you/.test(await page.locator("[data-testid='agent-view-waiting']").textContent().catch(() => "")));
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("nothing scrolls sideways", over <= 0, over);
    // At 390 there is no sidebar at all, so a takeover must cover the screen.
    await page.goto(APP + "/donors/d_b72_01", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const tk = await page.evaluate(() => {
      const e = document.querySelector(".fullscreen-takeover");
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), vw: window.innerWidth };
    });
    ok("the donor record covers the whole screen at 390, where there is no sidebar to clear",
       !!tk && tk.x === 0 && tk.w === tk.vw, tk);
    await shot(page, "390-donor-record");
    ok("no console error, page error or 5xx at 390", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  await browser.close();
  console.log(`\nfix6-walk: ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("screenshots:\n  " + shots.join("\n  "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
