// server/onboard/setupData.js · ONBOARD-5. WHAT EACH SETUP PAGE ALREADY KNOWS.
//
// Each page of the setup (SetupPage.jsx) opens prefilled from what Steward has.
// The reads here are the ones no existing route gives in one piece: funds and
// campaigns with their gift counts and duplicate names, her yearly events, how
// she talks (the Major cut, her word for donors, the couple addressee), where
// gifts come in with "Connected as …", QuickBooks and the mailbox's account,
// who owns her donors, and the last page's totals and first three calls.
// Every write the pages make goes through the route that already owns it
// (branding, vocabulary, funds, campaign merge, invites); the few that have no
// owner are in setupPageRoutes.js.
"use strict";
const HG = require("../../shared/numbers/householdGiving");
const { GIFT, MONEY } = require("../../shared/numbers/money");
const { KEY_SQL, EMAIL_ONLY } = require("../outreach/campaignMerge");

const MISSING = new Set(["42P01", "42703"]);
const safe = p => p.catch(e => { if (e && MISSING.has(e.code)) return []; throw e; });
const MAJOR_CHOICES = [100000, 500000, 1000000];      // $1,000+ · $5,000+ · $10,000+
const WORD_CHOICES = [["donor", "donors"], ["partner", "partners"], ["member", "members"], ["friend", "friends"]];

// Make it yours and Receipts and letters: what the org row already says.
async function org(query, orgId) {
  const [o] = await query(`SELECT name, website, logo_data, brand_accent, brand_primary, vocabulary_json, vocabulary_set_at, legal_name, ein,
                                  receipt_address, receipt_signature_name, receipt_signature_title, receipt_signature_image IS NOT NULL AS has_signature
                             FROM orgs WHERE id = ?`, [orgId]);
  let v = o.vocabulary_json;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  const month = v && Number(v.fiscal_year_start_month) >= 1 ? Number(v.fiscal_year_start_month) : o.vocabulary_set_at ? 7 : null;
  const logo = String(o.logo_data || "");
  return { id: orgId, name: o.name, website: o.website || null,
    logo: logo.startsWith("data:image/") && logo.length < 800000 ? logo : null, hasLogo: !!logo,
    color: o.brand_accent || o.brand_primary || null, fiscalMonth: month,
    legalName: o.legal_name || "", ein: o.ein || "", receiptAddress: o.receipt_address || "",
    signerName: o.receipt_signature_name || "", signerTitle: o.receipt_signature_title || "", hasSignature: !!o.has_signature };
}

// Funds, campaigns and events: what the import found, each with its gift count.
async function funds(query, orgId) {
  const [fundRows, campRows, events] = await Promise.all([
    query(`SELECT f.id, f.name, COALESCE(f.description, '') AS description, COALESCE(f.restricted, false) AS restricted,
                  (SELECT COUNT(*)::int FROM gifts g WHERE g.org_id = f.org_id AND g.fund_id = f.id AND ${GIFT("g")}) AS gifts
             FROM fin_funds f WHERE f.org_id = ? ORDER BY gifts DESC, f.name`, [orgId]),
    query(`SELECT c.id, c.name, c.created_at, ${KEY_SQL("c.name")} AS k,
                  (SELECT COUNT(*)::int FROM gifts g WHERE g.org_id = c.org_id AND g.campaign_id = c.id AND ${GIFT("g")}) AS gifts
             FROM campaigns c WHERE c.org_id = ? AND c.retired_at IS NULL AND NOT ${EMAIL_ONLY("c")}
            ORDER BY c.created_at, c.id`, [orgId]),
    safe(query(`SELECT id, name, month, letters_month FROM org_yearly_events WHERE org_id = ? AND deleted_at IS NULL ORDER BY month, name`, [orgId])),
  ]);
  // Two campaigns with the same name: the one with the most gifts is kept, the other offered to merge into it.
  const byKey = new Map();
  for (const c of campRows) (byKey.get(c.k) || byKey.set(c.k, []).get(c.k)).push(c);
  const keepOf = new Map();
  for (const list of byKey.values()) if (list.length > 1) {
    const keep = [...list].sort((a, b) => b.gifts - a.gifts || new Date(a.created_at) - new Date(b.created_at))[0];
    for (const c of list) if (c.id !== keep.id) keepOf.set(c.id, keep.id);
  }
  return {
    funds: fundRows.map(f => ({ id: f.id, name: f.name, description: f.description, restricted: !!f.restricted, gifts: Number(f.gifts) })),
    campaigns: campRows.map(c => ({ id: c.id, name: c.name, gifts: Number(c.gifts), duplicateOf: keepOf.get(c.id) || null })),
    events: events.map(e => ({ id: e.id, name: e.name, month: Number(e.month), lettersMonth: e.letters_month == null ? null : Number(e.letters_month) })),
  };
}

// How you talk: the Major cut, her word for donors, how a couple is addressed.
async function voice(query, orgId) {
  const [o] = await query(`SELECT giving_level_major_cents, giving_level_mid_cents, vocabulary_json, addressee_pattern FROM orgs WHERE id = ?`, [orgId]);
  let v = o.vocabulary_json;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  v = v || {};
  // A real couple of hers for the sample sentence, when she has one; else the mockup's.
  const [couple] = await safe(query(`SELECT array_agg(d.name ORDER BY (d.id = h.primary_donor_id) DESC, d.id) AS names FROM households h
      JOIN donors d ON d.household_id = h.id AND d.org_id = h.org_id AND d.deleted_at IS NULL
     WHERE h.org_id = ? GROUP BY h.id HAVING COUNT(*) = 2 ORDER BY h.id LIMIT 1`, [orgId]));
  const names = couple && Array.isArray(couple.names) ? couple.names : ["Debbie Vogel", "Jeff Vogel"];
  const DS = require("../../donorStatus");
  const cuts = await DS.cutsFor(orgId);
  return {
    majorCents: Number(cuts.majorCents) || Number(o.giving_level_major_cents) || null, midCents: Number(cuts.midCents) || Number(o.giving_level_mid_cents) || null,
    majorChoices: MAJOR_CHOICES,
    giverSingular: v.giver_singular || "donor", giverPlural: v.giver_plural || "donors", wordChoices: WORD_CHOICES,
    addresseePattern: o.addressee_pattern || null,
    couple: names,
    addresseeChoices: HG.ADDRESSEE_PATTERNS.map(p => ({ key: p.key, pattern: p.pattern, says: HG.addresseeOf(names, p.pattern) })),
  };
}

// The cut is cents. Mid has to stay under Major (profileStatus's rule); when a
// low Major would cross it, Mid comes down to a fifth of Major, said in the reply.
function levelsFor(majorCents, midCents) {
  const major = Math.round(Number(majorCents));
  if (!Number.isFinite(major) || major < 100) return { error: "A major gift is a dollar amount of at least $1." };
  if (major > 100000000000) return { error: "That is more than Steward can count as one gift." };
  let mid = Number(midCents) || 100000;
  let moved = false;
  if (mid >= major) { mid = Math.max(1, Math.round(major / 5)); moved = true; }
  return { major, mid, moved };
}

// The donor word in singular and plural: letters, spaces and hyphens, 2 to 30 characters.
function wordFor(singular, plural) {
  const clean = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
  const one = clean(singular).toLowerCase(), many = clean(plural).toLowerCase();
  const okWord = w => /^[a-z][a-z' -]{1,29}$/.test(w);
  if (!okWord(one)) return { error: "Your word for one person is 2 to 30 letters, like \"partner\"." };
  if (!okWord(many)) return { error: "Your word for several people is 2 to 30 letters, like \"partners\"." };
  return { singular: one, plural: many };
}

// Where gifts come in: each source with "Connected as …" once linked.
async function gifts(query, orgId) {
  const [rows, [o]] = await Promise.all([
    safe(query(`SELECT provider, display_name, status, created_at FROM giving_sources WHERE org_id = ? AND status <> 'disconnected' ORDER BY created_at`, [orgId])),
    query(`SELECT stripe_connected, stripe_account_id, other_giving_sources FROM orgs WHERE id = ?`, [orgId]),
  ]);
  const connected = {};
  for (const r of rows) if (!connected[r.provider]) connected[r.provider] = { as: r.display_name, status: r.status, at: r.created_at };
  return { connected, stripeConnect: !!(o && (o.stripe_connected === true || o.stripe_connected === 1)) };
}

// QuickBooks and email: the account each is linked as.
async function connections(query, orgId, userId) {
  const [[qb], mine, anyone, [o]] = await Promise.all([
    safe(query(`SELECT realm_id, connected_by_name, created_at FROM bookkeeping_connections WHERE org_id = ? AND vendor = 'quickbooks' AND status = 'active' LIMIT 1`, [orgId])),
    safe(query(`SELECT provider, address FROM mailbox_connections WHERE org_id = ? AND user_id = ? AND status <> 'disconnected' ORDER BY provider`, [orgId, userId])),
    safe(query(`SELECT COUNT(*)::int AS n FROM mailbox_connections WHERE org_id = ? AND status <> 'disconnected'`, [orgId])),
    query(`SELECT qbo_sync_enabled FROM orgs WHERE id = ?`, [orgId]),
  ]);
  return {
    quickbooks: { enabled: !!(o && o.qbo_sync_enabled === true),
      connected: qb ? { as: qb.connected_by_name ? `company ${qb.realm_id || ""} (linked by ${qb.connected_by_name})`.replace("company  ", "your company ") : "your company" } : null },
    email: { mine: mine.map(m => ({ provider: m.provider, as: m.address })), anyone: Number((anyone[0] || {}).n) || 0 },
  };
}

// Invite your team: who is here, and how many donors have no owner yet.
async function team(query, orgId) {
  const [people, invites, [own]] = await Promise.all([
    query(`SELECT id, name, email, role FROM users WHERE org_id = ? AND deactivated_at IS NULL AND COALESCE(is_super_admin, false) = false ORDER BY created_at`, [orgId]),
    query(`SELECT id, email, role FROM invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > NOW() ORDER BY created_at`, [orgId]),
    query(`SELECT COUNT(*) FILTER (WHERE assigned_to IS NULL AND pending_assignee_invite_id IS NULL)::int AS unowned, COUNT(*)::int AS people
             FROM donors WHERE org_id = ? AND deleted_at IS NULL AND COALESCE(is_sample, false) = false`, [orgId]),
  ]);
  const owns = await query(`SELECT assigned_to AS id, COUNT(*)::int AS n FROM donors WHERE org_id = ? AND deleted_at IS NULL AND assigned_to IS NOT NULL GROUP BY 1`, [orgId]);
  const ownMap = new Map(owns.map(r => [r.id, Number(r.n)]));
  return { people: people.map(p => ({ id: p.id, name: p.name, email: p.email, role: p.role, owns: ownMap.get(p.id) || 0 })),
    invites: invites.map(i => ({ id: i.id, email: i.email, role: i.role })), unowned: Number(own.unowned), peopleIn: Number(own.people) };
}

// Owners: everyone without one goes to `toUserId`, or the donors at or above the
// Major cut go to someone. Stamped like /donors/bulk-assign (assigned_by, assigned_at).
async function assignOwners({ query, run }, orgId, rule, who) {
  const to = String(rule.to || "");
  const which = rule.which === "major" ? "major" : "unowned";
  let toName = null, pendingInvite = null;
  if (to.startsWith("invite:")) {
    const [inv] = await query(`SELECT id, email FROM invites WHERE id = ? AND org_id = ? AND accepted_at IS NULL AND expires_at > NOW()`, [to.slice(7), orgId]);
    if (!inv) return { error: "That invitation is not pending in this organization." };
    pendingInvite = inv;
  } else {
    const [u] = await query(`SELECT id, name FROM users WHERE id = ? AND org_id = ? AND deactivated_at IS NULL`, [to, orgId]);
    if (!u) return { error: "That person is not in this organization." };
    toName = u.name;
  }
  let where = `org_id = ? AND deleted_at IS NULL AND COALESCE(is_sample, false) = false`;
  const args = [orgId];
  if (which === "unowned") where += ` AND assigned_to IS NULL AND pending_assignee_invite_id IS NULL`;
  else {
    const DS = require("../../donorStatus");
    const cuts = await DS.cutsFor(orgId);
    // The Major tag's own condition, the one the Donors list's Giving level: Major filter uses.
    const tag = DS.tagCondition("major", orgId, await DS.todayFor(orgId), cuts);
    where += ` AND ${tag.sql}`;
    args.push(...tag.args);
  }
  const r = pendingInvite
    ? await run(`UPDATE donors SET assigned_to = NULL, assigned_to_name = NULL, pending_assignee_invite_id = ?, pending_assignee_name = ?, updated_at = NOW() WHERE ${where}`,
      [pendingInvite.id, String(pendingInvite.email).split("@")[0], ...args])
    : await run(`UPDATE donors SET assigned_to = ?, assigned_to_name = ?, assigned_by = ?, assigned_by_name = ?, assigned_at = NOW(),
                        pending_assignee_invite_id = NULL, pending_assignee_name = NULL, updated_at = NOW() WHERE ${where}`,
      [to, toName, who.id, who.name, ...args]);
  return { updated: r.changes || 0 };
}

// The last page: her totals, and the first three people worth a call, with the reason.
async function call(query, orgId, today, insightsFor) {
  const PC = require("../donors/peopleCounts");
  const FS = require("./firstSession");
  const [[t], counts, apps] = await Promise.all([
    query(`SELECT COUNT(*)::int AS people, COALESCE(SUM(COALESCE(total_giving, 0)), 0)::numeric AS lifetime
             FROM donors WHERE org_id = ? AND deleted_at IS NULL AND COALESCE(is_sample, false) = false`, [orgId]),
    PC.peopleCounts(orgId).catch(() => ({ lapsed: null })),
    Promise.all([
      safe(query(`SELECT COUNT(DISTINCT provider)::int AS n FROM giving_sources WHERE org_id = ? AND status = 'active'`, [orgId])),
      safe(query(`SELECT COUNT(*)::int AS n FROM bookkeeping_connections WHERE org_id = ? AND status = 'active'`, [orgId])),
      safe(query(`SELECT COUNT(DISTINCT provider)::int AS n FROM mailbox_connections WHERE org_id = ? AND status <> 'disconnected'`, [orgId])),
      query(`SELECT CASE WHEN stripe_connected IN (true) THEN 1 ELSE 0 END AS n FROM orgs WHERE id = ?`, [orgId]).catch(() => [{ n: 0 }]),
    ]),
  ]);
  const appsN = apps.reduce((a, r) => a + (Number((r[0] || {}).n) || 0), 0);
  let people = [], preparing = false;
  try {
    const got = await insightsFor(orgId, today);
    preparing = !!(got.preparing || !got.result || !got.result.deck);
    people = preparing ? [] : FS.movesInHomeOrder(got.result.deck, 3).map(m => ({ id: m.lead, name: m.name, why: m.why || null, what: m.what || null }));
  } catch { preparing = true; }
  return {
    totals: { people: Number(t.people), lifetimeCents: Math.round(Number(t.lifetime) * 100), lapsed: counts && counts.lapsed != null ? Number(counts.lapsed) : null, apps: appsN },
    sentences: {
      people: "Everyone in Steward, not counting sample data.",
      lifetime: "Everyone's lifetime giving added: their imported total plus every gift since, refunds taken off.",
      lapsed: "Gave before, but nothing in the last 12 months and no pledge holding them.",
      apps: "Giving sources, QuickBooks, mailboxes and Stripe connected now.",
    },
    // Each figure opens its rows (figureSources.js): setupSources.js, and the Lapsed tag's own.
    sources: { people: { key: "setup-everyone", params: {} }, lifetime: { key: "setup-everyone", params: { measure: "sum" } },
      lapsed: { key: "donors-by-status", params: { tag: "lapsed", today } } },
    people, preparing,
  };
}

// A real gift of hers for the sample receipt and letter: her latest, with its donor.
async function sampleGift(query, orgId) {
  const [g] = await query(`SELECT g.id, g.amount, g.date, d.name AS donor FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                            WHERE g.org_id = ? AND ${MONEY("g")} AND d.deleted_at IS NULL AND COALESCE(g.is_sample, false) = false
                            ORDER BY g.date DESC NULLS LAST, g.id DESC LIMIT 1`, [orgId]);
  return g ? { id: g.id, amountCents: Math.round(Number(g.amount) * 100), date: g.date, donor: g.donor } : null;
}

module.exports = { org, funds, voice, levelsFor, wordFor, gifts, connections, team, assignOwners, call, sampleGift, MAJOR_CHOICES };
