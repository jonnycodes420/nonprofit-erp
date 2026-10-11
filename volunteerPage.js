// volunteerPage.js · VOL-PAGE-1. THE VOLUNTEER PAGE, BUILT LIKE A GIVING PAGE.
//
// A volunteer page is a `giving_pages` row with page_kind 'volunteer': the same
// editor, brand, media library, draft and publish, slug, embed, Pages list and
// search as a giving page. Its blocks are the "volunteer" surface of the one
// widget registry (shared/pageWidgets.js). This module holds what only a
// volunteer page has:
//   · the three templates, which lay out blocks and prompts and invent nothing
//     (no number, no quote, no testimonial: a template's quote block says
//     "Add a quote from one of your volunteers");
//   · pageData(), everything the volunteer blocks read when the page opens:
//     the public roles, the upcoming shifts with filled of needed, and the
//     impact numbers from real records. Nothing on the page is typed in.
// Reading it writes nothing. The sign-up itself is in
// routes/volunteerScheduling.js, beside VOL-1's one sign-up path.

const { query } = require("./db");
const orgTime = require("./orgTime");

const KIND = "volunteer";
// The SQL that means "a page that takes gifts". Every read of giving_pages
// that would show a donation form, count a giving page or offer one to a
// donor carries it, so a volunteer page never turns up as a place to give.
const GIVE_KIND_SQL = (a = "") => `COALESCE(${a ? a + "." : ""}page_kind, 'give') = 'give'`;
const SHIFT_DAYS = 90;          // how far ahead the shift picker looks
const SHIFT_MAX = 40;

// The three ready-made pages. Each is only blocks and prompts.
const STARTERS = {
  one_day: {
    label: "One-day event",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "tall" },
      { type: "richtext", blocks: [{ type: "p", text: "Say what the day is, who it helps and what volunteers will do, in your own words." }] },
      { type: "shiftpicker", heading: "Pick a shift", opportunityIds: [] },
      { type: "volsignup", heading: "Sign up to help", askPhone: true, askAvailability: false, askInterests: false, questions: [] },
      { type: "volwaiver", heading: "Before your first shift" },
      { type: "volquote", text: "", name: "", permission: false },
    ],
  },
  ongoing: {
    label: "Ongoing roles",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "standard" },
      { type: "richtext", blocks: [{ type: "p", text: "Say why volunteers matter here, in your own words." }] },
      { type: "opportunities", heading: "Ways to help", opportunityIds: [] },
      { type: "volimpact", heading: "What our volunteers did this year" },
      { type: "volquote", text: "", name: "", permission: false },
      { type: "shiftpicker", heading: "Upcoming shifts", opportunityIds: [] },
      { type: "volsignup", heading: "Sign up to help", askPhone: true, askAvailability: true, askInterests: true, questions: [] },
      { type: "volwaiver", heading: "Before your first shift" },
    ],
  },
  group_day: {
    label: "Group service day",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "tall" },
      { type: "richtext", blocks: [{ type: "p", text: "Say what a group will do on the day and what to bring, in your own words." }] },
      { type: "groupsignup", heading: "Bringing a group?", text: "Churches, schools and companies are welcome. Tell us about your group and we will be in touch to plan the day together." },
      { type: "shiftpicker", heading: "Pick a date", opportunityIds: [] },
      { type: "volsignup", heading: "Sign up your group", askPhone: true, askAvailability: false, askInterests: false, questions: [] },
      { type: "volwaiver", heading: "Before the day" },
    ],
  },
};

const IMPACT_SENTENCES = {
  hours: y => `Every volunteer shift dated January 1 to today, ${y}, added up.`,
  roster: () => "Everyone whose record carries the Volunteer role, including anyone added today.",
};

async function orgTodayFor(orgId) {
  const [o] = await query("SELECT timezone FROM orgs WHERE id = ?", [orgId]);
  return orgTime.orgToday(o || {});                               // ORG_TZ_SEAM_OK
}

// Everything a volunteer block reads, in one shape for the public page and
// the editor's preview. `widgets` supplies the org's own questions.
async function pageData(orgId, widgets = []) {
  const today = await orgTodayFor(orgId);
  const until = orgTime.addDays(today, SHIFT_DAYS);
  const VS = await import("./shared/volunteerShifts.js");
  const [opps, slots] = await Promise.all([
    query(`SELECT id, name, description, location, commitment, skills, requires_waiver, requires_background_check
             FROM volunteer_opportunities WHERE org_id = ? AND archived_at IS NULL AND is_public = TRUE ORDER BY name, id`, [orgId]),
    query(`SELECT s.id, s.opportunity_id, s.date, s.start_time, s.end_time, s.capacity,
                  COALESCE(s.name, o.name) AS opp_name
             FROM volunteer_slots s JOIN volunteer_opportunities o ON o.id = s.opportunity_id AND o.org_id = s.org_id
            WHERE s.org_id = ? AND s.cancelled_at IS NULL AND s.published IS NOT FALSE
              AND o.archived_at IS NULL AND o.is_public = TRUE AND s.date >= ? AND s.date <= ?
            ORDER BY s.date, s.start_time, s.id LIMIT ${SHIFT_MAX}`, [orgId, today, until]),
  ]);
  const ids = slots.map(s => s.id);
  const [roles, counts] = ids.length ? await Promise.all([
    query(`SELECT id, slot_id, name, needed FROM volunteer_slot_roles WHERE slot_id = ANY(?) ORDER BY sort, name, id`, [ids]),
    query(`SELECT slot_id, role_id,
                  COUNT(*) FILTER (WHERE status IN ('confirmed','completed'))::int AS filled,
                  COUNT(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted
             FROM volunteer_signups WHERE org_id = ? AND slot_id = ANY(?) GROUP BY slot_id, role_id`, [orgId, ids]),
  ]) : [[], []];
  const countOf = (slotId, roleId) => counts.find(c => c.slot_id === slotId && (c.role_id || null) === (roleId || null)) || { filled: 0, waitlisted: 0 };
  const shifts = slots.map(s => {
    const mine = roles.filter(r => r.slot_id === s.id).map(r => {
      const c = countOf(s.id, r.id);
      const needed = r.needed == null ? null : Number(r.needed);
      return { id: r.id, name: r.name, needed, filled: c.filled, waitlisted: c.waitlisted, full: needed != null && c.filled >= needed };
    });
    let needed, filled, waitlisted;
    if (mine.length) {
      needed = mine.every(r => r.needed != null) ? mine.reduce((a, r) => a + r.needed, 0) : null;
      filled = mine.reduce((a, r) => a + r.filled, 0);
      waitlisted = mine.reduce((a, r) => a + r.waitlisted, 0);
    } else {
      const c = countOf(s.id, null);
      needed = s.capacity == null ? null : Number(s.capacity);
      filled = c.filled; waitlisted = c.waitlisted;
    }
    const full = mine.length ? mine.every(r => r.full) : (needed != null && filled >= needed);
    return { slotId: s.id, opportunityId: s.opportunity_id, oppName: s.opp_name, date: s.date, start: s.start_time, end: s.end_time,
      label: `${dayLabel(s.date)}, ${VS.timeRangeWords(s.start_time, s.end_time)}`,
      needed, filled, waitlisted, full, roles: mine };
  });
  const FS = require("./figureSources");
  const GRP = require("./groups");
  const year = today.slice(0, 4);
  const hoursSource = { key: "volunteer-hours", params: { from: `${year}-01-01`, to: today } };
  const f = await GRP.buildDonorFilter(orgId, { role: "volunteer" });
  const [[r], hours] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM donors WHERE ${f.whereSql}`, f.params),
    FS.figureValue(orgId, hoursSource),
  ]);
  const signup = (Array.isArray(widgets) ? widgets : []).find(w => w && w.type === "volsignup");
  return {
    today,
    opportunities: opps.map(o => ({ id: o.id, name: o.name, description: o.description || "", location: o.location || "",
      commitment: o.commitment || "", skills: o.skills || "",
      requiresWaiver: !!o.requires_waiver, requiresBackgroundCheck: !!o.requires_background_check })),
    shifts,
    impact: { year, hours: Number(hours.value || 0), hoursSentence: IMPACT_SENTENCES.hours(year), hoursSource,
      roster: r.n, rosterSentence: IMPACT_SENTENCES.roster() },
    questions: signup && Array.isArray(signup.questions) ? signup.questions : [],
  };
}

function dayLabel(iso) {
  const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return t.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

// The sign-up's words, checked once. Returns { error } or the clean values.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GROUP_KINDS = ["church", "school", "company", "other"];
function cleanSignup(b = {}) {
  const s = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
  const name = s(b.name, 200), email = s(b.email, 200).toLowerCase();
  if (!name || !EMAIL_RE.test(email)) return { error: "Please give your name and an email address." };
  const interests = (Array.isArray(b.interests) ? b.interests : []).map(x => s(x, 120)).filter(Boolean).slice(0, 12);
  const answers = (Array.isArray(b.answers) ? b.answers : []).map(a => ({ q: s(a && a.q, 200), a: s(a && a.a, 1000) }))
    .filter(a => a.q && a.a).slice(0, 5);
  let group = null;
  if (b.group && s(b.group.name, 200)) {
    const size = Math.round(Number(b.group.size));
    if (!Number.isFinite(size) || size < 2 || size > 500) return { error: "Say how many are in your group, from 2 to 500." };
    group = { name: s(b.group.name, 200), kind: GROUP_KINDS.includes(b.group.kind) ? b.group.kind : "other", size,
      leaderPhone: s(b.group.leaderPhone, 40) };
  }
  return { name, email, phone: s(b.phone, 40), availability: s(b.availability, 500), interests, answers,
    slotId: s(b.slotId, 60) || null, roleId: s(b.roleId, 60) || null, group };
}

module.exports = { KIND, GIVE_KIND_SQL, STARTERS, pageData, cleanSignup, dayLabel, GROUP_KINDS };
