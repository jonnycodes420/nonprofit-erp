// server/shared/givingPagePayload.js — a giving page's public payload, its teams and peer fundraisers.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const { CAMPAIGN_GIFT_MATCH, NOT_DELETED } = require("../../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign
const { newId } = require("./newId");   // IDS-1: every new row id is prefix + 20 hex

function mount(ctx) {
const {
  GIVE_THEME_COLS, campaignPageMod, coverFeePayload, formConfigMod, giveThemePayload, givingAccountEntry,
  orgToday, orgTz, query, resolveWidgetsPublic, run, uuid, widgetMod, withSmartAmounts,
} = ctx;

// GIVE-3 · ONE PAYLOAD FOR THE PAGE AND ITS PREVIEW. The public read and the
// editor's preview (GET /giving-pages/:id/page/preview) select the same rows
// and build the same payload in givingPagePublicPayload, so the component
// that draws them cannot be handed two different shapes.
const gpOrgSql = where => `SELECT o.id, o.name, o.org_slug, o.legal_name, o.ein, o.receipt_address, o.stripe_account_id, o.stripe_connected, o.mission, o.cover_fees_enabled, o.form_upsell_threshold_cents,
          o.form_upsell_monthly_cents,
          o.fee_rate_card_pct, o.fee_rate_card_flat_cents,
          o.fee_rate_ach_pct, o.fee_rate_ach_flat_cents, o.fee_rate_ach_cap_cents,
          ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE ${where}`;
const gpPageSql = where => `SELECT gp.*, f.name AS fund_name, c.name AS campaign_name, c.goal_amount AS campaign_goal,
       to_char(c.end_date,'YYYY-MM-DD') AS campaign_end_date, c.match_cents AS campaign_match_cents,
       to_char(gp.ends_on,'YYYY-MM-DD') AS page_ends_on,
       COALESCE((SELECT SUM(amount) FROM gifts WHERE giving_page_id = gp.id AND ${NOT_DELETED("gifts")}), 0) AS raised_amount,
       CASE WHEN gp.campaign_id IS NOT NULL THEN
         0   -- FIX-49: filled below by numbers.publicBarRaised, the one public-bar rule
       END AS campaign_raised,
       -- PARITY-2 Part 2: THE DONOR COUNT BESIDE THE BAR, over the SAME rows
       -- the bar sums (the page's, or its campaign's when it counts toward
       -- one): each person once, however many gifts they made.
       (SELECT COUNT(DISTINCT donor_id)::int FROM gifts WHERE giving_page_id = gp.id AND amount > 0 AND ${NOT_DELETED("gifts")}) AS page_donors,
       CASE WHEN gp.campaign_id IS NOT NULL THEN
         (SELECT COUNT(DISTINCT g.donor_id)::int FROM gifts g WHERE g.org_id = gp.org_id AND g.amount > 0 AND ${CAMPAIGN_GIFT_MATCH("g", "c")})
       END AS campaign_donors
     FROM giving_pages gp
     LEFT JOIN fin_funds f ON f.id = gp.fund_id
     LEFT JOIN campaigns c ON c.id = gp.campaign_id AND c.org_id = gp.org_id
     WHERE ${where}`;

async function givingPagePublicPayload(org, page, reqQuery, { editing = false } = {}) {
  const req = { query: reqQuery || {}, params: { orgSlug: org.org_slug } };
  org.donor_facing_name = String(org.display_name || "").trim() || org.name; // W-2 white-label
  const funds = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = ? ORDER BY name ASC", [org.id]);
  // GIVE-3 · THE GOAL BAR FOOTS. A page that counts toward a campaign shows
  // the campaign's own total from NUMBERS-1's one query (numbers.campaignGiftTotals,
  // CAMPAIGN_GIFT_MATCH: inside the campaign's dates, deleted people out), the
  // number Fundraising shows. Read by the page's campaign id, so a draft that
  // points at another campaign previews that campaign's bar.
  if (page.campaign_id) {
    const [c] = await query("SELECT name, goal_amount, to_char(end_date,'YYYY-MM-DD') AS end_date FROM campaigns WHERE id = ? AND org_id = ?", [page.campaign_id, org.id]);
    if (c) {
      const tot = (await require("../../numbers").campaignGiftTotals(query, org.id)).find(r => r.cid === page.campaign_id);
      Object.assign(page, { campaign_name: c.name, campaign_goal: c.goal_amount, campaign_end_date: c.end_date });
      if (tot) { page.campaign_raised = tot.raised; page.campaign_donors = Number(tot.donor_count) || 0; }
      // FIX-49: the bar counts the campaign's gifts and, unless the campaign says
      // "Leave grants off the public bar", its awarded grants.
      page.campaign_raised = await require("../../numbers").publicBarRaised(query, org.id, page.campaign_id);
    } else page.campaign_id = null;
  }
  const GD = await import("../../shared/givingPageDesign.js");
  // WALKB-1: a hint is never published, and a placeholder EIN never reaches a stranger.
  const PH = await import("../../shared/placeholderCopy.js");
  const pageToday = orgToday(await orgTz(org.id));   // ORG_TZ_SEAM_OK: days left is the org's own day
  const daysLeft = page.campaign_end_date
    ? Math.max(0, Math.round((Date.parse(page.campaign_end_date + "T00:00:00Z") - Date.parse(pageToday + "T00:00:00Z")) / 86400000)) : null;

  // BUILD-95 §5B — the built page, if she has published one.
  const { normalizeFormPosition } = await widgetMod();
  const formPos = normalizeFormPosition(page.form_position);
  // CAMPAIGN-2 — the page's own id and its campaign's end date travel with the
  // widgets, so a countdown, a match and a recent-gifts list resolve against the
  // campaign this page IS rather than against a date somebody typed twice.
  const publishedWidgets = editing ? page.published : PH.widgetsWithoutHints(page.published);
  const builtWidgets = Array.isArray(publishedWidgets) && publishedWidgets.length
    ? await resolveWidgetsPublic(org, publishedWidgets, {
        keepHints: editing,
        pageId: page.id,
        campaignId: page.campaign_id || null,
        campaignEndDate: page.campaign_end_date || null,
        today: orgToday(await orgTz(org.id)),           // ORG_TZ_SEAM_OK — a countdown is the org's own day
      })
    : null;

  // Rollup + leaderboard — cheap once peer gifts always carry the parent's
  // giving_page_id (see gifts.peer_fundraiser_id comment in db.js): the
  // page's own raised_amount above already includes every peer gift with no
  // extra logic, and this is just the same SUM one level down, grouped by
  // fundraiser. Live every call, never cached, same rule as raised_amount.
  const fundraiserRows = await query(
    `SELECT pf.id, pf.name, pf.slug,
       COALESCE((SELECT SUM(amount) FROM gifts WHERE peer_fundraiser_id = pf.id AND ${NOT_DELETED("gifts")}), 0) AS raised_amount
     FROM peer_fundraisers pf
     WHERE pf.giving_page_id = ? AND pf.status = 'active'
     ORDER BY raised_amount DESC, pf.created_at ASC`,
    [page.id]
  );
  // PARITY-2 Part 2: the teams board and the campaign's own countdown, only
  // on a peer-to-peer page. The board is the same helper the "See all" read
  // uses, so the top ten and the full list cannot rank differently.
  const p2pOn = page.p2p_enabled === true;
  const P2Pm = p2pOn ? await import("../../shared/p2p.js") : null;
  const teamBoard = p2pOn ? await p2pTeamBoard(org.id, page.id) : [];
  const p2pEndDate = page.campaign_end_date || page.page_ends_on || null;
  const p2pToday = orgToday(await orgTz(org.id));                 // ORG_TZ_SEAM_OK: a countdown is the org's own day
  const shownDonors = page.campaign_id && page.campaign_donors != null ? Number(page.campaign_donors) : Number(page.page_donors || 0);

  return {
    org: { name: org.donor_facing_name, mission: org.mission, slug: req.params.orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false, ...(await coverFeePayload(org)), givingAccount: !!(await givingAccountEntry({ id: org.id, org_slug: req.params.orgSlug })), theme: giveThemePayload(org), portalSignIn: org.portal_enabled === true,
      // GIVE-3: the org's own facts the trust panel and "other ways to give"
      // may state (shared/givingPageDesign.js decides which lines show).
      facts: { orgName: org.donor_facing_name, legalName: org.legal_name || "", ein: PH.publicEin(org.ein),
               contactEmail: org.give_contact || "", address: org.receipt_address || "", stripe: !!org.stripe_account_id } },
    givingPage: {
      id: page.id, slug: page.slug, title: page.title, story: editing ? page.story : PH.storyWithoutHints(page.story), imageUrl: page.image_url,
      // FIX-41: the cover with its words and focal point (pictures.js).
      cover: page.image_url ? { url: page.image_url, ...(page.image_meta || {}) } : null,
      goalAmount: page.goal_amount != null ? parseFloat(page.goal_amount) : null,
      raisedAmount: parseFloat(page.raised_amount) || 0,
      // GIVE-EDIT-1: the goal bar's switch, set in the page editor.
      showGoal: page.show_goal !== false,
      // GIVE-3: how the page looks, and the campaign figures its goal bar draws.
      design: GD.normalizeDesign(page.design),
      campaignDonors: page.campaign_id && page.campaign_donors != null ? Number(page.campaign_donors) : null,
      campaignDaysLeft: daysLeft,
      fundId: page.fund_id, fundName: page.fund_name || null,
      // "Counts toward" linkage (attribution FIX) — when set, the public
      // thermometer shows the campaign's progress, not a second page-local goal.
      campaignId: page.campaign_id || null,
      campaignName: page.campaign_name || null,
      campaignGoal: page.campaign_goal != null ? parseFloat(page.campaign_goal) : null,
      campaignRaised: page.campaign_raised != null ? parseFloat(page.campaign_raised) : null,
      // ── CAMPAIGN-2 · THE SENTENCE UNDER THE GOAL BAR ─────────────────────
      // Every number has a sentence, and a thermometer is the number a stranger
      // is most likely to doubt. It says WHAT IT COUNTS, including the two
      // things people assume it does not: a cheque somebody posted (an offline
      // gift counts the moment staff record it, like any other) and a gift given
      // through a supporter's own fundraising page.
      //
      // It is computed from the same two figures the bar is drawn from, in one
      // function, so the bar and its sentence cannot disagree.
      goalSentence: await (async () => {
        const CP = await campaignPageMod();
        const linked = !!page.campaign_id;
        const raised = linked && page.campaign_raised != null ? parseFloat(page.campaign_raised) : parseFloat(page.raised_amount || 0);
        const goal = linked ? (page.campaign_goal != null ? parseFloat(page.campaign_goal) : 0) : parseFloat(page.goal_amount || 0);
        return CP.goalBarSentence({
          raisedCents: Math.round((raised || 0) * 100),
          goalCents: Math.round((goal || 0) * 100),
          hasPeerPages: page.p2p_enabled === true,
        });
      })(),
      // BUILD-95 §5B — the BUILT page, resolved through the ONE pipeline the
      // portal uses. PUBLISHED only: a draft is what she is still arranging,
      // and a donor arriving from a QR code must never land in the middle of
      // an afternoon's rearranging.
      //
      // null means "never built", and the page falls back to its title, story
      // and image exactly as before — an org that has not opened the builder
      // sees no change at all, which is what makes this safe to ship.
      page: builtWidgets,
      formPosition: formPos,
      // BUILD-102 Part 1 — THE FORM THE DONOR IS OFFERED, from the same
      // `formSpec` the editor's preview renders. Not a second shape derived from
      // the same row: the same function, so the two cannot drift.
      // GIVE-2 §3 — AND THE AMOUNTS THE FORM OFFERS THIS VISITOR. The one
      // place a computed ladder replaces a typed one, so the editor's preview,
      // the embedded form and the page a stranger opens from a QR code cannot
      // disagree about which answer the donor is reading. A form with
      // `smartAmounts` off, or with too few gifts to tell, comes back
      // byte-for-byte as `formSpec` built it.
      //
      // The browser walk caught this: `/forms/:id/public` had it and THIS
      // payload did not, so the public giving page — the one a donor actually
      // opens — still showed Steward's $25/$50/$100/$250 guess.
      form: await withSmartAmounts(
        (await formConfigMod()).specForVariant(page.form_config, page.ab_test, req.query.v, {
          funds: funds.map(f => ({ id: f.id, name: f.name })),
          orgName: org.donor_facing_name,
        }),
        { orgId: org.id, givingPageId: page.id, editing,   // FLOWS-9: the preview keeps her amounts
          personalToken: editing ? null : (req.query.reconnect || req.query.r || null) }),
      // BUILD-102 Part 6 — whether a test is running, so a first-time visitor can
      // be assigned a side WITHOUT a cookie being set on every form that has none.
      // A cookie nobody needs is a cookie somebody has to explain in a policy.
      abRunning: !!(page.ab_test && page.ab_test.running !== false && page.ab_test.b),
      // BUILD-102 Part 2 — the org's threshold, so the page can ask the shared
      // rule rather than carry a copy of it. The RULE stays in
      // shared/formConfig.js; this is only the org's number.
      upsellThresholdCents: org.form_upsell_threshold_cents != null
        ? Number(org.form_upsell_threshold_cents)
        : (await formConfigMod()).UPSELL_DEFAULT_THRESHOLD_CENTS,
      // GIVE-2 §6 — and the monthly amount the org suggests, when it named one.
      // Null keeps a third of the gift, which is what every org had before.
      upsellMonthlyCents: org.form_upsell_monthly_cents != null
        ? Number(org.form_upsell_monthly_cents) : null,
    },
    funds,
    peerFundraisers: {
      count: fundraiserRows.length,
      leaderboard: fundraiserRows.slice(0, 10).map(f => ({ id: f.id, name: f.name, slug: f.slug, raisedAmount: parseFloat(f.raised_amount) || 0 })),
    },
    // PARITY-2 Part 2: everything the public peer-to-peer page draws beyond
    // the bar: the donor count and its sentence, the countdown, the teams
    // board, and whether a new page waits for approval. Absent (null) on a
    // page that is not peer-to-peer, so nothing on it changes.
    p2p: p2pOn ? {
      enabled: true,
      donorCount: shownDonors,
      donorCountLine: P2Pm.donorCountLine(shownDonors),
      donorCountSentence: P2Pm.DONOR_COUNT_SENTENCE,
      endDate: p2pEndDate,
      countdown: p2pEndDate ? (await campaignPageMod()).countdownSentence(p2pEndDate, p2pToday) : null,
      requiresApproval: page.p2p_requires_approval === true,
      teamCount: teamBoard.length,
      teams: teamBoard.slice(0, 10),
      leaderboardSentence: P2Pm.LEADERBOARD_SENTENCE,
    } : null,
  };
}

// ── PARITY-2 Part 2 · THE PUBLIC LEADERBOARDS ────────────────────────────
// One query per board, used by the page (top ten) and by "See all" (every
// active row), so the two can never rank differently. Raised is the
// donor-intended amount (net of a covered fee), the same SUM the page's own
// bar uses. A team's total is every gift through its members' pages, live,
// never a stored counter (forms.md, BUILD-103); members listed are the active
// ones only.
async function p2pTeamBoard(orgId, pageId) {
  const rows = await query(
    `SELECT t.id, t.name, t.slug, t.goal_amount,
            (SELECT COUNT(*)::int FROM peer_fundraisers pf WHERE pf.team_id = t.id AND pf.org_id = t.org_id AND pf.status = 'active') AS members,
            COALESCE((SELECT SUM(g.amount) FROM gifts g
                        JOIN peer_fundraisers pf ON pf.id = g.peer_fundraiser_id AND pf.org_id = g.org_id
                       WHERE pf.team_id = t.id AND g.org_id = t.org_id), 0)::float AS raised
       FROM p2p_teams t
      WHERE t.org_id = ? AND t.giving_page_id = ? AND t.status = 'active'
      ORDER BY raised DESC, t.name LIMIT 500`, [orgId, pageId]);
  return rows.map(t => ({ id: t.id, name: t.name, slug: t.slug, members: t.members,
    raisedAmount: Math.round(Number(t.raised) * 100) / 100,
    goalAmount: t.goal_amount != null ? Number(t.goal_amount) : null }));
}

// ── Peer-to-peer fundraising ────────────────────────────────────────────────
// A supporter's own personal fundraiser under a parent Giving Page — see
// peer_fundraisers in db.js. Slug uniqueness is scoped to one giving page,
// not the whole org (mirrors uniqueGivingPageSlug above, one level down).
async function uniquePeerFundraiserSlug(givingPageId, base, excludeId) {
  let slug = base, n = 1;
  while (true) {
    const rows = excludeId
      ? await query("SELECT id FROM peer_fundraisers WHERE giving_page_id=? AND slug=? AND id<>?", [givingPageId, slug, excludeId])
      : await query("SELECT id FROM peer_fundraisers WHERE giving_page_id=? AND slug=?", [givingPageId, slug]);
    if (!rows.length) return slug;
    n++;
    slug = `${base}-${n}`;
  }
}

// Same shape as invites.token (two concatenated stripped UUIDs, 64 hex
// chars) — this codebase's existing convention for "a long random value,
// stored and looked up directly, that IS the entire auth for one action."
// See CLAUDE.md's recovery-token pattern for the HMAC-signed alternative;
// this is the simpler stored-token sibling, used here because (unlike a
// card-update link generated server-side on a schedule) this token also
// needs to double as the durable "your account" credential the supporter
// holds onto indefinitely, not a short-lived one-off.
function generateEditToken() {
  return uuid().replace(/-/g, "") + uuid().replace(/-/g, "");
}

// BUILD-103 Part 5: ONE PERSON RECORD, shared by the public sign-up and the
// staff "Add a fundraiser" (FIX-28). Exact email, never name; nobody known
// becomes a person typed volunteer; two matches link to neither.
async function fundraiserPerson(orgId, name, cleanEmail, who) {
  const matched = await query(
    `SELECT id FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 2`,
    [orgId, cleanEmail]);
  if (matched.length === 1) return matched[0].id;
  if (matched.length) return null;
  const personId = newId("d");
  await run(
    `INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
     VALUES (?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?)`,
    [personId, orgId, name, cleanEmail, who.id, who.name]);
  return personId;
}
return { fundraiserPerson, generateEditToken, givingPagePublicPayload, gpOrgSql, gpPageSql, p2pTeamBoard, uniquePeerFundraiserSlug };
}

module.exports = { mount };
