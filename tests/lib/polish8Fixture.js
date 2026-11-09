// tests/lib/polish8Fixture.js · POLISH-8. One made-up org shaped like the
// fleet's descriptions (lead-2026-11-09): email on since Nov 3 with Journey and
// sequence steps on; three people with a next step; a household; a done task;
// a live "Year-end 2026" giving page with payments connected; a board with long
// names and an erased person; a person with one upload and two attachments;
// two "General appeal" drafts and templates; GALA marked sent to nobody; a
// "Spring 2026" campaign goal; and annual donors running late (Keep moves).
"use strict";
const bcrypt = require("bcryptjs");
const { api, q } = require("../helpers");
const { civilDay, dayOffset } = require("../clock");

const ORG = "org_polish8";
const PASSWORD = "loadtest1234";
const ME = "u_" + ORG;
const D = k => `d_p8_${k}`;
const WHO = ["system:test/polish8", "POLISH-8 test"];

async function build() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,
                             emails_enabled,onboarded_at,donor_mail_set_at,donor_mail_set_by_name,stripe_connected,stripe_account_id)
           VALUES ($1,'Polish Eight Wrenfield Arts','org-polish8',1,'active','team','America/New_York',NOW(),
                   TRUE,NOW() - interval '20 days',NOW() - interval '6 days','Steward support',TRUE,'acct_p8_test')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Mike Ostrander','admin')`,
    [ME, ORG, `${ORG}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  // one sign-in per run (a production-mode server limits sign-ins)
  const lg = await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: PASSWORD });
  const tok = lg.body && lg.body.token;
  if (!tok) throw new Error("sign-in failed: " + JSON.stringify(lg.body));
  const today = civilDay(undefined, "America/New_York");
  const person = (k, name, extra = {}) => q(
    `INSERT INTO donors (id,org_id,name,email,kind,person_types,stage,assigned_to,assigned_to_name,erased_at,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,'individual','["donor"]'::jsonb,$5,$6,$7,$8,$9,$10)`,
    [D(k), ORG, name, extra.email === undefined ? `${k}@polish8.example.org` : extra.email, extra.stage || null,
     extra.stage ? ME : null, extra.stage ? "Mike Ostrander" : null, extra.erased ? new Date() : null, ...WHO]);
  const gift = (k, amount, date) => api("POST", `/donors/${D(k)}/gifts`, tok, { amount, date, method: "check" });

  // §1 Email on (the org's switch), and Journey and sequence steps on.
  await q(`INSERT INTO org_mail_types (org_id,type_key,is_on,audience,set_at,set_by_name,created_by,created_by_name) VALUES ($1,'journey_steps',TRUE,'everyone',NOW(),'Mike Ostrander',$2,$3)`, [ORG, ...WHO]);

  // §2 People with a next step, owned by Mike.
  // (13 of them, the fleet's count: more than the Thread's first page of 12)
  const extra = ["Abel", "Bryn", "Cato", "Dara", "Elio", "Fenn", "Gale", "Hugo", "Ilse", "Jem"].map((n, i) => [`x${i}`, `${n} Quillon`, 10 + i]);
  for (const [k, name, d] of [["ines", "Ines Calloway", 3], ["jory", "Jory Penhallow", 6], ["kesi", "Kesi Tamberlane", 9], ...extra]) {
    await person(k, name);
    await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
             VALUES ($1,$2,$3,'call','Call about the spring visit',$4,$5,$6,'Mike Ostrander',$7,$8)`,
      [`th_p8_${k}`, ORG, D(k), dayOffset(d), dayOffset(-2), ME, ...WHO]);
  }

  // §3 A household of two.
  await person("hal", "Hal Fennimore"); await person("rue", "Rue Fennimore");
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id,created_by,created_by_name) VALUES ('hh_p8',$1,'The Fennimore household',$2,$3,$4)`, [ORG, D("hal"), ...WHO]);
  await q(`UPDATE donors SET household_id='hh_p8' WHERE id = ANY($1)`, [[D("hal"), D("rue")]]);

  // §4 A task, done.
  const t = await api("POST", "/tasks", tok, { title: "Post the spring newsletter", due: dayOffset(-1), type: "admin", priority: "medium" });
  const TASK = t.body && (t.body.id || (t.body.task && t.body.task.id));
  await api("POST", `/tasks/${TASK}/complete`, tok, { done: true });

  // §5 A live giving page.
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,page_kind,goal_amount,created_by,created_by_name) VALUES ('gp_p8','${ORG}','year-end-2026','Year-end 2026','active','give',5000,$1,$2)`, WHO);

  // §6 The board: long names, and one erased person who gave.
  await person("owen", "Owen Bartholomew-Castellanos", { stage: "cultivate" });
  await person("nath", "Nathaniel Wolstenholme-Abernathy", { stage: "cultivate" });
  await person("gone", "Erased person", { stage: "cultivate", erased: true, email: null });
  await gift("owen", 2500, dayOffset(-60)); await gift("gone", 1200, dayOffset(-90));

  // §8 One upload and two attachments on Pell.
  await person("pell", "Pell Ashcombe");
  await q(`INSERT INTO donor_materials (id,org_id,donor_id,file_name,file_type,file_data,uploaded_by) VALUES ('mat_p8',$1,$2,'proposal.txt','text/plain','eg==','Mike Ostrander')`, [ORG, D("pell")]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name) VALUES ('ix_p8',$1,$2,'note',$3,'Sent the photos.',$4,$5)`, [ORG, D("pell"), dayOffset(-4), ...WHO]);
  for (const n of [1, 2]) await q(`INSERT INTO interaction_attachments (id,org_id,interaction_id,donor_id,asset_id,filename,mime,bytes,created_by,created_by_name)
           VALUES ($1,$2,'ix_p8',$3,$4,$5,'image/png',10,$6,$7)`, [`att_p8_${n}`, ORG, D("pell"), `asset_p8_${n}`, `photo-${n}.png`, ...WHO]);

  // §9 Two "General appeal" drafts and two templates; §10 GALA sent to nobody;
  // §11 a Spring 2026 goal.
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,created_at,created_by,created_by_name) VALUES
           ('cmp_p8_ga1',$1,'General appeal','email','draft',NOW() - interval '30 days',$2,$3),
           ('cmp_p8_ga2',$1,'General appeal','email','draft',NOW() - interval '2 days',$2,$3),
           ('cmp_p8_gala',$1,'GALA','email','sent',NOW() - interval '10 days',$2,$3)`, [ORG, ...WHO]);
  await q(`UPDATE campaigns SET sent_at = NOW() - interval '9 days', recipient_count = 0 WHERE id='cmp_p8_gala'`);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,created_by,created_by_name)
           VALUES ('cmp_p8_spring',$1,'Spring 2026','appeal','draft',15000,'2026-03-01','2026-05-31',$2,$3)`, [ORG, ...WHO]);
  await q(`INSERT INTO email_templates (id,org_id,name,subject,blocks,created_at,created_by,created_by_name) VALUES
           ('tpl_p8_1',$1,'General appeal','Will you help?','[]'::jsonb,NOW() - interval '40 days',$2,$3),
           ('tpl_p8_2',$1,'General appeal','Will you help again?','[]'::jsonb,NOW() - interval '3 days',$2,$3)`, [ORG, ...WHO]);

  // §12 Year-end givers: Keep moves.
  for (const [k, name] of [["ula", "Ula Brightwater"], ["vic", "Vic Tannahill"], ["wren", "Wren Osgood"]]) {
    await person(k, name);
    // year-end givers: each December, the last one last year (insights.js yearEnd)
    const y = +today.slice(0, 4) - (today.slice(5, 7) === "12" ? 0 : 1);
    for (const yr of [y - 1, y]) await gift(k, 250, `${yr}-12-12`);
  }
  return { tok, lg, today, ORG, D, ME, TASK, PASSWORD };
}
module.exports = { build, ORG, D, ME, PASSWORD };
