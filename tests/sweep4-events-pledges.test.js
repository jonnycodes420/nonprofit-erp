// tests/sweep4-events-pledges.test.js: SWEEP-4. EVENTS AND PLEDGES SAY WHAT
// HAPPENED, TO THE PERSON AND THE CENT. Guards donor data and money: the walk
// of 29 Oct (docs/sweeps/sweep-4/walk.md) found a deleted giver still counted on
// the event page, a pledge with no installments, follow-up tasks made twice with
// no count and no Undo, a public event page taking registrations while it could
// not take money, a past event's chart worrying about guests who never came, and
// Ask saying an event "brought in" a third of what its page said it raised.
//
//   §1 a deleted person is in no event figure: First-time givers, Sponsors and
//      the raised rows leave them out (the gave source already did), and a
//      person with two gifts on their first day is one first-time giver.
//   §2 every pledge has its installments: POST /donors/:id/pledges with no
//      schedule writes one installment of the whole pledge on its due date; a
//      schedule that does not sum is refused and writes no pledge; a schedule
//      edit that says nothing is still refused.
//   §3 follow-up tasks for who came: GET counts first (each person who came,
//      once, never a deleted one); POST makes that many; a second POST makes
//      none; Undo takes exactly that batch back.
//   §4 the public event page reads "Not open yet" while payments aren't
//      connected, and its Register form writes nothing.
//   §5 a past event's seating chart is who came (shared/eventShape cameOnly).
//   §6 Ask on the event says what was received and what was pledged there,
//      the event page's two parts.
//   Then assertSurfacesAgree on the org.
//
// HOW IT GOES RED ON MAIN (199d99d): First-time givers is 3 with the deleted
// giver and the two-gift giver counted twice (§1); the pledge answers 201 with
// 0 installments and the bad schedule answers 201 (§2); GET follow-up is 404,
// POST makes one task per row and the second press makes them again (§3);
// /e/<slug> answers 200 with a Register button and the form writes a guest (§4);
// the chart says "1 still without a seat" about a guest who never came (§5);
// Ask says "brought in" and nothing about the pledge (§6).
//
// Standard scratch stack (tests/README.md). Sends nothing. The clock is not pinned.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");

const ORG = "org_sweep4_ev";
const PASSWORD = "loadtest1234";
const EVENT = "ev_sweep4_gala", SLUG = "sweep4-lantern-gala", DAY = "2026-06-06";
const P = k => `d_sweep4_${k}`;

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
const fig = (rep, key) => ((rep.figures || []).find(f => f.key === key) || {}).value;

(async () => {
  try {
    const tok = await freshOrg(ORG, "Sweep4 events (test)");
    // ── the night: Ada came and gave twice on her first day, Ben came and did
    // not give, Cy said yes and never came, Dee came and gave and is deleted,
    // Eve is a sponsor and is deleted.
    const who = [["ada", "Ada Lantern"], ["ben", "Ben Lantern"], ["cy", "Cy Lantern"], ["dee", "Dee Lantern"], ["eve", "Eve Lantern"]];
    for (const [k, name] of who)
      await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`, [P(k), ORG, name, `${k}@sweep4.test`]);
    await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug,created_by,created_by_name) VALUES ($1,$2,'Lantern Gala','gala',$3,'completed',$4,'system:test','test')`, [EVENT, ORG, DAY, SLUG]);
    await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price) VALUES ('evl_sweep4_t',$1,$2,'ticket','Dinner',100), ('evl_sweep4_s',$1,$2,'sponsor','Lantern sponsor',2500)`, [ORG, EVENT]);
    await q(`INSERT INTO event_tables (id,org_id,event_id,label,seats) VALUES ('evt_sweep4_t1',$1,$2,'Table 1',8)`, [ORG, EVENT]);
    const guest = (k, status, table, level = "evl_sweep4_t") => q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status,table_label,level_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`ea_sweep4_${k}`, EVENT, ORG, P(k), who.find(w => w[0] === k)[1], status, table, level]);
    await guest("ada", "attended", "Table 1"); await guest("ben", "attended", "Table 1"); await guest("cy", "registered", null);
    await guest("dee", "attended", "Table 1"); await guest("eve", "registered", null, "evl_sweep4_s");
    // through the one gift path, then stamped with the event (the stamp EVENTS-1 writes)
    const gift = async (k, amount) => {
      const r = await api("POST", `/donors/${P(k)}/gifts`, tok, { amount, date: DAY, type: "one-time" });
      const id = r.body && r.body.gift && r.body.gift.id;
      if (!id) throw new Error("gift not recorded: " + JSON.stringify(r.body).slice(0, 200));
      await q(`UPDATE gifts SET event_id=$1 WHERE id=$2 AND org_id=$3`, [EVENT, id, ORG]);
    };
    await gift("ada", 300); await gift("ada", 200); await gift("dee", 1000);
    // a pledge made at the event, due within its year, for §6
    await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,event_id,created_by,created_by_name) VALUES ('pl_sweep4_ev',$1,$2,750,'2026-12-01','open',$3,'system:test','test')`, [ORG, P("ben"), EVENT]);
    await q(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES ('pli_sweep4_ev',$1,'pl_sweep4_ev',1,'2026-12-01',750)`, [ORG]);
    for (const k of ["dee", "eve"]) {
      const d = await api("DELETE", `/donors/${P(k)}`, tok);
      ok(`setup: ${k} is deleted through the app`, d.status === 200, d.status);
    }

    // ── §1 a deleted person is in no event figure
    const rep = (await api("GET", `/events/${EVENT}/report`, tok)).body || {};
    ok("§1 First-time givers is Ada alone: the deleted giver is out and two gifts on her first day are one person",
       fig(rep, "firstTime") === 1, { firstTime: fig(rep, "firstTime") });
    ok("§1 Sponsors leaves out the deleted sponsor", fig(rep, "sponsors") === 0, { sponsors: fig(rep, "sponsors") });
    const rows = k => api("GET", `/events/${EVENT}/rows?rows=${k}`, tok).then(r => (r.body.donors || []).map(d => d.donor_id));
    for (const k of ["raised", "firstTime", "sponsors", "attended", "registered", "cameGave"])
      ok(`§1 the ${k} rows name nobody deleted`, !(await rows(k)).some(id => id === P("dee") || id === P("eve")), k);
    ok("§1 Came and Gave leave the deleted person out (Ada and Ben came; Ada and Ben's pledge gave)",
       fig(rep, "attended") === 2 && fig(rep, "gave") === 2, { attended: fig(rep, "attended"), gave: fig(rep, "gave") });

    // ── §2 every pledge has its installments
    const made = await api("POST", `/donors/${P("ada")}/pledges`, tok, { amount: "1,200", dueDate: "2026-12-15" });
    const inst = made.body && made.body.installments || [];
    ok("§2 a pledge made with no schedule has one installment, the whole pledge on its due date",
       made.status === 201 && inst.length === 1 && Number(inst[0].amount) === 1200 && String(inst[0].due_date).slice(0, 10) === "2026-12-15",
       { status: made.status, inst });
    const before = (await one(`SELECT COUNT(*)::int n FROM pledges WHERE org_id=$1`, [ORG])).n;
    const bad = await api("POST", `/donors/${P("ada")}/pledges`, tok, { amount: 900, dueDate: "2026-12-15",
      installments: [{ dueDate: "2026-12-15", amount: 300 }, { dueDate: "2027-12-15", amount: 300 }] });
    const after = (await one(`SELECT COUNT(*)::int n FROM pledges WHERE org_id=$1`, [ORG])).n;
    ok("§2 a schedule that does not sum to the pledge is refused, and no pledge is written",
       bad.status === 400 && after === before, { status: bad.status, body: bad.body, before, after });
    const blank = await api("PUT", `/pledges/${made.body.id}/installments`, tok, { firstDue: "2027-01-01" });
    ok("§2 a schedule edit that gives no schedule is still refused", blank.status === 400, blank.status);
    const orphans = (await one(`SELECT COUNT(*)::int n FROM pledges p WHERE p.org_id=$1 AND NOT EXISTS (SELECT 1 FROM pledge_installments i WHERE i.pledge_id=p.id)`, [ORG])).n;
    ok("§2 no pledge in the org is without installments", orphans === 0, orphans);

    // ── §3 follow-up tasks for who came
    const plan = await api("GET", `/events/${EVENT}/follow-up`, tok);
    ok("§3 the count comes first: Ada and Ben came (the deleted guest and the no-show are not counted)",
       plan.status === 200 && plan.body.came === 2 && plan.body.toCreate === 2 && /2 tasks/.test(plan.body.sentence || ""), { status: plan.status, body: plan.body });
    const tasks = () => one(`SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1 AND event_id=$2`, [ORG, EVENT]).then(r => r.n);
    const p1 = await api("POST", `/events/${EVENT}/follow-up`, tok, { dueDate: "2026-11-05", priority: "medium" });
    ok("§3 the press makes the two it said", p1.status === 200 && p1.body.count === 2 && (await tasks()) === 2 && !!p1.body.batch, { body: p1.body });
    const named = await q(`SELECT donor_id, created_by FROM tasks WHERE org_id=$1 AND event_id=$2 ORDER BY donor_id`, [ORG, EVENT]);
    ok("§3 one each for Ada and Ben, stamped with who made them",
       JSON.stringify(named.map(t => t.donor_id)) === JSON.stringify([P("ada"), P("ben")]) && named.every(t => t.created_by === "u_" + ORG), named);
    const p2 = await api("POST", `/events/${EVENT}/follow-up`, tok, { dueDate: "2026-11-05" });
    ok("§3 a second press makes none", p2.status === 200 && p2.body.count === 0 && (await tasks()) === 2, { body: p2.body });
    const un = await api("POST", `/events/${EVENT}/follow-up/undo`, tok, { batch: p1.body.batch });
    ok("§3 Undo takes exactly that batch back", un.status === 200 && un.body.removed === 2 && (await tasks()) === 0, { body: un.body });

    // ── §4 the public page while payments aren't connected
    const page = await fetch(`${BASE}/e/${SLUG}`);
    const html = await page.text();
    ok("§4 the event page reads Not open yet and offers no form", page.status === 404 && /Not open yet/.test(html) && !/<form/i.test(html),
       { status: page.status, head: html.slice(0, 200) });
    await q(`UPDATE events SET status='upcoming', date=$2 WHERE id=$1`, [EVENT, "2099-06-06"]);
    const reg = await fetch(`${BASE}/e/${SLUG}/register`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Fay Walkup", email: "fay@sweep4.test", levelId: "evl_sweep4_t", quantity: "1" }).toString() });
    const fay = (await one(`SELECT COUNT(*)::int n FROM event_attendees WHERE org_id=$1 AND LOWER(email)='fay@sweep4.test'`, [ORG])).n;
    ok("§4 its Register form writes nothing", fay === 0 && reg.status === 404, { status: reg.status, fay });
    await q(`UPDATE events SET status='completed', date=$2 WHERE id=$1`, [EVENT, DAY]);

    // ── §5 a past event's chart is who came
    const { seatingChart } = await import("../shared/eventShape.js");
    const g = (await api("GET", `/events/${EVENT}/guests`, tok)).body.guests || [];
    const past = seatingChart(g, { tables: [{ label: "Table 1", seats: 8 }], cameOnly: true });
    ok("§5 the past chart does not count Cy, who said yes and never came, as without a seat",
       past.unseated.length === 0 && !/without a seat/.test(past.sentence), { sentence: past.sentence, unseated: past.unseated.map(x => x.name) });
    const future = seatingChart(g, { tables: [{ label: "Table 1", seats: 8 }] });
    ok("§5 before the day, Cy is still somebody to seat", future.unseated.some(x => x.donor_id === P("cy")), future.sentence);

    // ── §6 Ask says both parts
    const ask = await api("POST", "/ask", tok, { text: "How did the Lantern Gala do?" });
    ok("§6 Ask says what came in and what was pledged there", ask.status === 200 && /\$500 in gifts/.test(ask.body.sentence || "") && /\$750 more was pledged there/.test(ask.body.sentence || ""),
       { status: ask.status, sentence: ask.body && ask.body.sentence });

    // ── the truth check
    let agree = null;
    try { agree = await require("./lib/surfacesAgree").assertSurfacesAgree(ORG, { token: tok, soft: true, skip: ["atlas"] }); } catch (e) { agree = { ok: false, diffs: [e.message] }; }
    ok("every surface agrees on the org", agree && agree.ok, agree && agree.diffs);
  } catch (e) { console.error(e); ok("the suite ran to the end", false, e.message); }
  await closeDb();
  summary("sweep4-events-pledges");
})();
