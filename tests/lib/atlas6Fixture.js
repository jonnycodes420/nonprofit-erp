// tests/lib/atlas6Fixture.js · ATLAS-6. An org shaped like the fleet's (10 Nov):
// a donor whose lifetime is four gifts and whose January to March 2026 is one
// of them; a donor whose $2,500 gift was on May 31, 2026 (never March 2025);
// an executive director named in Tax Receipts, the Brand kit and My profile.
// Made-up names. The reproduction walk and tests/atlas6-grounded.test.js share it.
"use strict";
const bcrypt = require("bcryptjs");

const ORG = "org_atl6";
const ADMIN = "dana@atl6.test", DIRECTOR = "hal@atl6.test", PASSWORD = "loadtest1234";
const PEOPLE = {
  warren: { id: "d_atl6_warren", name: "Warren Pelley", gifts: [["2024-06-10", 20000], ["2025-03-02", 11348], ["2026-02-14", 4361], ["2026-07-01", 5000]] },
  rosalind: { id: "d_atl6_rosalind", name: "Rosalind Kemp", gifts: [["2024-11-20", 27500], ["2025-09-15", 30000], ["2026-05-31", 2500]] },
  tobias: { id: "d_atl6_tobias", name: "Tobias Wren", gifts: [["2025-01-15", 150], ["2025-12-02", 275.5], ["2026-01-05", 300], ["2026-03-31", 125], ["2026-10-01", 80]] },
};

async function seed(q) {
  for (const t of ["interactions", "tasks", "threads", "gifts", "voice_memos", "atlas_actions", "org_summary"])
    await q(`DELETE FROM ${t} WHERE ${t === "org_summary" ? "org_key" : "org_id"}=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,legal_name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,ein,receipt_address,
                             receipt_signature_name,receipt_signature_title,vocabulary_json,ai_enabled)
           VALUES ($1,'Cedar Hollow Arts','Cedar Hollow Arts, Inc.','cedar-hollow-arts',1,'active','team','America/New_York',NOW(),'47-1234567',
                   '18 Mill Lane, Cedar Hollow, VT 05001','Hal Brennan','Executive Director',$2,true)
           ON CONFLICT (id) DO UPDATE SET receipt_signature_name=EXCLUDED.receipt_signature_name, receipt_signature_title=EXCLUDED.receipt_signature_title,
             ein=EXCLUDED.ein, receipt_address=EXCLUDED.receipt_address, legal_name=EXCLUDED.legal_name, vocabulary_json=EXCLUDED.vocabulary_json, ai_enabled=true`,
    [ORG, JSON.stringify({ fiscal_year_start_month: 7 })]);
  const hash = bcrypt.hashSync(PASSWORD, 4);
  for (const [id, email, name, title, role] of [["u_atl6_dana", ADMIN, "Dana Ortiz", "Development Director", "admin"], ["u_atl6_hal", DIRECTOR, "Hal Brennan", "Executive Director", "admin"]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,sign_title) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, org_id=EXCLUDED.org_id, sign_title=EXCLUDED.sign_title, deactivated_at=NULL`,
      [id, ORG, email, hash, name, role, title]);
  let n = 0;
  for (const p of Object.values(PEOPLE)) {
    await q(`INSERT INTO donors (id,org_id,name,email,kind,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','u_atl6_dana','Dana Ortiz')`,
      [p.id, ORG, p.name, `${p.id}@atl6.test`]);
    for (const [date, amount] of p.gifts)
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method) VALUES ($1,$2,$3,$4,$5,'cash','Check')`, [`g_atl6_${++n}`, ORG, p.id, amount, date]);
  }
}

module.exports = { ORG, ADMIN, DIRECTOR, PASSWORD, PEOPLE, seed };
