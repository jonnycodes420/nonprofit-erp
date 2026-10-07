// SEARCH-2 · ⌘K FINDS EVERYTHING, AND NOTHING IT SHOULDN'T.
//
// The one test this build earns, because search is a way to READ donor data:
// what it hands back is exactly what a person may see, from their own org,
// never a deleted record, and never a gift to a volunteer coordinator.
//
// One record of each new kind is found by the words a person would type:
//   a gift by "$4,321.17", by its cheque number and by its day; a monthly plan
//   and a pledge by their amounts; a journey, a meeting, an email (by subject
//   and by sender), a note and an import by their words; "Saltmarsh gift" for
//   one person's gifts. Then: a deleted gift, and a deleted person's gift and
//   note, are not found; another org's gift of the same amount is not found;
//   a group with more than five says so, and "see all" returns them all; and a
//   coordinator is refused.
//
// WHAT WOULD MAKE THIS FAIL (planted and watched go red before it was trusted):
//   · drop `d.deleted_at IS NULL` from the gifts read in routes/search.js
//     → "a deleted person's gift is not found" goes red;
//   · drop `g.org_id = ?` from the gifts read → "another org's gift" goes red;
//   · drop the coordinator line in routes/search.js AND /search's absence from
//     auth.js's allowlist → "a coordinator cannot find a gift" goes red.
//
//   BASE=http://localhost:5601 node tests/search2-everything.test.js
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api } = require("./helpers");

const ORG = "org_search2", OTHER = "org_search2b";
const ADMIN = "director@search2.local", COORD = "coord@search2.local", OTHER_ADMIN = "director@search2b.local";
const SALT = "d_s2_saltmarsh", GONE = "d_s2_gone", ELSE = "d_s2b_else";

async function clear(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}

(async () => {
  console.log("search2-everything");
  await clear(ORG); await clear(OTHER);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, name, slug] of [[ORG, "Search Two Harbour", "search2"], [OTHER, "Search Two Elsewhere", "search2b"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, slug]);
  }
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_s2_admin',$1,$2,$3,'Perpetua Staffer','admin')`, [ORG, ADMIN, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_s2_coord',$1,$2,$3,'Cora Ordinator','volunteer_coordinator')`, [ORG, COORD, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_s2b_admin',$1,$2,$3,'Elsa Where','admin')`, [OTHER, OTHER_ADMIN, hash]);
  const person = (id, org, name, email) => q(`INSERT INTO donors (id,org_id,name,email,kind,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','steward','system:test','test')`, [id, org, name, email]);
  await person(SALT, ORG, "Wilhelmina Saltmarsh", "wil@saltmarsh.test");
  await person(GONE, ORG, "Ignatius Gone", "ig@gone.test");
  await person(ELSE, OTHER, "Elsewhere Giver", "else@where.test");
  const gift = (id, org, donor, amount, date, check = null) =>
    q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,check_number) VALUES ($1,$2,$3,$4,$5,'cash',$6,$7)`,
      [id, org, donor, amount, date, check ? "Check" : "Card", check]);
  await gift("g_s2_main", ORG, SALT, 4321.17, "2025-03-14", "88123");
  await gift("g_s2_doomed", ORG, SALT, 555.55, "2025-04-01");
  await gift("g_s2_gone", ORG, GONE, 777.77, "2025-04-02");
  await gift("g_s2b_same", OTHER, ELSE, 4321.17, "2025-03-14");
  for (let i = 0; i < 6; i++) await gift("g_s2_many_" + i, ORG, SALT, 12.34, `2025-01-0${i + 1}`);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_s2',$1,$2,'sub_s2_test',37,'month','active')`, [ORG, SALT]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,notes) VALUES ('pl_s2',$1,$2,9876,'2026-12-01','open','toward the boathouse')`, [ORG, SALT]);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps) VALUES ('ct_s2',$1,'Lighthouse welcome path','[{"type":"call","label":"Call","offsetDays":3}]'::jsonb)`, [ORG]);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,archived_at) VALUES ('ct_s2_old',$1,'Lighthouse retired path','[]'::jsonb,NOW())`, [ORG]);
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by,created_by_name)
           VALUES ('ce_s2',$1,'u_s2_admin','google','evt_s2','Tidepool walkthrough','2025-03-14 12:00:00-04','2025-03-14 13:00:00-04',ARRAY[$2],'u_s2_admin','Perpetua Staffer')`, [ORG, SALT]);
  const touch = (id, donor, type, note, date, metadata = null, by = null) =>
    q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata,created_by,logged_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'u_s2_admin',$8)`,
      [id, ORG, donor, type, note, date, metadata, by]);
  await touch("i_s2_in", SALT, "email", "Replied to Perpetua Staffer: Quarterly kelp report\n\nLovely.", "2025-05-02", { subject: "Quarterly kelp report", direction: "inbound" }, "Perpetua Staffer");
  await touch("i_s2_out", SALT, "email", "Perpetua Staffer wrote: Barnacle invitation\n\nCome along.", "2025-05-03", { subject: "Barnacle invitation", direction: "outbound" }, "Perpetua Staffer");
  await touch("i_s2_note", SALT, "note", "She mentioned a zebrafish grant idea for next spring.", "2025-05-04");
  await touch("i_s2_meet", SALT, "meeting", "Harbour lunch at the pier.", "2025-05-05");
  await touch("i_s2_gone", GONE, "note", "A vanishing ledger story.", "2025-05-06");
  await q(`INSERT INTO imports (id,org_id,name,source_filename,rows_in,committed_at) VALUES ('imp_s2',$1,'Old CRM gifts','old-crm-export-2019.csv',42,'2025-06-01 15:00:00+00')`, [ORG]);
  await q(`UPDATE donors SET deleted_at=NOW() WHERE id=$1`, [GONE]);

  const tok = await login(ADMIN);
  const find = async (term, kinds) => {
    const r = await api("GET", `/search?q=${encodeURIComponent(term)}${kinds ? "&kinds=" + kinds : ""}`, tok);
    return { status: r.status, results: (r.body && r.body.results) || [], more: (r.body && r.body.more) || {} };
  };
  const has = (res, kind, id) => res.results.some(x => x.kind === kind && x.id === id);

  // ── one record of each new kind, by its natural search term ──────────────
  let r = await find("$4,321.17");
  ok("a gift by its amount", has(r, "gift", "g_s2_main"), r.results);
  ok("…and only this org's: another org's gift of the same amount is not found", !r.results.some(x => x.id === "g_s2b_same"), r.results);
  ok("a gift by its cheque number", has(await find("88123"), "gift", "g_s2_main"));
  r = await find("Mar 14 2025");
  ok("a day finds that day's gift", has(r, "gift", "g_s2_main"), r.results);
  ok("…and that day's meeting", has(r, "meeting", "ce_s2"), r.results);
  ok("a gift by who gave it", has(await find("Saltmarsh"), "gift", "g_s2_main"));
  r = await find("Saltmarsh gift");
  ok("a name and 'gift' jumps to that person's gifts", r.results[0] && r.results[0].kind === "personGifts" && r.results[0].id === SALT, r.results.slice(0, 2));
  ok("a monthly plan by its amount", has(await find("$37"), "plan", "rs_s2"));
  ok("a pledge by its amount", has(await find("$9,876"), "pledge", "pl_s2"));
  r = await find("Lighthouse");
  ok("a journey by its name", has(r, "journey", "ct_s2"), r.results);
  ok("…but not an archived one", !has(r, "journey", "ct_s2_old"));
  ok("a calendar meeting by its title", has(await find("Tidepool"), "meeting", "ce_s2"));
  ok("a logged meeting by its words", has(await find("Harbour lunch"), "meeting", "i_s2_meet"));
  ok("an email by its subject", has(await find("kelp report"), "email", "i_s2_in"));
  ok("an email they sent, by its sender", has(await find("Wilhelmina"), "email", "i_s2_in"));
  ok("an email we sent, by its sender", has(await find("Perpetua"), "email", "i_s2_out"));
  ok("a note by its words", has(await find("zebrafish"), "note", "i_s2_note"));
  ok("an import by its file name", has(await find("old-crm-export"), "import", "imp_s2"));
  ok("an import by the day it went in", has(await find("2025-06-01"), "import", "imp_s2"));

  // ── deleted records never show ──────────────────────────────────────────
  ok("the gift exists before it is deleted", has(await find("$555.55"), "gift", "g_s2_doomed"));
  const del = await api("DELETE", "/gifts/g_s2_doomed", tok);
  ok("the gift is deleted through the app", del.status === 200 || del.status === 204, del.status);
  ok("a deleted gift is not found", !(await find("$555.55")).results.some(x => x.id === "g_s2_doomed"));
  ok("a deleted person's gift is not found", !(await find("$777.77")).results.some(x => x.id === "g_s2_gone"));
  ok("a deleted person's note is not found", !(await find("vanishing ledger")).results.some(x => x.id === "i_s2_gone"));
  ok("a deleted person is not found", !(await find("Ignatius")).results.some(x => x.id === GONE));

  // ── three to a group, and "see all" ─────────────────────────────────────
  r = await find("$12.34");
  ok("a group with more than five says it has more", r.results.filter(x => x.kind === "gift").length === 5 && r.more.gifts === true, r.more);
  r = await find("$12.34", "gifts");
  ok("see all returns every one", r.results.filter(x => x.kind === "gift").length === 6 && !r.more.gifts, r.results.length);

  // ── a coordinator cannot find a gift ────────────────────────────────────
  const ctok = await login(COORD);
  const c1 = await api("GET", `/search?q=${encodeURIComponent("$4,321.17")}`, ctok);
  ok("a coordinator cannot find a gift", c1.status === 403 && !JSON.stringify(c1.body).includes("g_s2_main"), c1);
  const c2 = await api("GET", `/search?q=${encodeURIComponent("$4,321.17")}&kinds=gifts`, ctok);
  ok("…not by asking for gifts alone either", c2.status === 403 && !JSON.stringify(c2.body).includes("g_s2_main"), c2);

  // ── the other org sees only its own ─────────────────────────────────────
  const otok = await login(OTHER_ADMIN);
  const o = await api("GET", `/search?q=${encodeURIComponent("$4,321.17")}`, otok);
  const oids = ((o.body && o.body.results) || []).map(x => x.id);
  ok("the other org finds its own gift and not ours", oids.includes("g_s2b_same") && !oids.includes("g_s2_main"), oids);

  await clear(ORG); await clear(OTHER);
  await closeDb();
  summary("search2-everything");
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary("search2-everything"); });
