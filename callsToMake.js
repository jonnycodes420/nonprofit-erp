// callsToMake.js · PARITY-1 Part C. HOME'S "CALLS TO MAKE", DEFINED ONCE.
//
// The gifts somebody should pick up the phone about, this week:
//   · a first-time donor: their first ever gift, dated in the last 7 days
//     (the org's own calendar day), and
//   · a big gift: at least the org's call floor (WHY-1's $250 until an admin
//     changes it, why.js orgCallFloorCents), made in Steward rather than
//     imported, in the last 60 days (WHY-1's window, BIG_GIFT_DAYS),
// that nobody has thanked by phone yet: no call logged with that person on or
// after the gift's date. A snoozed gift stays off the list until its snooze
// runs out. Somebody marked deceased, do not contact or anonymous is never on it.
//
// One SQL builder feeds the panel's rows AND the figure source that opens its
// count (figureSources.js "calls-to-make"), so the list and the number agree.
// Reading it writes nothing.

const { query } = require("./db");
const orgTime = require("./orgTime");
const WHY = require("./why");

const FIRST_TIME_DAYS = 7;
const SNOOZE_DAYS = 7;
const FIRST_DETAIL = "First gift";

function dollars(cents) {
  const d = Math.round(Number(cents) || 0) / 100;
  return "$" + d.toLocaleString("en-US", { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function sentence(floorCents) {
  return `Gifts to thank by phone: each first gift from a new donor in the last ${FIRST_TIME_DAYS} days, and each gift of ${dollars(floorCents)} or more made in Steward in the last ${WHY.BIG_GIFT_DAYS} days, where nobody has logged a call with that person since the gift. A snoozed gift comes back after ${SNOOZE_DAYS} days.`;
}

// Rows in the figure-source shape: id (the gift), type, donor_id, name, date,
// amount, detail ("First gift" or the floor it cleared).
function callsSql(orgId, today, floorCents) {
  const weekFrom = orgTime.addDays(today, -(FIRST_TIME_DAYS - 1));
  const bigFrom = orgTime.addDays(today, -WHY.BIG_GIFT_DAYS);
  return {
    sql: `WITH firsts AS (
            SELECT donor_id, MIN(LEFT(date,10)) AS first_date FROM gifts
             WHERE org_id = ? AND amount > 0 GROUP BY donor_id),
          cand AS (
            SELECT g.id, g.donor_id, d.name, LEFT(g.date,10) AS date, g.amount,
                   (f.first_date = LEFT(g.date,10) AND f.first_date >= ?) AS first_time
              FROM gifts g
              JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
                   AND COALESCE(d.deceased,false) = false AND COALESCE(d.do_not_contact,false) = false
                   AND COALESCE(d.kind,'') <> 'anonymous'
              JOIN firsts f ON f.donor_id = g.donor_id
             WHERE g.org_id = ? AND g.amount > 0 AND LEFT(g.date,10) <= ?
               AND ((f.first_date >= ? AND LEFT(g.date,10) = f.first_date)
                    OR (g.import_id IS NULL AND ROUND(g.amount * 100) >= ? AND LEFT(g.date,10) >= ?)))
          SELECT c.id, 'gift' AS type, c.donor_id, c.name, c.date, ROUND(c.amount::numeric, 2) AS amount,
                 CASE WHEN c.first_time THEN '${FIRST_DETAIL}' ELSE ? END AS detail
            FROM cand c
           WHERE NOT EXISTS (SELECT 1 FROM interactions i WHERE i.org_id = ? AND i.donor_id = c.donor_id
                               AND i.type = 'call' AND LEFT(i.date,10) >= c.date)
             AND NOT EXISTS (SELECT 1 FROM call_snoozes s WHERE s.org_id = ? AND s.gift_id = c.id AND s.until > ?)`,
    args: [orgId, weekFrom, orgId, today, weekFrom, floorCents, bigFrom,
      `Gift of ${dollars(floorCents)} or more`, orgId, orgId, today],
    order: "date DESC, id DESC",
  };
}

module.exports = { FIRST_TIME_DAYS, SNOOZE_DAYS, FIRST_DETAIL, callsSql, sentence, dollars, floorFor: WHY.orgCallFloorCents };
