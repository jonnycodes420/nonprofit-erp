// tests/send-gate-2.test.js · SEND-GATE-2. NOTHING SENDS TO A DONOR ON ITS
// OWN WITHOUT JONATHAN'S SWITCH (Donor mail) AND THE DIRECTOR'S (the email).
//
//   §1 static: every donor send path names a kind in mailTypes.js (an email
//      type, the exempt sign-in link, or mail a person sends by hand), and
//      every type is sent by some path; nothing but the switch handler in
//      routes/mailTypes.js writes org_mail_types, and it asks for the confirm
//      first; the SEND-GATE-1 proxy hand-off is still there.
//   §2 every type off: a Stripe gift, a pledge reminder, a journey step, an
//      event ticket and a campaign make zero provider calls, even for people
//      set to Always include. The top bar reads "Automatic email: Off".
//   §3 the switch: on needs who gets it and a confirm, only an admin changes
//      it, a super-admin never turns one on, each change is one audit row. The
//      event editor's switch and Settings' are the same switch.
//   §4 receipts on, Everyone: a gift sends one receipt; a Never donor gets
//      none (held, and the profile says why); Donor mail off sends none, and
//      the top bar then reads "Waiting for Steward to turn email on".
//   §5 pledge reminders on, Only donors I choose: only Always include gets one.
//   §6 Going out: "next 7 days" lists exactly the emails that send when the
//      clock moves 7 days, and "Sent" shows each with exactly what went.
//   §7 an import with gifts and pledges sends nothing with every type on.
//   §8 super-admin: the org's emails, read-only, and what Donor mail starts.
//
// Against main it fails at §1 (mailTypes.js does not exist) and at every
// /mail-types call. Planted defects that turned it red: the type check in
// sendGate.decide removed (§2, §5), the confirm check in the switch handler
// removed (§3), a second INSERT INTO org_mail_types in server.js (§1), the
// pledge cadence in goingOut.js cut to one reminder (§6).
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")("sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, civilToday, mailTypesOn } = require("./helpers");
const TYPES = require("../mailTypes");

const ROOT = path.join(__dirname, "..");
const ORG = "org_sendgate2", ACCT = "acct_sendgate2";
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
        captured.push({ to: [].concat(j.to || [], j.cc || [], j.bcc || []).join(",").toLowerCase(), subject: j.subject || "", html: j.html || "" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.once("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}
const sentTo = addr => captured.filter(c => c.to.includes(addr));
const settle = (ms = 1500) => new Promise(r => setTimeout(r, ms));
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = day => new Date(day + "T12:00:00Z").getUTCDay();
const nyInstant = (day, hh) => {
  for (const off of [4, 5]) {
    const d = new Date(`${day}T${String(hh + off).padStart(2, "0")}:30:00Z`);
    if (Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d)) === hh) return d.toISOString();
  }
};

async function reset() {
  const tables = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name NOT IN ('orgs','fin_audit_log')`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM users WHERE email LIKE '%@sendgate2.example'`).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
async function fire(evtId, piId, cents, email, name, metadata = {}) {
  const payload = JSON.stringify({ id: evtId, type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: piId, amount_received: cents, receipt_email: email, metadata: { donor_name: name, ...metadata } } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const mailOff = async on => { await q(`UPDATE orgs SET emails_enabled=$2 WHERE id=$1`, [ORG, on]); await settle(5200); };   // the org gate's 5s cache

// ── §1 · static ──────────────────────────────────────────────────────────
function staticChecks() {
  // Comments out, gently: a "/*" or "//" inside a string (a glob, a URL) must
  // not swallow the code after it, so only a comment that starts a line or
  // follows a space, with a space after it, is a comment here.
  const strip = s => s.replace(/(^|[ \t])\/\*[\s*][\s\S]*?\*\//g, "$1").replace(/(^|[ \t])\/\/[ \t].*$/gm, "$1");
  const files = require("child_process").execSync("git ls-files -- '*.js' ':!tests' ':!client' ':!zapier' ':!node_modules'", { cwd: ROOT })
    .toString().trim().split("\n").filter(Boolean).filter(f => fs.existsSync(path.join(ROOT, f)));
  const src = Object.fromEntries(files.map(f => [f, strip(fs.readFileSync(path.join(ROOT, f), "utf8"))]));
  const mailPolicy = require("../mailPolicy");
  const used = new Map();   // kind -> first place
  const note = (k, where) => { if (mailPolicy.categoryOf(k) === "donor" && !used.has(k)) used.set(k, where); };
  // Consumer-account mail (the giving network), sent with no org: not org donor mail.
  const NO_ORG = new Set(["magic_link", "signup_existing", "verify", "signin_link", "reset", "email_change", "alias", "admin_delist"]);
  const loose = [];
  for (const f of files.filter(f => !f.startsWith("scripts/"))) {
    const s = src[f];
    for (const m of s.matchAll(/_stewardKind:\s*([^,}\n]+)/g)) for (const lit of m[1].matchAll(/"(\w+)"/g)) note(lit[1], f);
    for (const m of s.matchAll(/donorSendOpts\([^)]*?,\s*"(\w+)"\s*\)/g)) note(m[1], f);
    for (const m of s.matchAll(/sendStaffWrittenEmail\([^;]*?"(\w+)"\s*\)/g)) note(m[1], f);
    for (const m of s.matchAll(/sendDonorLifecycleEmail\("(\w+)"([\s\S]*?)\);/g)) {
      // The sixth argument is the org; count top-level commas to find it.
      let depth = 0, args = 1;
      for (const ch of m[2]) { if ("([{".includes(ch)) depth++; else if (")]}".includes(ch)) depth--; else if (ch === "," && depth === 0) args++; }
      if (NO_ORG.has(m[1])) { if (args >= 6) loose.push(`${f}: ${m[1]} is sent with an org but listed as consumer mail`); }
      else note(m[1], f);
    }
  }
  const unknown = [...used.keys()].filter(k => !TYPES.isKnownKind(k));
  ok("§1 every donor send path names a kind mailTypes.js knows (an email, the exempt sign-in link, or by hand)", unknown.length === 0 && loose.length === 0,
    { unknown: unknown.map(k => `${k} (${used.get(k)})`), loose });
  const unsent = TYPES.TYPES.filter(t => !t.kinds.some(k => used.has(k))).map(t => t.key);
  ok("§1 every email on the page is sent by some path (the page can't list one that never goes)", unsent.length === 0, unsent);
  ok("§1 the sign-in link the donor asked for is the one exempt kind", Object.keys(TYPES.EXEMPT).join() === "express_link" && used.has("express_link"));
  // The one write.
  const writers = files.filter(f => /(INSERT\s+INTO|UPDATE)\s+org_mail_types\b/i.test(src[f]));
  ok("§1 only routes/mailTypes.js writes an email's switch", writers.join() === "routes/mailTypes.js", writers);
  const r = src["routes/mailTypes.js"] || "";
  const writes = [...r.matchAll(/(INSERT\s+INTO|UPDATE)\s+org_mail_types\b/gi)].map(m => m.index);
  const handler = r.indexOf('app.post("/mail-types/:key"');
  const confirmAt = r.indexOf("body.confirm !== true", handler);
  const nextRoute = r.indexOf("app.", handler + 10);
  ok("§1 …once, inside the switch handler, after it asks for the confirm", writes.length === 1 && handler > 0 && confirmAt > handler
    && writes[0] > confirmAt && writes[0] < nextRoute, { writes, handler, confirmAt, nextRoute });
  const plant = s => /(INSERT\s+INTO|UPDATE)\s+org_mail_types\b/i.test(s);
  ok("§1 the guard is able to fail (a planted write is caught)", plant("await run(`UPDATE org_mail_types SET is_on = true`)") && plant("INSERT INTO org_mail_types (org_id) VALUES (1)"));
  const server = src["server.js"];
  ok("§1 the proxy still hands every org's donor mail to sendToDonor", /orgId && category === mailPolicy\.CATEGORY\.DONOR\)[\s\S]{0,200}SEND_GATE\.sendToDonor\(opts, deliver\)/.test(server));
}

(async () => {
  console.log("send-gate-2 (SEND-GATE-2)");
  staticChecks();
  const sink = await startSink();
  if (!sink) { ok(`the capturing sink bound :${SINK_PORT}`, false); await closeDb(); return summary(); }
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,timezone_confirmed_at,
             receipt_address,legal_name,ein,receipts_enabled,emails_enabled,stripe_account_id)
           VALUES ($1,'Send Gate Two Choir','org-sendgate2',1,NOW(),'active','team','America/New_York',NOW(),
             '14 Harbor Rd, Wilmington, NC 28401','Send Gate Two Choir Inc','12-3456780',TRUE,TRUE,$2)`, [ORG, ACCT]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_sg2',$1,'4010','Contributions','revenue',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_sg2',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_sg2_admin',$1,'admin@sendgate2.example',$2,'Rosa Admin','admin'),
             ('u_sg2_staff',$1,'staff@sendgate2.example',$2,'Sam Staff','staff')`, [ORG, bcrypt.hashSync(PW, 4)]);
  const tok = await login("admin@sendgate2.example");
  const staffTok = await login("staff@sendgate2.example");
  ok("fixture: signed in", !!tok && !!staffTok);
  const today = civilToday();
  // Five people: Fern follows, Abe always, Nina never, plus two for receipts.
  const P = {
    fern: ["d_sg2_fern", "Fern Follows", "fern@sendgate2.example", "follows"],
    abe: ["d_sg2_abe", "Abe Always", "abe@sendgate2.example", "always"],
    nina: ["d_sg2_nina", "Nina Never", "nina@sendgate2.example", "never"],
  };
  for (const [id, name, email, mode] of Object.values(P)) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,auto_email,auto_email_never,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,$6,${sys})`, [id, ORG, name, email, mode === "always", mode === "never"]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,100,$4,'cash',${sys})`, ["g_" + id, ORG, id, addDays(today, -365)]);
  }
  const st0 = await api("GET", "/mail-types/status", tok);
  ok("§2 the top bar reads 'Automatic email: Off' when nothing is on", st0.status === 200 && st0.body.state === "off" && st0.body.chip === "Automatic email: Off", st0.body);
  const page0 = await api("GET", "/mail-types", staffTok);
  const allTypes = page0.body && page0.body.groups ? page0.body.groups.flatMap(g => g.types) : [];
  ok("§2 every email starts Off (nobody has turned it on yet), and staff can read the page", page0.status === 200 && allTypes.length === TYPES.TYPES.length
    && allTypes.every(t => t.on === false && t.since === "Off. Nobody has turned it on yet") && page0.body.canChange === false, page0.body);
  ok("§2 the page lists the sign-in link as always sent, because the donor asked", (page0.body.always || []).some(a => /asked for it/.test(a.sentence)));

  // ── §2 every type off ───────────────────────────────────────────────────
  const mk = await api("POST", "/email-templates", tok, { starterKey: "first_gift_welcome" });
  const TID = mk.body && mk.body.template && mk.body.template.id;
  await api("PUT", `/email-templates/${TID}`, tok, { subject: "Welcome, {{first_name}}", publish: true });
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,trigger_key,created_by,created_by_name) VALUES ('ct_sg2',$1,'One email',$2::jsonb,'by_hand',${sys})`,
    [ORG, JSON.stringify([{ type: "send", label: "Send the welcome", offsetDays: 0, draft: `template:${TID}` }])]);
  const turned = await api("POST", "/journeys/ct_sg2/steps/0/auto", tok, { on: true, confirm: true });
  const applied = await api("POST", "/journeys/ct_sg2/apply", tok, { donorIds: [P.fern[0], P.abe[0], P.nina[0]] });
  ok("fixture: a journey with an automatic step, applied to three people", turned.status === 200 && applied.status < 300, { t: turned.body, a: applied.body });
  // Every journey send is due in 3 days (the Going-out check moves them).
  await q(`UPDATE journey_sends SET send_on=$2 WHERE org_id=$1`, [ORG, addDays(today, 3)]);
  // A pledge for Abe, overdue: one reminder runs now.
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,next_reminder_at,created_by,created_by_name) VALUES ('pl_sg2_off',$1,$2,300,$3,'open',NOW() - INTERVAL '1 hour',${sys})`, [ORG, P.abe[0], addDays(today, -10)]);
  await api("POST", "/pledges/process-reminders", tok, {});
  // A journey run on a day that is due (moved forward, then put back).
  await q(`UPDATE journey_sends SET send_on=$2 WHERE org_id=$1`, [ORG, addDays(today, -1)]);
  let runDay = today; while ([0, 6].includes(weekday(runDay))) runDay = addDays(runDay, 1);
  await api("POST", "/journey-sends/run", tok, { now: nyInstant(runDay, 9) });
  await q(`UPDATE journey_sends SET send_on=$2, status='scheduled', attempts=0 WHERE org_id=$1 AND status <> 'sent'`, [ORG, addDays(today, 3)]);
  // An online gift from Abe, and an event ticket for Abe.
  await fire("evt_sg2_gift0", "pi_sg2_gift0", 5000, P.abe[2], P.abe[1]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug,location,created_by,created_by_name)
           VALUES ('ev_sg2',$1,'Winter Concert','other', CURRENT_DATE + 30, 'upcoming', 'sg2-winter', 'The hall', ${sys})`, [ORG]);
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,capacity,position,created_by,created_by_name)
           VALUES ('el_sg2',$1,'ev_sg2','ticket','Adult',20,5,50,0,${sys})`, [ORG]);
  await fire("evt_sg2_ticket", "pi_sg2_ticket", 2000, P.abe[2], P.abe[1], { event_level_id: "el_sg2", event_qty: "1" });
  // A campaign to all three.
  const camp = await api("POST", "/campaigns", tok, { name: "Spring note", subject: "Spring at the choir", body: "Hi {{first_name}}", segment: { mode: "manual", donorIds: [P.fern[0], P.abe[0], P.nina[0]] }, status: "draft" });
  const campId = camp.body && (camp.body.id || (camp.body.campaign && camp.body.campaign.id));
  const cs = await api("POST", `/campaigns/${campId}/send`, tok, {});
  await settle(2500);
  const regs = (await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=$1`, [ORG]))[0].n;
  const gifts = (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND stripe_payment_id LIKE 'pi_sg2_%'`, [ORG]).catch(() => [{ n: -1 }]))[0].n;
  ok("fixture: the gift and the ticket landed, the campaign was pressed", gifts === 2 && regs >= 1 && !!campId, { gifts, regs, camp: camp.body, cs: cs.body });
  ok("§2 every type off: zero provider calls for a gift, a pledge reminder, a journey step, a ticket and a campaign", captured.length === 0, captured.map(c => c.subject));
  const heldKinds = new Set((await q(`SELECT kind, held_reason FROM mail_blocked WHERE org_id=$1`, [ORG])).map(r => r.kind + ":" + r.held_reason));
  ok("§2 each one is held with why (the email is off)", ["receipt", "pledge_reminder", "sequence", "event_ticket", "campaign"].every(k => heldKinds.has(k + ":type_off")), [...heldKinds]);

  // ── §3 the switch ───────────────────────────────────────────────────────
  const noWho = await api("POST", "/mail-types/gift_receipt", tok, { on: true, confirm: true });
  const noConfirm = await api("POST", "/mail-types/gift_receipt", tok, { on: true, audience: "everyone" });
  ok("§3 turning one on asks who gets it, then asks to confirm in words", noWho.status === 400 && noConfirm.status === 400
    && noConfirm.body.error === "confirm_required" && noConfirm.body.sentence === "Every online gift from now on will get a receipt by email.", { noWho: noWho.body, noConfirm: noConfirm.body });
  const asStaff = await api("POST", "/mail-types/gift_receipt", staffTok, { on: true, audience: "everyone", confirm: true });
  ok("§3 only an admin can change it", asStaff.status === 403, asStaff.body);
  const auditN = async () => (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND (action LIKE 'turned on %' OR action LIKE 'turned off %')`, [ORG]))[0].n;
  const a0 = await auditN();
  const on1 = await api("POST", "/mail-types/event_ticket", tok, { on: true, audience: "everyone", confirm: true, from: "event_editor" });
  const settings1 = await api("GET", "/mail-types", tok);
  const et = s => s.body.groups.flatMap(g => g.types).find(t => t.key === "event_ticket");
  ok("§3 the event editor's switch is the Settings switch: flipped there, Settings shows it on, by whom",
    on1.status === 200 && et(settings1).on === true && /^On since .* by (Rosa Admin|admin@sendgate2\.example)$/.test(et(settings1).since) && et(settings1).whoGetsIt === "Everyone, from now on", et(settings1));
  const off1 = await api("POST", "/mail-types/event_ticket", tok, { on: false });
  const ed1 = await api("GET", "/mail-types", tok);
  ok("§3 …and turned off in Settings (one click, no confirm), the editor reads it off", off1.status === 200 && et(ed1).on === false && /^Off since /.test(et(ed1).since), et(ed1));
  await settle(800);
  ok("§3 one audit row for each change", (await auditN()) - a0 === 2, (await auditN()) - a0);

  // ── §4 receipts on, Everyone ────────────────────────────────────────────
  const rOn = await api("POST", "/mail-types/gift_receipt", tok, { on: true, audience: "everyone", confirm: true });
  ok("fixture: receipts on, for everyone", rOn.status === 200, rOn.body);
  await fire("evt_sg2_fern", "pi_sg2_fern", 7500, P.fern[2], P.fern[1]);
  await fire("evt_sg2_nina", "pi_sg2_nina", 7500, P.nina[2], P.nina[1]);
  await settle(2500);
  ok("§4 a gift sends exactly one receipt", sentTo(P.fern[2]).filter(c => /receipt/i.test(c.subject)).length === 1, captured.map(c => c.to + " " + c.subject));
  ok("§4 a donor set to Never gets none", sentTo(P.nina[2]).length === 0);
  const ninaHeld = await api("GET", `/donors/${P.nina[0]}/blocked-mail`, tok);
  ok("§4 her profile says why: set to Never, with Send kept", ninaHeld.status === 200 && ninaHeld.body.mode === "never"
    && ninaHeld.body.blocked.some(b => b.kind === "receipt" && b.why === "this person is set to Never") && /never/.test(ninaHeld.body.line), ninaHeld.body);
  const fernLine = await api("GET", `/donors/${P.fern[0]}/blocked-mail`, tok);
  ok("§4 the profile line reads 'follows your settings · receipts is on'", /^Automatic emails: follows your settings · receipts is on$/.test(fernLine.body.line), fernLine.body.line);
  const st1 = await api("GET", "/mail-types/status", tok);
  ok("§4 the top bar reads 'Automatic email: 1 on' and Home names it", st1.body.state === "on" && st1.body.chip === "Automatic email: 1 on" && st1.body.home === "Steward is sending receipts for you.", st1.body);
  await mailOff(false);
  const before4 = captured.length;
  await fire("evt_sg2_fern2", "pi_sg2_fern2", 2500, P.fern[2], P.fern[1]);
  await settle(2000);
  ok("§4 with Donor mail off, a gift sends no receipt", captured.length === before4);
  const fernOff = await q(`SELECT held_reason FROM mail_blocked WHERE org_id=$1 AND donor_id=$2 AND kind='receipt' AND sent_at IS NULL`, [ORG, P.fern[0]]);
  ok("§4 …and it is held because email is off for the organization", fernOff.some(r => r.held_reason === "org_mail_off"), fernOff);
  const st2 = await api("GET", "/mail-types/status", tok);
  ok("§4 the top bar reads 'Waiting for Steward to turn email on'", st2.body.state === "waiting" && st2.body.chip === "Waiting for Steward to turn email on", st2.body);
  const pageW = await api("GET", "/mail-types", tok);
  ok("§4 the page says email is off at the top", pageW.body.mailOn === false && /^Email is off for your organization, so nothing on this page sends yet\./.test(pageW.body.top || ""), pageW.body.top);
  await mailOff(true);
  await api("POST", "/mail-types/gift_receipt", tok, { on: false });

  // ── §5 pledge reminders on, Only donors I choose ───────────────────────
  await q(`UPDATE pledges SET status='written_off' WHERE org_id=$1`, [ORG]);
  for (const k of ["fern", "abe", "nina"]) {
    await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,next_reminder_at,created_by,created_by_name) VALUES ($1,$2,$3,200,$4,'open',NOW() - INTERVAL '1 hour',${sys})`, ["pl_sg2_" + k, ORG, P[k][0], addDays(today, -5)]);
  }
  const pOn = await api("POST", "/mail-types/pledge_reminder", tok, { on: true, audience: "chosen", confirm: true });
  const before5 = captured.length;
  await api("POST", "/pledges/process-reminders", tok, {});
  await settle(1500);
  const got5 = captured.slice(before5).filter(c => /pledge/i.test(c.subject)).map(c => c.to);
  ok("§5 pledge reminders for chosen donors: only Abe (Always include) gets one", pOn.status === 200 && got5.length === 1 && got5[0].includes(P.abe[2]), got5);
  await api("POST", "/mail-types/pledge_reminder", tok, { on: false });

  // ── §6 Going out: before and after ──────────────────────────────────────
  await q(`UPDATE pledges SET status='written_off' WHERE org_id=$1`, [ORG]);
  // Abe: the last of four reminders, due in 2 days. Fern: the same, but
  // pledges go to chosen donors only. Abe's second pledge: next one in 10 days.
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,first_overdue_at,reminder_step,next_reminder_at,created_by,created_by_name) VALUES
           ('pl_sg2_g1',$1,$2,400,$4,'open',NOW() - INTERVAL '12 days',3,NOW() + INTERVAL '2 days',${sys}),
           ('pl_sg2_g2',$1,$3,400,$4,'open',NOW() - INTERVAL '12 days',3,NOW() + INTERVAL '2 days',${sys}),
           ('pl_sg2_g3',$1,$2,150,$4,'open',NOW() - INTERVAL '4 days',3,NOW() + INTERVAL '10 days',${sys})`, [ORG, P.abe[0], P.fern[0], addDays(today, -13)]);
  // Two people who have not given lately, on the journey: Gus follows, Hal is Never.
  // (Fern and Abe gave this week, so the runner would skip their steps; Going
  // out asks the runner's own rule and leaves them out too.)
  for (const [id, name, never] of [["d_sg2_gus", "Gus Follows", false], ["d_sg2_hal", "Hal Never", true]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,auto_email_never,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,${sys})`, [id, ORG, name, id.slice(7) + "@sendgate2.example", never]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,100,$4,'cash',${sys})`, ["g_" + id, ORG, id, addDays(today, -365)]);
  }
  await api("POST", "/journeys/ct_sg2/apply", tok, { donorIds: ["d_sg2_gus", "d_sg2_hal"] });
  await q(`UPDATE journey_sends SET send_on=$2, status='scheduled', attempts=0 WHERE org_id=$1 AND status <> 'sent'`, [ORG, addDays(today, 3)]);
  await api("POST", "/mail-types/journey_steps", tok, { on: true, audience: "everyone", confirm: true });
  await api("POST", "/mail-types/pledge_reminder", tok, { on: true, audience: "chosen", confirm: true });
  const go = await api("GET", "/going-out", tok);
  const planned = (go.body.next.groups || []).flatMap(g => g.people.map(p => g.typeKey + ":" + p.donorId)).sort();
  const expectPlanned = ["journey_steps:d_sg2_gus", "pledge_reminder:" + P.abe[0]].sort();
  ok("§6 next 7 days: Gus's journey step and Abe's pledge reminder; not Hal or Nina (Never), not Fern or Abe's steps (they just gave), not Fern's pledge (chosen only), not the one in 10 days",
    go.status === 200 && JSON.stringify(planned) === JSON.stringify(expectPlanned), { planned, groups: go.body.next && go.body.next.groups });
  // The clock moves 7 days: every due date comes 7 days closer, the sweeps run.
  await q(`UPDATE journey_sends SET send_on = (send_on::date - 7)::text WHERE org_id=$1 AND status='scheduled'`, [ORG]);
  await q(`UPDATE pledges SET next_reminder_at = next_reminder_at - INTERVAL '7 days', first_overdue_at = first_overdue_at - INTERVAL '7 days' WHERE org_id=$1 AND status='open'`, [ORG]);
  const before6 = captured.length;
  const sentBefore = (await q(`SELECT COUNT(*)::int AS n FROM auto_mail_sent WHERE org_id=$1`, [ORG]))[0].n;
  await api("POST", "/journey-sends/run", tok, { now: nyInstant(runDay, 9) });
  await api("POST", "/pledges/process-reminders", tok, {});
  await settle(2000);
  const amsRows = await q(`SELECT id, type_key, donor_id, subject, html FROM auto_mail_sent WHERE org_id=$1 ORDER BY sent_at OFFSET $2`, [ORG, sentBefore]);
  const actual = amsRows.map(r => r.type_key + ":" + r.donor_id).sort();
  ok("§6 seven days on, exactly those emails sent: no more, no fewer", JSON.stringify(actual) === JSON.stringify(expectPlanned) && captured.length - before6 === expectPlanned.length,
    { actual, provider: captured.slice(before6).map(c => c.to + " " + c.subject) });
  const go2 = await api("GET", "/going-out", tok);
  const sentIds = new Set((go2.body.sent || []).map(s => s.id));
  let exact = amsRows.length > 0;
  for (const r of amsRows) {
    const one = await api("GET", `/going-out/sent/${r.id}`, tok);
    const wire = captured.slice(before6).find(c => c.subject === r.subject && c.html === one.body.html);
    if (!sentIds.has(r.id) || one.status !== 200 || !wire) exact = false;
  }
  ok("§6 Sent lists each one, and shows exactly what the person received", exact, amsRows.map(r => r.subject));
  const csv = await fetch(`${BASE}/going-out/sent.csv`, { headers: { Authorization: "Bearer " + tok } });
  ok("§6 Sent exports to CSV", csv.status === 200 && (await csv.text()).split("\n").filter(Boolean).length >= amsRows.length + 1);
  const heldGo = (go2.body.held || []).find(h => h.donorId === "d_sg2_hal");
  ok("§6 Held lists Hal's journey step, with why", !!heldGo && heldGo.why === "this person is set to Never", go2.body.held && go2.body.held.slice(0, 4));
  const st3 = await api("GET", "/mail-types/status", tok);
  ok("§6 the top bar counts what is on", st3.body.chip === "Automatic email: 2 on" && st3.body.home === "Steward is sending pledge reminders and journey steps for you.", st3.body);

  // ── §7 an import sends nothing, with every type on ──────────────────────
  await mailTypesOn(ORG, "everyone");
  await q(`UPDATE pledges SET status='written_off' WHERE org_id=$1`, [ORG]);
  const grid = [["First", "Last", "Email", "Amount", "Method", "Completed", "3 Yr Total"],
    ["Ivy", "Imported", "ivy@sendgate2.example", "500", "Check", "Yes", ""],
    ["Ian", "Imported", "ian@sendgate2.example", "1000", "Pledge", "No", "3000"]];
  const sent7 = captured.length;
  const c1 = await api("POST", "/sheet-import/commit", tok, { fileName: "Choir Gifts.xlsx", sheets: [{ name: "Sheet1", grid }], answers: { date: today }, importId: "imp_sendgate2_1" });
  await q(`UPDATE pledges SET due_date=$2 WHERE org_id=$1 AND import_id='imp_sendgate2_1'`, [ORG, addDays(today, -20)]);
  await api("POST", "/pledges/process-reminders", tok, {});
  await api("POST", "/pledges/process-reminders", tok, {});
  await settle(2500);
  const landed = (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND import_id='imp_sendgate2_1')::int AS g,
                                  (SELECT COUNT(*) FROM pledges WHERE org_id=$1 AND import_id='imp_sendgate2_1')::int AS p`, [ORG]))[0];
  ok("fixture: the import wrote gifts and a pledge", c1.status === 201 && landed.g >= 1 && landed.p >= 1, { s: c1.status, landed });
  ok("§7 with every email on, the import and the reminder sweep after it sent nothing", captured.length === sent7, captured.slice(sent7).map(c => c.to + " " + c.subject));

  // ── §8 super-admin ──────────────────────────────────────────────────────
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ('org_sg2_hq','SG2 HQ','sg2-hq',1,'active','team') ON CONFLICT DO NOTHING`);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sg2_super','org_sg2_hq','super@sendgate2.example',$1,'Jo Super','admin',true)`, [bcrypt.hashSync(PW, 4)]);
  const sup = await login("super@sendgate2.example");
  const adm = await api("GET", `/admin/orgs/${ORG}/mail-types`, sup);
  const notSup = await api("GET", `/admin/orgs/${ORG}/mail-types`, tok);
  ok("§8 super-admin sees the org's emails and what Donor mail starts, read-only", adm.status === 200 && notSup.status === 403
    && adm.body.types.length === TYPES.TYPES.length && /^This will start: /.test(adm.body.willStart), { s: adm.status, w: adm.body.willStart });
  await q(`UPDATE orgs SET emails_enabled=false WHERE id=$1`, [ORG]);
  const ask = await api("POST", `/admin/orgs/${ORG}/mail-switches`, sup, { donor: true });
  ok("§8 turning Donor mail on says exactly what will start, with the next 7 days", ask.status === 409 && /This will start: .*emails? in the next 7 days\./.test(ask.body.message || ""), ask.body);

  if (!process.env.SG2_KEEP) await reset();
  await q(`DELETE FROM users WHERE id='u_sg2_super'`); await q(`DELETE FROM orgs WHERE id='org_sg2_hq'`);
  sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
