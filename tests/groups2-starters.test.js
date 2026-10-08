// tests/groups2-starters.test.js · GROUPS-2's one test. STARTER GROUPS.
//
//     On a fresh org holding the 1,000-donor messy file (the file Jonathan
//     imported on 7 Oct and then found "No groups yet"):
//     §1 each starter's count is the number the same question gets elsewhere:
//        LYBUNT and SYBUNT from the Reports tab (Ask reads the same report),
//        first gift this year from the giving summary's "new", gifts waiting
//        for a thank-you from Home's own figure, top tenth from the lifetime
//        ranking, do not solicit from the flags;
//     §2 a starter at 0 is hidden and counted as hidden;
//     §3 the asking starters leave out do-not-solicit people and say how many;
//     §4 adding one makes a group by rule, and recording a gift moves a person
//        out of "Gave last year, not yet this year" and into "Gave more this
//        year than last" with nothing else done;
//     §5 the preview is a GET that writes nothing, and another org cannot
//        read or add a starter into this one.
//
// Donor data: an asking list that holds a do-not-solicit donor is a donor
// asked who said not to be, and a count that differs from Reports is a list
// she cannot trust.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the PR):
//   · on main there is no /groups/starters → every section;
//   · drop `solicitable` from the asking starters → §3 "left out of the group";
//   · use Reports' wider SYBUNT unchanged → §1 "SYBUNT = Reports' SYBUNT minus LYBUNT".

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_groups2", ORG2 = "org_groups2b";
const TABLES = ["audiences", "gifts", "interactions", "tasks", "threads", "import_merges", "imports", "donors", "fin_transactions", "fin_funds", "accounts", "budgets", "users"];

async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    for (let i = 0; i < 25; i++) {
      const err = await q(`DELETE FROM orgs WHERE id=$1`, [o]).then(() => null, e => e);
      if (!err) break;
      const t = err.table || (/on table "(\w+)"/.exec(err.message || "") || [])[1];
      if (!t || t === "orgs") throw err;
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]);
    }
  }
}

async function makeOrg(id, slug, email) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, slug, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Groups Admin','admin')`,
    ["u_" + id, id, email, bcrypt.hashSync("loadtest1234", 10)]);
  return login(email);
}

// The DonorImport page's own steps, as tests/import-messy.test.js §7 drives them.
async function importThousand(tok) {
  const lib = await import("../shared/importShape.js");
  const cfs = await import("../shared/customFieldShape.js");
  const K = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fix33", "answer-key.json"), "utf8"));
  const a = lib.analyzeCsvText(fs.readFileSync(path.join(__dirname, "fixtures", "fix33", "steward-test-1000-donors-messy.csv"), "utf8"));
  const tx = lib.autoDetectTxMapping(a.headers, a.rows);
  const plan = cfs.buildMapperPlan({ headers: a.physical.headerCells, fields: a.headers, rows: a.rows, txMap: tx });
  const flagColumns = {};
  for (const c of plan.columns) if (c.status === "flag" && c.flag !== "exclusion" && c.flag !== "frequency") flagColumns[c.flag] = c.field;
  const built = lib.buildTransactionRows({ headers: a.headers, rows: a.rows }, tx,
    { rowLines: a.rowLines, today: K.anchorDate, dateConvention: "mdy", flagColumns,
      coerceCustomValue: cfs.coerceCustomValue, parseBoolValue: cfs.parseBoolValue, parseExclusionValue: cfs.parseExclusionValue });
  const byD = new Map();
  for (const g of built.gifts) { if (!byD.has(g.donorIndex)) byD.set(g.donorIndex, []); byD.get(g.donorIndex).push(g); }
  for (let start = 0; start < built.donors.length; start += 500) {
    const slice = built.donors.slice(start, start + 500);
    const cg = [];
    slice.forEach((_, li) => (byD.get(start + li) || []).forEach(g => { const { donorIndex, ...rest } = g; cg.push({ ...rest, donorIndex: li }); }));
    const r = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: cg, identityResolved: true });
    if (r.status !== 200) throw new Error("import chunk " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
  }
  return built.donors.length;
}

const byKey = list => Object.fromEntries((list.starters || []).map(s => [s.key, s]));
const figureCount = b => Number(b && (b.value ?? b.count ?? (b.figure && b.figure.value)));

(async () => {
  await reset();
  const T = await makeOrg(ORG, "groups2-starters", "groups2@test.local");
  const T2 = await makeOrg(ORG2, "groups2-other", "groups2b@test.local");
  const people = await importThousand(T);
  ok(`the 1,000-donor file imported (${people} people)`, people >= 1000, people);

  // Two LYBUNT people marked do not solicit, through the person's own record.
  const ly0 = await api("GET", "/reports/lybunt", T);
  const lyRows = (ly0.body && ly0.body.rows) || [];
  ok("Reports has a LYBUNT list on this file", ly0.status === 200 && lyRows.length > 10, { status: ly0.status, n: lyRows.length });
  const dns = lyRows.slice(0, 2).map(r => r.id);
  for (const id of dns) await q(`UPDATE donors SET do_not_solicit = true WHERE id=$1 AND org_id=$2`, [id, ORG]);

  const r0 = await api("GET", "/groups/starters", T);
  ok("GET /groups/starters answers", r0.status === 200 && Array.isArray(r0.body.starters), r0.status);
  const S = byKey(r0.body || {});

  // ── §1 THE SAME NUMBER AS EVERYWHERE ELSE ──────────────────────────────
  const ly = await api("GET", "/reports/lybunt", T);
  const sy = await api("GET", "/reports/sybunt", T);
  const lyN = ly.body.rows.length, syN = sy.body.rows.length;
  ok("§1 LYBUNT starter + those it leaves out = Reports' LYBUNT", S.lybunt && S.lybunt.count + S.lybunt.leftOut === lyN, { starter: S.lybunt, reports: lyN });
  ok("§1 SYBUNT starter + those it leaves out = Reports' SYBUNT minus LYBUNT", S.sybunt && S.sybunt.count + S.sybunt.leftOut === syN - lyN, { starter: S.sybunt, reports: syN, lyN });
  const cur = ly.body.currentPeriod;
  const fresh = await api("GET", `/figures/givers/rows?from=${cur.from}&to=${cur.to}&first=new`, T);
  const freshN = figureCount(fresh.body);
  ok("§1 First gift this year = the giving summary's new donors this fiscal year", (S.first_gift ? S.first_gift.count : 0) === freshN, { starter: S.first_gift, summary: freshN });
  const home = await api("GET", "/dashboards/people", T);
  const m = /"source":\{"key":"unthanked","params":\{"since":"(\d{4}-\d{2}-\d{2})"\}\}/.exec(JSON.stringify(home.body));
  ok("§1 Home shows its gifts-not-yet-thanked figure with its start date", !!m, home.status);
  if (m) {
    const un = await q(`SELECT COUNT(DISTINCT g.donor_id)::int n FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
                         WHERE g.org_id=$1 AND d.deleted_at IS NULL AND COALESCE(g.is_sample,false)=false AND g.date >= $2 AND COALESCE(g.acknowledgement_sent,false)=false`, [ORG, m[1]]);
    const rows = await api("GET", `/figures/unthanked/rows?since=${m[1]}`, T);
    ok("§1 Home's figure counts the gifts the starter's people hold", figureCount(rows.body) >= un[0].n, { home: figureCount(rows.body), people: un[0].n });
    ok("§1 Gifts waiting for a thank-you = the people behind Home's figure", (S.awaiting_thanks ? S.awaiting_thanks.count : 0) === un[0].n, { starter: S.awaiting_thanks, people: un[0].n });
  }
  const [{ n: givers }] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND COALESCE(total_giving,0) > 0`, [ORG]);
  const tenth = Math.ceil(givers / 10);
  const top = await api("GET", `/figures/top-lifetime/rows?top=${tenth}&measure=count`, T);
  ok("§1 Top tenth = Reports' top donors, lifetime, at a tenth of everyone who gave", S.top_tenth && S.top_tenth.count + S.top_tenth.leftOut === tenth && figureCount(top.body) === tenth,
    { starter: S.top_tenth, tenth, reports: figureCount(top.body) });
  console.log("  starters:", r0.body.starters.map(s => `${s.key} ${s.count}${s.leftOut ? ` (+${s.leftOut} left out)` : ""}`).join(" · "),
    `| hidden ${r0.body.hidden} | Reports LYBUNT ${lyN}, SYBUNT ${syN}, new ${freshN}, tenth ${tenth}`);
  ok("§1 the comparisons are not vacuous (each compared figure is above 0)", lyN > 0 && syN - lyN > 0 && freshN > 0 && tenth > 0, { lyN, syN, freshN, tenth });
  const [{ n: dnsN }] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND archived_at IS NULL AND (do_not_solicit IS TRUE OR do_not_contact IS TRUE)`, [ORG]);
  ok("§1 Do not solicit = everyone carrying either flag", S.do_not_solicit && S.do_not_solicit.count === dnsN, { starter: S.do_not_solicit, flags: dnsN });

  // ── §2 ZERO IS HIDDEN, AND SAID ────────────────────────────────────────
  const zero = r0.body.starters.filter(s => s.count === 0);
  ok("§2 no starter at 0 is shown", zero.length === 0, zero.map(s => s.key));
  ok("§2 a file with no board members, monthly plans or event guests hides those starters", !S.board && !S.monthly && !S.guests_never_gave, Object.keys(S));
  ok("§2 the hidden ones are counted", r0.body.hidden === 12 - r0.body.starters.length && r0.body.hidden >= 3, r0.body.hidden);

  // ── §3 DO NOT SOLICIT IS RESPECTED ─────────────────────────────────────
  ok("§3 the LYBUNT starter says it leaves out the two marked do not solicit", S.lybunt && S.lybunt.leftOut >= 2, S.lybunt);
  const pv = await api("GET", "/groups/starters/lybunt", T);
  ok("§3 the preview says so in words", pv.status === 200 && /do not solicit/.test(pv.body.sentence), pv.body && pv.body.sentence);
  const add = await api("POST", "/groups/starters/lybunt", T);
  ok("§4 Add makes a group kept by a rule", add.status === 201 && add.body.kind === "dynamic", add.status);
  const gid = add.body.id;
  const g1 = await api("GET", `/groups/${gid}`, T);
  const ids1 = new Set((g1.body.members || []).map(x => x.id));
  ok("§3 the do-not-solicit people are left out of the group", dns.every(id => !ids1.has(id)), dns);
  ok("§4 the group holds the starter's count", ids1.size === S.lybunt.count, { group: ids1.size, starter: S.lybunt.count });

  // ── §4 A GIFT MOVES SOMEBODY ───────────────────────────────────────────
  const more0 = await api("POST", "/groups/starters/gave_more", T);
  ok("§4 a second starter adds", more0.status === 201, more0.status);
  const mover = lyRows.find(r => !dns.includes(r.id) && ids1.has(r.id) && Number(r.priorYearTotal) > 0);
  const amount = Math.round(Number(mover.priorYearTotal) + 100);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const gift = await api("POST", `/donors/${mover.id}/gifts`, T, { amount, date: today < cur.to ? today : cur.to, type: "one-time" });
  ok("§4 a gift is recorded", gift.status === 200 || gift.status === 201, gift.status);
  const g2 = await api("GET", `/groups/${gid}`, T);
  const gm = await api("GET", `/groups/${more0.body.id}`, T);
  ok("§4 they left Gave last year, not yet this year", !(g2.body.members || []).some(x => x.id === mover.id) && g2.body.members.length === ids1.size - 1, g2.body.members.length);
  ok("§4 and are in Gave more this year than last", (gm.body.members || []).some(x => x.id === mover.id), mover.name);
  const r1 = await api("GET", "/groups/starters", T);
  ok("§4 the starter list now marks both as added", byKey(r1.body).lybunt.addedGroupId === gid && byKey(r1.body).gave_more.addedGroupId === more0.body.id);
  const edit = await api("PATCH", `/groups/${gid}`, T, { rules: { ...add.body.rules, solicitable: "" } });
  ok("§4 its rule edits like any group's", edit.status === 200 && !edit.body.rules.solicitable && edit.body.rules.bunt === "lybunt", edit.body && edit.body.rules);

  // ── §5 A GET WRITES NOTHING; THE TENANT WALL ───────────────────────────
  const [{ n: a0 }] = await q(`SELECT COUNT(*)::int n FROM audiences WHERE org_id=$1`, [ORG]);
  await api("GET", "/groups/starters/sybunt", T);
  await api("GET", "/groups/starters", T);
  const [{ n: a1 }] = await q(`SELECT COUNT(*)::int n FROM audiences WHERE org_id=$1`, [ORG]);
  ok("§5 the list and the preview write nothing", a0 === a1, { a0, a1 });
  const other = await api("GET", "/groups/starters", T2);
  ok("§5 another org reads only its own (empty) records", other.status === 200 && other.body.starters.length === 0, other.body);
  const otherAdd = await api("POST", "/groups/starters/lybunt", T2);
  const [{ n: mine }] = await q(`SELECT COUNT(*)::int n FROM audiences WHERE org_id=$1`, [ORG]);
  ok("§5 another org's Add lands in its own org", otherAdd.status === 201 && mine === a1, { status: otherAdd.status, mine, a1 });

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });
