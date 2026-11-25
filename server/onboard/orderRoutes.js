// server/onboard/orderRoutes.js · ORDER-1. THE ORDER ON THE CLOSE LINK.
//
//   POST  /admin/orgs/:id/start-links  { order: {...} }   (startRoutes.js hands an order body here)
//   PATCH /admin/start-links/:id/order                     edit an order she has not signed (version + 1)
//   POST  /admin/start-links/:id/send   { token }          "Review and sign your order", when Jonathan presses Send
//   GET   /admin/start-links/:id/pdf                       the order, signed or not, as a PDF (super-admin)
//   GET   /admin/orders/unsigned                           item 5's dry-run list: paid or closed, no signed order
//   GET   /public/start/:token/order.pdf                   "Download this order as a PDF" (her link is the key)
// The page's read and the signature go through startRoutes.js (/public/start/:token and
// /sign), which call page() and sign() below for a link that carries an order.
//
// A GET never changes state. A signed order is never edited: a change is a new order,
// raised with "replace", which retires the old link and gets a new number.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");
const O = require("./order");
const DEAL = require("../admin/sales/orderDeal");

const routers = { r1: express.Router() };
const ACTOR = "system:onboard/order";
// THE PLANTED DEFECTS (ORDER1_PLANT on the server, TEST_MODE=1, tests only):
//   stale        a signature is taken against an order that changed since she opened it  → order1 §4
//   chargeearly  the card step's subscription has no trial_end (it bills today)            → order1 §5
const PLANT = process.env.TEST_MODE === "1" ? process.env.ORDER1_PLANT || "" : "";

let deps = null;

const ipOf = req => String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim().slice(0, 100) || null;
const uaOf = req => String(req.headers["user-agent"] || "").slice(0, 500) || null;
const etYear = at => Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/New_York" }).format(new Date(at)));

// ── Reading an order ──────────────────────────────────────────────────────
async function snapshotFor(link, at) {
  const { query, orgTzName } = deps;
  const [org] = await query(`SELECT name FROM orgs WHERE id=?`, [link.org_id]);
  const tz = await orgTzName(link.org_id);
  return O.buildSnapshot({ order: link.order_json, orderNumber: link.order_number, version: link.order_version,
    orgName: org ? org.name : "", preparedBy: link.created_by_name, preparedAt: link.created_at, tz, at });
}
async function signatureOf(linkId) {
  const [s] = await deps.query(`SELECT * FROM order_signatures WHERE start_link_id=?`, [linkId]);
  return s || null;
}

// The page's data for an order link, in any state. Before she signs: the order for this
// moment and its hash. After: the snapshot she signed, and the stamp.
async function page(link, state) {
  const sig = await signatureOf(link.id);
  const snapshot = sig ? sig.snapshot : await snapshotFor(link, Date.now());
  return {
    order: {
      snapshot, sha256: sig ? sig.snapshot_sha256 : O.shownSha(snapshot),
      updatedOn: !sig && Number(link.order_version) > 1 && link.order_updated_at ? O.updatedWords(link.order_updated_at) : null,
      signed: sig ? { stamp: O.signedStamp(sig.signer_name, sig.signed_at), name: sig.signer_name, title: sig.signer_title, email: sig.signer_email,
        copySent: !!link.copy_sent_at } : null,
    },
    state,
  };
}

// ── She signs ─────────────────────────────────────────────────────────────
// Returns { ok } or { status, body }. The link is claimed by its UPDATE, so two tabs
// cannot both sign; the snapshot is re-built for this instant and must hash to what
// her page showed.
async function sign(req, link, b) {
  const { query, run, resend } = deps;
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const title = String(b.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (name.length < 2) return { status: 400, body: { error: "name_required", message: "Type your full name to sign." } };
  if (!title) return { status: 400, body: { error: "title_required", message: "Type your title." } };
  if (b.agree !== true) return { status: 400, body: { error: "agree_required", message: "Tick the box to say you're authorized and you agree." } };
  const now = Date.now();
  const shown = await snapshotFor(link, now);
  const sha = O.shownSha(shown);
  if (String(b.sha256 || "") !== sha && PLANT !== "stale") {
    const updated = Number(link.order_version) > 1 && link.order_updated_at;
    return { status: 409, body: { error: "order_changed",
      message: updated ? `This order was updated on ${O.updatedWords(link.order_updated_at)}. Read the new one and sign it.`
        : "The order on this page has changed since you opened it. It has been reloaded; read it again and sign.",
      ...(await page(link, "open")) } };
  }
  // What she signed: the order as shown, with her name and title as she typed them.
  const snapshot = { ...shown, signer: { ...shown.signer, name, title } };
  const snapshotSha256 = O.snapshotSha(snapshot);
  const firstChargeAt = new Date(snapshot.figures.firstChargeAt);
  const sigId = newId("sig"), osgId = newId("osg");
  const signedAt = new Date(now).toISOString();
  const claimed = await query(`UPDATE start_links SET status='signed', signed_at=?, signature_id=?, first_charge_at=?
                                WHERE id=? AND status='open' AND COALESCE(order_version,1)=? RETURNING id`,
    [signedAt, sigId, firstChargeAt.toISOString(), link.id, Number(link.order_version) || 1]);
  if (!claimed.length) return { status: 409, body: { error: "already_signed", message: "This order has already been signed, or it changed a moment ago. Reload the page." } };
  const email = link.order_json.signerEmail;
  await run(`INSERT INTO order_signatures (id, org_id, start_link_id, order_number, order_version, snapshot, snapshot_sha256, terms_version,
               signer_name, signer_title, signer_email, signed_at, ip, user_agent, first_charge_at, created_by, created_by_name)
             VALUES (?,?,?,?,?,?::jsonb,?,?,?,?,?,?,?,?,?,?,?)`,
    [osgId, link.org_id, link.id, link.order_number, Number(link.order_version) || 1, JSON.stringify(snapshot), snapshotSha256, O.TERMS_VERSION,
     name, title, email, signedAt, ipOf(req), uaOf(req), firstChargeAt.toISOString(), ACTOR, name]);
  // ONBOARD-1's record too, so Settings → Billing and the paper gate read it like every signature.
  const text = O.snapshotText(snapshot);
  await run(`INSERT INTO start_signatures (id, org_id, start_link_id, signer_name, signer_title, signer_email, signed_at, ip, user_agent,
               agreement_version, text_sha256, rendered_text, price_cents, first_charge_at, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [sigId, link.org_id, link.id, name, title, email, signedAt, ipOf(req), uaOf(req), `order ${link.order_number} v${Number(link.order_version) || 1} · terms ${O.TERMS_VERSION}`,
     O.snapshotSha(snapshot), text, snapshot.figures.priceCents, firstChargeAt.toISOString(), ACTOR, name]);
  if (req.audit) req.audit.summary = `${name} (${title}) signed order ${link.order_number} for ${snapshot.orgName}`;

  const sigRow = await signatureOf(link.id);
  const pdf = await require("./orderPdf").render(sigRow.snapshot, sigRow);
  // The deal: Signed, with the signed order on it (the PDF opens from the deal's Orders).
  const who = { id: ACTOR, name: `${name} (order link)` };
  try {
    await DEAL.moveTo(deps, link.deal_id, "signed", who);
    await DEAL.note(deps, link.deal_id, `Order ${link.order_number} signed. ${O.signedStamp(name, signedAt)}, ${title}. ${snapshot.total.label}: ${snapshot.total.amount}. The signed PDF is under Orders.`, who);
  } catch (e) { console.error(`[order] ${link.order_number}: the deal did not move:`, e.message); }
  // The signed copy, to the person who just signed, and nobody else.
  const mail = await require("./orderMail").signedCopy(resend, { to: email, snapshot, stamp: O.signedStamp(name, signedAt), pdf, orgId: link.org_id });
  if (mail.sent) await run(`UPDATE start_links SET copy_sent_at=NOW() WHERE id=?`, [link.id]);
  else console.error(`[order] ${link.order_number}: the signed copy was not sent: ${mail.reason}`);
  return { ok: true, copySent: mail.sent };
}

// The card step's Checkout for an order: subscription mode on the org's own customer, the
// typed price inline on the band's own product, per month or per year, trial_end = the first
// charge. The setup fee is added when Stripe says the card went in (startComplete), tied to
// the subscription's first real invoice: never today.
function checkoutPieces(link, product) {
  const o = link.order_json;
  return {
    lineItem: { quantity: 1, price_data: { currency: "usd", product, unit_amount: link.price_cents, recurring: { interval: o.interval === "year" ? "year" : "month" } } },
    plan: `${link.tier_id}_${o.interval === "year" ? "yearly" : "monthly"}`,
    setupFeeCents: o.setupFeeCents || 0,
  };
}
function confirmation(sig) {
  const s = sig.snapshot;
  return `Signed. Nothing is charged today. ${s.total.label}: ${s.total.amount}. Cancel any time before ${s.figures.firstChargeOn} in Settings and you pay nothing.`;
}

// ── Jonathan makes, edits and sends an order ──────────────────────────────
async function nextNumber(year) {
  const [r] = await deps.query(`SELECT COALESCE(MAX(CAST(split_part(order_number, '-', 3) AS INTEGER)), 0) AS n
                                  FROM start_links WHERE order_number LIKE ?`, [`SW-${year}-%`]);
  return Number(r.n) + 1;
}

async function create(req, res, org, whoName, { subscribed = false } = {}) {
  const { query, run, publicAppUrl, orgTzName } = deps;
  const SL = require("./startLink");
  const v = O.validateOrder((req.body || {}).order || {});
  if (!v.ok) return res.status(400).json(v);
  const open = await query(`SELECT id FROM start_links WHERE org_id=? AND status IN ('open','signed') AND expires_at > NOW()`, [org.id]);
  if (open.length && !(req.body || {}).replace) {
    return res.status(409).json({ error: "start_link_open", existingLinkId: open[0].id,
      message: `${org.name} already has an open order. Edit it, send that one, or make a new one with "replace" to retire it.` });
  }
  if (open.length) await run(`UPDATE start_links SET status='revoked' WHERE org_id=? AND status IN ('open','signed')`, [org.id]);
  if (subscribed) v.order.subscribed = true;   // signing records the order; Stripe billing is left as it is
  const deal = await DEAL.dealForOrg(query, org.id);
  const token = SL.newToken();
  const id = newId("stl");
  const year = etYear(Date.now());
  let number = null;
  for (let i = 0; i < 5 && !number; i++) {
    const candidate = O.orderNumber(year, await nextNumber(year));
    try {
      await run(`INSERT INTO start_links (id, org_id, token_hash, contact_name, contact_email, price_cents, price_basis, tier_id,
                   charge_mode, first_charge_on, note, status, expires_at, created_by, created_by_name,
                   order_number, order_json, order_version, deal_id)
                 VALUES (?,?,?,?,?,?,'order',?, 'days', NULL, NULL, 'open', NOW() + make_interval(days => ?), ?, ?, ?, ?::jsonb, 1, ?)`,
        [id, org.id, SL.sha256("start:" + token), v.order.signerName, v.order.signerEmail, v.order.priceCents, v.order.tierId,
         SL.EXPIRES_DAYS, req.user.userId, whoName, candidate, JSON.stringify(v.order), deal ? deal.id : null]);
      number = candidate;
    } catch (e) { if (e.code !== "23505") throw e; }
  }
  if (!number) return res.status(409).json({ error: "order_number_busy", message: "Two orders took the same number at once. Press it again." });
  const [row] = await query(`SELECT * FROM start_links WHERE id=?`, [id]);
  const snap = await snapshotFor(row, Date.now());
  if (req.audit) req.audit.summary = `Order ${number} made for ${org.name}`;
  res.status(201).json({
    id, url: `${publicAppUrl()}/start/${token}`, path: `/start/${token}`, token, orderNumber: number,
    orgName: org.name, contactName: v.order.signerName, contactEmail: v.order.signerEmail,
    priceUsd: v.order.priceCents / 100, interval: v.order.interval, expiresAt: row.expires_at,
    deal: deal ? { id: deal.id, name: deal.name } : null, snapshot: snap,
    sentence: `Order ${number}. Single use, and it expires ${require("../../closeLink").formatChargeDate(row.expires_at, await orgTzName(org.id))}. Nothing is charged when she signs.${deal ? ` The deal "${deal.name}" moves to Signed when she signs.` : " No deal in Sales is linked to this org, so no deal moves."}`,
  });
}

function mount(ctx) {
  deps = ctx;
  const { query, run, wrap, requireAuth, requireSuperAdmin, resend, publicAppUrl, registerLimiter } = ctx;
  const app = routers.r1;
  const limiter = registerLimiter || ((req, res, next) => next());
  const SL = require("./startLink");

  app.patch("/admin/start-links/:id/order", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const [link] = await query(`SELECT * FROM start_links WHERE id=?`, [req.params.id]);
    if (!link || !link.order_json) return res.status(404).json({ error: "not_found", message: "There is no such order." });
    if (link.status !== "open" || new Date(link.expires_at).getTime() <= Date.now()) {
      return res.status(409).json({ error: "order_not_editable", message: link.status === "signed" || link.status === "completed"
        ? `Order ${link.order_number} is signed. A signed order is never edited: make a new order, and it replaces this one.`
        : `Order ${link.order_number} can no longer be edited. Make a new order.` });
    }
    const v = O.validateOrder((req.body || {}).order || {});
    if (!v.ok) return res.status(400).json(v);
    if (link.order_json.subscribed) v.order.subscribed = true;
    const done = await query(`UPDATE start_links SET order_json=?::jsonb, order_version=COALESCE(order_version,1)+1, order_updated_at=NOW(),
                                price_cents=?, tier_id=?, contact_name=?, contact_email=? WHERE id=? AND status='open' RETURNING order_version`,
      [JSON.stringify(v.order), v.order.priceCents, v.order.tierId, v.order.signerName, v.order.signerEmail, link.id]);
    if (!done.length) return res.status(409).json({ error: "order_not_editable", message: "She signed it a moment ago. Make a new order instead." });
    if (req.audit) req.audit.summary = `Order ${link.order_number} edited (version ${done[0].order_version})`;
    res.json({ ok: true, version: done[0].order_version, sentence: `Order ${link.order_number} is now version ${done[0].order_version}. Her link stays the same; if she opened it already, she is told it was updated and signs the new one.` });
  }));

  // Send: Jonathan presses it, with the link he was just shown (only its hash is kept).
  app.post("/admin/start-links/:id/send", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const [link] = await query(`SELECT * FROM start_links WHERE id=?`, [req.params.id]);
    if (!link || !link.order_json) return res.status(404).json({ error: "not_found", message: "There is no such order." });
    const token = String((req.body || {}).token || "");
    if (SL.sha256("start:" + token) !== link.token_hash) return res.status(400).json({ error: "token_mismatch", message: "That link isn't this order's. Make the order again to get its link." });
    if (link.status !== "open" || new Date(link.expires_at).getTime() <= Date.now()) return res.status(409).json({ error: "not_open", message: `Order ${link.order_number} is not open to sign.` });
    const [org] = await query(`SELECT name FROM orgs WHERE id=?`, [link.org_id]);
    const mail = await require("./orderMail").requestSign(resend, { to: link.order_json.signerEmail, name: link.order_json.signerName, orgName: org ? org.name : "",
      orderNumber: link.order_number, url: `${publicAppUrl()}/start/${token}`, orgId: link.org_id, preparedBy: link.created_by_name });
    if (mail.sent) await run(`UPDATE start_links SET sent_at=NOW() WHERE id=?`, [link.id]);
    if (req.audit) req.audit.summary = `Order ${link.order_number}: "Review and sign your order" ${mail.sent ? "sent" : "not sent"} to ${link.order_json.signerEmail}`;
    res.json({ ok: true, sent: mail.sent, to: link.order_json.signerEmail,
      sentence: mail.sent ? `Sent to ${link.order_json.signerEmail} only.` : mail.reason });
  }));

  const sendPdf = async (res, link) => {
    const sig = await signatureOf(link.id);
    const snapshot = sig ? sig.snapshot : await snapshotFor(link, Date.now());
    const pdf = await require("./orderPdf").render(snapshot, sig);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="steward-order-${link.order_number}${sig ? "-signed" : ""}.pdf"`);
    res.end(pdf);
  };
  app.get("/admin/start-links/:id/pdf", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const [link] = await query(`SELECT * FROM start_links WHERE id=?`, [req.params.id]);
    if (!link || !link.order_json) return res.status(404).json({ error: "not_found" });
    await sendPdf(res, link);
  }));
  app.get("/public/start/:token/order.pdf", limiter, wrap(async (req, res) => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(req.params.token || ""))) return res.status(404).json({ error: "not_found" });
    const [link] = await query(`SELECT * FROM start_links WHERE token_hash=?`, [SL.sha256("start:" + req.params.token)]);
    const state = SL.linkState(link);
    if (!link || !link.order_json || state === "missing" || state === "revoked" || state === "expired") return res.status(404).json({ error: "not_found", message: "This order link can't be used." });
    await sendPdf(res, link);
  }));

  // ITEM 5 · the dry-run list: orgs on a paid plan, or that came through a close or start
  // link, with no signed order. It reads; it writes and sends nothing.
  app.get("/admin/orders/unsigned", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const rows = await query(`
      SELECT o.id, o.name, o.plan, o.subscription_status, o.stripe_subscription_id IS NOT NULL AS has_subscription,
             EXISTS (SELECT 1 FROM close_links c WHERE c.org_id = o.id OR c.target_org_id = o.id) AS via_close_link,
             EXISTS (SELECT 1 FROM start_links s WHERE s.org_id = o.id) AS via_start_link,
             (SELECT u.email FROM users u WHERE u.org_id = o.id AND u.role = 'admin' AND u.deactivated_at IS NULL ORDER BY u.created_at LIMIT 1) AS admin_email,
             (SELECT u.name FROM users u WHERE u.org_id = o.id AND u.role = 'admin' AND u.deactivated_at IS NULL ORDER BY u.created_at LIMIT 1) AS admin_name,
             (SELECT json_build_object('id', s.id, 'number', s.order_number, 'status', s.status, 'sentAt', s.sent_at)
                FROM start_links s WHERE s.org_id = o.id AND s.order_json IS NOT NULL AND s.status IN ('open','signed') AND s.expires_at > NOW()
               ORDER BY s.created_at DESC LIMIT 1) AS open_order
        FROM orgs o
       WHERE o.id <> 'org_b72demo'
         AND (o.stripe_subscription_id IS NOT NULL OR o.subscription_status IN ('active','past_due')
              OR EXISTS (SELECT 1 FROM close_links c WHERE c.org_id = o.id OR c.target_org_id = o.id)
              OR EXISTS (SELECT 1 FROM start_links s WHERE s.org_id = o.id))
         AND NOT EXISTS (SELECT 1 FROM order_signatures g WHERE g.org_id = o.id)
       ORDER BY o.name`);
    res.json({ ok: true, dryRun: true, count: rows.length,
      sentence: "Organizations on a paid plan, or that came in through a close link, with no signed order. Nothing here is sent until you press Send on an order.",
      orgs: rows.map(r => ({ id: r.id, name: r.name, plan: r.plan, status: r.subscription_status, adminEmail: r.admin_email, adminName: r.admin_name,
        why: [r.has_subscription || ["active", "past_due"].includes(r.subscription_status) ? "on a paid plan" : null, r.via_close_link ? "came through a close link" : null,
          r.via_start_link ? "has a start link" : null].filter(Boolean).join(", "),
        openOrder: r.open_order || null })) });
  }));
}

module.exports = { routers, mount, page, sign, create, checkoutPieces, confirmation, signatureOf, ACTOR, PLANT };
