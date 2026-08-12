#!/usr/bin/env node
// BUILD-46 §8(5) — demo seed: one donor giving at TWO portal-enabled,
// network-listed demo orgs, so the dashboard shows the whole story (home
// cards, unified recurring, tax summary, both impact feeds).
//
// LOCAL-ONLY by design: writes rows directly via db.js and refuses to run
// against anything but the scratch stack (prod demo seeding is a separate,
// deliberate step once the launch flags are flipped). Idempotent.
//
// Usage: DATABASE_URL=…:5544/steward_loadtest DB_SSL=disable node scripts/seed-build46-network-demo.js

const { getDb, query, run } = require("../db");

const A = { org: "org_n46a", slug: "harbor-music-n46", name: "Harbor Music School", accent: "#1a6b4a" };
const B = { org: "org_n46b", slug: "open-door-n46", name: "Open Door Pantry", accent: "#846e32" };
const DEMO_EMAIL = "alex.demo@n46.test";
const Y = new Date().getFullYear();

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")) {
    console.error("REFUSED: this seed is local-only (scratch stack). Set DATABASE_URL to the :5544 scratch DB.");
    process.exit(1);
  }
  await getDb();
  for (const o of [A, B]) {
    await run(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,stripe_connected)
               VALUES ($1,$2,$3,1,'active','core',$4,true) ON CONFLICT (id) DO NOTHING`, [o.org, o.name, o.slug, "acct_" + o.org]);
    await run(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,accent_color,contact_email,footer_text)
               VALUES ($1,true,true,$2,$3,$4,$5)
               ON CONFLICT (org_id) DO UPDATE SET enabled=true, network_listed=true, display_name=EXCLUDED.display_name, accent_color=EXCLUDED.accent_color`,
      [o.org, o.name, o.accent, "hello@" + o.slug + ".org", o.name + " · A BUILD-46 demo organization"]);
  }
  // Donor records at both orgs under the ONE demo email.
  await run(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage)
             VALUES ('d_n46a_alex',$1,'Alex Demo',$2,650,4,'${Y}-06-10','mid','steward') ON CONFLICT (id) DO NOTHING`, [A.org, DEMO_EMAIL]);
  await run(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage)
             VALUES ('d_n46b_alex',$1,'Alex Demo',$2,340,3,'${Y}-07-04','mid','steward') ON CONFLICT (id) DO NOTHING`, [B.org, DEMO_EMAIL]);
  const gifts = [
    ["g_n46a_1", A.org, "d_n46a_alex", 150, `${Y}-02-14`], ["g_n46a_2", A.org, "d_n46a_alex", 100, `${Y}-06-10`],
    ["g_n46a_3", A.org, "d_n46a_alex", 250, `${Y - 1}-12-02`], ["g_n46a_4", A.org, "d_n46a_alex", 150, `${Y - 1}-05-20`],
    ["g_n46b_1", B.org, "d_n46b_alex", 40, `${Y}-03-01`], ["g_n46b_2", B.org, "d_n46b_alex", 100, `${Y}-07-04`],
    ["g_n46b_3", B.org, "d_n46b_alex", 200, `${Y - 1}-11-27`],
  ];
  for (const [id, org, donor, amt, date] of gifts)
    await run(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ($1,$2,$3,$4,$5,'cash','') ON CONFLICT (id) DO NOTHING`, [id, org, donor, amt, date]);
  const pdf = Buffer.from("%PDF-1.4 build46-demo-receipt").toString("base64");
  await run(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data)
             VALUES ('r_n46a_1',$1,'d_n46a_alex','g_n46a_2','gift','${Y}-00201',100,100,'{}',$2) ON CONFLICT (id) DO NOTHING`, [A.org, pdf]);
  await run(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data)
             VALUES ('r_n46b_1',$1,'d_n46b_alex','g_n46b_3','gift','${Y - 1}-00088',200,200,'{}',$2) ON CONFLICT (id) DO NOTHING`, [B.org, pdf]);
  await run(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status)
             VALUES ('rs_n46a',$1,'d_n46a_alex','sub_n46a',25,'month','active') ON CONFLICT (id) DO NOTHING`, [A.org]);
  await run(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status)
             VALUES ('rs_n46b',$1,'d_n46b_alex','sub_n46b',10,'month','active') ON CONFLICT (id) DO NOTHING`, [B.org]);
  const updates = [
    ["imp_n46a_1", A.org, "The spring recital filled the hall", "Ninety students performed. Your giving keeps lesson fees at half of cost."],
    ["imp_n46a_2", A.org, "Twelve new practice-room hours a week", "Evening access doubled for students without an instrument at home."],
    ["imp_n46b_1", B.org, "A record month: 2,100 grocery boxes", "Every Thursday line moved faster with the new cold-storage room your gifts funded."],
    ["imp_n46b_2", B.org, "Weekend meals for 300 kids", "The backpack program now covers every school in the district."],
  ];
  for (const [id, org, title, body] of updates)
    await run(`INSERT INTO impact_updates (id,org_id,title,body,targets,org_wide,status) VALUES ($1,$2,$3,$4,'[]',true,'published') ON CONFLICT (id) DO NOTHING`, [id, org, title, body]);
  console.log(`Seeded. Demo donor email: ${DEMO_EMAIL} — orgs: ${A.name} (${A.slug}), ${B.name} (${B.slug})`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
