// tests/fix33-sync-proof.test.js — FIX-33. PROOF THAT MAIL AND CALENDAR SYNC, NOT JUST "CONNECTED".
//
//     A MESSAGE OR MEETING WITH SOMEBODY ON FILE LANDS ON THEIR RECORD, BOTH
//     DIRECTIONS; ANYTHING ELSE STORES NOTHING; AND A BOOKED MEETING CHANGES
//     THE WHOLE RECORD AND UNDOES ITSELF WHEN IT MOVES OR IS CANCELLED.
//
// Jonathan connected Outlook on prod and the card said "not read yet" for
// hours; mail he sent to a donor from Outlook was never logged (Outlook was
// only asked for mail FROM a contact); and a visit he booked in Steward
// reached his calendar and changed nothing else on the donor's record.
//
// Everything here runs through the real routes, against ONE stand-in for
// Microsoft Graph, Gmail and Google Calendar on this shard's CALENDAR_MOCK_PORT
// (the server reads GRAPH_API_BASE, GMAIL_API_BASE and GOOGLE_CALENDAR_API_BASE).
//
//   §1  a received email from a person on file logs on their timeline, with
//       Last email and engagement moving
//   §2  a SENT email to a person on file logs the same way (the Sent Items fix)
//   §3  an unanswered personal email becomes THREAD-3's Reply step, and a
//       reply closes it
//   §4  an email to nobody on file stores nothing, anywhere
//   §5  a calendar event with a guest on file becomes a meeting on the profile;
//       one whose TITLE names one person links them; one that could be two
//       people asks; a personal event stores nothing (Part 3b)
//   §6  a meeting booked in Steward is created on Outlook and Google in the
//       organisation's time zone
//   §7  fix33-meeting-booked: booking sets the Next step, the prep and after
//       tasks, the timeline, engagement, the status line and the Thread;
//       moving it (in Steward or on the calendar) moves them; cancelling it
//       (either side) reverts them and gives the old step back
//   §8  a dated Steward step goes to her calendar only when "put my dates on
//       my calendar" is on, and a meeting step never does
//   §9  a refused token shows the reconnect banner and fails /health's count
//   §10 the health panel reports real reads, counts and the last error
//
// HOW IT WOULD GO RED (each planted and seen red, see the PR):
//   mail: drop the Sent Items request                         -> §2 red
//   privacy: store a message whose only counterparty is unknown -> §4 red
//   calendar: skip the title rule                               -> §5 red
//   booking: send the event in UTC                              -> §6 red
//   effects: skip applyMeeting after a booking                  -> §7 red
//   cancel: delete the event without revertMeeting              -> §7 red
//   push: push meeting steps / ignore the switch                -> §8 red
//   watch: swallow a refused token without a run row            -> §9 red

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");

const ORG = "org_fix33sp";
const PW = bcrypt.hashSync("loadtest1234", 10);
const PORT = Number(process.env.CALENDAR_MOCK_PORT || 5618);
const TZ = "America/New_York";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";

const DANA = `dana@${ORG}.local`, SAM = `sam@${ORG}.local`, LEE = `lee@${ORG}.local`;
const C = "d_fix33_christine", M = "d_fix33_margaret", D1 = "d_fix33_david1", D2 = "d_fix33_david2";
const STRANGER = "stranger@elsewhere.invalid";
const SECRET_SUBJECT = "Your biopsy results";
const PERSONAL_TITLE = "Dentist appointment downtown";

const iso = h => new Date(Date.now() + h * 3600e3).toISOString();
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();

// ── the stand-in ────────────────────────────────────────────────────────────
const S = {
  graphStatus: 200,
  inbox: [], sent: [], events: [],
  gmail: {}, gcal: [],
  calls: [],            // every request: { method, path, body }
};
const gm = (id, from, to, subject, text, ms, labels = []) => ({
  id, threadId: "t_" + id, internalDate: String(ms), labelIds: labels, snippet: text,
  payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }],
             mimeType: "text/plain", body: { data: Buffer.from(text).toString("base64") } },
});
const graphMsg = (id, from, to, subject, text, when) => ({
  id, subject, from: { emailAddress: { address: from } }, toRecipients: to.map(a => ({ emailAddress: { address: a } })),
  ccRecipients: [], receivedDateTime: when, sentDateTime: when, body: { contentType: "text", content: text },
  hasAttachments: false, conversationId: "conv_" + id, internetMessageHeaders: [],
});
const graphEvent = (id, subject, startH, attendees = [], location = null) => ({
  id, subject, isCancelled: false, location: location ? { displayName: location } : null,
  start: { dateTime: iso(startH).replace(/Z$/, ""), timeZone: "UTC" }, end: { dateTime: iso(startH + 1).replace(/Z$/, ""), timeZone: "UTC" },
  attendees: attendees.map(a => ({ emailAddress: { address: a } })),
});

const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
    S.calls.push({ method: req.method, path: u.pathname, search: u.search, body });
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj == null ? "" : JSON.stringify(obj)); };
    const p = u.pathname;
    // Microsoft Graph
    if (p.startsWith("/v1.0/")) {
      if (S.graphStatus !== 200) return send(S.graphStatus, { error: { code: "Throttled" } });
      if (p === "/v1.0/me/messages") return send(200, { value: S.inbox });
      if (p === "/v1.0/me/mailFolders/sentitems/messages") return send(200, { value: S.sent });
      if (p === "/v1.0/me/calendarView") return send(200, { value: S.events });
      if (p === "/v1.0/me/events" && req.method === "POST") {
        const id = "gev_" + (S.calls.length);
        S.events.push({ id, subject: body.subject, isCancelled: false, location: body.location || null,
          start: { dateTime: new Date(Date.parse(body.start.dateTime + "Z")).toISOString(), timeZone: "UTC" },
          end: { dateTime: new Date(Date.parse(body.end.dateTime + "Z")).toISOString(), timeZone: "UTC" }, attendees: body.attendees || [] });
        return send(201, { id });
      }
      if (p.startsWith("/v1.0/me/events/")) return send(req.method === "DELETE" ? 204 : 200, req.method === "DELETE" ? null : { id: p.split("/").pop() });
      return send(404, {});
    }
    // Gmail
    if (p === "/gmail/v1/users/me/messages") return send(200, { messages: Object.keys(S.gmail).map(id => ({ id })) });
    if (p.startsWith("/gmail/v1/users/me/messages/")) { const m = S.gmail[p.split("/").pop()]; return m ? send(200, m) : send(404, {}); }
    // Google Calendar
    if (p === "/calendar/v3/calendars/primary/events" && req.method === "GET") return send(200, { items: S.gcal });
    if (p === "/calendar/v3/calendars/primary/events" && req.method === "POST") return send(200, { id: "gc_" + S.calls.length });
    if (p.startsWith("/calendar/v3/calendars/primary/events/")) return send(req.method === "DELETE" ? 204 : 200, req.method === "DELETE" ? null : { id: p.split("/").pop() });
    send(404, {});
  });
});

const TABLES = ["mailbox_sync_runs", "meeting_effects", "calendar_pushes", "calendar_events", "mail_reply_steps", "mailbox_connections",
  "tasks", "threads", "interactions", "donor_scores", "fin_transactions", "budgets", "accounts", "fin_funds", "donors", "users"];
async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'FIX-33 Sync Proof','fix33-sync-proof',1,'active','team',$2)`, [ORG, TZ]);
  for (const [id, email, name] of [["u_fix33_dana", DANA, "Dana Reyes"], ["u_fix33_sam", SAM, "Sam Ito"], ["u_fix33_lee", LEE, "Lee Park"]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, [id, ORG, email, PW, name]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name) VALUES
           ($2,$1,'Christine Stewart','christine@example.com','active',500,'system:test','test'),
           ($3,$1,'Margaret Chen','margaret@example.com','active',900,'system:test','test'),
           ($4,$1,'David Lee',NULL,'active',100,'system:test','test'),
           ($5,$1,'David Ortiz',NULL,'active',100,'system:test','test')`, [ORG, C, M, D1, D2]);
  const { sealBag } = await import("../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: ORG });
  // Lee's permission was withdrawn: an expired token and no refresh token.
  const dead = sealBag({ accessToken: "tok_dead", refreshToken: null, scope: null }, { aad: ORG });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name) VALUES
           ('mbx_fix33_dana',$1,'u_fix33_dana','microsoft',$2,'active',$5,NOW() + INTERVAL '1 day',true,'system:test','test'),
           ('mbx_fix33_sam',$1,'u_fix33_sam','google',$3,'active',$5,NOW() + INTERVAL '1 day',true,'system:test','test'),
           ('mbx_fix33_lee',$1,'u_fix33_lee','google',$4,'active',$6,NOW() - INTERVAL '1 hour',true,'system:test','test')`,
    [ORG, DANA, SAM, LEE, sealed, dead]);
}

const sinceCalls = n => S.calls.slice(n);
const anywhere = async needle => {
  const [r] = await q(
    `SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$2 AND row_to_json(interactions)::text ILIKE $1)
          + (SELECT COUNT(*) FROM calendar_events WHERE org_id=$2 AND row_to_json(calendar_events)::text ILIKE $1)
          + (SELECT COUNT(*) FROM threads WHERE org_id=$2 AND row_to_json(threads)::text ILIKE $1)
          + (SELECT COUNT(*) FROM tasks WHERE org_id=$2 AND row_to_json(tasks)::text ILIKE $1)
          + (SELECT COUNT(*) FROM fin_audit_log WHERE org_id=$2 AND row_to_json(fin_audit_log)::text ILIKE $1) AS n`, [`%${needle}%`, ORG]);
  return Number(r.n);
};
const openThread = async donor => (await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, donor]))[0] || null;
const meetingTasks = async eventId => q(`SELECT type, due, done, voided_at FROM tasks WHERE org_id=$1 AND calendar_event_id=$2 ORDER BY type`, [ORG, eventId]);
const orgDay = instant => new Date(instant).toLocaleDateString("en-CA", { timeZone: TZ });

(async () => {
  await new Promise(r => mock.listen(PORT, r));
  await reset();
  const dana = { token: await login(DANA, "loadtest1234") };
  const sam = { token: await login(SAM, "loadtest1234") };
  const lee = { token: await login(LEE, "loadtest1234") };

  // ── §1 · §2 · §4 · MAIL BOTH WAYS, AND NOTHING ABOUT ANYBODY ELSE ─────────
  console.log("\n— §1 §2 §4 · mail in, mail out, and a stranger —");
  S.inbox = [
    graphMsg("in_c1", "christine@example.com", [DANA], "Lunch next week?", "Could we meet next week to talk about the scholarship?", daysAgo(1)),
    graphMsg("in_m1", "margaret@example.com", [DANA], "A question about my gift", "Would you be able to send me last year's total?", daysAgo(6)),
    graphMsg("in_x1", STRANGER, [DANA], SECRET_SUBJECT, "Please call the clinic.", daysAgo(1)),
  ];
  S.sent = [
    graphMsg("out_c1", DANA, ["christine@example.com"], "Re: Lunch next week?", "Thursday at noon works. See you at Drinklings.", daysAgo(0.5)),
    graphMsg("out_x1", DANA, [STRANGER], "Re: " + SECRET_SUBJECT, "I will call tomorrow.", daysAgo(0.5)),
  ];
  let mark = S.calls.length;
  const r1 = await api("POST", "/mailbox/microsoft/sync", dana.token, { what: "mail" });
  ok("§1 Read now answers ok with a plain sentence", r1.status === 200 && r1.body.ok === true && /Read just now/.test(r1.body.sentence || ""), JSON.stringify(r1.body).slice(0, 200));
  const askedSent = sinceCalls(mark).some(c => c.path === "/v1.0/me/mailFolders/sentitems/messages" && /to%3Achristine%40example\.com|to:christine@example\.com/i.test(c.search));
  ok("§2 Outlook's Sent Items is asked, by recipient on file", askedSent, sinceCalls(mark).map(c => c.path).join(" "));
  const cMail = await q(`SELECT metadata->>'direction' AS dir, metadata->>'message_id' AS mid FROM interactions WHERE org_id=$1 AND donor_id=$2 AND type='email' ORDER BY created_at`, [ORG, C]);
  ok("§1 the email FROM Christine is on her timeline as inbound", cMail.some(r => r.mid === "in_c1" && r.dir === "inbound"), JSON.stringify(cMail));
  ok("§2 the email Dana SENT Christine is on her timeline as outbound", cMail.some(r => r.mid === "out_c1" && r.dir === "outbound"), JSON.stringify(cMail));
  const relC = await api("GET", `/donors/${C}/relationship`, dana.token);
  ok("§1 Last email: the profile's email thread shows both messages", (relC.body.emailThreads || []).some(t => /lunch next week/i.test(t.subject) && t.count >= 2), JSON.stringify((relC.body.emailThreads || []).map(t => [t.subject, t.count])));
  const today = orgDay(Date.now());
  const ENG = require("../engagement"); const DB = require("../db");
  const touchC = await ENG.touchRows(DB.query, ORG, today, C);
  ok("§1 engagement counts Christine's email as a reply", touchC.some(t => t.part === "replies"), JSON.stringify(touchC.map(t => t.part)));
  ok("§4 the stranger's mail stored nothing anywhere (subject absent)", (await anywhere("biopsy")) === 0 && (await anywhere(STRANGER)) === 0);

  // ── §3 · AN UNANSWERED EMAIL BECOMES A REPLY STEP, AND A REPLY CLOSES IT ───
  console.log("\n— §3 · the reply step —");
  await api("POST", "/mailbox/run-replies", dana.token, {});
  const mStep = await openThread(M);
  ok("§3 Margaret's unanswered email opened a Reply step", mStep && mStep.next_step_type === "reply", JSON.stringify(mStep && [mStep.next_step_type, mStep.next_step_label]));
  S.sent.push(graphMsg("out_m1", DANA, ["margaret@example.com"], "Re: A question about my gift", "Here it is: $900 last year.", daysAgo(0.1)));
  await api("POST", "/mailbox/microsoft/sync", dana.token, { what: "mail" });
  ok("§3 Dana's reply from Outlook closed it", !(await openThread(M)), JSON.stringify(await openThread(M)));

  // ── §5 · CALENDAR EVENTS BECOME MEETINGS ON THE PROFILE (Part 3b) ──────────
  console.log("\n— §5 · calendar events become meetings —");
  S.events = [
    graphEvent("ev_guest", "Coffee", 24 * 5, [DANA, "margaret@example.com"], "Magee's"),
    graphEvent("ev_title", "Visit with Christine", 24 * 6, [DANA], "Drinklings"),
    graphEvent("ev_two", "Lunch with David", 24 * 7, [DANA]),
    graphEvent("ev_personal", PERSONAL_TITLE, 24 * 4, [DANA, "receptionist@clinic.invalid"]),
  ];
  const r5 = await api("POST", "/mailbox/microsoft/sync", dana.token, { what: "calendar" });
  ok("§5 the calendar read ran", r5.status === 200 && r5.body.calendar && r5.body.calendar.kept === 3, JSON.stringify(r5.body.calendar));
  const evs = await q(`SELECT provider_event_id AS pid, person_ids, candidate_ids, matched_by FROM calendar_events WHERE org_id=$1 ORDER BY provider_event_id`, [ORG]);
  const ev = pid => evs.find(e => e.pid === pid) || {};
  ok("§5 a guest on file makes it Margaret's meeting", JSON.stringify(ev("ev_guest").person_ids) === JSON.stringify([M]), JSON.stringify(ev("ev_guest")));
  ok("§5 'Visit with Christine' with no guest email links to Christine Stewart", JSON.stringify(ev("ev_title").person_ids) === JSON.stringify([C]) && ev("ev_title").matched_by === "title", JSON.stringify(ev("ev_title")));
  ok("§5 'Lunch with David' could be two people: it asks, nobody is linked", (ev("ev_two").person_ids || []).length === 0
    && [...(ev("ev_two").candidate_ids || [])].sort().join() === [D1, D2].sort().join(), JSON.stringify(ev("ev_two")));
  ok("§5 a personal event stored nothing at all", !ev("ev_personal").pid && (await anywhere("Dentist")) === 0 && (await anywhere("clinic.invalid")) === 0);
  const items = await api("GET", `/calendar/items?from=${today}&to=${orgDay(Date.now() + 20 * 864e5)}&scope=mine`, dana.token);
  const two = (items.body.items || []).find(i => i.type === "meeting" && /David/.test(i.title));
  ok("§5 the unsure event is on Steward's Calendar asking who, with both Davids offered", two && two.unsure === true && (two.candidates || []).length === 2, JSON.stringify(two));
  const evTwo = (await q(`SELECT id FROM calendar_events WHERE org_id=$1 AND provider_event_id='ev_two'`, [ORG]))[0];
  const pick = await api("POST", `/calendar/events/${evTwo.id}/people`, dana.token, { donorId: D1 });
  ok("§5 one click puts it on David Lee's record", pick.status === 200 && (await openThread(D1))?.next_step_type === "meeting", JSON.stringify(pick.body));
  const relM = await api("GET", `/donors/${M}/relationship`, dana.token);
  ok("§5 Margaret's profile shows the meeting in Coming up", (relM.body.upcoming || []).some(u => u.title === "Coffee"), JSON.stringify((relM.body.upcoming || []).map(u => u.title)));

  // ── §6 · §7 · BOOK IN STEWARD: THE CALENDAR, IN THE ORG'S ZONE, AND THE WHOLE RECORD ──
  console.log("\n— §6 §7 · fix33-meeting-booked —");
  // Remove the title-matched event so Christine's open step is a plain follow-up first.
  S.events = S.events.filter(e => e.id !== "ev_title");
  await api("POST", "/mailbox/microsoft/sync", dana.token, { what: "calendar" });
  ok("§7 the calendar event leaving took Christine's meeting step with it", !(await openThread(C)), JSON.stringify(await openThread(C)));
  const dueBefore = orgDay(Date.now() + 2 * 864e5);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_fix33_prev',$1,$2,'follow_up','Send the scholarship report',$3,$4,'u_fix33_dana','Dana Reyes','u_fix33_dana','Dana Reyes')`, [ORG, C, dueBefore, today]);
  // Friday 16:00 New York, nine days out, so the prep lands on a business day.
  const start = new Date(Date.now() + 9 * 864e5); start.setUTCHours(18, 0, 0, 0);
  const startsAt = start.toISOString(), endsAt = new Date(start.getTime() + 3600e3).toISOString();
  mark = S.calls.length;
  const book = await api("POST", `/donors/${C}/book-visit`, dana.token, { startsAt, endsAt, location: "Drinklings" });
  ok("§6 booking succeeds", book.status === 201, JSON.stringify(book.body));
  const posted = sinceCalls(mark).find(c => c.method === "POST" && c.path === "/v1.0/me/events");
  const wall = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(start).replace(", ", "T");
  ok("§6 Outlook gets the event in the organisation's time zone, at its wall-clock time",
    posted && posted.body.start.timeZone === TZ && String(posted.body.start.dateTime).startsWith(wall), JSON.stringify(posted && posted.body.start) + " want " + wall);
  const evId = book.body.id;
  const day = orgDay(startsAt);
  const step = await openThread(C);
  ok("§7 Next step becomes the meeting: 'Visit with Christine Stewart, <day>, Drinklings'",
    step && step.next_step_type === "meeting" && step.due_date === day && /^Visit with Christine Stewart, \w{3} \d{1,2} \w{3}, Drinklings$/.test(step.next_step_label),
    JSON.stringify(step && [step.next_step_type, step.next_step_label, step.due_date]));
  const ME = require("../meetingEffects");
  const tks = await meetingTasks(evId);
  ok("§7 a prep task the business day before and an after task on the day",
    tks.length === 2 && tks.find(t => t.type === "meeting_prep")?.due === ME.businessDayBefore(day) && tks.find(t => t.type === "meeting_after")?.due === day, JSON.stringify(tks));
  ok("§7 …worded 'Prep for Christine: read the brief' and 'How did it go with Christine?'",
    (await anywhere("Prep for Christine: read the brief")) >= 1 && (await anywhere("How did it go with Christine?")) >= 1);
  const bookedLine = (await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'kind'='meeting_booked' AND metadata->>'calendar_event_id'=$3`, [ORG, C, evId]))[0];
  ok("§7 the timeline says 'Meeting booked for <day>'", bookedLine && /^Meeting booked for \w{3} \d{1,2} \w{3}$/.test(bookedLine.note), JSON.stringify(bookedLine));
  const touchC2 = await ENG.touchRows(DB.query, ORG, today, C);
  ok("§7 engagement counts the booked meeting", touchC2.some(t => t.part === "meetings" && t.detail === "Meeting booked"), JSON.stringify(touchC2.map(t => [t.part, t.detail])));
  const st = await api("GET", `/donors/${C}/status`, dana.token);
  ok("§7 the status line carries 'Meeting set for <d Mon>'", st.body.meetingSet && /^Meeting set for \d{1,2} \w{3}$/.test(st.body.meetingSet.sentence), JSON.stringify(st.body.meetingSet));
  const thr = await api("GET", `/threads?donorId=${C}`, dana.token);
  const kinds = (thr.body.list || []).map(i => i.nextStep.type).sort();
  ok("§7 the Thread shows the meeting and both tasks, each pointing at the meeting",
    JSON.stringify(kinds) === JSON.stringify(["meeting", "meeting_after", "meeting_prep"]) && (thr.body.list || []).every(i => i.calendarEventId === evId), JSON.stringify(kinds));

  // Move it in Steward: everything follows.
  const moved = new Date(start.getTime() + 3 * 864e5);
  mark = S.calls.length;
  const mv = await api("POST", `/calendar/events/${evId}/move`, dana.token, { startsAt: moved.toISOString(), endsAt: new Date(moved.getTime() + 3600e3).toISOString() });
  const patched = sinceCalls(mark).find(c => c.method === "PATCH");
  ok("§7 moving it in Steward moves it on Outlook, in the org's zone", mv.status === 200 && patched && patched.body.start.timeZone === TZ, JSON.stringify(patched && patched.body));
  const day2 = orgDay(moved);
  const tks2 = await meetingTasks(evId);
  ok("§7 …and the step and both tasks move to the new day", (await openThread(C)).due_date === day2
    && tks2.find(t => t.type === "meeting_after").due === day2 && tks2.find(t => t.type === "meeting_prep").due === ME.businessDayBefore(day2), JSON.stringify(tks2));
  ok("§7 …and the timeline says it moved", (await anywhere("Meeting moved from")) === 1);

  // Moved on the calendar side (Margaret's guest meeting): the sync moves the record.
  const gEv = S.events.find(e => e.id === "ev_guest");
  const mEvId = (await q(`SELECT id FROM calendar_events WHERE org_id=$1 AND provider_event_id='ev_guest'`, [ORG]))[0].id;
  const before = (await meetingTasks(mEvId)).find(t => t.type === "meeting_after").due;
  gEv.start.dateTime = iso(24 * 12).replace(/Z$/, ""); gEv.end.dateTime = iso(24 * 12 + 1).replace(/Z$/, "");
  await api("POST", "/mailbox/microsoft/sync", dana.token, { what: "calendar" });
  const after = (await meetingTasks(mEvId)).find(t => t.type === "meeting_after").due;
  ok("§7 a meeting moved in Outlook moves Margaret's tasks and step", after !== before && after === orgDay(iso(24 * 12)) && (await openThread(M)).due_date === after, `${before} -> ${after}`);
  // Cancelled in Outlook: the record reverts.
  S.events = S.events.filter(e => e.id !== "ev_guest");
  await api("POST", "/mailbox/microsoft/sync", dana.token, { what: "calendar" });
  ok("§7 cancelled in Outlook: Margaret's meeting step closes and her tasks are voided",
    !(await openThread(M)) && (await meetingTasks(mEvId)).every(t => t.voided_at), JSON.stringify(await meetingTasks(mEvId)));
  ok("§7 …and her timeline notes it", (await q(`SELECT 1 FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'kind'='meeting_cancelled'`, [ORG, M])).length === 1);

  // Cancel in Steward: the follow-up it took over comes back exactly.
  mark = S.calls.length;
  const cx = await api("POST", `/calendar/events/${evId}/cancel`, dana.token, {});
  ok("§7 cancelling in Steward deletes it on Outlook", cx.status === 200 && sinceCalls(mark).some(c => c.method === "DELETE" && c.path.startsWith("/v1.0/me/events/")), JSON.stringify(cx.body));
  const back = await openThread(C);
  ok("§7 …the step goes back to 'Send the scholarship report' on its own day",
    back && back.id === "th_fix33_prev" && back.next_step_type === "follow_up" && back.next_step_label === "Send the scholarship report" && back.due_date === dueBefore,
    JSON.stringify(back && [back.next_step_type, back.next_step_label, back.due_date]));
  ok("§7 …the tasks are voided and the booking stops counting as engagement",
    (await meetingTasks(evId)).every(t => t.voided_at) && !(await ENG.touchRows(DB.query, ORG, today, C)).some(t => t.detail === "Meeting booked"));
  const st2 = await api("GET", `/donors/${C}/status`, dana.token);
  ok("§7 …and 'Meeting set' is gone from the status line", !st2.body.meetingSet, JSON.stringify(st2.body.meetingSet));

  // Google, for Sam: the same booking path in the org's zone.
  mark = S.calls.length;
  const gb = await api("POST", `/donors/${M}/book-visit`, sam.token, { startsAt, endsAt, location: "Magee's" });
  const gPost = sinceCalls(mark).find(c => c.method === "POST" && c.path === "/calendar/v3/calendars/primary/events");
  ok("§6 Google Calendar gets the event in the org's zone too", gb.status === 201 && gPost && gPost.body.start.timeZone === TZ && String(gPost.body.start.dateTime).startsWith(wall), JSON.stringify(gPost && gPost.body.start));

  // ── §8 · DATES ON HER CALENDAR ONLY WHEN SHE SAID SO ─────────────────────
  console.log("\n— §8 · put my dates on my calendar —");
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_fix33_push',$1,$2,'follow_up','Call about the gala table',$3,$4,'u_fix33_dana','Dana Reyes','u_fix33_dana','Dana Reyes')`,
    [ORG, D2, orgDay(Date.now() + 4 * 864e5), today]);
  mark = S.calls.length;
  await api("POST", "/calendar/push-dates/run", dana.token, {});
  ok("§8 with the switch off, nothing is put on her calendar", !sinceCalls(mark).some(c => c.method === "POST" && c.path === "/v1.0/me/events"));
  await api("PUT", "/calendar/push-dates", dana.token, { enabled: true });
  await api("POST", "/calendar/push-dates/run", dana.token, {});
  const pushes = sinceCalls(mark).filter(c => c.method === "POST" && c.path === "/v1.0/me/events").map(c => c.body.subject);
  ok("§8 with it on, the dated step goes to her calendar", pushes.some(t => /Call about the gala table/.test(t)), JSON.stringify(pushes));
  ok("§8 …and a meeting step is never pushed as a second entry", !pushes.some(t => /Lunch with David/.test(t)), JSON.stringify(pushes));

  // ── §9 · §10 · THE WATCH ─────────────────────────────────────────────────
  console.log("\n— §9 §10 · the health panel, the banner, the smoke —");
  const rl = await api("POST", "/mailbox/google/sync", lee.token, { what: "mail" });
  ok("§9 a refused token is a failed read, said in one sentence", rl.body.ok === false && /refused Steward's permission/.test(rl.body.error || ""), JSON.stringify(rl.body));
  const mbLee = await api("GET", "/mailbox", lee.token);
  ok("§9 Lee sees the reconnect banner", /^Steward hasn't been able to read your Gmail yet\. Reconnect$|^Steward hasn't read your Gmail since/.test(mbLee.body.banner || ""), mbLee.body.banner);
  const runRow = (await q(`SELECT ok, error FROM mailbox_sync_runs WHERE org_id=$1 AND user_id='u_fix33_lee' ORDER BY started_at DESC LIMIT 1`, [ORG]))[0];
  ok("§9 the failed read left its own run row", runRow && runRow.ok === false && /refused/.test(runRow.error), JSON.stringify(runRow));
  const health = await (await fetch(BASE + "/health")).json();
  ok("§9 /health counts the stale connection (the prod smoke fails on it)", health.mailboxSync && health.mailboxSync.stale >= 1 && health.mailboxSync.checkedAt, JSON.stringify(health.mailboxSync));
  const mbDana = await api("GET", "/mailbox", dana.token);
  const h = (mbDana.body.providers || []).find(p => p.key === "microsoft").health;
  ok("§10 the health panel has a last mail read and a last calendar read", h && h.lastMailReadAt && h.lastCalendarReadAt, JSON.stringify(h));
  ok("§10 …messages logged today and this week match what was logged", h.loggedWeek === 4 && h.loggedToday >= 1, JSON.stringify([h.loggedToday, h.loggedWeek]));
  ok("§10 …meetings found and dates pushed are counted", h.meetingsFound >= 1 && h.eventsPushed >= 1, JSON.stringify([h.meetingsFound, h.eventsPushed]));
  ok("§10 …and no banner and no error for a connection that reads", !mbDana.body.banner && !h.lastError, JSON.stringify([mbDana.body.banner, h.lastError]));
  S.graphStatus = 503;
  const r10 = await api("POST", "/mailbox/microsoft/sync", dana.token, { what: "mail" });
  const h2 = ((await api("GET", "/mailbox", dana.token)).body.providers || []).find(p => p.key === "microsoft").health;
  ok("§10 a provider that refuses every request is a failed read with a Try again sentence, not 'nothing new'",
    r10.body.ok === false && /did not answer/.test(h2.lastError || ""), JSON.stringify([r10.body.error, h2.lastError]));
  S.graphStatus = 200;

  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM fin_audit_log WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  mock.close();
  await closeDb();
  await DB.pool?.end?.().catch?.(() => {});
  summary();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
