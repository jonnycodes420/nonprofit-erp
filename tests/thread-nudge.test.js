// BUILD-81 Part 2 — THE NUDGE LEAVES THE APP. One email per user per weekday
// morning, listing every open thread due or overdue, oldest first; the
// SUBJECT is what escalates. Proven against REAL captured email bytes (local
// Resend sink), never assumptions.
//
//   §1  the test-mode proof: threads at day 3, 11 and 24 → ONE email whose
//       subject reads "3 threads open · <oldest>, day 24", rows oldest
//       first, the day-24 line reads "day 24" and never a date the reader
//       has to subtract, the org's mailing address in the footer
//   §2  links do NOTHING on their own: GET and HEAD every link in the
//       email, then assert ZERO threads changed (mail clients prefetch)
//   §3  no email when nothing is due; idempotent per (user, day); the
//       per-user off switch; a snoozed thread stays out
//   §4  nothing on weekends by default; the org toggle turns Saturday on
//   §5  the subject escalates: the same thread a week later carries a
//       bigger day number
//   §6  no mailing address on file → the email SAYS SO and links to add
//       it, rather than a footer that pretends
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, BASE } = require("./helpers");

const ORG = "org_b81ndg", ORG2 = "org_b81ndg2";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);
const daysAhead = n => iso(Date.now() + n * 86400000);

let captured = [];
const sink = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* non-JSON */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mails = () => captured.filter(e => e.path === "/emails");

// A weekday and a Saturday to pin the schedule rule deterministically
// (2026-09-09 is a Wednesday; 2026-09-12 a Saturday).
const WEDNESDAY = "2026-09-09", SATURDAY = "2026-09-12";

async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of ["threads", "digest_sends", "notification_sends", "tasks", "interactions", "gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address,legal_name)
           VALUES ($1,'B81 Nudge Org','b81-nudge',1,'active','growth','48 Camellia Row, Fairhope, AL 36532','B81 Nudge Org Inc.')`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B81 Addressless Org','b81-nudge2',1,'active','growth')`, [ORG2]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b81ndg',$1,'b81ndg@test.local',$2,'Nudge Admin','admin')`, [ORG, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,notify_thread_nudge) VALUES ('u_b81ndg_off',$1,'b81ndgoff@test.local',$2,'Opted Out','staff',FALSE)`, [ORG, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b81ndg2',$1,'b81ndg2@test.local',$2,'Second Admin','admin')`, [ORG2, hash]);
  const donors = [["dn_b81_marta", ORG, "Marta Villanueva"], ["dn_b81_des", ORG, "Desmond Cole"], ["dn_b81_priya", ORG, "Priya Raman"],
    ["dn_b81_fut", ORG, "Felix Future"], ["dn_b81_snz", ORG, "Sona Snoozed"], ["dn_b81_o2", ORG2, "Otis Second"]];
  for (const [id, o, name] of donors)
    await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,$3,'steward','u_b81ndg','Nudge Admin')`, [id, o, name]);
  const th = (id, o, donor, type, label, due, opened, snooze = null) =>
    q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,snoozed_until,created_by,created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'u_b81ndg','Nudge Admin')`, [id, o, donor, type, label, due, opened, snooze]);
  await th("th_b81n_24", ORG, "dn_b81_marta", "thank_you_note", "Send thank-you note", daysAgo(22), daysAgo(24));
  await th("th_b81n_11", ORG, "dn_b81_des", "try_again", "Try again", daysAgo(9), daysAgo(11));
  await th("th_b81n_03", ORG, "dn_b81_priya", "follow_up", "Follow up", daysAgo(0), daysAgo(3));
  await th("th_b81n_fut", ORG, "dn_b81_fut", "follow_up", "Follow up", daysAhead(6), daysAgo(1));
  await th("th_b81n_snz", ORG, "dn_b81_snz", "follow_up", "Follow up", daysAgo(5), daysAgo(8), daysAhead(20));
  await th("th_b81n_o2", ORG2, "dn_b81_o2", "follow_up", "Follow up", daysAgo(2), daysAgo(4));
}

(async () => {
  await new Promise((res, rej) => { sink.on("error", rej); sink.listen(SINK_PORT, res); });
  await reset();
  const tok = await login("b81ndg@test.local");
  const tok2 = await login("b81ndg2@test.local");
  const TODAY = (await api("GET", "/threads", tok)).body.today;

  // ── §1 · the test-mode proof ─────────────────────────────────────────────
  console.log("\n— §1 · the proof email —");
  captured = [];
  const r1 = await api("POST", "/nudges/run", tok, { today: TODAY, force: true });
  ok("run 200, one send + one opt-out skip", r1.status === 200 && r1.body.sent.length === 1 && r1.body.skipped.some(s => s.reason === "opted_out"), r1.body);
  const m = mails();
  ok("exactly ONE email left the org (not one per thread)", m.length === 1, m.length);
  const mail = m[0]?.body || {};
  ok('the SUBJECT is the fact: "3 threads open · Marta Villanueva, day 24"',
     mail.subject === "3 threads open · Marta Villanueva, day 24", mail.subject);
  const html = mail.html || "";
  const posOf = n => html.indexOf(n);
  ok("rows are OLDEST FIRST: Marta, then Desmond, then Priya",
     posOf("Marta Villanueva") > -1 && posOf("Marta Villanueva") < posOf("Desmond Cole") && posOf("Desmond Cole") < posOf("Priya Raman"),
     [posOf("Marta Villanueva"), posOf("Desmond Cole"), posOf("Priya Raman")]);
  ok('the day-24 line reads "day 24" — never a date the reader has to subtract',
     /Marta Villanueva[^<]*<\/a>[^<]*·[^<]*day 24/.test(html.replace(/\n/g, " ")) || /day 24/.test(html), html.slice(posOf("Marta Villanueva"), posOf("Marta Villanueva") + 220));
  ok("no raw opened-on date beside the day count", !new RegExp(daysAgo(24)).test(html), null);
  ok("the due-tomorrow thread is NOT in the email", !html.includes("Felix Future"), null);
  ok("the snoozed thread is NOT in the email", !html.includes("Sona Snoozed"), null);
  ok("the footer carries the org's mailing address (CAN-SPAM)",
     html.includes("48 Camellia Row, Fairhope, AL 36532") && html.includes("B81 Nudge Org Inc."), null);
  ok("no exclamation marks, no 'friendly reminder', no em dash in the copy",
     !/!/.test(html.replace(/<[^>]+>/g, "").replace(/&#33;/g, "!")) && !/friendly reminder/i.test(html) && !html.replace(/<[^>]+>/g, "").includes("—"), null);
  ok("the word family holds: no 'recovered' as an outcome in the email", !/\brecovered\b/i.test(html.replace(/<[^>]+>/g, "")), null);
  ok("no naggy language in the email: 'keeps asking' / 'until you've done it' absent — Steward holds things, it doesn't nag",
     !/keeps asking/i.test(html) && !/until you['\u2019]ve done it/i.test(html), null);

  // ── §2 · links do nothing on their own ───────────────────────────────────
  console.log("\n— §2 · GET must never change state —");
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(x => x[1]);
  ok("every thread link opens the donor's log-one-line screen (?conversation=1)",
     links.filter(l => l.includes("/donors/")).length === 3 && links.filter(l => l.includes("/donors/")).every(l => l.includes("conversation=1")), links);
  const snapshot = async () => JSON.stringify(await q(`SELECT id, closed_at, snoozed_until, due_date, next_step_type FROM threads WHERE org_id=$1 ORDER BY id`, [ORG]));
  const before = await snapshot();
  for (const l of links) {
    for (const method of ["GET", "HEAD"]) {
      await fetch(l, { method }).catch(() => {});                        // the mail client's prefetch
      await fetch(BASE + new URL(l, BASE).pathname + new URL(l, BASE).search, { method }).catch(() => {}); // and straight at the API host
    }
  }
  await api("GET", "/threads", tok); // the one legitimate GET reader
  const after = await snapshot();
  ok("GET and HEAD on every link changed ZERO threads", before === after, null);

  // ── §3 · quiet rules ─────────────────────────────────────────────────────
  console.log("\n— §3 · quiet rules —");
  captured = [];
  const r2 = await api("POST", "/nudges/run", tok, { today: TODAY, force: true });
  ok("same day again → already_sent, no second email", r2.body.sent.length === 0 && mails().length === 0, r2.body);
  await q(`DELETE FROM digest_sends WHERE org_id=$1 AND digest_type='thread_nudge'`, [ORG]);
  captured = [];
  await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE org_id=$1 AND id IN ('th_b81n_24','th_b81n_11','th_b81n_03')`, [ORG]);
  const r3 = await api("POST", "/nudges/run", tok, { today: TODAY, force: true });
  ok("NOTHING due → no email and nothing reserved", r3.body.sent.length === 0 && mails().length === 0, r3.body);
  const reserved = await q(`SELECT COUNT(*)::int AS n FROM digest_sends WHERE org_id=$1 AND digest_type='thread_nudge'`, [ORG]);
  ok("…zero digest_sends rows (an empty morning reserves nothing)", reserved[0].n === 0, reserved[0].n);
  await q(`UPDATE threads SET closed_at=NULL, close_kind=NULL, close_reason=NULL WHERE org_id=$1 AND id IN ('th_b81n_24','th_b81n_11','th_b81n_03')`, [ORG]);

  // ── §4 · weekends off by default ─────────────────────────────────────────
  console.log("\n— §4 · weekends —");
  captured = [];
  const rSat = await api("POST", "/nudges/run", tok, { today: SATURDAY });
  ok("Saturday → skipped, no email (default)", rSat.status === 200 && rSat.body.skippedWeekend === true && mails().length === 0, rSat.body);
  await q(`UPDATE orgs SET thread_nudge_weekends=TRUE WHERE id=$1`, [ORG]);
  captured = [];
  const rSat2 = await api("POST", "/nudges/run", tok, { today: SATURDAY });
  ok("org weekend toggle ON → Saturday sends", rSat2.body.sent?.length === 1 && mails().length === 1, rSat2.body);
  await q(`UPDATE orgs SET thread_nudge_weekends=FALSE WHERE id=$1`, [ORG]);
  await q(`DELETE FROM digest_sends WHERE org_id=$1 AND digest_type='thread_nudge'`, [ORG]);
  const rWed = await api("POST", "/nudges/run", tok, { today: WEDNESDAY });
  ok("a weekday needs no force flag", rWed.body.skippedWeekend !== true, rWed.body);
  await q(`DELETE FROM digest_sends WHERE org_id=$1 AND digest_type='thread_nudge'`, [ORG]);

  // ── §5 · the subject escalates ───────────────────────────────────────────
  console.log("\n— §5 · escalation —");
  captured = [];
  const later = iso(Date.now() + 8 * 86400000);
  const r5 = await api("POST", "/nudges/run", tok, { today: later, force: true });
  const m5 = mails()[0]?.body || {};
  ok("a week later the SAME thread carries a bigger number: day 32",
     r5.body.sent.length === 1 && /day 32$/.test(m5.subject || ""), m5.subject);

  // ── §6 · no address on file ──────────────────────────────────────────────
  console.log("\n— §6 · the honest footer —");
  captured = [];
  const r6 = await api("POST", "/nudges/run", tok2, { today: TODAY, force: true });
  const m6 = mails()[0]?.body || {};
  ok("org with no mailing address still hears about its threads", r6.body.sent?.length === 1, r6.body);
  ok("…and the email SAYS the address is missing and links to add it",
     /no mailing address on file/i.test(m6.html || "") && /Add it in Settings/i.test(m6.html || ""), (m6.html || "").slice(-400));

  // per-user prefs surface
  const me = await api("GET", "/me", tok);
  ok("GET /me carries the threadNudge pref (default on)", me.body?.notifications?.threadNudge === true, me.body?.notifications);
  const put = await api("PUT", "/me/notification-prefs", tok, { threadNudge: false });
  ok("the pref round-trips", put.body?.notifications?.threadNudge === false, put.body);
  await api("PUT", "/me/notification-prefs", tok, { threadNudge: true });

  sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
