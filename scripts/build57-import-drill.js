// BUILD-57 §2b — the hostile import drill: a deliberately messy donor file,
// imported UNATTENDED through the REAL import surface (the browser UI a pilot
// org will actually use), findings reported rather than fixed inline.
//
// The fixture mimics how nonprofit data actually arrives: same-day same-amount
// gift twins, nickname/legal-name duplicate donors, missing + malformed
// emails, joint and household names in one field, mixed date formats,
// Excel-serial dates, currency symbols + thousands separators, negative
// amounts and refunds, trailing whitespace, a formula-injection name,
// deceased / do-not-solicit flags, orphan gifts, duplicate transaction IDs —
// plus ~1,200 generated rows so the chunked path (500/batch) really runs.
// A windows-1252 (non-UTF8) CSV variant probes encoding handling separately.
//
// Prereqs: scratch stack + localhost client build + preview :4173 (the
// build57-capture recipe). Run:
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build57-import-drill.js
//
// Output: docs/build57/import/ — the fixture files, step screenshots, and
// import-findings.json (what the surface did with each class of mess).
const path = require("path");
const fs = require("fs");
const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa");
const { chromium } = require(path.join(PLAYWRIGHT_DIR, "node_modules", "playwright"));
const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));

const guard = require("./lib/prodGuard");
const API = guard.writerBase("http://localhost:5601");
const APP = process.env.APP || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "build57", "import");
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (cls, observed) => { findings.push({ class: cls, observed }); console.log(`  FINDING [${cls}] ${observed}`); };
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 300) : "")); } };

const EMAIL = "b57import@test.local", PASS = "loadtest1234";
const j = async (method, p, token, body) => {
  const r = await fetch(API + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// ── The fixture ────────────────────────────────────────────────────────────
function buildFixture() {
  const donorRows = [
    ["Name", "Email", "Phone", "Total Giving", "Last Gift Date", "Gifts", "City", "State", "Deceased", "Do Not Contact", "Notes"],
    ["  Sarah  Jones  ", "sarah.jones@example.org ", "205-555-0101", " $12,500.00 ", "3/14/2019", "5", "Mobile", "AL", "", "", "trailing whitespace everywhere"],
    ["MARGARET O'BRIEN", "mobrien@example.org", "", "1,250", "2019-03-14", "3", "Fairhope", "AL", "", "", ""],
    ["van der Berg, Hans", "hans@example.org", "", "500", "14 Mar 2019", "2", "", "", "", "", "last-first with particles"],
    ["Miller, Bob", "bob@example.org", "", "300", "03/14/19", "1", "", "", "", "", "nickname twin of Robert Miller"],
    ["Robert Miller", "robert.miller@example.org", "", "300", "2019/03/14", "1", "", "", "", "", "legal-name twin of Bob Miller"],
    ["Robert & Lisa Atkinson", "roblisa@example.org", "", "2,000", "Jan-15", "4", "", "", "", "", "joint names one field"],
    ["Mr. and Mrs. James Whitfield", "whitfields@example.org", "", "750", 43903, "2", "", "", "", "", "honorific couple + Excel serial date"],
    ["The Whitfield Family Trust", "trust@whitfield.example", "", "10,000", "March 3rd, 2021", "1", "", "", "", "", "household/trust in name field"],
    ["José Muñoz", "jose@example.org", "", "425", "2021-06-01", "2", "", "", "", "", "utf8 accents (see latin-1 CSV twin)"],
    ["Smith, Jr., Tom", "tsmith@example.org", "", "150", "2020-01-05", "1", "", "", "", "", "comma suffix"],
    ["ACME Holdings, Inc.", "giving@acme.example", "", "5,000", "2022-11-30", "2", "", "", "", "", "corporate comma — must NOT flip"],
    ["Meredith Halfemail", "meredith@", "", "80", "2023-02-02", "1", "", "", "", "", "malformed email"],
    ["Norm NoDomain", "info@none", "", "60", "2023-02-03", "1", "", "", "", "", "malformed email"],
    ["Nadia NotApplicable", "N/A", "", "90", "2023-02-04", "1", "", "", "", "", "email is N/A"],
    ["Dupe Emailrow One", "same@example.org", "", "100", "2023-01-01", "1", "", "", "", "", "same email as next row"],
    ["Dupe Emailrow Two", "same@example.org", "", "999", "2023-01-02", "2", "", "", "", "", "same email as prior row"],
    ["Delia Deceased", "delia@example.org", "", "5,500", "2018-04-04", "6", "", "", "Y", "", "deceased flag"],
    ["Don Notsolicit", "don@example.org", "", "425", "2024-08-08", "2", "", "TRUE", "", "TRUE", "do-not-solicit flag"],
    ["Nina Negative", "nina@example.org", "", "(500)", "2024-02-02", "1", "", "", "", "", "accounting-negative total"],
    ["Tara TotalNA", "tara@example.org", "", "N/A", "not sure", "", "", "", "", "", "junk total + junk date"],
    ["Wendy Wideworld", "wendy@example.org", "", "€500", "31/12/2023", "1", "", "", "", "", "euro symbol + D/M/Y date"],
    ["=SUM(A1:A9)", "formula@example.org", "", "100", "2024-01-01", "1", "", "", "", "", "formula-injection name"],
    ["X".repeat(300), "long@example.org", "", "10", "2024-01-01", "1", "", "", "", "", "300-char name"],
    ["Onlyname Person", "", "", "", "", "", "", "", "", "", "no email, no history"],
    ["", "", "", "", "", "", "", "", "", "", ""],
  ];
  for (let i = 0; i < 1200; i++) {
    donorRows.push([`Generated Donor ${i}`, `gen${i}@bulk.example.org`, "", String(100 + i), "2024-05-01", "2", "", "", "", "", ""]);
  }

  const giftRows = [
    ["Donor Email", "Donor Name", "Gift Date", "Amount", "Fund", "Transaction ID", "Notes"],
    // Same-day same-amount TWINS (all three are real gifts — F-4 rule).
    ["sarah.jones@example.org", "Sarah Jones", "2025-03-02", "$100.00", "General", "", "Sunday plate twin 1"],
    ["sarah.jones@example.org", "Sarah Jones", "2025-03-02", "$100.00", "General", "", "Sunday plate twin 2"],
    ["sarah.jones@example.org", "Sarah Jones", "2025-03-02", "$100.00", "General", "", "Sunday plate twin 3"],
    // Refunds / negatives.
    ["mobrien@example.org", "Margaret O'Brien", "2025-04-01", "-250", "", "TXN-9001", "refund row"],
    ["mobrien@example.org", "Margaret O'Brien", "2025-04-02", "(1,000)", "", "TXN-9002", "accounting negative"],
    ["hans@example.org", "Hans van der Berg", "2025-04-03", "$-50", "", "", "negative with symbol"],
    // Currency mess.
    ["roblisa@example.org", "Robert & Lisa Atkinson", "2025-05-01", " $1,250.00 ", "Building", "TXN-9003", ""],
    ["roblisa@example.org", "Robert & Lisa Atkinson", "2025-05-02", "1 250", "", "", "space thousands separator"],
    ["jose@example.org", "José Muñoz", "2025-05-03", "€500", "", "", "euro"],
    ["tsmith@example.org", "Tom Smith Jr", "2025-05-04", "500.5", "", "", "half dollar"],
    // Date mess.
    ["giving@acme.example", "ACME Holdings, Inc.", 44234, "2000", "", "TXN-9004", "Excel serial date"],
    ["giving@acme.example", "ACME Holdings, Inc.", "Jan-15", "300", "", "", "month-year string"],
    ["delia@example.org", "Delia Deceased", "2027-01-01", "75", "", "", "future-dated gift"],
    ["don@example.org", "Don Notsolicit", "1899-12-31", "25", "", "", "epoch-adjacent date"],
    // Orphans + identity mess.
    ["stranger@nowhere.example", "Sam Stranger", "2025-06-01", "80", "", "", "donor not in donor sheet"],
    ["", "Nameless Nobody", "2025-06-02", "40", "", "", "name-only orphan gift"],
    ["", "", "2025-06-03", "65", "", "", "NO donor identity at all"],
    ["wendy@example.org", "Wendy Wideworld", "2025-06-04", "", "", "", "no amount"],
    // Duplicate transaction id (the ONE legitimate dedup key).
    ["long@example.org", "Longname", "2025-06-05", "150", "", "TXN-DUP-1", "first with this txn id"],
    ["long@example.org", "Longname", "2025-06-05", "150", "", "TXN-DUP-1", "same txn id — must dedupe"],
  ];
  for (let i = 0; i < 1200; i++) {
    giftRows.push([`gen${i}@bulk.example.org`, `Generated Donor ${i}`, "2024-05-01", String(60 + (i % 40)), "", `GEN-${i}-A`, ""]);
    giftRows.push([`gen${i}@bulk.example.org`, `Generated Donor ${i}`, "2023-11-15", String(40 + (i % 25)), "", `GEN-${i}-B`, ""]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(donorRows), "Donors");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(giftRows), "Gift History");
  const xlsxPath = path.join(OUT, "hostile-fixture.xlsx");
  XLSX.writeFile(wb, xlsxPath);

  // Non-UTF8 probe: the same handful of donors as a windows-1252 CSV
  // (José/Muñoz/Béatrice carry high-bit latin-1 bytes, NOT utf8).
  const latinCsv = [
    "Name,Email,Total Giving,Last Gift Date",
    "Jos\xe9 Latin-Mu\xf1oz,jose.latin@example.org,300,2024-01-01",
    "B\xe9atrice Ch\xe2teau,bea@example.org,450,2024-02-01",
  ].join("\r\n");
  const csvPath = path.join(OUT, "hostile-latin1.csv");
  fs.writeFileSync(csvPath, Buffer.from(latinCsv, "latin1"));
  return { xlsxPath, csvPath, donorRowCount: donorRows.length - 1, giftRowCount: giftRows.length - 1 };
}

(async () => {
  const fixture = buildFixture();
  console.log(`fixture: ${fixture.donorRowCount} donor rows, ${fixture.giftRowCount} gift rows`);

  // Fresh org, every run (register-or-login; a rerun reuses the org and the
  // email-dedup makes the re-import a second, idempotency-probing pass).
  let auth = (await j("POST", "/auth/login", null, { email: EMAIL, password: PASS })).body;
  const rerun = !!auth.token;
  if (!auth.token) {
    auth = (await j("POST", "/auth/register-org", null, { orgName: "B57 Import Drill Org", userName: "Import Admin", email: EMAIL, password: PASS })).body;
    await j("POST", "/onboarding/complete", auth.token, {});
  }
  const tok = auth.token;
  if (!tok) throw new Error("fixture login/register failed");
  if (auth.org) auth.org.onboarding_complete = 1; // register payload predates the complete call

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [auth.token, auth.user, auth.org]);
  const p = await ctx.newPage();
  p.on("dialog", d => d.accept());
  const shot = name => p.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });

  const donorCountNow = async () => {
    const r = (await j("GET", "/donors?limit=1&offset=0", tok)).body;
    return r.total ?? (Array.isArray(r) ? r.length : 0);
  };
  const waitForDonorCount = async (min, timeoutMs = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const n = await donorCountNow();
      if (n >= min) return n;
      await p.waitForTimeout(3000);
    }
    return donorCountNow();
  };

  // ── Door 1: the RECOMMENDED menu entry, exactly as a pilot org would ─────
  await p.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await p.locator("button:has-text('Donors')").first().click();
  await p.waitForTimeout(800);
  await p.locator("button:has-text('Import & tools')").first().click();
  await p.locator("text=Import + History").first().click();
  await p.waitForTimeout(500);
  await shot("01-recommended-modal");
  await p.locator("input[type=file]").first().setInputFiles(fixture.xlsxPath);
  await p.waitForTimeout(2500);
  await shot("02-recommended-after-upload");
  const bothInRecommended = await p.locator("button:has-text('Import both')").count();
  if (!bothInRecommended) {
    note("recommended-path-no-import-both",
      "The RECOMMENDED menu entry (Import + History) opens CombinedImport, whose multi-sheet picker forces ONE sheet — the 'Import both — donors + their gift history' CTA exists only in DonorImport (menu: 'Import donors only'). A pilot org following the recommended path with the most common two-sheet workbook never sees the linked import.");
  }
  await p.locator("button:has-text('Close')").first().click().catch(() => {});
  await p.waitForTimeout(400);

  // ── Door 2: the DonorImport surface that carries "Import both" ───────────
  await p.locator("button:has-text('Import & tools')").first().click();
  await p.locator("text=Import donors only").first().click();
  await p.waitForTimeout(500);
  await p.locator("input[type=file]").first().setInputFiles(fixture.xlsxPath);
  await p.waitForTimeout(2500);
  await shot("03-donorimport-after-upload");
  const bothBtn = p.locator("button:has-text('Import both')");
  ok("workbook recognized as donors + gift history (Import both offered)", await bothBtn.count() > 0);
  if (await bothBtn.count()) {
    await bothBtn.first().click();
    await p.waitForTimeout(1500);
  }
  await shot("04-import-both-review");
  const importBtn = p.locator("button", { hasText: /Import [\d,]+ donor/ }).first();
  ok("the import CTA rendered with real counts", await importBtn.count() > 0);
  const t0 = Date.now();
  await importBtn.click({ timeout: 10000 }).catch(() => {});
  // Chunked submit with a progress bar; completion closes the modal — poll
  // the API for arrival rather than trusting a DOM string.
  await waitForDonorCount(1200);
  const elapsed = Math.round((Date.now() - t0) / 1000);
  await shot("05-import-result");
  console.log(`  import (unattended, real surface) took ~${elapsed}s`);
  await p.locator("button:has-text('Done')").first().click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(500);

  // ── What actually landed (read back through the API) ─────────────────────
  const list = (await j("GET", "/donors?limit=1&offset=0", tok)).body;
  const donorTotal = list.total ?? (Array.isArray(list) ? list.length : 0);
  ok("bulk of the file landed (>1,200 donors in the org)", donorTotal >= 1200, donorTotal);
  console.log(`  donors in org after import: ${donorTotal}`);

  const probe = async (search) => {
    const r = (await j("GET", `/donors?search=${encodeURIComponent(search)}&limit=10`, tok)).body;
    return r.donors || [];
  };

  // Findings sweep — observed behavior per hostile class, reported not fixed.
  const sarah = await probe("Sarah Jones");
  if (sarah.length) {
    const g = (await j("GET", `/donors/${sarah[0].id}`, tok)).body.gifts || [];
    const twins = g.filter(x => Number(x.amount) === 100);
    note("same-day-twins", `Sarah Jones has ${twins.length} of 3 same-day $100 gifts (F-4 says all 3 insert + duplicateCandidates reports them)`);
  } else note("whitespace-name", "『  Sarah  Jones  』 did not land as a searchable donor");

  const bob = await probe("Miller");
  note("nickname-legal-dupes", `"Miller" search returns ${bob.length} donors (${bob.map(d => d.name).join(" / ")}) — nickname/legal twins land as separate records; merge tool is the offered path`);

  const negTotal = await probe("Nina Negative");
  if (negTotal.length) note("negative-total", `Nina Negative total_giving stored as ${negTotal[0].total_giving ?? negTotal[0].total}`);

  const meredith = await probe("Meredith");
  if (meredith.length) {
    const full = (await j("GET", `/donors/${meredith[0].id}`, tok)).body;
    note("malformed-email", `"meredith@" stored verbatim as email="${full.email}" — no validation at import`);
  }

  const formula = await probe("SUM(A1");
  note("formula-name", formula.length ? `formula-injection name stored verbatim: "${formula[0].name}" (CSV export guard must keep escaping it)` : "formula-injection name did not land");

  const deceased = await probe("Delia");
  if (deceased.length) {
    const full = (await j("GET", `/donors/${deceased[0].id}`, tok)).body;
    note("deceased-flag", `Deceased=Y column: donor landed as a normal active donor (status=${full.status}, tags=${JSON.stringify(full.tags)}) — the flag is silently discarded`);
  }
  const dns = await probe("Don Notsolicit");
  if (dns.length) {
    const full = (await j("GET", `/donors/${dns[0].id}`, tok)).body;
    note("do-not-solicit-flag", `Do Not Contact=TRUE column: donor landed with no suppression (status=${full.status}) — a pilot org could email a do-not-solicit donor`);
  }

  const acme = await probe("ACME");
  if (acme.length) {
    const g = (await j("GET", `/donors/${acme[0].id}`, tok)).body.gifts || [];
    note("excel-serial-date", `ACME's Excel-serial-dated gift stored date(s): ${g.map(x => x.date).join(", ")}`);
  }
  const stranger = await probe("Stranger");
  note("orphan-gift", stranger.length ? `orphan gift's donor minted from the gift row: ${stranger[0].name}` : "orphan gift donor NOT created — the gift row was dropped");

  const mobrien = await probe("O'Brien");
  if (mobrien.length) {
    const g = (await j("GET", `/donors/${mobrien[0].id}`, tok)).body.gifts || [];
    note("refund-rows", `Margaret's refund rows (-250, "(1,000)") landed as gifts: ${g.map(x => x.amount).join(", ") || "none"} — negative gift handling`);
  }
  const longdup = await probe("Longname");
  if (!longdup.length) {
    const xname = await probe("XXXXXXXXXX");
    note("txn-id-dedupe", xname.length ? `TXN-DUP-1 gifts on the 300-char-name donor: ${((await j("GET", `/donors/${xname[0].id}`, tok)).body.gifts || []).filter(g => g.external_id === "TXN-DUP-1").length} (dup txn id must collapse to 1)` : "could not locate the txn-dup donor");
  }

  // ── Second pass: the SAME file again (a pilot org double-clicks) ─────────
  if (!rerun) {
    console.log("  re-importing the identical file (idempotency under mess)…");
    const before = await donorCountNow();
    await p.locator("button:has-text('Donors')").first().click().catch(() => {});
    await p.waitForTimeout(600);
    await p.locator("button:has-text('Import & tools')").first().click().catch(() => {});
    await p.locator("text=Import donors only").first().click().catch(() => {});
    await p.waitForTimeout(400);
    await p.locator("input[type=file]").first().setInputFiles(fixture.xlsxPath).catch(() => {});
    await p.waitForTimeout(2500);
    const bb = p.locator("button:has-text('Import both')");
    if (await bb.count()) { await bb.first().click(); await p.waitForTimeout(1200); }
    const ib = p.locator("button", { hasText: /Import [\d,]+ donor/ }).first();
    if (await ib.count()) {
      await ib.click().catch(() => {});
      await p.waitForTimeout(30000);
    }
    await shot("06-reimport-result");
    const after = await donorCountNow();
    note("reimport-idempotency", `re-importing the identical file: donor count ${before} → ${after} (email-keyed rows dedupe; email-less rows ${after > before ? "DUPLICATE on re-run" : "did not duplicate"})`);
  }

  // ── Non-UTF8 probe: the windows-1252 CSV through "Import donors only" ────
  await p.locator("button:has-text('Donors')").first().click().catch(() => {});
  await p.waitForTimeout(600);
  await p.locator("button:has-text('Import & tools')").first().click().catch(() => {});
  await p.locator("text=Import donors only").first().click().catch(() => {});
  await p.waitForTimeout(400);
  await p.locator("input[type=file]").first().setInputFiles(fixture.csvPath).catch(() => {});
  await p.waitForTimeout(1500);
  await shot("07-latin1-preview");
  const anyImport = p.locator("button", { hasText: /Import [\d,]+ donor/ }).first();
  if (await anyImport.count()) {
    await anyImport.click().catch(() => {});
    await p.waitForTimeout(8000);
  }
  const joseLatin = await probe("Latin-Mu");
  note("non-utf8-bytes", joseLatin.length
    ? `windows-1252 CSV: "José Latin-Muñoz" stored as "${joseLatin[0].name}" (mojibake if not exactly José Latin-Muñoz)`
    : "windows-1252 CSV rows did not import at all");

  fs.writeFileSync(path.join(OUT, "import-findings.json"), JSON.stringify({ ranAt: new Date().toISOString(), donorTotal, findings }, null, 2));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed · ${findings.length} findings → ${OUT}/import-findings.json`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
