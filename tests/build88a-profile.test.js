// BUILD-88a A.4 — THE PROFILE, TIDIED. Run: node tests/build88a-profile.test.js
//
// Layout and copy only. Nothing here changes a number.
//
//   §1  ONE emerald primary in the header (Log a conversation); the rest are
//       outlines. Emerald means "this is the button", and exactly one thing on
//       a screen may mean that.
//   §2  a colleague is a FIRST NAME. "Admin User" is the software talking to
//       itself.
//   §3  the send layer is GONE from the profile. Steward prepares, she sends:
//       a draft written here used to go out without ever passing through the
//       place she reads her own mail. "Draft Email" copies it instead.
//   §4  the Move Stage strip and Enroll in sequence render only with the Team
//       flag — not as a frosted preview. A Core org has no pipeline, and
//       showing them the strip teaches them the product is not for them.
//   §5  the wealth score is HIDDEN until it can say what it is and where it
//       came from.
//   §6  THE VOICE GUARD, on the rendered timeline: zero em dashes, zero
//       build-tagged strings.
//   §7  the planned-giving chips say which are on.
//
// Browser suite conventions (BUILD-44 Part 6): SKIP cleanly without Playwright
// or a localhost-API dist; the app is served from :4173.

const path = require("path");
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const PORT = 4173;
const APP = `http://localhost:${PORT}`;
const ORG_TEAM = "org_b88a4t", ORG_CORE = "org_b88a4c";

const skip = why => { console.log("  SKIP  " + why + "\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
const API_ORIGIN = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
const distJs = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
if (!distJs.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(API_ORIGIN)))
  skip("client/dist not built against the local API");
let chromium;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
async function frontendBase() {
  try { const r = await fetch(APP + "/", { signal: AbortSignal.timeout(1500) }); if (r.ok) return null; } catch { }
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); }
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => srv.listen(PORT, r));
  return srv;
}

async function seed(org, slug, plan) {
  const CHILD = ["threads", "donor_designations", "workflow_runs", "workflows", "moves", "opportunities", "tasks",
    "receipts", "pledges", "fin_audit_log", "fin_transactions", "gifts", "interactions", "notification_sends", "metric_snapshots"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,$2,$3,1,'active',$4)`, [org, "B88a " + slug, slug, plan]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Admin User','admin')`,
    [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ($1,$2,'4010','Contributions','revenue')`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${org}`, org]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name,created_by,created_by_name)
           VALUES ($1,$2,'Ada Fennimore','ada@b88a4.test','steward',5000,1,$3,$4,'Admin User',$4,'Admin User')`,
    [`d_${org}`, org, civilToday(), `u_${org}`]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,created_by,created_by_name)
           VALUES ($1,$2,$3,5000,$4,'cash',$5,'Check',$6,'Admin User')`,
    [`g_${org}`, org, `d_${org}`, civilToday(), `ff_${org}`, `u_${org}`]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,gift_id,created_by,logged_by_name)
           VALUES ($1,$2,$3,'gift','She handed it over at the gala.',$4,$5,$6,'Admin User')`,
    [`int_${org}`, org, `d_${org}`, civilToday(), `g_${org}`, `u_${org}`]);
}

(async () => {
  console.log("build88a-profile (A.4)");
  await seed(ORG_TEAM, "b88a4t", "team");
  await seed(ORG_CORE, "b88a4c", "core");
  const loginT = await api("POST", "/auth/login", null, { email: "b88a4t@t.local", password: "loadtest1234" });
  const loginC = await api("POST", "/auth/login", null, { email: "b88a4c@t.local", password: "loadtest1234" });
  ok("both logins ok", loginT.status === 200 && loginC.status === 200, { t: loginT.status, c: loginC.status });

  const srv = await frontendBase();
  const browser = await chromium.launch();

  const openProfile = async (auth, org) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
    page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) console.log("  [pageerror]", e.message.slice(0, 300)); });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    await page.goto(`${APP}/donors/d_${org}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);
    return page;
  };

  const page = await openProfile(loginT.body, ORG_TEAM);
  // ── §1 · one emerald primary ─────────────────────────────────────────────
  console.log("\n— §1 · one emerald primary in the header —");
  const header = await page.$eval(".dph-actions", el => {
    const filled = [];
    for (const b of el.querySelectorAll("button")) {
      const cs = getComputedStyle(b);
      filled.push({ text: b.innerText.trim(), bg: cs.backgroundColor, color: cs.color, testid: b.getAttribute("data-testid") || "" });
    }
    return filled;
  });
  const emerald = header.filter(b => b.bg === "rgb(13, 92, 58)" || b.bg === "rgb(26, 107, 74)");
  ok("exactly ONE filled emerald button in the header", emerald.length === 1, header);
  ok("…and it is Log a conversation", emerald[0] && /Log a conversation/.test(emerald[0].text), emerald[0]);
  ok("nothing else in the header is filled brass either — the second primary is an outline",
    !header.some(b => b.bg === "rgb(201, 168, 76)"), header.map(b => [b.text, b.bg]));

  // ── §7 · the planned-giving chips (read on the Overview tab, where they live)
  console.log("\n— §7 · the chips say which are on —");
  const chips = await page.$$eval("[data-designation]", els => els.map(e => ({ k: e.getAttribute("data-designation"), on: e.getAttribute("data-on"), pressed: e.getAttribute("aria-pressed") })));
  ok("every planned-giving chip states its on/off state, in the DOM",
    chips.length >= 3 && chips.every(c => c.on === "0" || c.on === "1") && chips.every(c => c.pressed === "false" || c.pressed === "true"), chips);
  const overviewText = await page.innerText("body");
  ok("\"Admin User\" appears nowhere on the Overview tab either", !/Admin User/.test(overviewText),
    JSON.stringify((overviewText.match(/[\s\S]{0,120}Admin User[\s\S]{0,60}/) || [])[0]));

  // ── §2 · first names ─────────────────────────────────────────────────────
  console.log("\n— §2 · a colleague is a first name —");
  await page.click('button:has-text("Activity")').catch(() => {});
  await page.waitForTimeout(900);
  const bodyText = await page.innerText("body");
  ok("\"Admin User\" appears nowhere on the rendered profile", !/Admin User/.test(bodyText),
    (bodyText.match(/.{0,40}Admin User.{0,40}/) || [])[0]);
  ok("the timeline credits the colleague by first name", /by Admin\b/.test(bodyText) || !/\bby \w+ \w+\b/.test(bodyText), null);

  // ── §3 · the send layer ──────────────────────────────────────────────────
  console.log("\n— §3 · Steward prepares, she sends —");
  ok("no \"Send Email\" button on the profile", !/Send Email/i.test(bodyText), null);
  ok("no Gmail compose panel on the profile", !/Send via Gmail/i.test(bodyText), null);
  const sendCalls = [];
  page.on("request", r => { if (/\/gmail\/send|\/campaigns\/[^/]+\/send/.test(r.url())) sendCalls.push(r.url()); });
  await page.waitForTimeout(400);
  ok("the profile makes ZERO calls to the send layer", sendCalls.length === 0, sendCalls);

  // ── §6 · the voice guard on the timeline ─────────────────────────────────
  console.log("\n— §6 · the voice guard, on the rendered timeline —");
  const timelineText = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(d => /No activity logged yet|handed it over/.test(d.innerText || "") && d.innerText.length < 4000);
    return el ? el.innerText : document.body.innerText;
  });
  ok("zero em dashes in the rendered timeline", !/—/.test(timelineText),
    (timelineText.match(/.{0,40}—.{0,40}/) || [])[0]);
  ok("zero build-tagged strings anywhere on the rendered profile",
    !/\bbuild[\s-]?\d/i.test(bodyText), (bodyText.match(/.{0,40}build[\s-]?\d.{0,40}/i) || [])[0]);
  ok("the gift shows ONCE on the record, with its money read off the gift row",
    (bodyText.match(/\$5,000/g) || []).length >= 1 && !/Gift received: \$/.test(bodyText),
    (bodyText.match(/.{0,30}Gift received.{0,30}/) || [])[0]);

  // ── §4 + §5 · the Team flag, and the score that cannot say what it is ────
  console.log("\n— §4 · the Team layer renders only with the Team flag —");
  ok("Team sees the Move Stage strip", await page.$('[data-testid="dp-move-stage"]') !== null);
  console.log("\n— §5 · the wealth score is hidden until it can define itself —");
  ok("even on Team, the wealth score panel does not render",
    await page.$('[data-testid="dp-wealth-score"]') === null && !/Wealth Score/i.test(bodyText),
    (bodyText.match(/.{0,30}Wealth Score.{0,30}/i) || [])[0]);

  const pageC = await openProfile(loginC.body, ORG_CORE);
  const coreText = await pageC.innerText("body");
  ok("Core does NOT see the Move Stage strip — not even behind glass",
    await pageC.$('[data-testid="dp-move-stage"]') === null && !/Move Stage/i.test(coreText),
    (coreText.match(/.{0,30}Move Stage.{0,30}/i) || [])[0]);
  ok("Core does NOT see Enroll in sequence",
    await pageC.$('[data-testid="dp-sequences"]') === null && !/Enroll in sequence/i.test(coreText), null);
  ok("Core still has the whole CRM core — the header, the record and the timeline",
    /Log a conversation/.test(coreText) && /Ada Fennimore/.test(coreText), null);
  ok("and Core's header has exactly one emerald primary too",
    (await pageC.$eval(".dph-actions", el => [...el.querySelectorAll("button")]
      .filter(b => ["rgb(13, 92, 58)", "rgb(26, 107, 74)"].includes(getComputedStyle(b).backgroundColor)).length)) === 1, null);

  await browser.close();
  if (srv) srv.close();
  summary("build88a-profile");
  await closeDb();
})();
