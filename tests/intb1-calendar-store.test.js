// tests/intb1-calendar-store.test.js — INT-BUILD-1. THE ONE GUARD THIS BUILD EARNED.
//
//     A CALENDAR EVENT WITH NO ATTENDEE IN STEWARD STORES NOTHING AT ALL,
//     AND A MATCHED ONE STORES ONLY TITLE, START, END, LOCATION, THE MATCHED
//     PEOPLE AND THE OWNER, SCOPED TO THE ORG.
//
// A calendar holds the doctor and the job interview. The only thing that makes
// it acceptable for a work system to read one is that it keeps nothing about
// any event that is not a meeting with somebody the organisation knows.
//
// The sync runs for real, through POST /mailbox/google/sync, against a stand-in
// for Google Calendar on this shard's CALENDAR_MOCK_PORT. The stand-in returns
// the description and every attendee even though Steward asks Google not to
// send the description, so the test proves Steward drops them itself.
//
// HOW IT WOULD GO RED: store before matching; keep the attendee list; keep the
// description; match a donor in another org by the same email. Proven able to
// fail: storing every event (skipping the match in classifyCalendarEvent)
// turns §1 red; writing `ev.attendees` into the row turns §2 red.

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_intb1a", B = "org_intb1b";
const PW = bcrypt.hashSync("loadtest1234", 10);
const PORT = Number(process.env.CALENDAR_MOCK_PORT || 5618);
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";

const SECRET_TITLE = "Oncology follow-up";
const SECRET_PLACE = "Mercy Hospital, 4th floor";
const SECRET_PERSON = "dr.okafor@mercy.invalid";
const SECRET_DESC = "Bring the scan results";
const OTHER_GUEST = "stranger@elsewhere.invalid";

const soon = h => new Date(Date.now() + h * 3600e3).toISOString();
const EVENTS = [
  { id: "ev_private", status: "confirmed", summary: SECRET_TITLE, location: SECRET_PLACE, description: SECRET_DESC,
    start: { dateTime: soon(20) }, end: { dateTime: soon(21) },
    attendees: [{ email: `dana@${A}.local` }, { email: SECRET_PERSON }] },
  { id: "ev_coffee", status: "confirmed", summary: "Coffee with Margaret", location: "Magee's on Main", description: SECRET_DESC,
    start: { dateTime: soon(26) }, end: { dateTime: soon(27) },
    attendees: [{ email: `dana@${A}.local` }, { email: "margaret@example.com" }, { email: OTHER_GUEST }] },
];

let lastQuery = null;
const mock = http.createServer((req, res) => {
  lastQuery = req.url;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ items: EVENTS }));
});

const TABLES = ["calendar_events", "mailbox_connections", "interactions", "donors", "users"];
async function reset() {
  for (const o of [A, B]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [o, `INTB1 ${o}`, `intb1-${o}`]);
  }
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`,
    [`u_${A}`, A, `dana@${A}.local`, PW]);
  // The same person's address on file in BOTH orgs. Only A's row may be matched.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ('d_intb1_a',$1,'Margaret Chen','margaret@example.com','active',500,'system:test','test'),
                  ('d_intb1_b',$2,'Margaret Chen','margaret@example.com','active',500,'system:test','test')`, [A, B]);
  const { sealBag } = await import("../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: A });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name)
           VALUES ('mbx_intb1',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test')`,
    [A, `u_${A}`, `dana@${A}.local`, sealed]);
}

const anywhere = async needle => {
  const [r] = await q(
    `SELECT (SELECT COUNT(*) FROM calendar_events WHERE row_to_json(calendar_events)::text ILIKE $1)
          + (SELECT COUNT(*) FROM interactions WHERE row_to_json(interactions)::text ILIKE $1)
          + (SELECT COUNT(*) FROM fin_audit_log WHERE row_to_json(fin_audit_log)::text ILIKE $1) AS n`, [`%${needle}%`]);
  return Number(r.n);
};

(async () => {
  await new Promise(r => mock.listen(PORT, r));
  await reset();
  const dana = await login(`dana@${A}.local`);
  const r = await api("POST", "/mailbox/google/sync", dana, { what: "calendar" });
  ok("the sync ran", r.status === 200, `status ${r.status} ${r.text}`);
  ok("the provider was asked without the description", !!lastQuery && /fields=/.test(lastQuery) && !/description/.test(decodeURIComponent(lastQuery)), lastQuery);
  ok("the answer counts only what was kept, never what was dropped", r.body?.calendar?.kept === 1 && !/drop/i.test(r.text), r.text);

  // §1 — the event with nobody on file left nothing anywhere.
  ok("§1 no row for the private event", (await q(`SELECT 1 FROM calendar_events WHERE provider_event_id='ev_private'`)).length === 0, "stored");
  ok("§1 its title is nowhere", (await anywhere(SECRET_TITLE)) === 0, "found");
  ok("§1 its place is nowhere", (await anywhere(SECRET_PLACE)) === 0, "found");
  ok("§1 its guest is nowhere", (await anywhere(SECRET_PERSON)) === 0, "found");

  // §2 — the matched event holds the six fields and nothing else.
  const rows = await q(`SELECT * FROM calendar_events WHERE org_id=$1`, [A]);
  ok("§2 exactly one meeting stored", rows.length === 1, `${rows.length}`);
  const c = rows[0] || {};
  ok("§2 title, place and times kept", c.title === "Coffee with Margaret" && c.location === "Magee's on Main" && !!c.starts_at && !!c.ends_at, JSON.stringify(c));
  ok("§2 the matched person is A's own record", JSON.stringify(c.person_ids) === JSON.stringify(["d_intb1_a"]), JSON.stringify(c.person_ids));
  ok("§2 the owner is the calendar's owner", c.owner_user_id === `u_${A}`, c.owner_user_id);
  ok("§2 no description kept", (await anywhere(SECRET_DESC)) === 0, "found");
  ok("§2 no other guest's address kept", (await anywhere(OTHER_GUEST)) === 0, "found");
  ok("§2 her own address is not on the meeting row", !JSON.stringify(c).includes(`dana@${A}.local`), "found");
  const provided = ["title", "starts_at", "ends_at", "location", "person_ids", "owner_user_id"];
  const hers = ["note", "next_step", "logged_at", "logged_by", "interaction_id", "dismissed_at"];
  ok("§2 nothing else from the provider is filled in", hers.every(k => c[k] === null) && c.booked_in_steward === false, JSON.stringify(c));
  ok("§2 every provider field is set", provided.every(k => c[k] !== null && c[k] !== undefined), JSON.stringify(c));

  // §3 — scoped: the same address in another org matched nothing there.
  ok("§3 the other org has no meeting", (await q(`SELECT 1 FROM calendar_events WHERE org_id=$1`, [B])).length === 0, "leaked");

  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); mock.close(); await closeDb().catch(() => {}); process.exit(1); });
