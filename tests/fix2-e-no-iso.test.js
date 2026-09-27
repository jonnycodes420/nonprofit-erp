// FIX-2 finding 10 — NO ISO DATE ON ANY SCREEN.
//
// Jonathan's walk (27 September) read "2024-11-15" in report results, an ISO
// as-of date on the dashboards, and more. A person never reads a machine's
// date: every date that reaches a screen goes through shared/displayDate.js
// ("Jan 14, 2026", or "Sep 27" within the year where the design omits it).
// Inputs, CSV and exports keep ISO, because a machine reads those.
//
//   §1 SOURCE (cheap, no browser): no JSX text child in client/src renders a
//      date the ISO way — `String(x).slice(0,10)`, `.toISOString()`, or a raw
//      `*.date` / `*_at` / `*At` / `*_on` / `*Date` / `due` field printed as
//      it came from the server. The allowlist names each survivor and why.
//   §2 BROWSER: a fixture org with a real file (the BUILD-89 demo file shape,
//      1,000 donors, gifts over three years, pledges, grants, twenty-five
//      conversations, tasks, a volunteer with hours, a membership, an event) is
//      walked at 1440: every rail screen and every sub-tab on it (two levels),
//      a donor profile's every tab, a report's results. The rendered text is
//      collected EXCLUDING input/textarea/select values and anything marked
//      as an export or CSV preview (data-export-preview), and any
//      \d{4}-\d{2}-\d{2} fails, naming the screen and the text around it.
//
// Needs the stack for §2 (BASE, APP_URL, DATABASE_URL, Playwright on
// NODE_PATH). Where Playwright is missing §2 prints SKIP and §1 still runs.

const fs = require("fs"), path = require("path");
const { spawnSync } = require("child_process");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 1500) : "")); }
};

// ── §1 the source ──────────────────────────────────────────────────────────
// A date field read raw into a JSX text child, or cut to its first ten
// characters. Only TEXT children count (never an attribute: an <input value>
// keeps ISO), and a nested element is judged on its own.
const DATE_NAME = /^(date|due|dueDate|due_date)$|(_date|Date|_at|At|_on|On)$/;
const SURVIVORS = {
  // file → { reason, count }: each ISO-shaped render that is NOT a date a
  // person reads on the app's screens. Every entry says why.
  "client/src/pages/Landing.jsx": { count: 1, reason: "the landing page's sample card prints a fixed label (\"Tuesday\"), not a date field" },
};
function jsxIsoRenders() {
  const espree = require(path.join(root, "client/node_modules/espree"));
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name)) files.push(p);
    }
  })(path.join(root, "client/src"));
  const isoCall = n => {
    if (n.type !== "CallExpression" || n.callee.type !== "MemberExpression") return false;
    const p = n.callee.property && n.callee.property.name;
    if (p === "toISOString") return true;
    if (["slice", "substring", "substr"].includes(p) && n.arguments.length === 2
        && n.arguments[0].value === 0 && n.arguments[1].value === 10) {
      const o = n.callee.object;
      if (o.type === "CallExpression" && o.callee.name === "String") return true;
      const nm = o.type === "MemberExpression" ? (o.property.name || "") : o.type === "Identifier" ? o.name : "";
      return DATE_NAME.test(nm);
    }
    return false;
  };
  const rawDate = n => n && n.type === "MemberExpression" && !n.computed && DATE_NAME.test(n.property.name || "");
  // displayDate(x) || x: the raw text is shown only when it is NOT a date the
  // formatter reads, so it is never ISO.
  const formatted = n => n && n.type === "CallExpression" && /^displayDate(Short)?$/.test(n.callee.name || "");
  const find = (node, pred) => {
    let f = null;
    (function v(n) {
      if (!n || f || typeof n.type !== "string") return;
      if (n.type === "JSXElement" || n.type === "JSXFragment" || n.type === "JSXAttribute") return;
      // A function with a body is logic (an IIFE computing a value), not the
      // text itself; what it returns is judged where it is rendered.
      if (/Function/.test(n.type) && n.body && n.body.type === "BlockStatement") return;
      if (pred(n)) { f = n; return; }
      for (const k in n) { const c = n[k]; if (Array.isArray(c)) c.forEach(v); else if (c && typeof c.type === "string") v(c); }
    })(node);
    return f;
  };
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    let ast;
    try { ast = espree.parse(src, { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true }, loc: true }); }
    catch (e) { hits.push({ file: path.relative(root, f), line: 0, text: "PARSE " + e.message }); continue; }
    (function v(n, parent) {
      if (!n || typeof n.type !== "string") return;
      if (n.type === "JSXExpressionContainer" && parent && (parent.type === "JSXElement" || parent.type === "JSXFragment")) {
        const e = n.expression;
        const h = find(e, isoCall) || find(e, x => x.type === "TemplateLiteral" && x.expressions.some(rawDate))
          || find(e, x => x.type === "TemplateLiteral" && x.expressions.some(y => y.type === "LogicalExpression" && rawDate(y.right) && !formatted(y.left))) || (rawDate(e) ? e : null)
          || (e.type === "LogicalExpression" && rawDate(e.right) && !formatted(e.left) ? e.right : null)
          || (e.type === "ConditionalExpression" && (rawDate(e.consequent) ? e.consequent : rawDate(e.alternate) ? e.alternate : null));
        if (h) hits.push({ file: path.relative(root, f), line: h.loc.start.line, text: src.split("\n")[h.loc.start.line - 1].trim().slice(0, 120) });
      }
      for (const k in n) { const c = n[k]; if (Array.isArray(c)) c.forEach(x => v(x, n)); else if (c && typeof c.type === "string") v(c, n); }
    })(ast, null);
  }
  return hits;
}

// ── §2 the browser ─────────────────────────────────────────────────────────
const ISO = /\d{4}-\d{2}-\d{2}/;
const ORG = "org_fx2eiso", EMAIL = "fx2eiso@example.org", PW = "loadtest1234";

async function seed(h) {
  const bcrypt = require("bcryptjs");
  const { q } = h;
  // The org is rebuilt from nothing each run: every table that carries an
  // org_id, so a half-seeded previous run cannot leave a shape behind.
  const tabs = (await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public'`)).map(r => r.table_name);
  for (let pass2 = 0; pass2 < 3; pass2++)
    for (const t of tabs) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Iso Fixture Arts','fx2e-iso',1,'team','active')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx2eiso',$1,$2,$3,'Ivy Iso','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  // The demo file's shape, into THIS org: the script logs in as whoever it is
  // given and writes only through the API, as that user.
  const r = spawnSync(process.execPath, [path.join(root, "scripts/build89-demo-seed.js")], {
    env: { ...process.env, BASE: process.env.BASE, DEMO_EMAIL: EMAIL, DEMO_PASSWORD: PW }, encoding: "utf8", timeout: 240000 });
  if (r.status !== 0) throw new Error("demo-file seed failed: " + (r.stderr || r.stdout).slice(-600));
  const tok = await h.login(EMAIL, PW);
  const donors = (await q(`SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY total_giving DESC NULLS LAST LIMIT 5`, [ORG]));
  // What the file cannot carry, through the same routes a person uses.
  const today = new Date(); const iso = n => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  await h.api("POST", "/tasks", tok, { title: "Call about the gala table", dueDate: iso(-3), donorId: donors[0].id, priority: "high" });
  await h.api("POST", "/tasks", tok, { title: "Send the annual report", dueDate: iso(5), donorId: donors[1].id, priority: "medium" });
  return { tok, donors };
}

async function browserLeg() {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { console.log("  SKIP  §2 browser: Playwright is not installed here (CI has none)"); return; }
  const APP = process.env.APP_URL;
  if (!APP) { console.log("  SKIP  §2 browser: APP_URL is not set"); return; }
  const h = require("./helpers");
  const { tok, donors } = await seed(h);
  const lr = await h.api("POST", "/auth/login", null, { email: EMAIL, password: PW });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [lr.body.token, JSON.stringify(lr.body.user), JSON.stringify(lr.body.org)]);

  // The rendered text a person reads: visible text nodes, never an input's
  // value, a <select>'s options, or an export/CSV preview.
  const readText = () => page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || !n.nodeValue.trim()) continue;
      if (el.closest("select,option,textarea,script,style,noscript,[data-export-preview]")) continue;
      if (el.checkVisibility && !el.checkVisibility()) continue;
      out.push(n.nodeValue);
    }
    return out.join(" ¦ ");
  });
  const findings = [];
  const walked = [];
  const check = async screen => {
    walked.push(screen);
    await page.waitForTimeout(900);
    const text = await readText();
    const re = /\d{4}-\d{2}-\d{2}/g; let m; const seen = new Set();
    while ((m = re.exec(text))) {
      const ctx = text.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, " ");
      if (!seen.has(ctx)) { seen.add(ctx); findings.push({ screen, text: ctx }); }
    }
  };
  // The button whose own words ARE the label (an icon or a count beside it is
  // ignored); failing that, the shortest one that starts with it.
  const click = (label, scope) => page.evaluate(([n, scope]) => {
    const rootEl = scope === "main" ? (document.querySelector("main") || document.body) : document;
    const words = b => b.innerText.replace(/[^A-Za-z0-9&' ]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const all = [...rootEl.querySelectorAll("button,a,[role=tab]")].filter(b => b.offsetParent);
    const want = n.replace(/[^A-Za-z0-9&' ]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    let hit = all.filter(b => words(b) === want);
    if (!hit.length) hit = all.filter(b => words(b).startsWith(want)).sort((a, b) => a.innerText.length - b.innerText.length);
    if (!hit.length) return false; hit[0].click(); return true;
  }, [label, scope]);
  const tabLabels = () => page.evaluate(() => [...document.querySelectorAll("main [role=tab], [role=tab]")]
    .filter(b => b.offsetParent).map(b => b.innerText.replace(/\s+/g, " ").trim()).filter(Boolean));
  // Every tab on the screen, and every tab those reveal (two levels), each
  // named after its screen: "Finance › Transactions".
  const walkTabs = async (screen, depth, done) => {
    for (const t of await tabLabels()) {
      const key = screen.split(" › ")[0] + " › " + t;
      if (done.has(t)) continue; done.add(t);
      if (!(await click(t))) continue;
      await check(key);
      if (depth < 2) await walkTabs(screen, depth + 1, done);
    }
  };

  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const RAIL = ["Home", "Dashboards", "Donors", "Fundraising", "Grants", "Communications", "Tasks", "Agent", "Volunteers", "Reports", "Finance", "Settings"];
  const visited = [];
  for (const nav of RAIL) {
    let okNav = await click(nav);
    if (!okNav) { await click("More"); await page.waitForTimeout(400); okNav = await click(nav); }
    if (!okNav) { findings.push({ screen: nav, text: "(could not open the screen from the rail)" }); continue; }
    visited.push(nav);
    await check(nav);
    await walkTabs(nav, 1, new Set());
  }
  // A report's results: the first report on the Reports screen that opens.
  await click("Reports");
  for (const r of ["LYBUNT", "Giving Summary", "Gifts by Fund", "Top Donors", "Week in Review"]) {
    if (await click(r, "main")) { await check("Reports › " + r); }
  }
  // A donor profile, every tab: the busiest record, and one with an open step.
  const withStep = (await h.q(`SELECT donor_id FROM threads WHERE org_id=$1 AND status='open' LIMIT 1`, [ORG]).catch(() => []))[0];
  for (const id of [donors[0].id, withStep && withStep.donor_id].filter(Boolean)) {
    await page.goto(`${APP}/donors/${id}`, { waitUntil: "networkidle" });
    await check("Donor profile");
    for (const t of await page.evaluate(() => [...document.querySelectorAll(".dp-tabs button")].map(b => b.innerText.trim().split("\n")[0]))) {
      if (await click(t)) await check("Donor profile › " + t);
    }
  }
  await browser.close();
  ok(`§2 every rail screen opened (${visited.length}/${RAIL.length})`, visited.length === RAIL.length, RAIL.filter(r => !visited.includes(r)));
  ok("§2 no ISO date on any screen, sub-tab, report or profile", findings.filter(f => !/could not open/.test(f.text)).length === 0,
     findings.filter(f => !/could not open/.test(f.text)));
  if (process.env.FIX2E_PRINT) console.log("    WALKED", walked.join(" | "));
  if (process.env.FIX2E_PRINT) for (const f of findings) console.log("    ISO", f.screen, "::", f.text);
  await h.closeDb();
}

(async () => {
  console.log("fix2-e-no-iso");
  console.log("\n— §1 · no JSX text child renders a date the ISO way —");
  const hits = jsxIsoRenders();
  const byFile = {};
  for (const x of hits) (byFile[x.file] = byFile[x.file] || []).push(x);
  const over = Object.entries(byFile).filter(([f, xs]) => xs.length > ((SURVIVORS[f] && SURVIVORS[f].count) || 0));
  ok("§1 no ISO-shaped date render in client/src outside the named survivors", over.length === 0,
     over.flatMap(([, xs]) => xs.map(x => `${x.file}:${x.line} ${x.text}`)));
  const stale = Object.entries(SURVIVORS).filter(([f, s]) => ((byFile[f] || []).length) < s.count);
  ok("§1 the survivors list is exact (a fixed survivor leaves the list)", stale.length === 0, stale.map(([f]) => f));

  console.log("\n— §2 · the screens, as rendered —");
  await browserLeg();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
