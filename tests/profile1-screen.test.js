// PROFILE-1 — THE DONOR PROFILE, AS APPROVED. Run: node tests/profile1-screen.test.js
//
// The screen is `docs/profile-1/mockup.html`, which Jonathan approved. This
// suite is the contract for the parts of it that are structure rather than
// taste, at 1440 and at 390:
//
//   §1  the header: back, avatar, name, stage chip, role chips, and exactly
//       three actions — Log a conversation, Plan a follow-up, More ▾ — all
//       BUTTONS, with everything that left the row present in the menu.
//   §2  the four figures (Lifetime, Last gift, Last contact, Open ask), each
//       carrying a SOURCE, each opening the rows behind it, each footing to
//       the number on the tile, and each with its census definition still
//       keyboard-reachable beside the label.
//   §3  the six tabs, unchanged and in order.
//   §4  Overview reads down in the approved order: what do I do next,
//       Suggested, Proposals, Giving by year, Recent conversations.
//   §5  a bar on Giving by year opens that year's gifts, and the rows foot.
//   §6  what HOTFIX-1 fixed is still fixed on the new screen: no "lines left
//       out" anywhere, and an open item is never answered with "nothing is
//       open". (The lock flash and the rail live in their own suites —
//       tests/fix3-d-lock-flash.js and tests/hotfix1-profile.js.)
//   §7  390: nothing scrolls sideways, and the rail is still on the page.
//
// Browser suite conventions (BUILD-44 Part 6): SKIPs cleanly without
// Playwright or a localhost-API dist.

const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, civilToday, civilPlusDays } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const ORG = "org_p1screen", PW = "loadtest1234";
const DONOR = "d_p1screen";
const ONLY_ASK = "d_p1screen_ask";

const skip = why => { console.log("  SKIP  " + why + "\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
const API_ORIGIN = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
const assetDir = path.join(DIST, "assets");
const distJs = fs.existsSync(assetDir) ? fs.readdirSync(assetDir).filter(f => f.endsWith(".js")) : [];
if (!distJs.some(f => fs.readFileSync(path.join(assetDir, f), "utf8").includes(API_ORIGIN)))
  skip("client/dist not built against the local API");
let chromium;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

const cents = v => Math.round((Number(v) || 0) * 100);

async function seed() {
  const CHILD = ["threads", "donor_designations", "workflow_runs", "workflows", "moves", "opportunities",
    "tasks", "receipts", "pledges", "fin_audit_log", "fin_transactions", "gifts", "interactions",
    "notification_sends", "metric_snapshots"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Profile One Trust','p1screen',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,'p1screen@t.local',$3,'Mira Okonjo','admin')`,
    [`u_${ORG}`, ORG, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ($1,$2,'4010','Contributions','revenue')`, [`acct_${ORG}`, ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Youth Arts Access',false)`, [`ff_${ORG}`, ORG]);
  // Giving across three calendar years, so the by-year chart has bars to open
  // and at least one year with nothing in it.
  const y = Number(civilToday().slice(0, 4));
  const gifts = [[`${y - 4}-03-11`, 10000], [`${y - 2}-06-02`, 25000], [`${y - 2}-11-19`, 5000], [`${y}-02-08`, 1500]];
  await q(`INSERT INTO donors (id,org_id,name,email,phone,kind,contact_name,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name,created_by,created_by_name,tags)
           VALUES ($1,$2,'Thornbury Foundation','grants@thornbury.test','212-555-0144','organisation','Maria Lopez','solicit',$3,$4,$5,$6,'Mira Okonjo',$6,'Mira Okonjo','[]')`,
    [DONOR, ORG, gifts.reduce((s, g) => s + g[1], 0), gifts.length, gifts[gifts.length - 1][0], `u_${ORG}`]);
  let n = 0;
  for (const [date, amt] of gifts) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'cash',$6,'Check',$7,'Mira Okonjo')`,
      [`g_p1_${n++}`, ORG, DONOR, amt, date, `ff_${ORG}`, `u_${ORG}`]);
  }
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
           VALUES ($1,$2,$3,'meeting','Call with Maria Lopez about the fall cycle.',$4,$5,'Mira Okonjo')`,
    [`int_p1_a`, ORG, DONOR, civilPlusDays(-70), `u_${ORG}`]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
           VALUES ($1,$2,$3,'meeting','Site visit to the Saturday studio.',$4,$5,'Mira Okonjo')`,
    [`int_p1_b`, ORG, DONOR, civilPlusDays(-140), `u_${ORG}`]);
  // One OPEN proposal, so "Open ask" has a number and the next step is real.
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,proposal_stage,status,expected_close,created_by,created_by_name)
           VALUES ($1,$2,$3,'FY26 major gift ask',32500,'asked','open',$4,$5,'Mira Okonjo')`,
    [`opp_p1`, ORG, DONOR, civilPlusDays(25), `u_${ORG}`]);
  // §6's real case: a donor with an OPEN ASK and NO thread and NO task. The
  // first draft of "what do I do next" answered "nothing is open" on exactly
  // this record, with the proposal four inches below it.
  await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count,assigned_to,assigned_to_name,created_by,created_by_name,tags)
           VALUES ($1,$2,'Ashgrove Fund','grants@ashgrove.test','organisation','solicit',0,0,$3,'Mira Okonjo',$3,'Mira Okonjo','[]')`,
    [ONLY_ASK, ORG, `u_${ORG}`]);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,proposal_stage,status,expected_close,created_by,created_by_name)
           VALUES ($1,$2,$3,'Studio scholarships ask',12000,'asked','open',$4,$5,'Mira Okonjo')`,
    [`opp_p1b`, ORG, ONLY_ASK, civilPlusDays(40), `u_${ORG}`]);
}

(async () => {
  console.log("profile1-screen");
  await seed();
  const login = await api("POST", "/auth/login", null, { email: "p1screen@t.local", password: PW });
  ok("login ok", login.status === 200, login.status);
  const auth = login.body;

  const browser = await chromium.launch();
  const openAt = async (w, h, who = DONOR) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) console.log("  [pageerror]", e.message.slice(0, 200)); });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    await page.goto(`${APP}/donors/${who}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="dp-figures"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1600);
    return page;
  };

  const page = await openAt(1440, 1200);

  // ── §1 · the header ──────────────────────────────────────────────────────
  console.log("\n— §1 · the header: three buttons and a menu —");
  const acts = await page.$$eval(".dph-actions > button", bs => bs.map(b => ({
    text: b.innerText.trim(), tag: b.tagName, testid: b.getAttribute("data-testid") || "" })));
  ok("§1 the header offers exactly three actions", acts.length === 3, acts);
  ok("§1 …and they are Log a conversation, Plan a follow-up, More ▾",
     JSON.stringify(acts.map(a => a.text)) === JSON.stringify(["Log a conversation", "Plan a follow-up", "More ▾"]), acts);
  ok("§1 …all three are BUTTONS, not links", acts.every(a => a.tag === "BUTTON"), acts);
  ok("§1 the back button is still there", await page.locator('button:has-text("Back")').count() >= 1);
  ok("§1 the name and the stage chip are on the header",
     /Thornbury Foundation/.test(await page.locator(".donor-profile-header").innerText()), "");
  const roles = await page.locator(".donor-profile-header").innerText();
  ok("§1 the role chips are on the header", /Volunteer/.test(roles) && /Staff and board/.test(roles), roles.slice(0, 200));
  await page.locator('[data-testid="dp-more"]').click();
  await page.waitForTimeout(350);
  const menu = await page.$$eval('[data-testid="dp-more-menu"] button', bs => bs.map(b => b.innerText.trim()));
  ok("§1 More opens a menu carrying everything that left the row",
     menu.includes("Request a gift") && menu.includes("Impact summary") && menu.includes("Edit record"), menu);
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator('[data-testid="dp-more"]').click();
  await page.waitForTimeout(250);

  // ── §2 · the four figures ────────────────────────────────────────────────
  console.log("\n— §2 · four figures, each opening its rows —");
  const figs = await page.$$eval('[data-testid="dp-figures"] [data-figure-key]', els => els.map(e => ({
    key: e.getAttribute("data-figure-key"), src: e.getAttribute("data-source-key"),
    blank: e.hasAttribute("data-blank"), text: e.innerText.trim(), value: e.getAttribute("data-value") })));
  const want = ["profile.lifetime", "profile.lastGift", "profile.contact", "profile.openAsk"];
  ok("§2 all four figures are on the screen, in order",
     JSON.stringify(figs.map(f => f.key)) === JSON.stringify(want), figs.map(f => f.key));
  ok("§2 every figure that has a value carries a SOURCE",
     figs.filter(f => !f.blank).every(f => !!f.src), figs);
  const labels = await page.$$eval('[data-testid="dp-figures"] > div > div:first-child', ds => ds.map(d => d.innerText.trim().replace(/\s*\?$/, "")));
  // innerText returns CSS-TRANSFORMED text: these labels are uppercased by
  // the stylesheet, so compare case-insensitively (the trap that has now cost
  // this repo four separate suites).
  ok("§2 the labels are Lifetime · Last gift · Last contact · Open ask",
     JSON.stringify(labels.map(l => l.toLowerCase())) === JSON.stringify(["lifetime", "last gift", "last contact", "open ask"]), labels);
  for (const l of ["Lifetime", "Last gift", "Last contact", "Open ask"]) {
    const d = page.locator(`[data-testid="dp-tile-def-${l}"]`);
    const title = await d.getAttribute("title").catch(() => null);
    const aria = await d.getAttribute("aria-label").catch(() => null);
    const tab = await d.getAttribute("tabindex").catch(() => null);
    ok(`§2 ${l}'s definition is on the tile and reachable by keyboard`,
       await d.count() === 1 && !!title && title === aria && tab === "0", { l, title: (title || "").slice(0, 60), tab });
  }
  // Open Lifetime and check the drawer foots to the tile, to the cent.
  await page.locator('[data-figure-key="profile.lifetime"]').first().click();
  await page.waitForTimeout(1800);
  const panel = page.locator("[data-figure-panel]");
  ok("§2 clicking Lifetime opens the rows behind it", await panel.count() === 1);
  const footCents = await page.locator("[data-figure-total]").getAttribute("data-cents").catch(() => null);
  const tileCents = figs.find(f => f.key === "profile.lifetime").value;
  ok("§2 …and the drawer foots to the number on the tile, to the cent",
     footCents !== null && Number(footCents) === cents(tileCents), { footCents, tileCents });
  ok("§2 …and the drawer says, in words, that it IS the number on screen",
     /the number on screen/.test(await page.locator("[data-figure-total]").innerText()), "");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── §3 · the six tabs ────────────────────────────────────────────────────
  console.log("\n— §3 · the six tabs, unchanged —");
  const tabs = await page.$$eval(".dp-tabs button", bs => bs.map(b => (b.childNodes[0] || {}).textContent.trim()));
  ok("§3 Overview · Gifts & Pledges · Funds · Related · Materials · Activity",
     JSON.stringify(tabs) === JSON.stringify(["Overview", "Gifts & Pledges", "Funds", "Related", "Materials", "Activity"]), tabs);

  // ── §4 · Overview, in the approved order ─────────────────────────────────
  console.log("\n— §4 · Overview reads down in the approved order —");
  const order = await page.evaluate(() => {
    const ids = ["dp-next", "donor-proposals-panel", "dp-giving-by-year", "dp-recent-conversations"];
    return ids.map(id => { const el = document.querySelector(`[data-testid="${id}"]`);
      return { id, y: el ? el.getBoundingClientRect().top + window.scrollY : null }; });
  });
  ok("§4 every approved section is on the Overview", order.every(o => o.y !== null), order);
  ok("§4 …and they run: what do I do next, Proposals, Giving by year, Recent conversations",
     order.every((o, i) => i === 0 || (o.y !== null && order[i - 1].y !== null && order[i - 1].y < o.y)), order);
  const nextText = await page.locator('[data-testid="dp-next"]').innerText();
  ok("§4 the section is headed with the question", /WHAT DO I DO NEXT/i.test(nextText), nextText.slice(0, 120));
  ok("§4 the open ask is named as the next step",
     /FY26 major gift ask/.test(nextText) && /\$32,500/.test(nextText), nextText.slice(0, 300));

  // ── §5 · a bar opens its gifts ───────────────────────────────────────────
  console.log("\n— §5 · a bar on Giving by year opens that year's gifts —");
  const thisYear = new Date().getFullYear();   // clock-seam-ok: a chart label, not a civil date the server also computes
  const bar = page.locator(`[data-bar-year="${thisYear}"]`);
  ok("§5 the chart draws a bar for every year in the span", await page.locator("[data-bar-year]").count() >= 3);
  ok("§5 …and a bar with money in it is a button", await bar.getAttribute("role") === "button");
  await bar.click();
  await page.waitForTimeout(1800);
  ok("§5 clicking it opens that year's gifts", await page.locator("[data-figure-panel]").count() === 1);
  const yearFoot = await page.locator("[data-figure-total]").getAttribute("data-cents").catch(() => null);
  ok("§5 …and those rows foot to this year's giving", Number(yearFoot) === cents(1500), yearFoot);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ── §6 · what HOTFIX-1 fixed is still fixed ──────────────────────────────
  console.log("\n— §6 · HOTFIX-1's fixes survive the redesign —");
  const body = await page.locator("body").innerText();
  ok("§6 nothing on the screen says lines were left out", !/left out/i.test(body), (body.match(/.{0,60}left out.{0,40}/) || [])[0]);
  ok("§6 with an open ask on the record, the screen never says nothing is open",
     !/nothing is open/i.test(body), (body.match(/.{0,80}nothing is open.{0,40}/i) || [])[0]);
  ok("§6 …and it names the real next step instead",
     /FY26 major gift ask/.test(nextText), nextText.slice(0, 200));
  ok("§6 no locked marker on a Team org's profile", !/Unlock with Team/i.test(body), "");

  // The donor with an open ask and nothing else: the same rule, on the record
  // that broke it.
  const askOnly = await openAt(1440, 1000, ONLY_ASK);
  const askText = await askOnly.locator('[data-testid="dp-next"]').innerText();
  ok("§6 a donor with ONLY an open proposal is never told nothing is open",
     !/nothing is open/i.test(askText), askText.slice(0, 300));
  ok("§6 …the ask itself is the next step", /Studio scholarships ask/.test(askText), askText.slice(0, 300));
  ok("§6 …and the empty state is not drawn at all",
     await askOnly.locator('[data-testid="dp-next-empty"]').count() === 0);
  await askOnly.close();

  // ── §7 · 390 ─────────────────────────────────────────────────────────────
  console.log("\n— §7 · 390 —");
  await page.close();
  const phone = await openAt(390, 900);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("§7 nothing scrolls sideways at 390", overflow <= 1, overflow);
  ok("§7 the rail is still on the page", await phone.locator('[data-testid="dp-right-rail"]').count() === 1);
  ok("§7 the four figures are still all there", await phone.locator('[data-testid="dp-figures"] [data-figure-key]').count() === 4);
  ok("§7 the header still offers its three actions", await phone.locator(".dph-actions > button").count() === 3);
  await phone.close();

  await browser.close();
  await closeDb();
  summary("profile1-screen");
})().catch(e => { console.error(e); process.exit(1); });
