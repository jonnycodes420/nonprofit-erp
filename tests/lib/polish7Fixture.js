// tests/lib/polish7Fixture.js · POLISH-7. One made-up org shaped like the
// fleet's descriptions: a July fiscal year, Louisa kept Current by Marlowe's
// gift, a volunteer with no shifts, a $450 pledge to write off, a foundation
// with a named contact whose address is the foundation's, a campaign that
// reached nobody, and three people called Faye Kovac.
"use strict";
const bcrypt = require("bcryptjs");
const { login, api, q } = require("../helpers");
const { civilDay, dayOffset } = require("../clock");

const ORG = "org_polish7";
const PASSWORD = "loadtest1234";
const D = k => `d_p7_${k}`;

async function build() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,'Polish Seven Tidewater Choir','org-polish7',1,'active','team','America/New_York',$2)`, [ORG, JSON.stringify({ fiscal_year_start_month: 7 })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ysolde Marrick','admin')`,
    ["u_" + ORG, ORG, `${ORG}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(`${ORG}@test.local`, PASSWORD);
  const person = (k, name, extra = {}) => q(
    `INSERT INTO donors (id,org_id,name,email,kind,person_types,contact_name,city,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'system:test/polish7','POLISH-7 test')`,
    [D(k), ORG, name, extra.email === undefined ? `${k}@polish7.example.org` : extra.email, extra.kind || "individual",
     JSON.stringify(extra.types || ["donor"]), extra.contact || null, extra.city || null]);
  const today = civilDay(undefined, "America/New_York");
  const gift = (k, amount, date) => api("POST", `/donors/${D(k)}/gifts`, tok, { amount, date, method: "check" });

  // Louisa and Marlowe, one household (spouse link); only Marlowe gave, three days ago.
  await person("marlowe", "Marlowe Quennell"); await person("louisa", "Louisa Quennell");
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,created_by,created_by_name)
           VALUES ('rel_p7_q',$1,$2,$3,'spouse','system:test/polish7','POLISH-7 test')`, [ORG, D("marlowe"), D("louisa")]);
  await gift("marlowe", 120, dayOffset(-3));
  await gift("louisa", 60, dayOffset(-500));
  // A volunteer with no shifts.
  await person("pim", "Pim Ardelle", { types: ["volunteer"] });
  // A $450 pledge to write off.
  await person("hollis", "Hollis Brannagh");
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ('pl_p7',$1,$2,450,$3,'open','system:test/polish7','POLISH-7 test')`,
    [ORG, D("hollis"), dayOffset(20)]);
  // A foundation: Ruth is its named contact, the address is the foundation's.
  await person("windermere", "Windermere Foundation", { kind: "organisation", contact: "Ruth Ashgrove", email: "grants@windermere.example.org" });
  await gift("windermere", 5000, dayOffset(-400));
  // A campaign marked sent that reached nobody, and one that reached two.
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,sent_at,recipient_count,created_by,created_by_name) VALUES
           ('cmp_p7_zero',$1,'Spring note to nobody','email','sent',now(),0,'system:test/polish7','POLISH-7 test'),
           ('cmp_p7_two',$1,'Autumn thanks','email','sent',now(),2,'system:test/polish7','POLISH-7 test')`, [ORG]);
  // Three people called Faye Kovac, told apart by email, city and last gift.
  await person("faye1", "Faye Kovac", { city: "Duluth" }); await gift("faye1", 25, dayOffset(-40));
  await person("faye2", "Faye Kovac", { city: "Ely", email: null }); await gift("faye2", 80, dayOffset(-200));
  await person("faye3", "Faye Kovac", { city: "Hibbing", email: "fkovac@polish7.example.org" });
  return { tok, today, ORG, D, PASSWORD };
}
module.exports = { build, ORG, D, PASSWORD };
