// tests/flows13.test.js — FLOWS-13. THE SCREEN AFTER AN ACTION, AND FIVE SMALLER TRUTHS.
//
// One made-up org per run (no real name anywhere), one check per item:
//   §1  the write-to-read list (client/src/lib/writeToRead.js): every write the fleet named reaches
//       every read on its screen; a gift edit moves the open profile with no reload (browser);
//       an erased person's $100,000 leaves the officer's portfolio value on the next read
//   §2  a saved logo heads the public giving page ("Not open yet" too) and the embedded form (browser)
//   §3  one click applies a custom period, even with an earlier period's read still on its way (browser)
//   §4  a list emptied by its filters says so ("None of the 277 lapsed donors match these filters.")
//   §5  the editor never prints one impact line into every amount; four identical lines are flagged
//   §6  Atlas answers a question nothing in Steward answers in under 5 s, with a model that takes 8 s
//       a call (a stand-in), and a slow question stops at its limit with what it has
//
// HOW IT GOES RED: against main's code (a throwaway worktree of 793118a), every section is red; the
// planted defects are listed in the PR (each client fix removed in turn, the suite run, red seen).
"use strict";
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, login, closeDb, browserLegOrSkip, civilPlusDays, civilToday } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const PASSWORD = "loadtest1234";
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

(async () => {
  console.log("flows13 (FLOWS-13)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const ORG = `org_flows13_${run}`, SLUG = `flows13-${run}`, EMAIL = `owner-${run}@flows13.local`, ME = `u_flows13_${run}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at)
           VALUES ($1,'Flows Thirteen Tidepool Arts',$2,1,'active','team','America/New_York',true,NOW())`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wilhelmina Strand','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  const ids = {};
  const P = async (key, name) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${run}@flows13.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (ids[key] = r.body.id);
  };
  const gift = (id, amount, date) => api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });

  // ── §1 the write-to-read list ────────────────────────────────────────────
  const ch = await import(path.join(ROOT, "client/src/lib/changes.js"));
  const W2R = await import(path.join(ROOT, "client/src/lib/writeToRead.js")).catch(() => ({ WRITE_TO_READ: [] }));
  const misses = [];
  for (const w of W2R.WRITE_TO_READ) {
    const c = ch.kindsOfWrite(w.path, w.method, w.body ? JSON.stringify(w.body) : undefined);
    for (const r of w.reads) if (!ch.reaches(c, r.kinds, r.ids || null)) misses.push(`${w.write} → ${r.read}`);
  }
  const named = new Set(W2R.WRITE_TO_READ.map(w => w.write));
  ok("§1 the list names the fleet's writes: gift edit, pledge payment, recurring cancel, write-off, deposit undo, erase, logo, invite revoke",
    ["Gift edit ($100 to $150)", "Pledge payment", "Pledge write-off", "Recurring cancel (recorded by staff)", "Deposit undo (Finance)", "A person erased", "Logo or accent saved", "Invite revoked"].every(n => named.has(n)), [...named]);
  ok("§1 every write on the list reaches every read on its screen", W2R.WRITE_TO_READ.length > 0 && misses.length === 0, misses);
  ok("§1 the Brand Identity preview, the brand kit and the Team list each hear an org change",
    /useChanged\(\["org"\]/.test(read("client/src/components/settings/BrandingManager.jsx")) && /useChanged\(\["org"\]/.test(read("client/src/components/BrandKit.jsx"))
      && /useChanged\(\["org"\]/.test(read("client/src/components/settings/InvitedList.jsx")));

  // An erased person's $100,000 leaves the officer's portfolio value.
  await P("ottoline", "Ottoline Brackwater"); await P("fenwick", "Fenwick Ashdown");
  await gift(ids.ottoline, 100000, civilPlusDays(-20));
  await gift(ids.fenwick, 2500, civilPlusDays(-10));
  await q(`UPDATE donors SET assigned_to=$1, stage='cultivate' WHERE org_id=$2 AND id = ANY($3)`, [ME, ORG, [ids.ottoline, ids.fenwick]]);
  const before = (await api("GET", "/dashboard/my-stats", tok)).body || {};
  const er = await api("POST", `/donors/${ids.ottoline}/erase`, tok, { confirm: "ERASE" });
  const after = (await api("GET", "/dashboard/my-stats", tok)).body || {};
  const monthly = ((await api("GET", "/digests/preview?type=monthly", tok)).body || {}).report || {};
  const pipe = (await api("GET", "/dashboard/my-stats/pipeline/breakdown", tok)).body || {};
  ok("§1 the officer's portfolio before the erase counts both: $102,500 across 2 people", before.pipelineValue === 102500 && before.portfolioCount === 2, before);
  ok("§1 after the erase, the next read leaves the erased person out: $2,500, 1 person, on Home, its drill-down and the monthly report",
    er.status === 200 && after.pipelineValue === 2500 && after.portfolioCount === 1 && pipe.total === 2500 && pipe.count === 1 && monthly.portfolioValue === 2500 && monthly.portfolioCount === 1,
    { erase: er.status, after: { pipelineValue: after.pipelineValue, portfolioCount: after.portfolioCount }, pipe: { total: pipe.total, count: pipe.count }, monthly: { v: monthly.portfolioValue, n: monthly.portfolioCount } });

  // ── §2 the logo on the public surfaces ───────────────────────────────────
  const br = await api("PUT", "/orgs/branding", tok, { logoData: JPEG });
  const pub = await fetch(`${process.env.BASE || "http://localhost:5601"}/org/${SLUG}/public`).then(async r => ({ status: r.status, body: await r.json() }));
  ok("§2 the giving page's \"Not open yet\" answer carries the org's name and the saved logo",
    br.status === 200 && pub.status === 404 && pub.body.notOpen === true && pub.body.brand && pub.body.brand.logo === JPEG && /Tidepool/.test(pub.body.brand.name || ""), { status: pub.status, brand: pub.body.brand && { ...pub.body.brand, logo: (pub.body.brand.logo || "").slice(0, 24) } });
  const gp = await api("POST", "/giving-pages", tok, { title: "Tidepool spring appeal" });
  const pageId = gp.body && (gp.body.id || (gp.body.page && gp.body.page.id));
  ok("§2 Brand kit lists every place the logo appears, the not-open page and the form on her site among them",
    /LOGO_PLACES/.test(read("client/src/components/BrandKit.jsx")) && /Not open yet/.test(read("client/src/components/BrandKit.jsx")) && /donation form on your website/.test(read("client/src/components/BrandKit.jsx")));

  // ── §4 an empty list names its filters ───────────────────────────────────
  const FE = await import(path.join(ROOT, "shared/filteredEmpty.js")).catch(() => null);
  ok("§4 \"None of the 277 lapsed donors match these filters.\"", !!FE && FE.filteredEmptySentence(277, "lapsed donor") === "None of the 277 lapsed donors match these filters.");
  const dd = read("client/src/components/DonorDirectory.jsx"), dn = read("client/src/components/Donors.jsx"), fin = read("client/src/components/Finance.jsx");
  ok("§4 Re-engage with the Directory's filters on gets the unfiltered list, and its empty state names the filters with Clear filters",
    /unfiltered=\{reFilterN>0\?filtered:null\}/.test(dn) && /filteredEmptySentence\(all,"lapsed donor"\)/.test(dd) && /Clear filters/.test(dd));
  ok("§4 the sweep: Finance's transactions emptied by a filter say so, never \"Log one … to begin\"", /filteredEmptySentence\(transactions\.length, "transaction"\)/.test(fin));

  // ── §5 each amount its own impact line ───────────────────────────────────
  const IL = await import(path.join(ROOT, "shared/impactLines.js")).catch(() => null);
  const same = "buys a week of art supplies for 10 kids";
  const four = IL && IL.repeatedImpact({ 2500: same, 5000: same, 10000: same, 25000: same }, [2500, 5000, 10000, 25000]);
  ok("§5 four identical lines are flagged, naming every amount", !!four && four.cents.length === 4 && /\$25, \$50, \$100 and \$250 all say/.test(four.sentence), four);
  ok("§5 lines of their own are not flagged, and a blank is not a line", !!IL && IL.repeatedImpact({ 2500: "a", 5000: "b", 10000: "" }, [2500, 5000, 10000, 25000]) === null);
  const pe = read("client/src/pages/PortalEditor.jsx");
  ok("§5 the editor's boxes never print an example impact as every amount's line; the flag shows by the boxes and at Publish",
    !/art supplies/.test(pe) && /placeholder=\{impactPlaceholder\(c\)\}/.test(pe) && /details-impact-repeated/.test(pe) && /repeatedImpact\(normalizeDesign\(dsRef\.current\.design\)/.test(pe));
  ok("§5 the seed writes a different line for each amount (Spring Paddle), so no page carries four of one", (() => {
    const m = read("scripts/ci/seed-demo.js").match(/impact: \{([^}]+)\}/); if (!m) return false;
    const lines = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]); return lines.length >= 4 && new Set(lines).size === lines.length;
  })());

  // ── the browser: §1, §2, §3 ──────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser legs)")) {
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n").slice(0, 3).join(" | ")); } };

    await step("§1 gift edit", async () => {
      await P("perpetua", "Perpetua Lindqvist");
      await gift(ids.perpetua, 100, civilPlusDays(-3));
      await page.goto(`${APP}/donors/${ids.perpetua}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.locator("[data-tab=giving]").click(); await page.waitForTimeout(1200);
      const row = page.locator("tr", { hasText: "$100" }).filter({ hasText: "Edit" }).first();
      await row.getByRole("button", { name: "Edit" }).click();
      await page.locator('input[type="number"]').first().fill("150");
      await page.getByRole("button", { name: /^Save/ }).first().click();
      await page.waitForTimeout(2000);
      const t = await page.locator("body").innerText();
      const life = (t.match(/Lifetime\n(\$[\d,]+)/) || [])[1], total = (t.match(/Total: (\$[\d,]+)/) || [])[1];
      ok("§1 a $100 → $150 gift edit moves Lifetime and the gift history on the open profile within 2 s, with no reload", life === "$150" && total === "$150", { life, total });
    });

    await step("§2 public surfaces", async () => {
      const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await p2.goto(`${APP}/give/${SLUG}`, { waitUntil: "networkidle", timeout: 60000 });
      const notOpenLogo = await p2.locator('[data-testid="org-brand-logo"]').count();
      const notOpenText = await p2.locator('[data-testid="give-not-open"]').innerText().catch(() => "");
      ok("§2 the public giving page's \"Not open yet\" has the saved logo and the org's name above it", notOpenLogo === 1 && /Not open yet/.test(notOpenText), { notOpenLogo, notOpenText });
      if (pageId) {
        await p2.goto(`${APP}/embed/${pageId}`, { waitUntil: "networkidle", timeout: 60000 });
        const embLogo = await p2.locator('[data-testid="org-brand-logo"]').count();
        ok("§2 the form preview (\"What a visitor sees\", /embed) is headed by the saved logo", embLogo === 1, { embLogo, pageId });
      } else ok("§2 a giving page for the form preview was made", false, gp.body);
      await p2.close();
    });

    await step("§3 custom period", async () => {
      // Last FY's read is held 3 s; the custom days are picked while it is on its way.
      await page.route(/\/fundraising\/overview\?period=last_fy/, async r => { await sleep(3000); await r.continue().catch(() => {}); });
      await page.goto(`${APP}/app/fundraising`, { waitUntil: "networkidle", timeout: 60000 });
      await page.locator('[data-testid="fr-period-last"]').click();
      await page.locator('[data-testid="fr-period-from"]').click(); await page.keyboard.type("01/01/2026");
      await page.locator('[data-testid="fr-period-to"]').click(); await page.keyboard.type("03/31/2026");
      await page.locator('[data-testid="fr-period-custom"]').click();
      await page.waitForTimeout(4500);
      const shown = ((await page.locator('[data-testid="fr-period"]').innerText().catch(() => "")).match(/Showing [^\n]+|Updating…/) || [""])[0];
      const url = new URL(page.url()).search;
      ok("§3 one click on Show these days applies Jan 1 to Mar 31, 2026, and Last FY's late answer never paints over it",
        /frPeriod=custom/.test(url) && /Jan 1, 2026 to Mar 31, 2026/.test(shown), { shown, url });
      await page.unroute(/\/fundraising\/overview\?period=last_fy/);
    });
    await browser.close();
  }

  // ── §6 Atlas, with a model that takes 8 s a call ─────────────────────────
  const AT = await import(path.join(ROOT, "shared/atlas.js"));
  const NS = (() => { try { return require(path.join(ROOT, "server/atlas/noSource.js")); } catch { return null; } })();
  ok("§6 a question about the world names no data source; one about her people or a request does",
    !!NS && !!NS.noSource("What is the capital of France?", ["Ottoline Brackwater"]) && !NS.noSource("How much did Fenwick give?", ["Fenwick Ashdown"])
      && !NS.noSource("Can you remind me tomorrow?", []) && !NS.noSource("Is Fenwick coming?", ["Fenwick Ashdown"]));
  const model = http.createServer((req, res) => {
    let b = ""; req.on("data", c => { b += c; }); req.on("end", async () => {
      await sleep(8000);
      if (res.destroyed) return;
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"type":"error","error":{"type":"api_error","message":"stand-in, slow"}}');
    });
  });
  const mport = await freePort(); await new Promise(r => model.listen(mport, "127.0.0.1", r));
  const port = await freePort(), B2 = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port), TEST_MODE: "1", STEWARD_PROCESS: "web", DISABLE_BACKGROUND_TICKS: "1", ATLAS_TOTAL_MS: "6000",
      ANTHROPIC_API_KEY: "sk-ant-standin", ANTHROPIC_BASE_URL: `http://127.0.0.1:${mport}`, OPENAI_API_KEY: "",
      JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: "http://localhost:9", DB_SSL: process.env.DB_SSL || "disable" } });
  let err = ""; child.stderr.on("data", d => { err = (err + d).slice(-1500); });
  const atlas = async text => {
    const t0 = performance.now(); const ctl = new AbortController(); const stop = setTimeout(() => ctl.abort(), 40000);
    const r = await fetch(`${B2}/atlas`, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify({ text }) })
      .then(async x => ({ status: x.status, body: await x.json().catch(() => null) })).catch(e => ({ status: 0, body: null, e: String(e) })).finally(() => clearTimeout(stop));
    const lines = ((r.body && r.body.request && r.body.request.lines) || []).map(c => String(c.line || "")).filter(Boolean);
    return { ms: Math.round(performance.now() - t0), status: r.status, lines };
  };
  try {
    let up = false;
    for (let i = 0; i < 360 && !up; i++) { up = (await fetch(`${B2}/ready`).catch(() => null))?.status === 200; if (!up) await sleep(500); }
    ok("§6 the stand-in's server is up", up, err.slice(-300));
    const u = await atlas("What is the capital of France?");
    ok("§6 a question nothing in Steward answers: \"I can't see that in your data\" in under 5 s, with a model that takes 8 s",
      u.status < 300 && u.ms < 5000 && u.lines.some(l => /^I can't see that in your data\./.test(l)), u);
    const ck = await atlas("What's Fenwick Ashdown's favorite color?");
    ok("§6 a thing Steward doesn't keep, named: answered in code, under 5 s", ck.status < 300 && ck.ms < 5000 && ck.lines.some(l => /I don't have Fenwick Ashdown's favorite color/.test(l)), ck);
    const slow = await atlas("Which of my donors gave the most?");
    ok("§6 a question that needs the slow lookup stops at its limit and says so (ATLAS_TOTAL_MS 6 s: under 12 s, never the old 12 + 20)",
      slow.status < 300 && slow.ms < 12000 && slow.lines.length > 0, slow);
  } finally { child.kill(); model.close(); }

  ok("§6 the code-first check runs before the model's read", /answeredInCode\(orgId, text, \{ today, all \}\)/.test(read("routes/atlas.js")) && typeof AT.cantKnow === "function");
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
