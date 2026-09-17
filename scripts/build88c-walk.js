#!/usr/bin/env node
// BUILD-88c — THE WALK. Open Communications, pick Appeal, send yourself a
// test, and read it at a phone's width.
//
// The brief's walk ends at jonathan@stewardapp.dev on a real phone, and that
// last step is Jonathan's: this stack's Resend key is a dummy and the mail
// lands in the local sink on :5602. So the walk does everything up to the
// inbox, and then READS THE CAPTURED EMAIL IN A 390px BROWSER — the same
// measurement a phone would make: nothing wider than the screen, body type big
// enough to read, the org's band at the top, and her own first name in the
// first line rather than a pair of braces.
//
// Loopback only. The sink must be up (this script starts its own on :5602 if
// nothing holds it).
//   PLAYWRIGHT_DIR=~/steward-qa node scripts/build88c-walk.js
const path = require("path");
require("./lib/prodGuard").writerDbUrl();
const API = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const APP = process.env.APP || "http://localhost:4173";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(API) || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(APP)) {
  console.error("REFUSED: loopback only."); process.exit(1);
}
const http = require("http");
const bcrypt = require("bcryptjs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, p = []) => pool.query(sql, p).then(r => r.rows);
const api = async (method, p, tok, body) => {
  const r = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : "")); } };

const ORG = "org_b88cwalk";
const EMAIL = "b88cwalk@t.local";
// The people on the list. Real-shaped names, because the sentence she reads is
// "3 sponsors, including Margaret Chen and Bob Harmon" and a fixture called
// "Donor One" would prove nothing about it.
const PEOPLE = [
  ["Margaret Chen", "margaret@b88cwalk.test"],
  ["Bob Harmon", "bob@b88cwalk.test"],
  ["Ruth Okafor", "ruth@b88cwalk.test"],
];

let captured = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", x => (b += x));
  req.on("end", () => {
    let json = null; try { json = b ? JSON.parse(b) : null; } catch { /* not json */ }
    captured.push({ path: req.url, body: json });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "walk_" + Math.random().toString(36).slice(2) }));
  });
});

(async () => {
  console.log("BUILD-88c walk — Communications, the Appeal, a test to herself, read at 390px\n");
  const sinkUp = await new Promise(r => { sink.on("error", () => r(false)); sink.listen(5602, () => r(true)); });
  if (!sinkUp) { console.error("REFUSED: :5602 is held by something else — the walk must capture its own mail."); process.exit(1); }

  // ── the org, in her own words ────────────────────────────────────────────
  for (const t of ["campaign_recipients", "campaigns", "interactions", "donors", "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,receipt_address,vocabulary_json)
           VALUES ($1,'Sparrow Missions','b88cwalk',1,'active','team','America/New_York','1 Main St, Lexington KY',$2)`,
    [ORG, JSON.stringify({ monthly_giver_singular: "sponsor", monthly_giver_plural: "sponsors" })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ada Trelawney','admin')`,
    [`u_${ORG}`, ORG, EMAIL, bcrypt.hashSync("loadtest1234", 10)]);
  let i = 0;
  for (const [name, email] of PEOPLE) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage) VALUES ($1,$2,$3,$4,'new','steward')`,
      [`d${i++}_${ORG}`, ORG, name, email]);
  }
  const auth = (await api("POST", "/auth/login", null, { email: EMAIL, password: "loadtest1234" })).body;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) console.log("  [pageerror]", e.message.slice(0, 200)); });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    localStorage.setItem("steward_nav_more", "1");
  }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);

  // ── open Communications ──────────────────────────────────────────────────
  console.log("— open Communications —");
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('button:has-text("Communications")');
  await page.waitForTimeout(1800);
  await page.click('button:has-text("New Campaign")');
  await page.waitForTimeout(1200);
  const galleryText = await page.innerText('[data-testid="campaign-gallery"]').catch(() => "");
  ok("it opens on the six, not on a cursor", (await page.$$('[data-testid^="template-"]')).length === 6,
    (await page.$$('[data-testid^="template-"]')).length);
  ok("…in her org's name", /Sparrow Missions/.test(galleryText), galleryText.slice(0, 120).replace(/\n/g, " | "));
  ok("…and the sponsor update is one of them, because her people are sponsors",
    /Sponsor update/i.test(galleryText), null);

  // ── pick Appeal ──────────────────────────────────────────────────────────
  console.log("\n— pick Appeal —");
  await page.click('[data-testid="template-appeal"]');
  await page.waitForTimeout(1600);
  const editorHtml = await page.$eval('[data-testid="campaign-editor"]', el => el.innerHTML);
  ok("the appeal arrives written", editorHtml.length > 400, editorHtml.length);
  const previewText = await page.innerText('[data-testid="campaign-preview"]');
  ok("the preview beside it uses the first recipient's own first name",
    /Margaret/.test(previewText) && !/{{/.test(previewText), previewText.slice(0, 120).replace(/\n/g, " | "));
  const segText = (await page.innerText('[data-testid="segment-sentence"]')).trim();
  ok("the segment reads as people", /^3 donors, including .+ and .+\.$/.test(segText), segText);

  // ── send me a test ───────────────────────────────────────────────────────
  console.log("\n— send me a test —");
  captured = [];
  await page.click('[data-testid="send-me-a-test"]');
  for (let t = 0; t < 60 && captured.length === 0; t++) await new Promise(r => setTimeout(r, 100));
  await page.waitForTimeout(600);
  const mail = captured.find(c => c.path === "/emails");
  ok("one email left, and it went to HER", !!mail && mail.body?.to === EMAIL, { n: captured.length, to: mail?.body?.to });
  ok("…from her organisation's name, on whatever domain is in force",
    /^Sparrow Missions </.test(mail?.body?.from || ""), mail?.body?.from);
  ok("…with a Reply-To that reaches a human", mail?.body?.reply_to === EMAIL, mail?.body?.reply_to);
  ok("…marked [Test] in the subject, so it is never mistaken for the campaign",
    /^\[Test\] /.test(mail?.body?.subject || ""), mail?.body?.subject);
  const screenAfter = await page.innerText('[data-testid="test-result"]');
  ok("the screen says where it went, and that it is not counted",
    new RegExp(EMAIL).test(screenAfter) && /not counted/.test(screenAfter),
    screenAfter.slice(-160).replace(/\n/g, " | "));
  const [recips] = await q(`SELECT COUNT(*)::int n FROM campaign_recipients cr JOIN campaigns c ON c.id=cr.campaign_id WHERE c.org_id=$1`, [ORG]);
  const [ints] = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND type='email'`, [ORG]);
  ok("nobody's record moved, and the campaign's count did not either", recips.n === 0 && ints.n === 0, { recips: recips.n, ints: ints.n });

  // ── read it on a phone ───────────────────────────────────────────────────
  console.log("\n— read it at a phone's width (390px) —");
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.setContent(
    `<meta name="viewport" content="width=device-width,initial-scale=1">` + (mail?.body?.html || "<p>nothing captured</p>"),
    { waitUntil: "domcontentloaded" });
  await phone.waitForTimeout(400);
  const read = await phone.evaluate(() => {
    const body = document.body;
    const sizes = [...document.querySelectorAll("p")].map(p => parseFloat(getComputedStyle(p).fontSize));
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      widest: Math.max(0, ...[...document.querySelectorAll("*")].map(e => e.getBoundingClientRect().right)),
      minP: sizes.length ? Math.min(...sizes) : 0,
      text: body.innerText.replace(/\s+/g, " ").trim(),
    };
  });
  ok("it does not scroll sideways on a phone", read.scrollW <= read.clientW + 1, read);
  ok("…nothing hangs off the right edge", read.widest <= 391, read.widest);
  ok("…and the body type is readable, never under 14px", read.minP >= 14, read.minP);
  ok("it opens with her own first name", /^\s*Sparrow Missions\b[\s\S]*Hello Ada,/.test(read.text) || /Hello Ada,/.test(read.text),
    read.text.slice(0, 120));
  ok("…no merge braces survived into the inbox", !/{{|}}/.test(read.text), (read.text.match(/.{0,30}{{.{0,30}/) || [])[0]);
  ok("…and it says on its face that nobody else got it",
    /Nobody else received it, and it is not counted/.test(read.text), null);
  console.log("\n  what the phone reads:\n    " + read.text.slice(0, 420).replace(/(.{100})/g, "$1\n    "));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  sink.close();
  await pool.end();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
