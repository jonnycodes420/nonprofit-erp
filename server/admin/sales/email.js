// server/admin/sales/email.js · SALES-1 Part B. EMAIL ON THE SALES RECORDS.
//
// Jonathan connects his own mailbox (Microsoft 365, or Gmail) under Sales
// settings. The read is the same engine the customer mailboxes use
// (server/boot/helpers-7.js fetchMailboxMessages: the provider is asked ONLY
// for mail to or from the addresses it is given), owned by the sales scope:
// the permission is sealed with aad "sales", in sales_mailboxes, never in any
// org's mailbox_connections.
//
// keeps(message, scope) is the rule, and it runs again on everything the
// provider hands back: a message is stored only when someone on it (other than
// the mailbox itself) is a sales contact's address, or at a domain Jonathan
// marked as a prospect domain. Everything else is never stored.
// THE PLANTED DEFECT (SALES1_PLANT=storeall, tests only): keeps() keeps every
// message. tests/sales1-partners.test.js §11 goes red.
//
// Read-only: nothing is ever sent from here.
"use strict";
const { newId } = require("../../shared/newId");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES1_PLANT || "" : "";
const DEFAULT_NO_REPLY_DAYS = 5;
const addr = v => { const m = String(v || "").match(/<([^>]+)>/); return (m ? m[1] : String(v || "")).trim().toLowerCase(); };
const domainOfAddr = a => (a.includes("@") ? a.split("@").pop() : null);

// Who on the message (not the mailbox itself) is a sales contact or at a prospect domain.
function keeps(msg, { addresses, domains, own }) {
  const people = [msg.from, ...(msg.to || []), ...(msg.cc || [])].map(addr).filter(a => a && a !== own);
  const matched = people.filter(a => addresses.has(a) || (domains.has(domainOfAddr(a))));
  if (PLANT === "storeall") return { people, matched: matched.length ? matched : people };
  return matched.length ? { people, matched } : null;
}

async function scopeOf(query, own) {
  const [contacts, settings] = await Promise.all([
    query(`SELECT id, emails FROM sales_contacts WHERE deleted_at IS NULL`),
    query(`SELECT key, value FROM sales_settings WHERE key = 'prospect_domains'`),
  ]);
  const byAddr = new Map();
  for (const c of contacts) for (const e of c.emails || []) { const a = String(e).toLowerCase(); if (!byAddr.has(a)) byAddr.set(a, []); byAddr.get(a).push(c.id); }
  const domains = new Set(((settings[0] && settings[0].value) || []).map(d => String(d).toLowerCase()));
  return { addresses: new Set(byAddr.keys()), byAddr, domains, own: String(own || "").toLowerCase() };
}

async function sealBody(text) {
  const { sealBag } = await import("../../../shared/secretBox.js");
  return sealBag({ text: String(text || "").slice(0, 100000) }, { aad: "sales" });
}
async function openBody(sealed) {
  if (!sealed) return "";
  const { openBag } = await import("../../../shared/secretBox.js");
  try { return openBag(sealed, { aad: "sales" }).text || ""; } catch { return ""; }
}

// Store what keeps() keeps, and link each to every matching contact, their
// organizations and their open deals (and to orgs at a matching prospect domain).
async function capture(ctx, mailbox, messages, who = { id: "system:sales-mail", name: "Steward (sales mailbox read)" }) {
  const scope = await scopeOf(ctx.query, mailbox.address);
  let stored = 0, skipped = 0;
  for (const m of messages || []) {
    const k = keeps(m, scope);
    if (!k) { skipped++; continue; }
    const out = m.sent === true || addr(m.from) === scope.own;
    const at = m.at ? new Date(m.at) : new Date(`${String(m.date || "").slice(0, 10)}T12:00:00Z`);
    const id = newId("sem");
    const ins = await ctx.query(`INSERT INTO sales_emails (id, mailbox_id, provider_message_id, thread_id, subject, from_addr, to_addrs, cc_addrs, sent_at, direction, body_sealed, created_by, created_by_name)
                                 VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?) ON CONFLICT (mailbox_id, provider_message_id) DO NOTHING RETURNING id`,
      [id, mailbox.id, String(m.id), m.threadKey || null, String(m.subject || "").slice(0, 500), addr(m.from), JSON.stringify((m.to || []).map(addr)), JSON.stringify((m.cc || []).map(addr)),
        Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(), out ? "out" : "in", await sealBody(m.bodyText), who.id, who.name]);
    if (!ins.length) continue;   // already stored
    stored++;
    const contactIds = [...new Set(k.matched.flatMap(a => scope.byAddr.get(a) || []))];
    const domainHits = [...new Set(k.matched.map(domainOfAddr).filter(d => d && scope.domains.has(d)))];
    const recs = await linkTargets(ctx.query, contactIds, domainHits);
    for (const r of recs) await ctx.run(`INSERT INTO sales_email_links (email_id, record_type, record_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [id, r.type, r.id, who.id, who.name]);
    // SALES-2 item 9: a reply from them ends their cadences and closes the remaining steps.
    if (!out && contactIds.length) await require("./cadences").endFor(ctx, contactIds, "reply", who);
  }
  return { stored, skipped };
}

// The contacts themselves, their organizations, and their open deals; orgs at a matching domain.
async function linkTargets(query, contactIds, domains) {
  const out = contactIds.map(id => ({ type: "contact", id }));
  if (contactIds.length) {
    const orgs = await query(`SELECT DISTINCT l.b_id AS id FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id AND o.deleted_at IS NULL
                               WHERE l.a_type = 'contact' AND l.a_id = ANY(?) AND l.b_type = 'org'`, [contactIds]);
    const deals = await query(`SELECT DISTINCT d.id FROM sales_links l JOIN sales_deals d ON d.id = l.a_id AND d.deleted_at IS NULL
                                 LEFT JOIN sales_stages s ON s.id = d.stage_id
                                WHERE l.a_type = 'deal' AND l.b_type = 'contact' AND l.b_id = ANY(?) AND COALESCE(s.kind, 'open') = 'open'`, [contactIds]);
    out.push(...orgs.map(o => ({ type: "org", id: o.id })), ...deals.map(d => ({ type: "deal", id: d.id })));
  }
  if (domains.length) {
    const orgs = await query(`SELECT id FROM sales_orgs WHERE deleted_at IS NULL AND domain = ANY(?)`, [domains]);
    for (const o of orgs) if (!out.some(r => r.type === "org" && r.id === o.id)) out.push({ type: "org", id: o.id });
  }
  return out;
}

// A record's email, newest first; the body only when asked for one message.
async function forRecord(query, type, id) {
  return query(`SELECT e.id, e.subject, e.from_addr, e.to_addrs, e.sent_at, e.direction FROM sales_emails e JOIN sales_email_links l ON l.email_id = e.id
                 WHERE l.record_type = ? AND l.record_id = ? ORDER BY e.sent_at DESC LIMIT 200`, [type, id]);
}
async function body(query, emailId) {
  const [e] = await query(`SELECT id, subject, from_addr, to_addrs, cc_addrs, sent_at, direction, body_sealed FROM sales_emails WHERE id = ?`, [emailId]);
  if (!e) return null;
  const { body_sealed, ...rest } = e;
  return { ...rest, body: await openBody(body_sealed) };
}

// "Last emailed" and "No reply in N days" for every contact and deal, in one statement each.
async function replyFacts(query, now = Date.now(), days = DEFAULT_NO_REPLY_DAYS) {
  const rows = await query(`SELECT l.record_type, l.record_id,
                                   MAX(e.sent_at) FILTER (WHERE e.direction = 'out') AS last_out,
                                   MAX(e.sent_at) FILTER (WHERE e.direction = 'in') AS last_in,
                                   MAX(e.sent_at) AS last_any
                              FROM sales_email_links l JOIN sales_emails e ON e.id = l.email_id
                             WHERE l.record_type IN ('contact', 'deal') GROUP BY l.record_type, l.record_id`);
  const out = {};
  for (const r of rows) {
    const lastOut = r.last_out ? new Date(r.last_out).getTime() : null, lastIn = r.last_in ? new Date(r.last_in).getTime() : null;
    const waiting = lastOut != null && (lastIn == null || lastIn < lastOut);
    const sinceDays = waiting ? Math.floor((now - lastOut) / 86400000) : null;
    out[`${r.record_type}:${r.record_id}`] = { lastEmailedAt: r.last_out ? new Date(r.last_out).toISOString() : null,
      lastEmailAt: r.last_any ? new Date(r.last_any).toISOString() : null, noReplyDays: waiting && sinceDays >= days ? sinceDays : null };
  }
  return out;
}

// ── The mailbox: its own token refresh (sealed with aad "sales"), the read ──
async function tokenFor(ctx, mb) {
  const { openBag, sealBag } = await import("../../../shared/secretBox.js");
  const O = await import("../../../shared/oauth.js");
  const { oauthEnv } = require("../../shared/oauthFlow");
  try {
    const bag = openBag(mb.credentials_sealed, { aad: "sales" });
    const stale = O.needsRefresh(mb.token_expires_at ? new Date(mb.token_expires_at).toISOString() : null, new Date().toISOString());
    if (!stale) return bag.accessToken;
    if (!bag.refreshToken) throw new Error("no refresh token");
    const { values } = oauthEnv(mb.provider, O.ENV_VARS);
    const spec = O.tokenRequest(mb.provider, { refreshToken: bag.refreshToken, clientId: values.clientId, clientSecret: values.clientSecret });
    const r = await fetch(spec.url, { method: "POST", headers: { ...spec.headers, ...(spec.basic ? { Authorization: "Basic " + Buffer.from(spec.basic).toString("base64") } : {}) }, body: spec.body });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b?.error || `token endpoint ${r.status}`);
    const fresh = O.readTokens(b);
    if (!fresh) throw new Error("no access token");
    await ctx.run(`UPDATE sales_mailboxes SET credentials_sealed = ?, token_expires_at = ?, updated_at = NOW() WHERE id = ?`,
      [sealBag({ accessToken: fresh.accessToken, refreshToken: fresh.refreshToken || bag.refreshToken, scope: fresh.scope || null }, { aad: "sales" }),
        fresh.expiresInSeconds ? new Date(Date.now() + fresh.expiresInSeconds * 1000).toISOString() : null, mb.id]);
    return fresh.accessToken;
  } catch (e) {
    console.error(`[sales-mail] ${mb.provider} token:`, e.message);
    await ctx.run(`UPDATE sales_mailboxes SET status = 'error', last_error = ?, last_error_at = NOW(), updated_at = NOW() WHERE id = ?`,
      ["The mailbox needs connecting again: its permission was withdrawn or expired.", mb.id]).catch(() => {});
    return null;
  }
}

// Read one mailbox now: ask the provider only about the sales addresses (and prospect domains), keep what matches.
async function readNow(ctx, mb, { fetcher = null } = {}) {
  const scope = await scopeOf(ctx.query, mb.address);
  const terms = [...scope.addresses, ...scope.domains];
  if (!terms.length) return { stored: 0, skipped: 0, said: "No sales contact has an email address yet, so there is nothing to look for." };
  const token = await tokenFor(ctx, mb);
  if (!token) return { error: "reconnect", message: "The mailbox needs connecting again: its permission was withdrawn or expired." };
  const fetchMessages = fetcher || require("../../boot/share").ctx.fetchMailboxMessages;
  let got;
  try { got = await fetchMessages(mb.provider, token, terms); }
  catch (e) {
    await ctx.run(`UPDATE sales_mailboxes SET last_error = ?, last_error_at = NOW() WHERE id = ?`, [String(e.message || e).slice(0, 300), mb.id]);
    return { error: "read_failed", message: "The mailbox could not be read just now. It tries again on its own." };
  }
  const r = await capture(ctx, mb, got.messages || []);
  await ctx.run(`UPDATE sales_mailboxes SET last_ok_at = NOW(), found_last = ?, status = 'active', last_error = NULL, updated_at = NOW() WHERE id = ?`, [r.stored, mb.id]);
  return { ok: true, ...r };
}

async function mailboxes(query) {
  return query(`SELECT id, provider, address, status, last_ok_at, last_error, found_last, created_at FROM sales_mailboxes WHERE status <> 'disconnected' ORDER BY created_at`);
}
async function disconnect(ctx, id, who) {
  const r = await ctx.run(`UPDATE sales_mailboxes SET status = 'disconnected', credentials_sealed = NULL, updated_at = NOW() WHERE id = ? AND status <> 'disconnected'`, [id]);
  void who;
  return r.changes ? { ok: true } : { error: "not_found" };
}
// The separate, confirmed wipe of everything captured.
async function deleteCaptured(ctx) {
  const links = await ctx.run(`DELETE FROM sales_email_links`);
  const mails = await ctx.run(`DELETE FROM sales_emails`);
  return { ok: true, emails: mails.changes, links: links.changes };
}

async function noReplyDays(query) {
  const [r] = await query(`SELECT value FROM sales_settings WHERE key = 'no_reply_days'`);
  const n = r ? Number(r.value) : DEFAULT_NO_REPLY_DAYS;
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_NO_REPLY_DAYS;
}

module.exports = { DEFAULT_NO_REPLY_DAYS, keeps, scopeOf, capture, linkTargets, forRecord, body, replyFacts, tokenFor, readNow, mailboxes, disconnect, deleteCaptured, noReplyDays };
