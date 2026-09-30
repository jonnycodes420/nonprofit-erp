// tests/fix10-gift-delete-tasks.test.js — FIX-10 Part C, the build's ONE test.
//
// WHAT IT GUARDS: the record of what an organisation said, or did not say, to a
// donor. Deleting a gift used to leave that gift's own tasks standing. A
// director then read "Thank Ruth, $500 just came in" against a $500 gift that
// existed nowhere, could not tell it from a task she had typed herself, and
// either thanked Ruth for nothing or ticked it off believing she had.
//
// THE RULE, both halves, because half of it is the dangerous half:
//   1. Deleting a gift voids EXACTLY the tasks that gift created.
//   2. Tasks a person wrote by hand are NEVER touched.
//
// The predicate is tasks.source_gift_id, stamped only where a gift's arrival
// creates a task, so (2) holds by construction. This suite is what proves the
// construction, and it asserts the negative first: if a future build starts
// matching on donor_id or on the title, the hand-written assertion goes red.
//
// NO UNDO CLAUSE. Checked before writing this: DELETE /gifts/:id is a hard
// delete (routes/crm.js), the profile's Delete is a confirm and a reload with
// no undo offered, and there is no restore or undelete endpoint for a gift
// anywhere in the API. Restore-on-undo would be new product, so the brief's
// scope check applies and the void-only behavior IS the whole test. The day an
// undo lands, this file grows a third assertion.
//
// PROVEN ABLE TO FAIL — three defects were planted and each turned it red:
//   · voiding by donor_id instead of source_gift_id → the hand-written task
//     assertion fails (it gets voided with the others).
//   · dropping `AND voided_at IS NULL` from the donor's task read → the
//     "only the hand-written one is left" assertion fails.
//   · skipping the timeline note → the note assertion fails.
const { ok, summary, api, q, civilToday, waitFor } = require("./helpers");

const STAMP = "fix10gdt";

(async () => {
  // Clean slate, this fixture's own org only — found by its admin's address,
  // because register-org mints the org id. Re-runnable, and it can never reach
  // another org's rows.
  const email = `${STAMP}@stewardapp.dev`;
  const priorOrg = (await q(`SELECT org_id FROM users WHERE email=$1`, [email]).catch(() => []))[0]?.org_id;
  if (priorOrg) {
    for (const t of ["interactions", "tasks", "fin_transactions", "gifts", "donors", "users"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [priorOrg]).catch(() => {});
    }
    await q(`DELETE FROM orgs WHERE id=$1`, [priorOrg]).catch(() => {});
  }

  const reg = await fetch((process.env.BASE || "http://localhost:5601") + "/auth/register-org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Gift Delete Tasks (fix10)", userName: "Fixture",
      email, password: "loadtest1234", provisioned: true, demoData: false }),
  });
  const regBody = await reg.json();
  if (reg.status !== 201 || !regBody.token) { console.error("register-org failed", reg.status, regBody); process.exit(1); }
  const tok = regBody.token, orgId = regBody.org.id;
  const today = civilToday();

  const d = await api("POST", "/donors", tok, { name: "Ruth Calloway", email: `ruth.${STAMP}@example.org` });
  const donorId = d.body?.id;
  ok("a donor to hang this on", !!donorId, { status: d.status, body: d.body });

  // A gift, recorded through the one gift path. Whatever tasks the org's own
  // workflows make from it are the tasks under test — the suite never invents
  // them, because a fixture that invents its own subject proves nothing about
  // the code that makes the real one.
  const gift = await api("POST", `/donors/${donorId}/gifts`, tok,
    { amount: 500, date: today, type: "cash", paymentMethod: "Check" });
  const giftId = gift.body?.gift?.id || gift.body?.id;
  ok("the gift recorded", (gift.status === 200 || gift.status === 201) && !!giftId, { status: gift.status, body: gift.body });

  // Its own tasks, stamped with it. The workflow that makes them runs AFTER the
  // gift POST answers, so this waits for them: reading straight through raced
  // the insert and saw zero, which would have passed the delete assertion for
  // the wrong reason (nothing to void is not the same as nothing voided).
  const own = await waitFor(async () => {
    const r = await q(`SELECT id, title FROM tasks WHERE org_id=$1 AND source_gift_id=$2`, [orgId, giftId]);
    return r.length ? r : null;
  }) || [];
  ok(`the gift's arrival created at least one task, stamped with the gift (${own.length})`,
    own.length >= 1, own);

  // And one a person typed, on the SAME donor, so a lazy predicate on donor_id
  // would take it out with the rest.
  const hand = await api("POST", "/tasks", tok,
    { title: "Call her about the spring lunch", due: today, donorId });
  ok("a hand-written task on the same donor", hand.status === 201, { status: hand.status, body: hand.body });
  const handId = hand.body?.id;
  ok("the hand-written task carries NO source gift, which is what protects it",
    (await q(`SELECT source_gift_id FROM tasks WHERE id=$1`, [handId]))[0]?.source_gift_id == null);

  // ── the delete ────────────────────────────────────────────────────────────
  const del = await api("DELETE", `/gifts/${giftId}`, tok);
  ok(`the delete succeeded and reports what it voided (${del.body?.voidedTasks})`,
    del.status === 200 && del.body?.voidedTasks === own.length, { status: del.status, body: del.body });

  // 1. exactly the gift's tasks are voided
  const voided = await q(
    `SELECT id, voided_reason, source_gift_id FROM tasks WHERE org_id=$1 AND voided_at IS NOT NULL`, [orgId]);
  ok(`exactly the gift's own ${own.length} task(s) are voided, no more and no fewer`,
    voided.length === own.length && voided.every(r => r.source_gift_id === giftId), voided);
  ok("each voided row says why", voided.every(r => r.voided_reason === "gift_deleted"), voided);
  ok("they are VOIDED rows, not deleted ones: the record survives the cancellation",
    (await q(`SELECT COUNT(*)::int n FROM tasks WHERE id = ANY($1::text[])`, [own.map(t => t.id)]))[0].n === own.length);

  // 2. the hand-written one is untouched, and it is the only thing left on the list
  const handRow = (await q(`SELECT voided_at, title FROM tasks WHERE id=$1`, [handId]))[0];
  ok("the hand-written task was NOT voided", handRow && handRow.voided_at == null, handRow);
  const left = (await api("GET", `/donors/${donorId}/tasks`, tok)).body || [];
  ok("the donor's task list shows exactly the hand-written task",
    left.length === 1 && left[0].id === handId, left.map(t => t.title));

  // the day view and Home's counts cannot carry a cancelled thank-you either
  const dayJson = JSON.stringify((await api("GET", "/dashboard/today", tok)).body || {});
  ok("no voided task reaches the day view",
    own.every(t => !dayJson.includes(t.title)), own.map(t => t.title));

  // 3. the timeline says what happened, on the donor's own record
  const prof = await api("GET", `/donors/${donorId}`, tok);
  const notes = (prof.body?.interactions || []).map(i => String(i.note || ""));
  ok('the timeline reads "Gift removed, thank-you cancelled."',
    notes.some(n => n.startsWith("Gift removed, thank-you cancelled.")), notes.slice(0, 5));

  summary();
})().catch(e => { console.error(e); process.exit(1); });
