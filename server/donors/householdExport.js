// server/donors/householdExport.js · HOUSEHOLD-1 item 4. AN EXPORT REACHES BOTH PEOPLE.
//
// A pilot customer merged couples and then "if I wanted to pull a report to
// email/call etc based on fields, it would leave one of them off". The Donors
// export (GET /donors/export/csv) now:
//   * always has a Household column and an Addressee line ("Debbie and Jeff
//     Vogel" for a household's mailing; a person on their own is their name)
//   * with households=1 ("Show households together"), each household that has
//     anyone in the filter brings in its other people too, one row per person,
//     each with their own email and phone
//   * with purpose=email | call | mail, leaves out anyone whose own preference
//     says no (do not contact, and no email / no calls / no mail): a person's
//     preference is theirs, never their household's
//   * with collapse=household (a mailing), one row per household address: the
//     people of a household at the same street, city and ZIP become one row
//     under the Addressee line; someone at a different address keeps their own
//
// Who gets mail does not change here: this is a file she downloads. Nothing sends.
"use strict";
const HG = require("../../shared/numbers/householdGiving");

const PURPOSES = { email: "do_not_email", call: "do_not_call", mail: "do_not_mail" };
const yes = v => v === true || v === 1 || v === "1" || v === "true";
const addrKey = d => ["address", "city", "zip"].map(k => String(d[k] || "").trim().toLowerCase()).join("|");

// The other live people of the households in `donors` that are not already in it.
async function householdOthers(query, orgId, donors) {
  const hh = [...new Set(donors.map(d => d.household_id).filter(Boolean))];
  if (!hh.length) return [];
  // TRUTH-5: the file's Gift count is giftCount.js's, as for everyone else in it.
  return (await query(`SELECT donors.*, ${require("../../shared/numbers/giftCount").DONOR_GIFT_COUNT("donors")} AS gift_count_live
                   FROM donors WHERE org_id = ? AND household_id = ANY(?::text[]) AND deleted_at IS NULL
                   AND erased_at IS NULL AND NOT (id = ANY(?::text[])) ORDER BY household_id, total_giving DESC NULLS LAST, id`,
    [orgId, hh, donors.map(d => d.id)])).map(({ gift_count_live, ...d }) => ({ ...d, gift_count: Number(gift_count_live) || 0 }));
}

// The rows of the file, and the columns this module adds.
async function shape(query, orgId, donors, q) {
  let rows = donors;
  if (String(q.households || "") === "1") {
    // Each household's people together, in the order its first person came.
    const others = await householdOthers(query, orgId, donors);
    const byHh = new Map();
    for (const o of others) (byHh.get(o.household_id) || byHh.set(o.household_id, []).get(o.household_id)).push(o);
    const out = [], placed = new Set();
    for (const d of donors) {
      out.push(d);
      if (d.household_id && !placed.has(d.household_id)) {
        placed.add(d.household_id);
        for (const o of byHh.get(d.household_id) || []) out.push({ ...o, __broughtIn: true });
      }
    }
    // Keep each household's people next to each other.
    const firstAt = new Map();
    out.forEach((d, i) => { const k = d.household_id || d.id; if (!firstAt.has(k)) firstAt.set(k, i); });
    rows = out.map((d, i) => ({ d, i })).sort((a, b) => firstAt.get(a.d.household_id || a.d.id) - firstAt.get(b.d.household_id || b.d.id) || a.i - b.i).map(x => x.d);
  }
  const flag = PURPOSES[String(q.purpose || "")];
  const leftOut = flag ? rows.filter(d => yes(d.do_not_contact) || yes(d[flag])).length : 0;
  if (flag) rows = rows.filter(d => !yes(d.do_not_contact) && !yes(d[flag]));
  // Household names and each household's people (live), for the column and the Addressee.
  const hhIds = [...new Set(rows.map(d => d.household_id).filter(Boolean))];
  const hh = hhIds.length ? await query(
    `SELECT h.id, h.name, d.id AS person_id, d.name AS person_name FROM households h
       JOIN donors d ON d.household_id = h.id AND d.org_id = h.org_id AND d.deleted_at IS NULL AND d.erased_at IS NULL
      WHERE h.org_id = ? AND h.id = ANY(?::text[]) ORDER BY h.id, (d.id = h.primary_donor_id) DESC, d.total_giving DESC NULLS LAST, d.id`, [orgId, hhIds]) : [];
  const nameOf = new Map(), peopleOf = new Map();
  for (const r of hh) { nameOf.set(r.id, r.name); (peopleOf.get(r.id) || peopleOf.set(r.id, []).get(r.id)).push(r.person_name); }
  const inRows = new Map();
  for (const d of rows) if (d.household_id) (inRows.get(d.household_id) || inRows.set(d.household_id, []).get(d.household_id)).push(d);
  // The addressee names the household's people who are in the file at this address.
  const addressee = d => {
    if (!d.household_id) return d.name || "";
    // the primary person first, then the household's own order
    const here = new Set((inRows.get(d.household_id) || []).filter(x => addrKey(x) === addrKey(d)).map(x => x.name));
    const names = (peopleOf.get(d.household_id) || []).filter(n => here.has(n));
    return HG.addresseeOf(names.length ? names : [d.name]);
  };
  if (String(q.collapse || "") === "household") {
    const seen = new Set();
    rows = rows.filter(d => {
      if (!d.household_id) return true;
      const k = d.household_id + "#" + addrKey(d);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const columns = [
    ["Household", d => (d.household_id ? nameOf.get(d.household_id) || "" : "")],
    ["Addressee", d => addressee(d)],
    ["Contact preferences", d => [["do_not_contact", "Do not contact"], ["do_not_email", "No email"], ["do_not_mail", "No mail"], ["do_not_call", "No calls"], ["do_not_solicit", "Do not solicit"]]
      .filter(([k]) => yes(d[k])).map(([, w]) => w).join("; ")],
  ];
  return { rows, columns, leftOut };
}

module.exports = { shape, PURPOSES };
