// membershipPage.js · PAGES-1. THE MEMBERSHIP PAGE, BUILT LIKE A GIVING PAGE.
//
// A membership page is a `giving_pages` row with page_kind 'membership': the
// same editor, brand, draft, publish, History and Revert as a giving or
// volunteer page. Its blocks are the "membership" surface of the one widget
// registry, and its form is the `memberlevels` block: every level the org
// sells and has not hidden, each with Join, through the same checkout the
// `/give/:org?memberships` page uses (PARITY-2). This module holds what only a
// membership page has: its three templates and what its blocks read.
//
// THE TEMPLATES INVENT NOTHING (VOL-PAGE-1's rule). Each is blocks the org's
// own records fill: the header from the brand, the photo from Steward's
// library, the levels and the member count from Memberships, the footer from
// Settings. A text block holds a prompt, which is the editor's (a `hint`),
// and the public page leaves out until somebody writes over it (WALKB-1).
// So a template looks finished with nothing but the org's logo and colors.

const { query } = require("./db");

const KIND = "membership";

const prompt = text => ({ type: "richtext", blocks: [], hint: text });

const STARTERS = {
  story_first: {
    label: "Story first",
    blurb: "A photo, why membership matters, then the levels.",
    widgets: [
      { type: "pageheader" },
      { type: "hero", heading: "", sub: "", image: null, size: "tall" },
      prompt("Say what members make possible, in your own words."),
      { type: "memberlevels", heading: "Become a member" },
      { type: "pagefooter" },
    ],
  },
  campaign: {
    label: "Campaign",
    blurb: "A member drive: the count toward your goal leads the page.",
    widgets: [
      { type: "pageheader" },
      { type: "hero", heading: "", sub: "", image: null, size: "standard" },
      { type: "goalbar", heading: "Members today", target: 100 },
      { type: "memberlevels", heading: "Join today" },
      prompt("Say why you are asking now, in your own words."),
      { type: "pagefooter" },
    ],
  },
  simple: {
    label: "Simple",
    blurb: "Your logo and the levels, nothing else.",
    widgets: [
      { type: "pageheader" },
      { type: "memberlevels", heading: "Become a member" },
      { type: "pagefooter" },
    ],
  },
};

// How many people hold a membership today: the goal bar's count. Active and
// in their grace period, one per person (a household's second card is not a
// second member).
async function memberCount(orgId) {
  const [r] = await query(
    `SELECT COUNT(DISTINCT donor_id)::int AS n FROM memberships WHERE org_id = ? AND status IN ('active','grace')`, [orgId]);
  return (r && r.n) || 0;
}
const MEMBER_SENTENCE = "Everyone with an active membership today, or in its grace period, counted once.";

module.exports = { KIND, STARTERS, memberCount, MEMBER_SENTENCE };
