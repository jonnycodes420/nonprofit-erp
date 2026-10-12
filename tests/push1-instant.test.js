// tests/push1-instant.test.js: PUSH-1. GMAIL AND OUTLOOK UPDATES ARRIVE IN
// SECONDS, AND ONLY FROM GOOGLE OR MICROSOFT.
//
// A notice from Google or Microsoft is a door into a person's mailbox read. If
// the door opens for anybody, anybody can make Steward read her mail on
// demand; if a channel quietly expires, the profile goes stale and nothing
// says so. This suite boots its own server (instant updates set up, the
// mailbox tick every 1.5 seconds, held to this org) against one stand-in for
// Gmail, Pub/Sub's signing keys, Google Calendar and Microsoft Graph.
//
//   §1 the tick makes every channel: the Gmail watch on the Pub/Sub topic, a
//      Calendar channel, and three Graph subscriptions whose URL Graph
//      validated; every secret is stored only as a hash
//   §2 a verified Gmail notice runs ONE incremental read that logs the email
//   §3 a verified Calendar notice logs the meeting; a "sync" notice reads nothing
//   §4 verified Graph notices log the Outlook email and the Outlook meeting
//   §5 an unverified notice is refused and logged and reads nothing: no token,
//      a token from another key, the wrong audience, the wrong service
//      account, a wrong channel token, a wrong clientState
//   §6 an expiring channel is renewed: Graph extended, the Calendar channel
//      replaced and the old one stopped (its notices refused), Gmail watched again
//   §7 with push on, the tick does not read every 5 minutes; when a change
//      arrives that no notice announced, instant updates pause, the panel says
//      so, and the tick reads every 5 minutes again
//
// HOW IT WOULD GO RED (planted and seen red, see the PR):
//   skip the clientState check in routes/push.js            -> §5 red
//   skip the OIDC audience check in mailboxPush.js           -> §5 red
//   never renew (RENEW_AHEAD_MS of 0)                        -> §6 red
//   drop missedNotice from the tick                          -> §7 red

const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_push1";
const PW = bcrypt.hashSync("loadtest1234", 10);
const ANN = "ann@push1.local", UID = "u_push1_ann", ROSA = "rosa@push1-donor.example", DONOR = "d_push1_rosa";
const TOPIC = "projects/steward-test/topics/gmail-push";
const SA = "gmail-push@steward-test.iam.gserviceaccount.com";
const CRED_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.STEWARD_CREDENTIAL_KEY = CRED_KEY;
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the signing keys: Google's (served by the stand-in) and a forger's ──────
const google = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const forger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "push1-test-key";
function jwt(claims, key = google.privateKey, kid = KID) {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const s = crypto.sign("RSA-SHA256", Buffer.from(h + "." + p), key).toString("base64url");
  return `${h}.${p}.${s}`;
}

// ── the stand-in ────────────────────────────────────────────────────────────
const S = {
  calls: [], historyId: 100, gmailPending: false, gmail: {},
  gcalPending: [], gcal: [], gcalChannels: [], stopped: [],
  graphSubs: {}, graphValidated: 0, graphPending: { inbox: [], sent: [], calendar: [] }, inbox: [], events: [],
  childBase: null,
};
const gm = (id, from, to, subject, text) => ({
  id, threadId: "t_" + id, internalDate: String(Date.now()), labelIds: ["INBOX"], snippet: text,
  payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }],
             mimeType: "text/plain", body: { data: Buffer.from(text).toString("base64") } },
});
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", async () => {
    const u = new URL(req.url, "http://x");
    const p = decodeURIComponent(u.pathname);
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
    S.calls.push({ method: req.method, path: p, search: u.search, body, at: Date.now() });
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj == null ? "" : JSON.stringify(obj)); };
    if (p === "/certs") {
      const jwk = google.publicKey.export({ format: "jwk" });
      return send(200, { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });
    }
    // Gmail
    if (p === "/gmail/v1/users/me/watch") return send(200, { historyId: String(S.historyId), expiration: String(Date.now() + 7 * 864e5) });
    if (p === "/gmail/v1/users/me/stop") return send(204, null);
    if (p === "/gmail/v1/users/me/profile") return send(200, { emailAddress: ANN, historyId: String(S.historyId) });
    if (p === "/gmail/v1/users/me/history") return send(200, { historyId: String(S.historyId), ...(S.gmailPending ? { history: [{ id: String(S.historyId) }] } : {}) });
    if (p === "/gmail/v1/users/me/messages") { S.gmailPending = false; return send(200, { messages: Object.keys(S.gmail).map(id => ({ id })) }); }
    if (p.startsWith("/gmail/v1/users/me/messages/")) { const m = S.gmail[p.split("/").pop()]; return m ? send(200, m) : send(404, {}); }
    // Google Calendar
    if (p === "/calendar/v3/calendars/primary/events/watch") {
      const resourceId = "res_" + S.gcalChannels.length;
      S.gcalChannels.push({ ...body, resourceId });
      return send(200, { kind: "api#channel", id: body.id, resourceId, expiration: String(Date.now() + 7 * 864e5) });
    }
    if (p === "/calendar/v3/channels/stop") { S.stopped.push(body); return send(204, null); }
    if (p === "/calendar/v3/calendars/primary/events" && req.method === "GET") {
      const sp = u.searchParams;
      if (sp.get("syncToken")) { const items = S.gcalPending.map(id => ({ id })); S.gcalPending = []; return send(200, { kind: "calendar#events", items, nextSyncToken: "st_" + Date.now() }); }
      if (sp.get("updatedMin")) return send(200, { kind: "calendar#events", items: [] });
      if (sp.get("timeMin")) return send(200, { kind: "calendar#events", items: S.gcal });
      return send(200, { kind: "calendar#events", items: S.gcal.map(e => ({ id: e.id })), nextSyncToken: "st_first" });
    }
    // Microsoft Graph
    if (p === "/v1.0/subscriptions" && req.method === "POST") {
      // Graph proves the URL first, exactly as the real one does.
      const vt = "Validation: Testing client application reachability for subscription Request-Id: " + crypto.randomUUID();
      const echo = await fetch(body.notificationUrl + "?validationToken=" + encodeURIComponent(vt), { method: "POST", headers: { "Content-Type": "text/plain" } })
        .then(async r => ({ status: r.status, text: await r.text(), type: r.headers.get("content-type") || "" })).catch(() => null);
      if (!echo || echo.status !== 200 || echo.text !== vt || !/text\/plain/.test(echo.type)) return send(400, { error: { code: "ValidationError", message: "Subscription validation request failed." } });
      S.graphValidated++;
      const id = "sub_" + crypto.randomBytes(4).toString("hex");
      S.graphSubs[id] = { ...body, id };
      return send(201, { id, resource: body.resource, expirationDateTime: body.expirationDateTime });
    }
    const sm = p.match(/^\/v1\.0\/subscriptions\/(.+)$/);
    if (sm) {
      if (!S.graphSubs[sm[1]]) return send(404, { error: { code: "ResourceNotFound" } });
      if (req.method === "PATCH") { S.graphSubs[sm[1]].expirationDateTime = body.expirationDateTime; return send(200, { id: sm[1], expirationDateTime: body.expirationDateTime }); }
      if (req.method === "DELETE") { delete S.graphSubs[sm[1]]; return send(204, null); }
    }
    const fresh = p.match(/^\/v1\.0\/me\/mailFolders\('(Inbox|SentItems)'\)\/messages\/delta$/) || (p === "/v1.0/me/calendarView/delta" ? [0, "calendar"] : null);
    const dbase = `http://localhost:${mock.address().port}/v1.0/me/deltalink/`;
    if (fresh) { const k = fresh[1] === "Inbox" ? "inbox" : fresh[1] === "SentItems" ? "sent" : "calendar"; return send(200, { value: [], "@odata.deltaLink": dbase + k }); }
    const dl = p.match(/^\/v1\.0\/me\/deltalink\/(inbox|sent|calendar)$/);
    if (dl) { const v = S.graphPending[dl[1]]; S.graphPending[dl[1]] = []; return send(200, { value: v, "@odata.deltaLink": dbase + dl[1] }); }
    if (p === "/v1.0/me/messages") return send(200, { value: S.inbox });
    if (p === "/v1.0/me/mailFolders/sentitems/messages") return send(200, { value: [] });
    if (p === "/v1.0/me/calendarView") return send(200, { value: S.events });
    send(404, {});
  });
});

async function reset() {
  for (const t of ["mailbox_push", "mailbox_sync_runs", "meeting_effects", "calendar_pushes", "calendar_events", "mail_reply_steps",
                   "mailbox_connections", "tasks", "threads", "interactions", "donor_scores", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
async function setup() {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'PUSH-1 Instant','push1-instant',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ann Lowe','admin')`, [UID, ORG, ANN, PW]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ($1,$2,'Rosa Diaz',$3,'active',300,'system:test','test')`, [DONOR, ORG, ROSA]);
  const { sealBag } = await import("../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "tok_push1", refreshToken: "ref_push1", scope: null }, { aad: ORG });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name) VALUES
           ('mbx_push1_g',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test'),
           ('mbx_push1_m',$1,$2,'microsoft',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test')`, [ORG, UID, ANN, sealed]);
}

const waitFor = async (fn, ms = 15000, every = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); }
  return null;
};
const pushRows = () => q(`SELECT * FROM mailbox_push WHERE org_id=$1 ORDER BY kind`, [ORG]);
const runs = (provider, kind, trigger) => q(`SELECT COUNT(*)::int AS n FROM mailbox_sync_runs WHERE org_id=$1 AND provider=$2 AND kind=$3 AND trigger=$4`, [ORG, provider, kind, trigger]).then(r => r[0].n);
const logged = id => q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND metadata->>'message_id'=$2`, [ORG, id]).then(r => r[0].n);

(async () => {
  console.log("push1-instant (PUSH-1)");
  await new Promise(r => mock.listen(0, r));
  const MOCK = `http://localhost:${mock.address().port}`;
  await setup();
  const port = await freePort();
  const B = `http://localhost:${port}`;
  S.childBase = B;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), TEST_MODE: "1", DISABLE_BACKGROUND_TICKS: "1", SENTRY_DSN: "",
           JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local",
           STEWARD_CREDENTIAL_KEY: CRED_KEY, MAILBOX_TICK_MS: "1500", MAILBOX_TICK_ORG: ORG, PUSH_RETRY_MS: "300",
           PUSH_BASE_URL: B, GMAIL_PUBSUB_TOPIC: TOPIC, PUBSUB_PUSH_SERVICE_ACCOUNT: SA, GOOGLE_OIDC_CERTS_URL: MOCK + "/certs",
           GMAIL_API_BASE: MOCK, GOOGLE_CALENDAR_API_BASE: MOCK, GRAPH_API_BASE: MOCK },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errs = ""; child.stderr.on("data", d => { errs += d; });
  try {
    const up = await waitFor(() => fetch(B + "/health").then(r => r.ok), 120000, 1000);
    ok("the push server started", !!up, errs.slice(-400));
    if (!up) return;
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ANN, password: "loadtest1234" }) })).json();
    const H = { Authorization: "Bearer " + login.token };
    const mailbox = async () => (await (await fetch(B + "/mailbox", { headers: H })).json()).providers || [];
    const health = async key => ((await mailbox()).find(p => p.key === key) || {}).health || {};
    const post = (p, body, headers = {}) => fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: body == null ? undefined : JSON.stringify(body) });
    const claims = (over = {}) => ({ iss: "https://accounts.google.com", aud: B + "/push/google/gmail", email: SA, email_verified: true,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, sub: "1234", ...over });
    const gmailNotice = (token, address = ANN) => post("/push/google/gmail",
      { message: { data: Buffer.from(JSON.stringify({ emailAddress: address, historyId: S.historyId })).toString("base64"), messageId: "m" + Date.now() }, subscription: "projects/steward-test/subscriptions/gmail" },
      token ? { Authorization: "Bearer " + token } : {});

    // §1
    console.log("\n· §1 · the tick makes every channel");
    const rows = await waitFor(async () => { const r = await pushRows(); return r.length === 5 && r.every(x => x.status === "on") ? r : null; }, 20000);
    ok("§1 five channels are on: Gmail watch, Calendar channel, Graph Inbox, Sent Items and events", !!rows, JSON.stringify((await pushRows()).map(r => [r.kind, r.status, r.last_error])));
    const watch = S.calls.find(c => c.path === "/gmail/v1/users/me/watch");
    ok("§1 the Gmail watch names the Pub/Sub topic and only INBOX and SENT", watch && watch.body.topicName === TOPIC && JSON.stringify(watch.body.labelIds) === '["INBOX","SENT"]', JSON.stringify(watch && watch.body));
    const ch0 = S.gcalChannels[0];
    ok("§1 the Calendar channel points at Steward's endpoint, with a token", ch0 && ch0.type === "web_hook" && ch0.address === B + "/push/google/calendar" && (ch0.token || "").length >= 32, JSON.stringify(ch0));
    const subs = Object.values(S.graphSubs);
    ok("§1 three Graph subscriptions, each validated by echoing Graph's token", subs.length === 3 && S.graphValidated === 3
      && subs.map(s => s.resource).sort().join("|") === "me/events|me/mailFolders('Inbox')/messages|me/mailFolders('SentItems')/messages", JSON.stringify(subs.map(s => s.resource)));
    const mins = subs.length ? (new Date(subs[0].expirationDateTime) - Date.now()) / 60e3 : 0;
    ok("§1 Graph is asked for its documented maximum (just under 10,080 minutes)", mins > 10060 && mins <= 10080, String(mins));
    const all = JSON.stringify(await pushRows());
    const secrets = [ch0 && ch0.token, ...subs.map(s => s.clientState)].filter(Boolean);
    ok("§1 no secret is stored as itself, only its hash", secrets.length === 4 && secrets.every(s => !all.includes(s)), String(secrets.length));
    // the first reads ran on the tick (nothing read yet), then push takes over
    await waitFor(async () => (await runs("google", "mail", "tick")) >= 1 && (await runs("microsoft", "calendar", "tick")) >= 1, 15000);

    // §2
    console.log("\n· §2 · a verified Gmail notice: one incremental read, the email logged");
    S.gmail.gm_rosa1 = gm("gm_rosa1", `Rosa Diaz <${ROSA}>`, ANN, "Coffee next week?", "Would love to catch up about the spring program.");
    S.historyId = 200; S.gmailPending = true;
    const pushBefore = await runs("google", "mail", "push");
    const r2 = await gmailNotice(jwt(claims()));
    ok("§2 the verified notice is acknowledged (204)", r2.status === 204, String(r2.status));
    const got2 = await waitFor(async () => (await logged("gm_rosa1")) === 1, 10000);
    ok("§2 …and Rosa's email is on her record within seconds", !!got2, errs.slice(-300));
    await sleep(800);
    ok("§2 …through exactly one read, marked push", (await runs("google", "mail", "push")) - pushBefore === 1, String((await runs("google", "mail", "push")) - pushBefore));
    const gRow = (await pushRows()).find(r => r.kind === "gmail");
    ok("§2 the channel records when the notice came", gRow && gRow.last_notified_at && gRow.notices >= 1, JSON.stringify(gRow && [gRow.last_notified_at, gRow.notices]));

    // §3
    console.log("\n· §3 · a verified Calendar notice logs the meeting");
    const gc = (await pushRows()).find(r => r.kind === "gcal");
    const ch = S.gcalChannels.find(c => c.id === gc.channel_id);
    const calNotice = (state, over = {}) => post("/push/google/calendar", null, { "X-Goog-Channel-ID": gc.channel_id, "X-Goog-Channel-Token": ch.token,
      "X-Goog-Resource-ID": ch.resourceId, "X-Goog-Resource-State": state, "X-Goog-Message-Number": "2", ...over });
    const calPush0 = await runs("google", "calendar", "push");
    const rs = await calNotice("sync");
    await sleep(800);
    ok("§3 a 'sync' notice is acknowledged and reads nothing", rs.status === 200 && (await runs("google", "calendar", "push")) === calPush0, String(rs.status));
    const start = new Date(Date.now() + 2 * 864e5);
    S.gcal.push({ id: "gev_rosa", status: "confirmed", summary: "Coffee with Rosa", start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + 3600e3).toISOString() }, attendees: [{ email: ROSA }, { email: ANN }] });
    S.gcalPending = ["gev_rosa"];
    const r3 = await calNotice("exists");
    ok("§3 the verified change notice is acknowledged", r3.status === 200, String(r3.status));
    const got3 = await waitFor(async () => (await q(`SELECT 1 FROM calendar_events WHERE org_id=$1 AND provider='google' AND provider_event_id='gev_rosa'`, [ORG])).length === 1, 10000);
    ok("§3 …and the meeting with Rosa is on her record", !!got3, errs.slice(-300));
    ok("§3 …read once, as push, through the sync token", (await runs("google", "calendar", "push")) === calPush0 + 1
      && S.calls.some(c => c.path === "/calendar/v3/calendars/primary/events" && /syncToken=/.test(c.search)), String(await runs("google", "calendar", "push")));

    // §4
    console.log("\n· §4 · verified Graph notices log the Outlook email and meeting");
    const subOf = res => Object.values(S.graphSubs).find(s => s.resource === res);
    const graphNotice = (sub, over = {}) => post("/push/microsoft", { value: [{ subscriptionId: sub.id, clientState: sub.clientState, changeType: "created",
      resource: sub.resource, tenantId: "t1", subscriptionExpirationDateTime: sub.expirationDateTime, ...over }] });
    const when = new Date().toISOString();
    S.inbox.push({ id: "ms_rosa1", subject: "Thank you", from: { emailAddress: { address: ROSA } }, toRecipients: [{ emailAddress: { address: ANN } }],
      ccRecipients: [], receivedDateTime: when, sentDateTime: when, body: { contentType: "text", content: "Thanks for the tour yesterday." },
      hasAttachments: false, conversationId: "conv_ms_rosa1", internetMessageHeaders: [] });
    S.graphPending.inbox = [{ id: "ms_rosa1" }];
    const r4 = await graphNotice(subOf("me/mailFolders('Inbox')/messages"));
    ok("§4 the verified Outlook notice is accepted (202)", r4.status === 202, String(r4.status));
    ok("§4 …and Rosa's Outlook email is on her record", !!(await waitFor(async () => (await logged("ms_rosa1")) === 1, 10000)), errs.slice(-300));
    const s2 = new Date(Date.now() + 3 * 864e5);
    S.events.push({ id: "msev_rosa", subject: "Site visit", isCancelled: false, location: null,
      start: { dateTime: s2.toISOString().replace(/Z$/, ""), timeZone: "UTC" }, end: { dateTime: new Date(s2.getTime() + 3600e3).toISOString().replace(/Z$/, ""), timeZone: "UTC" },
      attendees: [{ emailAddress: { address: ROSA } }] });
    S.graphPending.calendar = [{ id: "msev_rosa" }];
    const r4b = await graphNotice(subOf("me/events"));
    ok("§4 the Outlook calendar notice logs the meeting", r4b.status === 202 && !!(await waitFor(async () =>
      (await q(`SELECT 1 FROM calendar_events WHERE org_id=$1 AND provider='microsoft' AND provider_event_id='msev_rosa'`, [ORG])).length === 1, 10000)), String(r4b.status));

    // §5
    console.log("\n· §5 · an unverified notice is refused, logged, and reads nothing");
    const pushRunsNow = async () => (await q(`SELECT COUNT(*)::int AS n FROM mailbox_sync_runs WHERE org_id=$1 AND trigger='push'`, [ORG]))[0].n;
    const before5 = await pushRunsNow();
    S.gmail.gm_rosa2 = gm("gm_rosa2", `Rosa Diaz <${ROSA}>`, ANN, "Second note", "Forged notices should not fetch me.");
    S.historyId = 300; S.gmailPending = true;
    const cases = [
      ["no token at all", await gmailNotice(null)],
      ["a token signed by another key", await gmailNotice(jwt(claims(), forger.privateKey))],
      ["the wrong audience", await gmailNotice(jwt(claims({ aud: "https://elsewhere.example/push" })))],
      ["the wrong service account", await gmailNotice(jwt(claims({ email: "someone@evil.iam.gserviceaccount.com" })))],
      ["an expired token", await gmailNotice(jwt(claims({ exp: Math.floor(Date.now() / 1000) - 3600 })))],
      ["a Calendar notice with the wrong channel token", await calNotice("exists", { "X-Goog-Channel-Token": "not-the-token" })],
      ["a Calendar notice for an unknown channel", await calNotice("exists", { "X-Goog-Channel-ID": "stw-unknown" })],
      ["a Graph notice with the wrong clientState", await graphNotice(subOf("me/mailFolders('Inbox')/messages"), { clientState: "guess" })],
      ["a Graph notice for an unknown subscription", await graphNotice({ id: "sub_nobody", clientState: "x", resource: "me/events" })],
    ];
    cases.push(["a validation token carrying markup is not echoed", await fetch(B + "/push/microsoft?validationToken=" + encodeURIComponent("<script>alert(1)</script>"), { method: "POST" })]);
    for (const [what, r] of cases) ok(`§5 refused: ${what} (401)`, r.status === 401, String(r.status));
    await sleep(1200);
    ok("§5 …and not one of them started a read", (await pushRunsNow()) === before5, `${before5} -> ${await pushRunsNow()}`);
    ok("§5 …and the forged Gmail notice fetched nothing", (await logged("gm_rosa2")) === 0);
    ok("§5 …and each refusal is logged", (errs.match(/\[push\] refused/g) || []).length >= cases.length, String((errs.match(/\[push\] refused/g) || []).length));
    S.gmailPending = false; delete S.gmail.gm_rosa2;

    // §6
    console.log("\n· §6 · an expiring channel is renewed");
    await q(`UPDATE mailbox_push SET expires_at = NOW() + INTERVAL '1 day' WHERE org_id=$1 AND kind IN ('graph_inbox','gcal')`, [ORG]);
    await q(`UPDATE mailbox_push SET expires_at = NOW() + INTERVAL '5 days' WHERE org_id=$1 AND kind='gmail'`, [ORG]);
    const oldCal = { ...gc, token: ch.token };
    const inboxSub = subOf("me/mailFolders('Inbox')/messages");
    const mark6 = S.calls.length;
    const renewed = await waitFor(async () => {
      const r = await pushRows();
      return r.filter(x => ["graph_inbox", "gcal", "gmail"].includes(x.kind)).every(x => new Date(x.expires_at) - Date.now() > 6 * 864e5) ? r : null;
    }, 15000);
    ok("§6 the three channels near expiry now run a week ahead", !!renewed, JSON.stringify((await pushRows()).map(r => [r.kind, r.expires_at])));
    const c6 = S.calls.slice(mark6);
    ok("§6 Graph extended the same subscription (PATCH)", c6.some(c => c.method === "PATCH" && c.path === `/v1.0/subscriptions/${inboxSub.id}`), c6.map(c => c.method + " " + c.path).join(" "));
    const gc2 = (renewed || []).find(r => r.kind === "gcal");
    ok("§6 the Calendar channel was replaced, and the old one stopped", gc2 && gc2.channel_id !== oldCal.channel_id && S.stopped.some(s => s.id === oldCal.channel_id), JSON.stringify(S.stopped));
    ok("§6 Gmail was watched again", c6.some(c => c.path === "/gmail/v1/users/me/watch"));
    const stale = await post("/push/google/calendar", null, { "X-Goog-Channel-ID": oldCal.channel_id, "X-Goog-Channel-Token": oldCal.token,
      "X-Goog-Resource-ID": ch.resourceId, "X-Goog-Resource-State": "exists" });
    ok("§6 a notice on the old Calendar channel is refused", stale.status === 401, String(stale.status));

    // §7
    console.log("\n· §7 · push on: the tick waits 30 minutes; push stops: back to 5");
    const h1 = await health("google");
    ok("§7 the panel says instant updates are on, with the last notice", h1.instant && h1.instant.on === true && h1.instant.sentence === "Instant updates: on" && !!h1.instant.lastNoticeAt && h1.instant.pollEveryMinutes === 30, JSON.stringify(h1.instant));
    const tick0 = await runs("google", "mail", "tick");
    await sleep(4500);   // three ticks
    ok("§7 while push is on, the tick does not read Gmail every tick", (await runs("google", "mail", "tick")) === tick0, `${tick0} -> ${await runs("google", "mail", "tick")}`);
    // The last notice was 40 minutes ago, the last read 31: the 30-minute
    // safety read is due. A message arrived and no notice announced it.
    await q(`UPDATE mailbox_sync_runs SET finished_at = NOW() - INTERVAL '31 minutes' WHERE org_id=$1 AND provider='google' AND kind='mail'`, [ORG]);
    await q(`UPDATE mailbox_push SET last_notified_at = NOW() - INTERVAL '40 minutes' WHERE org_id=$1 AND kind='gmail'`, [ORG]);
    S.gmail.gm_rosa3 = gm("gm_rosa3", `Rosa Diaz <${ROSA}>`, ANN, "No notice for this one", "Google never told Steward about me.");
    S.historyId = 400; S.gmailPending = true;
    const paused = await waitFor(async () => { const r = (await pushRows()).find(x => x.kind === "gmail"); return r && r.status === "paused" ? r : null; }, 10000);
    ok("§7 the safety read found a change no notice announced: instant updates paused", paused && paused.paused_reason === "stopped", JSON.stringify(paused));
    ok("§7 …and the email was still logged, by the safety read", (await logged("gm_rosa3")) === 1);
    const h2 = await health("google");
    ok("§7 the panel says so, in the words of the brief", h2.instant && h2.instant.on === false
      && h2.instant.sentence === "Instant updates paused: Google stopped sending. Reading every 5 minutes." && h2.instant.pollEveryMinutes === 5, JSON.stringify(h2.instant));
    const tick1 = await runs("google", "mail", "tick");
    await sleep(4000);
    ok("§7 …and the tick reads every time again", (await runs("google", "mail", "tick")) >= tick1 + 2, `${tick1} -> ${await runs("google", "mail", "tick")}`);
    ok("§7 …and it waits an hour before making the channel again", ((await pushRows()).find(x => x.kind === "gmail") || {}).status === "paused");
    const m2 = await health("microsoft");
    ok("§7 Outlook, still healthy, stays on", m2.instant && m2.instant.on === true && m2.instant.pollEveryMinutes === 30, JSON.stringify(m2.instant));
  } finally {
    child.kill();
    mock.close();
    await reset().catch(() => {});
    await closeDb();
  }
  summary();
})().catch(e => { console.error(e); process.exit(1); });
