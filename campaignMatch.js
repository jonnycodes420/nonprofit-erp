// NUMBERS-1 · WHICH GIFTS COUNT TOWARD A CAMPAIGN, said once.
//
// Every campaign, goal, thermometer and campaign report sums gifts through
// CAMPAIGN_GIFT_MATCH. A gift counts toward a campaign when it is attributed
// to it (by campaign_id, or by the legacy free-text name only when it has no
// campaign_id, so one gift never counts toward two campaigns), when the person
// who gave it is not deleted, and when it is dated inside the campaign's own
// start and end. A gift dated outside the window keeps its attribution on the
// row and counts toward nothing (GivingTuesday 2026, 21 Oct). FIX-49: a soft
// or matching credit row counts toward no campaign (creditTypes.js), and a
// gift counts its full amount, a fee the donor covered included (Jonathan,
// 25 Oct: the gift is what the donor paid). Only creditTypes.js is required,
// so figureSources.js and the routes can all load it.
const { NOT_CREDIT } = require("./creditTypes");
// The SQL that says a gift row `g` counts toward campaign `c`. Both aliases are
// the caller's; the donor join is inside, so a caller cannot forget it.
// gifts.date is TEXT (YYYY-MM-DD) and the campaign's dates are DATE, so the
// comparison is on the first ten characters, cast once.
const CAMPAIGN_GIFT_MATCH = (g = "g", c = "c") =>
  `(${g}.campaign_id = ${c}.id OR (${g}.campaign_id IS NULL AND ${g}.campaign = ${c}.name))
   AND (${c}.start_date IS NULL OR LEFT(${g}.date, 10)::date >= ${c}.start_date)
   AND (${c}.end_date IS NULL OR LEFT(${g}.date, 10)::date <= ${c}.end_date)
   AND ${NOT_CREDIT(g)}
   AND NOT EXISTS (SELECT 1 FROM donors dx WHERE dx.id = ${g}.donor_id AND dx.org_id = ${g}.org_id AND dx.deleted_at IS NOT NULL)`;

// FIX-49 · GRANTS ON A PUBLIC BAR. A grant awarded toward a campaign counts
// toward it on the public bar too (Jonathan, 25 Oct), unless the campaign has
// "Leave grants off the public bar" on (campaigns.grants_off_public_bar). The
// admin cards always count them. `c` is the caller's campaign alias.
const PUBLIC_BAR_GRANTS = (c = "c") =>
  `CASE WHEN COALESCE(${c}.grants_off_public_bar, false) THEN 0 ELSE COALESCE((SELECT SUM(grx.amount) FROM grants grx
     WHERE grx.org_id = ${c}.org_id AND grx.campaign_id = ${c}.id AND grx.awarded_at IS NOT NULL), 0) END`;

// pg hands a DATE back as a Date at LOCAL midnight, so it is read in local
// parts; a string is already a civil day.
const pad = n => String(n).padStart(2, "0");
const day = v => v == null || v === "" ? null
  : v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : String(v).slice(0, 10);

function inWindow(date, start, end) {
  const d = day(date), s = day(start), e = day(end);
  return (!s || d >= s) && (!e || d <= e);
}

const fmtDay = v => {
  const s = day(v);
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)))
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

// null when the gift may count toward the campaign; otherwise the sentence.
function campaignWindowRefusal(campaign, date) {
  if (!campaign || inWindow(date, campaign.start_date, campaign.end_date)) return null;
  const s = day(campaign.start_date) && fmtDay(campaign.start_date), e = day(campaign.end_date) && fmtDay(campaign.end_date);
  const span = s && e ? `runs ${s} to ${e}` : s ? `starts ${s}` : `ended ${e}`;
  return `${campaign.name} ${span}, and this gift is dated ${fmtDay(date)}. A gift counts toward a campaign only inside its dates, so choose another campaign or none.`;
}

module.exports = { CAMPAIGN_GIFT_MATCH, PUBLIC_BAR_GRANTS, inWindow, campaignWindowRefusal };
