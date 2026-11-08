// server/drafts/render.js · TRUTH-3. EVERY OPEN, PREVIEW AND SEND RE-RENDERS A DRAFT.
//
// A stored draft holds figure keys (shared/numbers/draftRender.js). This reads
// the person's figures today (shared/numbers/draftFigures.js, the same rules
// the profile reads) and fills them, for the draft queue (GET
// /milestone-drafts), Atlas's drafts (GET /agent/drafts and the waiting
// list), the note reminders' talking points, and the Send itself
// (server/shared/milestoneDrafts.js). An old draft stored with a number in a
// total sentence reads the true figure here too: render() templatizes first.
"use strict";
const { query } = require("../../db");
const N = require("../../shared/numbers");
const R = require("../../shared/numbers/draftRender");

// figures(orgId, donorId) with one read per person per call site.
function figureReader(orgId) {
  const cache = new Map();
  let fy = null;
  return async donorId => {
    if (!donorId) return null;
    if (!cache.has(donorId)) {
      if (!fy) {
        const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
        fy = N.fiscalYear.fiscalYearToDate(org || {});
      }
      cache.set(donorId, await N.draftFigures.draftFigures(query, orgId, donorId, fy));
    }
    return cache.get(donorId);
  };
}

// One draft row ({ donor_id, subject, body }) with its figures filled, plus
// the header line. `read` is a figureReader for the org.
async function renderDraft(orgId, row, read = figureReader(orgId)) {
  if (!row) return row;
  const F = await read(row.donor_id);
  if (!F) return row;
  return { ...row, subject: R.render(row.subject, F), body: R.render(row.body, F),
    donor_total_giving: F.lifetime, donor_before_steward: F.beforeStewardCents / 100,
    lifetime_header: R.lifetimeHeader(F) };
}

async function renderDrafts(orgId, rows) {
  const read = figureReader(orgId);
  const out = [];
  for (const r of rows || []) out.push(await renderDraft(orgId, r, read));
  return out;
}

// Talking points (note reminders) are words too: each point is rendered.
async function renderPoints(orgId, donorId, points, read = figureReader(orgId)) {
  const F = await read(donorId);
  return Array.isArray(points) && F ? points.map(p => R.render(p, F)) : points;
}

// Her own words: only the keys are filled, nothing is re-read as a total.
async function fillOnly(orgId, row, read = figureReader(orgId)) {
  const F = await read(row && row.donor_id);
  return F ? { subject: R.fill(row.subject, F), body: R.fill(row.body, F) } : { subject: row.subject, body: row.body };
}

module.exports = { figureReader, renderDraft, renderDrafts, renderPoints, fillOnly };
