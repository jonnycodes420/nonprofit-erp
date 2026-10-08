// tests/cal1-moves.test.js · CAL-1's one test. A DRAG IS THE ITEM'S OWN ROUTE, AND UNDO PUTS IT BACK.
//
//     Moving a meeting, a next step and a shift by drag (the requests built by
//     shared/calendarMoves.js, exactly as the Calendar page builds them) saves
//     the new time through each item's own route, writes ONE audit row each,
//     and Undo (the same route with the old values) puts each back exactly.
//     A synced meeting moves on the connected calendar first; when that
//     calendar refuses, nothing moves. Another organisation's user moves
//     nothing.
//
// Donor data and the audit trail: a calendar that moved a meeting in Steward
// but not on Google tells the director the wrong time; a move with no audit
// row, or an Undo that lands one minute off, is a record nobody can trust.
//
// It stands in for Google on CALENDAR_MOCK_PORT (the server's
// GOOGLE_CALENDAR_API_BASE), as intb1-calendar-store does.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the build report):
//   · moveRequest builds the meeting's end from the old end without the drag
//     → §1 the meeting's new end is wrong;
//   · the event-free shift route skipped (a drag writing the slot directly)
//     → §1 "one audit row";
//   · Undo built from the moved values → §2 "back exactly".

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, waitFor } = require("./helpers");
// FIX-33: a move reaches the calendar as wall-clock time in the org's zone
// (it used to be a UTC instant). The same INSTANT is what must match.
function sameInstant(block, isoUtc) {
  if (!block || !block.dateTime) return false;
  if (/Z$|[+-]\d\d:\d\d$/.test(block.dateTime)) return Date.parse(block.dateTime) === Date.parse(isoUtc);
  const wall = new Intl.DateTimeFormat("en-CA", { timeZone: block.timeZone || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(isoUtc)).replace(", ", "T");
  return block.dateTime === wall;
}

const ORG = "org_cal1mv", ORG2 = "org_cal1mv2";
const PORT = Number(process.env.CALENDAR_MOCK_PORT || 5823);
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
const TABLES = ["volunteer_signups", "volunteer_slot_roles", "volunteer_slots", "volunteer_opportunities", "meeting_effects", "calendar_events", "mailbox_connections", "tasks", "threads", "interactions", "donors", "users"];   // FIX-33: a moved meeting writes its effects

let refuse = false;
const patches = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    if (req.method === "PATCH") patches.push({ url: req.url, body: JSON.parse(b || "{}") });
    res.writeHead(refuse ? 500 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(refuse ? { error: "nope" } : { id: "ev_cal1", status: "confirmed" }));
  });
});

async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  await new Promise(r => mock.listen(PORT, r));
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  for (const [o, slug] of [[ORG, "cal1-mv"], [ORG2, "cal1-mv2"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW())`, [o, `Calendar ${slug}`, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`, [`u_${o}`, o, `dana@${o}.local`, pw]);
  }
  await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ('d_cal1_a',$1,'Calendar Fixture A','active','system:test','test')`, [ORG]);
  const { sealBag } = await import("../shared/secretBox.js");
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name)
           VALUES ('mbx_cal1',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test')`,
    [ORG, `u_${ORG}`, `dana@${ORG}.local`, sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: ORG })]);
  // The week: a Monday a little ahead, so nothing here is in the past.
  const day = new Date(Date.now() + 9 * 864e5); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const MON = day.toISOString().slice(0, 10);
  const plus = n => new Date(Date.parse(MON + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by,created_by_name)
           VALUES ('cal_cal1_m',$1,$2,'google','gev_1','Coffee with A',$3,$4,ARRAY['d_cal1_a'],'system:test','test')`,
    [ORG, `u_${ORG}`, `${MON}T14:00:00Z`, `${MON}T15:00:00Z`]);   // 10:00 to 11:00 in New York
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,due_time,opened_on,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_cal1_s',$1,'d_cal1_a','call','Call',$2,'09:30',$2,$3,'Dana','system:test','test')`, [ORG, plus(1), `u_${ORG}`]);
  await q(`INSERT INTO volunteer_opportunities (id,org_id,name,slug,created_by,created_by_name) VALUES ('vop_cal1',$1,'Clean-up','cal1-clean-up','system:test','test')`, [ORG]);
  await q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time,capacity,published,created_by,created_by_name)
           VALUES ('vsl_cal1',$1,'vop_cal1',$2,'09:00','12:00',4,true,'system:test','test')`, [ORG, plus(2)]);

  const C = await import("../shared/calendarMoves.js");
  const tok = await login(`dana@${ORG}.local`), tok2 = await login(`dana@${ORG2}.local`);
  const list = await api("GET", `/calendar/items?from=${MON}&to=${plus(6)}&types=meeting,step,shift`, tok);
  ok("the calendar lists the three", list.status === 200 && ["meeting:cal_cal1_m", "step:th_cal1_s", "shift:vsl_cal1"].every(id => list.body.items.some(i => i.id === id)), list.body.items && list.body.items.map(i => i.id));
  const item = id => list.body.items.find(i => i.id === id);
  const audits = async path => Number((await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND request_path=$2`, [ORG, path]))[0].n);
  const send = r => api(r.method, r.path, tok, r.body);
  // FIX-34 · THE CI-ONLY FLAKE. middleware/auditTrail.js writes its one row on
  // res "finish", AFTER the response has gone (snapshot reads, then the
  // insert), by design: a write's response does not wait on its audit. So a
  // count read the instant the response lands can be one short; on CI's slower
  // shared runners it was (PR #168, #171). Wait for the rows this suite asserts
  // to arrive (never a fixed sleep), then assert the count EXACTLY, so a
  // second row still fails.
  const auditsAt = async want => {
    const now = async () => ({ m: await audits(want.paths[0]), s: await audits(want.paths[1]), h: await audits(want.paths[2]) });
    await waitFor(async () => { const c = await now(); return c.m >= want.m && c.s >= want.s && c.h >= want.h; }, { timeout: 10000, interval: 25 });
    return now();
  };

  // ── §1 · each drag goes through its own route, one audit row each ───────
  console.log("\n— §1 · the drag: its own route, one audit row —");
  const meeting = item("meeting:cal_cal1_m"), stepIt = item("step:th_cal1_s"), shift = item("shift:vsl_cal1");
  const mReq = C.moveRequest(meeting, { days: 1, minutes: 30 });                 // Tuesday, 10:30 to 11:30
  const sReq = C.moveRequest(stepIt, { days: 2, minutes: 60 });                  // two days on, 10:30
  const hReq = C.moveRequest(shift, { endMinutes: 60 });                         // the shift stretched to 13:00
  ok("§1 each request is the item's own route", mReq.path === "/calendar/events/cal_cal1_m/move" && sReq.path === "/threads/th_cal1_s" && hReq.path === "/volunteer-hub/slots/vsl_cal1", [mReq.path, sReq.path, hReq.path]);
  const before = { m: await audits(mReq.path), s: await audits(sReq.path), h: await audits(hReq.path) };
  const r1 = await send(mReq), r2 = await send(sReq), r3 = await send(hReq);
  ok("§1 all three saved", r1.status === 200 && r2.status === 200 && r3.status === 200, [r1.status, r2.status, r3.status, r1.body]);
  const [m1] = await q(`SELECT starts_at, ends_at FROM calendar_events WHERE id='cal_cal1_m'`);
  ok("§1 the meeting is a day and half an hour later, still an hour long", new Date(m1.starts_at).toISOString() === new Date(Date.parse(`${MON}T14:00:00Z`) + (1440 + 30) * 60000).toISOString()
    && new Date(m1.ends_at) - new Date(m1.starts_at) === 3600000, m1);
  ok("§1 …and it moved on Google first, to the same times", patches.length === 1 && /events\/gev_1/.test(patches[0].url) && sameInstant(patches[0].body.start, mReq.body.startsAt) && sameInstant(patches[0].body.end, mReq.body.endsAt), patches);
  const [t1] = await q(`SELECT due_date, due_time FROM threads WHERE id='th_cal1_s'`);
  ok("§1 the next step is two days on at 10:30", t1.due_date === plus(3) && t1.due_time === "10:30", t1);
  const [s1] = await q(`SELECT date, start_time, end_time FROM volunteer_slots WHERE id='vsl_cal1'`);
  ok("§1 the shift runs to 13:00", s1.date === plus(2) && s1.start_time === "09:00" && s1.end_time === "13:00", s1);
  const paths = [mReq.path, sReq.path, hReq.path];
  const c1 = await auditsAt({ paths, m: before.m + 1, s: before.s + 1, h: before.h + 1 });
  ok("§1 one audit row for each move", c1.m === before.m + 1 && c1.s === before.s + 1 && c1.h === before.h + 1, { before, after: c1 });

  // ── §2 · Undo puts each back exactly ────────────────────────────────────
  console.log("\n— §2 · Undo: the same route, the old values —");
  const u1 = await send(mReq.undo), u2 = await send(sReq.undo), u3 = await send(hReq.undo);
  ok("§2 all three undone", u1.status === 200 && u2.status === 200 && u3.status === 200, [u1.status, u2.status, u3.status]);
  const [m2] = await q(`SELECT starts_at, ends_at FROM calendar_events WHERE id='cal_cal1_m'`);
  const [t2] = await q(`SELECT due_date, due_time FROM threads WHERE id='th_cal1_s'`);
  const [s2] = await q(`SELECT date, start_time, end_time FROM volunteer_slots WHERE id='vsl_cal1'`);
  ok("§2 the meeting is back to the minute, here and on Google", new Date(m2.starts_at).toISOString() === `${MON}T14:00:00.000Z` && new Date(m2.ends_at).toISOString() === `${MON}T15:00:00.000Z`
    && patches.length === 2 && sameInstant(patches[1].body.start, `${MON}T14:00:00Z`), { m2, p: patches[1] });
  ok("§2 the next step is back exactly", t2.due_date === plus(1) && t2.due_time === "09:30", t2);
  ok("§2 the shift is back exactly", s2.date === plus(2) && s2.start_time === "09:00" && s2.end_time === "12:00", s2);
  const c2 = await auditsAt({ paths, m: before.m + 2, s: before.s + 2, h: before.h + 2 });
  ok("§2 …and each Undo is its own audit row", c2.m === before.m + 2 && c2.s === before.s + 2 && c2.h === before.h + 2, { before, after: c2 });

  // ── §3 · when the calendar refuses, nothing moves; another org, nothing ─
  console.log("\n— §3 · refused and tenant —");
  refuse = true;
  const bad = await send(C.moveRequest(meeting, { days: 1 }));
  refuse = false;
  const [m3] = await q(`SELECT starts_at FROM calendar_events WHERE id='cal_cal1_m'`);
  ok("§3 Google refuses: it says so and nothing moved in Steward", bad.status === 502 && /Nothing moved/.test(bad.body.sentence || "") && new Date(m3.starts_at).toISOString() === `${MON}T14:00:00.000Z`, bad.body);
  const theirs = await api(sReq.method, sReq.path, tok2, sReq.body);
  const [t3] = await q(`SELECT due_date FROM threads WHERE id='th_cal1_s'`);
  ok("§3 another organisation's user cannot move this org's step", theirs.status >= 400 && t3.due_date === plus(1), theirs.status);
  const other = await api("GET", `/calendar/items?from=${MON}&to=${plus(6)}`, tok2);
  ok("§3 …and sees none of it on their calendar", other.status === 200 && !other.body.items.some(i => /cal1/.test(i.id)), other.body.items.map(i => i.id));
  ok("§3 a drag on a logged or read-only item is refused before any request", !!C.moveRequest({ type: "journey", editable: { move: false } }, { days: 1 }).refused);

  await reset();
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); mock.close(); await closeDb().catch(() => {}); summary(); });
