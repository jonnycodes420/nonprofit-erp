// tests/lib/numbers10DeleteChecks.js · NUMBERS-10 item 6 (W-1127-Finance-03), run by tests/real-shaped.test.js
// (§N10D; REAL_SHAPED_ONLY=N10D runs it alone).
//
// "Deleting a donor's gifts still leaves the 'Call to say thank you' journey step and note in place with no
// gift behind it." A person gives twice; the first gift starts "New donor, first year", whose first step is
// "Call to say thank you". Her gifts are deleted, newest first, as the fleet did. Then:
//   · the step is closed (skipped) and its call task voided, the journey stopped;
//   · the timeline has ONE line saying the thank-you was cancelled, naming the step;
//   · Undo of the gift brings back the gift, the step (open), the call (live) and takes the line away;
//   · every surface agrees (assertSurfacesAgree) after the delete and after the Undo.
// HOW IT GOES RED ON MAIN: no line on the timeline (the step was skipped silently; the timeline kept
// "Journey step: Call to say thank you, due …" with nothing after it). Planted: cancelLine skipped → red.
"use strict";
const crypto = require("crypto");

async function n10Delete({ ok, api, q, freshOrg, surfaces, drainQueue }) {
  console.log("\n— §N10D · deleting a gift closes its thank-you, with a line; Undo brings both back —");
  const ORG = "org_n10del";
  const tok = await freshOrg(ORG, "Numbers ten delete (test)");
  const one = async (sql, a) => (await q(sql, a))[0] || {};
  const day = n => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
  const j = await api("POST", "/journeys", tok, { name: "New donor, first year", trigger: "first_gift", enabled: true,
    steps: [{ type: "thank", label: "Call to say thank you", offsetDays: 2 }, { type: "send", label: "Send a handwritten note", offsetDays: 7 }] });
  const p = (await api("POST", "/donors", tok, { name: "Rufus Tallgrass", email: "rufus.tallgrass@numbers10.example" })).body || {};
  const gift = async (amount, d) => { const r = await api("POST", `/donors/${p.id}/gifts`, tok, { amount, date: day(d), idempotencyKey: crypto.randomUUID() });
    if (drainQueue) await drainQueue(q).catch(() => {}); return r.body && (r.body.gift ? r.body.gift.id : r.body.id); };
  const g1 = await gift(100, -10), g2 = await gift(40, -3);
  const st = async () => ({
    plan: await one("SELECT status, end_reason FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2", [ORG, p.id]),
    step: await one("SELECT s.status FROM cultivation_plan_steps s JOIN cultivation_plans c ON c.id=s.plan_id WHERE c.org_id=$1 AND c.donor_id=$2 AND s.label='Call to say thank you'", [ORG, p.id]),
    call: await one("SELECT voided_at IS NOT NULL AS voided FROM tasks WHERE org_id=$1 AND donor_id=$2 AND title='Call to say thank you'", [ORG, p.id]),
    lines: (await q("SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE 'Thank-you cancelled:%'", [ORG, p.id])).map(r => r.note),
  });
  const s0 = await st();
  ok("§N10D fixture: a first gift's journey with an open \"Call to say thank you\" step and its call",
    j.status === 201 && !!g1 && !!g2 && s0.plan.status === "active" && s0.step.status === "open" && s0.call.voided === false && !s0.lines.length, JSON.stringify(s0));
  const d2 = await api("DELETE", `/gifts/${g2}`, tok);
  const d1 = await api("DELETE", `/gifts/${g1}`, tok);
  const s1 = await st();
  ok("§N10D deleting her gifts closes the step and voids its call", d2.status === 200 && d1.status === 200
    && s1.plan.status === "abandoned" && s1.step.status === "skipped" && s1.call.voided === true, JSON.stringify([d1.body, s1]));
  ok("§N10D the timeline says the thank-you was cancelled, once, naming the step and the gift",
    s1.lines.length === 1 && /^Thank-you cancelled: the \$100 gift of [A-Z][a-z]{2} \d{1,2}, \d{4} was removed, so Call to say thank you \(New donor, first year\) is cancelled\.$/.test(s1.lines[0]), s1.lines);
  await surfaces(ORG, { step: "§N10D after the deletes", token: tok });
  const un = await api("POST", `/gifts/${g1}/restore`, tok, {});
  if (drainQueue) await drainQueue(q).catch(() => {});
  const s2 = await st();
  ok("§N10D Undo brings the gift, the open step and its call back, and takes the line away",
    un.status === 200 && !!(await one("SELECT id FROM gifts WHERE id=$1", [g1])).id && s2.plan.status === "active" && s2.step.status === "open"
    && s2.call.voided === false && !s2.lines.length, JSON.stringify([un.body, s2]));
  await surfaces(ORG, { step: "§N10D after the Undo", token: tok });
}

module.exports = { n10Delete };
