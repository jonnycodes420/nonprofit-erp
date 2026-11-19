// tests/onboard3.test.js · ONBOARD-3. ONBOARDING THAT ENDS IN A WIN.
//
// A new org's first donor file makes "Does this match your old system?" due;
// its years are byYear.orgByYear's own; a typed figure reads Matches within $1
// or opens what explains the difference; Looks right sets the data-in gate,
// stored with the figures typed. Home then opens on "Your first 30 minutes",
// its list in Home's own order. Day 30 says who gave again since data in, from
// the day-one list only. The Monday notes list holds only people with a
// thank-you or note step due this week, and never a do-not-contact person.
//
// THE PLANTED DEFECTS (ONBOARD3_PLANT on the SERVER, one at a time; each red):
//   no-data-in      Looks right leaves orgs.data_in_at alone            → §3
//   own-year        a year's total summed in the route, soft credit in  → §2
//   ranking         the first-session list sorted by name               → §4
//   before-data-in  the readout counts a gift dated before data in      → §5
//   not-on-list     the readout counts a person not on the snapshot     → §5
//   recovered       the readout says "recovered"                        → §5
//   print-all       the notes list takes every open step, any week      → §6
//   print-dnc       the notes list keeps a do-not-contact person        → §6
//
// Fake fixtures only, made-up names. Nothing sends.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays, waitFor } = require("./helpers");
const BY = require("../shared/numbers/byYear");
const T = require("../server/onboard/totals");

const PASS = "loadtest1234";
const ORG = "org_onb3_tern", OLD = "org_onb3_old", SHEET = "org_onb3_sheet";
const DIRECTOR = "onb3-director@example.org", OLDDIR = "onb3-old@example.org";
const qq = (sql, p = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), p); };

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function mkUser(id, org, email, role) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,false)`,
    [id, org, email, bcrypt.hashSync(PASS, 10), email.split("@")[0].replace("onb3-", "Onb3 "), role]);
}

// The fixture: eight people from one file, gifts across three years. Names run
// against the alphabet of their giving, so an order by name is not Home's.
const today = civilToday();
const Y = Number(today.slice(0, 4));
const PEOPLE = [
  // id, name, years they gave each December (amount), extra
  ["d_onb3_zell", "Zelda Quarry", [Y - 3, Y - 2, Y - 1], 1200],
  ["d_onb3_yates", "Yusuf Brightwater", [Y - 3, Y - 2, Y - 1], 900],
  ["d_onb3_xan", "Xanthe Morrow", [Y - 4, Y - 3, Y - 2], 650],
  ["d_onb3_wolf", "Wendell Ashgrove", [Y - 3, Y - 2], 400],
  ["d_onb3_vale", "Valentina Oakes", [Y - 2, Y - 1], 300],
  ["d_onb3_umb", "Ulrich Pennywhistle", [Y - 2], 220],
  ["d_onb3_tamsin", "Tamsin Holloway", [Y], 75],                 // gave this year: current
  ["d_onb3_soft", "Sorrel Dunmore", [Y - 1], 150],
];

(async () => {
  console.log("ONBOARD-3: onboarding that ends in a win\n");
  for (const o of [ORG, OLD, SHEET, "org_onb3_home"]) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb3-%@example.org'`);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ($1,$2,$3,1,'trialing','trial','customer')`,
    [ORG, "Ternwick Food Pantry", "onb3-ternwick"]);
  await q(`UPDATE orgs SET paper_done_at = NOW() - INTERVAL '3 days' WHERE id=$1`, [ORG]);   // in onboarding (ONBOARD-1's paper)
  await mkUser("u_onb3_dir", ORG, DIRECTOR, "admin");
  const IMP = "imp_onb3_first";
  await q(`INSERT INTO imports (id,org_id,name,shape,committed_at,actor_user_id,rows_set_aside,summary_json)
           VALUES ($1,$2,'Ternwick donors.xlsx','gifts',NOW(),'u_onb3_dir',2,$3)`,
    [IMP, ORG, JSON.stringify({ verifyFile: { gaps: [{ rows: 2, cents: 5000, bucket: "set aside", words: "no name to put the gift on" }] } })]);
  let gid = 0;
  const gift = async (donor, amount, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,import_id,refund_of,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system:test','ONBOARD-3 fixture')`,
    [`g_onb3_${++gid}`, ORG, donor, amount, date, extra.type || "cash", extra.importId === undefined ? IMP : extra.importId, extra.refundOf || null]);
  for (const [id, name, years, amt] of PEOPLE) {
    const last = `${Math.max(...years)}-12-${Math.max(...years) === Y ? "01" : "15"}`;
    const lastDay = Math.max(...years) === Y ? civilPlusDays(-20) : last;
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,created_import_id,last_gift_date,address,city,state,zip,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active','cultivate',0,0,$5,$6,'12 Gull Lane','Ternwick','ME','04011','system:test','ONBOARD-3 fixture')`,
      [id, ORG, name, `${id}@example.org`, IMP, lastDay]);
    for (const y of years) await gift(id, amt, y === Y ? civilPlusDays(-20) : `${y}-12-15`);
  }
  // Last year: a refund, a soft credit and an open pledge, each a usual reason a total differs.
  const ly = `${Y - 1}-12-15`;
  await gift("d_onb3_zell", -200, `${Y - 1}-12-20`, { refundOf: "g_onb3_3" });
  await gift("d_onb3_soft", 500, ly, { type: "soft credit" });
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_at) VALUES ('p_onb3_open',$1,'d_onb3_yates',1000,$2,'open',$3)`, [ORG, ly, `${ly}T12:00:00Z`]);
  await gift("d_onb3_umb", 80, null);   // a gift with no date
  // Nothing is due yet: the file is in but the stamp runs after the import is recorded.
  const dir = await login(DIRECTOR);

  // ── §1 · DUE AFTER THE FIRST DONOR FILE, ONLY FOR A NEW ORG ────────────
  const before = await api("GET", "/org/setup-status", dir);
  ok("§1 before the import is recorded, Home has no first screen", before.status === 200 && !before.body.firstWin, before.body.firstWin);
  await q(`UPDATE orgs SET paper_done_at = NULL WHERE id=$1`, [ORG]);
  ok("§1 a self-serve trial (not in onboarding) is never made due, so its Home is untouched", !(await T.markDue(qq, ORG, IMP)));
  await q(`UPDATE orgs SET paper_done_at = NOW() - INTERVAL '3 days' WHERE id=$1`, [ORG]);
  ok("§1 the first donor file into an org in onboarding with no data in makes the check due", await T.markDue(qq, ORG, IMP));
  const st = await api("GET", "/org/setup-status", dir);
  ok("§1 Home's first screen is now the totals check", st.body.firstWin === "totals", st.body.firstWin);
  // An org that already had a donor file (every customer before this build) never sees it.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ($1,'Oldfield Shelter','onb3-old',1,'active','core','customer')`, [OLD]);
  await mkUser("u_onb3_old", OLD, OLDDIR, "admin");
  await q(`INSERT INTO imports (id,org_id,name,shape,committed_at,actor_user_id) VALUES ('imp_onb3_old1',$1,'old.csv','gifts',NOW() - INTERVAL '90 days','u_onb3_old'),
           ('imp_onb3_old2',$1,'new.csv','gifts',NOW(),'u_onb3_old')`, [OLD]);
  await q(`INSERT INTO donors (id,org_id,name,status,stage,created_import_id,created_by,created_by_name) VALUES ('d_onb3_old',$1,'Odette Fairweather','active','cultivate','imp_onb3_old2','system:test','fixture')`, [OLD]);
  ok("§1 a second file into an org that already had one never makes the check due", !(await T.markDue(qq, OLD, "imp_onb3_old2")));
  const oldSt = await api("GET", "/org/setup-status", await login(OLDDIR));
  ok("§1 that org's Home is unchanged", !oldSt.body.firstWin, oldSt.body.firstWin);

  // The importer's own path (POST /sheet-import/commit), not just the hook: the
  // walk found the spreadsheet import never reached afterImport, so a real file
  // never made the check due.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ($1,'Saltmarsh Kitchen','onb3-sheet',1,'trialing','trial','customer')`, [SHEET]);
  await q(`UPDATE orgs SET paper_done_at = NOW() WHERE id=$1`, [SHEET]);
  await mkUser("u_onb3_sheet", SHEET, "onb3-sheet@example.org", "admin");
  const sTok = await login("onb3-sheet@example.org");
  const sBody = { fileName: "Saltmarsh gifts.csv", sheets: [{ name: "Sheet1", grid: [["Date", "First Name", "Last Name", "Email", "Amount"],
    [`${Y - 1}-12-15`, "Odile", "Varga", "odile.varga@example.org", "150"], [`${Y - 1}-06-02`, "Pell", "Merriweather", "pell.m@example.org", "75"],
    [`${Y - 2}-12-11`, "Odile", "Varga", "odile.varga@example.org", "125"]] }] };
  const sc = await api("POST", "/sheet-import/commit", sTok, { ...sBody, background: true });
  if (sc.status === 202) await waitFor(async () => { const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(sc.body.importId)}`, sTok); return j.body && j.body.status !== "running"; }, { timeout: 60000, interval: 200 });
  const [sOrg] = await q(`SELECT totals_due_at FROM orgs WHERE id=$1`, [SHEET]);
  ok("§1 a real spreadsheet import (the importer's own route) makes the check due", (sc.status === 202 || sc.status === 201) && !!sOrg.totals_due_at, { status: sc.status, body: sc.status >= 300 ? sc.body : undefined, sOrg });

  // ── §2 · THE YEARS ARE shared/numbers' YEARS ───────────────────────────
  const tot = await api("GET", "/onboard/totals", dir);
  const [org] = await q(`SELECT * FROM orgs WHERE id=$1`, [ORG]);
  const truth = await BY.orgByYear(qq, org, today);
  ok("§2 three years shown, newest first", tot.status === 200 && tot.body.years.length === 3, tot.body);
  const same = tot.body.years.every((y, i) => y.key === truth.years[i].key && y.cents === truth.years[i].cents && y.giftCount === truth.years[i].giftCount);
  ok("§2 each year's total and gift count are byYear.orgByYear's, to the cent (the same function as Reports)", same,
    { shown: tot.body.years.map(y => [y.key, y.cents, y.giftCount]), truth: truth.years.slice(0, 3).map(y => [y.key, y.cents, y.giftCount]) });
  ok("§2 every year has its one-line definition and opens its rows", tot.body.years.every(y => /refunds taken off/.test(y.sentence) && y.sources.total.key === "gifts" && y.sources.giftCount.params.measure === "count"));
  const last = tot.body.years.find(y => y.key === `fy:${Y - 1}`);
  const keys = last ? last.explain.map(x => x.key) : [];
  ok("§2 last year's explanations: the refund, the soft credit and the unpaid pledge, each a figure that opens", ["refunds", "soft", "pledges"].every(k => keys.includes(k))
    && last.explain.every(x => x.source && /^onb-/.test(x.source.key)), keys);
  ok("§2 the gift with no date and the rows set aside are said once, for every year", tot.body.always.some(x => x.key === "undated" && x.cents === 8000)
    && tot.body.always.some(x => x.key === `aside:${IMP}` && x.open.id === IMP), tot.body.always);
  // Each explanation's rows foot to its figure.
  for (const x of last ? last.explain : []) {
    const r = await api("GET", `/figures/${x.source.key}/rows?${new URLSearchParams({ ...x.source.params, page: 1, pageSize: 200 })}`, dir);
    const sum = Math.abs((r.body.rows || []).reduce((a, row) => a + Math.round(Number(row.amount) * 100), 0));
    ok(`§2 "${x.key}" opens rows that foot to ${T.fmt(x.cents)}`, r.status === 200 && sum === x.cents, { status: r.status, sum, cents: x.cents, body: r.status === 200 ? undefined : r.body });
  }

  // Matches within $1; a difference reads as one.
  const cents = last ? last.cents : 0;
  const cmp = await api("POST", "/onboard/totals/compare", dir, { typed: { [`fy:${Y - 1}`]: `$${((cents + 60) / 100).toFixed(2)}`, [`fy:${Y - 2}`]: "1,000" } });
  const r1 = cmp.body.rows.find(r => r.key === `fy:${Y - 1}`), r2 = cmp.body.rows.find(r => r.key === `fy:${Y - 2}`);
  ok("§2 a figure within $1 reads Matches", r1 && r1.result && r1.result.matches === true && r1.result.words === "Matches", r1);
  ok("§2 a figure off by more says the difference in plain words", r2 && r2.result && r2.result.matches === false && /less than Steward|more than Steward/.test(r2.result.words), r2);
  ok("§2 matching is to the dollar both ways (pure)", T.compare(10000, 10100).matches && !T.compare(10000, 10101).matches && T.compare(10000, 9900).matches && T.compare(10000, null) === null);

  // ── §3 · LOOKS RIGHT SETS THE DATA-IN GATE ─────────────────────────────
  const ask = await api("POST", "/onboard/totals/ask-jonathan", dir, { key: `fy:${Y - 2}`, typed: "1,000" });
  const [ob] = await q(`SELECT waiting_on FROM org_onboarding WHERE org_id=$1`, [ORG]);
  ok("§3 Ask Jonathan puts the year on the /ops board's Waiting on", ask.status === 200 && ob && /Totals .*old system \$1,000/.test(ob.waiting_on), ob);
  const [pre] = await q(`SELECT data_in_at FROM orgs WHERE id=$1`, [ORG]);
  ok("§3 nothing has set data in before Looks right", !pre.data_in_at);
  const lr = await api("POST", "/onboard/totals/looks-right", dir, { typed: { [`fy:${Y - 1}`]: `${(cents / 100).toFixed(2)}` } });
  const [post] = await q(`SELECT data_in_at FROM orgs WHERE id=$1`, [ORG]);
  const [chk] = await q(`SELECT years, created_by FROM onboard_totals_checks WHERE org_id=$1`, [ORG]);
  ok("§3 Looks right sets orgs.data_in_at (ONBOARD-2's data-in gate)", lr.status === 200 && !!post.data_in_at, { lr: lr.body, post });
  ok("§3 the figures typed are stored with it, with who pressed it", chk && chk.created_by === "u_onb3_dir"
    && chk.years.find(y => y.key === `fy:${Y - 1}`).typedCents === cents && chk.years.find(y => y.key === `fy:${Y - 2}`).typedCents === null, chk);
  const board = await api("GET", "/onboarding/mine", dir);
  ok("§3 the data-in gate reads met", !board.body.tracked || (board.body.stages || []).find(s => s.id === "data").done, board.body);
  const skip = await api("POST", "/onboard/totals/looks-right", dir, { typed: {} });
  ok("§3 Looks right with every box empty still works", skip.status === 200, skip.body);
  const bad = await api("POST", "/onboard/totals/looks-right", dir, { typed: { [`fy:${Y - 1}`]: "about twelve grand" } });
  ok("§3 a figure that is not a dollar amount is asked again, in words", bad.status === 400 && /dollar amount/.test(bad.body.message), bad.body);

  // ── §4 · YOUR FIRST 30 MINUTES ─────────────────────────────────────────
  const st2 = await api("GET", "/org/setup-status", dir);
  ok("§4 after Looks right, Home opens on Your first 30 minutes", st2.body.firstWin === "first", st2.body.firstWin);
  const fs = await waitFor(async () => { const r = await api("GET", "/onboard/first-session", dir); return r.body && !r.body.preparing ? r : null; }, { timeout: 30000, interval: 500 });
  ok("§4 the first session reads", fs && fs.status === 200 && fs.body.show === true && fs.body.steps.length === 3, fs && fs.body);
  const kick = await api("GET", "/onboarding/kickoff", dir);
  const fsIds = fs.body.people.map(p => p.id), kickIds = (kick.body.people || []).map(p => p.id);
  ok("§4 the list is Home's moves, in Home's order (no new ranking)", fsIds.length > 1 && fsIds.length <= 10
    && kickIds.every((id, i) => fsIds[i] === id), { fsIds, kickIds });
  ok("§4 each person carries the reason line Home wrote", fs.body.people.every(p => typeof p.why === "string" && p.why.length > 10), fs.body.people.map(p => p.why));
  ok("§4 the deadline is December 31 when the fiscal year ends later", fs.body.deadline.day === `${Y}-12-31`, fs.body.deadline);
  const FSM = require("../server/onboard/firstSession");
  const dl = FSM.deadline({ fiscal_year_start_month: 12 }, "2026-11-18");
  ok("§4 the deadline is the fiscal year's end when that is sooner (a year ending November 30)", dl.day === "2026-11-30" && /fiscal year/.test(dl.why), dl);
  ok("§4 Stripe and QuickBooks show their real state: not connected", fs.body.connections.stripe.state === "none" && fs.body.connections.quickbooks.state === "none");
  await api("POST", "/onboard/first-session/dismiss", dir, {});
  const dism = await api("GET", "/onboard/first-session", dir);
  ok("§4 dismissed, it comes back from Home until done", dism.body.show === true && dism.body.dismissed === true);
  await api("POST", "/onboard/first-session/reopen", dir, {});
  // Log a touch from the list (the kickoff gate's signal) and connect Stripe.
  const who = fs.body.people[0];
  const logged = await api("POST", `/donors/${who.id}/conversations`, dir, { touchKind: "call", callResult: "talked", line: "Called to say thank you for every December.", date: today, fromMove: true, nextStep: { skipped: true } });
  ok("§4 a touch is logged on someone on the list", logged.status === 200 || logged.status === 201, logged.body);
  await q(`UPDATE orgs SET stripe_account_id='acct_onb3_test' WHERE id=$1`, [ORG]);
  await q(`UPDATE org_onboarding SET stripe_ok_at=NOW() WHERE org_id=$1`, [ORG]);
  await api("POST", "/onboard/first-session/seen", dir, {});
  const done = await api("GET", "/onboard/first-session", dir);
  ok("§4 the call ticks step three (the kickoff gate's own signal)", done.body.steps.find(s => s.id === "touch").done, done.body.steps);
  ok("§4 Stripe reads connected", done.body.connections.stripe.state === "connected", done.body.connections);
  ok("§4 all three done: the screen says so once", done.body.allDone === true && done.body.show === true, done.body);
  await api("POST", "/onboard/first-session/told", dir, {});
  const after = await api("GET", "/org/setup-status", dir);
  ok("§4 then Home returns to normal", after.body.firstWin !== "first" && after.body.firstWin !== "totals", after.body.firstWin);

  // ── §5 · DAY 30: WHO GAVE AGAIN, FROM THE DAY-ONE LIST ONLY ────────────
  const snap = await q(`SELECT donor_id, state FROM onboard_snapshots WHERE org_id=$1 ORDER BY donor_id`, [ORG]);
  const onList = new Set(snap.map(r => r.donor_id));
  ok("§5 Looks right wrote down the day-one list: the lapsed people, not the current giver", onList.has("d_onb3_xan") && onList.has("d_onb3_wolf") && !onList.has("d_onb3_tamsin")
    && snap.every(r => r.state === "lapsed" || r.state === "lapsing"), snap);
  const notYet = await api("GET", "/org/setup-status", dir);
  ok("§5 before day 30 Home shows no readout", notYet.body.firstWin !== "readout", notYet.body.firstWin);
  // Thirty-one days on: move data in back, and give the fixture its month.
  await q(`UPDATE orgs SET data_in_at = NOW() - INTERVAL '31 days' WHERE id=$1`, [ORG]);
  await gift("d_onb3_xan", 250, civilPlusDays(-5), { importId: null });     // on the list, after data in: counts
  await gift("d_onb3_wolf", 400, civilPlusDays(-40), { importId: null });   // on the list, BEFORE data in: never counts
  await gift("d_onb3_tamsin", 60, civilPlusDays(-3), { importId: null });   // after data in, NOT on the list: never counts
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by) VALUES ('i_onb3_giftrow',$1,'d_onb3_xan','gift',$2,'Gift of $250','u_onb3_dir')`, [ORG, civilPlusDays(-5)]);
  const due30 = await api("GET", "/org/setup-status", dir);
  ok("§5 on day 30 Home shows the readout", due30.body.firstWin === "readout", due30.body.firstWin);
  const ro = await api("GET", "/onboard/readout", dir);
  const ids = (ro.body.people || []).map(p => p.id);
  ok("§5 the readout names who gave again, with the amount", ro.status === 200 && ids.length === 1 && ids[0] === "d_onb3_xan" && ro.body.people[0].cents === 25000, ro.body.people);
  ok("§5 a gift dated before data in is never counted", !ids.includes("d_onb3_wolf"), ids);
  ok("§5 a person not on the day-one list is never counted", !ids.includes("d_onb3_tamsin"), ids);
  ok("§5 a gift's own timeline row is not a note logged (the walk saw 278 from the import)", ro.body.notes === 0, ro.body.notes);
  ok("§5 it says what was done: the call logged since data in", ro.body.calls === 1 && /1 call\b/.test(ro.body.did), { calls: ro.body.calls, did: ro.body.did });
  ok("§5 the voice: \"given again since you started\", never \"recovered\"", /given again since you started/.test(ro.body.headline) && !/recover/i.test(JSON.stringify(ro.body)), ro.body.headline);
  const gr = await api("GET", `/figures/onb-gave-again/rows?${new URLSearchParams({ ...ro.body.sources.gave.params, page: 1, pageSize: 200 })}`, dir);
  const grSum = (gr.body.rows || []).reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
  ok("§5 \"gave again\" opens rows that foot to it", gr.status === 200 && grSum === ro.body.totalCents, { grSum, total: ro.body.totalCents });
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ('org_onb3_home','Onb3 Steward Staff','onb3-home',1,'trialing','trial','customer') ON CONFLICT DO NOTHING`);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_onb3_super','org_onb3_home','onb3-super@example.org',$1,'Onb3 Super','admin',true)`, [bcrypt.hashSync(PASS, 10)]);
  const ops = await api("GET", "/ops/onboarding/readouts", await login("onb3-super@example.org"));
  const opsRow = (ops.body.readouts || []).find(r => r.orgId === ORG);
  ok("§5 /ops shows the same readout for the org", ops.status === 200 && opsRow && opsRow.headline === ro.body.headline && opsRow.totalCents === ro.body.totalCents, ops.body);
  const opsNo = await api("GET", "/ops/onboarding/readouts", dir);
  ok("§5 a customer cannot read /ops readouts", opsNo.status === 404 || opsNo.status === 403, opsNo.status);
  await q(`DELETE FROM gifts WHERE org_id=$1 AND donor_id='d_onb3_xan' AND date=$2`, [ORG, civilPlusDays(-5)]);
  const none = await api("GET", "/onboard/readout", dir);
  ok("§5 when nobody has, it says what was done and names the next three to call", none.body.people.length === 0 && /Nobody from your day-one list/.test(none.body.headline)
    && none.body.next.length > 0 && none.body.next.length <= 3 && !/recover/i.test(JSON.stringify(none.body)), { h: none.body.headline, next: none.body.next });

  // ── §6 · PRINT THIS WEEK'S NOTES ───────────────────────────────────────
  const WN = require("../server/onboard/weekNotes");
  const wk = WN.weekOf(today);
  const mid = civilPlusDays(0) <= wk.to ? civilPlusDays(0) : wk.to;
  await q(`UPDATE donors SET about_them='Volunteers at the Saturday pantry with her grandson Milo.' WHERE id='d_onb3_zell'`);
  await q(`UPDATE donors SET do_not_contact=true WHERE id='d_onb3_vale'`);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,created_by,created_by_name) VALUES
           ('th_onb3_1',$1,'d_onb3_zell','thank_you_note','Send thank-you note',$2,$3,'system:test','fixture'),
           ('th_onb3_2',$1,'d_onb3_vale','thank_you_note','Send thank-you note',$2,$3,'system:test','fixture'),
           ('th_onb3_3',$1,'d_onb3_soft','follow_up','Call to check in',$2,$3,'system:test','fixture')`, [ORG, mid, today]);
  await q(`INSERT INTO tasks (id,org_id,title,due,donor_id,done,type,created_by,created_by_name) VALUES
           ('t_onb3_1',$1,'Write a note to Yusuf',$2,'d_onb3_yates',0,'donor','system:test','fixture')`, [ORG, WN.weekOf(civilPlusDays(7)).from]);
  const wn = await api("GET", "/notes/this-week", dir);
  const wIds = (wn.body.people || []).map(p => p.id);
  ok("§6 the list holds the person with a thank-you due this week", wn.status === 200 && wIds.includes("d_onb3_zell"), wn.body);
  ok("§6 never a person whose note is due next week", !wIds.includes("d_onb3_yates"), wIds);
  ok("§6 never a do-not-contact person", !wIds.includes("d_onb3_vale"), wIds);
  ok("§6 never a step that is not a thank-you or a note", !wIds.includes("d_onb3_soft"), wIds);
  const zrow = (wn.body.people || []).find(p => p.id === "d_onb3_zell") || {};
  ok("§6 each row: address, last gift, the About note's detail and a first line from those facts", (zrow.address || []).join(" ").includes("12 Gull Lane")
    && zrow.lastGift && /Milo/.test(zrow.about) && /^Dear .*thank you for your gift of \$/.test(zrow.firstLine), zrow);
  const before6 = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  await api("GET", "/notes/this-week", dir);
  const after6 = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  ok("§6 reading the list changes nothing (a GET never changes state)", before6[0].n === after6[0].n);
  const empty = await api("GET", "/notes/this-week", await login(OLDDIR));
  ok("§6 nobody due: the page says so instead of printing blank", empty.status === 200 && empty.body.people.length === 0 && /Nothing to print/.test(empty.body.empty), empty.body);
  for (const o of [ORG, OLD, SHEET, "org_onb3_home"]) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb3-%@example.org'`);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
