// server/memberships/routes.js — memberships and membership levels.
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
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  LAPSED_MEMBER_SQL, MB_READY, actor, checkWriteAccess, enrollMembership, figureSources, mbCents,
  membershipLevelPayload, processMembershipRenewals, query, renewMembership, requireAdmin, requireAuth,
  resolveOrgBrandTheme, run, runTx, staffWho, uuid, withTransaction, wrap,
} = ctx;
let MB = null;
MB_READY.then(m => { MB = m; });
let app = routers.r1;

app.get("/membership-levels", requireAuth, wrap(async (req, res) => {
  await MB_READY;
  const levels = await query(`SELECT * FROM membership_levels WHERE org_id=? ORDER BY active DESC, position, price`, [req.user.orgId]);
  const counts = await query(`SELECT level_id, status, COUNT(*)::int n FROM memberships WHERE org_id=? GROUP BY 1,2`, [req.user.orgId]);
  const by = {};
  for (const c of counts) (by[c.level_id] ||= { active: 0, grace: 0, lapsed: 0, cancelled: 0 })[c.status] = c.n;
  res.json({ levels: levels.map(l => membershipLevelPayload(l, by[l.id] || { active: 0, grace: 0, lapsed: 0, cancelled: 0 })) });
}));

// Prices and the value of benefits are the org's policy: admins set them.
app.post("/membership-levels", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  await MB_READY;
  const v = MB.validateLevel(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  const L = v.level, id = newId("mbl"), who = actor(req);
  // A new level sorts last on the public page until somebody moves it.
  const [last] = await query(`SELECT COALESCE(MAX(position), 0)::int AS p FROM membership_levels WHERE org_id=?`, [req.user.orgId]);
  await run(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term,scope,benefits,description,hidden,position,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?)`,
    [id, req.user.orgId, L.name, L.priceCents / 100, L.fmvCents / 100, L.term, L.scope, JSON.stringify(L.benefits),
     L.description || null, L.hidden, (last?.p || 0) + 1, who.id, who.name]);
  res.status(201).json({ id, sentence: MB.fmvSentence(L) });
}));

// PARITY-2 Part 1: THE ORDER OF THE PUBLIC PAGE, in one write. Admin-only,
// like every other change to what is for sale. The body is every level id in
// the order wanted; an id that is not this org's is refused, not skipped.
// Registered ABOVE `/membership-levels/:id` so "order" is never read as an id.
app.put("/membership-levels/order", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
  if (!ids || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length)
    return res.status(400).json({ error: "Send every level id once, in the order wanted." });
  const mine = await query(`SELECT id FROM membership_levels WHERE org_id=? AND id = ANY(?)`, [req.user.orgId, ids]);
  if (mine.length !== ids.length) return res.status(404).json({ error: "Not found" });
  const [all] = await query(`SELECT COUNT(*)::int AS n FROM membership_levels WHERE org_id=?`, [req.user.orgId]);
  if (all.n !== ids.length) return res.status(400).json({ error: "Send every level id once, in the order wanted." });
  await withTransaction(async client => {
    for (let i = 0; i < ids.length; i++)
      await runTx(client, `UPDATE membership_levels SET position=? WHERE id=? AND org_id=?`, [i + 1, ids[i], req.user.orgId]);
  });
  res.json({ ok: true, ids });
}));

// The words on a level (name, description, benefits) and whether it shows on
// the public page are anybody's with write access. What it COSTS, what it is
// worth, its term, scope and whether it is for sale at all stay admin-only:
// those are the org's policy and they change what a receipt says.
app.put("/membership-levels/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await MB_READY;
  const [l] = await query(`SELECT * FROM membership_levels WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!l) return res.status(404).json({ error: "Not found" });
  const cur = membershipLevelPayload(l);
  const v = MB.validateLevel({ ...cur, ...req.body });
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  const L = v.level;
  const active = typeof req.body?.active === "boolean" ? req.body.active : l.active !== false;
  const policyChanged = L.priceCents !== mbCents(l.price) || L.fmvCents !== mbCents(l.fmv) || L.term !== l.term
    || L.scope !== l.scope || active !== (l.active !== false);
  if (policyChanged) {
    const [u] = await query(`SELECT role FROM users WHERE id=?`, [req.user.userId]);
    if (!u || u.role !== "admin") return res.status(403).json({ error: "Only an admin changes a level's price, value, term or whether it is for sale." });
  }
  await run(`UPDATE membership_levels SET name=?, price=?, fmv=?, term=?, scope=?, benefits=?::jsonb, active=?, description=?, hidden=?
              WHERE id=? AND org_id=?`,
    [L.name, L.priceCents / 100, L.fmvCents / 100, L.term, L.scope, JSON.stringify(L.benefits), active,
     L.description || null, L.hidden, l.id, req.user.orgId]);
  res.json({ ok: true, sentence: MB.fmvSentence(L) });
}));

// A level somebody has held cannot vanish from under their receipt; retire it
// (active=false) instead.
app.delete("/membership-levels/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [used] = await query(`SELECT COUNT(*)::int n FROM memberships WHERE level_id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (used?.n) return res.status(409).json({ error: "level_in_use", message: "People have held this level. It can be retired, not removed." });
  const { changes } = await run(`DELETE FROM membership_levels WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

app.post("/donors/:id/memberships", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [level] = await query(`SELECT * FROM membership_levels WHERE id=? AND org_id=?`, [String(req.body?.levelId || ""), orgId]);
  if (!level) return res.status(404).json({ error: "Level not found" });
  if (level.active === false) return res.status(400).json({ error: `${level.name} is retired. Choose a current level.` });
  const startsOn = req.body?.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(req.body.startsOn) ? req.body.startsOn : null;
  const idem = typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim() ? req.body.idempotencyKey.trim().slice(0, 128) : null;
  try {
    const r = await enrollMembership({ orgId, donorId: req.params.id, level, startsOn, paid: req.body?.paid !== false,
      paymentMethod: req.body?.paymentMethod || null, idemKey: idem, who: actor(req) });
    res.status(r.duplicate ? 200 : 201).json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || e.message, message: e.message });
    throw e;
  }
}));

app.get("/donors/:id/memberships", requireAuth, wrap(async (req, res) => {
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT m.id, m.status, m.joined_on, m.starts_on, m.expires_on, m.gift_id, m.payment_method, m.source,
            l.id AS level_id, l.name AS level_name, l.term, l.scope
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id
      WHERE m.donor_id=? AND m.org_id=? ORDER BY m.starts_on DESC, m.created_at DESC`, [d.id, req.user.orgId]);
  res.json({ memberships: rows, current: rows.find(r => r.status === "active" || r.status === "grace") || null,
    sentence: "Memberships are counted apart from giving: the payment is a gift, and the part that bought benefits is not deductible." });
}));

// BUILD-101 Part 5 — THE MEMBER CARD. MEMBERS-2 moved the renderer to
// ../memberCard.js, because the member downloads the same card from their own
// page and two renderers is how the staff copy and the member's copy end up
// disagreeing about one membership.
const { renderMemberCardPdf } = require("../../memberCard");

app.get("/memberships/:id/card.pdf", requireAuth, wrap(async (req, res) => {
  const [m] = await query(
    `SELECT m.*, l.name AS level_name, d.name AS donor_name FROM memberships m
       JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
       JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
      WHERE m.id=? AND m.org_id=?`, [req.params.id, req.user.orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  const theme = await resolveOrgBrandTheme(req.user.orgId).catch(() => null);
  let logo = null;
  if (theme?.logoDataUri && /^data:image\/(png|jpe?g);base64,/.test(theme.logoDataUri)) { try { logo = Buffer.from(theme.logoDataUri.split(",")[1], "base64"); } catch { logo = null; } }
  const pdf = await renderMemberCardPdf({ orgName: theme?.displayName || "", accent: theme?.band, logo,
    memberName: m.donor_name, levelName: m.level_name, expiresOn: m.expires_on, memberSince: m.joined_on });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="member-card-${m.id}.pdf"`);
  res.send(pdf);
}));

app.get("/memberships/lapsed", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT m.id, m.donor_id, d.name AS donor_name, l.name AS level_name, m.expires_on,
            COALESCE(m.status_changed_on, m.expires_on) AS lapsed_on,
            (SELECT COUNT(*)::int FROM memberships t WHERE t.org_id=m.org_id AND t.donor_id=m.donor_id
               AND t.status IN ('active','grace','lapsed','renewed')) AS membership_years,
            (SELECT MAX(g.date) FROM gifts g WHERE g.org_id=m.org_id AND g.donor_id=m.donor_id
               AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.org_id=g.org_id AND x.gift_id=g.id)) AS last_gift_date
       FROM memberships m
       JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
       JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id AND d.deleted_at IS NULL
      WHERE m.org_id=? AND m.status='lapsed' AND ${LAPSED_MEMBER_SQL}
      ORDER BY lapsed_on DESC, d.name LIMIT 1000`, [orgId]);
  res.json({
    members: rows.map(r => ({ ...r, lastGiftDate: r.last_gift_date ? String(r.last_gift_date).slice(0, 10) : null })),
    sentence: "People whose most recent membership has lapsed and who hold none now. Membership years counts the terms they held. A gift here means a gift that was not a membership payment, so someone can be a lapsed member and a current donor at once.",
  });
}));

app.get("/memberships", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const where = ["m.org_id=?"], args = [orgId];
  if (req.query.status && ["active", "grace", "lapsed", "cancelled"].includes(String(req.query.status))) { where.push("m.status=?"); args.push(String(req.query.status)); }
  // "Lapsed" means a PERSON who lapsed, once: their latest membership lapsed
  // and they hold none now (BUILD-101 Part 3 — the same predicate as the
  // Lapsed list, so the count and the list cannot disagree).
  if (req.query.status === "lapsed") where.push(LAPSED_MEMBER_SQL);
  if (req.query.levelId) { where.push("m.level_id=?"); args.push(String(req.query.levelId)); }
  const dir = req.query.sort === "expiry_desc" ? "DESC" : "ASC";
  const rows = await query(
    `SELECT m.id, m.donor_id, d.name AS donor_name, m.status, m.joined_on, m.starts_on, m.expires_on, m.gift_id,
            l.id AS level_id, l.name AS level_name, l.term,
            d.your_page_sent_at AS "yourPageSentAt", d.your_page_opened_at AS "yourPageOpenedAt"
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id JOIN donors d ON d.id=m.donor_id
      WHERE ${where.join(" AND ")} ORDER BY m.expires_on ${dir} NULLS LAST, d.name LIMIT 1000`, args);
  // REPORTS-4: each status count is the `members` source's value, so it
  // opens onto the memberships it counts. Before, the counts included deleted
  // people's memberships and the rows did not.
  const byStatus = {}, byStatusSource = {};
  for (const st of ["active", "grace", "lapsed", "cancelled"]) {
    byStatusSource[st] = { key: "members", params: { status: st } };
    byStatus[st] = (await figureSources.figureValue(orgId, byStatusSource[st])).value;
  }
  res.json({ members: rows, byStatus, byStatusSource,
    sentence: "Each person counts once per membership. Active and in-grace members hold a current membership; lapsed ones have passed their grace period. Their page says whether they have opened the page that holds their card, their renewal and their receipts." });
}));

// Cancelling stops a membership; it does not refund the gift (a refund is its
// own act on the gift). Never write-gated: a lapsed org can always stop one.
app.post("/memberships/:id/cancel", requireAuth, wrap(async (req, res) => {
  const r = await query(`UPDATE memberships SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
                          WHERE id=? AND org_id=? AND status IN ('active','grace') RETURNING id, donor_id, level_id`, [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found" });
  // WIRE-1: the cancel is on the member's timeline.
  const [lv] = await query("SELECT name FROM membership_levels WHERE id=? AND org_id=?", [r[0].level_id, req.user.orgId]);
  const who = await staffWho(req);
  await TL.timelineLine({ orgId: req.user.orgId, donorId: r[0].donor_id,
    note: `${lv ? lv.name + " membership" : "Membership"} cancelled.`, actorId: who.id, actorName: who.name,
    key: `membership_cancelled:${r[0].id}`, metadata: { via: "membership", membership_id: r[0].id } });
  res.json({ ok: true });
}));

app.post("/memberships/:id/renew", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const idem = typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim() ? req.body.idempotencyKey.trim().slice(0, 128) : null;
  try {
    const r = await renewMembership({ orgId: req.user.orgId, membershipId: req.params.id, levelId: req.body?.levelId || null,
      paymentMethod: req.body?.paymentMethod || null, idemKey: idem, who: actor(req) });
    res.status(r.duplicate ? 200 : 201).json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || e.message, message: e.message });
    throw e;
  }
}));

// Ops/test hook (the /pledges/run-reminders bar). A pinned {today} is honoured
// only under TEST_MODE: production's tick passes no clock (the BUILD-94 rule).
app.post("/memberships/run-sweep", requireAuth, requireAdmin, wrap(async (req, res) => {
  const pinned = process.env.TEST_MODE && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.today || "")) ? String(req.body.today) : null;
  res.json(await processMembershipRenewals({ orgId: req.user.orgId, today: pinned }));
}));
}

module.exports = { routers, mount };
