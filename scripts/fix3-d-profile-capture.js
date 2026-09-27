// FIX-3 finding 10 — capture TODAY's donor profile and the two mockup
// directions, at 1440 and 390, into docs/fix-3/profile/.
//
//   BASE=http://localhost:5941 APP_URL=http://localhost:4541 DATABASE_URL=… \
//   NODE_PATH=~/steward-qa/node_modules node scripts/fix3-d-profile-capture.js [today|mockups|all]
//
// Today's profile is drawn on a fixture org it creates (org_fx3dprof), never
// the demo: a major-gift prospect with an open proposal, a cultivation plan,
// giving history, conversations, a sequence and custom fields. The mockups
// are static HTML (docs/fix-3/profile/mockups/*.html) rendered from disk.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const OUT = path.join(root, "docs/fix-3/profile");
const what = process.argv[2] || "all";
const ORG = "org_fx3dprof", EMAIL = "fx3dprof@example.org", PW = "loadtest1234", DONOR = "d_fx3dprof";

async function seedToday(h) {
  const bcrypt = require("bcryptjs");
  for (const t of ["sequence_enrollments", "proposals", "cultivation_plans", "cultivation_templates", "threads", "interactions", "gifts", "tasks", "donors", "custom_field_defs", "fin_audit_log", "users"])
    await h.q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await h.q(`DELETE FROM sequences WHERE org_id=$1`, [ORG]).catch(() => {});
  await h.q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await h.q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,mission) VALUES ($1,'Riverbend Music School','fx3d-prof',1,'team','active','Music lessons for every child in the valley, whatever their family can pay.')`, [ORG]);
  await h.q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx3dprof',$1,$2,$3,'Maya Okafor','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  const d = n => h.civilPlusDays(-n);
  await h.q(`INSERT INTO donors (id,org_id,name,email,phone,stage,status,total_giving,gift_count,last_gift_date,first_gift_date,assigned_to,assigned_to_name,tags,notes,person_types)
             VALUES ($1,$2,'Eleanor Whitcombe','eleanor.whitcombe@example.org','555-0142','cultivate','active',41500,6,$3,$4,'u_fx3dprof','Maya Okafor',
                     '["board prospect","piano"]','Retired surgeon; her granddaughter took lessons here. Prefers a call to email.','["donor","volunteer"]')`,
    [DONOR, ORG, d(70), d(1400)]);
  const gifts = [[1400, 2500], [1050, 5000], [700, 7500], [400, 10000], [160, 1500], [70, 15000]];
  for (const [i, [ago, amt]] of gifts.entries())
    await h.q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'check','u_fx3dprof','Maya Okafor')`,
      [`g_fx3dprof_${i}`, ORG, DONOR, amt, d(ago)]);
  const tok = await h.login(EMAIL, PW);
  const say = (label, r) => { if (!(r.status >= 200 && r.status < 300)) console.log(`  ${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r; };
  say("conversation 1", await h.api("POST", `/donors/${DONOR}/conversations`, tok, { touch: "meeting", line: "Lunch at the school; she asked how the scholarship fund works.", nextStep: { skipped: true } }));
  say("conversation 2", await h.api("POST", `/donors/${DONOR}/conversations`, tok,
    { touch: "call_reached", line: "Said she would like to see a proposal before the spring recital.", nextStep: { type: "follow_up", label: "Send the scholarship proposal", due: h.civilPlusDays(5) } }));
  say("proposal", await h.api("POST", `/donors/${DONOR}/proposals`, tok, { purpose: "Named scholarship fund", askAmount: "50000", stage: "cultivating", expectedClose: h.civilPlusDays(75), probability: 75 }));
  const tpl = say("template", await h.api("POST", "/cultivation-templates", tok, { name: "Major gift, first ask", steps: [
    { type: "follow_up", label: "Invite her to a studio lesson", offsetDays: 7 },
    { type: "send", label: "Send the scholarship proposal", offsetDays: 21 },
    { type: "check_in_ask", label: "Ask for the named scholarship", offsetDays: 60 }] }));
  if (tpl.body && tpl.body.id) say("plan", await h.api("POST", `/donors/${DONOR}/plan`, tok, { templateId: tpl.body.id }));
  const seq = say("sequence", await h.api("POST", "/sequences", tok, { name: "Major donor stewardship", steps: [{ delayDays: 0, subject: "Thank you", body: "Dear {{first_name}}, thank you." }, { delayDays: 30, subject: "A note from the studio", body: "Hello {{first_name}}." }] }));
  if (seq.body && seq.body.id) say("enroll", await h.api("POST", `/sequences/${seq.body.id}/enroll`, tok, { donorId: DONOR }));
  const f1 = say("cf1", await h.api("POST", "/custom-fields", tok, { entity: "donor", label: "Spouse", type: "text" }));
  const f2 = say("cf2", await h.api("POST", "/custom-fields", tok, { entity: "donor", label: "Instrument", type: "text" }));
  const f3 = say("cf3", await h.api("POST", "/custom-fields", tok, { entity: "donor", label: "Board interest", type: "select", options: ["Yes", "Maybe", "No"] }));
  const vals = {};
  if (f1.body.key) vals[f1.body.key] = "Harold Whitcombe";
  if (f2.body.key) vals[f2.body.key] = "Piano";
  if (f3.body.key) vals[f3.body.key] = "Maybe";
  say("cf values", await h.api("PUT", `/donors/${DONOR}/custom-fields`, tok, { values: vals }));
}

async function captureToday(browser, h) {
  const lr = await h.api("POST", "/auth/login", null, { email: EMAIL, password: PW });
  for (const [w, hgt] of [[1440, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lr.body.token, JSON.stringify(lr.body.user), JSON.stringify(lr.body.org)]);
    await page.goto(`${process.env.APP_URL}/donors/${DONOR}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".donor-stat-grid", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `today-${w}.png`) });
    // "Full page": the profile is a fixed takeover with its own scrolling
    // panes, so let every pane run to its full height and grow the viewport.
    const full = await page.evaluate(() => {
      const el = document.querySelector(".fullscreen-takeover");
      if (!el) return 0;
      el.style.position = "static"; el.style.overflow = "visible";
      el.querySelectorAll("*").forEach(n => { const cs = getComputedStyle(n); if (/(auto|scroll|hidden)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) { n.style.overflow = "visible"; n.style.height = "auto"; n.style.maxHeight = "none"; } });
      const body = el.querySelector(".donor-profile-body"); if (body) { body.style.overflow = "visible"; body.style.height = "auto"; }
      return el.scrollHeight + 60;
    });
    await page.setViewportSize({ width: w, height: Math.min(Math.max(full, hgt), 9000) });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `today-${w}-full.png`), fullPage: true });
    await ctx.close();
  }
}

async function captureMockups(browser) {
  for (const dir of ["direction-1", "direction-2"]) {
    const file = "file://" + path.join(OUT, "mockups", dir + ".html");
    for (const [w, hgt] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: hgt } });
      await page.goto(file, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${dir}-${w}.png`) });
      await page.screenshot({ path: path.join(OUT, `${dir}-${w}-full.png`), fullPage: true });
      // The management drawer and the More menu, opened, so the reader sees
      // that nothing was dropped (collapsed is not deleted).
      const opened = await page.evaluate(() => {
        let n = 0;
        document.querySelectorAll("details").forEach(d => { d.open = true; n++; });
        document.querySelectorAll("[data-open-for-capture]").forEach(el => { el.classList.add("is-open"); n++; });
        return n;
      });
      if (opened) {
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(OUT, `${dir}-${w}-full-open.png`), fullPage: true });
      }
      await page.close();
    }
  }
}

(async () => {
  const { chromium } = require("playwright");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  if (what === "today" || what === "all") {
    const h = require("../tests/helpers");
    await seedToday(h);
    await captureToday(browser, h);
    await h.closeDb();
  }
  if (what === "mockups" || what === "all") await captureMockups(browser);
  await browser.close();
  console.log("captured into", OUT);
})().catch(e => { console.error(e); process.exit(1); });
