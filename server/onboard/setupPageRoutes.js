// server/onboard/setupPageRoutes.js · ONBOARD-5. THE SETUP PAGE'S OWN ROUTES.
//
//   POST /onboarding/guided/at          { step }   the page she is on (she comes back to it)
//   POST /onboarding/guided/confirm     { step }   Continue on funds / how you talk
//   POST /onboarding/guided/finish                 "Go to Home": setup is finished
//   GET  /onboarding/setup/org                     her logo, color, fiscal year, legal name, EIN, address, signer
//   GET  /onboarding/setup/funds                   funds and campaigns with gift counts, duplicates, events
//   GET  /onboarding/setup/voice                   the Major cut, her word for donors, the couple addressee
//   GET  /onboarding/setup/gifts                   each giving source's "Connected as …"
//   GET  /onboarding/setup/connections             QuickBooks and her mailbox, "Connected as …"
//   GET  /onboarding/setup/team                    who is here, pending invitations, donors with no owner
//   GET  /onboarding/setup/call                    the last page: totals and the first three calls
//   GET  /onboarding/setup/sample                  her latest real gift, for the sample receipt and letter
//   POST /onboarding/setup/site-colors             reads her website's colors (writes nothing)
//   POST /onboarding/setup/voice                   { majorCents, giverSingular, giverPlural, addresseePattern }
//   POST /onboarding/setup/events                  { name, month, lettersMonth } one of her yearly events
//   POST /onboarding/setup/events/remove           { id }
//   POST /onboarding/setup/owners                  { to, which: "unowned"|"major" } who owns which donors
//
// Every other write a page makes goes through the route that already owns it:
// /orgs/branding, /org/vocabulary, PATCH /orgs/:id, /letters/signatures/org,
// /finance/funds/:id, /campaign-tidy/merge, /giving-sources, /oauth/*, /auth/invite.
// Nothing here sends anything. Invitations go out only from /auth/invite, which
// the page calls only when she presses Send invites.
"use strict";
const crypto = require("crypto");
const GUIDED = require("./guided");
const DATA = require("./setupData");

function mount(app, ctx) {
  const { query, run, wrap, requireAuth, requireAdmin, checkWriteAccess, actor } = ctx;
  const who = req => (actor ? actor(req) : { id: req.user.userId, name: String(req.user.name || req.user.email || "user").slice(0, 120) });
  const may = checkWriteAccess || ((req, res, next) => next());
  const admin = requireAdmin || ((req, res, next) => next());

  app.post("/onboarding/guided/at", requireAuth, may, wrap(async (req, res) => {
    const r = await GUIDED.setAt(run, req.user.orgId, String((req.body || {}).step || ""), who(req));
    if (r.error) return res.status(400).json(r);
    res.json({ ok: true });
  }));

  app.post("/onboarding/guided/confirm", requireAuth, may, wrap(async (req, res) => {
    const r = await GUIDED.confirm(run, req.user.orgId, String((req.body || {}).step || ""), who(req));
    if (r.error) return res.status(400).json(r);
    res.json({ ok: true, ...(await GUIDED.read(query, req.user.orgId)) });
  }));

  app.post("/onboarding/guided/finish", requireAuth, may, wrap(async (req, res) => {
    await GUIDED.finish(run, req.user.orgId, who(req));
    if (req.audit) req.audit.label("Finished setting up Steward");
    res.json({ ok: true });
  }));

  app.get("/onboarding/setup/org", requireAuth, wrap(async (req, res) => res.json(await DATA.org(query, req.user.orgId))));
  app.get("/onboarding/setup/funds", requireAuth, wrap(async (req, res) => res.json(await DATA.funds(query, req.user.orgId))));
  app.get("/onboarding/setup/voice", requireAuth, wrap(async (req, res) => res.json(await DATA.voice(query, req.user.orgId))));
  app.get("/onboarding/setup/gifts", requireAuth, wrap(async (req, res) => res.json(await DATA.gifts(query, req.user.orgId))));
  app.get("/onboarding/setup/connections", requireAuth, wrap(async (req, res) => res.json(await DATA.connections(query, req.user.orgId, req.user.userId))));
  app.get("/onboarding/setup/team", requireAuth, wrap(async (req, res) => res.json({ me: req.user.userId, ...(await DATA.team(query, req.user.orgId)) })));
  app.get("/onboarding/setup/sample", requireAuth, wrap(async (req, res) => res.json({ gift: await DATA.sampleGift(query, req.user.orgId) })));
  app.get("/onboarding/setup/call", requireAuth, wrap(async (req, res) => {
    const DS = require("../../donorStatus");
    const today = await DS.todayFor(req.user.orgId);
    res.json(await DATA.call(query, req.user.orgId, today, (...a) => require("../../insightsData").insightsFor(...a)));
  }));

  // Her website's colors, to prefill Make it yours. A read of a public page; nothing is stored.
  app.post("/onboarding/setup/site-colors", requireAuth, wrap(async (req, res) => {
    const [o] = await query(`SELECT website FROM orgs WHERE id = ?`, [req.user.orgId]);
    const url = String((req.body || {}).url || (o && o.website) || "").trim();
    if (!url) return res.json({ colors: [], sentence: "No website on file, so these are Steward's colors." });
    const site = await require("../../setupSite").readSite(url).catch(() => ({ ok: false }));
    const f = (site && site.facts) || {};
    const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || "")) ? String(v).toLowerCase() : null);
    const colors = [...new Set([hex((f.brandPrimary || {}).value), hex((f.brandAccent || {}).value)].filter(Boolean))];
    res.json({ colors, logoUrl: (f.logoUrl || {}).value || null,
      sentence: colors.length ? `We pulled ${colors.length === 1 ? "this" : "these"} from ${url}. Change any of them.` : "We could not read colors from your website, so these are Steward's." });
  }));

  app.post("/onboarding/setup/voice", requireAuth, admin, may, wrap(async (req, res) => {
    const b = req.body || {};
    const HG = require("../../shared/numbers/householdGiving");
    const [o] = await query(`SELECT giving_level_mid_cents, vocabulary_json FROM orgs WHERE id = ?`, [req.user.orgId]);
    const lv = DATA.levelsFor(b.majorCents, o.giving_level_mid_cents);
    if (lv.error) return res.status(400).json({ error: "invalid_major", message: lv.error });
    const w = DATA.wordFor(b.giverSingular, b.giverPlural);
    if (w.error) return res.status(400).json({ error: "invalid_word", message: w.error });
    const ap = HG.validAddresseePattern(b.addresseePattern);
    if (!ap.ok) return res.status(400).json({ error: "invalid_addressee", message: ap.message });
    const V = await import("../../shared/vocabulary.js");
    // Her other words stay as they are: only the donor pair changes.
    const now = V.normalizeVocabulary(o.vocabulary_json);
    const store = V.vocabularyToStore({ ...now, giver_singular: w.singular, giver_plural: w.plural });
    await run(`UPDATE orgs SET giving_level_mid_cents = ?, giving_level_major_cents = ?, vocabulary_json = ?, vocabulary_set_at = NOW(), addressee_pattern = ? WHERE id = ?`,
      [lv.mid, lv.major, JSON.stringify(store), ap.value, req.user.orgId]);
    // What is derived from the levels is rebuilt now, as Settings' giving levels do.
    await require("../insights/store").schedule(req.user.orgId).catch(e => console.error("[setup voice] insights:", e.message));
    if (req.audit) req.audit.label("Set how Steward talks: the major-gift amount, the word for donors and how couples are addressed");
    res.json({ ok: true, ...(await DATA.voice(query, req.user.orgId)),
      midMoved: lv.moved ? `Mid-level now starts at $${(lv.mid / 100).toLocaleString("en-US")}, so it stays under Major.` : null });
  }));

  app.post("/onboarding/setup/events", requireAuth, admin, may, wrap(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim().replace(/\s+/g, " ");
    const month = Number(b.month), letters = b.lettersMonth == null || b.lettersMonth === "" ? null : Number(b.lettersMonth);
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "invalid_event", message: "Give the event a name of 2 to 80 characters." });
    if (!Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ error: "invalid_event", message: "Choose the month it happens." });
    if (letters != null && (!Number.isInteger(letters) || letters < 1 || letters > 12)) return res.status(400).json({ error: "invalid_event", message: "Choose the month its tax letters go, or none." });
    const id = "yev_" + crypto.randomBytes(8).toString("hex");
    const w = who(req);
    await run(`INSERT INTO org_yearly_events (id, org_id, name, month, letters_month, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)`,
      [id, req.user.orgId, name, month, letters, w.id, w.name]);
    if (req.audit) req.audit.entity("org_yearly_event", id, name);
    res.status(201).json({ ok: true, id, ...(await DATA.funds(query, req.user.orgId)) });
  }));

  app.post("/onboarding/setup/events/remove", requireAuth, admin, may, wrap(async (req, res) => {
    const id = String((req.body || {}).id || "");
    const r = await run(`UPDATE org_yearly_events SET deleted_at = NOW() WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [id, req.user.orgId]);
    if (!r.changes) return res.status(404).json({ error: "not_found", message: "That event is not on your list." });
    res.json({ ok: true, ...(await DATA.funds(query, req.user.orgId)) });
  }));

  app.post("/onboarding/setup/owners", requireAuth, admin, may, wrap(async (req, res) => {
    const r = await DATA.assignOwners({ query, run }, req.user.orgId, req.body || {}, who(req));
    if (r.error) return res.status(400).json({ error: "invalid_owner", message: r.error });
    if (req.audit) req.audit.label(`Gave ${r.updated} donors an owner during setup`);
    res.json({ ok: true, ...r });
  }));
}

module.exports = { mount };
