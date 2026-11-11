// tests/lib/polish9Fixture.js · POLISH-9. One made-up org shaped like the
// fleet's descriptions (lead-2026-11-10):
//   §1 an internal name with "(Demo)" in it and a public name set in the
//      portal, payments connected, a "Studio Scholarships" fund, and a giving
//      form at /give/<slug>
//   §2/§3 gifts this fiscal year and last, two designations of $30,350.00
//      and more with long fund names (the Board's "Giving by designation")
//   §4 a draft "New donor, first year" journey whose steps are the template's
//      OLD seven-month timing (made before FIX-4 retimed it to twelve)
//   §5 a Sep 30 import from before Steward checked imports: 40 rows in the
//      file, every count 0
//   §6 a contact who has never given ("Jonathan Ashgrove", person type
//      contact) and a volunteer, and a "General appeal" draft to all of them
//   §7 email turned on by "Jonathan" on Nov 3 (the stored string), then
//      changed by Mike Henderson on Nov 6 (in the audit log)
//   §8 a donor with a gift whose amount the walk edits
"use strict";
const bcrypt = require("bcryptjs");
const { api, q } = require("../helpers");
const { civilDay, dayOffset } = require("../clock");

const ORG = "org_polish9";
const SLUG = "wrenfield-p9";
const PASSWORD = "loadtest1234";
const ME = "u_" + ORG;
const D = k => `d_p9_${k}`;
const WHO = ["system:test/polish9", "POLISH-9 test"];
const INTERNAL = "Wrenfield Arts (Demo)";
const PUBLIC = "Wrenfield Arts Collective";
const FUND = "fund_p9_studio";
const FUND_LONG = "fund_p9_long";

// The template's steps as they were before FIX-4: seven touches, the last at day 210.
const OLD_NEW_DONOR_STEPS = [
  { type: "thank", label: "Call to say thank you", offsetDays: 2, draft: null },
  { type: "send", label: "Send a handwritten note", offsetDays: 7, draft: null },
  { type: "send", label: "Send the impact report", offsetDays: 45, draft: "impact_report" },
  { type: "follow_up", label: "Ask them for a visit", offsetDays: 75, draft: null },
  { type: "follow_up", label: "Invite them to something", offsetDays: 120, draft: "event_invitation" },
  { type: "follow_up", label: "Check in, no ask", offsetDays: 165, draft: null },
  { type: "check_in_ask", label: "Make the ask", offsetDays: 210, draft: "the_ask" },
];

async function wipe() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
}

async function build() {
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,
                             emails_enabled,onboarded_at,donor_mail_set_at,donor_mail_set_by_name,stripe_connected,stripe_account_id,org_kind)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),
                   TRUE,'2026-09-01','2026-11-03T15:00:00Z','Jonathan',TRUE,'acct_p9_test','customer')`, [ORG, INTERNAL, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Mike Henderson','admin')`,
    [ME, ORG, `${ORG}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  await q(`INSERT INTO portal_settings (org_id,display_name) VALUES ($1,$2)`, [ORG, PUBLIC]);
  // one sign-in per run (a production-mode server limits sign-ins)
  const lg = await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: PASSWORD });
  const tok = lg.body && lg.body.token;
  if (!tok) throw new Error("sign-in failed: " + JSON.stringify(lg.body));

  // §1 the fund a donor picks, by its staff-side name (no public name set)
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Studio Scholarships',TRUE)`, [FUND, ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Community Residencies and Teaching Artists',TRUE)`, [FUND_LONG, ORG]);

  const person = (k, name, types = ["donor"], email) => q(
    `INSERT INTO donors (id,org_id,name,email,kind,person_types,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,'individual',$5::jsonb,$6,$7)`,
    [D(k), ORG, name, email === undefined ? `${k}@polish9.example.org` : email, JSON.stringify(types), ...WHO]);
  const gift = (k, amount, date, fundId) => api("POST", `/donors/${D(k)}/gifts`, tok, { amount, date, method: "check", ...(fundId ? { fundId } : {}) });

  // §2/§3 giving this fiscal year and last, two big designations
  await person("ada", "Ada Merriweather"); await person("bram", "Bram Okonjo"); await person("cleo", "Cleo Vantassel");
  const today = civilDay(undefined, "America/New_York");
  const r1 = await gift("ada", 30350, dayOffset(-20), FUND);
  if (r1.status >= 300) throw new Error("gift failed: " + JSON.stringify(r1.body));
  await gift("bram", 30350.5, dayOffset(-15), FUND_LONG);
  await gift("cleo", 1250, dayOffset(-380));

  // §4 the draft journey made before FIX-4
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,preset_key,journey_enabled,description,created_at)
           VALUES ('ct_p9_newdonor',$1,'New donor, first year',$2::jsonb,'new_donor_first_year',FALSE,
                   'Thank them properly, show them what it did, then ask again.','2026-08-14')`, [ORG, JSON.stringify(OLD_NEW_DONOR_STEPS)]);

  // §5 the Sep 30 import, from before Steward checked imports
  await q(`INSERT INTO imports (id,org_id,name,source_filename,shape,rows_in,gifts_created,rows_set_aside,rows_errored,dollars_in,dollars_created,donors_created,
                                started_at,committed_at,created_at,actor_user_id,actor_user_name)
           VALUES ('imp_p9_sep30',$1,'harbor-gifts-sept.csv','harbor-gifts-sept.csv','gifts',40,0,0,0,0,0,0,
                   '2026-09-30T16:00:00Z','2026-09-30T16:01:00Z','2026-09-30T16:00:00Z',$2,'Mike Henderson')`, [ORG, ME]);

  // §6 a contact who has never given, a volunteer, and the appeal to them
  await person("jon", "Jonathan Ashgrove", ["contact"]);
  // nine givers whose names also start "Jonathan A", all ahead of him by giving (prod-shaped: a big file)
  for (const [i, last] of ["Abernathy", "Adler", "Alcott", "Amari", "Ames", "Archer", "Arden", "Ashby", "Avery"].entries()) {
    await person(`ja${i}`, `Jonathan ${last}`);
    await gift(`ja${i}`, 50 + i * 10, dayOffset(-30 - i));
  }
  await person("vee", "Vera Tolliver", ["volunteer"]);

  // §8 the donor whose gift amount the walk edits
  await person("ed", "Edda Pellingham");
  const g8 = await gift("ed", 400, dayOffset(-10));

  return { tok, lg, D, ORG, SLUG, INTERNAL, PUBLIC, FUND, today, gift8: g8.body && (g8.body.id || (g8.body.gift && g8.body.gift.id)) };
}

module.exports = { build, wipe, ORG, SLUG, D, INTERNAL, PUBLIC, FUND, OLD_NEW_DONOR_STEPS, ME };
