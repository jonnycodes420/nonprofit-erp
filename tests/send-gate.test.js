// tests/send-gate.test.js · SEND-GATE-1. A DONOR GETS AUTOMATIC EMAIL ONLY IF
// THE ORG TURNED IT ON FOR THEM.
//
//   §1 the static guard: the mail provider is reached only through the gate.
//      No other Resend client, no raw send but the ops alert, no SMS client,
//      no direct provider HTTP, no Gmail or Outlook send, and every send
//      without an org tag is one of the named staff, sign-in or Jonathan
//      sends. The proxy hands every org's donor mail to sendToDonor.
//   §2 switch OFF: a journey step, a pledge reminder, a Stripe gift's receipt
//      and an Atlas follow-up make zero provider calls; each automatic one
//      leaves a held line on the profile (Atlas only drafts, never sends).
//   §3 switch ON: the same journey step, reminder and receipt send once each.
//   §4 the held line's Send sends that one message once (a double click is one).
//   §5 bulk: turning on N people changes exactly N switches and writes N audit
//      rows; a count that no longer matches is refused.
//   §6 a manual send (a draft she presses Send on) goes with the switch off,
//      and is refused with Donor mail off.
//   §7 an import (gifts, a pledge, event attendance) with a first-gift
//      sequence armed makes zero provider calls, zero staff notices, zero
//      switch changes and no enrolment; its undo sends nothing either.
//
// Against main it fails at §1 (sendGate.js does not exist; the receipt send
// carries no org tag) and §2 (every automatic send goes). Planted defects that
// turned it red: the proxy's sendToDonor branch removed (§2, §3, §4),
// perRecord dropped (§5), `fromImport` removed from recordGift (§7 enrolment).
// (`liveRead` ignored turns fix36-history's later-QuickBooks-read leg red.)
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")("sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, waitFor, civilToday } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const ORG = "org_sendgate", ACCT = "acct_sendgate";
const PW = "loadtest1234";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const sys = "'system:test','test'";

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        let j = {}; try { j = JSON.parse(body); } catch { /* not json */ }
        captured.push({ to: [].concat(j.to || [], j.cc || [], j.bcc || []).join(",").toLowerCase(), subject: j.subject || "" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.once("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}
const sentTo = addr => captured.filter(c => c.to.includes(addr)).length;
const settle = (ms = 1500) => new Promise(r => setTimeout(r, ms));

async function reset() {
  const tables = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name NOT IN ('orgs','fin_audit_log')`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

// ── §1 · the static guard ────────────────────────────────────────────────
// Every `emails.send(` with no org tag on it must sit inside one of these:
// staff sign-in and account mail, mail to Jonathan, Steward's own billing,
// and the ops alert. None of them goes to an org's donor.
const UNTAGGED_OK = new Set([
  "opsAlert", "/auth/forgot-password", "/auth/invite", "sendSigninLinkEmail", "notifyFounderOfSignup",
  "/lost-and-found/lead", "/demo-request", "/invitation-request", "/contact", "mailJonathan", "mailSupport",
  "sendCloseWelcomeEmail", "sendExistingOrgCloseEmail", "mailUser",
]);
function staticGuard() {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const files = require("child_process").execSync("git ls-files -- '*.js' ':!tests' ':!scripts' ':!client' ':!zapier' ':!node_modules'", { cwd: ROOT })
    .toString().trim().split("\n").filter(Boolean);
  const src = Object.fromEntries(files.map(f => [f, strip(fs.readFileSync(path.join(ROOT, f), "utf8"))]));
  ok("§1 the gate exists (sendGate.js exports sendToDonor)", fs.existsSync(path.join(ROOT, "sendGate.js")) && typeof require("../sendGate").sendToDonor === "function");
  const resendFiles = files.filter(f => /new Resend\(/.test(src[f])).sort().join();
  ok("§1 only server.js and routes/migc.js construct a Resend client", resendFiles === "routes/migc.js,server.js", resendFiles);
  const server = src["server.js"];
  ok("§1 the raw client sends once: the ops alert, to Jonathan", (server.match(/_rawResend\.emails\.send\(/g) || []).length === 1
    && /async function opsAlert[\s\S]{0,4000}_rawResend\.emails\.send\(/.test(server));
  const proxyAt = server.indexOf("const resend = new Proxy(_rawResend");
  const proxy = server.slice(proxyAt, proxyAt + 6000);
  ok("§1 the proxy hands every org's donor mail to sendToDonor before the provider",
    /orgId && category === mailPolicy\.CATEGORY\.DONOR\)[\s\S]{0,200}SEND_GATE\.sendToDonor\(opts, deliver\)/.test(proxy));
  ok("§1 the MiGulfCoast client sends only to its own fixed contact address",
    /const to = process\.env\.MIGC_CONTACT_EMAIL/.test(src["routes/migc.js"]) && !/FROM donors/.test(src["routes/migc.js"]));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) });
  const sms = deps.filter(d => /twilio|vonage|nexmo|plivo|messagebird|telnyx|sinch|@aws-sdk\/client-(sns|pinpoint)|nodemailer|@sendgrid|mailgun|postmark/i.test(d));
  ok("§1 no SMS client and no second mail client is installed", sms.length === 0, sms);
  const direct = files.filter(f => /fetch\([^)]*api\.resend\.com\/emails["'`]|users\.messages\.send|\/sendMail\b|\.sendMail\(/.test(src[f]));
  ok("§1 nothing posts to the provider's HTTP API, Gmail send or Outlook sendMail directly", direct.length === 0, direct);
  const loose = [];
  for (const f of files) {
    const s = src[f];
    let i = -1;
    while ((i = s.indexOf("emails.send(", i + 1)) !== -1) {
      if (f === "server.js" && i > proxyAt && i < proxyAt + 6000) continue;   // the proxy itself
      if (/_rawResend\.$/.test(s.slice(i - 11, i))) continue;
      const blk = s.slice(Math.max(0, i - 300), i + 700);
      if (/_stewardOrgId|donorSendOpts\(|\bopts\)|\.\.\.payload/.test(blk)) continue;
      const before = s.slice(0, i);
      const m = [...before.matchAll(/(?:async function (\w+)|app\.post\("([^"]+)"|router\.post\("([^"]+)")/g)].pop();
      const where = m ? (m[1] || m[2] || m[3]) : "?";
      if (!UNTAGGED_OK.has(where)) loose.push(`${f}: ${where}`);
    }
  }
  ok("§1 every send without an org tag is a named staff, sign-in, billing or Jonathan send", loose.length === 0, loose);
}

async function fireGift(evtId, piId, cents, email, name) {
  const payload = JSON.stringify({ id: evtId, type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: piId, amount_received: cents, receipt_email: email, metadata: { donor_name: name } } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const nyInstant = (day, hh) => {
  for (const off of [4, 5]) {
    const d = new Date(`${day}T${String(hh + off).padStart(2, "0")}:30:00Z`);
    if (Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d)) === hh) return d.toISOString();
  }
};
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = day => new Date(day + "T12:00:00Z").getUTCDay();
const nextWeekday = day => { let d = addDays(day, 1); while ([0, 6].includes(weekday(d))) d = addDays(d, 1); return d; };
const held = id => q(`SELECT kind, what, sent_at FROM mail_blocked WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, id]);

(async () => {
  console.log("send-gate (SEND-GATE-1)");
  staticGuard();

  const sink = await startSink();
  if (!sink) { ok(`the capturing sink bound :${SINK_PORT}`, false); await closeDb(); return summary(); }
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,timezone_confirmed_at,
             receipt_address,legal_name,ein,receipts_enabled,emails_enabled,stripe_account_id)
           VALUES ($1,'Send Gate Rowing','org-sendgate',1,NOW(),'active','team','America/New_York',NOW(),
             '12 Harbor Rd, Wilmington, NC 28401','Send Gate Rowing Inc','12-3456789',TRUE,TRUE,$2)`, [ORG, ACCT]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_sg',$1,'4010','Contributions','revenue',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_sg',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_sg_admin',$1,'sg-admin@sendgate.example',$2,'Dana Reyes','admin')`, [ORG, bcrypt.hashSync(PW, 4)]);
  const tok = await login("sg-admin@sendgate.example");
  ok("fixture: signed in", !!tok);
  const today = civilToday();
  const PEOPLE = { off: ["d_sg_off", "Olive Offley", "olive@sendgate.example"], on: ["d_sg_on", "Owen Onslow", "owen@sendgate.example"] };
  for (const [id, name, email] of Object.values(PEOPLE)) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,${sys})`, [id, ORG, name, email]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,100,$4,'cash',${sys})`, ["g_" + id, ORG, id, addDays(today, -365)]);
    await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,next_reminder_at,created_by,created_by_name) VALUES ($1,$2,$3,300,$4,'open',NOW() - INTERVAL '1 hour',${sys})`, ["pl_" + id, ORG, id, addDays(today, -10)]);
  }
  const OFF = PEOPLE.off[2], ON = PEOPLE.on[2];
  const born = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND auto_email = true`, [ORG]).catch(() => [{ n: -1 }]);
  ok("fixture: every person starts with automatic emails off", born[0].n === 0, born);

  // Turn ON for one person, through the profile's switch (and its confirm).
  const noConfirm = await api("POST", `/donors/${PEOPLE.on[0]}/auto-email`, tok, { on: true });
  ok("§3 turning it on needs the confirm", noConfirm.status === 400, noConfirm.body);
  const sw = await api("POST", `/donors/${PEOPLE.on[0]}/auto-email`, tok, { on: true, confirm: true });
  ok("§3 a person on staff turns it on", sw.status === 200 && sw.body.autoEmail === true, sw.body);

  // SEND-GATE-2: the three emails used here are on, for chosen donors only,
  // so Owen (Always include) gets them and Olive (Follows) is held.
  for (const key of ["journey_steps", "pledge_reminder", "gift_receipt"]) {
    const t = await api("POST", `/mail-types/${key}`, tok, { on: true, audience: "chosen", confirm: true });
    ok(`fixture: ${key} on for chosen donors`, t.status === 200, t.body);
  }

  // ── the journey step ─────────────────────────────────────────────────────
  const mk = await api("POST", "/email-templates", tok, { starterKey: "first_gift_welcome" });
  const TID = mk.body && mk.body.template && mk.body.template.id;
  await api("PUT", `/email-templates/${TID}`, tok, { subject: "Thank you, {{first_name}}", publish: true });
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,trigger_key,created_by,created_by_name) VALUES ('ct_sg',$1,'One email',$2::jsonb,'by_hand',${sys})`,
    [ORG, JSON.stringify([{ type: "send", label: "Send the welcome", offsetDays: 0, draft: `template:${TID}` }])]);
  const turned = await api("POST", "/journeys/ct_sg/steps/0/auto", tok, { on: true, confirm: true });
  await api("POST", "/journeys/ct_sg/apply", tok, { donorIds: [PEOPLE.off[0], PEOPLE.on[0]] });
  const sendDay = nextWeekday(today);
  const jr = await api("POST", "/journey-sends/run", tok, { now: nyInstant(sendDay, 9) });
  ok("fixture: the journey step is on and ran", turned.status === 200 && jr.status === 200, { t: turned.body, r: jr.body });

  // ── the pledge reminder ──────────────────────────────────────────────────
  await api("POST", "/pledges/process-reminders", tok, {});
  // ── the receipt for an online gift (Stripe) ──────────────────────────────
  await fireGift("evt_sg_off", "pi_sg_off", 50000, OFF, PEOPLE.off[1]);
  await fireGift("evt_sg_on", "pi_sg_on", 50000, ON, PEOPLE.on[1]);
  // ── an Atlas follow-up ───────────────────────────────────────────────────
  const atlas = await api("POST", "/atlas", tok, { text: `Email ${PEOPLE.off[1]} a thank-you now` });
  await settle(2500);

  console.log("\n§2 switch off");
  ok("§2 Olive (off) got nothing: no journey step, reminder, receipt or Atlas email", sentTo(OFF) === 0, captured);
  const hOff = await held(PEOPLE.off[0]);
  const kinds = new Set(hOff.map(h => h.kind));
  ok("§2 the journey step is a held line on her profile", kinds.has("sequence"), hOff);
  ok("§2 the pledge reminder is a held line", kinds.has("pledge_reminder"), hOff);
  ok("§2 the receipt is a held line that names it", hOff.some(h => h.kind === "receipt" && /^Receipt for \$500/.test(h.what)), hOff);
  ok("§2 Atlas wrote no send and turned nothing on", atlas.status < 500 && (await q(`SELECT auto_email FROM donors WHERE id=$1`, [PEOPLE.off[0]]))[0].auto_email === false, atlas.body);
  const jsOff = await q(`SELECT status FROM journey_sends WHERE org_id=$1 AND donor_id=$2`, [ORG, PEOPLE.off[0]]);
  ok("§2 the scheduled journey row is kept, not deleted", jsOff.length === 1, jsOff);
  const pOff = await q(`SELECT next_reminder_at, reminder_error FROM pledges WHERE id=$1`, ["pl_" + PEOPLE.off[0]]);
  ok("§2 the reminder is not queued to try again", pOff[0].next_reminder_at === null, pOff);
  const api1 = await api("GET", `/donors/${PEOPLE.off[0]}/blocked-mail`, tok);
  ok("§2 the profile reads the switch and the held lines", api1.status === 200 && api1.body.autoEmail === false && api1.body.blocked.length === hOff.length, api1.body);

  console.log("\n§3 switch on");
  ok("§3 Owen (on) got the journey step once", captured.filter(c => c.to.includes(ON) && /Thank you, Owen/.test(c.subject)).length === 1, captured);
  ok("§3 Owen got the pledge reminder once", captured.filter(c => c.to.includes(ON) && /pledge/i.test(c.subject)).length === 1, captured);
  ok("§3 Owen got the receipt once", captured.filter(c => c.to.includes(ON) && /receipt/i.test(c.subject)).length === 1, captured);
  ok("§3 nothing of Owen's was held", (await held(PEOPLE.on[0])).length === 0);

  console.log("\n§4 Send on a held line");
  const r0 = hOff.find(h => h.kind === "receipt");
  const [row] = await q(`SELECT id FROM mail_blocked WHERE org_id=$1 AND donor_id=$2 AND kind='receipt'`, [ORG, PEOPLE.off[0]]);
  const before = captured.length;
  const [s1, s2] = await Promise.all([
    api("POST", `/donors/${PEOPLE.off[0]}/blocked-mail/${row && row.id}/send`, tok, { confirm: true }),
    api("POST", `/donors/${PEOPLE.off[0]}/blocked-mail/${row && row.id}/send`, tok, { confirm: true }),
  ]);
  await settle(800);
  ok("§4 a double click sends the held receipt exactly once", !!r0 && [s1.status, s2.status].sort().join() === "200,409" && captured.length - before === 1 && sentTo(OFF) === 1, { s1: s1.body, s2: s2.body, n: captured.length - before });
  ok("§4 the switch is still off", (await q(`SELECT auto_email FROM donors WHERE id=$1`, [PEOPLE.off[0]]))[0].auto_email === false);

  console.log("\n§5 bulk");
  const BULK = [];
  for (let i = 0; i < 7; i++) {
    const id = `d_sg_b${i}`; BULK.push(id);
    await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active',${sys})`, [id, ORG, `Bulk Person ${i}`, `b${i}@sendgate.example`]);
  }
  const ids = [...BULK, PEOPLE.on[0]];   // Owen is already on: not a change
  const pv = await api("POST", "/donors/auto-email/bulk", tok, { ids, on: true });
  ok("§5 the first click says the exact count and changes nothing", pv.status === 200 && pv.body.count === 7
    && (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE id = ANY($1) AND auto_email`, [BULK]))[0].n === 0, pv.body);
  const wrong = await api("POST", "/donors/auto-email/bulk", tok, { ids, on: true, confirm: true, count: 9 });
  ok("§5 a count that is not the selection's is refused", wrong.status === 409, wrong.body);
  const auditBefore = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND action LIKE 'set automatic emails to always include%'`, [ORG]))[0].n;
  const go = await api("POST", "/donors/auto-email/bulk", tok, { ids, on: true, confirm: true, count: 7 });
  const nowOn = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND auto_email`, [ORG]))[0].n;
  ok("§5 the second click turns on exactly 7", go.status === 200 && go.body.changed === 7 && nowOn === 8, { b: go.body, nowOn });
  const aud = await waitFor(async () => {
    const r = await q(`SELECT entity_id FROM fin_audit_log WHERE org_id=$1 AND action LIKE 'set automatic emails to always include%'`, [ORG]);
    return r.length - auditBefore >= 7 ? r : null;
  }, { timeout: 5000 }) || [];
  const audIds = new Set(aud.map(a => a.entity_id));
  ok("§5 and writes 7 audit rows, one per person", aud.length - auditBefore === 7 && BULK.every(id => audIds.has(id)), { n: aud.length - auditBefore });

  console.log("\n§6 a manual send");
  await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,created_by,created_by_name)
           VALUES ('md_sg1',$1,$2,'sg:1','A note from Dana','Thank you for rowing with us.','pending_review',${sys})`, [ORG, PEOPLE.off[0]]).catch(e => console.error(e.message));
  const man = await api("POST", "/milestone-drafts/md_sg1/send", tok, {});
  await settle(600);
  ok("§6 a draft she presses Send on goes with the switch off", man.status === 200 && captured.some(c => c.to.includes(OFF) && c.subject === "A note from Dana"), man.body);
  await q(`UPDATE orgs SET emails_enabled=false WHERE id=$1`, [ORG]);
  await settle(5200);   // the org gate's 5s cache
  await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,created_by,created_by_name)
           VALUES ('md_sg2',$1,$2,'sg:2','A second note','Still thank you.','pending_review',${sys})`, [ORG, PEOPLE.off[0]]).catch(() => {});
  const refused = await api("POST", "/milestone-drafts/md_sg2/send", tok, {});
  ok("§6 with Donor mail off, a manual send is refused", refused.status >= 400 && !captured.some(c => c.subject === "A second note"), refused.body);
  await q(`UPDATE orgs SET emails_enabled=true WHERE id=$1`, [ORG]);
  await settle(5200);

  console.log("\n§7 an import");
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,tracks) VALUES ('seq_sg',$1,'Welcome','first_gift','active',$2::jsonb)`,
    [ORG, JSON.stringify([{ key: "all", label: "Everyone else", rule: "everyone_else" }])]);
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body,track_key) VALUES ('sst_sg','seq_sg',0,0,'Welcome','Hi','all')`);
  const grid = [["First", "Last", "Email", "Amount", "Method", "Completed", "3 Yr Total", "Attended"],
    ["Ivy", "Imported", "ivy@sendgate.example", "500", "Check", "Yes", "", "Yes"],
    ["Ian", "Imported", "ian@sendgate.example", "1000", "Pledge", "No", "3000", "Yes"],
    ["Isa", "Imported", "isa@sendgate.example", "250", "Cash", "Yes", "", "Yes"]];
  const body = { fileName: "Harvest Supper Gifts.xlsx", sheets: [{ name: "Sheet1", grid }] };
  const answers = { date: today, eventName: "Harvest Supper", linkEvent: true };
  const sentBefore = captured.length;
  const onBefore = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND auto_email`, [ORG]))[0].n;
  const c1 = await api("POST", "/sheet-import/commit", tok, { ...body, answers, importId: "imp_sendgate_1" });
  await api("POST", "/pledges/process-reminders", tok, {});
  await settle(2500);
  const landed = (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND import_id='imp_sendgate_1')::int AS g,
                                  (SELECT COUNT(*) FROM pledges WHERE org_id=$1 AND import_id='imp_sendgate_1')::int AS p,
                                  (SELECT COUNT(*) FROM event_attendees WHERE org_id=$1)::int AS a`, [ORG]))[0];
  ok("fixture: the import wrote gifts, a pledge and attendance", c1.status === 201 && landed.g >= 2 && landed.p >= 1 && landed.a >= 1, { s: c1.status, landed, b: c1.status !== 201 && c1.body });
  ok("§7 the import made zero provider calls", captured.length === sentBefore, captured.slice(sentBefore));
  const notices = (await q(`SELECT COUNT(*)::int AS n FROM notification_sends WHERE org_id=$1`, [ORG]).catch(() => [{ n: 0 }]))[0].n;
  ok("§7 zero staff notifications", notices === 0, notices);
  ok("§7 zero switch changes", (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND auto_email`, [ORG]))[0].n === onBefore);
  const enr = (await q(`SELECT COUNT(*)::int AS n FROM sequence_enrollments WHERE org_id=$1`, [ORG]))[0].n;
  ok("§7 an imported first gift starts no sequence", enr === 0, enr);
  const un = await api("POST", "/imports/imp_sendgate_1/reverse", tok, {});
  await settle(1500);
  ok("§7 undo answers and sends nothing", un.status === 200 && captured.length === sentBefore, { s: un.status, b: un.body });

  await reset();
  sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
