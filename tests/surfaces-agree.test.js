// tests/surfaces-agree.test.js: HARDEN-1. EVERY SURFACE GIVES ONE ANSWER.
// The build's one new test (it guards donor data and money: a number on one
// screen that another screen contradicts is a number nobody can trust).
//
// 27 Oct, prod, three screens contradicted the file:
//   · the Move Report said "Steward holds 3,315 gifts, $2,887,186.01" in an
//     org whose people from that import had all been deleted, and did not say
//     it was comparing the whole move rather than the one file;
//   · Home said "Giving this year is $63,984 behind last year at this point"
//     while Fundraising said "↓ $210,535.51 vs last period", this year so far
//     against ALL of last year;
//   · Home said "This is your file, 40 people, and no giving history in it
//     yet" above 1,208 donors.
//
// Org A: two fiscal years of gifts, a deleted person who gave in both, a
// group, an event with attendance, a campaign with a goal, a giving page and two imports of
// one move whose first file's people are all deleted. Org B: a move whose one
// run carried 3 people and no gifts, then 5 people with gifts another way.
// tests/lib/surfacesAgree.js asks every surface and lists each disagreement.
//
// HOW IT GOES RED ON MAIN: the Move Report counts the deleted people's gifts
// and its headline names no scope; Fundraising's delta is against the whole of
// last year; the giving page counts the deleted person's gift; org B's Home
// line says 3 people above 8.
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const orgTime = require("../orgTime");

const PASSWORD = "loadtest1234";
const STAMP = require("crypto").randomBytes(5).toString("hex");
const ORG_A = "org_hs1sa_" + STAMP, ORG_B = "org_hs1sb_" + STAMP, ORG_C = "org_hs1sc_" + STAMP;

async function freshOrg(id) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, "Surfaces " + id, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
// One check, reported as a PASS or the precise list of disagreements.
async function agrees(name, orgId, tok) {
  const r = await assertSurfacesAgree(orgId, { token: tok, soft: true });
  ok(`${name} (${r.ms}ms)`, r.ok, r.diffs.length);
  for (const d of r.diffs) console.log("        " + d);
  return r;
}

async function main() {
  const today = civilToday();
  const t = orgTime.parseCivil(today);
  const fyStart = `${t.m < 7 ? t.y - 1 : t.y}-07-01`;               // the default July year
  const lyStart = `${Number(fyStart.slice(0, 4)) - 1}-07-01`;        // same days last year begin here
  const lyLate = orgTime.addDays(fyStart, -1);                        // last year, after the same days
  const older = orgTime.addDays(fyStart, -500);

  // ── ORG A ────────────────────────────────────────────────────────────────
  const tok = await freshOrg(ORG_A);
  const RUN1 = "imp_hs1a1_" + STAMP, RUN2 = "imp_hs1a2_" + STAMP;
  const file1 = [{ name: "Marta Oldfile", email: "marta@hs1.test" }, { name: "Milo Oldfile", email: "milo@hs1.test" }];
  const gifts1 = [{ donorIndex: 0, amount: 700, date: older }, { donorIndex: 1, amount: 900, date: lyLate }];
  const r1 = await api("POST", "/donors/import-combined", tok, { importId: RUN1, donors: file1, gifts: gifts1 });
  const moveFile = (rows) => ({ people: new Set(rows.map(r => r.k)).size, households: 0, gifts: rows.length,
    cents: rows.reduce((a, r) => a + r.c, 0), recurringPeople: 0, byYear: [], topDonors: [], undatedGifts: 0 });
  await api("POST", "/imports", tok, { id: RUN1, name: "Old system, first file", migrationSource: "donorperfect", shape: "combined",
    giftsCreated: 2, donorsCreated: 2, summary: { moveFile: moveFile([{ k: "marta", c: 70000 }, { k: "milo", c: 90000 }]) } });

  const people = ["Ada Lively", "Bram Lively", "Cleo Lively", "Dov Lively", "Esme Lively", "Zed Goner"].map((n, i) => ({ name: n, email: `p${i}@hs1.test` }));
  const gifts = [
    { donorIndex: 0, amount: 1000, date: fyStart }, { donorIndex: 1, amount: 500, date: today }, { donorIndex: 2, amount: 250, date: fyStart },
    { donorIndex: 5, amount: 5000, date: today },                                       // Zed, this year
    { donorIndex: 0, amount: 2000, date: lyStart }, { donorIndex: 3, amount: 1500, date: lyStart },
    { donorIndex: 5, amount: 3000, date: lyStart },                                     // Zed, same days last year
    { donorIndex: 0, amount: 4000, date: lyLate }, { donorIndex: 4, amount: 800, date: lyLate },
    { donorIndex: 4, amount: 300, date: older },
  ];
  const r2 = await api("POST", "/donors/import-combined", tok, { importId: RUN2, donors: people, gifts });
  await api("POST", "/imports", tok, { id: RUN2, name: "Old system, whole file again", migrationSource: "donorperfect", shape: "combined",
    giftsCreated: gifts.length, donorsCreated: people.length, summary: { moveFile: moveFile(gifts.map(g => ({ k: people[g.donorIndex].email, c: g.amount * 100 }))) } });
  ok("setup: two imports of one move land", r1.status === 200 && r2.status === 200, [r1.status, r2.status]);

  const ids = Object.fromEntries((await q(`SELECT id, name FROM donors WHERE org_id=$1`, [ORG_A])).map(r => [r.name, r.id]));
  const Z = ids["Zed Goner"];
  // a campaign with a goal, Ada's and Zed's this-year gifts in it
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,created_by,created_by_name)
           VALUES ($1,$2,'Autumn Appeal','appeal','active',10000,$3,$4,'system:test','test')`,
    ["cmp_hs1_" + STAMP, ORG_A, orgTime.addDays(fyStart, -30), orgTime.addDays(today, 60)]);
  await q(`UPDATE gifts SET campaign_id=$1 WHERE org_id=$2 AND donor_id = ANY($3) AND date >= $4`, ["cmp_hs1_" + STAMP, ORG_A, [ids["Ada Lively"], Z], fyStart]);
  // a group of three, one of them Zed
  const grp = await api("POST", "/groups", tok, { name: "Front row", kind: "static" });
  await api("POST", `/groups/${grp.body.id}/members`, tok, { donorIds: [ids["Ada Lively"], ids["Bram Lively"], Z] });
  // an event: Ada and Zed attended, Bram confirmed
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,created_by,created_by_name) VALUES ($1,$2,'Harvest Supper','gala',$3,'completed','system:test','test')`,
    ["ev_hs1_" + STAMP, ORG_A, fyStart]);
  for (const [n, st] of [["Ada Lively", "attended"], ["Bram Lively", "confirmed"], ["Zed Goner", "attended"]]) {
    await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status) VALUES ($1,$2,$3,$4,$5,$6)`,
      [`ea_hs1_${STAMP}_${n.split(" ")[0]}`, "ev_hs1_" + STAMP, ORG_A, ids[n], n, st]);
  }
  // a giving page Ada and Zed gave through
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,created_by,created_by_name) VALUES ($1,$2,$3,'Give to the Supper','active','system:test','test')`,
    ["gp_hs1_" + STAMP, ORG_A, "supper-" + STAMP]);
  await q(`UPDATE gifts SET giving_page_id=$1 WHERE org_id=$2 AND donor_id = ANY($3) AND date >= $4`, ["gp_hs1_" + STAMP, ORG_A, [ids["Ada Lively"], Z], fyStart]);
  await agrees("A: before any delete, every surface agrees", ORG_A, tok);

  // delete Zed and both people of the first file
  const gone = [Z, ids["Marta Oldfile"], ids["Milo Oldfile"]];
  const del = await api("POST", "/donors/bulk-delete", tok, { ids: gone, count: gone.length });
  ok("A: three deleted", del.status === 200 && del.body.deleted === 3, del.body);
  const after = await agrees("A: after the delete, every surface agrees and none shows them", ORG_A, tok);
  ok("A: the helper saw the deleted person's money gone from this year", after.facts["giving this year so far"]
     && Object.values(after.facts["giving this year so far"]).every(v => v === 175000), after.facts["giving this year so far"]);
  // HARDEN-1: /annual-fund has no screen today, but it is still a route that
  // answers "raised this year", so it counts nobody deleted either.
  const af = (await api("GET", "/annual-fund", tok)).body || {};
  const [{ live }] = await q(`SELECT COALESCE(SUM(g.amount),0)::float AS live FROM gifts g
     WHERE g.org_id=$1 AND LEFT(g.date::text,4)=$2
       AND NOT EXISTS (SELECT 1 FROM donors d WHERE d.id=g.donor_id AND d.deleted_at IS NOT NULL)`, [ORG_A, String(af.year)]);
  ok("A: /annual-fund raised this year counts no deleted person", Math.round(Number(af.totalRaised) * 100) === Math.round(live * 100),
     { annualFund: af.totalRaised, live, year: af.year });

  // Undo brings Zed back, and every surface counts him again
  const undoZ = await api("POST", `/deleted-records/${del.body.undoIds[0]}/restore`, tok, {});
  ok("A: the Undo restores one person", undoZ.status === 200, undoZ.status + " " + JSON.stringify(undoZ.body).slice(0, 200));
  await agrees("A: after the Undo, every surface agrees", ORG_A, tok);
  await api("POST", "/donors/bulk-delete", tok, { ids: [Z], count: 1 });

  // ── ORG B: the stale Home line ───────────────────────────────────────────
  const tokB = await freshOrg(ORG_B);
  await q(`UPDATE orgs SET migration_source='donorperfect', migration_started_at=NOW() WHERE id=$1`, [ORG_B]);
  const RUNB = "imp_hs1b_" + STAMP;
  await api("POST", "/donors/import-combined", tokB, { importId: RUNB, donors: [1, 2, 3].map(i => ({ name: `Only Person${i}`, email: `o${i}@hs1.test` })), gifts: [] });
  await api("POST", "/imports", tokB, { id: RUNB, name: "People only", migrationSource: "donorperfect", shape: "donors", donorsCreated: 3,
    summary: { moveFile: { people: 3, households: 0, gifts: 0, cents: 0, recurringPeople: 0, byYear: [], topDonors: [] } } });
  await api("POST", "/donors/import-combined", tokB, { donors: [1, 2, 3, 4, 5].map(i => ({ name: `Giving Person${i}`, email: `g${i}@hs1.test` })),
    gifts: [1, 2, 3, 4, 5].map(i => ({ donorIndex: i - 1, amount: 40 * i, date: fyStart })) });
  const mv = (await api("GET", "/move", tokB)).body.move || {};
  ok("B: Home's file line reads the file as it is now", !/3 people/.test(mv.homeLine || ""), mv.homeLine);
  await agrees("B: every surface agrees", ORG_B, tokB);
  await janFirst();
}

// ── ORG C: HARDEN-1, A GIFT DATED JANUARY 1 COUNTS IN JANUARY ──────────────
// gifts.date is text, and `new Date("2026-01-01")` is UTC midnight: every zone
// west of UTC reads it with a local getter or formatter as Dec 31, 2025. The
// mirror: pg hands a DATE column back as a Date at LOCAL midnight, so
// toISOString() reads the day before east of UTC, and String() of it is not a
// day at all. Org C keeps a January year. Pia gave on Jan 1 of last year and
// of this year; Quin gave on Dec 31 of last year, so a one-day shift is seen;
// Rae gave $7 on Jan 1 of the two years before, for Reports' completed years.
//
// HOW IT GOES RED ON THE UNFIXED CODE: the public event page answers the date
// "Thu Jan 01" (String of a pg Date); /billing/status answers the custom
// price's end as a UTC timestamp; the helpers below do not exist; the static
// scan lists every `new Date(<stored day>)` read in local time. The API
// checks run in the battery server's zone (New York on the scratch box, UTC
// on CI), so the pure ones also run in a child at TZ=America/New_York and
// TZ=Asia/Tokyo, where the bug shows whatever zone the runner is in.
const ROOT = require("path").join(__dirname, "..");
function zoneProbe(tz, Y) {
  const code = `
    import { createRequire } from "module";
    const require = createRequire(${JSON.stringify(ROOT + "/")});
    const O = require("./orgTime.js");
    const D = await import(${JSON.stringify("file://" + ROOT + "/shared/displayDate.js")});
    const jan = "${Y}-01-01", dec = "${Y - 1}-12-31";
    console.log(JSON.stringify({
      year: D.civilYear(jan), decYear: D.civilYear(dec), month: D.displayMonth(jan), day: D.displayDate(jan),
      longMonth: O.civilLocale(jan, { month: "long", year: "numeric" }), longDay: O.civilLocale(jan, { month: "long", day: "numeric" }),
      text: O.civilOf(jan), pgDate: O.civilOf(new Date(${Y}, 0, 1)), stamp: O.civilOf("${Y}-01-01T00:00:00.000Z"),
      blank: O.civilOf(""), bad: O.civilLocale("not a day") }));`;
  const out = require("child_process").execFileSync(process.execPath, ["--input-type=module", "-e", code],
    { env: { ...process.env, TZ: tz, NODE_OPTIONS: "" }, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop());
}
// A stored day (a field named for one) built into a Date and read in local
// time, or pg's DATE turned into a day with toISOString(). The two allowed
// below are moments, not days: a CSV cell of any value, and a grant file's
// saved-at stamp.
const SCAN_SKIP = /(^|\/)(node_modules|dist[^/]*|tests|scripts|docs|audit|marketing|\.git|\.claude)(\/|$)/;
const SCAN_ALLOW = [/^routes\/crm\.js: const cell = v => reportCsvCell\(v instanceof Date/, /^routes\/grantLibrary\.js: const iso = d => \(d instanceof Date/];
function localDayReads() {
  const fs = require("fs"), path = require("path");
  const FIELD = String.raw`(?:[\w$]+\??\.)*(?:date|due_date|dueDate|last_gift_date|first_gift_date|lastGift|firstGift|lastGiftDate|firstGiftDate|start_date|end_date|ends_on|endsOn|deadline|expected_close)`;
  const LOCAL = String.raw`\.(?:getFullYear|getMonth|getDate|getDay|toLocaleDateString|toLocaleString|toDateString)\(`;
  const INLINE = new RegExp(String.raw`new Date\(\s*${FIELD}\s*\)\s*${LOCAL}`);
  const ASSIGN = new RegExp(String.raw`(?:const|let|var)\s+([\w$]+)\s*=\s*new Date\(\s*${FIELD}\s*\)\s*;`);
  const MIRROR = /([\w$]+(?:\.[\w$]+)*) instanceof Date \? \1\.toISOString\(\)/;
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), rel = path.relative(ROOT, p);
      if (SCAN_SKIP.test(rel)) continue;
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(c|m)?jsx?$/.test(e.name)) continue;
      const L = fs.readFileSync(p, "utf8").split("\n");
      const hit = (i, l) => { const h = `${rel}: ${l.trim()}`; if (!SCAN_ALLOW.some(a => a.test(h))) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 120)}`); };
      L.forEach((l, i) => {
        if (/^\s*\/\//.test(l)) return;
        if (INLINE.test(l) && !/timeZone/.test(l)) hit(i, l);
        const a = ASSIGN.exec(l);
        if (a) for (let j = i; j < Math.min(L.length, i + 8); j++) {
          if (new RegExp(String.raw`\b${a[1].replace(/\$/g, "\\$")}${LOCAL}`).test(L[j]) && !/timeZone/.test(L[j])) { hit(j, L[j]); break; }
        }
        const m = MIRROR.exec(l);
        if (m && !/(_at|current_period_end)\b/.test(m[1])) hit(i, l);
      });
    }
  })(ROOT);
  return hits;
}

async function janFirst() {
  const Y = orgTime.parseCivil(civilToday()).y, P = Y - 1;
  const tokC = await freshOrg(ORG_C);
  await q(`UPDATE orgs SET vocabulary_json=$2, custom_price_cents=4900, custom_price_ends_on=$3 WHERE id=$1`,
    [ORG_C, JSON.stringify({ fiscal_year_start_month: 1 }), `${Y}-12-31`]);
  const r = await api("POST", "/donors/import-combined", tokC, { donors: [{ name: "Pia January", email: "pia@hs1.test" }, { name: "Quin December", email: "quin@hs1.test" }, { name: "Rae Early", email: "rae@hs1.test" }],
    gifts: [{ donorIndex: 0, amount: 100, date: `${P}-01-01` }, { donorIndex: 0, amount: 300, date: `${Y}-01-01` }, { donorIndex: 1, amount: 50, date: `${P}-12-31` },
      { donorIndex: 2, amount: 7, date: `${P - 1}-01-01` }, { donorIndex: 2, amount: 7, date: `${P}-01-01` }] });
  ok("C: Jan 1 and Dec 31 gifts land", r.status === 200, r.status);
  const c = v => Math.round(Number(v) * 100);
  const get = path => api("GET", path, tokC).then(x => x.body || {});

  // /annual-fund: the year, its January, and retention
  const [afY, afP] = await Promise.all([get(`/annual-fund?year=${Y}`), get(`/annual-fund?year=${P}`)]);
  ok("C: /annual-fund counts this year's Jan 1 gift in this year's January", c(afY.totalRaised) === 30000 && c(afY.monthly?.[0]?.raised) === 30000,
     { total: afY.totalRaised, jan: afY.monthly?.[0] });
  ok("C: /annual-fund counts last year's Jan 1 in its January and Dec 31 in its December", c(afP.totalRaised) === 15700
     && c(afP.monthly?.[0]?.raised) === 10700 && c(afP.monthly?.[11]?.raised) === 5000, { total: afP.totalRaised, jan: afP.monthly?.[0], dec: afP.monthly?.[11] });
  ok("C: retention: Pia, who gave only on Jan 1 each year, is retained (1 of 3)", afY.donors?.retained === 1 && afY.donors?.retentionRate === 33, afY.donors);

  // Reports: the giving summary by year and by month, and retention by year
  const [gsY, gsP, ret] = await Promise.all([get(`/reports/giving-summary?year=${Y}&yearMode=calendar`),
    get(`/reports/giving-summary?year=${P}&yearMode=calendar`), get(`/reports/retention?year=${Y}&yearMode=calendar`)]);
  const mo = (gs, ym) => c((gs.monthly || []).find(m => m.month === ym)?.total || 0);
  ok("C: Reports' giving summary puts each Jan 1 in its year and its January", c(gsY.total) === 30000 && c(gsP.total) === 15700
     && mo(gsY, `${Y}-01`) === 30000 && mo(gsP, `${P}-01`) === 10700 && mo(gsP, `${P}-12`) === 5000 && mo(gsP, `${P - 1}-12`) === 0,
     { y: gsY.total, p: gsP.total, monthsY: gsY.monthly, monthsP: gsP.monthly });
  const rowP = (ret.rows || []).find(x => x.year === P) || {};   // completed years only
  ok("C: Reports' retention counts Rae, who gave only on Jan 1, retained last year", rowP.priorDonors === 1 && rowP.retainedDonors === 1, (ret.rows || []).map(x => [x.year, x.label, x.priorDonors, x.retainedDonors]));

  // Home, Fundraising and the Board: one this-year figure, one difference
  const f = await agrees("C: every surface agrees", ORG_C, tokC);
  const thisYear = f.facts["giving this year so far"] || {};
  const ahead = Object.entries(f.facts).find(([k]) => /^ahead of or behind/.test(k))?.[1] || {};
  ok("C: Home, Fundraising and the Board all count the Jan 1 gift this year", Object.keys(thisYear).length >= 3
     && Object.values(thisYear).every(v => v === 30000), thisYear);
  ok("C: and last year's Jan 1 in the same days last year", Object.keys(ahead).length >= 2 && Object.values(ahead).every(v => v === 19300), ahead);
  const prof = await get(`/donors/${(await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Pia January'`, [ORG_C]))[0].id}`);
  ok("C: the profile's first and last gift are Jan 1", String(prof.first_gift_date).slice(0, 10) === `${P}-01-01` && String(prof.last_gift_date).slice(0, 10) === `${Y}-01-01`,
     [prof.first_gift_date, prof.last_gift_date]);

  // A DATE column, read as its day: an event on Jan 1 and a price that ends Dec 31
  const EV = "ev_hs1c_" + STAMP;
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,created_by,created_by_name) VALUES ($1,$2,'New Year Walk','walk',$3,'upcoming','system:test','test')`,
    [EV, ORG_C, `${Y}-01-01`]);
  const pub = (await api("GET", `/org/${ORG_C.replace(/_/g, "-")}/event/${EV}/public`, null)).body || {};
  ok("C: the public event page dates a Jan 1 event Jan 1", pub.event?.date === `${Y}-01-01`, pub.event);
  const bill = await get("/billing/status");
  ok("C: Billing says the agreed price ends on its own day", bill.customPrice?.endsOn === `${Y}-12-31`, bill.customPrice);

  // The helpers every fixed place reads through, in a zone west and east of UTC
  for (const tz of ["America/New_York", "Asia/Tokyo"]) {
    let z = null; try { z = zoneProbe(tz, Y); } catch (e) { z = { error: String(e.message).slice(0, 300) }; }
    ok(`C: at TZ=${tz}, a Jan 1 day stays Jan 1 through the civil helpers`, z && z.year === Y && z.decYear === P && z.month === `Jan ${Y}`
       && z.day === `Jan 1, ${Y}` && z.longMonth === `January ${Y}` && z.longDay === "January 1" && z.text === `${Y}-01-01`
       && z.pgDate === `${Y}-01-01` && z.stamp === `${Y}-01-01` && z.blank === null && z.bad === "", z);
  }
  const reads = localDayReads();
  ok("C: no source file reads a stored day through a Date in local time", reads.length === 0, reads.length);
  for (const h of reads) console.log("        " + h);
}

main().then(async () => { await closeDb(); summary(); }).catch(async e => { console.error(e); await closeDb(); process.exit(1); });
