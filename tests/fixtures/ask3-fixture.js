// ASK-3 · the fixture both ASK-3 tests ask about. Invented people, never the demo.
//   Lantern Appeal <Y-1> and Lantern Appeal <Y> (compared to it).
//   Flavia Testwater   $1,000 to last year's appeal, nothing to this year's,
//                      $300 unthanked general gift last July (her last gift).
//   Flavia Otherway    one $50 general gift: a second Flavia, in no appeal, so
//                      "Flavia" on its own is ambiguous on file.
//   Bram Lanternby     $400 then $600 (gave more); Cora Wickfield $500 then $200 (less).
const bcrypt = require("bcryptjs");
module.exports = async function ask3Fixture(q, ORG, { ai = false } = {}) {
  const Y = new Date().getUTCFullYear();
  for (const t of ["question_log", "threads", "interactions", "gifts", "campaigns", "donors", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,ai_enabled) VALUES ($1,'Ask Three Fixture',$2,1,'active','team','UTC',$3)`, [ORG, ORG.replace(/_/g, "-"), ai]);
  const email = `staff@${ORG}.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ask Staff','admin')`, [`u_${ORG}`, ORG, email, bcrypt.hashSync("loadtest1234", 10)]);
  const last = `c_${ORG}_last`, now = `c_${ORG}_now`;
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,compare_campaign_id) VALUES
     ($1,$3,$4,'appeal','completed',5000,$5,$6,NULL), ($2,$3,$7,'appeal','active',5000,$8,$9,$1)`,
    [last, now, ORG, `Lantern Appeal ${Y - 1}`, `${Y - 1}-01-01`, `${Y - 1}-12-31`, `Lantern Appeal ${Y}`, `${Y}-01-01`, `${Y}-12-31`]);
  const D = { flavia: "Flavia Testwater", other: "Flavia Otherway", bram: "Bram Lanternby", cora: "Cora Wickfield" };
  for (const [k, name] of Object.entries(D))
    await q(`INSERT INTO donors (id,org_id,name,city,stage,created_by,created_by_name) VALUES ($1,$2,$3,'Salem','active','system:test','test')`, [`d_${ORG}_${k}`, ORG, name]);
  const G = [
    ["flavia", `${Y - 1}-02-10`, 1000, last, true], ["flavia", `${Y - 1}-07-04`, 300, null, false],
    ["other", `${Y - 1}-08-01`, 50, null, true],
    ["bram", `${Y - 1}-02-12`, 400, last, true], ["bram", `${Y}-01-05`, 600, now, true],
    ["cora", `${Y - 1}-02-14`, 500, last, true], ["cora", `${Y}-01-06`, 200, now, true],
  ];
  let i = 0;
  for (const [k, date, amt, camp, thanked] of G)
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,campaign_id,acknowledgement_sent,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'system:test','test')`,
      [`g_${ORG}_${++i}`, ORG, `d_${ORG}_${k}`, amt, date, camp, thanked]);
  return { Y, email, last, now, flavia: `d_${ORG}_flavia`, other: `d_${ORG}_other`, campaignNow: `Lantern Appeal ${Y}`, campaignLast: `Lantern Appeal ${Y - 1}` };
};
