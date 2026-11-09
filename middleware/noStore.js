// middleware/noStore.js · LAG-1. NO READ OF AN ORG'S DATA IS KEPT ON THE WAY.
//
// The 8 Nov fleet measured, on production, confirmed changes that took 30 to
// 60 seconds to reach the totals. No GET said how long its answer could be
// kept, so nothing in the path (the browser's HTTP cache, a proxy, a CDN put
// in front of the API one day) was told it could not. Now every answer the
// API gives is `Cache-Control: no-store` unless its route says otherwise: the
// few that do (stock photos, a public embed, a signed asset, a public event
// page) set their own header after this, and theirs wins.
//
// Mounted above every router, beside the one audit write.
"use strict";

function noStore() {
  return function noStoreMw(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD") res.setHeader("Cache-Control", "no-store");
    next();
  };
}

module.exports = { noStore };
