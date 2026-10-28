// tests/fix55-import-reads.test.js: FIX-55. THE IMPORT SCREEN READS RIGHT.
// Guards donor data: what the preview says before Import is what Import
// writes, the window closes without writing, a dropped file is the same file,
// and people she deleted come back, or stay gone for good, only on her word.
//
//   §1 every question type (which person, deleted match, event date, column
//      role) leaves the preview ready once answered; a re-read sends the
//      file's key, not its cells
//   §2 the browser, the event workbook: ticking "Use the event date" changes
//      the Money line and the button before Import, and Import then dates all
//      63 gifts Oct 22, 2026, counted in This year, the receipt reconciled
//   §3 the browser: the X, Escape and a click outside close the preview, and
//      nothing is written
//   §4 the browser: a file dropped on the start screen, and on the Donors
//      page, opens the same preview as choosing it
//   §6 the undo confirm says which of the people already here it puts back,
//      in the receipt's own count (it said 75 where the receipt said 79)
//   §5 "Bring them all back" on a file whose 82 givers were deleted gives the
//      file's full gifts and pledges; Empty trash then stops them matching
//
// HOW IT GOES RED ON MAIN: §1 the re-read by key is refused (no fileKey on
// main, so the screen sent the whole workbook every time); §2 the button
// keeps "(63 undated)" while the re-read is out and Import can be pressed on
// the stale preview; §4 there is no drop zone; §5 there is no
// purge-trash preview and Bring them all back does not exist.
//
// Standard scratch stack (tests/README.md), APP_URL for the browser legs. Sends nothing.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, BASE, browserLegOrSkip } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const XLSX = require(path.join(ROOT, "client", "node_modules", "xlsx"));
const WORKBOOK = path.join(__dirname, "fixtures", "import", "fix52", "event-workbook-shape.xlsx");
const WKEY = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "import", "fix52", "expected.json"), "utf8"));
const APP = process.env.APP_URL || "http://localhost:4173";
const DIST = path.join(ROOT, "client", "dist");
const PASSWORD = "loadtest1234";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fix55-"));

let R = null;
async function sheetsOf(file) {
  R = R || await import("../shared/sheetRead.js");
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true }), XLSX);
}
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address) VALUES ($1,$2,$3,1,'active','team','1 Test Way, Testville, TS 00000')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  const r = await api("POST", "/auth/login", null, { email, password: PASSWORD });
  if (!r.body || !r.body.token) throw new Error("login failed for " + email + ": " + JSON.stringify(r.body));
  return { id, email, token: r.body.token, user: r.body.user, org: r.body.org };
}
const gridOf = rows => [{ name: "Sheet1", grid: rows }];
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null };
  for (let i = 0; i < 800; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    await new Promise(res => setTimeout(res, 150));
  }
  return { start: r, end: { status: "timeout" } };
}
const writes = async org => (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS g, (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS d,
  (SELECT COUNT(*) FROM imports WHERE org_id=$1)::int AS i, (SELECT COUNT(*) FROM sheet_import_jobs WHERE org_id=$1)::int AS j`, [org]))[0];

async function apiLegs() {
  // §1 every question type, answered, leaves the preview ready
  const A = await freshOrg("org_fix55qs", "Questions (test)");
  await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES
             ('d_f55_r1',$1,'Pat Rainwater','pat.r1@test.local','system:test','Test'), ('d_f55_r2',$1,'Pat Rainwater','pat.r2@test.local','system:test','Test')`, [A.id]);
  await q(`INSERT INTO donors (id, org_id, name, deleted_at, created_by, created_by_name) VALUES ('d_f55_gone',$1,'Cleo Ashby',NOW(),'system:test','Test')`, [A.id]);
  const body = { fileName: "questions.csv", sheets: gridOf([["Name", "Date", "Figure"], ["Pat Rainwater", "2026-09-01", "125.50"], ["Cleo Ashby", "2026-09-02", "80.25"], ["Rory Penn", "2026-09-03", "40.75"]]) };
  let u = (await api("POST", "/sheet-import/understand", A.token, body)).body;
  const kinds = new Set((u.questions || []).map(x => x.kind || x.id));
  ok("§1 the file asks which person, about a deleted match, and a column's role", kinds.has("person") && kinds.has("deletedPerson") && kinds.has("column") && u.ready === false,
     JSON.stringify((u.questions || []).map(x => [x.kind, x.optional])));
  ok("§1 the preview hands back the file's key", typeof u.fileKey === "string" && u.fileKey.length >= 16, u.fileKey);
  const person = u.questions.find(x => x.kind === "person"), col = u.questions.find(x => x.kind === "column"), del = u.questions.find(x => x.kind === "deletedPerson");
  // a re-read by key: the cells are not sent again
  const byKey = await api("POST", "/sheet-import/understand", A.token, { fileName: body.fileName, fileKey: u.fileKey, answers: { people: { [person.key]: "d_f55_r1" } } });
  ok("§1 a re-read by the file's key needs no cells", byKey.status === 200 && byKey.body.fileKey === u.fileKey, byKey.status + " " + JSON.stringify(byKey.body).slice(0, 200));
  ok("§1 answering which person removes that question", byKey.status === 200 && !(byKey.body.questions || []).some(x => x.kind === "person"));
  const unknown = await api("POST", "/sheet-import/understand", A.token, { fileName: body.fileName, fileKey: "0".repeat(32), answers: {} });
  ok("§1 a key the server does not hold asks for the file again (409 file_needed)", unknown.status === 409 && unknown.body.error === "file_needed", unknown.status);
  const answered = { people: { [person.key]: "d_f55_r1" }, deletedPeople: { [del.key]: "same" } };
  u = (await api("POST", "/sheet-import/understand", A.token, { fileName: body.fileName, fileKey: u.fileKey, answers: answered, overrides: { [col.key]: "amount" } })).body;
  ok("§1 with every question answered the preview is ready and the button enables", u.ready === true && !/^Answer/.test(u.button.text), JSON.stringify([u.ready, u.button && u.button.text, (u.questions || []).filter(x => !x.optional)]));
  ok("§1 the deleted match answered Same person stays out", (u.deletedMatches || []).some(x => x.id === "d_f55_gone") && u.counts.gifts === 2, JSON.stringify([u.counts.gifts, u.deletedMatches]));
  const wb = await sheetsOf(WORKBOOK);
  const ev = (await api("POST", "/sheet-import/understand", A.token, { fileName: "event.xlsx", sheets: wb, answers: { eventDate: "2026-10-22", useEventDate: true } })).body;
  ok("§1 the event date answered: no gift undated, the button says so", ev.counts.undatedGifts === 0 && !/undated/.test(ev.button.text) && ev.ready === true, ev.button && ev.button.text);

  // §5 bring them all back, then empty the trash
  const B = await freshOrg("org_fix55back", "Bring back (test)");
  const wbBody = { fileName: "event-workbook-shape.xlsx", sheets: wb, answers: { eventDate: "2026-10-22", useEventDate: true } };
  const first = await importJob(B.token, wbBody);
  ok("§5 the event workbook imports", first.end && first.end.status === "done", JSON.stringify(first.end || first.start.body).slice(0, 300));
  const givers = (await q(`SELECT DISTINCT donor_id AS id FROM (SELECT donor_id FROM gifts WHERE org_id=$1 UNION SELECT donor_id FROM pledges WHERE org_id=$1) x`, [B.id])).map(r => r.id);
  ok(`§5 the file's givers are the key's ${WKEY.donorRecords + WKEY.pledgerOnlyRecords} records`, givers.length === WKEY.donorRecords + WKEY.pledgerOnlyRecords, givers.length);
  // undo the import, then delete the givers by hand: the file now names 82 people she deleted
  const undo = await api("POST", `/imports/${first.importId}/reverse`, B.token, {});
  ok("§5 the import undoes", undo.status === 200, undo.status + " " + JSON.stringify(undo.body).slice(0, 200));
  await q(`INSERT INTO donors (id, org_id, name, email, external_donor_id, deleted_at, created_by, created_by_name)
             SELECT 'dg_' || substr(md5(x.k), 1, 12), $1, x.name, x.email, x.ext, NOW() - interval '120 days', 'system:test', 'Test'
               FROM jsonb_to_recordset($2::jsonb) AS x(k text, name text, email text, ext text)`,
    [B.id, JSON.stringify((await (async () => { const Rm = await import("../shared/sheetRead.js"); const uu = Rm.understand({ sheets: wb, today: "2026-10-27", answers: {} });
      const keys = new Set([...uu.gifts, ...uu.pledges].map(g => g.personKey));
      return uu.people.filter(p => keys.has(p.key)).map(p => ({ k: p.key, name: p.name, email: p.email || null, ext: p.externalId || null })); })()))]);
  let pv = (await api("POST", "/sheet-import/understand", B.token, wbBody)).body;
  const ids = [...new Set([...(pv.deletedMatches || []).map(x => x.id), ...(pv.questions || []).filter(x => x.kind === "deletedPerson").map(x => x.deletedId)])];
  ok(`§5 the preview names the ${givers.length} deleted givers and holds their money out`, ids.length === givers.length && pv.counts.gifts < WKEY.gifts, JSON.stringify([ids.length, pv.counts.gifts]));
  const back = await api("POST", "/sheet-import/bring-back", B.token, { ids });
  pv = (await api("POST", "/sheet-import/understand", B.token, { ...wbBody, fileKey: pv.fileKey, sheets: undefined })).body;
  ok(`§5 Bring them all back: ${WKEY.gifts} gifts $${WKEY.giftCents / 100}, ${WKEY.pledges} pledges, nobody held`,
     back.body.restored === givers.length && pv.counts.gifts === WKEY.gifts && pv.counts.giftCents === WKEY.giftCents && pv.counts.pledges === WKEY.pledges
     && !(pv.deletedMatches || []).length, JSON.stringify([back.body.restored, pv.counts && [pv.counts.gifts, pv.counts.giftCents, pv.counts.pledges], (pv.deletedMatches || []).length]));
  // delete them again and empty the trash: they never match again
  await q(`UPDATE donors SET deleted_at = NOW() - interval '120 days' WHERE org_id=$1 AND id = ANY($2)`, [B.id, ids]);
  const refused = await api("POST", "/donors/purge-trash", B.token, { olderThanDays: 90 });
  ok("§5 Empty trash needs its second confirm", refused.status === 400 && refused.body.error === "confirm_required", refused.status);
  const count30 = await api("GET", "/donors/purge-trash/preview?olderThanDays=365", B.token);
  const count = await api("GET", "/donors/purge-trash/preview?olderThanDays=90", B.token);
  ok("§5 the trash is counted first, by how long ago", count.status === 200 && count.body.count === ids.length && count30.body.count === 0 && /for good/.test(count.body.sentence),
     JSON.stringify([count.body, count30.body]));
  const purge = await api("POST", "/donors/purge-trash", B.token, { olderThanDays: 90, confirm: "empty" });
  ok("§5 Empty trash deletes them for good", purge.status === 200 && purge.body.purged === ids.length
     && (await q("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND id = ANY($2)", [B.id, ids]))[0].n === 0, JSON.stringify(purge.body).slice(0, 200));
  // the audit row is written as the response finishes: give it a moment
  const since = new Date(Date.now() - 60000).toISOString();
  let aud = [];
  for (let i = 0; i < 30 && !aud.length; i++) {
    aud = await q(`SELECT summary, record_count, entity_id, entity_label, changes::text AS changes, before_fields::text AS b, after_fields::text AS a
                         FROM fin_audit_log WHERE org_id=$1 AND request_path='/donors/purge-trash' AND status_code < 300 AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`, [B.id, since]);
    if (!aud.length) await new Promise(r => setTimeout(r, 100));
  }
  const audText = JSON.stringify(aud[0] || {});
  ok("§5 the audit row says a delete happened, not who", aud.length === 1 && aud[0].record_count === ids.length && !ids.some(id => audText.includes(id)), audText.slice(0, 300));
  pv = (await api("POST", "/sheet-import/understand", B.token, wbBody)).body;
  ok("§5 after Empty trash nobody in the file matches someone deleted", !(pv.deletedMatches || []).length && !(pv.questions || []).some(x => x.kind === "deletedPerson")
     && pv.counts.gifts === WKEY.gifts, JSON.stringify([(pv.deletedMatches || []).length, pv.counts.gifts]));
  // §6 the undo confirm and the receipt agree on the people already here
  const D = await freshOrg("org_fix55undo", "Undo words (test)");
  const RS = path.join(__dirname, "fixtures", "import", "real-shaped");
  const g = await importJob(D.token, { fileName: "jp-gift-history-287.xlsx", sheets: await sheetsOf(path.join(RS, "jp-gift-history-287.xlsx")) });
  const c = await importJob(D.token, { fileName: "jp-contacts-656.xlsx", sheets: await sheetsOf(path.join(RS, "jp-contacts-656.xlsx")) });
  const rcpt = (await api("GET", `/imports/${c.importId}`, D.token)).body.import || {};
  const up = (await api("GET", `/imports/${c.importId}/undo-preview`, D.token)).body || {};
  const matched = Number(up.counts && up.counts.peopleMatched) || 0, restored = Number(up.counts && up.counts.peopleRestored) || 0;
  const said = (up.sentence || "").match(/(\d[\d,]*) (?:people|person)(?: who (?:were|was))? already here/);
  ok("§6 both imports end done", g.end && g.end.status === "done" && c.end && c.end.status === "done");
  ok("§6 the undo confirm names the receipt's count of people already here, and how many of them it puts back",
     matched > 0 && restored > 0 && (restored === matched ? !!said && Number(said[1].replace(/,/g, "")) === matched
       : new RegExp(`${restored.toLocaleString("en-US")} of the ${matched.toLocaleString("en-US")} people already here`).test(up.sentence))
     && JSON.stringify(rcpt).includes(String(matched)), JSON.stringify({ matched, restored, sentence: up.sentence }));
  return { A, B };
}

function browserReady() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built";
  const dir = path.join(DIST, "assets");
  const js = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".js")) : [];
  if (!js.some(f => fs.readFileSync(path.join(dir, f), "utf8").includes(BASE.replace(/^https?:\/\//, "")))) return "client/dist not built against the local API";
  try { require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright")); }
  catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
  return null;
}
async function browserLegs() {
  if (browserLegOrSkip(browserReady(), "fix55 browser legs:")) return;
  const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
  const browser = await chromium.launch();
  const C = await freshOrg("org_fix55ui", "Reads right (test)");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([t, u, g]) => { try { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", g); } catch {} },
    [C.token, JSON.stringify(C.user), JSON.stringify(C.org)]);
  await ctx.route(url => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(String(url)), r => r.abort().catch(() => {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  const open = async () => {
    if (!/\/donors(\?|$)/.test(page.url())) await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: /Import & tools/ }).first().click({ timeout: 30000 });
    await page.getByRole("menuitem", { name: /Import a spreadsheet|Any spreadsheet/ }).first().click({ timeout: 10000 });
    await page.waitForSelector('[data-testid="sheet-import"]', { timeout: 15000 });
  };
  const goText = () => page.textContent('[data-testid="sheet-import-go"]');
  const settle = () => page.waitForSelector('[data-testid="sheet-import-go"]:not([disabled])', { timeout: 60000 });
  try {
    // §3 the window always closes, and closing writes nothing
    const w0 = await writes(C.id);
    await open();
    await page.click('button[aria-label="Close"]');
    ok("§3 the X closes the empty import window", await page.locator('[data-testid="sheet-import"]').count() === 0);
    await open();
    await page.setInputFiles('[data-testid="sheet-file"]', WORKBOOK);
    await settle();
    await page.click('button[aria-label="Close"]');
    ok("§3 the X closes the preview", await page.locator('[data-testid="sheet-import"]').count() === 0);
    await open();
    await page.setInputFiles('[data-testid="sheet-file"]', WORKBOOK);
    await settle();
    await page.keyboard.press("Escape");
    ok("§3 Escape closes the preview", await page.locator('[data-testid="sheet-import"]').count() === 0);
    await open();
    await page.setInputFiles('[data-testid="sheet-file"]', WORKBOOK);
    await settle();
    await page.mouse.click(8, 500);
    ok("§3 a click outside closes the preview", await page.locator('[data-testid="sheet-import"]').count() === 0);
    const w1 = await writes(C.id);
    ok("§3 closing wrote nothing", JSON.stringify(w0) === JSON.stringify(w1), JSON.stringify([w0, w1]));

    // §4 a dropped file is the same file
    await open();
    await page.setInputFiles('[data-testid="sheet-file"]', WORKBOOK);
    await settle();
    const chosen = await goText();
    await page.keyboard.press("Escape");
    const bytes = fs.readFileSync(WORKBOOK).toString("base64");
    const drop = async sel => {
      const dt = await page.evaluateHandle(b64 => {
        const bin = atob(b64), arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const d = new DataTransfer();
        d.items.add(new File([arr], "event-workbook-shape.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        return d;
      }, bytes);
      for (const type of ["dragenter", "dragover", "drop"]) await page.dispatchEvent(sel, type, { dataTransfer: dt });
    };
    await open();
    await drop('[data-testid="sheet-drop"]');
    await settle();
    ok("§4 a file dropped on the start screen gives the same preview as choosing it", (await goText()) === chosen, [await goText(), chosen]);
    await page.keyboard.press("Escape");
    await drop('[data-testid="sheet-drop-page"]');
    await settle();
    ok("§4 a file dropped on the Donors page opens the same reader with that file", (await goText()) === chosen, [await goText(), chosen]);
    await page.keyboard.press("Escape");

    // §2 the date box: the summary and the button change before Import, and Import dates the gifts
    await open();
    await page.setInputFiles('[data-testid="sheet-file"]', WORKBOOK);
    await settle();
    const money0 = await page.textContent('[data-testid="layer-money"]');
    ok("§2 before the answer: 63 gifts with no date, on the Money line and the button", /63 with no date/.test(money0) && /63 undated/.test(await goText()), [money0, await goText()]);
    await page.fill('[data-testid="sheet-event-date"]', "2026-10-22");
    await settle();
    await page.check('[data-testid="sheet-use-event-date"]');
    // the stale preview may never be imported: the button waits for the re-read
    const during = await page.$eval('[data-testid="sheet-import-go"]', b => ({ disabled: b.disabled, text: b.textContent })).catch(() => null);
    const t0 = Date.now();
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid="sheet-import-go"]'); return b && !b.disabled && !/undated/.test(b.textContent); }, null, { timeout: 15000 }).catch(() => {});
    const reread = Date.now() - t0;
    const money1 = await page.textContent('[data-testid="layer-money"]');
    ok("§2 while the re-read is out, Import waits and says so", !during || during.disabled === true || !/undated/.test(during.text), JSON.stringify(during));
    ok("§2 after ticking: no gift without a date on the Money line or the button", !/no date/.test(money1) && !/undated/.test(await goText()), [money1, await goText()]);
    ok("§2 the re-read after the answer is under 2 seconds", reread < 2000, reread + "ms");
    await page.click('[data-testid="sheet-import-go"]');
    if (await page.locator('[data-testid="sheet-aside"][open]').count()) await page.click('[data-testid="sheet-import-go"]');
    await page.waitForSelector('[data-testid="sheet-result"]', { timeout: 120000 });
    const g = (await q(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE date = '2026-10-22')::int AS dated, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1 AND amount > 0`, [C.id]))[0];
    ok(`§2 all ${WKEY.gifts} gifts landed dated Oct 22, 2026`, g.n === WKEY.gifts && g.dated === WKEY.gifts && Math.round(Number(g.s) * 100) === WKEY.giftCents, JSON.stringify(g));
    const imp = (await q(`SELECT id FROM imports WHERE org_id=$1 ORDER BY started_at DESC LIMIT 1`, [C.id]))[0];
    const rc = imp ? (await api("GET", `/imports/${imp.id}`, C.token)).body.import || {} : {};
    ok("§2 the receipt's truth check agrees", rc.reconciled === true, JSON.stringify([rc.reconciled, rc.findings]).slice(0, 300));
    // the surfaces (Home, the profile, Reports) read the same total (tests/lib/surfacesAgree.js)
    try { const { assertSurfacesAgree } = require("./lib/surfacesAgree"); await assertSurfacesAgree(C.id, { step: "event workbook, dated by the event" }); } catch (e) { if (!/Cannot find module/.test(e.message)) throw e; }
    const tyDb = (await q(`SELECT COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1 AND amount > 0 AND date >= '2026-01-01' AND date <= '2026-12-31'`, [C.id]))[0];
    ok("§2 the gifts count in This year", Math.round(Number(tyDb.s) * 100) === WKEY.giftCents, JSON.stringify(tyDb));
    ok("§2–§4 no page error in the browser", errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  await apiLegs();
  await browserLegs();
  fs.rmSync(TMP, { recursive: true, force: true });
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });
