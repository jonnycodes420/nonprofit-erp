// scripts/lib/demoRealPeople.js — FIX-3 C, finding 8. WHO IS REAL, CONCRETELY.
//
// The walk found "Jonathan Atkinson $1" in the Harborlight demo's thank-you
// list: a real $1 Stripe charge through the demo org's give page, landing in
// the org the pitch is given on. The demo holds only invented people, so this
// module defines "a real person" in terms a test can check:
//
//   1. the founder's identity as the repo knows it — the name Jonathan
//      Atkinson; any xjca2006(+tag)@ address; any @stewardapp.dev address
//      (FOUNDER_EMAIL is one); jonathan.atkinson@asbury.edu (the duplicate
//      staff user in NEEDS-JONATHAN.md); and FOUNDER_EMAIL if it is set;
//   2. every address on the mail block (mailBlock.js — Jonathan's list);
//   3. every `users` row on the instance, matched by email, or by full name
//      (two or more words — a one-word "Admin" matches nothing). This includes
//      the demo org's own users: a donor named Dana Reyes would be staff
//      leaking into the file;
//   4. a gift carrying a Stripe payment id the seed did not mint (the seed's
//      are all `pi_demo_…`): real money means a real person paid it.
//
// READ-ONLY. This module only SELECTs; it is shared by the seed (which then
// removes what it finds, in scripts/seed-demo.js) and by the prod check
// (scripts/demo-real-people-check.js, PROD_READONLY). `q(sql, params)` must
// return rows.
"use strict";

const { BLOCKED_ADDRESSES, bareAddress } = require("../../mailBlock");

const FOUNDER_NAMES = ["Jonathan Atkinson"];
const FOUNDER_EMAILS = ["jonathan@stewardapp.dev", "jonathan.atkinson@asbury.edu"];
const REAL_EMAIL_PATTERNS = [
  [/^xjca2006(\+[^@]*)?@/i, "the founder's own mailbox (xjca2006@)"],
  [/@stewardapp\.dev$/i, "a Steward staff address (@stewardapp.dev)"],
];
// The seed's own Stripe ids. Anything else in the demo is a real charge.
const SEED_STRIPE_PREFIX = "pi_demo_";

const normName = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
const normEmail = s => bareAddress(s);

function staticEmails() {
  const set = new Map();
  for (const e of FOUNDER_EMAILS) set.set(e.toLowerCase(), "the founder's address");
  if (process.env.FOUNDER_EMAIL) set.set(normEmail(process.env.FOUNDER_EMAIL), "FOUNDER_EMAIL");
  for (const e of BLOCKED_ADDRESSES) set.set(e.toLowerCase(), "an address on the mail block (mailBlock.js)");
  return set;
}

// Normalised once per list — the finder compares a thousand donors with every
// users row on the instance.
const _ix = new WeakMap();
function indexUsers(users) {
  if (_ix.has(users)) return _ix.get(users);
  const ix = { emails: new Set(), names: new Map() };
  for (const u of users) {
    const e = normEmail(u.email);
    if (e) ix.emails.add(e);
    const n = normName(u.name);
    if (n.includes(" ")) ix.names.set(n, u.name);
  }
  _ix.set(users, ix);
  return ix;
}

// The reason a {name, email} is a real person, or null. `users` is a list of
// {email, name} — every users row on the instance.
function realReason(row, users = []) {
  const email = normEmail(row && row.email);
  const name = normName(row && row.name);
  if (name && FOUNDER_NAMES.some(n => normName(n) === name)) return "the founder's name";
  if (email) {
    const fixed = staticEmails().get(email);
    if (fixed) return fixed;
    for (const [re, why] of REAL_EMAIL_PATTERNS) if (re.test(email)) return why;
  }
  const ix = indexUsers(users);
  if (email && ix.emails.has(email)) return `a user's email (${email})`;
  if (name && ix.names.has(name)) return `a user's full name (${ix.names.get(name)})`;
  return null;
}

function realStripeCharge(stripePaymentId) {
  return !!stripePaymentId && !String(stripePaymentId).startsWith(SEED_STRIPE_PREFIX);
}

// Every row in `orgId` that is a real person:
//   donors            — by name/email (1–3), or a gift with a real charge (4)
//   event_attendees   — the guest list carries its own name and email
//   users             — the org's users other than `seededUserEmails`, when
//                       they are real by 1–3 (the seed's own users are
//                       invented; anyone else signed in to the demo is not)
// Returns [{ table, id, name, email, reason }].
// A LIKE pattern matching strings that start with `s`: escape the escape
// character first, then LIKE's two wildcards.
const likePrefix = s => String(s).replace(/[\\%_]/g, c => "\\" + c) + "%";

async function findRealPeople(q, orgId, { seededUserEmails = [] } = {}) {
  const users = await q(`SELECT email, name FROM users WHERE email IS NOT NULL OR name IS NOT NULL`);
  const out = [];
  const donors = await q(`SELECT id, name, email FROM donors WHERE org_id=$1`, [orgId]);
  const charged = new Map((await q(
    `SELECT donor_id, MIN(stripe_payment_id) AS pi FROM gifts
      WHERE org_id=$1 AND stripe_payment_id IS NOT NULL AND stripe_payment_id NOT LIKE $2
      GROUP BY donor_id`, [orgId, likePrefix(SEED_STRIPE_PREFIX)])).map(r => [r.donor_id, r.pi]));
  for (const d of donors) {
    const why = realReason(d, users) || (charged.has(d.id) ? `a real Stripe charge (${charged.get(d.id)})` : null);
    if (why) out.push({ table: "donors", id: d.id, name: d.name, email: d.email, reason: why });
  }
  const guests = await q(`SELECT id, name, email FROM event_attendees WHERE org_id=$1`, [orgId]).catch(() => []);
  for (const g of guests) {
    const why = realReason(g, users);
    if (why) out.push({ table: "event_attendees", id: g.id, name: g.name, email: g.email, reason: why });
  }
  const seeded = new Set(seededUserEmails.map(e => normEmail(e)));
  const own = await q(`SELECT id, name, email FROM users WHERE org_id=$1`, [orgId]);
  for (const u of own) {
    if (seeded.has(normEmail(u.email))) continue;
    // Matched against every OTHER users row and the fixed list; a user always
    // matches itself, so it is left out of its own comparison.
    const why = realReason(u, users.filter(x => normEmail(x.email) !== normEmail(u.email)))
      || "a user in the demo org the seed did not create";
    out.push({ table: "users", id: u.id, name: u.name, email: u.email, reason: why });
  }
  return out;
}

module.exports = { realReason, realStripeCharge, findRealPeople, FOUNDER_NAMES, FOUNDER_EMAILS, SEED_STRIPE_PREFIX };
