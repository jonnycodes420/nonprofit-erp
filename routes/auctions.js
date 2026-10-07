// routes/auctions.js · PARITY-2 Part 4. AUCTIONS, FIRST VERSION.
//
// STAFF (requireAuth; writes also checkWriteAccess)
//   GET    /auctions                         every auction, with its counts
//   POST   /auctions                         make one (per event, or standalone)
//   GET    /auctions/:id                     one auction: items, bids, winners, bidders, drafts, figures
//   PUT    /auctions/:id                     edit it (times, title, archive)
//   POST   /auctions/:id/items               add an item
//   PUT    /auction-items/:id                edit an item
//   DELETE /auction-items/:id                remove an item nobody has bid on
//   POST   /auction-items/:id/in-kind        record the donated item as an in-kind gift (once)
//   POST   /auctions/:id/closing-note        prepare "bidding closes soon" drafts, one per bidder
//   POST   /auctions/:id/winner-emails       prepare the winners' drafts, with their pay links
//
// PUBLIC (no login)
//   GET    /auction/:slug                    the auction page (writes nothing)
//   GET    /auction/:slug/status             what the page polls (writes nothing)
//   POST   /auction/:slug/register           register to bid: name, email, phone
//   POST   /auction/:slug/bid                place a bid, or buy it now
//   GET    /auction/pay/:token               a winner's pay page (writes nothing)
//   POST   /auction/pay/:token               lives in routes/give.js beside the donation
//                                            checkout, because it IS the donation checkout
//
// WHAT THIS FILE REFUSES
//   · Nothing is sent to a bidder or a winner by itself. The closing note and
//     the winners' email are DRAFTS (milestone_drafts) that a person sends with
//     a Send button, through the same send every other draft takes
//     (donorMailDecision, the mail block, the org's mail switch).
//   · No money moves here. A winner pays on the org's own Stripe through the
//     donation checkout; the webhook writes the gift through recordGift with
//     the fair-market split, and issues the receipt the payment produces.
//   · A bid is accepted or refused by the DATABASE clock inside a transaction
//     that locks the item, so two bids cannot both be the high bid, and a bid
//     a second after the close is refused.
//   · A GET writes nothing. Registering and bidding are POSTs.
"use strict";

const express = require("express");
const AC = require("../auctionCore");
const figureSources = require("../figureSources");
const orgTime = require("../orgTime");

const routers = { r0: express.Router() };
const COOKIE_PREFIX = "stw_auc_";
const TITLE_MAX = 160, DESC_MAX = 4000, CAT_MAX = 60, PHOTOS_MAX = 6;

// The words a redirect may carry back to the public page. A code, never
// text from the request, so the page never prints what somebody put in a URL.
const MESSAGES = {
  registered: ["ok", "You are registered. Your bidder number is at the top of the page."],
  bid: ["ok", "Your bid is in. You are the high bidder."],
  bought: ["ok", "It is yours at the buy-now price. The organisation will send you a link to pay."],
  register_first: ["err", "Register to bid first: your name, email and phone, so the organisation knows who won."],
  closed: ["err", "Bidding on that item has closed."],
  not_open: ["err", "Bidding has not opened yet."],
  too_low: ["err", "Someone bid first. The lowest bid now is shown on the item."],
  bad_amount: ["err", "That amount did not read as dollars and cents."],
  too_high: ["err", "That bid is over one million dollars, which is almost certainly a typo."],
  no_buy_now: ["err", "Buy now is no longer available on that item: the bidding has passed it."],
  already: ["err", "That email is already registered for this auction. To bid from this phone or browser too, ask for a sign-in link below."],
  link_sent: ["ok", "If that email is registered for this auction, a sign-in link is on its way. It works once, for fifteen minutes."],
  link_bad: ["err", "That sign-in link has expired or was already used. Ask for a new one below."],
  signed_in: ["ok", "You are signed in on this device. Your bids and your bidder number are the same as on your other one."],
  paid_already: ["ok", "This item has already been paid for."],
  pay_in_progress: ["err", "A payment for this item is already going through. If it does not show as paid in a few minutes, ask the organisation."],
  pay_try_again: ["err", "We could not check on an earlier payment for this item. Try again in a minute."],
  missing: ["err", "A name, an email and a phone number, so the organisation can reach you if you win."],
  no_item: ["err", "That item is not in this auction."],
};

function mount(ctx) {
const {
  actor, brandEmailHeaderHtml, checkWriteAccess, donateLimiter, donorMailDecision, donorSendOpts, publicAppUrl,
  portalLinkEmailLimiter, portalLinkIpLimiter, query, queryTx, recordGift, requireAuth, resend, resolveOrgBrandTheme,
  run, runTx, storeAuctionPhoto, uuid, withTransaction, wrap, processAuctionUnpaid, requireAdmin, processUnansweredMail,
} = ctx;
const app = routers.r0;

// WIRE-1: the ops/test door onto the won-but-unpaid sweep, this org only (the
// /memberships/run-sweep shape). The hourly tick runs it for every org.
app.post("/auctions/run-unpaid-sweep", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await processAuctionUnpaid(req.user.orgId));
}));

// THREAD-3: the ops/test door onto the needs-a-reply sweep, this org only.
// The hourly tick and every mailbox sync run it too.
app.post("/mailbox/run-replies", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await processUnansweredMail(req.user.orgId));
}));

let PP = null;
const PP_READY = import("../shared/publicPage.js").then(m => { PP = m; return m; });
const page = opts => PP.publicPage({ footer: "Auction by Steward.", ...opts });

const tzOf = async orgId => {
  const [o] = await query(`SELECT timezone FROM orgs WHERE id=?`, [orgId]);
  return orgTime.normalizeTimezone(o && o.timezone);
};
// An instant, as a person in the org's timezone reads it.
const whenWords = (d, tz) => new Date(d).toLocaleString("en-US", {
  timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
// An instant as the "YYYY-MM-DDTHH:MM" a datetime-local input holds, in the org's zone.
function localOf(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const cleanText = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};
async function bidderFor(req, auction) {
  const t = cookieOf(req, COOKIE_PREFIX + auction.id);
  if (!t) return null;
  const h = AC.hashToken(t);
  // FIX-20 Part 6: the first device's token is on the bidder row; every
  // device signed in by an emailed link has its own row.
  const [b] = await query(`SELECT bd.* FROM auction_bidders bd
                            WHERE bd.auction_id=? AND bd.org_id=?
                              AND (bd.token_hash=? OR EXISTS (SELECT 1 FROM auction_bidder_devices v
                                    WHERE v.bidder_id=bd.id AND v.org_id=bd.org_id AND v.token_hash=?))`,
    [auction.id, auction.org_id, h, h]);
  return b || null;
}
async function publicAuction(slug) {
  const [a] = await query(`SELECT * FROM auctions WHERE public_slug=? AND status='active'`, [String(slug || "")]);
  return a || null;
}
const fmt = c => AC.fmtMoney(c);

// What one person sees about one item: their own standing, nobody else's name.
function youOf(st, bidderId, myBidItems) {
  if (!bidderId || !myBidItems.has(st.id)) return null;
  const mine = st.bidder_id === bidderId;
  if (st.closed) return mine ? "won" : "lost";
  return mine ? "high" : "outbid";
}
const YOU_WORDS = {
  high: ["ok", "You're the high bidder."],
  outbid: ["err", "You've been outbid."],
  won: ["ok", "You won this. The organisation will send you a link to pay."],
  lost: ["muted", "Someone else won this one."],
};

// ═══════════════════════════════════════════════════════════════════════
//  STAFF
// ═══════════════════════════════════════════════════════════════════════

function readItem(b, { partial = false } = {}) {
  const out = {}, errors = [];
  const money = (k, label, { required = false, positive = false } = {}) => {
    if (b[k] === undefined) { if (required && !partial) errors.push(`${label} is required.`); return; }
    if (b[k] === null || b[k] === "") { if (required) errors.push(`${label} is required.`); else out[k] = null; return; }
    const c = AC.cents(b[k]);
    if (c == null || c < 0 || c > AC.BID_MAX_CENTS) { errors.push(`${label} must be dollars and cents.`); return; }
    if (positive && c <= 0) { errors.push(`${label} must be more than $0.`); return; }
    out[k] = c;
  };
  if (b.title !== undefined || !partial) {
    out.title = cleanText(b.title, TITLE_MAX);
    if (!out.title) errors.push("An item needs a title.");
  }
  if (b.description !== undefined) out.description = cleanText(b.description, DESC_MAX) || null;
  if (b.category !== undefined) out.category = cleanText(b.category, CAT_MAX) || null;
  if (b.donorId !== undefined) out.donorId = b.donorId ? String(b.donorId) : null;
  money("fmv", "Fair market value");
  money("startingBid", "Starting bid", { required: true, positive: true });
  money("bidIncrement", "Bid increment", { required: true, positive: true });
  money("buyNow", "Buy now");
  if (out.buyNow != null && out.startingBid != null && out.buyNow < out.startingBid) errors.push("Buy now cannot be below the starting bid.");
  return { out, errors };
}

async function storePhotos(orgId, list) {
  if (!Array.isArray(list)) return { photos: undefined };
  const photos = [];
  for (const p of list.slice(0, PHOTOS_MAX)) {
    const r = await storeAuctionPhoto(orgId, p);
    if (r.error) return { error: r.message || "That photo could not be read." };
    if (r.url) photos.push(r.url);
  }
  return { photos };
}

async function loadAuction(orgId, id) {
  const [a] = await query(`SELECT a.*, e.name AS event_name FROM auctions a
                             LEFT JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
                            WHERE a.id=? AND a.org_id=?`, [id, orgId]);
  return a || null;
}

app.get("/auctions", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT a.id, a.title, a.public_slug, a.opens_at, a.closes_at, a.status, a.event_id, e.name AS event_name,
            (SELECT COUNT(*)::int FROM auction_items i WHERE i.auction_id=a.id AND i.org_id=a.org_id) AS items,
            (SELECT COUNT(*)::int FROM auction_bids b WHERE b.auction_id=a.id AND b.org_id=a.org_id) AS bids,
            (a.closes_at <= NOW()) AS closed, (a.opens_at > NOW()) AS not_open
       FROM auctions a LEFT JOIN events e ON e.id=a.event_id AND e.org_id=a.org_id
      WHERE a.org_id=? ORDER BY a.status, a.closes_at DESC`, [orgId]);
  const events = await query(`SELECT id, name, date FROM events WHERE org_id=? AND status <> 'cancelled' ORDER BY date DESC LIMIT 50`, [orgId]);
  res.json({ auctions: rows, events, timezone: await tzOf(orgId) });
}));

async function readAuctionBody(orgId, b, { partial = false } = {}) {
  const out = {}, errors = [];
  const tz = await tzOf(orgId);
  if (b.title !== undefined || !partial) {
    out.title = cleanText(b.title, TITLE_MAX);
    if (!out.title) errors.push("An auction needs a title.");
  }
  if (b.description !== undefined) out.description = cleanText(b.description, DESC_MAX) || null;
  for (const [k, label] of [["opensLocal", "Opening time"], ["closesLocal", "Closing time"]]) {
    if (b[k] === undefined) { if (!partial) errors.push(`${label} is required.`); continue; }
    const d = orgTime.localToInstant(b[k], tz);
    if (!d || isNaN(d)) errors.push(`${label} must be a date and time.`);
    else out[k === "opensLocal" ? "opensAt" : "closesAt"] = d;
  }
  if (b.eventId !== undefined) {
    out.eventId = b.eventId ? String(b.eventId) : null;
    if (out.eventId) {
      const [e] = await query(`SELECT id FROM events WHERE id=? AND org_id=?`, [out.eventId, orgId]);
      if (!e) errors.push("That event is not one of yours.");
    }
  }
  if (b.status !== undefined) {
    if (!["active", "archived"].includes(b.status)) errors.push("Status is active or archived.");
    else out.status = b.status;
  }
  return { out, errors, tz };
}

app.post("/auctions", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { out, errors } = await readAuctionBody(orgId, req.body || {});
  if (out.opensAt && out.closesAt && out.closesAt <= out.opensAt) errors.push("It has to close after it opens.");
  if (errors.length) return res.status(400).json({ error: errors.join(" "), errors });
  const id = "auc_" + uuid().replace(/-/g, "").slice(0, 12);
  const slug = `${AC.slugify(out.title)}-${uuid().replace(/-/g, "").slice(0, 6)}`;
  const who = actor(req);
  await run(`INSERT INTO auctions (id,org_id,event_id,title,description,public_slug,opens_at,closes_at,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, out.eventId || null, out.title, out.description || null, slug, out.opensAt, out.closesAt, who.id, who.name]);
  if (req.audit) req.audit.entity("auctions", id, `Auction: ${out.title}`);
  res.json({ id, publicSlug: slug });
}));

app.put("/auctions/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await loadAuction(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const { out, errors } = await readAuctionBody(orgId, req.body || {}, { partial: true });
  const opens = out.opensAt || a.opens_at, closes = out.closesAt || a.closes_at;
  if (new Date(closes) <= new Date(opens)) errors.push("It has to close after it opens.");
  if (errors.length) return res.status(400).json({ error: errors.join(" "), errors });
  const sets = [], args = [];
  const col = { title: "title", description: "description", opensAt: "opens_at", closesAt: "closes_at", eventId: "event_id", status: "status" };
  for (const [k, c] of Object.entries(col)) if (out[k] !== undefined) { sets.push(`${c}=?`); args.push(out[k]); }
  if (sets.length) await run(`UPDATE auctions SET ${sets.join(",")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...args, a.id, orgId]);
  res.json({ ok: true });
}));

// Every figure on the auction screen, read THROUGH its source, so the number
// and the rows it opens are one query.
async function auctionFigures(orgId, auctionId) {
  const out = {};
  for (const key of ["auction-raised", "auction-committed", "auction-sold", "auction-unsold", "auction-bidders"]) {
    const source = { key, params: { auction: auctionId } };
    const f = await figureSources.figure(orgId, source, {}, { rows: false });
    out[key] = { value: f.value, sentence: f.sentence, label: f.label, source };
  }
  return out;
}

// FIX-20 Part 5: who a winner's email cannot reach, and why. Only reasons
// about the PERSON count here (a bounce, a complaint, a deceased flag): an
// org whose mail is off is a fact about every winner, and the drafts screen
// already says so when Send is pressed.
const WINNER_MAIL_WORDS = {
  bounced: "Their address bounced, so email will not reach them.",
  complained: "They marked your mail as spam, so Steward will not email them.",
  deceased: "They are marked deceased.",
  blocked_address: "Their address is on the do-not-mail list.",
  sample_donor: "They are a sample person, so Steward will not email them.",
  no_email: "There is no email address for them.",
};
async function winnerMailBlock(orgId, email) {
  const d = await donorMailDecision("auction_winner", email, orgId);
  if (d.send || !WINNER_MAIL_WORDS[d.reason]) return null;
  return { reason: d.reason, sentence: WINNER_MAIL_WORDS[d.reason] + " Copy the pay link and send it yourself." };
}

app.get("/auctions/:id", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await loadAuction(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const tz = await tzOf(orgId);
  const items = (await AC.itemStates(query, orgId, a.id)).map(st => {
    const winner = st.closed && st.bid_id ? {
      bidderId: st.bidder_id, name: st.bidder_name, email: st.bidder_email, bidderNumber: st.bidder_number,
      donorId: st.bidder_donor_id, amount: Number(st.high_amount),
      payUrl: `${publicAppUrl()}/auction/pay/${AC.payToken(st.id, st.bid_id)}`,
    } : null;
    return {
      id: st.id, title: st.title, description: st.description, category: st.category, photos: st.photos || [],
      donorId: st.donor_id, donorName: st.donor_name,
      fmv: Number(st.fmv), startingBid: Number(st.starting_bid), bidIncrement: Number(st.bid_increment),
      buyNow: st.buy_now == null ? null : Number(st.buy_now),
      highBid: st.high_amount == null ? null : Number(st.high_amount), bidCount: st.bid_count,
      highBidder: st.bid_id ? { name: st.bidder_name, bidderNumber: st.bidder_number, donorId: st.bidder_donor_id } : null,
      closed: !!st.closed, boughtNow: !!st.bought_now, winner,
      inKindGiftId: st.in_kind_gift_id, paidGiftId: st.paid_gift_id, paidAt: st.paid_at,
      deductibleOfWin: winner ? AC.dollars(AC.deductibleCents(AC.cents(st.high_amount), AC.cents(st.fmv))) : null,
    };
  });
  const bidders = await query(
    `SELECT bd.id, bd.name, bd.email, bd.phone, bd.bidder_number, bd.donor_id, bd.created_at,
            (SELECT COUNT(*)::int FROM auction_bids b WHERE b.bidder_id=bd.id AND b.org_id=bd.org_id) AS bids
       FROM auction_bidders bd WHERE bd.org_id=? AND bd.auction_id=? ORDER BY bd.bidder_number`, [orgId, a.id]);
  const drafts = await query(
    `SELECT m.id, m.donor_id, d.name AS donor_name, m.subject, m.body, m.status, m.sent_at, m.milestone_key
       FROM milestone_drafts m LEFT JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
      WHERE m.org_id=? AND m.milestone_key IN (?, ?) AND m.status <> 'dismissed'
      ORDER BY m.created_at DESC`, [orgId, `auction-closing:${a.id}`, `auction-winner:${a.id}`]);
  for (const it of items) {
    if (it.winner && !it.paidGiftId) it.winner.mailBlocked = await winnerMailBlock(orgId, it.winner.email);
  }
  // FIX-20 Part 1: a second payment for an item someone already paid for.
  // No gift was recorded for it; a person refunds it in Stripe.
  const refundFlags = (await query(
    `SELECT f.id, f.item_id, i.title AS item_title, f.stripe_payment_id, f.amount::text AS amount, f.payer_name, f.payer_email,
            f.donor_id, f.kept_payment_id, f.created_at, f.resolved_at, f.resolved_by_name
       FROM auction_refund_flags f LEFT JOIN auction_items i ON i.id=f.item_id AND i.org_id=f.org_id
      WHERE f.org_id=? AND f.auction_id=? ORDER BY f.created_at`, [orgId, a.id]))
    .map(f => ({ ...f, amount: Number(f.amount) }));
  const [org] = await query(`SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=?`, [orgId]);
  res.json({
    refundFlags,
    refundSentence: "A second payment arrived for an item that was already paid for. Steward recorded no gift for it. Refund this in Stripe; Steward does not refund on its own.",
    auction: { ...a, opensLocal: localOf(a.opens_at, tz), closesLocal: localOf(a.closes_at, tz),
               opensWords: whenWords(a.opens_at, tz), closesWords: whenWords(a.closes_at, tz),
               closed: new Date(a.closes_at) <= new Date(), notOpen: new Date(a.opens_at) > new Date(),
               publicUrl: `${publicAppUrl()}/auction/${a.public_slug}` },
    items, bidders, drafts, figures: await auctionFigures(orgId, a.id), timezone: tz,
    canTakeCards: !!(org && org.stripe_connected && org.stripe_account_id),
  });
}));

app.post("/auctions/:id/items", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await loadAuction(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const { out, errors } = readItem(req.body || {});
  if (out.donorId) {
    const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [out.donorId, orgId]);
    if (!d) errors.push("That donor is not one of yours.");
  }
  if (errors.length) return res.status(400).json({ error: errors.join(" "), errors });
  const ph = await storePhotos(orgId, req.body.photos || []);
  if (ph.error) return res.status(400).json({ error: ph.error });
  const id = "aui_" + uuid().replace(/-/g, "").slice(0, 12);
  const [pos] = await query(`SELECT COALESCE(MAX(position),0)+1 AS p FROM auction_items WHERE auction_id=? AND org_id=?`, [a.id, orgId]);
  const who = actor(req);
  await run(`INSERT INTO auction_items (id,org_id,auction_id,title,description,category,photos,donor_id,fmv,starting_bid,bid_increment,buy_now,position,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?::jsonb,?,?,?,?,?,?,?,?)`,
    [id, orgId, a.id, out.title, out.description || null, out.category || null, JSON.stringify(ph.photos || []), out.donorId || null,
     AC.dollars(out.fmv || 0), AC.dollars(out.startingBid), AC.dollars(out.bidIncrement),
     out.buyNow == null ? null : AC.dollars(out.buyNow), pos.p, who.id, who.name]);
  if (req.audit) req.audit.entity("auction_items", id, `Auction item: ${out.title}`);
  res.json({ id });
}));

async function loadItem(orgId, id) {
  const [i] = await query(`SELECT i.*, (SELECT COUNT(*)::int FROM auction_bids b WHERE b.item_id=i.id AND b.org_id=i.org_id) AS bids
                             FROM auction_items i WHERE i.id=? AND i.org_id=?`, [id, orgId]);
  return i || null;
}

app.put("/auction-items/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const item = await loadItem(orgId, req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const { out, errors } = readItem({
    startingBid: b.startingBid ?? item.starting_bid, bidIncrement: b.bidIncrement ?? item.bid_increment,
    ...b, buyNow: b.buyNow !== undefined ? b.buyNow : item.buy_now,
  }, { partial: true });
  // Once somebody has bid, the terms they bid on stay put. The fair market
  // value is the org's own number and may be corrected at any time.
  if (item.bids > 0) {
    const same = (k, col) => out[k] === undefined || out[k] === AC.cents(item[col]);
    if (!same("startingBid", "starting_bid") || !same("bidIncrement", "bid_increment") || !same("buyNow", "buy_now")) {
      errors.push("People have bid on this item, so its starting bid, increment and buy-now price stay as they were.");
    }
  }
  if (out.donorId) {
    const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [out.donorId, orgId]);
    if (!d) errors.push("That donor is not one of yours.");
  }
  if (errors.length) return res.status(400).json({ error: errors.join(" "), errors });
  const ph = await storePhotos(orgId, b.photos);
  if (ph.error) return res.status(400).json({ error: ph.error });
  const sets = [], args = [];
  const put = (c, v) => { sets.push(`${c}=?`); args.push(v); };
  if (out.title !== undefined) put("title", out.title);
  if (out.description !== undefined) put("description", out.description);
  if (out.category !== undefined) put("category", out.category);
  if (out.donorId !== undefined) put("donor_id", out.donorId);
  if (out.fmv !== undefined) put("fmv", AC.dollars(out.fmv || 0));
  if (out.startingBid !== undefined) put("starting_bid", AC.dollars(out.startingBid));
  if (out.bidIncrement !== undefined) put("bid_increment", AC.dollars(out.bidIncrement));
  if (out.buyNow !== undefined) put("buy_now", out.buyNow == null ? null : AC.dollars(out.buyNow));
  if (ph.photos !== undefined) { sets.push("photos=?::jsonb"); args.push(JSON.stringify(ph.photos)); }
  if (sets.length) await run(`UPDATE auction_items SET ${sets.join(",")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...args, item.id, orgId]);
  res.json({ ok: true });
}));

app.delete("/auction-items/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const item = await loadItem(orgId, req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  if (item.bids > 0) return res.status(409).json({ error: "People have bid on this item, so it stays. Its bids are a record of what they offered." });
  await run(`DELETE FROM auction_items WHERE id=? AND org_id=?`, [item.id, orgId]);
  res.json({ ok: true });
}));

// THE DONATED ITEM IS AN IN-KIND GIFT for the person who gave it, at the
// org's fair market value, written once through recordGift. A person presses
// the button: the value may be revised after the item is listed, and a gift
// on somebody's record is a decision, not a side effect of typing an item.
app.post("/auction-items/:id/in-kind", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const item = await loadItem(orgId, req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  if (item.in_kind_gift_id) return res.json({ giftId: item.in_kind_gift_id, already: true });
  if (!item.donor_id) return res.status(400).json({ error: "Say who donated it first: an in-kind gift is on somebody's record." });
  const fmvC = AC.cents(item.fmv) || 0;
  if (fmvC <= 0) return res.status(400).json({ error: "Enter its fair market value first: an in-kind gift is recorded at that value." });
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [item.donor_id, orgId]);
  if (!d) return res.status(400).json({ error: "The donor on this item is no longer on file." });
  const a = await loadAuction(orgId, item.auction_id);
  const who = actor(req);
  const today = orgTime.orgToday({ timezone: await tzOf(orgId) });   // ORG_TZ_SEAM_OK
  const written = await recordGift({
    orgId, donorId: item.donor_id, amount: AC.dollars(fmvC), date: today,
    type: "in_kind", paymentMethod: "In-kind",
    notes: `Donated for the auction "${a.title}": ${item.title}`,
    campaign: a.event_name || "",
    idempotencyKey: `auction-inkind:${item.id}`, conflict: "idempotency",
    actorId: who.id, actorName: who.name,
    ledgerDescription: `In-kind: ${item.title}`, ledgerSource: "gift",
    timelineNote: `Donated "${item.title}" for the auction, valued at ${fmt(fmvC)}`,
    source: "auction",
  });
  let giftId = written.gift && written.gift.id;
  if (!giftId) {
    const [g] = await query(`SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?`, [orgId, `auction-inkind:${item.id}`]);
    giftId = g && g.id;
  }
  await run(`UPDATE auction_items SET in_kind_gift_id=? WHERE id=? AND org_id=? AND in_kind_gift_id IS NULL`, [giftId, item.id, orgId]);
  res.json({ giftId });
}));

// ── THE TWO PREPARED NOTES ────────────────────────────────────────────────
// Each writes DRAFTS, one per person, into the same review queue every other
// draft is in. Pressing it twice writes nothing twice: a person who already
// has a draft for this auction's note is skipped.
async function writeDrafts(req, a, key, people, compose) {
  const orgId = req.user.orgId, who = actor(req);
  const have = new Set((await query(`SELECT donor_id FROM milestone_drafts WHERE org_id=? AND milestone_key=? AND status <> 'dismissed'`,
    [orgId, key])).map(r => r.donor_id));
  let made = 0;
  for (const p of people) {
    if (have.has(p.donorId)) continue;
    const { subject, body } = compose(p);
    await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
               VALUES (?,?,?,?,?,?, 'pending_review', ?, ?, ?)`,
      ["md_" + uuid().slice(0, 8), orgId, p.donorId, key, subject, body, key.split(":")[0], who.id, who.name]);
    made++;
  }
  return made;
}
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "there";

app.post("/auctions/:id/closing-note", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await loadAuction(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  if (new Date(a.closes_at) <= new Date()) return res.status(409).json({ error: "Bidding has closed, so there is nothing left to remind anyone about." });
  const tz = await tzOf(orgId);
  const brand = await resolveOrgBrandTheme(orgId).catch(() => null);
  const orgName = (brand && brand.displayName) || "us";
  const bidders = await query(`SELECT donor_id AS "donorId", name FROM auction_bidders WHERE org_id=? AND auction_id=?`, [orgId, a.id]);
  const url = `${publicAppUrl()}/auction/${a.public_slug}`;
  const closes = new Date(a.closes_at).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const made = await writeDrafts(req, a, `auction-closing:${a.id}`, bidders, p => ({
    subject: `Bidding closes at ${closes}: ${a.title}`,
    body: `Hi ${firstName(p.name)},\n\nBidding in ${a.title} closes at ${closes}. If there is something you have your eye on, now is the time to check whether you are still the high bidder.\n\n${url}\n\nThank you for bidding, and for supporting ${orgName}.`,
  }));
  res.json({ made, bidders: bidders.length });
}));

app.post("/auctions/:id/winner-emails", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const a = await loadAuction(orgId, req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const states = await AC.itemStates(query, orgId, a.id);
  const won = states.filter(s => s.closed && s.bid_id && !s.paid_gift_id);
  if (!won.length) return res.status(409).json({ error: "There is nobody to write to yet: no closed item has an unpaid winner." });
  const [org] = await query(`SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=?`, [orgId]);
  if (!(org && org.stripe_connected && org.stripe_account_id)) {
    return res.status(409).json({ error: "Connect your Stripe account first: a winner pays through it, and a pay link that cannot take a card is a dead end." });
  }
  const brand = await resolveOrgBrandTheme(orgId).catch(() => null);
  const orgName = (brand && brand.displayName) || "us";
  const byPerson = new Map();
  let unreachable = 0;
  for (const s of won) {
    if (await winnerMailBlock(orgId, s.bidder_email)) { unreachable++; continue; }
    const k = s.bidder_donor_id;
    if (!byPerson.has(k)) byPerson.set(k, { donorId: k, name: s.bidder_name, items: [] });
    byPerson.get(k).items.push(s);
  }
  const made = await writeDrafts(req, a, `auction-winner:${a.id}`, [...byPerson.values()], p => {
    const lines = p.items.map(s => `${s.title}: ${fmt(AC.cents(s.high_amount))}\nPay here: ${publicAppUrl()}/auction/pay/${AC.payToken(s.id, s.bid_id)}`);
    return {
      subject: p.items.length === 1 ? `You won ${p.items[0].title}` : `You won ${p.items.length} items in ${a.title}`,
      body: `Hi ${firstName(p.name)},\n\nCongratulations: you had the winning bid in ${a.title}.\n\n${lines.join("\n\n")}\n\nEach link takes you to a secure payment page run by ${orgName}'s own payment account. Your receipt will show the part of your bid that is tax deductible: the amount over each item's fair market value.\n\nThank you for supporting ${orgName}.`,
    };
  });
  res.json({ made, winners: byPerson.size, unreachable });
}));

// FIX-20 Part 1: a person refunded the flagged payment in Stripe and says so.
// Steward moves no money here; it only records that somebody did.
app.post("/auction-refund-flags/:id/resolve", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const who = actor(req);
  const { changes } = await run(
    `UPDATE auction_refund_flags SET resolved_at=NOW(), resolved_by=?, resolved_by_name=? WHERE id=? AND org_id=? AND resolved_at IS NULL`,
    [who.id, who.name, req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found or already marked refunded" });
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC
// ═══════════════════════════════════════════════════════════════════════

const NOT_FOUND = () => page({ title: "Not found", brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
  body: `<div class="card"><h1>That page is not here.</h1><p class="muted">The link may have changed, or this auction has been taken down. Ask the organisation for its current link.</p></div>` });

// A winner's pay page. It writes nothing: paying is a POST (routes/give.js).
// Defined before /auction/:slug so "pay" is never read as a slug.
app.get("/auction/pay/:token", donateLimiter, wrap(async (req, res) => {
  await PP_READY;
  res.setHeader("Cache-Control", "no-store");
  const r = await AC.resolvePayToken(query, req.params.token);
  if (!r) return res.status(404).send(NOT_FOUND());
  const { orgId, auction, item } = r;
  const esc = PP.escapeHtml;
  const brand = await resolveOrgBrandTheme(orgId).catch(() => null) || { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
  const amountC = AC.cents(item.high_amount), fmvC = AC.cents(item.fmv) || 0;
  const dedC = AC.deductibleCents(amountC, fmvC);
  const [org] = await query(`SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=?`, [orgId]);
  const canPay = !!(org && org.stripe_connected && org.stripe_account_id);
  const problem = MESSAGES[String(req.query.m || "")];
  const photo = Array.isArray(item.photos) && item.photos[0];
  let body;
  if (item.paid_gift_id) {
    body = `<div class="card"><h1>Paid. Thank you.</h1><div class="ok">${esc(item.title)}, ${esc(fmt(amountC))}. Your receipt is on its way by email.</div></div>`;
  } else if (req.query.paid === "1") {
    body = `<div class="card"><h1>Thank you. Your payment went through.</h1><p class="muted">We are recording it now. If this page does not say so within a minute, your email receipt is your proof of payment and ${esc(brand.displayName || "the organisation")} has the record.</p></div>`;
  } else {
    body = `
      ${problem ? `<div class="${problem[0] === "ok" ? "ok" : "err"}">${esc(problem[1])}</div>` : ""}
      <div class="card">
        ${photo ? `<img src="${esc(photo)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:10px;margin:0 0 12px">` : ""}
        <h1>You won ${esc(item.title)}</h1>
        <p class="muted">${esc(auction.title)} · bidder #${esc(item.bidder_number)}, ${esc(item.bidder_name)}</p>
        <div class="row"><h2>Your winning bid</h2><span class="pill open">${esc(fmt(amountC))}</span></div>
        <p class="small">${fmvC > 0
          ? `Its fair market value is ${esc(fmt(fmvC))}, so ${esc(fmt(dedC))} of this is tax deductible. Your receipt will say so.`
          : "The whole amount is tax deductible: the organisation puts no value on what you receive."}</p>
        ${canPay ? `<form method="post" action="/auction/pay/${esc(req.params.token)}">
          <button class="btn" type="submit">Pay ${esc(fmt(amountC))}</button></form>`
          : `<p class="small">${esc(brand.displayName || "The organisation")} will be in touch about paying. Nothing is charged on this page.</p>`}
      </div>
      <p class="small" style="text-align:center">Your card is taken by ${esc(brand.displayName || "the organisation")}'s own payment account. Steward never holds the money and never sees the card.</p>`;
  }
  res.send(page({ title: `${item.title} · ${brand.displayName || ""}`, brand, body }));
}));

app.get("/auction/:slug", donateLimiter, wrap(async (req, res) => {
  await PP_READY;
  res.setHeader("Cache-Control", "no-store");
  const a = await publicAuction(req.params.slug);
  if (!a) return res.status(404).send(NOT_FOUND());
  const esc = PP.escapeHtml;
  const tz = await tzOf(a.org_id);
  const brand = await resolveOrgBrandTheme(a.org_id).catch(() => null) || { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
  const bidder = await bidderFor(req, a);
  const states = await AC.itemStates(query, a.org_id, a.id);
  const mine = bidder ? new Set((await query(`SELECT DISTINCT item_id FROM auction_bids WHERE bidder_id=? AND org_id=?`, [bidder.id, a.org_id])).map(r => r.item_id)) : new Set();
  const now = new Date();
  const notOpen = new Date(a.opens_at) > now, allClosed = new Date(a.closes_at) <= now;
  const cats = [...new Set(states.map(s => s.category).filter(Boolean))].sort();
  const cat = cats.includes(String(req.query.c || "")) ? String(req.query.c) : "";
  const shown = cat ? states.filter(s => s.category === cat) : states;
  const msg = MESSAGES[String(req.query.m || "")];
  const self = `/auction/${encodeURIComponent(a.public_slug)}`;
  const shareUrl = `${publicAppUrl()}/auction/${a.public_slug}`;
  const [ev] = a.event_id ? await query(`SELECT name FROM events WHERE id=? AND org_id=?`, [a.event_id, a.org_id]) : [null];

  const itemCard = st => {
    const high = AC.cents(st.high_amount), minNext = AC.minNextBidCents(st);
    const buyNowC = AC.cents(st.buy_now);
    const you = youOf(st, bidder && bidder.id, mine);
    const photos = Array.isArray(st.photos) ? st.photos : [];
    const canBid = bidder && !st.closed && !st.not_open;
    return `<div class="card" id="i-${esc(st.id)}" data-item="${esc(st.id)}">
      ${photos[0] ? `<img src="${esc(photos[0])}" alt="" style="width:100%;max-height:300px;object-fit:cover;border-radius:10px;margin:0 0 10px;display:block">` : ""}
      ${photos.length > 1 ? `<div style="display:flex;gap:6px;overflow-x:auto;margin:0 0 10px">${photos.slice(1).map(p => `<img src="${esc(p)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none">`).join("")}</div>` : ""}
      <div class="row"><h2>${esc(st.title)}</h2>${st.category ? `<span class="pill shut">${esc(st.category)}</span>` : ""}</div>
      ${st.description ? `<p class="small" style="white-space:pre-line">${esc(st.description)}</p>` : ""}
      <p style="margin:8px 0 2px"><strong data-high>${high == null ? `Starting bid ${esc(fmt(AC.cents(st.starting_bid)))}` : `${st.closed ? "Winning bid" : "High bid"} ${esc(fmt(high))}`}</strong>
        <span class="small" data-count>${st.bid_count ? ` · ${st.bid_count} bid${st.bid_count === 1 ? "" : "s"}` : " · no bids yet"}</span></p>
      <p class="small" data-state>${st.closed ? (st.bid_id ? "Bidding has closed." : "Bidding has closed with no bids.") : ""}</p>
      <div data-you>${you ? `<div class="${YOU_WORDS[you][0] === "muted" ? "small" : YOU_WORDS[you][0]}">${esc(YOU_WORDS[you][1])}</div>` : ""}</div>
      <p class="small">${esc(AC.deductibleSentence(st))}</p>
      ${canBid ? `
      <form method="post" action="${self}/bid" data-bidform>
        <input type="hidden" name="itemId" value="${esc(st.id)}">
        <label>Your bid (at least <span data-min>${esc(fmt(minNext))}</span>)
          <input name="amount" inputmode="decimal" data-amount value="${esc((minNext / 100).toFixed(2))}" required></label>
        <button class="btn" type="submit">Bid</button>
      </form>
      ${buyNowC != null && (high == null || high < buyNowC) ? `
      <form method="post" action="${self}/bid" data-buynow>
        <input type="hidden" name="itemId" value="${esc(st.id)}"><input type="hidden" name="buyNow" value="1">
        <button class="btn quiet" type="submit">Buy it now for ${esc(fmt(buyNowC))}</button>
      </form>` : ""}` : ""}
    </div>`;
  };

  const registerCard = !bidder && !allClosed ? `
    <div class="card" id="register">
      <h2>Register to bid</h2>
      <p class="small">Your name, email and phone, so ${esc(brand.displayName || "the organisation")} can reach you if you win. Nothing is charged until you win and choose to pay.</p>
      <form method="post" action="${self}/register">
        <input class="hp" name="website" tabindex="-1" autocomplete="off">
        <label>Your name<input name="name" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Phone<input name="phone" type="tel" required autocomplete="tel"></label>
        <button class="btn" type="submit">Register</button>
      </form>
    </div>` : "";

  const signinCard = !bidder ? `
    <div class="card" id="signin">
      <h2>Registered on another phone?</h2>
      <p class="small">Enter the email you registered with and we will send a sign-in link for this device. Your bidder number and your bids stay the same.</p>
      <form method="post" action="${self}/signin-link">
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <button class="btn quiet" type="submit">Email me a sign-in link</button>
      </form>
    </div>` : "";

  const enc = encodeURIComponent(shareUrl);
  const share = `<div class="card"><h2>Share it</h2>
      <p class="small" style="display:flex;gap:14px;flex-wrap:wrap;margin:6px 0 0">
        <a href="mailto:?subject=${encodeURIComponent(a.title)}&body=${enc}">Email</a>
        <a href="sms:?&body=${enc}">Text</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=${enc}" target="_blank" rel="noopener">Facebook</a>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${enc}" target="_blank" rel="noopener">LinkedIn</a>
        <a href="#" data-copy="${esc(shareUrl)}">Copy link</a>
      </p></div>`;

  const body = `
    ${msg ? `<div class="${msg[0]}">${esc(msg[1])}</div>` : ""}
    <div class="card">
      <h1>${esc(a.title)}</h1>
      ${ev ? `<p class="muted">Part of ${esc(ev.name)}</p>` : ""}
      ${a.description ? `<p style="white-space:pre-line">${esc(a.description)}</p>` : ""}
      <p class="small">${notOpen ? `Bidding opens ${esc(whenWords(a.opens_at, tz))}` : `Bidding ${allClosed ? "closed" : "closes"} ${esc(whenWords(a.closes_at, tz))}`}</p>
      <p style="font-size:20px;font-weight:700;margin:4px 0 0" data-countdown data-to="${esc(new Date(notOpen ? a.opens_at : a.closes_at).toISOString())}" data-label="${notOpen ? "Opens in" : "Closes in"}">${allClosed ? "Bidding has closed." : ""}</p>
      ${bidder ? `<p class="small" style="margin-top:8px">You are bidder #${esc(bidder.bidder_number)}, ${esc(bidder.name)}.</p>` : ""}
    </div>
    ${registerCard}
    ${signinCard}
    ${cats.length ? `<p class="small" style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="${self}" class="pill ${cat ? "shut" : "open"}">All</a>
        ${cats.map(c => `<a href="${self}?c=${encodeURIComponent(c)}" class="pill ${c === cat ? "open" : "shut"}">${esc(c)}</a>`).join("")}</p>` : ""}
    ${shown.map(itemCard).join("") || `<div class="card"><p class="muted">No items yet.</p></div>`}
    ${share}
    <p class="small" style="text-align:center">If you win, you pay ${esc(brand.displayName || "the organisation")} through its own payment account. Steward never holds the money and never sees a card.</p>
    <script>
    (function(){
      var cd=document.querySelector("[data-countdown]");
      function tick(){ if(!cd||!cd.dataset.to) return; var ms=new Date(cd.dataset.to)-new Date();
        if(ms<=0){ if(!cd.dataset.done){cd.dataset.done="1"; ${allClosed ? "" : "setTimeout(function(){location.reload();},1500);"}} cd.textContent=${JSON.stringify(notOpen ? "Bidding is opening." : "Bidding has closed.")}; return; }
        var s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60;
        cd.textContent=cd.dataset.label+" "+(d?d+"d ":"")+(d||h?h+"h ":"")+m+"m "+x+"s"; }
      tick(); setInterval(tick,1000);
      var YOU=${JSON.stringify(YOU_WORDS)};
      function money(c){var n=c/100;return "$"+n.toLocaleString("en-US",{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});}
      function poll(){ fetch(${JSON.stringify(self + "/status")},{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json();}).then(function(j){
        (j.items||[]).forEach(function(it){ var el=document.querySelector('[data-item="'+it.id+'"]'); if(!el) return;
          var h=el.querySelector("[data-high]"); if(h&&it.high!=null) h.textContent=(it.closed?"Winning bid ":"High bid ")+money(it.high);
          var c=el.querySelector("[data-count]"); if(c) c.textContent=it.bidCount?" · "+it.bidCount+" bid"+(it.bidCount===1?"":"s"):" · no bids yet";
          var y=el.querySelector("[data-you]"); if(y){ y.innerHTML=""; if(it.you){var d=document.createElement("div"); d.className=YOU[it.you][0]==="muted"?"small":YOU[it.you][0]; d.textContent=YOU[it.you][1]; y.appendChild(d);} }
          var mn=el.querySelector("[data-min]"), am=el.querySelector("[data-amount]");
          if(mn) mn.textContent=money(it.minNext);
          if(am && document.activeElement!==am && Number(am.value)*100<it.minNext) am.value=(it.minNext/100).toFixed(2);
          if(it.closed){ el.querySelectorAll("form").forEach(function(f){f.remove();}); var st=el.querySelector("[data-state]"); if(st) st.textContent=it.high!=null?"Bidding has closed.":"Bidding has closed with no bids."; }
          else if(it.buyNowGone){ var b=el.querySelector("[data-buynow]"); if(b) b.remove(); }
        }); }).catch(function(){}); }
      ${allClosed ? "" : "setInterval(poll,15000);"}
      document.querySelectorAll("[data-copy]").forEach(function(a){a.addEventListener("click",function(e){e.preventDefault();
        if(navigator.clipboard) navigator.clipboard.writeText(a.dataset.copy).then(function(){a.textContent="Copied";});});});
    })();
    </script>`;
  res.send(page({ title: `${a.title} · ${brand.displayName || ""}`, brand, body }));
}));

app.get("/auction/:slug/status", donateLimiter, wrap(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const a = await publicAuction(req.params.slug);
  if (!a) return res.status(404).json({ error: "Not found" });
  const bidder = await bidderFor(req, a);
  const states = await AC.itemStates(query, a.org_id, a.id);
  const mine = bidder ? new Set((await query(`SELECT DISTINCT item_id FROM auction_bids WHERE bidder_id=? AND org_id=?`, [bidder.id, a.org_id])).map(r => r.item_id)) : new Set();
  res.json({
    closesAt: a.closes_at, opensAt: a.opens_at,
    items: states.map(st => {
      const high = AC.cents(st.high_amount), buyNowC = AC.cents(st.buy_now);
      return { id: st.id, high, minNext: AC.minNextBidCents(st), bidCount: st.bid_count, closed: !!st.closed,
               buyNowGone: buyNowC == null || (high != null && high >= buyNowC), you: youOf(st, bidder && bidder.id, mine) };
    }),
  });
}));

app.post("/auction/:slug/register", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  const a = await publicAuction(req.params.slug);
  if (!a) return res.status(404).send("Not found");
  const self = `/auction/${encodeURIComponent(a.public_slug)}`;
  const back = code => res.redirect(303, `${self}?m=${code}${code === "registered" ? "" : code === "already" ? "#signin" : "#register"}`);
  if (String(req.body?.website || "").trim()) return back("registered");   // the honeypot
  if (new Date(a.closes_at) <= new Date()) return back("closed");
  const name = cleanText(req.body?.name, 200), email = cleanText(req.body?.email, 320).toLowerCase(), phone = cleanText(req.body?.phone, 40);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.replace(/\D/g, "").length < 7) return back("missing");
  const [taken] = await query(`SELECT id FROM auction_bidders WHERE auction_id=? AND LOWER(email)=?`, [a.id, email]);
  if (taken) return back("already");

  // ONE PERSON RECORD: matched by EXACT EMAIL, never by name. Somebody nobody
  // has heard of becomes a person typed "other": they are not a donor until
  // they pay, and recordGift makes them one on the same row when they do.
  const sys = AC.SYS_PUBLIC;
  const [known] = await query(`SELECT id FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`, [a.org_id, email]);
  let donorId = known && known.id;
  if (!donorId) {
    donorId = "d_" + uuid().slice(0, 10);
    await run(`INSERT INTO donors (id,org_id,name,email,phone,stage,status,tags,person_types,created_by,created_by_name)
               VALUES (?,?,?,?,?,'prospect','active','[]','["other"]'::jsonb,?,?)`,
      [donorId, a.org_id, name, email, phone, sys.id, sys.name]);
  }
  const token = AC.randomToken();
  try {
    await withTransaction(async c => {
      await queryTx(c, `SELECT pg_advisory_xact_lock(hashtext(?))`, [`auction-bidders:${a.id}`]);
      const [n] = await queryTx(c, `SELECT COALESCE(MAX(bidder_number),100)+1 AS n FROM auction_bidders WHERE auction_id=?`, [a.id]);
      await runTx(c, `INSERT INTO auction_bidders (id,org_id,auction_id,donor_id,name,email,phone,bidder_number,token_hash,created_by,created_by_name)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ["aub_" + uuid().replace(/-/g, "").slice(0, 12), a.org_id, a.id, donorId, name, email, phone, n.n, AC.hashToken(token), sys.id, sys.name]);
    });
  } catch (e) {
    if (/uq_auction_bidders_email|unique/i.test(e.message)) return back("already");
    throw e;
  }
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
  res.setHeader("Set-Cookie", `${COOKIE_PREFIX}${a.id}=${encodeURIComponent(token)}; Path=/auction; Max-Age=${60 * 60 * 24 * 60}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  back("registered");
}));

// FIX-20 Part 6: SIGNING IN ON A SECOND DEVICE, by the same kind of link the
// donor portal sends: one use, fifteen minutes, stored hashed in
// portal_magic_links (purpose auction:<id>, so it opens this auction and
// nothing else), superseded by a new request. The answer is the same whether
// or not the email is registered, and the send happens after the response.
app.post("/auction/:slug/signin-link", express.urlencoded({ extended: false }), portalLinkIpLimiter, portalLinkEmailLimiter, wrap(async (req, res) => {
  const a = await publicAuction(req.params.slug);
  if (!a) return res.status(404).send("Not found");
  const self = `/auction/${encodeURIComponent(a.public_slug)}`;
  res.redirect(303, `${self}?m=link_sent#signin`);
  const email = cleanText(req.body?.email, 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  (async () => {
    const [b] = await query(`SELECT id, name, email FROM auction_bidders WHERE auction_id=? AND org_id=? AND LOWER(email)=?`, [a.id, a.org_id, email]);
    if (!b) return;
    const purpose = `auction:${a.id}`;
    await run(`UPDATE portal_magic_links SET superseded_at=NOW()
                WHERE org_id=? AND email=? AND used_at IS NULL AND superseded_at IS NULL AND purpose=?`, [a.org_id, email, purpose]);
    const token = AC.randomToken();
    await run(`INSERT INTO portal_magic_links (id,org_id,email,token_hash,expires_at,requested_ip,purpose)
               VALUES (?,?,?,?, NOW() + INTERVAL '15 minutes', ?, ?)`,
      ["pml_" + uuid().slice(0, 10), a.org_id, email, AC.hashToken(token), req.ip || null, purpose]);
    const decision = await donorMailDecision("auction_signin", email, a.org_id);
    if (!decision.send) { console.log(`[auction] sign-in link refused (${decision.reason})`); return; }
    if (!process.env.RESEND_API_KEY) return;
    const brand = await resolveOrgBrandTheme(a.org_id).catch(() => null);
    const orgName = (brand && brand.displayName) || "the organisation";
    const url = `${publicAppUrl()}${self}/signin#token=${encodeURIComponent(token)}`;   // a fragment never rides a Referer
    const PPm = await PP_READY;
    const e = PPm.escapeHtml;
    const out = await resend.emails.send({
      ...(await donorSendOpts(a.org_id, email, "auction_signin")),
      to: email,
      subject: `Your sign-in link for ${a.title}`,
      html: `${await brandEmailHeaderHtml(a.org_id)}<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#0F1A12">
        <p>Hello ${e(firstName(b.name))},</p>
        <p>Here is your sign-in link for ${e(a.title)}, so you can bid from this device too. It works once, for the next fifteen minutes.</p>
        <p><a href="${e(url)}" style="display:inline-block;background:#0D5C3A;color:#FFFFFF;padding:12px 20px;border-radius:6px;text-decoration:none">Sign in to bid</a></p>
        <p style="font-size:14px">If you did not ask for this, nothing has happened and you can ignore it. ${e(orgName)} never asks for a password.</p>
      </div>`,
      text: `Hello ${firstName(b.name)},\n\nHere is your sign-in link for ${a.title}. It works once, for the next fifteen minutes.\n\n${url}\n\nIf you did not ask for this, nothing has happened and you can ignore it.`,
    });
    if (out && out.error) console.error("[auction] sign-in link refused by the provider:", out.error.message);
  })().catch(err => console.error("[auction] sign-in link failed:", err.message));
}));

// The link lands here. A GET writes nothing: the page reads the token from the
// fragment and the person presses the button, which POSTs it.
app.get("/auction/:slug/signin", donateLimiter, wrap(async (req, res) => {
  await PP_READY;
  res.setHeader("Cache-Control", "no-store");
  const a = await publicAuction(req.params.slug);
  if (!a) return res.status(404).send(NOT_FOUND());
  const esc = PP.escapeHtml;
  const brand = await resolveOrgBrandTheme(a.org_id).catch(() => null) || { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
  const self = `/auction/${encodeURIComponent(a.public_slug)}`;
  res.send(page({ title: `Sign in · ${a.title}`, brand, body: `
    <div class="card">
      <h1>Bid from this device</h1>
      <p class="muted">${esc(a.title)}</p>
      <form method="post" action="${self}/signin">
        <input type="hidden" name="token" data-token>
        <button class="btn" type="submit">Sign in on this device</button>
      </form>
    </div>
    <script>(function(){var m=/token=([^&]+)/.exec(location.hash||"");var i=document.querySelector("[data-token]");
      if(m&&i){i.value=decodeURIComponent(m[1]);history.replaceState(null,"",location.pathname);}})();</script>` }));
}));

app.post("/auction/:slug/signin", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  const a = await publicAuction(req.params.slug);
  if (!a) return res.status(404).send("Not found");
  const self = `/auction/${encodeURIComponent(a.public_slug)}`;
  const token = String(req.body?.token || "");
  if (!token || token.length > 300) return res.redirect(303, `${self}?m=link_bad#signin`);
  const [used] = await query(
    `UPDATE portal_magic_links SET used_at=NOW()
      WHERE token_hash=? AND org_id=? AND purpose=? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > NOW()
      RETURNING email`, [AC.hashToken(token), a.org_id, `auction:${a.id}`]);
  const [b] = used ? await query(`SELECT id, name, bidder_number FROM auction_bidders WHERE auction_id=? AND org_id=? AND LOWER(email)=LOWER(?)`,
    [a.id, a.org_id, used.email]) : [];
  if (!b) return res.redirect(303, `${self}?m=link_bad#signin`);
  const device = AC.randomToken();
  await run(`INSERT INTO auction_bidder_devices (id,org_id,bidder_id,token_hash,created_by,created_by_name) VALUES (?,?,?,?,?,?)`,
    ["abd_" + uuid().replace(/-/g, "").slice(0, 12), a.org_id, b.id, AC.hashToken(device), AC.SYS_PUBLIC.id, `Bidder #${b.bidder_number}, ${b.name}`]);
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
  res.setHeader("Set-Cookie", `${COOKIE_PREFIX}${a.id}=${encodeURIComponent(device)}; Path=/auction; Max-Age=${60 * 60 * 24 * 60}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  res.redirect(303, `${self}?m=signed_in`);
}));

// THE BID. Decided inside one transaction that locks the item row, by the
// database clock, so the high bid is always one bid and a bid at or after the
// close is refused to the second. The response is a 303 back to the page.
app.post("/auction/:slug/bid", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  const a = await publicAuction(req.params.slug);
  if (!a) return res.status(404).send("Not found");
  const itemId = String(req.body?.itemId || "");
  const self = `/auction/${encodeURIComponent(a.public_slug)}`;
  const back = code => res.redirect(303, `${self}?m=${code}#i-${encodeURIComponent(itemId)}`);
  const bidder = await bidderFor(req, a);
  if (!bidder) return back("register_first");
  const buyNow = String(req.body?.buyNow || "") === "1";
  let amountC = null;
  if (!buyNow) {
    amountC = AC.cents(String(req.body?.amount || "").replace(/[$,\s]/g, ""));
    if (amountC == null || amountC <= 0) return back("bad_amount");
    if (amountC > AC.BID_MAX_CENTS) return back("too_high");
  }
  const outcome = await withTransaction(async c => {
    const [it] = await queryTx(c,
      `SELECT i.id, i.starting_bid::text AS starting_bid, i.bid_increment::text AS bid_increment, i.buy_now::text AS buy_now,
              (LEAST(au.closes_at, COALESCE(i.closed_at, au.closes_at)) <= clock_timestamp()) AS closed,
              (au.opens_at > clock_timestamp()) AS not_open
         FROM auction_items i JOIN auctions au ON au.id=i.auction_id AND au.org_id=i.org_id
        WHERE i.id=? AND i.auction_id=? AND i.org_id=? FOR UPDATE OF i`, [itemId, a.id, a.org_id]);
    if (!it) return "no_item";
    if (it.not_open) return "not_open";
    if (it.closed) return "closed";
    const [top] = await queryTx(c,
      `SELECT amount::text AS amount FROM auction_bids WHERE item_id=? AND org_id=? ORDER BY amount DESC, created_at ASC, id ASC LIMIT 1`,
      [it.id, a.org_id]);
    const high = top ? AC.cents(top.amount) : null;
    const minNext = AC.minNextBidCents({ ...it, high_amount: top ? top.amount : null });
    const buyNowC = AC.cents(it.buy_now);
    let amount = amountC, isBuyNow = false;
    if (buyNow) {
      if (buyNowC == null || (high != null && high >= buyNowC)) return "no_buy_now";
      amount = buyNowC; isBuyNow = true;
    } else {
      if (amount < minNext) return "too_low";
      // A bid at or over the buy-now price IS buying it now, at that price.
      if (buyNowC != null && amount >= buyNowC && (high == null || high < buyNowC)) { amount = buyNowC; isBuyNow = true; }
    }
    await runTx(c, `INSERT INTO auction_bids (id,org_id,auction_id,item_id,bidder_id,amount,buy_now,created_by,created_by_name)
                    VALUES (?,?,?,?,?,?,?,?,?)`,
      ["abid_" + uuid().replace(/-/g, "").slice(0, 14), a.org_id, a.id, it.id, bidder.id, AC.dollars(amount), isBuyNow,
       AC.SYS_PUBLIC.id, `Bidder #${bidder.bidder_number}, ${bidder.name}`]);
    if (isBuyNow) await runTx(c, `UPDATE auction_items SET closed_at=clock_timestamp() WHERE id=? AND org_id=?`, [it.id, a.org_id]);
    return isBuyNow ? "bought" : "bid";
  });
  back(outcome);
}));

}

module.exports = { mount, routers };
