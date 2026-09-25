// BUILD-98 (switch) Part 3 — REPORTS PEOPLE CAN BUILD.
//
// Bloomerang's report builder is the feature people say they will miss. Each
// assertion is a way a report quietly tells somebody the wrong thing:
//   §1  a saved LYBUNT agrees with a HAND COUNT, and with the Reports tab,
//       because it IS the Reports tab's computation;
//   §2  two nested filter groups return exactly the expected rows;
//   §3  a field that is not in the catalogue is refused — a definition is a
//       list of names, never a string of SQL;
//   §4  a grouped total foots to the database in cents;
//   §5  a private report is private, a shared one is shared, another org's is
//       not found, and only the owner can change it;
//   §6  a weekly report emails ONCE per week, and opening it changes nothing;
//   §7  all twelve standard reports run.
//
// Standard scratch stack (tests/README.md).

const http = require("http");
const fs = require("fs"), path = require("path");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html")); };
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");

const ORG = "org_b98r", OTHER = "org_b98r2";
const PW = "loadtest1234";

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["saved_report_sends", "saved_reports", "custom_field_defs", "recurring_subscriptions", "pledges",
                     "fin_transactions", "interactions", "gifts", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
function captureSink() {
  const mail = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { /* not JSON */ } res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "sunk" })); });
  });
  return new Promise(r => srv.once("error", () => r(null)).listen(SINK_PORT, () => r({ srv, mail })));
}
const cents = v => Math.round(Number(v) * 100);

(async () => {
  console.log("build98-reports");
  await reset();
  const sink = await captureSink();
  for (const [id, name] of [[ORG, "Report Riders"], [OTHER, "Somebody Else"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507','America/New_York',NOW())`, [id, name, id.replace(/_/g, "-")]);
  const mkUser = (id, org, email, name) => q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, [id, org, email, bcrypt.hashSync(PW, 4), name]);
  await mkUser("u_b98r", ORG, "b98r@example.org", "Allie Barnett");
  await mkUser("u_b98r_b", ORG, "b98r-b@example.org", "Colleague");
  await mkUser("u_b98r2", OTHER, "b98r-o@example.org", "Other");
  const tok = await login("b98r@example.org"), tokB = await login("b98r-b@example.org"), tok2 = await login("b98r-o@example.org");

  // Fiscal years (July 1): today is in the current one; "last" and "earlier"
  // are the two before it. Dates are computed so the fixture never ages.
  const fy = (await api("GET", "/reports/giving-summary?yearMode=fiscal", tok)).body;
  const thisStart = fy.from;                                // e.g. 2026-07-01
  const y = Number(thisStart.slice(0, 4));
  const inThis = `${y}-08-15`, inLast = `${y - 1}-10-10`, inEarlier = `${y - 2}-11-11`;
  const people = [
    ["r_a", "Ada Lastyear", "KY", 600, [inLast]],               // LYBUNT
    ["r_b", "Ben Both", "KY", 1500, [inLast, inThis]],          // gave both — not LYBUNT
    ["r_c", "Cy Thisyear", "OH", 1200, [inThis]],               // first-time this year
    ["r_d", "Di Earlier", "KY", 300, [inEarlier]],              // SYBUNT, not LYBUNT
    ["r_e", "Ed Twice", "IN", 2400, [inEarlier, inLast]],       // LYBUNT (and SYBUNT)
  ];
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_r_barn',$1,'Barn Fund',false),('ff_r_ride',$1,'Riding Fund',true)`, [ORG]);
  for (const [id, name, state, total, dates] of people) {
    await q(`INSERT INTO donors (id,org_id,name,state,stage,total_giving,gift_count,first_gift_date,last_gift_date,tags,custom_fields)
             VALUES ($1,$2,$3,$4,'cultivate',$5,$6,$7,$8,$9,$10)`,
      [id, ORG, name, state, total, dates.length, dates[0], dates[dates.length - 1],
       id === "r_d" ? '["board"]' : "[]", JSON.stringify({ volunteer_hours: id === "r_c" ? "40" : "0" })]);
    for (const [i, dt] of dates.entries())
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id) VALUES ($1,$2,$3,$4,$5,'cash',$6)`,
        [`g_${id}_${i}`, ORG, id, total / dates.length, dt, i % 2 ? "ff_r_ride" : "ff_r_barn"]);
  }
  await q(`INSERT INTO custom_field_defs (id,org_id,entity,key,label,type) VALUES ('cf_r_vh',$1,'donor','volunteer_hours','Volunteer hours','number')`, [ORG]);

  // ── §1 LYBUNT by hand, by the tab, by the saved report ──────────────────
  const HAND = ["Ada Lastyear", "Ed Twice"];
  const tab = await api("GET", "/reports/lybunt?yearMode=fiscal", tok);
  const saved = await api("GET", "/saved-reports/std:lybunt/run", tok);
  const tabNames = (tab.body.rows || tab.body.donors || []).map(r => r.name).sort();
  const savedNames = (saved.body.rows || []).map(r => Object.values(r).find(v => HAND.includes(v) || /[A-Z][a-z]+ [A-Z]/.test(String(v)))).filter(Boolean).sort();
  ok("§1 the Reports tab's LYBUNT matches the hand count", JSON.stringify(tabNames) === JSON.stringify(HAND), tabNames);
  ok("§1 the saved LYBUNT matches the hand count", JSON.stringify(savedNames) === JSON.stringify(HAND), saved.body);
  ok("§1 and the two are the same number of rows", (saved.body.rows || []).length === tabNames.length);

  // ── §2 two nested groups ─────────────────────────────────────────────────
  // lifetime ≥ 1000 AND (state is KY OR state is IN) → Ben, Ed
  // OR tagged board → Di
  const nested = { entity: "people", columns: ["name"], sort: { field: "name", dir: "asc" },
    filter: { op: "or", rules: [
      { op: "and", rules: [{ field: "lifetime", cmp: "gte", value: 1000 }, { op: "or", rules: [{ field: "state", cmp: "eq", value: "KY" }, { field: "state", cmp: "eq", value: "IN" }] }] },
      { field: "tags", cmp: "contains", value: "board" },
    ] } };
  const n2 = await api("POST", "/report-builder/run", tok, { definition: nested });
  ok("§2 nested and/or groups return exactly the expected rows",
     JSON.stringify((n2.body.rows || []).map(r => r.c0)) === JSON.stringify(["Ben Both", "Di Earlier", "Ed Twice"]), n2.body);
  const cf = await api("POST", "/report-builder/run", tok, { definition: { entity: "people", columns: ["name", "cf:volunteer_hours"],
    filter: { op: "and", rules: [{ field: "cf:volunteer_hours", cmp: "gt", value: 10 }] } } });
  ok("§2 a custom field filters like any other", (cf.body.rows || []).length === 1 && cf.body.rows[0].c0 === "Cy Thisyear", cf.body);

  const deep = { op: "and", rules: [{ op: "or", rules: [{ op: "and", rules: [{ op: "or", rules: [{ field: "name", cmp: "eq", value: "x" }] }] }] }] };
  const d4 = await api("POST", "/report-builder/run", tok, { definition: { entity: "people", columns: ["name"], filter: deep } });
  ok("§2 …and four groups deep is refused", d4.status === 400 && /groups deep/.test(d4.body.error || ""), d4.body);

  // ── §3 a field is a name, never SQL ──────────────────────────────────────
  const inj = await api("POST", "/report-builder/run", tok, { definition: { entity: "people", columns: ["name; DROP TABLE donors"] } });
  ok("§3 a column that is not in the catalogue is refused", inj.status === 400);
  const inj2 = await api("POST", "/report-builder/run", tok, { definition: { entity: "people", columns: ["name"],
    filter: { op: "and", rules: [{ field: "cf:x') OR 1=1 --", cmp: "eq", value: "1" }] } } });
  ok("§3 a custom-field key that is not a plain key is refused", inj2.status === 400);
  const val = await api("POST", "/report-builder/run", tok, { definition: { entity: "people", columns: ["name"],
    filter: { op: "and", rules: [{ field: "name", cmp: "eq", value: "x' OR '1'='1" }] } } });
  ok("§3 a value is bound, never spliced: a quote in it matches nobody", val.status === 200 && (val.body.rows || []).length === 0);
  // db.js's query() rewrites every `?` into a placeholder, so a `?` inside the
  // compiled SQL would bind a value to the wrong slot. Every field in the
  // catalogue, as a column and as a filter, compiles without one.
  const RBM = await import("../shared/reportBuilder.js");
  const qm = [];
  for (const ek of RBM.ENTITY_KEYS) for (const [fk, f] of Object.entries(RBM.ENTITIES[ek].fields)) {
    const cmp = Object.entries(RBM.OPS).find(([, o]) => o.types.includes(f.type))?.[0];
    const c = RBM.compile({ entity: ek, columns: f.groupOnly ? [] : [fk], groupBy: f.groupOnly ? fk : undefined,
      filter: cmp ? { op: "and", rules: [{ field: fk, cmp, value: f.type === "date" ? "2026-01-01" : f.type === "bool" ? true : f.type === "number" || f.type === "money" ? 1 : "x" }] } : undefined });
    if (!c.ok || [c.from, ...c.where, ...c.columns.map(x => x.sql)].join(" ").includes("?")) qm.push(`${ek}.${fk}${c.ok ? "" : ": " + c.errors.join(" ")}`);
  }
  ok("§3 every catalogue field compiles, with no ? in the SQL", qm.length === 0, qm);
  const [still] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  ok("§3 and every donor is still there", still.n === 5);

  // ── §4 a grouped total foots ─────────────────────────────────────────────
  const byFund = await api("GET", "/saved-reports/std:by-fund/run", tok);
  const [dbThis] = await q(`SELECT COALESCE(SUM(amount),0) AS t FROM gifts WHERE org_id=$1 AND date >= $2`, [ORG, thisStart]);
  const groupSum = (byFund.body.rows || []).reduce((t, r) => t + cents(r.s0), 0);
  ok("§4 donors by fund groups this year's gifts by fund", (byFund.body.rows || []).length >= 1, byFund.body);
  ok("§4 and the groups add up to the database, in cents", groupSum === cents(dbThis.t) && byFund.body.totals.sums[0].cents === cents(dbThis.t),
     { groups: groupSum, db: cents(dbThis.t) });

  // ── §5 private, shared, and nobody else's ────────────────────────────────
  const mine = await api("POST", "/saved-reports", tok, { name: "My KY donors", definition: { entity: "people", columns: ["name"], filter: { op: "and", rules: [{ field: "state", cmp: "eq", value: "KY" }] } } });
  const shared = await api("POST", "/saved-reports", tok, { name: "Big givers", shared: true, schedule: "weekly",
    definition: { entity: "people", columns: ["name", "lifetime"], filter: { op: "and", rules: [{ field: "lifetime", cmp: "gte", value: 1000 }] }, sort: { field: "lifetime", dir: "desc" } } });
  ok("§5 both save", mine.status === 201 && shared.status === 201);
  const listB = await api("GET", "/saved-reports", tokB);
  const idsB = (listB.body.saved || []).map(r => r.id);
  ok("§5 a colleague sees the shared report", idsB.includes(shared.body.id));
  ok("§5 …and not the private one", !idsB.includes(mine.body.id));
  ok("§5 a colleague cannot run the private one", (await api("GET", `/saved-reports/${mine.body.id}/run`, tokB)).status === 404);
  ok("§5 a colleague cannot change the shared one", (await api("PUT", `/saved-reports/${shared.body.id}`, tokB, { name: "Mine now" })).status === 404);
  ok("§5 another org cannot run either", (await api("GET", `/saved-reports/${shared.body.id}/run`, tok2)).status === 404);
  const badSave = await api("POST", "/saved-reports", tok, { name: "Broken", definition: { entity: "people", columns: ["nope"] } });
  ok("§5 a broken definition is refused at save", badSave.status === 400);
  const csv = await fetch(`${BASE}/saved-reports/${shared.body.id}/csv`, { headers: { Authorization: "Bearer " + tok } });
  const csvText = await csv.text();
  ok("§5 it exports as CSV", csv.status === 200 && csvText.includes("Ed Twice"));
  const pdf = await fetch(`${BASE}/saved-reports/${shared.body.id}/pdf`, { headers: { Authorization: "Bearer " + tok } });
  ok("§5 and as PDF", pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).slice(0, 4).toString() === "%PDF");

  // ── §6 the weekly email, once ────────────────────────────────────────────
  if (!sink) ok("§6 mail sink bound (environment)", false, `port ${SINK_PORT} busy`);
  else {
    const wk = "wk:2026-09-21";
    const s1 = await api("POST", "/saved-reports/run-schedule", tok, { weekKey: wk });
    const s2 = await api("POST", "/saved-reports/run-schedule", tok, { weekKey: wk });
    await new Promise(r => setTimeout(r, 300));
    const got = sink.mail.filter(m => String(m.subject || "").startsWith("Big givers"));
    ok("§6 the weekly report sends", s1.body.sent === 1, s1.body);
    ok("§6 …ONCE: the same week a second time sends nothing", s2.body.sent === 0 && got.length === 1, { s2: s2.body, mails: got.length });
    // `to` is a string or an array of them — compared as addresses, never by
    // searching a stringified payload (the BUILD-84 rule).
    ok("§6 it goes to the report's owner", got[0] && [].concat(got[0].to).map(String).includes("b98r@example.org"), got[0] && got[0].to);
    ok("§6 it carries the rows", got[0] && String(got[0].html).includes("Ed Twice"));
    const link = (String(got[0]?.html || "").match(/href="([^"]+)"/) || [])[1] || "";
    ok("§6 its one link opens the report in Steward", /\/dashboard\?report=rpt_/.test(link), link);
    const before = await q(`SELECT (SELECT COUNT(*)::int FROM saved_report_sends WHERE org_id=$1) AS sends, (SELECT last_sent_at FROM saved_reports WHERE id=$2) AS last`, [ORG, shared.body.id]);
    await api("GET", `/saved-reports/${shared.body.id}/run`, tok);
    await api("GET", `/saved-reports/${shared.body.id}/run`, tokB);
    const after = await q(`SELECT (SELECT COUNT(*)::int FROM saved_report_sends WHERE org_id=$1) AS sends, (SELECT last_sent_at FROM saved_reports WHERE id=$2) AS last`, [ORG, shared.body.id]);
    ok("§6 opening the report changes nothing", before[0].sends === after[0].sends && String(before[0].last) === String(after[0].last));
    const s3 = await api("POST", "/saved-reports/run-schedule", tok, { weekKey: "wk:2026-09-28" });
    ok("§6 next week it sends again", s3.body.sent === 1);
  }

  // ── §7 the twelve ────────────────────────────────────────────────────────
  const list = await api("GET", "/saved-reports", tok);
  // Twelve from Part 3, and Part 5's "Volunteers who give" (the brief's
  // volunteer-to-donor conversion report) makes thirteen. BUILD-101 Part 5
  // adds the five membership reports (by level, expiring in 60 days, lapsed,
  // new and renewed by month, membership beside donation revenue): eighteen.
  // BUILD-100 (grants) Part 5 adds five more — the pipeline, by funder, awarded
  // versus requested by year, the deadlines due in 90 days, and restricted
  // balances by grant: TWENTY-THREE. The count is deliberately a literal so a
  // report added without a thought about this list fails here.
  ok("§7 there are twenty-three standard reports", (list.body.standard || []).length === 23,
     (list.body.standard || []).map(r => r.id));
  const broken = [];
  for (const s of list.body.standard || []) {
    const r = await api("GET", `/saved-reports/${encodeURIComponent(s.id)}/run`, tok);
    if (r.status !== 200 || !Array.isArray(r.body.columns)) broken.push(`${s.name}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  ok("§7 every one of them runs", broken.length === 0, broken);
  const ft = await api("GET", "/saved-reports/std:first-time/run", tok);
  ok("§7 first-time donors this year is Cy alone", (ft.body.rows || []).length === 1 && ft.body.rows[0].c0 === "Cy Thisyear", ft.body);

  // ── §8 the screen ────────────────────────────────────────────────────────
  // Found by the walk, not by an assertion: opening Reports STRAIGHT onto
  // "Your reports" — which is exactly what the weekly email's link does —
  // took the whole tab to its error boundary, because the page's parameter
  // builder read `.year` off a default period that had not loaded yet.
  // Clicking into the tab worked, so only a first render could show it.
  if (!haveBrowser()) console.log("  SKIP — no Playwright or client/dist (browser leg)");
  else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    page.on("console", m => { if (m.type() === "error" && /ErrorBoundary/.test(m.text())) errs.push(m.text()); });
    const lj = await (await page.request.post(BASE + "/auth/login", { data: { email: "b98r@example.org", password: PW } })).json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(d => { localStorage.setItem("npe_token", d.token); localStorage.setItem("npe_user", JSON.stringify(d.user)); localStorage.setItem("npe_org", JSON.stringify(d.org)); }, lj);
    await page.goto(`${APP}/dashboard?report=${shared.body.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const body = await page.innerText("body");
    ok("§8 the weekly email's link opens the report, not an error screen",
       (await page.locator('[data-testid="rb-view"]').count()) === 1 && body.includes("Big givers") && !body.includes("Something went wrong"), errs);
    ok("§8 …and the report's rows are on the screen", (await page.locator('[data-testid="rb-result"]').innerText().catch(() => "")).includes("Ed Twice"));
    await page.locator('[data-testid="rb-new"]').click(); await page.waitForTimeout(600);
    await page.locator('[data-testid="rb-run"]').click(); await page.waitForTimeout(1500);
    ok("§8 the builder runs a report on the screen", (await page.locator('[data-testid="rb-result"]').innerText().catch(() => "")).includes("rows"));
    ok("§8 with no page errors", errs.length === 0, errs);
    await browser.close();
  }

  if (sink) sink.srv.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
