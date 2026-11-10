// routes/wealthScore.js · WEALTH-1. A WEALTH SCORE ON EVERY PERSON.
//
//   GET   /donors/:id/wealth-score     the score, who set it and when, and Steward's suggestion
//   PATCH /donors/:id/wealth-score     set 1 to 5, or clear (score: null). One click, no dialog.
//   POST  /donors/bulk-wealth-score    the Donors list's bulk action: one score for the people picked
//   GET   /org/wealth-scores           may I see them, and is the team switch on
//   PUT   /org/wealth-scores           an admin turns "Everyone on the team can see Wealth Scores" on or off
//
// And the guard every list read passes: GET /donors, /donors/ids and
// /donors/export/csv, saving a list view and making a group by rule, refuse (403) a filter, sort or
// column naming the Wealth Score for someone who may not see it.
//
// THE RULE: nothing writes donors.wealth_rating but a person's own request
// here (or her own import file). A suggestion is shown, never stored.
// Every change is audited by middleware/auditTrail.js: the PATCH by its own
// before/after read of the row, the bulk set one row per person.
// Declared ahead of crm's /donors/:id (Express order).
"use strict";
const express = require("express");
const WS = require("../shared/numbers/wealthScore");
const WA = require("../server/wealth/access");

const routers = { r0: express.Router() };
const BULK_CAP = 25000;

function mount(ctx) {
const { query, run, requireAuth, requireAdmin, checkWriteAccess, wrap, actor } = ctx;
const app = routers.r0;

const mayOr403 = wrap(async (req, res, next) => {
  if (!(await WA.maySee(req.user && req.user.userId, req.user && req.user.orgId))) return res.status(403).json(WA.REFUSAL);
  next();
});

// ── THE GUARD ON EVERY LIST READ ───────────────────────────────────────────
// Only when the request names the field; any other list read passes untouched.
const listGuard = wrap(async (req, res, next) => {
  const q = req.query || {};
  const b = req.body || {};
  const asks = WA.names(q.where) || WA.names(q.cols) || String(q.sort || "") === WA.FIELD
    || WA.names(b.filters) || WA.names(b.columns) || String(b.sort || "") === WA.FIELD || WA.names(b.rules) || WA.names(b.where);
  if (!asks) return next();
  if (!(await WA.maySee(req.user.userId, req.user.orgId))) return res.status(403).json(WA.REFUSAL);
  next();
});
app.get(["/donors", "/donors/ids", "/donors/export/csv"], requireAuth, listGuard);
app.post("/donors/list-views", requireAuth, listGuard);
app.put(["/donors/list-layout", "/donors/list-layout/org"], requireAuth, listGuard);
// Group rules can use it (groups.js `where`); making or changing such a group is hers to do only if she may see it.
app.post("/groups", requireAuth, listGuard);
app.patch("/groups/:id", requireAuth, listGuard);

// ── ONE PERSON ─────────────────────────────────────────────────────────────
async function suggestionFor(orgId, donorId) {
  const P = require("../prospect");
  const facts = (await P.loadFacts(orgId, [donorId])).get(donorId);
  return facts ? WS.suggest(facts) : null;
}
const out = (d, suggestion) => ({
  id: d.id, score: d.wealth_rating == null ? null : Number(d.wealth_rating),
  setAt: d.wealth_rating_set_at || null, setByName: d.wealth_rating_set_by_name || null,
  // A suggestion only beside an empty score, and never counted as set.
  suggestion: d.wealth_rating == null ? suggestion : null,
  label: WS.LABEL, definition: WS.SENTENCE,
});

app.get("/donors/:id/wealth-score", requireAuth, mayOr403, wrap(async (req, res) => {
  const [d] = await query(`SELECT id, wealth_rating, wealth_rating_set_at, wealth_rating_set_by_name FROM donors
                            WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  res.json(out(d, d.wealth_rating == null ? await suggestionFor(req.user.orgId, d.id) : null));
}));

app.patch("/donors/:id/wealth-score", requireAuth, mayOr403, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  if (!("score" in b)) return res.status(400).json({ error: "score_required", sentence: "Choose 1, 2, 3, 4 or 5, or clear it." });
  const p = WS.parseScore(b.score);
  if (!p.ok) return res.status(400).json({ error: "bad_score", sentence: "A Wealth Score is 1, 2, 3, 4 or 5, or not set." });
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT id, name, wealth_rating FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const before = d.wealth_rating == null ? null : Number(d.wealth_rating);
  if (before === p.score) {
    const [same] = await query(`SELECT id, wealth_rating, wealth_rating_set_at, wealth_rating_set_by_name FROM donors WHERE id = ? AND org_id = ?`, [d.id, orgId]);
    return res.json({ ...out(same, null), unchanged: true });
  }
  const who = actor(req);
  await run(`UPDATE donors SET wealth_rating = ?, wealth_rating_set_at = ?, wealth_rating_set_by = ?, wealth_rating_set_by_name = ?, updated_at = NOW()
              WHERE id = ? AND org_id = ?`,
    [p.score, p.score == null ? null : new Date(), p.score == null ? null : who.id, p.score == null ? null : who.name, d.id, orgId]);
  // Who, when (the audit row's own), the old value and the new, in words a
  // person reads in the audit log.
  if (req.audit) {
    req.audit.entity && req.audit.entity("donor", d.id, d.name);
    req.audit.before && req.audit.before({ wealth_score: before });
    req.audit.after && req.audit.after({ wealth_score: p.score, ...(b.fromSuggestion === true ? { accepted_suggestion: true } : {}) });
  }
  // A score can move someone into a group by rule.
  await require("../afterChange").afterChange(orgId, [d.id], { door: "wealth_score", recalc: false }).catch(() => {});
  const [now] = await query(`SELECT id, wealth_rating, wealth_rating_set_at, wealth_rating_set_by_name FROM donors WHERE id = ? AND org_id = ?`, [d.id, orgId]);
  res.json({ ...out(now, p.score == null ? await suggestionFor(orgId, d.id) : null),
    sentence: p.score == null ? `${d.name}'s Wealth Score is cleared.` : `${d.name}'s Wealth Score is ${p.score}.` });
}));

// ── MANY PEOPLE ────────────────────────────────────────────────────────────
app.post("/donors/bulk-wealth-score", requireAuth, mayOr403, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const p = WS.parseScore(b.score);
  if (!("score" in b) || !p.ok) return res.status(400).json({ error: "bad_score", sentence: "Choose 1, 2, 3, 4 or 5, or clear it." });
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, BULK_CAP) : [];
  if (!ids.length) return res.status(400).json({ error: "ids_required", sentence: "Pick at least one person." });
  const orgId = req.user.orgId;
  const rows = await query(`SELECT id, name, wealth_rating FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL`, [orgId, ids]);
  const changing = rows.filter(r => (r.wealth_rating == null ? null : Number(r.wealth_rating)) !== p.score);
  const who = actor(req);
  if (changing.length) {
    await run(`UPDATE donors SET wealth_rating = ?, wealth_rating_set_at = ?, wealth_rating_set_by = ?, wealth_rating_set_by_name = ?, updated_at = NOW()
                WHERE org_id = ? AND id = ANY(?)`,
      [p.score, p.score == null ? null : new Date(), p.score == null ? null : who.id, p.score == null ? null : who.name, orgId, changing.map(r => r.id)]);
    if (req.audit) {
      req.audit.summary && req.audit.summary(p.score == null ? `cleared the Wealth Score of ${changing.length} ${changing.length === 1 ? "person" : "people"}`
        : `set the Wealth Score to ${p.score} for ${changing.length} ${changing.length === 1 ? "person" : "people"}`, { count: changing.length });
      req.audit.perRecord && req.audit.perRecord(changing.map(r => ({ entityType: "donor", entityId: r.id, label: r.name,
        before: { wealth_score: r.wealth_rating == null ? null : Number(r.wealth_rating) }, after: { wealth_score: p.score } })));
    }
    await require("../afterChange").afterChange(orgId, changing.map(r => r.id), { door: "wealth_score", recalc: false }).catch(() => {});
  }
  const n = changing.length;
  res.json({ changed: n, already: rows.length - n,
    sentence: p.score == null ? `Cleared the Wealth Score for ${n} ${n === 1 ? "person" : "people"}.` : `Set the Wealth Score to ${p.score} for ${n} ${n === 1 ? "person" : "people"}.` });
}));

// ── THE SETTING ────────────────────────────────────────────────────────────
app.get("/org/wealth-scores", requireAuth, wrap(async (req, res) => {
  const [team, mine] = await Promise.all([WA.teamMaySee(req.user.orgId), WA.maySee(req.user.userId, req.user.orgId)]);
  res.json({ team, maySee: mine, label: WS.LABEL, definition: WS.SENTENCE });
}));
app.put("/org/wealth-scores", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const on = !!(req.body && req.body.team === true);
  await run(`UPDATE orgs SET wealth_scores_team = ? WHERE id = ?`, [on, req.user.orgId]);
  res.json({ team: on, sentence: on ? "Everyone on the team can see Wealth Scores." : "Only admins and staff with the major gifts permission see Wealth Scores." });
}));
}

module.exports = { routers, mount };
