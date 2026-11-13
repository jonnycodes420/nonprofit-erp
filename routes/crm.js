// routes/crm.js — where the CRM's routes are mounted. SPLIT-1 moved them out.
//
// SPLIT-1: the 561 routes that lived here, and the helpers only they used,
// were moved VERBATIM into server/<domain>/ (events, grants, outreach,
// imports, tasks, reports, majorGifts, memberships, org, donors), and the
// helpers more than one domain reads into server/shared/. Nothing in them
// changed. A new route goes in its domain's file, never here
// (docs/architecture/ARCHITECTURE.md; scripts/ci/arch-check.js counts them).
//
// How it is wired, so it behaves exactly as the one file did:
//   * server.js still mounts routers.r0 and routers.r1 at the same two places.
//     Each module's routers sit inside them in the order below, which keeps
//     every pair of routes that can answer the same request in the order it
//     had (scripts/ci/route-diff.js checks it against main).
//   * server.js still calls mount() once, at the end of boot. It mounts the
//     helper modules first, each after the ones it reads, then the routes.
//   * giftHooks and reportHooks are still exported from here, filled by the
//     modules that hold those functions.
const express = require("express");

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};
const giftHooks = {};
// FIX-2 D — the one way another module runs a report: the SAME handler and
// params GET /reports/:key uses, so Agent's count is the report's count.
const reportHooks = {};

// SPLIT-1 — the helpers more than one module reads, mounted first, each after
// the ones it reads; then the route modules. Each mount() hands back what
// the others read, and the next one finds it on ctx.
const HELPERS = [
  "../server/shared/crmCommon",
  "../server/imports/helpers",
  "../server/donors/helpers",
  "../server/org/helpers",
  "../server/reports/bookkeeperReports",
  "../server/shared/grantMilestones",
  "../server/reports/handlers",
  "../server/reports/helpers",
  "../server/shared/trash",
  "../server/majorGifts/helpers",
  "../server/shared/journeyStart",
  "../server/outreach/helpers",
  "../server/grants/helpers",
  "../server/shared/auditLog",
  "../server/shared/givingPagePayload",
  "../server/shared/csv",
  "../server/shared/milestoneDrafts",
  "../server/events/helpers",
  "../server/shared/chequeImage",
];
const MODULES = [
  "../server/donors/gifts",
  "../server/donors/interactions",
  "../server/donors/people",
  "../server/donors/records",
  "../server/donors/relationships",
  "../server/donors/routes",
  "../server/events/eventGifts",
  "../server/events/publicPage",
  "../server/events/routes",
  "../server/grants/funders",
  "../server/grants/routes",
  "../server/imports/combined",
  "../server/imports/gifts",
  "../server/imports/recentGifts",
  "../server/imports/routes",
  "../server/imports/undo",
  "../server/majorGifts/plans",
  "../server/majorGifts/routes",
  "../server/majorGifts/top100",   // TOP100-1
  "../server/memberships/routes",
  "../server/org/data",
  "../server/org/integrations",
  "../server/org/me",
  "../server/org/menu",   // NAV-1 (menu): the org's sidebar and Major Gifts tabs
  "../server/org/morningEmail",   // TIDY-1
  "../server/org/publicPages",
  "../server/org/routes",
  "../server/org/invites",   // WALKB-2
  "../server/drafts/dismiss",   // COMMS-1
  "../server/finance/fundMerge",   // TRUTH-3: funds are a managed list
  "../server/receipts/list",   // TRUTH-3: every issued receipt
  "../server/receipts/drift",   // PLEDGES-3: void and reissue a receipt whose gift changed
  "../server/org/switchOrg",   // ACCESS-1
  "../server/events/eventRemoval",   // WALKB-2
  "../server/donors/recordsGapRoute",   // FLOWS-10: Billing's records gap
  "../server/volunteers/shiftRules",   // STALE-2: a bare draft shift deletes
  "../server/outreach/autoSend",
  "../server/outreach/rename",   // POLISH-8: rename a campaign or template in place
  "../server/outreach/journeys",
  "../server/outreach/routes",
  "../server/outreach/thanks",
  "../server/reports/boardPack",
  "../server/reports/dashboard",
  "../server/reports/fundraising",
  "../server/reports/impact",
  "../server/reports/routes",
  "../server/tasks/routes",
];

// The order Express tries them in. Two routes that can answer the same
// request keep the order they had in one file; scripts/ci/route-diff.js
// checks it against main.
routers.r0.use(require("../server/outreach/routes").routers.r0);
routers.r0.use(require("../server/org/routes").routers.r0);
routers.r0.use(require("../server/outreach/thanks").routers.r0);
routers.r0.use(require("../server/donors/gifts").routers.r0);
routers.r1.use(require("../server/org/me").routers.r1);
routers.r1.use(require("../server/org/menu").routers.r1);   // NAV-1 (menu)
routers.r1.use(require("../server/org/morningEmail").routers.r1);   // TIDY-1: preview and test the morning email
routers.r1.use(require("../server/org/routes").routers.r1);
routers.r1.use(require("../server/org/invites").routers.r1);   // WALKB-2: pending invites
routers.r1.use(require("../server/drafts/dismiss").routers.r1);   // COMMS-1: every draft can be dismissed
routers.r1.use(require("../server/finance/fundMerge").routers.r1);   // TRUTH-3: merge near-duplicate funds, with Undo
routers.r1.use(require("../server/receipts/list").routers.r1);   // TRUTH-3: Tax Receipts lists every receipt
routers.r1.use(require("../server/receipts/drift").routers.r1);   // PLEDGES-3: POST /receipts/:id/reissue
routers.r1.use(require("../server/org/switchOrg").routers.r1);   // ACCESS-1: the org switcher
routers.r1.use(require("../server/reports/dashboard").routers.r1);
routers.r1.use(require("../server/reports/boardPack").routers.r1);
routers.r1.use(require("../server/reports/routes").routers.r1);
routers.r1.use(require("../server/org/data").routers.r1);
routers.r1.use(require("../server/donors/routes").routers.r1);
routers.r1.use(require("../server/donors/records").routers.r1);
routers.r1.use(require("../server/donors/routes").routers.r1_2);
routers.r1.use(require("../server/imports/routes").routers.r1);
routers.r1.use(require("../server/imports/undo").routers.r1);
routers.r1.use(require("../server/imports/combined").routers.r1);
routers.r1.use(require("../server/donors/interactions").routers.r1);
routers.r1.use(require("../server/tasks/routes").routers.r1);
routers.r1.use(require("../server/donors/gifts").routers.r1);
routers.r1.use(require("../server/imports/gifts").routers.r1);
routers.r1.use(require("../server/majorGifts/plans").routers.r1);
routers.r1.use(require("../server/donors/relationships").routers.r1);
routers.r1.use(require("../server/outreach/thanks").routers.r1);
routers.r1.use(require("../server/majorGifts/routes").routers.r1);
routers.r1.use(require("../server/majorGifts/top100").routers.r1);   // TOP100-1
routers.r1.use(require("../server/outreach/autoSend").routers.r1);
routers.r1.use(require("../server/outreach/rename").routers.r1);   // POLISH-8
routers.r1.use(require("../server/outreach/journeys").routers.r1);
routers.r1.use(require("../server/donors/people").routers.r1);
routers.r1.use(require("../server/outreach/routes").routers.r1);
routers.r1.use(require("../server/grants/routes").routers.r1);
routers.r1.use(require("../server/grants/funders").routers.r1);
routers.r1.use(require("../server/org/integrations").routers.r1);
routers.r1.use(require("../server/reports/fundraising").routers.r1);
routers.r1.use(require("../server/org/publicPages").routers.r1);
routers.r1.use(require("../server/reports/impact").routers.r1);
routers.r1.use(require("../server/memberships/routes").routers.r1);
routers.r1.use(require("../server/events/eventGifts").routers.r1);   // GIFTS-1
routers.r1.use(require("../server/donors/recordsGapRoute").routers.r1);   // FLOWS-10 item 14
routers.r1.use(require("../server/events/eventRemoval").routers.r1);   // WALKB-2: delete or archive, above the event routes
routers.r1.use(require("../server/volunteers/shiftRules").routers.r1);   // STALE-2: a bare draft shift deletes
routers.r1.use(require("../server/events/routes").routers.r1);
routers.r1.use(require("../server/events/publicPage").routers.r1);

function mountAll(ctx) {
  const shared = Object.assign({}, ctx, { giftHooks, reportHooks });
  for (const h of HELPERS) Object.assign(shared, require(h).mount(shared));
  for (const r of MODULES) require(r).mount(shared);
}

module.exports = { routers, mount: mountAll, giftHooks, reportHooks };
