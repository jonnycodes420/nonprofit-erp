// scripts/auto1-walk.js · AUTO-1. Journey steps that send themselves, at 1440 then 390, on the local stack.
//
// On the scratch Harborlight (a demonstration org, so nothing is ever sent):
// the step switch, the confirm with the step's words and "About N people",
// Sending tomorrow with Skip, the Home line the night before, and Pause all.
// Screenshots land in docs/auto-1/.
//   API=http://localhost:5951 APP=http://localhost:4351 DATABASE_URL=postgresql://steward@localhost:5544/steward_auto1 \
//     PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/auto1-walk.js
"use strict";
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa"), "node_modules", "playwright"));
const API = process.env.API || "http://localhost:5951";
const APP = process.env.APP || "http://localhost:4351";
const OUT = path.join(__dirname, "..", "docs", "auto-1");
// It turns switches on and off on the scratch demo org, so it runs only against a local stack.
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || process.env.NODE_ENV === "production") { console.error("REFUSED: loopback only."); process.exit(1); }
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };
const JOURNEY = "ct_b72_emails";

(async () => {
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const H = { Authorization: "Bearer " + login.token, "Content-Type": "application/json" };
  const call = (method, p, body) => fetch(API + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined }).then(r => r.json().catch(() => ({})));
  const org = await call("GET", "/org");
  // Start from off, with the first email's words saved by a person here.
  const reset = async () => {
    const auto = await call("GET", `/journeys/${JOURNEY}/auto`);
    const first = (auto.steps || [])[0];
    if (first && first.template) await call("PUT", `/email-templates/${first.template.id}`, { publish: true });
    for (const s of auto.steps || []) if (s.on) await call("POST", `/journeys/${JOURNEY}/steps/${s.seq}/auto`, { on: false });
    await call("POST", "/auto-send/pause", { paused: false });
  };
  // Three people with no open step yet (one open Thread per person, so a
  // person mid-way through something else would wait), each with an email.
  const { Client } = require("pg");
  const db = process.env.DATABASE_URL || "";
  if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(db)) { console.error("REFUSED: loopback DATABASE_URL only."); process.exit(1); }
  const pg = new Client({ connectionString: db }); await pg.connect();
  const joiners = (await pg.query(`SELECT d.id FROM donors d WHERE d.org_id='org_b72demo' AND d.deleted_at IS NULL AND COALESCE(d.email,'')<>''
      AND COALESCE(d.is_client,false)=false AND COALESCE(d.do_not_contact,false)=false AND COALESCE(d.deceased,false)=false
      AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.donor_id=d.id AND t.closed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM cultivation_plans p WHERE p.donor_id=d.id AND p.template_id=$1)
    ORDER BY d.name LIMIT 6`, [JOURNEY])).rows.map(r => r.id);
  await pg.end();

  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`\n── ${w} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 500, isMobile: w < 500 });
    await reset();
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/status of 500/.test(m.text()) && !/favicon|fonts\.googleapis|_vercel/.test(m.location()?.url || "") && !/\[SW\]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("response", r => { if (r.status() >= 500 && !r.url().endsWith("/ai/stream")) errors.push(`${r.status()} ${r.url().replace(API, "")}`); });
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const shot = name => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
    const settle = (ms = 700) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));
    const openJourney = async () => {
      await page.goto(APP + "/app/journeys", { waitUntil: "domcontentloaded" }); await settle(1500);
      await page.getByText("First year, in three emails", { exact: false }).first().click(); await settle(1000);
    };

    await openJourney();
    const steps = page.locator('[data-testid="auto-send-steps"]');
    await steps.scrollIntoViewIfNeeded().catch(() => {});
    ok("the journey shows its email steps with a switch, off", await steps.isVisible().catch(() => false)
      && (await page.locator('[data-testid="auto-send-switch-0"]').getAttribute("aria-checked")) === "false", null);
    await settle(300); await shot("01-switch-off");

    await page.click('[data-testid="auto-send-switch-0"]'); await settle(500);
    const conf = page.locator('[data-testid="auto-send-confirm"]');
    ok("turning it on opens the confirm with the words and the count", await conf.isVisible().catch(() => false)
      && /^About \d+ (person|people) will get this in the next 7 days\.$/.test((await page.locator('[data-testid="auto-send-count"]').innerText()).trim()), null);
    await shot("02-confirm");
    await page.click('[data-testid="auto-send-confirm-on"]'); await settle(800);
    ok("the switch is on", (await page.locator('[data-testid="auto-send-switch-0"]').getAttribute("aria-checked")) === "true", null);
    await shot("03-switch-on");

    // Three people join; their first email waits for the next weekday morning.
    await call("POST", `/journeys/${JOURNEY}/apply`, { donorIds: w === 1440 ? joiners.slice(0, 3) : joiners.slice(3, 6) });
    await openJourney();
    const list = page.locator('[data-testid="sending-tomorrow"]');
    await list.scrollIntoViewIfNeeded().catch(() => {});
    ok("Sending tomorrow lists who goes, each with Skip", await list.isVisible().catch(() => false)
      && (await page.locator('[data-testid="sending-tomorrow-skip"]').count()) >= 1, null);
    await settle(300); await shot("04-sending-tomorrow");

    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" }); await settle(2000);
    const line = page.locator('[data-testid="home-auto-send-notice"]');
    await line.scrollIntoViewIfNeeded().catch(() => {});
    ok("Home says what goes out on its own", await line.isVisible().catch(() => false), null);
    await settle(300); await shot("05-home-line");

    await page.goto(APP + "/app/journeys", { waitUntil: "domcontentloaded" }); await settle(1500);
    const pause = page.locator('[data-testid="pause-all-sending"]');
    await pause.scrollIntoViewIfNeeded().catch(() => {});
    await page.click('[data-testid="pause-all-switch"]'); await settle(600);
    ok("Pause all automatic sending takes effect", /paused/i.test(await pause.innerText()), await pause.innerText().catch(() => ""));
    await shot("06-paused");
    await page.click('[data-testid="pause-all-switch"]'); await settle(500);
    ok("no console errors and no 5xx", errors.length === 0, errors);
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
