// scripts/seed/clientsafe1-meadowbrook.js · CLIENT-SAFE-1. MEADOWBROOK, IN
// PRIVACY MODE.
//
// Harborlight serves young people, not clients with health records, so privacy
// mode is shown on a SECOND small demo org: Meadowbrook Riding Center, a
// fictional therapeutic riding center. The setting is on, six people are
// marked as clients (two of them also give, and their gifts are on file as
// usual), and two emails from donors have a health detail held back. Every
// name is invented. The org sends nothing (emails_enabled=false,
// is_demo_org=true), and a re-seed puts it back exactly as it was.
"use strict";

const bcrypt = require("bcryptjs");

const MEADOWBROOK = "org_meadowbrook_demo";
const EMAIL = "director@meadowbrook.demo";
const PASSWORD = "demo-meadowbrook-2026";
const USER = "u_meadowbrook_demo";
const HELD = "Mentioned a health matter. Open it in your mailbox.";

// [id, name, email, client, gift dollars or 0]
const PEOPLE = [
  ["d_mb_whitcombe", "Eleanor Whitcombe", "eleanor.whitcombe@example.org", false, 2500],
  ["d_mb_farris", "Desmond Farris", "desmond.farris@example.org", false, 500],
  ["d_mb_quill", "Harriet Quill", "harriet.quill@example.org", false, 1200],
  ["d_mb_osei", "Kwame Osei", "kwame.osei@example.org", false, 250],
  ["d_mb_lindgren", "Maren Lindgren", "maren.lindgren@example.org", true, 300],
  ["d_mb_bastos", "Rafael Bastos", "rafael.bastos@example.org", true, 150],
  ["d_mb_achterberg", "Ilse Achterberg", "ilse.achterberg@example.org", true, 0],
  ["d_mb_navarro", "Lucia Navarro", "lucia.navarro@example.org", true, 0],
  ["d_mb_pembrook", "Tobias Pembrook", "tobias.pembrook@example.org", true, 0],
  ["d_mb_saito", "Kenji Saito", "kenji.saito@example.org", true, 0],
];

async function seedClientSafe1(q, { teardownOrg, TZ = "America/New_York", TODAY } = {}) {
  if (!teardownOrg) throw new Error("clientsafe1 seed: teardownOrg is required, so a re-seed starts from nothing");
  const td = await teardownOrg(q, MEADOWBROOK, { exit: false });
  if (td && td.ok === false) throw new Error("clientsafe1 seed: the previous Meadowbrook could not be removed: " + td.message);
  const today = TODAY || new Date().toISOString().slice(0, 10);
  const sys = ["system:seed", "Demo seed"];
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,emails_enabled,is_demo_org,receipts_enabled,
                             inbound_email_enabled,client_privacy,client_privacy_changed_at,client_privacy_changed_by)
           VALUES ($1,'Meadowbrook Riding Center','meadowbrook-demo',1,'active','team',$2,NOW(),false,true,false,false,true,NOW(),'Wren Calloway')`, [MEADOWBROOK, TZ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Calloway','admin')`,
    [USER, MEADOWBROOK, EMAIL, bcrypt.hashSync(PASSWORD, 10)]);
  for (const [id, name, email, client, dollars] of PEOPLE) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,is_client,total_giving,first_gift_date,last_gift_date,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$7,$8,$9)`,
      [id, MEADOWBROOK, name, email, client, dollars, dollars ? today : null, ...sys]);
    if (dollars) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,created_by,created_by_name)
                          VALUES ($1,$2,$3,$4,$5,'cash','Check',$6,$7)`, ["g_" + id.slice(2), MEADOWBROOK, id, dollars, today, ...sys]);
  }
  // Two emails from donors, each logged with its health sentence replaced.
  const mails = [
    ["int_mb_held1", "d_mb_whitcombe", "Thank you for the open house",
      `Thank you for showing us the new arena on Saturday. ${HELD} We would like to sponsor a horse for the spring session.`],
    ["int_mb_held2", "d_mb_quill", "Volunteering in November",
      `I can help with the Tuesday sessions again in November. ${HELD} Please put me down for the 4pm group.`],
  ];
  for (const [id, donorId, subject, body] of mails) {
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
             VALUES ($1,$2,$3,'email',$4,$5,$6,'Wren Calloway',$7)`,
      [id, MEADOWBROOK, donorId, `Replied to Wren Calloway: ${subject}\n\n${body}`, today, `system:mailbox/google/${USER}`,
       JSON.stringify({ message_id: "seed_" + id, provider: "google", direction: "inbound", subject, held_back: "health", mail_kind: "personal", logged_by: USER })]);
    await q(`INSERT INTO privacy_holds (id,org_id,donor_id,interaction_id,source,kind,created_by) VALUES ($1,$2,$3,$4,'mailbox','health',$5)`,
      ["ph_" + id.slice(4), MEADOWBROOK, donorId, id, `system:mailbox/google/${USER}`]);
  }
  const [n] = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND is_client)::int AS clients,
                              (SELECT COUNT(*) FROM privacy_holds WHERE org_id=$1)::int AS held`, [MEADOWBROOK]);
  if (n.clients !== 6 || n.held !== 2) throw new Error(`clientsafe1 seed: expected 6 clients and 2 held details, got ${n.clients} and ${n.held}`);
  console.log(`[seed] CLIENT-SAFE-1: Meadowbrook Riding Center, privacy mode on, 6 clients, 2 held-back details (${EMAIL})`);
}

module.exports = { seedClientSafe1, MEADOWBROOK, EMAIL, PASSWORD };
