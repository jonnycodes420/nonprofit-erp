// shared/numbers/pickable.js · FLOWS-12 item 5 (W-1114-Finance-29X). ERASED MEANS ERASED.
//
// The household picker offered "Erased person $100,000", and erased people
// were still counted, and their lifetime summed, in an officer's portfolio.
// An erased person (personData.js erasePerson) keeps their gifts as anonymous
// money (TRUTH-2), but they are nobody you can pick, link, seat, credit, merge
// or count as one of your people.
//
// One filter, shared: every person picker reads it (GET /donors/pick, which
// the household, guest, gift, merge, soft-credit and relationship pickers all
// ask), and so do portfolio membership (server/shared/crmCommon.js) and the
// officers' portfolio counts and totals. A lookup by id (a gift's row naming
// who gave it) still finds the erased record and labels it "Former donor
// (erased)" (shared/erasedLabel.js); that is not a picker.
"use strict";

const col = (d, c) => (d ? `${d}.${c}` : c);

// SQL: `d` is not erased. `d` may be "" for an unaliased query.
const NOT_ERASED = (d = "d") => `${col(d, "erased_at")} IS NULL`;
// SQL: `d` is someone a picker may offer: not deleted and not erased.
const PICKABLE = (d = "d") => `(${col(d, "deleted_at")} IS NULL AND ${NOT_ERASED(d)})`;

// The same over a row already read.
const pickable = row => !!row && !row.deleted_at && !row.erased_at;

module.exports = { NOT_ERASED, PICKABLE, pickable };
