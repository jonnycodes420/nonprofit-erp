// server/events/auctionImport.js · ASKS-1 item 3. THE ITEMS AN AUCTION SHEET BOUGHT.
//
// The sheet's purchases are gifts (routes/sheetImport.js writes them through
// recordGifts, type "auction", with the item's value as quid_pro_quo_value).
// This places the items they bought in the event's auction, so the Auctions
// screen and the gifts agree:
//   · the event's auction is the newest one linked to it; with none, one is
//     made for it, ALREADY CLOSED (closes at the event's day or now, whichever
//     is earlier), so its public page can never take a bid on a sold item
//   · an item is matched by its name in that auction (case and spacing aside),
//     or made with the sheet's value as its fair market value
//   · each item is marked paid by the gift that bought it, once; an item
//     already marked paid keeps the gift it had
// IMPORT-10 item 7: each placed purchase is a SOLD item with its winner: the
// gift's donor as the auction's bidder (found by donor or email, or made) and
// a winning bid of what was paid, on an item with no bid yet. Won, Items sold
// and Bidders read bids (figureSources auctionWinsSql), as Raised reads the
// paid gift; before this build an imported auction said Raised $57,934 beside
// Won $0, Items sold 0, Bidders 0. A winner with no email gets a bidder address
// that can never receive mail (…@import.invalid): a bidder row needs one, and
// nothing is ever sent to an imported, paid winner.
// What the import MADE carries its run (import_id), so Undo removes it with
// the gifts (server/imports/undo.js). With no event chosen, no auction is
// touched: the gifts still carry the item and its value, and the import's
// receipt says the items were not placed.
"use strict";

const key = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

// written: [{ giftId, item, fmvCents, cents }] in the order the sheet gave them.
async function placeAuctionItems({ query, run, newId, randomHex }, orgId, { eventId, importId, who, written }) {
  const out = { placed: 0, made: 0, matched: 0, auctionId: null, auctionMade: false, eventId: eventId || null };
  if (!written.length) return out;
  if (!eventId) { out.notPlaced = written.length; return out; }
  const AC = require("../../auctionCore");
  const [ev] = await query("SELECT id, name, LEFT(date::text, 10) AS day FROM events WHERE id=? AND org_id=?", [eventId, orgId]);
  if (!ev) { out.notPlaced = written.length; return out; }
  let [auc] = await query(`SELECT id FROM auctions WHERE org_id=? AND event_id=? ORDER BY (status='active') DESC, created_at DESC LIMIT 1`, [orgId, eventId]);
  if (!auc) {
    const id = newId("auc");
    const title = `${String(ev.name || "Event").slice(0, 180)} auction`;
    // closed already: the end of the event's day or now, whichever came first
    await run(`INSERT INTO auctions (id,org_id,event_id,title,public_slug,opens_at,closes_at,created_by,created_by_name,import_id)
               VALUES (?,?,?,?,?, LEAST(COALESCE(?::date + interval '23 hours 59 minutes', NOW()), NOW()) - interval '4 hours',
                       LEAST(COALESCE(?::date + interval '23 hours 59 minutes', NOW()), NOW()),?,?,?)`,
      [id, orgId, eventId, title, `${AC.slugify(title)}-${randomHex(6)}`, ev.day || null, ev.day || null, who.id, who.name, importId]);
    auc = { id };
    out.auctionMade = true;
  }
  out.auctionId = auc.id;
  const placedItems = [];   // [{ itemId, giftId, cents }]
  const have = await query(`SELECT id, title, paid_gift_id FROM auction_items WHERE org_id=? AND auction_id=? AND retired_at IS NULL ORDER BY position, created_at`, [orgId, auc.id]);
  const byName = new Map();
  for (const i of have) if (!byName.has(key(i.title))) byName.set(key(i.title), i);
  const [pos] = await query(`SELECT COALESCE(MAX(position),0) AS p FROM auction_items WHERE org_id=? AND auction_id=?`, [orgId, auc.id]);
  let position = Number(pos.p) || 0;
  for (const w of written) {
    const k = key(w.item);
    const found = byName.get(k);
    if (found) {
      // the first gift for a matched item marks it paid; a second purchase of the same name is its own item
      if (!found.paid_gift_id && !found.claimedHere) {
        await run(`UPDATE auction_items SET paid_gift_id=?, paid_at=NOW(), closed_at=COALESCE(closed_at, NOW()), updated_at=NOW()
                    WHERE id=? AND org_id=? AND paid_gift_id IS NULL`, [w.giftId, found.id, orgId]);
        found.claimedHere = true; out.matched++; out.placed++;
        placedItems.push({ itemId: found.id, giftId: w.giftId, cents: w.cents });
        continue;
      }
    }
    const id = newId("aui");
    const paid = Math.max(1, w.cents) / 100;
    await run(`INSERT INTO auction_items (id,org_id,auction_id,title,fmv,starting_bid,bid_increment,position,closed_at,paid_gift_id,paid_at,created_by,created_by_name,import_id)
               VALUES (?,?,?,?,?,?,?,?,NOW(),?,NOW(),?,?,?)`,
      [id, orgId, auc.id, String(w.item).slice(0, 200), (w.fmvCents || 0) / 100, paid, 1, ++position, w.giftId, who.id, who.name, importId]);
    if (!found) byName.set(k, { id, title: w.item, paid_gift_id: w.giftId });
    out.made++; out.placed++;
    placedItems.push({ itemId: id, giftId: w.giftId, cents: w.cents });
  }
  out.won = await recordWinners({ query, run, newId }, orgId, auc.id, { importId, who, placedItems });
  return out;
}

// IMPORT-10 item 7: the winner and the winning bid of each placed purchase.
async function recordWinners({ query, run, newId }, orgId, auctionId, { importId, who, placedItems }) {
  if (!placedItems.length) return 0;
  const AC = require("../../auctionCore");
  const donors = new Map((await query(`SELECT g.id AS gift_id, d.id, d.name, d.email, d.phone FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                                        WHERE g.org_id=? AND g.id = ANY(?::text[])`, [orgId, placedItems.map(p => p.giftId)])).map(r => [r.gift_id, r]));
  const bidded = new Set((await query(`SELECT DISTINCT item_id FROM auction_bids WHERE org_id=? AND item_id = ANY(?::text[])`, [orgId, placedItems.map(p => p.itemId)])).map(r => r.item_id));
  const [{ closes }] = await query(`SELECT closes_at AS closes FROM auctions WHERE id=? AND org_id=?`, [auctionId, orgId]);
  const bidAt = new Date(Math.min(Date.now(), new Date(closes || Date.now()).getTime()) - 60000).toISOString();   // a bid lands before the close
  const bidderOf = new Map();
  let won = 0;
  for (const p of placedItems) {
    const d = donors.get(p.giftId);
    if (!d || bidded.has(p.itemId)) continue;
    const email = String(d.email || "").trim().toLowerCase() || `no-email+${d.id}@import.invalid`;
    let bidderId = bidderOf.get(d.id);
    if (!bidderId) {
      const [b] = await query(`SELECT id FROM auction_bidders WHERE auction_id=? AND org_id=? AND (donor_id=? OR LOWER(email)=?) ORDER BY (donor_id=?) DESC LIMIT 1`,
        [auctionId, orgId, d.id, email, d.id]);
      bidderId = b ? b.id : newId("aub");
      if (!b) {
        const [n] = await query(`SELECT COALESCE(MAX(bidder_number),100)+1 AS n FROM auction_bidders WHERE auction_id=?`, [auctionId]);
        await run(`INSERT INTO auction_bidders (id,org_id,auction_id,donor_id,name,email,phone,bidder_number,token_hash,created_by,created_by_name,import_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [bidderId, orgId, auctionId, d.id, d.name, email, d.phone || null, n.n, AC.hashToken(AC.randomToken()), who.id, who.name, importId]);
      }
      bidderOf.set(d.id, bidderId);
    }
    await run(`INSERT INTO auction_bids (id,org_id,auction_id,item_id,bidder_id,amount,buy_now,created_at,created_by,created_by_name,import_id)
               VALUES (?,?,?,?,?,?,false,?,?,?,?)`,
      [newId("abid"), orgId, auctionId, p.itemId, bidderId, Math.max(1, p.cents) / 100, bidAt, who.id, who.name, importId]);
    bidded.add(p.itemId);
    won++;
  }
  return won;
}

// Undo: the items and the auction this import made go; an item that was
// already there is only unmarked, once its gift is gone.
async function undoAuctionItems({ run }, orgId, importId) {
  // IMPORT-10: the winning bids and the bidders this run made go first
  await run(`DELETE FROM auction_bids WHERE org_id=? AND import_id=?`, [orgId, importId]);
  await run(`DELETE FROM auction_bidders bd WHERE bd.org_id=? AND bd.import_id=?
               AND NOT EXISTS (SELECT 1 FROM auction_bids b WHERE b.bidder_id = bd.id)`, [orgId, importId]);
  await run(`DELETE FROM auction_items i WHERE i.org_id=? AND i.import_id=?
               AND NOT EXISTS (SELECT 1 FROM auction_bids b WHERE b.item_id = i.id)`, [orgId, importId]);
  await run(`UPDATE auction_items i SET paid_gift_id=NULL, paid_at=NULL, updated_at=NOW()
              WHERE i.org_id=? AND i.paid_gift_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = i.paid_gift_id AND g.org_id = i.org_id)`, [orgId]);
  await run(`DELETE FROM auctions a WHERE a.org_id=? AND a.import_id=?
               AND NOT EXISTS (SELECT 1 FROM auction_items i WHERE i.auction_id = a.id)`, [orgId, importId]);
}

module.exports = { placeAuctionItems, undoAuctionItems, recordWinners };
