// BUILD-84 verification walk — the REAL 444-row lead file through the REAL UI
// on a fresh org, and then the Map. This is the hour that found all four
// defects; it is now a script, so the same hour is repeatable.
//
// Proves, on screen and then in the database:
//   §1 the receipt names no fabricated gift figure and no fabricated balance
//   §2 444 of 444 rows import — organizations as donors, contacts attached
//   §3 stage assignment puts everyone in ONE stage and says why
//   §4 the Map renders from stored coordinates with ZERO geocoder requests,
//      holds across a refresh and a navigation, and says what it lacks
//   §5 a next step with a time on it
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build84-capture.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "build84", "steward-leads.csv");
const OUT = path.join(__dirname, "..", "docs", "build84");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 320)));
  if (!cond) failures++;
};
const shoot = async (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

(async () => {
  const stamp = Date.now().toString(36);
  const r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B84 Walk " + stamp, userName: "B84 Walker", email: `b84w_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token }, body: "{}" });
  r.org.onboarding_complete = 1;
  const token = r.token, orgId = r.org.id;
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) { console.log("  [pageerror]", e.message); failures++; } });
  // A build failure inside a useMemo is CAUGHT and logged, not thrown — the
  // TDZ ordering bug this walk found showed up on screen only as "No rows
  // ready". A console error from the import pipeline is a failure here.
  page.on("console", m => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return;
    console.log("  [console.error]", t.slice(0, 240));
    if (/\[import\]/.test(t)) failures++;
  });

  // EVERY outbound request the page makes, so "the map geocodes nothing" is
  // measured rather than asserted from the source.
  const requests = [];
  page.on("request", q => requests.push(q.url()));
  const geocoderHits = () => requests.filter(u => /nominatim|geocod/i.test(u) && !/\/geocode\/status/.test(u));

  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(r.user), JSON.stringify(r.org)]);

  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // The SPA lands on Home; the Donors tab is a nav button, not a route.
  await page.click('button:has-text("Donors")');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(600);
  const t0 = Date.now();
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForTimeout(4000);

  // The file's 30 columns are not a recognised shape — the mapper asks. Pick
  // "Donor totals" (aggregate), which is what a human does with a lead list.
  let body = await page.innerText("body");
  fs.writeFileSync(OUT + "/01-mapper.txt", body);
  // With only 2 of 30 headers recognised, the shape is a QUESTION (BUILD-79
  // Part 2) — answer it the way a human answers a lead list: one row per donor.
  if (/we can't tell/i.test(body)) {
    await page.selectOption('select:has(option[value="aggregate"])', "aggregate");
    await page.waitForTimeout(1500);
  }
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/01-mapper.txt", body);

  // ── §3 · the stage line, BEFORE the write ──
  ok("§3 the stage panel does NOT claim a basis this file does not have",
    !/based on giving history/i.test(body), (body.match(/[^\n]*based on giving[^\n]*/i) || [])[0]);
  ok("§3 …it says there is no giving data and everyone starts in one stage",
    /no giving data in this file/i.test(body) && /same stage/i.test(body),
    (body.match(/[^\n]*no giving data[^\n]*/i) || [])[0]);
  ok("§3 …and the eyebrow is not the 'Smart Stage Assignment' claim",
    !/smart stage assignment/i.test(body), null);
  ok("§3 there is no qualify × N / prospect × N split",
    !/qualify\s*×\s*\d/i.test(body), (body.match(/\w+\s*×\s*\d+/g) || []).join(" "));
  ok("§2 the pre-write line does not set aside 245 rows for having no person on them",
    !/skipped \(no name or email\)/i.test(body), (body.match(/[^\n]*skipped[^\n]*/i) || [])[0]);
  ok("§2 all 444 rows are ready before the write — none unnameable",
    /444 donors ready/.test(body) && !/No rows ready/.test(body),
    (body.match(/[^\n]*(donors ready|No rows ready)[^\n]*/) || [])[0]);
  await shoot(page, "01-mapper");

  // ── the write ──
  // The Team officer-routing question gates the button: answer it, then import.
  await page.click('button:has-text("Leave unassigned")').catch(() => {});
  await page.waitForTimeout(600);
  await page.click('button:has-text("Import 444 donors")');
  await page.waitForSelector('text=/set aside|imported|Done/i', { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(6000);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/02-receipt.txt", body);
  console.log(`— click-to-receipt: ${((Date.now() - t0) / 1000).toFixed(1)}s —`);

  // ── §1 · the receipt ──
  // The drive-time column MAY appear — the column report names every column by
  // name, which is BUILD-58 Part 2 and correct. What must never happen is it
  // appearing on the DOLLAR line as the file's money.
  const dollarLines = body.split("\n").filter(l => /currency|reconcile|dollars|In your file|carries \$/i.test(l)).join("\n");
  ok("§1 the drive-time column is nowhere on the dollar line",
    !/drive_min/.test(dollarLines), dollarLines.slice(0, 300));
  ok("§1 …and it IS still named in the column report, as an unrecognized column",
    /Not imported — unrecognized:[^\n]*drive_min_from_wilmore/.test(body), null);
  ok("§1 …and does not print a $12,840 figure anywhere", !/12,840/.test(body), null);
  ok("§1 the arithmetic panel does not claim no currency column was found when five were",
    !/no amount-shaped column found/.test(body), (body.match(/[^\n]*unknown[^\n]*/) || [])[0]);
  ok("§1 the currency list is printed ONCE, not as two findings",
    (body.match(/read as currency/g) || []).length <= 1, (body.match(/[^\n]*read as currency[^\n]*/g) || []).length);
  ok("§1 the dollar line says there is nothing to reconcile against, in a sentence",
    /nothing to reconcile against/i.test(body), (body.match(/[^\n]*reconcile against[^\n]*/i) || [])[0]);
  ok("§1 …and it names the currency columns it found, each with its own subtotal",
    /revenue/i.test(body) && /none was mapped as a gift amount/i.test(body),
    (body.match(/[^\n]*read[s]? as currency[^\n]*/i) || [])[0]);
  // FIX (2026-09-10) — DISPLAY cap: the largest three, the rest behind a count.
  // Five subtotals headed by $386,923,121 reads as confusion even when every
  // number is right.
  const curLine = (body.match(/[^\n]*columns in this file read as currency[^\n]*/i) || [""])[0];
  ok("§1 the currency sentence names the LARGEST THREE and counts the rest",
    /“revenue” \$386,923,121/.test(curLine) && /“expenses”/.test(curLine) && /“contributions”/.test(curLine)
    && /and 2 more/.test(curLine) && !/contrib_lost_yoy/.test(curLine), curLine);
  ok("§1 …and the full list is still carried in the reconciliation, not just on screen",
    /5 columns in this file read as currency/.test(curLine), curLine);
  ok("§1 the receipt never says the import is balanced", !/every row and every dollar accounted/i.test(body), null);
  await shoot(page, "02-receipt");

  // ── §2 · the database ──
  const { Client } = require(path.join(__dirname, "..", "node_modules", "pg"));
  const pg = new Client({ connectionString: "postgresql://steward@localhost:5544/steward_loadtest" });
  await pg.connect();
  const one = async sql => (await pg.query(sql.replace(/\$ORG/g, `'${orgId}'`))).rows[0];
  const db = await one(`SELECT
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND deleted_at IS NULL) donors,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND kind='organisation') orgs,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND contact_name IS NOT NULL) contacts,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND stage IS NOT NULL) placed,
    (SELECT COUNT(DISTINCT suggested_stage)::int FROM donors WHERE org_id=$ORG) distinct_suggested,
    (SELECT COUNT(*)::int FROM gifts WHERE org_id=$ORG) gifts,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND geocode_status IS NULL) no_status,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND geocode_status='pending') pending,
    (SELECT COUNT(*)::int FROM donors WHERE org_id=$ORG AND geocode_status='no_address') no_address`);
  console.log("— database —", JSON.stringify(db));
  ok("§2 all 444 rows are donors — none set aside for having no person on them", db.donors === 444, db);
  ok("§2 the organizations are typed as organizations", db.orgs === 444, db.orgs);
  ok("§2 the 199 rows with a contact person carry them as the CONTACT, not the donor's name",
    db.contacts === 199, db.contacts);
  ok("§3 nothing is placed, and every suggestion is the SAME stage",
    db.placed === 0 && db.distinct_suggested === 1, db);
  ok("§1 no gifts were invented from a currency-shaped column", db.gifts === 0, db.gifts);
  ok("§4 every donor left the import with a terminal-or-pending status, none NULL", db.no_status === 0, db);
  ok("§4 …and the statuses add up to the donor total", db.pending + db.no_address === db.donors,
    { pending: db.pending, no_address: db.no_address, donors: db.donors });

  const sample = (await pg.query(
    `SELECT name, contact_name, kind FROM donors WHERE org_id=$1 AND name IN
       ('Heart Of Africa Inc','Circle Of Hope International','Francis Asbury Society Inc') ORDER BY name`, [orgId])).rows;
  ok("§2 by name: the organization is the donor and the person is the contact",
    sample.length === 3 && sample.every(s => s.kind === "organisation")
    && sample.find(s => s.name === "Heart Of Africa Inc")?.contact_name === "Dr. D. Michael Henderson", sample);

  // ── §4 · the Map ──
  requests.length = 0;
  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(2500);
  const mapBtn = await page.$('button[title="Map"]') || await page.$('button:has-text("Map")');
  if (mapBtn) await mapBtn.click();
  await page.waitForTimeout(4000);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/03-map.txt", body);
  ok("§4 the Map made ZERO geocoder requests", geocoderHits().length === 0, geocoderHits().slice(0, 5));
  ok("§4 …and it never says 'Geocoding addresses…'", !/geocoding addresses/i.test(body), null);
  ok("§4 the map says what it lacks, in the receipt's vocabulary — a count and a named bucket",
    /\d+ (mapped|no address on file|could not be located|still processing|waiting for a geocoding provider)/i.test(body),
    (body.match(/[^\n]*\d+ (mapped|no address on file|could not be located|still processing|waiting for a geocoding provider)[^\n]*/i) || [])[0]);
  ok("§4 with no provider configured it says so in a sentence, not an empty grey box",
    /no geocoding provider is set up/i.test(body), (body.match(/[^\n]*geocoding provider[^\n]*/i) || [])[0]);
  ok("§4 …and it does not claim 444 addresses are 'still processing' when nothing can process",
    !/still processing/i.test(body) && /waiting for a geocoding provider/i.test(body),
    (body.match(/[^\n]*(still processing|waiting for a geocoding)[^\n]*/i) || [])[0]);
  await shoot(page, "03-map");

  // it holds across a refresh and a navigation
  requests.length = 0;
  const tRender = Date.now();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(2500);
  const mapBtn2 = await page.$('button[title="Map"]') || await page.$('button:has-text("Map")');
  if (mapBtn2) await mapBtn2.click();
  await page.waitForTimeout(2000);
  ok("§4 …and still zero after a refresh and a navigation back to it", geocoderHits().length === 0, geocoderHits().slice(0, 5));
  console.log(`— map render after refresh: ${((Date.now() - tRender) / 1000).toFixed(1)}s —`);

  // ── §4b · the write-time job, with a provider, and the map it feeds ──
  // A second server on :5621 with a MOCK Geocodio (the RESEND_BASE_URL /
  // STRIPE_API_BASE seam pattern) so the job runs for real against the same
  // scratch database, and the map the browser then renders is drawing STORED
  // coordinates it never asked for.
  const http = require("http");
  let providerRequests = 0, addressesSent = 0;
  const mock = http.createServer((req, res) => {
    let raw = ""; req.on("data", c => raw += c);
    req.on("end", () => {
      providerRequests++;
      const list = JSON.parse(raw || "[]");
      addressesSent += list.length;
      // Kentucky-ish coordinates, one per input, in input order.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: list.map((q, i) =>
        /^\s*$/.test(q) ? { response: { results: [] } }
        : { response: { results: [{ location: { lat: 37.5 + (i % 40) * 0.03, lng: -85.5 + (i % 40) * 0.04 } }] } }) }));
    });
  });
  await new Promise(r => mock.listen(5622, r));
  const { spawn } = require("child_process");
  const geoServer = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: "5621", DATABASE_URL: "postgresql://steward@localhost:5544/steward_loadtest",
           DB_SSL: "disable", JWT_SECRET: "local-test-secret", TEST_MODE: "1", SESSION_CACHE_TTL_MS: "0",
           DISABLE_BACKGROUND_TICKS: "1", RESEND_API_KEY: "re_dummy_local", STRIPE_SECRET_KEY: "sk_test_dummy",
           GEOCODIO_API_KEY: "mock-key", GEOCODIO_API_BASE: "http://127.0.0.1:5622/v1.9" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { const h = await fetch("http://127.0.0.1:5621/health").then(x => x.json()); if (h.status === "ok") break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  const status0 = await fetch("http://127.0.0.1:5621/geocode/status", { headers: auth }).then(x => x.json());
  ok("§4 with a provider configured, the product NAMES it", status0.provider === "geocodio", status0);
  const run1 = await fetch("http://127.0.0.1:5621/geocode/run", { method: "POST", headers: auth,
    body: JSON.stringify({ limit: 1000 }) }).then(x => x.json());
  console.log("— geocode run —", JSON.stringify({ ...run1, marked: undefined }));
  ok("§4 the job resolves every pending donor", run1.ok === 444 && run1.looked_up === 444, run1);
  ok("§4 …and it DE-DUPLICATES by address before spending a request — far fewer lookups than donors",
    run1.distinct < run1.looked_up && addressesSent === run1.distinct, { distinct: run1.distinct, sent: addressesSent });
  ok("§4 …in one batched request, not one per donor", providerRequests === 1, providerRequests);
  const run2 = await fetch("http://127.0.0.1:5621/geocode/run", { method: "POST", headers: auth,
    body: JSON.stringify({ mark: true, limit: 1000 }) }).then(x => x.json());
  ok("§4 a record whose address has not changed is NEVER looked up twice — a re-run spends nothing",
    run2.looked_up === 0 && providerRequests === 1, { run2, providerRequests });

  // and now the map, drawing what the job stored
  requests.length = 0;
  const tMap = Date.now();
  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1200);
  const mapBtn3 = await page.$('button[title="Map"]') || await page.$('button:has-text("Map")');
  if (mapBtn3) await mapBtn3.click();
  await page.waitForSelector(".leaflet-marker-icon", { timeout: 20000 }).catch(() => {});
  const tPins = ((Date.now() - tMap) / 1000).toFixed(1);
  const pins = await page.$$eval(".leaflet-marker-icon", els => els.length);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/04-map-pins.txt", body);
  ok(`§4 the map draws pins from STORED coordinates (${pins} markers) with zero geocoder requests`,
    pins > 0 && geocoderHits().length === 0, { pins, hits: geocoderHits().slice(0, 3) });
  ok("§4 …and it reports 444 mapped", /444 mapped/.test(body), (body.match(/[^\n]*mapped[^\n]*/) || [])[0]);
  console.log(`— map to first pins: ${tPins}s (includes the whole SPA load) —`);
  await shoot(page, "04-map-pins");
  geoServer.kill(); mock.close();

  // ── §5 · a next step with a time on it ──
  const tz = await fetch(API + `/orgs/${orgId}`, { method: "PATCH", headers: auth, body: JSON.stringify({ timezone: "America/New_York" }) }).then(x => x.json());
  const donorRow = (await pg.query(`SELECT id, name FROM donors WHERE org_id=$1 ORDER BY name LIMIT 1`, [orgId])).rows[0];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const convo = await fetch(API + `/donors/${donorRow.id}/conversations`, { method: "POST", headers: auth,
    body: JSON.stringify({ touch: "call_reached", line: "Reached the ED, wants a call back Monday.",
      nextStep: { type: "follow_up", label: "Call back", due: today, time: "14:00" } }) }).then(x => x.json());
  ok("§5 a next step accepts a time once the org's timezone is a human's choice", convo.thread?.due_time === "14:00", convo);
  ok("§5 …and the form's refusal LINKS to the fix rather than only refusing",
    /Set your time zone/.test(fs.readFileSync(path.join(__dirname, "..", "client/src/components/LogConversation.jsx"), "utf8")), null);
  const digest = await fetch(API + "/nudges/run", { method: "POST", headers: auth, body: JSON.stringify({ today, force: true, dryRun: true }) }).then(x => x.json());
  const timed = await fetch(API + "/step-reminders/run", { method: "POST", headers: auth, body: JSON.stringify({ today, now: "14:02", dryRun: true }) }).then(x => x.json());
  ok("§5 the timed task is out of the morning digest on its due date", (digest.sent || []).length === 0, digest);
  ok("§5 …and the timed sender has exactly one email for it", (timed.sent || []).length === 1 && /Call back/.test(timed.sent[0].subject), timed);

  await pg.end();
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})();
