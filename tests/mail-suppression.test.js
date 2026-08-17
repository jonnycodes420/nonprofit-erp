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

const { ok, summary, api, q, closeDb, BASE } = require("./helpers");
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");

const uniq = () => Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);

// Capture sink on :5602 (the server's RESEND_BASE_URL). `mode` can be flipped
// to "fail" so the provider rejects — the log-honesty leg.
function startSink(port = 5602) {
  const state = { captured: [], mode: "ok" };
  const srv = http.createServer((req, res) => {
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
  if (!sink) { console.error("could not bind :5602 — another sink running?"); process.exit(1); }
  const { state } = sink;
  const to = addr => state.captured.filter(m => (Array.isArray(m.to) ? m.to : [m.to]).includes(addr));

  // ── fixture: org + suppressed donor with an at-risk recurring gift ───────
  const email = `b58w4-admin-${uniq()}@test.local`;
  const reg = await fetch(BASE + "/auth/register-org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "W4 Mailworks " + uniq(), userName: "W4 Admin", email, password: "loadtest1234" }),
  }).then(r => r.json());
  const tok = reg.token, orgId = reg.org.id;
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
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
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
    state.captured.length = 0;
    const send = await api("POST", `/campaigns/${campId}/send`, tok, {});
    ok("campaign send queued", send.status === 200, send.body);
    await settle(1500);
    ok("clean donor received the campaign", to(cleanEmail).length === 1, { delivered: to(cleanEmail).length });
    ok("suppressed donor did NOT receive the campaign", to(donorEmail).length === 0, { delivered: to(donorEmail).length });
    ok("do-not-contact donor did NOT receive the campaign", to(dncEmail).length === 0, { delivered: to(dncEmail).length });
    ok("deceased donor did NOT receive the campaign", to(deadEmail).length === 0, { delivered: to(deadEmail).length });
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

  sink.srv.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
