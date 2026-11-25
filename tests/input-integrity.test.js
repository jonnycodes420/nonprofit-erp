// tests/input-integrity.test.js · INPUT-1 (Jarvis's 25 Nov sweep, root causes A and E). The build's
// one new suite: it guards money and donor data. Steward never changes what someone typed, and
// never accepts a date that can't be true.
//
// §1 A negative gift is refused, never saved as positive, by the gift form's route and by
//    recordGift behind it ("A gift can't be negative. To give money back, refund the gift."), on
//    an edit too, and by the ledger's Money in. A refund still writes its negative row: it is the
//    one way money goes back.
// §2 A future-dated gift makes no thank-you draft and no "Thank" task until its day; on its day
//    the hourly tick (server/outreach/giftDay.js) releases both, once. A gift dated today is
//    thanked at once, as before.
// §3 A shift that ends before it starts is refused; an overnight shift says so with an end date
//    and overlaps the next morning's shift in the conflict count. One entry over 16 hours asks.
//    Check-in before the shift's day asks; its second choice dates the hours to the shift.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · run on origin/main's server → §1 "the gift route refuses -50" red (201, a -$50 row; the
//     sign is stripped in the browser, not here), §1 ledger red (201), §2 "no draft before its
//     day" red, §3 "17:00 to 16:00 refused" red (201, 23 hours), §3 check-in early red (200).
//   · the gift route's two negative checks removed (server/donors/gifts.js) → §1 "refuses -50 with
//     the sentence" red: the older generic check answers "A positive amount is required" instead.
//   · assertGiftAmount made a no-op (server/money/negativeGift.js, what recordGift calls) → §1
//     "recordGift's own refusal" red.
//   · the `only` filter removed from outbox.relay → §2 "only the held steps ran" red (afterChange
//     ran again on the gift's day).
"use strict";
const { ok, summary, api, q, closeDb, BASE, civilPlusDays, drainQueue } = require("./helpers");

const PASSWORD = "loadtest1234";
const NEG = "A gift can't be negative. To give money back, refund the gift.";

(async () => {
  console.log("input-integrity (INPUT-1)");
  const RUN = require("crypto").randomBytes(4).toString("hex");
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Input One Fernhollow Pantry ${RUN}`, userName: "Wren Ashcombe", email: `owner-${RUN}@input1.local`, password: PASSWORD }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id;
  await q(`UPDATE orgs SET onboarded_at=NOW(), onboarded_via='test', onboarding_complete=1 WHERE id=$1`, [ORG]);
  const person = async name => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${RUN}@input1.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const today = civilPlusDays(0);
  const giftRows = async id => (await q(`SELECT amount::float AS a, type FROM gifts WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, id]));

  // ── §1 a negative gift is refused ───────────────────────────────────────
  console.log("\n§1 a negative gift is refused, never saved as positive");
  {
    const nora = await person("Nora Quillfeather");
    const r = await api("POST", `/donors/${nora}/gifts`, tok, { amount: "-50", date: today, type: "cash", payment_method: "Check" });
    ok("§1 the gift route refuses -50 with the sentence", r.status === 400 && r.body && r.body.code === "negative_gift" && r.body.sentence === NEG, r);
    ok("§1 and writes nothing (not $50, not -$50)", (await giftRows(nora)).length === 0, await giftRows(nora));
    const good = await api("POST", `/donors/${nora}/gifts`, tok, { amount: "60", date: today, type: "cash", payment_method: "Check" });
    const gid = good.body && good.body.gift && good.body.gift.id;
    ok("§1 a $60 gift saves", good.status === 201 && gid, good);
    const ed = await api("PUT", `/gifts/${gid}`, tok, { amount: "-60" });
    ok("§1 an edit can't turn it negative", ed.status === 400 && ed.body && ed.body.code === "negative_gift", ed);
    const rf = await api("POST", `/gifts/${gid}/refund`, tok, { amount: "10", date: today, reason: "Asked for part back" });
    const rows = await giftRows(nora);
    ok("§1 a refund is still the way back: a -$10 refund row beside the $60 gift", rf.status < 300 && rows.some(x => x.a === -10 && x.type === "refund") && rows.some(x => x.a === 60), { rf, rows });
    const led = await api("POST", "/finance/transactions", tok, { date: today, description: "Typed with a minus", amount: "-40", type: "income" });
    ok("§1 the ledger's Money in refuses -40 with the sentence", led.status === 400 && led.body && led.body.sentence === NEG, led);
    const out = await api("POST", "/finance/transactions", tok, { date: today, description: "Typed with a minus", amount: "-5", type: "expense" });
    ok("§1 and Money out refuses a negative too", out.status === 400 && out.body && out.body.code === "negative_amount", out);
    const n = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND amount < 0 AND source='manual'`, [ORG]);
    ok("§1 no negative ledger row was written", n[0].n === 0, n);
    // recordGift's own refusal (every door behind the routes): a negative is a refund, and only a refund.
    const NG = require("../server/money/negativeGift");
    let thrown = null; try { NG.assertGiftAmount(-50, {}); } catch (e) { thrown = e; }
    let refundOk = true; try { NG.assertGiftAmount(-10, { refundOf: "g_x" }); } catch (_) { refundOk = false; }
    ok("§1 recordGift's own refusal: -50 throws a 400 with the sentence; a refund row does not", !!thrown && thrown.status === 400 && thrown.message === NEG && refundOk, { thrown: thrown && thrown.message, refundOk });
  }

  // ── §2 a future gift waits for its day ──────────────────────────────────
  console.log("\n§2 a future-dated gift is thanked on its day, not today");
  {
    const felix = await person("Felix Ambrose"), tess = await person("Tess Lowmoor");
    const drafts = async id => (await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, id]))[0].n;
    const threads = async id => (await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id=$2`, [ORG, id]))[0].n;
    const now = await api("POST", `/donors/${tess}/gifts`, tok, { amount: "40", date: today, type: "cash", payment_method: "Check" });
    await drainQueue({ orgId: ORG });
    ok("§2 control: a gift dated today has its thank-you draft now", now.status === 201 && await drafts(tess) === 1, await drafts(tess));
    const fut = civilPlusDays(20);
    const g = await api("POST", `/donors/${felix}/gifts`, tok, { amount: "75", date: fut, type: "cash", payment_method: "Check" });
    const gid = g.body && g.body.gift && g.body.gift.id;
    await drainQueue({ orgId: ORG });
    ok("§2 a gift dated 20 days ahead saves", g.status === 201 && gid, g);
    ok("§2 no thank-you draft before its day", await drafts(felix) === 0, await drafts(felix));
    ok("§2 no Thank task (thread) before its day", await threads(felix) === 0, await threads(felix));
    const holds = await q(`SELECT handler, due_on FROM gift_day_holds WHERE gift_id=$1 ORDER BY handler`, [gid]);
    ok("§2 what follows is held for the gift's date", holds.some(h => h.handler === "thankYouDraft" && h.due_on === fut) && holds.some(h => h.handler === "journeys"), holds);
    const deps = { query: require("../db").query, orgTz: async id => (await q(`SELECT timezone FROM orgs WHERE id=$1`, [id]))[0] || {},
      orgToday: org => require("../orgTime").orgToday(org) };
    const GD = require("../server/outreach/giftDay");
    const early = await GD.releaseDueHolds(deps, { orgId: ORG });
    ok("§2 the tick before its day releases nothing", early.released === 0, early);
    // Its day comes (the clock is moved by moving the gift, as numbers6 does).
    const y = civilPlusDays(-1);
    await q(`UPDATE gifts SET date=$1, scheduled_on=$1 WHERE id=$2`, [y, gid]);
    await q(`UPDATE gift_day_holds SET due_on=$1 WHERE gift_id=$2`, [y, gid]);
    const r1 = await GD.releaseDueHolds(deps, { orgId: ORG });
    await drainQueue({ orgId: ORG });
    ok("§2 on its day the tick releases it", r1.released === 1, r1);
    ok("§2 and the thank-you draft is written", await drafts(felix) === 1, await drafts(felix));
    ok("§2 and the Thank task (thread) opens", await threads(felix) === 1, await threads(felix));
    const r2 = await GD.releaseDueHolds(deps, { orgId: ORG });
    await drainQueue({ orgId: ORG });
    ok("§2 released once: a second tick writes nothing", r2.released === 0 && await drafts(felix) === 1, { r2, d: await drafts(felix) });
    const ran = await q(`SELECT name FROM job_queue WHERE key LIKE $1`, [`ev:ev_day_${gid}%`]);
    ok("§2 only the held steps ran on its day", ran.length >= 1 && ran.every(j => /thankYouDraft|journeys|sequences/.test(j.name)), ran);
  }

  // ── §3 shifts, hours and check-in ───────────────────────────────────────
  console.log("\n§3 a shift can't end before it starts; check-in happens on the day");
  {
    const opp = (await api("POST", "/volunteer-hub/opportunities", tok, { name: "Pantry sorting" })).body;
    const d10 = civilPlusDays(10), d11 = civilPlusDays(11);
    const bad = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.id, date: d10, startTime: "17:00", endTime: "16:00", capacity: 3 });
    ok("§3 a shift 17:00 to 16:00 is refused, and says how to enter an overnight one", bad.status === 400 && /ends before it starts/.test(bad.body && bad.body.message || ""), bad);
    const night = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.id, date: d10, endDate: d11, startTime: "22:00", endTime: "06:00", capacity: 3 });
    ok("§3 an overnight shift with an end date the next day is 8 hours", night.status === 201 && night.body.hours === 8, night);
    const morning = (await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.id, date: d11, startTime: "01:00", endTime: "03:00", capacity: 3 })).body;
    const ivo = await person("Ivo Penhallow");
    await api("POST", "/volunteer-hub/signups", tok, { slotId: night.body.id, personId: ivo });
    const second = await api("POST", "/volunteer-hub/signups", tok, { slotId: morning.id, personId: ivo });
    ok("§3 the overnight shift overlaps the next morning's (the sign-up asks)", second.status === 409, second);
    await api("POST", "/volunteer-hub/signups", tok, { slotId: morning.id, personId: ivo, overlapOk: true });
    const sch = await api("GET", `/volunteer-hub/schedule?from=${civilPlusDays(9)}&to=${civilPlusDays(12)}`, tok);
    ok("§3 and the conflict count counts it", sch.status === 200 && sch.body.conflicts === 1, sch.body && sch.body.conflicts);
    const h24 = await api("POST", `/donors/${ivo}/volunteer-hours`, tok, { date: today, hours: "24", entryKey: `k24-${RUN}` });
    ok("§3 one entry of 24 hours asks first", h24.status === 409 && h24.body.code === "long_hours", h24);
    const h24y = await api("POST", `/donors/${ivo}/volunteer-hours`, tok, { date: today, hours: "24", entryKey: `k24-${RUN}`, confirmLong: true });
    ok("§3 and saves when she says it is right", h24y.status < 300, h24y);
    const day = (await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.id, date: d10, startTime: "09:00", endTime: "12:00", capacity: 3 })).body;
    const ama = await person("Ama Thistlewood");
    const su = (await api("POST", "/volunteer-hub/signups", tok, { slotId: day.id, personId: ama })).body;
    const sid = su && (su.signupId || su.id);
    const ci = await api("POST", "/volunteer-hub/checkin", tok, { signupId: sid, kiosk: true });
    ok("§3 check-in ten days early asks, naming the shift's day", ci.status === 409 && ci.body.code === "not_the_day" && /^This shift is on \w{3}, \w{3} \d{1,2}\. Check in then, or record hours for that date\.$/.test(ci.body.sentence), ci);
    const none = await q(`SELECT COUNT(*)::int AS n FROM volunteer_shifts WHERE org_id=$1 AND person_id=$2`, [ORG, ama]);
    ok("§3 and writes no hours", none[0].n === 0, none);
    const ci2 = await api("POST", "/volunteer-hub/checkin", tok, { signupId: sid, kiosk: true, forShiftDate: true });
    const hrs = await q(`SELECT date, hours::float AS h FROM volunteer_shifts WHERE org_id=$1 AND person_id=$2`, [ORG, ama]);
    ok("§3 record hours for that date: 3 hours, dated the shift's day", ci2.status === 200 && hrs.length === 1 && String(hrs[0].date).slice(0, 10) === d10 && hrs[0].h === 3, { ci2: ci2.status, hrs });
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch (_) { /* closing */ } process.exit(1); });
