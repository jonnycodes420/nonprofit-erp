#!/usr/bin/env node
// BUILD-101 — the memberships demo, on an org this script creates.
//
// "Lakeside Arts Center (Demo)": three levels, a dozen members across Active,
// Grace and Lapsed, ONE renewal thread with its note drafted, ONE membership
// bought online through the signed test webhook, and the members-by-level
// report checked against the script's own hand count.
//
// It never touches org_creo, never emails anyone (the org's mail is off and
// every address is @example.org), and creates no calendar event.
//
// Refuses any non-loopback API or database: this is a scratch-stack fixture.
//
//   BASE=http://localhost:5681 DATABASE_URL=postgresql://…@localhost:5544/… \
//   STRIPE_WEBHOOK_SECRET=whsec_localtest node scripts/build101-demo-seed.js

const crypto = require("crypto");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const BASE = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const LOOP = /^[a-z]+:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)[:/]/;
if (!LOOP.test(BASE + "/") || !LOOP.test(DB)) {
  console.error(`REFUSED: ${BASE} or the database is not loopback. This demo is for a scratch stack only.`);
  process.exit(1);
}
const ORG = "b101_demo", SLUG = "lakeside-arts-demo", ACCT = "acct_b101demo";
const EMAIL = "b101-demo-admin@example.org", PW = "loadtest1234";
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

(async () => {
  const c = new Client({ connectionString: DB }); await c.connect();
  const q = (s, a = []) => c.query(s, a).then(r => r.rows);
  const api = async (method, path, tok, body) => {
    const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = t; }
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 200)}`);
    return j;
  };

  // A clean slate for THIS org only.
  for (const t of ["memberships", "recurring_subscriptions", "receipts", "fin_transactions", "interactions", "thank_you_drafts", "threads",
                   "tasks", "workflow_runs", "gifts", "membership_levels", "donors", "users", "budgets", "accounts", "fin_funds"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at,stripe_account_id,stripe_connected,emails_enabled)
           VALUES ($1,'Lakeside Arts Center (Demo)',$2,1,'team','active','America/New_York',NOW(),$3,true,false)`, [ORG, SLUG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101demo',$1,$2,$3,'Morgan Reyes','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  const tok = (await api("POST", "/auth/login", null, { email: EMAIL, password: PW })).token;
  await api("POST", "/onboarding/complete", tok, {});
  const today = (await api("GET", "/dashboard/home", tok)).today;

  const levels = {};
  for (const [name, price, fmv, benefits] of [
    ["Individual", 60, 0, ["Free admission for one", "Member newsletter"]],
    ["Family", 120, 30, ["Free admission for two adults and children", "Two guest passes", "Members' preview night"]],
    ["Patron", 500, 75, ["Everything in Family", "Invitation to the patrons' dinner", "Recognition in the annual report"]],
  ]) levels[name] = (await api("POST", "/membership-levels", tok, { name, price, fmv, term: "12_months", benefits })).id;

  // name, level, how: paid (joined today) · started N days ago (no payment,
  // history) — the sweep turns the old ones into Grace and Lapsed.
  const people = [
    ["Ada Okafor", "Family", { paid: true }],
    ["Ben Castillo", "Individual", { paid: true }],
    ["Chloe Hart", "Patron", { paid: true }],
    ["Dev Patel", "Family", { startedDaysAgo: 345 }],        // expires in ~20 days → the renewal thread
    ["Elena Ruiz", "Individual", { startedDaysAgo: 200 }],
    ["Farah Nadeem", "Family", { startedDaysAgo: 100 }],
    ["Gus Lindqvist", "Patron", { startedDaysAgo: 30 }],
    ["Hana Sato", "Family", { startedDaysAgo: 375 }],        // expired 10 days ago → Grace
    ["Ian Brooks", "Individual", { startedDaysAgo: 380 }],   // expired 15 days ago → Grace
    ["Jo Whitfield", "Family", { startedDaysAgo: 420 }],     // expired 55 days ago → Lapsed
    ["Kai Moreno", "Individual", { startedDaysAgo: 600 }],   // Lapsed
  ];
  for (const [name, level, how] of people) {
    const email = name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.org";
    const d = await api("POST", "/donors", tok, { name, email, stage: "steward" });
    const id = d.id || d.donor?.id;
    await api("POST", `/donors/${id}/memberships`, tok, how.paid
      ? { levelId: levels[level], paymentMethod: "check", idempotencyKey: "b101demo-" + id }
      : { levelId: levels[level], startsOn: addDays(today, -how.startedDaysAgo), paid: false });
  }
  const sweep = await api("POST", "/memberships/run-sweep", tok, {});

  // The twelfth member joins online, through the signed test webhook.
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
  const payload = JSON.stringify({ id: "evt_b101demo_online", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_b101demo_online", amount_received: 12000, receipt_email: "lena.park@example.org",
      metadata: { donor_email: "lena.park@example.org", donor_name: "Lena Park", org_id: ORG, membership_level_id: levels.Family, frequency: "once" } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
  const wh = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig }, body: payload });

  // The members-by-level report against the script's own count.
  const rows = await q(`SELECT l.name, m.status FROM memberships m JOIN membership_levels l ON l.id=m.level_id WHERE m.org_id=$1`, [ORG]);
  const hand = {};
  for (const r of rows) { const h = hand[r.name] ||= { current: 0, lapsed: 0 }; if (r.status === "active" || r.status === "grace") h.current++; if (r.status === "lapsed") h.lapsed++; }
  const rep = await api("GET", "/reports/members-by-level", tok);
  const mismatch = rep.rows.filter(r => (hand[r.name]?.current || 0) !== r.current || (hand[r.name]?.lapsed || 0) !== r.lapsed);
  const byStatus = {}; for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const [thread] = await q(`SELECT next_step_label, LEFT(draft_note, 140) AS note FROM threads WHERE org_id=$1 AND next_step_type='membership_renewal' AND closed_at IS NULL`, [ORG]);
  const [online] = await q(`SELECT m.source, g.amount, g.deductible_amount FROM memberships m JOIN gifts g ON g.id=m.gift_id JOIN donors d ON d.id=m.donor_id
                             WHERE m.org_id=$1 AND LOWER(d.email)='lena.park@example.org'`, [ORG]);
  console.log(JSON.stringify({ org: ORG, login: EMAIL, members: rows.length, byStatus, renewalThreadsOpened: sweep.opened, renewalThread: thread || null,
    online: { webhook: wh.status, ...online }, membersByLevel: rep.rows.map(r => ({ level: r.name, current: r.current, lapsed: r.lapsed, revenue: (r.revenueCents / 100).toFixed(2) })),
    reconciles: mismatch.length === 0 }, null, 2));
  await c.end();
  if (mismatch.length || !thread || wh.status !== 200 || !online) process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
