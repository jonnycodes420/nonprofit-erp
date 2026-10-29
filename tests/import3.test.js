// tests/import3.test.js: IMPORT-3. IMPORT ADAPTS TO ANY SPREADSHEET.
//
// Two parts, one suite (the one new test this build may add):
//
// import3-event-sheet · Allie's event night (tests/fixtures/import/
//   event-gifts-sheet-scrubbed.xlsx: fake names, the real shape and amounts)
//   goes into an EMPTY org through the real routes:
//   §1  Steward asks only two things: when (no date column) and the one row
//       whose Completed is blank. Never "shape unclear", never 0 rows.
//   §2  The commit reads all 106 rows: gifts plus pledges for this year come
//       to the total row's $124,290, and the total row is skipped and checked.
//   §3  Completed = No is an open pledge; the seven "x 3 years" rows are
//       pledges of their 3 Yr Total with three yearly instalments.
//   §4  The 29 joint names are 29 households of two people each.
//   §5  Every gift and pledge links to the event, on the chosen date.
//   §6  Methods map to Steward's words; Other keeps the file's own text.
//   §7  "Reccuring" flags a monthly giver to confirm.
//   §8  A second import of the same file adds nothing.
//   §9  Undo removes all of it: gifts, pledges, people, households, the event.
//   §10 Privacy mode: a person marked as a client is never made a donor.
//
// import3-anything · the 27-file messy set (tests/fixtures/import/messy,
//   answer key computed by make.cjs from its own rows, never by the reader).
//   Each file goes into its own empty org: understand, then commit, then the
//   database is read back (people, households, gifts and cents, pledges and
//   cents, rows set aside). At least 24 must import exactly right in one
//   pass, and every file that is not exactly right must have stopped at
//   "Help me with these" (ready = false, commit refused), never imported.
//
// HOW IT WOULD GO RED: on main the routes do not exist (404). With the reader's
// total-row rule removed, the event sheet imports a nameless $124,290 row
// (§2 doubles); with the joint-name split removed, §4 finds 0 households; with
// the "no name and it foots" rule loosened to "no name", PayPal's withdrawal
// becomes a total and the messy count drops; with clients not checked, §10
// makes a donor of a client.
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");   // HARDEN-1
async function surfacesAgree(label, orgId, token) {
  const r = await assertSurfacesAgree(orgId, { token, soft: true, label });
  ok(`every surface agrees ${label} (${r.ms}ms)`, r.ok, r.diffs.length);
  for (const d of r.diffs) console.log("        " + d);
}


const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import");
const EVENT_FILE = path.join(FX, "event-gifts-sheet-scrubbed.xlsx");
const MESSY = path.join(FX, "messy");
const EXPECTED = JSON.parse(fs.readFileSync(path.join(MESSY, "expected.json"), "utf8"));
const PASSWORD = "loadtest1234";
const TABLES = ["pledge_installments", "pledges", "thank_you_drafts", "interactions", "gifts", "events", "fin_transactions", "imports",
  "donor_scores", "readouts", "tasks", "donors", "households", "fin_funds", "budgets", "accounts", "users"];

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

async function eventSheet() {
  const ORG = "org_import3e";
  const tok = await freshOrg(ORG, "Justin's Place (test)");
  const sheets = await sheetsOf(EVENT_FILE);
  const body = { fileName: "Finding Joy Dinner Gifts.xlsx", sheets };

  // §1: what Steward understood, and what it asks
  const u = await api("POST", "/sheet-import/understand", tok, body);
  ok("§1 understand answers 200", u.status === 200, u.status + " " + JSON.stringify(u.body).slice(0, 200));
  const U = u.body || {};
  ok("§1 the sheet is a gifts file, read from row 1", U.fileKind === "gifts" && U.tables && U.tables.length === 1 && U.tables[0].headerLine === 1, JSON.stringify(U.tables && U.tables.map(t => [t.kind, t.headerLine])));
  const roles = Object.fromEntries((U.tables[0].columns || []).map(c => [c.header, c.role]));
  ok("§1 Last and First are a person's name; 3 Yr Total is the pledge total", roles.Last === "last" && roles.First === "first" && roles.Amount === "amount"
     && roles.Method === "method" && roles.Frequency === "frequency" && roles.Completed === "paid" && roles["3 Yr Total"] === "pledgeTotal", JSON.stringify(roles));
  const qs = (U.questions || []).map(x => x.id);
  const evQ = (U.questions || []).find(x => x.id === "event") || {};
  ok("§1 it asks when (no date column), naming the event by the file's name (IMPORT-5: required)", evQ.required === true && evQ.suggestedEventName === "Finding Joy Dinner", JSON.stringify(evQ));
  ok("§1 and the one blank Completed, by row number, the pledges' due date, and nothing else", qs.length === 3 && qs.includes("row:Sheet1:26") && qs.includes("pledgeDue"), JSON.stringify(qs));
  ok("§1 the stray note in column K is a note, not a column", (U.notes || []).some(n => /matching gift/.test(n.text)) && !(U.tables[0].columns || []).some(c => c.index === 10), JSON.stringify(U.notes));

  const answers = { date: "2026-10-22", eventName: "Finding Joy Dinner", linkEvent: true, rows: { "Sheet1:26": "gift" } };
  const u2 = await api("POST", "/sheet-import/understand", tok, { ...body, answers });
  ok("§1 answered, it is ready, 135 people new and none matched (an empty org)", u2.body.ready === true && u2.body.newPeople === 135 && u2.body.matchedPeople === 0, JSON.stringify({ r: u2.body.ready, n: u2.body.newPeople, m: u2.body.matchedPeople, q: u2.body.questions }));
  ok("§2 the review states the total row's check in words", (u2.body.totalsSentence || [])[0] === "Your total row says $124,290, and the 106 rows above it add up to $124,290: 63 gifts ($45,340), $78,950 promised and not yet received (43 rows).", JSON.stringify(u2.body.totalsSentence));
  const before = await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [ORG]);
  ok("§1 understand wrote nothing", before.n === 0);

  // the commit
  const run1 = "imp_import3e_one";
  const c1 = await api("POST", "/sheet-import/commit", tok, { ...body, answers, importId: run1 });
  ok("§2 commit answers 201", c1.status === 201, c1.status + " " + JSON.stringify(c1.body).slice(0, 300));
  await surfacesAgree("after the import", ORG, tok);
  const g = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1", [ORG]);
  const p = await one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM pledges WHERE org_id=$1`, [ORG]);
  const pThisYear = await one(`SELECT COALESCE(SUM(i.amount),0)::numeric AS s FROM pledge_installments i JOIN pledges p ON p.id=i.pledge_id
                                WHERE p.org_id=$1 AND i.seq=1 AND i.paid_gift_id IS NULL`, [ORG]);
  ok("§2 106 rows read: 63 gifts and 43 pledges", g.n === 63 && p.n === 43, JSON.stringify({ g, p }));
  ok("§2 gifts plus this year's pledges come to the total row's $124,290", centsOf(g.s) + centsOf(pThisYear.s) === 12429000, JSON.stringify({ g: g.s, p: pThisYear.s }));
  ok("§2 no gift is the total row", !(await q("SELECT 1 FROM gifts WHERE org_id=$1 AND amount >= 124290", [ORG])).length);
  ok("§2 the commit's totals check matches", (c1.body.totals || []).every(t => t.matches) && (c1.body.totals || []).length === 2, JSON.stringify(c1.body.totals));

  // §3 pledges
  const open = await q("SELECT p.amount::numeric AS amount, p.status, p.installment_count FROM pledges p WHERE p.org_id=$1", [ORG]);
  ok("§3 every Completed = No row is an open pledge", open.length === 43 && open.every(r => r.status === "open"), JSON.stringify(open.slice(0, 3)));
  const multi = await q(`SELECT p.amount::numeric AS amount, p.installment_count AS n,
                                (SELECT SUM(amount) FROM pledge_installments i WHERE i.pledge_id=p.id)::numeric AS sched,
                                (SELECT MIN(due_date) FROM pledge_installments i WHERE i.pledge_id=p.id) AS first_due,
                                (SELECT MAX(due_date) FROM pledge_installments i WHERE i.pledge_id=p.id) AS last_due
                           FROM pledges p WHERE p.org_id=$1 AND p.installment_count=3 ORDER BY p.amount`, [ORG]);
  const want3 = [750, 900, 3000, 3000, 6000, 9000, 15000];
  ok("§3 the seven three-year rows are pledges of their 3 Yr Total", multi.length === 7 && multi.map(r => Number(r.amount)).join() === want3.join(), JSON.stringify(multi.map(r => r.amount)));
  ok("§3 each schedules three yearly instalments that sum to it, from the event", multi.every(r => Number(r.sched) === Number(r.amount) && r.first_due === "2026-10-22" && r.last_due === "2028-10-22"), JSON.stringify(multi[0]));

  // §4 households
  const hh = await q(`SELECT h.id, COUNT(d.id)::int AS members FROM households h JOIN donors d ON d.household_id=h.id WHERE h.org_id=$1 GROUP BY h.id`, [ORG]);
  ok("§4 29 joint names are 29 households of two people", hh.length === 29 && hh.every(h => h.members === 2), JSON.stringify(hh.slice(0, 3)));
  const people = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1", [ORG]);
  ok("§4 135 people in all (106 rows, 29 of them couples)", people.n === 135, people.n);

  // §5 the event
  const ev = await q("SELECT id, name, date::text AS date FROM events WHERE org_id=$1", [ORG]);
  ok("§5 the event was created once, on the chosen date", ev.length === 1 && ev[0].name === "Finding Joy Dinner" && ev[0].date === "2026-10-22", JSON.stringify(ev));
  const linked = await one(`SELECT COUNT(*) FILTER (WHERE event_id=$2 AND date='2026-10-22')::int AS ok, COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG, ev[0] && ev[0].id]);
  const plinked = await one(`SELECT COUNT(*) FILTER (WHERE event_id=$2)::int AS ok, COUNT(*)::int AS n FROM pledges WHERE org_id=$1`, [ORG, ev[0] && ev[0].id]);
  ok("§5 every gift and pledge links to it, dated the event day", linked.ok === linked.n && plinked.ok === plinked.n && linked.n > 0, JSON.stringify({ linked, plinked }));

  // §6 methods
  const methods = await q(`SELECT payment_method, COUNT(*)::int AS n FROM gifts WHERE org_id=$1 GROUP BY 1 ORDER BY 1`, [ORG]);
  const mset = new Set(methods.map(m => m.payment_method));
  ok("§6 Online and Credit are Card; Check and Cash stay; no raw file words as methods", [...mset].every(m => ["Card", "Check", "Cash", "Stock", "Qualified charitable distribution", "Foundation", "Other"].includes(m)), JSON.stringify(methods));
  const miss = await q(`SELECT payment_method, notes FROM gifts WHERE org_id=$1 AND notes LIKE '%Online (Miss)%'`, [ORG]);
  ok("§6 \"Online (Miss)\" is Other with the file's text kept on the gift", miss.length === 2 && miss.every(m => m.payment_method === "Other"), JSON.stringify(miss));
  const blankM = await q(`SELECT payment_method FROM gifts WHERE org_id=$1 AND notes LIKE '%Method in your file: blank%'`, [ORG]);
  ok("§6 the blank method is Other, said as blank", blankM.length === 1 && blankM[0].payment_method === "Other", JSON.stringify(blankM));
  const pledgeNotes = await q(`SELECT notes FROM pledges WHERE org_id=$1 AND (notes LIKE '%UNKNOWN%' OR notes LIKE '%Retirement Dist%' OR notes LIKE '%Investment%')`, [ORG]);
  ok("§6 a pledge keeps its method's original words in its note", pledgeNotes.length >= 3, pledgeNotes.length);

  // §7 monthly
  const monthly = await q("SELECT name, imported_sustainer_amount::numeric AS a FROM donors WHERE org_id=$1 AND imported_sustainer IS TRUE", [ORG]);
  ok("§7 the \"Reccuring\" row is flagged as a monthly giver to confirm", monthly.length === 1 && Number(monthly[0].a) === 100, JSON.stringify(monthly));

  // §8 again
  const c2 = await api("POST", "/sheet-import/commit", tok, { ...body, answers, importId: "imp_import3e_two" });
  const g2 = await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [ORG]);
  const p2 = await one("SELECT COUNT(*)::int AS n FROM pledges WHERE org_id=$1", [ORG]);
  const d2 = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1", [ORG]);
  const e2 = await one("SELECT COUNT(*)::int AS n FROM events WHERE org_id=$1", [ORG]);
  const h2 = await one("SELECT COUNT(*)::int AS n FROM households WHERE org_id=$1", [ORG]);
  ok("§8 a second import adds nothing", c2.status === 201 && c2.body.giftsCreated === 0 && c2.body.pledgesCreated === 0 && c2.body.donorsCreated === 0
     && g2.n === 63 && p2.n === 43 && d2.n === 135 && e2.n === 1 && h2.n === 29, JSON.stringify({ s: c2.status, b: c2.body && c2.body.sentence, g2, p2, d2, e2, h2 }));

  // §9 undo the first run (the second wrote nothing, and undoes to nothing)
  const un = await api("POST", `/imports/${run1}/reverse`, tok, {});
  ok("§9 undo answers 200", un.status === 200, un.status + " " + JSON.stringify(un.body));
  const left = await one(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS g, (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS p,
                                 (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS d, (SELECT COUNT(*) FROM households WHERE org_id=$1)::int AS h,
                                 (SELECT COUNT(*) FROM events WHERE org_id=$1)::int AS e, (SELECT COUNT(*) FROM pledge_installments WHERE org_id=$1)::int AS i`, [ORG]);
  ok("§9 undo removes the whole import", left.g === 0 && left.p === 0 && left.d === 0 && left.h === 0 && left.e === 0 && left.i === 0, JSON.stringify(left));
  await surfacesAgree("after the undo", ORG, tok);

  // §10 privacy mode
  const PORG = "org_import3p";
  const ptok = await freshOrg(PORG, "Privacy test");
  await q("UPDATE orgs SET client_privacy=true WHERE id=$1", [PORG]);
  await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,is_client,created_by,created_by_name) VALUES ('d_imp3client',$1,'Alma Ibarra','prospect','active','[]',true,'system:test','test')`, [PORG]);
  const csv = "Name,Amount,Date\nAlma Ibarra,100,2026-03-01\nTheo Jennings,200,2026-03-02\n";
  const pbody = { fileName: "gifts.csv", sheets: [{ name: "Sheet1", grid: R.gridFromText(csv) }] };
  const pc = await api("POST", "/sheet-import/commit", ptok, { ...pbody, importId: "imp_import3p_one" });
  const pg = await q("SELECT d.name, d.is_client FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1", [PORG]);
  const pd = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1", [PORG]);
  ok("§10 a client's row is set aside, never a gift; the other imports", pc.status === 201 && pg.length === 1 && pg[0].name === "Theo Jennings" && pd.n === 2 && pc.body.aside === 1, JSON.stringify({ s: pc.status, pg, pd, b: pc.body }));
}

async function anything() {
  const results = [];
  let i = 0;
  for (const [file, { expect: e, answers }] of Object.entries(EXPECTED)) {
    i++;
    const ORG = `org_import3m_${String(i).padStart(2, "0")}`;
    const tok = await freshOrg(ORG, "Messy " + file);
    const body = { fileName: file, sheets: await sheetsOf(path.join(MESSY, file)), answers };
    const u = await api("POST", "/sheet-import/understand", tok, body);
    const U = u.body || {};
    const row = { file, understood: `${U.fileKind}: ${(U.tables || []).filter(t => t.kind === "gifts" || t.kind === "people").map(t => `${t.sheet} row ${t.headerLine}`).join(" + ")}`, ready: U.ready, exact: false, stopped: false };
    if (!U.ready) {
      const c = await api("POST", "/sheet-import/commit", tok, { ...body, importId: `imp_import3m_${i}` });
      const wrote = await one("SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int + (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS n", [ORG]);
      row.stopped = c.status === 409 && wrote.n === 0 && (U.questions || []).length > 0;
      row.exact = !!e.stopsAtHelp && row.stopped && (e.helpColumns || []).every(h => (U.questions || []).some(x => x.kind === "column" && x.header === h));
      row.got = `stopped at Help: ${(U.questions || []).map(x => x.header || x.text).join("; ")}`;
    } else {
      const c = await api("POST", "/sheet-import/commit", tok, { ...body, importId: `imp_import3m_${i}` });
      const got = await one(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS people,
                                    (SELECT COUNT(*) FROM households WHERE org_id=$1)::int AS households,
                                    (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND kind='organisation')::int AS organizations,
                                    (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS gifts,
                                    (SELECT COALESCE(ROUND(SUM(amount)*100),0) FROM gifts WHERE org_id=$1)::bigint AS gift_cents,
                                    (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS pledges,
                                    (SELECT COALESCE(ROUND(SUM(amount)*100),0) FROM pledges WHERE org_id=$1)::bigint AS pledge_cents`, [ORG]);
      const g = { people: got.people, households: got.households, organizations: got.organizations, gifts: got.gifts, giftCents: Number(got.gift_cents),
                  pledges: got.pledges, pledgeCents: Number(got.pledge_cents), aside: c.body && c.body.aside };
      const keys = ["people", "households", "organizations", "gifts", "giftCents", "pledges", "pledgeCents", "aside"];
      row.exact = c.status === 201 && !e.stopsAtHelp && keys.every(k => g[k] === e[k])
        && (e.totalsMatch == null || ((c.body.totals || []).length === e.totalsMatch && c.body.totals.every(t => t.matches)));
      if (e.dates) {
        const ds = (await q("SELECT date FROM gifts WHERE org_id=$1 ORDER BY date", [ORG])).map(r => String(r.date).slice(0, 10));
        row.exact = row.exact && ds.join() === [...e.dates].sort().join();
      }
      const future = await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND date > to_char(NOW() + interval '1 day','YYYY-MM-DD')", [ORG]);
      row.exact = row.exact && future.n === 0;
      row.got = `${g.people} people, ${g.gifts} gifts ($${(g.giftCents / 100).toLocaleString()}), ${g.pledges} pledges ($${(g.pledgeCents / 100).toLocaleString()}), ${g.aside} set aside`;
      if (!row.exact) row.diff = JSON.stringify({ expected: e, got: g, status: c.status });
    }
    results.push(row);
  }
  const exact = results.filter(r => r.exact).length;
  for (const r of results) console.log(`   ${r.exact ? "exact " : r.stopped ? "help  " : "WRONG "} ${r.file} · ${r.understood} · ${r.got}${r.diff ? "\n        " + r.diff : ""}`);
  ok(`import3-anything: at least 24 of ${results.length} files import exactly right in one pass`, exact >= 24 && results.length >= 25, `${exact}/${results.length}`);
  ok("import3-anything: every file that is not exactly right stopped at Help me with these", results.every(r => r.exact || r.stopped),
     results.filter(r => !r.exact && !r.stopped).map(r => r.file).join(", "));
  if (process.env.IMPORT3_TABLE) fs.writeFileSync(process.env.IMPORT3_TABLE, JSON.stringify(results, null, 2));
}

(async () => {
  try {
    console.log("import3-event-sheet");
    await eventSheet();
    console.log("import3-anything");
    await anything();
  } catch (e) {
    ok("suite ran without throwing", false, e && e.stack);
  } finally {
    await closeDb();
    summary();
  }
})();
