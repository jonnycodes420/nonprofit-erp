// tests/lib/atlas9Fixture.js · ATLAS-9. An org shaped like the fleet's re-run (23 Nov):
//   · Odile Marchetti: an open $25,000 ask for Youth Arts Access (stage Asked), a gift
//     not yet thanked, coffee tomorrow, and an older conversation (the brief, item 1).
//   · lapsed people of different sizes, one marked deceased and one do not contact,
//     and two big givers who are NOT lapsed but top the morning call list (item 3).
//   · Hugo Strand: $30,000 this fiscal year, then an $80 gift, so his last gift is
//     not his year (item 4, "a $19,049 donor reads as an $80 donor").
// Every date is relative to the run's day (tests/clock.js), so the shape holds on
// any day. Made-up names. tests/atlas6-grounded.test.js §7 reads it.
"use strict";
const bcrypt = require("bcryptjs");

const ORG = "org_atl9";
const ADMIN = "nell@atl9.test", PASSWORD = "loadtest1234";
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// [id, name, flags, gifts: [[daysAgo, amount, thanked]]]
const PEOPLE = [
  ["d_atl9_odile", "Odile Marchetti", {}, [[400, 5000, true], [58, 1500, false]]],
  ["d_atl9_hugo", "Hugo Strand", {}, [[20, 30000, true], [3, 80, false]]],
  ["d_atl9_wren", "Wren Okafor", {}, [[12, 9000, false]]],
  ["d_atl9_corwin", "Corwin Baskerfield", {}, [[620, 40000, true]]],
  ["d_atl9_mirela", "Mirela Fenwright", {}, [[900, 9000, true], [480, 3000, true]]],
  ["d_atl9_teodor", "Teodor Quill", {}, [[430, 250, true]]],
  ["d_atl9_agatha", "Agatha Pell", { deceased: true }, [[700, 50000, true]]],
  ["d_atl9_bram", "Bram Hollis", { do_not_contact: true }, [[560, 60000, true]]],
];
const LAPSED_ASKABLE = ["d_atl9_corwin", "d_atl9_mirela", "d_atl9_teodor"];   // by lifetime: 40,000 · 12,000 · 250

async function seed(q, today) {
  for (const t of ["interactions", "tasks", "threads", "gifts", "voice_memos", "atlas_actions", "opportunities", "calendar_events", "recurring_subscriptions"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,legal_name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,vocabulary_json,ai_enabled)
           VALUES ($1,'Larchmere Youth Studio','Larchmere Youth Studio, Inc.','larchmere-youth-studio',1,'active','team','America/New_York',NOW(),$2,false)
           ON CONFLICT (id) DO UPDATE SET vocabulary_json=EXCLUDED.vocabulary_json, ai_enabled=false, timezone='America/New_York'`,
    [ORG, JSON.stringify({ fiscal_year_start_month: 7 })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_atl9_nell',$1,$2,$3,'Nell Abara','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, org_id=EXCLUDED.org_id, deactivated_at=NULL`, [ORG, ADMIN, bcrypt.hashSync(PASSWORD, 4)]);
  let n = 0;
  for (const [id, name, flags, gifts] of PEOPLE) {
    // Created three years back, so every gift here is after the org's Steward start (thank-yous are owed).
    await q(`INSERT INTO donors (id,org_id,name,email,kind,deceased,do_not_contact,created_at,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'individual',$5,$6,$7::date,'u_atl9_nell','Nell Abara')`,
      [id, ORG, name, `${id}@atl9.test`, !!flags.deceased, !!flags.do_not_contact, addDays(today, -1100)]);
    for (const [ago, amount, thanked] of gifts)
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,acknowledgement_sent) VALUES ($1,$2,$3,$4,$5,'cash','Check',$6)`,
        [`g_atl9_${++n}`, ORG, id, amount, addDays(today, -ago), thanked]);
  }
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,proposal_stage,expected_close,created_by,created_by_name) VALUES ('o_atl9_odile',$1,'d_atl9_odile','Youth Arts Access',25000,'open','asked',$2::date,'u_atl9_nell','Nell Abara')`,
    [ORG, addDays(today, 20)]);
  // Coffee tomorrow at noon in New York.
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,booked_in_steward,created_by,created_by_name)
           VALUES ('ce_atl9_odile',$1,'u_atl9_nell','steward','pe_atl9_odile','Coffee with Odile',($2::date + time '12:00') AT TIME ZONE 'America/New_York',($2::date + time '13:00') AT TIME ZONE 'America/New_York',ARRAY['d_atl9_odile'],true,'u_atl9_nell','Nell Abara')`,
    [ORG, addDays(today, 1)]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name) VALUES ('i_atl9_odile',$1,'d_atl9_odile','call',$2,'Talked about the spring showcase.','u_atl9_nell','Nell Abara')`,
    [ORG, addDays(today, -30)]);
}

module.exports = { ORG, ADMIN, PASSWORD, PEOPLE, LAPSED_ASKABLE, seed, addDays };
