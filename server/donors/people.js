// server/donors/people.js — people, photos, scores, geocoding and giving-page previews.
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
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  ASSET_ID_RE, GEOCODE_TICK_BUDGET, NOT_HISTORY_TYPES, PHOTO_FETCH_BUDGET, PT_READY, UNKNOWN_ROLE, actor,
  calcWealthScore, checkWriteAccess, donorLock, donorPhotoUrl, engagementMod, enrollInSequences,
  formConfigMod, fundraiserPerson, generateEditToken, geocode, getThemeAsset, givingPagePublicPayload,
  gpOrgSql, gpPageSql, imageBytesMatchMime, markDonorsForGeocoding, orgToday, orgTz, personPhoto,
  processGeocodeQueue, processPhotoQueue, pruneUnreferencedAssets, publicAppUrl, putThemeAsset, query,
  recomputeScoresForOrg, recordAssetPointerHistory, requireAdmin, requireAuth, requireCrm, run, scheduleScores,
  slugifyGivingPage, staffWho, uniquePeerFundraiserSlug, uuid, wrap, writeAuditLog,
} = ctx;
const { sql } = require("../db/sql");   // REDTEAM-2: SQL text only from the code
let PT = null;
PT_READY.then(m => { PT = m; });
// FIX-1 D — the roles a person can carry that a chip or a list may name.
// "other" is not a role, it is the absence of one: normalizeTypes floors an
// empty list at it, and turning any role on replaces it.
const PEOPLE_ROLES = ["donor", "volunteer", "staff_board"];
async function hasHistory(orgId, donorId) {
  const [r] = await query(
    `SELECT (EXISTS (SELECT 1 FROM interactions i WHERE i.org_id=? AND i.donor_id=? AND i.type <> ALL(?::text[])
                       AND COALESCE(i.created_by, '') NOT LIKE 'system:email-marketing%')
          OR EXISTS (SELECT 1 FROM calendar_events c WHERE c.org_id=? AND ? = ANY(c.person_ids))) AS has`,
    [orgId, donorId, NOT_HISTORY_TYPES, orgId, donorId]);
  return !!(r && r.has);
}
let app = routers.r1;

// ── ENGAGE-1 — A DONOR'S TWO SCORES ────────────────────────────────────────
// What the profile rail shows: engagement with its band and reason, generosity,
// every part with its points (they add to the score), the explanation from the
// one weights file, and the suggested ask from their own gifts. SCORES-1: a
// donor the compute has not reached yet (added a second ago, or mid-import) is
// scored on the fly, for this answer only, against the org's stored population,
// and one recompute is asked for (folded into any already waiting). A GET never
// writes a score row.
app.get("/donors/:id/scores", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  let [row] = await query("SELECT * FROM donor_scores WHERE org_id=? AND donor_id=?", [orgId, d.id]);
  if (!row) {
    const [s] = (await engagementMod.scorePeople(query, orgId, orgToday(await orgTz(orgId)), [d.id])).scores;   // ORG_TZ_SEAM_OK
    if (s) row = { engagement: s.engagement, generosity: s.generosity, band: s.band, reason: s.reason, last_touch: s.lastTouch, parts: s.parts, computed_for: null, computed_at: null };
    scheduleScores(orgId, [d.id]);
  }
  const W = await engagementMod.weights();
  const parts = (typeof row?.parts === "string" ? JSON.parse(row.parts) : row?.parts) || { engagement: [], generosity: [] };
  const band0 = W.bandFor(row ? row.engagement : 0);
  // FIX-34 · ONE STATUS. A Distant score beside a green "On track" line was two
  // answers on one profile; the band word is the closeness word (PARITY-1:
  // "the band in words"), read on the gifts as they are now.
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const cl = await engagementMod.closenessNow(query, orgId, d.id, today, band0.key);
  const band = cl.key === band0.key ? band0 : { key: cl.key, label: W.CLOSENESS.find(c => c.key === cl.key).label };
  res.json({
    donorId: d.id,
    engagement: row ? row.engagement : 0, generosity: row ? row.generosity : 0,
    // IMPORT-2: no conversation, note or meeting on file. The screen says "No
    // history yet" here, never "0, Distant", which would call a person Steward
    // knows nothing about cold.
    noHistory: !(await hasHistory(orgId, d.id)),
    // FIX-24 2b: "the most recent touch N days ago" said for today, not for the day the scores ran.
    band: band.key, bandLabel: band.label, reason: row ? engagementMod.reasonFor(row, orgToday(await orgTz(orgId)),   // ORG_TZ_SEAM_OK
      ((await require("../../meetings").lastContactWith(orgId, d.id)) || {}).date || null) : null,   // COUNTS-1: the one Last contact
    computedFor: row ? row.computed_for : null, computedAt: row ? row.computed_at : null,
    parts: {
      engagement: parts.engagement.map(x => ({ ...x, label: W.TOUCH_POINTS[x.key].label, how: W.TOUCH_POINTS[x.key].how, one: W.TOUCH_POINTS[x.key].one, many: W.TOUCH_POINTS[x.key].many,
        source: { key: "donor-engagement-part", params: { donor: d.id, part: x.key } } })),
      generosity: parts.generosity.map(x => ({ ...x, label: W.GENEROSITY_PARTS[x.key].label, how: W.GENEROSITY_PARTS[x.key].how,
        weight: W.GENEROSITY_PARTS[x.key].weight,
        source: { key: "donor-generosity-part", params: { donor: d.id, part: x.key } } })),
    },
    explanation: W.EXPLANATION,
    bands: W.BANDS,
    // PROSPECT-1 — screening results move the ask only for someone who may see them.
    suggestedAsk: await engagementMod.suggestedAsk(query, orgId, d.id,
      (await require("../../prospect").canSee(req.user.userId, req.user.orgId)) ? { screening: (await require("../../prospect").latestScreening(orgId, [d.id])).get(d.id) || null } : {}),
  });
}));

// Recompute now (an admin, or a suite that cannot wait for the debounce).
app.post("/scores/recompute", requireAuth, requireAdmin, wrap(async (req, res) => {
  const n = await recomputeScoresForOrg(req.user.orgId);
  req.audit.skip("scores are derived from data already on file");
  res.json({ ok: true, people: n });
}));

// Wealth/capacity scoring is part of the Team major-gifts layer — Core sees a
// stored score read-only (behind glass) but can't compute/recompute it.
app.post("/donors/:id/score", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const result = await calcWealthScore(req.params.id, req.user.orgId);
  if (!result) return res.status(404).json({ error: "Donor not found" });
  res.json(result);
}));

app.get("/donors/:id/fund-affinity", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  // LEDGER-2: the split is Lifetime cut by fund (shared/numbers/fundSplit.js):
  // every gift in exactly one bucket, the two buckets summing to Lifetime.
  const s = await NUMBERS.fundSplit.fundSplit(query, orgId, req.params.id);
  if (!s) return res.status(404).json({ error: "Donor not found" });
  const activeFunds = await query("SELECT id, name FROM fin_funds WHERE org_id=? AND retired_at IS NULL ORDER BY name ASC", [orgId]);
  const $ = c => Number(c) / 100;
  res.json({
    affinity: s.funds.map(f => ({ fundId: f.fundId, fundName: f.fundName, restricted: f.restricted, imported: !!f.imported,
                                  total: $(f.cents), giftCount: f.giftCount, lastDate: f.lastDate, pct: f.pct })),
    unrestrictedTotal: $(s.unrestrictedCents),
    restrictedTotal: $(s.restrictedCents),
    restrictedPct: s.restrictedPct, unrestrictedPct: s.unrestrictedPct,
    totalGiving: $(s.lifetimeCents),
    definition: "Restricted is money given to a restricted fund. Everything else is unrestricted: gifts to an unrestricted fund, gifts with no fund, and the total from your old system. The two add up to Lifetime.",
    activeFunds,
  });
}));

// The same data for the editor's live preview, before anything is published.
app.get("/giving-pages/:id/volunteer-data", requireAuth, wrap(async (req, res) => {
  const VP = require("../../volunteerPage");
  const [page] = await query("SELECT id, draft FROM giving_pages WHERE id = ? AND org_id = ? AND page_kind = ?", [req.params.id, req.user.orgId, VP.KIND]);
  if (!page) return res.status(404).json({ error: "not_found" });
  res.json(await VP.pageData(req.user.orgId, page.draft || []));
}));

// GIVE-3 · THE EDITOR'S PREVIEW: the draft, through the very same payload.
// The page row is read by id (a draft page need not be live yet) and the
// draft's own fields and blocks stand in for the published ones.
app.get("/giving-pages/:id/page/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgs = await query(gpOrgSql("o.id = ?"), [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "not_found" });
  const [row] = await query(gpPageSql("gp.org_id = ? AND gp.id = ? AND COALESCE(gp.page_kind,'give') = 'give'"), [req.user.orgId, req.params.id]);
  if (!row) return res.status(404).json({ error: "not_found" });
  const d = row.draft_settings && typeof row.draft_settings === "object" ? row.draft_settings : null;
  const page = { ...row, published: Array.isArray(row.draft) ? row.draft : row.published };
  if (d) {
    Object.assign(page, {
      title: d.title ?? row.title, story: d.story ?? row.story, image_url: d.imageUrl ?? row.image_url,
      image_meta: d.imageMeta ?? row.image_meta, show_goal: d.showGoal ?? row.show_goal,
      goal_amount: d.goalAmount !== undefined ? d.goalAmount : row.goal_amount,
      fund_id: d.fundId !== undefined ? d.fundId : row.fund_id,
      campaign_id: d.campaignId !== undefined ? d.campaignId : row.campaign_id,
      design: d.design ?? row.design,
    });
    // Publish writes the form only when it changed (GIVE-EDIT-1), so the
    // preview takes the drafted form by the same rule: an unchanged form stays
    // the page's original one-step form here too.
    if (d.form) {
      const GPE = require("../../givingPageEdit");
      const F = await formConfigMod();
      const fundIds = (await query("SELECT id FROM fin_funds WHERE org_id = ?", [req.user.orgId])).map(f => String(f.id));
      if (!GPE.sameJson(GPE.settingsOf(row, F, fundIds).form, d.form)) page.form_config = d.form;
    }
  }
  res.json(await givingPagePublicPayload(orgs[0], page, req.query, { editing: true }));
}));

// FIX-28: STAFF ADD A FUNDRAISER FOR SOMEBODY. The same person match and the
// same token shape as the public sign-up, but nobody is emailed: the manage
// link comes back to the staff member who made the page (an admin accountable
// for it, the way an invite link does), and they decide how to pass it on.
// Staff made it, so it is live at once whatever the approval setting.
app.post("/giving-pages/:id/fundraisers", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { name, email, personalGoalAmount } = req.body || {};
  if (!name || !String(name).trim() || !email || !String(email).trim()) return res.status(400).json({ error: "A name and an email are needed. The email is how Steward finds the person." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: "That email does not look right." });
  if (String(name).trim().length > 200 || String(email).trim().length > 320) return res.status(400).json({ error: "The name or email is too long." });
  if (personalGoalAmount && (!Number.isFinite(parseFloat(personalGoalAmount)) || parseFloat(personalGoalAmount) <= 0)) return res.status(400).json({ error: "The goal must be a positive number." });
  const [page] = await query("SELECT id, slug, title, p2p_enabled FROM giving_pages WHERE id=? AND org_id=? AND status='active'", [req.params.id, orgId]);
  if (!page) return res.status(404).json({ error: "That campaign could not be found." });
  if (page.p2p_enabled !== true) return res.status(400).json({ error: "Turn peer-to-peer on for this campaign first." });
  let teamId = null;
  if (req.body.teamId) {
    const [t] = await query("SELECT id FROM p2p_teams WHERE id=? AND giving_page_id=? AND org_id=? AND status='active'", [String(req.body.teamId), page.id, orgId]);
    if (!t) return res.status(404).json({ error: "That team is not on this campaign." });
    teamId = t.id;
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const personId = await fundraiserPerson(orgId, String(name).trim(), cleanEmail, actor(req));
  const [o] = await query("SELECT org_slug FROM orgs WHERE id=?", [orgId]);
  const id = newId("pf");
  const editToken = generateEditToken();
  const editTokenHash = require("crypto").createHash("sha256").update(editToken).digest("hex");
  const base = slugifyGivingPage(String(name));
  let slug = await uniquePeerFundraiserSlug(page.id, base);
  for (let attempt = 0; ; attempt++) {
    try {
      await run(
        `INSERT INTO peer_fundraisers (id, org_id, giving_page_id, name, email, slug, personal_goal_amount, story, image_url, status, edit_token, edit_token_hash, team_id, person_id)
         VALUES (?,?,?,?,?,?,?,'','','active',NULL,?,?,?)`,
        [id, orgId, page.id, String(name).trim(), cleanEmail, slug, personalGoalAmount ? parseFloat(personalGoalAmount) : null, editTokenHash, teamId, personId]);
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      slug = await uniquePeerFundraiserSlug(page.id, `${base}-${Date.now().toString(36).slice(-4)}`);
    }
  }
  { const who = await staffWho(req);   // WIRE-1: on the fundraiser's timeline
    await TL.timelineLine({ orgId, donorId: personId, note: `Started a fundraising page: ${page.title}.`,
      actorId: who.id, actorName: who.name, key: `p2p_page:${id}`,
      metadata: { via: "peer_fundraiser", fundraiser_id: id, giving_page_id: page.id } }); }
  const frontendUrl = publicAppUrl();
  res.status(201).json({ id, slug, teamId, personId,
    publicUrl: `${frontendUrl}/give/${o?.org_slug || ""}/${page.slug}/${slug}`,
    manageUrl: `${frontendUrl}/fundraiser/manage/${editToken}`,
    sentence: `${String(name).trim()}'s page is live. Nobody was emailed; copy their manage link and send it to them yourself.` });
}));

// POST /photos/run — drive the queue for the caller's org NOW. The ops/test
// hook, same bar as /geocode/run: admin, org-scoped, and the only way a suite
// gets a deterministic drain without waiting on a tick.
app.post("/photos/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await processPhotoQueue({ orgId: req.user.orgId, limit: Math.min(parseInt(req.body?.limit, 10) || PHOTO_FETCH_BUDGET, 1000) }));
}));

// POST /geocode/run — drive the queue for the caller's org NOW. The ops/test
// hook, same bar as POST /nudges/run. {mark:true} re-derives every donor's
// key first (what an import does); {limit} caps the spend.
app.post("/geocode/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const marked = req.body && req.body.mark ? await markDonorsForGeocoding(req.user.orgId) : null;
  const limit = Math.min(Math.max(parseInt(req.body?.limit, 10) || GEOCODE_TICK_BUDGET, 1), 5000);
  const out = await processGeocodeQueue({ limit, orgId: req.user.orgId });
  res.json({ marked, ...out });
}));

// GET /geocode/status — what the map needs to describe itself in a sentence:
// the counts by status and whether a provider is configured at all. A read
// path, and it makes NO provider call.
app.get("/geocode/status", requireAuth, wrap(async (req, res) => {
  const cfg = geocode.providerConfig();
  const rows = await query(
    `SELECT COALESCE(geocode_status, 'pending') AS s, COUNT(*)::int AS c
       FROM donors WHERE org_id = ? AND deleted_at IS NULL GROUP BY 1`, [req.user.orgId]);
  const counts = Object.fromEntries(geocode.GEOCODE_STATUSES.map(s => [s, 0]));
  for (const r of rows) counts[r.s] = (counts[r.s] || 0) + r.c;
  res.json({ provider: cfg.name, reason: cfg.reason || null, counts,
             total: Object.values(counts).reduce((a, b) => a + b, 0) });
}));

app.get("/person-photos/:id", wrap(async (req, res) => {
  const id = String(req.params.id || "");
  if (!ASSET_ID_RE.test(id)) return res.status(404).json({ error: "not_found" });
  // The org comes from the STORED ROW, never from the request. This is the
  // whole isolation argument (BUILD-37 B9 applied to a GET).
  const [row] = await query(
    `SELECT org_id FROM portal_assets WHERE id = ? AND kind = ? AND deleted_at IS NULL`,
    [id, personPhoto.PHOTO_ASSET_KIND]);
  if (!row) return res.status(404).json({ error: "not_found" });
  const v = personPhoto.verifyPhotoUrl({ orgId: row.org_id, assetId: id, e: req.query.e, s: req.query.s });
  // One answer for expired and for wrong-org alike: a probe must not be able
  // to tell "this photo exists in another tenant" from "this link is old".
  if (!v.ok) return res.status(403).json({ error: "link_expired" });
  const asset = await getThemeAsset(id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  res.set("Content-Type", asset.contentType);
  res.set("X-Content-Type-Options", "nosniff");                                    // SECURE-1
  res.set("Content-Security-Policy", require("../../assetStore").ASSET_CSP);
  // PRIVATE, and never longer than the signature it rode in on. Content
  // addressing still makes the bytes immutable, so a shared cache is the only
  // thing being refused here — correctly, for a photograph of a person.
  res.set("Cache-Control", `private, max-age=${Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000))}`);
  res.set("ETag", `"${asset.id}"`);
  res.send(asset.buffer);
}));

// Every donor in the org that HAS a photo, as { donorId: signedUrl }. One
// request feeds every row surface in the product (Thread rows, Drift, the
// recipient preview, search results, household members) — the alternative was
// threading a signed URL through seven separate payload builders, each of
// which would then be a place for the photo to silently go missing.
// Donors WITHOUT a photo are absent from the map, so an org that has uploaded
// four faces ships four entries, not 25,000.
const PHOTO_MAP_CAP = 5000;
app.get("/people/photos", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, photo_asset_id FROM donors
      WHERE org_id = ? AND photo_asset_id IS NOT NULL AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT ${PHOTO_MAP_CAP + 1}`, [req.user.orgId]);
  const photos = {};
  for (const r of rows.slice(0, PHOTO_MAP_CAP)) {
    const u = donorPhotoUrl(req.user.orgId, r.photo_asset_id);
    if (u) photos[r.id] = u;
  }
  // Past the cap the ROW surfaces fall back to initials; the profile header
  // always signs its own URL, so no record is ever without its face.
  res.json({ photos, capped: rows.length > PHOTO_MAP_CAP, cap: PHOTO_MAP_CAP });
}));

const personOut = (row, lock) => ({
  id: row.id, name: row.name, email: row.email || null, kind: row.kind || null,
  person_types: PT.typesOf(row),
  labels: PT.typeLabels(row),
  donorLocked: !!(lock && lock.locked),
  donorLockedReason: lock && lock.locked ? lock.reason : null,
});

app.get("/people", requireAuth, wrap(async (req, res) => {
  const role = String(req.query.role || "");
  if (!PEOPLE_ROLES.includes(role))
    return res.status(400).json({ error: "role_required", sentence: "Ask for donors, volunteers, or staff and board." });
  // REDTEAM-2: the request picks one of the roles; the condition's text is the code's own.
  const rows = await query(
    sql`SELECT d.id, d.name, d.email, d.phone, d.kind, d.person_types, d.gift_count, d.total_giving, d.last_gift_date
       FROM donors d
      WHERE d.org_id=${req.user.orgId} AND d.deleted_at IS NULL AND d.erased_at IS NULL
        AND ${sql.pick(role, Object.fromEntries(PEOPLE_ROLES.map(r => [r, PT.typeSql(r, "d")])))}
      ORDER BY lower(d.name), d.id
      LIMIT 5000`);   // TRUTH-2: an erased person is on no list
  res.json({
    role,
    people: rows.map(r => ({
      ...personOut(r, null),
      phone: r.phone || null,
      // Whether they also give is the DONOR ROLE, not a gift count: a
      // volunteer marked donor with no gift yet is a prospect, and says so.
      gives: PT.typesOf(r).includes("donor"),
      giftCount: Number(r.gift_count) || 0,
      totalGiving: Number(r.total_giving) || 0,
      lastGiftDate: r.last_gift_date || null,
    })),
  });
}));

app.get("/people/:id", requireAuth, wrap(async (req, res) => {
  const [row] = await query(
    // LEDGER-2: "Donor since" is the first gift on record, read live through the
    // one rule (shared/numbers/firstGift.js), never the stored column, which a
    // write that skipped the summary left on a later year.
    `SELECT d.id, d.name, d.email, d.kind, d.person_types, d.gift_count, ${NUMBERS.firstGift.FIRST_DATE("d")} AS first_gift_date
       FROM donors d WHERE d.id=? AND d.org_id=? AND d.deleted_at IS NULL`,
    [req.params.id, req.user.orgId]);
  if (!row) return res.status(404).json({ error: "Person not found" });
  // FIX-8 Part B.2 — the roles line reads "Donor since 2021", and the year is
  // a fact about the person, so it travels with the person rather than being
  // dug out of a gift list the header does not have.
  res.json({ ...personOut(row, await donorLock(req.user.orgId, row)),
             first_gift_date: row.first_gift_date || null,
             // IMPORT-4: gifts on file but none dated reads "Donor since: unknown".
             gift_count: Number(row.gift_count) || 0 });
}));

// One chip, one write: the person's own row, person_types, nothing else. Adding
// Volunteer puts them on the roster (GET /people?role=volunteer) that moment.
app.put("/people/:id/roles", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const role = String(req.body?.role || "");
  const on = req.body?.on === true;
  if (!PEOPLE_ROLES.includes(role)) return res.status(400).json(UNKNOWN_ROLE);
  const [row] = await query(
    `SELECT id, name, email, kind, person_types, gift_count FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
    [req.params.id, req.user.orgId]);
  if (!row) return res.status(404).json({ error: "Person not found" });

  const was = PT.typesOf(row);
  const next = PT.normalizeTypes(on ? [...was.filter(t => t !== "other"), role] : was.filter(t => t !== role));
  if (role === "donor" && !on && was.includes("donor")) {
    const lock = await donorLock(req.user.orgId, row);
    if (lock.locked) return res.status(409).json({ error: "donor_has_gifts", sentence: lock.reason, giftCount: lock.giftCount });
  }
  if (JSON.stringify(next) !== JSON.stringify(was)) {
    await run(`UPDATE donors SET person_types = ?::jsonb, updated_at = NOW() WHERE id=? AND org_id=?`,
      [JSON.stringify(next), row.id, req.user.orgId]);
    // Who changed it, in the audit log (the row has no updated_by).
    writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "person_roles", row.id, { from: was, to: next });
    // BUILD-94 Part 3 — ADDED AS VOLUNTEER is a trigger, on the transition only.
    if (!was.includes("volunteer") && next.includes("volunteer")) {
      enrollInSequences(req.user.orgId, row.id, "added_volunteer", {}, actor(req))
        .catch(e => console.error("[seq] volunteer trigger:", e.message));
    }
  }
  const fresh = { ...row, person_types: next };
  res.json(personOut(fresh, await donorLock(req.user.orgId, fresh)));
}));

// Store a photograph on a donor record. Type is checked by CONTENT (the magic
// number must agree with the declared mime — BUILD-86's rule), capped at 10MB
// of decoded image, and resized to a 512 square WebP with the original
// discarded: nothing keeps the full-resolution upload, here or in S3.
async function storeDonorPhoto({ orgId, donorId, dataUri, actorUser }) {
  const m = typeof dataUri === "string" ? dataUri.match(/^data:([^;]+);base64,(.*)$/s) : null;
  if (!m) return { error: "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, or WebP photo." };
  if (dataUri.length > personPhoto.PHOTO_MAX_STR) {
    return { error: "That photo is larger than 10 MB. A normal photo from a phone is well within that." };
  }
  const declared = m[1];
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { buffer = null; }
  if (!buffer || !buffer.length) return { error: "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, or WebP photo." };
  if (buffer.length > personPhoto.PHOTO_MAX_BYTES) {
    return { error: "That photo is larger than 10 MB. A normal photo from a phone is well within that." };
  }
  // SVG is excluded on purpose: it is a script-bearing document, and nobody's
  // headshot is a vector.
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(declared) || !imageBytesMatchMime(declared, buffer)) {
    return { error: "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, or WebP photo." };
  }
  let out;
  try {
    const sharp = require("sharp");
    const r = await sharp(buffer, { failOn: "none" })
      .rotate()                                     // honour EXIF orientation
      .resize(personPhoto.PHOTO_SIZE, personPhoto.PHOTO_SIZE, { fit: "cover", position: "attention", withoutEnlargement: false })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    out = { buffer: r.data, width: r.info.width, height: r.info.height };
  } catch (e) {
    // Unlike the theme path, this does NOT fall back to storing the original:
    // a 10MB master masquerading as a 512 thumbnail is the thing the cap and
    // the resize exist to prevent, and a real photograph always decodes.
    console.error("[person-photo] resize failed:", e.message);
    return { error: "We couldn't process that photo. Try re-exporting it as a JPEG or PNG." };
  }
  const [existing] = await query(`SELECT photo_asset_id FROM donors WHERE id = ? AND org_id = ?`, [donorId, orgId]);
  if (!existing) return { error: "Donor not found", status: 404 };
  const asset = await putThemeAsset({
    orgId, kind: personPhoto.PHOTO_ASSET_KIND,
    buffer: out.buffer, contentType: "image/webp", width: out.width, height: out.height,
  });
  await run(`UPDATE donors SET photo_asset_id = ?, updated_at = NOW() WHERE id = ? AND org_id = ?`, [asset.id, donorId, orgId]);
  await recordAssetPointerHistory(orgId, "donor.photo", donorId, existing.photo_asset_id || null, asset.id, actorUser);
  // Soft-delete any photo this org has that no donor points at any more — the
  // replaced face falls into the 90-day retention window, not out of history.
  await pruneUnreferencedAssets(orgId, personPhoto.PHOTO_ASSET_KIND, []).catch(e =>
    console.error("[person-photo] prune:", e.message));
  return { assetId: asset.id, url: donorPhotoUrl(orgId, asset.id) };
}

// ── BUILD-95 — A PICTURE OF THE CHEQUE ─────────────────────────────────────
// Stored through the SAME seam as a donor photo, and served through the same
// signed, expiring, private door — a cheque image carries a name, an amount, a
// bank, an account number and a signature, and is the most sensitive picture
// this product will ever hold. It is NOT a 512 square: a cheque cropped square
// is a cheque you cannot read, so it keeps its shape and is capped on the long
// edge instead.
// BUILD-96 Part 5 — how many photographs ONE REQUEST may carry. Not how many
// she may add: the screen chunks a folder into requests this size and adds up
// the answers, because a folder of two hundred headshots is hundreds of
// megabytes and fits in no request at all.
//
// Paired with the 24mb body limit registered for this path above. Twenty
// photographs of a few megabytes each sit inside that with room to spare, and
// a single photo is still capped at the same 10MB a one-at-a-time upload is.
const PHOTO_BULK_MAX = 20;

app.post("/donors/:id/photo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await storeDonorPhoto({
    orgId: req.user.orgId, donorId: req.params.id,
    dataUri: req.body && req.body.image, actorUser: req.user,
  });
  if (r.error) return res.status(r.status || 400).json({ error: "invalid_photo", message: r.error });
  res.json({ ok: true, photoUrl: r.url });
}));

// ── BUILD-96 Part 5 — A FOLDER OF PHOTOS ───────────────────────────────────
// She arrives with a folder of headshots off the old system. One at a time is
// not a feature for 200 people.
//
// Every photo goes through the SAME storeDonorPhoto seam a single upload uses
// — same cap, same type check, same resize, same asset history, same prune —
// because a bulk path with its own quieter rules is how a 10 MB master or a
// renamed PDF gets in. The only thing this route adds is deciding WHO.
//
// And it decides conservatively: shared/photoMatch.js attaches only when the
// file name identifies exactly one person, by email, then legacy id, then
// exact full name. Anything else comes back by file name for her to place.
// Nothing is guessed on a partial name — a wrong face is not an error anyone
// reviews, because a photo that "worked" is never looked at again.
app.post("/photos/bulk", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const pm = await import("../../shared/photoMatch.js");
  const orgId = req.user.orgId;
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ error: "no_files" });
  if (files.length > PHOTO_BULK_MAX)
    return res.status(400).json({ error: "too_many", message: `Add at most ${PHOTO_BULK_MAX} photos at a time.` });

  // The roster, once. A per-file lookup would be N queries and would also let
  // two files race each other onto the same person.
  const people = (await query(
    `SELECT id, name, email, external_donor_id, external_donor_ids
       FROM donors WHERE org_id=? AND deleted_at IS NULL`, [orgId]))
    .map(r => ({
      id: r.id, name: r.name, email: r.email,
      externalId: r.external_donor_id,
      externalIds: Array.isArray(r.external_donor_ids) ? r.external_donor_ids : [],
    }));
  const index = pm.buildIndex(people);

  let attached = 0;
  const needsYou = [];
  // A file name is the only thing shown back to her, so it is the only thing
  // echoed — never the image, and never a path from her machine beyond the
  // last segment.
  const shown = f => String(f || "").split(/[\\/]/).pop().slice(0, 200);

  for (const f of files) {
    const fileName = shown(f?.fileName);
    const m = pm.matchOne(fileName, index);

    if (m.status === "bad_type") {
      needsYou.push({ fileName, reason: "not_a_photo",
        message: `${fileName} isn't a photo Steward can use.` });
      continue;
    }
    if (m.status === "ambiguous") {
      needsYou.push({ fileName, reason: "ambiguous", matchedBy: m.rule,
        candidates: m.candidates.slice(0, 8).map(p => ({ id: p.id, name: p.name, email: p.email })),
        message: `${fileName} could be more than one person.` });
      continue;
    }
    if (m.status === "unmatched") {
      needsYou.push({ fileName, reason: "no_match",
        message: `${fileName} doesn't match anyone on file.` });
      continue;
    }

    // Matched. The same seam as one-at-a-time, and a store failure is reported
    // per file rather than failing the batch: 199 good photos should not be
    // lost to one bad one.
    const r = await storeDonorPhoto({
      orgId, donorId: m.person.id, dataUri: f?.image, actorUser: req.user,
    });
    if (r.error) {
      needsYou.push({ fileName, reason: "rejected", message: `${fileName}: ${r.error}` });
      continue;
    }
    attached++;
  }

  res.json({
    ok: true, attached, needsYou,
    sentence: pm.photoReport({ attached, needsYou: needsYou.length }),
  });
}));

app.delete("/donors/:id/photo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [d] = await query(`SELECT photo_asset_id FROM donors WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  await run(`UPDATE donors SET photo_asset_id = NULL, updated_at = NOW() WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "donor.photo", req.params.id, d.photo_asset_id || null, null, req.user);
  await pruneUnreferencedAssets(req.user.orgId, personPhoto.PHOTO_ASSET_KIND, []).catch(e =>
    console.error("[person-photo] prune:", e.message));
  res.json({ ok: true, photoUrl: null });
}));
}

module.exports = { routers, mount };
