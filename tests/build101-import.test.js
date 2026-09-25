// BUILD-101 Part 6 — MEMBERSHIPS FROM A FILE.
//
//   §1  each preset fixture (plain · NPSP Opportunity · Bloomerang · LGL) is
//       recognised as itself and its level and dates are read, by line;
//       a file with no membership date is claimed by none;
//   §2  THE BRIEF'S TEST: a membership file imports 50 memberships on 4 levels,
//       HOLDS the two rows with an unknown level BY LINE NUMBER, posts
//       NOTHING (no gift, no ledger row), and a sweep afterwards opens renewal
//       threads ONLY for the ones inside the window;
//   §3  status comes from the dates, by hand;
//   §4  running the same file again adds nothing;
//   §5  the browser: the real importer maps the file, carries the
//       memberships on the last chunk and says what it held.
//
// The file has 52 rows: fifty the org's levels can take, two naming a level it
// does not have ("Gold Circle", lines 17 and 40). It is GENERATED from today by
// one deterministic rule, because a membership's window is a fact about today;
// a static file would test the calendar, not the code (the BUILD-84 lesson).

const fs = require("fs"), path = require("path"), os = require("os");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html")); };

const O = "b101_imp";
const PW = "loadtest1234";
const FIX = path.join(__dirname, "fixtures", "build101-members");
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// Expiry offsets from today, cycled over the rows. Window is 30 days, grace 30.
const OFFSETS = [-400, -45, -10, 5, 20, 29, 31, 90, 200, 364];
const LEVEL_WORDS = ["Individual", "family", "PATRON", "Benefactor"];
const UNKNOWN_LINES = [17, 40];

async function reset() {
  for (const t of ["memberships", "receipts", "fin_transactions", "interactions", "thank_you_drafts", "threads", "tasks", "workflow_runs",
                   "gifts", "membership_levels", "donors", "users", "budgets", "accounts", "fin_funds", "imports"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [O]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [O]).catch(() => {});
}

function makeFile(today, { emailDomain = "b101imp.example.org" } = {}) {
  const lines = ["Name,Email,Level,Joined,Expires"], rows = [];
  for (let i = 0; i < 52; i++) {
    const line = i + 2;
    const off = OFFSETS[i % OFFSETS.length];
    const expires = addDays(today, off), starts = addDays(expires, -364);
    const level = UNKNOWN_LINES.includes(line) ? "Gold Circle" : LEVEL_WORDS[i % 4];
    const name = `Member ${String(i + 1).padStart(2, "0")} Lastname`, email = `m${i + 1}@${emailDomain}`;
    lines.push([name, email, level, starts, expires].join(","));
    rows.push({ line, name, email, level, starts, expires, off, unknown: UNKNOWN_LINES.includes(line) });
  }
  return { csv: lines.join("\n") + "\n", rows };
}

(async () => {
  console.log("build101-import");
  const MI = await import("../shared/membershipImport.js");
  const S = await import("../shared/importShape.js");

  // ── §1 · the presets ──────────────────────────────────────────────────────
  for (const [file, key] of [["plain", "plain"], ["npsp", "npsp"], ["bloomerang", "bloomerang"], ["lgl", "lgl"]]) {
    const a = S.analyzeCsvText(fs.readFileSync(path.join(FIX, file + ".csv"), "utf8"));
    ok(`§1 ${file}: recognised as ${MI.MEMBERSHIP_PRESETS[key].label}`, MI.detectMembershipPreset(a.headers) === key, MI.detectMembershipPreset(a.headers));
    const cols = MI.membershipColumns(a.headers);
    const nameCol = a.headers.find(h => /^name$/i.test(h)) || null;
    const emailCol = a.headers.find(h => /email/i.test(h)) || null;
    const built = MI.buildMembershipRows({ rows: a.rows }, cols, { nameCol, emailCol });
    const m = built.memberships[0] || {};
    ok(`§1 ${file}: line 2 reads Family, 2025-03-15 to 2026-03-14`,
       built.memberships.length === 1 && m.line === 2 && m.level === "Family" && m.starts === "2025-03-15" && m.expires === "2026-03-14", built);
    ok(`§1 ${file}: says whether it has met a real file`, key === "plain" || MI.MEMBERSHIP_PRESETS[key].confidence === "documented-not-walked");
  }
  ok("§1 LGL's 'Date Joined' is kept as member-since", MI.buildMembershipRows({ rows: S.analyzeCsvText(fs.readFileSync(path.join(FIX, "lgl.csv"), "utf8")).rows },
     MI.membershipColumns(S.analyzeCsvText(fs.readFileSync(path.join(FIX, "lgl.csv"), "utf8")).headers), { nameCol: "Name" }).memberships[0].joined === "2019-03-15");
  ok("§1 a file with a Level and no membership date is claimed by nobody", MI.detectMembershipPreset(["Name", "Level", "Notes"]) === null);
  ok("§1 an unreadable date is set aside by line, never guessed",
     MI.buildMembershipRows({ rows: [{ Name: "X", Level: "Family", Joined: "sometime", Expires: "" }] }, { membershipLevel: "Level", membershipJoined: "Joined", membershipExpires: "Expires" }, { nameCol: "Name" }).setAside[0].line === 2);

  // ── the org ───────────────────────────────────────────────────────────────
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
           VALUES ($1,'Riverbend Museum','b101-imp',1,'team','active','America/New_York',NOW())`, [O]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101imp',$1,'b101-imp@example.org',$2,'Ivy Admin','admin')`, [O, bcrypt.hashSync(PW, 4)]);
  const tok = await login("b101-imp@example.org");
  await api("POST", "/onboarding/complete", tok, {});
  const today = (await api("GET", "/dashboard/home", tok)).body.today;
  for (const [name, price, fmv] of [["Individual", 50, 0], ["Family", 100, 25], ["Patron", 250, 40], ["Benefactor", 1000, 100]])
    await api("POST", "/membership-levels", tok, { name, price, fmv, term: "12_months" });

  // ── §2 · the file through the import route ────────────────────────────────
  const { csv, rows } = makeFile(today);
  const a = S.analyzeCsvText(csv);
  const cols = MI.membershipColumns(a.headers);
  const built = MI.buildMembershipRows({ rows: a.rows }, cols, { nameCol: "Name", emailCol: "Email" });
  ok("§2 the file reads as 52 membership rows", built.memberships.length === 52 && built.setAside.length === 0, built.setAside);
  const ledgerBefore = (await q(`SELECT COUNT(*)::int n FROM fin_transactions WHERE org_id=$1`, [O]))[0].n;
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: rows.map(r => ({ name: r.name, email: r.email })), gifts: [], memberships: built.memberships });
  const M = imp.body.memberships || {};
  ok("§2 fifty memberships are written", imp.status === 200 && M.written === 50, M);
  ok("§2 …on four levels", (await q(`SELECT COUNT(DISTINCT level_id)::int n FROM memberships WHERE org_id=$1`, [O]))[0].n === 4);
  ok("§2 the two unknown levels are HELD, by line number",
     (M.held || []).length === 2 && JSON.stringify((M.held || []).map(h => h.line).sort((x, y) => x - y)) === JSON.stringify(UNKNOWN_LINES)
     && (M.held || []).every(h => /Gold Circle/.test(h.why)), M.held);
  ok("§2 …and no level was created to make them fit", (await q(`SELECT COUNT(*)::int n FROM membership_levels WHERE org_id=$1`, [O]))[0].n === 4);
  ok("§2 NOTHING is posted: no gift, no ledger row",
     (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [O]))[0].n === 0
     && (await q(`SELECT COUNT(*)::int n FROM fin_transactions WHERE org_id=$1`, [O]))[0].n === ledgerBefore);

  // ── §3 · status from the dates, by hand ───────────────────────────────────
  const imported = rows.filter(r => !r.unknown);
  const hand = { active: 0, grace: 0, lapsed: 0 };
  for (const r of imported) hand[r.off >= 0 ? "active" : r.off >= -30 ? "grace" : "lapsed"]++;
  const got = {};
  for (const r of await q(`SELECT status, COUNT(*)::int n FROM memberships WHERE org_id=$1 GROUP BY 1`, [O])) got[r.status] = r.n;
  ok("§3 active / grace / lapsed match the dates", got.active === hand.active && got.grace === hand.grace && got.lapsed === hand.lapsed, { got, hand });

  // ── §2 · the sweep opens threads only inside the window ───────────────────
  const inWindow = imported.filter(r => r.off >= 0 && r.off <= 30).length;
  const sw = (await api("POST", "/memberships/run-sweep", tok, {})).body;
  ok(`§2 the sweep opens renewal threads for exactly the ${inWindow} inside the window`, sw.opened === inWindow, sw);
  const threaded = await q(`SELECT m.expires_on FROM memberships m WHERE m.org_id=$1 AND m.renewal_thread_id IS NOT NULL`, [O]);
  ok("§2 …and none for a date already past or beyond the window",
     threaded.every(t => t.expires_on >= today && t.expires_on <= addDays(today, 30)), threaded);

  // ── §4 · the same file again ──────────────────────────────────────────────
  const again = await api("POST", "/donors/import-combined", tok, { donors: rows.map(r => ({ name: r.name, email: r.email })), gifts: [], memberships: built.memberships });
  ok("§4 re-importing adds nothing", again.body.memberships?.written === 0 && again.body.memberships?.skippedDuplicate === 50
     && (await q(`SELECT COUNT(*)::int n FROM memberships WHERE org_id=$1`, [O]))[0].n === 50, again.body.memberships);

  // ── §5 · the real importer in a browser ───────────────────────────────────
  if (!haveBrowser()) console.log("  SKIP — no Playwright or client/dist (browser leg)");
  else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const f2 = makeFile(today, { emailDomain: "b101imp2.example.org" });
    const tmp = path.join(os.tmpdir(), `b101-members-${process.pid}.csv`);
    fs.writeFileSync(tmp, f2.csv);
    const lj = await api("POST", "/auth/login", null, { email: "b101-imp@example.org", password: PW });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    const errors = [];
    page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) errors.push(e.message.slice(0, 160)); });
    // An error boundary swallows a render crash; its console line is how it is seen.
    page.on("console", m => { if (m.type() === "error" && /Error|TypeError|ReferenceError/.test(m.text()) && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lj.body.token, JSON.stringify(lj.body.user), JSON.stringify(lj.body.org)]);
    await page.goto(APP + "/donors", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.click('button:has-text("Donors")').catch(() => {});
    await page.waitForTimeout(900);
    await page.click('button:has-text("Import & tools")');
    await page.waitForTimeout(400);
    await page.click('button:has-text("Import + History")');
    await page.waitForTimeout(700);
    await (await page.$('input[type="file"]')).setInputFiles(tmp);
    await page.waitForTimeout(3000);
    ok("§5 the mapper says the file carries memberships", await page.locator('[data-testid="membership-preset"]').count() === 1);
    await page.locator('button:has-text("Import 52 donor")').click();
    await page.waitForSelector('[data-testid="import-memberships"]', { timeout: 60000 }).catch(() => {});
    const summaryText = await page.locator('[data-testid="import-memberships"]').innerText().catch(() => "");
    ok("§5 the summary says fifty imported as history and two held", /50 memberships imported as history/.test(summaryText) && /2 held/.test(summaryText), summaryText);
    ok("§5 …naming the held lines", /Line 17/.test(summaryText) && /Line 40/.test(summaryText), summaryText);
    const [n2] = await q(`SELECT COUNT(*)::int n FROM memberships m JOIN donors d ON d.id=m.donor_id WHERE m.org_id=$1 AND d.email LIKE '%b101imp2.example.org'`, [O]);
    ok("§5 …and the fifty are in the database, on the people the file named", n2.n === 50, n2);
    ok("§5 the membership columns never became donor fields or custom fields",
       (await q(`SELECT COUNT(*)::int n FROM custom_field_defs WHERE org_id=$1`, [O]).catch(() => [{ n: 0 }]))[0].n === 0);
    // Found by this leg: the receipt read a column ledger that a membership
    // file does not have, and the error boundary swallowed it — the console
    // line is how it is seen, so it is listened for above.
    ok("§5 no page error, and no error boundary", errors.length === 0, errors);
    await browser.close();
    fs.unlinkSync(tmp);
  }

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
