// BUILD-100 (grants) Part 7 — THE SCREENS, WALKED.
//
// Parts 1–6 built the grant machinery and proved it through the API. Part 7
// is the screens a person actually uses, and every assertion here is read off
// a REAL browser at 1440 AND 390 and compared with what the API said — never
// with a string written in this file:
//
//   §1  Home says how many grant deadlines fall in the next two weeks, as a
//       sentence, and Grants → Deadlines says the SAME sentence (one window
//       function, shared/grantMilestones.deadlinesInWindow);
//   §2  Grants → Deadlines: twelve months, every open deadline, the lead times;
//       a grant's own deadlines — add one, mark one done;
//   §3  documents on the grant: listed with the server's own count, and the
//       link WORKS through the preview's vercel.json proxy (a PDF comes back,
//       not index.html — the BUILD-95 photo class, found by this part);
//       upload one, and it is listed;
//   §4  the funder on the organisation's own record, and never on a person's;
//   §5  Finance → Restricted: every grant the API lists, each figure's hover IS
//       the registry's definition, an overspent grant is never clamped;
//       add spending and the figure moves;
//   §6  Import grants from the import menu: the preview's count IS the plan's,
//       it says what it writes and what it does not, and importing lands them;
//   §7  no page errors, and no screen scrolls sideways, at either width.
//
// Standard scratch stack (tests/README.md), plus the preview (APP_URL).

const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const haveBrowser = () => {
  try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html"));
};

const ORG = "b100_scr";
const ME = "b100scr@example.org";
const PW = "loadtest1234";
const CHILD = ["grant_spend", "grant_milestones", "grant_documents", "grant_interactions",
  "program_grants", "grants", "pledge_installments", "fin_transactions", "interactions",
  "thank_you_drafts", "threads", "tasks", "opportunities", "moves", "receipts", "gifts", "pledges",
  "donors", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// The smallest file the server's first-bytes check reads as a PDF.
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const money = n => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

(async () => {
  console.log("build100-screens");
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
           VALUES ($1,'Riverbend Arts (screens)','b100-scr',1,'team','active','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b100scr',$1,$2,$3,'Allie Barnett','admin')`,
    [ORG, ME, bcrypt.hashSync(PW, 4)]);
  const tok = await login(ME);
  await api("POST", "/onboarding/complete", tok, {});
  await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count) VALUES
           ('fd_scr_sun',$1,'The Sunrise Foundation','fd_scr_sun@example.org','organisation','cultivate',0,0),
           ('d_scr_ann',$1,'Ann Arbor','d_scr_ann@example.org','person','steward',0,0)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_scr_youth',$1,'Youth programme',true)`, [ORG]);

  // ── The fixture, through the product's own doors ──────────────────────────
  await api("PUT", "/funders/fd_scr_sun", tok, { funderType: "private_foundation" });
  const g1 = await api("POST", "/funders/fd_scr_sun/grants", tok, { program: "Youth programme", amountRequested: 10000,
    status: "submitted", restriction: "program_restricted", fundId: "f_scr_youth" });
  const aw = await api("PUT", `/grants/${g1.body.id}/award`, tok,
    { amountAwarded: 10000, frequency: "quarterly", installmentCount: 2, firstDue: plusDays(-30) });
  await api("POST", "/donors/fd_scr_sun/gifts", tok, { amount: 5000, date: plusDays(-20), pledgeId: aw.body.pledgeId, idempotencyKey: "b100scr-p1" });
  await api("POST", `/grants/${g1.body.id}/spend`, tok, { amount: 1200, spentOn: plusDays(-10), description: "Spring session tutors" });
  const g2 = await api("POST", "/funders/fd_scr_sun/grants", tok, { program: "Arts access", amountRequested: 25000,
    status: "submitted", restriction: "unrestricted" });
  const m1 = await api("POST", `/grants/${g2.body.id}/milestones`, tok, { kind: "proposal_due", dueDate: plusDays(5) });
  const m2 = await api("POST", `/grants/${g1.body.id}/milestones`, tok, { kind: "report_due", dueDate: plusDays(40) });
  const d1 = await api("POST", `/grants/${g1.body.id}/documents`, tok,
    { docType: "award_letter", file: "data:application/pdf;base64," + PDF.toString("base64"), fileName: "sunrise-award.pdf" });
  ok("§0 the fixture lands through the real routes",
     g1.status === 201 && aw.status === 200 && g2.status === 201 && m1.status === 201 && m2.status === 201 && d1.status === 201,
     [g1.status, aw.status, g2.status, m1.status, m2.status, d1.status, JSON.stringify(d1.body).slice(0, 120)]);

  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
    await reset(); await closeDb(); summary(); return;
  }
  const HN = await import("../shared/homeNote.js");
  const GM = await import("../shared/grantMilestones.js");
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();

  for (const W of [1440, 390]) {
    const full = W === 1440;              // the writes run once, at desktop width
    console.log(`\n— at ${W}px —`);
    const ctx = await browser.newContext({ viewport: { width: W, height: full ? 1000 : 844 }, ...(full ? {} : { isMobile: true, hasTouch: true }) });
    const page = await ctx.newPage();
    const errs = [];
    // A scratch boot has no ANTHROPIC_API_KEY (the Suggested panel's 503 is
    // Steward's own state), and /_vercel/* is the preview's own gap. Both named.
    page.on("pageerror", e => { const t = String(e.message); if (!/Stream failed: 503/.test(t)) errs.push(t); });
    page.on("console", m => { const t = m.text(); if (m.type() === "error" && !/_vercel|Failed to load resource|Stream failed: 503/.test(t)) errs.push(t); });
    const noSideways = async where => ok(`§7 ${where} does not scroll sideways at ${W}`,
      !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)),
      await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    const goTab = async label => {
      const direct = page.locator("button:visible", { hasText: new RegExp("^\\s*[^A-Za-z]*\\s*" + label + "\\s*$") }).first();
      if (await direct.count()) { await direct.click(); }
      else {
        await page.locator("button:visible", { hasText: /^\s*[^A-Za-z]*\s*More\s*$/ }).first().click();
        await page.waitForTimeout(400);
        await page.locator("button:visible", { hasText: new RegExp(label) }).first().click();
      }
      await page.waitForTimeout(1500);
    };

    const lj = await (await page.request.post(BASE + "/auth/login", { data: { email: ME, password: PW } })).json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(x => { localStorage.setItem("npe_token", x.token); localStorage.setItem("npe_user", JSON.stringify(x.user)); localStorage.setItem("npe_org", JSON.stringify(x.org)); }, lj);

    // ── §1 · Home ───────────────────────────────────────────────────────────
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const home = (await api("GET", "/dashboard/home", tok)).body;
    const want = HN.grantDeadlineSentence(home.grantDeadlinesSoon, home.grantDeadlineWindowDays);
    ok(`§1 the server counts ONE deadline in the next two weeks (${W})`, home.grantDeadlinesSoon === 1, home.grantDeadlinesSoon);
    const body1 = await page.locator("body").innerText();
    ok(`§1 Home says it as a sentence: "${want}" (${W})`, !!want && body1.includes(want), body1.slice(0, 400));
    ok(`§1 …and never as a bare numeral (${W})`, !/\b1 grant deadline/.test(body1));
    await noSideways("Home");

    // ── §2 · Grants → Deadlines ────────────────────────────────────────────
    await goTab("Grants");
    await page.locator("button:visible", { hasText: /^Deadlines$/ }).first().click();
    await page.waitForTimeout(1500);
    const dl = (await api("GET", "/grants/deadlines", tok)).body;
    ok(`§2 Grants → Deadlines opens (${W})`, await page.locator('[data-testid="deadlines-view"]').count() === 1);
    const line = await page.locator('[data-testid="deadlines-line"]').innerText().catch(() => "");
    const sameWindow = HN.grantDeadlineSentence(GM.deadlinesInWindow(dl.milestones, dl.today).length, GM.HOME_WINDOW_DAYS);
    ok(`§2 it opens on the SAME sentence Home says (${W})`, line.includes(want) && sameWindow === want, { line, want, sameWindow });
    ok(`§2 twelve months, empty ones included (${W})`, await page.locator('[data-testid="calendar-month"]').count() === 12 && dl.calendar.length === 12);
    ok(`§2 every open deadline the API lists is on screen (${W})`,
       await page.locator('[data-testid="deadline-row"]').count() === dl.milestones.length, dl.milestones.length);
    const listTxt = await page.locator('[data-testid="deadlines-view"]').innerText();
    ok(`§2 each row carries the server's own timing sentence (${W})`, dl.milestones.every(m => listTxt.includes(m.sentence)), dl.milestones.map(m => m.sentence));
    const rpt = dl.milestones.find(m => m.kind === "report_due");
    ok(`§2 the report-due row carries its grant's balance (${W})`, !!rpt && !!rpt.balance && listTxt.includes(rpt.balance.sentence), rpt && rpt.balance);
    ok(`§2 the org's lead times are shown (${W})`, await page.locator('[data-testid="lead-days"] input').count() === dl.milestoneTypes.length);
    await noSideways("Grants → Deadlines");

    // A grant's own deadlines and documents, opened from the list.
    const openG1 = page.locator('[data-testid="deadline-row"]', { hasText: "Report due" }).locator("button", { hasText: "Open grant" });
    await openG1.click();
    await page.waitForTimeout(1500);
    const panel = page.locator('[data-testid="grant-deadlines"]');
    ok(`§2 the grant carries its own deadlines panel (${W})`, await panel.count() === 1);
    ok(`§2 …listing only its own (${W})`, await panel.locator('[data-testid="deadline-row"]').count()
       === dl.milestones.filter(m => m.grantId === g1.body.id).length);
    ok(`§3 the "coming soon" placeholder is gone (${W})`, !(await page.locator("body").innerText()).includes("File uploads coming soon"));
    const docs = (await api("GET", `/grants/${g1.body.id}/documents`, tok)).body;
    const docRows = page.locator('[data-testid="grant-documents"] [data-testid="grant-document"]');
    ok(`§3 documents: every one the API lists (${W})`, await docRows.count() === docs.documents.length && docs.documents.length >= 1, docs.documents.length);
    const href = await docRows.first().locator("a").getAttribute("href");
    ok(`§3 the link is the signed bare path (${W})`, /^\/grant-documents\/[^?]+\?e=\d+&s=/.test(href || ""), href);
    const fetched = await page.request.get(APP + href);
    const ctype = fetched.headers()["content-type"] || "";
    const bytes = await fetched.body();
    ok(`§3 …and it OPENS through the vercel.json proxy: a PDF, not the app shell (${W})`,
       fetched.status() === 200 && /application\/pdf/.test(ctype) && bytes.slice(0, 5).toString() === "%PDF-", { status: fetched.status(), ctype });

    if (full) {
      // Add a deadline, then mark one done.
      const before = (await api("GET", "/grants/deadlines", tok)).body.milestones.filter(m => m.grantId === g1.body.id).length;
      await panel.locator('[data-testid="deadline-add"]').click();
      await panel.locator('[data-testid="deadline-kind"]').selectOption("renewal_opens");
      await panel.locator('[data-testid="deadline-date"]').fill(plusDays(120));
      await panel.locator('[data-testid="deadline-save"]').click();
      await page.waitForTimeout(1200);
      const after = (await api("GET", "/grants/deadlines", tok)).body.milestones.filter(m => m.grantId === g1.body.id);
      ok("§2 adding a deadline from the grant writes one", after.length === before + 1 && after.some(m => m.kind === "renewal_opens"), after.map(m => m.kind));
      ok("§2 …and the panel shows it", await panel.locator('[data-testid="deadline-row"]').count() === after.length);
      await panel.locator('[data-testid="deadline-row"]', { hasText: "Renewal" }).locator('[data-testid="deadline-done"]').click();
      await page.waitForTimeout(1200);
      const [ren] = await q(`SELECT state FROM grant_milestones WHERE org_id=$1 AND kind='renewal_opens'`, [ORG]);
      ok("§2 Done marks it done", ren && ren.state === "done", ren);
      // Upload a document.
      await page.locator('[data-testid="doc-type"]').selectOption("correspondence");
      await page.locator('[data-testid="doc-file"]').setInputFiles({ name: "thank-you-note.txt", mimeType: "text/plain", buffer: Buffer.from("Thank you for the award.\n") });
      await page.waitForTimeout(1500);
      const docs2 = (await api("GET", `/grants/${g1.body.id}/documents`, tok)).body.documents;
      ok("§3 attaching a file stores it", docs2.length === docs.documents.length + 1 && docs2.some(d => d.fileName === "thank-you-note.txt"), docs2.map(d => d.fileName));
      ok("§3 …and it is listed", await docRows.count() === docs2.length);
    }
    await noSideways("the grant");

    // ── §4 · the funder on the organisation's own record ────────────────────
    await page.goto(`${APP}/donors/fd_scr_sun`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const fp = page.locator('[data-testid="funder-panel"]');
    const fg = (await api("GET", "/funders/fd_scr_sun/grants", tok)).body;
    ok(`§4 an organisation's record carries the funder panel (${W})`, await fp.count() === 1);
    ok(`§4 …with its type (${W})`, await fp.locator('[data-testid="funder-type"]').inputValue() === fg.funder.funderType);
    ok(`§4 …and every grant with them (${W})`, await fp.locator('[data-testid="funder-grant"]').count() === fg.grants.length && fg.grants.length >= 2, fg.grants.length);
    const fd = (await api("GET", "/funders/fd_scr_sun/documents", tok)).body;
    ok(`§4 …and every document signed with them, across grants (${W})`,
       await fp.locator('[data-testid="grant-document"]').count() === (fd.documents || []).length);
    if (full) {
      await fp.locator('[data-testid="funder-ein"]').fill("12-3456789");
      await fp.locator('[data-testid="funder-save"]').click();
      await page.waitForTimeout(1000);
      const [e] = await q(`SELECT funder_ein FROM donors WHERE id='fd_scr_sun'`);
      ok("§4 the EIN saves from the record (stored as nine digits)", e && String(e.funder_ein).replace(/\D/g, "") === "123456789", e);
      await fp.locator('[data-testid="funder-new-grant"]').click();
      await fp.locator('[data-testid="fg-program"]').fill("Summer studio");
      await fp.locator('[data-testid="fg-amount"]').fill("7,500");
      await fp.locator('[data-testid="fg-save"]').click();
      await page.waitForTimeout(1200);
      const fg2 = (await api("GET", "/funders/fd_scr_sun/grants", tok)).body.grants;
      ok("§4 a new request from the record writes one grant, in cents", fg2.length === fg.grants.length + 1 && fg2.some(g => g.program === "Summer studio" && g.amountRequestedCents === 750000), fg2.map(g => g.program));
      ok("§4 …and the panel lists it", await fp.locator('[data-testid="funder-grant"]').count() === fg2.length);
    }
    await noSideways("the funder's record");
    await page.goto(`${APP}/donors/d_scr_ann`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    ok(`§4 a PERSON's record carries no funder panel (${W})`, await page.locator('[data-testid="funder-panel"]').count() === 0);

    // ── §5 · Finance → Restricted ──────────────────────────────────────────
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await goTab("Finance");
    await page.locator("button:visible", { hasText: /^Restricted$/ }).first().click();
    await page.waitForTimeout(1500);
    const rs = (await api("GET", "/finance/restricted", tok)).body;
    ok(`§5 Finance → Restricted opens (${W})`, await page.locator('[data-testid="restricted-view"]').count() === 1);
    ok(`§5 every restricted grant the API lists (${W})`, await page.locator('[data-testid="restricted-grant"]').count() === rs.grants.length && rs.grants.length === 1);
    const rem = page.locator('[data-testid="restricted-totals"] [data-testid="restricted-remaining"]');
    ok(`§5 the remaining figure's hover IS the registry's definition (${W})`, (await rem.getAttribute("title")) === rs.definitions.remaining);
    ok(`§5 …and it shows the server's figure (${W})`, (await rem.innerText()).includes(money(rs.totals.remaining)), { screen: await rem.innerText(), api: rs.totals.remaining });
    ok(`§5 the grant's own sentence is the server's (${W})`,
       (await page.locator('[data-testid="restricted-grant-sentence"]').first().innerText()) === rs.grants[0].sentence);
    if (full) {
      await page.locator('[data-testid="restricted-expand"]').first().click();
      await page.waitForTimeout(800);
      ok("§5 the spending behind the figure is listed", await page.locator('[data-testid="spend-row"]').count() === 1);
      await page.locator('[data-testid="spend-amount"]').fill("300");
      await page.locator('[data-testid="spend-date"]').fill(plusDays(-1));
      await page.locator('[data-testid="spend-desc"]').fill("Art supplies");
      await page.locator('[data-testid="spend-save"]').click();
      await page.waitForTimeout(1500);
      const rs2 = (await api("GET", "/finance/restricted", tok)).body;
      ok("§5 adding spending moves remaining by exactly that, in cents", rs.totals.remainingCents - rs2.totals.remainingCents === 30000, [rs.totals.remainingCents, rs2.totals.remainingCents]);
      ok("§5 …and the screen shows the new figure", (await rem.innerText()).includes(money(rs2.totals.remaining)), await rem.innerText());
      // Overspend it and the figure must go negative, never clamp to zero.
      await page.locator('[data-testid="spend-amount"]').fill("9000");
      await page.locator('[data-testid="spend-date"]').fill(plusDays(-1));
      await page.locator('[data-testid="spend-desc"]').fill("A deliberate overspend");
      await page.locator('[data-testid="spend-save"]').click();
      await page.waitForTimeout(1500);
      const rs3 = (await api("GET", "/finance/restricted", tok)).body;
      const remTxt = await page.locator('[data-testid="restricted-grant"] [data-testid="restricted-remaining"]').first().innerText();
      ok("§5 an overspent award shows a NEGATIVE remaining, never $0", rs3.grants[0].overspent && /-\$/.test(remTxt), remTxt);
      ok("§5 …and says so in its sentence", (await page.locator('[data-testid="restricted-grant-sentence"]').first().innerText()) === rs3.grants[0].sentence && /more has been spent/.test(rs3.grants[0].sentence));
      const [sp] = await q(`SELECT id FROM grant_spend WHERE org_id=$1 AND description='A deliberate overspend'`, [ORG]);
      await api("DELETE", `/grants/spend/${sp.id}`, tok);
    }
    await noSideways("Finance → Restricted");

    // ── §6 · Import grants ─────────────────────────────────────────────────
    await goTab("Donors");
    await page.locator("button:visible", { hasText: /Import & tools/ }).first().click();
    await page.waitForTimeout(300);
    await page.locator('[role="menuitem"]', { hasText: "Import grants" }).click();
    await page.waitForTimeout(600);
    ok(`§6 the import menu opens the grant importer (${W})`, await page.locator('[data-testid="grant-import"]').count() === 1);
    const csv = "Funder,Program,Amount Requested,Status,Deadline\n"
      + `Harbor Community Foundation,After-school strings ${W},12000,Submitted,${plusDays(60)}\n`
      + `The Sunrise Foundation,Winter showcase ${W},4000,Researching,${plusDays(90)}\n`
      + ",No funder here,500,Submitted,\n";
    await page.locator('[data-testid="grant-import-file"]').setInputFiles({ name: `grants-${W}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.waitForTimeout(2000);
    const lines = csv.trim().split("\n"), headers = lines[0].split(",");
    const rows = lines.slice(1).map(l => Object.fromEntries(l.split(",").map((v, i) => [headers[i], v])));
    const pv = (await api("POST", "/grants/import/preview", tok, { headers, rows })).body;
    ok(`§6 the preview's count IS the server plan's (${W})`,
       (await page.locator('[data-testid="gi-grants"]').innerText()).startsWith(String(pv.counts.grants)) && pv.counts.grants >= 1,
       { screen: await page.locator('[data-testid="gi-grants"]').innerText().catch(() => ""), plan: pv.counts });
    ok(`§6 …new funder records counted the same way (${W})`, (await page.locator('[data-testid="gi-new-funders"]').innerText()).startsWith(String(pv.counts.willCreateFunders)));
    const wr = await page.locator('[data-testid="grant-import-writes"]').innerText().catch(() => "");
    ok(`§6 it says what it writes AND what it does not, before the button (${W})`,
       pv.writes.every(w => wr.includes(w)) && pv.doesNotWrite.every(w => wr.includes(w)), wr);
    ok(`§6 a set-aside row is named by its line (${W})`,
       pv.refused.length === 0 || (await page.locator('[data-testid="grant-import-refused"]').innerText()).includes("Line " + pv.refused[0].line), pv.refused);
    await noSideways("the grant importer");
    if (full) {
      const n0 = (await q(`SELECT COUNT(*)::int c FROM grants WHERE org_id=$1`, [ORG]))[0].c;
      await page.locator('[data-testid="grant-import-commit"]').click();
      await page.waitForTimeout(2000);
      const n1 = (await q(`SELECT COUNT(*)::int c FROM grants WHERE org_id=$1`, [ORG]))[0].c;
      ok("§6 importing writes exactly the grants the preview counted", n1 - n0 === pv.counts.grants, [n0, n1, pv.counts.grants]);
      ok("§6 …and says what it did in a sentence", (await page.locator('[data-testid="grant-import-result"]').innerText().catch(() => "")).length > 10);
      const [ms] = await q(`SELECT COUNT(*)::int c FROM grant_milestones m JOIN grants g ON g.id=m.grant_id WHERE g.org_id=$1 AND g.program='After-school strings 1440'`, [ORG]);
      ok("§6 …and invented no deadline or follow-up (the file is history)", ms.c === 0, ms);
    }

    ok(`§7 no page errors anywhere in the walk at ${W}`, errs.length === 0, errs.slice(0, 4));
    await ctx.close();
  }
  await browser.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
