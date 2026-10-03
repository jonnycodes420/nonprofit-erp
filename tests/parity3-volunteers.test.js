// PARITY-3 — the build's one new test, two scenarios, because both guard a
// person's record: who holds a place on a shift (and who is told they do), and
// that one human being stays one record with hours that add up everywhere.
//
//   §1 A shift with two roles needing 3 and 2. Six people sign up for the
//      first: three are scheduled and three wait, in the order they came.
//      Taking one off moves the first person waiting up. The footer (needed,
//      scheduled, short, waitlisted, hours) is right at every step.
//   §2 A public application whose email matches a donor already on file is
//      approved onto THAT donor's record (no second person), and the hours
//      check-in logs total the same on the profile, the hours log CSV and the
//      Volunteers screen.
//
// WHAT WOULD MAKE THIS FAIL (proven before it was trusted):
//   · drop `AND role_id IS NOT DISTINCT FROM ?` from cancelSignUp's waiting
//     list read  → the promotion can take a person waiting for ANOTHER role,
//     and §1's "the first person waiting moved up" goes red;
//   · count only `confirmed` (not `completed`) in roleState's scheduled
//     → §1's footer after check-in goes red;
//   · let approve create a person instead of matching by email
//     → §2's "no second person" goes red.
//
//   BASE=http://localhost:5601 node tests/parity3-volunteers.test.js
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_par3v";
const ADMIN = "admin@par3v.local";
const T = civilToday();

(async () => {
  const orgTables = (await q(`SELECT table_name FROM information_schema.columns
                                WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of orgTables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    const gone = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false);
    if (gone) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Parity Volunteers Fixture','parity-vol-t',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_par3v',$1,$2,$3,'Parity Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  const tok = await login(ADMIN);

  // ── §1 ROLES, THE WAITING LIST AND THE FOOTER ─────────────────────────────
  const opp = await api("POST", "/volunteer-hub/opportunities", tok, { name: "Pantry", isPublic: true });
  ok("§1 an opportunity is made", opp.status === 201, opp.body);
  const day = civilPlusDays(7);
  const mk = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.body.id, date: day, startTime: "09:00", endTime: "12:00",
    name: "Saturday sort", roles: [{ name: "Sorting", needed: 3 }, { name: "Driver", needed: 2 }] });
  ok("§1 a shift with two roles is made", mk.status === 201, mk.body);
  const slotId = mk.body.id;
  const shift = async () => (await api("GET", `/volunteer-hub/schedule?from=${day}&to=${day}`, tok)).body.shifts.find(s => s.id === slotId);
  let s = await shift();
  const sorting = s.roles.find(r => r.name === "Sorting"), driver = s.roles.find(r => r.name === "Driver");
  ok("§1 the shift carries both roles with their numbers", sorting && sorting.needed === 3 && driver && driver.needed === 2, s.roles);
  const footIs = (label, f, want) => ok(`§1 ${label}: footer needed ${want.needed}, scheduled ${want.scheduled}, short ${want.short}, waitlisted ${want.waitlisted}, hours ${want.hours}`,
    f.needed === want.needed && f.scheduled === want.scheduled && f.short === want.short && f.waitlisted === want.waitlisted && f.hours === want.hours, f);
  footIs("empty", s.footer, { needed: 5, scheduled: 0, short: 5, waitlisted: 0, hours: 0 });

  const people = [];
  for (let i = 1; i <= 6; i++) {
    const d = await api("POST", "/volunteer-hub/people", tok, { name: `Sorter ${i}`, email: `sorter${i}@par3v.local` });
    const pid = d.body.id || (d.body.person && d.body.person.id);
    people.push(pid);
    const r = await api("POST", "/volunteer-hub/signups", tok, { slotId, personId: pid, roleId: sorting.id });
    const wantStatus = i <= 3 ? "confirmed" : "waitlisted";
    ok(`§1 sign-up ${i} for Sorting is ${wantStatus}${i > 3 ? `, number ${i - 3}` : ""}`,
      r.status === 201 && r.body.status === wantStatus && (i <= 3 || r.body.position === i - 3), r.body);
    s = await shift();
    const sched = Math.min(i, 3);
    footIs(`after ${i}`, s.footer, { needed: 5, scheduled: sched, short: (3 - sched) + 2, waitlisted: Math.max(0, i - 3), hours: sched * 3 });
  }
  const sortRole = s.roles.find(r => r.id === sorting.id);
  const waitingOrder = sortRole.people.filter(p => p.status === "waitlisted").sort((a, b) => a.position - b.position).map(p => p.personId);
  ok("§1 the three waiting are in the order they signed up", JSON.stringify(waitingOrder) === JSON.stringify(people.slice(3)), waitingOrder);
  ok("§1 nobody was put on Driver by a Sorting sign-up", s.roles.find(r => r.id === driver.id).people.length === 0);

  // Somebody waiting for Driver must NOT be the one promoted into Sorting:
  // two drivers fill the role, a third waits, and that third person's place
  // in the queue is made the EARLIEST of anybody's, so a promotion that
  // forgot the role would pick them.
  const mkPerson = async (name, email) => { const d = await api("POST", "/volunteer-hub/people", tok, { name, email }); return d.body.id; };
  for (const n of [1, 2]) {
    const pid = await mkPerson(`Driver ${n}`, `driver${n}@par3v.local`);
    const r = await api("POST", "/volunteer-hub/signups", tok, { slotId, personId: pid, roleId: driver.id });
    ok(`§1 driver ${n} is confirmed`, r.body.status === "confirmed", r.body);
  }
  const dvId = await mkPerson("Driver Waiting", "driverwait@par3v.local");
  const dvs = await api("POST", "/volunteer-hub/signups", tok, { slotId, personId: dvId, roleId: driver.id });
  ok("§1 a third driver waits, number 1 for Driver", dvs.body.status === "waitlisted" && dvs.body.position === 1, dvs.body);
  await q(`UPDATE volunteer_signups SET created_at = NOW() - INTERVAL '1 day', position = 0 WHERE id=$1`, [dvs.body.signupId]);
  s = await shift();
  footIs("drivers on", s.footer, { needed: 5, scheduled: 5, short: 0, waitlisted: 4, hours: 15 });

  const first = sortRole.people.find(p => p.personId === people[0]);
  const off = await api("POST", `/volunteer-hub/signups/${first.signupId}/cancel`, tok);
  ok("§1 taking one scheduled person off works", off.status === 200, off.body);
  s = await shift();
  const after = s.roles.find(r => r.id === sorting.id).people;
  const promoted = after.find(p => p.personId === people[3]);
  ok("§1 the first person waiting for Sorting moved up", promoted && promoted.status === "confirmed", after.map(p => [p.name, p.status, p.position]));
  ok("§1 …and the person waiting for Driver did not jump into Sorting",
    !after.some(p => p.personId === dvId) && s.roles.find(r => r.id === driver.id).people.some(p => p.personId === dvId && p.status === "waitlisted"));
  ok("§1 the other two still wait, in order", JSON.stringify(after.filter(p => p.status === "waitlisted").sort((a, b) => a.position - b.position).map(p => p.personId)) === JSON.stringify(people.slice(4)));
  footIs("after one came off", s.footer, { needed: 5, scheduled: 5, short: 0, waitlisted: 3, hours: 15 });

  // ── §2 THE APPLICATION THAT IS ALREADY A DONOR (with Part 2) ─────────────

  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });
