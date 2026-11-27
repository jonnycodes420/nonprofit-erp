// server/public/shortLinks.js · HONEST-3 item 5 (W-1127-Public-01). THE SHORT LINK WORKS.
//
// "/volunteer/harborlight returns Not found on production, while the working page is the non-obvious
// /volunteer-page/harborlight/volunteer found only through the in-app Share menu." /volunteer/<slug>
// was only ever an opportunity's address. It still is first; when no opportunity has that slug and an
// organization does, it goes to that org's volunteer page (its published page, else its list of
// opportunities). /event/<org>/<event> goes to the event's page at /e/<event> when that org owns it.
// A slug that is neither says "We couldn't find that organization", never a blank Not found.
"use strict";

const NOT_FOUND_TITLE = "We couldn't find that organization";
const NOT_FOUND_LINE = "Check the link, or ask the organization for its current one.";
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function orgBySlug(query, slug) {
  const [o] = await query("SELECT id, org_slug FROM orgs WHERE org_slug = ? AND archived_at IS NULL", [String(slug || "")]);
  return o || null;
}

// The org's volunteer page: its oldest published one, else /volunteer-with/<org>. Null for no such org.
async function volunteerTarget(query, slug) {
  const o = await orgBySlug(query, slug);
  if (!o) return null;
  const [p] = await query(
    `SELECT slug FROM giving_pages WHERE org_id = ? AND page_kind = 'volunteer' AND status = 'active'
        AND jsonb_typeof(published) = 'array' AND jsonb_array_length(published) > 0
      ORDER BY created_at ASC LIMIT 1`, [o.id]);
  return p ? `/volunteer-page/${encodeURIComponent(o.org_slug)}/${encodeURIComponent(p.slug)}` : `/volunteer-with/${encodeURIComponent(o.org_slug)}`;
}

// The short volunteer link for an org's page, when that page is the one /volunteer/<org> opens.
async function shortVolunteerUrl(query, orgId, pageSlug) {
  const [o] = await query("SELECT org_slug FROM orgs WHERE id = ?", [orgId]);
  if (!o || !o.org_slug) return null;
  const [opp] = await query("SELECT 1 AS x FROM volunteer_opportunities WHERE slug = ? AND archived_at IS NULL AND is_public = TRUE LIMIT 1", [o.org_slug]);
  if (opp) return null;   // an opportunity owns that address
  const to = await volunteerTarget(query, o.org_slug);
  return to === `/volunteer-page/${encodeURIComponent(o.org_slug)}/${encodeURIComponent(pageSlug)}` ? `/volunteer/${encodeURIComponent(o.org_slug)}` : null;
}

function notFoundBody() {
  return `<div class="card" data-testid="org-not-found"><h1>${esc(NOT_FOUND_TITLE)}</h1><p class="muted">${esc(NOT_FOUND_LINE)}</p></div>`;
}

function mount(app, { wrap, query, donateLimiter, evPage }) {
  app.get("/event/:orgSlug/:eventSlug", donateLimiter, wrap(async (req, res) => {
    const o = await orgBySlug(query, req.params.orgSlug);
    if (o) {
      const [e] = await query(
        `SELECT public_slug FROM events WHERE org_id = ? AND (public_slug = ? OR previous_slug = ?) AND status <> 'cancelled' LIMIT 1`,
        [o.id, String(req.params.eventSlug || ""), String(req.params.eventSlug || "")]);
      if (e && e.public_slug) return res.redirect(302, `/e/${encodeURIComponent(e.public_slug)}`);
    }
    res.status(404).send(evPage({ title: o ? "That event isn't here" : NOT_FOUND_TITLE,
      brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
      body: o ? `<div class="card"><h1>That event isn't here.</h1><p class="muted">The link may have changed, or the event has been taken down. Ask the organization for its current link.</p></div>` : notFoundBody() }));
  }));
}

module.exports = { volunteerTarget, shortVolunteerUrl, notFoundBody, mount, NOT_FOUND_TITLE, NOT_FOUND_LINE };
