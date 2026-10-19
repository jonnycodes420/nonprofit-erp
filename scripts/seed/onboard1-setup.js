// scripts/seed/onboard1-setup.js · ONBOARD-1. RIVERBEND, BEFORE SETUP.
//
// Harborlight is already set up, so "Set up Steward for me" cannot be shown on
// it. This seeds a SECOND, small demo org, Riverbend Food Pantry, in the state
// a new customer arrives in: an org, its director and nothing else. Jonathan
// signs in as the director and runs setup live, with:
//   * the sample export: scripts/demo-sites/riverbend/riverbend-salesforce-
//     contacts.csv and -donations.csv (also downloadable from
//     <API>/demo-site/riverbend/), a Salesforce Contacts and Donations pair;
//   * the fixture website: <API>/demo-site/riverbend/, fictional, served by
//     Steward itself so nothing reads a real organization's site.
// Every name in it is invented. The org sends nothing (emails_enabled=false,
// is_demo_org=true), and a re-seed puts it back to before setup.
"use strict";

const bcrypt = require("bcryptjs");

const RIVERBEND = "org_riverbend_demo";
const EMAIL = "director@riverbend.demo";
const PASSWORD = "demo-riverbend-2026";

async function seedOnboard1(q, { teardownOrg, TZ = "America/New_York" } = {}) {
  if (!teardownOrg) throw new Error("onboard1 seed: teardownOrg is required, so a re-seed starts from nothing");
  const td = await teardownOrg(q, RIVERBEND, { exit: false });
  if (td && td.ok === false) throw new Error("onboard1 seed: the previous Riverbend could not be removed: " + td.message);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,emails_enabled,is_demo_org,receipts_enabled)
           VALUES ($1,'Riverbend Food Pantry','riverbend-demo',0,'active','team',$2,NOW(),false,true,false)`, [RIVERBEND, TZ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_riverbend_demo',$1,$2,$3,'Delphine Okafor-Marsh','admin')`,
    [RIVERBEND, EMAIL, bcrypt.hashSync(PASSWORD, 10)]);
  const [n] = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS donors, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS gifts`, [RIVERBEND]);
  if (n.donors || n.gifts) throw new Error("onboard1 seed: Riverbend must start empty");
  console.log(`[seed] ONBOARD-1: Riverbend Food Pantry, before setup (${EMAIL})`);
}

module.exports = { seedOnboard1, RIVERBEND, EMAIL, PASSWORD };
