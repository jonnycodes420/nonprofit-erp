// tests/hotfix-rhythm.test.js · HOTFIX-RHYTHM. "SEE WHO" OPENS ITS LIST, AND A
// DUPLICATE IS A REAL DUPLICATE.
//
// A real customer, about 6,400 people imported: Home's "What your history
// shows: 25 are now late for their own rhythm" → See who → the underlined 25
// bounced to Home, Home showed nothing, and the tab stopped answering. The
// same import said it "left 4093 possible duplicates".
//
//   §dup    the duplicate rule on a made-up 6,200-person file
//           (tests/lib/dupFixture.js: most with no email, placeholders such as
//           "n/a" and 000-000-0000, households at one address, a shared office
//           line) flags exactly the planted duplicates, and nothing for
//           blank or placeholder pairs or same-address households
//   §links  in a browser, on a 6,000+ person org: See who, then the count,
//           lands on a list of exactly the card's number of people, on Home's
//           own address, the page still answers, fewer than 3 navigations
//
// HOW IT GOES RED ON MAIN (0f10f79): §dup (136 pairs on the fixture, 112 of
// them placeholders, the office line or name-only strangers); §links (the
// readout panel is its own React root with no router, so the count's list
// throws, the panel's host is gone, and a second See who polls forever).
// Planted on this branch: the list's empty state redirecting to /app is red
// on §links.
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, q, BASE, browserLegOrSkip } = require("./helpers");
const { pinBrowserClock } = require("./lib/browserClock");
const { civilDay } = require("./clock");
const FX = require("./lib/dupFixture");
const DH = require("../dataHealth");

const APP = process.env.APP_URL || "http://localhost:4173";
const ORG = { id: "org_rhythmfx", slug: "rhythmfx", name: "Kestrel Lantern Arts Collective", tier: "medium", n: 4, donors: 6200, gifts: 9000, interactions: 1000, tasks: 60, subs: 10, users: 1 };
const EMAIL = `admin@${ORG.slug}.load`, PASSWORD = "loadtest1234";
const RO_ID = "ro_rhythmfx_first";
const LATE = 25;

// THE GUARD: no link on Home points at an address that redirects back to Home.
// A bare /app is not an app address (it falls to "*" → "/" → /dashboard and
// remounts Home), and the Agent page's addresses land on Home (AGENT-5).
function homeLinkGuard() {
  const fs = require("fs");
  const dir = path.join(__dirname, "../client/src/components/home");
  const files = [...fs.readdirSync(dir).map(f => path.join(dir, f)), path.join(__dirname, "../client/src/components/Dashboard.jsx")];
  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/href=\{?["'`]\/(app)?["'`]\}?|href=\{?["'`]\/app\?|tabHref\(\s*["']agent["']|navigate\(\s*["']\/app["']/.test(line)) bad.push(`${path.basename(f)}:${i + 1}`);
    });
  }
  ok("§links no Home link points at an address that redirects back to Home (/app, /, the Agent page)", bad.length === 0, bad);
}

async function dupLeg() {
  const { nearDuplicate } = await import("../shared/nearNames.js");
  const F = FX.build();
  const { pairs, families } = DH.findPairs(F.rows, { orgId: F.orgId, near: nearDuplicate });
  const planted = new Set(F.planted);
  const by = new Map(F.rows.map(r => [r.id, r]));
  const extra = pairs.filter(p => !planted.has(p.key));
  const show = p => [by.get(p.a), by.get(p.b)].map(d => `${d.name} <${d.email ?? ""}> ${d.phone ?? ""}`).join(" / ") + " : " + p.reasons.join("; ");
  ok(`§dup the fixture is real-shaped (${F.rows.length} people, ${F.rows.filter(d => !String(d.email || "").includes("@")).length} with no real email)`,
    F.rows.length >= 6000 && F.rows.filter(d => !String(d.email || "").includes("@")).length > F.rows.length / 2);
  ok(`§dup every planted duplicate is found (${pairs.filter(p => planted.has(p.key)).length} of ${planted.size})`,
    F.planted.every(k => pairs.some(p => p.key === k)));
  ok(`§dup nothing else is flagged (${extra.length} extra of ${pairs.length})`, extra.length === 0, extra.slice(0, 8).map(show));
  // the shapes one by one, so a regression names itself
  const blank = (x, y) => DH.judgePair({ id: "a", name: "Mary Okafor", ...x }, { id: "b", name: "Mary Okafor", ...y });
  const placeholders = [...FX.PLACEHOLDER_EMAILS.map(e => [{ email: e }, { email: e }]), ...FX.PLACEHOLDER_PHONES.map(p => [{ phone: p }, { phone: p }]),
    [{ email: "" }, { email: "  " }], [{ phone: "" }, { phone: null }]];
  const hits = placeholders.filter(([x, y]) => blank(x, y)).map(([x]) => JSON.stringify(x));
  ok("§dup a blank or placeholder email or phone never matches two people", hits.length === 0, hits);
  const home = { address: "12 Larkspur Lane", city: "Harborview", zip: "98101" };
  const hh = DH.judgePair({ id: "a", name: "Erin Vantreight", ...home }, { id: "b", name: "Dana Okafor", ...home });
  ok("§dup two people at one address with different names are not a duplicate", !hh, hh);
  const real = DH.judgePair({ id: "a", name: "Mary Okafor", email: "mokafor@example.net" }, { id: "b", name: "Mary Okafor", email: " MOkafor@Example.net" });
  ok("§dup one real email in two cases still matches", real && real.confidence === "high", real);
  ok("§dup households are offered as families, not duplicates", Array.isArray(families));
}

let chromium;
async function linksLeg() {
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
  catch { browserLegOrSkip("Playwright not found (set PLAYWRIGHT_DIR)"); return; }
  const tabs = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  await q("SET session_replication_role = replica");
  for (const t of tabs) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG.id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG.id]);
  await q("SET session_replication_role = origin");
  const seedMany = require("../scripts/load/seed-many.js");
  await seedMany.seedOrg(ORG, bcrypt.hashSync(PASSWORD, 8));
  await seedMany.pool.query("ANALYZE donors; ANALYZE gifts");
  await seedMany.pool.end();
  const late = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT $2`, [ORG.id, LATE]);
  // a stale line: the two people it names were deleted since the import
  const gone = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 2`, [ORG.id]);
  await q(`UPDATE donors SET deleted_at = NOW() WHERE org_id=$1 AND id = ANY($2)`, [ORG.id, gone.map(d => d.id)]);
  await q(`INSERT INTO readouts (id, org_id, source_kind, title, headline, lines, for_date, created_by, created_by_name)
           VALUES ($1,$2,'import','What your history shows','Your history is in.',$3,$4,'system:test','HOTFIX-RHYTHM fixture')`,
    [RO_ID, ORG.id, JSON.stringify([{ kind: "now_late", count: LATE, sentence: `${LATE} are now late for their own rhythm`,
      why: "Drift compares each person with their own rhythm.", rows: late.map(d => ({ donorId: d.id })) },
      { kind: "recurring_stopped", count: 2, sentence: "2 people's monthly gift stopped", why: "A monthly gift that stopped.", rows: gone.map(d => ({ donorId: d.id })) }]), civilDay()]);
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG.id]);
  ok(`§links fixture: ${n} people, a readout with ${LATE} late`, n >= 6000, n);

  const login = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }).then(r => r.json());
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await pinBrowserClock(ctx);
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
      // every in-app navigation, counted (a router push or replace is one)
      window.__navs = [];
      for (const k of ["pushState", "replaceState"]) {
        const f = history[k].bind(history);
        history[k] = (s, t2, url) => { window.__navs.push(String(url)); return f(s, t2, url); };
      }
    }, [login.token, JSON.stringify(login.user), JSON.stringify(login.org || {})]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    let loads = 0;
    await page.goto(APP + "/dashboard", { waitUntil: "load" });
    page.on("framenavigated", f => { if (f === page.mainFrame()) loads++; });
    await page.waitForSelector('[data-testid="home-readout-open"]', { timeout: 30000 });
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => window.__navs.length);
    await page.locator('[data-testid="home-readout-open"]').first().click();
    const card = page.locator('[data-testid="readout-line-now_late"] [data-figure-key="readout-now_late"]');
    await card.waitFor({ timeout: 8000 }).catch(() => {});
    const cardN = Number(await card.getAttribute("data-value").catch(() => "NaN"));
    ok(`§links See who opens the readout, and its count reads ${LATE}`, cardN === LATE, cardN);
    await card.click().catch(e => errors.push("click: " + e.message.split("\n")[0]));
    const list = page.locator('[data-testid="figure-rows"][data-total]');
    await list.waitFor({ timeout: 8000 }).catch(() => {});
    const rows = await list.locator("[data-person-row]").count();
    const total = Number(await list.getAttribute("data-total").catch(() => "NaN"));
    ok(`§links the count opens a list of exactly ${LATE} people (count on the list = count on the card)`, rows === LATE && total === LATE, { rows, total });
    const alive = await Promise.race([page.evaluate(() => 1), new Promise(r => setTimeout(() => r(0), 3000))]);
    ok("§links the page still answers", alive === 1);
    const after = await page.evaluate(() => ({ navs: window.__navs.length, path: location.pathname }));
    const navs = after.navs - before + loads;
    ok(`§links no navigation loop (${navs} navigations, fewer than 3), still on Home's address`, navs < 3 && after.path === "/dashboard", after);
    // A stale line: its people are gone, so the list is empty, IN PLACE.
    const closeAll = async () => { for (let i = 0; i < 3 && await page.locator('[role="dialog"]').count(); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); } };
    const reopen = async () => {
      await closeAll();
      await page.locator('[data-testid="home-readout-open"]').first().click();
      await page.locator('[data-testid="readout-line-now_late"]').waitFor({ timeout: 8000 }).catch(() => {});
    };
    await reopen();
    const stale = page.locator('[data-testid="readout-line-recurring_stopped"] [data-figure-key="readout-recurring_stopped"]');
    const b2 = await page.evaluate(() => window.__navs.length);
    await stale.click({ timeout: 8000 }).catch(e => errors.push("stale: " + e.message.split("\n")[0]));
    const empty = page.locator('[data-testid="figure-rows"][data-total="0"]');
    await empty.waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const where = await page.evaluate(() => ({ path: location.pathname, navs: window.__navs.length }));
    ok("§links a stale line (its people deleted since) opens an empty list in place: no redirect, still on Home's address",
      (await empty.count()) === 1 && where.path === "/dashboard" && where.navs - b2 < 3, { empty: await empty.count(), ...where });
    await reopen();
    await card.click().catch(() => {});
    await list.waitFor({ timeout: 8000 }).catch(() => {});
    // A person on the list opens their profile through the app's router.
    await list.locator("[data-person-row]").first().click().catch(() => {});
    await page.waitForURL(u => /\/donors\/.+/.test(String(u)), { timeout: 8000 }).catch(() => {});
    ok("§links a name on the list opens that person", /\/donors\/.+/.test(page.url()), page.url());
    // See who again, after the list was used: the panel opens again
    await page.goto(APP + "/dashboard", { waitUntil: "load" });
    await page.waitForSelector('[data-testid="home-readout-open"]', { timeout: 30000 });
    await page.locator('[data-testid="home-readout-open"]').first().click();
    await page.locator('[data-testid="readout-line-now_late"]').waitFor({ timeout: 8000 }).catch(() => {});
    ok("§links See who opens again", await page.locator('[data-testid="readout-line-now_late"]').count() === 1);
    ok("§links no page errors", errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  } finally { await browser.close(); }
}

(async () => {
  homeLinkGuard();
  await dupLeg();
  await linksLeg();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
