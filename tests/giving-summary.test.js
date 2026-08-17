// BUILD-64 Part 4 — the giving summary is the donor's own page.
//
// Four guarantees, pinned so they can't quietly regress:
//   (1) ONE human date formatter (lib/money.js fmtDay) everywhere donor-facing.
//       An ISO date (a bare `.slice(0,10)` or a raw `{x.date}`) on the org
//       portal or the cross-org dashboard fails this suite.
//   (2) recurring gifts are tagged in the history (server carries the flag, the
//       portal renders a "Recurring" chip).
//   (3) fund designation is shown on the expanded gift rows where one exists.
//   (4) "Largest gift" is gone from the donor's page — replaced by the gift
//       count (which also restores the 5→6 signal that had quietly vanished).
//
// Pure source + lib scan (no server needed) — the same shape as the brand
// grep-guards, so it runs anywhere.
const fs = require("fs");
const path = require("path");
const { ok, summary, closeDb } = require("./helpers");

const CLIENT = path.join(__dirname, "..", "client", "src");
const read = p => fs.readFileSync(path.join(CLIENT, p), "utf8");
const PORTAL = read("pages/Portal.jsx");
const DASH = read("pages/GivingDashboard.jsx");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// Donor-facing date renders must never slice an ISO string to display it.
// (A yyyy-only `.slice(0,4)` for "giving since 2019" is fine — different width.)
const ISO_SLICE = /\.slice\(0,\s*10\)/;

async function run() {
  // ── (1) the ONE formatter ────────────────────────────────────────────────
  const money = await import("../client/src/lib/money.js");
  ok("fmtDay exists in lib/money.js", typeof money.fmtDay === "function");
  ok("fmtDay renders human, not ISO (2026-08-17 → Aug 17, 2026)", money.fmtDay("2026-08-17") === "Aug 17, 2026", money.fmtDay("2026-08-17"));
  ok("fmtDay reads a leading date off a timestamp", money.fmtDay("2026-08-11T09:30:00Z") === "Aug 11, 2026", money.fmtDay("2026-08-11T09:30:00Z"));
  ok("fmtDay passes junk through, never invents a date", money.fmtDay("") === "" && money.fmtDay(null) === "");

  ok("Portal imports fmtDay from the shared lib", /import \{[^}]*fmtDay[^}]*\} from "\.\.\/lib\/money"/.test(PORTAL));
  ok("GivingDashboard imports fmtDay from the shared lib", /import \{[^}]*fmtDay[^}]*\} from "\.\.\/lib\/money"/.test(DASH));
  ok("GivingDashboard no longer defines a SECOND fmtDay", !/function fmtDay\(/.test(DASH));
  ok("no ISO-slice date render remains in the org portal", !ISO_SLICE.test(PORTAL), PORTAL.match(/.{0,40}\.slice\(0,\s*10\).{0,20}/)?.[0]);
  ok("no ISO-slice date render remains in the cross-org dashboard", !ISO_SLICE.test(DASH), DASH.match(/.{0,40}\.slice\(0,\s*10\).{0,20}/)?.[0]);
  ok("the expanded gift row renders the date via fmtDay", /\{fmtDay\(g\.date\)\}/.test(PORTAL));
  ok("impact-update dates render via fmtDay", /\{fmtDay\(u\.date\)\}/.test(PORTAL));

  // ── (2) recurring gifts are tagged ───────────────────────────────────────
  ok("server portal payload derives the recurring flag from recurring_subscription_id",
    /recurring_subscription_id IS NOT NULL AS recurring/.test(SERVER));
  ok("server portal gift payload maps the recurring flag", /recurring:\s*g\.recurring === true/.test(SERVER));
  ok("the gift history renders a Recurring tag", /g\.recurring &&[^]{0,200}Recurring</.test(PORTAL));

  // ── (3) fund designation on the expanded rows ────────────────────────────
  ok("server portal payload carries the fund name", /f\.name AS fund/.test(SERVER) && /fund:\s*g\.fund/.test(SERVER));
  ok("the expanded gift row shows the fund designation where one exists", /\{g\.fund \?[^]{0,40}\$\{g\.fund\}/.test(PORTAL));

  // ── (4) "Largest gift" is gone from the donor's page ─────────────────────
  ok('the donor portal no longer labels a stat "Largest gift"', !/>Largest gift</.test(PORTAL), PORTAL.match(/>.{0,14}Largest gift.{0,14}</)?.[0]);
  ok("the gift count is the third giving stat", /S\.label\}>Gifts<\/div>[^]{0,80}\{g\.giftCount\}/.test(PORTAL));

  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
