// FIX-30 verification walk, at 1440 and 390, on a LOCAL Harborlight (the
// scratch database's own seed; nothing here can reach production).
//
//   §1 Templates: every email card opens the EMAIL-1 editor; only the printed
//      letters open their own editor
//   §2 the receipt opens in the EMAIL-1 editor with its tax lines locked, is
//      saved, and drafts for one person
//   §3 a campaign starter opens in the EMAIL-1 editor and can start a campaign
//   §4 the Dashboard's sequences link opens Sequences
//   §5 Gervase Everhart, who gave every October, reads Current
//
//   APP=http://localhost:4473 API=http://localhost:6401 \
//     PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/fix30-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = process.env.APP || "http://localhost:4173";
const API = process.env.API || "http://localhost:5601";
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API)) { console.error("REFUSED: loopback only."); process.exit(1); }
const OUT = path.join(__dirname, "..", "docs", "fix-30");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 400)));
  if (!cond) failures++;
};

(async () => {
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed: " + JSON.stringify(login));
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const org = (await api("GET", "/org")).body;

  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`\n── ${w} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("response", r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")}`); });
    // serviceWorkers:"block" makes the app's own SW registration log an error; that line is the block, not the app.
    page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel/.test(m.location()?.url || "") && !/^\[SW\] registration failed/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    // §4 needs one sequence line on Home. Harborlight has none locally, so the
    // walk answers /sequences/home with one in the browser: nothing is written.
    await page.route(API + "/sequences/home", r => r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ sequences: [{ id: "seq_walk", name: "Welcome", status: "active", activeCount: 4, nextSend: null, failedCount: 0, line: "Welcome: 4 people in it." }], canRun: true, blockedReason: null }) }));
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o));
    }, [login.token, login.user, org]);
    const shot = name => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: false });
    const settle = () => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(600));

    // §1
    await page.goto(APP + "/app/communications?subtab=templates", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-template-card]", { timeout: 25000 });
    await settle();
    const cards = await page.$$eval("[data-template-card]", cs => cs.map(c => ({ store: c.getAttribute("data-template-card"), editor: c.getAttribute("data-template-editor"), name: (c.innerText || "").split("\n")[1] })));
    const by = k => cards.filter(c => c.editor === k).length;
    console.log(`  cards: ${cards.length} · email editor ${by("email")} · letter editor ${by("letter")} · other ${cards.length - by("email") - by("letter")}`);
    ok("§1 every email card opens the EMAIL-1 editor (24) and only the 5 letters do not", by("email") === 24 && by("letter") === 5 && cards.length === 29, cards);
    await shot("1-templates");

    // §2 the receipt
    await page.click('[data-template-id="letter-receipt"] button');
    await page.waitForSelector('[data-testid="email-editor"]', { timeout: 20000 });
    await settle();
    ok("§2 the receipt opens in the EMAIL-1 editor", true);
    ok("§2 its tax lines are a locked block with no Remove", (await page.$$('[data-testid="email-locked-block"]')).length === 1);
    ok("§2 it offers a draft for one person", !!(await page.$('[data-testid="email-person-draft"]')));
    const subj = page.locator("#et-subject");
    const was = await subj.inputValue();
    await subj.fill(was.endsWith(".") ? was.slice(0, -1) : was + ".");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.innerText.trim() === "Saved"), null, { timeout: 15000 });
    ok("§2 the save goes through", true);
    await page.fill('input[aria-label="Find a person"]', "Gervase Everhart");
    await page.click('button:has-text("Gervase Everhart")');
    await page.click('[data-testid="email-person-draft-make"]');
    await page.waitForSelector('[data-testid="email-editor"] [role="status"]', { timeout: 15000 });
    const note = await page.locator('[data-testid="email-editor"] [role="status"]').first().innerText();
    ok("§2 the draft is waiting in Drafts to review, nothing sent", /waiting in Drafts to review\. Nothing has been sent/.test(note), note);
    await page.waitForTimeout(400);
    await shot("2-receipt-editor");
    await page.click('button:has-text("Back to templates")');
    await page.waitForSelector("[data-template-card]", { timeout: 15000 });

    // §3 a campaign starter
    await page.click('[data-template-id="campaign-appeal"] button');
    await page.waitForSelector('[data-testid="email-editor"]', { timeout: 20000 });
    await settle();
    ok("§3 the general appeal opens in the EMAIL-1 editor with Start a campaign", !!(await page.$('[data-testid="email-start-campaign"]')));
    await shot("3-appeal-editor");

    // §4 the Dashboard's sequences link
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-root", { timeout: 25000 });
    await settle();
    const go = await page.$('[data-testid="first-run-go"]');
    if (go) { await go.click(); await page.waitForTimeout(600); }
    await page.waitForSelector('[data-testid="home-sequence-line"]', { timeout: 15000 }).catch(() => {});
    const btns = await page.$$('xpath=//*[@data-testid="home-sequence-line"]/../preceding-sibling::*//button[normalize-space(.)="Open →"]');
    if (btns.length) {
      await btns[0].scrollIntoViewIfNeeded(); await btns[0].click();
      await page.waitForTimeout(1500);
      const url = page.url();
      const seqTab = await page.$$eval('[role="tab"][aria-selected="true"], button[aria-pressed="true"], [data-active="true"]', els => els.map(e => e.innerText.trim()));
      ok("§4 the Dashboard's sequences link opens Sequences", /subtab=sequences/.test(url) || seqTab.some(t => /^Sequences/i.test(t)), { url, seqTab });
      await shot("4-sequences");
    } else {
      ok("§4 the Dashboard shows its sequences card", false, "no sequences card");
    }

    // §5 Gervase Everhart
    const people = (await api("GET", "/donors/summaries")).body;
    const ge = (Array.isArray(people) ? people : []).find(d => /Gervase Everhart/.test(d.name));
    const st = ge ? (await api("GET", `/donors/${ge.id}/status`)).body : null;
    const lc = st && (st.tags || []).find(t => t.kind === "lifecycle");
    ok("§5 Gervase Everhart, who gave every October, reads Current", lc && lc.key === "current", lc);
    if (ge) {
      await page.goto(APP + `/donors/${ge.id}`, { waitUntil: "domcontentloaded" });
      await settle();
      await page.waitForTimeout(800);
      const text = await page.locator("body").innerText();
      ok("§5 his profile says Current, not Recaptured", /\bCurrent\b/.test(text) && !/\bRecaptured\b/.test(text));
      await shot("5-gervase");
    }
    // No Anthropic key on a scratch stack: /ai/stream answers 503 (the AI
    // switch's "no key" answer) and the browser logs the 503. That pair is the
    // environment; anything else is a defect.
    const real = errors.filter(e => !/^503 POST \/ai\/stream$/.test(e) && !/status of 503/.test(e));
    if (real.length !== errors.length) console.log(`  (environment: ${errors.length - real.length} lines from /ai/stream with no AI key)`);
    ok(`console errors at ${w}`, real.length === 0, real);
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
