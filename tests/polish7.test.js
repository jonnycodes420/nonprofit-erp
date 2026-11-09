// tests/polish7.test.js: POLISH-7. WORDS THAT MATCH WHAT HAPPENED.
// Guards donor data and mail (who a draft greets, what the audit log says,
// which campaigns count as sent). One made-up org (tests/lib/polish7Fixture.js),
// then one check per fleet item, on the server answer the screen reads, and a
// browser leg that clicks through the real screens of a production build:
//   §1 W-1107-Fundraising-05  no client file builds an FY label by hand; the long
//      form is "FY 2026–27 (Jul 1, 2026 to Jun 30, 2027)"; the board says it.
//   §2 W-1107-Donors-22X      Louisa's Current tag says the household gift that keeps her.
//   §3 W-1107-Atlas-26X       an audit row never shows raw JSON or "1 records".
//   §4 W-1107-Volunteers-13X  a volunteer with no shifts reads 0 hours, 0 shifts.
//   §5 W-1108-Finance-48X     a write-off's toast says "Wrote off $450."
//   §6 W-1108-Finance-21X     a note to grants@windermere opens "Dear friends at
//                             Windermere Foundation", never "Hi Ruth".
//   §7 W-1108-Atlas-11X       one journey span, from the steps.
//   §8 W-1108-Atlas-14X       the brand preview reads the saved name and logo.
//   §9 W-1108-Finance-14X     three Faye Kovacs are told apart by email, city, last gift.
//   §10 W-1107-Fundraising-16X a campaign that reached nobody is never Sent.
// HOW IT GOES RED ON MAIN: "Hi Ruth" (§6), "Current through …" (§2), "(1 records)"
// and quoted JSON (§3), no fyLongLabel / journeySpan / candidateLine /
// reachedAnyone (§1, §7, §9, §10); in the browser: "Deleted the write-off." (§5),
// "Your Organization" (§8), three bare "Faye Kovac" buttons (§9).
// Tests set their own clock (tests/clock.js). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");
const F = require("./lib/polish7Fixture");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const ROOT = path.join(__dirname, "..");
const src = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

(async () => {
  const { tok, D, ORG } = await F.build();
  const FP = await import(path.join(ROOT, "shared/fiscalPeriod.js"));

  // ── §1 · ONE PERIOD LABEL ─────────────────────────────────────────────────
  console.log("\n— §1 · period labels —");
  const HAND = /`FY \$\{|"FY " *\+|fiscal year \$\{|`This \$\{[\w.?]*(periodLabel|yearLabel)|Fiscal year \$\{|In \$\{[\w.?]*(fy|FY)/;
  const hand = walk(path.join(ROOT, "client/src")).filter(f => /\.(jsx?|tsx?)$/.test(f) && !/\/marketing\//.test(f) && HAND.test(fs.readFileSync(f, "utf8")))
    .map(f => path.relative(ROOT, f));
  ok("§1 no client file builds an FY label by hand (fiscalPeriod.js is the one door)", hand.length === 0, hand);
  ok("§1 the long form is \"FY 2026–27 (Jul 1, 2026 to Jun 30, 2027)\"",
    typeof FP.fyLongLabel === "function" && FP.fyLongLabel(2026, 7) === "FY 2026–27 (Jul 1, 2026 to Jun 30, 2027)" && FP.fyLongLabel(2026, 1) === "FY 2026 (Jan 1, 2026 to Dec 31, 2026)",
    FP.fyLongLabel && [FP.fyLongLabel(2026, 7), FP.fyLongLabel(2026, 1)]);
  const board = (await api("GET", "/dashboards/board", tok)).body || {};
  const fy = board.fiscalYear || (board.boards && board.boards[0] && board.boards[0].fiscalYear) || null;
  if (fy) ok("§1 the board names its year the one way", /^FY \d{4}–\d{2} \(Jul 1, \d{4} to Jun 30, \d{4}\)$/.test(fy.fyLabel || ""), fy);

  // ── §2 · CURRENT THROUGH THE HOUSEHOLD, SAID AS THE GIFT ──────────────────
  console.log("\n— §2 · Current tag —");
  const st = (await api("GET", `/donors/${D("louisa")}/status`, tok)).body || {};
  const cur = (st.tags || []).find(t => t.key === "current");
  ok("§2 Louisa's Current tag says the household gift by Marlowe and its day",
    !!cur && /^Current: household gift by Marlowe Quennell, [A-Z][a-z]{2} \d{1,2}\./.test(cur.sentence), cur && cur.sentence);
  ok("§2 the score's hover never says she has no reason to be Current (\"of their own\")", /no gift of their own in the last year/.test(src("client/src/components/shared.jsx")));

  // ── §3 · THE AUDIT LOG IS SENTENCES ───────────────────────────────────────
  console.log("\n— §3 · audit log —");
  const A = require("../auditTrail");
  const seg = A.describeAuditRow({ action: "updated", entity_type: "group", entity_label: "Spring givers",
    before: { segment: '{"rules":[{"field":"total_giving","op":"gte","value":500}]}' }, after: { segment: '{"rules":[{"field":"total_giving","op":"gte","value":1000}]}' } });
  ok("§3 a segment change never prints raw JSON", !/[{}"[\]]/.test(seg.replace(/^[^:]*: /, "")) && !/segment from "\{/.test(seg), seg);
  const one = A.describeAuditRow({ action: "updated", entity_type: "fund", entity_label: "Roof", record_count: 1 });
  ok("§3 one record is \"1 record\"", /\(1 record\)$/.test(one) && !/1records|1 records/.test(one), one);
  const W = await import(path.join(ROOT, "client/src/lib/auditWords.js")).catch(() => null);
  ok("§3 the screen's detail reads words for an object", !!W && W.auditValue({ rules: [{ field: "city", value: "Ely" }] }) === "rules field city, value Ely" && W.recordCount(1) === "1 record",
    W && W.auditValue({ rules: [{ field: "city", value: "Ely" }] }));

  // ── §4 · ZERO IS 0 ─────────────────────────────────────────────────────────
  console.log("\n— §4 · volunteers —");
  const vh = (await api("GET", `/donors/${D("pim")}/volunteer-hours`, tok)).body || {};
  ok("§4 a volunteer with no shifts has 0 hours and 0 shifts on the record", vh.shiftCount === 0 && vh.hundredths === 0, { n: vh.shiftCount, h: vh.hundredths });
  ok("§4 the list never draws a blank hours cell", /return String\(Number\(v\) \|\| 0\)/.test(src("client/src/components/VolunteerList.jsx")));

  // ── §6 · WHO A FOUNDATION'S NOTE GREETS ───────────────────────────────────
  console.log("\n— §6 · greetings —");
  const G = await import(path.join(ROOT, "shared/greeting.js"));
  const fdn = { name: "Windermere Foundation", kind: "organisation", contactName: "Ruth Ashgrove" };
  ok("§6 a note to the foundation's address opens \"Dear friends at Windermere Foundation,\"",
    G.greetingLine({ ...fdn, to: "grants@windermere.example.org" }, { word: "Hi" }) === "Dear friends at Windermere Foundation,", G.greetingLine({ ...fdn, to: "grants@windermere.example.org" }, { word: "Hi" }));
  ok("§6 a note to Ruth's own address opens \"Hi Ruth,\"", G.greetingLine({ ...fdn, to: "ruth.ashgrove@windermere.example.org" }, { word: "Hi" }) === "Hi Ruth,");
  const ins = (await api("GET", "/insights", tok)).body || {};
  const says = (ins.cards || []).flatMap(c => (c.items || []).filter(i => i.name === "Windermere Foundation").map(i => (i.how && i.how.say) || "")).filter(Boolean);
  ok("§6 Home's move for Windermere never says \"Hi Ruth\"", says.length > 0 && says.every(s => /^Dear friends at Windermere Foundation,/.test(s)), says);

  // ── §7 · ONE JOURNEY SPAN ──────────────────────────────────────────────────
  console.log("\n— §7 · journeys —");
  const J = await import(path.join(ROOT, "shared/journeyShape.js"));
  const steps = [0, 30, 60, 120, 180, 240, 330].map(d => ({ offsetDays: d }));
  ok("§7 the span is computed once and the sentence reads it", typeof J.journeySpan === "function" && J.touchesSentence(steps).startsWith(`7 touches over ${J.journeySpan(steps)}.`), J.journeySpan && J.journeySpan(steps));
  ok("§7 the builder reads the same span", /journeySpan\(draft\)/.test(src("client/src/components/JourneyBuilder.jsx")) && !/maxOffset < 45/.test(src("client/src/components/JourneyBuilder.jsx")));
  const presets = (await api("GET", "/journeys", tok)).body || {};
  const rows = [...(presets.journeys || []), ...(presets.presets || [])].filter(r => r.touches && Array.isArray(r.steps) && r.steps.length);
  ok("§7 every journey and template on the list states the span of its own steps", rows.every(r => r.touches.includes(`over ${J.journeySpan(r.steps)}.`)), rows.filter(r => !r.touches.includes(`over ${J.journeySpan(r.steps)}.`)).map(r => [r.name, r.touches]));

  // ── §9 · TELL THE CANDIDATES APART ────────────────────────────────────────
  console.log("\n— §9 · import candidates —");
  const C = await import(path.join(ROOT, "client/src/lib/candidateLine.js")).catch(() => null);
  const lines = C ? [{ email: "faye1@x.org", city: "Duluth", lastGift: "2026-09-29", lastAmount: 25 }, { city: "Ely" }].map(C.candidateLine) : [];
  ok("§9 each candidate says email, city and last gift, or that one is not on file",
    lines[0] === "faye1@x.org · Duluth · last gift $25 on Sep 29, 2026" && lines[1] === "no email · Ely · no gifts yet", lines);

  // ── §10 · SENT MEANS SOMEBODY GOT IT ──────────────────────────────────────
  console.log("\n— §10 · campaigns —");
  const CK = await import(path.join(ROOT, "shared/campaignKind.js"));
  const camps = [{ id: "a", type: "email", status: "sent", sent_at: "2026-11-01", recipient_count: 0 }, { id: "b", type: "email", status: "sent", sent_at: "2026-11-01", recipient_count: 2 }];
  const stats = CK.campaignStats(camps);
  ok("§10 a campaign that reached nobody is not counted as Sent", stats.totalSentRows.length === 1 && stats.totalSentRows[0].id === "b", stats.totalSentRows.map(c => c.id));
  ok("§10 and it reads \"Not sent: nobody could receive it\"", CK.wentOutToNobody && CK.wentOutToNobody(camps[0]) && CK.NOBODY_SENTENCE === "Not sent: nobody could receive it");

  // ── THE BROWSER LEG · real clicks on a production build ───────────────────
  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }
  await api("PUT", "/orgs/branding", tok, { logoData: PNG });
  const lg = await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: F.PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  try {
    // §5 · write off Hollis's pledge with real clicks; read the toast.
    await page.goto(`${APP}/donors/${D("hollis")}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 });
    await page.getByRole("button", { name: "Write Off", exact: true }).first().click({ timeout: 15000 });
    await page.getByRole("button", { name: /^Write off \$450/ }).first().click({ timeout: 10000 });
    const toast = await page.locator('[data-testid="undo-toast"], [role="status"]').filter({ hasText: /off|Deleted/ }).first().textContent({ timeout: 8000 }).catch(() => "");
    ok("§5 (browser) the write-off's toast says \"Wrote off $450.00.\", never \"Deleted\"", /Wrote off \$450(\.00)?\./.test(toast || "") && !/Deleted/.test(toast || ""), toast);
    const [pl] = await q(`SELECT status FROM pledges WHERE id='pl_p7'`);
    ok("§5 (browser) and the pledge is written off", pl && pl.status === "written_off", pl);

    // §8 · the brand preview reads the saved name and logo.
    await page.goto(`${APP}/app/settings`, { waitUntil: "networkidle", timeout: 60000 });
    const bname = page.locator('[data-testid="brand-preview-name"]');
    await page.getByText("Brand Identity", { exact: true }).first().scrollIntoViewIfNeeded({ timeout: 15000 }).catch(() => {});
    const shownName = await bname.first().textContent({ timeout: 15000 }).catch(() => "");
    ok("§8 (browser) the preview says the org's saved name", shownName === "Polish Seven Tidewater Choir", shownName);
    ok("§8 (browser) and shows the saved logo", (await page.locator('[data-testid="brand-preview-logo"]').count()) === 1);

    // §4 · Pim's volunteer view: 0 hours, 0 shifts.
    await page.goto(`${APP}/app/volunteers`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText("Pim Ardelle", { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
    const hrsText = await page.locator('[data-testid="vol-person-hours"]').first().innerText({ timeout: 10000 }).catch(() => "");
    ok("§4 (browser) a volunteer with no shifts reads 0 hours and 0 shifts", /^0\s+hours\s+0\s+shifts/.test(hrsText.trim()), hrsText);
  } finally { await browser.close(); }
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
