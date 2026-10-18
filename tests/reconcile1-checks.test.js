// tests/reconcile1-checks.test.js · RECONCILE-1. AN OLD REPORT IS CHECKED
// AGAINST STEWARD, AND SAYS WHERE THEY DISAGREE.
//
// The one test this build earns: it guards money figures a board reads (what
// an old report says against what Steward holds) and the line REPORTS-5 drew,
// that an old report's total never becomes a gift.
//
//   §match     a CSV giving summary that agrees with Steward says "Matches
//              Steward to the cent".
//   §differ    a by-donor-and-fund file that says $2,545.40 more shows that
//              difference to the cent, names the fund Steward has no match
//              for and the three people it has no record of, and every
//              Steward figure in the check opens rows that foot to it.
//   §add       "Add this person" adds one person (no gift) and Undo takes
//              them back out; the check moves both ways.
//   §nogift    no step above writes a gift.
//   §baseline  "Use as last year's total" changes nothing until it is clicked;
//              after the click Goals and the giving summary compare against
//              the report's total, labelled "from your old system".
//   §recheck   importing a CSV of the missing gifts re-runs the check (the
//              after-change step) and it now matches.
//   §tenant    another org reads none of it.
//
// RED ON MAIN (2026-10-15): there is no check at all (no route, no line on
// the import, no baseline), so §match onward fail at the first assertion.
//
// WHAT WOULD MAKE IT FAIL (planted before it was trusted): reconcile.js
// treating an unmatched fund label as matched; the import route skipping the
// check; historicalGiving({baseline}) ignoring the click; afterChange not
// scheduling the re-check.
//
//   BASE=http://localhost:5601 node tests/reconcile1-checks.test.js
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api, waitFor } = require("./helpers");

const ORG = "org_rc1checks";
const OTHER = "org_rc1other";
const ADMIN = "director@rc1checks.local";
const OTHER_ADMIN = "director@rc1other.local";
const Y = new Date().getFullYear();
const OLD = Y - 3;             // the year Steward has gifts for
const B2 = Y - 2, B1 = Y - 1;  // two years Steward has no gifts for
const csvUrl = text => `data:text/csv;base64,${Buffer.from(text, "utf8").toString("base64")}`;

async function clear(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
const giftCount = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]))[0].n);

// One file in, the way the wizard does it: read, then kept with its numbers pulled in.
async function bring(tok, fileName, csv, kind, from, to, mapping) {
  const read = await api("POST", "/old-reports/read", tok, { fileName, file: csvUrl(csv) });
  const batch = await api("POST", "/old-reports/batches", tok, {});
  const kept = await api("POST", `/old-reports/batches/${batch.body.id}/files`, tok,
    { fileName, file: csvUrl(csv), kind, system: "donorperfect", periodFrom: from, periodTo: to, pull: true, mapping: mapping || read.body.mapping });
  return { read, batch: batch.body, kept };
}

// Every Steward figure in a check opens rows, and they foot to it.
async function opensAndFoots(tok, src, cents, kind) {
  const qs = new URLSearchParams({ ...src.params, pageSize: "200" }).toString();
  const r = await api("GET", `/figures/${src.key}/rows?${qs}`, tok);
  if (r.status !== 200) return { ok: false, why: r.status };
  if (kind === "count") return { ok: r.body.totalRows === cents && r.body.value === cents, why: [r.body.totalRows, cents] };
  const sum = r.body.rows.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0);
  return { ok: r.body.cents === cents && sum === cents && r.body.totalRows <= 200, why: [r.body.cents, sum, cents] };
}

(async () => {
  console.log("reconcile1-checks");
  await clear(ORG); await clear(OTHER);
  for (const [org, slug, email, uid] of [[ORG, "rc1checks", ADMIN, "u_rc1"], [OTHER, "rc1other", OTHER_ADMIN, "u_rc1_o"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, `RC1 ${slug}`, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Checker','admin')`, [uid, org, email, bcrypt.hashSync("loadtest1234", 4)]);
  }
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_rc1_gen',$1,'General Operating',false)`, [ORG]);
  const people = [["ada", "Ada Ledger", 100000], ["ben", "Ben Tally", 25050], ["cy", "Cy Column", 50000], ["dee", "Dee Footing", 7525]];
  for (const [k, name, c] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,status,created_by,created_by_name) VALUES ($1,$2,$3,$4,'steward','active','system:test','test')`,
      [`d_rc1_${k}`, ORG, name, `${k}@rc1.test`]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id) VALUES ($1,$2,$3,$4,$5,'cash','fund_rc1_gen')`,
      [`g_rc1_${k}`, ORG, `d_rc1_${k}`, (c / 100).toFixed(2), `${OLD}-05-1${people.findIndex(p => p[0] === k)}`]);
  }
  const tok = await login(ADMIN);
  const otherTok = await login(OTHER_ADMIN);
  const giftsAtStart = await giftCount();

  // ── §match ─────────────────────────────────────────────────────────────
  const matchCsv = `Year,Total Raised,# of Gifts,Donors\n${OLD},"$1,825.75",4,4\n`;
  const m = await bring(tok, `giving-summary-${OLD}.csv`, matchCsv, "giving_summary", `${OLD}-01-01`, `${OLD}-12-31`);
  ok("§match the summary is kept with its numbers", m.kept.status === 201 && m.kept.body.totals?.count === 1, m.kept.body);
  ok("§match the import's readout says it matches", m.kept.body.check?.sentence === "Matches Steward to the cent.", m.kept.body.check);
  const mc = await api("GET", `/old-reports/${m.kept.body.sheetId}/check`, tok);
  ok("§match total, gifts and donors each match", ["total", "gifts", "donors"].every(k => (mc.body.check?.lines || []).find(l => l.key === k)?.status === "matches"), mc.body.check?.lines);
  ok("§match QuickBooks is not checked, and says why", (mc.body.check?.lines || []).find(l => l.key === "quickbooks")?.status === "not_checked", mc.body.check?.lines);

  // ── §differ ────────────────────────────────────────────────────────────
  const rows = [["Ada Ledger", "ada@rc1.test", "General Operating", 1, "$1,000.00"], ["Ben Tally", "ben@rc1.test", "General Operating", 1, "$250.50"],
    ["Cy Column", "cy@rc1.test", "General Operating", 1, "$500.00"], ["Dee Footing", "dee@rc1.test", "General Operating", 1, "$75.25"],
    ["Ada Ledger", "ada@rc1.test", "Capital Fund", 1, "$2,000.00"], ["Ben Tally", "ben@rc1.test", "Capital Fund", 1, "$300.00"],
    ["Eve Margin", "eve@rc1.test", "General Operating", 1, "$120.00"], ["Fay Ledgerly", "fay@rc1.test", "General Operating", 1, "$80.40"],
    ["Gus Accrual", "gus@rc1.test", "General Operating", 1, "$45.00"]];
  const diffCsv = "Donor Name,Email,Fund Description,# of Gifts,Gift Total\n" + rows.map(r => r.map(v => /,/.test(String(v)) ? `"${v}"` : v).join(",")).join("\n") + `\nTotal,,,9,"$4,371.15"\n`;
  const d = await bring(tok, `donorperfect-by-donor-${OLD}.csv`, diffCsv, "by_fund", `${OLD}-01-01`, `${OLD}-12-31`);
  const sheet = d.kept.body.sheetId;
  ok("§differ the file is kept, and foots to its own Total line", d.kept.status === 201 && d.kept.body.totals?.footsToFile === true, d.kept.body.totals);
  ok("§differ the readout says the difference to the cent",
    d.kept.body.check?.sentence === `Your ${OLD} giving by fund report says $4,371.15. Steward has $1,825.75 for ${OLD}. $2,545.40 is missing.`, d.kept.body.check);
  const dc = (await api("GET", `/old-reports/${sheet}/check`, tok)).body.check;
  const cause = k => (dc.causes || []).find(c => c.key === k);
  ok("§differ the unmapped fund is named, with its dollars", cause("unmapped_fund")?.label === "Capital Fund" && cause("unmapped_fund")?.cents === 230000, dc.causes);
  ok("§differ the three people Steward has no record of are named", JSON.stringify((cause("missing_people")?.people || []).map(p => p.name).sort()) === JSON.stringify(["Eve Margin", "Fay Ledgerly", "Gus Accrual"])
    && cause("missing_people")?.cents === 24540, cause("missing_people"));
  ok("§differ the two causes account for all of it, and nothing is left unexplained", !cause("cannot_tell") && !!cause("all_explained"), dc.causes);
  const total = dc.lines.find(l => l.key === "total");
  ok("§differ the total line differs by $2,545.40", total.status === "differs" && total.reportCents - total.stewardCents === 254540, total);
  ok("§differ the unmapped fund's line offers Map", dc.lines.find(l => l.key === "fund:capital fund")?.action?.kind === "map_fund", dc.lines);
  const opened = [];
  for (const l of dc.lines.filter(x => x.source)) opened.push([l.key, await opensAndFoots(tok, l.source, l.stewardCents, l.kind)]);
  for (const p of dc.people?.differing || []) for (const r of p.records) opened.push([p.name, await opensAndFoots(tok, r.source, r.cents, "money")]);
  ok("§differ every Steward figure opens rows that foot to it", opened.length >= 5 && opened.every(([, r]) => r.ok), opened);

  // ── §add ───────────────────────────────────────────────────────────────
  const add = await api("POST", `/old-reports/${sheet}/add-person`, tok, { name: "Eve Margin", email: "eve@rc1.test" });
  const [eve] = await q(`SELECT id, deleted_at, created_by FROM donors WHERE org_id=$1 AND email='eve@rc1.test'`, [ORG]);
  ok("§add Add this person adds Eve, stamped with who did it", add.status === 201 && eve && !eve.deleted_at && eve.created_by === "u_rc1", [add.body, eve]);
  ok("§add …and the check now lists two people, not three", (add.body.check?.causes || []).find(c => c.key === "missing_people")?.people?.length === 2, add.body.check?.causes);
  // Found by the walk: once added, her report amount is a person in Steward
  // with no gifts there, said so, never "can't tell why".
  const addCauses = add.body.check?.causes || [];
  ok("§add …and her $120 is said as 'in Steward with no gifts there', nothing left unexplained",
    addCauses.find(c => c.key === "no_gifts_in_steward")?.cents === 12000 && !addCauses.some(c => c.key === "cannot_tell"), addCauses.map(c => [c.key, c.cents]));
  const again = await api("POST", `/old-reports/${sheet}/add-person`, tok, { name: "Eve Margin", email: "eve@rc1.test" });
  ok("§add the same person is never added twice", again.status === 409, again.body);
  const undo = await api("POST", `/old-reports/${sheet}/add-person/undo`, tok, { donorId: add.body.donorId });
  const [eveAfter] = await q(`SELECT deleted_at FROM donors WHERE id=$1`, [add.body.donorId]);
  ok("§add Undo takes her back out", undo.status === 200 && !!eveAfter.deleted_at, undo.body);
  ok("§add …and the check lists three again", (undo.body.check?.causes || []).find(c => c.key === "missing_people")?.people?.length === 3, undo.body.check?.causes);
  const audited = await waitFor(async () => {
    const [a] = await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE '/old-reports/%/add-person%'`, [ORG]);
    return a.n >= 2 ? a : null;
  }, { timeout: 5000 }).catch(() => null);
  ok("§add both writes are in the one audit trail", !!audited, audited);

  // ── §baseline ──────────────────────────────────────────────────────────
  const yearsCsv = `Year,Total Raised\n${B2},"$40,000.00"\n${B1},"$45,500.00"\n`;
  const yb = await bring(tok, `giving-summary-${B2}-${B1}.csv`, yearsCsv, "giving_summary", `${B2}-01-01`, `${B1}-12-31`);
  ok("§baseline a two-year summary comes in", yb.kept.status === 201 && yb.kept.body.totals?.count === 2, yb.kept.body);
  const goal = await api("POST", "/goals", tok, { label: `${Y} goal`, goalAmount: 50000, goalType: "total_raised", periodStart: `${Y}-01-01`, periodEnd: `${Y}-12-31` });
  const summaryCmp = async () => (await api("GET", `/reports/giving-summary?from=${B1}-01-01&to=${B1}-12-31&yearMode=calendar`, tok)).body?.comparison;
  const before = { goal: (await api("GET", "/goals/active", tok)).body, cmp: await summaryCmp() };
  ok("§baseline before the click, Goals has no last year to compare against", goal.status === 201 && before.goal && before.goal.lastYear === null, before.goal);
  ok("§baseline before the click, the giving summary does not stand the report in", !!before.cmp && !before.cmp.imported, before.cmp);
  const set1 = await api("POST", "/old-reports/baseline", tok, { from: `${B1}-01-01`, to: `${B1}-12-31`, sheetId: yb.kept.body.sheetId });
  const set2 = await api("POST", "/old-reports/baseline", tok, { from: `${B2}-01-01`, to: `${B2}-12-31`, sheetId: yb.kept.body.sheetId });
  const after = { goal: (await api("GET", "/goals/active", tok)).body, cmp: await summaryCmp() };
  ok("§baseline after the click, Goals compares against $45,500, from your old system",
    set1.status === 200 && after.goal.lastYear?.value === 45500 && after.goal.lastYear?.imported === true && /from your old system/.test(after.goal.lastYear?.label), after.goal.lastYear);
  ok("§baseline …and the giving summary against $40,000, labelled",
    set2.status === 200 && after.cmp?.imported === true && after.cmp?.value === 40000 && /from your old system/.test(after.cmp?.label), after.cmp);
  const unset = await api("POST", "/old-reports/baseline", tok, { from: `${B1}-01-01`, to: `${B1}-12-31`, sheetId: set1.body.previousSheetId });
  ok("§baseline Undo clears it", unset.status === 200 && (await api("GET", "/goals/active", tok)).body.lastYear === null, unset.body);

  // ── §nogift ────────────────────────────────────────────────────────────
  ok("§nogift no report total, check, person, fund map or baseline wrote a gift", (await giftCount()) === giftsAtStart, [await giftCount(), giftsAtStart]);
  const [ht] = await q(`SELECT COUNT(*)::int AS n FROM historical_totals WHERE org_id=$1`, [ORG]);
  ok("§nogift the numbers are kept as historical totals instead", ht.n === 1 + rows.length + 2, ht);

  // ── §tenant ────────────────────────────────────────────────────────────
  const peek = await api("GET", `/old-reports/${sheet}/check`, otherTok);
  const poke = await api("POST", `/old-reports/${sheet}/add-person`, otherTok, { name: "Mallory", email: "m@rc1.test" });
  ok("§tenant another org cannot read or act on the check", peek.status === 404 && poke.status === 404, [peek.status, poke.status]);

  // ── §recheck ───────────────────────────────────────────────────────────
  const checkedAt = (await api("GET", `/old-reports/${sheet}/check`, tok)).body.check.checkedAt;
  const imp = [["Eve Margin", "eve@rc1.test", "General Operating", 120], ["Fay Ledgerly", "fay@rc1.test", "General Operating", 80.4],
    ["Gus Accrual", "gus@rc1.test", "General Operating", 45], ["Ada Ledger", "ada@rc1.test", "Capital Fund", 2000], ["Ben Tally", "ben@rc1.test", "Capital Fund", 300]];
  const run = `imp_rc1${Date.now().toString(36)}`;
  const r = await api("POST", "/donors/import-combined", tok, { importId: run,
    donors: imp.map(([name, email]) => ({ name, email })),
    gifts: imp.map(([, , fund, amount], i) => ({ donorIndex: i, amount, date: `${OLD}-08-0${i + 1}`, type: "cash", paymentMethod: "Check", fund, externalId: `RC1-${i}` })) });
  await api("POST", "/imports", tok, { id: run, name: "The missing gifts", sourceFilename: "missing.csv", shape: "gift_file_with_donors", rowsIn: imp.length, giftsCreated: imp.length, donorsCreated: 3, summary: {} });
  ok("§recheck the missing gifts are imported", r.status === 200 && r.body?.giftsInserted === imp.length, r.body);
  const re = await waitFor(async () => {
    const c = (await api("GET", `/old-reports/${sheet}/check`, tok)).body.check;
    return c && c.checkedAt !== checkedAt && c.status === "matches" ? c : null;
  }, { timeout: 30000, interval: 250 }).catch(() => null);
  const last = re || (await api("GET", `/old-reports/${sheet}/check`, tok)).body.check;
  ok("§recheck the check re-ran by itself, and now matches to the cent", !!re && re.sentence === "Matches Steward to the cent.", { status: last.status, sentence: last.sentence, causes: last.causes, checkedAt: [checkedAt, last.checkedAt] });
  const list = await api("GET", "/old-reports", tok);
  ok("§recheck Past reports carries the check and when it ran", (list.body.reports || []).find(x => x.id === sheet)?.check?.status === "matches"
    && !!(list.body.reports || []).find(x => x.id === sheet)?.check?.checkedAt, (list.body.reports || []).find(x => x.id === sheet));

  await clear(ORG); await clear(OTHER);
  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); summary(); await closeDb(); process.exit(1); });
