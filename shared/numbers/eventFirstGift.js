// shared/numbers/eventFirstGift.js · NUMBERS-10 item 5 (W-1127-Volunteers-01). AN EVENT'S FIRST-TIME GIVERS.
//
// The fleet read "First-time givers 1" on an event for a person whose first gift, earlier the same day, was not
// at the event. The old SQL took any gift for the event dated on the person's first gift DATE, so a second gift
// that day counted. Now a person is a first-time giver of an event when their FIRST gift ever (firstGift.js: the
// earliest gift, money above zero, not a credit row; on a day with two, the one recorded first, FIRST_GIFT_ORDER)
// is that gift, and it belongs to this event by the event's one rule (events.js EVENT_GIFT_MATCH: stamped with
// the event, or, unstamped, its campaign, or its name when it has no campaign). An old system's earlier first gift
// (IMPORTED_FIRST) means they gave before, so they are not first-time here. A deleted person is in nothing.
//
// One SQL, read by the After the event tile (server/events/routes.js) and the `event-first-time` figure source,
// so the count and the people it opens are the same rows. Binds (orgId, eventId). Columns: donor_id, name,
// amount, date, gift_id. Each person once.
"use strict";
const { GIFT } = require("./money");
const { FIRST_GIFT_ORDER, IMPORTED_FIRST } = require("./firstGift");
const { EVENT_GIFT_MATCH } = require("./events");

const EVENT_FIRST_TIME_SQL = `WITH e AS (SELECT * FROM events WHERE org_id = ? AND id = ?),
  first AS (
    SELECT DISTINCT ON (g.donor_id) g.*
      FROM gifts g
     WHERE g.org_id = (SELECT org_id FROM e) AND ${GIFT("g")}
       AND g.donor_id IN (SELECT eg.donor_id FROM gifts eg, e WHERE eg.org_id = e.org_id AND ${EVENT_GIFT_MATCH("eg", "e")})
     ORDER BY g.donor_id, ${FIRST_GIFT_ORDER})
  SELECT * FROM (
    SELECT f.donor_id, d.name, f.amount::float AS amount, f.date, f.id AS gift_id
      FROM first f CROSS JOIN e
      JOIN donors d ON d.id = f.donor_id AND d.org_id = f.org_id AND d.deleted_at IS NULL
     WHERE ${EVENT_GIFT_MATCH("f", "e")}
       AND (${IMPORTED_FIRST("d")} IS NULL OR LEFT(${IMPORTED_FIRST("d")}, 10) >= LEFT(f.date::text, 10))) ft
  ORDER BY amount DESC, name`;

const SENTENCE = "Each person whose first gift ever was for this event, once: the gift carries the event, or, with no event on it, the event's campaign (its name when it has no campaign). On a day with two gifts, the first is the one recorded first, so a gift earlier that day elsewhere means they were not new here. Giving in an old system before it counts as giving. A refund or a credit is not a gift.";

module.exports = { EVENT_FIRST_TIME_SQL, SENTENCE };
