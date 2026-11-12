// tests/lib/atlas7Fixture.js · ATLAS-7. An org shaped like Jonathan's on 11 Nov:
// two journeys (Major donor, Welcome back), a Top 100 with three people on it,
// and 44 made-up people whose gifts make the four money windows differ:
//   A  20 people, one $1,500 gift 20 days ago (one of them do not contact)
//   B  10 people, $600 twice, 200 and 300 days ago ($1,200 in the last 12 months, no one gift over $1,000)
//   C   8 people, one $2,000 gift three years ago (lifetime and one gift, not the last 12 months)
//   D   6 people, $400 recently (never over $1,000)
// So "gave over $1,000" is 38 people in a lifetime, 30 in the last 12 months.
// The reproduction walk and tests/atlas7-group-ask.test.js share it.
"use strict";
const bcrypt = require("bcryptjs");

const ORG = "org_atl7";
const ADMIN = "rowan@atl7.test", PASSWORD = "loadtest1234";
const FIRST = ["Alder", "Briony", "Cosmo", "Delphine", "Ewart", "Fenella", "Gideon", "Hesper", "Ivo", "Juniper", "Kestrel", "Linnea", "Mabry", "Nevin", "Orla",
  "Percival", "Quilla", "Rafferty", "Saoirse", "Thaddeus", "Ulla", "Vesper", "Wystan", "Xanthe", "Yorick", "Zinnia"];
const LAST = ["Ashgrove", "Blackthorne", "Coldwater", "Dunmore", "Elsworth", "Farrowdale", "Greywick"];
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Each person: id, name, group, gifts [[date, dollars]].
function people(today) {
  const out = [];
  const plan = [["A", 20, [[-20, 1500]]], ["B", 10, [[-200, 600], [-300, 600]]], ["C", 8, [[-3 * 365, 2000]]], ["D", 6, [[-15, 400]]]];
  let i = 0;
  for (const [group, n, gifts] of plan) for (let k = 0; k < n; k++, i++) {
    out.push({ id: `d_atl7_${String(i).padStart(2, "0")}`, name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) + (i % 3)]}`, group,
      gifts: gifts.map(([off, amt]) => [addDays(today, off), amt + k]) });   // + k: no two alike, so the largest-giver order is one order
  }
  return out;
}

async function seed(q, today) {
  for (const t of ["portfolio_members", "portfolio_lists", "cultivation_plan_steps", "cultivation_plans", "cultivation_templates", "interactions", "tasks", "threads",
    "gifts", "voice_memos", "atlas_actions", "agent_writes", "agent_runs", "org_summary"])
    await q(`DELETE FROM ${t} WHERE ${t === "org_summary" ? "org_key" : "org_id"}=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,legal_name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,ai_enabled)
           VALUES ($1,'Bayview Literacy Project','Bayview Literacy Project','bayview-literacy',1,'active','team','America/New_York',NOW(),true)
           ON CONFLICT (id) DO UPDATE SET ai_enabled=true`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_atl7_rowan',$1,$2,$3,'Rowan Ellery','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, org_id=EXCLUDED.org_id, deactivated_at=NULL`,
    [ORG, ADMIN, bcrypt.hashSync(PASSWORD, 4)]);
  const all = people(today);
  let g = 0;
  for (const p of all) {
    await q(`INSERT INTO donors (id,org_id,name,email,kind,do_not_contact,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual',$5,'u_atl7_rowan','Rowan Ellery')`,
      [p.id, ORG, p.name, `${p.id}@atl7.test`, p.id === "d_atl7_05"]);
    for (const [date, amount] of p.gifts)
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method) VALUES ($1,$2,$3,$4,$5,'cash','Check')`, [`g_atl7_${++g}`, ORG, p.id, amount, date]);
    const life = p.gifts.reduce((s, [, a]) => s + a, 0);
    const last = p.gifts.slice().sort((x, y) => (x[0] < y[0] ? 1 : -1))[0];
    await q(`UPDATE donors SET total_giving=$1, last_gift_date=$2, last_gift_amount=$3 WHERE id=$4`, [life, last[0], last[1], p.id]);
  }
  const step = label => [{ type: "follow_up", label, offsetDays: 0 }];
  for (const [id, name] of [["ct_atl7_major", "Major donor"], ["ct_atl7_welcome", "Welcome back"]])
    await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,trigger_key,journey_enabled,ever_enabled,created_by,created_by_name)
             VALUES ($1,$2,$3,$4::jsonb,'by_hand',true,true,'u_atl7_rowan','Rowan Ellery')`, [id, ORG, name, JSON.stringify(step(name === "Major donor" ? "Visit" : "Thank"))]);
  await q(`INSERT INTO portfolio_lists (id,org_id,name,created_by,created_by_name) VALUES ('pfl_atl7',$1,'Top 100','u_atl7_rowan','Rowan Ellery')`, [ORG]);
  for (const [rank, id] of ["d_atl7_00", "d_atl7_01", "d_atl7_02"].entries())
    await q(`INSERT INTO portfolio_members (id,org_id,list_id,donor_id,rank,created_by,created_by_name) VALUES ($1,$2,'pfl_atl7',$3,$4,'u_atl7_rowan','Rowan Ellery')`,
      [`pfm_atl7_${rank}`, ORG, id, rank + 1]);
  return all;
}

// The words Jonathan typed on 11 Nov, exactly.
const HIS_WORDS = "I need you to log every donor that gave over 1000 in my top 100 and then put them in a journey for specifically a top 100 journey where I contact them every three months for a year I'm just a phone call.";

module.exports = { ORG, ADMIN, PASSWORD, people, seed, addDays, HIS_WORDS };
