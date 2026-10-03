// auctionCore.js · PARITY-2 Part 4. THE ONE DEFINITION OF AN AUCTION'S STATE.
//
// Who is winning, whether an item is closed, what the next bid must be and
// what part of a winning bid is deductible are each decided HERE, once, and
// read by the staff screen, the public page, the pay page, the checkout, the
// webhook and the figure sources. Two of those disagreeing about who won is
// the one failure an auction cannot have.
//
//   · THE WINNER is the highest bid; between equal amounts, the EARLIEST
//     (created_at, then id). Computed at read time from the bids, never
//     stored, so a closed auction cannot disagree with its own bids.
//   · CLOSED means the database clock has reached the auction's closing time,
//     or the item was bought outright (`closed_at`), whichever came first.
//   · THE DEDUCTIBLE PART of a winning bid is the amount over the item's fair
//     market value (never below zero). The receipt states it through
//     recordGift's quid pro quo split, exactly as an event ticket does.
//   · A PAY LINK is the item id and an HMAC of (item, winning bid) under the
//     server secret. Nothing is stored, so there is no token at rest to read;
//     a link stops working if the winning bid it names is no longer the
//     winner. Unguessable without the secret.
//
// CommonJS at the root, like money.js and groups.js, because give.js and the
// webhook need it synchronously.
"use strict";

const crypto = require("crypto");
const money = require("./money");

const SYS_PUBLIC = { id: "system:auction-public", name: "The bidder, from the auction page" };
const SYS_PAY = { id: "system:auction-pay", name: "The winner, from the pay page" };
const BID_MAX_CENTS = 100000000;   // $1,000,000: a typo guard, not a business rule

// The top bid on every item of one auction, by the one ordering.
// Arguments: orgId, auctionId.
const TOP_BIDS_SQL = `
  SELECT DISTINCT ON (b.item_id) b.item_id, b.id AS bid_id, b.bidder_id, b.amount, b.created_at, b.buy_now
    FROM auction_bids b
   WHERE b.org_id = ? AND b.auction_id = ?
   ORDER BY b.item_id, b.amount DESC, b.created_at ASC, b.id ASC`;

// Every item of one auction with its high bid, its bid count and whether it
// is closed (by the DATABASE clock). Arguments: orgId, auctionId (x2).
const ITEM_STATE_SQL = `
  WITH top AS (${TOP_BIDS_SQL}),
       n AS (SELECT item_id, COUNT(*)::int AS bids FROM auction_bids WHERE org_id = ? AND auction_id = ? GROUP BY item_id)
  SELECT i.id, i.auction_id, i.title, i.description, i.category, i.photos, i.donor_id,
         i.fmv::text AS fmv, i.starting_bid::text AS starting_bid, i.bid_increment::text AS bid_increment,
         i.buy_now::text AS buy_now, i.position, i.closed_at, i.in_kind_gift_id, i.paid_gift_id, i.paid_at, i.paid_payment_id,
         dd.name AS donor_name,
         top.bid_id, top.bidder_id, top.amount::text AS high_amount, top.created_at AS high_at, top.buy_now AS bought_now,
         bd.name AS bidder_name, bd.email AS bidder_email, bd.bidder_number, bd.donor_id AS bidder_donor_id,
         COALESCE(n.bids, 0) AS bid_count,
         (LEAST(a.closes_at, COALESCE(i.closed_at, a.closes_at)) <= NOW()) AS closed,
         (a.opens_at > NOW()) AS not_open
    FROM auction_items i
    JOIN auctions a ON a.id = i.auction_id AND a.org_id = i.org_id
    LEFT JOIN top ON top.item_id = i.id
    LEFT JOIN n ON n.item_id = i.id
    LEFT JOIN auction_bidders bd ON bd.id = top.bidder_id AND bd.org_id = i.org_id
    LEFT JOIN donors dd ON dd.id = i.donor_id AND dd.org_id = i.org_id
   WHERE i.org_id = ? AND i.auction_id = ?
   ORDER BY i.position, i.created_at, i.id`;

async function itemStates(query, orgId, auctionId) {
  return query(ITEM_STATE_SQL, [orgId, auctionId, orgId, auctionId, orgId, auctionId]);
}

const cents = v => (v === null || v === undefined || v === "" ? null : money.toCents(String(v)));
const dollars = c => money.toDollars(c);

// The least the next bid may be: the starting bid with no bids, otherwise the
// high bid plus the increment.
function minNextBidCents(item) {
  const high = cents(item.high_amount != null ? item.high_amount : null);
  const start = cents(item.starting_bid ?? item.startingBid);
  const inc = cents(item.bid_increment ?? item.bidIncrement);
  return high == null ? start : high + inc;
}

// The part of a winning bid that is deductible: the amount over fair market
// value, never below zero. Integer cents in, integer cents out.
function deductibleCents(amountCents, fmvCents) {
  return Math.max(0, amountCents - Math.min(fmvCents, amountCents));
}

// What the receipt says the winner received, in the quid pro quo line.
function quidProQuoDesc(item) {
  const fmv = cents(item.fmv) || 0;
  return `Auction item "${String(item.title || "").slice(0, 200)}", fair market value ${fmtMoney(fmv)}`;
}

function fmtMoney(c) {
  const n = (Number(c) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// The sentence a bidder reads under an item.
function deductibleSentence(item) {
  const fmv = cents(item.fmv) || 0;
  if (fmv <= 0) return "The whole winning bid is tax deductible: the organisation puts no value on what you receive.";
  return `Its fair market value is ${fmtMoney(fmv)}, so only what you bid over ${fmtMoney(fmv)} is tax deductible.`;
}

// ── TOKENS ────────────────────────────────────────────────────────────────
const randomToken = () => crypto.randomBytes(24).toString("base64url");
const hashToken = t => crypto.createHash("sha256").update(String(t || "")).digest("hex");

function paySecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set; an auction pay link cannot be signed");
  return s;
}
function payMac(itemId, bidId) {
  return crypto.createHmac("sha256", paySecret()).update(`auction-pay|${itemId}|${bidId}`).digest("base64url").slice(0, 32);
}
function payToken(itemId, bidId) { return `${itemId}.${payMac(itemId, bidId)}`; }

// The item and its winner for a pay token, or null. A token is good only
// while the bid it was signed for is still the winning bid of a CLOSED item.
async function resolvePayToken(query, token) {
  const m = /^(aui_[A-Za-z0-9]{6,40})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ""));
  if (!m) return null;
  const [item] = await query(`SELECT org_id, auction_id FROM auction_items WHERE id = ?`, [m[1]]);
  if (!item) return null;
  const states = await itemStates(query, item.org_id, item.auction_id);
  const st = states.find(s => s.id === m[1]);
  if (!st || !st.closed || !st.bid_id) return null;
  const want = Buffer.from(payMac(st.id, st.bid_id));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const [auction] = await query(`SELECT * FROM auctions WHERE id = ? AND org_id = ?`, [item.auction_id, item.org_id]);
  return auction ? { orgId: item.org_id, auction, item: st } : null;
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "auction";
}

module.exports = {
  SYS_PUBLIC, SYS_PAY, BID_MAX_CENTS, TOP_BIDS_SQL, ITEM_STATE_SQL,
  itemStates, minNextBidCents, deductibleCents, quidProQuoDesc, deductibleSentence, fmtMoney,
  cents, dollars, randomToken, hashToken, payToken, resolvePayToken, slugify,
};
