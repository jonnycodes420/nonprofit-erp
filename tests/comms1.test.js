// tests/comms1.test.js · COMMS-1. CAMPAIGN EMAIL SAYS HOW TO TURN IT ON,
// INVITES ARRIVE, OLD SEQUENCE DRAFTS ARE CLEANED UP, EVERY DRAFT CAN BE DISMISSED.
//
//   §1 the audience panel (segment-preview's audience, and Communications'
//      overview) says "Campaign emails are off for your organization." with
//      the link to Settings → Automatic email for an admin only; anyone else
//      reads "Ask an admin". The panel renders it (CampaignEditor's AudienceLine).
//   §2 turning Campaign emails on sends nothing (no mail logged, no held mail
//      released, no campaign moved), and the setting says so.
//   §3 a staff invite in an org with no SMTP (and donor mail off) is sent
//      through Resend (stubbed), from Steward's address, to the invitee only,
//      as account mail (team_invite) the gates let through.
//   §4 Resend sends again at most once per 10 minutes and says when; 20 a day
//      per org; a bounce shows on the Invited row.
//   §5 scripts/ops/comms1-old-sequence-drafts.js: the dry run lists org and
//      count and changes nothing; --apply archives once with one audit row; a
//      second run changes nothing; --undo restores.
//   §6 every draft can be dismissed: × archives (never deletes) with an audit
//      row and Restore undoes it; the Atlas banner's line dismisses the same
//      draft; ten at once; the bell and the "draft" kind move at once; a
//      dismissed draft is never sent.
//
// What makes it fail on main: no turnOn on the audience or hub (§1); the
// setting's sentence says nothing about sending staying manual (§2); the
// invite email carries no kind or org and the Resend route sends again with
// no limit (§3, §4: inviteMail.js does not exist); the script does not exist
// (§5); POST /drafts/dismiss does not exist (§6).
// Planted: the invite addressed to the org's first donor turns §3 red; a ×
// that deletes the draft instead of archiving it turns §6 red.
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const express = require("express");
const { execFileSync } = require("child_process");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_comms1t";
const PASSWORD = "loadtest1234";
const ADMIN = `${ORG}-admin@test.local`, STAFF = `${ORG}-staff@test.local`;
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const SCRIPT = path.join(__dirname, "..", "scripts", "ops", "comms1-old-sequence-drafts.js");
const sys = "'system:test','COMMS-1 suite'";

async function wipe() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name NOT IN ('orgs','fin_audit_log')`)).map(r => r.t);
  await q("SET session_replication_role = replica").catch(() => {});
  for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q("SET session_replication_role = origin").catch(() => {});
}
async function setup() {
  await wipe();
  // Donor mail on and onboarded, so what holds the audience is the Campaign emails switch alone. No SMTP.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at)
           VALUES ($1,'Comms One Trust (test)',$2,1,'active','team','America/New_York',true,NOW())`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Odile Varga','admin')`, ["u_" + ORG + "_a", ORG, ADMIN, bcrypt.hashSync(PASSWORD, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Piet Lanver','staff')`, ["u_" + ORG + "_s", ORG, STAFF, bcrypt.hashSync(PASSWORD, 4)]);
  const people = [["Quill Ambrose", "quill.ambrose@comms1.test"], ["Rhea Tolland", "rhea.tolland@comms1.test"], ["Sorrel Dunmore", "sorrel.dunmore@comms1.test"]];
  for (let i = 0; i < people.length; i++)
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name,created_at) VALUES ($1,$2,$3,$4,${sys},NOW() - ($5 || ' days')::interval)`, [`d_c1_${i}`, ORG, people[i][0], people[i][1], String(30 - i)]);
  return { admin: await login(ADMIN, PASSWORD), staff: await login(STAFF, PASSWORD) };
}

// ── §1 ──────────────────────────────────────────────────────────────────────
async function turnOnSentence({ admin, staff }) {
  const a = await api("POST", "/campaigns/segment-preview", admin, { segment: { mode: "everyone" } });
  const s = await api("POST", "/campaigns/segment-preview", staff, { segment: { mode: "everyone" } });
  const at = a.body && a.body.audience && a.body.audience.turnOn, st = s.body && s.body.audience && s.body.audience.turnOn;
  ok("§1 the audience waits on Campaign emails (type_off)", a.body && a.body.audience && a.body.audience.groups.some(g => g.reason === "type_off"), JSON.stringify(a.body && a.body.audience));
  ok("§1 an admin's audience says they are off, with the link to Settings → Automatic email",
    at && at.sentence === "Campaign emails are off for your organization." && at.link && at.link.href === "/app/settings?section=automatic" && /Settings → Automatic email/.test(at.link.label), JSON.stringify(at));
  ok("§1 anyone else gets no link, and is told to ask an admin", st && st.sentence === at.sentence && !st.link && st.ask === "Ask an admin to turn them on.", JSON.stringify(st));
  const ha = await api("GET", "/communications/hub", admin), hs = await api("GET", "/communications/hub", staff);
  ok("§1 Communications' overview carries the same note, the link for the admin only",
    ha.body.campaignTurnOn && ha.body.campaignTurnOn.link && hs.body.campaignTurnOn && !hs.body.campaignTurnOn.link, JSON.stringify({ a: ha.body.campaignTurnOn, s: hs.body.campaignTurnOn }));
  const fs = require("fs");
  const editor = fs.readFileSync(path.join(__dirname, "..", "client/src/components/CampaignEditor.jsx"), "utf8");
  const hub = fs.readFileSync(path.join(__dirname, "..", "client/src/components/Communications.jsx"), "utf8");
  ok("§1 the audience panel and the overview render it", /<CampaignTurnOn note=\{audience\.turnOn\}/.test(editor) && /<CampaignTurnOn note=\{hub\.campaignTurnOn\}/.test(hub));
}

// ── §2 ──────────────────────────────────────────────────────────────────────
async function turningOnSendsNothing({ admin }) {
  await q(`INSERT INTO mail_blocked (id,org_id,donor_id,kind,what,subject,payload,dedupe_key,held_reason,type_key)
           VALUES ('mb_c1held',$1,'d_c1_0','campaign','Campaign: "Spring"','Spring','{"html":"<p>Spring</p>"}','c1-held','type_off','campaign')`, [ORG]);
  await q(`INSERT INTO campaigns (id,org_id,name,subject,body,status,scheduled_at) VALUES ('cmp_c1',$1,'Spring','Spring','<p>Spring</p>','scheduled',NOW() + interval '3 days')`, [ORG]).catch(() => {});
  const count = async () => (await q(`SELECT
      (SELECT COUNT(*)::int FROM email_log WHERE org_id=$1) AS logged,
      (SELECT COUNT(*)::int FROM mail_blocked WHERE org_id=$1 AND sent_at IS NULL) AS held,
      (SELECT COUNT(*)::int FROM auto_mail_sent WHERE org_id=$1) AS sent,
      (SELECT string_agg(status, ',') FROM campaigns WHERE org_id=$1) AS camp`, [ORG]))[0];
  const before = await count();
  const page = await api("GET", "/mail-types", admin);
  const type = ((page.body && page.body.groups) || []).flatMap(g => g.types || []).find(t => t.key === "campaign")
    || ((page.body && page.body.types) || []).find(t => t.key === "campaign");
  const noConfirm = await api("POST", "/mail-types/campaign", admin, { on: true, audience: "everyone" });
  const on = await api("POST", "/mail-types/campaign", admin, { on: true, audience: "everyone", confirm: true });
  await new Promise(r => setTimeout(r, 1500));
  const after = await count();
  ok("§2 the setting says sending stays manual, one click per campaign, nothing on its own",
    !!type && /manual/.test(type.sentence) && /one click per campaign/.test(type.sentence) && /nothing goes out on its own/.test(type.sentence), JSON.stringify(type));
  ok("§2 the confirm says turning it on sends nothing", noConfirm.status === 400 && /^Turning this on sends nothing\./.test(noConfirm.body.sentence || ""), JSON.stringify(noConfirm.body));
  ok("§2 turning it on sends nothing: no mail logged, the held mail still held, the scheduled campaign unmoved",
    on.status === 200 && after.logged === before.logged && after.held === before.held && after.sent === before.sent && after.camp === before.camp, JSON.stringify({ before, after, status: on.status }));
  await api("POST", "/mail-types/campaign", admin, { on: false });
}

// ── §3 and §4: the invite routes in-process, with a stubbed Resend ──────────
function stubResend() {
  const sent = [];
  return { sent, emails: { send: async opts => { sent.push(opts); return { data: { id: "re_c1_" + sent.length }, error: null }; } } };
}
function inviteApp(resend) {
  const { query, run } = require("../db");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { orgId: ORG, userId: "u_" + ORG + "_a", role: "admin" }; req.audit = { entity() {}, action() {}, before() {}, after() {}, skip() {} }; next(); });
  const mod = require("../server/org/invites");
  const pass = (req, res, next) => next();
  mod.mount({ query, run, requireAuth: pass, requireAdmin: pass, wrap: fn => (req, res, next) => fn(req, res, next).catch(next), resend,
    publicAppUrl: () => "http://localhost:4173", displayNameCase: s => s, actor: () => ({ id: "u_" + ORG + "_a", name: "Odile Varga" }) });
  app.use(mod.routers.r1);
  return new Promise(resolve => { const srv = app.listen(0, () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` })); });
}
const call = async (base, method, p) => { const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" }); return { status: r.status, body: await r.json().catch(() => null) }; };

async function invites() {
  const invitee = "tamsin.okafor@comms1-invite.test";
  // Donor mail OFF and no SMTP: account mail still goes.
  await q(`UPDATE orgs SET emails_enabled=false, smtp_host=NULL, smtp_from=NULL WHERE id=$1`, [ORG]);
  await q(`INSERT INTO invites (id,org_id,email,token,role,invited_by,expires_at) VALUES ('inv_c1',$1,$2,'tok_c1_0123456789abcdef','staff',$3,NOW() + interval '7 days')`, [ORG, invitee, "u_" + ORG + "_a"]);
  const resend = stubResend();
  const { srv, base } = await inviteApp(resend);
  const prevKey = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
  try {
    const r1 = await call(base, "POST", "/org/invites/inv_c1/resend");
    const m = resend.sent[0] || {};
    const to = [].concat(m.to || []);
    const mailPolicy = require("../mailPolicy");
    const [org] = await q(`SELECT * FROM orgs WHERE id=$1`, [ORG]);
    ok("§3 the invite is sent through Resend, in an org with no SMTP and donor mail off", r1.status === 200 && r1.body.emailSent === true && resend.sent.length === 1, JSON.stringify(r1.body));
    ok("§3 to the invitee only: no cc, no bcc, no donor", to.length === 1 && to[0] === invitee && !m.cc && !m.bcc && !/comms1\.test/.test(JSON.stringify(to)), JSON.stringify({ to, cc: m.cc, bcc: m.bcc }));
    ok("§3 from Steward's own address, as account mail with its org (team_invite), which the gates send",
      /stewardapp\.dev/.test(String(m.from)) && m._stewardKind === "team_invite" && m._stewardOrgId === ORG
      && mailPolicy.categoryOf("team_invite") === "account" && mailPolicy.orgMailDecision(org, "account", "team_invite").send === true, JSON.stringify({ from: m.from, kind: m._stewardKind, org: m._stewardOrgId }));
    ok("§3 the answer says when: Sent again to … at h:mm", /^Sent again to tamsin\.okafor@comms1-invite\.test at \d{1,2}:\d{2} [AP]M\./.test(r1.body.message || ""), r1.body.message);

    // §4 once per ten minutes
    const r2 = await call(base, "POST", "/org/invites/inv_c1/resend");
    ok("§4 a second Resend inside ten minutes sends nothing and says when it can go again",
      r2.status === 200 && r2.body.emailSent === false && r2.body.reason === "too_soon" && resend.sent.length === 1 && /You can send it again after \d{1,2}:\d{2} [AP]M/.test(r2.body.message || ""), JSON.stringify(r2.body));
    await q(`UPDATE invite_sends SET sent_at = sent_at - interval '11 minutes' WHERE org_id=$1`, [ORG]);
    const r3 = await call(base, "POST", "/org/invites/inv_c1/resend");
    ok("§4 after ten minutes it really sends again", r3.body && r3.body.emailSent === true && resend.sent.length === 2, JSON.stringify(r3.body));
    // 20 a day per org
    await q(`UPDATE invite_sends SET sent_at = sent_at - interval '11 minutes' WHERE org_id=$1`, [ORG]);
    for (let i = 0; i < 18; i++) await q(`INSERT INTO invite_sends (id,org_id,invite_id,email,sent_at,created_by) VALUES ($1,$2,'inv_other',$3,NOW() - interval '2 hours','system:test')`, [`isd_c1_${i}`, ORG, `x${i}@comms1-invite.test`]);
    const r4 = await call(base, "POST", "/org/invites/inv_c1/resend");
    ok("§4 the 21st invite email in a day is not sent, and says so", r4.body && r4.body.emailSent === false && r4.body.reason === "daily_cap" && resend.sent.length === 2, JSON.stringify(r4.body));
    // a bounce shows on the Invited row
    const last = (await q(`SELECT provider_id FROM invite_sends WHERE org_id=$1 AND invite_id='inv_c1' ORDER BY sent_at DESC LIMIT 1`, [ORG]))[0];
    const { query, run } = require("../db");
    await require("../server/org/inviteMail").markBounced(query, run, { providerId: last.provider_id, email: invitee });
    const list = await call(base, "GET", "/org/invites");
    const row = ((list.body && list.body.invites) || []).find(i => i.id === "inv_c1");
    ok("§4 a bounce shows on the Invited row", row && row.bounced === true && !!row.lastSentAt, JSON.stringify(row));
  } finally {
    process.env.RESEND_API_KEY = prevKey;
    srv.close();
  }
  const fs = require("fs");
  const billing = fs.readFileSync(path.join(__dirname, "..", "routes/billing.js"), "utf8");
  ok("§3 POST /auth/invite sends through the same inviteMail.sendInvite", /require\("\.\.\/server\/org\/inviteMail"\)\.sendInvite\(/.test(billing));
}

// ── §5 the drafts script ────────────────────────────────────────────────────
function runScript(...args) {
  return execFileSync(process.execPath, [SCRIPT, `--org=${ORG}`, ...args], { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
async function oldDrafts() {
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,created_by,created_by_name) VALUES ('seq_c1_off',$1,'At risk','at_risk','paused',${sys}),('seq_c1_on',$1,'Milestones','milestone','active',${sys})`, [ORG]);
  await q(`INSERT INTO sequence_enrollments (id,sequence_id,org_id,donor_id,status) VALUES ('enr_c1_a','seq_c1_off',$1,'d_c1_0','active'),('enr_c1_b','seq_c1_off',$1,'d_c1_1','active'),('enr_c1_c','seq_c1_on',$1,'d_c1_2','active')`, [ORG]);
  const md = (id, enr, donor, days, status = "pending_review", sent = false) => q(
    `INSERT INTO milestone_drafts (id,org_id,donor_id,sequence_enrollment_id,milestone_key,subject,body,status,created_at,sent_at,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,'at_risk','We miss you','Body',$5,NOW() - ($6 || ' days')::interval,CASE WHEN $7 THEN NOW() END,${sys})`, [id, ORG, donor, enr, status, String(days), sent]);
  await md("md_c1_old", "enr_c1_a", "d_c1_0", 10);            // off, old, unsent: the one
  await md("md_c1_new", "enr_c1_b", "d_c1_1", 2);             // off but recent: stays
  await md("md_c1_live", "enr_c1_c", "d_c1_2", 20);           // its sequence is on: stays
  await md("md_c1_sent", "enr_c1_a", "d_c1_0", 12, "sent", true);   // sent: stays
  const state = async () => (await q(`SELECT id, status FROM milestone_drafts WHERE org_id=$1 AND id LIKE 'md_c1_%' ORDER BY id`, [ORG])).map(r => `${r.id}:${r.status}`).join(",");
  const s0 = await state();
  // fin_audit_log is append-only, so a past run's rows for this org id remain: count this run's only.
  const [{ t0 }] = await q(`SELECT NOW() AS t0`);
  const dry = runScript();
  ok("§5 the dry run lists the org id and its count, and nothing else about the drafts", new RegExp(`^${ORG}: 1$`, "m").test(dry) && !/md_c1_|We miss you|Body/.test(dry), dry);
  ok("§5 the dry run changes nothing", (await state()) === s0, await state());
  const out1 = runScript("--apply");
  const s1 = await state();
  const audits = await q(`SELECT id, changes FROM fin_audit_log WHERE org_id=$1 AND user_id='system:scripts/ops/comms1-old-sequence-drafts' AND action='archive drafts' AND created_at >= $2`, [ORG, t0]);
  ok("§5 --apply archives only the old unsent draft of a turned-off sequence (never deleted, never sent)",
    s1 === "md_c1_live:pending_review,md_c1_new:pending_review,md_c1_old:archived,md_c1_sent:sent" && (await q(`SELECT COUNT(*)::int AS n FROM email_log WHERE org_id=$1`, [ORG]))[0].n >= 0, s1 + "\n" + out1);
  ok("§5 one audit row for the org, naming the draft", audits.length === 1 && JSON.stringify(audits[0].changes).includes("md_c1_old"), JSON.stringify(audits));
  const out2 = runScript("--apply");
  ok("§5 a second run changes nothing", (await state()) === s1 && (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND user_id='system:scripts/ops/comms1-old-sequence-drafts' AND created_at >= $2`, [ORG, t0]))[0].n === 1, out2);
  runScript(`--undo=${audits[0].id}`);
  ok("§5 --undo puts it back in the queue", (await state()) === s0, await state());
  await q(`DELETE FROM milestone_drafts WHERE org_id=$1 AND id LIKE 'md_c1_%'`, [ORG]);
}

// ── §6 every draft can be dismissed ─────────────────────────────────────────
async function dismissDrafts({ admin }) {
  const md = id => q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,created_by,created_by_name) VALUES ($1,$2,'d_c1_0','anniversary','A year with us','Thank you for a year.','pending_review',${sys})`, [id, ORG]);
  await md("md_c1_x");
  const audit = async () => (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE '/drafts/%'`, [ORG]))[0].n;
  const a0 = await audit();
  const d1 = await api("POST", "/drafts/dismiss", admin, { drafts: [{ kind: "milestone", id: "md_c1_x" }] });
  const list1 = await api("GET", "/milestone-drafts", admin);
  const [row] = await q(`SELECT status, archived_at, archived_by FROM milestone_drafts WHERE id='md_c1_x'`);
  ok("§6 × takes the draft off Drafts to review", d1.status === 200 && d1.body.count === 1 && !(list1.body || []).some(d => d.id === "md_c1_x"), JSON.stringify(d1.body));
  ok("§6 it is archived, not deleted, and says who", !!row && row.status === "archived" && !!row.archived_at && !!row.archived_by, JSON.stringify(row));
  await new Promise(r => setTimeout(r, 300));
  ok("§6 with an audit row", (await audit()) === a0 + 1, { a0, now: await audit() });
  const gone = await api("GET", "/drafts/dismissed", admin);
  ok("§6 Dismissed (n) lists it", gone.body && gone.body.drafts.some(d => d.id === "md_c1_x" && d.kind === "milestone"), JSON.stringify(gone.body));
  const send = await api("POST", "/milestone-drafts/md_c1_x/send", admin);
  ok("§6 a dismissed draft is never sent", send.status === 404 && ((await q(`SELECT status, sent_at FROM milestone_drafts WHERE id='md_c1_x'`))[0] || {}).sent_at === null, JSON.stringify(send.body));
  const back = await api("POST", "/drafts/restore", admin, { drafts: [{ kind: "milestone", id: "md_c1_x" }] });
  const list2 = await api("GET", "/milestone-drafts", admin);
  ok("§6 Undo (Restore) puts it back where it waited", back.body && back.body.count === 1 && (list2.body || []).some(d => d.id === "md_c1_x"), JSON.stringify(back.body));

  // The Atlas banner's line names the same draft.
  await q(`INSERT INTO agent_drafts (id,org_id,donor_id,subject,body,cites,status) VALUES ('adr_c1',$1,'d_c1_1','Coffee in May?','Would you meet?','["d_c1_1"]','pending')`, [ORG]);
  await q(`INSERT INTO atlas_actions (id,org_id,kind,state,line,donor_id,place,place_id,link,waits,undoable,actor_id,actor_name,created_by,created_by_name)
           VALUES ('aa_c1',$1,'draft','waiting','Drafted an email to Rhea asking to meet in May. Review and send.','d_c1_1','communications','adr_c1',$2,true,false,'system:atlas','Atlas',${sys})`,
    [ORG, JSON.stringify({ tab: "communications", draftId: "adr_c1", donorId: "d_c1_1" })]);
  const bell0 = await api("GET", "/atlas/activity", admin);
  const notes0 = await api("GET", "/atlas/notes?place=communications", admin);
  const line = ((notes0.body && notes0.body.notes) || []).find(n => n.id === "aa_c1");
  ok("§6 the banner's line names its draft", line && line.waits && line.link && line.link.draftId === "adr_c1", JSON.stringify(line));
  await api("POST", "/drafts/dismiss", admin, { drafts: [{ kind: "agent", id: line ? line.link.draftId : "adr_c1" }] });
  const bell1 = await api("GET", "/atlas/activity", admin);
  const notes1 = await api("GET", "/atlas/notes?place=communications", admin);
  const waiting1 = await api("GET", "/agent/waiting", admin);
  ok("§6 the banner × dismisses that same draft: archived, off Atlas's queue, the line no longer waits",
    (await q(`SELECT status FROM agent_drafts WHERE id='adr_c1'`))[0].status === "archived"
    && !((waiting1.body && waiting1.body.items) || []).some(i => i.id === "adr_c1")
    && !((notes1.body && notes1.body.notes) || []).some(n => n.id === "aa_c1" && n.waits), JSON.stringify(notes1.body));
  ok("§6 the bell's count drops at once", (bell1.body.waiting || 0) === (bell0.body.waiting || 0) - 1, { before: bell0.body.waiting, after: bell1.body.waiting });
  const approve = await api("POST", "/agent/waiting/agent_draft/adr_c1/approve", admin, {});
  ok("§6 a dismissed Atlas draft can't be approved", approve.status >= 400 && (await q(`SELECT status FROM agent_drafts WHERE id='adr_c1'`))[0].status === "archived", JSON.stringify({ s: approve.status, b: approve.body }));
  await api("POST", "/drafts/restore", admin, { drafts: [{ kind: "agent", id: "adr_c1" }] });
  const bell2 = await api("GET", "/atlas/activity", admin);
  ok("§6 restoring it makes the line wait again", bell2.body.waiting === bell0.body.waiting && (await q(`SELECT state, waits FROM atlas_actions WHERE id='aa_c1'`))[0].waits === true, { b0: bell0.body.waiting, b2: bell2.body.waiting });

  // A thank-you draft.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_c1',$1,'d_c1_2',250,CURRENT_DATE,${sys})`, [ORG]);
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body) VALUES ('ty_c1',$1,'d_c1_2','g_c1','Dear Sorrel, thank you.')`, [ORG]);
  await api("POST", "/drafts/dismiss", admin, { drafts: [{ kind: "thank_you", id: "ty_c1" }] });
  const tys = await api("GET", "/thank-yous", admin);
  ok("§6 a thank-you draft dismisses too, and is kept", !((tys.body && tys.body.drafts) || []).some(d => d.id === "ty_c1") && (await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE id='ty_c1' AND archived_at IS NOT NULL`))[0].n === 1);

  // Ten at once.
  for (let i = 0; i < 10; i++) await md(`md_c1_b${i}`);
  const a1 = await audit();
  const bulk = await api("POST", "/drafts/dismiss", admin, { drafts: Array.from({ length: 10 }, (_, i) => ({ kind: "milestone", id: `md_c1_b${i}` })) });
  await new Promise(r => setTimeout(r, 300));
  const left = await q(`SELECT COUNT(*)::int AS n FROM milestone_drafts WHERE org_id=$1 AND id LIKE 'md_c1_b%' AND status='archived'`, [ORG]);
  ok("§6 bulk: ten dismissed in one go, all archived, one audit row", bulk.body && bulk.body.count === 10 && left[0].n === 10 && (await audit()) === a1 + 1, JSON.stringify(bulk.body));

  // Counts move without a reload: a dismiss is the "draft" kind, and the counts listen for it.
  const ch = await import("../client/src/lib/changes.js");
  const fs = require("fs");
  const src = f => fs.readFileSync(path.join(__dirname, "..", "client/src/components", f), "utf8");
  ok("§6 a dismiss or restore is announced as the draft kind",
    ch.kindsOfWrite("/drafts/dismiss", "POST").kinds.has("draft") && ch.kindsOfWrite("/drafts/restore", "POST").kinds.has("draft"));
  ok("§6 Home's waiting line, the bell and the banner re-read on it",
    /useChanged\(\["draft"\],\(\)=>\{loadAgentDaily\(\)/.test(src("Dashboard.jsx")) && /useChanged\(\["draft"\], c => \{ if \(c\.source !== "worker"\) load\(\); \}\)/.test(src("AtlasNote.jsx"))
    && /useChanged\(\["draft"\], \(\) => load\(\)\)/.test(src("AtlasNote.jsx")));
}

(async () => {
  try {
    const tok = await setup();
    await turnOnSentence(tok);
    await turningOnSendsNothing(tok);
    await invites();
    await oldDrafts();
    await dismissDrafts(tok);
  } catch (e) { ok("the suite ran without throwing", false, e.stack || e.message); }
  finally { await wipe().catch(() => {}); await closeDb(); summary(); }
})();
