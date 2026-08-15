// MIGC client-site API suite — drives /api/migc/* (routes/migc.js) against
// the scratch server. Covers: contact insert + Resend notification capture,
// honeypot fake-success (nothing stored, nothing mailed), validation 400s,
// subscribe upsert idempotency, published-events filtering/order/cache
// header, and the router's CORS allowlist (loopback allowed, foreign origin
// gets no ACAO header).
//
// Needs the server booted with MIGC_CONTACT_EMAIL + MIGC_EMAIL_FROM (see
// tests/run-all.sh header env) so the contact route attempts the notification
// send; this suite starts its own Resend sink on :5602 to capture it.
// Rate-limit 429s are NOT asserted here — the shared scratch server runs with
// DISABLE_RATE_LIMIT=1 (limiter wiring is covered by the source guard below).

const { ok, summary, q, closeDb, BASE } = require("./helpers");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SINK_PORT = 5602;
const CONTACT_TO = process.env.MIGC_CONTACT_EMAIL || "migc-contact@example.org";
const MARK = "migc-suite.example"; // every row this suite creates uses this email domain

// Only mail addressed to the MIGC contact inbox counts — other suites' queued
// notifications can replay into an open sink (retry sweep, BUILD-45).
const received = [];
const forMe = m => [].concat(m.to || []).includes(CONTACT_TO);
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        let parsed = null; try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 200) }; }
        if (forMe(parsed)) received.push(parsed);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id: "sunk" }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));

async function post(pathname, body, headers = {}) {
  const r = await fetch(BASE + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j, headers: r.headers };
}

(async () => {
  const sink = await startSink();

  // Ensure tables exist (first request creates them), then clear this suite's rows.
  const warm = await fetch(BASE + "/api/migc/events");
  ok("events endpoint reachable", warm.status === 200);
  await q(`DELETE FROM migc_contacts WHERE email LIKE '%@${MARK}'`);
  await q(`DELETE FROM migc_subscribers WHERE email LIKE '%@${MARK}'`);
  await q(`DELETE FROM migc_events WHERE title LIKE 'migc-suite:%'`);

  // ── contact: happy path ──
  const c1 = await post("/api/migc/contact", {
    name: "Suite Tester", email: `visitor@${MARK}`, org: "Test Nonprofit",
    message: "I would like to schedule a conversation about coaching.",
  });
  ok("contact accepts a valid submission", c1.status === 200 && c1.body?.ok === true, c1);
  const rows = await q(`SELECT * FROM migc_contacts WHERE email = 'visitor@${MARK}'`);
  ok("contact row stored with all fields", rows.length === 1 && rows[0].name === "Suite Tester" && rows[0].org === "Test Nonprofit" && /coaching/.test(rows[0].message), rows);

  await settle();
  ok("contact notification captured by sink", received.length === 1, received.map(m => m.subject));
  const mail = received[0] || {};
  ok("notification reply_to is the visitor", (mail.reply_to === `visitor@${MARK}`) || [].concat(mail.reply_to || []).includes(`visitor@${MARK}`), mail.reply_to);
  ok("notification carries name + message", /Suite Tester/.test(mail.html || "") && /coaching/.test(mail.html || ""), mail.subject);

  // ── contact: honeypot ──
  const hp = await post("/api/migc/contact", {
    name: "Bot", email: `bot@${MARK}`, message: "spam spam", website: "http://spam.example",
  });
  ok("honeypot gets a fake 200", hp.status === 200 && hp.body?.ok === true, hp);
  const botRows = await q(`SELECT * FROM migc_contacts WHERE email = 'bot@${MARK}'`);
  ok("honeypot submission not stored", botRows.length === 0, botRows);
  await settle(400);
  ok("honeypot submission not mailed", received.length === 1, received.length);

  // ── contact: validation ──
  const v1 = await post("/api/migc/contact", { name: "No Message", email: `nomsg@${MARK}`, message: "" });
  ok("contact 400s on empty message", v1.status === 400 && !!v1.body?.error, v1);
  const v2 = await post("/api/migc/contact", { name: "Bad Email", email: "not-an-email", message: "hi there" });
  ok("contact 400s on invalid email", v2.status === 400, v2);
  const v3 = await post("/api/migc/contact", { name: "Long", email: `long@${MARK}`, message: "x".repeat(5001) });
  ok("contact 400s on >5000-char message", v3.status === 400, v3);
  ok("invalid submissions stored nothing", (await q(`SELECT * FROM migc_contacts WHERE email IN ('nomsg@${MARK}','long@${MARK}')`)).length === 0);

  // ── subscribe ──
  const s1 = await post("/api/migc/subscribe", { email: `reader@${MARK}` });
  ok("subscribe accepts a valid email", s1.status === 200 && s1.body?.ok === true, s1);
  const s2 = await post("/api/migc/subscribe", { email: `READER@${MARK}` });
  ok("re-subscribe (case-varied) is a quiet success", s2.status === 200 && s2.body?.ok === true, s2);
  const subs = await q(`SELECT * FROM migc_subscribers WHERE email LIKE '%@${MARK}'`);
  ok("subscriber stored once, lowercased", subs.length === 1 && subs[0].email === `reader@${MARK}`, subs);
  const s3 = await post("/api/migc/subscribe", { email: "nope" });
  ok("subscribe 400s on invalid email", s3.status === 400, s3);
  const s4 = await post("/api/migc/subscribe", { email: `bot2@${MARK}`, website: "spam" });
  ok("subscribe honeypot gets fake 200, stores nothing", s4.status === 200 && (await q(`SELECT * FROM migc_subscribers WHERE email = 'bot2@${MARK}'`)).length === 0, s4);

  // ── events ──
  // Seed out of date-order so the ORDER BY is actually exercised; one
  // unpublished row must never appear.
  await q(`INSERT INTO migc_events (id, title, date, time, location, description, is_published) VALUES
    ('migc_t_b', 'migc-suite: Later Workshop',  '2031-09-30', '10:00 AM', 'Daphne, AL', 'Second', TRUE),
    ('migc_t_a', 'migc-suite: Sooner Workshop', '2031-07-22', NULL, 'Virtual', 'First', TRUE),
    ('migc_t_d', 'migc-suite: Draft Event',     '2031-08-15', NULL, NULL, 'Hidden', FALSE)`);
  const er = await fetch(BASE + "/api/migc/events");
  const ej = await er.json();
  ok("events cache header is 5 minutes", er.headers.get("cache-control") === "public, max-age=300", er.headers.get("cache-control"));
  const mine = (ej.events || []).filter(e => /^migc-suite:/.test(e.title));
  ok("only published events returned", mine.length === 2 && !mine.some(e => /Draft/.test(e.title)), mine.map(e => e.title));
  ok("events sorted by date ascending", mine[0]?.title.includes("Sooner") && mine[1]?.title.includes("Later"), mine.map(e => e.date));
  ok("event date is a plain YYYY-MM-DD string", mine[0]?.date === "2031-07-22", mine[0]?.date);

  // ── CORS ──
  const loop = new URL(BASE).origin;
  const cOk = await fetch(BASE + "/api/migc/events", { headers: { Origin: loop } });
  ok("loopback origin allowed (local dev)", cOk.headers.get("access-control-allow-origin") === loop, cOk.headers.get("access-control-allow-origin"));
  const cNo = await fetch(BASE + "/api/migc/events", { headers: { Origin: "https://evil.example" } });
  ok("foreign origin gets no ACAO header", cNo.headers.get("access-control-allow-origin") === null, cNo.headers.get("access-control-allow-origin"));
  const pre = await fetch(BASE + "/api/migc/contact", {
    method: "OPTIONS",
    headers: { Origin: loop, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  ok("preflight from allowed origin succeeds", pre.status === 204 && pre.headers.get("access-control-allow-origin") === loop, pre.status);

  // ── source guards ──
  // The shared scratch server runs DISABLE_RATE_LIMIT=1, so assert the wiring
  // at the source level instead of driving 429s here.
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "migc.js"), "utf8");
  ok("both POST routes are rate-limited", /post\("\/contact", contactLimiter/.test(src) && /post\("\/subscribe", subscribeLimiter/.test(src));
  ok("no hardcoded notification address", !/@missionincrease\.org|@gmail\.com/.test(src));
  ok("notification target comes from env", src.includes("MIGC_CONTACT_EMAIL") && src.includes("MIGC_EMAIL_FROM"));
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  ok("router mounted before the SaaS CORS stack", serverSrc.indexOf('app.use("/api/migc"') < serverSrc.indexOf("app.use(cors("), serverSrc.indexOf('app.use("/api/migc"'));

  // ── cleanup ──
  await q(`DELETE FROM migc_contacts WHERE email LIKE '%@${MARK}'`);
  await q(`DELETE FROM migc_subscribers WHERE email LIKE '%@${MARK}'`);
  await q(`DELETE FROM migc_events WHERE title LIKE 'migc-suite:%'`);
  await closeDb();
  if (sink) sink.close();
  summary();
})().catch(err => { console.error(err); process.exit(1); });
