# SALES-6 · One link to send, a price tile that shows the open quote, and touches that count (26 Nov 2026)

**Why.** Jonathan walked CKRH's deal on 25 Nov, after SALES-5 shipped. The deal had two ways to a signature, SALES-3's
quote link ("Accept and sign", no card) and ORDER-1's order (read, sign, card, book), and he couldn't tell which to send.
The quote page showed the customer agreement's paper block ("Organization ____ / Signed ____") directly above the online
fields, so it read as two signatures. The Price tile said "$299/mo, the deal's value" while the quote he had sent said
$149. Last touch said "None yet" after weeks of email, because no sales mailbox had ever been connected and nothing said so.

**Reproduced** with real clicks on a local production build of main (`/ops` is super-admin only and the staging walker
is not one), on a made-up deal shaped like the walk: all four as described.

- **One action.** `server/admin/sales/sendToSign.js` makes ORDER-1's order from the newest quote. ORDER-1's insert moved
  into `orderRoutes.insertOrder` so the order number, token and row are made one way. The order gained a fixed start day
  (`order_json.startOn`; `orderFigures` takes the org's zone) and a list price line. An old unsigned quote link offers
  "Open your order", which makes the order under the quote's own token (a POST from her page; the link's GET writes
  nothing). `orderDeal.quoteSigned` marks the quote `ordered` when the order is signed.
- **The paper block.** `server/onboard/agreementBlock.js`: `bodyOf()` leaves the block out of every page and every order
  snapshot; both PDFs draw it filled. **How the hash treats it:** an order's hash (`snapshot_sha256`) is of the snapshot
  she saw, and that snapshot's agreement text has no block. A quote link made before SALES-6 keeps its stored text and
  `text_sha256` byte for byte (with the blank block); its page hides the block for display only, and the PDF says the
  hash is of the stored text. `legal/customer-agreement.md` and its version are unchanged, so signup's click-through
  hash is unchanged too.
- **The Price tile.** `customerPrice.pick()` now reads the newest open quote and when a price was signed, and returns
  `tile` and `line`. "Use $149 as the deal value" is one POST, actor-stamped by `records.update`; Undo is the value PATCH.
- **Touches.** No mailbox: the sentence on Last touch and Now, with the link; Sales settings shows the mailbox first.
  A mailbox keeps mail from 90 days before it was connected. A `/book` booking with a time is a meeting touch. A Calendly
  booking made on Calendly's own page does not reach Steward (no webhook), so it can't count; no integration was added.

**Existing rows.** None need repair. CKRH's unsigned quote opens the order flow as it is; its deal value stays $299
until Jonathan presses "Use $149 as the deal value". Quotes signed before stay accepted.

Tests: `tests/sales1-crm.test.js` §16 (13 checks, all red on main, green here; a planted defect, Steward's line left
out of the filled block, turns the PDF check red).
