// FIX-34 builder B · one status on the profile, one raised figure on Fundraising.
//
// 2. Emily Jackson gave $27,500 this year, has a meeting booked, and read "On
//    track" in green beside a "DRIFTING · UNSURE" badge, "Nothing we can see
//    for 6 months" and "Engagement 33, Distant". Every reader the profile
//    renders must say the same status: the drift badge and its reason line
//    (GET /donors/:id .drift), the closeness line (GET /donors/:id/status) and
//    the score card's band word (GET /donors/:id/scores).
// G. The goal bar read "$0 of $25,000" above "Raised FY 2026-27 $119,737.03".
//    With no campaign, the goal bar counts the same gifts as the Raised card.
//
// Fails before the fix: the badge says drifting while the closeness line says
// On track, the band word says Distant, and the goal bar sums its own 90-day
// window to $0.
const bcrypt = require("bcryptjs");
const { ok, login, api, q, civilPlusDays } = require("../helpers");

const ORG = "org_fix34b_status", ORG2 = "org_fix34b_goal";
const EMILY = "d_fix34b_emily";

async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of ["meeting_effects", "calendar_events", "donor_scores", "gifts", "fundraising_goals", "interactions", "threads", "tasks", "donors", "users"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    }
    for (let i = 0; i < 25; i++) {
      const err = await q(`DELETE FROM orgs WHERE id=$1`, [o]).then(() => null, e => e);
      if (!err) break;
      const t = err.table || (/on table "(\w+)"/.exec(err.message || "") || [])[1];
      if (!t || t === "orgs") throw err;
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]);
    }
  }
}

async function run() {
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  for (const [o, slug] of [[ORG, "fix34b-status"], [ORG2, "fix34b-goal"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW())`, [o, `FIX-34 B ${slug}`, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${o}`, o, `dana@${o}.local`, pw]);
  }

  // ── 2 · EMILY'S PATTERN ───────────────────────────────────────────────────
  // Quarterly for two years, then four gifts in the last year totalling
  // $27,500, the latest six months ago. Her median gap is about 91 days, so
  // six months is past it (drift's own rule says drifting), yet four gifts in
  // a year is her whole usual year (FIX-33's aboveOwnPattern). Two import rows
  // refused, which is what put "Nothing we can see" on her line. A meeting is
  // booked for next week and no conversation is logged.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_at,created_by,created_by_name)
           VALUES ($1,$2,'Emily Fixture','emily@fix34b.local','active','active','["has-refused-rows:2"]',NOW() - INTERVAL '3 years','system:test','fix34 b')`, [EMILY, ORG]);
  const gifts = [[-800, 2000], [-709, 2000], [-617, 2000], [-525, 2000], [-270, 10000], [-230, 7500], [-206, 5000], [-182, 5000]];
  for (const [i, [d, amt]] of gifts.entries()) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','fix34 b')`,
      [`g_fix34b_${i}`, ORG, EMILY, amt, civilPlusDays(d)]);
  }
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by,created_by_name)
           VALUES ('ce_fix34b',$1,$2,'google','ev_fix34b','Coffee with Emily',NOW() + INTERVAL '6 days',NOW() + INTERVAL '6 days 1 hour',ARRAY[$3],'system:test','fix34 b')`,
    [ORG, `u_${ORG}`, EMILY]);
  await q(`INSERT INTO meeting_effects (id,org_id,calendar_event_id,donor_id,day,created_by,created_by_name)
           VALUES ('me_fix34b',$1,'ce_fix34b',$2,$3,'system:test','fix34 b')`, [ORG, EMILY, civilPlusDays(6)]);

  const T = await login(`dana@${ORG}.local`);
  const donor = await api("GET", `/donors/${EMILY}`, T);
  const status = await api("GET", `/donors/${EMILY}/status`, T);
  const scores = await api("GET", `/donors/${EMILY}/scores`, T);
  ok("2 · the three profile readers answer", donor.status === 200 && status.status === 200 && scores.status === 200,
    [donor.status, status.status, scores.status]);
  const close = status.body && status.body.closeness;
  const drift = donor.body && donor.body.drift;
  ok("2 · she gave four times in the last year and has a meeting set (the fixture is her pattern)",
    !!(status.body && status.body.meetingSet), status.body && status.body.meetingSet);
  ok("2 · the closeness line says she is on her own pattern", close && close.key === "on_track", close);
  ok("2 · so no drift badge and no 'Nothing we can see' line ride the same profile", drift == null, drift);
  ok("2 · the score card's band word is the closeness word, not a second opinion",
    scores.body && close && scores.body.bandLabel === close.label, { band: scores.body && scores.body.bandLabel, closeness: close && close.label });
  const words = [close && close.key, drift ? "drifting" : null, scores.body && scores.body.band].filter(Boolean);
  ok("2 · ONE status across the readers", new Set(words).size === 1, words);

  // ── G · THE GOAL BAR COUNTS THE RAISED CARD'S GIFTS ───────────────────────
  // Gifts dated in the last two days (inside this fiscal year, before the goal's window), a
  // goal set in onboarding: labelled "25,000", today to 90 days out.
  await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,created_by,created_by_name) VALUES ('d_fix34b_g',$1,'Goal Fixture','active','active','[]','system:test','fix34 b')`, [ORG2]);
  for (const [i, amt] of [[0, 60000], [1, 59737.03]]) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,'d_fix34b_g',$3,$4,'system:test','fix34 b')`,
      [`g_fix34b_goal_${i}`, ORG2, amt, civilPlusDays(-1 - i)]);
  }
  await q(`INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label) VALUES ('goal_fix34b',$1,$2,$3,'total_raised',25000,'25,000')`,
    [ORG2, civilPlusDays(0), civilPlusDays(90)]);
  const T2 = await login(`dana@${ORG2}.local`);
  const ov = await api("GET", "/fundraising/overview", T2);
  const g = ov.body && ov.body.goal, period = ov.body && ov.body.period;
  ok("G · the overview answers with a goal and a Raised figure", ov.status === 200 && !!g && !!period, ov.body);
  ok("G · the Raised card counts this year's gifts", period && Math.round(period.raised * 100) === 11973703, period);
  ok("G · the goal bar shows the same raised figure as the Raised card", g && period && Math.round(g.currentAmount * 100) === Math.round(period.raised * 100),
    { goal: g && g.currentAmount, raised: period && period.raised });
  ok("G · and says which gifts it counts", g && /same gifts as Raised/.test(g.sourceNote || ""), g && g.sourceNote);
  ok("G · a bare amount is not shown as the goal's name", g && g.label == null, g && g.label);
  ok("G · 'On pace' never rides a bar at $0", !(g && Number(g.currentAmount) <= 0 && (g.paceState === "on_track" || g.paceState === "ahead")), g);

  await reset();
}

module.exports = { run };
if (require.main === module) run().then(async()=>{await require("../helpers").closeDb();require("../helpers").summary();}).catch(async e=>{console.error(e);process.exit(1);});
