// tests/sales2-prospecting.test.js · SALES-2 Part A (find and work prospects) and SALES-FIX-1.
//
// One section per numbered item: §F1–§F4 are SALES-FIX-1's (what Jonathan hit on his first
// real import, 11 Nov), §1–§6 are SALES-2 Part A's. §F5 (the column map's layout) is a
// screen, reviewed by eye on the walk at 1440 and 390, not pinned here.
//
// THE PLANTED DEFECTS (set SALES2_PLANT on the SERVER; each turns its section red):
//   door404       a stale-CSRF super-admin sees "not_found"                       → §F1
//   skiplink      Skip leaves an orgless contact unlinked when the org now exists → §F2
//   dupe          an email-less contact re-imported with Update is duplicated     → §F4
//   dnc           call mode offers a contact marked Do not contact                → §3
//   meetingstage  a "Meeting booked" outcome leaves the deal in its old stage     → §6
//
// Made-up fixtures only (every name invented, every domain under example.org). Nothing sends:
// templates are filled and handed back, never mailed. The suite sets its own clock (tests/clock.js).
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const { testNow } = require("./clock");
const TODAY = require("../server/admin/sales/today");
const CM = require("../server/admin/sales/callMode");
const FIT = require("../server/admin/sales/fit");

const PASS = "loadtest1234";
const HOME = "org_sales2home", CUST = "org_sales2cust";
const SUPER = "sales2-super@example.org", ADMIN = "sales2-admin@example.org";
const TZ = "America/New_York";

async function wipeOrg(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function wipeSales() {
  const t = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sales\\_%'`)).map(r => r.table_name);
  for (const x of t) await q(`DELETE FROM "${x}"`);
}
const S = (tok, m, p, b) => api(m, `/ops/sales${p}`, tok, b);
const view = v => encodeURIComponent(JSON.stringify(v));
const csvOf = rows => rows.map(r => r.map(c => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
// A cookie-only request (the browser's session cookie, no Bearer), like a page left open across a ship.
async function viaCookie(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Origin: "http://localhost:4173", Cookie: `steward_session=${token}`, ...headers },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let parsed = text; try { parsed = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, body: parsed };
}

(async () => {
  await wipeSales();
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await q(`DELETE FROM users WHERE id IN ('u_sales2_super','u_sales2_admin')`);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales2 Home','sales2-home',1,'active','team')`, [HOME]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales2 Customer','sales2-cust',1,'active','team')`, [CUST]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales2_super',$1,$2,$3,'Prospect Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales2_admin',$1,$2,$3,'Cust Admin','admin',false)`, [CUST, ADMIN, bcrypt.hashSync(PASS, 10)]);
  const sup = await login(SUPER);
  const adm = await login(ADMIN);
  const today = TODAY.civil(testNow(), TZ);

  // ── §F1 · THE DOOR SAYS THE REAL REASON TO A LIVE SUPER-ADMIN ─────────────────────
  // HOW IT GOES RED ON MAIN (and with SALES2_PLANT=door404): requireAuth404 turns the CSRF
  // refusal into { error: "not_found" }, so the stale page reads "could not be read".
  const stale = await viaCookie("POST", "/ops/sales/import/preview", sup, { object: "org", csv: "Name\nX\n" });
  ok("§F1 a super-admin's stale page (cookie, no CSRF header) is told the real refusal: 403 csrf_header_missing, 'Reload the page'",
    stale.status === 403 && stale.body.error === "csrf_header_missing" && /Reload the page/.test(stale.body.message || ""), [stale.status, stale.body]);
  const staleTok = await viaCookie("POST", "/ops/sales/import/preview", sup, { object: "org", csv: "Name\nX\n" }, { "X-Steward-Org": HOME, "X-Steward-CSRF": "x".repeat(43) });
  ok("§F1 …and a stale CSRF token is csrf_token_invalid, with its message", staleTok.status === 403 && staleTok.body.error === "csrf_token_invalid" && /Reload/.test(staleTok.body.message || ""), [staleTok.status, staleTok.body]);
  const admStale = await viaCookie("POST", "/ops/sales/import/preview", adm, { object: "org", csv: "Name\nX\n" });
  const anon = await viaCookie("POST", "/ops/sales/import/preview", "not-a-token", { object: "org", csv: "Name\nX\n" });
  const admGet = await S(adm, "GET", "/meta");
  ok("§F1 an org admin's stale page, a forged cookie and an org admin's read all still get a plain 404",
    admStale.status === 404 && admStale.body.error === "not_found" && anon.status === 404 && admGet.status === 404, [admStale.status, admStale.body, anon.status, admGet.status]);
  const live = await S(sup, "GET", "/meta");
  ok("§F1 the super-admin's own Bearer session still reads the CRM", live.status === 200 && live.body.ok === true);

  // ── §F2–§F4 · CONTACTS BEFORE THEIR ORGANIZATIONS (the shape that bit on prod) ────
  const ORGS = Array.from({ length: 15 }, (_, i) => [`Larkspur Fund ${i + 1}`, `larkspur${i + 1}.example.org`, "Lexington", "KY"]);
  const PEOPLE = Array.from({ length: 16 }, (_, i) => [["Wren", "Oriel", "Tamsin", "Ilse"][i % 4], `Testperson${i + 1}`, i === 15 ? "Larkspur Fund 1" : `Larkspur Fund ${i + 1}`, "555-0100"]);
  const contactsCsv = csvOf([["First Name", "Last Name", "Associated Company", "Phone Number"], ...PEOPLE]);
  const orgsCsv = csvOf([["Company name", "Company Domain Name", "City", "State/Region"], ...ORGS]);
  // §F3: the preview says what won't link, before anything is written.
  const pv0 = await S(sup, "POST", "/import/preview", { object: "contact", csv: contactsCsv });
  ok("§F3 preview warns: Import organizations first: 16 of 16 rows name an organization that isn't here",
    pv0.status === 200 && pv0.body.warning === "Import organizations first: 16 of 16 rows name an organization that isn't here.", pv0.body.warning);
  ok("§F3 preview reports each row's association: organization 'X' not found",
    pv0.body.sample[0].links[0].ok === false && pv0.body.sample[0].links[0].says === "organization 'Larkspur Fund 1' not found" && pv0.body.unlinked.length === 16, pv0.body.sample[0].links);
  const c1 = await S(sup, "POST", "/import/commit", { object: "contact", csv: contactsCsv, mode: "skip" });
  ok("§F3 commit lists the rows that didn't link, and why", c1.status === 200 && c1.body.counts.created === 16 && c1.body.counts.unlinkedRows === 16
    && c1.body.counts.unlinked[0].says === "organization 'Larkspur Fund 1' not found" && c1.body.counts.unlinked[0].row === 2, c1.body.counts);
  const o1 = await S(sup, "POST", "/import/commit", { object: "org", csv: orgsCsv, mode: "skip" });
  ok("§F2 the 15 organizations import", o1.body.counts.created === 15, o1.body.counts);
  const pv1 = await S(sup, "POST", "/import/preview", { object: "contact", csv: contactsCsv });
  ok("§F3 once they're here, the preview links every row and warns of nothing", pv1.body.warning === null && pv1.body.sample[0].links[0].ok === true && pv1.body.duplicates === 16, [pv1.body.warning, pv1.body.duplicates]);
  // §F2: Skip still links. HOW IT GOES RED (SALES2_PLANT=skiplink): a skipped row `continue`s before linkTo.
  const c2 = await S(sup, "POST", "/import/commit", { object: "contact", csv: contactsCsv, mode: "skip" });
  const orphans = await q(`SELECT COUNT(*)::int AS n FROM sales_contacts c WHERE c.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM sales_links l WHERE l.a_type='contact' AND l.a_id=c.id AND l.b_type='org')`);
  ok("§F2 re-importing with Skip links every skipped contact to its organization now that it exists", c2.body.counts.skipped === 16 && c2.body.counts.created === 0 && orphans[0].n === 0 && c2.body.counts.unlinkedRows === 0,
    [c2.body.counts, orphans[0].n]);
  const twoAtOne = await q(`SELECT COUNT(*)::int AS n FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id WHERE l.a_type='contact' AND l.b_type='org' AND o.name='Larkspur Fund 1'`);
  ok("§F2 Skip adds links and removes none: Larkspur Fund 1 has its two people", twoAtOne[0].n === 2, twoAtOne[0].n);
  // §F4: Update on an email-less file never duplicates anyone. HOW IT GOES RED (SALES2_PLANT=dupe): 32.
  const c3 = await S(sup, "POST", "/import/commit", { object: "contact", csv: contactsCsv, mode: "update" });
  const nC = await q(`SELECT COUNT(*)::int AS n FROM sales_contacts WHERE deleted_at IS NULL`);
  ok("§F4 import contacts, import orgs, re-import contacts with Update: still 16 contacts", nC[0].n === 16 && c3.body.counts.updated === 16 && c3.body.counts.created === 0, [nC[0].n, c3.body.counts]);
  // The same name at ANOTHER organization is another person.
  const other = csvOf([["First Name", "Last Name", "Associated Company"], ["Wren", "Testperson1", "Larkspur Fund 2"]]);
  const c4 = await S(sup, "POST", "/import/commit", { object: "contact", csv: other, mode: "update" });
  ok("§F4 the same name at a different organization is a different person", c4.body.counts.created === 1, c4.body.counts);
  for (const imp of [c1, o1, c4]) await S(sup, "POST", `/import/${imp.body.importId}/undo`, {});
  await wipeSales();

  // ── §1 · PROSPECT LISTS: A LEAD LIST, ANY SHAPE, INTO A NAMED LIST ─────────────────
  const LEAD = [["Organization Name", "EIN", "City", "State", "Total Revenue", "NTEE Code", "Website", "Phone",
    "Executive Director", "ED Email", "ED Phone", "Development Director", "DD Email", "DD Phone"],
  ["Bramblewood Youth Choir", "61-1234567", "Louisville", "KY", "$850,000", "A6", "https://bramblewood.example.org", "502-555-0101",
    "Marisol Quenby", "marisol@bramblewood.example.org", "502-555-0111", "Teodor Halvard", "teodor@bramblewood.example.org", "502-555-0112"],
  ["Cobble Street Pantry", "31-7654321", "Dayton", "OH", "1,250,000", "K31", "cobblestreet.example.org", "937-555-0102",
    "Agathe Morrow", "", "937-555-0121", "", "", ""],
  ["Fallowmere Literacy", "62-1112223", "Knoxville", "TN", "60000", "B92", "fallowmere.example.org", "",
    "Piers Ondaatje", "piers@fallowmere.example.org", "", "Juno Castellane", "juno@fallowmere.example.org", ""],
  ["Gristmill Arts Collective", "35-9998887", "Bloomington", "IN", "400000", "A20", "gristmill.example.org", "812-555-0104",
    "Ottoline Vance", "ottoline@gristmill.example.org", "812-555-0141", "Rufus Calder", "rufus@gristmill.example.org", "812-555-0142"]];
  const leadCsv = csvOf(LEAD);
  const lp = await S(sup, "POST", "/import/preview", { object: "prospect", csv: leadCsv });
  const m = lp.body.mapping || {};
  ok("§1 the mapper knows the usual lead-list columns", m["Organization Name"] === "name" && m.EIN === "ein" && m["Total Revenue"] === "revenue_raw" && m["NTEE Code"] === "nonprofit_type"
    && m["Executive Director"] === "ed_name" && m["ED Email"] === "ed_email" && m["DD Phone"] === "dd_phone" && m["Development Director"] === "dd_name", m);
  ok("§1 the preview counts organizations and people", lp.body.rows === 4 && lp.body.people === 7 && lp.body.both === 3, [lp.body.rows, lp.body.people, lp.body.both]);
  const LIST = "KY orgs $100K–$2M";
  const li = await S(sup, "POST", "/import/commit", { object: "prospect", csv: leadCsv, mode: "skip", list: { name: LIST }, fileName: "made-up-leads.csv" });
  ok("§1 a lead list imports: 4 organizations, 7 people, on the list", li.status === 200 && li.body.counts.created === 4 && li.body.counts.people.created === 7 && li.body.counts.list.name === LIST, li.body.counts);
  const [bram] = await q(`SELECT id, ein, revenue, state, domain FROM sales_orgs WHERE name = 'Bramblewood Youth Choir' AND deleted_at IS NULL`);
  const bramPage = await S(sup, "GET", `/rec/org/${bram.id}`);
  const roles = bramPage.body.linked.contact.map(c => c.role).sort();
  ok("§1 a row with an ED and a DD makes one organization with two contacts, roles set", roles.join() === "Development Director,ED" && bram.ein === "61-1234567" && Number(bram.revenue) === 850000 && bram.domain === "bramblewood.example.org", [roles, bram]);
  const meta1 = (await S(sup, "GET", "/meta")).body;
  const theList = meta1.lists.find(l => l.name === LIST);
  ok("§1 the list holds its 4 organizations", theList && theList.orgs === 4, meta1.lists);
  const second = await S(sup, "POST", "/lists", { name: "Louisville arts", add: [bram.id] });
  const onList = await S(sup, "GET", `/list/org?view=${view({ filters: [{ field: "list_ids", op: "in", value: [second.body.id] }] })}`);
  const bramRow = (await S(sup, "GET", `/list/org?view=${view({ filters: [{ field: "list_ids", op: "in", value: [theList.id] }] })}`)).body.rows.find(r => r.id === bram.id);
  ok("§1 the same organization can be on two lists", onList.body.rows.length === 1 && bramRow && bramRow.list_ids.length === 2, bramRow && bramRow.list_ids);
  const again = await S(sup, "POST", "/import/commit", { object: "prospect", csv: leadCsv, mode: "skip", list: { id: theList.id } });
  const nOrgs = await q(`SELECT COUNT(*)::int AS n FROM sales_orgs WHERE deleted_at IS NULL`);
  const nPeople = await q(`SELECT COUNT(*)::int AS n FROM sales_contacts WHERE deleted_at IS NULL`);
  ok("§1 importing the same list again duplicates nobody (website, then name at the organization)", again.body.counts.skipped === 4 && again.body.counts.people.skipped === 7 && nOrgs[0].n === 4 && nPeople[0].n === 7, again.body.counts);
  const undoAgain = await S(sup, "POST", `/import/${again.body.importId}/undo`, {});
  ok("§1 undoing the skip-only import removes nothing that was there before", undoAgain.status === 200 && (await q(`SELECT COUNT(*)::int AS n FROM sales_orgs WHERE deleted_at IS NULL`))[0].n === 4
    && (await S(sup, "GET", "/meta")).body.lists.find(l => l.id === theList.id).orgs === 4);

  // ── §2 · FIT, AS PLAIN RULES ───────────────────────────────────────────────────────
  await S(sup, "PATCH", `/rec/org/${bram.id}`, { current_crm: "Spreadsheets" });
  const rows2 = (await S(sup, "GET", `/list/org?view=${view({ sort: { key: "fit_met", dir: "desc" } })}`)).body.rows;
  const byName = n => rows2.find(r => r.name === n);
  ok("§2 Bramblewood fits 5 of 5 (KY, $850K, spreadsheets, a DD, a phone)", byName("Bramblewood Youth Choir").fit_line === "Fits 5 of 5", byName("Bramblewood Youth Choir"));
  const grist = byName("Gristmill Arts Collective");
  ok("§2 Gristmill misses are named: its state (IN) and an unknown CRM", grist.fit_line === "Fits 3 of 5" && grist.fit_misses.some(x => /State is KY, OH or TN \(it's IN\)/.test(x)) && grist.fit_misses.some(x => /Current CRM not known/.test(x)), grist.fit_misses);
  const fall = byName("Fallowmere Literacy");
  ok("§2 Fallowmere: revenue $60K is outside $100K–$2M, and no one has a phone", fall.fit_misses.some(x => /Revenue \$100K–\$2M \(it's \$60K\)/.test(x)) && fall.fit_misses.includes("No phone"), fall.fit_misses);
  ok("§2 a list sorts by fit", rows2[0].name === "Bramblewood Youth Choir" && rows2.every((r, i, a) => i === 0 || a[i - 1].fit_met >= r.fit_met), rows2.map(r => [r.name, r.fit_met]));
  const fitFiltered = (await S(sup, "GET", `/list/org?view=${view({ filters: [{ field: "fit_met", op: "gt", value: 3 }] })}`)).body.rows;
  ok("§2 a list filters by fit", fitFiltered.map(r => r.name).join() === "Bramblewood Youth Choir", fitFiltered.map(r => r.name));
  await S(sup, "PUT", "/settings", { fit: { checks: [{ field: "state", op: "in", values: ["KY", "OH", "TN", "IN"] }, { field: "has_phone", op: "yes" }] } });
  const grist2 = (await S(sup, "GET", "/list/org")).body.rows.find(r => r.name === "Gristmill Arts Collective");
  ok("§2 Jonathan changes the rule and every org updates", grist2.fit_line === "Fits 2 of 2" && grist2.fit_misses.length === 0, grist2);
  ok("§2 the rule is arithmetic: the pure check agrees", FIT.fitOf({ state: "tn", has_dd: false }, { checks: [{ field: "state", op: "in", values: ["TN"] }, { field: "has_dd", op: "yes" }] }).line === "Fits 1 of 2");
  await S(sup, "PUT", "/settings", { fit: FIT.DEFAULT_FIT });

  // ── §3 · CALL MODE ─────────────────────────────────────────────────────────────────
  // Bramblewood: ED and DD both with phones. Cobble: ED with a phone. Fallowmere: no phones. Gristmill: both.
  const [ed] = await q(`SELECT id FROM sales_contacts WHERE first_name = 'Marisol'`);
  const [dd] = await q(`SELECT id FROM sales_contacts WHERE first_name = 'Teodor'`);
  const [rufus] = await q(`SELECT id FROM sales_contacts WHERE first_name = 'Rufus'`);
  const [ottoline] = await q(`SELECT id FROM sales_contacts WHERE first_name = 'Ottoline'`);
  const [grOrg] = await q(`SELECT id FROM sales_orgs WHERE name = 'Gristmill Arts Collective'`);
  const [cobble] = await q(`SELECT id FROM sales_orgs WHERE name = 'Cobble Street Pantry'`);
  // Do not contact on Gristmill's ED: the DD is offered instead. HOW IT GOES RED (SALES2_PLANT=dnc): Ottoline is offered.
  const dncSet = await S(sup, "POST", `/rec/contact/${ottoline.id}/dnc`, { reason: "Asked not to be called (made-up)" });
  const queue = n => S(sup, "GET", `/call/queue?list=${theList.id}&view=${view({ sort: { key: "name", dir: "asc" } })}&done=${n.join(",")}`);
  const q0 = await queue([]);
  ok("§3 the queue starts at the list's first organization, with its ED (tried least recently) and a tel: number",
    q0.status === 200 && q0.body.current.org.name === "Bramblewood Youth Choir" && q0.body.current.contactId === ed.id && q0.body.current.phone === "502-555-0111" && q0.body.current.org.fit.line === "Fits 5 of 5", q0.body.current);
  const allIds = [q0.body.current, ...q0.body.next].map(e => e.contactId);
  ok("§3 call mode never offers a contact marked Do not contact", dncSet.status === 200 && !allIds.includes(ottoline.id) && [q0.body.current, ...q0.body.next].some(e => e.contactId === rufus.id), allIds);
  ok("§3 an organization whose people have no phone is not offered (Fallowmere)", ![q0.body.current, ...q0.body.next].some(e => e.org.name === "Fallowmere Literacy"));
  // No answer → a call logged with its outcome, and "call again" in 2 business days.
  const na = await S(sup, "POST", "/call/outcome", { orgId: bram.id, contactId: ed.id, outcome: "no_answer", notes: "Rang out (made-up)", phone: "502-555-0111", listId: theList.id });
  const [callRow] = await q(`SELECT outcome, list_id, body FROM sales_activities WHERE id = $1`, [na.body.id]);
  const due2 = CM.addBusinessDays(today, 2);
  const naTask = await q(`SELECT a.due_on::text AS due_on, a.body FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id AND l.record_type = 'contact' AND l.record_id = $1 WHERE a.kind = 'task'`, [ed.id]);
  ok("§3 No answer logs a call with its outcome, notes and list", na.status === 201 && callRow.outcome === "no_answer" && callRow.list_id === theList.id && /Rang out/.test(callRow.body), callRow);
  ok("§3 No answer → call again in 2 business days (the default rule)", naTask.length === 1 && naTask[0].due_on === due2 && /Call Marisol Quenby again/.test(naTask[0].body), [naTask, due2]);
  const q1 = await queue([]);
  ok("§3 the queue skips anyone with an open task in the future (Bramblewood waits for its day)", q1.body.current.org.name !== "Bramblewood Youth Choir" && ![q1.body.current, ...q1.body.next].some(e => e.orgId === bram.id), q1.body.current.org.name);
  // Voicemail → call again in 3 business days AND an email task today.
  const vm = await S(sup, "POST", "/call/outcome", { orgId: cobble.id, contactId: q1.body.current.contactId, outcome: "voicemail", phone: q1.body.current.phone });
  ok("§3 Left voicemail → call again in 3 business days and an email task today", vm.status === 201 && vm.body.tasks.length === 2 && vm.body.tasks[0].due_on === CM.addBusinessDays(today, 3) && vm.body.tasks[1].due_on === today && /^Email /.test(vm.body.tasks[1].body), vm.body.tasks);
  // Bad number → the number is flagged and the other contact is next.
  await S(sup, "POST", `/rec/contact/${ottoline.id}/dnc`, { clear: true });
  const grq = await S(sup, "GET", `/call/queue?view=${view({ filters: [{ field: "name", op: "eq", value: "Gristmill Arts Collective" }] })}`);
  const firstGr = grq.body.current.contactId;
  const bad = await S(sup, "POST", "/call/outcome", { orgId: grOrg.id, contactId: firstGr, outcome: "bad_number", phone: grq.body.current.phone });
  const grq2 = await S(sup, "GET", `/call/queue?view=${view({ filters: [{ field: "name", op: "eq", value: "Gristmill Arts Collective" }] })}`);
  const [flagged] = await q(`SELECT bad_phones FROM sales_contacts WHERE id = $1`, [firstGr]);
  ok("§3 Bad number flags the phone and the other contact comes next", bad.status === 201 && flagged.bad_phones.includes(grq.body.current.phone) && grq2.body.current && grq2.body.current.contactId !== firstGr && [ottoline.id, rufus.id].includes(grq2.body.current.contactId),
    [firstGr, grq2.body.current && grq2.body.current.contactId, flagged.bad_phones]);
  // Called today → skipped, even with no task (a rule with no follow-up).
  await S(sup, "PUT", "/settings", { callRules: { gatekeeper: { callAgainDays: null, emailToday: false, stage: null } } });
  const other2 = grq2.body.current.contactId;
  await S(sup, "POST", "/call/outcome", { orgId: grOrg.id, contactId: other2, outcome: "gatekeeper", phone: grq2.body.current.phone });
  const grq3 = await S(sup, "GET", `/call/queue?view=${view({ filters: [{ field: "name", op: "eq", value: "Gristmill Arts Collective" }] })}`);
  ok("§3 anyone called today is skipped (both Gristmill people are done for today)", grq3.body.current === null, grq3.body.current);
  ok("§3 each outcome's rule is Jonathan's to edit", (await S(sup, "GET", "/meta")).body.settings.callRules.gatekeeper.callAgainDays === null);
  await S(sup, "PUT", "/settings", { callRules: CM.DEFAULT_CALL_RULES });
  // Not a fit → the org is closed with its reason and leaves the queue.
  const naf = await S(sup, "POST", "/call/outcome", { orgId: cobble.id, outcome: "not_a_fit", notes: "Budget is all federal (made-up)" });
  const [cob] = await q(`SELECT lost_at, lost_reason FROM sales_orgs WHERE id = $1`, [cobble.id]);
  ok("§3 Not a fit closes the organization with its reason", naf.status === 201 && cob.lost_at && /Not a fit: Budget is all federal/.test(cob.lost_reason), cob);
  ok("§3 the pure queue: dnc, a future task, called today and done each skip; a never-tried lead is first",
    CM.buildQueue({ orgs: [{ id: "o1" }, { id: "o2" }, { id: "o3", dnc: true }], done: new Set(["o2"]), blocked: new Set(), lastCall: new Map([["contact:c2", new Date(testNow() - 3 * 86400000).toISOString()]]),
      contactsByOrg: new Map([["o1", [{ id: "c2", role: "ED", phones: ["1"] }, { id: "c1", role: "Development Director", phones: ["2"] }, { id: "c0", role: "Board", phones: ["3"] }]]]) }, today)
      .map(e => e.contactId).join() === "c1");

  // ── §4 · DO NOT CONTACT ────────────────────────────────────────────────────────────
  const [fallOrg] = await q(`SELECT id FROM sales_orgs WHERE name = 'Fallowmere Literacy'`);
  const dncOrg = await S(sup, "POST", `/rec/org/${fallOrg.id}/dnc`, { reason: "Board asked us to stop (made-up)" });
  const noReason = await S(sup, "POST", `/rec/org/${bram.id}/dnc`, {});
  const page4 = await S(sup, "GET", `/rec/org/${fallOrg.id}`);
  ok("§4 Do not contact is a flag with its reason, day and who; a reason is required", dncOrg.status === 200 && noReason.status === 400 && page4.body.record.dnc_reason === "Board asked us to stop (made-up)" && page4.body.record.dnc_at && page4.body.record.dnc_by_name === "Prospect Super");
  const exOrg = await S(sup, "GET", `/export/org?view=${view({})}`);
  const exCon = await S(sup, "GET", `/export/contact?view=${view({})}`);
  ok("§4 a Do not contact organization, and its people, leave every list export", !/Fallowmere/.test(exOrg.text) && !/Piers|Juno/.test(exCon.text) && /Bramblewood/.test(exOrg.text) && /Marisol/.test(exCon.text), [exOrg.text.length, exCon.text.length]);
  const [piers] = await q(`SELECT id FROM sales_contacts WHERE first_name = 'Piers'`);
  const piersPage = await S(sup, "GET", `/rec/contact/${piers.id}`);
  ok("§4 a person at a Do not contact organization shows it on their page", piersPage.body.dncViaOrg && piersPage.body.dncViaOrg.name === "Fallowmere Literacy");
  await q(`UPDATE sales_contacts SET phones = '["865-555-0199"]'::jsonb WHERE id = $1`, [piers.id]);
  const q4 = await S(sup, "GET", `/call/queue?view=${view({ filters: [{ field: "name", op: "eq", value: "Fallowmere Literacy" }] })}`);
  ok("§4 a Do not contact organization is in no call queue, even with a phone now", q4.body.current === null && q4.body.total === 0, q4.body.current);

  // ── §5 · EMAIL TEMPLATES, SENT BY JONATHAN ────────────────────────────────────────
  await S(sup, "PUT", "/settings", { templates: [{ id: "stp_t1", name: "Made-up intro", subject: "Steward for {{org}}", body: "Hi {{first_name}}, a note about {{org}} in {{city}} and {{current_crm}}. {{my_name}}" }] });
  const fill = await S(sup, "GET", `/email/fill?template=stp_t1&contact=${dd.id}`);
  ok("§5 a template fills its merge fields from the contact and their organization", fill.status === 200 && fill.body.subject === "Steward for Bramblewood Youth Choir"
    && fill.body.body === "Hi Teodor, a note about Bramblewood Youth Choir in Louisville and Spreadsheets. Prospect Super" && fill.body.to === "teodor@bramblewood.example.org", fill.body);
  ok("§5 Open in Mail is a mailto: with the subject and body; Steward sends nothing", /^mailto:teodor@bramblewood\.example\.org\?subject=Steward%20for%20Bramblewood/.test(fill.body.mailto) && /never sends/.test(fill.body.says));
  const before5 = await q(`SELECT COUNT(*)::int AS n FROM sales_activities WHERE kind = 'email'`);
  const drafted = await S(sup, "POST", "/email/drafted", { subject: fill.body.subject, contactId: dd.id, orgId: bram.id, template: "Made-up intro" });
  const tl = (await S(sup, "GET", `/rec/contact/${dd.id}`)).body.timeline;
  ok("§5 Copy / Open in Mail logs one 'Email drafted' on the contact's timeline", drafted.status === 201 && (await q(`SELECT COUNT(*)::int AS n FROM sales_activities WHERE kind = 'email'`))[0].n === before5[0].n + 1
    && tl.some(a => a.kind === "email" && /Email drafted: Steward for Bramblewood/.test(a.body)));
  const miss = await S(sup, "GET", `/email/fill?template=stp_t1&contact=${piers.id}`);
  ok("§5 a field the record lacks is named, never left as {{…}}; a Do not contact person gets no mailto", !/\{\{/.test(miss.body.body) && miss.body.missing.includes("current_crm") && miss.body.mailto === null && miss.body.dnc === true, miss.body);

  // ── §6 · MEETING BOOKED, DONE RIGHT ────────────────────────────────────────────────
  // HOW IT GOES RED (SALES2_PLANT=meetingstage): the deal stays in Contacted.
  const pre = await S(sup, "POST", "/call/outcome", { orgId: bram.id, contactId: dd.id, outcome: "interested", phone: "502-555-0112" });
  const dealId = pre.body.dealId;
  const st0 = (await S(sup, "GET", `/rec/deal/${dealId}`)).body.record.stage_id;
  const meetDay = TODAY.addDays(today, 3);
  const mb = await S(sup, "POST", "/call/outcome", { orgId: bram.id, contactId: dd.id, outcome: "meeting_booked", phone: "502-555-0112",
    meeting: { date: meetDay, time: "10:30", place: "https://zoom.example.org/j/123", attendees: "Teodor Halvard, Marisol Quenby" } });
  const dealAfter = (await S(sup, "GET", `/rec/deal/${dealId}`)).body;
  const meta6 = (await S(sup, "GET", "/meta")).body;
  const stageName = id => meta6.pipelines.flatMap(p => p.stages).find(s => s.id === id).name;
  ok("§6 'Connected – interested' made the deal, in Contacted", pre.status === 201 && stageName(st0) === "Contacted");
  ok("§6 a Meeting booked outcome moves the deal to Meeting booked", mb.status === 201 && mb.body.dealId === dealId && stageName(dealAfter.record.stage_id) === "Meeting booked", [mb.body, stageName(dealAfter.record.stage_id)]);
  const mt = dealAfter.timeline.find(a => a.kind === "meeting");
  const nyHour = mt && new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: false }).format(new Date(mt.at));
  ok("§6 the meeting is on the deal at 10:30 New York, with its place and who's attending", mt && nyHour === "10:30" && TODAY.civil(mt.at, TZ) === meetDay && mt.meeting.place === "https://zoom.example.org/j/123" && /Marisol/.test(mt.meeting.attendees), [nyHour, mt && mt.meeting]);
  const invite = dealAfter.timeline.find(a => a.kind === "task" && /^Send the calendar invite/.test(a.body));
  ok("§6 a 'send the calendar invite' task is due today; Steward sends no invite", invite && invite.due_on === today && !invite.done_at, invite);
  const home6 = (await S(sup, "GET", "/home")).body.today;
  ok("§6 the booked meeting shows on Today", home6.lines.booked.some(r => r.id === mt.id) && typeof home6.sentences.booked === "string");
  // The day after: Today asks "How did it go?" (pure, at the meeting day + 1).
  const later = TODAY.buildToday({ meetings: [{ id: mt.id, at: mt.at, body: mt.body, outcome: null, records: [{ type: "deal", id: dealId, name: "x" }] }] }, Date.parse(`${TODAY.addDays(meetDay, 1)}T15:00:00Z`), TZ);
  ok("§6 the day after, Today asks 'How did it go?'", later.lines.howDidItGo.length === 1 && later.lines.howDidItGo[0].id === mt.id && later.lines.booked.length === 0);
  const asked = await S(sup, "POST", `/meetings/${mt.id}/after`, { outcome: "demo_done" });
  const dealDone = (await S(sup, "GET", `/rec/deal/${dealId}`)).body;
  ok("§6 one click (Demo done) moves the deal and answers the question", asked.status === 200 && stageName(dealDone.record.stage_id) === "Demo done" && dealDone.timeline.find(a => a.id === mt.id).outcome === "demo_done");
  const lostNo = await S(sup, "POST", `/meetings/${mt.id}/after`, { outcome: "lost" });
  ok("§6 Lost from 'How did it go?' needs a reason", lostNo.status === 400 && lostNo.body.need === "lost_reason");
  const direct = await S(sup, "POST", "/meetings", { orgId: grOrg.id, contactIds: [rufus.id], date: meetDay, time: "14:00", place: "Their office (made-up)" });
  const dDeal = (await S(sup, "GET", `/rec/deal/${direct.body.dealId}`)).body;
  ok("§6 booking from an organization with no open deal makes the deal in Meeting booked", direct.status === 201 && stageName(dDeal.record.stage_id) === "Meeting booked" && dDeal.linked.org[0].id === grOrg.id);

  ok("§6 an organization with a meeting ahead (or reached today) offers no one else to call",
    CM.buildQueue({ orgs: [{ id: "o1" }], done: new Set(), blocked: new Set(), lastCall: new Map(), orgBusy: new Set(["o1"]),
      contactsByOrg: new Map([["o1", [{ id: "c1", role: "Development Director", phones: ["2"] }]]]) }, today).length === 0);

  // ── §0 · THE NEW ROUTES ARE BEHIND THE SAME DOOR ───────────────────────────────────
  const probes = [["GET", "/lists"], ["POST", "/lists", { name: "x" }], ["GET", "/call/queue"], ["POST", "/call/outcome", {}], ["POST", "/meetings", {}],
    ["GET", "/email/fill"], ["POST", "/email/drafted", {}], ["POST", `/rec/org/${bram.id}/dnc`, { reason: "x" }]];
  const leaks = [];
  for (const [mm, p, b] of probes) { const r = await S(adm, mm, p, b); if (r.status !== 404) leaks.push(`${mm} ${p} → ${r.status}`); }
  ok("§0 an org admin gets 404 on every new sales route", leaks.length === 0, leaks);

  await wipeSales();
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* */ } process.exit(1); });
