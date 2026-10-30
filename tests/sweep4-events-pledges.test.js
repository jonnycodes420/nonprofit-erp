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

// FIX-60: what a pledge's installments must be, read from the database: they
// exist, they sum to the pledge to the cent, the paid ones are the payments
// linked to it (each of exactly its gift's amount, up to the pledge), and each
// paid one's gift is that pledge's.
async function installmentsRight(where, args) {
  const rows = await q(`SELECT p.id, ROUND(p.amount*100)::bigint AS cents,
      (SELECT COUNT(*)::int FROM pledge_installments i WHERE i.pledge_id=p.id) AS n,
      (SELECT COALESCE(SUM(ROUND(i.amount*100)),0)::bigint FROM pledge_installments i WHERE i.pledge_id=p.id) AS inst,
      (SELECT COALESCE(SUM(ROUND(i.amount*100)),0)::bigint FROM pledge_installments i WHERE i.pledge_id=p.id AND i.paid_gift_id IS NOT NULL) AS paid,
      (SELECT COALESCE(SUM(ROUND(g.amount*100)),0)::bigint FROM gifts g WHERE g.pledge_id=p.id AND g.org_id=p.org_id) AS linked,
      (SELECT COUNT(*)::int FROM pledge_installments i JOIN gifts g ON g.id=i.paid_gift_id
         WHERE i.pledge_id=p.id AND (g.pledge_id IS DISTINCT FROM p.id OR ROUND(g.amount*100) < ROUND(i.amount*100))) AS wrong
      FROM pledges p WHERE ${where} ORDER BY p.id`, args);
  const bad = rows.filter(r => !(r.n > 0 && Number(r.inst) === Number(r.cents)
    && Number(r.paid) === Math.min(Number(r.linked), Number(r.cents)) && r.wrong === 0));
  return { rows, bad };
}

async function fix60(tok) {
  for (const [k, name] of [["fay", "Fay Lantern"], ["gus", "Gus Lantern"], ["hal", "Hal Lantern"], ["ivy", "Ivy Lantern"]])
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`, [P(k), ORG, name, `${k}@sweep4.test`]);
  const pay = async (k, amount, date, notes) => {
    const r = await api("POST", `/donors/${P(k)}/gifts`, tok, { amount, date, type: "one-time", notes });
    if (!(r.body && r.body.gift)) throw new Error("payment not recorded: " + JSON.stringify(r.body).slice(0, 200));
    return r.body.gift.id;
  };
  // Gus paid twice on his pledge G-77; Fay paid two of four on a pledge no row states (a shell)
  await pay("gus", 300, "2026-01-15", "Payment on pledge G-77");
  await pay("gus", 200.5, "2026-03-15", "Payment on pledge G-77");
  await pay("fay", 250, "2026-02-01", "Pledge payment 1 of 4");
  await pay("fay", 250, "2026-03-01", "Pledge payment 2 of 4");

  // the history import's commitments (POST /donors/import-semantics), as DonorImport sends them
  const sem = await api("POST", "/donors/import-semantics", tok, { pledges: [
    { donorName: "Gus Lantern", donorEmail: "gus@sweep4.test", amount: 1000.75, date: "2026-01-10", dueDate: "2026-12-31", externalId: "G-77", status: "open" },
    { donorName: "Fay Lantern", donorEmail: "fay@sweep4.test", amount: 1000, date: "2026-02-01", shell: true, installments: 4, status: "open" },
    { donorName: "Hal Lantern", donorEmail: "hal@sweep4.test", amount: 600, date: "2026-05-01", dueDate: "2027-01-31", externalId: "G-81", status: "open" },
  ] });
  ok("§7 the history import wrote its three pledges", sem.status === 200 && sem.body.counts && sem.body.counts.pledges === 3, { status: sem.status, counts: sem.body && sem.body.counts });
  const semP = await installmentsRight(`p.org_id=$1 AND p.donor_id = ANY($2)`, [ORG, [P("gus"), P("fay"), P("hal")]]);
  ok("§7 each history pledge has installments that sum to it to the cent, and the paid ones are its linked payments",
     semP.rows.length === 3 && semP.bad.length === 0, semP.rows);
  const gusInst = await q(`SELECT i.seq, ROUND(i.amount*100)::bigint AS c, i.paid_gift_id IS NOT NULL AS paid, LEFT(i.due_date::text,10) AS due
                             FROM pledge_installments i JOIN pledges p ON p.id=i.pledge_id WHERE p.donor_id=$1 ORDER BY i.seq`, [P("gus")]);
  ok("§7 Gus's payments are marked oldest first, to the cent: $300.00 and $200.50 paid, $500.25 still due on the pledge's date",
     JSON.stringify(gusInst.map(i => [Number(i.c), i.paid, i.due])) === JSON.stringify([[30000, true, "2026-01-15"], [20050, true, "2026-03-15"], [50025, false, "2026-12-31"]]), gusInst);
  const fayInst = await q(`SELECT ROUND(i.amount*100)::bigint AS c, i.paid_gift_id IS NOT NULL AS paid, i.due_date
                             FROM pledge_installments i JOIN pledges p ON p.id=i.pledge_id WHERE p.donor_id=$1 ORDER BY i.seq`, [P("fay")]);
  ok("§7 the shell's two payments are its two paid installments; the rest has no date anybody wrote down",
     JSON.stringify(fayInst.map(i => [Number(i.c), i.paid, i.due_date])) === JSON.stringify([[25000, true, "2026-02-01"], [25000, true, "2026-03-01"], [50000, false, null]]), fayInst);
  // the next payment of exactly what is left lands on that installment, from the one gift path
  await pay("gus", 500.25, "2026-06-01", "Last payment");
  const [gusP] = await q(`SELECT status FROM pledges WHERE donor_id=$1 AND org_id=$2`, [P("gus"), ORG]);
  const gusAfter = await installmentsRight(`p.org_id=$1 AND p.donor_id=$2`, [ORG, P("gus")]);
  ok("§7 the payment of what is left pays the last installment and fulfils the pledge",
     gusP.status === "fulfilled" && gusAfter.bad.length === 0 && Number(gusAfter.rows[0].paid) === 100075, { gusP, rows: gusAfter.rows });

  // the history import, undone: its pledges and their installments go with it
  const RUN = "imp_fix60sem" + Date.now().toString(36);
  const hist = await api("POST", "/gifts/import-history", tok, { importId: RUN,
    gifts: [{ donorId: P("ivy"), amount: 400, date: "2026-04-01", notes: "Payment on pledge G-90" }] });
  const rec = await api("POST", "/imports", tok, { id: RUN, name: "Fix60 history", shape: "gifts", summary: {} });
  const sem2 = await api("POST", "/donors/import-semantics", tok, { importId: RUN, pledges: [
    { donorName: "Ivy Lantern", donorEmail: "ivy@sweep4.test", amount: 1000, date: "2026-03-01", dueDate: "2026-12-31", externalId: "G-90", status: "open" }] });
  const ivy = await installmentsRight(`p.org_id=$1 AND p.donor_id=$2`, [ORG, P("ivy")]);
  ok("§7 the imported payment is the pledge's first installment, paid", hist.status === 200 && rec.status < 300 && sem2.status === 200
     && ivy.rows.length === 1 && ivy.bad.length === 0 && Number(ivy.rows[0].paid) === 40000, { hist: hist.status, rec: [rec.status, rec.body], rows: ivy.rows });
  const un = await api("POST", `/imports/${RUN}/reverse`, tok, {});
  const [left] = await q(`SELECT (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1 AND donor_id=$2) AS p,
                                 (SELECT COUNT(*)::int FROM pledge_installments i WHERE i.org_id=$1 AND NOT EXISTS (SELECT 1 FROM pledges p WHERE p.id=i.pledge_id)) AS orphan`, [ORG, P("ivy")]);
  ok("§7 Undo takes the import's pledge and every installment it wrote", un.status === 200 && left.p === 0 && left.orphan === 0, { status: un.status, body: un.body, left });

  // To confirm: a pledge form, confirmed in three monthly payments
  await q(`INSERT INTO capture_items (id,org_id,kind,stakes,status,source,headline,created_by) VALUES ('cap_fix60_pl',$1,'pledge','money','waiting','upload','A pledge form from Hal','system:test')`, [ORG]);
  const cf = await api("POST", "/capture/cap_fix60_pl/confirm", tok, { kind: "pledge", amountCents: 100001, donorId: P("hal"), frequency: "monthly", installments: 3, startDate: "2026-11-01" });
  const capP = await installmentsRight(`p.org_id=$1 AND p.idempotency_key='capture:cap_fix60_pl'`, [ORG]);
  ok("§7 To confirm's pledge is three installments summing to $1,000.01", cf.status === 200 && capP.rows.length === 1 && capP.rows[0].n === 3 && capP.bad.length === 0,
     { status: cf.status, body: cf.body, rows: capP.rows });

  // the profile (and the API) with a cadence
  const prof = await api("POST", `/donors/${P("hal")}/pledges`, tok, { amount: "1,000.00", dueDate: "2027-01-15", frequency: "quarterly", installmentCount: 3 });
  const profP = await installmentsRight(`p.id=$1`, [prof.body && prof.body.id]);
  ok("§7 the profile's pledge in three quarterly payments sums to the pledge", prof.status === 201 && profP.rows.length === 1 && profP.rows[0].n === 3 && profP.bad.length === 0, profP.rows);

  // an unpaid sponsorship at the event is a pledge with its installment
  const sp = await api("POST", `/events/${EVENT}/register`, tok, { levelId: "evl_sweep4_s", donorId: P("hal"), quantity: 1, paid: false });
  const spP = await installmentsRight(`p.org_id=$1 AND p.donor_id=$2 AND p.notes LIKE 'Sponsorship:%'`, [ORG, P("hal")]);
  ok("§7 an unpaid sponsorship is a pledge with one installment of the whole", sp.status === 201 && spP.rows.length === 1 && spP.bad.length === 0, { status: sp.status, body: sp.body, rows: spP.rows });

  const all = await installmentsRight(`p.org_id=$1`, [ORG]);
  ok("§7 every pledge in the org: installments to the cent, paid ones its payments", all.bad.length === 0, all.bad);
}

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

    // ── §7 FIX-60: every door that makes a pledge writes its installments
    await fix60(tok);

    // ── the truth check
    let agree = null;
    try { agree = await require("./lib/surfacesAgree").assertSurfacesAgree(ORG, { token: tok, soft: true, skip: ["atlas"] }); } catch (e) { agree = { ok: false, diffs: [e.message] }; }
    ok("every surface agrees on the org", agree && agree.ok, agree && agree.diffs);
  } catch (e) { console.error(e); ok("the suite ran to the end", false, e.message); }
  await closeDb();
  summary("sweep4-events-pledges");
})();
