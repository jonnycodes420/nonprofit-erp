// THREAD-2a — NO JOURNEY STEP EVER SENDS ANYTHING TO A DONOR.
//
// THE ONE TEST THIS BUILD ADDS, and it guards the line that is never crossed:
// agents read, draft and propose; a human signs anything that reaches a donor.
//
// A journey is the most dangerous thing in this product to get wrong. It fires
// on its own — a gift lands, a stage moves, a volunteer signs up, and Steward
// writes seven steps against a real person's record with nobody watching. If
// any one of those steps could send, then "she wrote every word, she turned it
// on, and each send is hers" would be false for the whole feature, and it
// would be false silently, at 3am, to a real donor.
//
// So this walks the WHOLE journey path end to end with a live Resend sink
// bound, and asserts that the sink saw NOTHING. Not "no marketing email" —
// nothing at all.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red before the green
// was trusted):
//   · a preset step given a `send: true` / mail call        → §3 fails
//   · maybeStartJourney mailing the donor on start          → §3 fails
//   · advanceCultivationPlan mailing when a step opens      → §3 fails
//   · `requiresConfirmation` made a per-step setting        → §1 fails
//   · mark-done accepting no line                           → §4 fails
//
//   §1  the catalogue: every step requires confirmation, no step can send
//   §2  the shape module holds the line in code, not in prose
//   §3  the whole path fires and the mail sink stays EMPTY
//   §4  a step closes only on a human action, with a line
//   §5  at most one journey, and the replacement reason is written down
//
// Run on the scratch stack: BASE, DATABASE_URL, SINK_PORT (tests/run-all.sh).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");

const ORG = "org_t2anosend";
const ADMIN = "t2a-admin@t.local";
const PW = "loadtest1234";

// ── THE MAIL SINK ─────────────────────────────────────────────────────────
// The server is booted with RESEND_BASE_URL pointing here. Anything that
// tries to mail ANYBODY during this suite lands in `captured`, and §3's whole
// assertion is that the array is empty.
const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        captured.push({ url: req.url, method: req.method, body: body.slice(0, 4000) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}

async function reset() {
  await q(`DELETE FROM cultivation_plan_steps WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM cultivation_plans WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM cultivation_templates WHERE org_id=$1`, [ORG]).catch(() => {});
  // Every org is born with a ledger (BUILD-58 W-3), and `accounts` /
  // `fin_funds` hold a foreign key to the org — so an org row cannot be
  // deleted until they are. Leaving them behind made the second run of this
  // suite fail on `orgs_pkey`, which reads like a product bug and is a
  // fixture that did not clean up after itself.
  for (const t of ["threads", "interactions", "fin_transactions", "gifts", "moves",
                   "donors", "users", "accounts", "budgets", "fin_funds", "fin_audit_log"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  const J = await import("../shared/journeyShape.js");
  const sink = await startSink();

  console.log("— §1 · the catalogue: every step requires confirmation, no step can send —");
  const steps = J.allPresetSteps();
  ok("five presets, and they are the brief's five",
     J.PRESET_KEYS.join(",") === "new_donor_first_year,major_donor,welcome_back,monthly_giver,new_volunteer",
     J.PRESET_KEYS);
  ok("…and the first-year one is the brief's seven touches over seven months",
     J.touchesSentence(J.presetByKey("new_donor_first_year").steps)
       === "7 touches over 7 months. Nothing is sent without you.",
     J.touchesSentence(J.presetByKey("new_donor_first_year").steps));
  ok(`every step in the catalogue requires a person to confirm (${steps.length} steps)`,
     steps.length > 0 && steps.every(s => J.requiresConfirmation(s) === true));
  // THE SHAPE OF A STEP CANNOT EXPRESS A SEND. Not "is set to false" — there
  // is no field for it, which is a stronger property than any default.
  const sendish = steps.filter(s =>
    Object.keys(s).some(k => /^(send|autoSend|auto_send|email|mailTo|sendAt|schedule)$/i.test(k)));
  ok("…and no step carries a field that could mean 'send this'",
     sendish.length === 0, sendish.map(s => `${s.preset}:${s.label}`));
  const drafted = steps.filter(s => s.draft);
  ok(`the steps that carry a DRAFT still require confirmation (${drafted.length} of them)`,
     drafted.length > 0 && drafted.every(s => J.requiresConfirmation(s) === true));

  console.log("\n— §2 · the line is held in code, not in prose —");
  ok("requiresConfirmation is unconditional — it is not a per-step setting an org can turn off",
     J.requiresConfirmation({ draft: null }) === true
     && J.requiresConfirmation({ draft: "the_ask", autoSend: true }) === true
     && J.requiresConfirmation({}) === true);
  ok("a journey needs a trigger, and an unknown one is refused",
     J.validateJourney({ name: "X", trigger: "whenever", steps: [{ type: "thank", label: "a", offsetDays: 1 }] }).errors
       .some(e => e.field === "trigger"));
  ok("…and a draft Steward does not write is refused, never silently dropped",
     J.validateJourney({ name: "X", trigger: "by_hand",
       steps: [{ type: "thank", label: "a", offsetDays: 1, draft: "wire_transfer" }] }).errors
       .some(e => /draft/.test(e.field)));

  console.log("\n— §3 · the whole path fires, and the mail sink stays EMPTY —");
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled)
           VALUES ($1,'Journey HQ','journey-hq',1,'active','t1000_monthly',true)`, [ORG]);
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_t2a',$1,$2,$3,'Maria','admin')`, [ORG, ADMIN, hash]);
  const admin = await login(ADMIN);

  // MAIL IS ON for this org, deliberately. Testing "nothing was sent" against
  // an org whose mail is switched off would prove nothing at all — the gate
  // would be doing the work and the journey code could be mailing freely.
  const gate = await q(`SELECT emails_enabled FROM orgs WHERE id=$1`, [ORG]);
  ok("the fixture org has mail ON, so 'nothing was sent' is about the journey and not the gate",
     gate[0].emails_enabled === true, gate[0]);

  // Arm two journeys: the first-gift welcome, and a major-donor one that
  // outranks it above $10,000.
  const mk = async (presetKey, over) => {
    const r = await api("POST", "/journeys", admin, {
      presetKey, enabled: true, ...(over ? { amountCents: over } : {}),
    });
    ok(`armed ${presetKey}`, r.status === 201, r.status + " " + JSON.stringify(r.body).slice(0, 160));
    return r.body.id;
  };
  const firstYearId = await mk("new_donor_first_year");
  const majorId = await mk("major_donor", 1000000);   // $10,000

  const before = captured.length;

  // A donor, and a first gift through the real gift path.
  const dr = await api("POST", "/donors", admin, { name: "Margaret Chen", email: "margaret-t2a@example.org" });
  ok("a donor was created", dr.status === 201 || dr.status === 200, dr.status);
  const donorId = dr.body.id || dr.body.donor?.id;

  const g1 = await api("POST", `/donors/${donorId}/gifts`, admin, { amount: 500, date: new Date().toISOString().slice(0, 10) });
  ok("a first gift was recorded", g1.status === 201 || g1.status === 200, g1.status + " " + JSON.stringify(g1.body).slice(0, 140));
  // The engine runs after the response; give it a moment to land.
  await new Promise(r => setTimeout(r, 1200));

  const plans = await q(
    `SELECT id, template_name, trigger_key, priority, status FROM cultivation_plans
      WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, donorId]);
  ok("the first gift started the first-year journey",
     plans.some(p => p.status === "active" && p.trigger_key === "first_gift"), plans);

  const stepRows = await q(
    `SELECT st.* FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id=st.plan_id
      WHERE p.org_id=$1 AND p.donor_id=$2 AND p.status='active' ORDER BY st.seq`, [ORG, donorId]);
  ok("…with seven steps written against the record", stepRows.length === 7, stepRows.length);
  ok("…exactly one of them open, the rest pending — the plan machinery's own rule",
     stepRows.filter(s => s.status === "open").length === 1
     && stepRows.filter(s => s.status === "pending").length === 6,
     stepRows.map(s => s.status).join(","));
  ok("…and the drafted steps kept their draft kind",
     stepRows.filter(s => s.draft_kind).length === 3, stepRows.map(s => s.draft_kind).join(","));

  // THE ASSERTION THE WHOLE FILE EXISTS FOR.
  ok("§3 NOTHING WAS SENT — the mail sink saw no request at all while a journey "
     + "started and wrote seven steps",
     captured.length === before,
     `sink captured ${captured.length - before} request(s): ` + JSON.stringify(captured.slice(before)).slice(0, 400));

  console.log("\n— §4 · a step closes only on a human action, with a line —");
  const open = stepRows.find(s => s.status === "open");
  const noNote = await api("POST", `/plan-steps/${open.id}/done`, admin, {});
  ok("marking done with no line is refused", noNote.status === 400 && noNote.body.error === "note_required", noNote.status);
  const stillOpen = await q(`SELECT status FROM cultivation_plan_steps WHERE id=$1`, [open.id]);
  ok("…and the step is still open", stillOpen[0].status === "open", stillOpen[0]);

  const done = await api("POST", `/plan-steps/${open.id}/done`, admin, { note: "Called her, she was delighted." });
  ok("with a line it closes", done.status === 200, done.status + " " + JSON.stringify(done.body).slice(0, 140));
  const after4 = await q(
    `SELECT status, done_note FROM cultivation_plan_steps WHERE id=$1`, [open.id]);
  ok("…the line is kept on the step", after4[0].status === "done" && /delighted/.test(after4[0].done_note || ""), after4[0]);
  const timeline = await q(
    `SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note ILIKE '%delighted%'`, [ORG, donorId]);
  ok("…and lands on their record as a real conversation, so Last contact is true",
     timeline.length === 1, timeline);
  const nextOpen = await q(
    `SELECT st.seq, st.status FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id=st.plan_id
      WHERE p.org_id=$1 AND p.donor_id=$2 AND p.status='active' AND st.status='open'`, [ORG, donorId]);
  ok("…and the NEXT step is scheduled in the same breath",
     nextOpen.length === 1 && Number(nextOpen[0].seq) === 2, nextOpen);

  // Skip asks why, and keeps the answer.
  const sk = await api("POST", `/plan-steps/${nextOpen.length ? (await q(
    `SELECT st.id FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id=st.plan_id
      WHERE p.org_id=$1 AND p.donor_id=$2 AND st.status='open'`, [ORG, donorId]))[0].id : "x"}/skip`,
    admin, { reason: "She asked us not to post anything." });
  ok("skip keeps the reason", sk.status === 200 && /not to post/.test(sk.body.reason || ""), sk.status + " " + JSON.stringify(sk.body).slice(0, 120));

  console.log("\n— §5 · at most one journey, and the reason is written down —");
  const g2 = await api("POST", `/donors/${donorId}/gifts`, admin, { amount: 25000, date: new Date().toISOString().slice(0, 10) });
  ok("a $25,000 gift was recorded", g2.status === 201 || g2.status === 200, g2.status);
  await new Promise(r => setTimeout(r, 1200));

  const active = await q(
    `SELECT id, template_name, priority, status, replaced_plan_id, replaced_reason
       FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, donorId]);
  const live = active.filter(p => p.status === "active");
  ok("§5 the donor is in AT MOST ONE journey", live.length === 1, active);
  ok("…and it is the major-donor one, because a $25,000 gift is a major gift "
     + "before it is anything else",
     live[0].template_name === "Major donor", live[0].template_name);
  const replaced = active.find(p => p.status === "abandoned");
  ok("…the one it replaced is stopped, not deleted", !!replaced, active.map(p => p.status).join(","));
  ok("…and the REASON is written down, in the words the screen shows",
     /takes priority/.test((live[0].replaced_reason || "") + (replaced?.replaced_reason || "")),
     { onNew: live[0].replaced_reason, onOld: replaced?.replaced_reason });

  ok("§5 …and STILL nothing was sent, through a replacement as well as a start",
     captured.length === before,
     `sink captured ${captured.length - before}: ` + JSON.stringify(captured.slice(before)).slice(0, 400));

  sink.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
