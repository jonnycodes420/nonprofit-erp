// tests/reports6-schedule.test.js · REPORTS-6 item 1. A SCHEDULED REPORT GOES ONLY WHERE IT WAS SENT.
//
// The one new test of the build, and it guards donor data and email: a report
// leaves the building as a PDF, to people with no Steward login. So:
//   §1 a scheduled send goes ONLY to the addresses listed on THAT schedule in
//      THAT org: not another schedule's people, not another org's, and never an
//      address on file as a donor (refused when saved, held at send);
//   §2 the email carries no link that opens data without a login: its one link
//      is Unsubscribe, which renders a page naming the report, shows none of
//      the report, and writes nothing on GET or HEAD; the report is the PDF;
//   §3 it stops when the org's Staff mail switch is off (nothing reserved,
//      nothing sent) and goes again when it is on;
//   §4 an Unsubscribe stops that schedule for that one address, and a period
//      goes once.
// Planted and seen red (docs/history/REPORTS-6.md): the send mailing every
// schedule's people in the org; a link to the report in the email; the switch
// check taken out.
const bcrypt = require("bcryptjs");
const http = require("http");
const { ok, summary, login, api, q, closeDb, SINK_PORT, BASE } = require("./helpers");

// helpers.ok takes (name, cond); each check below reads as the claim it makes, condition first.
const check = (cond, name, extra) => ok(name, cond, extra);
const ORG = "org_rp6sched", ORG2 = "org_rp6sched2";
const PW = "loadtest1234";
const TABLES = ["report_schedule_unsubs", "report_schedule_sends", "report_schedules", "gifts", "donors", "users"];
async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

const mails = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    try { if (req.url === "/emails") mails.push(JSON.parse(b)); } catch { /* not a send */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const toOf = m => (Array.isArray(m.to) ? m.to : [m.to]).map(x => String(x).toLowerCase());
const sentTo = () => mails.flatMap(toOf).sort();
const run1 = (tok, body) => api("POST", "/report-schedules/run", tok, { force: true, hour: 9, ...body });
const counts = async () => {
  const [r] = await q(`SELECT (SELECT COUNT(*)::int FROM report_schedule_unsubs WHERE org_id=$1) AS u,
                                (SELECT COUNT(*)::int FROM report_schedule_sends WHERE org_id=$1) AS s,
                                (SELECT COUNT(*)::int FROM report_schedules WHERE org_id=$1) AS sc`, [ORG]);
  return r;
};

(async () => {
  console.log("reports6-schedule");
  await new Promise((r, j) => { sink.on("error", j); sink.listen(SINK_PORT, r); });
  await reset();
  const hash = bcrypt.hashSync(PW, 4);
  for (const [id, name, slug] of [[ORG, "Linden Street Library Friends", "rp6-sched"], [ORG2, "Another Shop", "rp6-sched2"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,created_at,emails_enabled,staff_mail_enabled,onboarded_at)
             VALUES ($1,$2,$3,1,'active','growth',NOW() - INTERVAL '900 days',true,true,NOW())`, [id, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Sched Admin','admin')`, ["u_" + id, id, `admin@${slug}.example.org`, hash]);
  }
  // A donor (never a recipient), a board member on file (may be one), and gifts so the report has rows.
  await q(`INSERT INTO donors (id,org_id,name,email,created_at) VALUES ('d_rp6s_1',$1,'Opal Whitcombe','opal@donor.example.org',NOW() - INTERVAL '800 days')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,person_types,created_at) VALUES ('d_rp6s_2',$1,'Board Chair','chair@linden.example.org','["staff_board"]'::jsonb,NOW() - INTERVAL '800 days')`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_rp6s_1',$1,'d_rp6s_1',4321.09,'2025-09-10','cash')`, [ORG]);
  const tok = await login("admin@rp6-sched.example.org");
  const tok2 = await login("admin@rp6-sched2.example.org");

  // §1 — refused when saved: an address on file as a donor.
  const refused = await api("POST", "/report-schedules", tok, { target: "report:std:lybunt", frequency: "weekly", day: 1, hour: 8, recipients: "treasurer@linden.example.org\nopal@donor.example.org" });
  check(refused.status === 400 && /on file as a donor/.test(refused.body.error || ""), "§1 a schedule naming a donor's address is refused when saved", JSON.stringify(refused.body));
  const s1 = await api("POST", "/report-schedules", tok, { target: "report:std:lybunt", frequency: "weekly", day: 1, hour: 8, recipients: "chair@linden.example.org, treasurer@linden.example.org" });
  check(s1.status === 201 && /^Next send: /.test(s1.body.nextSendSentence || ""), "§1 a schedule saves and states its next send", JSON.stringify(s1.body));
  const s2 = await api("POST", "/report-schedules", tok, { target: "report:std:lybunt", frequency: "monthly", day: 3, hour: 8, recipients: "other-committee@linden.example.org" });
  const sB = await api("POST", "/report-schedules", tok2, { target: "report:std:lybunt", frequency: "weekly", day: 1, hour: 8, recipients: "chair@another.example.org" });
  check(s2.status === 201 && sB.status === 201, "§1 a second schedule in the org, and one in another org");
  // A donor's address that reaches the list behind the screen's back is held at send.
  await q(`UPDATE report_schedules SET recipients = recipients || '["opal@donor.example.org"]'::jsonb WHERE id=$1`, [s1.body.id]);

  mails.length = 0;
  const r1 = await run1(tok, { scheduleId: s1.body.id, today: "2026-11-02" });
  check(r1.status === 200 && r1.body.sent === 2, "§1 the run sends to this schedule's two people", JSON.stringify(r1.body));
  check(JSON.stringify(sentTo()) === JSON.stringify(["chair@linden.example.org", "treasurer@linden.example.org"]),
    "§1 ONLY this schedule's people: not the other schedule's, not the other org's, not the donor", JSON.stringify(sentTo()));
  const [led] = await q(`SELECT sent_to, held FROM report_schedule_sends WHERE schedule_id=$1`, [s1.body.id]);
  check(led && led.sent_to.length === 2 && led.held.some(h => h.email === "opal@donor.example.org" && h.reason === "on file as a donor"),
    "§1 the send is logged with who it went to, and the donor held with the reason", JSON.stringify(led));
  const other = await api("GET", `/report-schedules/${s1.body.id}/preview.pdf`, tok2);
  check(other.status === 404, "§1 another org cannot open this schedule's PDF", String(other.status));

  // §2 — no link that opens data without a login; the report is the attachment.
  const m = mails[0] || {};
  const hrefs = [...String(m.html || "").matchAll(/href="([^"]+)"/g)].map(x => x[1]);
  check(hrefs.length >= 1 && hrefs.every(h => /\/unsubscribe\?token=[\w-]+\.[\w-]+$/.test(h)), "§2 the email's only link is its Unsubscribe", JSON.stringify(hrefs));
  check(!/report=|\/dashboard|\/app\/|\/reports|\/figures/.test(String(m.html || "")), "§2 no link or path in the email opens the report or any org data");
  const att = (m.attachments || [])[0];
  const pdf = att ? Buffer.from(att.content, "base64") : Buffer.alloc(0);
  check(pdf.slice(0, 5).toString() === "%PDF-" && /\.pdf$/.test(att.filename), "§2 the report arrives as a PDF attachment", att && att.filename);
  check(!/\/URI\s*\(/.test(pdf.toString("latin1")), "§2 the PDF carries no link out (no URI action)");
  const unsub = new URL(hrefs[0]);
  const before = await counts();
  const page = await fetch(`${BASE}${unsub.pathname}${unsub.search}`);
  const head = await fetch(`${BASE}${unsub.pathname}${unsub.search}`, { method: "HEAD" });
  const pageText = await page.text();
  check(page.status === 200 && head.status === 200 && /Stop getting/.test(pageText), "§2 Unsubscribe opens with no login and names what it stops");
  check(!/Opal|4,321|4321/.test(pageText), "§2 the Unsubscribe page shows none of the report's people or numbers");
  check(JSON.stringify(await counts()) === JSON.stringify(before), "§2 GET and HEAD on the link write nothing", JSON.stringify(await counts()));

  // §4 — a period goes once; an Unsubscribe stops that address on that schedule only.
  mails.length = 0;
  const again = await run1(tok, { scheduleId: s1.body.id, today: "2026-11-02" });
  check(again.body.sent === 0 && mails.length === 0, "§4 the same week does not go twice", JSON.stringify(again.body));
  const firstRun = r1.body.schedules[0];
  check(firstRun && firstRun.sentTo.length === 2, "§4 the first run named both people");
  // The link from the first email of the first run (each email carries its own address's token).
  const posted = await fetch(`${BASE}${unsub.pathname}${unsub.search}`, { method: "POST", headers: { Accept: "text/html" } });
  const who = JSON.parse(Buffer.from(unsub.searchParams.get("token").split(".")[0], "base64url").toString()).email;
  check(posted.status === 200 && (await counts()).u === 1, "§4 pressing Stop records one unsubscribe for that address", who);
  mails.length = 0;
  await run1(tok, { scheduleId: s1.body.id, today: "2026-11-09" });
  check(!sentTo().includes(who) && sentTo().length === 1, "§4 the next week goes to everyone else and not to the address that stopped it", JSON.stringify(sentTo()));

  // §3 — the Staff mail switch.
  await q(`UPDATE orgs SET staff_mail_enabled=false WHERE id=$1`, [ORG]);
  const sendsBefore = (await counts()).s;
  mails.length = 0;
  const off = await run1(tok, { scheduleId: s1.body.id, today: "2026-11-16" });
  check(off.body.sent === 0 && mails.length === 0, "§3 with Staff mail off nothing is sent", JSON.stringify(off.body));
  check((await counts()).s === sendsBefore, "§3 and nothing is reserved, so it goes once mail is on");
  const listOff = await api("GET", "/report-schedules?target=report:std:lybunt", tok);
  check(/Staff mail is off/.test(listOff.body.staffMailOff || ""), "§3 the schedule screen says Staff mail is off");
  await q(`UPDATE orgs SET staff_mail_enabled=true WHERE id=$1`, [ORG]);
  mails.length = 0;
  const on = await run1(tok, { scheduleId: s1.body.id, today: "2026-11-16" });
  check(on.body.sent === 1 && mails.length === 1, "§3 with Staff mail on again, the period goes", JSON.stringify(on.body));

  await reset();
  await closeDb();
  await new Promise(r => sink.close(r));
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} try { sink.close(); } catch {} process.exit(1); });
