#!/usr/bin/env node
// LIST-1 · THE DONOR LIST: YOUR COLUMNS, 100 PER PAGE, FILTER BY ANYTHING.
//
// Guards donor data: the list must hold exactly the people a filter names
// (an ignored or widened filter is a list that says "in 40502" and holds
// everybody), and one person's layout must never move another's.
//
//   §1 a user reorders and removes columns and sees the same layout after a
//      reload; another user's layout is unaffected; reset and the org default
//   §2 filters for zip, city, state, came-and-didn't-give, open pledge, a
//      gift with no date and an imported custom field each return the right
//      people; AND and OR; a filter Steward doesn't know is refused, not ignored
//   §3 the list's numbers are the profile's (Lifetime, This year, pledge balance)
//   §4 a saved filter becomes a group with the same members
//   §5 Atlas (and Ask) give the same list for the same question
//   §6 100 rows per page loads in under a second on a 10,000-donor org
//
// Against a booted server at $BASE (helpers.js). Fails on main: the routes,
// the `where` filter and the columns do not exist there.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_list1", SLUG = "list1-test", BIG = "org_list1big";
const A = { id: "u_list1a", email: "list1-admin@example.org" };
const B = { id: "u_list1b", email: "list1-staff@example.org" };
const BIGU = { id: "u_list1big", email: "list1-big@example.org" };
const sys = "'system:test','test'";
const W = (conditions, join = "and") => encodeURIComponent(JSON.stringify({ join, conditions }));
const sortIds = a => [...a].sort();
const same = (a, b) => JSON.stringify(sortIds(a)) === JSON.stringify(sortIds(b));

async function reset(org) {
  const first = ["voice_memos", "atlas_actions", "agent_runs", "event_attendees", "events", "pledges", "gifts", "custom_field_defs",
    "donor_list_views", "donor_list_layouts", "audiences", "interactions", "tasks", "donors", "user_sessions", "users", "fin_funds", "accounts"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}
async function makeOrg(id, slug, name, users) {
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,onboarded_at,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),NOW(),'{"fiscal_year_start_month":1}')`, [id, name, slug]);
  for (const [u, role, nm] of users) await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [u.id, id, u.email, pw, nm, role]);
}

(async () => {
  console.log("list1-columns-filters (LIST-1)");
  const today = civilToday();
  const plus = d => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  await reset(ORG);
  await makeOrg(ORG, SLUG, "List One Harbor", [[A, "admin", "Ada Admin"], [B, "staff", "Ben Staff"]]);

  // ── The people ──
  const people = [
    // id, name, zip, city, state, custom chapter, person_types
    ["d_l1_ada", "Ada Lexa", "40502", "Lexington", "KY", null, "donor"],
    ["d_l1_ben", "Ben Lexa", "40502-1234", "Lexington", "Kentucky", null, "donor"],
    ["d_l1_cara", "Cara Pledge", "40503", "Lexington", "KY", null, "donor"],
    ["d_l1_dev", "Dev Nodate", "10001", "New York", "NY", null, "donor"],
    ["d_l1_eve", "Eve Chapter", "40502", "Lexington", "KY", "Bluegrass", "donor"],
    ["d_l1_fay", "Fay Chapter", "40511", "Lexington", "KY", "Cumberland", "donor"],
    ["d_l1_vol", "Val Volunteer", "40502", "Lexington", "KY", null, "volunteer"],
  ];
  for (const [id, name, zip, city, state, chapter, pt] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,zip,city,state,custom_fields,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,${sys})`,
      [id, ORG, name, `${id}@example.org`, zip, city, state, chapter ? JSON.stringify({ chapter }) : null, JSON.stringify([pt])]);
  }
  await q(`INSERT INTO custom_field_defs (id,org_id,entity,key,label,type,options,position,created_by,created_by_name,created_source)
           VALUES ('cf_l1_ch',$1,'donor','chapter','Chapter','select','["Bluegrass","Cumberland"]'::jsonb,1,${sys},'import')`, [ORG]);
  const ev = "ev_l1_fj";
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ($1,$2,'Finding Joy','gala',$3)`, [ev, ORG, plus(-30)]);
  for (const [d, st] of [["d_l1_ada", "attended"], ["d_l1_ben", "attended"], ["d_l1_cara", "registered"], ["d_l1_vol", "attended"]])
    await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status) VALUES ($1,$2,$3,$4,$4,$5)`, [`ea_${d}`, ev, ORG, d, st]);
  const gift = (id, donor, amount, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,pledge_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'check',$6,${sys})`,
    [id, ORG, donor, amount, date, extra.pledge || null]);
  await gift("g_l1_1", "d_l1_ada", 100, plus(-60));            // before the event: came and didn't give since
  await gift("g_l1_2", "d_l1_ben", 50, plus(-10));             // after the event
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES ('pl_l1',$1,'d_l1_cara',1000,$2,'open')`, [ORG, plus(60)]);
  await gift("g_l1_3", "d_l1_cara", 250, plus(-5), { pledge: "pl_l1" });
  await gift("g_l1_4", "d_l1_dev", 75, plus(-3));
  await gift("g_l1_5", "d_l1_dev", 20, "");                    // a gift with no date
  await gift("g_l1_6", "d_l1_eve", 40, `${Number(today.slice(0, 4)) - 1}-06-01`);   // last year: not in This year
  const { query: dbq } = require("../db");
  await require("../afterChange").recalcDonorSummaryBatch(dbq, people.map(p => p[0]), ORG);

  const ta = await login(A.email), tb = await login(B.email);
  ok("both people sign in", !!ta && !!tb);

  // ── §1 Columns ──
  const s0 = await api("GET", "/donors/list-setup", ta);
  ok("§1 list-setup answers with fields in the seven groups", s0.status === 200 && s0.body.groups.length === 7
    && ["Contact", "Giving", "Pledges", "Events", "Volunteering", "Communication", "From your imports"].every(g => s0.body.fields.some(f => f.group === g)),
    JSON.stringify(s0.body && s0.body.groups));
  ok("§1 the imported custom field is a field under From your imports", s0.body.fields.some(f => f.key === "cf:chapter" && f.group === "From your imports" && f.filter));
  ok("§1 a new person starts on the default layout", s0.body.layout.source === "default" && s0.body.layout.columns.join() === s0.body.defaultColumns.join());
  const mine = { columns: ["name", "zip", "city", "this_year", "lifetime", "pledge_balance", "cf:chapter"], widths: { zip: 120 }, pageSize: 100 };
  const put = await api("PUT", "/donors/list-layout", ta, mine);
  ok("§1 saving a reordered layout (stage, owner removed) answers 200", put.status === 200, put.status);
  const s1 = await api("GET", "/donors/list-setup", ta);
  ok("§1 after a reload she sees the same columns, widths and page size",
    s1.body.layout.columns.join() === mine.columns.join() && s1.body.layout.widths.zip === 120 && s1.body.layout.pageSize === 100 && s1.body.layout.source === "mine",
    JSON.stringify(s1.body.layout));
  const sb = await api("GET", "/donors/list-setup", tb);
  ok("§1 another person's layout is unaffected", sb.body.layout.source === "default" && sb.body.layout.columns.join() === sb.body.defaultColumns.join(), JSON.stringify(sb.body.layout));
  const junk = await api("PUT", "/donors/list-layout", tb, { columns: ["zip", "nonsense", "zip"], pageSize: 7 });
  ok("§1 an unknown column is dropped, name stays first, a page size Steward doesn't offer becomes 50",
    junk.body.layout.columns.join() === "name,zip" && junk.body.layout.pageSize === 50, JSON.stringify(junk.body));
  const orgDef = await api("PUT", "/donors/list-layout/org", tb, { columns: ["name", "city"] });
  ok("§1 only an admin sets the org's default", orgDef.status === 403, orgDef.status);
  await api("PUT", "/donors/list-layout/org", ta, { columns: ["name", "city", "lifetime"], pageSize: 25 });
  const rb = await api("DELETE", "/donors/list-layout", tb);
  ok("§1 Reset to default takes her to the org's default", rb.body.layout.source === "org" && rb.body.layout.columns.join() === "name,city,lifetime", JSON.stringify(rb.body));
  const s2 = await api("GET", "/donors/list-setup", ta);
  ok("§1 the admin's own layout did not move", s2.body.layout.columns.join() === mine.columns.join());
  const view = await api("POST", "/donors/list-views", ta, { name: "Major donors, Lexington", ...mine,
    filters: { join: "and", conditions: [{ field: "city", op: "is", value: "Lexington" }] } });
  const s3 = await api("GET", "/donors/list-setup", ta), s3b = await api("GET", "/donors/list-setup", tb);
  ok("§1 a saved view is kept, with its filter, for her alone", view.status === 200 && s3.body.views.some(v => v.name === "Major donors, Lexington" && v.filters.conditions.length === 1)
    && s3b.body.views.length === 0);

  // ── §2 Filters ──
  const list = async (conds, join, extra = "") => {
    const r = await api("GET", `/donors?role=donor&limit=100&offset=0&where=${W(conds, join)}${extra}`, ta);
    return { status: r.status, ids: (r.body.donors || []).map(d => d.id), total: r.body.total, body: r.body };
  };
  const cases = [
    ["zip is 40502 (a ZIP+4 counts, a volunteer is not a donor)", [{ field: "zip", op: "is", value: "40502" }], ["d_l1_ada", "d_l1_ben", "d_l1_eve"]],
    ["zip starts with 405", [{ field: "zip", op: "starts", value: "405" }], ["d_l1_ada", "d_l1_ben", "d_l1_cara", "d_l1_eve", "d_l1_fay"]],
    ["zip is one of 40503, 10001", [{ field: "zip", op: "in", value: "40503, 10001" }], ["d_l1_cara", "d_l1_dev"]],
    ["city is Lexington", [{ field: "city", op: "is", value: "lexington" }], ["d_l1_ada", "d_l1_ben", "d_l1_cara", "d_l1_eve", "d_l1_fay"]],
    ["state is KY (a record that says Kentucky counts)", [{ field: "state", op: "is", value: "KY" }], ["d_l1_ada", "d_l1_ben", "d_l1_cara", "d_l1_eve", "d_l1_fay"]],
    ["came to Finding Joy and didn't give", [{ field: "event_no_gift", op: "is", value: ev }], ["d_l1_ada"]],
    ["has an open pledge", [{ field: "open_pledge", op: "yes", value: null }], ["d_l1_cara"]],
    ["pledge balance at least 700", [{ field: "pledge_balance", op: "gte", value: "700" }], ["d_l1_cara"]],
    ["has a gift with no date", [{ field: "no_date_gift", op: "yes", value: null }], ["d_l1_dev"]],
    ["imported Chapter is Bluegrass", [{ field: "cf:chapter", op: "is", value: "Bluegrass" }], ["d_l1_eve"]],
    ["zip 10001 OR Chapter Cumberland", [{ field: "zip", op: "is", value: "10001" }, { field: "cf:chapter", op: "is", value: "Cumberland" }], ["d_l1_dev", "d_l1_fay"], "or"],
    ["four chips: Lexington AND KY AND zip 405* AND lifetime at least 40",
      [{ field: "city", op: "is", value: "Lexington" }, { field: "state", op: "is", value: "KY" }, { field: "zip", op: "starts", value: "405" }, { field: "lifetime", op: "gte", value: "40" }],
      ["d_l1_ada", "d_l1_ben", "d_l1_cara", "d_l1_eve"]],
  ];
  for (const [name, conds, want, join] of cases) {
    const r = await list(conds, join);
    ok(`§2 ${name}`, r.status === 200 && same(r.ids, want) && r.total === want.length, `${r.status} ${JSON.stringify(r.ids)} total=${r.total}`);
  }
  const badF = await list([{ field: "favourite_colour", op: "is", value: "green" }]);
  ok("§2 a field Steward doesn't know is refused with a sentence, never ignored", badF.status === 400 && badF.body.error === "bad_filter" && /favourite_colour/.test(badF.body.sentence), JSON.stringify(badF.body));
  const badOp = await list([{ field: "zip", op: "gte", value: "40502" }]);
  ok("§2 an operator a field doesn't take is refused", badOp.status === 400 && badOp.body.error === "bad_filter");
  const noGeo = await list([{ field: "zip", op: "within", value: { zip: "40502", miles: "10" } }]);
  ok("§2 within N miles is refused in words when no address in that zip is on the map", noGeo.status === 400 && /map/.test(noGeo.body.sentence), JSON.stringify(noGeo.body));
  await q(`UPDATE donors SET latitude=38.03, longitude=-84.50 WHERE org_id=$1 AND id IN ('d_l1_ada','d_l1_eve')`, [ORG]);
  await q(`UPDATE donors SET latitude=38.06, longitude=-84.45 WHERE org_id=$1 AND id='d_l1_fay'`, [ORG]);
  await q(`UPDATE donors SET latitude=40.75, longitude=-73.99 WHERE org_id=$1 AND id='d_l1_dev'`, [ORG]);
  const geo = await list([{ field: "zip", op: "within", value: { zip: "40502", miles: "10" } }]);
  ok("§2 within 10 miles of 40502 finds the placed addresses nearby and not New York", geo.status === 200 && same(geo.ids, ["d_l1_ada", "d_l1_eve", "d_l1_fay"]), JSON.stringify(geo.ids));
  const ids = await api("GET", `/donors/ids?role=donor&where=${W([{ field: "zip", op: "starts", value: "405" }])}`, ta);
  ok("§2 select all matching returns every id the filter holds", ids.status === 200 && ids.body.total === 5 && ids.body.ids.length === 5);
  const tag = await api("POST", "/donors/bulk-tag", ta, { ids: ids.body.ids, tag: "Lexington ask" });
  const tagged = await list([{ field: "tags", op: "is", value: "Lexington ask" }]);
  ok("§2 a tag added to all matching is a filter that finds exactly them", tag.status === 200 && tag.body.tagged === 5 && same(tagged.ids, ids.body.ids), JSON.stringify(tag.body));

  // ── §3 The numbers are the profile's ──
  const FS = require("../figureSources");
  const orgTime = require("../orgTime");
  const [vo] = await q(`SELECT timezone, vocabulary_json FROM orgs WHERE id=$1`, [ORG]);
  const fyStart = orgTime.orgFiscalYearStart(vo || {});
  const all = await api("GET", `/donors?role=donor&limit=100&offset=0&cols=lifetime,this_year,pledge_balance,cf:chapter,zip`, ta);
  let numbersOk = all.status === 200 && all.body.donors.length === 6, why = "";
  for (const d of all.body.donors || []) {
    const src = (key, extra = {}) => ({ key, params: { donor: d.id, ...extra } });
    const [lt, yr] = await Promise.all([FS.figureValue(ORG, src("donor-lifetime"), {}), FS.figureValue(ORG, src("donor-gifts-between", { from: fyStart, to: today }), {})]);
    const ltC = lt.totalRows ? lt.cents : 0, yrC = yr.totalRows ? yr.cents : 0;
    if (Math.round(d.cells.lifetime * 100) !== ltC || Math.round(d.cells.this_year * 100) !== yrC) { numbersOk = false; why += `${d.id} list ${d.cells.lifetime}/${d.cells.this_year} profile ${ltC}/${yrC}; `; }
  }
  ok("§3 every row's Lifetime and This year are the profile's figures, to the cent", numbersOk, why);
  const cara = (all.body.donors || []).find(d => d.id === "d_l1_cara") || { cells: {} };
  const eve = (all.body.donors || []).find(d => d.id === "d_l1_eve") || { cells: {} };
  ok("§3 pledge balance is what is still to come (1,000 less 250 paid)", cara.cells.pledge_balance === 750, JSON.stringify(cara.cells));
  ok("§3 an imported custom field shows as its own column", eve.cells["cf:chapter"] === "Bluegrass" && eve.cells.zip === "40502");
  const sorted = await api("GET", `/donors?role=donor&limit=100&offset=0&sort=zip&dir=asc`, ta);
  const zips = (sorted.body.donors || []).map(d => d.zip);
  ok("§3 clicking a header sorts by that column", zips.join() === [...zips].sort().join() && zips[0] === "10001", zips.join());

  // ── §4 A saved filter becomes a group with the same members ──
  const where = JSON.stringify({ join: "and", conditions: [{ field: "zip", op: "starts", value: "405" }, { field: "event_attended", op: "is", value: ev }] });
  const grp = await api("POST", "/groups", ta, { name: "Came to Finding Joy, 405", kind: "dynamic", rules: { role: "donor", where } });
  const GR = require("../groups");
  const g = grp.status === 201 ? await GR.groupById(ORG, grp.body.id) : null;
  const members = g ? await GR.memberIds(ORG, g) : [];
  const fromList = await list(JSON.parse(where).conditions);
  ok("§4 Save as group keeps the filter, and the group's members are the list's people",
    grp.status === 201 && same(members, fromList.ids) && same(members, ["d_l1_ada", "d_l1_ben"]), `${grp.status} ${JSON.stringify(grp.body).slice(0, 200)} ${JSON.stringify(members)}`);

  // ── §5 Atlas and Ask: the same list for the same question ──
  const question = "donors in 40502 who came to Finding Joy";
  const listed = await list([{ field: "zip", op: "is", value: "40502" }, { field: "event_attended", op: "is", value: ev }]);
  const ask = await api("POST", "/ask", ta, { text: question });
  const askIds = ((ask.body && (ask.body.people || (ask.body.answer && ask.body.answer.people))) || []).map(p => p.donorId);
  ok("§5 Ask answers the question with the list's people", ask.status === 200 && same(askIds, listed.ids) && same(listed.ids, ["d_l1_ada", "d_l1_ben"]),
    `${ask.status} ${JSON.stringify(ask.body).slice(0, 300)}`);
  const atlas = await api("POST", "/atlas", ta, { text: question });
  const reqId = atlas.body && atlas.body.request && atlas.body.request.id;
  const acts = reqId ? await q(`SELECT line FROM atlas_actions WHERE org_id=$1 AND request_id=$2`, [ORG, reqId]).catch(() => []) : [];
  const line = acts.map(a => a.line).join(" | ");
  ok("§5 Atlas gives the same answer: two people on the Donors list match", atlas.status < 300 && /2 people on your Donors list match/.test(line), `${atlas.status} ${line} ${JSON.stringify(atlas.body).slice(0, 300)}`);

  // ── §6 100 rows per page under a second on 10,000 donors ──
  await reset(BIG);
  await makeOrg(BIG, "list1-big", "List One Ten Thousand", [[BIGU, "admin", "Big Admin"]]);
  await q(`INSERT INTO donors (id,org_id,name,email,zip,city,state,total_giving,gift_count,last_gift_date,first_gift_date,last_gift_amount,created_by,created_by_name)
           SELECT 'd_big_' || i, $1, 'Person ' || i, 'p' || i || '@example.org', lpad((40000 + i % 900)::text, 5, '0'),
                  (ARRAY['Lexington','Louisville','Frankfort','Berea'])[1 + i % 4], 'KY', (i % 997) * 3, 2, $2, $3, (i % 997) * 1.5, ${sys}
             FROM generate_series(1, 10000) i`, [BIG, plus(-20), plus(-400)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           SELECT 'g_big_' || i || '_' || k, $1, 'd_big_' || i, (i % 997) * 1.5, CASE k WHEN 1 THEN $2 ELSE $3 END, 'check', ${sys}
             FROM generate_series(1, 10000) i, generate_series(1, 2) k`, [BIG, plus(-20), plus(-400)]);
  await q(`ANALYZE donors`); await q(`ANALYZE gifts`);
  const tbig = await login(BIGU.email);
  const cols = "name,stage,owner,lifetime,last_gift_date,engagement,generosity,this_year,city,zip,pledge_balance";
  const times = [];
  let page = null;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    page = await api("GET", `/donors?role=donor&limit=100&offset=${i * 100}&cols=${cols}`, tbig);
    times.push(performance.now() - t0);
  }
  const warm = [...times.slice(1)].sort((a, b) => a - b)[1];
  console.log(`  10,000 donors, 100 rows with ${cols.split(",").length} columns: ${times.map(Math.round).join("ms, ")}ms (median warm ${warm}ms)`);
  ok("§6 a 100-row page on 10,000 donors is 100 rows with a total of 10,000", page.status === 200 && page.body.donors.length === 100 && page.body.total === 10000, `${page.status} ${page.body && page.body.total}`);
  ok("§6 and it loads in under a second", warm < 1000, `${times.join(",")}ms`);
  const tf = performance.now();
  const filtered = await api("GET", `/donors?role=donor&limit=100&offset=0&cols=${cols}&where=${W([{ field: "city", op: "is", value: "Lexington" }, { field: "lifetime", op: "gte", value: "1000" }, { field: "zip", op: "starts", value: "400" }])}`, tbig);
  const fms = performance.now() - tf;
  console.log(`  filtered (three chips): ${Math.round(fms)}ms, ${filtered.body && filtered.body.total} people`);
  ok("§6 a three-chip filter on 10,000 donors also loads in under a second", filtered.status === 200 && fms < 1000, `${fms}ms`);
  await reset(BIG);
  await reset(ORG);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
