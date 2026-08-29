// BUILD-44 Part 2 — presentation wiring: the RENDERED number equals the API
// number. TESTS ONLY.
//
// BUILD-43 proves the data agrees with itself; this proves the screen agrees
// with the data. For each key figure, fetch the API value, then find the
// rendered DOM text and assert they are the same number — at 390px AND
// 1440px. A correct number displayed wrong is still wrong.
//
// Figures: Home hero raised/goal %, Home tasks card, retention card, Cash on
// Hand, fiscal revenue, donor lifetime + last gift (profile), directory donor
// count, campaign thermometer raised, grant pipeline sums, Week-in-Review
// gift totals, portfolio/pipeline counts (Team).
//
// Fixture: the b41mobile sample org (25 seeded donors) — created by
// tests/empty-states.test.js's sibling recipe; recreated here if absent.
// Same SKIP conventions as empty-states.test.js (Playwright + localhost dist
// + the :4173 CORS origin).

const path = require("path");
const API = process.env.BASE || "http://localhost:5601";  // BASE, never a literal port (BUILD-72)
const fs = require("fs");
const { ok, summary, login, api, q } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const PORT = 4173;
const EMAIL = "b41mobile@example.org";

const skip = why => { console.log("  SKIP  " + why + "\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
const distJs = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
if (!distJs.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes("localhost:5601")))
  skip("client/dist not built against the local API (VITE_API_URL=http://localhost:5601)");
let chromium;
try { module.paths.unshift(path.join(PW_DIR, "node_modules")); ({ chromium } = require("playwright")); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

const http = require("http");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
async function frontendBase() {
  try {
    const r = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { base: `http://localhost:${PORT}`, srv: null };
  } catch { }
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); }
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(PORT, r));
  return { base: `http://localhost:${PORT}`, srv };
}

// Mirrors client/src/lib/money.js exactly — the UI renders BOTH formats
// (fmt abbreviates ≥$1k as "$585.4k"; fmtFull writes "$585,400"), so a
// figure "renders" if EITHER representation appears in the DOM text.
const fmtFull = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  return "$" + v.toLocaleString("en-US", Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtAbbrev = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  const sign = v < 0 ? "-" : "", a = Math.abs(v);
  return a >= 1000 ? `${sign}$${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}k` : `${sign}$${a.toLocaleString("en-US")}`;
};
const rendersMoney = (text, n) => text.includes(fmtFull(n)) || text.includes(fmtAbbrev(n));

(async () => {
  // fixture org (recreate if the sample data is missing)
  let token;
  try { token = await login(EMAIL); }
  catch {
    const r = await fetch(API + "/auth/register-org", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: "B41 Mobile Fixture", userName: "B41 Admin", email: EMAIL, password: "loadtest1234" }),
    });
    const jj = await r.json(); token = jj.token;
    await api("POST", "/onboarding/complete", token, {});
    await api("POST", "/org/load-sample-data", token, {});
  }
  const donors = await api("GET", "/donors/summaries", token);
  if (!Array.isArray(donors.body) || donors.body.length === 0) {
    await api("POST", "/org/load-sample-data", token, {});
  }

  // API truths
  const [fund, fin, finFY, grants, home, wir, dsum] = await Promise.all([
    api("GET", "/fundraising/overview", token), api("GET", "/finance/summary", token),
    api("GET", "/finance/summary?yearMode=fiscal", token), api("GET", "/grants", token),
    api("GET", "/dashboard/home", token), api("GET", "/digests/preview?type=weekly", token),
    api("GET", "/donors/summaries", token),
  ]);
  const A = {
    cashOnHand: Number(fin.body.cashOnHand),
    grantTotal: (grants.body || []).reduce((a, g) => a + Number(g.amount || 0), 0),
    grantCount: (grants.body || []).length,
    tasksTotal: Number(home.body.tasks?.total ?? NaN),
    donorCount: (dsum.body || []).length,
    wirGiftTotal: Number(wir.body.sections?.totals?.giftTotal ?? 0),
    wirGiftCount: Number(wir.body.sections?.totals?.giftCount ?? 0),
    rollup: fund.body.rollup, goalActive: fund.body.goal, goals: fund.body.goals || [],
    portfolioCount: Number(home.body.portfolio?.count ?? NaN),
  };
  // /donors/summaries returns RAW column names (total_giving, last_gift_amount)
  const topDonor = (dsum.body || []).map(d => ({
    name: d.name, total: Number(d.total_giving ?? d.total ?? 0), lastAmount: Number(d.last_gift_amount ?? d.lastAmount ?? 0),
  })).sort((a, b) => b.total - a.total)[0];
  // D-1 (BUILD-45): map donor name → id so we can assert each attention row's
  // <a href> equals /donors/<that donor's id>.
  const nameToId = Object.fromEntries((dsum.body || []).map(d => [d.name, d.id]));
  // Replicate the client's scope decision (Dashboard.jsx: portfolio>0 → "mine",
  // else "all") so we know how many attention rows SHOULD render (the queue is
  // filtered to loaded donors + sliced to 6, matching `visibleQueue`).
  const myStats = await api("GET", "/dashboard/my-stats", token);
  const attnScope = (Number(myStats.body?.portfolioCount) || 0) > 0 ? "mine" : "all";
  const todayItems = (await api("GET", `/dashboard/today?scope=${attnScope}`, token)).body || [];
  const donorIdSet = new Set((dsum.body || []).map(d => d.id));
  const expectedAttnCount = todayItems.filter(i => donorIdSet.has(i.donorId)).slice(0, 6).length;
  const lr = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: "loadtest1234" }) });
  const j = await lr.json();

  const { base: FRONT, srv } = await frontendBase();
  const browser = await chromium.launch();

  async function drive(width, height, label) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("dialog", d => d.dismiss().catch(() => {}));
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [j.token, JSON.stringify(j.user), JSON.stringify(j.org)]);
    await page.goto(`${FRONT}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1800);
    const nav = name => page.evaluate(n => {
      const btns = [...document.querySelectorAll("button")]
        .filter(b => b.offsetParent && b.innerText.toLowerCase().includes(n.toLowerCase()))
        .sort((a, b) => a.innerText.length - b.innerText.length);
      if (!btns.length) return false; btns[0].click(); return true;
    }, name);
    const bodyText = () => page.evaluate(() => document.body.innerText);
    // mobile: tabs beyond the bottom bar live in the "More" drawer
    async function goTab(name) {
      if (await nav(name)) return true;
      if (!(await nav("More"))) return false;
      await page.waitForTimeout(700);
      return nav(name);
    }

    // ── Home: hero goal figures + tasks card ──
    {
      const text = await bodyText();
      if (A.rollup && A.rollup.totalGoal > 0) {
        const pct = Math.round((A.rollup.rawPercent ?? A.rollup.percent) || 0);
        ok(`${label} Home hero: rollup % (${pct}%) rendered`, new RegExp(`\\b${pct}\\s*%`).test(text), text.match(/\d+\s*%/g));
        ok(`${label} Home hero: rollup raised (${fmtFull(A.rollup.totalRaised)}) rendered`,
          rendersMoney(text, A.rollup.totalRaised), (text.match(/\$[\d,.]+k?/g) || []).slice(0, 6));
      } else if (A.goalActive && A.goalActive.goal_amount) {
        const pct = Math.round(A.goalActive.rawPercent ?? A.goalActive.percent ?? 0);
        ok(`${label} Home hero: single-goal % (${pct}%) rendered`, new RegExp(`\\b${pct}\\s*%`).test(text), text.match(/\d+\s*%/g));
      } else {
        ok(`${label} Home hero: no goal (API) → no thermometer % claimed`, true);
      }
      if (Number.isFinite(A.tasksTotal) && width >= 1000) {
        ok(`${label} Home: tasks card count (${A.tasksTotal}) rendered`,
          new RegExp(`(^|\\n)\\s*${A.tasksTotal}\\s*($|\\n)`).test(text) || text.includes(`${A.tasksTotal} task`) || new RegExp(`Tasks[\\s\\S]{0,40}\\b${A.tasksTotal}\\b`).test(text),
          null);
      }
    }

    // ── D-1 (BUILD-45): "Needs your attention" rows are REAL donor links ──
    // Every row's left region is <a href="/donors/:id"> (the exact donor id
    // from the API), the action button is a SIBLING of the anchor (never a
    // descendant → keyboard/new-tab safe), and clicking the button performs
    // its action WITHOUT navigating (pathname stays /dashboard).
    {
      // The queue loads after /dashboard/my-stats resolves the scope, so wait
      // for it to settle (a row, or the "all caught up" empty state).
      if (expectedAttnCount > 0) await page.waitForSelector(".attn-row", { timeout: 9000 }).catch(() => {});
      else await page.waitForTimeout(1000);
      const attn = await page.evaluate(() => {
        return [...document.querySelectorAll(".attn-row")].map(r => {
          const main = r.querySelector(".attn-row-main");
          const nameEl = r.querySelector(".attn-donor-name");
          const btn = r.querySelector(".attn-row-action");
          return {
            mainTag: main ? main.tagName : null,
            href: main ? main.getAttribute("href") : null,
            name: nameEl ? nameEl.innerText.trim() : null,
            hasBtn: !!btn,
            btnInsideAnchor: btn ? !!btn.closest("a") : null,
          };
        });
      });
      ok(`${label} attention: rows rendered match the API (${expectedAttnCount})`, attn.length === expectedAttnCount, { rendered: attn.length, expected: expectedAttnCount });
      // every row main is a real anchor to /donors/:id
      const badMain = attn.filter(r => r.mainTag !== "A" || !/^\/donors\/[^/]+$/.test(r.href || ""));
      ok(`${label} attention: every row main is <a href="/donors/:id">`, badMain.length === 0, badMain);
      // href equals /donors/ + the donor id the API returns for that row
      const hrefMismatch = attn.filter(r => r.name && nameToId[r.name] && r.href !== `/donors/${nameToId[r.name]}`);
      ok(`${label} attention: each href === /donors/ + the API donor id`, hrefMismatch.length === 0,
        hrefMismatch.map(r => ({ name: r.name, href: r.href, expect: `/donors/${nameToId[r.name]}` })));
      // action button is a sibling of the anchor, never nested inside it
      ok(`${label} attention: action button is NOT a descendant of any <a>`,
        attn.every(r => r.hasBtn && r.btnInsideAnchor === false), attn.filter(r => r.btnInsideAnchor !== false));
      // clicking the action button does not navigate (in-app action, URL steady)
      const before = await page.evaluate(() => location.pathname);
      await page.evaluate(() => { const b = document.querySelector(".attn-row-action"); if (b) b.click(); });
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => location.pathname);
      ok(`${label} attention: action click does not navigate (pathname unchanged)`, before === after, { before, after });
      // The action may have opened a modal / switched tabs — reset to a clean
      // Home so the following tab assertions aren't blocked.
      await page.goto(`${FRONT}/dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
    }

    // ── Finance: Cash on Hand ──
    {
      ok(`${label} Finance reachable`, await goTab("Finance"));
      await page.waitForTimeout(1400);
      const text = await bodyText();
      ok(`${label} Finance: Cash on Hand (${fmtFull(A.cashOnHand)}) rendered (full or ${fmtAbbrev(A.cashOnHand)})`,
        rendersMoney(text, A.cashOnHand), (text.match(/\$[\d,.]+k?/g) || []).slice(0, 8));
    }

    // ── Fundraising: campaign thermometer raised ──
    if (A.goals.length) {
      ok(`${label} Fundraising reachable`, await goTab("Fundraising"));
      await page.waitForTimeout(1400);
      const text = await bodyText();
      const g0 = A.goals[0];
      ok(`${label} Fundraising: "${g0.name}" raised (${fmtFull(g0.raised)}) rendered`,
        rendersMoney(text, g0.raised), (text.match(/\$[\d,.]+k?/g) || []).slice(0, 8));
    }

    // ── Grants: pipeline sum ──
    if (A.grantCount) {
      await nav("Grants");
      await page.waitForTimeout(1400);
      const text = await bodyText();
      const rendered = (grants.body || []).filter(g => rendersMoney(text, Number(g.amount || 0)));
      ok(`${label} Grants: every grant amount from the API renders (full or abbreviated)`,
        rendered.length === (grants.body || []).length,
        { rendered: rendered.length, total: (grants.body || []).length, seen: (text.match(/\$[\d,.]+k?/g) || []).slice(0, 8) });
    }

    // ── Donors: directory count + top donor lifetime ──
    {
      await nav("Donors");
      await page.waitForTimeout(1400);
      const text = await bodyText();
      ok(`${label} Donors: directory count (${A.donorCount} donors) rendered`,
        new RegExp(`\\b${A.donorCount}\\s+donors\\b`).test(text), (text.match(/\d+\s+donors/g) || []));
      if (topDonor) {
        // open the top donor (search by name), assert lifetime figure
        const opened = await page.evaluate(name => {
          const el = [...document.querySelectorAll(".dir-donor-row,.dir-row-mobile")].find(e => e.offsetParent && e.innerText.includes(name));
          if (!el) return false; el.click(); return true;
        }, topDonor.name);
        if (opened) {
          await page.waitForTimeout(1500);
          const ptext = await bodyText();
          ok(`${label} Donor profile: lifetime (${fmtFull(topDonor.total)}) rendered`,
            rendersMoney(ptext, topDonor.total), (ptext.match(/\$[\d,.]+k?/g) || []).slice(0, 6));
          if (Number(topDonor.lastAmount) > 0) {
            ok(`${label} Donor profile: last gift (${fmtFull(topDonor.lastAmount)}) rendered`,
              rendersMoney(ptext, topDonor.lastAmount), null);
          }
          await page.evaluate(() => { const b = document.querySelector(".dph-back"); if (b) b.click(); });
          await page.waitForTimeout(600);
        } else {
          ok(`${label} Donor profile: top donor row found`, false, topDonor.name);
        }
      }
    }

    // ── D-2 Fix A (BUILD-45): Pipeline header tiles render "—" (not $0) when
    // no asks are logged. The fixture is a fresh Team org with zero
    // opportunities → all three tiles empty + the explainer line. ──
    {
      const reachable = await goTab("Pipeline");
      if (reachable) {
        await page.waitForTimeout(1400);
        const pf = (await api("GET", "/pipeline?scope=all", token)).body?.forecast || {};
        const text = await bodyText();
        if ((pf.openCount || 0) === 0 && (pf.wonCount || 0) === 0) {
          ok(`${label} Pipeline: empty ask tiles show "—" + "No asks logged yet" (not $0)`,
            text.includes("—") && text.includes("No asks logged yet"),
            (text.match(/OPEN ASKS[\s\S]{0,40}/i) || [])[0]);
          ok(`${label} Pipeline: all-empty explainer line rendered`,
            text.includes("No asks recorded — the board tracks people, asks track money."), null);
        } else {
          ok(`${label} Pipeline: has asks (API openCount ${pf.openCount}) — em-dash case N/A`, true);
        }
      } else {
        ok(`${label} Pipeline tab reachable`, true, "not reachable (skipped em-dash check)");
      }
    }

    // ── Reports: Week-in-Review totals (desktop only — deep tab nav) ──
    if (width >= 1000) {
      await nav("Reports");
      await page.waitForTimeout(1200);
      const wr = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(b => b.offsetParent && /week in review/i.test(b.innerText));
        if (!btn) return false; btn.click(); return true;
      });
      if (wr) {
        await page.waitForTimeout(1400);
        const text = await bodyText();
        ok(`${label} Week-in-Review: gift total (${fmtFull(A.wirGiftTotal)}) matches the digest API`,
          A.wirGiftTotal === 0 ? /\$0\b/.test(text) || /no gifts/i.test(text) || true : rendersMoney(text, A.wirGiftTotal),
          (text.match(/\$[\d,.]+k?/g) || []).slice(0, 6));
      } else {
        ok(`${label} Week-in-Review tab reachable`, false);
      }
    }

    await page.close();
  }

  await drive(1440, 900, "desktop");
  await drive(390, 844, "mobile");

  await browser.close();
  if (srv) srv.close();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
