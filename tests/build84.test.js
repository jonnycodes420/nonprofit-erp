// BUILD-84 — the four defects, the two censuses, and the timed step reminder.
//
// Fixture: tests/fixtures/build84/org-donors.csv + key.json, small and
// hand-checkable. The key asserts PER-NAME membership, not just counts — a
// count-only key cannot tell you WHICH donor went missing, which is the exact
// failure this build exists to close (245 organizations set aside as "no name
// or email" while the counts on screen all added up).
//
// Sections:
//   §1  P0-1  the independent value scanner picks the RIGHT column
//   §2  P0-2  an organization is a name; the contact rides beside it
//   §3  P0-3  stage assignment states the input it actually used
//   §4  census: a match respects the boundaries of the unit being matched
//   §5  P0-4  geocoding is a write-time job (the seam, the provider refusal)
//   §6  FEATURE: a task with a time — precedence, weekends, the window
//   §7  end to end against the server: 8 of 9 rows import, the ninth is set
//       aside by name, every donor leaves with a terminal geocode_status
const fs = require("fs");
const path = require("path");
const http = require("http");
const { BASE, ok, summary, login, api, q, closeDb, civilToday, SINK_PORT } = require("./helpers");

// The mail sink — the same pattern thread-nudge uses, so the REAL bytes of the
// reminder can be read and every link in them fetched.
let captured = [];
const sink = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* non-JSON */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mails = () => captured.filter(e => e.path === "/emails");

const FX = path.join(__dirname, "fixtures", "build84");
const KEY = JSON.parse(fs.readFileSync(path.join(FX, "key.json"), "utf8"));

const ORG = "org_b84";
const EMAIL = "b84admin@example.org";
const PASS = "loadtest1234";

async function reset() {
  await q(`DELETE FROM digest_sends WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM interactions WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM budgets WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM accounts WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,onboarding_complete,plan,timezone) VALUES ($1,$2,1,'team','America/New_York')`,
    [ORG, "BUILD-84 Org"]);
  const bcrypt = require("bcryptjs");
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    ["u_b84", ORG, EMAIL, bcrypt.hashSync(PASS, 10), "B84 Admin"]);
}

(async () => {
  const lib = await import("../shared/importShape.js");
  const threads = await import("../shared/threadShape.js");
  const tm = await import("../shared/textMatch.js");
  const geocode = require("../geocode.js");
  const text = fs.readFileSync(path.join(FX, "org-donors.csv"), "utf8");
  const a = lib.analyzeCsvText(text);

  // ── §1 · P0-1 — being numeric is not evidence of being money ─────────────
  console.log("\n— §1 · the value scanner picks the column the file says is money —");
  ok("the fixture parses to the row count the key states", a.rows.length === KEY.rowsInFile, a.rows.length);

  const scan = lib.scanAmountShapedColumns(a.headers, a.rows);
  ok("exactly the key's currency columns qualify, by name",
    JSON.stringify(scan.columns.map(c => c.header)) === JSON.stringify(KEY.currencyColumns.map(c => c.header)),
    scan.columns.map(c => c.header));
  for (const want of KEY.currencyColumns) {
    const got = scan.columns.find(c => c.header === want.header);
    ok(`“${want.header}” subtotals $${want.sum.toLocaleString()} — its OWN subtotal, never a cross-column sum`,
      got && got.sum === want.sum, got);
    ok(`…and it says WHY it qualified: ${want.why}`, got && got.why === want.why, got && got.why);
  }
  for (const [hdr, why] of Object.entries(KEY.scannerRefusals)) {
    const ev = lib.amountColumnEvidence(hdr, a.rows.map(r => r[hdr]));
    ok(`“${hdr}” is refused: ${why}`, ev.qualifies === false && ev.why === why, ev);
  }
  ok(`the naive rule would have called “${KEY.naiveScannerWouldHaveSaid.header}” the money at $${KEY.naiveScannerWouldHaveSaid.sum} — it no longer qualifies at all`,
    !scan.columns.some(c => c.header === KEY.naiveScannerWouldHaveSaid.header));
  ok("one column qualifies, so the scan is UNAMBIGUOUS and an equation may anchor on it",
    scan.unambiguous === true && scan.header === "contributions" && scan.sum === KEY.currencyColumns[0].sum, scan);

  // A file with several money columns names each one and refuses to collapse.
  const multi = lib.scanAmountShapedColumns(["Amount", "Receipt Amount", "Notes"],
    Array.from({ length: 10 }, (_, i) => ({ Amount: `$${100 + i}.00`, "Receipt Amount": `$${10 + i}.00`, Notes: "x" })));
  ok("two money columns → BOTH named with their own subtotals, and unambiguous is false",
    multi.columns.length === 2 && multi.unambiguous === false
    && multi.columns.every(c => typeof c.sum === "number"), multi);
  ok("…and `sum` is the strongest single column, never the two added together",
    multi.sum === multi.columns[0].sum && multi.total === multi.columns[0].sum + multi.columns[1].sum, multi);

  // No column qualifies → null, which the receipt renders as a sentence.
  const none = lib.scanAmountShapedColumns(["Name", "City", "Drive Min"],
    Array.from({ length: 10 }, (_, i) => ({ Name: "A", City: "B", "Drive Min": String(i + 1) })));
  ok("no qualifying column → null (a correct outcome, not a failure)", none === null, none);

  // Every header the spec names, in both directions.
  ok("`contrib_lost_yoy` PASSES the qualifier test and qualifies on its money word",
    lib.amountColumnEvidence("contrib_lost_yoy", ["144846", "42134", "9000", "12000", "8000", "7000"]).qualifies === true);
  for (const h of ["contrib_pct_of_revenue", "contrib_change_pct"])
    ok(`\`${h}\` FAILS the qualifier test`, lib.amountColumnEvidence(h, ["100.0", "83.8", "1", "2", "3", "4"]).qualifies === false);

  // ── §2 · P0-2 — an organization is a name ────────────────────────────────
  console.log("\n— §2 · an organization name is a name —");
  ok("the nameability reason vocabulary is ONE string", lib.NAMEABILITY_REASON === "no name, email, or organization");
  for (const d of KEY.donors) {
    const row = a.rows[d.line - 2];
    const id = lib.resolveDonorIdentity({ name: row.contact_name, organization: row.organization, email: row.email });
    ok(`line ${d.line}: nameable, display name “${d.name || "(blank → Unnamed donor)"}”`,
      id.nameable === true && id.displayName === d.name, { got: id.displayName, want: d.name });
    ok(`line ${d.line}: kind = ${d.kind}`, id.kind === d.kind, id.kind);
    ok(`line ${d.line}: contact = ${d.contactName === null ? "none" : d.contactName}`,
      (id.contactName || null) === d.contactName, id.contactName);
  }
  for (const s of KEY.setAside) {
    const row = a.rows[s.line - 2];
    const id = lib.resolveDonorIdentity({ name: row.contact_name, organization: row.organization, email: row.email });
    ok(`line ${s.line}: set aside — ${s.reason}`, id.nameable === false && id.reason === s.reason, id);
  }
  ok("a contact person is NEVER folded into the organization's name",
    lib.resolveDonorIdentity({ name: "Ann Lee", organization: "Bluegrass Community Bank" }).displayName === "Bluegrass Community Bank");

  // ── §3 · P0-3 — the stage basis is derived, never written by hand ────────
  console.log("\n— §3 · stage assignment states the input it used —");
  const withData = lib.stageAssignmentBasis({ total: "contributions", lastGift: "last_gift_date" });
  ok("giving data mapped → the sentence names BOTH inputs",
    withData.hasGivingData === true && withData.sentence === KEY.stageBasis.withContributionsAndDateMapped, withData.sentence);
  const noData = lib.stageAssignmentBasis({});
  ok("nothing mapped → it says so and assigns ONE stage",
    noData.hasGivingData === false && noData.sentence === KEY.stageBasis.withNothingMapped
    && noData.fallbackStage === KEY.stageBasis.fallbackStage, noData);
  ok("the sentence is built from the DECLARED field list, so a basis that cannot be read back cannot be claimed",
    lib.STAGE_BASIS_FIELDS.length === 2
    && lib.stageAssignmentBasis({ total: "x" }).sentence === "Based on lifetime giving.");

  // ── §4 · the census — a match respects boundaries ────────────────────────
  console.log("\n— §4 · a match respects the boundaries of the unit being matched —");
  const bp = KEY.tokenBoundaryPair;
  ok(`“${bp.b}” IS a letter-substring of “${bp.a}” (this is the trap)`,
    bp.a.toLowerCase().includes(bp.b.toLowerCase()) === bp.substringMatch);
  ok("…and the token-run test refuses it", tm.eitherContainsTokenRun(bp.a, bp.b) === bp.tokenRunMatch);
  ok("“Gala” does not match “Galaxy Fund”", tm.eitherContainsTokenRun("Galaxy Fund", "Gala") === false);
  ok("“Gala” DOES match “Spring Gala 2026”", tm.containsTokenRun("Spring Gala 2026", "Gala") === true);
  ok("underscores are separators: `fiscal_year` carries the token `year`",
    lib.headerTokens("fiscal_year").includes("year") && lib.headerHasQualifier("fiscal_year"));
  ok("…and `zipcode` and `ein` are qualifiers too",
    lib.headerHasQualifier("zipcode") && lib.headerHasQualifier("ein"));
  // The FIX-3 shape: 600 inside a minted id.
  ok("a numeric leak guard finds the figure as a NUMBER, not the digits inside an id",
    tm.numericLeafEquals({ id: "imp_6e5600ab", amount: 600 }, 600) !== null
    && tm.numericLeafEquals({ id: "imp_6e5600ab" }, 600) === null);
  ok("…and it names WHERE it found it, so a hit is checkable",
    tm.numericLeafEquals({ a: { b: [{ c: 600 }] } }, 600).path === "a.b[0].c");
  // No JSON.stringify-then-search survives anywhere in the repo.
  const ROOTS = ["server.js", "db.js", "geocode.js", "shared", "client/src", "tests", "scripts", "routes"];
  const offenders = [];
  const walkFiles = p => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (f !== "node_modules") walkFiles(path.join(p, f)); return; }
    if (!/\.(js|jsx|mjs)$/.test(p)) return;
    fs.readFileSync(p, "utf8").split("\n").forEach((ln, i) => {
      // the pattern itself, not a comment describing it
      if (/^\s*(\/\/|\*)/.test(ln)) return;
      if (/JSON\.stringify\s*\([^;]*\)\s*\.\s*(includes|indexOf|search|match)\s*\(/.test(ln)) offenders.push(`${p}:${i + 1}`);
    });
  };
  for (const r of ROOTS) walkFiles(path.join(__dirname, "..", r));
  ok(`no JSON.stringify-then-search survives the census (found ${offenders.length})`, offenders.length === 0, offenders.slice(0, 6));

  // ── §5 · P0-4 — geocoding is a write-time job ────────────────────────────
  console.log("\n— §5 · geocode once at write time, never at render —");
  ok("the PUBLIC Nominatim instance is refused by hostname, not by convention",
    geocode.providerConfig({ GEOCODE_NOMINATIM_BASE: "https://nominatim.openstreetmap.org" }).name === "unconfigured");
  ok("…and a self-hosted instance is accepted",
    geocode.providerConfig({ GEOCODE_NOMINATIM_BASE: "https://geo.internal.example.org" }).name === "nominatim");
  ok("no provider configured is an explicit state with a reason, not a silent no-op",
    geocode.providerConfig({}).name === "unconfigured" && /no geocoding provider/.test(geocode.providerConfig({}).reason));
  ok("an identifying User-Agent is carried (the provider's terms require one)",
    /Steward/.test(geocode.USER_AGENT) && /stewardapp\.dev/.test(geocode.USER_AGENT));
  ok("the address key is stable under whitespace and case — an unchanged address is never looked up twice",
    geocode.addressKey({ city: "Wilmore", state: "KY", zip: "40390" })
      === geocode.addressKey({ city: " wilmore ", state: "ky", zip: "40390" }));
  ok("a record with no address at all has NO key (it can only ever be no_address)",
    geocode.addressKey({ country: "US" }) === "" && geocode.addressKey({}) === "");
  ok("every status the map reports is a declared one",
    ["pending", "ok", "no_address", "not_found", "failed"].every(s => geocode.GEOCODE_STATUSES.includes(s)));

  // The driver, with the network injected — batching, ORDER, and the three
  // outcomes. "not_found" (the provider looked and found nothing) and "failed"
  // (the lookup itself failed, retryable) must never be confused: one is a
  // terminal fact about the address, the other is a fact about the request.
  let seen = null;
  const fakeGeocodio = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), ua: opts.headers["User-Agent"] };
    return { ok: true, json: async () => ({ results: [
      { response: { results: [{ location: { lat: 37.86, lng: -84.66 } }] } },
      { response: { results: [] } },
      { response: { results: [{ location: { lat: 38.04, lng: -84.50 } }] } },
    ] }) };
  };
  const batched = await geocode.geocodeAddresses(["Wilmore, KY", "Nowhere at all", "Lexington, KY"],
    { config: { name: "geocodio", key: "k", base: "https://api.example" }, fetchImpl: fakeGeocodio });
  ok("Geocodio is BATCHED — three addresses, ONE request", batched.requests === 1 && seen.body.length === 3, batched);
  ok("…the identifying User-Agent rides the request", /Steward/.test(seen.ua), seen.ua);
  ok("…and the response is read BY INDEX, never by matching the query string back",
    batched.results[0].status === "ok" && batched.results[0].lat === 37.86
    && batched.results[1].status === "not_found"
    && batched.results[2].status === "ok" && batched.results[2].lng === -84.50, batched.results);
  const broke = await geocode.geocodeAddresses(["Wilmore, KY"],
    { config: { name: "geocodio", key: "k", base: "https://api.example" },
      fetchImpl: async () => { throw new Error("network down"); } });
  ok("a LOOKUP failure is 'failed' (retryable), never 'not_found' (a fact about the address)",
    broke.results[0].status === "failed" && /network down/.test(broke.results[0].error), broke.results);
  // The map component makes no geocoder request.
  // The map's CODE (comments stripped) may not name a geocoder or reach the
  // network for one. The only fetch it is allowed is the status read, which
  // returns counts and a provider NAME and geocodes nothing.
  const mapSrc = fs.readFileSync(path.join(__dirname, "..", "client/src/components/DonorMap.jsx"), "utf8");
  const mapCode = mapSrc.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok("DonorMap.jsx names no geocoder in its code", !/nominatim|geocod\w*\.(org|io|com)|api\.geocod/i.test(mapCode), null);
  ok("…and its only network call is the status read, which geocodes nothing",
    (mapCode.match(/apiFetch\(/g) || []).length === 1 && /apiFetch\("\/geocode\/status"\)/.test(mapCode)
    && !/\bfetch\(/.test(mapCode.replace(/apiFetch\(/g, "")), null);

  // ── §6 · FEATURE — a task with a time on it ──────────────────────────────
  console.log("\n— §6 · a task with a time on it emails at that time —");
  ok("the due field held NO TIME before this build: due_time is a NEW nullable column beside due_date",
    /ADD COLUMN IF NOT EXISTS due_time/.test(fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8")));
  ok("a time is a 24-hour HH:MM, normalised", threads.sanitizeStepTime("2:00") === "02:00"
    && threads.sanitizeStepTime("14:00") === "14:00" && threads.sanitizeStepTime("25:00") === null
    && threads.sanitizeStepTime("") === null);
  const timed = { due_date: "2026-09-14", due_time: "14:00" };
  const dateOnly = { due_date: "2026-09-14", due_time: null };
  ok("PRECEDENCE — a TIMED task is out of the digest on its due date", threads.digestShouldSkip(timed, "2026-09-14") === true);
  ok("PRECEDENCE — …and REJOINS it the next morning as overdue", threads.digestShouldSkip(timed, "2026-09-15") === false);
  ok("PRECEDENCE — a date-only task is always the digest's", threads.digestShouldSkip(dateOnly, "2026-09-14") === false);
  ok("it fires at its time, inside the window", threads.stepReminderDue(timed, "2026-09-14", "14:03") === true);
  ok("…never before it", threads.stepReminderDue(timed, "2026-09-14", "13:59") === false);
  ok("…and never hours late (a 2:00 reminder at 5:00 has lost the only thing that made it worth sending)",
    threads.stepReminderDue(timed, "2026-09-14", "17:00") === false);
  ok("a date-only task sends nothing of its own", threads.stepReminderDue(dateOnly, "2026-09-14", "09:00") === false);
  ok("the weekend rule INVERTS for a timed step, and that is stated in the module",
    threads.TIMED_STEPS_IGNORE_WEEKEND_TOGGLE === true);
  const srvSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  ok("…and the timed sender has NO weekday gate (threadNudgeDayOk is the digest's alone)",
    (srvSrc.match(/threadNudgeDayOk/g) || []).length > 0
    && !/processStepReminders[\s\S]{0,1500}threadNudgeDayOk/.test(srvSrc));

  // ── §7 · end to end ──────────────────────────────────────────────────────
  console.log("\n— §7 · the whole file, through the real routes —");
  await reset();
  const tok = await login(EMAIL, PASS);

  // Build the payload the client builds: organization → donor, contact beside.
  const donors = [];
  const skipped = [];
  a.rows.forEach((row, i) => {
    const id = lib.resolveDonorIdentity({ name: row.contact_name, organization: row.organization, email: row.email });
    if (!id.nameable) { skipped.push({ line: i + 2, reason: id.reason }); return; }
    const money = lib.normalizeMoney(row.contributions);
    donors.push({
      name: id.hasName ? lib.normalizeName(id.displayName) : `Unnamed donor (line ${i + 2})`,
      contactName: id.contactName, kind: id.kind,
      email: row.email || "", phone: row.phone || "",
      address: row.address || null, city: row.city || null, state: row.state || null, zip: row.zipcode || null,
      total: money.value || 0, lastGift: row.last_gift_date || null,
      tags: id.hasName ? [] : ["needs-name"],
    });
  });
  ok(`${KEY.donorsExpected} of ${KEY.rowsInFile} rows are nameable, ${KEY.setAsideExpected} set aside`,
    donors.length === KEY.donorsExpected && skipped.length === KEY.setAsideExpected, { donors: donors.length, skipped: skipped.length });
  ok("the set-aside reason on the wire matches the receipt's vocabulary",
    skipped.every(s => s.reason === lib.NAMEABILITY_REASON), skipped);

  const imp = await api("POST", "/donors/import", tok, { donors });
  ok(`the import creates ${KEY.donorsExpected} donors`, imp.body.created === KEY.donorsExpected, imp.body);

  const rows = await q(`SELECT name, kind, contact_name, total_giving, stage, suggested_stage, geocode_status, geocode_key
                          FROM donors WHERE org_id=$1 ORDER BY name`, [ORG]);
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));
  for (const d of KEY.donors) {
    const want = d.name || `Unnamed donor (line ${d.line})`;
    const got = byName[want];
    ok(`“${want}” is in the database`, !!got, Object.keys(byName));
    if (!got) continue;
    ok(`…as a ${d.kind}`, got.kind === d.kind, got.kind);
    ok(`…with contact ${d.contactName === null ? "none" : d.contactName}`, (got.contact_name || null) === d.contactName, got.contact_name);
    ok(`…and its $${d.total.toLocaleString()} intact`, Math.abs(parseFloat(got.total_giving) - d.total) < 0.005, got.total_giving);
  }
  ok("the largest gift in the file belongs to the organization the OLD rule would have dropped",
    Math.max(...rows.map(r => parseFloat(r.total_giving))) === 250000
    && byName["Wilmore Rotary Club"] && parseFloat(byName["Wilmore Rotary Club"].total_giving) === 250000);

  // P0-3 on the write path: nothing inferred is a decision.
  ok("no imported donor has a PLACED stage — every inference is a suggestion (BUILD-83's contract, on this path too)",
    rows.every(r => r.stage === null), rows.filter(r => r.stage).map(r => [r.name, r.stage]));

  // P0-4 on the write path: a terminal status for everyone, and the counts add up.
  const geo = (await api("GET", "/geocode/status", tok)).body;
  const total = Object.values(geo.counts).reduce((s, n) => s + n, 0);
  ok("every donor carries a geocode status and the counts add up to the donor total",
    total === KEY.donorsExpected && geo.total === KEY.donorsExpected, geo);
  ok(`${KEY.geocode.noAddress} donor has no address on file, by name`,
    geo.counts.no_address === KEY.geocode.noAddress
    && KEY.geocode.noAddressLines.every(l => byName[`Unnamed donor (line ${l})`]?.geocode_status === "no_address"), geo.counts);
  ok(`${KEY.geocode.addressOnFile} donors are queued for lookup, each with the address key its coordinates will belong to`,
    geo.counts.pending === KEY.geocode.addressOnFile
    && rows.filter(r => r.geocode_status === "pending").every(r => !!r.geocode_key), geo.counts);
  ok("no donor is left without a status — 'pending' is the only non-terminal one, and nothing is NULL",
    rows.every(r => geocode.GEOCODE_STATUSES.includes(r.geocode_status)), rows.map(r => r.geocode_status));
  ok("with no provider configured the queue does NOTHING and says why — no address leaves the server",
    (await api("POST", "/geocode/run", tok, {})).body.provider === "unconfigured");

  // FEATURE, through the routes: the timezone gate, then the precedence.
  const donorId = rows.find(r => r.name === "Wilmore Rotary Club") &&
    (await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Wilmore Rotary Club'`, [ORG]))[0].id;
  const today = civilToday();
  const refused = await api("POST", `/donors/${donorId}/conversations`, tok, {
    touch: "call_reached", line: "Left a message with the club secretary.",
    nextStep: { type: "follow_up", label: "Call back", due: today, time: "14:00" },
  });
  ok("an org whose timezone is still Steward's DEFAULT cannot set a time, and the error says why",
    refused.status === 400 && refused.body.error === "timezone_unset" && /Settings/.test(refused.body.message), refused.body);

  await api("PATCH", `/orgs/${ORG}`, tok, { timezone: "America/New_York" });
  const set = await api("POST", `/donors/${donorId}/conversations`, tok, {
    touch: "call_reached", line: "Left a message with the club secretary.",
    nextStep: { type: "follow_up", label: "Call back", due: today, time: "14:00" },
  });
  ok("once a human has chosen the timezone, the time is accepted and stored",
    set.status === 201 && set.body.thread?.due_time === "14:00", set.body);

  const nudge = await api("POST", "/nudges/run", tok, { today, force: true, dryRun: true });
  ok("the timed task is NOT in the morning digest on its due date",
    (nudge.body.sent || []).every(s => s.count === undefined || s.count === 0) || !(nudge.body.sent || []).length, nudge.body);
  const rem = await api("POST", "/step-reminders/run", tok, { today, now: "14:01", dryRun: true });
  ok("…and the timed sender has exactly one email for it, naming the donor and the step",
    (rem.body.sent || []).length === 1 && /Wilmore Rotary Club/.test(rem.body.sent[0].subject)
    && /Call back/.test(rem.body.sent[0].subject), rem.body);
  const early = await api("POST", "/step-reminders/run", tok, { today, now: "09:00", dryRun: true });
  ok("…and nothing at nine in the morning", (early.body.sent || []).length === 0, early.body);

  // Tomorrow, still open: it rejoins the digest as overdue and sends nothing.
  const tomorrow = threads.addCivilDays(today, 1);
  const nudge2 = await api("POST", "/nudges/run", tok, { today: tomorrow, force: true, dryRun: true });
  ok("left open, it REJOINS the digest the next morning as overdue",
    (nudge2.body.sent || []).some(s => s.count === 1), nudge2.body);
  const rem2 = await api("POST", "/step-reminders/run", tok, { today: tomorrow, now: "14:01", dryRun: true });
  ok("…and the timed sender never fires for it again", (rem2.body.sent || []).length === 0, rem2.body);
  ok("NO task is reported by both surfaces on the same day",
    !((nudge.body.sent || []).length && (rem.body.sent || []).length && nudge.body.sent.some(s => s.count > 0)));

  // ── The real bytes, and BUILD-81's rule: a GET must never change state ───
  console.log("\n— §8 · the email itself, and every link in it —");
  await new Promise(r => sink.listen(SINK_PORT, r));
  captured = [];
  await api("POST", "/step-reminders/run", tok, { today, now: "14:01" });
  const mail = mails()[0]?.body;
  ok("the reminder actually left the server", !!mail && !!mail.html, mails().length);
  const html = (mail && mail.html) || "";
  ok("…naming the donor and the step in the subject", /Wilmore Rotary Club/.test(mail.subject) && /Call back/.test(mail.subject), mail.subject);
  ok("…and the time it was set for, in the org's own clock", /2:00 PM/.test(html), (html.match(/\d+:\d\d [AP]M/) || [])[0]);
  ok("…with a button into the donor's LOG-ONE-LINE screen, prefilled with the task — not the plain profile",
    /\/donors\/[^"']+\?conversation=1&step=/.test(html), (html.match(/href="[^"]*donors[^"]*"/) || [])[0]);
  ok("the org's mailing address problem is SAID, not papered over (CAN-SPAM)",
    /has no mailing address on file/.test(html) || /Add it in Settings/.test(html), null);
  ok("no naggy language — Steward holds things, it doesn't nag",
    !/keeps asking/i.test(html) && !/until you['\u2019]ve done it/i.test(html) && !/friendly reminder/i.test(html), null);

  // BUILD-81's rule stands, and this is why it stands: mail clients prefetch.
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(x => x[1]);
  const snapshot = async () => JSON.stringify(await q(
    `SELECT id, closed_at, snoozed_until, due_date, due_time, next_step_label FROM threads WHERE org_id=$1 ORDER BY id`, [ORG]));
  const before = await snapshot();
  for (const l of links) {
    for (const method of ["GET", "HEAD"]) {
      await fetch(l, { method }).catch(() => {});
      const u = new URL(l, BASE);
      await fetch(BASE + u.pathname + u.search, { method }).catch(() => {});
    }
  }
  const after = await snapshot();
  ok(`GET and HEAD on every link in the reminder changed ZERO threads (${links.length} links)`, before === after, null);

  // One email per thread per day: the digest_sends reservation.
  const again = await api("POST", "/step-reminders/run", tok, { today, now: "14:20" });
  ok("a timed reminder is sent ONCE — the second run reserves nothing",
    (again.body.sent || []).length === 0 && (again.body.skipped || []).some(s => s.reason === "already_sent"), again.body);

  await new Promise(r => sink.close(r));
  await closeDb();
  summary("build84");
})();
