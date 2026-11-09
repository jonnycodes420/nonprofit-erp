// tests/atlas5/fixture.js · ATLAS-5. One made-up org for the suite and the walk.
// Lantern Cove Rowing, in New York time. Two people share the first name
// Walter (so "which Walter?" is asked); Sterling has a note the fleet asked
// about; Juniper has a lunch already logged.
"use strict";
const bcrypt = require("bcryptjs");
const ORG = "org_atlas5", ADMIN = "atlas5-admin@example.org", USER = "u_atlas5";
const sys = "'system:test','test'";

async function reset(q) {
  const first = ["fin_audit_log", "atlas_actions", "voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "audience_members", "audiences",
    "interactions", "tasks", "threads", "gifts", "donors", "user_sessions", "users"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function seed(q, today, { ai = false } = {}) {
  const y = Number(today.slice(0, 4));
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,legal_name,ein,onboarded_at,ai_enabled)
           VALUES ($1,'Lantern Cove Rowing',$2,1,'active','team','America/New_York',NOW(),true,'Lantern Cove Rowing Inc','12-3456785',NOW(),$3)`, [ORG, "atlas5-test", !!ai]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,sign_name,sign_title) VALUES ($1,$2,$3,$4,'Tamsin Reyes','admin','Tamsin Reyes','Executive Director')`, [USER, ORG, ADMIN, pw]);
  const P = [
    ["d_a5_sterling", "Sterling Ashby", "sterling.a@example.org"],
    ["d_a5_walter1", "Walter Brennick", "walter.b@example.org"],
    ["d_a5_walter2", "Walter Osei", "walter.o@example.org"],
    ["d_a5_juniper", "Juniper Hale", "juniper.h@example.org"],
  ];
  for (const [id, name, email] of P) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,${sys})`, [id, ORG, name, email]);
  }
  const G = [["g_a5_1", "d_a5_sterling", 1200, `${y - 1}-12-12`], ["g_a5_2", "d_a5_walter1", 300, `${y - 1}-06-08`], ["g_a5_3", "d_a5_walter2", 75, `${y - 1}-03-18`]];
  for (const [id, did, amt, date] of G) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash',${sys})`, [id, ORG, did, amt, date]);
  }
  await q(`UPDATE donors d SET total_giving = s.t, gift_count = s.n, first_gift_date = s.f, last_gift_date = s.l,
             last_gift_amount = (SELECT amount FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id ORDER BY date DESC LIMIT 1)
           FROM (SELECT donor_id, SUM(amount) t, COUNT(*)::int n, MIN(date) f, MAX(date) l FROM gifts WHERE org_id=$1 GROUP BY donor_id) s
          WHERE d.id = s.donor_id AND d.org_id=$1`, [ORG]);
  // Juniper's lunch, logged once. An answer about her names it once.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name,created_by) VALUES
    ('i_a5_1',$1,'d_a5_juniper','meeting',$2,'Lunch at the boathouse; she wants to sponsor a youth eight next spring.','Tamsin Reyes','system:test')`, [ORG, `${y}-10-20`]);
}
module.exports = { ORG, ADMIN, USER, reset, seed };
