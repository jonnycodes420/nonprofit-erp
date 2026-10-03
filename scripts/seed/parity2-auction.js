// scripts/seed/parity2-auction.js · PARITY-2 Part 4. HARBORLIGHT'S AUCTION.
//
// Twelve donated items, open now: bidding opened three days ago and closes in
// four. It belongs to the next UPCOMING gala if the demo has one, otherwise to
// the next upcoming event (the gala in the demo is months in the past, and a
// live auction cannot belong to an evening that is over), otherwise to nobody.
//
// Seven of the org's own supporters are registered to bid. Ten items have
// bids, several with a contest; two have none yet. No gift is written: the
// money arrives when a winner pays, and the in-kind gift for each donated item
// is a button the director presses, so the demo's totals are untouched.
//
// Called with ONE line from scripts/seed-demo.js main(). `q` takes $n params.
"use strict";
const crypto = require("crypto");

const ITEMS = [
  // title, category, fmv, start, increment, buyNow, description
  ["A week at the lake house", "Getaways", 1400, 600, 50, 2000, "Seven nights for six at a cabin on Lake Winnisook, the dock and canoe included. Dates by arrangement, May to October."],
  ["Chef's table for eight", "Dining", 900, 400, 25, null, "A five-course dinner cooked in your home by the chef at Saltworks, with wine pairings."],
  ["Harbor sunset sail", "Experiences", 450, 200, 25, 650, "Two hours on a 38-foot sloop for up to six people, skipper and snacks provided."],
  ["Signed team jersey", "Sports", 150, 75, 10, null, "Framed home jersey signed by the whole roster."],
  ["Watercolour: North Shore at dawn", "Art", 600, 250, 25, null, "Original watercolour, 18 by 24 inches, framed, by a local artist who taught in our studio program."],
  ["Family pass to the aquarium", "Experiences", 220, 90, 10, null, "A year's membership for two adults and up to four children."],
  ["Wine dinner for two", "Dining", 300, 120, 10, null, "Tasting menu and wine pairing at Marrow & Vine."],
  ["Ski weekend", "Getaways", 1100, 500, 50, null, "Two nights slopeside with lift tickets for two."],
  ["Photography session", "Experiences", 350, 150, 25, null, "An hour on location and twenty edited portraits."],
  ["Hand-thrown dinnerware set", "Art", 280, 100, 10, null, "Twelve pieces from the youth ceramics studio's teaching artist."],
  ["Golf for four", "Sports", 480, 200, 25, null, "Eighteen holes with carts at Bayview Links."],
  ["Cooking class for six", "Dining", 240, 100, 10, null, "A private evening class in fresh pasta, with dinner after."],
];
// Bids per item as [bidder index, amount] in the order they were placed.
const BIDS = [
  [[0, 600], [3, 650], [0, 700], [5, 800], [3, 850]],
  [[1, 400], [2, 425], [1, 475]],
  [[4, 200], [6, 225]],
  [[2, 75], [5, 85], [2, 95], [6, 105]],
  [[3, 250]],
  [[0, 90], [1, 100]],
  [],
  [[5, 500], [4, 550]],
  [[6, 150]],
  [],
  [[1, 200], [3, 225], [1, 250]],
  [[2, 100], [4, 110]],
];

async function seedParity2Auction(q, { ORG }) {
  const [ev] = await q(
    `SELECT id, name FROM events WHERE org_id=$1 AND status <> 'cancelled' AND date >= CURRENT_DATE
      ORDER BY (name ILIKE '%gala%') DESC, date ASC LIMIT 1`, [ORG]);
  const people = await q(
    `SELECT id, name, email, phone FROM donors
      WHERE org_id=$1 AND deleted_at IS NULL AND email IS NOT NULL AND email <> ''
        AND COALESCE(kind,'') NOT IN ('organisation','anonymous') AND COALESCE(deceased,false) = false
      ORDER BY total_giving DESC, id OFFSET 30 LIMIT 25`, [ORG]);
  if (people.length < 19) { console.log("[seed] auction: not enough people on file, skipped"); return; }
  const givers = people.slice(0, 12), bidders = people.slice(12, 19);

  const id = "auc_b72_spring";
  const title = ev ? `${ev.name} online auction` : "Spring online auction";
  await q(`INSERT INTO auctions (id,org_id,event_id,title,description,public_slug,opens_at,closes_at,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,$5,'harborlight-auction-b72',NOW() - INTERVAL '3 days',NOW() + INTERVAL '4 days','u_b72demo','Dana Reyes')`,
    [id, ORG, ev ? ev.id : null, title,
     "Every item was given by a friend of Harborlight. Every dollar over an item's value goes to the after-school studio and scholarships."]);

  const bidderIds = [];
  for (let i = 0; i < bidders.length; i++) {
    const b = bidders[i], bid = `aub_b72_${i + 1}`;
    bidderIds.push(bid);
    await q(`INSERT INTO auction_bidders (id,org_id,auction_id,donor_id,name,email,phone,bidder_number,token_hash,created_at,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() - ($10 || ' hours')::interval,'system:auction-public','The bidder, from the auction page')`,
      [bid, ORG, id, b.id, b.name, b.email, b.phone || "555-0100", 101 + i,
       crypto.createHash("sha256").update(crypto.randomBytes(24)).digest("hex"), String(70 - i * 3)]);
  }
  let n = 0;
  for (let i = 0; i < ITEMS.length; i++) {
    const [t, cat, fmv, start, inc, buyNow, desc] = ITEMS[i];
    const item = `aui_b72_${String(i + 1).padStart(2, "0")}`;
    await q(`INSERT INTO auction_items (id,org_id,auction_id,title,description,category,donor_id,fmv,starting_bid,bid_increment,buy_now,position,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'u_b72demo','Dana Reyes')`,
      [item, ORG, id, t, desc, cat, givers[i].id, fmv, start, inc, buyNow, i + 1]);
    const bids = BIDS[i];
    for (let k = 0; k < bids.length; k++) {
      const [who, amount] = bids[k];
      // Placed over the three days the auction has been open, oldest first.
      const hoursAgo = 66 - i * 4 - k * 3;
      await q(`INSERT INTO auction_bids (id,org_id,auction_id,item_id,bidder_id,amount,created_at,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,$6,NOW() - ($7 || ' hours')::interval,'system:auction-public',$8)`,
        [`abid_b72_${++n}`, ORG, id, item, bidderIds[who], amount, String(Math.max(1, hoursAgo)),
         `Bidder #${101 + who}, ${bidders[who].name}`]);
    }
  }
  console.log(`[seed] auction: "${title}", 12 items, ${bidders.length} bidders, ${n} bids, closes in four days`);
}

module.exports = { seedParity2Auction };
