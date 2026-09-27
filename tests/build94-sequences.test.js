// BUILD-94 Part 3 — SEQUENCES.
//
// The brief's one test: a sequence with two tracks and three steps, five
// people enrolled, the clock advanced day by day —
//   · the right track per person, and the right copy per step
//   · one timeline line per send, naming who turned it on and when
//   · the second-gift skip fires
//   · the unsubscribe stop fires
//   · a retried job sends nothing twice
//   · an org with no timezone cannot turn it on
//
// Plus the rule the whole part rests on: SHE WROTE EVERY WORD, SHE TURNED IT
// ON, AND EACH SEND IS HERS. Steward writes nothing to a donor — asserted on
// the source, not remembered.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const http = require("http");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

// The scratch stack DOES set RESEND_API_KEY, so the engine really calls the
// provider. Without a sink on :5602 every send fails — correctly, and the
// engine's refusal to write a timeline line for an email that never left is
// exactly the behaviour that would then be untestable. So: a sink.
const captured = [];
const sink = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push(body ? JSON.parse(body) : null); } catch { captured.push(null); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});

const ORG = "org_b94s";        // has a human-confirmed timezone
const ORG_NOTZ = "org_b94s_ntz"; // has not
const root = path.join(__dirname, "..");

// Five people: two major, three small — so the two tracks both have somebody.
const PEOPLE = [
  { id: "d_b94s_1", name: "Maud Major",   email: "maud@b94s.test",   amount: 2500 },
  { id: "d_b94s_2", name: "Marcus Major", email: "marcus@b94s.test", amount: 1000 },
  { id: "d_b94s_3", name: "Sam Small",    email: "sam@b94s.test",    amount: 75 },
  { id: "d_b94s_4", name: "Sara Small",   email: "sara@b94s.test",   amount: 50 },
  { id: "d_b94s_5", name: "Stu Small",    email: "stu@b94s.test",    amount: 99 },
];

// A Tuesday morning in the org's zone — inside the weekday-morning window.
// Pinned rather than "now" so the suite does not pass or fail by the hour it
// is run at (the BUILD-84 rule for clock-dependent goldens).
// Pinned, not "now": the send window is weekday mornings in the org's zone,
// so a suite run at 3pm — or on a Saturday — would correctly send nothing and
// then fail for a reason that has nothing to do with the code. The route takes
// this only under TEST_MODE; production's tick passes no clock at all.
const TUESDAY_MORNING = "2026-09-22T14:30:00Z"; // 09:30 America/Chicago

async function fixture() {
  for (const org of [ORG, ORG_NOTZ]) {
    for (const t of ["sequence_sends", "sequence_enrollments", "email_suppressions",
                     "interactions", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM sequences WHERE org_id=$1)`, [org]).catch(() => {});
    await q(`DELETE FROM sequences WHERE org_id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  // BUILD-94 Part 4 — NO ADDRESS, NO SEND applies to sequences as well as
  // campaigns, so the org has to have one before anything here can send.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipt_address)
           VALUES ($1,'Justin Place Seq','b94s',1,'active','team','America/Chicago',NOW(),'1200 Justin Way, Fort Worth, TX 76107')
           ON CONFLICT (id) DO UPDATE SET timezone='America/Chicago', timezone_confirmed_at=NOW(),
             subscription_status='active', plan='team', receipt_address='1200 Justin Way, Fort Worth, TX 76107'`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'No Zone Arts','b94s-ntz',1,'active','team','America/New_York',NULL)
           ON CONFLICT (id) DO UPDATE SET timezone_confirmed_at=NULL,
             subscription_status='active', plan='team'`, [ORG_NOTZ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_b94s',$1,'b94s@test.local',$2,'Allie Barnett','admin',false)
           ON CONFLICT (id) DO UPDATE SET is_super_admin=false, org_id=EXCLUDED.org_id`, [ORG, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_b94s_sa',$1,'b94s-sa@test.local',$2,'Jonathan','admin',true)
           ON CONFLICT (id) DO UPDATE SET is_super_admin=true, org_id=EXCLUDED.org_id`, [ORG, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94s_n',$1,'b94s-n@test.local',$2,'No Zone','admin')
           ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id`, [ORG_NOTZ, hash]);
  for (const p of PEOPLE) {
    await q(`INSERT INTO donors (id,org_id,name,email,total_giving,last_gift_amount,last_gift_date,gift_count,status,stage,first_gift_date)
             VALUES ($1,$2,$3,$4,$5,$5,'2026-09-21',1,'new','steward','2026-09-21')`,
      [p.id, ORG, p.name, p.email, p.amount]);
  }
}

// Two tracks, three steps. The copy is HERS — every word below is what a
// person typed, which is the whole point.
const SEQUENCE = {
  name: "Welcome",
  trigger: "first_gift",
  tracks: [
    { key: "major", label: "Major", rule: "gift_major" },
    { key: "rest",  label: "Everyone else", rule: "everyone_else" },
  ],
  steps: [
    { trackKey: "major", dayOffset: 0, sendEvenAfterGift: true,
      subject: "Thank you, {{first}}", body: "Your gift of {{last_gift_amount}} means a great deal to us. — {{org_name}}" },
    { trackKey: "major", dayOffset: 3, sendEvenAfterGift: false,
      subject: "What your gift does, {{first}}", body: "Here is where {{last_gift_amount}} goes." },
    { trackKey: "rest",  dayOffset: 0, sendEvenAfterGift: true,
      subject: "Thank you, {{first}}", body: "Thank you for {{last_gift_amount}}. — {{org_name}}" },
    { trackKey: "rest",  dayOffset: 2, sendEvenAfterGift: false,
      subject: "One more thing, {{first}}", body: "A short note about what we do." },
  ],
};

// Push every active enrollment's next_send_at back by N days, which is how a
// day is advanced without waiting one.
const advanceDays = (n, seqId) =>
  q(`UPDATE sequence_enrollments SET next_send_at = next_send_at - ($1 || ' days')::interval
      WHERE sequence_id=$2 AND status='active'`, [String(n), seqId]);

(async () => {
  await new Promise(r => sink.listen(SINK_PORT, r));
  await fixture();
  const tok = await login("b94s@test.local", "loadtest1234");
  const tokSA = await login("b94s-sa@test.local", "loadtest1234");
  const tokN = await login("b94s-n@test.local", "loadtest1234");

  // ── the builder, and the timezone gate ──────────────────────────────────
  console.log("— no timezone on file, no sequences, and the screen says why —");
  const bN = await api("GET", "/sequences/builder", tokN);
  ok("an org with no confirmed timezone cannot run sequences", bN.body.canRun === false, bN.body.canRun);
  ok("…and is told why, in words", /timezone/i.test(bN.body.blockedReason || ""), bN.body.blockedReason);
  const b = await api("GET", "/sequences/builder", tok);
  ok("an org that named its timezone can", b.body.canRun === true, b.body);
  ok("the trigger set is closed — four, and no \"anyone in a segment\"",
    b.body.triggers.length === 4 && !b.body.triggers.some(t => /segment/i.test(t.key + t.label)),
    b.body.triggers.map(t => t.key));
  ok("a logged conversation is said NOT to stop a sequence",
    /not stop a sequence/i.test(b.body.stopNote || ""), b.body.stopNote);
  ok("the send window is weekday mornings",
    JSON.stringify(b.body.sendWindow.days) === JSON.stringify([1,2,3,4,5]) && b.body.sendWindow.startHour === 8,
    b.body.sendWindow);

  // ── a sequence refuses to be saved wrong ────────────────────────────────
  console.log("— a sequence that cannot be turned on says so before she tries —");
  const noCatchAll = await api("POST", "/sequences/tracked", tok,
    { ...SEQUENCE, tracks: [{ key: "major", label: "Major", rule: "gift_major" }],
      steps: SEQUENCE.steps.filter(s => s.trackKey === "major") });
  ok("a sequence with no catch-all track is refused", noCatchAll.status === 400
    && noCatchAll.body.problems.some(p => /Everyone else/.test(p)), noCatchAll.body);
  const badToken = await api("POST", "/sequences/tracked", tok,
    { ...SEQUENCE, steps: [{ trackKey: "rest", dayOffset: 0, subject: "Hi {{frist}}", body: "x" },
                           ...SEQUENCE.steps.filter(s => s.trackKey === "major")] });
  ok("a misspelled merge field is refused, not sent blank", badToken.status === 400
    && badToken.body.problems.some(p => /frist/.test(p)), badToken.body);

  // ── build it, and it is OFF ─────────────────────────────────────────────
  const created = await api("POST", "/sequences/tracked", tokSA, SEQUENCE);
  ok("a super-admin can build it inside her org", created.status === 201, created.body);
  ok("and a NEW sequence is off", created.body.status === "draft", created.body.status);
  const SEQ_ID = created.body.id;

  console.log("— she turns it on, and only she can —");
  const saTurn = await api("POST", `/sequences/tracked/${SEQ_ID}/turn-on`, tokSA);
  ok("a super-admin may NOT turn it on", saTurn.status === 403, saTurn.body);
  ok("…and is told to leave it off for them", /leave it off/i.test(saTurn.body.message || ""), saTurn.body.message);

  const pre = await api("GET", `/sequences/tracked/${SEQ_ID}/turn-on-preview`, tok);
  ok("the turn-on screen says enrollment starts today",
    /starts from today/i.test(pre.body.retroactiveSentence) || /nothing to catch up on/i.test(pre.body.retroactiveSentence),
    pre.body.retroactiveSentence);
  ok("…with the count that would have been enrolled had it been on all year",
    pre.body.retroactiveCount === 5, pre.body.retroactiveCount);

  const on = await api("POST", `/sequences/tracked/${SEQ_ID}/turn-on`, tok);
  ok("she turns it on", on.status === 200 && on.body.status === "active", on.body);
  const [seqRow] = await q(`SELECT turned_on_by_name, turned_on_at FROM sequences WHERE id=$1`, [SEQ_ID]);
  ok("turning it on is audited with actor and time",
    seqRow.turned_on_by_name === "Allie Barnett" && seqRow.turned_on_at != null, seqRow);

  // ── ENROLLMENT IS NEVER RETROACTIVE ─────────────────────────────────────
  console.log("— nobody who gave yesterday is enrolled —");
  const enr0 = await q(`SELECT COUNT(*)::int AS n FROM sequence_enrollments WHERE sequence_id=$1`, [SEQ_ID]);
  ok("turning it on enrolls nobody", enr0[0].n === 0, enr0[0].n);

  // ── five people enrolled by the event itself ────────────────────────────
  console.log("— five first gifts, five enrollments, the right track each —");
  for (const p of PEOPLE) {
    // A SECOND donor record is not created — these are their first gifts, so
    // the fixture rows are reset to zero and given one through the real path.
    await q(`UPDATE donors SET gift_count=0, total_giving=0, last_gift_amount=0 WHERE id=$1`, [p.id]);
    const g = await api("POST", `/donors/${p.id}/gifts`, tok, { amount: p.amount, date: "2026-09-22", type: "cash" });
    if (g.status >= 300) ok(`gift for ${p.name} recorded`, false, g.body);
  }
  const enr = await q(
    `SELECT e.donor_id, e.track_key, e.status, d.name FROM sequence_enrollments e
       JOIN donors d ON d.id=e.donor_id WHERE e.sequence_id=$1 ORDER BY d.name`, [SEQ_ID]);
  ok("five people are in it", enr.length === 5, enr.length);
  const trackOf = Object.fromEntries(enr.map(e => [e.name, e.track_key]));
  ok("the two $1,000-and-up givers are on the major track",
    trackOf["Maud Major"] === "major" && trackOf["Marcus Major"] === "major", trackOf);
  ok("the three smaller givers are on the other one",
    trackOf["Sam Small"] === "rest" && trackOf["Sara Small"] === "rest" && trackOf["Stu Small"] === "rest", trackOf);
  ok("and each person is on exactly ONE track",
    new Set(enr.map(e => e.donor_id)).size === 5);

  // ── the clock, day by day ───────────────────────────────────────────────
  console.log("— the clock advanced day by day —");
  // Day 0: every step-1 is due (dayOffset 0).
  let run1 = await api("POST", "/sequences/tracked/run", tok, { now: TUESDAY_MORNING });
  ok("day 0 ran", run1.status === 200, run1.body);
  const sent1 = await q(`SELECT donor_id, step_order, status, subject FROM sequence_sends WHERE sequence_id=$1 ORDER BY donor_id`, [SEQ_ID]);
  // With no RESEND_API_KEY on the scratch stack the provider call is skipped
  // and the send is treated as delivered — which is what makes the timeline
  // and idempotency assertions below meaningful without a live provider.
  ok("five step-1 emails went", sent1.filter(s => s.status === "sent").length === 5, sent1.map(s => s.status));
  ok("…and only step 1", sent1.every(s => s.step_order === 0), sent1.map(s => s.step_order));

  // ── one timeline line per send, naming who turned it on ─────────────────
  const tl = await q(
    `SELECT donor_id, note FROM interactions WHERE org_id=$1 AND type='email' AND note LIKE 'Sequence:%' ORDER BY donor_id`, [ORG]);
  ok("one timeline line per send, and exactly one", tl.length === 5, tl.length);
  ok("the line names the sequence, the step, and who turned it on",
    /^Sequence: Welcome, step 1, turned on by Allie Barnett on \d+ \w{3} — /.test(tl[0].note), tl[0].note);

  // ── the right copy per step, with HER merge fields ──────────────────────
  const maudSend = sent1.find(s => s.donor_id === "d_b94s_1");
  ok("the major track's step 1 carries the major copy", maudSend.subject === "Thank you, {{first}}", maudSend.subject);
  const maudLine = tl.find(t => t.donor_id === "d_b94s_1").note;
  ok("…and the rendered subject has her actual name in it", /Thank you, Maud$/.test(maudLine), maudLine);

  const prev = await api("GET", `/sequences/tracked/${SEQ_ID}/preview?donorId=d_b94s_1&trackKey=major`, tok);
  ok("the preview renders for a NAMED REAL PERSON, not a sample",
    prev.body.person && prev.body.person.name === "Maud Major", prev.body.person);
  ok("…with her real gift in the words", /\$2,500/.test(prev.body.steps[0].body), prev.body.steps[0].body);
  ok("…and nothing renders blank", prev.body.steps.every(s => s.missing.length === 0),
    prev.body.steps.map(s => s.missing));

  // ── A RETRIED JOB SENDS NOTHING TWICE ───────────────────────────────────
  console.log("— a retried job sends nothing twice —");
  const before = (await q(`SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=$1`, [SEQ_ID]))[0].n;
  await api("POST", "/sequences/tracked/run", tok, { now: TUESDAY_MORNING });
  await api("POST", "/sequences/tracked/run", tok, { now: TUESDAY_MORNING });
  const after = (await q(`SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=$1`, [SEQ_ID]))[0].n;
  ok("two more runs on the same day send nothing new", after === before, [before, after]);
  ok("and no second timeline line appeared",
    (await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND note LIKE 'Sequence:%'`, [ORG]))[0].n === 5);

  // ── THE SECOND-GIFT SKIP ────────────────────────────────────────────────
  console.log("— a second gift skips what is left —");
  await api("POST", `/donors/d_b94s_3/gifts`, tok, { amount: 30, date: "2026-09-23", type: "cash" });
  // ── THE UNSUBSCRIBE STOP ────────────────────────────────────────────────
  await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source) VALUES ($1,$2,$3,'unsubscribed','test')`,
    ["sup_b94s", ORG, "sara@b94s.test"]);

  await advanceDays(3, SEQ_ID);
  const run2 = await api("POST", "/sequences/tracked/run", tok, { now: TUESDAY_MORNING });
  ok("day 3 ran", run2.status === 200, run2.body);

  const states = await q(
    `SELECT d.name, e.status, e.stop_reason, e.current_step FROM sequence_enrollments e
       JOIN donors d ON d.id=e.donor_id WHERE e.sequence_id=$1 ORDER BY d.name`, [SEQ_ID]);
  const st = Object.fromEntries(states.map(s => [s.name, s]));
  ok("the one who gave again had the rest skipped",
    st["Sam Small"].status === "completed" && st["Sam Small"].stop_reason === "another_gift", st["Sam Small"]);
  ok("the one who unsubscribed was stopped",
    st["Sara Small"].status === "stopped" && st["Sara Small"].stop_reason === "unsubscribed", st["Sara Small"]);
  ok("the untouched ones carried on",
    st["Stu Small"].status === "completed" && st["Maud Major"].current_step >= 1, [st["Stu Small"], st["Maud Major"]]);
  ok("neither the skipped nor the stopped person got a second email",
    (await q(`SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=$1 AND donor_id IN ('d_b94s_3','d_b94s_4') AND step_order > 0`, [SEQ_ID]))[0].n === 0);

  // A LOGGED CONVERSATION IS NOT A STOP — the one everybody assumes.
  console.log("— and a logged conversation is not a stop —");
  const [maudEnr] = await q(`SELECT status FROM sequence_enrollments WHERE sequence_id=$1 AND donor_id='d_b94s_2'`, [SEQ_ID]);
  await api("POST", "/donors/d_b94s_2/interactions", tok, { type: "call", note: "Spoke to Marcus, lovely chat", date: "2026-09-24" });
  const [maudAfter] = await q(`SELECT status FROM sequence_enrollments WHERE sequence_id=$1 AND donor_id='d_b94s_2'`, [SEQ_ID]);
  ok("logging a call does not stop the sequence", maudAfter.status === maudEnr.status, [maudEnr.status, maudAfter.status]);

  // ── TURNING IT OFF LEAVES THE ENROLLED WHERE THEY ARE ───────────────────
  console.log("— turning it off —");
  const stillActive = (await q(`SELECT COUNT(*)::int AS n FROM sequence_enrollments WHERE sequence_id=$1 AND status='active'`, [SEQ_ID]))[0].n;
  await api("POST", `/sequences/tracked/${SEQ_ID}/turn-off`, tok);
  const afterOff = await q(`SELECT COUNT(*)::int AS n FROM sequence_enrollments WHERE sequence_id=$1 AND status='active'`, [SEQ_ID]);
  ok("the enrolled stay where they are", afterOff[0].n === stillActive, [stillActive, afterOff[0].n]);
  const sendsBeforeOff = (await q(`SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=$1`, [SEQ_ID]))[0].n;
  await advanceDays(5, SEQ_ID);
  await api("POST", "/sequences/tracked/run", tok, { now: TUESDAY_MORNING });
  ok("and nothing further sends", (await q(`SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=$1`, [SEQ_ID]))[0].n === sendsBeforeOff);

  // ── Home ────────────────────────────────────────────────────────────────
  console.log("— one line per sequence on Home —");
  const home = await api("GET", "/sequences/home", tok);
  ok("Home has a line for it", home.body.sequences.length === 1, home.body.sequences);
  ok("…and it reads like a sentence", /^Welcome: \d+ (person|people) in it, /.test(home.body.sequences[0].line),
    home.body.sequences[0].line);

  // ── THE RULE, ON THE SOURCE ─────────────────────────────────────────────
  console.log("— Steward writes nothing to a donor —");
  const SEQSRC = fs.readFileSync(path.join(root, "shared/sequenceShape.js"), "utf8");
  ok("the sequence module calls no model", !/anthropic|claude|askClaude|generateDraft/i.test(SEQSRC));
  const serverSrc = readSource("server.js");
  const engine = serverSrc.slice(serverSrc.indexOf("async function processTrackedSequences"),
                                 serverSrc.indexOf("async function advanceEnrollment"));
  ok("the tracked send path calls no model either",
    !/anthropic|askClaude|generateMilestoneDraft|generateAtRiskDraft/i.test(engine));
  ok("the new sentence is recorded in CLAUDE.md",
    /she wrote every word, she turned it on, and each send is hers/i
      .test(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8")));

  // ── EVERY link in a sequence email survives GET and HEAD, zero state change
  // Enumerated off the bytes that actually went out, not a URL the suite
  // happens to know about — a link added to the footer tomorrow is covered by
  // this the day it appears, which is the point of asserting it this way.
  console.log("— every link in a sequence email changes nothing on GET or HEAD —");
  const sentHtml = captured.map(c => (c && c.html) || "").join("\n");
  const hrefs = [...new Set([...sentHtml.matchAll(/href="([^"]+)"/g)].map(m => m[1]))]
    .filter(u => /^https?:\/\//.test(u) || u.startsWith("/"))
    // Fonts and other third-party assets are not ours to probe.
    .filter(u => !/fonts\.googleapis|fonts\.gstatic/.test(u));
  ok("a sequence email carries at least one link to check", hrefs.length >= 1, hrefs);
  const snapshot = async () => JSON.stringify({
    sup: (await q(`SELECT COUNT(*)::int AS n FROM email_suppressions WHERE org_id=$1`, [ORG]))[0].n,
    enr: (await q(`SELECT status, current_step, stop_reason FROM sequence_enrollments WHERE sequence_id=$1 ORDER BY donor_id`, [SEQ_ID])),
    sends: (await q(`SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=$1`, [SEQ_ID]))[0].n,
    dne: (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND do_not_email = true`, [ORG]))[0].n,
  });
  const before0 = await snapshot();
  const statuses = [];
  for (const href of hrefs) {
    const url = href.replace(/^https?:\/\/[^/]+/, "");
    if (!url.startsWith("/")) continue;
    statuses.push([url.slice(0, 40), (await fetch(BASE + url)).status, (await fetch(BASE + url, { method: "HEAD" })).status]);
  }
  ok("every link answers GET and HEAD without a 5xx",
    statuses.every(([, g, h]) => g < 500 && h < 500), statuses);
  ok("…and NOT ONE of them changed anything", (await snapshot()) === before0,
    [before0.slice(0, 200), (await snapshot()).slice(0, 200)]);

  // BUILD-94 Part 4 — and the gate itself: take the address away and the
  // queue HOLDS rather than failing. Nothing is consumed, so the day she
  // types it in the whole queue goes.
  console.log("— no address, no send, for sequences too —");
  await q(`UPDATE sequences SET status='active' WHERE id=$1`, [SEQ_ID]);
  await q(`UPDATE sequence_enrollments SET status='active', completed_at=NULL, next_send_at=NOW()
            WHERE sequence_id=$1 AND donor_id='d_b94s_1'`, [SEQ_ID]);
  await q(`UPDATE orgs SET receipt_address=NULL WHERE id=$1`, [ORG]);
  const held = await api("POST", "/sequences/tracked/run", tok, { now: TUESDAY_MORNING });
  ok("with no mailing address the sends are HELD, not failed",
    held.body.noAddress >= 1 && held.body.failed === 0, held.body);
  ok("…and the enrollment is still active, waiting",
    (await q(`SELECT status FROM sequence_enrollments WHERE sequence_id=$1 AND donor_id='d_b94s_1'`, [SEQ_ID]))[0].status === "active");
  await q(`UPDATE orgs SET receipt_address='1200 Justin Way, Fort Worth, TX 76107' WHERE id=$1`, [ORG]);

  ok("every email that went out went through the provider, once each",
    captured.length === (await q(`SELECT COUNT(*)::int AS n FROM sequence_sends WHERE sequence_id=$1 AND status='sent'`, [SEQ_ID]))[0].n,
    captured.length);

  sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
