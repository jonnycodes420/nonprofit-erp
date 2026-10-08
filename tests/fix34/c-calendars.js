// tests/fix34/c-calendars.js: FIX-34 builder C. TWO CALENDARS, AN API THAT IS
// OFF, AND ONE READ AT A TIME.
//
// 7 Oct: the Google Calendar API was switched off in the Google Cloud project,
// so the calendar silently never ran and the card said "did not answer". She
// also has Gmail AND Outlook connected, and a visit went onto whichever came
// first in the alphabet. Everything here runs through the real routes against
// one stand-in for Gmail, Google Calendar and Microsoft Graph on
// CALENDAR_MOCK_PORT (the server reads GMAIL_API_BASE, GOOGLE_CALENDAR_API_BASE
// and GRAPH_API_BASE).
//
//   §1 two calendars: the booking panel offers both, and a booking lands ONLY
//      on the one she chose (and is remembered as her default)
//   §2 Check again with Calendar refused 403 SERVICE_DISABLED names Google
//      Calendar as turned off and refused, never "did not answer"
//   §3 the booking does not default onto the calendar whose last read failed
//      while the other is healthy; an explicit pick still lands there
//   §4 two overlapping reads of one connection: only one runs
//   §5 a 429 with Retry-After: the connection waits, and no run is started
//   §6 a Gmail read with nothing new is one history call, no message fetches
//   §7 an Outlook read with nothing new is one Graph delta call per folder
//
// HOW IT WOULD GO RED (run against c4be904, before the fix; see the report):
//   §1 provider ignored, first connection by name   §2 "did not answer" for a 403
//   §3 default ignores calendar health               §4 no per-connection lock
//   §5 Retry-After ignored                           §6 full search every run

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, login, api, q } = require("../helpers");

const ORG = "org_fix34c";
const PORT = Number(process.env.CALENDAR_MOCK_PORT || 6318);
const PW = bcrypt.hashSync("loadtest1234", 10);
const ANN = `ann@${ORG}.local`, UID = "u_fix34c_ann", DONOR = "d_fix34c_rosa";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";

const S = { calls: [], calendarOff: false, gmailDelay: 0, graph429: false, historyId: "500", delta: { inbox: [], sent: [], calendar: [] } };
const SERVICE_DISABLED = { error: { code: 403, status: "PERMISSION_DENIED",
  message: "Google Calendar API has not been used in project 123 before or it is disabled.",
  errors: [{ reason: "accessNotConfigured", domain: "usageLimits" }],
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] } };

const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", async () => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    S.calls.push({ method: req.method, path: p, search: u.search, at: Date.now() });
    const send = (code, obj, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(obj == null ? "" : JSON.stringify(obj)); };
    if (p.startsWith("/v1.0/")) {
      if (S.graph429 && req.method === "GET") return send(429, { error: { code: "TooManyRequests" } }, { "Retry-After": "120" });
      // Graph delta: a fresh delta hands back a link; the link answers what changed since.
      const dp = decodeURIComponent(p);
      const fresh = dp.match(/^\/v1\.0\/me\/mailFolders\('(Inbox|SentItems)'\)\/messages\/delta$/) || (dp === "/v1.0/me/calendarView/delta" ? [0, "calendar"] : null);
      const base = `http://localhost:${PORT}/v1.0/me/deltalink/`;
      if (fresh) { const k = fresh[1] === "Inbox" ? "inbox" : fresh[1] === "SentItems" ? "sent" : "calendar"; return send(200, { value: [], "@odata.deltaLink": base + k }); }
      const dl = dp.match(/^\/v1\.0\/me\/deltalink\/(inbox|sent|calendar)$/);
      if (dl) { const v = S.delta[dl[1]]; S.delta[dl[1]] = []; return send(200, { value: v, "@odata.deltaLink": base + dl[1] }); }
      if (p === "/v1.0/me/events" && req.method === "POST") return send(201, { id: "ms_ev_" + S.calls.length });
      if (p === "/v1.0/me/mailFolders/inbox" || p === "/v1.0/me/calendar") return send(200, { id: "x" });
      if (p === "/v1.0/me/messages" || p === "/v1.0/me/mailFolders/sentitems/messages" || p === "/v1.0/me/calendarView") return send(200, { value: [] });
      return send(404, {});
    }
    if (p.startsWith("/calendar/v3/")) {
      if (S.calendarOff) return send(403, SERVICE_DISABLED);
      if (p === "/calendar/v3/calendars/primary") return send(200, { id: "primary" });
      if (p === "/calendar/v3/calendars/primary/events" && req.method === "POST") return send(200, { id: "g_ev_" + S.calls.length });
      if (p === "/calendar/v3/calendars/primary/events") return send(200, { kind: "calendar#events", items: [] });
      return send(404, {});
    }
    if (p === "/gmail/v1/users/me/profile") return send(200, { emailAddress: ANN, historyId: S.historyId });
    if (p === "/gmail/v1/users/me/history") return send(200, { historyId: S.historyId });
    if (p === "/gmail/v1/users/me/messages") {
      if (S.gmailDelay) await new Promise(r => setTimeout(r, S.gmailDelay));
      return send(200, { messages: [] });
    }
    send(404, {});
  });
});

const TABLES = ["mailbox_sync_runs", "meeting_effects", "calendar_pushes", "calendar_events", "mailbox_connections",
  "tasks", "threads", "interactions", "donor_scores", "donors", "users"];
async function clean() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
async function setup() {
  await clean();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'FIX-34 C Calendars','fix34c-calendars',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ann Lowe','admin')`, [UID, ORG, ANN, PW]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ($1,$2,'Rosa Diaz','rosa@example.com','active',300,'system:test','test')`, [DONOR, ORG]);
  const { sealBag } = await import("../../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "tok_fix34c", refreshToken: "ref_fix34c", scope: null }, { aad: ORG });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name) VALUES
           ('mbx_fix34c_g',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test'),
           ('mbx_fix34c_m',$1,$2,'microsoft',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test')`, [ORG, UID, ANN, sealed]);
}
const when = d => ({ startsAt: new Date(Date.now() + d * 864e5).toISOString(), endsAt: new Date(Date.now() + d * 864e5 + 3600e3).toISOString() });
const posts = since => S.calls.slice(since).filter(c => c.method === "POST");
const toGoogle = cs => cs.some(c => c.path === "/calendar/v3/calendars/primary/events");
const toGraph = cs => cs.some(c => c.path === "/v1.0/me/events");

async function run() {
  console.log("\n· FIX-34 C · two calendars, an API that is off, one read at a time");
  await new Promise((r, j) => { mock.once("error", j); mock.listen(PORT, r); });
  try {
    await setup();
    const tok = await login(ANN, "loadtest1234");

    // §1
    const rel = await api("GET", `/donors/${DONOR}/relationship`, tok);
    const list = (rel.body.calendars && rel.body.calendars.list) || [];
    ok("§1 the booking panel is offered both calendars", list.map(c => c.provider).sort().join() === "google,microsoft", JSON.stringify(rel.body.calendars));
    let mark = S.calls.length;
    const b1 = await api("POST", `/donors/${DONOR}/book-visit`, tok, { ...when(3), provider: "microsoft" });
    ok("§1 booking on Outlook lands on Outlook only", b1.status === 201 && toGraph(posts(mark)) && !toGoogle(posts(mark)), JSON.stringify([b1.status, posts(mark).map(c => c.path)]));
    mark = S.calls.length;
    const b2 = await api("POST", `/donors/${DONOR}/book-visit`, tok, { ...when(4), provider: "google" });
    ok("§1 booking on Google lands on Google only", b2.status === 201 && toGoogle(posts(mark)) && !toGraph(posts(mark)), JSON.stringify([b2.status, posts(mark).map(c => c.path)]));
    const rows = await q(`SELECT provider FROM calendar_events WHERE org_id=$1 ORDER BY starts_at`, [ORG]);
    ok("§1 each stored meeting names the calendar it went on", rows.map(r => r.provider).join() === "microsoft,google", JSON.stringify(rows));
    const rel2 = await api("GET", `/donors/${DONOR}/relationship`, tok);
    ok("§1 the one she used last is the default next time", rel2.body.calendars && rel2.body.calendars.defaultProvider === "google", JSON.stringify(rel2.body.calendars));

    // §2
    S.calendarOff = true;
    const chk = await api("POST", "/mailbox/google/sync", tok, {});
    const said = String(chk.body.error || chk.body.sentence || "");
    ok("§2 Check again names Google Calendar as turned off", /Google Calendar is turned off in your Google Cloud project/.test(said) && /Turn on the Google Calendar API/.test(said), said);
    ok("§2 …and never says it did not answer", !/did not answer/i.test(said), said);
    const mb = await api("GET", "/mailbox", tok);
    const gh = ((mb.body.providers || []).find(p => p.key === "google") || {}).health || {};
    ok("§2 the card's health line says it was refused, and which API", /Google Calendar is turned off/.test(gh.lastError || "") && (gh.apis || []).some(a => a.api === "calendar" && a.reason === "disabled"), JSON.stringify([gh.lastError, gh.apis]));
    const calRun = (await q(`SELECT ok, error FROM mailbox_sync_runs WHERE org_id=$1 AND provider='google' AND kind='calendar' ORDER BY started_at DESC LIMIT 1`, [ORG]))[0];
    ok("§2 the failed calendar read is recorded as refused, not as no answer", calRun && calRun.ok === false && /turned off/.test(calRun.error || "") && !/did not answer/.test(calRun.error || ""), JSON.stringify(calRun));

    // §3 (google's last read failed; google is also her last-used)
    const rel3 = await api("GET", `/donors/${DONOR}/relationship`, tok);
    ok("§3 the panel defaults to the healthy calendar", rel3.body.calendars && rel3.body.calendars.defaultProvider === "microsoft", JSON.stringify(rel3.body.calendars));
    mark = S.calls.length;
    const b3 = await api("POST", `/donors/${DONOR}/book-visit`, tok, when(5));
    ok("§3 a booking with no pick does not land on the failing calendar", b3.status === 201 && toGraph(posts(mark)) && !toGoogle(posts(mark)), JSON.stringify([b3.status, b3.body, posts(mark).map(c => c.path)]));
    S.calendarOff = false;
    mark = S.calls.length;
    const b4 = await api("POST", `/donors/${DONOR}/book-visit`, tok, { ...when(6), provider: "google" });
    ok("§3 …but when she picks it explicitly, it goes there", b4.status === 201 && toGoogle(posts(mark)) && !toGraph(posts(mark)), JSON.stringify([b4.status, posts(mark).map(c => c.path)]));

    // §4
    await q(`DELETE FROM mailbox_sync_runs WHERE org_id=$1`, [ORG]);
    await q(`UPDATE mailbox_connections SET gmail_history_id=NULL WHERE org_id=$1`, [ORG]);
    S.gmailDelay = 1500;
    const [r1, r2] = await Promise.all([
      api("POST", "/mailbox/google/sync", tok, { what: "mail" }),
      new Promise(r => setTimeout(r, 300)).then(() => api("POST", "/mailbox/google/sync", tok, { what: "mail" })),
    ]);
    S.gmailDelay = 0;
    const mailRuns = (await q(`SELECT COUNT(*)::int AS n FROM mailbox_sync_runs WHERE org_id=$1 AND provider='google' AND kind='mail'`, [ORG]))[0].n;
    ok("§4 two overlapping reads of one connection: only one ran", mailRuns === 1, `runs=${mailRuns} ${JSON.stringify([r1.body.sentence, r2.body.sentence])}`);
    ok("§4 …and the second says a read is already under way", [r1, r2].some(r => r.body.running === true), JSON.stringify([r1.body.running, r2.body.running]));

    // §5
    S.graph429 = true;
    await api("POST", "/mailbox/microsoft/sync", tok, { what: "mail" });
    const ra = (await q(`SELECT retry_after FROM mailbox_connections WHERE id='mbx_fix34c_m'`))[0];
    const wait = ra && ra.retry_after ? new Date(ra.retry_after).getTime() - Date.now() : null;
    ok("§5 a 429 with Retry-After 120 makes the connection wait about two minutes", wait != null && wait > 60e3 && wait <= 125e3, String(wait));
    S.graph429 = false;
    const before = (await q(`SELECT COUNT(*)::int AS n FROM mailbox_sync_runs WHERE org_id=$1 AND provider='microsoft'`, [ORG]))[0].n;
    mark = S.calls.length;
    await api("POST", "/mailbox/microsoft/sync", tok, { what: "mail" });
    const after = (await q(`SELECT COUNT(*)::int AS n FROM mailbox_sync_runs WHERE org_id=$1 AND provider='microsoft'`, [ORG]))[0].n;
    ok("§5 …and no read is started for it until then", after === before && !S.calls.slice(mark).some(c => c.path === "/v1.0/me/messages"), `${before}->${after}`);

    // §6
    const full = await api("POST", "/mailbox/google/sync", tok, { what: "mail" });
    const hid = (await q(`SELECT gmail_history_id FROM mailbox_connections WHERE id='mbx_fix34c_g'`))[0];
    ok("§6 a full Gmail read stores the history id", full.status === 200 && hid && hid.gmail_history_id === "500", JSON.stringify(hid));
    mark = S.calls.length;
    const t0 = Date.now();
    const again = await api("POST", "/mailbox/google/sync", tok, { what: "mail" });
    const ms = Date.now() - t0;
    const mailCalls = S.calls.slice(mark).filter(c => c.path.startsWith("/gmail/") && c.path !== "/gmail/v1/users/me/profile");
    ok("§6 a read with nothing new is one history call and no message search", again.status === 200 && mailCalls.length === 1 && mailCalls[0].path === "/gmail/v1/users/me/history",
      `${mailCalls.map(c => c.path).join(" ")} (${ms}ms)`);

    // §7
    await q(`UPDATE mailbox_connections SET retry_after=NULL WHERE id='mbx_fix34c_m'`);
    const graphRead = cs => cs.filter(c => c.path.startsWith("/v1.0/") && !/mailFolders\/inbox$|\/me\/calendar$/.test(c.path) && c.method === "GET");
    await api("POST", "/mailbox/microsoft/sync", tok, {});                       // full read, links made
    mark = S.calls.length;
    const quiet = await api("POST", "/mailbox/microsoft/sync", tok, {});
    const qc = graphRead(S.calls.slice(mark));
    const mailQ = qc.filter(c => /deltalink\/(inbox|sent)$/.test(c.path)), calQ = qc.filter(c => /deltalink\/calendar$/.test(c.path));
    ok("§7 an Outlook read with nothing new is one delta call per folder, and nothing else",
      quiet.status === 200 && mailQ.length === 2 && calQ.length === 1 && qc.length === 3, qc.map(c => c.path).join(" "));
    S.delta.inbox = [{ id: "new_msg" }];
    mark = S.calls.length;
    await api("POST", "/mailbox/microsoft/sync", tok, { what: "mail" });
    ok("§7 …and a change in the Inbox brings the full read back", graphRead(S.calls.slice(mark)).some(c => c.path === "/v1.0/me/messages"),
      graphRead(S.calls.slice(mark)).map(c => c.path).join(" "));
  } finally {
    await clean();
    await new Promise(r => mock.close(r));
  }
}

module.exports = { run };
if (require.main === module) run().then(async()=>{await require("../helpers").closeDb();require("../helpers").summary();}).catch(async e=>{console.error(e);process.exit(1);});
