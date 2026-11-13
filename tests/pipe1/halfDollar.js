// tests/pipe1/halfDollar.js · PIPE-1 §3, run by tests/pipe1-pipeline.test.js on a
// stack of its own at one fixed date (tests/lib/pinnedStack.js runAt). Not a
// suite by itself.
//
// One calendar-year org. Yesterday it took $20,000.00; the same day last year it
// took $30,149.50. So giving is exactly $10,149.50 behind last year at this
// point, on whatever date the stack is pinned to: the half-dollar case that
// sent polish4-units red on 13 Nov. Home must say "$10,150 behind", and the
// truth check (assertSurfacesAgree) must agree with Home, the Board,
// Fundraising and Reports. Made-up names. Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("../helpers");
const { assertSurfacesAgree } = require("../lib/surfacesAgree");
const { civilDay, dayOffset } = require("../clock");

const ORG = "org_pipe1_half";
const PASSWORD = "loadtest1234";

async function main() {
  const at = civilDay();
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Pipe Half Dollar Trust','pipe1-half',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Noor Halvorsen','admin')`,
    ["u_" + ORG, ORG, `${ORG}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(`${ORG}@test.local`, PASSWORD);
  for (const [id, name] of [["a", "Wren Castellano"], ["b", "Ola Brightwater"]]) {
    await q(`INSERT INTO donors (id,org_id,name,kind,stage,created_by,created_by_name,created_at,updated_at)
             VALUES ($1,$2,$3,'person','steward','system:test/pipe1','PIPE-1 test',NOW()-INTERVAL '3 years',NOW()-INTERVAL '3 years')`, [`${ORG}_${id}`, ORG, name]);
  }
  const yesterday = dayOffset(-1);
  const lastYear = `${Number(yesterday.slice(0, 4)) - 1}${yesterday.slice(4)}`;
  const g1 = await api("POST", `/donors/${ORG}_a/gifts`, tok, { amount: 20000, date: yesterday, type: "one-time", payment_method: "check" });
  const g2 = await api("POST", `/donors/${ORG}_b/gifts`, tok, { amount: 30149.5, date: lastYear, type: "one-time", payment_method: "check" });
  ok(`[${at}] the two gifts are recorded`, g1.status < 300 && g2.status < 300, [g1.status, g2.status]);

  const lead = await api("GET", "/home/lead", tok);
  const doors = (lead.body && lead.body.doors) || {};
  const line = (doors.why && doors.why.line) || (doors.what && doors.what.line) || "";
  ok(`[${at}] Home says giving is $10,150 behind last year (half away from zero)`, /\$10,150 behind last year/.test(line), line || lead.body);

  const r = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: `at ${at}` });
  ok(`[${at}] every surface agrees with the key, Home's door included`, r.ok, r.diffs.join(" | "));
}

main().catch(e => ok("halfDollar ran", false, e.stack)).finally(async () => { await closeDb().catch(() => {}); summary(); });
