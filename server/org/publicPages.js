// server/org/publicPages.js — an organization's public pages: giving pages, teams and fundraisers, events, volunteer and membership pages.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const TL = require("../../timelineLine");
const { CAMPAIGN_GIFT_MATCH, NOT_DELETED } = require("../../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  GIVE_THEME_COLS, MB_READY, campaignPageMod, coverFeePayload, demoMailNote, displayNameCase, donateLimiter,
  donorFacingOrgName, donorFromAddress, escapeHtml, eventLevelPayload, fundraiserPerson, generateEditToken,
  giveThemePayload, givingAccountEntry, givingPagePublicPayload, gpOrgSql, gpPageSql, levelTaken,
  membershipLevelPayload, openAdminTask, orgTakesGifts, orgTime, orgToday, orgTz, p2pTeamBoard, publicAppUrl,
  query, requireAdmin, requireAuth, resend, resolveWidgetsPublic, run, slugifyGivingPage,
  uniquePeerFundraiserSlug, uuid, wrap,
} = ctx;
// PARITY-2 Part 1: the one list of an org's public doors (the give hub).
const { waysToGive } = require("../../waysToGive");
let app = routers.r1;

// ── Public org slug list (diagnostic) ─────────────────────────────────────
app.get("/org/public-list", wrap(async (req, res) => {
  const orgs = await query("SELECT id, name, org_slug FROM orgs ORDER BY name ASC");
  res.json(orgs.map(o => ({ id: o.id, name: o.name, slug: o.org_slug, url: `/give/${o.org_slug}` })));
}));

// ── Public donation page ───────────────────────────────────────────────────
// POLISH-3 · ONE PAYLOAD FOR THE ORG'S OWN PAGE AND ITS PREVIEW, as GIVE-3
// did for giving pages: the public read and the editor's preview of the
// org-wide Donation form build it here, so the page and the preview cannot be
// handed two different shapes. The org's facts ride along for the trust panel.
const orgPageSql = where => `SELECT o.id, o.name, o.org_slug, o.mission, o.cover_fees_enabled, o.form_upsell_threshold_cents,
          o.form_upsell_monthly_cents,
          o.fee_rate_card_pct, o.fee_rate_card_flat_cents,
          o.fee_rate_ach_pct, o.fee_rate_ach_flat_cents, o.fee_rate_ach_cap_cents,
          o.legal_name, o.ein, o.receipt_address, o.stripe_account_id, o.stripe_connected, o.receipts_enabled,
          ${GIVE_THEME_COLS}
     FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE ${where}`;
async function orgPagePublicPayload(org, orgSlug, { draftForm = null } = {}) {
  org.donor_facing_name = String(org.display_name || "").trim() || org.name;
  const funds = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = $1 ORDER BY name ASC", [org.id]);
  // BUILD-49 entry point (c): the post-donation thank-you screen offers the
  // giving account only for listed orgs (givingAccountEntry — the one gate).
  // Listing is already public via the directory, so this reveals nothing new.
  const gaEntry = await givingAccountEntry({ id: org.id, org_slug: orgSlug });
  // BUILD-60 — the give page is the ORG's page: it carries the org's own theme.
  // PARITY-2 Part 1: the give hub: the org's other open doors (waysToGive.js).
  const ways = await waysToGive(org.id, orgSlug);
  const theme = giveThemePayload(org);
  // The editor's preview draws the drafted amounts, as Publish will set them.
  if (draftForm) {
    if (Array.isArray(draftForm.onetimeAmounts) && draftForm.onetimeAmounts.length) theme.onetimeAmounts = draftForm.onetimeAmounts.map(Number);
    if (Array.isArray(draftForm.monthlyAmounts) && draftForm.monthlyAmounts.length) theme.monthlyAmounts = draftForm.monthlyAmounts.map(Number);
  }
  return { org: { name: org.donor_facing_name, mission: org.mission, slug: orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false, ...(await coverFeePayload(org)), givingAccount: !!gaEntry, theme, portalSignIn: org.portal_enabled === true, ways,
    // GIVE-3's trust panel, on the org's own page too (shared/givingPageDesign.js decides which lines show).
    facts: { orgName: org.donor_facing_name, legalName: org.legal_name || "", ein: (await import("../../shared/placeholderCopy.js")).publicEin(org.ein),
             contactEmail: org.give_contact || "", address: org.receipt_address || "", stripe: !!org.stripe_account_id } }, funds };
}
app.get("/org/:orgSlug/public", wrap(async (req, res) => {
  // BUILD-58 W-2 — the give page is a DONOR-FACING money surface: it shows
  // the org's white-label display name (portal_settings.display_name) when
  // set, never the staff-side orgs.name (e.g. "CREO Arts (Demo)").
  const orgs = await query(orgPageSql("o.org_slug = $1"), [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  // FIX-58: the org's own donation form is gated like its giving pages: until
  // payments are connected it is not open, and its address says so. The
  // memberships page reads the same payload for the org's brand and asks with
  // ?memberships=1; a membership's checkout is refused by donateHandler on its
  // own until payments are connected, so that page never takes money either.
  const org = orgs[0];
  if (req.query.memberships !== "1" && !orgTakesGifts(org)) {
    const name = String(org.display_name || "").trim() || org.name;
    return res.status(404).json({ notOpen: true, orgName: name, error: `${name}'s giving page isn't open yet. Please check back soon.` });
  }
  res.json(await orgPagePublicPayload(org, req.params.orgSlug));
}));
// The editor's preview of the org's own Donation form: the same payload, with
// the drafted amounts. A GET: nothing is written.
app.get("/org-form/page/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgs = await query(orgPageSql("o.id = $1"), [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "not_found" });
  const [d] = await query("SELECT form_draft FROM portal_settings WHERE org_id = $1", [req.user.orgId]);
  const draft = d && d.form_draft && typeof d.form_draft === "object" ? d.form_draft : null;
  res.json(await orgPagePublicPayload(orgs[0], orgs[0].org_slug, { draftForm: draft }));
}));

// Public — org info + giving page + real live progress. Same shape as
// GET /org/:orgSlug/public, plus the page's own title/story/image/goal and
// the real computed raised total (never a manually-set counter).
// BUILD-98 (switch) Part 4 — an event's tickets, for the public giving page.
// Public by slug like every /org/:orgSlug/…/public read: it shows what a
// flyer would, and nothing about who has registered beyond places left.
app.get("/org/:orgSlug/event/:eventId/public", wrap(async (req, res) => {
  const [org] = await query("SELECT id, name FROM orgs WHERE org_slug=?", [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const [ev] = await query("SELECT id, name, date, location, description FROM events WHERE id=? AND org_id=? AND status <> 'cancelled' AND is_sample IS NOT TRUE", [req.params.eventId, org.id]);
  if (!ev) return res.status(404).json({ error: "Not found" });
  const levels = await query("SELECT * FROM event_levels WHERE event_id=? AND org_id=? AND retired_at IS NULL ORDER BY kind DESC, position, price", [ev.id, org.id]);
  const out = [];
  for (const l of levels) out.push(eventLevelPayload(l, await levelTaken(l.id)));
  res.json({ orgName: await donorFacingOrgName(org.id, org.name).catch(() => org.name),
    event: { id: ev.id, name: ev.name, date: orgTime.civilOf(ev.date), location: ev.location, description: ev.description },
    levels: out });
}));

// ── VOL-PAGE-1 · THE PUBLIC VOLUNTEER PAGE ─────────────────────────────────
// The giving page's read for a page of kind volunteer: the same brand, the
// same widget resolver, plus everything the volunteer blocks read (roles,
// shifts with filled of needed, impact numbers), all from records. A GET, so
// it writes nothing: the page counts its own view with POST /forms/:id/event.
// A quote without its volunteer's permission never leaves the server.
app.get("/org/:orgSlug/volunteer-page/:pageSlug/public", donateLimiter, wrap(async (req, res) => {
  const VP = require("../../volunteerPage");
  const [org] = await query(`SELECT o.id, o.name, o.org_slug, ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.org_slug = ?`,
    [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "not_found", message: "This page could not be found." });
  const [page] = await query(`SELECT id, title, slug, published, image_url, image_meta FROM giving_pages
     WHERE org_id = ? AND slug = ? AND page_kind = ? AND status = 'active' AND published IS NOT NULL`, [org.id, req.params.pageSlug, VP.KIND]);
  if (!page || !Array.isArray(page.published) || !page.published.length) return res.status(404).json({ error: "not_found", message: "This page could not be found." });
  const widgets = (await resolveWidgetsPublic(org, page.published, { pageId: page.id, today: orgToday(await orgTz(org.id)) }))   // ORG_TZ_SEAM_OK
    .filter(w => w.type !== "volquote" || (w.permission === true && w.text && w.name));
  const data = await VP.pageData(org.id, page.published);
  res.json({ org: { id: org.id, name: String(org.display_name || "").trim() || org.name, slug: org.org_slug },
    theme: giveThemePayload(org), page: { id: page.id, title: page.title, slug: page.slug,
      cover: page.image_url ? { url: page.image_url, ...(page.image_meta || {}) } : null }, widgets, data });   // FIX-41
}));
app.get("/org/:orgSlug/giving-page/:pageSlug/public", wrap(async (req, res) => {
  const orgs = await query(gpOrgSql("o.org_slug = ?"), [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  const pageRows = await query(gpPageSql("gp.org_id = ? AND gp.slug = ? AND gp.status = 'active' AND COALESCE(gp.page_kind,'give') = 'give'"),
    [org.id, req.params.pageSlug]);
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  // FUNDRAISING-2: a page is not open to the public until the org can take
  // money through it. Until payments are connected it is a draft, and its
  // address says so kindly instead of showing a form that cannot work.
  if (!orgTakesGifts(org)) return res.status(404).json({ notOpen: true, orgName: org.name,
    error: `${org.name}'s giving page isn't open yet. Please check back soon.` });
  res.json(await givingPagePublicPayload(org, pageRows[0], req.query));
}));
async function p2pIndividualBoard(orgId, pageId) {
  const rows = await query(
    `SELECT pf.id, pf.name, pf.slug, t.name AS team_name, t.slug AS team_slug,
            COALESCE((SELECT SUM(amount) FROM gifts WHERE peer_fundraiser_id = pf.id AND org_id = pf.org_id AND ${NOT_DELETED("gifts")}), 0)::float AS raised
       FROM peer_fundraisers pf
       LEFT JOIN p2p_teams t ON t.id = pf.team_id AND t.org_id = pf.org_id AND t.status = 'active'
      WHERE pf.org_id = ? AND pf.giving_page_id = ? AND pf.status = 'active'
      ORDER BY raised DESC, pf.created_at ASC LIMIT 500`, [orgId, pageId]);
  return rows.map(f => ({ id: f.id, name: f.name, slug: f.slug, teamName: f.team_name || null, teamSlug: f.team_slug || null,
    raisedAmount: Math.round(Number(f.raised) * 100) / 100 }));
}
async function p2pPublicPage(orgSlug, pageSlug) {
  const [org] = await query("SELECT id, name FROM orgs WHERE org_slug=?", [orgSlug]);
  if (!org) return null;
  const [pg] = await query(`SELECT id, slug, title FROM giving_pages WHERE org_id=? AND slug=? AND status='active' AND p2p_enabled = true`,
    [org.id, pageSlug]);
  return pg ? { org, pg } : null;
}

// "See all": every active fundraiser or team on the board, in order. Public:
// a name, a slug, a team and what was raised. Never an email, never a donor.
app.get("/org/:orgSlug/giving-page/:pageSlug/leaderboard", donateLimiter, wrap(async (req, res) => {
  const hit = await p2pPublicPage(req.params.orgSlug, req.params.pageSlug);
  if (!hit) return res.status(404).json({ error: "This giving page could not be found." });
  const kind = req.query.kind === "teams" ? "teams" : "individuals";
  const P2Pm = await import("../../shared/p2p.js");
  const rows = kind === "teams" ? await p2pTeamBoard(hit.org.id, hit.pg.id) : await p2pIndividualBoard(hit.org.id, hit.pg.id);
  res.json({ kind, rows, sentence: P2Pm.LEADERBOARD_SENTENCE });
}));

// A TEAM'S OWN PAGE (`/give/:org/:page?team=<slug>` on the client): its
// captain, its members and what each has raised, and the team's total
// against its goal. Public, and the roster is names only: a stranger reading
// a team page is shown who is raising, never who gave.
app.get("/org/:orgSlug/giving-page/:pageSlug/team/:teamSlug/public", donateLimiter, wrap(async (req, res) => {
  const hit = await p2pPublicPage(req.params.orgSlug, req.params.pageSlug);
  if (!hit) return res.status(404).json({ error: "This team could not be found." });
  const [t] = await query(`SELECT id, name, slug, goal_amount, captain_fundraiser_id FROM p2p_teams
                            WHERE org_id=? AND giving_page_id=? AND slug=? AND status='active'`,
    [hit.org.id, hit.pg.id, String(req.params.teamSlug).slice(0, 80)]);
  if (!t) return res.status(404).json({ error: "This team could not be found." });
  const P2Pm = await import("../../shared/p2p.js");
  const members = (await p2pIndividualBoard(hit.org.id, hit.pg.id)).filter(f => f.teamSlug === t.slug);
  const board = await p2pTeamBoard(hit.org.id, hit.pg.id);
  const mine = board.find(b => b.id === t.id) || { raisedAmount: 0 };
  const raisedCents = Math.round(mine.raisedAmount * 100);
  const goalCents = t.goal_amount != null ? Math.round(Number(t.goal_amount) * 100) : null;
  const captain = members.find(m => m.id === t.captain_fundraiser_id) || null;
  res.json({
    orgName: await donorFacingOrgName(hit.org.id, hit.org.name).catch(() => hit.org.name),
    givingPage: { slug: hit.pg.slug, title: hit.pg.title },
    team: {
      id: t.id, name: t.name, slug: t.slug,
      raisedAmount: raisedCents / 100, goalAmount: goalCents != null ? goalCents / 100 : null,
      captain: captain ? { name: captain.name, slug: captain.slug } : null,
      members: members.map(m => ({ name: m.name, slug: m.slug, raisedAmount: m.raisedAmount, isCaptain: m.id === t.captain_fundraiser_id })),
      sentence: P2Pm.teamSentence({ teamName: t.name, raisedCents, goalCents, memberCount: members.length })
        + " It is every gift given through its members' pages, summed live.",
    },
  });
}));

async function sendFundraiserManageEmail(org, fundraiser, givingPage, manageUrl, { pending = false } = {}) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const from = await donorFromAddress(org.id); // BUILD-64: the org's name in the inbox
    // PARITY-2 Part 2: a page that waits for approval says so, rather than
    // telling somebody their page is live when it is not yet.
    const { error } = await resend.emails.send({
      from, _stewardOrgId: org.id, _stewardKind: "fundraiser_manage",   // MAIL-1: the org's mail policy applies
      to: fundraiser.email,
      subject: pending ? `Your fundraiser for ${displayNameCase(org.name)} is waiting for approval`
                       : `Your fundraiser for ${displayNameCase(org.name)} is live!`,
      html: `<p>Hi ${escapeHtml(fundraiser.name)},</p>
             <p>Thanks for starting a personal fundraiser for <strong>${escapeHtml(givingPage.title)}</strong> on behalf of <strong>${escapeHtml(org.name)}</strong>! ${pending ? `${escapeHtml(org.name)} looks at every new page before it goes live, and yours will be public as soon as they approve it. You can write your story in the meantime.` : "Your page is live and ready to share."}</p>
             <p><a href="${manageUrl}" style="background:#c9a84c;color:#0f1a12;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Manage Your Fundraiser</a></p>
             <p>Use that link any time to update your story, goal, or photo, bookmark it, since there's no password to reset it with.</p>`,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.error("Fundraiser manage email send failed:", err.message);
    return false;
  }
}

// BUILD-103 Part 1 — the teams on this campaign, for the sign-up screen.
// Public, and it returns a name, a slug and what the team has raised. Never a
// member list and never an email: a stranger reading a campaign page is not
// entitled to the roster.
app.get("/org/:orgSlug/giving-page/:pageSlug/teams", donateLimiter, wrap(async (req, res) => {
  const [org] = await query("SELECT id FROM orgs WHERE org_slug=?", [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const [pg] = await query(`SELECT id FROM giving_pages WHERE org_id=? AND slug=? AND status='active' AND p2p_enabled = true`,
    [org.id, req.params.pageSlug]);
  if (!pg) return res.json({ teams: [] });
  const rows = await query(
    `SELECT t.id, t.name, t.slug, t.goal_amount,
            (SELECT COUNT(*)::int FROM peer_fundraisers pf WHERE pf.team_id=t.id AND pf.status='active') AS members,
            COALESCE((SELECT SUM(g.amount) FROM gifts g JOIN peer_fundraisers pf ON pf.id=g.peer_fundraiser_id
                       WHERE pf.team_id=t.id AND g.amount > 0),0)::float AS raised
       FROM p2p_teams t WHERE t.giving_page_id=? AND t.org_id=? AND t.status='active'
      ORDER BY raised DESC, t.name LIMIT 200`, [pg.id, org.id]);
  res.json({ teams: rows.map(t => ({ id: t.id, name: t.name, slug: t.slug, members: t.members,
    raisedCents: Math.round(Number(t.raised) * 100),
    goalCents: t.goal_amount != null ? Math.round(Number(t.goal_amount) * 100) : null })) });
}));

// Public — a supporter starting a fundraiser from a live Giving Page. No
// auth (this is the entire point — spur-of-the-moment, zero account setup),
// rate-limited the same as the donation route it sits next to since it's
// the same abuse surface (public, unauthenticated, org-costs-nothing-to-spam
// concern). Only succeeds against an *active* parent page — same rule
// POST /donate/:orgSlug already enforces for donations themselves.
app.post("/org/:orgSlug/giving-page/:pageSlug/fundraisers", donateLimiter, wrap(async (req, res) => {
  const { name, email, personalGoalAmount, story, imageUrl } = req.body;
  if (!name || !name.trim() || !email || !email.trim()) return res.status(400).json({ error: "Name and email are required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: "Please enter a valid email address." });
  if (name.trim().length > 200) return res.status(400).json({ error: "Name is too long." });
  if (email.trim().length > 320) return res.status(400).json({ error: "Email is too long." });
  if (story && story.length > 5000) return res.status(400).json({ error: "Story is too long (5,000 character max)." });
  if (imageUrl && imageUrl.length > 2000) return res.status(400).json({ error: "Image URL is too long." });
  if (personalGoalAmount && (!Number.isFinite(parseFloat(personalGoalAmount)) || parseFloat(personalGoalAmount) <= 0)) return res.status(400).json({ error: "Personal goal must be a positive number." });

  const orgs = await query("SELECT id, name FROM orgs WHERE org_slug = ?", [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];

  const pageRows = await query("SELECT * FROM giving_pages WHERE org_id=? AND slug=? AND status='active'", [org.id, req.params.pageSlug]);
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  const givingPage = pageRows[0];
  // BUILD-103 — a peer-to-peer campaign is a giving page with the switch on.
  // A page that is not one does not take fundraisers, and says so in the same
  // words it would use for a page that is not there.
  if (givingPage.p2p_enabled !== true) return res.status(404).json({ error: "This giving page could not be found." });

  // BUILD-103 Part 1 — JOIN A TEAM, OR START ONE. A team belongs to this page
  // and is looked up under it, so a team id from another org's campaign finds
  // nothing rather than being refused by a check somebody could forget.
  const P2Pm = await import("../../shared/p2p.js");
  let teamId = null;
  let startedTeam = false;   // PARITY-2 Part 2: whoever starts a team at sign-up is its captain
  if (req.body?.teamId) {
    const [t] = await query(`SELECT id FROM p2p_teams WHERE id=? AND giving_page_id=? AND org_id=? AND status='active'`,
      [String(req.body.teamId), givingPage.id, org.id]);
    if (!t) return res.status(404).json({ error: "That team is not on this campaign." });
    teamId = t.id;
  } else if (String(req.body?.teamName || "").trim()) {
    const v = P2Pm.validateTeam({ name: req.body.teamName, goalAmount: req.body.teamGoalAmount });
    if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
    const [existing] = await query(`SELECT id FROM p2p_teams WHERE giving_page_id=? AND slug=?`, [givingPage.id, v.team.slug]);
    if (existing) teamId = existing.id;
    else {
      startedTeam = true;
      teamId = newId("pt");
      await run(`INSERT INTO p2p_teams (id,org_id,giving_page_id,name,slug,goal_amount,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,'system:p2p-signup','The fundraiser, from the sign-up page')`,
        [teamId, org.id, givingPage.id, v.team.name, v.team.slug, v.team.goalCents == null ? null : v.team.goalCents / 100]);
    }
  }

  // BUILD-103 Part 5: ONE PERSON RECORD. The fundraiser is matched to the
  // CRM by EXACT EMAIL, never by name, and somebody nobody has heard of
  // becomes a person typed VOLUNTEER — not a donor. They are not a donor
  // until they give, and typing them as one would put somebody who has never
  // given a penny into every donor list the office reads.
  const cleanEmail = email.trim().toLowerCase();
  const personId = await fundraiserPerson(org.id, name.trim(), cleanEmail,
    { id: "system:p2p-signup", name: "The fundraiser, from the sign-up page" });

  const base = slugifyGivingPage(name);
  const id = newId("pf");
  const editToken = generateEditToken();
  const editTokenHash = require("crypto").createHash("sha256").update(editToken).digest("hex");

  // uniquePeerFundraiserSlug's own SELECT check has a narrow TOCTOU window
  // against a second near-simultaneous submission slugifying to the same
  // base — the unique index (giving_page_id, slug) is the real guarantee,
  // this retry loop just turns that rare race into a friendly re-slug
  // instead of a raw 500.
  let slug = await uniquePeerFundraiserSlug(givingPage.id, base);
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    try {
      await run(
        // The token is stored as its SHA-256 and nowhere else (BUILD-103): the
        // manage link is the whole auth model, so it is held the way every
        // other credential in this codebase is held.
        // PARITY-2 Part 2: a page that asks for approval writes the new
        // fundraiser 'pending': not public and taking no gifts until a staff
        // member approves it. Off by default, so 'active' as before.
        `INSERT INTO peer_fundraisers (id, org_id, giving_page_id, name, email, slug, personal_goal_amount, story, image_url, status, edit_token, edit_token_hash, team_id, person_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
        [id, org.id, givingPage.id, name.trim(), cleanEmail, slug, personalGoalAmount ? parseFloat(personalGoalAmount) : null, story || "", imageUrl || "",
         givingPage.p2p_requires_approval === true ? "pending" : "active", editTokenHash, teamId, personId]
      );
      inserted = true;
    } catch (e) {
      if (attempt === 2) throw e;
      slug = await uniquePeerFundraiserSlug(givingPage.id, `${base}-${Date.now().toString(36).slice(-4)}`);
    }
  }

  // WIRE-1: starting a page is a line on the fundraiser's own timeline.
  await TL.timelineLine({ orgId: org.id, donorId: personId, note: `Started a fundraising page: ${givingPage.title}.`,
    actorId: "system:p2p-signup", actorName: "The fundraiser, from the sign-up page", key: `p2p_page:${id}`,
    metadata: { via: "peer_fundraiser", fundraiser_id: id, giving_page_id: givingPage.id } });

  // PARITY-2 Part 2: the person who starts a team is its captain. Staff can
  // change it from the P2P screen.
  if (startedTeam && teamId) {
    await run(`UPDATE p2p_teams SET captain_fundraiser_id=?, updated_at=NOW() WHERE id=? AND org_id=? AND captain_fundraiser_id IS NULL`,
      [id, teamId, org.id]);
  }
  const pending = givingPage.p2p_requires_approval === true;
  // WIRE-1: a page waiting for approval is a task for an admin, linked to the
  // person, so it is somebody's job and not a row nobody opens.
  if (pending && openAdminTask) {
    await openAdminTask(org.id, {
      title: `Approve ${name.trim()}'s fundraising page for ${givingPage.title || "a giving page"}`, priority: "high",
      donorId: personId || null, actorId: "system:p2p-signup", actorName: "The fundraiser, from the sign-up page",
    }).catch(e => console.error("[p2p] approval task:", e.message));
  }

  const frontendUrl = publicAppUrl();
  const publicUrl = `${frontendUrl}/give/${req.params.orgSlug}/${req.params.pageSlug}/${slug}`;
  const manageUrl = `${frontendUrl}/fundraiser/manage/${editToken}`;

  // manageUrl/editToken are deliberately NOT returned here. invites.token
  // is the same "long random value, stored, looked up directly" shape, but
  // invites are minted by an authenticated admin (requireAuth+requireAdmin)
  // for someone they're accountable for, so returning the link in that
  // response is safe. This route is fully public and unauthenticated —
  // returning the token directly would let anyone submit a stranger's real
  // name+email and get durable control of a fundraiser attributed to them
  // instantly, with the stranger left holding an unsolicited email and no
  // recourse (no password to reset). Email is the only legitimate channel;
  // the frontend redirects to publicUrl and surfaces emailSent so a failed
  // send is visible instead of silently stranding the supporter.
  const emailSent = await sendFundraiserManageEmail(org, { name: name.trim(), email: email.trim() }, givingPage, manageUrl, { pending });

  // FIX-7 Part 6.2 — the demonstration org mails nobody. The sign-up still
  // works and the page still exists; the screen says what would have arrived
  // and where, rather than showing a failed send or nothing at all.
  const demoNote = await demoMailNote(org.id, { what: "the link to their fundraiser dashboard", to: cleanEmail });
  res.status(201).json({ id, slug, publicUrl, emailSent, teamId, pending,
    ...(pending ? { pendingSentence: `${displayNameCase(org.name)} looks at every new page before it goes live. Yours is waiting for them now, and the link to manage it is in your email.` } : {}),
    ...(demoNote ? { demoNote } : {}) });
}));

// Public — fundraiser's own page: name/image/story/goal + real live
// progress computed the same way the parent page's is (never a manually-set
// number). Includes the parent givingPage's fund designation so the shared
// Donate.jsx form's "hide fund selector when the page already designates
// one" logic keeps working unmodified one level down. A fundraiser 404s the
// same way an archived/nonexistent giving page does (indistinguishable from
// "never existed") if either the fundraiser OR its parent page is archived —
// a fundraiser cannot outlive its campaign's own availability.
app.get("/org/:orgSlug/giving-page/:pageSlug/fundraiser/:fundraiserSlug/public", wrap(async (req, res) => {
  const orgs = await query(`SELECT o.id, o.name, o.mission, o.cover_fees_enabled, o.form_upsell_threshold_cents,
          o.form_upsell_monthly_cents,
          o.fee_rate_card_pct, o.fee_rate_card_flat_cents,
          o.fee_rate_ach_pct, o.fee_rate_ach_flat_cents, o.fee_rate_ach_cap_cents,
          ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.org_slug = ?`, [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  org.donor_facing_name = String(org.display_name || "").trim() || org.name; // W-2 white-label

  const pageRows = await query(
    `SELECT gp.*, to_char(gp.ends_on,'YYYY-MM-DD') AS page_ends_on, f.name AS fund_name FROM giving_pages gp LEFT JOIN fin_funds f ON f.id = gp.fund_id
     WHERE gp.org_id = ? AND gp.slug = ? AND gp.status = 'active'`,
    [org.id, req.params.pageSlug]
  );
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  const page = pageRows[0];

  const fRows = await query(
    `SELECT pf.*, COALESCE((SELECT SUM(amount) FROM gifts WHERE peer_fundraiser_id = pf.id AND ${NOT_DELETED("gifts")}), 0) AS raised_amount
     FROM peer_fundraisers pf WHERE pf.giving_page_id=? AND pf.slug=? AND pf.status='active'`,
    [page.id, req.params.fundraiserSlug]
  );
  if (!fRows.length) return res.status(404).json({ error: "This fundraiser could not be found." });
  const f = fRows[0];

  // PARITY-2 Part 2: what a fundraiser's own page shows beyond the bar: the
  // team it belongs to, the recent donors (a first name only where the donor
  // chose to show it publicly, otherwise Anonymous, and the amount), the
  // share links with their UTM tags and the campaign's countdown.
  const P2Pm = await import("../../shared/p2p.js");
  const CPm = await campaignPageMod();
  const [team] = f.team_id ? await query(`SELECT name, slug FROM p2p_teams WHERE id=? AND org_id=? AND status='active'`, [f.team_id, org.id]) : [];
  const recentRows = await query(
    `SELECT g.date, g.amount, g.cover_fee_amount, g.show_name_publicly, d.name AS donor_name
       FROM gifts g LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND g.peer_fundraiser_id = ? AND g.amount > 0
      ORDER BY g.date DESC NULLS LAST, g.created_at DESC LIMIT 10`, [org.id, f.id]);
  const [{ n: donorN } = { n: 0 }] = await query(
    `SELECT COUNT(DISTINCT donor_id)::int AS n FROM gifts WHERE org_id = ? AND peer_fundraiser_id = ? AND amount > 0`, [org.id, f.id]);
  const [camp] = page.campaign_id ? await query(`SELECT to_char(end_date,'YYYY-MM-DD') AS end_date FROM campaigns WHERE id=? AND org_id=?`, [page.campaign_id, org.id]) : [];
  const endDate = camp?.end_date || page.page_ends_on || null;
  const raisedCents = Math.round((parseFloat(f.raised_amount) || 0) * 100);
  const goalCents = f.personal_goal_amount != null ? Math.round(Number(f.personal_goal_amount) * 100) : null;
  const shareUrl = `${publicAppUrl()}/give/${req.params.orgSlug}/${page.slug}/${f.slug}`;

  res.json({
    org: { name: org.donor_facing_name, mission: org.mission, slug: req.params.orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false, ...(await coverFeePayload(org)), givingAccount: !!(await givingAccountEntry({ id: org.id, org_slug: req.params.orgSlug })), theme: giveThemePayload(org), portalSignIn: org.portal_enabled === true },
    givingPage: { id: page.id, slug: page.slug, title: page.title, fundId: page.fund_id, fundName: page.fund_name || null, p2pEnabled: page.p2p_enabled === true },
    peerFundraiser: {
      id: f.id, slug: f.slug, name: f.name, story: f.story, imageUrl: f.image_url,
      cover: f.image_url ? { url: f.image_url, ...(f.image_meta || {}) } : null,
      personalGoalAmount: f.personal_goal_amount != null ? parseFloat(f.personal_goal_amount) : null,
      raisedAmount: parseFloat(f.raised_amount) || 0,
      raisedSentence: P2Pm.publicRaisedSentence({ name: f.name, raisedCents, goalCents }),
      donorCount: donorN,
      donorCountLine: P2Pm.donorCountLine(donorN),
      team: team ? { name: team.name, slug: team.slug } : null,
      recentDonors: recentRows.map(r => CPm.publicGiftLine({
        donorName: r.donor_name,
        amountCents: Math.round(Number(r.amount) * 100),   // FIX-49: the full gift, a covered fee included
        showName: r.show_name_publicly === true, date: r.date }, { showAmounts: true })),
      recentDonorsSentence: P2Pm.RECENT_DONORS_SENTENCE,
      share: P2Pm.shareLinks({ link: shareUrl, fundraiserSlug: f.slug,
        text: `I'm raising money for ${page.title || org.donor_facing_name}.` }),
      endDate,
      countdown: endDate ? CPm.countdownSentence(endDate, orgToday(await orgTz(org.id))) : null,   // ORG_TZ_SEAM_OK: the org's own day
    },
    funds: [],
  });
}));

// Public by slug, like the event tickets read: what a flyer would show, and
// what the receipt will call deductible, before she pays.
app.get("/org/:orgSlug/membership/:levelId/public", wrap(async (req, res) => {
  await MB_READY;
  const [org] = await query("SELECT id, name FROM orgs WHERE org_slug=?", [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const [l] = await query("SELECT * FROM membership_levels WHERE id=? AND org_id=? AND active IS NOT FALSE", [req.params.levelId, org.id]);
  if (!l) return res.status(404).json({ error: "Not found" });
  res.json({ orgName: await donorFacingOrgName(org.id, org.name).catch(() => org.name),
    level: publicLevelPayload(l) });
}));

// The public face of a level: what the card and the checkout state, and
// nothing about who holds it. One shape for the single-level page and the
// membership page, so the two cannot describe one level differently.
function publicLevelPayload(l) {
  const p = membershipLevelPayload(l);
  return { id: p.id, name: p.name, price: p.price, fmv: p.fmv, deductible: p.deductible, term: p.term, termLabel: p.termLabel,
           priceSuffix: p.priceSuffix, description: p.description, scope: p.scope, benefits: p.benefits,
           autoRenew: !!p.autoRenewFrequency, autoRenewFrequency: p.autoRenewFrequency, picture: p.picture };
}

// PARITY-2 Part 1: THE MEMBERSHIP PAGE (`/give/:orgSlug?memberships`). Every
// level that is for sale and not hidden, in the org's order, with the org's
// own theme so the page is theirs. Public by slug, like the single level.
app.get("/org/:orgSlug/memberships/public", wrap(async (req, res) => {
  await MB_READY;
  const [org] = await query(
    `SELECT o.id, o.name, ps.membership_cover, ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.org_slug=?`,
    [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const levels = await query(
    `SELECT * FROM membership_levels WHERE org_id=? AND active IS NOT FALSE AND hidden IS NOT TRUE
      ORDER BY position, price, name`, [org.id]);
  res.json({ orgName: String(org.display_name || "").trim() || org.name, slug: req.params.orgSlug,
    theme: giveThemePayload(org), portalSignIn: org.portal_enabled === true,
    cover: org.membership_cover || null,   // FIX-41: the membership page's cover photo
    levels: levels.map(publicLevelPayload) });
}));
}

module.exports = { routers, mount };
