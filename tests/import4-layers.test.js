// tests/import4-layers.test.js: IMPORT-4. A LAYERED IMPORT THAT UNDERSTANDS THE
// FILE AND PUTS EVERYTHING ON THE PROFILE. The build's one new test.
//
// 26 Oct: a real nonprofit's event workbook went through the preview and the
// button offered "Import 443 donors + 0 gifts". Every gift was refused as an
// "unreadable date" (the dates were blank), and Invited, RSVP, Attended, Table
// and Mailing list all defaulted to "Don't import". Fixtures are fake
// (tests/fixtures/import/import4/make.cjs writes them and computes each answer
// key from its own rows, never from the reader).
//
// import4-combined · Finding_Joy_Combined.xlsx into an org that already holds
//   three of its people (matched by ID, email and name):
//   §1  the preview: every column mapped, kept or skipped with a reason; the
//       button says what will exist and never "0 gifts"; the totals row is
//       checked; the placeholder phone is flagged.
//   §2  all 106 gifts land on their people, each flagged No date, $124,290.
//   §3  Lifetime and the event total count them; This year does not, and
//       the profile says so.
//   §4  the event is created with its name; 400 invited, 172 attended.
//   §5  4 opt-outs and 1 do not contact, each with where it came from.
//   §6  8 pledges open with their balances ($78,950), on the profile.
//   §7  the placeholder phone is on nobody; kept columns are custom fields;
//       ZIPs that lost a zero have it back; the three people already here
//       were matched, never duplicated.
//   §8  NUMBERS-1's checker passes; a second import adds nothing.
//   §9  "Use the event date" dates all 106 in one call, and This year counts them.
//   §10 Undo restores the org exactly, the three matched people as they were.
//
// import4-either-order · the guest list and the gift sheet for one event, in
//   either order, make the same people, one event, no duplicates.
//
// import4-every-fixture · every fixture in import4/ into its own empty org:
//   no money lost (gifts + promised + set aside = the file's money), every
//   column accounted for, no duplicate people, the checker passes after import,
//   and undo leaves the org exactly as it was. Prints the report table.
//
// import4-comma-couples (IMPORT-5) · "Alex, Brad Hollins" in a file is two
//   people, one household; a record already here is proposed in Data health,
//   fixed on her click, undone exactly.
//
// HOW IT WOULD GO RED (run against main): "Alex, Brad Hollins" reads as "Brad
// Hollins Alex" and there is no couples line in Data health; the combined workbook imports 0 gifts
// (blank dates were refused), no event or attendance, no opt-outs, and the
// columns are questions; with the ID link removed, gifts land on new people;
// with the placeholder rule removed, 30 people get the org's own phone; with
// the undo additions removed, attendance and opt-outs survive an undo.
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
// IMPORT-5: the answers a person gives an event file with no dates: the event's
// day, its gifts left "No date", its pledges due from the event's date
const IMPORT5_DATES = { eventDate: "2026-10-22", useEventDate: false, pledgeDue: "event" };
const { assertSurfacesAgree } = require("./lib/surfacesAgree");   // HARDEN-1
async function surfacesAgree(label, orgId, token) {
  const r = await assertSurfacesAgree(orgId, { token, soft: true, label });
  ok(`every surface agrees ${label} (${r.ms}ms)`, r.ok, r.diffs.length);
  for (const d of r.diffs) console.log("        " + d);
}


const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import");
const FX4 = path.join(FX, "import4");
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FX4, "expected.json"), "utf8"));
const PASSWORD = "loadtest1234";
// every org-child table an import can touch, children first
const TABLES = ["event_attendees", "email_suppressions", "pledge_installments", "pledges", "thank_you_drafts", "interactions", "gifts", "events",
  "fin_transactions", "imports", "donor_scores", "readouts", "tasks", "cultivation_plans", "name_fixes", "donors", "households", "custom_field_defs",
  "fin_funds", "budgets", "accounts", "users"];
const { checkOrg } = require("../scripts/check-numbers");
const NUM = require("../numbers");

let R = null;
async function sheetsOf(file) {
  R = R || await import("../shared/sheetRead.js");
  const buf = fs.readFileSync(file);
  if (/\.(csv|tsv|txt)$/i.test(file)) return [{ name: "Sheet1", grid: R.gridFromText(buf.toString("utf8")) }];
  return R.gridsFromWorkbook(XLSX.read(buf, { type: "buffer", cellDates: true }), XLSX);
}
async function freshOrg(id, name) {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`,
    [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`,
    ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
const centsOf = v => Math.round(Number(v || 0) * 100);
// The org as rows: every table an import touches, each row's own columns minus
// the clocks a recompute is allowed to move. Undo must give this back exactly.
const SNAP_SKIP = new Set(["updated_at", "last_scored_at", "score_updated_at", "engagement_updated_at"]);
async function snapshot(org) {
  const out = {};
  for (const t of TABLES) {
    const rows = await q(`SELECT * FROM ${t} WHERE org_id=$1 ORDER BY id`, [org]).catch(() => []);
    // The org's unrestricted fund and its chart of accounts are made the first
    // time any gift is recorded (recordGift's orgUnrestrictedFundId and
    // ensureOrgLedger): setup every org has, never import data, so they stay.
    if (t === "accounts") { out[t] = []; continue; }
    out[t] = rows.filter(r => !(t === "fin_funds" && r.description === "General unrestricted operating fund"))
      .map(r => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !SNAP_SKIP.has(k)).sort())));
  }
  return out;
}
// Per row, by id: which rows are gone, which are new, and which columns moved.
function snapDiff(a, b) {
  const diffs = [];
  for (const t of Object.keys(a)) {
    const byId = list => new Map(list.map(x => { const o = JSON.parse(x); return [o.id, o]; }));
    const A = byId(a[t]), B = byId(b[t]);
    const gone = [...A.keys()].filter(k => !B.has(k)), extra = [...B.keys()].filter(k => !A.has(k));
    const moved = [...A.keys()].filter(k => B.has(k)).map(k => [k, Object.keys(A.get(k)).filter(c => JSON.stringify(A.get(k)[c]) !== JSON.stringify(B.get(k)[c]))]).filter(([, cs]) => cs.length);
    if (gone.length || extra.length || moved.length) diffs.push(`${t}: ${gone.length} gone, ${extra.length} new${extra.length ? " (" + JSON.stringify(B.get(extra[0])).slice(0, 160) + ")" : ""}`
      + (moved.length ? `, changed ${moved.map(([k, cs]) => `${k}[${cs.map(c => `${c}: ${JSON.stringify(A.get(k)[c])} → ${JSON.stringify(B.get(k)[c])}`).join(", ")}]`).join(" ").slice(0, 600)}` : ""));
  }
  return diffs;
}
async function numbersCheck(org) {
  const r = await checkOrg(org, { screens: NUM.screens });
  return r.problems || [];
}

// ── import4-combined ──────────────────────────────────────────────────────
async function combined() {
  const ORG = "org_import4c";
  const E = EXPECTED["Finding_Joy_Combined.xlsx"];
  const tok = await freshOrg(ORG, "Justin's Place (test)");
  // three of the file's people are already here: by ID, by email, by name
  await q(`INSERT INTO donors (id,org_id,name,email,phone,external_donor_id,stage,status,tags,person_types,created_by,created_by_name) VALUES
           ('d_imp4_byid',$1,'Elliot Thackeray',NULL,'(555) 999-0001','JP-1013','prospect','active','["Gala 2025"]','["donor"]','system:test','test'),
           ('d_imp4_bymail',$1,'Marisol T. Sorensen','marisol.sorensen22@example.org',NULL,NULL,'prospect','active','[]','["volunteer"]','system:test','test'),
           ('d_imp4_byname',$1,'Odette Valdivia',NULL,NULL,NULL,'prospect','active','[]','["other"]','system:test','test')`, [ORG]);
  const sheets = await sheetsOf(path.join(FX4, "Finding_Joy_Combined.xlsx"));
  // who those three are in the file (computed from the file, not the reader)
  const peopleRows = XLSX.utils.sheet_to_json(XLSX.readFile(path.join(FX4, "Finding_Joy_Combined.xlsx")).Sheets.People, { header: 1, defval: null }).slice(3);
  const row = id => peopleRows.find(r => r[0] === id);
  ok("§0 the fixture's matched people are who this suite says", row("JP-1013") && row("JP-1022")[3] === "marisol.sorensen22@example.org"
     && peopleRows.some(r => `${r[1]} ${r[2]}` === "Odette Valdivia" && !r[3]), JSON.stringify([row("JP-1013"), row("JP-1022")]));
  const before = await snapshot(ORG);
  // IMPORT-5: an event's date is asked, never invented; the first preview asks it
  const asked = await api("POST", "/sheet-import/understand", tok, { fileName: "Finding_Joy_Combined.xlsx", sheets });
  const askedQ = ((asked.body || {}).questions || []);
  ok("§1 with no date in the file, the event's date is a required question and Import waits", (asked.body || {}).ready === false
     && askedQ.some(x => x.id === "event" && x.required && !x.optional) && askedQ.some(x => x.id === "pledgeDue"), JSON.stringify(askedQ.map(x => [x.id, x.optional])));
  const body = { fileName: "Finding_Joy_Combined.xlsx", sheets, answers: IMPORT5_DATES };

  // §1 the preview
  const t0 = performance.now();
  const u = await api("POST", "/sheet-import/understand", tok, body);
  const previewMs = Math.round(performance.now() - t0);
  const U = u.body || {};
  ok("§1 understand answers 200 and is ready with no blocking question", u.status === 200 && U.ready === true,
     u.status + " " + JSON.stringify((U.questions || []).filter(x => !x.optional)).slice(0, 300));
  const acct = U.columnAccount || {};
  ok(`§1 every column is accounted for: ${E.columns.total} = ${E.columns.mapped} mapped + ${E.columns.kept} kept + ${E.columns.skipped} skipped`,
     acct.total === E.columns.total && acct.mapped === E.columns.mapped && acct.kept === E.columns.kept && acct.skipped === E.columns.skipped && !acct.question,
     JSON.stringify(acct));
  const cols = U.columns || [];
  ok("§1 no column with data is skipped without a reason", cols.every(c => c.disposition !== "skipped" || (c.reason && c.reason.length > 8)), JSON.stringify(cols.filter(c => c.disposition === "skipped")));
  const byHdr = h => cols.find(c => c.header === h && c.sheet === "People") || {};
  ok("§1 Invited, RSVP, Attended, Table and Mailing List are mapped, never left out",
     ["Invited", "RSVP", "Attended", "Table", "Mailing List", "Party Size", "Do Not Contact", "Volunteer"].every(h => byHdr(h) && byHdr(h).disposition === "mapped"),
     JSON.stringify(["Invited", "RSVP", "Attended", "Table", "Mailing List"].map(byHdr)));
  ok("§1 \"Gave at dinner\" is skipped as a total of the Gifts sheet, after it foots", byHdr("Gave at dinner").disposition === "skipped" && /total/.test(byHdr("Gave at dinner").reason) && /agree/.test(byHdr("Gave at dinner").reason),
     JSON.stringify(byHdr("Gave at dinner")));
  ok("§1 Shirt Size and Dietary are kept under their own names", E.kept.every(h => byHdr(h).disposition === "kept"), JSON.stringify(E.kept.map(byHdr)));
  ok("§1 the Gifts sheet's ID links each gift to its person", (cols.find(c => c.sheet === "Gifts" && c.header === "ID") || {}).links === true);
  const btn = (U.button || {}).text || "";
  ok("§1 the button says what will exist afterwards", btn === "Import 450 people (104 donors, 26 volunteers) · 106 gifts $124,290 (106 undated) · 8 pledges $53,950 due this year · $78,950 over 3 years · Finding Joy Dinner: 172 attended · 4 opt-outs · 1 do not contact · 3 already in Steward", btn);
  ok("§1 the button never offers 0 gifts", !/\b0 gifts\b/.test(btn));
  ok("§1 the totals row is checked and explained", /Your total row says \$178,240.*106 gifts \(\$124,290\), \$53,950 promised and not yet received/.test((U.totalsSentence || [])[0] || ""), JSON.stringify(U.totalsSentence));
  ok("§1 the shared phone is flagged as a placeholder on 30 people", (U.placeholders || []).some(p => p.kind === "phone" && p.people === E.placeholderPeople), JSON.stringify(U.placeholders));
  ok("§1 the event is named from the title row; once dated, nothing about dates blocks", U.event && U.event.name === E.eventName
     && (U.questions || []).filter(x => ["date", "event", "eventGifts", "pledgeDue"].includes(x.id)).every(x => x.optional), JSON.stringify([U.event, (U.questions || []).map(x => [x.id, x.optional])]));
  ok("§1 the sample person shows the most layers", U.sample && U.sample.roles.includes("donor") && U.sample.attendance && U.sample.attendance.attended, String(JSON.stringify(U.sample)).slice(0, 300));
  ok("§1 understand wrote nothing", (await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [ORG])).n === 0);

  // §2 the commit
  const RUN = "imp_import4c_one";
  const c1 = await api("POST", "/sheet-import/commit", tok, { ...body, importId: RUN });
  ok("§2 commit answers 201", c1.status === 201, c1.status + " " + JSON.stringify(c1.body).slice(0, 400));
  await surfacesAgree("after the import", ORG, tok);
  const g = await one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE date IS NULL)::int AS undated, COALESCE(SUM(amount),0)::numeric AS s,
                              COUNT(DISTINCT donor_id)::int AS donors FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§2 all 106 gifts land, every one undated, $124,290", g.n === E.gifts && g.undated === E.undatedGifts && centsOf(g.s) === E.giftCents, JSON.stringify(g));
  ok("§2 on 104 donors", g.donors === E.donors, g.donors);
  // each gift is on the person its ID names
  const wrong = await q(`SELECT g.id FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND (d.external_donor_id IS NULL OR d.external_donor_id NOT LIKE 'JP-%')`, [ORG]);
  ok("§2 every gift is on the person its ID names, misspellings and swapped names included", wrong.length === 0, wrong.length);
  const sample = await one("SELECT id FROM donors WHERE org_id=$1 AND external_donor_id=$2", [ORG, E.sample.id]);
  const prof = await api("GET", `/donors/${sample && sample.id}`, tok);
  const pg = (prof.body && prof.body.gifts) || [];
  ok("§2 the gift is on the profile, with no date", prof.status === 200 && pg.length === 1 && pg[0].date == null && centsOf(pg[0].amount) === E.sample.gaveCents, JSON.stringify(pg.map(x => [x.amount, x.date])));

  // §3 what counts
  const f = (prof.body && prof.body.figures) || {};
  ok("§3 Lifetime counts the undated gift", f.lifetime && f.lifetime.cents === E.sample.gaveCents, JSON.stringify(f.lifetime));
  ok("§3 This year does not", !f.thisYear || !f.thisYear.cents, JSON.stringify(f.thisYear));
  ok("§3 and the profile says why", JSON.stringify(prof.body).includes("no date not counted"), JSON.stringify(f.thisYear));
  const ev = await q("SELECT * FROM events WHERE org_id=$1", [ORG]);
  ok("§4 the event is created once, by its name, on the day she gave (IMPORT-5)", ev.length === 1 && ev[0].name === E.eventName && ev[0].date_unknown === false && JSON.stringify(ev[0].date).startsWith("\"2026-10-2"), JSON.stringify(ev));
  const evId = ev[0] && ev[0].id;
  const evg = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1 AND event_id=$2", [ORG, evId]);
  ok("§3 the event total counts every undated gift", evg.n === E.gifts && centsOf(evg.s) === E.giftCents, JSON.stringify(evg));
  const evApi = await api("GET", `/events/${evId}`, tok);
  ok("§4 the event page answers", evApi.status === 200, evApi.status);
  const att = await one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status='attended')::int AS attended,
                                COUNT(*) FILTER (WHERE status IN ('attended','registered'))::int AS rsvp FROM event_attendees WHERE org_id=$1 AND event_id=$2`, [ORG, evId]);
  ok(`§4 ${E.invited} invited, ${E.rsvp} RSVP'd, ${E.attended} attended`, att.n === E.invited && att.attended === E.attended && att.rsvp === E.rsvp, JSON.stringify(att));
  const tbl = await one(`SELECT a.table_label, a.quantity FROM event_attendees a JOIN donors d ON d.id=a.donor_id WHERE a.org_id=$1 AND d.external_donor_id=$2`, [ORG, E.sample.id]);
  ok("§4 the table and party size are on the attendance", tbl && tbl.table_label === E.sample.table && tbl.quantity === 3, JSON.stringify(tbl));
  const contacts = await one(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id=$1 AND d.person_types = '["other"]'::jsonb
                                AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id) AND NOT EXISTS (SELECT 1 FROM pledges p WHERE p.donor_id=d.id)
                                AND d.created_import_id=$2`, [ORG, RUN]);
  const notDonor = await one(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id=$1 AND d.person_types @> '["donor"]'::jsonb
                                AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id) AND NOT EXISTS (SELECT 1 FROM pledges p WHERE p.donor_id=d.id) AND d.created_import_id=$2`, [ORG, RUN]);
  ok("§4 someone who came and never gave is a contact, not a donor", contacts.n > 250 && notDonor.n === 0, JSON.stringify({ contacts, notDonor }));

  // §5 communication choices
  const comm = await one(`SELECT COUNT(*) FILTER (WHERE do_not_email)::int AS dne, COUNT(*) FILTER (WHERE do_not_contact)::int AS dnc FROM donors WHERE org_id=$1`, [ORG]);
  const sup = await one("SELECT COUNT(*)::int AS n FROM email_suppressions WHERE org_id=$1", [ORG]);
  ok(`§5 ${E.optOuts} opt-outs, each in the suppression list; ${E.doNotContact} do not contact`, comm.dne === E.optOuts && sup.n === E.optOuts && comm.dnc === E.doNotContact, JSON.stringify({ comm, sup }));
  const why = await q(`SELECT note FROM interactions WHERE org_id=$1 AND import_id=$2 AND note LIKE 'Opted out of email%'`, [ORG, RUN]);
  ok("§5 each opt-out says where it came from", why.length === E.optOuts && why.every(w => /Finding_Joy_Combined\.xlsx/.test(w.note) && /Mailing List/.test(w.note)) && why.some(w => /please remove/.test(w.note)),
     JSON.stringify(why.map(w => w.note)));

  // §6 pledges
  const pl = await api("GET", `/donors/${(await one("SELECT id FROM donors WHERE org_id=$1 AND external_donor_id=$2", [ORG, E.pledgeSample.id])).id}/pledges`, tok);
  const p0 = (pl.body || [])[0] || {};
  ok("§6 the three-year pledge: $15,000, $5,000 received, $10,000 to go", pl.status === 200 && centsOf(p0.amount) === E.pledgeSample.totalCents
     && centsOf(p0.paid_amount) === E.pledgeSample.receivedCents && centsOf(p0.balance) === E.pledgeSample.openCents, JSON.stringify(p0).slice(0, 300));
  const openAll = await one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(GREATEST(p.amount - COALESCE(pp.paid,0),0)),0)::numeric AS open
                               FROM pledges p LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id=$1 AND pledge_id IS NOT NULL GROUP BY pledge_id) pp ON pp.pledge_id=p.id
                              WHERE p.org_id=$1`, [ORG]);
  ok(`§6 ${E.pledges} pledges, $78,950 open`, openAll.n === E.pledges && centsOf(openAll.open) === E.pledgeOpenCents, JSON.stringify(openAll));

  // §7 the details that are easy to get wrong
  const ph = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND regexp_replace(COALESCE(phone,''),'\\D','','g') = '5550100000'", [ORG]);
  ok("§7 the placeholder phone is on nobody", ph.n === 0, ph.n);
  const cf = await q("SELECT key, label FROM custom_field_defs WHERE org_id=$1 ORDER BY label", [ORG]);
  const shirt = cf.find(x => x.label === "Shirt Size");
  const sp = await one("SELECT custom_fields FROM donors WHERE org_id=$1 AND external_donor_id=$2", [ORG, E.sample.id]);
  ok("§7 kept columns are custom fields under their own headers, filled on the person", cf.map(x => x.label).join() === "Dietary,Shirt Size" && shirt && sp.custom_fields && sp.custom_fields[shirt.key] === "L",
     JSON.stringify({ cf, sp }));
  const zips = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND zip = '02134'", [ORG]);
  ok(`§7 ${E.zipsFixed} ZIPs that lost their leading zero have it back`, zips.n === E.zipsFixed, zips.n);
  const people = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1", [ORG]);
  ok(`§7 ${E.persons} people in all: the three already here were matched, never duplicated`, people.n === E.persons, people.n);
  const byid = await one("SELECT name, phone, email, tags, person_types FROM donors WHERE id='d_imp4_byid'");
  ok("§7 a person already here keeps what they had and gains what was missing", byid.phone === "(555) 999-0001" && byid.email === row("JP-1013")[3] && /Gala 2025/.test(byid.tags),
     JSON.stringify(byid));
  const vols = await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND person_types @> '["volunteer"]'::jsonb AND id <> 'd_imp4_bymail'`, [ORG]);
  ok(`§7 ${E.volunteers} volunteers`, vols.n === E.volunteers - (row("JP-1022")[16] ? 1 : 0), vols.n);

  // §8 numbers, and again
  const probs = await numbersCheck(ORG);
  ok("§8 NUMBERS-1's checker passes after the import", probs.length === 0, JSON.stringify(probs).slice(0, 600));
  const c2 = await api("POST", "/sheet-import/commit", tok, { ...body, importId: "imp_import4c_two" });
  const again = await one(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS g, (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS d,
                                  (SELECT COUNT(*) FROM event_attendees WHERE org_id=$1)::int AS a, (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS p,
                                  (SELECT COUNT(*) FROM events WHERE org_id=$1)::int AS e`, [ORG]);
  ok("§8 a second import adds nothing", c2.status === 201 && c2.body.giftsCreated === 0 && c2.body.donorsCreated === 0 && again.g === E.gifts
     && again.d === E.persons && again.a === E.invited && again.p === E.pledges && again.e === 1, JSON.stringify({ s: c2.status, again, b: c2.body && c2.body.sentence }));
  await api("POST", "/imports/imp_import4c_two/reverse", tok, {});
  await surfacesAgree("after a second import and its undo", ORG, tok);

  // §9 the event date, in one click
  const d1 = await api("POST", `/imports/${RUN}/date-undated`, tok, { date: "2026-10-22" });
  const g9 = await one("SELECT COUNT(*) FILTER (WHERE date='2026-10-22')::int AS n, COUNT(*) FILTER (WHERE date IS NULL)::int AS undated FROM gifts WHERE org_id=$1", [ORG]);
  ok("§9 \"Use the event date\" dates all 106 in one call", d1.status === 200 && d1.body.dated === E.gifts && g9.n === E.gifts && g9.undated === 0, JSON.stringify({ s: d1.status, b: d1.body, g9 }));
  const prof9 = await api("GET", `/donors/${sample.id}`, tok);
  ok("§9 and This year then counts them", prof9.body.figures.thisYear && prof9.body.figures.thisYear.cents === E.sample.gaveCents, JSON.stringify(prof9.body.figures.thisYear));
  ok("§9 the event has its date now", (await one("SELECT date::text AS d FROM events WHERE id=$1", [evId])).d === "2026-10-22");
  const probs9 = await numbersCheck(ORG);
  ok("§9 the checker still passes", probs9.length === 0, JSON.stringify(probs9).slice(0, 600));

  // §10 undo
  const un = await api("POST", `/imports/${RUN}/reverse`, tok, {});
  ok("§10 undo answers 200", un.status === 200, un.status + " " + JSON.stringify(un.body));
  const after = await snapshot(ORG);
  for (const t of ["imports"]) { before[t] = []; after[t] = []; }   // the run's own record stays, marked undone
  const diff = snapDiff(before, after);
  ok("§10 undo restores the org exactly, the three matched people as they were", diff.length === 0, diff.join("\n"));
  await surfacesAgree("after the undo", ORG, tok);
  return { file: "Finding_Joy_Combined.xlsx", previewMs };
}

// ── import4-either-order ──────────────────────────────────────────────────
async function eitherOrder() {
  const gifts = { fileName: "Finding Joy Dinner Gifts.xlsx", sheets: await sheetsOf(path.join(FX, "event-gifts-sheet-scrubbed.xlsx")),
                  answers: { ...IMPORT5_DATES, eventName: "Finding Joy Dinner", linkEvent: true, rows: { "Sheet1:26": "gift" } } };
  const guests = { fileName: "Finding Joy Dinner Guest List.xlsx", sheets: await sheetsOf(path.join(FX, "event-guest-list-scrubbed.xlsx")),
                   answers: { ...IMPORT5_DATES, eventName: "Finding Joy Dinner" } };
  const E = EXPECTED["event-guest-list-scrubbed.xlsx"];
  const out = {};
  for (const [tag, order] of [["a", [gifts, guests]], ["b", [guests, gifts]]]) {
    const ORG = `org_import4o${tag}`;
    const tok = await freshOrg(ORG, "Order " + tag);
    for (const [i, b] of order.entries()) {
      const c = await api("POST", "/sheet-import/commit", tok, { ...b, importId: `imp_import4o${tag}_${i}` });
      ok(`either order (${tag}) step ${i + 1} commits`, c.status === 201, c.status + " " + JSON.stringify(c.body).slice(0, 300));
    }
    out[tag] = await one(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS people,
                                 (SELECT COUNT(DISTINCT LOWER(name)) FROM donors WHERE org_id=$1)::int AS names,
                                 (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS gifts,
                                 (SELECT COALESCE(SUM(amount),0) FROM gifts WHERE org_id=$1)::numeric AS cents,
                                 (SELECT COUNT(*) FROM events WHERE org_id=$1)::int AS events,
                                 (SELECT COUNT(*) FROM event_attendees WHERE org_id=$1 AND status='attended')::int AS attended,
                                 (SELECT COUNT(*) FROM gifts g WHERE g.org_id=$1 AND g.event_id IS NOT NULL)::int AS linked`, [ORG]);
    ok(`either order (${tag}): ${E.persons} people, none twice, one event`, out[tag].people === E.persons && out[tag].names === E.persons && out[tag].events === 1,
       JSON.stringify(out[tag]));
    const probs = await numbersCheck(ORG);
    ok(`either order (${tag}): the checker passes`, probs.length === 0, JSON.stringify(probs).slice(0, 400));
  }
  ok("either order: the same people, gifts, attendance and links", JSON.stringify(out.a) === JSON.stringify(out.b), JSON.stringify(out));
}

// ── import4-every-fixture ─────────────────────────────────────────────────
async function everyFixture(rows) {
  let i = 0;
  for (const [file, e] of Object.entries(EXPECTED)) {
    i++;
    const ORG = `org_import4f_${String(i).padStart(2, "0")}`;
    const tok = await freshOrg(ORG, "Fixture " + file);
    const full = file.startsWith("event-") ? path.join(FX, file) : path.join(FX4, file);
    const body = { fileName: file, sheets: await sheetsOf(full), answers: { ...IMPORT5_DATES, ...(e.answers || {}) } };
    const before = await snapshot(ORG);
    const t0 = performance.now();
    const u = await api("POST", "/sheet-import/understand", tok, body);
    const ms = Math.round(performance.now() - t0);
    const U = u.body || {};
    const c = await api("POST", "/sheet-import/commit", tok, { ...body, importId: `imp_import4f_${i}` });
    const db = await one(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS people,
        (SELECT COUNT(*) FROM (SELECT 1 FROM donors WHERE org_id=$1 GROUP BY LOWER(name), COALESCE(LOWER(email),'')) x)::int AS distinct_people,
        (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND person_types @> '["volunteer"]'::jsonb)::int AS volunteers,
        (SELECT COUNT(DISTINCT donor_id) FROM gifts WHERE org_id=$1)::int AS donors,
        (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS gifts,
        (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND date IS NULL)::int AS undated,
        (SELECT COALESCE(ROUND(SUM(amount)*100),0) FROM gifts WHERE org_id=$1)::bigint AS gift_cents,
        (SELECT COALESCE(ROUND(SUM(amount)*100),0) FROM gifts WHERE org_id=$1 AND date IS NULL)::bigint AS undated_cents,
        (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS pledges,
        (SELECT COALESCE(ROUND(SUM(i.amount)*100),0) FROM pledge_installments i JOIN pledges p ON p.id=i.pledge_id WHERE p.org_id=$1 AND i.seq=1 AND i.paid_gift_id IS NULL)::bigint AS promised_cents,
        (SELECT COALESCE(ROUND(SUM(p.amount - COALESCE((SELECT SUM(g.amount) FROM gifts g WHERE g.pledge_id=p.id),0))*100),0) FROM pledges p WHERE p.org_id=$1)::bigint AS open_cents,
        (SELECT COUNT(*) FROM events WHERE org_id=$1)::int AS events,
        (SELECT COUNT(*) FROM event_attendees WHERE org_id=$1 AND status='attended')::int AS attended,
        (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND do_not_email)::int AS opt_outs`, [ORG]);
    const asideCents = (U.aside || []).reduce((a, x) => a + (x.cents || 0), 0);
    const money = Number(db.gift_cents) + Number(db.promised_cents) + asideCents;
    const acct = U.columnAccount || {};
    const probs = c.status === 201 ? await numbersCheck(ORG) : [{ rule: "commit", examples: [c.status] }];
    const un = await api("POST", `/imports/imp_import4f_${i}/reverse`, tok, {});
    const after = await snapshot(ORG);
    before.imports = []; after.imports = [];
    const diff = snapDiff(before, after);
    const fails = [];
    if (c.status !== 201) fails.push(`commit ${c.status}`);
    if (e.fileCents != null && money !== e.fileCents) fails.push(`money ${money} vs the file's ${e.fileCents}`);
    if (e.totalsRowCents != null && (U.totals || []).filter(t => !t.subtotal).some(t => t.statedCents !== e.totalsRowCents)) fails.push("totals row");
    if (e.persons != null && db.people !== e.persons) fails.push(`people ${db.people} vs ${e.persons}`);
    if (db.distinct_people !== db.people) fails.push(`${db.people - db.distinct_people} duplicate people`);
    if (e.gifts != null && db.gifts !== e.gifts) fails.push(`gifts ${db.gifts} vs ${e.gifts}`);
    if (e.giftCents != null && Number(db.gift_cents) !== e.giftCents) fails.push(`gift cents ${db.gift_cents} vs ${e.giftCents}`);
    if (e.undatedGifts != null && db.undated !== e.undatedGifts) fails.push(`undated ${db.undated} vs ${e.undatedGifts}`);
    if (e.volunteers != null && db.volunteers !== e.volunteers) fails.push(`volunteers ${db.volunteers} vs ${e.volunteers}`);
    if (e.optOuts != null && db.opt_outs !== e.optOuts) fails.push(`opt-outs ${db.opt_outs} vs ${e.optOuts}`);
    if (e.attended != null && db.attended !== e.attended) fails.push(`attended ${db.attended} vs ${e.attended}`);
    if (e.columns && !(acct.total === e.columns.total && acct.mapped === e.columns.mapped && acct.kept === e.columns.kept && acct.skipped === e.columns.skipped))
      fails.push(`columns ${JSON.stringify(acct)} vs ${JSON.stringify(e.columns)}`);
    if (e.placeholderEmail && (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND LOWER(email)=$2", [ORG, e.placeholderEmail])).n) fails.push("placeholder email copied");
    if (probs.length) fails.push("checker: " + JSON.stringify(probs).slice(0, 200));
    if (un.status !== 200) fails.push(`undo ${un.status}`);
    if (diff.length) fails.push("undo left: " + diff.join("; ").slice(0, 300));
    ok(`every fixture: ${file}`, fails.length === 0, fails.join(" | "));
    rows.push({ file, people: db.people, donors: db.donors, volunteers: db.volunteers, gifts: db.gifts, giftCents: Number(db.gift_cents),
      undated: db.undated, undatedCents: Number(db.undated_cents), pledges: db.pledges, openCents: Number(db.open_cents), events: db.events,
      attended: db.attended, optOuts: db.opt_outs, aside: (U.aside || []).length, asideReasons: [...new Set((U.aside || []).map(a => a.reason))],
      columns: acct, previewMs: ms, button: (U.button || {}).text });
  }
}

// ── import4-comma-couples (IMPORT-5) ──────────────────────────────────────
// "Alex, Brad Hollins" (Justin's Place's dinner list) is a couple, not "Last,
// First". A file reads it as two people in one household; a record already
// here is only proposed in Data health, fixed on her click, and undone whole.
async function commaCouples() {
  const ORG = "org_import4cc";
  const tok = await freshOrg(ORG, "Comma couples (test)");
  const file = "u03-names-every-way.csv";
  const c = await api("POST", "/sheet-import/commit", tok, { fileName: file, sheets: await sheetsOf(path.join(FX4, file)), importId: "imp_import4cc_1" });
  const hh = await q(`SELECT h.name AS household, ARRAY_AGG(d.name ORDER BY d.name) AS people FROM donors d JOIN households h ON h.id=d.household_id
                       WHERE d.org_id=$1 AND (d.name ~ 'Hollins' OR d.name ~ 'Dunlop') GROUP BY h.name ORDER BY h.name`, [ORG]);
  ok("comma couples: \"Alex, Brad Hollins\" and \"Leslie, Kelly Dunlop\" are two people each, in one household each", c.status === 201
     && JSON.stringify(hh) === JSON.stringify([{ household: "Alex & Brad Hollins", people: ["Alex Hollins", "Brad Hollins"] }, { household: "Leslie & Kelly Dunlop", people: ["Kelly Dunlop", "Leslie Dunlop"] }]),
     JSON.stringify([c.status, hh]));
  // records already here, as the old reading left them, and two that are not couples
  const ORG2 = "org_import4cc2";
  const tok2 = await freshOrg(ORG2, "Comma couples, already here (test)");
  await q(`INSERT INTO donors (id, org_id, name, created_import_id, created_by, created_by_name) VALUES
           ('d_cc_1',$1,'Brad Hollins Alex','imp_old','system:test','Test'), ('d_cc_2',$1,'Leslie, Kelly Dunlop',NULL,'system:test','Test'),
           ('d_cc_3',$1,'Paul James Thomas','imp_old','system:test','Test'), ('d_cc_4',$1,'Brad Hollins Alex',NULL,'system:test','Test')`, [ORG2]);
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, created_by, created_by_name) VALUES ('g_cc_1',$1,'d_cc_1',150,'2026-04-06','system:test','Test')`, [ORG2]);
  // the person's totals as the gift makes them, so the snapshot is the org's true state
  await q(`UPDATE donors SET total_giving=150, gift_count=1, last_gift_amount=150, first_gift_date='2026-04-06', last_gift_date='2026-04-06' WHERE id='d_cc_1'`);
  const before = await snapshot(ORG2);
  const health = (await api("GET", "/data-health", tok2)).body || {};
  const list = (await api("GET", "/data-health/couples", tok2)).body || {};
  ok("comma couples: Data health counts 2 names that look like couples, nothing changed yet", health.counts && health.counts.couples === 2 && (list.rows || []).length === 2
     && /2 names look like couples written with a comma/.test(list.sentence) && snapDiff(before, await snapshot(ORG2)).length === 0, JSON.stringify([health.counts, list]));
  const r1 = (list.rows || []).find(r => r.donorId === "d_cc_1") || {};
  ok("comma couples: before and after are shown", r1.before === "Brad Hollins Alex" && r1.after === "Alex & Brad Hollins" && JSON.stringify(r1.people) === JSON.stringify(["Alex Hollins", "Brad Hollins"]), JSON.stringify(r1));
  const ap = await api("POST", "/data-health/couples/apply", tok2, { donorIds: ["d_cc_1", "d_cc_2", "d_cc_3"] });
  const after = await q(`SELECT d.id, d.name, h.name AS household, (SELECT COUNT(*) FROM gifts g WHERE g.donor_id=d.id)::int AS gifts FROM donors d LEFT JOIN households h ON h.id=d.household_id
                          WHERE d.org_id=$1 AND (d.name ~ 'Hollins' OR d.name ~ 'Dunlop') ORDER BY d.name`, [ORG2]);
  ok("comma couples: Fix makes each two people in one household; the gift stays with the first; the others are untouched", ap.status === 201 && ap.body.applied === 2
     && JSON.stringify(after.map(x => [x.name, x.household, x.gifts])) === JSON.stringify([["Alex Hollins", "Alex & Brad Hollins", 1], ["Brad Hollins", "Alex & Brad Hollins", 0],
       ["Brad Hollins Alex", null, 0], ["Kelly Dunlop", "Leslie & Kelly Dunlop", 0], ["Leslie Dunlop", "Leslie & Kelly Dunlop", 0]])
     && (await one("SELECT name FROM donors WHERE id='d_cc_3'")).name === "Paul James Thomas", JSON.stringify([ap.status, ap.body, after]));
  const un = await api("POST", "/data-health/couples/undo", tok2, { batchId: ap.body.batchId });
  const afterUndo = await snapshot(ORG2);
  delete afterUndo.name_fixes; delete before.name_fixes;   // the fix's own log, kept as history like an import's run
  const d = snapDiff(before, afterUndo);
  ok("comma couples: Undo puts every name back and removes the people and households the fix made", un.status === 200 && d.length === 0, JSON.stringify([un.status, d]));
}

(async () => {
  const rows = [];
  try {
    console.log("import4-combined");
    const c = await combined();
    console.log("import4-either-order");
    await eitherOrder();
    console.log("import4-comma-couples");
    await commaCouples();
    console.log("import4-every-fixture");
    await everyFixture(rows);
    const money = c => "$" + (c / 100).toLocaleString("en-US");
    for (const r of rows) console.log(`   ${r.file}: ${r.people} people, ${r.donors} donors, ${r.volunteers} volunteers, ${r.gifts} gifts ${money(r.giftCents)} (${r.undated} undated ${money(r.undatedCents)}), `
      + `${r.pledges} pledges ${money(r.openCents)} open, ${r.events} events, ${r.attended} attended, ${r.optOuts} opt-outs, ${r.aside} set aside${r.asideReasons.length ? " (" + r.asideReasons.join("; ") + ")" : ""}, `
      + `columns ${r.columns.mapped}/${r.columns.kept}/${r.columns.skipped} of ${r.columns.total}, preview ${r.previewMs}ms`);
    if (process.env.IMPORT4_TABLE) fs.writeFileSync(process.env.IMPORT4_TABLE, JSON.stringify({ combinedPreviewMs: c.previewMs, rows }, null, 2));
  } catch (e) {
    ok("suite ran without throwing", false, e && e.stack);
  } finally {
    await closeDb().catch(() => {});
    summary();
  }
})();
