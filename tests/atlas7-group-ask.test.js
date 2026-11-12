// tests/atlas7-group-ask.test.js · ATLAS-7. ATLAS HANDLES A GROUP ASK, MAKES THE
// JOURNEY IT WAS ASKED FOR, AND NEVER SAYS "DONE" WHEN NOTHING WAS DONE.
//
// Jonathan's words of 11 Nov, exactly (tests/lib/atlas7Fixture.js HIS_WORDS),
// on an org shaped like his: two journeys, a Top 100 with three people on it,
// and 44 made-up people of whom 38 gave over $1,000 in their lifetime, 30 in
// the last 12 months and 28 in one gift. It guards donor data: who is put on a
// list and into a journey, and that Undo takes all of it back.
//
//   §1 "Done." only when something ran: a request whose lines were all refused
//      says "Nothing was changed.".
//   §2 "every donor that gave over 1000" is a group, read through the Donors
//      list's filters, never "I couldn't tell who that was about".
//   §3 the window question: each count beside a window is the Donors list's own
//      count for the same rules (GET /donors/ids), and the hand count.
//   §4 the journey he described is the first choice, "Create 'Top 100': a phone
//      call every 3 months for a year (4 calls)", and Do it makes it: a journey
//      in Journeys with four phone-call steps, by hand.
//   §5 the Top 100: 27 added, 3 already on it, and the line says so.
//   §6 one confirm, then act: nothing is written before Do it; Do it twice
//      writes once; Undo all of it takes out the enrollments, archives the new
//      journey and takes the 27 back off the list.
//   §7 29 first calls (one person is do not contact) are spread over the next
//      ten working days, at most three a day, largest givers first.
//
// HOW IT GOES RED (planted, each seen red before green; ATLAS-7 report):
//   * spokeFor heads every request "Done." again: §1 red.
//   * the group read is skipped (the model's one-person read): §2 red (no_who).
//   * a window's count taken without its dates: §3 red (38 beside 12 months).
//   * Undo leaves the journey's enrollments: §6 red.
//   * every first call on the first day: §7 red.
//
// Standard scratch stack (tests/README.md). Nothing is sent: journey steps are
// tasks for staff.
const { ok, summary, q, closeDb, api } = require("./helpers");
const { civilDay } = require("./clock");
const F = require("./lib/atlas7Fixture");

(async () => {
  console.log("ATLAS-7: a group ask, the journey he described, one confirm\n");
  const today = civilDay();
  const people = await F.seed(q, today);
  const login = await api("POST", "/auth/login", null, { email: F.ADMIN, password: F.PASSWORD });
  const tok = login.body && login.body.token;
  ok("Rowan signs in", !!tok, login.body);
  const AT = await import("../shared/atlas.js");

  // ── §1 never "Done." over nothing ────────────────────────────────────────
  const refused = [{ kind: "not_found", state: "refused", line: "x" }, { kind: "cant", state: "refused", line: "y" }];
  ok("§1 a plan whose lines were all refused is headed \"Nothing was changed.\", never \"Done.\"",
    AT.spokeFor(refused, 0) === "Nothing was changed." && AT.spokeFor([{ kind: "journey_added", state: "failed" }], 0) === "Nothing was changed."
    && AT.spokeFor([{ kind: "journey_added", state: "done" }], 0) === "Done.", [AT.spokeFor(refused, 0)]);
  const r1 = await api("POST", "/atlas", tok, { text: "Merge Alder Ashgrove with Briony Blackthorne" });
  const l1 = ((r1.body.request || {}).lines || []);
  ok("§1 end to end: a request that only refused says so", r1.status < 300 && l1.length > 0 && l1.every(l => l.state === "refused")
    && r1.body.request.spoke === "Nothing was changed.", { spoke: r1.body.request && r1.body.request.spoke, lines: l1.map(l => [l.kind, l.state, l.line]) });

  // ── §2 a group, never no_who ─────────────────────────────────────────────
  const r2 = await api("POST", "/atlas", tok, { text: F.HIS_WORDS });
  const req2 = r2.body.request || {};
  const qs = req2.questions || [];
  const win = qs.find(x => x.id === "window"), jq = qs.find(x => x.id === "journey");
  ok("§2 his words are a group ask: one window question and one journey question, never \"I couldn't tell who\"",
    r2.status < 300 && req2.status === "needs_answers" && !!win && !!jq && !(req2.lines || []).some(l => l.line === AT.REFUSE.no_who),
    { status: r2.status, qs: qs.map(x => x.sentence), lines: req2.lines });

  // ── §3 the counts are the Donors list's ──────────────────────────────────
  const GO = require("../shared/numbers/gaveOver");
  const listCount = async rules => (await api("GET", `/donors/ids?${new URLSearchParams(rules)}`, tok)).body.total;
  const shown = k => { const o = win && win.options.find(x => x.id === k); return o ? Number((/^(\d+) (people|person)/.exec(o.detail) || [])[1]) : null; };
  const year = Number(today.slice(0, 4)), from12 = (() => { const d = new Date(Date.UTC(year - 1, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 1)); return d.toISOString().slice(0, 10); })();
  const listed = { last12: await listCount({ gaveOver: 1000, gaveFrom: from12, gaveTo: today }), calendar: await listCount({ gaveOver: 1000, gaveFrom: `${year}-01-01`, gaveTo: today }),
    lifetime: await listCount({ gaveOver: 1000 }), oneGift: await listCount({ giftOver: 1000 }) };
  const sum = (p, f) => p.gifts.filter(([d]) => d >= f.from && d <= f.to).reduce((s, [, a]) => s + a, 0);
  const hand = { last12: people.filter(p => sum(p, { from: from12, to: today }) > 1000).length, lifetime: people.filter(p => sum(p, { from: "1900-01-01", to: today }) > 1000).length,
    oneGift: people.filter(p => p.gifts.some(([, a]) => a > 1000)).length };
  ok("§3 the count beside \"In the last 12 months\" is the Donors list's for the same window, and the hand count (30)",
    shown("last12") === listed.last12 && listed.last12 === hand.last12 && hand.last12 === 30, { shown: shown("last12"), listed, hand });
  ok("§3 and every other window's count is the Donors list's (lifetime 38, one gift 28)",
    GO.WINDOWS.every(k => shown(k) === listed[k]) && listed.lifetime === hand.lifetime && listed.oneGift === hand.oneGift, { shown: GO.WINDOWS.map(shown), listed, hand });

  // ── §4 the journey he described comes first ──────────────────────────────
  ok("§4 the first choice creates the journey he described; the two he has follow",
    !!jq && jq.options[0].id === "new" && jq.options[0].name === "Create 'Top 100': a phone call every 3 months for a year (4 calls)"
    && jq.options.slice(1).map(o => o.name).join("|") === "Major donor|Welcome back", jq && jq.options.map(o => o.name));

  // ── §6 one confirm: nothing written before Do it ─────────────────────────
  const counts = async () => (await q(`SELECT (SELECT COUNT(*)::int FROM portfolio_members WHERE org_id=$1) AS list,
      (SELECT COUNT(*)::int FROM cultivation_plans WHERE org_id=$1) AS plans, (SELECT COUNT(*)::int FROM cultivation_templates WHERE org_id=$1 AND archived_at IS NULL) AS journeys,
      (SELECT COUNT(*)::int FROM threads WHERE org_id=$1 AND closed_at IS NULL) AS threads`, [F.ORG]))[0];
  const before = await counts();
  const a2 = await api("POST", `/atlas/${req2.id}/answer`, tok, { answers: { window: "last12", journey: "new" } });
  const plan = (a2.body.request || {}).groupPlan;
  const mid = await counts();
  ok("§6 the confirm shows real numbers: 30 people, 27 to add and 3 already on the list, 29 into the new journey (1 do not contact)",
    a2.status < 300 && !!plan && plan.count === 30 && plan.list.add === 27 && plan.list.already === 3 && plan.journey.create === true
    && plan.journey.joinCount === 29 && plan.journey.leftOut.join() === "1 do not contact" && !plan.doneAt, { status: a2.status, plan });
  ok("§6 and nothing is written before Do it", JSON.stringify(mid) === JSON.stringify(before), { before, mid });
  const [d1, d2] = await Promise.all([api("POST", `/atlas/${req2.id}/group`, tok, {}), api("POST", `/atlas/${req2.id}/group`, tok, {})]);
  const done = [d1, d2].find(x => x.status === 201);
  const after = await counts();
  ok("§6 Do it pressed twice at once writes once (one 201, one 409)", [d1.status, d2.status].sort().join() === "201,409" && after.plans === 29, { s: [d1.status, d2.status], after });
  const lines = ((done && done.body.request) || {}).lines || [];
  const line = k => lines.find(l => l.kind === k) || {};

  // ── §4/§5 what Do it wrote ───────────────────────────────────────────────
  const [jt] = await q(`SELECT id, name, trigger_key, journey_enabled, steps, created_by FROM cultivation_templates WHERE org_id=$1 AND name='Top 100' AND archived_at IS NULL`, [F.ORG]);
  const steps = jt ? (typeof jt.steps === "string" ? JSON.parse(jt.steps) : jt.steps) : [];
  ok("§4 the journey is made: \"Top 100\", by hand, four phone calls 0/91/182/273 days apart, on in Journeys, stamped with Rowan",
    !!jt && jt.trigger_key === "by_hand" && jt.journey_enabled === true && jt.created_by === "u_atl7_rowan"
    && steps.map(s => `${s.label}@${s.offsetDays}`).join() === "Phone call@0,Phone call@91,Phone call@182,Phone call@273"
    && ((await api("GET", "/journeys", tok)).body.journeys || []).some(x => x.id === jt.id), { jt, steps });
  const onList = (await q(`SELECT donor_id FROM portfolio_members WHERE org_id=$1`, [F.ORG])).map(r => r.donor_id);
  ok("§5 27 added to the Top 100, the 3 already on it kept once, and the line says how many of each",
    onList.length === 30 && new Set(onList).size === 30 && line("group_list").line === "Added 27 people to your Top 100; 3 were already on it." && line("group_list").undoable,
    { n: onList.length, line: line("group_list").line });
  ok("§1 after Do it the heading is \"Done.\", and each action is a line with its count",
    done.body.request.spoke === "Done." && /^Put 29 people in "Top 100"\./.test(line("group_journey").line || "") && /^Made the journey "Top 100"/.test(line("group_journey_new").line || ""),
    { spoke: done.body.request.spoke, lines: lines.map(l => l.line) });

  // ── §7 the first calls are spread ────────────────────────────────────────
  const firsts = await q(`SELECT p.donor_id, s.due_date FROM cultivation_plans p JOIN cultivation_plan_steps s ON s.plan_id=p.id AND s.seq=1
                           WHERE p.org_id=$1 AND p.template_id=$2`, [F.ORG, jt && jt.id]);
  const perDay = new Map(); for (const f of firsts) perDay.set(f.due_date, (perDay.get(f.due_date) || 0) + 1);
  const days = [...perDay.keys()].sort();
  const workday = d => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay());
  const life = new Map(people.map(p => [p.id, p.gifts.reduce((s, [, a]) => s + a, 0)]));
  const order = firsts.slice().sort((x, y) => (x.due_date < y.due_date ? -1 : x.due_date > y.due_date ? 1 : 0));
  const largestFirst = order.every((f, i) => i === 0 || f.due_date === order[i - 1].due_date || life.get(order[i - 1].donor_id) >= life.get(f.donor_id));
  ok("§7 29 first calls over ten working days from today, at most 3 a day, the largest givers first",
    firsts.length === 29 && days.length === 10 && days.every(workday) && days[0] >= today && Math.max(...perDay.values()) <= 3 && largestFirst,
    { days: [...perDay.entries()], largestFirst });

  // ── §6 Undo takes all of it back ─────────────────────────────────────────
  const u = await api("POST", `/atlas/${req2.id}/undo`, tok, {});
  const undone = await counts();
  const [arch] = jt ? await q(`SELECT archived_at FROM cultivation_templates WHERE id=$1`, [jt.id]) : [null];
  ok("§6 Undo all of it: no enrollments or their open calls left, the new journey archived, the list back to its 3",
    u.status < 300 && undone.plans === 0 && undone.threads === before.threads && !!(arch && arch.archived_at) && undone.list === 3,
    { status: u.status, undone, arch });

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
