// ENGAGE-1 — THE ONE TEST: a donor's score breakdown parts sum to the score,
// and each part's rows are exactly the rows it counted.
//
// A fixture org with six people and every kind of touch the engagement score
// reads (a meeting, calls, an inbound reply, an outbound email that must NOT
// count, a call older than 24 months that must NOT count, an event attended, a
// volunteer shift, a newsletter click), plus gifts across five years and a
// recurring gift. After POST /scores/recompute, for every person:
//   1. the engagement parts add to the engagement score, and the generosity
//      parts add to the generosity score;
//   2. every part's rows (GET /figures/donor-*-part/rows, the screen's "See why")
//      are the rows that part counted: as many as its count, adding to its raw
//      total (points, or cents);
//   3. those rows are the right rows, checked against the database directly:
//      lifetime giving foots to SUM(gifts.amount) to the cent, and the touches
//      are exactly the fixture's ids (the old call and the outbound email are
//      not among them).
//
// How it fails, planted and watched before trusting it: make the compute count
// one more touch than the row builder returns (or drop the window from the
// breakdown only) and checks 2 and 3 go red; round a part independently instead
// of apportioning and check 1 goes red.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const orgTime = require("../orgTime");

const ORG = "org_eng1t", TZ = "America/New_York";
const PW = bcrypt.hashSync("loadtest1234", 10);
const P = ["d_e1_a", "d_e1_b", "d_e1_c", "d_e1_d", "d_e1_e", "d_e1_f", "d_e1_g"];

async function clear() {
  for (const t of ["donor_scores", "email_marketing_activity", "email_marketing_campaigns", "event_attendees", "events",
                   "volunteer_shifts", "recurring_subscriptions", "gifts", "interactions", "threads", "donors", "users"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
}
async function reset() {
  await clear();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'ENGAGE-1 scores','engage1-scores',1,'active','team',$2)`, [ORG, TZ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`,
    [`u_${ORG}`, ORG, `dana@${ORG}.local`, PW]);
  for (const [i, id] of P.entries()) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','system:test','test')`,
      [id, ORG, `Person ${"ABCDEFG"[i]}`, `p${i}@example.org`]);
  }
}

(async () => {
  await reset();
  const tok = await login(`dana@${ORG}.local`);
  const today = orgTime.orgToday({ timezone: TZ });
  const ago = n => orgTime.addDays(today, -n);
  const touch = (id, donor, type, date, meta = null) => q(
    `INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata,created_by) VALUES ($1,$2,$3,$4,'fixture',$5,$6,'u_${ORG}')`,
    [id, ORG, donor, type, date, meta ? JSON.stringify(meta) : null]);
  // A: a meeting, two calls, a reply; an outbound email and an old call that do not count.
  await touch("i_e1_m1", P[0], "meeting", ago(5));
  await touch("i_e1_c1", P[0], "call", ago(40));
  await touch("i_e1_c2", P[0], "call_reached", ago(400));
  await touch("i_e1_r1", P[0], "email", ago(10), { direction: "inbound" });
  await touch("i_e1_o1", P[0], "email", ago(11), { direction: "outbound" });
  await touch("i_e1_old", P[0], "call", ago(800));
  // B: one call. C: an event and a volunteer shift. D: a newsletter click. E, F: nothing.
  await touch("i_e1_c3", P[1], "call", ago(200));
  // G: a call and a reply, so seven people and six givers: percentiles that are
  // not round numbers, which is what makes a rounding mistake show.
  await touch("i_e1_c4", P[6], "call", ago(50));
  await touch("i_e1_r2", P[6], "email", ago(70), { direction: "inbound" });
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ('ev_e1',$1,'Open house','other',$2)`, [ORG, ago(60)]);
  await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status) VALUES ('ea_e1','ev_e1',$1,$2,'Person C','attended')`, [ORG, P[2]]);
  await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,created_by) VALUES ('vs_e1',$1,$2,$3,3,'system:test')`, [ORG, P[2], ago(20)]);
  await q(`INSERT INTO email_marketing_campaigns (id,org_id,provider,provider_campaign_id,name) VALUES ('emc_e1',$1,'mailchimp','mc1','Spring news')`, [ORG]);
  await q(`INSERT INTO email_marketing_activity (id,org_id,campaign_id,donor_id,opened,clicked,occurred_at) VALUES ('ema_e1',$1,'emc_e1',$2,true,true,NOW() - INTERVAL '3 days')`, [ORG, P[3]]);
  // Gifts: A gives every year and more this year; B once long ago; C monthly; D a refund against a gift; E twice.
  const gift = (id, donor, amount, date) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash','system:test','test')`,
    [id, ORG, donor, amount, date]);
  await gift("g_e1_a1", P[0], 100.10, ago(30));
  await gift("g_e1_a2", P[0], 50.05, ago(400));
  await gift("g_e1_a3", P[0], 75.33, ago(800));
  await gift("g_e1_a4", P[0], 60, ago(1200));
  await gift("g_e1_b1", P[1], 500, ago(1500));
  await gift("g_e1_c1", P[2], 25, ago(15));
  await gift("g_e1_c2", P[2], 25, ago(45));
  await gift("g_e1_d1", P[3], 40, ago(100));
  await gift("g_e1_d2", P[3], -10.01, ago(90));
  await gift("g_e1_e1", P[4], 1000, ago(500));
  await gift("g_e1_e2", P[4], 999.99, ago(200));
  await gift("g_e1_g1", P[6], 300, ago(700));
  await gift("g_e1_g2", P[6], 333.33, ago(20));
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_e1',$1,$2,'sub_e1_fixture',25,'month','active')`, [ORG, P[2]]);

  const rc = await api("POST", "/scores/recompute", tok, {});
  ok("the recompute ran for every person", rc.status === 200 && rc.body.people === P.length, rc.text.slice(0, 200));

  const expectTouches = { [P[0]]: { meetings: ["i_e1_m1"], calls: ["i_e1_c1", "i_e1_c2"], replies: ["i_e1_r1"] },
                          [P[1]]: { calls: ["i_e1_c3"] }, [P[2]]: { events: ["ea_e1"], volunteering: ["vs_e1"] }, [P[3]]: { email: ["ema_e1"] },
                          [P[6]]: { calls: ["i_e1_c4"], replies: ["i_e1_r2"] } };
  for (const id of P) {
    const s = (await api("GET", `/donors/${id}/scores`, tok)).body;
    const eSum = s.parts.engagement.reduce((a, p) => a + p.points, 0);
    const gSum = s.parts.generosity.reduce((a, p) => a + p.points, 0);
    ok(`${id}: engagement parts add to the score (${s.engagement})`, eSum === s.engagement, s.parts.engagement);
    ok(`${id}: generosity parts add to the score (${s.generosity})`, gSum === s.generosity, s.parts.generosity);

    for (const p of s.parts.engagement) {
      const r = (await api("GET", `/figures/donor-engagement-part/rows?donor=${id}&part=${p.key}&pageSize=200`, tok)).body;
      const pts = Math.round(r.rows.reduce((a, x) => a + Number(x.amount), 0) * 100);
      ok(`${id} ${p.key}: rows are as many as it counted (${p.count})`, r.totalRows === p.count, r.rows);
      ok(`${id} ${p.key}: rows add to its points before scaling (${p.raw})`, pts === Math.round(p.raw * 100), { pts, raw: p.raw });
      const want = ((expectTouches[id] || {})[p.key] || []).slice().sort();
      ok(`${id} ${p.key}: they are exactly the fixture's touches`, JSON.stringify(r.rows.map(x => x.id).sort()) === JSON.stringify(want), { got: r.rows.map(x => x.id), want });
    }
    for (const p of s.parts.generosity) {
      const r = (await api("GET", `/figures/donor-generosity-part/rows?donor=${id}&part=${p.key}&pageSize=200`, tok)).body;
      ok(`${id} ${p.key}: rows are as many as it counted (${p.count})`, r.totalRows === p.count, r.rows);
      if (["lifetime", "recent", "upgrade"].includes(p.key) && p.raw > 0) {
        ok(`${id} ${p.key}: rows add to its raw total to the cent`, r.cents === p.raw, { cents: r.cents, raw: p.raw });
      } else if (p.key === "consistency" || p.key === "monthly") {
        ok(`${id} ${p.key}: one row per thing it counted`, r.totalRows === p.raw, { rows: r.totalRows, raw: p.raw });
      }
      if (p.key === "lifetime") {
        const [{ c }] = await q(`SELECT COALESCE(ROUND(SUM(amount) * 100), 0)::bigint AS c FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, id]);
        ok(`${id} lifetime: foots to the database to the cent`, Math.max(0, Number(c)) === p.raw && (p.raw === 0 || r.cents === Number(c)), { db: c, raw: p.raw, rows: r.cents });
      }
    }
  }
  // The old call and the outbound email counted nothing, anywhere.
  const aCalls = (await api("GET", `/figures/donor-engagement-part/rows?donor=${P[0]}&part=calls&pageSize=200`, tok)).body.rows.map(r => r.id);
  ok("a call older than 24 months is not counted", !aCalls.includes("i_e1_old"), aCalls);

  await clear();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
