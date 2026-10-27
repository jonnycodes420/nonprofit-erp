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
const ORG_A = "org_hs1sa_" + STAMP, ORG_B = "org_hs1sb_" + STAMP;

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
}

main().then(async () => { await closeDb(); summary(); }).catch(async e => { console.error(e); await closeDb(); process.exit(1); });
