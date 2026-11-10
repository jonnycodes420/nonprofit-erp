// server/onboard/signals.js · ONBOARD-2. THE SIGNALS EACH STAGE READS.
//
// One query per fact across every org asked for (no query per org), the same
// shape as /ops's Journey (server/admin/opsJourney.js). Timestamps, counts and
// the org's own names (the signer, the champion); never a donor's name or a
// gift amount. A table or column another build adds (ONBOARD-1's start links,
// signatures and staged imports) may not exist yet: that fact reads as "not
// reached", never as an error.
"use strict";

const ORG_KIND = require("../../orgKind");

const MISSING = new Set(["42P01", "42703"]);   // undefined table, undefined column
const safe = p => p.catch(e => { if (e && MISSING.has(e.code)) return []; throw e; });
const by = rows => new Map(rows.map(r => [r.org_id, r]));
const list = raw => { if (Array.isArray(raw)) return raw; try { const p = JSON.parse(raw || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } };
const usd = c => `$${(Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PLURAL = (n, w) => `${Number(n).toLocaleString("en-US")} ${w}${Number(n) === 1 ? "" : "s"}`;

// A person at the org who is not Steward: not a super-admin.
const PERSON = `COALESCE(u.is_super_admin, false) = false`;

async function readFacts(query, orgIds) {
  if (!orgIds.length) return {};
  const ids = [orgIds];
  const [orgs, links, sigs, staged, accepted, pages, logos, sources, books, setup, signins, stored, logs, gifts, paid] = await Promise.all([
    query(`SELECT id, name, timezone, created_at, paper_done_at, data_in_at, stripe_account_id,
                  (COALESCE(logo_data, '') <> '') AS has_logo, subscription_status, trial_ends_at, billing_mrr_cents,
                  custom_price_cents, stripe_subscription_id, other_giving_sources, billing_card_last4,
                  (billing_card_last4 IS NOT NULL OR billing_card_saved_at IS NOT NULL) AS card_on_file
             FROM orgs WHERE id = ANY(?)`, ids),
    safe(query(`SELECT DISTINCT ON (org_id) org_id, id, status, contact_name, contact_email, price_cents, first_charge_at, expires_at, signed_at, created_at
                  FROM start_links WHERE org_id = ANY(?) ORDER BY org_id, created_at DESC`, ids)),
    safe(query(`SELECT DISTINCT ON (org_id) org_id, signer_name, signer_title, signer_email, signed_at
                  FROM start_signatures WHERE org_id = ANY(?) ORDER BY org_id, signed_at DESC`, ids)),
    safe(query(`SELECT org_id, MIN(staged_at) AS t FROM imports WHERE org_id = ANY(?) AND staged_at IS NOT NULL AND accepted_at IS NULL AND reversed_at IS NULL GROUP BY org_id`, ids)),
    safe(query(`SELECT DISTINCT ON (org_id) org_id, donors_created, gifts_created, dollars_in, dollars_created, rows_set_aside
                  FROM imports WHERE org_id = ANY(?) AND accepted_at IS NOT NULL AND reversed_at IS NULL ORDER BY org_id, accepted_at`, ids)),
    query(`SELECT org_id, MIN(COALESCE(published_at, created_at)) AS t FROM giving_pages WHERE org_id = ANY(?) AND status = 'active' GROUP BY org_id`, ids),
    safe(query(`SELECT org_id FROM portal_settings WHERE org_id = ANY(?) AND COALESCE(logo_url, '') <> ''`, ids)),
    safe(query(`SELECT org_id, provider, MIN(created_at) AS t FROM giving_sources WHERE org_id = ANY(?) AND status = 'active' GROUP BY org_id, provider`, ids)),
    safe(query(`SELECT org_id, MIN(created_at) AS t FROM bookkeeping_connections WHERE org_id = ANY(?) AND status = 'active' GROUP BY org_id`, ids)),
    safe(query(`SELECT DISTINCT ON (org_id) org_id, tools FROM setup_runs WHERE org_id = ANY(?) ORDER BY org_id, created_at DESC`, ids)),
    query(`SELECT s.org_id, s.user_id, u.email, u.name, MIN(s.created_at) AS t FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id
            WHERE s.org_id = ANY(?) AND ${PERSON} GROUP BY s.org_id, s.user_id, u.email, u.name`, ids),
    safe(query(`SELECT org_id, verbal_yes_on, waiting_on, stripe_ok_at, home_opened_at, home_opened_by FROM org_onboarding WHERE org_id = ANY(?)`, ids)),
    query(`SELECT DISTINCT ON (i.org_id) i.org_id, i.created_at AS t, i.logged_by_name FROM interactions i JOIN users u ON u.id = i.created_by AND u.org_id = i.org_id
            WHERE i.org_id = ANY(?) AND i.metadata->>'from_move' = 'true' AND ${PERSON} ORDER BY i.org_id, i.created_at`, ids),
    // A gift recorded or synced through Steward: not an import, not sample data.
    query(`SELECT org_id, MIN(created_at) AS t FROM gifts
            WHERE org_id = ANY(?) AND import_id IS NULL AND COALESCE(is_sample, false) = false AND amount > 0 GROUP BY org_id`, ids),
    query(`SELECT org_id, MIN(paid_at) AS t FROM platform_payments WHERE org_id = ANY(?) AND amount_paid_cents > 0 GROUP BY org_id`, ids),
  ]);
  const m = { links: by(links), sigs: by(sigs), staged: by(staged), accepted: by(accepted), pages: by(pages), books: by(books),
    setup: by(setup), stored: by(stored), logs: by(logs), gifts: by(gifts), paid: by(paid) };
  const logo = new Set(logos.map(r => r.org_id));
  const conn = new Map();
  for (const r of sources) { if (!conn.has(r.org_id)) conn.set(r.org_id, {}); conn.get(r.org_id)[r.provider] = r.t; }
  const sess = new Map();
  for (const r of signins) { if (!sess.has(r.org_id)) sess.set(r.org_id, []); sess.get(r.org_id).push(r); }

  const out = {};
  for (const o of orgs) {
    const link = m.links.get(o.id) || null, sig = m.sigs.get(o.id) || null, st = m.stored.get(o.id) || {};
    const connected = { ...(conn.get(o.id) || {}) };
    if (m.books.get(o.id)) connected.quickbooks = m.books.get(o.id).t;
    // The champion: the person the start link was raised for, else whoever signed, else the first to sign in.
    const people = (sess.get(o.id) || []).sort((a, b) => new Date(a.t) - new Date(b.t));
    const want = [link && link.contact_email, sig && sig.signer_email].filter(Boolean).map(e => e.toLowerCase());
    const champ = people.find(p => want.includes(String(p.email || "").toLowerCase())) || (want.length ? null : people[0]) || null;
    const acc = m.accepted.get(o.id);
    const log = m.logs.get(o.id);
    const firstChargeAt = o.subscription_status === "trialing" && o.trial_ends_at ? o.trial_ends_at : (link && link.first_charge_at) || null;
    out[o.id] = {
      id: o.id, name: o.name, tz: o.timezone || "America/New_York", createdAt: o.created_at,
      paperDoneAt: o.paper_done_at, dataInAt: o.data_in_at,
      signature: sig ? { name: sig.signer_name, title: sig.signer_title, at: sig.signed_at } : null,
      cardOnFile: !!o.card_on_file, cardLast4: o.billing_card_last4 || null,
      startLink: link ? { status: link.status, contact: link.contact_name, createdAt: link.created_at, expiresAt: link.expires_at, signedAt: link.signed_at } : null,
      stagedAt: (m.staged.get(o.id) || {}).t || null,
      importFooting: acc ? `${PLURAL(acc.donors_created || 0, "person").replace("persons", "people")}, ${PLURAL(acc.gifts_created || 0, "gift")}, ${usd(Math.round(Number(acc.dollars_created || 0) * 100))} of ${usd(Math.round(Number(acc.dollars_in || 0) * 100))} in the file${acc.rows_set_aside ? `, ${PLURAL(acc.rows_set_aside, "row")} set aside` : ""}` : null,
      stripeAccount: !!o.stripe_account_id, stripeOkAt: o.stripe_account_id ? st.stripe_ok_at || null : null,
      pageLiveAt: (m.pages.get(o.id) || {}).t || null, hasLogo: !!o.has_logo || logo.has(o.id),
      namedSources: list((m.setup.get(o.id) || {}).tools).map(String),
      statementSources: list(o.other_giving_sources).filter(v => typeof v === "string"),
      connected,
      kickoff: {
        who: champ ? champ.name || champ.email : (link && link.contact_name) || null,
        signedInAt: champ ? champ.t : null,
        homeAt: st.home_opened_at || null,
        loggedAt: log ? log.t : null, loggedOn: log ? log.logged_by_name : null,
      },
      firstGiftAt: (m.gifts.get(o.id) || {}).t || null,
      firstPaidAt: (m.paid.get(o.id) || {}).t || null,
      subscriptionStatus: o.subscription_status || null,
      paymentFailed: o.subscription_status === "past_due" || o.subscription_status === "unpaid",
      firstChargeOn: firstChargeAt ? require("./stages").civil(firstChargeAt, o.timezone || "America/New_York") : null,   // the org's own day
      // MRR now: what the live subscription bills (orgKind's one rule). At the
      // first charge date: the subscription's amount, else the agreed price.
      mrrNowCents: o.subscription_status === "active" ? ORG_KIND.orgMrrCents(o, "customer") : 0,
      mrrAgreedCents: Number(o.billing_mrr_cents) > 0 ? Number(o.billing_mrr_cents)
        : o.custom_price_cents != null ? Number(o.custom_price_cents) : link ? Number(link.price_cents || 0) : 0,
      manual: { verbalYesOn: st.verbal_yes_on ? new Date(st.verbal_yes_on).toISOString().slice(0, 10) : null, waitingOn: st.waiting_on || null },
    };
  }
  return out;
}

// The orgs the board shows: every live customer org, and any org already in
// onboarding (a start link, a stamped paper, or a verbal yes Jonathan entered).
async function boardOrgIds(query) {
  const custs = await require("../admin/opsSources").customerOrgs(query);
  const [linked, stamped, yes] = await Promise.all([
    safe(query(`SELECT DISTINCT org_id FROM start_links`, [])),
    query(`SELECT id AS org_id FROM orgs WHERE paper_done_at IS NOT NULL AND archived_at IS NULL`, []),
    safe(query(`SELECT org_id FROM org_onboarding WHERE verbal_yes_on IS NOT NULL`, [])),
  ]);
  const extra = [...linked, ...stamped, ...yes].map(r => r.org_id);
  const live = await query(`SELECT id FROM orgs WHERE id = ANY(?) AND archived_at IS NULL AND COALESCE(is_demo_org, false) = false`, [[...new Set(extra)]]);
  return [...new Set([...custs.map(o => o.id), ...live.map(r => r.id)])];
}

module.exports = { readFacts, boardOrgIds };
