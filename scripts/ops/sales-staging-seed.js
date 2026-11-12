// scripts/ops/sales-staging-seed.js · SALES-1. STAGING'S MADE-UP SALES CRM.
//
// Called by scripts/ops/staging-seed.js (which refuses anything but staging),
// never on its own and never on prod. Wipes every sales_ table and writes a
// fixed, made-up book so Muse can walk /ops → Sales: 12 organizations, 20
// contacts, 8 deals across the Direct pipeline's stages (one in Later, one in
// Lost), a few activities and an open task. Every name is invented; every
// domain is under example.org. Part B adds the partners and the mailbox fixture.
"use strict";

const ACTOR = ["system:staging-seed", "Staging seed (made-up sales CRM)"];
const STAGES = [["Lead", 5, "open", false], ["Contacted", 10, "open", false], ["Meeting booked", 20, "open", false], ["Demo done", 35, "open", false],
  ["Donors loaded", 55, "open", false], ["Verbal yes", 80, "open", true], ["Trial", 90, "open", true], ["Paying", 100, "won", true], ["Later", 0, "later", false], ["Lost", 0, "lost", false]];
const sid = n => `sst_${n.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")}`;

const ORGS = [
  ["Fernhollow Reading Circle", "fernhollow", "Asheville", "NC", "Bloomerang"], ["Tidewater Kids Rowing", "tidewaterrow", "Norfolk", "VA", "none"],
  ["Quarry Hill Food Share", "quarryhill", "Barre", "VT", "Little Green Light"], ["Lanternfly Arts Lab", "lanternfly", "Easton", "PA", "spreadsheets"],
  ["Mossbank Senior Meals", "mossbank", "Duluth", "MN", "DonorPerfect"], ["Brightwater Literacy", "brightwater", "Tacoma", "WA", "Bloomerang"],
  ["Cinder Lane Shelter", "cinderlane", "Flagstaff", "AZ", "none"], ["Harrowgate Music School", "harrowgate", "Ithaca", "NY", "Neon"],
  ["Pebblecreek Watershed", "pebblecreek", "Boise", "ID", "Givebutter"], ["Saltgrass Youth Theatre", "saltgrass", "Galveston", "TX", "none"],
  ["Northstar Tutoring Fund", "northstartutor", "Fargo", "ND", "Bloomerang"], ["Willowmere Animal Rescue", "willowmere", "Eugene", "OR", "spreadsheets"],
];
const FIRST = ["Avery", "Bram", "Celia", "Dario", "Esme", "Folke", "Greer", "Hollis", "Ines", "Jory", "Kestrel", "Linnea", "Mott", "Noor", "Oren", "Pia", "Quill", "Rafe", "Sable", "Tamsin"];
const LAST = ["Ashdown", "Birchall", "Crane", "Dunmore", "Ellery", "Fenwick", "Galloway", "Hartigan", "Ivers", "Jessop", "Kittredge", "Lowell", "Marchbank", "Nettle", "Oakes", "Pembry", "Quarles", "Ravel", "Stroud", "Thorne"];
const ROLES = ["ED", "Development Director", "Board", "Other"];
// [org index, name, stage, value $, close in days, next step]
const DEALS = [
  [0, "Fernhollow – Core", "Demo done", 350, 20, "Send the import guide"], [1, "Tidewater – Team", "Meeting booked", 600, 45, null],
  [2, "Quarry Hill – Core", "Paying", 350, -40, "Check in after month two"], [3, "Lanternfly – Core", "Lead", 250, 60, null],
  [4, "Mossbank – Team", "Verbal yes", 600, 7, "Paper by Friday"], [5, "Brightwater – Core", "Trial", 350, 10, "Kickoff call"],
  [6, "Cinder Lane – Core", "Later", 300, 90, null], [7, "Harrowgate – Team", "Lost", 500, -10, null],
];

// opts.payingStewardOrgId: a staging org the Paying deal's organization is linked to, so the ledger has a month to show.
async function seedSales(q, now = Date.now(), opts = {}) {
  const day = n => new Date(now + n * 86400000).toISOString().slice(0, 10);
  for (const t of ["sales_activity_links", "sales_activities", "sales_stage_history", "sales_links", "sales_deals", "sales_contacts", "sales_orgs",
    "sales_views", "sales_merges", "sales_imports", "sales_properties", "sales_stages", "sales_pipelines", "sales_settings",
    "sales_payouts", "sales_deal_partners", "sales_partner_terms", "sales_partners", "sales_email_links", "sales_emails", "sales_mailboxes",
    "sales_list_members", "sales_lists", "sales_cadence_enrollments", "sales_cadences", "sales_referral_links"]) await q(`DELETE FROM ${t}`);
  // Every record has an owner: staging's first live super-admin, if there is one.
  const [owner] = await q(`SELECT id FROM users WHERE is_super_admin = true AND deactivated_at IS NULL ORDER BY created_at LIMIT 1`);
  const OWNER = owner ? owner.id : null;
  await q(`INSERT INTO sales_pipelines (id,name,position,created_by,created_by_name) VALUES ('spl_direct','Direct',0,$1,$2)`, ACTOR);
  for (const [i, [name, p, kind, onb]] of STAGES.entries()) {
    await q(`INSERT INTO sales_stages (id,pipeline_id,name,position,probability,limit_days,kind,onboarding,created_by,created_by_name) VALUES ($1,'spl_direct',$2,$3,$4,21,$5,$6,$7,$8)`,
      [sid(name), name, i, p, kind, onb, ...ACTOR]);
  }
  for (const [i, [name, slug, city, state, crm]] of ORGS.entries()) {
    await q(`INSERT INTO sales_orgs (id,name,domain,website,city,state,current_crm,nonprofit_type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'Prospect',$8,$9)`,
      [`sor_stg_${i}`, name, `${slug}.example.org`, `https://${slug}.example.org`, city, state, crm, ...ACTOR]);
  }
  for (let i = 0; i < 20; i++) {
    const org = i % 12, slug = ORGS[org][1];
    await q(`INSERT INTO sales_contacts (id,first_name,last_name,title,emails,role,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [`sco_stg_${i}`, FIRST[i], LAST[i], ["Executive Director", "Development Director", "Board Chair", "Volunteer lead"][i % 4],
        JSON.stringify([`${FIRST[i].toLowerCase()}@${slug}.example.org`]), ROLES[i % 4], ...ACTOR]);
    await q(`INSERT INTO sales_links (id,a_type,a_id,b_type,b_id,is_primary,created_by,created_by_name) VALUES ($1,'contact',$2,'org',$3,true,$4,$5)`,
      [`sli_stg_c${i}`, `sco_stg_${i}`, `sor_stg_${org}`, ...ACTOR]);
  }
  for (const [i, [org, name, stage, dollars, close, next]] of DEALS.entries()) {
    const kind = STAGES.find(s => s[0] === stage)[2];
    await q(`INSERT INTO sales_deals (id,name,pipeline_id,stage_id,value_cents,close_date,source,next_step,next_step_on,revisit_on,lost_reason,trial_ends_on,
               stage_entered_at,won_at,lost_at,created_by,created_by_name)
             VALUES ($1,$2,'spl_direct',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,$14,$15)`,
      [`sde_stg_${i}`, name, sid(stage), dollars * 100, day(close), ["Referral", "Conference", "Cold email", "Partner"][i % 4], next, next ? day(i % 3 - 1) : null,
        kind === "later" ? day(-1) : null, kind === "lost" ? "Chose to stay on their spreadsheet" : null, stage === "Trial" ? day(9) : null,
        new Date(now - (i === 1 ? 30 : 5) * 86400000).toISOString(), kind === "lost" ? new Date(now - 10 * 86400000).toISOString() : null, ...ACTOR]);
    // Made 60 days ago (so a win 40 days ago reads as 20 days to close, never a negative).
    await q(`UPDATE sales_deals SET created_at = $1 WHERE id = $2`, [new Date(now - 60 * 86400000).toISOString(), `sde_stg_${i}`]);
    if (kind === "won") await q(`UPDATE sales_deals SET won_at = $1 WHERE id = $2`, [new Date(now - 40 * 86400000).toISOString(), `sde_stg_${i}`]);
    await q(`INSERT INTO sales_stage_history (id,deal_id,to_stage_id,to_name,at,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`ssh_stg_${i}`, `sde_stg_${i}`, sid(stage), stage, new Date(now - 30 * 86400000).toISOString(), ...ACTOR]);
    await q(`INSERT INTO sales_links (id,a_type,a_id,b_type,b_id,is_primary,created_by,created_by_name) VALUES ($1,'deal',$2,'org',$3,true,$4,$5)`, [`sli_stg_d${i}`, `sde_stg_${i}`, `sor_stg_${org}`, ...ACTOR]);
    await q(`INSERT INTO sales_links (id,a_type,a_id,b_type,b_id,label,created_by,created_by_name) VALUES ($1,'deal',$2,'contact',$3,'Champion',$4,$5)`, [`sli_stg_dc${i}`, `sde_stg_${i}`, `sco_stg_${org}`, ...ACTOR]);
  }
  const acts = [["meeting", "Demo of Home and the Thread", 0, [["deal", "sde_stg_0"], ["contact", "sco_stg_0"]]], ["call", "Intro call; they use Bloomerang", -3, [["org", "sor_stg_5"]]],
    ["note", "Board meets on the 2nd Tuesday", -6, [["org", "sor_stg_4"]]], ["task", "Send pricing for two seats", -2, [["deal", "sde_stg_1"]]]];
  for (const [i, [kind, body, d, recs]] of acts.entries()) {
    await q(`INSERT INTO sales_activities (id,kind,at,body,due_on,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`sac_stg_${i}`, kind, new Date(now + d * 86400000).toISOString(), body, kind === "task" ? day(d) : null, ...ACTOR]);
    for (const [t, id] of recs) await q(`INSERT INTO sales_activity_links (activity_id,record_type,record_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5)`, [`sac_stg_${i}`, t, id, ...ACTOR]);
  }
  for (const t of ["sales_orgs", "sales_contacts", "sales_deals", "sales_activities"]) await q(`UPDATE ${t} SET owner_id = $1`, [OWNER]);
  if (opts.payingStewardOrgId) await q(`UPDATE sales_orgs SET steward_org_id = $1 WHERE id = 'sor_stg_2'`, [opts.payingStewardOrgId]);

  // Part B: two made-up partners. Linden's terms don't stack (finder OR closer); Bracken's reseller term runs with no end, capped.
  await q(`INSERT INTO sales_partners (id,name,company,contact_name,contact_email,terms_stack,created_by,created_by_name) VALUES
           ('spt_stg_linden','Linden Partners','Linden Partners LLC','Odile Marsh','odile@linden.example.org',false,$1,$2),
           ('spt_stg_bracken','Bracken Consulting','Bracken Consulting','Teodor Vane','teo@bracken.example.org',true,$1,$2)`, ACTOR);
  await q(`INSERT INTO sales_partner_terms (id,partner_id,kind,percent,flat_cents,recurring,months,cap_cents,created_by,created_by_name) VALUES
           ('stm_stg_finder','spt_stg_linden','finder',10,NULL,true,12,NULL,$1,$2),
           ('stm_stg_closer','spt_stg_linden','closer',40,NULL,false,NULL,NULL,$1,$2),
           ('stm_stg_resell','spt_stg_bracken','reseller',NULL,10000,true,NULL,120000,$1,$2)`, ACTOR);
  await q(`INSERT INTO sales_deal_partners (id,deal_id,partner_id,term_id,created_by,created_by_name) VALUES
           ('sdp_stg_1','sde_stg_2','spt_stg_linden','stm_stg_finder',$1,$2),
           ('sdp_stg_2','sde_stg_5','spt_stg_bracken','stm_stg_resell',$1,$2)`, ACTOR);
  await q(`INSERT INTO sales_links (id,a_type,a_id,b_type,b_id,created_by,created_by_name) VALUES ('sli_stg_p1','partner','spt_stg_linden','org','sor_stg_2',$1,$2)`, ACTOR);

  // Part B: the fake mailbox fixture. No permission is held (nothing is ever read from it); four made-up emails on the records.
  await q(`INSERT INTO sales_mailboxes (id,provider,address,user_id,status,created_by,created_by_name) VALUES ('smb_stg','microsoft','sales-fixture@example.org',$1,'fixture',$2,$3)`, [OWNER || "system:staging-seed", ...ACTOR]);
  let seal = () => null;
  try { const { sealBag } = await import("../../shared/secretBox.js"); seal = t => sealBag({ text: t }, { aad: "sales" }); } catch { /* no key: bodies stay empty */ }
  const mails = [["sem_stg_1", "out", "sco_stg_0", "Following up on the demo", 8, "Thanks for the time on Tuesday. Here is the import guide."],
    ["sem_stg_2", "in", "sco_stg_4", "Re: Paper for Mossbank", 2, "We'll have it signed by Friday."],
    ["sem_stg_3", "out", "sco_stg_4", "Paper for Mossbank", 3, "Attached is the agreement."],
    ["sem_stg_4", "out", "sco_stg_1", "Pricing for two seats", 1, "Here is the pricing we discussed."]];
  for (const [id, dir, contact, subject, daysAgo, body] of mails) {
    const [c] = await q(`SELECT emails FROM sales_contacts WHERE id = $1`, [contact]);
    const other = (c.emails || [])[0];
    let sealed = null; try { sealed = seal(body); } catch { sealed = null; }
    await q(`INSERT INTO sales_emails (id,mailbox_id,provider_message_id,subject,from_addr,to_addrs,sent_at,direction,body_sealed,created_by,created_by_name)
             VALUES ($1,'smb_stg',$1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)`,
      [id, subject, dir === "out" ? "sales-fixture@example.org" : other, JSON.stringify([dir === "out" ? other : "sales-fixture@example.org"]),
        new Date(now - daysAgo * 86400000).toISOString(), dir, sealed, ...ACTOR]);
    const deals = await q(`SELECT a_id FROM sales_links WHERE a_type = 'deal' AND b_type = 'contact' AND b_id = $1`, [contact]);
    const orgs = await q(`SELECT b_id FROM sales_links WHERE a_type = 'contact' AND a_id = $1 AND b_type = 'org'`, [contact]);
    for (const [t, rid] of [["contact", contact], ...deals.map(x => ["deal", x.a_id]), ...orgs.map(x => ["org", x.b_id])])
      await q(`INSERT INTO sales_email_links (email_id,record_type,record_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [id, t, rid, ...ACTOR]);
  }
  // SALES-2: the made-up prospect list call mode walks (40 organizations across KY, OH and TN).
  const prospects = await require("./sales-staging-prospects").seedProspects(q, OWNER);
  const partB = await require("./sales-staging-prospects").seedPartBWalk(q, OWNER, now);
  return { orgs: ORGS.length, contacts: 20, deals: DEALS.length, partners: 2, emails: mails.length, prospects, partB };
}

module.exports = { seedSales, ORGS, DEALS };
