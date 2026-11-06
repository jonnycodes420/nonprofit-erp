// tests/atlas4/fixture.js · ATLAS-4. One made-up org for the suite and the walk.
// Sterling gave $900 last December and $1,244 the December before (lifetime
// $2,144); Odette gave $400 last December. Marlowe has an About note and a
// conversation; Wren has never given. Email is switched on for the org, and
// every automatic email type is off.
"use strict";
const bcrypt = require("bcryptjs");
const ORG = "org_atlas4", ADMIN = "atlas4-admin@example.org", USER = "u_atlas4";
const sys = "'system:test','test'";
const ABOUT = "Prefers email on weekdays; loves youth arts, and asked us twice to invite her niece to the spring showcase before tickets go on sale.";

async function reset(q) {
  const first = ["fin_audit_log", "atlas_actions", "voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "audience_members", "audiences",
    "interactions", "tasks", "threads", "gifts", "sequences", "org_mail_types", "donors", "user_sessions", "users"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function seed(q, today) {
  const y = Number(today.slice(0, 4));
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,legal_name,ein,onboarded_at,
                             emails_enabled,donor_mail_set_at,donor_mail_set_by_name)
           VALUES ($1,'Kestrel Point Arts',$2,1,'active','team','America/New_York',NOW(),true,'Kestrel Point Arts Inc','12-3456781',NOW(),true,NOW() - INTERVAL '2 days','Steward support')`, [ORG, "atlas4-test"]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,sign_name,sign_title) VALUES ($1,$2,$3,$4,'Rowan Pike','admin','Rowan Pike','Development Director')`, [USER, ORG, ADMIN, pw]);
  const P = [
    ["d_a4_marlowe", "Marlowe Quince", "marlowe.q@example.org", ABOUT],
    ["d_a4_sterling", "Sterling Nakamura", "sterling.n@example.org", ""],
    ["d_a4_odette", "Odette Varga", "odette.v@example.org", ""],
    ["d_a4_wren", "Wren Achterberg", "wren.a@example.org", ""],
  ];
  for (const [id, name, email, about] of P) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,about_them,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,${sys})`, [id, ORG, name, email, about || null]);
  }
  const G = [["g_a4_1", "d_a4_sterling", 900, `${y - 1}-12-12`], ["g_a4_2", "d_a4_sterling", 1244, `${y - 2}-12-08`],
    ["g_a4_3", "d_a4_odette", 400, `${y - 1}-12-18`], ["g_a4_4", "d_a4_marlowe", 150, `${y - 1}-12-20`]];
  for (const [id, did, amt, date] of G) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash',${sys})`, [id, ORG, did, amt, date]);
  }
  await q(`UPDATE donors d SET total_giving = s.t, gift_count = s.n, first_gift_date = s.f, last_gift_date = s.l,
             last_gift_amount = (SELECT amount FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id ORDER BY date DESC LIMIT 1)
           FROM (SELECT donor_id, SUM(amount) t, COUNT(*)::int n, MIN(date) f, MAX(date) l FROM gifts WHERE org_id=$1 GROUP BY donor_id) s
          WHERE d.id = s.donor_id AND d.org_id=$1`, [ORG]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name,created_by) VALUES
    ('i_a4_1',$1,'d_a4_marlowe','call',$2,'Called about the spring showcase; she wants to bring her niece and asked whether the mural program needs volunteers.','Henderson Ames','system:test')`, [ORG, `${y}-10-20`]);
  // Two sequences made before the builder (the Earlier list), both off.
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,created_by,created_by_name) VALUES
    ('seq_a4_1',$1,'Welcome series','first_gift','paused',${sys}), ('seq_a4_2',$1,'Lapsed check-in','lapsed','paused',${sys})`, [ORG]).catch(() => {});
}
module.exports = { ORG, ADMIN, USER, ABOUT, reset, seed };
