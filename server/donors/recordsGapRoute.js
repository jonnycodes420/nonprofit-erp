// server/donors/recordsGapRoute.js · FLOWS-10 item 14 (Area 5 Explore 5). GET /billing/records-gap.
// Why Billing's Records and the Donors tab are two numbers, as one line Billing shows under Records,
// and the people marked Donor with no gift as a figure that opens (recordsGapSources.js). The rule is
// shared/numbers/recordsGap.js's. Its own module: routes/billing.js is at its size limit.
"use strict";
const express = require("express");
const RG = require("../../shared/numbers/recordsGap");

const routers = { r1: express.Router() };

function mount(ctx) {
  const { query, requireAuth, wrap } = ctx;
  routers.r1.get("/billing/records-gap", requireAuth, wrap(async (req, res) => {
    // FLOWS-15 item 5: Records, the Donors tab and every part between them, in one read (shared/numbers/recordsGap.js).
    const [row] = await query(RG.countsSql(), [req.user.orgId]);
    const gap = RG.gapOf(row);
    res.json({ ...gap, sentence: RG.gapSentence(gap), source: gap.markedNoGift ? { key: "marked-donor-no-gift", params: {} } : null });
  }));
}

module.exports = { routers, mount };
