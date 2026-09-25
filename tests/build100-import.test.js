// BUILD-100 (grants) Part 6 — READING SOMEBODY ELSE'S GRANT SPREADSHEET.
//
// The brief's own test: a 40-row fixture imports 40 grants on 12 funders with
// ZERO new people and the pipeline total in cents.
//
//   §1  the pure rules — columns, detection, each source's status vocabulary,
//       and the name key that must not fold two funders into one;
//   §2  the brief's 40-row file, end to end, reconciled by hand in cents;
//   §3  ZERO NEW PEOPLE — every funder created is an organisation, and the
//       person count across the org is byte-identical before and after;
//   §4  a funder whose only match is a PERSON is refused by name, and nothing
//       is written for that row;
//   §5  EIN beats name, and a name alone still finds the organisation;
//   §6  the same file twice adds nothing, and the same row twice inside one
//       file adds one;
//   §7  what a row is refused FOR, each by line number, and what the import
//       deliberately does not write (no gift, no pledge, no deadline watched);
//   §8  the four vendor presets read their own words;
//   §9  the wall: org A's import lands nothing in org B, and the preview
//       writes nothing at all.
//
// NB every EIN in this file is GENERATED, never written down — the repo-wide
// rule from FIX-legal-entity forbids a tax-ID-shaped literal in source, and it
// is right to: an EIN is not public.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b100_imp", OTHER = "b100_imp2";
const ME = "b100imp@example.org", THEM = "b100imp-other@example.org";
const PW = "loadtest1234";

const CHILD = ["grant_spend", "grant_milestones", "grant_documents", "grant_interactions",
  "program_grants", "grants", "pledge_installments", "fin_transactions", "interactions",
  "threads", "tasks", "opportunities", "moves", "gifts", "pledges", "donors", "users",
  "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = id => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
   VALUES ($1,$1,$2,1,'team','active','America/New_York',NOW())
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [id, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const cents = v => Math.round(Number(v) * 100);
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// A tax-ID-shaped string is never written down here; it is assembled.
const einFor = n => `${12 + (n % 80)}-${String(3100000 + n * 137)}`;

(async () => {
  console.log("build100-import");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b100imp", ORG, ME, "Allie Barnett");
  await mkUser("u_b100imp2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_youth6','${ORG}','Youth programme',true)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const I = await import("../shared/grantImport.js");
  const G = await import("../shared/grantShape.js");

  // ── §1 · THE PURE RULES ─────────────────────────────────────────────────
  console.log("\n— §1 · columns, detection, vocabulary, and the name key —");
  ok("§1 the longest matching spelling wins a column",
     I.fieldForHeader("Amount Awarded") === "amountAwarded"
     && I.fieldForHeader("Amount Requested") === "amountRequested"
     && I.fieldForHeader("Amount") === "amountRequested");
  // THE UNDERSCORE LESSON (BUILD-84): normalise to tokens first, or `\b` never
  // fires at one and "fiscal_year" is read as nothing.
  ok("§1 an underscored header is read", I.fieldForHeader("fiscal_year") === "cycleName");
  ok("§1 …and a header that merely CONTAINS a field word claims nothing",
     I.fieldForHeader("EIN Verified") === null && I.fieldForHeader("Amount Requested Last Year") === null);
  ok("§1 the MORE SPECIFIC header wins a contested field, and the other is reported", (() => {
    const m = I.grantMapping(["Funder", "Program", "Amount", "Amount Requested", "Wobble"]);
    return m.mapping.amountRequested === "Amount Requested"
      && m.unrecognised.some(u => u.header === "Amount" && /more specific/.test(u.why))
      && m.unrecognised.some(u => u.header === "Wobble");
  })(), I.grantMapping(["Funder", "Program", "Amount", "Amount Requested", "Wobble"]));
  // AND THE SPELLING IS CARRIED, because it is what decides whether an awarded
  // row's amount is an award or only an ask.
  ok("§1 a column that SAYS requested is known to say it",
     I.requestedIsExplicit("amount requested") && I.requestedIsExplicit("ask")
     && !I.requestedIsExplicit("amount"));
  ok("§1 one shared column is not evidence of a vendor",
     I.detectGrantSource(["Account Name", "Amount", "Status"]).source === "generic");
  ok("§1 …and two of a vendor's own columns are",
     I.detectGrantSource(["Opportunity Name", "Opportunity Stage", "Amount"]).source === "npsp");
  // THE NAME KEY. The first cut folded the Sunrise Foundation and the Sunrise
  // Trust into one funder — every grant from either would have landed on
  // whichever record existed first.
  ok("§1 the corporate form is dropped so one office's Inc. is not a second funder",
     I.funderNameKey("The Sunrise Fdn., Inc.") === I.funderNameKey("Sunrise Foundation"));
  ok("§1 …but the ENTITY TYPE is part of the name",
     I.funderNameKey("Sunrise Trust") !== I.funderNameKey("Sunrise Foundation"),
     [I.funderNameKey("Sunrise Trust"), I.funderNameKey("Sunrise Foundation")]);
  ok("§1 a name that is nothing BUT the corporate form keeps itself",
     I.funderNameKey("The Company") !== "", I.funderNameKey("The Company"));
  ok("§1 an EIN is nine digits or nothing",
     I.normalizeEin("12-3456789") === "123456789" && I.normalizeEin("1234567") === null
     && I.normalizeEin("") === null);
  ok("§1 Steward's own status words round-trip",
     G.STATUS_KEYS.every(k => I.statusFromSource(k, "generic").status === k), G.STATUS_KEYS);
  ok("§1 a word no table knows defaults to researching and is NOT read",
     I.statusFromSource("wobble", "generic").status === "researching"
     && I.statusFromSource("wobble", "generic").read === false);

  // ── THE BRIEF'S FILE: 40 rows, 12 funders ───────────────────────────────
  // Hand-computed and nowhere else. Twelve funders; rows spread across the six
  // statuses; the OPEN rows are what the pipeline total must foot to.
  const FUNDERS = ["The Sunrise Foundation", "Acme Corporate Giving", "Quiet Trust",
    "Hollis Family Foundation", "Mercer Charitable Fund", "Delta Regional Foundation",
    "Nightingale Trust", "Beacon Hill Fund", "Orchard Foundation", "Larkspur Philanthropies",
    "Tidewater Community Foundation", "Whitfield Family Trust"];
  const STATUSES = ["Researching", "LOI", "Submitted", "Awarded", "Declined", "Closed"];
  const headers = ["Grant ID", "Funder", "EIN", "Program", "Amount Requested", "Amount Awarded",
                   "Status", "Deadline", "Decline Reason", "Fund", "Officer", "Fiscal Year", "Notes"];
  const rows = [], HAND = { openCents: 0, awardedCents: 0, byFunder: new Map() };
  for (let i = 0; i < 40; i++) {
    const f = FUNDERS[i % 12];
    const status = STATUSES[i % 6];
    const requested = 1000 + i * 250;                 // 1,000 … 10,750
    const awarded = status === "Awarded" ? requested - 100 : "";
    rows.push([
      `SRC-${1000 + i}`, f, einFor(i % 12), `Programme ${i + 1}`,
      `$${requested.toLocaleString("en-US")}.00`, awarded === "" ? "" : `$${awarded.toLocaleString("en-US")}.00`,
      status, plusDays(10 + i), status === "Declined" ? "not_a_fit" : "",
      i % 4 === 0 ? "Youth programme" : "", i % 5 === 0 ? "Allie Barnett" : "", "FY2026",
      i === 0 ? "The first row carries a note." : "",
    ]);
    if (["Researching", "LOI", "Submitted"].includes(status)) HAND.openCents += cents(requested);
    if (status === "Awarded") HAND.awardedCents += cents(awarded);
    HAND.byFunder.set(f, (HAND.byFunder.get(f) || 0) + 1);
  }
  ok("fixture the file is 40 rows on 12 funders",
     rows.length === 40 && HAND.byFunder.size === 12, [rows.length, HAND.byFunder.size]);

  // ── §9a · THE PREVIEW WRITES NOTHING ────────────────────────────────────
  console.log("\n— §9a · a preview reads and returns; it changes nothing —");
  const before = (await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1`, [ORG]))[0].c;
  const beforeGrants = (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1`, [ORG]))[0].c;
  const prev = await api("POST", "/grants/import/preview", tok, { headers, rows });
  ok("§9a the preview reads the file", prev.status === 200, prev.body);
  ok("§9a …and says it wrote nothing", prev.body.wrote === false);
  ok("§9a …and nothing was written",
     (await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1`, [ORG]))[0].c === before
     && (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1`, [ORG]))[0].c === beforeGrants);
  ok("§9a the preview already knows the pipeline total, in cents",
     prev.body.pipelineCents === HAND.openCents, [prev.body.pipelineCents, HAND.openCents]);
  ok("§9a …and names what it will and will not touch",
     (prev.body.doesNotWrite || []).join("|").includes("gifts")
     && (prev.body.doesNotWrite || []).join("|").includes("pledges"), prev.body.doesNotWrite);

  // ── §2 · THE BRIEF'S TEST ───────────────────────────────────────────────
  console.log("\n— §2 · 40 grants on 12 funders, reconciled in cents —");
  const imp = await api("POST", "/grants/import", tok, { headers, rows });
  ok("§2 the file imports", imp.status === 201, imp.body);
  ok("§2 FORTY grants", imp.body.counts.grants === 40, imp.body.counts);
  ok("§2 TWELVE funders", imp.body.counts.funders === 12, imp.body.counts);
  ok("§2 …all twelve created, since none was on file",
     imp.body.counts.created === 12, imp.body.created.map(c => c.name));
  ok("§2 nothing was refused", imp.body.counts.refused === 0, imp.body.refused);
  ok("§2 nothing was skipped", imp.body.counts.skipped === 0, imp.body.counts);
  ok("§2 THE PIPELINE TOTAL IN CENTS",
     imp.body.pipelineCents === HAND.openCents, [imp.body.pipelineCents, HAND.openCents]);
  // And the number a screen would show reads the same as the file's own rows.
  const pipeline = await api("GET", "/grants/pipeline", tok, null);
  ok("§2 the pipeline screen agrees, in cents",
     pipeline.body.openPipeline.cents === HAND.openCents,
     [pipeline.body.openPipeline.cents, HAND.openCents]);
  const dbCounts = (await q(
    `SELECT status, COUNT(*)::int AS c, COALESCE(SUM(amount_requested),0) AS req,
            COALESCE(SUM(amount_awarded),0) AS awd
       FROM grants WHERE org_id=$1 GROUP BY status ORDER BY status`, [ORG]));
  ok("§2 the database holds 40 grants across the six statuses",
     dbCounts.reduce((s, r) => s + r.c, 0) === 40 && dbCounts.length === 6, dbCounts);
  const awardedCents = dbCounts.filter(r => r.status === "awarded")
    .reduce((s, r) => s + Math.round(Number(r.awd) * 100), 0);
  ok("§2 the awarded money foots to the file's own awarded column",
     awardedCents === HAND.awardedCents, [awardedCents, HAND.awardedCents]);
  ok("§2 the sentence says what happened, without a hole in it",
     /^40 grants on 12 funders, 12 funders added as organisations\./.test(imp.body.sentence)
     && /still open\.$/.test(imp.body.sentence), imp.body.sentence);

  // ── §3 · ZERO NEW PEOPLE ────────────────────────────────────────────────
  console.log("\n— §3 · a funder is an organisation, and no person was made —");
  const people = await q(
    `SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1 AND deleted_at IS NULL
       AND (kind IS NULL OR LOWER(kind) NOT IN ('organisation','organization'))`, [ORG]);
  ok("§3 ZERO people on file after importing forty grants", people[0].c === 0, people[0]);
  const orgs = await q(
    `SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1 AND LOWER(kind) IN ('organisation','organization')`, [ORG]);
  ok("§3 …and twelve organisations", orgs[0].c === 12, orgs[0]);
  ok("§3 every created funder carries the file's EIN",
     (await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1 AND funder_ein IS NOT NULL`, [ORG]))[0].c === 12);
  // AND THE FUNDER RECORD OPENS. Part 1's own door refuses a person, so a funder
  // created as one would be a bug that looks like data.
  const oneFunder = imp.body.created[0].id;
  const fr = await api("GET", `/funders/${oneFunder}/grants`, tok, null);
  ok("§3 a created funder's own record opens on Part 1's door", fr.status === 200, fr.body);
  ok("§3 …with the grants the file gave it",
     (fr.body.grants || []).length === HAND.byFunder.get(imp.body.created[0].name),
     [(fr.body.grants || []).length, imp.body.created[0].name]);

  // ── §4 · A NAME THAT ONLY MATCHES A PERSON IS REFUSED ────────────────────
  console.log("\n— §4 · institutional money never lands on a human being —");
  await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count)
           VALUES ('dn_marg','${ORG}','Margaret Chen','marg@example.org','person','steward',50000,4)`);
  const grantsBefore = (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1`, [ORG]))[0].c;
  const personFile = await api("POST", "/grants/import", tok, {
    headers: ["Funder", "Program", "Amount Requested", "Status"],
    rows: [["Margaret Chen", "Studio access", "$5,000.00", "Submitted"],
           ["Halcyon Foundation", "Studio access", "$6,000.00", "Submitted"]],
  });
  ok("§4 the file imports the row it can", personFile.status === 201 && personFile.body.counts.grants === 1,
     personFile.body.counts);
  ok("§4 …and REFUSES the one whose funder is a person, by line",
     personFile.body.refused.length === 1 && personFile.body.refused[0].line === 2
     && personFile.body.refused[0].code === "funder_is_a_person", personFile.body.refused);
  ok("§4 …saying why, in words that name the fix",
     /programme officer|Add the funder as an organisation/.test(personFile.body.refused[0].why),
     personFile.body.refused[0].why);
  ok("§4 …and NOTHING was written for that row",
     (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1`, [ORG]))[0].c === grantsBefore + 1);
  ok("§4 …and the person is untouched: still a person, still their own giving",
     (await q(`SELECT kind, total_giving FROM donors WHERE id='dn_marg'`))[0].kind === "person"
     && Math.round(Number((await q(`SELECT total_giving FROM donors WHERE id='dn_marg'`))[0].total_giving) * 100) === cents(50000),
     (await q(`SELECT kind, total_giving FROM donors WHERE id='dn_marg'`))[0]);

  // ── §5 · EIN BEATS NAME ─────────────────────────────────────────────────
  console.log("\n— §5 · the one identifier in this domain that is unique —");
  const renamed = await api("POST", "/grants/import", tok, {
    headers: ["Funder", "EIN", "Program", "Amount Requested", "Status"],
    // The SAME funder as row 1 of the big file, spelled differently — only the
    // EIN says they are one institution.
    rows: [["Sunrise Fdn", einFor(0), "Second cycle", "$8,000.00", "LOI"]],
  });
  ok("§5 the row imports", renamed.status === 201 && renamed.body.counts.grants === 1, renamed.body);
  ok("§5 …matched on the EIN, creating NO second funder",
     renamed.body.counts.created === 0 && renamed.body.counts.matchedByEin === 1, renamed.body.counts);
  const sunriseId = (await q(
    `SELECT id FROM donors WHERE org_id=$1 AND name=$2`, [ORG, "The Sunrise Foundation"]))[0].id;
  ok("§5 …and the grant is on the funder already on file",
     (await q(`SELECT funder_donor_id FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "Second cycle"]))[0]
       .funder_donor_id === sunriseId);
  const byNameOnly = await api("POST", "/grants/import", tok, {
    headers: ["Funder", "Program", "Amount Requested", "Status"],
    rows: [["The Sunrise Foundation, Inc.", "Third cycle", "$2,000.00", "Submitted"]],
  });
  ok("§5 a name alone, with the corporate form on it, still finds the same funder",
     byNameOnly.body.counts.created === 0 && byNameOnly.body.counts.matchedByName === 1, byNameOnly.body.counts);
  // TWO RECORDS CLAIMING ONE EIN IS A DUPLICATE TO MERGE, and the DATABASE says
  // so — the index is the arbiter, not a check that could lose a race.
  const dupEin = await api("PUT", `/funders/${imp.body.created[1].id}`, tok, { ein: einFor(0) });
  ok("§5 a second record cannot claim an EIN already on file",
     dupEin.status === 409 && dupEin.body.code === "ein_already_on_file", [dupEin.status, dupEin.body]);
  const badEin = await api("PUT", `/funders/${sunriseId}`, tok, { ein: "12-345" });
  ok("§5 …and a half-typed EIN is refused rather than stored short",
     badEin.status === 400 && badEin.body.code === "bad_ein", badEin.body);

  // ── §6 · THE SAME FILE TWICE ────────────────────────────────────────────
  console.log("\n— §6 · importing it again adds nothing —");
  const total6 = (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1`, [ORG]))[0].c;
  const again = await api("POST", "/grants/import", tok, { headers, rows });
  ok("§6 the second pass writes no grant",
     again.body.counts.grants === 0 && again.body.counts.skipped === 40, again.body.counts);
  ok("§6 …and no funder", again.body.counts.created === 0, again.body.counts);
  ok("§6 …and the count on file is unchanged",
     (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1`, [ORG]))[0].c === total6);
  ok("§6 the sentence says nothing was imported, and why",
     /already on file/.test(again.body.sentence) || /no grants/.test(again.body.sentence), again.body.sentence);
  const twins = await api("POST", "/grants/import", tok, {
    headers: ["Funder", "Program", "Amount Requested", "Status"],
    rows: [["Orchard Foundation", "Twin programme", "$3,000.00", "Submitted"],
           ["Orchard Foundation", "Twin programme", "$3,000.00", "Submitted"]],
  });
  ok("§6 the same row twice INSIDE one file imports once and counts the other",
     twins.body.counts.grants === 1 && twins.body.counts.skipped === 1, twins.body.counts);

  // ── §7 · WHAT A ROW IS REFUSED FOR, AND WHAT IS NEVER WRITTEN ───────────
  console.log("\n— §7 · each refusal by line, and the things import does not touch —");
  const messy = await api("POST", "/grants/import", tok, {
    headers: ["Funder", "Program", "Amount Requested", "Amount Awarded", "Status", "Deadline"],
    rows: [
      ["", "No funder here", "$1,000.00", "", "Submitted", ""],                       // line 2
      ["Beacon Hill Fund", "", "$1,000.00", "", "Submitted", ""],                     // line 3
      ["Beacon Hill Fund", "No money named", "", "", "Submitted", ""],                // line 4
      ["Beacon Hill Fund", "Awarded with no amount", "$4,000.00", "", "Awarded", ""],  // line 5, imports as submitted
      ["Beacon Hill Fund", "An unreadable date", "$4,000.00", "", "Submitted", "03/04/2026"],
      ["Beacon Hill Fund", "An unreadable status", "$4,000.00", "", "Wobbling", ""],
    ],
  });
  ok("§7 three rows are refused, each with its line",
     messy.body.refused.length === 3 && messy.body.refused.map(r => r.line).join(",") === "2,3,4",
     messy.body.refused);
  for (const [line, must] of [[2, /no funder/i], [3, /programme, project or purpose/i], [4, /no amount/i]]) {
    const r = messy.body.refused.find(x => x.line === line);
    ok(`§7 line ${line} says why in words a person can act on`, !!r && must.test(r.why), r);
  }
  // AN AWARD WITH NO AWARDED AMOUNT IS NOT AN AWARD — falling back to what was
  // requested would report money the funder never promised, for ever.
  ok("§7 an awarded row with no awarded amount imports as SUBMITTED and is counted",
     messy.body.counts.awardedWithoutAmount === 1
     && (await q(`SELECT status FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "Awarded with no amount"]))[0].status === "submitted",
     messy.body.counts);
  ok("§7 an ambiguous date is left out and counted, never guessed at",
     messy.body.counts.datesUnreadable === 1
     && (await q(`SELECT deadline FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "An unreadable date"]))[0].deadline === null,
     messy.body.counts);
  ok("§7 an unreadable status defaults to researching and is COUNTED",
     messy.body.counts.statusUnreadable === 1
     && (await q(`SELECT status FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "An unreadable status"]))[0].status === "researching",
     messy.body.counts);
  // AN IMPORTED FILE IS HISTORY AND RAISES NOTHING (BUILD-81/83).
  ok("§7 not one gift was written", (await q(`SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=$1`, [ORG]))[0].c === 0);
  ok("§7 not one pledge was written",
     (await q(`SELECT COUNT(*)::int AS c FROM pledges WHERE org_id=$1`, [ORG]))[0].c === 0);
  ok("§7 not one deadline Steward watches was raised",
     (await q(`SELECT COUNT(*)::int AS c FROM grant_milestones WHERE org_id=$1`, [ORG]))[0].c === 0);
  ok("§7 not one follow-up was opened",
     (await q(`SELECT COUNT(*)::int AS c FROM threads WHERE org_id=$1`, [ORG]))[0].c === 0);
  ok("§7 a declined row carries a reason from the closed list",
     (await q(`SELECT DISTINCT decline_reason FROM grants WHERE org_id=$1 AND status='declined'`, [ORG]))
       .every(r => G.DECLINE_REASON_KEYS.includes(r.decline_reason)),
     await q(`SELECT DISTINCT decline_reason FROM grants WHERE org_id=$1 AND status='declined'`, [ORG]));
  // A DECLINE WITH NO READABLE REASON DOES NOT CLAIM THE FUNDER GAVE NONE.
  const noReason = await api("POST", "/grants/import", tok, {
    headers: ["Funder", "Program", "Amount Requested", "Status"],
    rows: [["Nightingale Trust", "Declined with no reason", "$1,500.00", "Declined"]],
  });
  const nr = (await q(`SELECT decline_reason, notes FROM grants WHERE org_id=$1 AND program=$2`,
    [ORG, "Declined with no reason"]))[0];
  ok("§7 it is filed as 'something else' with the note saying the FILE did not carry one",
     noReason.body.counts.declineReasonMissing === 1 && nr.decline_reason === "other"
     && /did not carry a decline reason/.test(nr.notes || ""), nr);
  // A FUND OR AN OFFICER THE FILE NAMES IS MATCHED, NEVER CREATED.
  ok("§7 a fund the org has is matched by name",
     (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1 AND fund_id='f_youth6'`, [ORG]))[0].c === 10,
     await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1 AND fund_id='f_youth6'`, [ORG]));
  ok("§7 …and no fund was created", (await q(`SELECT COUNT(*)::int AS c FROM fin_funds WHERE org_id=$1`, [ORG]))[0].c >= 1
     && !(await q(`SELECT 1 FROM fin_funds WHERE org_id=$1 AND name='Youth programme' AND id<>'f_youth6'`, [ORG])).length);
  const unmatchedFund = await api("POST", "/grants/import", tok, {
    headers: ["Funder", "Program", "Amount Requested", "Status", "Fund"],
    rows: [["Orchard Foundation", "A fund nobody has", "$1,000.00", "Submitted", "Imaginary fund"]],
  });
  ok("§7 a fund the org does NOT have is carried into the notes, not created",
     unmatchedFund.status === 201
     && /not on the chart of accounts/.test((await q(
       `SELECT notes FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "A fund nobody has"]))[0].notes || "")
     && !(await q(`SELECT 1 FROM fin_funds WHERE org_id=$1 AND name='Imaginary fund'`, [ORG])).length,
     await q(`SELECT notes FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "A fund nobody has"]));

  // ── §8 · THE FOUR VENDOR PRESETS ────────────────────────────────────────
  console.log("\n— §8 · each source's own words —");
  const vendors = [
    ["npsp", ["Opportunity Name", "Opportunity Stage", "Account Name", "Amount", "Close Date"],
     [["Youth studio", "Closed Won", "Sunrise Foundation", "$9,000.00", plusDays(-5)],
      ["Capital ask", "Closed Lost", "Sunrise Foundation", "$9,000.00", plusDays(-5)],
      ["Next year", "Prospecting", "Sunrise Foundation", "$9,000.00", plusDays(30)]],
     ["awarded", "declined", "researching"]],
    ["bloomerang", ["Transaction ID", "Constituent", "Designation Fund", "Transaction Status", "Amount", "Purpose"],
     [["BL-1", "Mercer Charitable Fund", "Youth programme", "Approved", "$2,500.00", "Bloomerang award"],
      ["BL-2", "Mercer Charitable Fund", "Youth programme", "Pending", "$2,500.00", "Bloomerang pending"]],
     ["awarded", "submitted"]],
    ["instrumentl", ["Funder", "Grantmaker", "Next Deadline", "Award Status", "Amount Requested", "Program"],
     [["Delta Regional Foundation", "Delta Regional Foundation", plusDays(45), "Tracking", "$7,000.00", "Instrumentl tracked"],
      ["Delta Regional Foundation", "Delta Regional Foundation", plusDays(45), "LOI Submitted", "$7,000.00", "Instrumentl loi"]],
     ["researching", "loi"]],
    ["submittable", ["Submission ID", "Form Name", "Submission Status", "Amount Requested", "Funder", "Project"],
     [["SB-1", "Youth form", "In Review", "$4,500.00", "Beacon Hill Fund", "Submittable review"],
      ["SB-2", "Youth form", "Declined", "$4,500.00", "Beacon Hill Fund", "Submittable declined"]],
     ["submitted", "declined"]],
  ];
  for (const [key, vh, vr, wantStatuses] of vendors) {
    const det = I.detectGrantSource(vh);
    ok(`§8 ${key} is detected from its own columns`, det.source === key, det);
    const r = await api("POST", "/grants/import", tok, { headers: vh, rows: vr });
    ok(`§8 …and its rows import`, r.status === 201 && r.body.counts.grants === vr.length,
       [r.status, r.body.counts, r.body.refused]);
    ok(`§8 …its status words read as Steward's`,
       r.body.grants.map(g => g.status).join(",") === wantStatuses.join(","),
       r.body.grants.map(g => [g.program, g.status]));
    ok(`§8 …every status it produced is one of the six`,
       r.body.grants.every(g => G.STATUS_KEYS.includes(g.status)), r.body.grants.map(g => g.status));
  }
  // NPSP's Closed Won is an award and NEVER a proposal; Closed Lost is a decline
  // with no reason in the file, which is the `other` bucket plus the note.
  ok("§8 NPSP's Closed Won carries the amount as the AWARD",
     Math.round(Number((await q(
       `SELECT amount_awarded FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "Youth studio"]))[0].amount_awarded) * 100)
       === cents(9000),
     await q(`SELECT amount_awarded FROM grants WHERE org_id=$1 AND program=$2`, [ORG, "Youth studio"]));
  ok("§8 the source list says how confident Steward is in each",
     I.GRANT_SOURCES.every(s => ["documented", "reported", "unconfirmed"].includes(s.confidence))
     && I.GRANT_SOURCES.some(s => s.confidence === "unconfirmed"),
     I.GRANT_SOURCES.map(s => [s.key, s.confidence]));
  const srcRoute = await api("GET", "/grants/import/sources", tok, null);
  ok("§8 …and the product says it out loud", srcRoute.status === 200
     && (srcRoute.body.sources || []).length === I.GRANT_SOURCES.length, srcRoute.status);

  // ── §9 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §9 · org A's file lands nothing in org B —");
  ok("§9 org B has no grants", (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1`, [OTHER]))[0].c === 0);
  ok("§9 …and no donors", (await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1`, [OTHER]))[0].c === 0);
  // The same file in org B creates ITS OWN funders — an EIN is unique within an
  // organisation's own records, never across tenants.
  const bImport = await api("POST", "/grants/import", tok2, {
    headers: ["Funder", "EIN", "Program", "Amount Requested", "Status"],
    rows: [["The Sunrise Foundation", einFor(0), "Their own ask", "$1,000.00", "Submitted"]],
  });
  ok("§9 org B importing the same funder creates its OWN record",
     bImport.status === 201 && bImport.body.counts.created === 1, bImport.body.counts);
  ok("§9 …and org A's funder is untouched",
     (await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1 AND funder_ein=$2`,
       [ORG, I.normalizeEin(einFor(0))]))[0].c === 1);
  ok("§9 …and org A's grant count did not move",
     (await q(`SELECT COUNT(*)::int AS c FROM grants WHERE org_id=$1 AND program='Their own ask'`, [ORG]))[0].c === 0);
  const noPlan = await api("POST", "/grants/import", tok, { headers: ["Wobble"], rows: [["x"]] });
  ok("§9 a file with no funder column is refused with the fix named",
     noPlan.status === 400 && noPlan.body.code === "no_funder_column", noPlan.body);

  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();
