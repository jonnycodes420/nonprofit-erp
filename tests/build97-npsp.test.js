// BUILD-97 Part 1 — SALESFORCE NPSP: THE PRESET, AND THE THREE THINGS IT
// REFUSES TO GUESS.
//
// The organisations Steward is being sold to are leaving the Nonprofit Success
// Pack. Their migration is two exports — a Contact report (the people) and an
// Opportunity report (their gifts) — and Steward already reads a donor sheet
// and a gift sheet in one pass. So this is a PRESET ON THE MAPPER, never a
// second importer: the BUILD-89S 89d rule and the BUILD-94 Mailchimp rule,
// applied a third time.
//
//   §1  THE HOUSEHOLD TRAP. In NPSP every individual belongs to a HOUSEHOLD
//       ACCOUNT, and the Contact export carries its name in `Account Name`:
//       "Barnett Household". Mapping Account Name → organization — the obvious
//       reading, and the one the brief's own sentence invites — turns EVERY
//       PERSON IN THE FILE into an organisation called "<Surname> Household",
//       which takes the whole file off the person surfaces (BUILD-80 Part 7)
//       and out of Drift. Six people must stay six people.
//
//   §2  ONLY `Closed Won` IS MONEY. A third of the fixture's Amount column is
//       money that never arrived. An importer that sums the column produces
//       $42,465 where the truth is $26,960 — and every row that is not cash
//       leaves with its DOLLARS and a REASON, so the BUILD-72 reconciliation
//       invariant still holds over a stage column.
//
//   §3  EVERY COLUMN IS ACCOUNTED FOR (BUILD-58 Part 2). mapped + ignored +
//       unrecognized == columns in the file, as arithmetic, not as a claim.
//
//   §4  THE SILENT DISCARD THIS BUILD FOUND. NPSP ships `Email Opt Out`
//       (`HasOptedOutOfEmail`) and NOTHING in the importer recognised that
//       spelling — every donor who had asked to stop receiving email imported
//       as reachable. Now recognised; and when a file carries TWO refusal
//       columns, the one Steward cannot use is named out loud.
//
//   §5  THE BUILDER. The stage decision has to survive the real accounted
//       transaction builder, not just the pure module — that is where the
//       invariant lives.
//
// Pure module + the shared builder. No server, no DB — this suite needs
// neither, which is why it runs in a second.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb } = require("./helpers");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const ORG = "org_b97npsp";
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };

const FIX = path.join(__dirname, "fixtures", "build97");

// The fixture has no quoted commas (asserted below), so a split is honest.
function readCsv(file) {
  const text = fs.readFileSync(path.join(FIX, file), "utf8").trim();
  const lines = text.split("\n");
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map(l => {
    const cells = l.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { headers, rows, text };
}

(async () => {
  console.log("build97-npsp");

  const N = await import("../shared/npspPreset.js");
  const S = await import("../shared/importShape.js");

  const contacts = readCsv("npsp-contacts.csv");
  const opps = readCsv("npsp-opportunities.csv");

  ok("the fixture has no quoted commas, so a naive split reads it honestly",
     !contacts.text.includes('"') && !opps.text.includes('"'));
  ok("8 contacts", contacts.rows.length === 8, contacts.rows.length);
  ok("12 opportunities", opps.rows.length === 12, opps.rows.length);

  // ── §1 · THE HOUSEHOLD TRAP ──────────────────────────────────────────────
  console.log("\n— §1 · a household account is not an organisation —");
  const kinds = contacts.rows.map(r => ({
    name: `${r["First Name"]} ${r["Last Name"]}`.trim(),
    org: N.npspOrganizationName(r),
  }));
  const asOrgs = kinds.filter(k => k.org);
  ok("exactly TWO rows become organisations", asOrgs.length === 2, asOrgs);
  ok("…and they are the ones with an Organization record type",
     asOrgs.map(o => o.org).sort().join("|") === "Cedar Grove Trust|Sunrise Foundation", asOrgs);
  ok("six people stay people", kinds.filter(k => !k.org).length === 6, kinds);
  // The failure this section exists to prevent, stated as the number it would
  // have produced: eight organisations and nobody on a person surface.
  ok("a naive Account Name -> organization would have produced EIGHT organisations",
     contacts.rows.filter(r => String(r["Account Name"] || "").trim()).length === 8);

  ok("`npe01__SYSTEMIsIndividual__c` is definitive when present",
     N.accountIsHousehold({ "npe01__SYSTEMIsIndividual__c": "true", "Account Name": "Sunrise Foundation" }) === true);
  ok("…in both directions",
     N.accountIsHousehold({ "npe01__SYSTEMIsIndividual__c": "false", "Account Name": "Barnett Household" }) === false);
  ok("the record type beats the naming convention",
     N.accountIsHousehold({ "Account Record Type": "Organization", "Account Name": "The Household Trust" }) === false);
  ok("with NO evidence at all the answer is null, not 'organisation'",
     N.accountIsHousehold({ "First Name": "Ada" }) === null);
  // The asymmetry, asserted: unknown must not become an organisation.
  ok("…and an unknown row therefore yields NO organisation name",
     N.npspOrganizationName({ "First Name": "Ada" }) === "");
  ok("'Barnett and Reyes Household' is still a household",
     N.accountIsHousehold({ "Account Name": "Barnett and Reyes Household" }) === true);

  // ── §2 · ONLY CLOSED WON IS MONEY ────────────────────────────────────────
  console.log("\n— §2 · the stage decides whether this is money —");
  const money = { cash: [0, 0], pledge: [0, 0], inKind: [0, 0], refused: [0, 0] };
  for (const r of opps.rows) {
    const d = N.npspGiftDecision(r);
    const key = d.bucket === "cash" ? "cash"
              : d.routedAs === "pledges" ? "pledge"
              : d.routedAs === "inKind" ? "inKind" : "refused";
    money[key][0]++; money[key][1] += Number(r.Amount);
  }
  ok("cash: 6 rows, $26,960.00", money.cash[0] === 6 && money.cash[1] === 26960, money.cash);
  ok("pledges: 2 rows, $10,040.00", money.pledge[0] === 2 && money.pledge[1] === 10040, money.pledge);
  ok("in-kind: 1 row, $300.00", money.inKind[0] === 1 && money.inKind[1] === 300, money.inKind);
  ok("not received: 3 rows, $5,165.00", money.refused[0] === 3 && money.refused[1] === 5165, money.refused);
  const fileTotal = opps.rows.reduce((s, r) => s + Number(r.Amount), 0);
  ok("every row lands in exactly one bucket (the invariant, as arithmetic)",
     money.cash[0] + money.pledge[0] + money.inKind[0] + money.refused[0] === opps.rows.length);
  ok("…and so does every dollar",
     Math.round((money.cash[1] + money.pledge[1] + money.inKind[1] + money.refused[1]) * 100)
       === Math.round(fileTotal * 100), fileTotal);
  ok("summing the Amount column would overstate what arrived by $15,505",
     Math.round((fileTotal - money.cash[1]) * 100) === 1550500, fileTotal - money.cash[1]);

  // In-kind outranks the stage: Zz010 is Closed Won and is NOT cash.
  const inKindRow = opps.rows.find(r => r["Opportunity ID"] === "006Aa00000Zz010");
  ok("the in-kind row IS at stage Closed Won", inKindRow.Stage === "Closed Won", inKindRow.Stage);
  ok("…and is still not counted as money received",
     N.npspGiftDecision(inKindRow).bucket === "routed", N.npspGiftDecision(inKindRow));

  // An unknown stage is never cash, and says so by name.
  const unknownRow = opps.rows.find(r => r["Opportunity ID"] === "006Aa00000Zz012");
  const unknownVerdict = N.npspGiftDecision(unknownRow);
  ok("an unrecognised stage is refused, never guessed into cash",
     unknownVerdict.bucket === "refused" && unknownVerdict.knownStage === false, unknownVerdict);
  ok("…and the reason NAMES the stage so a human can answer",
     unknownVerdict.reason.includes("Awaiting Board Review"), unknownVerdict.reason);
  ok("a BLANK stage is not 'fine', it is a row nobody finished",
     S.classifyGiftStage("").kind === "not_received" && S.classifyGiftStage("").known === false,
     S.classifyGiftStage(""));

  // THE VOCABULARY LIVES IN ONE PLACE. A second copy in the preset would be a
  // second truth about whether money arrived.
  ok("the preset reads the shared stage vocabulary, it does not hold one",
     N.npspStageKind("Closed Won").kind === N.NPSP_STAGE_CASH
     && N.npspStageKind("Pledged").kind === N.NPSP_STAGE_PLEDGE
     && N.npspStageKind("Closed Lost").kind === N.NPSP_STAGE_NOT_RECEIVED);
  const presetSrc = fs.readFileSync(path.join(__dirname, "..", "shared", "npspPreset.js"), "utf8");
  ok("…proven on the source: the preset imports classifyGiftStage",
     /import \{[^}]*classifyGiftStage[^}]*\} from "\.\/importShape\.js"/.test(presetSrc));
  ok("…and defines no stage table of its own",
     !/GIFT_STAGE_RECEIVED|GIFT_STAGE_NOT_RECEIVED/.test(presetSrc));

  // ── §3 · EVERY COLUMN ACCOUNTED FOR ──────────────────────────────────────
  console.log("\n— §3 · not one column falls on the floor —");
  for (const [label, file] of [["contacts", contacts], ["opportunities", opps]]) {
    const r = N.npspMapping(file.headers);
    ok(`${label}: mapped + ignored + unrecognized == columns in the file`,
       r.accounted === r.columnsIn && r.columnsIn === file.headers.length,
       { accounted: r.accounted, columnsIn: r.columnsIn });
    ok(`${label}: nothing is left unrecognised`, r.unrecognized.length === 0, r.unrecognized);
    ok(`${label}: nothing required is missing`, r.missing.length === 0, r.missing);
    ok(`${label}: every ignored column carries a REASON, never a bare name`,
       r.ignored.every(i => typeof i.reason === "string" && i.reason.length > 10),
       r.ignored.filter(i => !i.reason));
  }

  // The keys are the MAPPER's own field names — a third vocabulary would need
  // a translation layer, and a translation layer is where a column goes missing.
  const cMap = N.npspMapping(contacts.headers);
  const CSV_KEYS = new Set(["name", "email", "phone", "total", "lastAmount", "lastGift", "gifts",
    "status", "organization", "city", "state", "address", "zip", "notes", "owner", "photo",
    "deceased", "doNotContact", "_firstName", "_lastName"]);
  const badContact = Object.values(cMap.mapping).filter(f => !CSV_KEYS.has(f));
  ok("every contact target is a real CSV_FIELDS key", badContact.length === 0, badContact);

  const oMap = N.npspMapping(opps.headers);
  const TX_KEYS = new Set(["address", "amount", "campaign", "city", "date", "donorEmail",
    "donorName", "donorType", "externalId", "firstName", "fund", "lastName", "notes", "orgName",
    "owner", "paymentMethod", "phone", "stage", "state", "type", "zip", "inKind"]);
  const badOpp = Object.values(oMap.mapping).filter(f => !TX_KEYS.has(f));
  ok("every opportunity target is a real txMap key", badOpp.length === 0, badOpp);
  ok("Close Date is the date", oMap.mapping["Close Date"] === "date", oMap.mapping["Close Date"]);
  ok("Amount is the amount", oMap.mapping["Amount"] === "amount");
  ok("Stage is the stage", oMap.mapping["Stage"] === "stage");
  ok("Primary Campaign Source is the FUND, as the brief asks",
     oMap.mapping["Primary Campaign Source"] === "fund", oMap.mapping["Primary Campaign Source"]);
  ok("Account Name is the organisation on a gift row",
     oMap.mapping["Account Name"] === "orgName");

  // Detection: the namespace is unambiguous; report labels need two signals.
  ok("a Data Loader export (API names) is recognised",
     N.detectNpsp(["Id", "npo02__TotalOppAmount__c", "npe01__HomeEmail__c"]).isNpsp === true);
  ok("a report export (human labels) is recognised",
     N.detectNpsp(contacts.headers).object === N.NPSP_OBJECT_CONTACT);
  ok("an Opportunity export is told apart from a Contact export",
     N.detectNpsp(opps.headers).object === N.NPSP_OBJECT_OPPORTUNITY);
  ok("an ordinary CSV is NOT claimed as Salesforce",
     N.detectNpsp(["Name", "Email", "Amount", "Date"]).isNpsp === false,
     N.detectNpsp(["Name", "Email", "Amount", "Date"]));
  ok("…nor is a Mailchimp export", N.detectNpsp(["Email Address", "First Name", "Tags", "Member Rating"]).isNpsp === false);

  // ── §4 · THE SILENT DISCARD ──────────────────────────────────────────────
  console.log("\n— §4 · 'Email Opt Out' is a refusal, and it was invisible —");
  const flags = S.detectFlagColumns(["Name", "Email Opt Out"]);
  ok("`Email Opt Out` is now recognised as a do-not-contact column",
     flags.doNotContactCol === "Email Opt Out", flags);
  ok("…as is the API spelling", S.detectFlagColumns(["HasOptedOutOfEmail"]).doNotContactCol === "HasOptedOutOfEmail");
  // The boundary that keeps it honest: a phone refusal is not an email refusal.
  ok("`Do Not Call` is NOT folded in — it blocks the phone, not the mail",
     S.detectFlagColumns(["Do Not Call"]).doNotContactCol === "", S.detectFlagColumns(["Do Not Call"]));
  ok("the old anchored patterns still hold (no lookalike false positives)",
     S.detectFlagColumns(["Deceased Spouse Name", "Contact Notes"]).deceasedCol === "");
  ok("detectFlagColumns now returns EVERY matching column, not just the first",
     S.detectFlagColumns(["Do Not Contact", "Email Opt Out"]).doNotContactCols.length === 2,
     S.detectFlagColumns(["Do Not Contact", "Email Opt Out"]));
  ok("…and the single-value answer is unchanged for every existing caller",
     S.detectFlagColumns(["Do Not Contact", "Email Opt Out"]).doNotContactCol === "Do Not Contact");

  const warn = cMap.warnings.find(w => w.kind === "flag_collision");
  ok("a file with TWO refusal columns produces a WARNING, not a silence", !!warn, cMap.warnings);
  ok("…which names BOTH columns",
     warn && warn.sentence.includes("Do Not Contact") && warn.sentence.includes("Email Opt Out"),
     warn && warn.sentence);
  ok("…and says plainly what the consequence is",
     warn && /import as reachable/.test(warn.sentence), warn && warn.sentence);
  ok("the column Steward could not use is IGNORED (known), never UNRECOGNIZED (unknown)",
     cMap.ignored.some(i => i.header === "Email Opt Out") && !cMap.unrecognized.includes("Email Opt Out"),
     { ignored: cMap.ignored.map(i => i.header), unrecognized: cMap.unrecognized });
  ok("a file with only ONE refusal column produces no warning",
     N.npspMapping(["First Name", "Last Name", "Email", "Do Not Contact"]).warnings.length === 0);

  // ── §5 · THROUGH THE REAL BUILDER ────────────────────────────────────────
  // The pure decision is worth nothing if the accounted builder disagrees with
  // it — the invariant lives in the builder, not in this file.
  console.log("\n— §5 · the same answer through the accounted builder —");
  const txMap = oMap.mapping && Object.fromEntries(
    Object.entries(oMap.mapping).map(([header, field]) => [field, header]));
  const built = S.buildTransactionRows({ rows: opps.rows }, txMap, { today: "2026-09-23" });
  const tally = built.semantics.tally;

  const cashDollars = built.gifts.reduce((s, g) => s + g.amount, 0);
  ok("the builder counts the SAME cash: $26,960.00",
     Math.round(cashDollars * 100) === 2696000, cashDollars);
  ok("…across the same 6 gifts", built.gifts.length === 6, built.gifts.length);
  ok("pledges routed: 2 rows, $10,040.00",
     tally.pledges.rows === 2 && Math.round(tally.pledges.dollars * 100) === 1004000, tally.pledges);
  ok("in-kind routed: 1 row, $300.00",
     tally.inKind.rows === 1 && Math.round(tally.inKind.dollars * 100) === 30000, tally.inKind);
  ok("not received: 3 rows, $5,165.00 — counted, never dropped",
     tally.notReceived.rows === 3 && Math.round(tally.notReceived.dollars * 100) === 516500,
     tally.notReceived);

  // THE RECONCILIATION INVARIANT, over a stage column.
  const f = built.file;
  ok("every physical row leaves with exactly one disposition",
     built.dispositions.length === opps.rows.length,
     { dispositions: built.dispositions.length, rows: opps.rows.length });
  ok("rows_in_file = imported + donor_only + skipped + errored",
     f.rows === f.imported + f.donorOnly + f.skipped + f.errored, f);
  ok("…and none of them errored", f.errored === 0, f);
  ok("the file's dollars still add up through the builder",
     Math.round(f.dollars * 100) === Math.round(fileTotal * 100), { fileDollars: f.dollars, fileTotal });

  // Every set-aside row says WHY, in the stage's own words.
  const setAside = built.dispositions.filter(d => d.disposition === "skipped" && /^not_received/.test(d.reason || ""));
  ok("each not-received row carries its own reason", setAside.length === 3, setAside.map(d => d.reason));
  ok("…and one of them quotes the unknown stage back",
     setAside.some(d => d.reason.includes("Awaiting Board Review")), setAside.map(d => d.reason));
  ok("…and each carries its DOLLARS, so the equation can state the gap",
     setAside.every(d => d.dollars > 0), setAside.map(d => d.dollars));
  ok("the builder reports the unknown stages for a human to answer",
     built.semantics.unknownStages.length === 1
     && built.semantics.unknownStages[0].stage === "Awaiting Board Review",
     built.semantics.unknownStages);

  // A file with NO stage column behaves exactly as it did before this build.
  const noStage = S.buildTransactionRows({ rows: opps.rows },
    Object.fromEntries(Object.entries(txMap).filter(([fld]) => fld !== "stage")), { today: "2026-09-23" });
  ok("with no stage column mapped, the stage branch is inert (nothing set aside by stage)",
     noStage.semantics.tally.notReceived.rows === 0, noStage.semantics.tally.notReceived);
  ok("…and the unknown-stage list is empty",
     noStage.semantics.unknownStages.length === 0, noStage.semantics.unknownStages);
  ok("…and the money that never arrived is then counted as cash — which is the\n        whole reason the stage column has to be mapped",
     noStage.gifts.length > built.gifts.length, { withStage: built.gifts.length, without: noStage.gifts.length });

  // ── §6 · THE PRESET SAYS WHAT IT IS ──────────────────────────────────────
  console.log("\n— §6 · confidence, stated on the preset itself —");
  ok("the preset declares it has NOT been walked against a real export",
     N.NPSP_PRESET.confidence === "documented-not-walked", N.NPSP_PRESET.confidence);
  ok("…and carries the cash rule as one sentence a person can read",
     /Closed Won/.test(N.NPSP_PRESET.cashRule) && /set aside/.test(N.NPSP_PRESET.cashRule),
     N.NPSP_PRESET.cashRule);
  const readme = fs.readFileSync(path.join(FIX, "README.md"), "utf8");
  ok("the fixture states it is built from documentation, not recorded",
     /HAND-BUILT FROM DOCUMENTATION, NOT RECORDED/.test(readme));
  ok("…and is deliberately NOT in the sanctioned recorded-payload directory",
     !fs.existsSync(path.join(__dirname, "fixtures", "external", "npsp-contacts.csv")));

  // ── §7 · THE BROWSER: THE PERSON DOING THE MIGRATION SEES IT ─────────────
  // Everything above is true of the module. None of it reaches a fundraiser
  // unless the mapper actually applies the preset and says what it did — and
  // the BUILD-98 lesson is that every server assertion can be green while the
  // screen shows something else.
  console.log("\n— §7 · the browser: the mapper says what it recognised —");
  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    for (const t of ["gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,'NPSP Migration','npsp-migration',1,'active','team')`, [ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,'npsp@b97.example.org',$3,'Migrator','admin')`,
            ["u_" + ORG, ORG, bcrypt.hashSync("loadtest1234", 10)]);
    const login = await api("POST", "/auth/login", null,
      { email: "npsp@b97.example.org", password: "loadtest1234" });
    ok("the fixture org signs in", login.status === 200, login.status);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    const errors = [];
    page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) errors.push(e.message.slice(0, 160)); });
    await page.addInitScript(([tk, u, o]) => {
      localStorage.setItem("npe_token", tk);
      localStorage.setItem("npe_user", u);
      localStorage.setItem("npe_org", o);
    }, [login.body.token, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);
    await page.goto(APP + "/donors", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.click('button:has-text("Donors")').catch(() => {});
    await page.waitForTimeout(900);
    await page.click('button:has-text("Import & tools")');
    await page.waitForTimeout(400);
    await page.click('button:has-text("Import + History")');
    await page.waitForTimeout(700);
    await (await page.$('input[type="file"]')).setInputFiles(path.join(FIX, "npsp-contacts.csv"));
    await page.waitForTimeout(3000);

    const banner = page.locator('[data-testid="npsp-preset"]');
    ok("the mapper says it recognised a Salesforce export", await banner.count() === 1, await banner.count());
    const text = (await banner.count()) ? await banner.innerText() : "";
    ok("…and which of the two reports it is",
       /contact report/i.test(text), text.slice(0, 160));
    ok("…and states the household rule, which is the trap",
       /household is a PERSON/i.test(text), text.slice(0, 260));

    // THE WARNING IS ON SCREEN, not only in the module's return value.
    const warnEl = page.locator('[data-testid="npsp-warning"]');
    ok("the two-refusal-columns warning renders", await warnEl.count() === 1, await warnEl.count());
    const warnText = (await warnEl.count()) ? await warnEl.innerText() : "";
    ok("…naming both columns on screen",
       /Do Not Contact/.test(warnText) && /Email Opt Out/.test(warnText), warnText.slice(0, 240));

    // THE MAPPING WAS ACTUALLY APPLIED — the assertion that would catch a
    // preset that computes the right answer and never reaches the dropdowns.
    const totalSel = page.locator('[data-testid="donor-map-Total Gifts"]');
    ok("the mapper rendered a target for 'Total Gifts'", await totalSel.count() === 1, await totalSel.count());
    if (await totalSel.count()) {
      ok("…and the preset pre-selected LIFETIME GIVING, not a guess",
         (await totalSel.inputValue()) === "std:total", await totalSel.inputValue());
    }
    const acctSel = page.locator('[data-testid="donor-map-Account Name"]');
    if (await acctSel.count()) {
      ok("'Account Name' is mapped to organization on a contact sheet",
         (await acctSel.inputValue()) === "std:organization", await acctSel.inputValue());
    } else ok("'Account Name' has a target dropdown", false, "not rendered");

    const ignored = page.locator('[data-testid="npsp-ignored"]');
    ok("the columns it set aside are reachable on screen", await ignored.count() === 1, await ignored.count());

    ok("no page error while reading the file", errors.length === 0, errors.slice(0, 2));
    await browser.close();
    for (const t of ["gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
    await closeDb();
  }

  summary();
})().catch(e => { console.error(e); process.exit(1); });
