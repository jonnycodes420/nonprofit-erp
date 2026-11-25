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
//   §3 FIX-24 · "Make a volunteer" from the profile and Add a volunteer
//      picking somebody on file both go through makeVolunteer: the SAME
//      person (no second record), an active volunteer record with hours a
//      week, days and roles, in the Volunteers group; a second press updates
//      it. Planted before trusted: let makeVolunteer INSERT a donor → "still
//      one record" goes red; skip the approved application → "in the
//      Volunteers group" goes red.
//
//   §5 STALE-2 · the QA fleet's 7 Nov volunteer items: a sign-up that
//      overlaps a shift the person holds answers 409 naming the clash, and
//      goes on when confirmed (09X); a deleted volunteer leaves no conflict on
//      the schedule or its count (09Y); a logged shift's hours, date and role
//      change, and the audit row holds before and after (12); the profile
//      lists scheduled shifts under Coming up and Past shifts (24); a tagged
//      volunteer with nothing logged answers 0 hours, 0 shifts (13X); taking
//      somebody off a shift names them, never a bare "Cancelled." (25X); a
//      draft shift nobody is on deletes, a published one is refused.
//      Each was run against main first and went red there.
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

  // ── §2 THE APPLICATION THAT IS ALREADY A DONOR ──────────────────────────
  // A donor on file applies from the public page with the same email in other
  // capitals. Approving puts volunteering on THAT record: no second person.
  const GIVER = "d_par3v_giver";
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,'Gale Giver','gale.giver@par3v.local','cultivate','system:test','test')`, [GIVER, ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_par3v_1',$1,$2,250,$3,'system:test','test')`, [ORG, GIVER, civilPlusDays(-40)]);
  const onFileCount = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND LOWER(email)='gale.giver@par3v.local'`, [ORG]))[0].n);
  const pub = await api("PUT", "/volunteer-hub/recruitment", tok, { title: "Help at the pantry", bodyHtml: "<h2>Why</h2><p>Hands needed.</p><script>x()</script>",
    published: true, questions: [{ label: "Have you volunteered before?", type: "yesno", required: true }] });
  ok("§2 the recruitment page is published, its words kept and the script dropped", pub.status === 200 && pub.body.published && !/script/.test(pub.body.bodyHtml) && /<h2>Why<\/h2>/.test(pub.body.bodyHtml), pub.body);
  const qid = pub.body.questions[0].id;
  const form = new URLSearchParams({ name: "Gale Giver", email: "Gale.Giver@PAR3V.local", phone: "555-0199", [`q_${qid}`]: "yes", availability: "Saturdays" });
  const sent = await fetch(`${require("./helpers").BASE}/volunteer-with/parity-vol-t/apply`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  // POLISH-1: the volunteer is told "You're in" and when to expect a reply.
  ok("§2 the public application is accepted", sent.status === 200 && /You're in\./.test(await sent.text()));
  ok("§2 applying makes no person: still exactly one record with that email", await onFileCount() === 1);
  const pend = await api("GET", "/volunteer-hub/applications", tok);
  const app = (pend.body.applications || []).find(a => a.email === "gale.giver@par3v.local");
  ok("§2 it waits in Pending applications, naming the donor already on file", app && pend.body.pending >= 1 && app.onFile.some(m => m.id === GIVER && m.gives), pend.body);
  const appr = await api("POST", `/volunteer-hub/applications/${app.id}/approve`, tok, {});
  ok("§2 approving puts it on the donor's own record", appr.status === 200 && appr.body.personId === GIVER && appr.body.matchedExisting === true, appr.body);
  ok("§2 …and there is still exactly one person with that email", await onFileCount() === 1);
  const [pt] = await q(`SELECT person_types FROM donors WHERE id=$1`, [GIVER]);
  ok("§2 the donor is now also a Volunteer", JSON.stringify(pt.person_types).includes("volunteer"), pt.person_types);
  const again = await api("POST", `/volunteer-hub/applications/${app.id}/approve`, tok, {});
  ok("§2 a second approval is refused, not repeated", again.status === 409);

  // Hours from check-in: a 09:00 to 12:00 shift is 3 hours, plus 1h30 logged
  // by hand. The profile, its CSV and the Volunteers screen all say 4.5.
  const mk2 = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.body.id, date: civilPlusDays(-1), startTime: "09:00", endTime: "12:00", capacity: 5 });
  const su = await api("POST", "/volunteer-hub/signups", tok, { slotId: mk2.body.id, personId: GIVER });
  const ci = await api("POST", "/volunteer-hub/checkin", tok, { signupId: su.body.signupId });
  ok("§2 check-in logs 3 hours from the shift's times", ci.status === 200 && ci.body.hours === 3, ci.body);
  const ci2 = await api("POST", "/volunteer-hub/checkin", tok, { signupId: su.body.signupId });
  ok("§2 check-out writes no second set of hours", ci2.status === 200 && ci2.body.state === "checked_out");
  const hand = await api("POST", `/donors/${GIVER}/volunteer-hours`, tok, { date: civilPlusDays(-2), hours: "1", minutes: "30", opportunityId: opp.body.id });
  ok("§2 an hour and a half logged by hand", hand.status === 201, hand.body);
  const prof = await api("GET", `/donors/${GIVER}/volunteer-hours`, tok);
  ok("§2 the profile says 4.5 hours in all", prof.body.lifetime.hours === 4.5 && prof.body.shifts.length === 2, prof.body.lifetime);
  const figRows = await api("GET", `/figures/volunteer-hours/rows?${new URLSearchParams({ ...prof.body.lifetime.source.params, pageSize: "50" })}`, tok);
  ok("§2 the total opens rows that add up to it", figRows.status === 200 && Math.round(figRows.body.rows.reduce((a, r) => a + Number(r.amount) * 100, 0)) === 450, figRows.body.value);
  const csv = await fetch(`${require("./helpers").BASE}/donors/${GIVER}/volunteer-hours.csv`, { headers: { Authorization: "Bearer " + tok } }).then(r => r.text());
  const totalLine = csv.trim().split(/\r?\n/).pop();
  ok("§2 the log CSV totals 4.5", /^Total,,,4\.5,/.test(totalLine), totalLine);
  const roster = await api("GET", "/volunteer-hub/roster", tok);
  const me = (roster.body.people || []).find(x => x.id === GIVER);
  ok("§2 the Volunteers screen says 4.5 hours", me && me.hundredths === 450, me);

  // ── §3 FIX-24 · MAKE A DONOR A VOLUNTEER ────────────────────────────────
  const ADA = "d_par3v_ada";
  await q(`INSERT INTO donors (id,org_id,name,email,phone,stage,created_by,created_by_name) VALUES ($1,$2,'Ada Petrossian','ada@par3v.local','555-0142','steward','system:test','test')`, [ADA, ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_par3v_ada',$1,$2,100000,$3,'system:test','test')`, [ORG, ADA, civilPlusDays(-3)]);
  const onRoll = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]))[0].n);
  const before = await onRoll();
  const bad = await api("POST", `/donors/${ADA}/make-volunteer`, tok, { hoursPerWeek: 500 });
  ok("§3 hours a week past 80 is refused and nothing changes", bad.status === 400 && !(await q(`SELECT 1 FROM volunteer_records WHERE person_id=$1`, [ADA])).length, bad.body);   // VOL-3: the record's own table
  const mv = await api("POST", `/donors/${ADA}/make-volunteer`, tok, { hoursPerWeek: 15, availability: ["Saturdays", "Not a day"], roles: "Food drive, Driver" });
  ok("§3 Make a volunteer makes the volunteer record on the same person", mv.status === 201 && mv.body.personId === ADA && mv.body.created === true, mv.body);
  ok("§3 …with 15 hours a week, Saturdays and both roles (an unknown day dropped)",
    mv.body.hoursPerWeek === 15 && JSON.stringify(mv.body.availability) === '["Saturdays"]' && JSON.stringify(mv.body.roles) === '["Food drive","Driver"]', mv.body);
  ok("§3 …and still one record: nobody new was made", await onRoll() === before);
  const vp = await api("GET", `/donors/${ADA}/volunteer-profile`, tok);
  ok("§3 the profile's volunteer record says so", vp.body.record && vp.body.record.hoursPerWeek === 15, vp.body.record);
  const vg = await api("POST", "/volunteer-hub/volunteers-group", tok, {});
  const grp = await api("GET", `/figures/group-members/rows?group=${vg.body.id}&pageSize=200`, tok);
  ok("§3 she is in the Volunteers group (the rule's own rows)", vg.body.id && (grp.body.rows || []).some(r => r.donor_id === ADA || r.id === ADA), (grp.body.rows || []).map(r => r.name));
  const again3 = await api("POST", `/donors/${ADA}/make-volunteer`, tok, { hoursPerWeek: 10 });
  const recs = await q(`SELECT hours_per_week, roles FROM volunteer_records WHERE org_id=$1 AND person_id=$2`, [ORG, ADA]);   // VOL-3
  ok("§3 a second press updates the one record and keeps the roles it was not given", again3.status === 200 && recs.length === 1 && Number(recs[0].hours_per_week) === 10 && JSON.stringify(recs[0].roles).includes("Driver"), recs);
  const BOB = "d_par3v_bob";
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,'Bob Banerjee','bob@par3v.local','cultivate','system:test','test')`, [BOB, ORG]);
  const found = await api("GET", `/volunteer-hub/people/search?q=baner`, tok);
  ok("§3 Add a volunteer finds somebody on file, with no giving in the answer",
    (found.body.people || []).some(p => p.id === BOB) && !JSON.stringify(found.body).includes("giving"), found.body);
  const n0 = await onRoll();
  const link = await api("POST", `/volunteer-hub/people`, tok, { personId: BOB, availability: ["Sundays"] });
  ok("§3 picking them links that person instead of making a new one", link.body.personId === BOB && await onRoll() === n0, link.body);

  // ── §4 FIX-27 · LOG A SHIFT, AND THE FILTERS THAT FAILED ON THE WALK ─────
  // Planted before trusted: put back `availability ? ?` → the Availability
  // filter answers 500; drop the hours dates default → "at least 4 hours"
  // keeps a person whose hours are all in another year.
  const logged = await api("POST", `/donors/${ADA}/volunteer-hours`, tok, { date: civilPlusDays(-1), hours: "2", role: "Food drive" });
  ok("§4 Log a shift saves", logged.status === 201 && logged.body.totalHours === 2, logged.body);
  const recent = await api("GET", "/volunteer-hub/shifts?limit=50", tok);
  ok("§4 …and it is in the recent shifts under her name", (recent.body.shifts || []).some(x => x.person_id === ADA && x.person_name === "Ada Petrossian" && x.hours === 2), (recent.body.shifts || []).slice(0, 3));
  const rosterNow = await api("GET", "/volunteer-hub/roster", tok);
  const all = await api("GET", "/volunteer-hub/list", tok);
  ok("§4 the picker (the roster) and the list are the same people, by the same names",
    JSON.stringify((rosterNow.body.people || []).map(x => [x.id, x.name]).sort()) === JSON.stringify((all.body.rows || []).map(x => [x.id, x.name]).sort()), { roster: (rosterNow.body.people || []).length, list: (all.body.rows || []).length });
  const sat = await api("GET", "/volunteer-hub/list?volAvail=Saturdays", tok);
  ok("§4 the Availability filter answers, with the people free that day", sat.status === 200 && (sat.body.rows || []).some(r => r.id === ADA) && !(sat.body.rows || []).some(r => r.id === BOB), sat.status === 200 ? (sat.body.rows || []).map(r => r.name) : sat.body);
  await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,via,created_by,created_by_name) VALUES ('vs_par3v_old',$1,$2,$3,9,'Old year','staff','system:test','test')`,
    [ORG, BOB, `${Number(T.slice(0, 4)) - 2}-06-01`]);
  const four = await api("GET", "/volunteer-hub/list?volHoursMin=4", tok);
  ok("§4 the Hours filter counts the column's dates (this year): 9 hours two years ago is not 4 this year",
    four.status === 200 && (four.body.rows || []).every(r => r.rangeHours >= 4) && !(four.body.rows || []).some(r => r.id === BOB), (four.body.rows || []).map(r => [r.name, r.rangeHours]));
  const cleared = await api("GET", "/volunteer-hub/list", tok);
  ok("§4 cleared, the list is everybody again", cleared.status === 200 && cleared.body.rows.length === all.body.rows.length && all.body.rows.length > 0, cleared.body.sentence);

  // ── §5 STALE-2 · OVERLAPS, PHANTOM CONFLICTS, EDIT, THE PROFILE, DRAFTS ───
  const opp5 = await api("POST", "/volunteer-hub/opportunities", tok, { name: "Harbour clean-up", isPublic: true });
  const d5 = civilPlusDays(9);
  const slotAt = async (start, end, extra = {}) => (await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp5.body.id, date: d5, startTime: start, endTime: end, capacity: 4, ...extra })).body.id;
  const morning = await slotAt("09:00", "12:00", { name: "Beach sweep" }), late = await slotAt("11:00", "14:00", { name: "Dock tidy" });
  const ines = await mkPerson("Ines Marlowe", "ines.marlowe@par3v.local");
  const s1 = await api("POST", "/volunteer-hub/signups", tok, { slotId: morning, personId: ines });
  ok("§5 Ines is on the morning shift", s1.status === 201 && s1.body.status === "confirmed", s1.body);
  const clash = await api("POST", "/volunteer-hub/signups", tok, { slotId: late, personId: ines });
  ok("§5 (09X) a sign-up that overlaps answers 409, naming the clash", clash.status === 409 && clash.body.error === "overlap"
    && /Ines Marlowe is already on Beach sweep, .*9am to 12pm, which overlaps this shift\./.test(clash.body.message || ""), clash.body);
  ok("§5 …and adds nothing until confirmed", !(await q(`SELECT 1 FROM volunteer_signups WHERE slot_id=$1 AND person_id=$2`, [late, ines])).length);
  const both = await api("POST", "/volunteer-hub/signups", tok, { slotId: late, personId: ines, overlapOk: true });
  ok("§5 …confirmed, she is on both", both.status === 201 && both.body.status === "confirmed", both.body);
  const back = await slotAt("12:00", "15:00", { name: "Back to back" });
  const bb = await api("POST", "/volunteer-hub/signups", tok, { slotId: back, personId: await mkPerson("Theo Brandt", "theo.brandt@par3v.local") });
  ok("§5 a shift that only touches another is no clash", bb.status === 201, bb.body);
  const conflictsOn = async () => (await api("GET", `/volunteer-hub/schedule?from=${d5}&to=${d5}`, tok)).body;
  const c0 = await conflictsOn();
  ok("§5 the schedule shows Ines's one conflict", c0.conflicts === 1 && c0.shifts.find(x => x.id === morning).conflicts === 1, { conflicts: c0.conflicts });
  const del = await api("DELETE", `/donors/${ines}`, tok);
  ok("§5 Ines is deleted", del.status === 200, del.body);
  const c1 = await conflictsOn();
  ok("§5 (09Y) no phantom conflict after the volunteer is deleted", c1.conflicts === 0 && c1.shifts.every(x => x.conflicts === 0), { conflicts: c1.conflicts, perShift: c1.shifts.map(x => x.conflicts) });

  // 12 · Edit a logged shift.
  const MIRA = await mkPerson("Mira Okafor", "mira.okafor@par3v.local");
  const lg = await api("POST", `/donors/${MIRA}/volunteer-hours`, tok, { date: civilPlusDays(-3), hours: "2", role: "Sorting" });
  const vsId = lg.body.id || lg.body.shiftId || (await q(`SELECT id FROM volunteer_shifts WHERE org_id=$1 AND person_id=$2`, [ORG, MIRA]))[0].id;
  const ed = await api("PATCH", `/volunteer-shifts/${vsId}`, tok, { date: civilPlusDays(-4), hours: "3.5", role: "Driving" });
  const [vrow] = await q(`SELECT date::text AS date, hours::float AS hours, role FROM volunteer_shifts WHERE id=$1`, [vsId]);
  ok("§5 (12) a logged shift's hours, date and role change", ed.status === 200 && vrow.hours === 3.5 && vrow.date === civilPlusDays(-4) && vrow.role === "Driving", { status: ed.status, vrow });
  let aud = null;   // the audit trail writes as the response finishes; give it a moment
  for (let i = 0; i < 20 && !aud; i++) { [aud] = await q(`SELECT * FROM fin_audit_log WHERE org_id=$1 AND changes::text LIKE '%Driving%' ORDER BY created_at DESC LIMIT 1`, [ORG]); if (!aud) await new Promise(r => setTimeout(r, 150)); }
  ok("§5 …and the audit row holds the before and the after", !!aud && /Sorting/.test(JSON.stringify(aud)) && /Driving/.test(JSON.stringify(aud)), aud ? Object.keys(aud) : null);

  // 24 · Scheduled shifts on the profile, ahead and behind.
  const past = (await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp5.body.id, date: civilPlusDays(-6), startTime: "09:00", endTime: "11:00", name: "Last week's sweep", capacity: 4 })).body.id;
  await api("POST", "/volunteer-hub/signups", tok, { slotId: past, personId: MIRA });
  await api("POST", "/volunteer-hub/signups", tok, { slotId: back, personId: MIRA, overlapOk: true });
  const mp = await api("GET", `/donors/${MIRA}/volunteer-hours`, tok);
  ok("§5 (24) the profile lists the shift ahead under Coming up", (mp.body.upcoming || []).some(u => /Back to back/.test(u.when)), mp.body.upcoming);
  ok("§5 (24) …and the one behind under Past shifts", (mp.body.pastShifts || []).some(u => /Last week's sweep/.test(u.when)), mp.body.pastShifts);

  // 13X · nothing logged is 0, not a blank.
  const NEW = await mkPerson("Quinn Adebayo", "quinn.adebayo@par3v.local");
  const z = await api("GET", `/donors/${NEW}/volunteer-hours`, tok);
  ok("§5 (13X) a volunteer with nothing logged answers 0 hours and 0 shifts", z.status === 200 && z.body.shiftCount === 0 && z.body.lifetime.hours === 0, { shiftCount: z.body.shiftCount, life: z.body.lifetime && z.body.lifetime.hours });
  const panel = require("fs").readFileSync(require("path").join(__dirname, "../client/src/components/VolunteerPanel.jsx"), "utf8");
  ok("§5 (13X) …and the profile panel shows for a tagged volunteer, saying 0 hours, 0 shifts",
    /includes\("volunteer"\)/.test(panel) && /!tagged && !scheduled\) return null/.test(panel) && /0 hours, 0 shifts/.test(panel));

  // 25X · Taking somebody off says who.
  const theoSu = (await q(`SELECT su.id FROM volunteer_signups su JOIN donors d ON d.id=su.person_id WHERE su.slot_id=$1 AND d.name='Theo Brandt'`, [back]))[0].id;
  const offT = await api("POST", `/volunteer-hub/signups/${theoSu}/cancel`, tok);
  ok("§5 (25X) taking somebody off names them, never a bare \"Cancelled.\"", offT.status === 200 && offT.body.message === "Theo Brandt is off this shift.", offT.body);

  // Draft shifts: one nobody is on deletes; a published one is refused.
  const draft = await slotAt("16:00", "18:00", { name: "Draft evening", published: false });
  await q(`UPDATE volunteer_slots SET published=false WHERE id=$1`, [draft]);
  const dd = await api("DELETE", `/volunteer-hub/slots/${draft}`, tok);
  ok("§5 a draft shift nobody signed up for deletes", dd.status === 200 && !(await q(`SELECT 1 FROM volunteer_slots WHERE id=$1`, [draft])).length, dd.body);
  const pubDel = await api("DELETE", `/volunteer-hub/slots/${morning}`, tok);
  ok("§5 …a published one is refused and stays", pubDel.status === 409 && (await q(`SELECT 1 FROM volunteer_slots WHERE id=$1`, [morning])).length === 1, pubDel.body);

  // ── §VOL-3 · A STATUS, A RECORD THAT IS NOT AN APPLICATION, SERVED HOURS, ERASE, EVENTS ──
  // Red on main: no volunteer_records, the role toggle took the role v3off, the tomorrow shift counted,
  // erase left the application, no event team. Each line below was seen red there first.
  const vol3Counts = async () => (await api("GET", "/volunteer-hub/counts", tok)).body;
  const vol3Roster = async () => (await api("GET", "/volunteer-hub/roster", tok)).body;
  const v3c0 = await vol3Counts(), v3r0 = await vol3Roster();
  ok("§VOL-3 Add made no application for Quinn (only the volunteer page makes those)",
    !(await q(`SELECT 1 FROM volunteer_applications WHERE org_id=$1 AND person_id=$2`, [ORG, NEW])).length);
  const v3off = await api("PUT", `/people/${NEW}/roles`, tok, { role: "volunteer", on: false });
  const v3c1 = await vol3Counts(), v3r1 = await vol3Roster();
  ok("§VOL-3 taking the Volunteer role off marks them former, with who and when",
    v3off.status === 200 && v3off.body.volunteer && v3off.body.volunteer.status === "former" && v3off.body.volunteer.statusOn === T && v3off.body.volunteer.statusBy === "Parity Admin" && v3off.body.undo === true, v3off.body);
  ok("§VOL-3 …the active count goes down by one, and the roster sentence says active",
    v3c1.roster.value === v3c0.roster.value - 1 && /active volunteers? on the roster/.test(v3r1.sentence), [v3c0.roster.value, v3c1.roster.value, v3r1.sentence]);
  const [v3pt] = await q(`SELECT person_types FROM donors WHERE id=$1`, [NEW]);
  ok("§VOL-3 …the role and the record stay (their history stays)", JSON.stringify(v3pt.person_types).includes("volunteer") && v3r1.people.some(p => p.id === NEW && p.status === "former"), v3pt.person_types);
  const actOff = await api("GET", "/figures/volunteers-active/rows?pageSize=200", tok);
  ok("§VOL-3 …and the Active volunteers card's rows leave them out, footing to the card", actOff.status === 200 && actOff.body.totalRows === v3c1.roster.value && !(actOff.body.rows || []).some(r => r.donorId === NEW), [actOff.body.totalRows, v3c1.roster.value]);
  // POLISH-11 item 2 (W-1125-Volunteers-T2): Undo survives leaving the page. Coming back to the person
  // (a fresh read), the record still offers it, and Recent changes lists it with the same Undo.
  const backP11 = await api("GET", `/people/${NEW}`, tok);
  const rc2 = ((await api("GET", "/recent-changes", tok)).body.rows || []).find(r => r.kind === "volunteer_status" && r.id === "vstatus:" + NEW);
  ok("§VOL-3 back on the person, Undo is still offered (the record's window), and Recent changes lists it",
    backP11.status === 200 && backP11.body.volunteer_status && !!backP11.body.volunteer_status.undoUntil && rc2 && /former volunteer/.test(rc2.sentence)
    && rc2.undo.path === `/donors/${encodeURIComponent(NEW)}/volunteer-status/undo`, { vs: backP11.body.volunteer_status, rc2 });
  const und = await api("POST", `/donors/${NEW}/volunteer-status/undo`, tok, {});
  const v3c2 = await vol3Counts(), v3r2 = await vol3Roster();
  ok("§VOL-3 Undo puts them back to active and the count returns", und.status === 200 && und.body.record.status === "active" && v3c2.roster.value === v3c0.roster.value && v3r2.sentence === v3r0.sentence, [und.body, v3c2.roster.value]);
  const v3ed = await api("PATCH", `/donors/${NEW}/volunteer-record`, tok, { hoursPerWeek: 6, availability: ["Saturdays"], roles: "Driver" });
  const vp3 = await api("GET", `/donors/${NEW}/volunteer-profile`, tok);
  ok("§VOL-3 roles, days and hours a week are editable on the record", v3ed.status === 200 && vp3.body.record.hoursPerWeek === 6 && JSON.stringify(vp3.body.record.roles) === '["Driver"]' && vp3.body.record.status === "active", vp3.body.record);

  // A shift dated tomorrow is not hours given yet.
  const h0 = (await api("GET", `/donors/${NEW}/volunteer-hours`, tok)).body;
  const lr0 = (await api("GET", `/volunteer-hub/list?search=Quinn`, tok)).body.rows.find(r => r.id === NEW);
  // RULES-1: the profile rail, the status line and the Donors list's hours column read the same rule.
  const servedReads = async () => {
    const rail = (await api("GET", `/donors/${NEW}/rail`, tok)).body || {};
    const st = (await api("GET", `/donors/${NEW}/status`, tok)).body || {};
    const li = (await api("GET", `/donors?search=Quinn&limit=50&cols=volunteer_hours`, tok)).body || {};
    const row = (li.donors || []).find(d => d.id === NEW);
    return { rail: rail.volunteering ? rail.volunteering.hours : 0, last: rail.volunteering ? rail.volunteering.lastShift : null,
      line: st.volunteer ? st.volunteer.line : null, list: row ? row.cells.volunteer_hours : "missing" };
  };
  const sr0 = await servedReads();
  const tmr = await api("POST", `/donors/${NEW}/volunteer-hours`, tok, { date: civilPlusDays(1), hours: "2", minutes: "0", note: "VOL-3 tomorrow" });
  const sr1 = await servedReads();
  // Red on main (5c922c6): the rail went up by 2 and its last shift became tomorrow; the list column too.
  ok("§RULES-1 a shift dated tomorrow adds nothing to the profile rail's hours or last shift, the status line or the Donors list column",
    JSON.stringify(sr1) === JSON.stringify(sr0) && sr0.list !== "missing", [sr0, sr1]);
  const h1 = (await api("GET", `/donors/${NEW}/volunteer-hours`, tok)).body, v3r3 = await vol3Roster();
  const lr1 = (await api("GET", `/volunteer-hub/list?search=Quinn`, tok)).body.rows.find(r => r.id === NEW);
  ok("§VOL-3 a shift dated tomorrow adds no hours this year, in all, or to the roster's total",
    tmr.status === 201 && h1.thisYear.hours === h0.thisYear.hours && h1.lifetime.hours === h0.lifetime.hours && v3r3.hundredthsThisYear === v3r2.hundredthsThisYear, [h0.lifetime.hours, h1.lifetime.hours, v3r2.hundredthsThisYear, v3r3.hundredthsThisYear]);
  ok("§VOL-3 …and is not their Last served", lr1 && lr1.lastServed === lr0.lastServed && lr1.lifetimeHours === lr0.lifetimeHours, [lr0, lr1]);
  const lifeSrc = await api("GET", `/figures/volunteer-hours/rows?from=1900-01-01&to=2999-12-31&donor=${NEW}&pageSize=50`, tok);
  ok("§VOL-3 …and the lifetime figure's rows foot without it", lifeSrc.status === 200 && !(lifeSrc.body.rows || []).some(r => r.date > T), (lifeSrc.body.rows || []).map(r => r.date));

  // The header cards open their rows, footing to the card.
  const act = await api("GET", "/figures/volunteers-active/rows?pageSize=200", tok);
  ok("§VOL-3 the Active volunteers card opens its rows, the same count", act.status === 200 && act.body.totalRows === v3c2.roster.value && (act.body.rows || []).some(r => r.donorId === NEW), [act.body.totalRows, v3c2.roster.value]);

  // Erase takes the application with it; one whose person is gone can be deleted, a live one cannot.
  const ERA = await mkPerson("Rowan Erase", "rowan.erase@par3v.local");
  await q(`INSERT INTO volunteer_applications (id,org_id,name,email,answers,status,person_id,created_by,created_by_name)
           VALUES ('vap_par3v_rowan',$1,'Rowan Erase','rowan.erase@par3v.local','[{"question":"Why?","answer":"To help"}]'::jsonb,'approved',$2,'system:test','test')`, [ORG, ERA]);
  await q(`INSERT INTO volunteer_applications (id,org_id,name,email,answers,status,created_by,created_by_name)
           VALUES ('vap_par3v_rowan2',$1,'Rowan E','ROWAN.ERASE@par3v.local','[]'::jsonb,'pending','system:test','test')`, [ORG]);
  const er = await api("POST", `/donors/${ERA}/erase`, tok, { confirm: "ERASE" });
  ok("§VOL-3 erasing a person erases their applications and answers, by person and by address",
    er.status === 200 && !(await q(`SELECT 1 FROM volunteer_applications WHERE org_id=$1 AND id IN ('vap_par3v_rowan','vap_par3v_rowan2')`, [ORG])).length
      && !(await q(`SELECT 1 FROM volunteer_records WHERE org_id=$1 AND person_id=$2`, [ORG, ERA])).length, er.body);
  await q(`INSERT INTO volunteer_applications (id,org_id,name,email,status,person_id,created_by,created_by_name)
           VALUES ('vap_par3v_orphan',$1,'Left Behind','left@par3v.local','approved',$2,'system:test','test'),
                  ('vap_par3v_live',$1,'Quinn Adebayo','quinn.adebayo@par3v.local','approved',$3,'system:test','test')`, [ORG, ERA, NEW]);
  const apps = (await api("GET", "/volunteer-hub/applications?status=approved", tok)).body.applications || [];
  ok("§VOL-3 an application whose person is gone says so; a live one does not",
    apps.some(a => a.id === "vap_par3v_orphan" && a.personGone) && apps.some(a => a.id === "vap_par3v_live" && !a.personGone), apps.map(a => [a.id, a.personGone]));
  const delLive = await api("DELETE", "/volunteer-hub/applications/vap_par3v_live", tok);
  const delGone = await api("DELETE", "/volunteer-hub/applications/vap_par3v_orphan", tok);
  ok("§VOL-3 …Delete takes the orphan and refuses the live one",
    delLive.status === 409 && delGone.status === 200 && !(await q(`SELECT 1 FROM volunteer_applications WHERE id='vap_par3v_orphan'`)).length
      && (await q(`SELECT 1 FROM volunteer_applications WHERE id='vap_par3v_live'`)).length === 1, [delLive.status, delGone.status]);

  // An event has a volunteer team, and a shift is made from it.
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status) VALUES ('evt_par3v_gala',$1,'Harvest supper','gala',$2,'upcoming')`, [ORG, civilPlusDays(10)]);
  const evSlot = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.body.id, eventId: "evt_par3v_gala", date: civilPlusDays(10), startTime: "17:00", endTime: "21:00", capacity: 4, name: "Harvest supper" });
  await api("POST", "/volunteer-hub/signups", tok, { slotId: evSlot.body.id, personId: NEW });
  const team = await api("GET", "/events/evt_par3v_gala/volunteer-team", tok);
  ok("§VOL-3 the event page shows its shift and who is on it",
    evSlot.status === 201 && team.status === 200 && team.body.shifts.length === 1 && team.body.shifts[0].people.some(p => p.id === NEW) && team.body.shifts[0].needed === 4, team.body);

  // ── ATLAS-10 item 4: an application from someone who already volunteers closes itself; a role can be
  //    removed (with Undo), Volunteer's hours staying put; Guest is a role; the last role stays.
  //    Red on main: the second application waits in Pending; Guest is refused (400); remove is "Mark as former".
  {
    const ROLES = async id => (await q(`SELECT person_types FROM donors WHERE id=$1`, [id]))[0].person_types;
    const qid2 = (await api("GET", "/volunteer-hub/recruitment", tok)).body.questions[0].id;
    const again2 = new URLSearchParams({ name: "Gale Giver", email: "gale.giver@par3v.local", [`q_${qid2}`]: "yes", availability: "Saturdays" });
    await fetch(`${require("./helpers").BASE}/volunteer-with/parity-vol-t/apply`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: again2.toString() });
    const [second] = await q(`SELECT status, decided_by, person_id FROM volunteer_applications WHERE org_id=$1 AND LOWER(email)='gale.giver@par3v.local' ORDER BY submitted_at DESC LIMIT 1`, [ORG]);
    ok("§ATLAS-10 Gale, already a volunteer, applies again: it closes itself onto her record, by system:already-volunteer", second && second.status === "approved" && second.decided_by === "system:already-volunteer" && second.person_id === GIVER, second);
    await q(`INSERT INTO volunteer_applications (id,org_id,name,email,status,via) VALUES ('vap_a10_old',$1,'Gale Giver','gale.giver@par3v.local','pending','page')`, [ORG]);
    const list = (await api("GET", "/volunteer-hub/applications", tok)).body || {};
    ok("§ATLAS-10 one already waiting is listed apart as Already a volunteer, never in Pending or its count",
      !(list.applications || []).some(a => a.id === "vap_a10_old") && (list.alreadyVolunteer || []).some(a => a.id === "vap_a10_old" && a.personId === GIVER)
      && list.pending === (list.applications || []).length, { pending: list.pending, already: list.alreadyVolunteer });
    const g1 = await api("PUT", `/people/${GIVER}/roles`, tok, { role: "guest", on: true });
    ok("§ATLAS-10 Guest is a role the + menu can add", g1.status === 200 && (await ROLES(GIVER)).includes("guest"), g1.body);
    const hoursBefore = (await q(`SELECT COUNT(*)::int AS n FROM volunteer_shifts WHERE org_id=$1 AND person_id=$2`, [ORG, GIVER]))[0].n;
    const rm = await api("PUT", `/people/${GIVER}/roles`, tok, { role: "volunteer", on: false, remove: true });
    ok("§ATLAS-10 Remove Volunteer takes the role off, and every shift stays on her record",
      rm.status === 200 && !(await ROLES(GIVER)).includes("volunteer") && (await q(`SELECT COUNT(*)::int AS n FROM volunteer_shifts WHERE org_id=$1 AND person_id=$2`, [ORG, GIVER]))[0].n === hoursBefore, { status: rm.status, roles: await ROLES(GIVER) });
    const un = await api("PUT", `/people/${GIVER}/roles`, tok, { role: "volunteer", on: true, undo: true });
    ok("§ATLAS-10 Undo puts Volunteer back", un.status === 200 && (await ROLES(GIVER)).includes("volunteer"));
    const solo = await mkPerson("Imelda Strand", "imelda.strand@par3v.local");
    await q(`UPDATE donors SET person_types='["staff_board"]'::jsonb WHERE id=$1`, [solo]);
    const last = await api("PUT", `/people/${solo}/roles`, tok, { role: "staff_board", on: false, remove: true });
    ok("§ATLAS-10 a person's last role cannot be removed", last.status === 409 && last.body.error === "last_role" && JSON.stringify(await ROLES(solo)) === '["staff_board"]', last.body);
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });
