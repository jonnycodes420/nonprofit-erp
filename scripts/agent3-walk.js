// AGENT-3 Muse walk, on a LOCAL Harborlight (the scratch database's own seed)
// with the model on. At 1440 it types the three prompts into the Agent, runs
// the renewal and the thank-yous, approves one thank-you in Review all and
// opens that person's record. At 390 it opens the plan list and the record.
//
//   APP=http://localhost:4573 API=http://localhost:6501 \
//     PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/agent3-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = process.env.APP || "http://localhost:4173";
const API = process.env.API || "http://localhost:5601";
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API)) { console.error("REFUSED: loopback only."); process.exit(1); }
const OUT = path.join(__dirname, "..", "docs", "agent-3");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 400)));
  if (!cond) failures++;
};

(async () => {
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const org = (await api("GET", "/org")).body;
  const browser = await chromium.launch();
  let person = null;
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`\n── ${w} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel/.test(m.location()?.url || "") && !/^\[SW\] registration failed/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("response", r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")}`); });
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const shot = name => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
    const settle = (ms = 600) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));
    await page.goto(APP + "/app/agent", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="agent-ask-bar"]', { timeout: 30000 });
    await settle();
    const ask = async text => {
      await page.fill('[data-testid="agent-ask-bar"]', text);
      try { await page.waitForSelector('[data-testid="agent-ask-bar-go"]:not([disabled])', { timeout: 60000 }); }
      catch (e) { await page.screenshot({ path: path.join(OUT, `stuck-${w}.png`) }); throw e; }
      await page.click('[data-testid="agent-ask-bar-go"]');
      // Done planning when the button stops saying so; the sheet is then this plan's.
      await page.waitForFunction(() => !/Planning/.test((document.querySelector('[data-testid="agent-ask-bar-go"]') || {}).innerText || ""), null, { timeout: 240000 });
      await settle();
    };
    if (w === 1440) {
      await ask("Who has a grant report due in the next 30 days?");
      await page.waitForSelector('[data-testid="agent-read"]', { timeout: 60000 });
      await settle();
      const read = await page.locator('[data-testid="agent-read"]').innerText();
      ok("the grant question is a list of the funders with a report due", /match/i.test(read) && /grant report due in the next 30 days/i.test(read), read.slice(0, 300));
      await shot("1-grant-report-due");

      for (const [name, text] of [["2-renewal", "Draft a renewal to every member expiring next month"], ["3-spring-thanks", "Thank everyone who gave to the spring appeal"]]) {
        await ask(text);
        await page.waitForSelector('[data-testid="agent-sheet-confirm"]', { timeout: 30000 });
        await settle();
        const sheet = await page.locator('[data-testid="agent-sheet"]').innerText();
        ok(`${name}: a plan to read before anything runs`, /draft/i.test(sheet), sheet.slice(0, 300));
        await shot(`${name}-plan`);
        await page.click('[data-testid="agent-sheet-confirm"]');
        await page.waitForFunction(() => !document.querySelector('[data-testid="agent-sheet-confirm"]') && document.querySelector('[data-testid="agent-review-all"]'), null, { timeout: 120000 });
        await settle();
      }
      await page.click('[data-testid="agent-review-all"]');
      await page.waitForSelector('[data-testid="agent-draft-review"]', { timeout: 20000 });
      await settle();
      await shot("4-review-all");
      const W0 = (await api("GET", "/agent/waiting")).body.items || [];
      await page.click('[data-testid="review-approve"]');
      await page.waitForTimeout(1500);
      const W1 = (await api("GET", "/agent/waiting")).body.items || [];
      const gone = W0.filter(i => i.kind === "agent_draft").find(i => !W1.some(j => j.id === i.id));
      ok("approving one draft takes it out of Drafts to review", !!gone, { before: W0.length, after: W1.length });
      person = gone ? { id: gone.donorId, name: gone.who } : null;
      await shot("5-approved");
      await page.keyboard.press("Escape").catch(() => {});
    } else {
      await settle(1200);
      await shot("1-agent-plans");
    }
    if (person) {
      await page.goto(APP + `/donors/${person.id}`, { waitUntil: "domcontentloaded" });
      await settle(1200);
      const text = await page.locator("body").innerText();
      ok(`${person.name}'s record shows the approved thank-you`, /approved to send by/i.test(text), text.slice(0, 200));
      await shot("6-on-the-person");
    }
    const real = errors.filter(e => !/^503 POST \/ai\/stream$/.test(e) && !/status of 503/.test(e));
    ok(`console errors at ${w}`, real.length === 0, real);
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
