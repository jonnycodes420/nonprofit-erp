// BUILD-58 W-4 — transactional vs marketing mail, decided in ONE place, and
// no log line may record a send that did not happen.
//
// The walk found the failed-card recovery email honoring the MARKETING
// suppression list (a donor who unsubscribed from a newsletter silently got
// no card-recovery mail) while payment_recovery_events logged `dunning_sent`
// anyway. Two classes fixed here:
//
//  1. Suppressibility is decided by ONE policy (DONOR_MAIL_POLICY in
//     server.js): every donor-facing message kind is classified
//     transactional | marketing. Transactional mail (dunning, recovery
//     thank-you, receipts, year-end, recurring changes/proposals) NEVER
//     consults the marketing suppression list; marketing mail always does.
//     The raw suppression probe (getSuppressionReason) may be called ONLY by
//     the policy layer — pinned by source scan, so a new send site cannot
//     quietly consult the wrong list.
//  2. `dunning_sent` (and its class) is logged ONLY downstream of an actual
//     successful delivery. A provider failure logs nothing as "sent".
//
// Donor flags (deceased / do_not_contact — BUILD-58 Part 2's P0) plug into
// the same policy: deceased blocks ALL outbound mail; do_not_contact blocks
// marketing only.
//
// Verify-first: committed RED against the pre-BUILD-58 server.

const { ok, summary, api, q, closeDb, BASE, SINK_PORT } = require("./helpers");
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { readSource } = require("../scripts/lib/readSource");

const uniq = () => Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);

// Capture sink on :5602 (the server's RESEND_BASE_URL). `mode` can be flipped
// to "fail" so the provider rejects — the log-honesty leg.
function startSink(port = SINK_PORT) {
  const state = { captured: [], mode: "ok", attempts: 0 };
  const srv = http.createServer((req, res) => {
    state.attempts++;
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      let parsed = {}; try { parsed = JSON.parse(b); } catch {}
      res.setHeader("Content-Type", "application/json");
      if (state.mode === "fail") { res.statusCode = 500; res.end(JSON.stringify({ error: "provider_down" })); return; }
      state.captured.push(parsed);
      res.end(JSON.stringify({ id: "sunk_" + state.captured.length }));
    });
  });
  return new Promise(resolve => {
    srv.on("error", e => { console.error("sink bind failed:", e.message); resolve(null); });
    srv.listen(port, () => resolve({ srv, state }));
  });
}
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("mail-suppression (BUILD-58 W-4)");
  const sink = await startSink();
  if (!sink) { console.error(`could not bind :${SINK_PORT} — another sink running?`); process.exit(1); }
  const { state } = sink;
  const to = addr => state.captured.filter(m => (Array.isArray(m.to) ? m.to : [m.to]).includes(addr));

  // ── fixture: org + suppressed donor with an at-risk recurring gift ───────
  const email = `b58w4-admin-${uniq()}@test.local`;
  const reg = await fetch(BASE + "/auth/register-org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "W4 Mailworks " + uniq(), userName: "W4 Admin", email, password: "loadtest1234" }),
  }).then(r => r.json());
  const tok = reg.token, orgId = reg.org.id;
  // Mail is opt-in per org, by a super-admin (2026-09-24): a new org starts
  // OFF. This suite is about what a mail-ON org does, so it opts in first,
  // standing in for POST /admin/orgs/:id/email-switch.
  // MAIL-1: and it has onboarded (its donor file is in), or nothing sends.
  await q("UPDATE orgs SET emails_enabled=true, onboarded_at=NOW(), onboarded_via='test' WHERE id=$1", [orgId]);
  // MAIL-1 §9's org: mail switched ON by a super-admin, but NO donor file yet.
  const m1Admin = `mail1-admin-${uniq()}@test.local`;
  const m1 = await fetch(BASE + "/auth/register-org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "MAIL-1 Not Yet " + uniq(), userName: "M1 Admin", email: m1Admin, password: "loadtest1234" }),
  }).then(r => r.json());
  const m1Tok = m1.token, m1Org = m1.org.id;
  await q(`UPDATE orgs SET emails_enabled=true, receipts_enabled=true, legal_name='MAIL-1 Org, Inc.', ein='12-3456789',
           receipt_address='1 Test Way, Testville, TS 00000' WHERE id=$1`, [m1Org]);
  // §9's demo org: every switch on and even stamped onboarded. It still sends only sign-in mail.
  const demoAdmin = `mail1-demo-${uniq()}@test.local`;
  const dm = await fetch(BASE + "/auth/register-org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "MAIL-1 Demo " + uniq(), userName: "Demo Admin", email: demoAdmin, password: "loadtest1234", provisioned: true }),
  }).then(r => r.json());
  const dmTok = dm.token, dmOrg = dm.org.id;
  await q("UPDATE orgs SET emails_enabled=true, onboarded_at=NOW() WHERE id=$1", [dmOrg]);
  // …and waits out the 5s mail-gate cache the signup's own gate check filled
  // (the real switch route clears it; SQL can't).
  await new Promise(r => setTimeout(r, 5100));
  await api("POST", "/onboarding/complete", tok, {});

  const donorEmail = `wren-w4-${uniq()}@test.local`;
  const dRes = await api("POST", "/donors", tok, { name: "Wren Suppressed", email: donorEmail });
  const donorId = dRes.body.id;
  // The donor unsubscribed from a campaign once — on the MARKETING list.
  await q("INSERT INTO email_suppressions (id, org_id, email, reason, source) VALUES ($1,$2,$3,'unsubscribe','campaign')",
    ["sup_" + uniq(), orgId, donorEmail]);
  // …and has a recurring gift with a failed card.
  const subId = "sub_w4_" + uniq();
  await q(`INSERT INTO recurring_subscriptions (id, org_id, donor_id, stripe_subscription_id, amount, "interval", status, failure_count, first_failed_at, last_failed_at, dunning_step, next_dunning_at)
           VALUES ($1,$2,$3,$4,20,'month','past_due',1,NOW(),NOW(),0,NOW())`,
    ["rs_" + uniq(), orgId, donorId, subId]);

  // ── §1 the policy is the ONE decision point (source) ─────────────────────
  console.log("\n§1 one suppressibility decision point, typed");
  const src = readSource("server.js");
  ok("DONOR_MAIL_POLICY classification table exists", /DONOR_MAIL_POLICY\s*=/.test(src), null);
  {
    // Raw suppression probe callable ONLY from the policy layer: definition +
    // exactly one call inside the policy decision function.
    const calls = [...src.matchAll(/getSuppressionReason\s*\(/g)].length;
    ok("getSuppressionReason has exactly 2 occurrences (definition + the policy layer)", calls === 2, { calls });
    // Every classified kind is transactional or marketing — no third state.
    const tableMatch = src.match(/DONOR_MAIL_POLICY\s*=\s*{([\s\S]*?)}/);
    const classes = tableMatch ? [...tableMatch[1].matchAll(/"(transactional|marketing)"/g)].length : 0;
    const kinds = tableMatch ? tableMatch[1].split("\n").filter(l => /:\s*"/.test(l)).length : 0;
    ok("every kind in the policy table is transactional|marketing", kinds > 0 && classes === kinds, { kinds, classes });
    for (const kind of ["dunning", "recovered_thankyou", "receipt", "year_end", "recurring_change", "campaign", "sequence", "workflow"])
      ok(`policy classifies "${kind}"`, tableMatch && new RegExp(`${kind}\\s*:`).test(tableMatch[1]), null);
  }

  // ── §2 dunning is TRANSACTIONAL — the suppression list cannot block it ───
  console.log("\n§2 dunning delivers to a marketing-suppressed donor");
  {
    state.captured.length = 0;
    const r = await api("POST", `/recurring/${donorId}/resend`, tok, {});
    ok("manual dunning resend returns 200 for a suppressed donor", r.status === 200, r.body);
    await settle();
    ok("the recovery email was DELIVERED despite the marketing suppression", to(donorEmail).length === 1, { delivered: to(donorEmail).length });
    const events = await q("SELECT type FROM payment_recovery_events WHERE org_id=$1 AND donor_id=$2 AND type='dunning_sent'", [orgId, donorId]);
    ok("dunning_sent logged — and this time it is TRUE", events.length === 1, { events: events.length });
  }

  // ── §3 the log never lies: provider failure ≠ dunning_sent ──────────────
  console.log("\n§3 a failed delivery is never logged as sent");
  {
    state.mode = "fail";
    const before = await q("SELECT COUNT(*)::int AS n FROM payment_recovery_events WHERE org_id=$1 AND type='dunning_sent'", [orgId]);
    const r = await api("POST", `/recurring/${donorId}/resend`, tok, {});
    await settle();
    const after = await q("SELECT COUNT(*)::int AS n FROM payment_recovery_events WHERE org_id=$1 AND type='dunning_sent'", [orgId]);
    ok("provider rejected → NO new dunning_sent row", after[0].n === before[0].n, { before: before[0].n, after: after[0].n, resp: r.body });
    ok("the route does not claim sent:true on a failed delivery", r.body?.sent !== true, r.body);
    state.mode = "ok";
  }

  // ── §4 donor flags ride the same policy ──────────────────────────────────
  console.log("\n§4 deceased blocks everything; do_not_contact blocks marketing only");
  {
    // do_not_contact: transactional still delivers
    const upd = await api("PUT", `/donors/${donorId}`, tok, { name: "Wren Suppressed", email: donorEmail, doNotContact: true });
    ok("PUT /donors/:id accepts doNotContact", upd.status === 200, upd.body);
    // to_jsonb so a pre-fix schema (no column yet) FAILS instead of crashing
    const flags = await q("SELECT to_jsonb(d) AS j FROM donors d WHERE id=$1", [donorId]);
    ok("do_not_contact stored on the donor row", flags[0]?.j?.do_not_contact === true, { do_not_contact: flags[0]?.j?.do_not_contact });
    state.captured.length = 0;
    await api("POST", `/recurring/${donorId}/resend`, tok, {});
    await settle();
    ok("do-not-contact donor STILL gets the card-failure email (service mail)", to(donorEmail).length === 1, { delivered: to(donorEmail).length });

    // deceased: nothing goes out, and the route says why
    const upd2 = await api("PUT", `/donors/${donorId}`, tok, { name: "Wren Suppressed", email: donorEmail, deceased: true });
    ok("PUT /donors/:id accepts deceased", upd2.status === 200, upd2.body);
    state.captured.length = 0;
    const r2 = await api("POST", `/recurring/${donorId}/resend`, tok, {});
    ok("resend to a deceased donor is refused", r2.status === 400, r2.body);
    await settle();
    ok("no email left for the deceased donor", to(donorEmail).length === 0, { delivered: to(donorEmail).length });
    await api("PUT", `/donors/${donorId}`, tok, { name: "Wren Suppressed", email: donorEmail, deceased: false });
  }

  // ── §5 marketing mail stays suppressed (both lists) ──────────────────────
  console.log("\n§5 campaigns still honor the suppression list AND the flags");
  // BUILD-94 Part 4 — NO ADDRESS, NO SEND. A campaign now refuses to go out
  // without the org's mailing address on file, so this fixture has to have one
  // before it can test anything about WHO a campaign reaches. (§6 sets the
  // same field further down for receipts; this pulls it earlier rather than
  // duplicating it.)
  await q(`UPDATE orgs SET receipt_address='1 Test Way, Testville, TS 00000' WHERE id=$1`, [orgId]);
  {
    // A clean donor + a DNC donor + the suppressed donor, one campaign to all.
    const cleanEmail = `clean-w4-${uniq()}@test.local`;
    await api("POST", "/donors", tok, { name: "Clean Reachable", email: cleanEmail });
    const dncEmail = `dnc-w4-${uniq()}@test.local`;
    const dnc = await api("POST", "/donors", tok, { name: "Dnc Donor", email: dncEmail });
    await api("PUT", `/donors/${dnc.body.id}`, tok, { name: "Dnc Donor", email: dncEmail, doNotContact: true });
    const deadEmail = `dead-w4-${uniq()}@test.local`;
    const dead = await api("POST", "/donors", tok, { name: "Deceased Donor", email: deadEmail });
    await api("PUT", `/donors/${dead.body.id}`, tok, { name: "Deceased Donor", email: deadEmail, deceased: true });

    const camp = await api("POST", "/campaigns", tok, { name: "W4 Blast " + uniq(), subject: "Hello", body: "Hi {{donor_name}}", audience: "all" });
    const campId = camp.body?.id || camp.body?.campaign?.id;
    ok("campaign created", !!campId, camp.body);
    // FIX-26: THE SHOWN COUNT IS THE SEND. The builder shows the server's
    // segment-preview count and nothing else; it must equal the messages this
    // send creates, and everyone it leaves out must carry a reason.
    const [campRow] = await q("SELECT segment FROM campaigns WHERE id=$1", [campId]);
    const pv = await api("POST", "/campaigns/segment-preview", tok, { segment: JSON.parse(campRow.segment || "{}") });
    ok("FIX-26 segment-preview answers", pv.status === 200 && typeof pv.body?.count === "number", pv.body);
    const reasons = new Map((pv.body?.leftOut || []).map(g => [g.reason, g]));
    const leftOutIds = new Set((pv.body?.leftOut || []).flatMap(g => g.people.map(p => p.id)));
    ok("FIX-26 the deceased and do-not-contact donors are left out, by name of reason",
      reasons.has("deceased") && reasons.has("do_not_contact") && leftOutIds.has(dead.body.id) && leftOutIds.has(dnc.body.id),
      pv.body?.leftOut);
    ok("FIX-26 the suppression-list donor is left out", leftOutIds.has(donorId), pv.body?.leftOut);
    ok("FIX-26 left out adds up", pv.body?.leftOutCount === (pv.body?.leftOut || []).reduce((n, g) => n + g.count, 0), pv.body);
    state.captured.length = 0;
    const send = await api("POST", `/campaigns/${campId}/send`, tok, {});
    ok("campaign send queued", send.status === 200, send.body);
    await settle(1500);
    {
      const made = await q("SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1 AND (failure_reason IS NULL OR failure_reason NOT LIKE 'suppressed:%')", [campId]);
      ok("FIX-26 the shown count equals the messages the send created", pv.body?.count === made[0].n && made[0].n === state.captured.length,
        { shown: pv.body?.count, created: made[0].n, sink: state.captured.length });
      ok("FIX-26 the send answers with the same count", send.body?.recipientCount === pv.body?.count, { send: send.body, shown: pv.body?.count });
    }
    ok("clean donor received the campaign", to(cleanEmail).length === 1, { delivered: to(cleanEmail).length });
    ok("suppressed donor did NOT receive the campaign", to(donorEmail).length === 0, { delivered: to(donorEmail).length });
    ok("do-not-contact donor did NOT receive the campaign", to(dncEmail).length === 0, { delivered: to(dncEmail).length });
    ok("deceased donor did NOT receive the campaign", to(deadEmail).length === 0, { delivered: to(deadEmail).length });
    // WHY-1 Part 8 — a partial send says so: it is "sent", it counts only the
    // one the provider took, and the rows that did not go keep their reasons.
    const [cr] = await q("SELECT status, recipient_count FROM campaigns WHERE id=$1", [campId]);
    const fails = await q("SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1 AND failure_reason IS NOT NULL", [campId]);
    ok("§8a a partial send is sent, counting only what the provider accepted", cr.status === "sent" && cr.recipient_count === 1 && fails[0].n >= 1, { cr, fails: fails[0] });
  }

  // ── §6 receipts are transactional too ────────────────────────────────────
  console.log("\n§6 a receipt reaches a marketing-suppressed donor");
  {
    await q(`UPDATE orgs SET receipts_enabled=true, legal_name='W4 Mailworks, Inc.', ein='12-3456789', receipt_address='1 Test Way, Testville, TS 00000' WHERE id=$1`, [orgId]);
    const gift = await api("POST", `/donors/${donorId}/gifts`, tok, { amount: 300, date: today(), idempotencyKey: crypto.randomUUID() });
    const giftId = gift.body?.gift?.id;
    state.captured.length = 0;
    const rc = await api("POST", `/gifts/${giftId}/receipt`, tok, {});
    ok("receipt issued for the suppressed donor", rc.status === 200 || rc.status === 201, rc.body);
    await settle();
    ok("receipt email DELIVERED despite marketing suppression", to(donorEmail).length === 1, { delivered: to(donorEmail).length });
    const rrow = await q("SELECT sent_to FROM receipts WHERE org_id=$1 AND gift_id=$2", [orgId, giftId]);
    ok("receipt row records the real delivery (sent_to set)", rrow[0]?.sent_to === donorEmail, rrow[0]);
  }

  // ── §7 volunteer mail rides the same decision (FIX-14 Part 4) ────────────
  // A volunteer is a row in donors, so a bounced or deceased volunteer gets
  // no shift reminder and no page link, while a clean one gets both. Reads
  // through the real sweep and the real route, captured in the local sink.
  console.log("\n§7 volunteer reminders and page links skip bounced and deceased people");
  {
    const CLEAN = "jonathan@stewardapp.dev";
    const bouncedEmail = `vol-bounced-${uniq()}@example.com`;
    const deadEmail = `vol-dead-${uniq()}@example.com`;
    const mk = async (name, em) => (await api("POST", "/donors", tok, { name, email: em })).body.id;
    const cleanId = await mk("Clean Volunteer", CLEAN);
    const bouncedId = await mk("Bounced Volunteer", bouncedEmail);
    const deadId = await mk("Deceased Volunteer", deadEmail);
    // Bounced: the global deliverability row the Resend webhook writes.
    await q("INSERT INTO email_suppressions (id, org_id, email, reason, source) VALUES ($1,NULL,$2,'bounced','resend_webhook')",
      ["sup_" + uniq(), bouncedEmail]);
    await api("PUT", `/donors/${deadId}`, tok, { name: "Deceased Volunteer", email: deadEmail, deceased: true });
    await q("UPDATE orgs SET volunteer_reminders_enabled=true WHERE id=$1", [orgId]);
    // "Tomorrow" is in the org's timezone; one of UTC today..today+2 is it,
    // so each person is confirmed on all three and exactly one is due.
    const oppId = "vo_" + uniq();
    await q(`INSERT INTO volunteer_opportunities (id, org_id, name, slug, created_by, created_by_name)
             VALUES ($1,$2,'Pantry Shift',$3,'system:test','Test')`, [oppId, orgId, "pantry-" + uniq()]);
    for (let k = 0; k < 3; k++) {
      const date = new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);
      const slotId = "vs_" + uniq();
      await q(`INSERT INTO volunteer_slots (id, org_id, opportunity_id, date, start_time, end_time, created_by, created_by_name)
               VALUES ($1,$2,$3,$4,'09:00','12:00','system:test','Test')`, [slotId, orgId, oppId, date]);
      for (const pid of [cleanId, bouncedId, deadId])
        await q(`INSERT INTO volunteer_signups (id, org_id, slot_id, person_id, status, created_by, created_by_name)
                 VALUES ($1,$2,$3,$4,'confirmed','system:test','Test')`, ["su_" + uniq(), orgId, slotId, pid]);
    }
    state.captured.length = 0;
    // PARITY-3: the sweep DRAFTS (it sends nothing), and a person presses
    // Send. The suppression rules apply at that press, to every draft.
    const run = await api("POST", "/volunteer-hub/run-reminders", tok, {});
    ok("the reminder sweep runs", run.status === 200, run.body);
    await settle();
    ok("…and sends nothing by itself", to(CLEAN).length === 0 && to(bouncedEmail).length === 0 && to(deadEmail).length === 0,
      { clean: to(CLEAN).length });
    const sendAll = async () => {
      const d = await api("GET", "/volunteer-hub/drafts?kind=volunteer_reminder", tok);
      const ids = ((d.body && d.body.drafts) || []).map(x => x.id);
      return api("POST", "/volunteer-hub/drafts/send", tok, { ids });
    };
    const pressed = await sendAll();
    ok("staff press Send on the reminder drafts", pressed.status === 200, pressed.body);
    await settle();
    ok("the clean volunteer got exactly one shift reminder", to(CLEAN).length === 1, { delivered: to(CLEAN).length });
    ok("the bounced volunteer got NO shift reminder", to(bouncedEmail).length === 0, { delivered: to(bouncedEmail).length });
    ok("the deceased volunteer got NO shift reminder", to(deadEmail).length === 0, { delivered: to(deadEmail).length });

    state.captured.length = 0;
    const lb = await api("POST", "/volunteer-hub/magic-link", tok, { personId: bouncedId, send: true });
    ok("the page link to a bounced volunteer is not emailed, and says so", lb.status === 200 && lb.body.sent === false && /bounced/.test(lb.body.message || ""), lb.body);
    const lc = await api("POST", "/volunteer-hub/magic-link", tok, { personId: cleanId, send: true });
    ok("the page link to a clean volunteer is emailed", lc.status === 200 && lc.body.sent === true, lc.body);
    await settle();
    ok("…and only the clean one reached the sink", to(CLEAN).length === 1 && to(bouncedEmail).length === 0,
      { clean: to(CLEAN).length, bounced: to(bouncedEmail).length });

    // WHY-1 Part 8 (c) — a refused reminder is NOT sent: the claim is released,
    // the reason kept, and the next run inside a day does not try again.
    const lateEmail = `vol-late-${uniq()}@example.com`;
    const lateId = await mk("Late Volunteer", lateEmail);
    const lateSlots = await q(`SELECT DISTINCT slot_id FROM volunteer_signups WHERE org_id=$1 AND person_id=$2`, [orgId, cleanId]);
    for (const { slot_id } of lateSlots)
      await q(`INSERT INTO volunteer_signups (id, org_id, slot_id, person_id, status, created_by, created_by_name)
               VALUES ($1,$2,$3,$4,'confirmed','system:test','Test')`, ["su_" + uniq(), orgId, slot_id, lateId]);
    state.mode = "fail";
    await api("POST", "/volunteer-hub/run-reminders", tok, {});
    await sendAll();
    await settle();
    const lateRows = await q(`SELECT status, send_error FROM milestone_drafts WHERE org_id=$1 AND donor_id=$2 AND source='volunteer_reminder'`, [orgId, lateId]);
    ok("§8c a refused reminder is not marked sent, and keeps its reason", lateRows.length === 1 && lateRows[0].status === "failed" && !!lateRows[0].send_error, lateRows);
    const before = state.attempts;
    await api("POST", "/volunteer-hub/run-reminders", tok, {});
    await sendAll();
    await settle();
    ok("§8c the next run and the next press do not try it again (no storm)", state.attempts === before, { before, after: state.attempts });
    state.mode = "ok";
    await q("UPDATE orgs SET volunteer_reminders_enabled=false WHERE id=$1", [orgId]);
  }

  // ── §8 HONEST "SENT" (WHY-1 Part 8) ──────────────────────────────────────
  console.log("\n§8 a campaign nobody received is Failed; a refused onboarding email waits a day");
  {
    // (a) every recipient refused by the provider: Failed, never Sent.
    const lone = `lone-w4-${uniq()}@test.local`;
    await api("POST", "/donors", tok, { name: "Lone Reader", email: lone });
    const camp = await api("POST", "/campaigns", tok, { name: "W4 All Fail " + uniq(), subject: "Hello", body: "Hi", audience: "all" });
    const campId = camp.body?.id || camp.body?.campaign?.id;
    state.mode = "fail";
    await api("POST", `/campaigns/${campId}/send`, tok, {});
    await settle(2500);
    state.mode = "ok";
    const [c] = await q("SELECT status, recipient_count FROM campaigns WHERE id=$1", [campId]);
    ok("§8a a campaign where every recipient failed is Failed, with nobody counted", c.status === "failed" && c.recipient_count === 0, c);

    // (b) MAIL-1: an onboarding enrolment left over from before is STOPPED by
    // the engine and sends nothing, provider up or down (this replaces WHY-1's
    // "retried a day later": the onboarding sequence is off for good).
    const seqId = "seq_w4_" + uniq(), enrId = "se_w4_" + uniq();
    await q(`INSERT INTO sequences (id, org_id, name, trigger, status, created_by, created_by_name) VALUES ($1,$2,'Onboarding','onboarding','active','system:test','Test')`, [seqId, orgId]);
    await q(`INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES ($1,$2,0,0,'Welcome','Hi {{first_name}}'), ($3,$2,1,2,'Next','Hi')`,
      ["ss_w4a_" + uniq(), seqId, "ss_w4b_" + uniq()]);
    const [u] = await q("SELECT id FROM users WHERE org_id=$1 LIMIT 1", [orgId]);
    await q(`INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at) VALUES ($1,$2,$3,$4,0,'active',NOW() - INTERVAL '1 minute')`,
      [enrId, seqId, orgId, u.id]);
    state.captured.length = 0;
    const att0 = state.attempts;
    await api("POST", "/sequences/process", tok, {});
    const [e1] = await q("SELECT current_step, status, last_error FROM sequence_enrollments WHERE id=$1", [enrId]);
    ok("§8b a leftover onboarding enrolment is stopped, with its reason", e1.status === "stopped" && /off for good/.test(e1.last_error || ""), e1);
    ok("§8b …and nothing reached the provider", state.attempts === att0, { attempts: state.attempts - att0 });
    await q("UPDATE sequence_enrollments SET status='completed' WHERE id=$1", [enrId]);
  }

  // ── §9 MAIL-1 · NOTHING UNTIL THE DONOR FILE IS IN ───────────────────────
  // An org whose mail a super-admin switched ON but which has imported no
  // donor file: no digest, no Week in Review, no onboarding mail, no donor
  // mail, and still a password reset. One real donor imported, and the digest,
  // a receipt and a campaign go (the unsubscribed donor still does not).
  // A demo org sends nothing but sign-in mail, whatever its switches say.
  // Proven able to fail: with the `not_onboarded` arm removed from
  // mailPolicy.orgMailDecision, §9a's digest and campaign assertions go red.
  console.log("\n§9 MAIL-1: nothing until the donor file is in");
  {
    const sentTo = addr => to(addr).length;
    const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
    const keep = `m1-keep-${uniq()}@test.local`, gone = `m1-gone-${uniq()}@test.local`;
    const dKeep = (await api("POST", "/donors", m1Tok, { name: "Kit Keeps", email: keep })).body.id;
    await api("POST", "/donors", m1Tok, { name: "Gil Gone", email: gone });
    await q("INSERT INTO email_suppressions (id, org_id, email, reason, source) VALUES ($1,$2,$3,'unsubscribe','campaign')", ["sup_" + uniq(), m1Org, gone]);
    const gift = await api("POST", `/donors/${dKeep}/gifts`, m1Tok, { amount: 50, date: today(), idempotencyKey: crypto.randomUUID() });
    const giftId = gift.body?.gift?.id;
    await settle(1500);
    state.captured.length = 0;

    // §9a before onboarding
    const [pre] = await q("SELECT onboarded_at FROM orgs WHERE id=$1", [m1Org]);
    ok("§9a an org with no import is not onboarded", pre.onboarded_at === null, pre);
    const dg = await api("POST", "/digests/run", m1Tok, { type: "weekly", weekStart: monday });
    ok("§9a the digest is refused, by name", dg.body?.weekly?.gated === "not_onboarded" || dg.body?.gated === "not_onboarded", dg.body);
    const camp0 = await api("POST", "/campaigns", m1Tok, { name: "M1 Early " + uniq(), subject: "Early", body: "Hi", audience: "all" });
    await api("POST", `/campaigns/${camp0.body?.id || camp0.body?.campaign?.id}/send`, m1Tok, {});
    await settle(2000);
    const seq = await q("SELECT COUNT(*)::int c FROM sequences WHERE org_id=$1 AND trigger='onboarding'", [m1Org]);
    ok("§9a no onboarding sequence exists for the new org", seq[0].c === 0, seq[0]);
    ok("§9a zero digests and zero Week in Review reached its admin", sentTo(m1Admin) === 0, { n: sentTo(m1Admin) });
    ok("§9a zero campaign mail reached its donors", sentTo(keep) === 0 && sentTo(gone) === 0, { keep: sentTo(keep), gone: sentTo(gone) });
    const fp = await fetch(BASE + "/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: m1Admin }) });
    await settle();
    ok("§9a …and a password reset still goes", fp.status < 300 && sentTo(m1Admin) === 1, { s: fp.status, n: sentTo(m1Admin) });

    // §9b one real donor imported -> onboarded
    const runId = "imp_m1" + Date.now().toString(36);
    const real = `m1-real-${uniq()}@test.local`;
    const im = await api("POST", "/donors/import-combined", m1Tok, { donors: [{ name: "Ivy Imported", email: real }], gifts: [], importId: runId });
    const rec = await api("POST", "/imports", m1Tok, { id: runId, name: "donors.csv", sourceFilename: "donors.csv", shape: "donors", donorsCreated: 1, rowsIn: 1 });
    const [post] = await q("SELECT onboarded_at, onboarded_via FROM orgs WHERE id=$1", [m1Org]);
    ok("§9b an import of one real donor onboards the org, dated", im.status < 300 && rec.status < 300 && !!post.onboarded_at && post.onboarded_via === "import:" + runId,
      { im: im.status, rec: rec.status, post });
    await settle(5200);   // the 5s org-gate cache
    state.captured.length = 0;
    const dg2 = await api("POST", "/digests/run", m1Tok, { type: "weekly", weekStart: monday });
    await settle();
    ok("§9b the digest now reaches the admin", !dg2.body?.weekly?.gated && sentTo(m1Admin) >= 1, { b: dg2.body, n: sentTo(m1Admin) });
    const rc = await api("POST", `/gifts/${giftId}/receipt`, m1Tok, {});
    await settle();
    ok("§9b a receipt is sent", rc.status < 300 && sentTo(keep) === 1, { s: rc.status, b: rc.body, n: sentTo(keep) });
    state.captured.length = 0;
    const camp = await api("POST", "/campaigns", m1Tok, { name: "M1 After " + uniq(), subject: "After", body: "Hi", audience: "all" });
    await api("POST", `/campaigns/${camp.body?.id || camp.body?.campaign?.id}/send`, m1Tok, {});
    await settle(2500);
    ok("§9b a campaign to 3 donors (1 unsubscribed) sends 2", sentTo(keep) === 1 && sentTo(real) === 1 && sentTo(gone) === 0,
      { keep: sentTo(keep), real: sentTo(real), gone: sentTo(gone) });
    ok("§9 the onboarding sequence sent nothing, in any case", !state.captured.some(m => /great decision for your mission/i.test(m.subject || "")), null);

    // §9c a demo org: switches on, stamped onboarded, still only sign-in mail
    state.captured.length = 0;
    const dd = `m1-demo-donor-${uniq()}@test.local`;
    await api("POST", "/donors", dmTok, { name: "Dee Demo", email: dd });
    const dcamp = await api("POST", "/campaigns", dmTok, { name: "Demo " + uniq(), subject: "Demo", body: "Hi", audience: "all" });
    await api("POST", `/campaigns/${dcamp.body?.id || dcamp.body?.campaign?.id}/send`, dmTok, {});
    await api("POST", "/digests/run", dmTok, { type: "weekly", weekStart: monday });
    await settle(2000);
    ok("§9c a demo org sends no donor mail and no digest", sentTo(dd) === 0 && sentTo(demoAdmin) === 0, { donor: sentTo(dd), admin: sentTo(demoAdmin) });
    await fetch(BASE + "/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: demoAdmin }) });
    await settle();
    ok("§9c …but its login still gets a password reset", sentTo(demoAdmin) === 1, { n: sentTo(demoAdmin) });
  }

  sink.srv.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
