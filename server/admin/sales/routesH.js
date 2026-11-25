// server/admin/sales/routesH.js · ORDER-1 item 4. THE DEAL'S ORDERS.
//
// Behind the /ops door (super-admins only):
//   GET /ops/sales/deals/:id/orders   every order raised on this deal: number, version, state,
//                                     who signed and when, the first charge; the PDF opens from
//                                     GET /admin/start-links/:id/pdf (server/onboard/orderRoutes.js)
"use strict";

function mount(app, { query, wrap, door, salesLimiter }) {
  app.get("/ops/sales/deals/:id/orders", salesLimiter, door, wrap(async (req, res) => {
    const rows = await query(`SELECT l.id, l.order_number, l.order_version, l.status, l.expires_at, l.created_at, l.created_by_name, l.sent_at, l.copy_sent_at,
        g.signer_name, g.signer_title, g.signed_at, g.terms_version, g.snapshot->'total'->>'label' AS first_charge, g.snapshot->'total'->>'amount' AS first_amount
        FROM start_links l LEFT JOIN order_signatures g ON g.start_link_id = l.id
       WHERE l.deal_id = ? AND l.order_json IS NOT NULL ORDER BY l.created_at DESC`, [req.params.id]);
    res.json({ ok: true, orders: rows.map(r => ({ ...r, state: require("../../onboard/startLink").linkState(r),
      stamp: r.signed_at ? require("../../onboard/order").signedStamp(r.signer_name, r.signed_at) : null })) });
  }));
}

module.exports = { mount };
