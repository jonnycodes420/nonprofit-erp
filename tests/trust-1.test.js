// tests/trust-1.test.js · TRUST-1. ONE ORG'S REQUEST NEVER WRITES IN ANOTHER
// ORG, AND A CAMPAIGN REACHES WHO THE SETTING SAYS.
//
//   §1 tenant scope: an admin of org A runs the three sweeps a request can
//      reach (POST /sequences/process, /pledges/process-reminders,
//      /recurring/process-dunning). Org B, with an overdue pledge, a card in
//      dunning and no at-risk sequence, is byte-for-byte untouched: no new
//      sequence, no row anywhere, no pledge or card moved. A's own at-risk
//      sequence, made by Steward, is OFF ('paused').
//   §2 the campaign audience, on the walk org's shape (Donor mail on, Campaign
//      emails on for Everyone, people whose automatic email is off with an
//      address): they can get the campaign, the reasons add up ("· 3 have
//      unsubscribed · 1 set to Never"), and the send reaches exactly the
//      number the builder showed. Automatic kinds still leave them out: a
//      pledge reminder for one of them is held, with the type off and with it
//      on for "Only donors I choose".
//   §3 the merge: every starter (shared/emailTemplates.js through the send's
//      legacyCampaignBody, shared/emailTemplateLibrary.js through the block
//      renderer) for a person with no gift says no "your gift of" with the
//      amount missing, and with one gift it says the amount.
//
// Against main it fails at §1 (B gets an active at-risk sequence; B's pledge
// starts its cadence), at §2 (0 can get the campaign: "68 have automatic
// email off") and at §3 ("your gift of your previous gift"). Planted defects
// that turned it red: /sequences/process calling processSequences() and
// autoEnroll() with no org (§1), the campaign branch of donorMailDecision
// reading auto_email again (§2).
"use strict";

const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, civilToday, mailTypesOn } = require("./helpers");

const A = "org_trust1_a", B = "org_trust1_b", C = "org_trust1_walk";
const PW = "loadtest1234";
const sys = "'system:test','test'";
const settle = (ms = 1500) => new Promise(r => setTimeout(r, ms));
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        let j = {}; try { j = JSON.parse(body); } catch { /* not json */ }
        captured.push({ to: [].concat(j.to || []).join(",").toLowerCase(), subject: j.subject || "", html: j.html || "" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.once("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}

async function orgTables() {
  return (await q(`SELECT DISTINCT table_name FROM information_schema.columns
                    WHERE column_name='org_id' AND table_schema='public' AND table_name NOT IN ('orgs','fin_audit_log')`)).map(r => r.table_name);
}
async function reset(tables) {
  for (let pass = 0; pass < 2; pass++) for (const t of tables) for (const o of [A, B, C]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
  await q(`DELETE FROM users WHERE email LIKE '%@trust1.example'`).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1::text[])`, [[A, B, C]]).catch(() => {});
}
async function makeOrg(id, name, { mail = false } = {}) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,timezone_confirmed_at,
             receipt_address,legal_name,ein,receipts_enabled,emails_enabled)
           VALUES ($1,$2,$3,1,NOW(),'active','team','America/New_York',NOW(),'14 Harbor Rd, Wilmington, NC 28401',$2,'12-3456780',TRUE,$4)`,
    [id, name, id.replace(/_/g, "-"), mail]);
  const email = `admin.${id}@trust1.example`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rosa Admin','admin')`,
    ["u_" + id, id, email, bcrypt.hashSync(PW, 4)]);
  return login(email);
}
// Everything in an org a request could have written: a row count per table,
// and the moving parts of its pledges, cards and sequences.
async function snapshot(org, tables) {
  const counts = {};
  for (const t of tables) {
    const [r] = await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id=$1`, [org]).catch(() => [{ n: -1 }]);
    if (r.n) counts[t] = r.n;
  }
  const pledges = await q(`SELECT id, first_overdue_at, next_reminder_at, reminder_step, updated_at FROM pledges WHERE org_id=$1 ORDER BY id`, [org]);
  const cards = await q(`SELECT id, status, dunning_step, next_dunning_at, updated_at FROM recurring_subscriptions WHERE org_id=$1 ORDER BY id`, [org]);
  const seqs = await q(`SELECT id, trigger, status FROM sequences WHERE org_id=$1 ORDER BY id`, [org]);
  return JSON.stringify({ counts, pledges, cards, seqs });
}

(async () => {
  console.log("trust-1 (TRUST-1)");
  const sink = await startSink();
  if (!sink) { ok(`the capturing sink bound :${SINK_PORT}`, false); await closeDb(); return summary(); }
  const tables = await orgTables();
  await reset(tables);
  const today = civilToday();

  // ── §1 · tenant scope ────────────────────────────────────────────────────
  const tokA = await makeOrg(A, "Trust One Alpha");
  await makeOrg(B, "Trust One Bravo");
  ok("fixture: org A's admin signed in", !!tokA);
  // B: a long-time donor who has drifted (an at-risk candidate), an overdue
  // pledge that has not started its cadence, and a card in dunning.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name)
           VALUES ('d_t1_b','${B}','Bea Bravo','bea@trust1.example','steward','["donor"]'::jsonb,${sys})`);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_t1_b1','${B}','d_t1_b',500,$1,'cash',${sys}),
           ('g_t1_b2','${B}','d_t1_b',500,$2,'cash',${sys})`, [addDays(today, -700), addDays(today, -300)]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ('pl_t1_b','${B}','d_t1_b',300,$1,'open',${sys})`, [addDays(today, -10)]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,dunning_step,next_dunning_at)
           VALUES ('rs_t1_b','${B}','d_t1_b','sub_t1_b',25,'month','past_due',0,NOW() - INTERVAL '1 hour')`);
  const before = await snapshot(B, tables);
  const r1 = await api("POST", "/sequences/process", tokA, {});
  const r2 = await api("POST", "/pledges/process-reminders", tokA, {});
  const r3 = await api("POST", "/recurring/process-dunning", tokA, {});
  ok("§1 the three sweeps answered org A", [r1, r2, r3].every(r => r.status === 200), [r1.status, r2.status, r3.status]);
  await settle(800);
  const after = await snapshot(B, tables);
  const bSeqs = await q(`SELECT id, status FROM sequences WHERE org_id=$1 AND trigger='at_risk'`, [B]);
  ok("§1 org B gets no at-risk sequence from org A's request", bSeqs.length === 0, bSeqs);
  ok("§1 org B is untouched: no row, no pledge or card moved", before === after, { before: JSON.parse(before), after: JSON.parse(after) });
  const aSeqs = await q(`SELECT status, created_by FROM sequences WHERE org_id=$1 AND trigger='at_risk'`, [A]);
  ok("§1 the at-risk sequence Steward makes in A is made OFF", aSeqs.length === 1 && aSeqs[0].status === "paused" && aSeqs[0].created_by === "system:auto", aSeqs);

  // ── §2 · the campaign audience, on the walk org's shape ──────────────────
  const tokC = await makeOrg(C, "Trust One Riders", { mail: true });
  await mailTypesOn(C, "everyone", ["campaign"]);
  // 68 with an address and automatic email off (Follows), 4 with no address,
  // 3 unsubscribed, 1 set to Never. One of the 68 has never given.
  const people = [];
  for (let i = 0; i < 68; i++) people.push({ id: `d_t1_f${i}`, name: `Fran Follows${i}`, email: `fran${i}@trust1.example`, gift: i !== 0 });
  people[0].name = "Nell Nogift";
  for (let i = 0; i < 4; i++) people.push({ id: `d_t1_n${i}`, name: `Noah Noaddress${i}`, email: null, gift: true });
  for (let i = 0; i < 3; i++) people.push({ id: `d_t1_u${i}`, name: `Una Unsub${i}`, email: `una${i}@trust1.example`, gift: true, dne: true });
  people.push({ id: "d_t1_never", name: "Ned Never", email: "ned@trust1.example", gift: true, never: true });
  for (const p of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,auto_email,auto_email_never,do_not_email,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'steward','["donor"]'::jsonb,false,$5,$6,${sys})`, [p.id, C, p.name, p.email, !!p.never, !!p.dne]);
    if (p.gift) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,75,$4,'cash',${sys})`,
      ["g_" + p.id, C, p.id, addDays(today, -40)]);
  }
  await q(`UPDATE donors d SET total_giving = COALESCE((SELECT SUM(amount) FROM gifts g WHERE g.donor_id=d.id),0),
             gift_count = (SELECT COUNT(*) FROM gifts g WHERE g.donor_id=d.id) WHERE org_id=$1`, [C]);
  const seg = await api("POST", "/campaigns/segment-preview", tokC, { segment: { mode: "all" } });
  const au = (seg.body && seg.body.audience) || {};
  const sum = (au.groups || []).reduce((n, g) => n + g.count, 0);
  ok("§2 with Campaign emails on for Everyone, the 68 whose automatic email is off can get it", au.sendable === 68, { sendable: au.sendable, line: au.line });
  ok("§2 the reasons add up to the segment", au.total === 76 && au.total === au.sendable + sum, { total: au.total, sum });
  ok("§2 the count line names each reason", au.line === "76 donors · 68 can get this email: 4 have no email address · 3 have unsubscribed · 1 set to Never.", au.line);

  // The truth check (tests/lib/surfacesAgree.js, campaignReach) says the same.
  const { assertSurfacesAgree } = require("./lib/surfacesAgree");
  const SA_ALL = ["people", "gifts", "thisYear", "vsLastYear", "homeLine", "drift", "groups", "events", "campaigns", "moveReport", "search", "ask", "atlas",
    "exports", "deleted", "finance", "pledges", "mailCampaigns", "units"];
  const sa = await assertSurfacesAgree(C, { token: tokC, soft: true, skip: SA_ALL }).catch(e => ({ ok: false, diffs: [e.message] }));
  const reachDiffs = (sa.diffs || []).filter(d => /would reach|campaign builder/.test(d));
  const reachFact = sa.facts && sa.facts["people a campaign to everyone with an address would reach"];
  ok("§2 the truth check: the builder's count is the database's, by the send's rule (72 with an address, 68 reached)",
    reachDiffs.length === 0 && reachFact && reachFact["the database, by the send's rule"] === 68 && reachFact["the campaign builder's count"] === 68, { reachDiffs, reachFact });

  // The send reaches exactly that number, and the no-gift person reads a
  // thank-you, not "your gift of your previous gift".
  const T = await import(path.join(__dirname, "..", "shared", "emailTemplates.js"));
  const ty = T.emailTemplates({ orgName: "Trust One Riders" }).find(t => t.key === "thank_you");
  const mk = await api("POST", "/campaigns", tokC, { name: "Thanks, all", subject: ty.subject, body: ty.body, segment: { mode: "all" } });
  const cid = mk.body && mk.body.id;
  captured.length = 0;
  const sent = await api("POST", `/campaigns/${cid}/send`, tokC, {});
  for (let i = 0; i < 60 && captured.length < 68; i++) await settle(250);
  await settle(1200);
  ok("§2 the send's answer is the builder's count", sent.status === 200 && sent.body.recipientCount === au.sendable, sent.body);
  ok("§2 the send reached exactly the number the builder showed", captured.length === au.sendable, captured.length);
  ok("§2 nobody unsubscribed, set to Never or without an address got it",
    !captured.some(c => /una\d|ned@/.test(c.to)), captured.filter(c => /una\d|ned@/.test(c.to)).map(c => c.to));
  const nell = captured.find(c => c.to.includes("fran0@"));
  const fran = captured.find(c => c.to.includes("fran1@"));
  ok("§3 the send for a person with no gift says no gift amount", !!nell && !/your previous gift|gift of\s*(<|[.,]|$)/i.test(nell.html)
    && nell.html.includes("Thank you for being part of this."), nell && (nell.html.match(/<p>[^<]*(gift|part of this)[^<]*<\/p>/gi) || []));
  ok("§3 the send for a person with a gift says the amount", !!fran && /gift of \$75 to Trust One Riders/.test(fran.html), fran && (fran.html.match(/<p>[^<]*gift[^<]*<\/p>/gi) || []));

  // Automatic kinds still leave them out: a pledge reminder for Fran.
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,next_reminder_at,created_by,created_by_name)
           VALUES ('pl_t1_c','${C}','d_t1_f1',200,$1,'open',NOW() - INTERVAL '1 hour',${sys})`, [addDays(today, -10)]);
  captured.length = 0;
  await api("POST", "/pledges/process-reminders", tokC, {});
  await settle();
  const offHeld = captured.filter(c => c.to.includes("fran1@")).length;
  await mailTypesOn(C, "chosen", ["pledge_reminder"]);
  await q(`UPDATE pledges SET next_reminder_at = NOW() - INTERVAL '1 hour', status='open' WHERE id='pl_t1_c'`);
  await api("POST", "/pledges/process-reminders", tokC, {});
  await settle();
  ok("§2 an automatic kind still leaves out a person whose automatic email is off (type off, and 'Only donors I choose')",
    offHeld === 0 && captured.filter(c => c.to.includes("fran1@")).length === 0, captured.map(c => c.to));

  // ── §3 · every starter, no gift and one gift ─────────────────────────────
  const B_ = await import(path.join(__dirname, "..", "shared", "emailBlocks.js"));
  const L = await import(path.join(__dirname, "..", "shared", "emailTemplateLibrary.js"));
  const bad = /your previous gift|gift of your last gift|your gift of\s*(<|[.,]|$|your)|gift of\s*\$?0\b|comes to \$0/i;
  const starters = T.emailTemplates({ orgName: "Trust One Riders", t: k => (k === "monthly_giver" ? "sponsor" : k) });
  const legacyNo = starters.map(s => ({ key: s.key, html: T.renderMergeFields(s.body, { first_name: "Nell", gift_amount: "", total_giving: "" }) }));
  const legacyYes = starters.map(s => ({ key: s.key, html: T.renderMergeFields(s.body, { first_name: "Fran", gift_amount: "$75", total_giving: "$75" }) }));
  ok("§3 every starter, for a person with no gift, has no gift sentence with the amount missing", legacyNo.every(s => !bad.test(s.html)),
    legacyNo.filter(s => bad.test(s.html)).map(s => s.key));
  ok("§3 …and with one gift, each that names a gift says its amount", legacyYes.filter(s => /gift_amount|total_giving/.test(starters.find(x => x.key === s.key).body)).every(s => /\$75/.test(s.html)),
    legacyYes.map(s => s.key));
  const libList = L.EMAIL_STARTERS;
  const renderOne = (t, fields) => B_.renderEmail({ blocks: t.blocks, subject: t.subject, preheader: t.preheader, fields, mode: "preview" }).html || "";
  const blockNo = libList.map(t => ({ key: t.key, html: renderOne(t, { first_name: "Nell", last_gift_amount: "", last_gift_date: "", org_name: "Trust One Riders" }) }));
  const blockYes = libList.map(t => ({ key: t.key, html: renderOne(t, { first_name: "Fran", last_gift_amount: "$75", last_gift_date: "October 1, 2026", org_name: "Trust One Riders" }) }));
  ok("§3 the block starters were rendered", libList.length > 0 && blockNo.every(s => s.html.length > 200), libList.length);
  ok("§3 every block starter, for a person with no gift, has no gift sentence with the amount missing", blockNo.every(s => !bad.test(s.html)),
    blockNo.filter(s => bad.test(s.html)).map(s => s.key));
  ok("§3 …and with one gift, each that names a gift says its amount",
    blockYes.filter(s => /last_gift_amount/.test(JSON.stringify(libList.find(x => x.key === s.key).blocks))).every(s => /\$75/.test(s.html)), blockYes.map(s => s.key));

  sink.close();
  await reset(tables);
  await closeDb();
  summary();
})().catch(async e => { ok("trust-1 ran", false, e.stack); await closeDb().catch(() => {}); summary(); });
