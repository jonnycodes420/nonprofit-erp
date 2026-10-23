// scripts/check2-walk.js · CHECK-2. The Henrietta Duffield check, walked at 1440 then 390, on the local stack.
//
// A stand-in model on MOCK answers the check's read exactly as prod's model
// read Jonathan's test check (21 Oct): "HENRIETTA M. DUFFIELD / GEORGE A.
// DUFFIELD", $2,500, memo "Gala - in memory of Walter". The local server must
// be booted with ANTHROPIC_API_KEY set and ANTHROPIC_BASE_URL=http://localhost:<MOCK>.
// STAGE=before (on origin/main) or after names the screenshots in docs/check-2/.
//   API=http://localhost:5621 APP=http://localhost:4174 MOCK=5629 STAGE=after \
//     DATABASE_URL=postgresql://steward@localhost:5544/steward_check2 node scripts/check2-walk.js
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa"), "node_modules", "playwright"));
const API = process.env.API || "http://localhost:5621";
const APP = process.env.APP || "http://localhost:4174";
const MOCK = Number(process.env.MOCK || 5629);
const STAGE = process.env.STAGE === "before" ? "before" : "after";
const OUT = path.join(__dirname, "..", "docs", "check-2");
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || process.env.NODE_ENV === "production") { console.error("REFUSED: loopback only."); process.exit(1); }
const db = process.env.DATABASE_URL || "";
if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(db)) { console.error("REFUSED: loopback DATABASE_URL only."); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const blank = { kind: "check", payer: "", payee: "", amountDigits: "", amountWords: "", amountStated: "", memo: "", date: "", chequeNumber: "",
  donorName: "", email: "", line1: "", city: "", state: "", postal: "", fundName: "", advisorName: "", employer: "", frequency: "",
  installments: "", startDate: "", shares: "", ticker: "", originalGiftDate: "", sentence: "" };
const HENRIETTA = { ...blank, payer: "HENRIETTA M. DUFFIELD / GEORGE A. DUFFIELD", payee: "Harborlight Youth Coll.", amountDigits: "2,500.00",
  amountWords: "Two thousand five hundred and 00/100", memo: "Gala - in memory of Walter", date: "Oct 19, 2026", chequeNumber: "1187",
  sentence: "A check from HENRIETTA M. DUFFIELD / GEORGE A. DUFFIELD for the gala, in memory of Walter." };
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", d => { body += d; });
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (body.includes('"name":"pick_fund"')) return res.end(JSON.stringify({ type: "message", role: "assistant", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", id: "f", name: "pick_fund", input: { fund: "none", confidence: "low" } }] }));
    res.end(JSON.stringify({ type: "message", role: "assistant", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", id: "r", name: "record_items", input: { items: [HENRIETTA] } }] }));
  });
});

(async () => {
  await new Promise(r => mock.listen(MOCK, r));
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const H = { Authorization: "Bearer " + login.token, "Content-Type": "application/json" };
  const call = (method, p, body) => fetch(API + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined }).then(r => r.json().catch(() => ({})));
  const org = await call("GET", "/org");
  const { Client } = require("pg");
  const pg = new Client({ connectionString: db }); await pg.connect();
  const img = fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "capture1", "check-1.png")).toString("base64");

  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`── ${STAGE} ${w} ──`);
    // A fresh card each width: the check arrives as a phone photo would.
    const up = await call("POST", "/capture/upload", { files: [{ name: "duffield-check.png", dataUrl: "data:image/png;base64," + img }], source: "photo" });
    const card = up.cards && up.cards[0];
    console.log("  card:", card && card.headline, "|", card && card.donor && (card.donor.sentence || card.donor.state));
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 500, isMobile: w < 500 });
    const page = await ctx.newPage();
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const settle = (ms = 900) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));
    const shot = async (name, full = false) => { await page.screenshot({ path: path.join(OUT, `${STAGE}-${name}-${w}.png`), fullPage: full }); console.log("  shot", `${STAGE}-${name}-${w}.png`); };

    await page.goto(APP + "/app/fundraising?fr=toconfirm", { waitUntil: "domcontentloaded" }); await settle(1800);
    const btn = page.getByRole("button", { name: /Log \$2,500\.00 check/ }).first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await page.locator('[data-testid="capture-match"], [data-testid="capture-new-person"]').first().scrollIntoViewIfNeeded().catch(() => {});
    await settle(300); await shot("01-card");
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click(); await settle(2500); await shot("02-confirmed");
    } else console.log("  the Log button is not enabled");
    const [row] = (await pg.query(`SELECT donor_id, gift_id FROM capture_items WHERE id=$1`, [card && card.id])).rows;
    if (!row || !row.donor_id) { console.log("  not confirmed; stopping this width"); await ctx.close(); continue; }
    const [draft] = (await pg.query(`SELECT id FROM thank_you_drafts WHERE gift_id=$1`, [row.gift_id])).rows;
    console.log("  donor", row.donor_id, "gift", row.gift_id, "draft", draft && draft.id);

    await page.goto(APP + "/donors/" + row.donor_id, { waitUntil: "domcontentloaded" }); await settle(2200); await shot("03-profile");
    const emails = page.getByRole("tab", { name: /^Emails/ }).first();
    if (await emails.isVisible().catch(() => false)) { await emails.click(); await settle(1200); await shot("04-profile-emails"); }
    await page.goto(APP + "/app/communications?subtab=thankyous" + (draft ? "&draft=" + draft.id : ""), { waitUntil: "domcontentloaded" }); await settle(1800); await shot("05-communications");
    await page.goto(APP + "/app/fundraising?fr=acknowledgments", { waitUntil: "domcontentloaded" }); await settle(1800); await shot("06-acknowledgments");
    await page.goto(APP + "/app/finance", { waitUntil: "domcontentloaded" }); await settle(2000);
    const line = page.getByText(/Gift from (Henrietta|HENRIETTA)/).first();
    await line.scrollIntoViewIfNeeded().catch(() => {}); await settle(300); await shot("07-finance");
    await ctx.close();
  }
  await browser.close();
  await pg.end();
  mock.close();
})().catch(e => { console.error(e); mock.close(); process.exit(1); });
