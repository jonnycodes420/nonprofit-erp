// SPEED-3 · THE DONORS PAGE: ITS ROWS FIRST, THEN THEIR COLUMNS.
//
// The list's row carries columns worked out per person (the scores, the
// closeness word, pledge hold, Re-engage: groups.buildDonorFilter's
// selectCols). Asked as one flat SELECT … ORDER BY … LIMIT 50, Postgres
// planned those columns for every person in the org, not the 50 on the page:
// closeness's "a gift in the last twelve months" became one hashed scan of
// every org's gifts on each read (81,809 rows on the load fixture), and under
// the nightly load test GET /donors was 1.6 s at p95.
//
// So the page's ids are chosen first, in a subquery over donors with the same
// WHERE, ORDER BY, LIMIT and OFFSET, and the columns are worked out on those
// rows only, in the same statement. The rows, their order and every value are what
// the flat SELECT returned; only the plan changes. When the order itself reads
// one of the worked-out columns (the score sorts, Room to give, a search's
// match), the page cannot be chosen without them, and the flat SELECT stays.
"use strict";

// A selectCols alias, or a search's name match: an order that reads one needs the flat form.
const READS_COLUMN = /\b(engagement_score|generosity_score|engagement_band|closeness|pledge_hold|reengage|room_rank|match_reason)\b|\?/;

function pageSql({ selectCols, selectArgs, whereSql, params, orderBy, orderArgs = [], limit, offset }) {
  if (READS_COLUMN.test(orderBy) || orderArgs.length) {
    return [`SELECT donors.*${selectCols} FROM donors WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...selectArgs, ...params, ...orderArgs, limit, offset]];
  }
  // The page's ids (a narrow sort), then their rows; the org is the subquery's WHERE.
  return [`SELECT donors.*${selectCols}
      FROM (SELECT donors.id FROM donors WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?) page
      JOIN donors ON donors.id = page.id
     ORDER BY ${orderBy}`,
    [...selectArgs, ...params, limit, offset]];
}

module.exports = { pageSql, READS_COLUMN };
