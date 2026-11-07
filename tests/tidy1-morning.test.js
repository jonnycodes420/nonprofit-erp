// TIDY-1 · The morning email can be previewed and tested, and MONEY-3's loose ends.
//
//   §1 the preview (GET /me/morning-email) is the email the morning tick sends:
//      the same subject and the same HTML, byte for byte, as the local sink
//      captured from the real run; "Last sent" then names it and its items.
//   §2 "Send me a test" goes only to the signed-in person's own address, marked
//      [Test]; the 4th in a day is refused and sends nothing. Planted defect:
//      sending to the org's first donor instead (red).
//   §3 the queue drain waits for an import's background job (importRecent).
//   §4 Home's "also" lines: a household with two pledges gives two keys.
//   §5 the after-change rhythm write skips itself when the person's gifts
//      changed after its read, and the newer write lands.
// Sends go to the local Resend sink only. Fake people, made-up names.
"use strict";
const http = require("http");
const path = require("path");
const fs = require("fs");
const { ok, summary, api, q, closeDb, BASE, SINK_PORT } = require("./helpers");
const { drainQueue } = require("./lib/drainQueue");
const { civilDay } = require("./clock");

const uniq = () => Math.random().toString(36).slice(2, 8);
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));

function startSink(port) {
  const state = { captured: [] };
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      let parsed = {}; try { parsed = JSON.parse(b); } catch {}
      state.captured.push(parsed);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "sunk_" + state.captured.length }));
    });
  });
  return new Promise(resolve => { srv.on("error", () => resolve(null)); srv.listen(port, () => resolve({ srv, state })); });
}

(async () => {
  console.log("tidy1-morning (TIDY-1)");
  const sink = await startSink(SINK_PORT);
  if (!sink) { console.error(`could not bind the sink on :${SINK_PORT}`); process.exit(1); }
  const { state } = sink;
  const to = addr => state.captured.filter(m => (Array.isArray(m.to) ? m.to : [m.to]).includes(addr));

  // ── fixture: an org whose mail is on, its admin, one donor with an email ──
  const email = `tidy1-${uniq()}@test.local`;
  const reg = await fetch(BASE + "/auth/register-org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Tidewell Commons " + uniq(), userName: "Wren Ashdown", email, password: "loadtest1234" }),
  }).then(r => r.json());
  const tok = reg.token, orgId = reg.org.id;
  await q("UPDATE orgs SET emails_enabled=true, staff_mail_enabled=true, onboarded_at=NOW(), onboarded_via='test' WHERE id=$1", [orgId]);
  const donorEmail = `first-donor-${uniq()}@test.local`;
  const d1 = await api("POST", "/donors", tok, { name: "Odile Farrow", email: donorEmail, stage: "donor" });
  const [me] = await q("SELECT id FROM users WHERE email=$1", [email]);
  await api("PUT", "/me/notification-prefs", tok, { morningEmail: true, brief: { days: "every_day" } });
  const today = civilDay();
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,assigned_to,assigned_to_name,created_by,created_by_name)
           VALUES ($1,$2,'Ring the hall about Saturday',$3,'medium','admin',0,$4,'Wren Ashdown',$4,'Wren Ashdown')`,
    ["t_tidy1" + uniq(), orgId, today, me.id]);

  // ── §1 the preview is what the tick sends ────────────────────────────────
  {
    const pv = await api("GET", "/me/morning-email", tok);
    ok("§1 the preview answers with a subject, the HTML and its items",
      pv.status === 200 && /Ring the hall about Saturday/.test(pv.body?.html || "") && pv.body.items === 1 && pv.body.wouldSend === true,
      { status: pv.status, items: pv.body?.items, why: pv.body?.why });
    ok("§1 nothing has been sent yet, and the page says so", pv.status === 200 && pv.body?.lastSent === null, pv.body?.lastSent);
    state.captured.length = 0;
    const run = await api("POST", "/nudges/run", tok, { today: pv.body?.today || today, force: true });
    await settle();
    const got = to(email);
    ok("§1 the real morning run sent her one email", (run.body?.sent || []).some(s => s.email === email) && got.length === 1, { sent: run.body?.sent, skipped: run.body?.skipped, n: got.length });
    ok("§1 the preview's subject is the sent subject", got[0] && got[0].subject === pv.body?.subject, { preview: pv.body.subject, sent: got[0]?.subject });
    ok("§1 the preview's HTML is the sent HTML, byte for byte", got[0] && !!pv.body?.html && got[0].html === pv.body.html,
      { previewLen: pv.body?.html?.length, sentLen: got[0]?.html?.length });
    const after = await api("GET", "/me/morning-email", tok);
    ok("§1 Last sent: a time and the number of items", after.body?.lastSent && after.body.lastSent.items === 1 && !!after.body.lastSent.at, after.body?.lastSent);
    ok("§1 a GET wrote nothing: no test slot taken", after.body?.testsLeft === 3, after.body?.testsLeft);
  }

  // ── §2 the test goes to her alone, 3 a day ───────────────────────────────
  {
    state.captured.length = 0;
    const sends = [];
    for (let i = 0; i < 3; i++) sends.push(await api("POST", "/me/morning-email/test", tok, { to: donorEmail }));
    await settle();
    ok("§2 three tests send", sends.every(s => s.status === 200 && s.body?.sent === true), sends.map(s => [s.status, s.body?.error]));
    const mine = to(email);
    ok("§2 each went to the signed-in person's own address", mine.length === 3 && state.captured.length === 3, { mine: mine.length, all: state.captured.map(m => m.to) });
    ok("§2 never to the org's donor, even when the body names one", to(donorEmail).length === 0 && d1.status < 300, { donor: to(donorEmail).length });
    ok("§2 each is marked [Test]", mine.every(m => /^\[Test\] /.test(m.subject || "")), mine.map(m => m.subject));
    ok("§2 the countdown reaches zero", sends[2].body?.testsLeft === 0, sends.map(s => s.body?.testsLeft));
    const fourth = await api("POST", "/me/morning-email/test", tok, {});
    await settle();
    ok("§2 the 4th in a day is refused", fourth.status === 429 && /3 tests today/.test(fourth.body?.error || ""), { status: fourth.status, body: fourth.body });
    ok("§2 …and sends nothing", state.captured.length === 3, state.captured.length);
    const [{ n: realSlots }] = await q(`SELECT COUNT(*)::int AS n FROM digest_sends WHERE org_id=$1 AND digest_type IN ('thread_nudge','daily_tasks')`, [orgId]);
    ok("§2 a test reserves no real morning ledger", realSlots === 1, realSlots);
  }

  // ── §3 the drain waits for an import's background job ───────────────────
  {
    const id = "jq_tidy1" + uniq();
    await q(`INSERT INTO job_queue (id, name, org_id, key, payload, status, attempts, started_at, locked_by, heartbeat_at, created_by, created_by_name)
             VALUES ($1,'importRecent',$2,$3,'{}','running',1,NOW(),'tidy1-test',NOW(),'system:tidy1-test','TIDY-1 test')`, [id, orgId, "importRecent:tidy1" + uniq()]);
    const waiting = await drainQueue(q, { orgId, timeout: 600 });
    ok("§3 while an import's recent-gifts job runs, the drain is not done", waiting.drained === false && waiting.waiting >= 1, waiting);
    await q(`UPDATE job_queue SET status='done', finished_at=NOW() WHERE id=$1`, [id]);
    const done = await drainQueue(q, { orgId, timeout: 3000 });
    ok("§3 when it finishes, the drain is", done.drained === true, done);
  }

  // ── §4 two pledges, two keys ─────────────────────────────────────────────
  {
    const file = path.join(__dirname, "..", "client", "src", "lib", "alsoKey.js");
    let keys = null;
    if (fs.existsSync(file)) {
      const { alsoKey } = await import(file);
      // A household card: one partner's pledge move leads, the other's two
      // pledges and a drift line fold in (insights.js m.also's shape).
      const also = [
        { kind: "pledge_due", label: "Pledge due", line: "a", pledgeId: "pl_one", still: 100 },
        { kind: "pledge_due", label: "Pledge due", line: "b", pledgeId: "pl_two", still: 300 },
        { kind: "drift", label: "Drifting", line: "c" }, { kind: "drift", label: "An early sign", line: "d" },
      ];
      keys = also.map((a, i) => alsoKey(a, i));
    }
    ok("§4 a household with two pledges gives every also line its own key", !!keys && new Set(keys).size === keys.length, keys);
    const jsx = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "Insights.jsx"), "utf8");
    ok("§4 Home's move card keys its also lines by alsoKey, never by kind alone", /m\.also\.map\(\(a, ai\) => <div key=\{alsoKey\(a, ai\)\}>/.test(jsx) && !/key=\{a\.kind\}/.test(jsx), null);
  }

  // ── §5 the stale rhythm write skips itself ───────────────────────────────
  {
    const AC = require("../afterChange");
    const add = await api("POST", "/donors", tok, { name: "Benedikt Orme", stage: "donor" });
    const did = add.body?.id;
    await api("POST", `/donors/${did}/gifts`, tok, { amount: 100, date: "2025-11-01", type: "cash" });
    await drainQueue(q, { orgId });
    const [before] = await q("SELECT giving_last_year, giving_this_year, computed_at FROM donor_rhythm WHERE org_id=$1 AND donor_id=$2", [orgId, did]);
    let i = 0;
    const query = (sql, params) => { i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), params); };
    let wroteBetween = false;
    AC.configure({
      query,
      // Called after the read and before the write: a second gift lands here,
      // through the real route (its own after-change step then runs).
      computeDriftForDonors: async () => {
        const g = await api("POST", `/donors/${did}/gifts`, tok, { amount: 250, date: today, type: "cash" });
        wroteBetween = g.status < 300;
        return { map: new Map() };
      },
    });
    const r = typeof AC.rhythmFor === "function"
      ? await AC.rhythmFor(orgId, [did], { door: "gift_form:tidy1", today }).catch(e => ({ error: e.message }))
      : { error: "afterChange.rhythmFor is not there" };
    ok("§5 a gift landed between the read and the write", wroteBetween, null);
    ok("§5 the write from the stale read is skipped", !r.error && Array.isArray(r.skipped) && r.skipped.includes(did), r);
    await drainQueue(q, { orgId });
    const [after] = await q("SELECT giving_this_year, giving_last_year, last_door FROM donor_rhythm WHERE org_id=$1 AND donor_id=$2", [orgId, did]);
    const total = Number(after?.giving_this_year || 0) + Number(after?.giving_last_year || 0);
    ok("§5 the stored row counts both gifts (the newer write landed)", !!before && total === 350 && after.last_door !== "gift_form:tidy1", { before, after });
  }

  sink.srv.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
