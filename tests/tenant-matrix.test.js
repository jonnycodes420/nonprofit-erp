// BUILD-75 Phase B — THE TENANT-ISOLATION MATRIX, generated, never hand-written.
//
// This suite BOOTS server.js in-process (PORT 5697), walks the LIVE router via
// scripts/lib/routeInventory.js, and generates the isolation battery from that
// walk — so the router probed IS the router enumerated, and a route added
// tomorrow is probed tomorrow with no human remembering to add it.
//
//   §1  COVERAGE IS THE GATE (B.4): every parameterized route must either be
//       cross-tenant-probed (its params resolve to org B's real rows) or carry
//       an explicit, reasoned entry in PARAM_EXEMPT. A new `/foo/:barId` with
//       neither FAILS THE BUILD. The committed audit/route-inventory.json must
//       also match the live router exactly (re-run the inventory script when
//       routes change). Proven to fail: a synthetic route is injected into a
//       copy of the inventory and must land in the unexercised bucket.
//   §2  AUTH WALL: every authenticated route → 401 on no/tampered/expired
//       token (never 200, never 500); requireAdmin routes → 403 for staff;
//       requireSuperAdmin routes → 403 for an org admin; cookie-auth routes
//       (portal/donor-account) reject a staff BEARER token.
//   §3  CROSS-TENANT: org A's admin token against org B's real resource ids —
//       ONE answer everywhere: 404 (a 403 confirms the row exists; the
//       codebase convention is 404 and this suite pins it). Any route
//       answering differently is listed by name in the failure.
//   §4  LEAK SCAN: every response body returned to an A-credentialed probe is
//       scanned for org B's private markers (names, emails, and the
//       deliberately unmistakable gift/ledger amounts). Status codes lie;
//       bodies don't.
//   §5  B-INTEGRITY: org B's rows are content-hashed before and after the
//       whole battery — byte-identical or the battery WROTE across the wall.
//   §6  INDISTINGUISHABILITY: 404-for-nonexistent and 404-for-B's-real-id are
//       byte-identical bodies on a sample of :id readers.
//   §7  TARGETED B.3: search for a B-only string → zero rows; exports scanned
//       byte-wise; dashboard aggregates carry no B amounts; a signed Stripe
//       webhook on A's account carrying B's donor email never resolves to B's
//       donor; importing B's email at A surfaces no B data in dedupe.
//
// Deep donor-account/portal isolation stays in tests/org-blindness.test.js
// (48) and tests/portal.test.js (67) — this suite is the breadth layer.

// FIX-15: a shard hands this suite a port inside its own block, so two
// worktrees running the battery at once never both bind :5697.
process.env.PORT = process.env.MATRIX_PORT || "5697";
// The in-process boot needs the scratch DB even when the pushing shell
// exported nothing: default DATABASE_URL exactly as tests/helpers.js does
// (dotenv's .env is empty here — an unset URL sent the boot to :5432), and
// disable SSL for the loopback scratch PG.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
process.env.RESEND_BASE_URL = process.env.RESEND_BASE_URL || "http://localhost:5602";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.DONOR_ACCOUNTS_ENABLED = "1";   // flag-off 404s are byte-identical to unknown routes BY DESIGN — the wall is only probeable with the surface on
process.env.NETWORK_SIGNUP_ENABLED = "1";
process.env.RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || "whsec_resend_dummy"; // so the unsigned probe gets the 400, not the unconfigured 503
// INT-1 — same reasoning one provider along: with no webhook id the PayPal
// endpoint answers 503 (not configured), and this suite reads any 5xx on a
// public probe as a fault. Configured here, an unsigned probe gets the 400 it
// should, which is the thing worth probing.
process.env.PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || "WH-MATRIX-DUMMY";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ok, summary, q, closeDb } = require("./helpers");
const { buildInventory } = require("../scripts/lib/routeInventory");

const M = `http://localhost:${process.env.PORT}`;
const A = "org_mxa", B = "org_mxb";
// PRIVATE markers — org B data that must never reach an A-credentialed body.
// The org NAME is deliberately NOT a private marker (public surfaces show it).
const PRIV = ["zzmarkb", "6377.89", "63778"];

const iso = d => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());

// FIX-20 Part 9: THE TEARDOWN IS DISCOVERED, NOT LISTED. It used to be a
// hand-kept list of tables, and every build that added a table the battery
// writes to (saved_dashboards was the last) made the suite pass once and then
// die on its own leftovers with an FK error that reads like a product bug.
// Now every table with an org_id column is swept, children before parents by
// retrying whatever an FK held back, until nothing of either org is left. The
// org delete at the end fails loudly if anything still points at it.
async function reset() {
  const tables = (await q(`SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'org_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name`)).map(r => r.table_name);
  for (const org of [A, B]) {
    let left = tables;
    for (let pass = 0; pass < 10 && left.length; pass++) {
      const heldBack = [];
      for (const t of left) {
        try { await q(`DELETE FROM "${t}" WHERE org_id = $1`, [org]); }
        catch (e) { if (e.code === "23503") heldBack.push(t); }   // a child row still points here: next pass
      }
      left = heldBack;
    }
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}

// One org's full fixture. `tag` "a"|"b"; B rows carry the private marker and
// the unmistakable amounts.
async function seedOrg(o, tag) {
  const mark = tag === "b" ? "ZZMARKB" : "Plain";
  const amt = tag === "b" ? 6377.89 : 111.11;
  const ledger = tag === "b" ? 63778 : 222;
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,receipts_enabled,legal_name,ein,receipt_address)
           VALUES ($1,$2,$3,1,'active','team',$4,true,$5,'12-3456789','1 Test St')`,
    [o, `Matrix ${tag.toUpperCase()} Org`, `matrix-${tag}`, `acct_matrix_${tag}`, `Matrix ${tag.toUpperCase()} Legal`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [`u_${o}_admin`, o, `admin-${tag}@mx.local`, hash, `Admin ${tag}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'staff')`,
    [`u_${o}_staff`, o, `staff-${tag}@mx.local`, hash, `Staff ${tag}`]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,notes,tags)
           VALUES ($1,$2,$3,$4,'mid','cultivate',$5,1,$6,$7,$8,'[]')`,
    [`d_${o}`, o, `${mark} Donor`, `donor-${mark.toLowerCase()}@mx.local`, amt, TODAY, `u_${o}_staff`, `${mark} private note`]);
  // the donor who gives to BOTH orgs (org-blindness fixture)
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,tags) VALUES ($1,$2,'Shared Person','shared@mx.local','new','prospect',0,0,'[]')`,
    [`ds_${o}`, o]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010',$3,'revenue',TRUE)`,
    [`acct_${o}`, o, `Revenue ${tag}`]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,$3,FALSE)`, [`fnd_${o}`, o, `${mark} Fund`]);
  await q(`INSERT INTO campaigns (id,org_id,name,subject,body,status,goal_amount) VALUES ($1,$2,$3,'s','b','draft',1000)`,
    [`c_${o}`, o, `${mark} Campaign`]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign_id,fund_id) VALUES ($1,$2,$3,$4,$5,'cash',$6,$7)`,
    [`g_${o}`, o, `d_${o}`, amt, TODAY, `c_${o}`, `fnd_${o}`]);
  // BUILD-98 Part 1 — a tribute notice and a soft credit, so the new
  // /gifts/:id/extras and /tribute-notices/:id routes are probed across the wall.
  await q(`INSERT INTO saved_reports (id,org_id,name,definition,shared,owner_id) VALUES ($1,$2,$3,$4,true,$5)`,
    [`rpt_${o}`, o, `${mark} Report`, JSON.stringify({ entity: "people", columns: ["name"] }), `u_${o}_admin`]);
  await q(`INSERT INTO ack_letter_templates (id,org_id,name,body) VALUES ($1,$2,$3,$4)`,
    [`alt_${o}`, o, `${mark} Letter`, `Dear {{salutation}}, thank you from ${mark}.`]);
  await q(`INSERT INTO tribute_notices (id,org_id,gift_id,donor_id,tribute_type,honouree_name,body)
           VALUES ($1,$2,$3,$4,'memory',$5,$6)`, [`tn_${o}`, o, `g_${o}`, `d_${o}`, `${mark} Honouree`, `${mark} notice`]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id) VALUES ($1,$2,$3,$4,$5,'income',$6,$7)`,
    [`ft_${o}`, o, TODAY, `${mark} Txn`, ledger, `acct_${o}`, `fnd_${o}`]);
  await q(`INSERT INTO grants (id,org_id,funder,program,amount,status) VALUES ($1,$2,$3,'Prog',50000,'prospecting')`,
    [`gr_${o}`, o, `${mark} Funder`]);
  await q(`INSERT INTO programs (id,org_id,name) VALUES ($1,$2,$3)`, [`prg_${o}`, o, `${mark} Program`]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,done,donor_id,assigned_to) VALUES ($1,$2,$3,$4,'high',0,$5,$6)`,
    [`t_${o}`, o, `${mark} Task`, TODAY, `d_${o}`, `u_${o}_staff`]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,created_by,created_by_name)
           VALUES ($1,$2,$3,'follow_up','Follow up',$4,$4,$5,'Matrix Admin')`,
    [`th_${o}`, o, `d_${o}`, TODAY, `u_${o}_admin`]);   // BUILD-81 — the Thread
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)`,
    [`i_${o}`, o, `d_${o}`, `${mark} interaction`, TODAY]);
  // FIX-14 Part 2 — a deleted entry waiting for Undo. Org A must not be able
  // to put org B's back (or learn that it exists).
  await q(`INSERT INTO deleted_records (id,org_id,table_name,record_id,row_data,created_by) VALUES ($1,$2,'tasks',$3,$4,$5)`,
    [`del_${o}`, o, `t_gone_${o}`, JSON.stringify({ id: `t_gone_${o}`, org_id: o, title: `${mark} deleted task` }), `u_${o}_admin`]);
  // BUILD-87 Part 1 — an import RUN is a readable row with its own id, so the
  // matrix gets a real one per org to probe across the wall.
  await q(`INSERT INTO imports (id,org_id,name,source_filename,shape,rows_in,gifts_created,donors_created,rows_set_aside,rows_errored,dollars_in,dollars_created,summary_json)
           VALUES ($1,$2,$3,$4,'workbook',1,1,1,0,0,$5,$5,$6)`,
    [`imp_${o}`, o, `${mark} Import`, `${mark}-file.xlsx`, amt, JSON.stringify({ dollarsSetAside: 0, dollarsErrored: 0 })]);
  // FIX-7 Part 2 — a PUBLIC slug on the event, so §9 can stand on org A's own
  // event page and try to spend org B's ticket level through it.
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug) VALUES ($1,$2,$3,'gala',$4,'upcoming',$5)`,
    [`ev_${o}`, o, `${mark} Event`, TODAY, `matrix-${tag}-event`]);
  await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status) VALUES ($1,$2,$3,$4,$5,'invited')`,
    [`ea_${o}`, `ev_${o}`, o, `d_${o}`, `${mark} Attendee`]);
  await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role) VALUES ($1,$2,$3,$4,3,'Barn')`, [`vs_${o}`, o, `d_${o}`, TODAY]);
  // FIX-9 — VOL-2's SCHEDULING ROWS. Until this build the whole of
  // routes/volunteerScheduling.js was invisible to this suite (readSource did
  // not stitch the file, so every route in it read `auth: []` and was
  // classified public), and ten parameterized routes went un-probed. These are
  // the rows org A's token is pointed at.
  await q(`INSERT INTO volunteer_opportunities (id,org_id,name,slug) VALUES ($1,$2,$3,$4)`,
    [`vopp_${o}`, o, `${mark} Opportunity`, `opp-${o}`]).catch(() => {});
  await q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time)
           VALUES ($1,$2,$3,$4,'09:00','12:00')`, [`vslot_${o}`, o, `vopp_${o}`, TODAY]).catch(() => {});
  await q(`INSERT INTO volunteer_groups (id,org_id,name,kind) VALUES ($1,$2,$3,'company')`,
    [`vgrp_${o}`, o, `${mark} Group`]).catch(() => {});
  await q(`INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,group_id,status)
           VALUES ($1,$2,$3,$4,$5,'confirmed')`,
    [`vsu_${o}`, o, `vslot_${o}`, `d_${o}`, `vgrp_${o}`]).catch(() => {});
  await q(`INSERT INTO volunteer_group_members (id,org_id,group_id,person_id)
           VALUES ($1,$2,$3,$4)`, [`vgm_${o}`, o, `vgrp_${o}`, `d_${o}`]).catch(() => {});
  // VOL-2 — a VOLUNTEERS-shaped import per org, for the undo probe. The
  // `imp_${o}` row above is shape 'workbook' and the volunteer undo only
  // answers for shape 'volunteers', so probing with it would have 404'd
  // because of the shape and never touched the org wall at all.
  await q(`INSERT INTO imports (id,org_id,name,shape,rows_in) VALUES ($1,$2,$3,'volunteers',1)`,
    [`vimp_${o}`, o, `${mark} Volunteer import`]);
  await q(`INSERT INTO api_keys (id,org_id,name,prefix,key_hash) VALUES ($1,$2,'Zapier','stw_xxxxxx',$3)`, [`ak_${o}`, o, `hash_${o}`]);
  // REPORTS-3 — a SAVED DASHBOARD per org, and it is deliberately SHARED.
  // Shared is the harder case: within an org it means "the team may open
  // this", and the read is `shared OR mine`, so a bug that forgot the org
  // predicate would let org A open org B's shared dashboard — and running one
  // returns that org's gifts, givers and donor names. Org A reading it,
  // rewriting its tiles or deleting it must each answer 404.
  await q(`INSERT INTO saved_dashboards (id,org_id,name,tiles,filters,shared,owner_id,owner_name)
           VALUES ($1,$2,$3,$4,'{}'::jsonb,true,$5,'Owner')`,
    [`sdash_${o}`, o, `${mark} Dashboard`, JSON.stringify([{ kind: "figure", source: "gifts", params: {} }]), `u_${o}`]).catch(() => {});
  // FIX-11 Part 1 — one audit row per org, with a known id, so GET
  // /audit/log/:id is probed against a REAL row of the other org's history
  // rather than against a missing one (which would 404 for the wrong reason
  // and prove nothing). An audit row names who did what to whose record, so
  // it is exactly the kind of row org A must not be able to read.
  await q(`INSERT INTO fin_audit_log (id,org_id,user_id,user_name,action,entity_type,entity_id,entity_label,changes)
           VALUES ($1,$2,$3,$4,'updated','gift',$5,'Hidden Donor','{}'::jsonb)`,
    [`al_${o}`, o, `u_${o}_staff`, `staff-${o}@mx.local`, `g_${o}`]).catch(() => {});
  // FIX-11 Part 2 — one table at each org's event, so the table routes are
  // probed against a REAL row of the other org's room rather than a missing
  // one (which would 404 for the wrong reason and prove nothing).
  await q(`INSERT INTO event_tables (id,org_id,event_id,label,seats,sort,created_by,created_by_name)
           VALUES ($1,$2,$3,'Table 1',8,1,'system:test','matrix')
           ON CONFLICT (event_id,label) DO NOTHING`, [`etb_${o}`, o, `ev_${o}`]).catch(() => {});
  // INT-2 — an accounting connection per org, so the four /bookkeeping routes
  // have a real row to fail against rather than 404ing for a missing fixture.
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
           VALUES ($1,$2,'quickbooks','active',$3,'{}'::jsonb,'system:test','matrix')`,
    [`bkc_${o}`, o, `realm_${o}`]).catch(() => {});
  await q(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term) VALUES ($1,$2,'Family',100,25,'12_months')`, [`mbl_${o}`, o]);
  await q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status) VALUES ($1,$2,$3,$4,$5,$5,$5,'active')`, [`mb_${o}`, o, `d_${o}`, `mbl_${o}`, TODAY]);
  // BUILD-98 (switch) Part 4 — a ticket level, so /event-levels/:id is probed.
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv) VALUES ($1,$2,$3,'ticket',$4,150,60)`,
    [`evl_${o}`, o, `ev_${o}`, `${mark} Level`]);
  // EVENTS-2 — a place on that level's waiting list, so the cross probe has a
  // REAL row to try to offer: offering one sends an email to a person, which
  // is exactly the act the wall exists to stop reaching across.
  await q(`INSERT INTO event_waitlist (id,org_id,event_id,level_id,name,email,position) VALUES ($1,$2,$3,$4,$5,$6,1)`,
    [`ewl_${o}`, o, `ev_${o}`, `evl_${o}`, `${mark} Waiting`, `${mark.toLowerCase()}-waiting@matrix.test`]);
  // EMAIL-1 — one photo in each org's media library, so editing, removing
  // and restoring it are probed against a REAL row of the other org.
  await q(`INSERT INTO media_items (id,org_id,kind,title,alt,created_by,created_by_name) VALUES ($1,$2,'photo',$3,'A photo','system:test','matrix')`,
    [`med_${o}`, o, `${mark} Photo`]);
  await q(`INSERT INTO volunteers (id,org_id,donor_id,name) VALUES ($1,$2,$3,$4)`, [`v_${o}`, o, `d_${o}`, `${mark} Volunteer`]);
  await q(`INSERT INTO board_members (id,org_id,name,role) VALUES ($1,$2,$3,'Member')`, [`bd_${o}`, o, `${mark} Board`]);
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id) VALUES ($1,$2,$3,$4)`, [`h_${o}`, o, `${mark} Household`, `d_${o}`]);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status) VALUES ($1,$2,$3,$4,5000,'open')`,
    [`op_${o}`, o, `d_${o}`, `${mark} Ask`]);
  // BUILD-99 (major gifts) Part 3 — a cultivation template, an applied plan and
  // one of its steps, so the cross-tenant probe has real rows to fail against.
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps)
           VALUES ($1,$2,$3,'[{"type":"send","label":"Send it","offsetDays":7}]'::jsonb)`,
    [`ct_${o}`, o, `${mark} Plan`]);
  await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status)
           VALUES ($1,$2,$3,$4,$5,$6,'active')`,
    [`cp_${o}`, o, `d_${o}`, `ct_${o}`, `${mark} Plan`, TODAY]);
  await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status)
           VALUES ($1,$2,$3,1,'send',$4,$5,'pending')`,
    [`cs_${o}`, o, `cp_${o}`, `${mark} Step`, TODAY]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES ($1,$2,$3,500,$4,'open')`,
    [`pl_${o}`, o, `d_${o}`, TODAY]);
  await q(`INSERT INTO planned_gifts (id,org_id,donor_id,type,estimated_value) VALUES ($1,$2,$3,'bequest',10000)`,
    [`pgift_${o}`, o, `d_${o}`]);
  await q(`INSERT INTO donor_materials (id,org_id,donor_id,file_name,file_type,file_data) VALUES ($1,$2,$3,$4,'text/plain','eg==')`,
    [`mat_${o}`, o, `d_${o}`, `${mark}-file.txt`]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status) VALUES ($1,$2,$3,$4,'active')`,
    [`gp_${o}`, o, `page-${tag}`, `Page ${tag}`]); // title deliberately public-safe
  await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,status,edit_token) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`,
    [`pf_${o}`, o, `gp_${o}`, `Peer ${tag}`, `peer-${tag}@mx.local`, `peer-${tag}`, crypto.randomBytes(32).toString("hex")]);
  // BUILD-103 — a team on that org's giving page, so /p2p-teams/:id is
  // crossed: taking a team down is a change to somebody else's campaign. It
  // goes AFTER the page it hangs off, because it has an FK to it.
  await q(`INSERT INTO p2p_teams (id,org_id,giving_page_id,name,slug,goal_amount) VALUES ($1,$2,$3,$4,$5,1000)`,
    [`pt_${o}`, o, `gp_${o}`, `Team ${tag}`, `team-${tag}`]);
  // BUILD-78: defs table replaces the legacy custom_fields; B's donor also
  // carries a private custom VALUE so leak-scan bodies can catch it.
  await q(`INSERT INTO custom_field_defs (id,org_id,entity,key,label,type) VALUES ($1,$2,'donor',$3,$4,'text')`,
    [`cf_${o}`, o, `${tag}_private_field`, `${mark} Field`]);
  await q(`UPDATE donors SET custom_fields=$1::jsonb WHERE id=$2`,
    [JSON.stringify({ [`${tag}_private_field`]: `${mark} custom value` }), `d_${o}`]);
  // GIVE-2 §8 — a matching employer this org typed, with its own form link.
  // `DELETE /matching-employers/:id` must answer 404 to the other org: a list
  // one organisation built of the employers it knows match is not another's to
  // take rows out of.
  await q(`INSERT INTO matching_employers (id,org_id,name,form_url,ratio) VALUES ($1,$2,$3,$4,'1:1')`,
    [`me_${o}`, o, `${mark} Employer`, `https://${tag}-employer.example.com/match`]);
  await q(`INSERT INTO impact_metrics (id,org_id,name,dollar_threshold,outcome_template,active) VALUES ($1,$2,$3,100,'{n} things',TRUE)`,
    [`im_${o}`, o, `${mark} Metric`]);
  await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status) VALUES ($1,$2,$3,'threshold_500',$4,$5,'pending_review')`,
    [`md_${o}`, o, `d_${o}`, `${mark} subject`, `${mark} body`]);
  await q(`INSERT INTO note_reminders (id,org_id,donor_id,milestone_key,talking_points,status) VALUES ($1,$2,$3,'anniversary_year_1',$4,'pending')`,
    [`nr_${o}`, o, `d_${o}`, JSON.stringify([`${mark} talking point`])]);
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data)
           VALUES ($1,$2,$3,$4,'gift',$5,$6,$6,$7,'JVBERi0x')`,
    [`rc_${o}`, o, `d_${o}`, `g_${o}`, `2026-0000${tag === "b" ? 2 : 1}`, amt, JSON.stringify({ donorName: `${mark} Donor`, amount: amt })]);
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status) VALUES ($1,$2,$3,'manual','active')`,
    [`sq_${o}`, o, `${mark} Sequence`]);
  await q(`INSERT INTO workflows (id,org_id,recipe_key,name,trigger,conditions,actions,config,enabled)
           VALUES ($1,$2,$3,$4,'gift_received','[]','[]','{}',false)`,
    [`wf_${o}`, o, `major_gift_alert`, `${mark} Workflow`]);
  await q(`INSERT INTO impact_updates (id,org_id,title,body,targets,org_wide,status) VALUES ($1,$2,$3,$4,'[]',true,'published')`,
    [`iu_${o}`, o, `Update ${tag}`, `Body ${tag}`]); // portal-public by design — no private marker
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ($1,$2,$3,$4,25,'month','active')`,
    [`rs_${o}`, o, `d_${o}`, `sub_${o}`]);
  await q(`INSERT INTO invites (id,org_id,email,role,token,expires_at) VALUES ($1,$2,$3,'staff',$4,NOW() + INTERVAL '7 days')`,
    [`inv_${o}`, o, `invite-${tag}@mx.local`, `tok_${o}_${crypto.randomBytes(8).toString("hex")}`]).catch(async () =>
    q(`INSERT INTO invites (id,org_id,email,token,expires_at) VALUES ($1,$2,$3,$4,NOW() + INTERVAL '7 days')`,
      [`inv_${o}`, o, `invite-${tag}@mx.local`, `tok_${o}_x`]));
  await q(`INSERT INTO portal_settings (org_id,enabled,display_name) VALUES ($1,true,$2)`, [o, `Matrix ${tag.toUpperCase()} Portal`]);
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type) VALUES ($1,$2,$3,$4,'spouse')`,
    [`dr_${o}`, o, `d_${o}`, `ds_${o}`]);
  await q(`CREATE TABLE IF NOT EXISTS board_reports (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, quarter INTEGER, year INTEGER,
             generated_at TIMESTAMPTZ DEFAULT NOW(), generated_by TEXT, generated_by_name TEXT, metrics TEXT, pdf_data TEXT)`);
  await q(`INSERT INTO board_reports (id,org_id,quarter,year,metrics,pdf_data) VALUES ($1,$2,3,2026,'{}','JVBERi0x')`, [`br_${o}`, o]);
  await q(`INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES ($1,$2,$3,'estate')`,
    [`dd_${o}`, o, `d_${o}`]).catch(() => {});
  await q(`INSERT INTO budgets (id,org_id,account_id,year,amount) VALUES ($1,$2,$3,2026,1000)`, [`bg_${o}`, o, `acct_${o}`]).catch(() => {});
  // BUILD-88b B.3 — a thank-you draft per org, so the queue's three routes are
  // probed across the wall like everything else.
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body) VALUES ($1,$2,$3,$4,$5)`,
    [`ty_${o}`, o, `d_${o}`, `g_${o}`, `${mark} thank-you draft`]).catch(() => {});
  // BUILD-89S 89a — a connected giving source and the recurring commitment it
  // recognised, so /giving-sources/:id and /giving-recurring/:id are probed
  // across the wall like every other parameterized route. The credential is a
  // real sealed envelope shape because the column's CHECK refuses anything else.
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,credentials_sealed)
           VALUES ($1,$2,'paypal',$3,'v1.AAAA.BBBB.CCCC.DDDD')`,
    [`gsrc_${o}`, o, `${mark} PayPal`]).catch(() => {});
  await q(`INSERT INTO giving_recurring
             (id,org_id,donor_id,source_id,provider,amount_cents,confidence,gift_count,first_gift_on,last_gift_on,expected_next)
           VALUES ($1,$2,$3,$4,'paypal',6377890,'inferred',3,'2026-05-14','2026-07-14','2026-08-14')`,
    [`grec_${o}`, o, `d_${o}`, `gsrc_${o}`]).catch(() => {});

  // BUILD-92 A3 — a standing cross-source question, so DELETE/POST on
  // /giving-sources/duplicates/:id has a real row of THIS org to be probed
  // against rather than a source id that would 404 for the wrong reason.
  await q(`INSERT INTO gift_duplicate_questions
             (id,org_id,source_id,existing_gift_id,existing_source_id,external_key,donor_id,
              amount_cents,occurred_at,sentence,candidate)
           VALUES ($1,$2,$3,$4,$3,$5,$6,5000,'2026-06-10','Looks like the same $50 gift already here.','{}'::jsonb)`,
    [`gdq_${o}`, o, `gsrc_${o}`, `g_${o}`, `statement:${o}:probe`, `d_${o}`]).catch(() => {});

  // BUILD-92 A4 — a saved statement mapping.
  await q(`INSERT INTO statement_mappings (id,org_id,name,preset_key,mapping,drop_negative)
           VALUES ($1,$2,$3,'generic_statement','{"date":"Posting Date","amount":"Amount","donorName":"Description"}'::jsonb,true)`,
    [`smap_${o}`, o, `Zelle ${o}`]).catch(() => {});

  // BUILD-97 — a named audience. Seeded per-org so the cross-tenant probe hits
  // a row that really exists and is really refused, rather than 404-ing
  // because there was nothing there to reach in the first place.
  await q(`INSERT INTO audiences (id,org_id,name,description,segment)
           VALUES ($1,$2,$3,'probe','{"mode":"donors"}'::jsonb)`,
    [`aud_${o}`, o, `Audience ${o}`]).catch(() => {});
  // PARITY-1 Part D — a Group kept by hand, with one member, per org.
  await q(`INSERT INTO audiences (id,org_id,name,description,segment,kind)
           VALUES ($1,$2,$3,'probe','{"mode":"group"}'::jsonb,'static')`,
    [`grp_${o}`, o, `Group ${o}`]).catch(() => {});
  await q(`INSERT INTO group_members (org_id,group_id,donor_id,added_by,added_by_name) VALUES ($1,$2,$3,'system:test','test')`,
    [o, `grp_${o}`, `d_${o}`]).catch(() => {});
  // PARITY-4 Part 2: a gift started and not finished, per org. Org A aimed at
  // org B's row (its draft, a send, setting it aside) is refused because it is
  // org B's, and the draft would show org B's donor's email.
  await q(`INSERT INTO gift_starts (id,org_id,email,first_name,amount,started_at,expired_at,created_by,created_by_name)
           VALUES ($1,$2,$3,'Matrix',40,NOW() - INTERVAL '2 hours',NOW(),'system:test','test') ON CONFLICT DO NOTHING`,
    [`gs_${o}`, o, `started-${o}@matrix.test`]).catch(e => console.error("gift start seed:", e.message));
  // PARITY-2 Part 4: an auction with one item, per org, so org A aimed at
  // org B's auction or item is refused because it is org B's.
  await q(`INSERT INTO auctions (id,org_id,title,public_slug,opens_at,closes_at,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,NOW() - INTERVAL '1 day',NOW() + INTERVAL '1 day','system:test','test') ON CONFLICT DO NOTHING`,
    [`auc_${o}`, o, `${mark} auction`, `mx-auction-${o}`]).catch(e => console.error("auction seed:", e.message));
  await q(`INSERT INTO auction_items (id,org_id,auction_id,title,fmv,starting_bid,bid_increment,donor_id,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,63.78,100,10,$5,'system:test','test') ON CONFLICT DO NOTHING`,
    [`aui_${o}`, o, `auc_${o}`, `${mark} item`, `d_${o}`]).catch(e => console.error("auction item seed:", e.message));
  // INT-5 — a webhook endpoint and one delivery against it, per org. Org A
  // aimed at org B's endpoint must be refused because it is org B's, not
  // because there was nothing there.
  await q(`INSERT INTO webhook_endpoints (id,org_id,url,events,secret,created_by,created_by_name)
           VALUES ($1,$2,$3,'["gift.created"]'::jsonb,$4,'system:test','test')
           ON CONFLICT DO NOTHING`,
    [`whe_${o}`, o, `https://example.invalid/${o}`, `whsec_${o}`]).catch(() => {});
  await q(`INSERT INTO webhook_deliveries (id,org_id,endpoint_id,event,payload,attempt)
           VALUES ($1,$2,$3,'gift.created','{}'::jsonb,0) ON CONFLICT DO NOTHING`,
    [`whd_${o}`, o, `whe_${o}`]).catch(() => {});
  // INT-BUILD-1 — a meeting on this org's own staff calendar, so org A aimed
  // at org B's meeting is refused because it is org B's.
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by,created_by_name)
           VALUES ($1,$2,$3,'google',$1,'Probe meeting',NOW() - INTERVAL '2 hours',NOW() - INTERVAL '1 hour',ARRAY[$4],'system:test','test')
           ON CONFLICT DO NOTHING`,
    [`cal_${o}`, o, `u_${o}_staff`, `d_${o}`]).catch(e => console.error("calendar seed:", e.message));
  // SEC-1 — a signed-in session belonging to this org's own staff member, so
  // org A signing out org B's session is refused because it is somebody
  // else's, not because the row was never there.
  await q(`INSERT INTO user_sessions (id,user_id,org_id,user_agent,ip_prefix) VALUES ($1,$2,$3,'probe','10.0.0.x')
           ON CONFLICT DO NOTHING`, [`ses_${o}`, `u_${o}_staff`, o]).catch(e => console.error("session seed:", e.message));
  // INT-4 — a never-log entry belonging to THIS org's own user, so org A
  // aimed at org B's entry is refused because it is somebody else's, not
  // because the row was never there.
  await q(`INSERT INTO mailbox_never_log (id,user_id,org_id,pattern,kind)
           VALUES ($1,$2,$3,$4,'domain') ON CONFLICT DO NOTHING`,
    [`nvr_${o}`, `u_${o}_staff`, o, `private-${o}.invalid`]).catch(() => {});
  // INT-3 — a campaign the org's own email tool sent, per org, for the same
  // reason the audience above is seeded: org A aimed at org B's campaign must be
  // refused because it belongs to org B, not because the row was never there.
  await q(`INSERT INTO email_marketing_campaigns
             (id,org_id,provider,provider_campaign_id,name,sent_at,sends,opens,clicks)
           VALUES ($1,$2,'mailchimp',$3,$4,NOW() - interval '10 days',100,40,10)`,
    [`emcamp_${o}`, o, `mc_${o}`, `Campaign ${o}`]).catch(() => {});
  // BUILD-97 Part 3 — an instruction, a run and a write, per org. Seeded
  // directly rather than through the routes because creating one calls a model,
  // and a tenancy probe must not depend on an API key being present. The point
  // is that org A's token, aimed at org B's instruction id, reaches nothing.
  await q(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,plan)
           VALUES ($1,$2,$3,'task','active','draft','{"steps":[]}'::jsonb)`,
    [`ai_${o}`, o, `Instruction belonging to ${o}`]).catch(() => {});
  // BUILD-99 (major gifts) Part 4 — the run carries a BRIEF, so /briefs/:runId
  // 404s for the tenancy reason rather than for a missing payload.
  await q(`INSERT INTO agent_runs (id,org_id,instruction_id,status,actions) VALUES ($1,$2,$3,'done',$4)`,
    [`arun_${o}`, o, `ai_${o}`, JSON.stringify({
      donorId: `d_${o}`,
      brief: { headline: `${mark} brief`, dropped: [], sentenceCount: 1,
               sections: [{ key: "notes", title: "What you wrote", sentences: [{ text: `${mark} line`, cites: [`note:d_${o}`] }] }] },
    })]).catch(() => {});
  await q(`INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,cites)
           VALUES ($1,$2,$3,$4,'set_stage','donors',$5,'{"stage":"prospect"}'::jsonb,'[]'::jsonb)`,
    [`aw_${o}`, o, `arun_${o}`, `ai_${o}`, `d_${o}`]).catch(() => {});
  // EMAIL-1 — an Agent draft, so "start from a template" and its Undo are
  // probed against org B's real draft.
  await q(`INSERT INTO agent_drafts (id,org_id,run_id,instruction_id,donor_id,subject,body,cites)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'[{"t":"note"}]'::jsonb)`,
    [`adr_${o}`, o, `arun_${o}`, `ai_${o}`, `d_${o}`, `${mark} subject`, `${mark} draft`]).catch(() => {});
}

// ── The cross-tenant resolver: (path segment or param name) → org B's row id.
// A parameterized route resolves when EVERY :param maps here. A new route
// whose params don't resolve must be added here or to PARAM_EXEMPT — that
// forced decision IS the coverage gate.
function bResolver(routePath, param) {
  const seg1 = routePath.split("/").filter(Boolean)[0] || "";
  // INT-5 — two different kinds of row live under /webhooks, so the first path
  // segment is not enough to say which id a probe needs: /webhooks/:id is an
  // ENDPOINT and /webhooks/deliveries/:id is a DELIVERY. Resolved by the route
  // rather than by the segment, or the delivery probe would aim an endpoint id
  // at it and 404 for the wrong reason.
  if (seg1 === "calendar" && param === "id") return `cal_${B}`;
  if (seg1 === "me" && routePath.includes("/sessions/") && param === "id") return `ses_${B}`;
  if (seg1 === "webhooks") {
    return routePath.includes("/deliveries/:id") ? `whd_${B}` : `whe_${B}`;
  }
  const byParam = {
    qid: "q1",   // PARITY-3: a question on an application
    donorId: `d_${B}`, subId: `rs_${B}`, attendeeId: `ea_${B}`, grantId: `gr_${B}`,
    userId: `u_${B}_staff`, recipientId: `cr_${B}`, kind: "estate",
    // BUILD-99 (major gifts) Part 2 — a portfolio is READ by officer id, so the
    // cross-tenant probe is org B's own officer.
    officerId: `u_${B}_staff`,
    // BUILD-99 (major gifts) Part 4 — a brief IS an agent run, so the probe is
    // org B's own run id.
    runId: `arun_${B}`,
    // BUILD-100 (grants) Parts 2, 3 and 4 — a deadline Steward watches, a file a
    // grant carries and a line of restricted spending are each org B's business,
    // and each route must answer 404 to org A rather than acting on the row.
    msId: `gms_${B}`,
    docId: `gdoc_${B}`,
    spendId: `gsp_${B}`,
    // EVENTS-2 — a place on a waiting list belongs to one org's event, and
    // offering it is an email to a person. Org A must not be able to send it.
    wid: `ewl_${B}`,
    // FIX-9 — the check-in board names its param `slotId`, and the path
    // prefixes below are only consulted for `:id`, so it needs a name here.
    slotId: `vslot_${B}`,
    // FIX-11 Part 2 — a table at org B's gala. Org A renaming or removing it
    // would rearrange a room it has nothing to do with, and seating somebody
    // at it would put a stranger's name on another organisation's chart.
    tableId: `etb_${B}`,
  };
  if (byParam[param]) return byParam[param];
  if (param !== "id") return null;
  const bySeg = {
    donors: `d_${B}`, gifts: `g_${B}`, grants: `gr_${B}`, campaigns: `c_${B}`, tasks: `t_${B}`,
    events: `ev_${B}`, sequences: `sq_${B}`, programs: `prg_${B}`, households: `h_${B}`,
    "giving-pages": `gp_${B}`, pledges: `pl_${B}`, opportunities: `op_${B}`, "planned-gifts": `pgift_${B}`,
    receipts: `rc_${B}`, "milestone-drafts": `md_${B}`, "note-reminders": `nr_${B}`,
    "custom-fields": `cf_${B}`, "impact-metrics": `im_${B}`, "impact-updates": `iu_${B}`,
    workflows: `wf_${B}`, volunteers: `v_${B}`, interactions: `i_${B}`, materials: `mat_${B}`,
    recurring: `rs_${B}`, orgs: B, board: `bd_${B}`, "peer-fundraisers": `pf_${B}`,
    "donor-relationships": `dr_${B}`, users: `u_${B}_staff`,
    "p2p-teams": `pt_${B}`,        // BUILD-103 — a team takedown
    media: `med_${B}`,              // EMAIL-1: a photo in another org's media library
    "gift-starts": `gs_${B}`,       // PARITY-4 Part 2: a started gift, its draft and its note
    "matching-employers": `me_${B}`,  // GIVE-2 §8 — an employer on another org's own list
    // INT-3 — /email-marketing/campaigns/:id/people opens the people behind one
    // campaign's opens or clicks, which is donor data. Org A asking for org B's
    // campaign must get nothing, and this maps the probe onto a real org B row.
    "email-marketing": `emcamp_${B}`,
    // INT-4 — /mailbox/never-log/:id deletes one person's private never-log
    // entry. Org A must not be able to remove org B's.
    mailbox: `nvr_${B}`,
    // INT-1 — a CONNECTION is a giving_sources row (the Connections screen is
    // a view over them, not a second table), so org A asking for org B's
    // connection, its gift rows or its sync log must answer 404 like any other.
    connections: `gsrc_${B}`,
    "import-merges": `mrg_${B}`,   // BUILD-80 Part 6.2 — merge-review undo
    threads: `th_${B}`,            // BUILD-81 — the Thread (dismiss route)
    "deleted-records": `del_${B}`, // FIX-14 Part 2 — Undo of a delete
    records: `i_${B}`,             // FIX-14 Part 2 — one record's edit history
    imports: `imp_${B}`,           // BUILD-87 Part 1 — the import-history receipt
    "thank-yous": `ty_${B}`,       // BUILD-88b B.3 — the thank-you queue
    "giving-sources": `gsrc_${B}`,   // BUILD-89S 89a — a connected giving source
    "giving-recurring": `grec_${B}`, // BUILD-89S 89a — a recognised recurring commitment
    "statement-mappings": `smap_${B}`, // BUILD-92 A4 — a saved statement mapping
    audiences: `aud_${B}`,           // BUILD-97 — a named audience is org B's business
    groups: `grp_${B}`,              // PARITY-1 Part D — a Group is org B's business
    "tribute-notices": `tn_${B}`,    // BUILD-98 Part 1 — a notice to a family is org B's business
    acknowledgments: `alt_${B}`,     // BUILD-98 Part 2 — a letter template is org B's business
    "saved-reports": `rpt_${B}`,     // BUILD-98 Part 3 — a saved report is org B's business
    "event-levels": `evl_${B}`,      // BUILD-98 Part 4 — a ticket level is org B's business
    "volunteer-shifts": `vs_${B}`,   // BUILD-98 Part 5 — a volunteer's shift is org B's business
    "api-keys": `ak_${B}`,           // BUILD-98 Part 6 — org A cannot revoke org B's key
    "membership-levels": `mbl_${B}`, // BUILD-101 — org A cannot edit or remove org B's levels
    // FIX-11 Part 1 — one row of org B's history. It names a person, a record
    // and both sides of a change, so it is donor data by any reading.
    audit: `al_${B}`,
    "memberships": `mb_${B}`,        // BUILD-101 — org A cannot cancel org B's member
    auctions: `auc_${B}`,            // PARITY-2 Part 4: org A cannot read, edit or write drafts for org B's auction
    "auction-items": `aui_${B}`,     // PARITY-2 Part 4: nor edit, remove or book in-kind org B's item
    people: `d_${B}`,                // FIX-1 D — a person IS a donors row; org A cannot read or re-role org B's
  };
  // BUILD-92 A3 — the duplicate questions live UNDER /giving-sources, so the
  // first segment would resolve them to a SOURCE id and the probe would 404
  // for the wrong reason. Point them at org B's real question instead.
  // BUILD-97 Part 3 — the agent's own rows. `/agent/instructions/:id/...` and
  // `/agent/writes/:id/undo` both use :id, and the first segment is `agent` for
  // both, so they are resolved by PATH rather than by segment.
  // BUILD-99 (major gifts) Part 1 — a proposal IS a row in `opportunities`
  // (shared/proposalShape.js says why there is no second table), so the
  // cross-tenant probe is org B's own opportunity id.
  // INT-2 — an accounting connection is org B's own books. Org A mapping its
  // funds into them, sending a deposit to them, reading their month or
  // disconnecting them would each be a different kind of disaster, and all four
  // must answer 404.
  if (routePath.startsWith("/bookkeeping/")) return `bkc_${B}`;
  if (routePath.startsWith("/agent/drafts/")) return `adr_${B}`;   // EMAIL-1
  // INT-POS — the register's event report is read by EVENT id, so org A asking
  // for what org B's gala took at the till must answer 404 like anything else.
  if (routePath.startsWith("/pos/event/")) return `ev_${B}`;
  if (routePath.startsWith("/proposals/")) return `op_${B}`;
  // BUILD-99 (major gifts) Part 3 — the plan's three shapes, resolved by PATH
  // because all three use `:id` and their first segments differ.
  if (routePath.startsWith("/cultivation-templates/")) return `ct_${B}`;
  // FIX-6 item 1 — the approval queue's two doors. `:kind` is a WORD, not a
  // row, so it resolves to a real kind; `:id` is org B's own thank-you draft.
  // Probing with a kind the route refuses outright would 404 for the wrong
  // reason and never touch the org wall (the trap VOL-2 hit with a
  // workbook-shaped import row).
  if (/^\/agent\/waiting\//.test(routePath)) return param === "kind" ? "thank_you" : `ty_${B}`;
  // VOL-2 — two routes under /volunteer-hub, both on `:id`, needing different
  // rows: the undo takes an IMPORT and the person view takes a PERSON, and a
  // person is a `donors` row (the one-person-one-record rule).
  if (routePath.startsWith("/volunteer-hub/import/")) return `vimp_${B}`;
  if (routePath.startsWith("/volunteer-hub/person/")) return `d_${B}`;
  // FIX-9 — the scheduling surface. Each of these acts on somebody else's
  // volunteers: archiving org B's opportunity, cancelling its shift, reading
  // who is coming to it, opening or adding to its group, or marking one of its
  // people a no-show. All of them answer 404.
  if (routePath.startsWith("/volunteer-hub/opportunities/")) return `vopp_${B}`;
  if (routePath.startsWith("/volunteer-hub/slots/")) return `vslot_${B}`;
  if (routePath.startsWith("/volunteer-hub/groups/")) return `vgrp_${B}`;
  if (routePath.startsWith("/volunteer-hub/kiosk/")) return `vslot_${B}`;
  if (routePath.startsWith("/volunteer-hub/signups/")) return `vsu_${B}`;
  // PARITY-3 Part 1 — a volunteer's skill, certification or tag: org B's own
  // row, which org A may not remove.
  if (routePath.startsWith("/volunteer-qualifications/")) return `vq_${B}`;
  // PARITY-3 Part 2 — an application from org B's public volunteer page:
  // org A may not read its answers, open its waiver, approve or decline it.
  if (routePath.startsWith("/volunteer-hub/applications/")) return `vap_${B}`;
  // PARITY-3 — a draft reminder or thank-you is a milestone_drafts row: org
  // B's own draft, which org A may neither read nor discard.
  if (routePath.startsWith("/volunteer-hub/drafts/")) return `md_${B}`;
  // THREAD-2a — a journey IS a cultivation template, so the cross-tenant
  // probe is org B's own template row. These three routes read, rewrite and
  // APPLY a journey to people, which is the most consequential of the set:
  // org A reaching org B's journey could start seven steps against org B's
  // donors. They answer 404.
  // REPORTS-3 — org B's own saved dashboard. `/board-pack` and
  // `/dashboard-tiles` carry no row id (the board pack's `dashboard` is a
  // query parameter, probed by §6 of reports3-board-pack), so the only
  // row-shaped param in this build is a dashboard's own id.
  if (routePath.startsWith("/saved-dashboards/")) return `sdash_${B}`;
  if (routePath.startsWith("/journeys/")) return `ct_${B}`;
  if (routePath.startsWith("/plan-steps/")) return `cs_${B}`;
  if (routePath.startsWith("/plans/")) return `cp_${B}`;
  if (routePath.startsWith("/agent/instructions/")) return `ai_${B}`;
  if (routePath.startsWith("/agent/writes/")) return `aw_${B}`;
  // FIX-1 §A — a run's state, read by id: org A's token on org B's run reaches nothing.
  if (routePath.startsWith("/agent/runs/")) return `arun_${B}`;
  if (routePath.startsWith("/giving-sources/duplicates/")) return `gdq_${B}`;
  if (routePath.startsWith("/fundraising/campaigns")) return `c_${B}`;
  if (routePath.startsWith("/reports/board")) return `br_${B}`;
  if (routePath.startsWith("/finance/accounts")) return `acct_${B}`;
  if (routePath.startsWith("/finance/funds")) return `fnd_${B}`;
  if (routePath.startsWith("/finance/transactions")) return `ft_${B}`;
  if (routePath.startsWith("/finance/budgets")) return `bg_${B}`;   // BUILD-88a A.3
  return bySeg[seg1] || null;
}

// Routes whose params deliberately get NO cross-tenant probe — each with the
// reason a reviewer can audit. Anything parameterized, unresolved, and not
// listed here FAILS §1.
const PARAM_EXEMPT = [
  [/^\/(portal|org|give|donate|track|portal-assets|unsubscribe|auth|network|fundraiser)\//, "public / capability-token / slug-scoped surface — org-scoping is by slug or signed token, covered by portal.test.js + donor-front-door"],
  // PARITY-2 Part 4: the public auction page, its bid and register forms and
  // a winner's pay page. Org-scoping is by the public slug (one auction) or a
  // signed pay token (one item's winning bid); there is no staff token to
  // cross. The tie, the close and the pay path are pinned in parity2-auction.
  [/^\/auction\//, "public slug / signed pay-token surface, see parity2-auction.test.js"],
  [/^\/peer-fundraisers\/manage\//, "capability-token route — the token IS the credential (garbage-token probes in donor-front-door)"],
  [/^\/admin\//, "requireSuperAdmin — the §2 role probe (org admin → 403) is the applicable wall; there is no tenant context to cross"],
  [/^\/account\//, "donor-account cookie auth — deep isolation lives in org-blindness.test.js (48 asserts)"],
  [/^\/recurring\/(update-card|proposal)/, "signed-token donor surface"],
  [/^\/reports\/:key$/, "param is a report NAME, not a row id"],
  [/^\/api\/v1\//, "API-KEY auth, not a staff JWT — the org is the key's stored row; cross-org reads are proven in tests/build98-api.test.js"],
  // BUILD-86 C.3 — the param is a DASHBOARD NAME from the fixed registry in
  // shared/dashboards.js (board · fundraising · people · recurring), never a
  // row id. There is no cross-org value to probe: the org comes from the token
  // and an unknown key is a 404. Tenancy for what these screens RETURN is
  // proven directly in tests/dashboards.test.js §6, which asserts org B never
  // sees org A's people or figures on any of the four.
  [/^\/dashboards\/:key(\/pdf)?$/, "param is a dashboard NAME from a fixed registry, not a row id — see dashboards.test.js §6"],
  // FIX-2 A — the param is a SOURCE NAME from the fixed registry in
  // figureSources.js (gifts · givers · retention · …), never a row id. The org
  // comes from the token and is the first argument of every source's query;
  // an unknown name is a 404. Cross-org rows are proven directly in
  // tests/fix2-a-footing.test.js §2 (org B asking for org A's donor gets none).
  [/^\/figures\/:source\/rows$/, "param is a figure SOURCE NAME from a fixed registry, not a row id — see fix2-a-footing.test.js §2"],
  // REPORTS-4: the same rows as /rows (figureSources.allRows through figure()),
  // as a CSV and as the people in them. The org is the token's; the param is a
  // source name. reports4-foot checks they hold exactly the figure's rows.
  [/^\/figures\/:source\/(export\.csv|people)$/, "param is a figure SOURCE NAME from a fixed registry, not a row id; same rows as /rows, see reports4-foot.test.js"],
  // REPORTS-3 — the param is a figure SOURCE NAME, exactly as above: the
  // dashboard-tile catalogue is built from figureSources.js's own registry and
  // an unknown name is refused. There is no cross-org value to probe.
  [/^\/dashboard-tiles$/, "no parameters — the catalogue of a fixed registry"],
  [/^\/portfolio\/officers\/:userId\/color$/, "cross-org userId probed via bResolver userId map"], // resolved, listed for clarity
  // INT-OAUTH — the param is a PROVIDER KEY from the fixed registry in
  // shared/oauth.js (xero · intuit · square), never a row id, and an unknown
  // one is a 404. There is no "org B's provider" to probe: the org on every
  // one of these routes comes from the token and is written into the state, the
  // sealed credentials and each row. What these routes could cross is proven
  // directly in tests/oauth-state.test.js, which fails the callback when the
  // signed state names a different org and shows org A's sealed tokens will
  // not open for org B.
  [/^\/oauth\/:provider\//, "param is a PROVIDER KEY from a fixed registry, not a row id — see oauth-state.test.js"],
  // INT-3 — the param is a PROVIDER KEY from the fixed registry in
  // shared/emailMarketing.js (mailchimp · constantcontact), never a row id, and
  // an unknown one is a 404. There is no "org B's provider" to reach: every one
  // of these routes takes its org from the token and reads or writes only that
  // org's own `email_marketing_connections` row. What they COULD cross is the
  // opt-out and the push, and that is proven directly in tests/int3-optout.test.js
  // §7, where org A's webhook secret cannot write onto org B and each org keeps
  // exactly its own suppression row.
  //
  // NOTE the campaign route is deliberately NOT exempt here: its `:id` is a real
  // org-scoped row, so it resolves through bResolver onto org B's own campaign.
  [/^\/email-marketing\/:provider\//, "param is a PROVIDER KEY from a fixed registry, not a row id — see int3-optout.test.js §7"],
  // INT-4 — the param is a PROVIDER KEY from the fixed registry in
  // shared/oauth.js (google · microsoft), never a row id. These routes are not
  // org-scoped at all: they are USER-scoped, and the wall they need is that one
  // person's mailbox is not reachable by a colleague, which the tenant matrix
  // (one token per org) cannot express. It is proven directly in
  // tests/int4-mailbox.test.js §7, where an ADMIN colleague in the SAME org
  // cannot see, pause or disconnect her mailbox.
  //
  // NOTE /mailbox/never-log/:id is deliberately NOT exempt: its param is a real
  // row id and it resolves through bResolver onto org B's own entry.
  [/^\/mailbox\/:provider\//, "param is a PROVIDER KEY from a fixed registry, not a row id — the wall is per-USER, see int4-mailbox.test.js §7"],
];

function sign(payload, opts) { return jwt.sign(payload, process.env.JWT_SECRET, opts); }

(async () => {
  console.log("tenant-matrix (BUILD-75 Phase B)");
  const app = require("../server.js");
  await new Promise(r => setTimeout(r, 3500)); // boot DDL settles

  await reset();
  await seedOrg(A, "a");
  await seedOrg(B, "b");

  const mfetch = async (method, p, token, body, raw) => {
    const r = await fetch(M + p, {
      method,
      headers: { "Content-Type": raw ? "application/octet-stream" : "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body == null ? undefined : (raw ? body : JSON.stringify(body)),
    });
    const text = await r.text();
    return { status: r.status, text };
  };
  const loginM = async email => (JSON.parse((await mfetch("POST", "/auth/login", null, { email, password: "loadtest1234" })).text)).token;

  const aAdmin = await loginM("admin-a@mx.local");
  const aStaff = await loginM("staff-a@mx.local");
  ok("fixture logins minted", !!aAdmin && !!aStaff, { aAdmin: !!aAdmin, aStaff: !!aStaff });

  const tampered = aAdmin.slice(0, -4) + "AAAA";
  const expired = sign({ userId: `u_${A}_admin`, orgId: A, email: "admin-a@mx.local", role: "admin" }, { expiresIn: -60 });

  // ── §5 pre-battery snapshot of org B ───────────────────────────────────────
  async function hashOrgB() {
    const parts = [];
    for (const t of ["donors", "gifts", "grants", "tasks", "campaigns", "fin_transactions", "fin_funds", "opportunities",
      "pledges", "receipts", "households", "sequences", "workflows", "events", "volunteers", "custom_field_defs",
      "impact_metrics", "milestone_drafts", "note_reminders", "recurring_subscriptions", "giving_pages", "users"]) {
      const rows = await q(`SELECT * FROM ${t} WHERE org_id=$1 ORDER BY id`, [B]).catch(() => []);
      parts.push(t + ":" + JSON.stringify(rows));
    }
    return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
  }
  const bBefore = await hashOrgB();

  // ── build the probe plan from the LIVE router ──────────────────────────────
  const inv = buildInventory(app);
  ok(`live router walked: ${inv.length} routes (sanity: > 300)`, inv.length > 300, inv.length);

  // committed inventory must match the live router
  const committed = require("../audit/route-inventory.json");
  const keyOf = r => `${r.method} ${r.path}`;
  const liveSet = new Set(inv.map(keyOf)), fileSet = new Set(committed.routes.map(keyOf));
  const drift = [...liveSet].filter(k => !fileSet.has(k)).concat([...fileSet].filter(k => !liveSet.has(k)));
  ok("committed audit/route-inventory.json matches the live router (re-run scripts/build75-route-inventory.js when routes change)",
     drift.length === 0, drift.slice(0, 10));

  const isPublic = r => r.auth.length === 0 || r.auth.every(a => /[lL]imiter|Parser/.test(a));
  const failures = { auth: [], role: [], cross: [], leak: [], fivehundred: [] };
  const ledger = new Map(); // routeKey → [probe names]
  const record = (r, probe) => { const k = keyOf(r); if (!ledger.has(k)) ledger.set(k, []); ledger.get(k).push(probe); };
  const scanLeak = (r, probe, text) => {
    const low = text.toLowerCase();
    for (const m of PRIV) if (low.includes(m)) { failures.leak.push(`${keyOf(r)} [${probe}] leaked "${m}"`); return; }
  };

  const fillPath = (routePath, resolver) => {
    let out = routePath, unresolved = [];
    for (const seg of routePath.split("/")) {
      if (!seg.startsWith(":")) continue;
      const name = seg.slice(1).replace(/\?$/, "");
      const v = resolver(routePath, name);
      if (v == null) unresolved.push(name);
      else out = out.replace(seg, encodeURIComponent(v));
    }
    return { out, unresolved };
  };

  const crossProbed = new Set(), unexercised = [];
  for (const r of inv) {
    const key = keyOf(r);

    if (isPublic(r)) {
      // public surface: anonymous garbage probe must not 500 (bodies of
      // deliberate B-public surfaces are legitimately B's — no leak scan here)
      const { out, unresolved } = fillPath(r.path, () => "zz-nonexistent");
      if (!unresolved.length) {
        const res = await mfetch(r.method, out, null, r.method === "GET" ? undefined : {});
        if (res.status >= 500) failures.fivehundred.push(`${key} → ${res.status}`);
        record(r, "public-garbage");
      } else record(r, "public-unfillable");
      continue;
    }

    // §2 — the auth wall, every authenticated route
    for (const [probe, tok] of [["no-token", null], ["tampered", tampered], ["expired", expired]]) {
      const { out, unresolved } = fillPath(r.path, () => "zz-nonexistent");
      if (unresolved.length) break;
      const res = await mfetch(r.method, out, tok, r.method === "GET" ? undefined : {});
      record(r, probe);
      if (res.status !== 401) failures.auth.push(`${key} [${probe}] → ${res.status} (want 401)`);
      scanLeak(r, probe, res.text);
    }

    // §2 — role walls
    if (r.auth.includes("requireAdmin") && !r.auth.includes("requireSuperAdmin")) {
      const { out, unresolved } = fillPath(r.path, bResolver);
      const target = unresolved.length ? fillPath(r.path, () => "zz-nonexistent").out : out;
      const res = await mfetch(r.method, target, aStaff, r.method === "GET" ? undefined : {});
      record(r, "staff-on-admin");
      if (res.status !== 403) failures.role.push(`${key} [staff] → ${res.status} (want 403)`);
      scanLeak(r, "staff-on-admin", res.text);
    }
    if (r.auth.includes("requireSuperAdmin")) {
      const { out } = fillPath(r.path, () => "zz-nonexistent");
      const res = await mfetch(r.method, out, aAdmin, r.method === "GET" ? undefined : {});
      record(r, "admin-on-superadmin");
      if (res.status !== 403) failures.role.push(`${key} [org-admin→superadmin] → ${res.status} (want 403)`);
      scanLeak(r, "admin-on-superadmin", res.text);
    }
    if (r.auth.includes("requirePortalSession") || r.auth.includes("requireDonorAccount")) {
      const { out, unresolved } = fillPath(r.path, () => "zz-nonexistent");
      if (!unresolved.length) {
        const res = await mfetch(r.method, out, aStaff, r.method === "GET" ? undefined : {});
        record(r, "staff-jwt-on-cookie-route");
        if (![401, 403, 404].includes(res.status)) failures.role.push(`${key} [staff-jwt on cookie route] → ${res.status}`);
        scanLeak(r, "staff-jwt-on-cookie-route", res.text);
      }
    }

    // §3 — cross-tenant: A's token, B's real resource, DUAL-probed against a
    // nonexistent id. Two layers: (1) SECURITY — B's id must be byte-
    // indistinguishable from a ghost id (no existence oracle) and never 2xx;
    // (2) CONVENTION — the one answer is 404. A 400 is tolerated ONLY when it
    // is validation-first AND identical for B and ghost (the body was rejected
    // before ownership was ever consulted — nothing about B was revealed).
    if (r.path.includes(":") && r.auth.includes("requireAuth") && !r.auth.includes("requireSuperAdmin")) {
      const { out, unresolved } = fillPath(r.path, bResolver);
      if (!unresolved.length) {
        const tok = aAdmin; // admin = the STRONGEST in-org credential; if admin can't cross, staff can't
        const ghostPath = fillPath(r.path, () => "zz-nonexistent").out;
        const body = r.method === "GET" ? undefined : {};
        const res = await mfetch(r.method, out, tok, body);
        const ghost = await mfetch(r.method, ghostPath, tok, body);
        record(r, "cross-tenant-path");
        crossProbed.add(key);
        const oracle = res.status !== ghost.status || res.text !== ghost.text;
        if (res.status >= 200 && res.status < 300) failures.cross.push(`${key} → ${res.status} 2XX ON B'S RESOURCE`);
        else if (oracle) failures.cross.push(`${key} → B:${res.status} vs ghost:${ghost.status} EXISTENCE ORACLE (${res.text.slice(0, 60)} / ${ghost.text.slice(0, 60)})`);
        else if (res.status !== 404 && res.status !== 400) failures.cross.push(`${key} → ${res.status} (want 404, the one answer)`);
        scanLeak(r, "cross-tenant-path", res.text);
      }
    }

    // §3 — B ids in QUERY identifier params on GET list routes
    if (r.method === "GET" && r.auth.includes("requireAuth") && !r.path.includes(":")) {
      const idq = r.params.query.filter(n => /donorId|campaignId|fundId|assignedTo|grantId|giving_page_id|pageId/.test(n));
      if (idq.length) {
        const qs = idq.map(n => `${n}=${encodeURIComponent(bResolver("/donors/x", "donorId"))}`).join("&");
        const res = await mfetch("GET", `${r.path}?${qs}`, aAdmin);
        record(r, "cross-tenant-query");
        scanLeak(r, "cross-tenant-query", res.text);
        if (res.status >= 500) failures.fivehundred.push(`${key} [b-query] → ${res.status}`);
      }
    }

    // §1 bookkeeping — parameterized route with NO cross probe must be exempt
    if (r.path.includes(":") && !crossProbed.has(key)) {
      const exempt = PARAM_EXEMPT.some(([re]) => re.test(r.path));
      if (!exempt) unexercised.push(key);
    }
  }

  // ── §1 · coverage is the gate ──────────────────────────────────────────────
  console.log("\n— §1 · coverage: every parameterized route crossed or classified —");
  ok(`unexercised parameterized routes (add a bResolver mapping or a reasoned PARAM_EXEMPT entry): [${unexercised.join(", ")}]`,
     unexercised.length === 0, unexercised);
  // The gate PROVEN to fail on a route the matrix did not exercise:
  const fake = { method: "GET", path: "/matrix-proof/:widgetId", auth: ["requireAuth"], params: { path: ["widgetId"], query: [], body: [] } };
  const fakeResolved = fillPath(fake.path, bResolver);
  const fakeExempt = PARAM_EXEMPT.some(([re]) => re.test(fake.path));
  ok("a synthetic uncovered route lands in the unexercised bucket (the B.4 gate fails on it)",
     fakeResolved.unresolved.length > 0 && !fakeExempt, { unresolved: fakeResolved.unresolved, fakeExempt });
  ok(`probe ledger covers every route (${ledger.size}/${inv.length})`, ledger.size === inv.length,
     inv.map(keyOf).filter(k => !ledger.has(k)).slice(0, 10));

  // ── §2 · the auth wall ─────────────────────────────────────────────────────
  console.log("\n— §2 · the auth wall —");
  ok(`no-token / tampered / expired → 401 everywhere (${failures.auth.length} exceptions)`, failures.auth.length === 0, failures.auth.slice(0, 12));
  ok(`role walls hold — staff→admin 403, org-admin→superadmin 403, staff-JWT→cookie routes (${failures.role.length} exceptions)`,
     failures.role.length === 0, failures.role.slice(0, 12));
  ok(`no probe produced a 5xx (${failures.fivehundred.length})`, failures.fivehundred.length === 0, failures.fivehundred.slice(0, 12));

  // ── §3 · cross-tenant, one answer everywhere ───────────────────────────────
  console.log("\n— §3 · cross-tenant: 404, the one answer —");
  if (failures.cross.length) for (const f of failures.cross) console.log("  CROSS-EXCEPTION  " + f);
  ok(`A's token on B's real resource → 404 on all ${crossProbed.size} resolvable routes (${failures.cross.length} exceptions)`,
     failures.cross.length === 0, failures.cross.length);
  ok(`cross-tenant probes actually ran at scale (${crossProbed.size} routes ≥ 60)`, crossProbed.size >= 60, crossProbed.size);

  // ── §4 · the leak scan ─────────────────────────────────────────────────────
  console.log("\n— §4 · response-body leak scan —");
  ok(`no A-credentialed body carried a B private marker (${failures.leak.length})`, failures.leak.length === 0, failures.leak.slice(0, 12));

  // ── §6 · indistinguishability ──────────────────────────────────────────────
  console.log("\n— §6 · 404-for-B and 404-for-nonexistent are the same bytes —");
  for (const [p, bid] of [["/donors/", `d_${B}`], ["/grants/", `gr_${B}`], ["/households/", `h_${B}`], ["/opportunities/", `op_${B}`]]) {
    const real = await mfetch(p === "/opportunities/" ? "PUT" : "GET", p + bid, aAdmin, p === "/opportunities/" ? {} : undefined);
    const ghost = await mfetch(p === "/opportunities/" ? "PUT" : "GET", p + "zz-nonexistent", aAdmin, p === "/opportunities/" ? {} : undefined);
    ok(`${p}: B's real id and a nonexistent id are indistinguishable (${real.status}/${ghost.status})`,
       real.status === ghost.status && real.text === ghost.text, { real: real.text.slice(0, 80), ghost: ghost.text.slice(0, 80) });
  }

  // ── §7 · targeted B.3 ──────────────────────────────────────────────────────
  console.log("\n— §7 · search, exports, aggregates, webhook, import dedupe —");
  const search = await mfetch("GET", "/donors?search=zzmarkb&limit=50", aAdmin);
  const searchRows = JSON.parse(search.text);
  ok("searching a B-only string at A returns zero rows", (searchRows.donors || searchRows).length === 0, search.text.slice(0, 120));
  const gsearch = await mfetch("GET", "/grants?search=ZZMARKB", aAdmin);
  ok("grant search for a B-only funder returns zero rows", !gsearch.text.toLowerCase().includes("zzmarkb"), gsearch.text.slice(0, 120));

  for (const [label, path] of [["org JSON export", "/org/export"], ["donors CSV export", "/donors/export/csv"], ["giving-summary CSV", "/reports/giving-summary?format=csv&year=2026&yearMode=calendar"]]) {
    const res = await mfetch("GET", path, aAdmin);
    const low = res.text.toLowerCase();
    ok(`${label} carries no B marker byte-wise`, res.status === 200 && !PRIV.some(m => low.includes(m)), { status: res.status });
  }

  for (const [label, path] of [["home dashboard", "/dashboard/home"], ["finance summary", "/finance/summary"], ["fundraising overview", "/fundraising/overview"]]) {
    const res = await mfetch("GET", path, aAdmin);
    ok(`${label} aggregates carry no B amounts`, !PRIV.some(m => res.text.toLowerCase().includes(m)), { status: res.status });
  }

  // a signed Stripe event on A's account carrying B's donor email must resolve
  // inside A only (a new A donor or none — never B's row, never a B write)
  const evt = JSON.stringify({
    id: "evt_matrix_x1", type: "payment_intent.succeeded", account: `acct_matrix_a`,
    data: { object: { id: "pi_matrix_x1", amount_received: 5000, receipt_email: `donor-zzmarkb@mx.local`, metadata: { donor_name: "Webhook Probe" } } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${ts}.${evt}`).digest("hex");
  const wh = await fetch(M + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` }, body: evt });
  ok("webhook accepted (signature valid)", wh.status === 200, wh.status);
  const whoGot = await q(`SELECT donor_id, org_id FROM gifts WHERE stripe_payment_id='pi_matrix_x1'`);
  ok("the gift landed in A and NOT on B's donor row", whoGot.length === 1 && whoGot[0].org_id === A && whoGot[0].donor_id !== `d_${B}`, whoGot);

  // importing the email of a B-ONLY donor at A must surface no B data in dedupe
  const imp = await mfetch("POST", "/donors/import-combined", aAdmin, {
    donors: [{ name: "Fresh Import", email: "donor-zzmarkb@mx.local" }], gifts: [],
  });
  ok("import of a B-only email at A treats it as NEW — no B hint in the result", imp.status === 200 && !imp.text.toLowerCase().includes("zzmarkb"), imp.text.slice(0, 200));

  // ── §8 · OFFICER vs OFFICER, inside one org (BUILD-76 Part 5) ─────────────
  // The admin-token battery above proves org A cannot touch org B. It says
  // nothing about officer A vs officer B INSIDE one org — the BUILD-75 worry
  // paragraph's exact gap. THE DECISION, written down and asserted rather
  // than left to accident:
  //
  //   · Donor DATA is ORG-SHARED — any staff member reads any donor record,
  //     gifts, notes, moves. That IS the product's turnover thesis ("if your
  //     director leaves, everything she knew is written down" — written down
  //     for the ORGANIZATION, not siloed per officer). Officer-level data
  //     silos would make the pitch false.
  //   · Portfolio VIEWS are officer-scoped and ENFORCED SERVER-SIDE, not
  //     hidden client-side: the pipeline board (BUILD-31 — a non-admin's
  //     scope=all / foreign assignedTo is downgraded to their own
  //     portfolio) and the my-stats family (own numbers by construction).
  //     Performance-tracking surfaces are the trust question the brief
  //     names, and they are the ones that stay per-officer.
  //   · The day view's org-wide opt-in (?scope=all) stays open to staff —
  //     a small-shop convenience, deliberately.
  //   · Drift is org-wide (the file's truth, not an officer's), and a
  //     colleague may clear a drift item for another officer's donor — the
  //     actor stamp records WHO, which is accountability, not a wall.
  console.log("\n— §8 · officer vs officer, inside one org —");
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,'off2-a@mx.local',$3,'Officer Two','staff')`,
    [`u_${A}_off2`, A, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name,notes,tags)
           VALUES ($1,$2,'Portfolio Two Donor','p2donor@mx.local','mid','cultivate',777,1,$3,$4,'Officer Two','officer two private-ish note','[]')`,
    [`d_${A}_p2`, A, TODAY, `u_${A}_off2`]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ($1,$2,$3,'call','p2 call note',$4,$5,'Officer Two')`,
    [`i_${A}_p2`, A, `d_${A}_p2`, TODAY, `u_${A}_off2`]);
  const off1 = aStaff; // u_${A}_staff owns d_${A}

  // The enforced wall: the pipeline board downgrades a staff scope=all /
  // foreign assignedTo to the officer's OWN portfolio.
  for (const [label, path] of [
    ["scope=all", "/pipeline?scope=all"],
    ["assignedTo=officer2", `/pipeline?assignedTo=u_${A}_off2`],
  ]) {
    const res = await mfetch("GET", path, off1);
    const cols = JSON.parse(res.text).columns || {};
    const cards = Object.values(cols).flat();
    ok(`§8 pipeline ${label}: staff downgraded to OWN portfolio (no officer-2 cards)`,
      res.status === 200 && cards.every(c => c.assignedTo !== `u_${A}_off2`) && !cards.some(c => c.donorId === `d_${A}_p2`),
      cards.map(c => [c.donorId, c.assignedTo]));
  }
  const adminBoard = JSON.parse((await mfetch("GET", "/pipeline?scope=all", aAdmin)).text);
  ok("§8 pipeline: the ADMIN oversight view still sees both portfolios (the Team-tier whole-shop forecast)",
    Object.values(adminBoard.columns || {}).flat().some(c => c.donorId === `d_${A}_p2`)
    && Object.values(adminBoard.columns || {}).flat().some(c => c.donorId === `d_${A}`), null);

  // my-stats: officer 1's numbers never include officer 2's portfolio.
  const myStats = JSON.parse((await mfetch("GET", "/dashboard/my-stats", off1)).text);
  ok("§8 my-stats: portfolioCount is the officer's OWN (1, not 2)", myStats.portfolioCount === 1, myStats.portfolioCount);
  for (const bk of ["pipeline", "lapsed", "gifts", "visits", "moves"]) {
    const res = await mfetch("GET", `/dashboard/my-stats/${bk}/breakdown`, off1);
    ok(`§8 my-stats/${bk} breakdown: no officer-2 rows`,
      res.status === 200 && !res.text.includes(`d_${A}_p2`) && !res.text.includes("Portfolio Two Donor"), res.text.slice(0, 120));
  }

  // The DECIDED sharing: officer 1 reads officer 2's donor + their notes.
  const shared = await mfetch("GET", `/donors/d_${A}_p2`, off1);
  ok("§8 DECISION: donor records are org-shared — officer 1 reads officer 2's donor (200)", shared.status === 200, shared.status);
  ok("§8 DECISION: …including the logged notes (the turnover thesis)",
    shared.text.includes("p2 call note"), null);

  // The day view: mine is mine; org-wide is a deliberate opt-in for staff.
  const mineQ = await mfetch("GET", "/dashboard/today?scope=mine", off1);
  ok("§8 today?scope=mine: no officer-2 donors", mineQ.status === 200 && !mineQ.text.includes(`d_${A}_p2`), null);
  const allQ = await mfetch("GET", "/dashboard/today?scope=all", off1);
  ok("§8 DECISION: today?scope=all stays open to staff (small-shop convenience)", allQ.status === 200, allQ.status);

  // Drift: org-wide by decision; a colleague's done is recorded to THEM.
  const dDone = await mfetch("POST", `/drift/d_${A}_p2/done`, off1, { note: "covered for officer two" });
  ok("§8 DECISION: drift-done on a colleague's donor is allowed (shared workspace)", [200, 201].includes(dDone.status), dDone.status);
  const doneRow = await q(`SELECT created_by FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'via'='drift_done'`, [A, `d_${A}_p2`]);
  ok("§8 …and the actor stamp records WHO actually did it (accountability, not a wall)",
    doneRow.length === 1 && doneRow[0].created_by === `u_${A}_staff`, doneRow);

  // ── §5 · org B is byte-identical after the whole battery ───────────────────
  // ── §9 · THE PUBLIC SLUG SURFACES · FIX-7 Part 2 ─────────────────────────
  // §3 probes routes behind `requireAuth`. The slug-scoped PUBLIC surfaces
  // (/e, /you, /give, /fundraiser) are skipped there — `isPublic(r)` returns
  // before the cross-tenant probe — so until now nothing in this file stood on
  // ORG A's public page and handed it ORG B's row id. That is exactly the
  // shape the brief named: the scoping rule for a public route is "the org the
  // SLUG belongs to", and a body field is not a slug.
  //
  // Each probe below stands on org A's own event page and offers org B's
  // ticket level. Status codes are not the assertion (these routes redirect on
  // every outcome, which is correct for a form post): the assertion is the
  // DATABASE. Nothing in org A may end up pointing at org B's level, and
  // nothing may appear in org B at all. §5's hash catches the second; the
  // counts here catch the first, which a hash of B would never see.
  console.log("\n— §9 · public slug surfaces: A's page, B's row id —");
  const bLevel = `evl_${B}`, aSlug = "matrix-a-event";
  const form = async (path, body) => {
    const r = await fetch(M + path, { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString() });
    return { status: r.status, location: r.headers.get("location") || "", text: await r.text() };
  };
  // The refusal this file is asserting, in the words the route sends back.
  const REFUSED = "option is no longer available";
  const countCross = async () => {
    const [w] = await q(`SELECT COUNT(*)::int n FROM event_waitlist WHERE org_id=$1 AND level_id=$2`, [A, bLevel]);
    const [a] = await q(`SELECT COUNT(*)::int n FROM event_attendees WHERE org_id=$1 AND level_id=$2`, [A, bLevel]);
    return Number(w.n) + Number(a.n);
  };
  const before9 = await countCross();
  await form(`/e/${aSlug}/waitlist`, { name: "Crosser", email: "crosser@mx.local", levelId: bLevel });
  const regB = await form(`/e/${aSlug}/register`, { name: "Crosser Two", email: "crosser2@mx.local", levelId: bLevel, quantity: "1" });
  const payB = await form(`/e/${aSlug}/checkout`, { name: "Crosser Three", email: "crosser3@mx.local", levelId: bLevel, quantity: "1" });
  const after9 = await countCross();
  ok("§9 A's event page wrote no row against B's ticket level (waitlist, register, checkout)",
     after9 === before9, { before: before9, after: after9 });
  // Rows alone are not enough for checkout: it hands off to Stripe and writes
  // nothing on the way, so a missing row would be "green" with the guard gone.
  // The REFUSAL itself is the assertion there, on both doors.
  ok("§9 register refuses B's level in words, not by accident",
     /option is no longer available/i.test(regB.text) || /option is no longer available/i.test(decodeURIComponent(regB.location)),
     { status: regB.status, location: regB.location, head: regB.text.slice(0, 160) });
  ok("§9 checkout refuses B's level in words, not by accident",
     new RegExp(REFUSED, "i").test(decodeURIComponent(payB.location)) || new RegExp(REFUSED, "i").test(payB.text),
     { status: payB.status, location: payB.location, head: payB.text.slice(0, 160) });

  // The same wall one step in: A's page, A's OWN level but from A's OTHER
  // event. Not a tenancy break — it is inside one org — but it is the same
  // sentence ("the id in the body is scoped to the thing in the slug"), and
  // it is the one /e/:slug/checkout was actually missing.
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug) VALUES ($1,$2,'Matrix A Second','gala',$3,'upcoming','matrix-a-event-2')
           ON CONFLICT (id) DO NOTHING`, [`ev2_${A}`, A, TODAY]).catch(() => {});
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv) VALUES ($1,$2,$3,'ticket','Second Level',150,60)
           ON CONFLICT (id) DO NOTHING`, [`evl2_${A}`, A, `ev2_${A}`]).catch(() => {});
  const [ev2Before] = await q(`SELECT COUNT(*)::int n FROM event_attendees WHERE org_id=$1 AND level_id=$2`, [A, `evl2_${A}`]);
  await form(`/e/${aSlug}/register`, { name: "Wrong Event", email: "wrongevent@mx.local", levelId: `evl2_${A}`, quantity: "1" });
  const wrongPay = await form(`/e/${aSlug}/checkout`, { name: "Wrong Event Two", email: "wrongevent2@mx.local", levelId: `evl2_${A}`, quantity: "1" });
  const [ev2After] = await q(`SELECT COUNT(*)::int n FROM event_attendees WHERE org_id=$1 AND level_id=$2`, [A, `evl2_${A}`]);
  ok("§9 one event's page cannot sell another event's level, even inside one org",
     Number(ev2After.n) === Number(ev2Before.n) && new RegExp(REFUSED, "i").test(decodeURIComponent(wrongPay.location) + wrongPay.text),
     { before: ev2Before.n, after: ev2After.n, location: wrongPay.location });

  // ── §10 · A USER ID IN THE BODY BELONGS TO THE ORG · FIX-19 ───────────────
  // POST /donors/:id/threads stored any ownerId it was handed, so org B's admin
  // could be named the owner of org A's next step. Every route that takes a
  // user id from the request now asks orgUsers.js first. The assertion is the
  // refusal AND the database: no thread for this donor, none owned by B.
  console.log("\n— §10 · a user id from org B on org A's thread —");
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,tags) VALUES ($1,$2,'Owner Probe','ownerprobe@mx.local','new','prospect','[]')
           ON CONFLICT (id) DO NOTHING`, [`d_${A}_owner`, A]);
  const crossOwner = await mfetch("POST", `/donors/d_${A}_owner/threads`, aAdmin,
    { label: "Call to say thank you", due: TODAY, ownerId: `u_${B}_admin` });
  const [ownThreads] = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1 AND donor_id=$2`, [A, `d_${A}_owner`]);
  const [bOwned] = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1 AND owner_id LIKE $2`, [A, `u_${B}_%`]);
  ok("§10 an ownerId from org B on org A's thread is refused with a 400",
     crossOwner.status === 400 && /not an active user/i.test(crossOwner.text), { status: crossOwner.status, body: crossOwner.text.slice(0, 160) });
  ok("§10 …and writes nothing: no thread for the donor, none in A owned by a B user",
     Number(ownThreads.n) === 0 && Number(bOwned.n) === 0, { ownThreads: ownThreads.n, bOwned: bOwned.n });
  // The same request with A's own staff user is accepted, so the refusal above
  // is about the org, not the route.
  const sameOrg = await mfetch("POST", `/donors/d_${A}_owner/threads`, aAdmin,
    { label: "Call to say thank you", due: TODAY, ownerId: `u_${A}_staff` });
  ok("§10 an ownerId from org A's own staff is accepted", sameOrg.status === 201, { status: sameOrg.status, body: sameOrg.text.slice(0, 160) });

  // ── §11 · FILES AND ASSETS · FIX-20 Part 0 ──────────────────────────────
  // /portal-assets/:id served ANY asset to anyone holding its id: a waiver, a
  // conversation attachment, a grant agreement. Now only an asset an admin
  // placed on a public page is served without a session; every other asset
  // needs a signed-in user of the org that owns it, and every refusal is the
  // same 404 a missing id gets. Fails if the door goes back to serving by id
  // alone (the signed-out and cross-org probes get the bytes).
  console.log("\n§11 · files and assets: signed out, other org, public page");
  const IXF = require("../interactionFiles");
  const aid = (k) => "pa_" + crypto.createHash("sha256").update(B + "|" + k).digest("hex").slice(0, 24);
  const bytes = Buffer.from("ZZMARKB private file bytes");
  const putB = (id, kind, ct, pub) => q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data,is_public)
    VALUES ($1,$2,$3,$4,$5,'db',$6,$7) ON CONFLICT (id) DO UPDATE SET is_public=$7, deleted_at=NULL`,
    [id, B, kind, ct, bytes.length, bytes.toString("base64"), pub]);
  const waiver = aid("volapply"), attach = aid("ixfile"), pagePhoto = aid("event");
  await putB(waiver, "volapply", "application/pdf", false);
  await putB(attach, "ixfile", "application/pdf", false);
  await putB(pagePhoto, "event", "image/png", true);
  await q(`INSERT INTO interaction_attachments (id,org_id,interaction_id,donor_id,asset_id,filename,mime,bytes,created_by)
           VALUES ($1,$2,$3,$4,$5,'waiver.pdf','application/pdf',$6,'system:matrix') ON CONFLICT (id) DO NOTHING`,
    [`iatt_${B}`, B, `i_${B}`, `d_${B}`, attach, bytes.length]);
  const bAdmin = await loginM("admin-b@mx.local");
  const get = async (p, token) => { const r = await fetch(M + p, { headers: token ? { Authorization: "Bearer " + token } : {} }); return { status: r.status, text: await r.text() }; };
  for (const [label, id] of [["a waiver upload", waiver], ["a conversation attachment", attach]]) {
    const out = await get(`/portal-assets/${id}`);
    const cross = await get(`/portal-assets/${id}`, aAdmin);
    const own = await get(`/portal-assets/${id}`, bAdmin);
    ok(`§11 ${label}: signed out gets 404`, out.status === 404 && !/ZZMARKB/.test(out.text), out.status);
    ok(`§11 ${label}: another org's admin gets 404`, cross.status === 404 && !/ZZMARKB/.test(cross.text), cross.status);
    ok(`§11 ${label}: its own org's signed-in user gets the file`, own.status === 200 && /ZZMARKB/.test(own.text), own.status);
  }
  const signed = IXF.signFileUrl({ orgId: B, assetId: attach });
  const sOut = await get(signed), sCross = await get(signed, aAdmin), sOwn = await get(signed, bAdmin);
  ok("§11 a conversation attachment's signed link opened signed out is a 404", sOut.status === 404, sOut.status);
  ok("§11 …and from another org is a 404", sCross.status === 404, sCross.status);
  ok("§11 …and from its own org downloads", sOwn.status === 200 && /ZZMARKB/.test(sOwn.text), sOwn.status);
  // FIX-22 · EVERY ATTACHMENT THE APP LISTS OPENS. The timeline counted an
  // email's attachment that nothing could open. Each file the profile lists
  // must download for its own org and 404 signed out and from another org; an
  // email's attachment (counted, never kept) must carry a link to the message
  // in the mailbox it is in, and another org must not see the list at all.
  // Fails if a listed url does not open, or an email's count has no link.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES ($1,$2,$3,'note','Matrix note','2026-01-05','system:matrix')
           ON CONFLICT (id) DO NOTHING`, [`i_${B}`, B, `d_${B}`]);
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status) VALUES ($1,$2,$3,'google','admin-b@mx.local','active')
           ON CONFLICT (id) DO NOTHING`, [`mbx_${B}`, B, `u_${B}_admin`]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,metadata) VALUES ($1,$2,$3,'email',
             'Admin wrote: Report (1 attachment, in the mailbox)','2026-01-06',$4,$5::jsonb) ON CONFLICT (id) DO NOTHING`,
    [`i_${B}_mail`, B, `d_${B}`, `system:mailbox/google/u_${B}_admin`,
     JSON.stringify({ message_id: "mxmsg1", provider: "google", direction: "outbound", subject: "Report", attachments: 1, logged_by: `u_${B}_admin` })]);
  const listed = await mfetch("GET", `/donors/d_${B}/attachments`, bAdmin);
  const files = (JSON.parse(listed.text || "{}").attachments || []);
  ok("§11 the profile lists the conversation attachment", files.length >= 1, { status: listed.status, n: files.length });
  for (const f of files) {
    const u = String(f.url || "").replace(/^https?:\/\/[^/]+/, "");
    const [fo, fc, fw] = [await get(u, bAdmin), await get(u), await get(u, aAdmin)];
    ok(`§11 listed file ${f.fileName} opens for its own org`, fo.status === 200 && /ZZMARKB/.test(fo.text), fo.status);
    ok(`§11 listed file ${f.fileName} is a 404 signed out and from another org`, fc.status === 404 && fw.status === 404, [fc.status, fw.status]);
  }
  const relB = await mfetch("GET", `/donors/d_${B}/relationship`, bAdmin);
  const mf = ((JSON.parse(relB.text || "{}").emailThreads || []).flatMap(t => t.mailFiles || []))[0] || {};
  ok("§11 an email's counted attachment links to the message in its mailbox",
     /^https:\/\/mail\.google\.com\/mail\/u\/\?authuser=admin-b%40mx\.local#all\/mxmsg1$/.test(mf.url || ""), { status: relB.status, mf });
  const relCross = await mfetch("GET", `/donors/d_${B}/relationship`, aAdmin);
  ok("§11 …and another org cannot read that list", relCross.status === 404 && !/mxmsg1/.test(relCross.text), relCross.status);

  const pub = await get(`/portal-assets/${pagePhoto}`);
  ok("§11 a public page image still loads signed out", pub.status === 200, pub.status);
  const missing = await get(`/portal-assets/pa_${"0".repeat(24)}`);
  ok("§11 a refusal is byte-identical to a missing id", missing.status === 404 && missing.text === (await get(`/portal-assets/${waiver}`)).text);

  console.log("\n— §5 · B-integrity: the battery wrote nothing across the wall —");
  const bAfter = await hashOrgB();
  ok("org B's rows hash byte-identical before and after ~1,000 hostile probes", bBefore === bAfter, { bBefore: bBefore.slice(0, 12), bAfter: bAfter.slice(0, 12) });

  await closeDb();
  summary();
})().catch(e => { console.error("SUITE ERROR:", e); process.exit(1); });
