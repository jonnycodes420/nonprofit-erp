// tests/atlas3/fixture.js · ATLAS-3. One made-up org for the suite and the walk.
// Four people gave last December and nothing this year; Marlowe has an About
// note, two conversations and a next step; Stephen and Margaret are married;
// Henrik has no $10,000 gift on record.
"use strict";
const bcrypt = require("bcryptjs");
const ORG = "org_atlas3", ADMIN = "atlas3-admin@example.org", USER = "u_atlas3";
const sys = "'system:test','test'";

async function reset(q) {
  const first = ["atlas_actions", "voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "audience_members", "audiences",
    "donor_relationships", "interactions", "tasks", "threads", "gifts", "donors", "user_sessions", "users"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function seed(q, today) {
  const y = Number(today.slice(0, 4));
  const lastDec = d => `${y - 1}-12-${String(d).padStart(2, "0")}`;
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,legal_name,ein,onboarded_at)
           VALUES ($1,'Lantern Bay Arts',$2,1,'active','team','America/New_York',NOW(),true,'Lantern Bay Arts Inc','12-3456780',NOW())`, [ORG, "atlas3-test"]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rowan Pike','admin')`, [USER, ORG, ADMIN, pw]);
  const P = [
    // id, name, email, about
    ["d_a3_marlowe", "Marlowe Quince", "marlowe.q@example.org", "Prefers email on weekdays; loves youth arts."],
    ["d_a3_sterling", "Sterling Nakamura", "sterling.n@example.org", ""],
    ["d_a3_odette", "Odette Varga", "odette.v@example.org", ""],
    ["d_a3_piers", "Piers Lindqvist", "piers.l@example.org", ""],
    ["d_a3_tamsin", "Tamsin Okafor", "tamsin.o@example.org", ""],
    ["d_a3_stephen", "Stephen Hollis", "stephen.h@example.org", ""],
    ["d_a3_margaret", "Margaret Hollis", "margaret.h@example.org", ""],
    ["d_a3_henrik", "Henrik Vale", "henrik.v@example.org", ""],
  ];
  for (const [id, name, email, about] of P) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,about_them,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,${sys})`, [id, ORG, name, email, about || null]);
  }
  // Last December, and nothing this year: Sterling ($900), Odette ($400), Piers ($250), Marlowe ($150).
  const G = [["g_a3_1", "d_a3_sterling", 900, lastDec(12)], ["g_a3_2", "d_a3_odette", 400, lastDec(18)], ["g_a3_3", "d_a3_piers", 250, lastDec(3)],
    ["g_a3_4", "d_a3_marlowe", 150, lastDec(20)],
    // Gave last December AND this year: not in the list.
    ["g_a3_5", "d_a3_tamsin", 300, lastDec(9)], ["g_a3_6", "d_a3_tamsin", 300, `${y}-03-14`],
    // Henrik gave $250 this spring, never $10,000.
    ["g_a3_7", "d_a3_henrik", 250, `${y}-04-02`]];
  for (const [id, did, amt, date] of G) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash',${sys})`, [id, ORG, did, amt, date]);
  }
  await q(`UPDATE donors d SET total_giving = s.t, gift_count = s.n, first_gift_date = s.f, last_gift_date = s.l,
             last_gift_amount = (SELECT amount FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id ORDER BY date DESC LIMIT 1)
           FROM (SELECT donor_id, SUM(amount) t, COUNT(*)::int n, MIN(date) f, MAX(date) l FROM gifts WHERE org_id=$1 GROUP BY donor_id) s
          WHERE d.id = s.donor_id AND d.org_id=$1`, [ORG]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name,created_by) VALUES
    ('i_a3_1',$1,'d_a3_marlowe','call',$2,'Called about the spring showcase; she wants to bring her niece.','Rowan Pike','system:test'),
    ('i_a3_2',$1,'d_a3_marlowe','meeting',$3,'Coffee downtown. Asked how the mural program is going.','Rowan Pike','system:test')`, [ORG, `${y}-10-20`, `${y}-06-11`]);
  await q(`INSERT INTO tasks (id,org_id,donor_id,title,due,done,created_by,created_by_name) VALUES ('t_a3_1',$1,'d_a3_marlowe','Send Marlowe the showcase invitation',$2,0,${sys})`, [ORG, `${y}-11-20`]);
}
module.exports = { ORG, ADMIN, USER, reset, seed };
