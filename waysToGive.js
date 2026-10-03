// waysToGive.js: PARITY-2 Part 1. THE ORG'S GIVE HUB.
//
// The org-wide giving page (`/give/:orgSlug`) ends with "More ways to give":
// every other public door this organisation has open today. This is the ONE
// place that list is built, so a new kind of door (an auction, a shop) is one
// more block here and nowhere else.
//
// Each entry is { kind, title, sentence, href }. `href` is a path on the
// public site, never a deployment host (the publicAppUrl rule): the page
// that renders it is already on that host.
//
// Only what a stranger with the flyer could already open is listed:
//   · the membership page, when at least one level is for sale and not hidden;
//   · each peer-to-peer giving page that is live (status 'active', p2p on);
//   · each upcoming event with a public page (`/e/:slug`), not cancelled and
//     not sample data.
// Every query is scoped by org_id. Nothing here names a donor or a sum.

const { query } = require("./db");
const { orgToday } = require("./orgTime");

const MAX_PAGES = 6;
const MAX_EVENTS = 6;

async function waysToGive(orgId, orgSlug) {
  const ways = [];
  const slug = encodeURIComponent(String(orgSlug || ""));

  const [lv] = await query(
    `SELECT COUNT(*)::int AS n FROM membership_levels
      WHERE org_id = ? AND active IS NOT FALSE AND hidden IS NOT TRUE`, [orgId]);
  if (lv && lv.n > 0) {
    ways.push({ kind: "membership", title: "Become a member",
      sentence: lv.n === 1 ? "One membership level, with what it includes." : `${lv.n} membership levels, with what each includes.`,
      href: `/give/${slug}?memberships` });
  }

  const pages = await query(
    `SELECT slug, title FROM giving_pages
      WHERE org_id = ? AND status = 'active' AND p2p_enabled = TRUE
      ORDER BY created_at DESC LIMIT ?`, [orgId, MAX_PAGES]);
  for (const p of pages) {
    ways.push({ kind: "p2p", title: p.title,
      sentence: "Give to the campaign, or start your own fundraising page for it.",
      href: `/give/${slug}/${encodeURIComponent(p.slug)}` });
  }

  // "Upcoming" in the ORG's calendar, never the database clock's.
  const [o] = await query(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
  const today = orgToday(o || {});
  const events = await query(
    `SELECT name, public_slug, to_char(date, 'YYYY-MM-DD') AS date FROM events
      WHERE org_id = ? AND public_slug IS NOT NULL AND status <> 'cancelled'
        AND is_sample IS NOT TRUE AND date >= ?::date
      ORDER BY date ASC LIMIT ?`, [orgId, today, MAX_EVENTS]);
  for (const e of events) {
    ways.push({ kind: "event", title: e.name, date: e.date,
      sentence: "An upcoming event. Get tickets or register on its page.",
      href: `/e/${encodeURIComponent(e.public_slug)}` });
  }
  return ways;
}

module.exports = { waysToGive };
