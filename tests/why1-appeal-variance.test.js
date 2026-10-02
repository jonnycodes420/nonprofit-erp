// tests/why1-appeal-variance.test.js — WHY-1 test 1. THE REASONS ARE THE MONEY.
//
//     "Why did <campaign> come in under last year?": the reasons' dollars sum
//     EXACTLY to the variance, each reason's rows are EXACTLY the donors it
//     counted, and the "who" list names nobody outside those rows.
//
// A fixture org with two campaigns a year apart and one donor in every part
// of the breakdown: two who have not given yet, one whose gift last time came
// after this year's (later-sent) window, one who gave less, one more, one the
// same (moves nothing), one new to the organisation, one who gave before but
// skipped last year's campaign, and a refund. Every amount has cents in it, so
// a sum done in floating point, or a part dropped, shows.
//
// HOW IT WOULD GO RED: leave a part out of the reasons (the variance stops
// footing); compute a reason's number apart from its rows (the rows stop
// footing to it); put a donor who gave more on the call list (who leaves the
// rows). Proven able to fail: dropping the "back" part from why.js's reasons
// turned the first assertion red by exactly $410.10.
//
// Standard scratch stack (tests/README.md), on the battery's own server.

const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api } = require("./helpers");

const ORG = "org_why1a";
const ADMIN = "staff@why1a.local";
const Y = new Date().getUTCFullYear() - 1;   // both campaigns wholly in the past
const C_NOW = "camp_why1a_now", C_LAST = "camp_why1a_last";

(async () => {
  for (const t of ["threads", "interactions", "gifts", "campaigns", "donor_scores", "donors", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Why One Fixture','why-one-a',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_why1a',$1,$2,$3,'Why Staff','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  // Last year's ran 1 March to 31 May; this year's went out twelve days later
  // and ended the same day, so its window is 79 days against 91.
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date) VALUES
             ($1,$2,'Fixture Appeal ${Y - 1}','appeal','completed',10000,'${Y - 1}-03-01','${Y - 1}-05-31'),
             ($3,$2,'Fixture Appeal ${Y}','appeal','completed',10000,'${Y}-03-13','${Y}-05-31')`, [C_LAST, ORG, C_NOW]);
  const D = ["lapsedA", "lapsedB", "late", "less", "more", "same", "fresh", "back"];
  for (const k of D)
    await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,$3,'active','system:test','test')`, [`d_why1a_${k}`, ORG, `Fixture ${k}`]);
  let n = 0;
  const gift = (k, amount, date, camp) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,campaign_id,campaign,created_by,created_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'system:test','test')`, [`g_why1a_${++n}`, ORG, `d_why1a_${k}`, amount, date, camp,
      camp === C_NOW ? `Fixture Appeal ${Y}` : camp === C_LAST ? `Fixture Appeal ${Y - 1}` : null]);
  await gift("lapsedA", 1200.25, `${Y - 1}-03-20`, C_LAST);
  await gift("lapsedB", 300.10, `${Y - 1}-04-02`, C_LAST);
  await gift("late", 450.45, `${Y - 1}-05-28`, C_LAST);          // day 88 of last year's: past this year's 79
  await gift("less", 800.80, `${Y - 1}-04-10`, C_LAST);
  await gift("less", 500.15, `${Y}-04-10`, C_NOW);
  await gift("more", 250.00, `${Y - 1}-04-11`, C_LAST);
  await gift("more", 400.33, `${Y}-04-11`, C_NOW);
  await gift("more", -50.00, `${Y}-04-20`, C_NOW);                // a refund comes off
  await gift("same", 100.00, `${Y - 1}-04-12`, C_LAST);
  await gift("same", 100.00, `${Y}-04-12`, C_NOW);
  await gift("fresh", 75.55, `${Y}-04-15`, C_NOW);                // first gift to the org
  await gift("back", 20.00, `${Y - 2}-11-01`, null);              // gave before, skipped last year's
  await gift("back", 410.10, `${Y}-04-16`, C_NOW);

  const tok = await login(ADMIN);
  await api("PUT", `/campaigns/${C_NOW}/compare`, tok, { compareId: C_LAST });
  const r = await api("POST", "/why/ask", tok, { key: "appeal", campaign: C_NOW });
  const a = r.body || {};
  ok("the question was answered", r.status === 200 && a.answered === true, JSON.stringify(a).slice(0, 300));

  // The variance, from the gifts themselves, in cents.
  const [t] = await q(`SELECT ROUND(COALESCE(SUM(amount) FILTER (WHERE campaign_id=$2),0)*100)::bigint AS now,
                              ROUND(COALESCE(SUM(amount) FILTER (WHERE campaign_id=$3),0)*100)::bigint AS last FROM gifts WHERE org_id=$1`, [ORG, C_NOW, C_LAST]);
  const variance = Number(t.now) - Number(t.last);
  const reasons = a.reasons || [];
  const total = reasons.reduce((s, x) => s + x.cents, 0);
  ok("§1 the reasons' dollars sum exactly to the variance", total === variance, `reasons ${total} vs variance ${variance}`);
  ok("§1 every part is there: lapsed, timing, less, more, new, back",
    ["lapsed", "timing", "less", "more", "new", "back"].every(k => reasons.some(x => x.key === k)), reasons.map(x => x.key).join(","));
  ok("§1 ranked by dollars, largest first", reasons.every((x, i) => !i || Math.abs(reasons[i - 1].cents) >= Math.abs(x.cents)), reasons.map(x => x.cents).join(","));

  // §2 Each reason's rows are exactly the donors it counted, footing to the cent.
  const EXPECT = { lapsed: ["lapsedA", "lapsedB"], timing: ["late"], less: ["less"], more: ["more"], new: ["fresh"], back: ["back"] };
  const inRows = new Set();
  for (const x of reasons) {
    const qs = new URLSearchParams({ ...x.source.params, pageSize: "200" }).toString();
    const f = await api("GET", `/figures/${x.source.key}/rows?${qs}`, tok);
    const rows = (f.body && f.body.rows) || [];
    const ids = rows.map(w => w.donorId).sort();
    rows.forEach(w => inRows.add(w.donorId));
    ok(`§2 ${x.key}: the rows are exactly the donors it counted`, JSON.stringify(ids) === JSON.stringify(EXPECT[x.key].map(k => `d_why1a_${k}`).sort()) && ids.length === x.count, ids.join(","));
    ok(`§2 ${x.key}: the rows foot to the reason, to the cent`, f.body && f.body.cents === x.cents
      && rows.reduce((s, w) => s + Math.round(w.amount * 100), 0) === x.cents, `${f.body && f.body.cents} vs ${x.cents}`);
  }
  ok("§2 the donor who gave the same moves nothing and is in no part", !inRows.has("d_why1a_same"), "");

  // §3 Who: inside the rows, and only the ones the money left with.
  const who = (a.who || []).map(w => w.donorId);
  ok("§3 the who list contains no donor outside the reasons' rows", who.length > 0 && who.every(id => inRows.has(id)), who.join(","));
  ok("§3 who is the lapsed, late and downgraded, ranked by last year's gift",
    JSON.stringify(who) === JSON.stringify(["lapsedA", "less", "late", "lapsedB"].map(k => `d_why1a_${k}`)), who.join(","));
  ok("§3 the step plans calls and sends nothing", a.step && a.step.kind === "plan" && a.step.items.every(i => who.includes(i.donorId)), JSON.stringify(a.step));

  summary();
  await closeDb();
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
