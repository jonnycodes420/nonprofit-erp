// tests/fix59-data-health.test.js: FIX-59. DATA HEALTH THAT IS CURRENT, THAT
// NEVER CALLS SPOUSES DUPLICATES, AND THAT FIXES ONLY ON HER CLICK. Guards
// donor data (every fix to a record she already has is a click with an Undo
// that restores it exactly) and money (imported gifts marked deposited, and
// back).
//
//   §1 Grow (pure): second gifts first, then came-didn't-give, then the rest;
//      the tab says "N second gifts · M more".
//   §2 duplicates: spouses (one surname, two full first names, one address,
//      email or phone) and a shared phone with two names are not duplicates;
//      the spouses are under Possible families; real near-duplicates stay;
//      name-only near-duplicates show as low with the reason.
//   §3 couples written as one name: comma (a first name off the list too, a
//      record already in a household), "or" and "and"; Fix all and Undo.
//   §4 names with markup or a note: listed, cleaned with the note moved to
//      Notes, and Undo restores name and Notes exactly.
//   §5 near-duplicates within an event: the question, Different (remembered,
//      Undo), Same (merged, Undo).
//   §6 Finance: imported gifts waiting for a deposit, marked deposited, Undo.
//   §7 Data health is current: the last check moves after an import and after
//      its undo, and says why.
//
// HOW IT GOES RED ON THE BASE (1c0bf5f): Grow sorts by dollars alone (§1);
// the spouses and the shared phone are pairs and nothing is a family, the
// name-only pairs are missing (§2); only the comma couple off a household is
// found (§3); §4, §5 and §6 have no endpoints (404); the sheet import never
// re-runs Data health, so the last check never moves (§7).
//
// Standard scratch stack (tests/README.md). Sends nothing. Fake people only.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const PASSWORD = "loadtest1234";
const ORG = "org_fix59_health";
const P = s => `${ORG}_${s}`;

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
const person = (id, name, extra = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,phone,address,city,state,zip,household_id,notes,created_by,created_by_name,created_at,updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'system:test/fix59','FIX-59 test',NOW()-INTERVAL '40 days',NOW()-INTERVAL '40 days')`,
  [P(id), ORG, name, extra.email || null, extra.phone || null, extra.address || null, extra.address ? "Portland" : null, extra.address ? "ME" : null,
   extra.address ? "04101" : null, extra.household || null, extra.notes || null]);
const pairOf = (list, a, b) => list.find(p => (p.a === P(a) && p.b === P(b)) || (p.a === P(b) && p.b === P(a)));
// a record as it stands, without the clock column every write moves
const snap = async ids => JSON.stringify((await q(`SELECT to_jsonb(d.*) - 'updated_at' AS j FROM donors d WHERE org_id=$1 AND id = ANY($2) ORDER BY id`, [ORG, ids])).map(r => r.j));

function growOrder() {
  const I = require("../insights");
  const item = (key, cents) => ({ key, name: key, lead: key, ids: [key], cents, facts: [], how: {} });
  const cards = [
    { kind: "upgraded", title: "Moving up", words: { why: "" }, items: [item("up1", 900000), item("up2", 400000)] },
    { kind: "second_gift", title: "Second gift", words: { why: "" }, items: [item("sg1", 2500), item("sg2", 10000), item("sg3", 500)] },
  ];
  const deck = I.buildDeck(cards);
  const events = [{ id: "ev1", name: "Harvest Supper", date: "2026-10-10", cameNoGift: [{ id: "c1", name: "Cora Came" }, { id: "c2", name: "Cal Came" }] }];
  const out = I.withEventGuests(deck, events, { asOf: "2026-10-29" });
  const grow = out.tabs.find(t => t.key === "grow");
  const kinds = grow.moves.map(m => m.kind);
  ok("§1 Grow: second gifts first (by dollars), then came-didn't-give, then the others",
     JSON.stringify(kinds) === JSON.stringify(["second_gift", "second_gift", "second_gift", "came_no_gift", "came_no_gift", "upgraded", "upgraded"])
     && grow.moves[0].lead === "sg2" && grow.moves[5].lead === "up1", JSON.stringify(grow.moves.map(m => m.lead)));
  ok("§1 Grow's count says the split: 3 second gifts · 4 more", grow.count === 7 && grow.split && grow.split.words === "3 second gifts · 4 more", grow.split);
}

async function main() {
  growOrder();

  const tok = await freshOrg(ORG, "FIX-59 data health (test)");
  // ── the people ──────────────────────────────────────────────────────────
  // spouses: one surname, two full first names, sharing an address, an email, a phone
  await person("jay", "Jay Acostino", { address: "12 Larkspur Lane" });
  await person("jami", "Jami Acostino", { address: "12 Larkspur Lane" });
  await person("erin", "Erin Hallberg", { email: "hallbergs@example.org" });
  await person("dan", "Dan Hallberg", { email: "hallbergs@example.org" });
  await person("jim", "Jim Rothmeyer", { phone: "207-555-0181" });
  await person("jen", "Jen Rothmeyer", { phone: "207-555-0181" });
  // one phone, two people with nothing else alike
  await person("mari", "Marisol Quintero", { phone: "207-555-0133" });
  await person("oswald", "Oswald Brandtner", { phone: "207-555-0133" });
  // real near-duplicates with something shared
  await person("jeffrey", "Jeffrey Yeltman", { address: "9 Quarry Road" });
  await person("jeff", "Jeff Yeltman", { address: "9 Quarry Road" });
  await person("patrick", "Patrick Nickelby", { phone: "207-555-0190" });
  await person("pat", "Pat Nickelby", { phone: "207-555-0190" });
  // a first name cut short is one person, not a family
  await person("anna", "Anna Pellworth", { email: "apellworth@example.org" });
  await person("ann", "Ann Pellworth", { email: "apellworth@example.org" });
  // near-duplicates by name alone
  await person("allanby", "Mark Allanby");
  await person("alanby", "Mark Alanby");
  await person("wiggant", "Stan Wiggant");
  await person("wiggand", "Stan Wiggand");
  await person("steve", "Steve Littleford");
  await person("stephen", "Stephen Littleford");
  // couples written as one name; one already in a household with an address-mate
  await q(`INSERT INTO households (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,'The Dormandy Household','system:test/fix59','FIX-59 test')`, [P("hh_dorm"), ORG]);
  await person("alec", "Alec, Brad Hubbardson");
  await person("leslie", "Leslie, Kelly Dormandy", { address: "4 Tern Way", household: P("hh_dorm") });
  await person("dormmate", "Kelly Dormandy", { address: "4 Tern Way", household: P("hh_dorm") });
  await person("josh", "Josh, Kasi Satori");
  await person("randall", "Randall or Joenell Barnetto");
  await person("chris", "Christopher and Cynthia Hornby");
  // names with markup or a note in them
  await person("bryant", "**Bryant Mayfield", { notes: "Board alum." });
  await person("scarla", "Scarla (send with Tiffany's) Nesbitt");
  // one event's list with two spellings of one person
  await person("fran", "Fran Rohlwing");
  await person("frances", "Frances Rohlwing");
  await person("guest", "Odile Pemberton");
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ($1,$2,'Marigold Test Supper','dinner',CURRENT_DATE - 20)`, [P("ev"), ORG]);
  for (const g of ["fran", "frances", "guest"]) await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status) VALUES ($1,$2,$3,$4,$5,'attended')`,
    [P("ea_" + g), P("ev"), ORG, P(g), g]);

  // ── §2 duplicates and families ──────────────────────────────────────────
  const dups = ((await api("GET", "/data-health/duplicates", tok)).body || {}).pairs || [];
  const spouses = [["jay", "jami"], ["erin", "dan"], ["jim", "jen"]];
  ok("§2 spouses (one surname, two full first names) are never possible duplicates",
     spouses.every(([a, b]) => !pairOf(dups, a, b)), spouses.map(([a, b]) => pairOf(dups, a, b)).filter(Boolean));
  ok("§2 a shared phone with two different names is not a duplicate", !pairOf(dups, "mari", "oswald"), pairOf(dups, "mari", "oswald"));
  const jy = pairOf(dups, "jeffrey", "jeff"), pn = pairOf(dups, "patrick", "pat"), ap2 = pairOf(dups, "anna", "ann");
  ok("§2 real near-duplicates still show (Jeffrey/Jeff at one address, Patrick/Pat on one phone, Anna/Ann on one email)", !!jy && !!pn && !!ap2, [jy, pn, ap2]);
  const nameOnly = [["allanby", "alanby"], ["wiggant", "wiggand"], ["steve", "stephen"]].map(([a, b]) => pairOf(dups, a, b));
  ok("§2 near-duplicates by name alone show as low confidence, with the reason",
     nameOnly.every(p => p && p.confidence === "low" && p.reasons.some(r => /^name only: .+no address, phone or email in common$/.test(r))), nameOnly);
  const fam = ((await api("GET", "/data-health/families", tok)).body || {}).rows || [];
  ok("§2 the spouses are under Possible families, each with what they share",
     spouses.every(([a, b]) => { const f = pairOf(fam, a, b); return f && f.reasons.length; }) && !pairOf(fam, "mari", "oswald"), fam.map(f => [f.left && f.left.name, f.right && f.right.name, f.reasons]));
  const h0 = (await api("GET", "/data-health", tok)).body || {};
  ok("§2 the page's counts are the rows: families and duplicates", h0.counts && h0.counts.families === fam.length && h0.counts.duplicates === dups.length, h0.counts);

  // ── §3 couples written as one name ──────────────────────────────────────
  const cp = ((await api("GET", "/data-health/couples", tok)).body || {}).rows || [];
  const cpNames = cp.map(r => r.name).sort();
  const wantCouples = ["Alec, Brad Hubbardson", "Christopher and Cynthia Hornby", "Josh, Kasi Satori", "Leslie, Kelly Dormandy", "Randall or Joenell Barnetto"];
  ok("§3 every couple written as one name is found: comma, a first name off the list, one in a household, \"or\" and \"and\"",
     JSON.stringify(cpNames) === JSON.stringify(wantCouples), cpNames);
  ok("§3 the count on the page is the same rows", h0.counts && h0.counts.couples === wantCouples.length, h0.counts && h0.counts.couples);
  const coupleIds = ["alec", "leslie", "dormmate", "josh", "randall", "chris"].map(P);
  const beforeCouples = await snap(coupleIds);
  const [{ n: peopleBefore }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  const [{ n: hhBefore }] = await q(`SELECT COUNT(*)::int AS n FROM households WHERE org_id=$1`, [ORG]);
  const ap = await api("POST", "/data-health/couples/apply", tok, { donorIds: cp.map(r => r.donorId) });
  const after = Object.fromEntries((await q(`SELECT id, name, spouse_name, household_id FROM donors WHERE org_id=$1 AND id = ANY($2)`, [ORG, coupleIds])).map(r => [r.id, r]));
  const [{ n: peopleMid }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  ok("§3 Fix all: each record is the first person; the one in a household keeps it and is not given a second Kelly",
     ap.status === 201 && ap.body.applied === 5 && after[P("randall")].name === "Randall Barnetto" && after[P("randall")].spouse_name === "Joenell Barnetto"
     && after[P("josh")].name === "Josh Satori" && after[P("chris")].name === "Christopher Hornby"
     && after[P("leslie")].name === "Leslie Dormandy" && after[P("leslie")].household_id === P("hh_dorm") && peopleMid === peopleBefore + 4,
     [ap.status, ap.body, after, peopleMid - peopleBefore]);
  const un = await api("POST", "/data-health/couples/undo", tok, { batchId: ap.body.batchId });
  const [{ n: peopleAfter }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  const [{ n: hhAfter }] = await q(`SELECT COUNT(*)::int AS n FROM households WHERE org_id=$1`, [ORG]);
  ok("§3 Undo restores every record exactly, removes the people and households the fix made, and keeps the household that was there",
     un.status === 200 && (await snap(coupleIds)) === beforeCouples && peopleAfter === peopleBefore && hhAfter === hhBefore, [un.status, peopleAfter - peopleBefore, hhAfter - hhBefore]);

  // ── §4 names with markup or a note ──────────────────────────────────────
  const nm = await api("GET", "/data-health/names", tok);
  const nmRows = (nm.body && nm.body.rows) || [];
  const br = nmRows.find(r => r.donorId === P("bryant")), sc = nmRows.find(r => r.donorId === P("scarla"));
  ok("§4 names with markup or a note in brackets are listed, cleaned as the import cleans them",
     nm.status === 200 && nmRows.length === 2 && br && br.after === "Bryant Mayfield" && sc && sc.after === "Scarla Nesbitt" && sc.notes[0] === "send with Tiffany's",
     [nm.status, nmRows]);
  const nameIds = [P("bryant"), P("scarla")];
  const beforeNames = await snap(nameIds);
  const na = await api("POST", "/data-health/names/apply", tok, { donorIds: nameIds });
  const nAfter = Object.fromEntries((await q(`SELECT id, name, notes FROM donors WHERE org_id=$1 AND id = ANY($2)`, [ORG, nameIds])).map(r => [r.id, r]));
  ok("§4 on her click the name is cleaned and the note moves to Notes, after what was there",
     na.status === 201 && nAfter[P("bryant")].name === "Bryant Mayfield" && nAfter[P("bryant")].notes === "Board alum."
     && nAfter[P("scarla")].name === "Scarla Nesbitt" && /send with Tiffany's/.test(nAfter[P("scarla")].notes || ""), [na.status, nAfter]);
  const nu = await api("POST", "/data-health/names/undo", tok, { batchId: na.body && na.body.batchId });
  ok("§4 Undo puts each name and its Notes back exactly", nu.status === 200 && (await snap(nameIds)) === beforeNames, nu.status);

  // ── §5 near-duplicates within an event ──────────────────────────────────
  const h1 = (await api("GET", "/data-health", tok)).body || {};
  const evLine = ((h1.counts && h1.counts.eventDuplicatesByEvent) || []).find(e => e.eventId === P("ev"));
  ok("§5 the page has one line for the event: 1 possible duplicate within Marigold Test Supper", evLine && evLine.count === 1 && evLine.eventName === "Marigold Test Supper", h1.counts && h1.counts.eventDuplicatesByEvent);
  const ep = ((await api("GET", `/data-health/event-pairs?eventId=${P("ev")}`, tok)).body || {}).rows || [];
  ok("§5 the question is the import's: \"Is Fran Rohlwing the same as Frances Rohlwing?\"", ep.length === 1 && ep[0].question === "Is Fran Rohlwing the same as Frances Rohlwing?" && ep[0].why === "nickname", ep);
  const d1 = await api("POST", "/data-health/event-pairs/answer", tok, { a: P("fran"), b: P("frances"), answer: "different" });
  const epAfterDiff = ((await api("GET", `/data-health/event-pairs?eventId=${P("ev")}`, tok)).body || {}).rows || [];
  const dupsAfterDiff = ((await api("GET", "/data-health/duplicates", tok)).body || {}).pairs || [];
  ok("§5 Different is remembered: neither the event nor the duplicates line asks again",
     d1.status === 201 && epAfterDiff.length === 0 && !pairOf(dupsAfterDiff, "fran", "frances"), [d1.status, epAfterDiff.length]);
  const ud = await api("POST", "/data-health/pairs/undismiss", tok, { a: P("fran"), b: P("frances") });
  const epBack = ((await api("GET", `/data-health/event-pairs?eventId=${P("ev")}`, tok)).body || {}).rows || [];
  ok("§5 Undo of Different asks the question again", ud.status === 200 && epBack.length === 1, [ud.status, epBack.length]);
  const pairIds = [P("fran"), P("frances")];
  const beforeMerge = await snap(pairIds);
  const sm = await api("POST", "/data-health/event-pairs/answer", tok, { a: P("fran"), b: P("frances"), answer: "same" });
  const [{ n: liveAfterSame }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND id = ANY($2) AND deleted_at IS NULL`, [ORG, pairIds]);
  const [{ n: attAfterSame }] = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND donor_id = ANY($3)`, [ORG, P("ev"), pairIds]);
  ok("§5 Same person merges the two through the one merge (one record left, on the list once)", sm.status === 201 && sm.body.mergeId && liveAfterSame === 1 && attAfterSame === 1, [sm.status, sm.body, liveAfterSame, attAfterSame]);
  const mu = await api("POST", `/data-health/merges/${sm.body.mergeId}/undo`, tok, {});
  const [{ n: attBack }] = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND donor_id = ANY($3)`, [ORG, P("ev"), pairIds]);
  ok("§5 Undo of Same brings both people back exactly, each on the list", mu.status === 200 && (await snap(pairIds)) === beforeMerge && attBack === 2, [mu.status, attBack]);

  // ── §6 Finance: imported gifts waiting for a deposit ────────────────────
  await q(`INSERT INTO imports (id,org_id,name,shape,actor_user_id) VALUES ($1,$2,'Spring checks.xlsx','sheet',$3)`, [P("imp1"), ORG, "u_" + ORG]);
  await q(`INSERT INTO imports (id,org_id,name,shape,actor_user_id) VALUES ($1,$2,'Deposit slip','deposit',$3)`, [P("dep1"), ORG, "u_" + ORG]);
  const gift = (id, donor, amount, daysAgo, importId, method = "check") => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,import_id,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,to_char(CURRENT_DATE - $5::int,'YYYY-MM-DD'),'cash',$6,$7,'system:test/fix59','FIX-59 test')`,
    [P(id), ORG, P(donor), amount, daysAgo, method, importId]);
  await gift("g1", "guest", 125.5, 10, P("imp1"));
  await gift("g2", "guest", 40, 20, P("imp1"));
  await gift("g3", "jay", 300, 30, P("imp1"), "cash");
  await gift("g4", "jay", 75, 5, null);              // typed in, not imported: stays waiting
  await gift("g5", "dan", 60, 5, P("dep1"));         // on a deposit already
  const giftIds = ["g1", "g2", "g3", "g4", "g5"].map(P);
  const giftSnap = async () => JSON.stringify(await q(`SELECT id, deposited_on, deposit_ref FROM gifts WHERE org_id=$1 AND id = ANY($2) ORDER BY id`, [ORG, giftIds]));
  const fin0 = (await api("GET", "/finance/overview", tok)).body || {};
  const item0 = (fin0.needsYou || []).find(n => n.key === "importedUndeposited");
  const unm0 = (fin0.needsYou || []).find(n => n.key === "unmatched");
  ok("§6 Finance: \"3 imported gifts are waiting for a deposit\", with the run and its action",
     item0 && item0.count === 3 && /^3 imported gifts are waiting for a deposit/.test(item0.sentence) && item0.actionLabel === "They were already deposited"
     && item0.runs.length === 1 && item0.runs[0].importId === P("imp1") && unm0 && unm0.count === 4, [item0, unm0 && unm0.count]);
  const rows0 = (await api("GET", "/finance/overview/rows?rows=importedUndeposited", tok)).body || {};
  ok("§6 the item opens its rows and they foot", rows0.count === 3 && rows0.totalCents === 46550, [rows0.count, rows0.totalCents]);
  const gBefore = await giftSnap();
  const mk = await api("POST", "/finance/imported-deposited", tok, { importId: P("imp1") });
  const fin1 = (await api("GET", "/finance/overview", tok)).body || {};
  const [g1] = await q(`SELECT deposited_on, deposit_ref, date FROM gifts WHERE id=$1`, [P("g1")]);
  ok("§6 They were already deposited: the run's gifts leave Not yet on a deposit, dated the day given; the typed-in gift stays",
     mk.status === 201 && mk.body.marked === 3 && !(fin1.needsYou || []).some(n => n.key === "importedUndeposited")
     && ((fin1.needsYou || []).find(n => n.key === "unmatched") || {}).count === 1 && g1.deposited_on === g1.date && g1.deposit_ref === null,
     [mk.status, mk.body, (fin1.needsYou || []).map(n => [n.key, n.count]), g1]);
  const mu2 = await api("POST", "/finance/imported-deposited/undo", tok, { batchId: mk.body && mk.body.batchId });
  const fin2 = (await api("GET", "/finance/overview", tok)).body || {};
  ok("§6 Undo puts every gift's deposit columns back exactly, and the item returns",
     mu2.status === 200 && (await giftSnap()) === gBefore && ((fin2.needsYou || []).find(n => n.key === "importedUndeposited") || {}).count === 3, [mu2.status]);

  // ── §7 Data health is current ───────────────────────────────────────────
  const lastRun = async () => ((await api("GET", "/data-health", tok)).body || {}).lastRun || null;
  const waitRun = async (trigger, after) => {
    for (let i = 0; i < 60; i++) {
      const r = await lastRun();
      if (r && r.trigger === trigger && (!after || new Date(r.created_at) > new Date(after))) return r;
      await new Promise(res => setTimeout(res, 250));
    }
    return await lastRun();
  };
  const run0 = await lastRun();
  const R = await import("../shared/sheetRead.js");
  const sheets = [{ name: "Sheet1", grid: R.gridFromText("Name,Email\nPenelope Garrowby,pgarrowby@example.org\nTobias Wendleton,twendleton@example.org\n") }];
  const start = await api("POST", "/sheet-import/commit", tok, { fileName: "fix59-contacts.csv", sheets, background: true });
  let job = null;
  for (let i = 0; i < 400 && start.status === 202; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(start.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") { job = j.body; break; }
    await new Promise(res => setTimeout(res, 150));
  }
  const run1 = await waitRun("import", run0 && run0.created_at);
  ok("§7 after an import, Data health checks again and says so",
     job && job.status === "done" && run1 && run1.trigger === "import" && (!run0 || new Date(run1.created_at) > new Date(run0.created_at)), [start.status, job && job.status, run0, run1]);
  const undo = await api("POST", `/imports/${encodeURIComponent(start.body.importId)}/reverse`, tok, {});
  const run2 = await waitRun("undo", run1 && run1.created_at);
  ok("§7 after the import is undone, it checks again", undo.status === 200 && run2 && run2.trigger === "undo" && new Date(run2.created_at) > new Date(run1.created_at), [undo.status, run2]);

  await closeDb();
  summary();
}
main().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
