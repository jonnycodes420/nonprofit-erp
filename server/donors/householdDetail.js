// server/donors/householdDetail.js · HOUSEHOLD-1 item 3. THE HOUSEHOLD SHARES;
// EACH PERSON KEEPS THEIR OWN.
//
// What the household view adds to GET /households/:id:
//   by_year      combined giving by fiscal year (householdGiving.byYear), each
//                year opening its gifts (`household-span`)
//   address      the household's address: its lead person's, and whether the
//                others share it (the same street, city and ZIP)
//   open_asks    every open proposal for anyone in it, each opening its rows
//   next_step    the household's next step: the soonest of its people's (the
//                one rule, server/tasks/nextStep.js)
//   people       each person with their own email, phone, photo and Contact
//                preferences (do not contact, email, mail, call, solicit),
//                never merged into one
"use strict";
const HG = require("../../shared/numbers/householdGiving");

const PREFS = [["do_not_contact", "Do not contact"], ["do_not_email", "No email"], ["do_not_mail", "No mail"], ["do_not_call", "No calls"], ["do_not_solicit", "Do not solicit"]];
const sameAddress = (a, b) => ["address", "city", "zip"].every(k => String(a[k] || "").trim().toLowerCase() === String(b[k] || "").trim().toLowerCase());

// A person's photo URL (signed, as the profile's), or null for initials.
function photoUrlFor(orgId) {
  const { ASSET_ID_RE } = require("../../assetStore");
  const PP = require("../../personPhoto");
  return id => id && ASSET_ID_RE.test(String(id)) ? PP.signPhotoUrl({ orgId, assetId: id }) : null;
}

async function detail(query, orgId, view, { org, today, photoUrl }) {
  const ids = view.members.map(m => m.id);
  if (!ids.length) return { by_year: [], address: null, open_asks: [], next_step: null, people: [] };
  const P = await import("../../shared/proposalShape.js");
  const [people, asks, years, steps] = await Promise.all([
    query(`SELECT id, name, email, phone, photo_asset_id, address, address2, city, state, zip, country,
                  do_not_contact, do_not_email, do_not_mail, do_not_call, do_not_solicit
             FROM donors WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, ids]),
    query(`SELECT o.id, o.donor_id, o.name, o.proposal_stage, TO_CHAR(o.expected_close, 'YYYY-MM-DD') AS expected_close,
                  ROUND(COALESCE(o.target_amount, 0) * 100)::bigint AS cents
             FROM opportunities o WHERE o.org_id = ? AND o.donor_id = ANY(?::text[]) AND o.proposal_stage = ANY(?::text[])
            ORDER BY o.expected_close ASC NULLS LAST, o.id`, [orgId, ids, P.OPEN_STAGE_KEYS]),
    HG.byYear(query, orgId, view.id, org, today),
    require("../tasks/nextStep").nextStepsFor(query, orgId, ids, today),
  ]);
  const byId = new Map(people.map(p => [p.id, p]));
  const lead = byId.get(view.primary_donor_id) || byId.get(ids[0]);
  const stageLabel = k => (P.PROPOSAL_STAGES.find(s => s.key === k) || {}).label || k;
  const nameOf = id => (byId.get(id) || {}).name || "";
  const next = [...steps.entries()].map(([id, n]) => ({ ...n, donorId: id, who: nameOf(id) }))
    .sort((a, b) => (a.overdue === b.overdue ? String(a.due || "9999").localeCompare(String(b.due || "9999")) : a.overdue ? 1 : -1))[0] || null;
  return {
    by_year: years.map(y => ({ ...y, source: { key: "household-span", params: { household: view.id, from: y.from, to: y.to } } })),
    address: lead && lead.address ? {
      lines: [lead.address, lead.address2, [lead.city, lead.state].filter(Boolean).join(", ") + (lead.zip ? ` ${lead.zip}` : "")].filter(x => x && x.trim()),
      sharedBy: people.filter(p => sameAddress(p, lead)).map(p => p.name),
      differs: people.filter(p => !sameAddress(p, lead)).map(p => p.name),
    } : null,
    open_asks: asks.map(a => ({ id: a.id, donorId: a.donor_id, who: nameOf(a.donor_id), name: a.name || "A proposal", stage: stageLabel(a.proposal_stage),
      expectedClose: a.expected_close || null, cents: Number(a.cents), source: { key: "donor-open-ask", params: { donor: a.donor_id } } })),
    next_step: next ? { label: next.label, due: next.due || "", overdue: !!next.overdue, donorId: next.donorId, who: next.who } : null,
    people: ids.map(id => byId.get(id)).filter(Boolean).map(p => ({
      id: p.id, name: p.name, email: p.email || null, phone: p.phone || null, photoUrl: photoUrl(p.photo_asset_id),
      preferences: PREFS.filter(([k]) => p[k] === true || p[k] === 1).map(([, w]) => w),
    })),
    // the primary person first, as the export's Addressee
    addressee: HG.addresseeOf([...ids].sort((x, y) => (y === view.primary_donor_id) - (x === view.primary_donor_id)).map(nameOf)),
  };
}

module.exports = { detail, photoUrlFor, PREFS };
