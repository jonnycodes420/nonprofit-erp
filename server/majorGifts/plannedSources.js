// server/majorGifts/plannedSources.js · HOME-7 item 3. "N HAVE TOLD YOU YOU'RE IN THEIR WILL".
// Home's Planned giving card leads with the people whose record holds a bequest (planned_gifts,
// the profile's Giving tab, Planned giving), and the figure opens exactly those people.
"use strict";

module.exports = function plannedSources() {
  return {
    "planned-bequests": {
      label: "Told you you're in their will",
      measure: () => "count",
      params: {},
      sentence: () => "Everyone whose record holds a bequest under Planned giving (the profile's Giving tab). One row per person.",
      sql: orgId => ({
        sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MAX(pg.date_indicated)::text AS date, NULL::numeric AS amount, 'Bequest' AS detail
                FROM planned_gifts pg JOIN donors d ON d.id = pg.donor_id AND d.org_id = pg.org_id
               WHERE pg.org_id = ? AND pg.type = 'bequest' AND d.deleted_at IS NULL GROUP BY d.id, d.name`,
        args: [orgId], order: "name, id",
      }),
    },
  };
};
