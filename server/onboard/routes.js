// server/onboard/routes.js · ONBOARD-1. Paper and data in: the start link
// (startRoutes.js) and the verified import (verifyRoutes.js). Mounted from
// routes/billing.js, which hands over its ctx.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
routers.r1.use(require("./startRoutes").routers.r1);
routers.r1.use(require("./verifyRoutes").routers.r1);

function mount(ctx) {
  require("./startComplete").configure(ctx);
  require("./startRoutes").mount(ctx);
  require("./verifyRoutes").mount(ctx);
}

module.exports = { routers, mount };
