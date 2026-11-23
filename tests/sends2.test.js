// tests/sends2.test.js · SENDS-2 (Jarvis's 22 Nov sweep). The build's one new suite: it guards email.
// Nothing goes to a person until someone has seen exactly who it goes to.
//
// §1 No bulk door mints confirms without a plan. The scan (scripts/ci/send-plan-scan.js) is green
//    on this tree and red on each planted shape (a route loop, a .map, a list in `to:`, a browser
//    loop of single sends); the run-time guard (confirmScope) refuses a second confirm in one
//    request without a plan; the old doors (volunteer drafts, Send all reviewed, reconnect) refuse
//    more than one person and send nothing.
// §2 A plan sends exactly its list, once, by the person who built it, within 10 minutes. A draft
//    changed since is skipped and named; each confirm carries the plan's id; another user's commit,
//    a stale plan and a second press send nothing.
// §3 A reminder is only a reminder while its shift is tomorrow. Yesterday's is not listed, a plan
//    names it as refused, a send by id refuses it with "Ana's shift was <date>", and the sweep sets
//    it expired.
// §4 A volunteer draft older than 14 days is marked for Older drafts, with the rule in one sentence.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · the scan run on origin/main's source → §1 red on four doors (thanks.js send-reviewed, give.js
//     reconnect, volunteerScheduling drafts/send, Auctions' Send all).
//   · /volunteer-hub/drafts/send looping its ids again (main's handler) → §1 "two ids refused" red.
//   · commit without `created_by = ?` → §2 "another user's commit" red.
//   · the reminder refusal removed from the single send → §3 "yesterday's reminder refused" red.
"use strict";
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, BASE, SINK_PORT, login, civilPlusDays } = require("./helpers");

const PASSWORD = "loadtest1234";
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = iso => { const [, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };

function startSink(port = SINK_PORT) {
  const state = { captured: [] };
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      let parsed = {}; try { parsed = JSON.parse(b); } catch (_) { /* not json */ }
      state.captured.push(parsed);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "sunk_" + state.captured.length }));
    });
  });
  return new Promise(resolve => {
    srv.on("error", e => { console.error("sink bind failed:", e.message); resolve(null); });
    srv.listen(port, () => resolve({ srv, state }));
  });
}

(async () => {
  console.log("sends2 (SENDS-2)");
  const sink = await startSink();
  if (!sink) { console.error(`could not bind :${SINK_PORT}`); process.exit(1); }
  const { state } = sink;
  const to = addr => state.captured.filter(m => (Array.isArray(m.to) ? m.to : [m.to]).map(x => String(x).toLowerCase()).includes(addr.toLowerCase()));
  const RUN = require("crypto").randomBytes(4).toString("hex");

  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Sends Two Lanternfield Commons ${RUN}`, userName: "Odile Marchbank", email: `owner-${RUN}@sends2.local`, password: PASSWORD }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tokA = rb.token, ORG = rb.org.id;
  await q(`UPDATE orgs SET emails_enabled=true, staff_mail_enabled=true, onboarded_at=NOW(), onboarded_via='test', onboarding_complete=1 WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  // A second admin in the same org: she may send her own lists, never Odile's.
  const emailB = `second-${RUN}@sends2.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Teodor Vane','admin')`,
    [`u_s2b_${RUN}`, ORG, emailB, bcrypt.hashSync(PASSWORD, 4)]);
  const tokB = await login(emailB, PASSWORD);
  await new Promise(r => setTimeout(r, 5100));   // the 5 s mail-gate cache the signup filled
  await api("POST", "/onboarding/complete", tokA, {});

  // Volunteers: a shift tomorrow with three people on it, and one yesterday.
  const tomorrow = civilPlusDays(1), yesterday = civilPlusDays(-1);
  const opp = `vop_s2_${RUN}`;
  await q(`INSERT INTO volunteer_opportunities (id,org_id,name,slug) VALUES ($1,$2,'Harbour litter pick',$3)`, [opp, ORG, `litter-${RUN}`]);
  const slot = async (id, date) => q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time) VALUES ($1,$2,$3,$4,'09:00','12:00')`, [id, ORG, opp, date]);
  await slot(`vsl_s2t_${RUN}`, tomorrow);
  await slot(`vsl_s2y_${RUN}`, yesterday);
  const people = {};
  for (const name of ["Ana Ruiz", "Ben Cho", "Corin Ashdown", "Delphine Oake"]) {
    const r = await api("POST", "/donors", tokA, { name, email: `${name.split(" ")[0].toLowerCase()}-${RUN}@sends2.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    people[name.split(" ")[0]] = { id: r.body.id, email: `${name.split(" ")[0].toLowerCase()}-${RUN}@sends2.invalid`, name };
  }
  const signup = async (who, slotId) => {
    const id = `su_s2_${who}_${slotId.slice(4, 7)}_${RUN}`;
    await q(`INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,status) VALUES ($1,$2,$3,$4,'confirmed')`, [id, ORG, slotId, people[who].id]);
    return id;
  };
  for (const who of ["Ana", "Ben", "Corin"]) await signup(who, `vsl_s2t_${RUN}`);
  const anaYesterday = await signup("Ana", `vsl_s2y_${RUN}`);
  const drafted = await api("POST", "/volunteer-hub/drafts/reminders", tokA, {});
  ok("fixture: tomorrow's three reminders are drafted", drafted.status === 200, drafted.body);
  const list = async () => ((await api("GET", "/volunteer-hub/drafts", tokA)).body || {});
  const reminders = (await list()).drafts.filter(d => d.kind === "volunteer_reminder");
  ok("fixture: three reminders listed", reminders.length === 3, reminders.map(d => d.name));

  // ── §1 no bulk door mints confirms without a plan ───────────────────────
  console.log("\n§1 no bulk door mints confirms without a plan");
  {
    const SCAN = require("../scripts/ci/send-plan-scan");
    const root = path.resolve(__dirname, "..");
    const r = require("child_process").spawnSync(process.execPath, [path.join(root, "scripts/ci/send-plan-scan.js")], { encoding: "utf8" });
    ok("§1 the scan is green on this tree", r.status === 0, (r.stdout + r.stderr).slice(-600));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sends2-"));
    const plant = (name, src) => { const f = path.join(dir, name); fs.writeFileSync(f, src); return f; };
    const loopRoute = plant("loopRoute.js", `app.post("/x/send-all", async (req, res) => {
  for (const d of drafts) { await sendMilestoneDraft(req, d); }
});`);
    const mapRoute = plant("mapRoute.js", `async function sendEach(req, ids) { await Promise.all(ids.map(id => sendDraft(req, id))); }`);
    const listTo = plant("listTo.js", `async function many(req, emails) { return recordStaffConfirm({ orgId: 1, to: emails.join(","), by: req.user }); }`);
    const wrapped = plant("wrapped.js", `async function viaHelper(req, d) { return sendHeld(req, d.id, null); }
async function many(req, ds) { for (const d of ds) await viaHelper(req, d); }`);
    const planned = plant("planned.js", `async function commit(req, items) { await under("sp_1", async () => { for (const i of items) await sendMilestoneDraft(req, i); }); }`);
    const server = f => SCAN.scanServer([f]).findings;
    ok("§1 planted: a route looping sendMilestoneDraft is red", server(loopRoute).length === 1, server(loopRoute));
    ok("§1 planted: Promise.all over a .map of sendDraft is red", server(mapRoute).length === 1, server(mapRoute));
    ok("§1 planted: one confirm for a list of addresses is red", server(listTo).length === 1, server(listTo));
    ok("§1 planted: a loop over a helper that sends a held email is red (found by name)", server(wrapped).length === 1, server(wrapped));
    ok("§1 the same loop inside a plan's commit (under) is green", server(planned).length === 0, server(planned));
    const clientLoop = plant("BulkPress.jsx", `export function X({ rows }) {
  const sendOne = r => apiFetch(\`/milestone-drafts/\${r.id}/send\`, { method: "POST" });
  const sendAll = async () => { for (const r of rows) await sendOne(r); };
  return <div>{rows.map(r => <button onClick={() => sendOne(r)}>Send</button>)}<button onClick={sendAll}>All</button></div>;
}`);
    const cf = SCAN.scanClient([clientLoop]);
    ok("§1 planted: a browser loop pressing a send endpoint per row is red, a per-row button is not", cf.length === 1 && /:3 /.test(cf[0]), cf);
    fs.rmSync(dir, { recursive: true, force: true });

    // The run-time half: a second confirm in one request needs a plan.
    const CS = require("../server/mail/confirmScope");
    const inRequest = fn => new Promise((resolve, reject) => CS.middleware()({}, {}, () => Promise.resolve().then(fn).then(resolve, reject)));
    const second = await inRequest(async () => { CS.noteConfirm(); try { CS.noteConfirm(); return "minted"; } catch (e) { return e.code; } });
    ok("§1 run time: a second confirm in one request without a plan is refused", second === "plan_required", second);
    const planned2 = await inRequest(() => CS.under("sp_x", async () => [CS.noteConfirm(), CS.noteConfirm()]));
    ok("§1 run time: under a plan each confirm carries the plan id", planned2.join() === "sp_x,sp_x", planned2);

    state.captured.length = 0;
    const two = await api("POST", "/volunteer-hub/drafts/send", tokA, { ids: reminders.slice(0, 2).map(d => d.id) });
    const rv = await api("POST", "/milestone-drafts/send-reviewed", tokA, {});
    const rc = await api("POST", "/recurring/unlinked/send-reconnect", tokA, { donorIds: [people.Ana.id, people.Ben.id] });
    await settle();
    ok("§1 volunteer drafts: two ids at once are refused, plan_required", two.status === 409 && two.body.error === "plan_required", two);
    ok("§1 Send all reviewed without a plan is refused", rv.status === 409 && rv.body.error === "plan_required", rv);
    ok("§1 reconnect to two people without a plan is refused", rc.status === 409 && rc.body.error === "plan_required", rc);
    ok("§1 …and nothing reached the sink", state.captured.length === 0, state.captured.length);
  }

  // ── §2 a plan sends exactly its list ─────────────────────────────────────
  console.log("\n§2 a plan sends exactly its list, once, by her, within 10 minutes");
  {
    const ids = reminders.map(d => d.id);
    const p = await api("POST", "/send-plans", tokA, { kind: "volunteer", ids });
    const b = p.body || {};
    ok("§2 the plan lists three people by name and address, with each subject", p.status === 201 && b.count === 3
      && ["Ana Ruiz", "Ben Cho", "Corin Ashdown"].every(n => b.recipients.some(r => r.name === n && r.email && r.subject)), b);
    ok("§2 it reads \"Send 3 reminders? To Ana Ruiz, Ben Cho and Corin Ashdown. Each goes now.\"",
      /^Send 3 reminders\? To [A-Z][a-z]+ [A-Z][a-z]+, [A-Z][a-z]+ [A-Z][a-z]+ and [A-Z][a-z]+ [A-Z][a-z]+\. Each goes now\.$/.test(b.sentence || "")
      && b.toLine === b.sentence.replace(/^Send 3 reminders\? /, "") && b.noun[1] === "reminders", b.sentence);
    ok("§2 building a plan sends nothing", (await settle(), state.captured.length === 0), state.captured.length);

    const byB = await api("POST", `/send-plans/${b.planId}/commit`, tokB, {});
    await settle();
    ok("§2 another person's commit is refused and names who prepared it", byB.status === 403 && /Odile Marchbank prepared this list/.test(byB.body.sentence || ""), byB.body);
    ok("§2 …and sends nothing", state.captured.length === 0, state.captured.length);

    // Ben's reminder is edited after she looked: it is skipped and named.
    const ben = reminders.find(d => d.name === "Ben Cho");
    await q(`UPDATE milestone_drafts SET subject = subject || ' (moved to 10am)' WHERE id = $1`, [ben.id]);
    const c = await api("POST", `/send-plans/${b.planId}/commit`, tokA, {});
    await settle();
    ok("§2 her commit sends the two unchanged reminders", c.status === 200 && c.body.sent === 2, c.body);
    ok("§2 the changed one is skipped and named", (c.body.skipped || []).length === 1 && c.body.skipped[0].name === "Ben Cho"
      && /Ben Cho/.test(c.body.message || ""), c.body);
    ok("§2 exactly Ana and Corin reached the sink, once each", to(people.Ana.email).length === 1 && to(people.Corin.email).length === 1
      && to(people.Ben.email).length === 0 && state.captured.length === 2, state.captured.map(m => m.to));
    const conf = await q(`SELECT plan_id FROM send_confirms WHERE org_id = $1`, [ORG]);
    ok("§2 each confirm carries the plan's id", conf.length === 2 && conf.every(r => r.plan_id === b.planId), conf);

    state.captured.length = 0;
    const again = await api("POST", `/send-plans/${b.planId}/commit`, tokA, {});
    await settle();
    ok("§2 a second press sends nothing twice", again.status === 409 && again.body.error === "already_sent" && state.captured.length === 0, again.body);

    const p2 = (await api("POST", "/send-plans", tokA, { kind: "volunteer", ids: [ben.id] })).body;
    await q(`UPDATE send_plans SET created_at = NOW() - INTERVAL '11 minutes' WHERE id = $1`, [p2.planId]);
    const old = await api("POST", `/send-plans/${p2.planId}/commit`, tokA, {});
    await settle();
    ok("§2 a plan older than 10 minutes is refused: look again", old.status === 410 && /more than 10 minutes/.test(old.body.sentence || "")
      && state.captured.length === 0, old.body);
  }

  // ── §3 a reminder is only a reminder while its shift is tomorrow ─────────
  console.log("\n§3 a reminder is only a reminder while its shift is tomorrow");
  {
    const stale = `md_s2_stale_${RUN}`;
    await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,slot_id,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'Reminder: your shift tomorrow','See you tomorrow at 9.','pending_review','volunteer_reminder',$5,'system:volunteer-reminders','Steward')`,
      [stale, ORG, people.Ana.id, `vol:reminder:${anaYesterday}`, `vsl_s2y_${RUN}`]);
    const listed = (await list()).drafts.map(d => d.id);
    ok("§3 yesterday's reminder is not listed", !listed.includes(stale), listed);
    const p = (await api("POST", "/send-plans", tokA, { kind: "volunteer", ids: [stale] })).body;
    ok("§3 a plan names it as refused, with the date", p.count === 0 && p.refused.length === 1
      && p.refused[0].why === `Ana's shift was ${shortDate(yesterday)}, so this reminder is out of date.`, p);
    state.captured.length = 0;
    const byId = await api("POST", "/volunteer-hub/drafts/send", tokA, { ids: [stale] });
    await settle();
    ok("§3 asked for by id, yesterday's reminder is refused with why", byId.status === 409 && byId.body.error === "out_of_date"
      && byId.body.sentence === `Ana's shift was ${shortDate(yesterday)}, so this reminder is out of date.`, byId.body);
    ok("§3 …and nothing reached the sink", state.captured.length === 0, state.captured.length);
    // The sweep sets a waiting one aside.
    const stale2 = `md_s2_stale2_${RUN}`;
    const delphine = await signup("Delphine", `vsl_s2y_${RUN}`);
    await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'Reminder','See you.','pending_review','volunteer_reminder','system:volunteer-reminders','Steward')`,
      [stale2, ORG, people.Delphine.id, `vol:reminder:${delphine}`]);
    const sweep = await api("POST", "/volunteer-hub/run-reminders", tokA, {});
    const [row] = await q(`SELECT status FROM milestone_drafts WHERE id = $1`, [stale2]);
    const [kept] = await q(`SELECT status FROM milestone_drafts WHERE id = $1`, [reminders.find(d => d.name === "Ben Cho").id]);
    ok("§3 the sweep sets a past shift's reminder expired (found through its sign-up)", sweep.status === 200 && row.status === "expired", { sweep: sweep.body, row });
    ok("§3 …and leaves tomorrow's waiting", kept.status === "pending_review", kept);
  }

  // ── §4 older drafts ──────────────────────────────────────────────────────
  console.log("\n§4 a volunteer draft older than 14 days waits under Older drafts");
  {
    const thanks = (id, who, days) => q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name,created_at)
             VALUES ($1,$2,$3,$1,'Thank you for Saturday','Thank you.','pending_review','volunteer_thanks','system:volunteer-checkin','Steward',NOW() - make_interval(days => $4))`,
      [id, ORG, people[who].id, days]);
    await thanks(`vol:thanks:s2old_${RUN}`, "Ben", 15);
    await thanks(`vol:thanks:s2new_${RUN}`, "Corin", 2);
    const l = await list();
    const by = id => l.drafts.find(d => d.id === id) || {};
    ok("§4 a thank-you from 15 days ago is marked older", by(`vol:thanks:s2old_${RUN}`).older === true, by(`vol:thanks:s2old_${RUN}`));
    ok("§4 one from 2 days ago is not", by(`vol:thanks:s2new_${RUN}`).older === false, by(`vol:thanks:s2new_${RUN}`));
    ok("§4 the rule is said in one sentence", /older than 14 days moves to Older drafts\.$/.test(l.ageRule || ""), l.ageRule);
  }

  sink.srv.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch (_) { /* closing */ } process.exit(1); });
