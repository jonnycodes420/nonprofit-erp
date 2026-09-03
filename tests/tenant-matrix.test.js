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

process.env.PORT = "5697";
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

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ok, summary, q, closeDb } = require("./helpers");
const { buildInventory } = require("../scripts/lib/routeInventory");

const M = "http://localhost:5697";
const A = "org_mxa", B = "org_mxb";
// PRIVATE markers — org B data that must never reach an A-credentialed body.
// The org NAME is deliberately NOT a private marker (public surfaces show it).
const PRIV = ["zzmarkb", "6377.89", "63778"];

const iso = d => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());

async function reset() {
  for (const org of [A, B]) {
    for (const t of ["board_reports", "donor_relationships", "donor_designations",
      "portal_audit_log", "digest_sends", "notification_sends", "workflow_runs", "workflows",
      "impact_updates", "recurring_change_log", "recurring_proposals", "recurring_subscriptions", "payment_recovery_events",
      "receipts", "pledges", "milestone_drafts", "note_reminders", "donor_materials", "planned_gifts",
      "custom_field_values", "custom_fields", "impact_metrics", "sequence_enrollments", "sequence_steps", "sequences",
      "peer_fundraisers", "giving_pages", "event_attendees", "events", "volunteers", "board_members",
      "opportunities", "moves", "program_grants", "programs", "tasks", "interactions", "gifts", "grants",
      "households", "donors", "fin_audit_log", "fin_transactions", "budgets", "accounts", "fin_funds",
      "invites", "portal_settings", "annual_fund_goals", "fundraising_goals", "metric_snapshots", "campaigns", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
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
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id) VALUES ($1,$2,$3,$4,$5,'income',$6,$7)`,
    [`ft_${o}`, o, TODAY, `${mark} Txn`, ledger, `acct_${o}`, `fnd_${o}`]);
  await q(`INSERT INTO grants (id,org_id,funder,program,amount,status) VALUES ($1,$2,$3,'Prog',50000,'prospecting')`,
    [`gr_${o}`, o, `${mark} Funder`]);
  await q(`INSERT INTO programs (id,org_id,name) VALUES ($1,$2,$3)`, [`prg_${o}`, o, `${mark} Program`]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,done,donor_id,assigned_to) VALUES ($1,$2,$3,$4,'high',0,$5,$6)`,
    [`t_${o}`, o, `${mark} Task`, TODAY, `d_${o}`, `u_${o}_staff`]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)`,
    [`i_${o}`, o, `d_${o}`, `${mark} interaction`, TODAY]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status) VALUES ($1,$2,$3,'gala',$4,'upcoming')`,
    [`ev_${o}`, o, `${mark} Event`, TODAY]);
  await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status) VALUES ($1,$2,$3,$4,$5,'invited')`,
    [`ea_${o}`, `ev_${o}`, o, `d_${o}`, `${mark} Attendee`]);
  await q(`INSERT INTO volunteers (id,org_id,donor_id,name) VALUES ($1,$2,$3,$4)`, [`v_${o}`, o, `d_${o}`, `${mark} Volunteer`]);
  await q(`INSERT INTO board_members (id,org_id,name,role) VALUES ($1,$2,$3,'Member')`, [`bd_${o}`, o, `${mark} Board`]);
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id) VALUES ($1,$2,$3,$4)`, [`h_${o}`, o, `${mark} Household`, `d_${o}`]);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status) VALUES ($1,$2,$3,$4,5000,'open')`,
    [`op_${o}`, o, `d_${o}`, `${mark} Ask`]);
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
  await q(`INSERT INTO custom_fields (id,org_id,label,field_type) VALUES ($1,$2,$3,'text')`, [`cf_${o}`, o, `${mark} Field`]);
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
}

// ── The cross-tenant resolver: (path segment or param name) → org B's row id.
// A parameterized route resolves when EVERY :param maps here. A new route
// whose params don't resolve must be added here or to PARAM_EXEMPT — that
// forced decision IS the coverage gate.
function bResolver(routePath, param) {
  const seg1 = routePath.split("/").filter(Boolean)[0] || "";
  const byParam = {
    donorId: `d_${B}`, subId: `rs_${B}`, attendeeId: `ea_${B}`, grantId: `gr_${B}`,
    userId: `u_${B}_staff`, recipientId: `cr_${B}`, kind: "estate",
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
  };
  if (routePath.startsWith("/fundraising/campaigns")) return `c_${B}`;
  if (routePath.startsWith("/reports/board")) return `br_${B}`;
  if (routePath.startsWith("/finance/accounts")) return `acct_${B}`;
  if (routePath.startsWith("/finance/funds")) return `fnd_${B}`;
  if (routePath.startsWith("/finance/transactions")) return `ft_${B}`;
  return bySeg[seg1] || null;
}

// Routes whose params deliberately get NO cross-tenant probe — each with the
// reason a reviewer can audit. Anything parameterized, unresolved, and not
// listed here FAILS §1.
const PARAM_EXEMPT = [
  [/^\/(portal|org|give|donate|track|portal-assets|unsubscribe|auth|network|fundraiser)\//, "public / capability-token / slug-scoped surface — org-scoping is by slug or signed token, covered by portal.test.js + donor-front-door"],
  [/^\/peer-fundraisers\/manage\//, "capability-token route — the token IS the credential (garbage-token probes in donor-front-door)"],
  [/^\/admin\//, "requireSuperAdmin — the §2 role probe (org admin → 403) is the applicable wall; there is no tenant context to cross"],
  [/^\/account\//, "donor-account cookie auth — deep isolation lives in org-blindness.test.js (48 asserts)"],
  [/^\/recurring\/(update-card|proposal)/, "signed-token donor surface"],
  [/^\/reports\/:key$/, "param is a report NAME, not a row id"],
  [/^\/portfolio\/officers\/:userId\/color$/, "cross-org userId probed via bResolver userId map"], // resolved, listed for clarity
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
      "pledges", "receipts", "households", "sequences", "workflows", "events", "volunteers", "custom_fields",
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
  console.log("\n— §5 · B-integrity: the battery wrote nothing across the wall —");
  const bAfter = await hashOrgB();
  ok("org B's rows hash byte-identical before and after ~1,000 hostile probes", bBefore === bAfter, { bBefore: bBefore.slice(0, 12), bAfter: bAfter.slice(0, 12) });

  await closeDb();
  summary();
})().catch(e => { console.error("SUITE ERROR:", e); process.exit(1); });
