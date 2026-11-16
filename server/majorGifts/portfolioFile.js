// server/majorGifts/portfolioFile.js · FLOWS-14 item 6 (W-1115-Donors-06X, repeat).
// THE OFFICER PORTFOLIOS ADD UP TO THE DONOR FILE.
//
// "Dana Reyes 718 people … plus Priya Raman 385 … equals 1,103 people, against
// Donors 1,184": 81 donors were in neither portfolio because imported people
// have no owner, and nothing on the screen said so. The strip now ends with an
// Unassigned row, and one sentence says the rows add up to the Donors tab.
//
//   the file        the Donors tab: a donor (person_types), not archived, not erased
//   an officer row  BUILD-30's definition, unchanged: assigned to them, in a pipeline stage
//   Unassigned      people in the file with no owner and no invite pending
//                   (the Owner filter's "Unassigned", and the where-chip "Owner is nobody")
//   anyone else     in the file and in no row above (an owner but no pipeline stage, an
//                   invite pending), said in the sentence when there is anyone
// People in an officer row who are not in the file (a contact assigned to them) are
// said too, so the arithmetic on screen is always whole. Nothing assigns an owner.
"use strict";
const { PICKABLE } = require("../../shared/numbers/pickable");
const { LIFETIME } = require("../../shared/numbers/lifetime");

const UNASSIGNED = (d = "d") => `(${d}.assigned_to IS NULL AND ${d}.pending_assignee_invite_id IS NULL)`;
const UNASSIGNED_WORDS = "Unassigned";
const PIPELINE = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];

async function fileSql(d = "d") {
  const PT = await import("../../shared/personType.js");
  return `(${PICKABLE(d)} AND ${PT.typeSql("donor", d)})`;
}
// SQL: person `d` is in an officer's row (BUILD-30, /portfolio/officers).
const IN_OFFICER_ROW = (d = "d") => `(EXISTS (SELECT 1 FROM users u WHERE u.id = ${d}.assigned_to AND u.org_id = ${d}.org_id) AND COALESCE(${d}.stage, ${d}.suggested_stage) = ANY(ARRAY[${PIPELINE.map(s => `'${s}'`).join(",")}]))`;

const cents = v => Math.round(Number(v || 0) * 100);
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = x => Number(x).toLocaleString("en-US");

// The rows below the officers', and the sentence. `officers` is /portfolio/officers' list.
async function footing(query, orgId, officers) {
  const file = await fileSql("d");
  const [r] = await query(
    `SELECT COUNT(*) FILTER (WHERE ${file})::int AS file_n,
            ROUND(COALESCE(SUM(${LIFETIME("d")}) FILTER (WHERE ${file}), 0)::numeric, 2) AS file_g,
            COUNT(*) FILTER (WHERE ${file} AND ${UNASSIGNED("d")})::int AS un_n,
            ROUND(COALESCE(SUM(${LIFETIME("d")}) FILTER (WHERE ${file} AND ${UNASSIGNED("d")}), 0)::numeric, 2) AS un_g,
            COUNT(*) FILTER (WHERE ${file} AND NOT ${UNASSIGNED("d")} AND NOT ${IN_OFFICER_ROW("d")})::int AS other_n,
            ROUND(COALESCE(SUM(${LIFETIME("d")}) FILTER (WHERE ${file} AND NOT ${UNASSIGNED("d")} AND NOT ${IN_OFFICER_ROW("d")}), 0)::numeric, 2) AS other_g,
            COUNT(*) FILTER (WHERE ${PICKABLE("d")} AND NOT ${file} AND ${IN_OFFICER_ROW("d")})::int AS out_n,
            ROUND(COALESCE(SUM(${LIFETIME("d")}) FILTER (WHERE ${PICKABLE("d")} AND NOT ${file} AND ${IN_OFFICER_ROW("d")}), 0)::numeric, 2) AS out_g
       FROM donors d WHERE d.org_id = ?`, [orgId]);
  const fileN = r.file_n, fileC = cents(r.file_g);
  const unN = r.un_n, unC = cents(r.un_g), otherN = r.other_n, otherC = cents(r.other_g), outN = r.out_n, outC = cents(r.out_g);
  const held = (officers || []).filter(o => Number(o.portfolio_count) > 0);
  const offN = held.reduce((s, o) => s + Number(o.portfolio_count), 0);
  const offC = held.reduce((s, o) => s + cents(o.portfolio_giving), 0);
  const sumN = offN + unN + otherN - outN, sumC = offC + unC + otherC - outC;
  const names = [...held.map(o => o.name), UNASSIGNED_WORDS];
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const parts = [`${list} add up to the ${n(fileN)} ${fileN === 1 ? "donor" : "donors"} on the Donors tab, ${usd(fileC)} given in total.`];
  if (otherN) parts.push(`That includes ${n(otherN)} with an owner but no pipeline stage or an invite still pending (${usd(otherC)}), in no row above.`);
  if (outN) parts.push(`The officers' rows also hold ${n(outN)} ${outN === 1 ? "person who is" : "people who are"} not on the Donors tab (${usd(outC)}).`);
  if (unN) parts.push(`Unassigned is everyone on the Donors tab with no owner; Steward never assigns one by itself.`);
  return {
    unassigned: { key: "none", name: UNASSIGNED_WORDS, portfolio_count: unN, portfolio_giving: unC / 100 },
    other: otherN ? { count: otherN, giving: otherC / 100 } : null,
    outside: outN ? { count: outN, giving: outC / 100 } : null,
    file: { count: fileN, giving: fileC / 100 },
    foots: sumN === fileN && sumC === fileC,
    sentence: parts.join(" "),
  };
}

module.exports = { UNASSIGNED, UNASSIGNED_WORDS, IN_OFFICER_ROW, fileSql, footing };
