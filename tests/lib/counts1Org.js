// tests/lib/counts1Org.js: COUNTS-1. A fresh, empty org with one admin, for a
// suite that builds its own made-up people. Returns { orgId, token }.
"use strict";
const bcrypt = require("bcryptjs");
const H = require("../helpers");
const PASSWORD = "loadtest1234";
async function freshCountsOrg(id, name = "Counts Test Collective") {
  const q = H.q;
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  await H.mailTypesOn(id, "everyone", ["campaign"]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  const token = await H.login(email, PASSWORD);
  return { orgId: id, token };
}
module.exports = { freshCountsOrg };
