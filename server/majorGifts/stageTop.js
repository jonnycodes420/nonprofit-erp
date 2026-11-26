// server/majorGifts/stageTop.js · COMMS-3 item 4. "SET STAGES FOR YOUR TOP 40".
//
// Communications → Audience: a Major, Prospects or Ready to ask card at 0 because no one has a
// major-gift stage yet links here. Major Gifts → Pipeline then shows the top 40 by Lifetime
// (shared/numbers/topDonors.js, the same order as Reports' Top donors, Lifetime) who have no
// stage, each with a stage to pick. Nothing is set until she presses the one button; then each
// picked person gets that stage (the Directory's bulk stage rule) and lands on her board when
// nobody owns them yet (POST /pipeline/add's rule: assignment is membership).
"use strict";
const STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward"];
const LIMIT = 40;

function mountStageTop(app, { query, run, requireAuth, requireCrm, checkWriteAccess, wrap }) {
  app.get("/pipeline/stage-top", requireAuth, requireCrm, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const top = require("../../shared/numbers/topDonors").topLifetimeSql();
    const rows = await query(`SELECT t.*, d.stage FROM (${top} LIMIT ?) t JOIN donors d ON d.id = t.id AND d.org_id = ?`, [orgId, LIMIT * 3, orgId]);
    const vis = require("../auth/portfolio").visibleSql(req, "d");   // ACCESS-2: their people only
    let list = rows.filter(r => !r.stage);
    if (vis.scoped && list.length) {
      const seen = new Set((await query(`SELECT d.id FROM donors d WHERE d.org_id=? AND d.id = ANY(?::text[])${vis.sql}`, [orgId, list.map(r => r.id), ...vis.args])).map(r => r.id));
      list = list.filter(r => seen.has(r.id));
    }
    list = list.slice(0, LIMIT);
    const [staged] = await query("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND deleted_at IS NULL AND COALESCE(stage,'') <> ''", [orgId]);
    res.json({ people: list.map((r, i) => ({ id: r.id, name: r.name, rank: i + 1, lifetime: Number(r.total) || 0, lastGiftDate: r.last_gift_date || null })),
      staged: staged.n, stages: STAGES,
      sentence: `Your top ${LIMIT} donors by Lifetime giving who have no major-gift stage yet, the same order as Reports' Top donors (Lifetime). Pick a stage for anyone you are working with; leave the rest blank.` });
  }));

  // { stages: { donorId: stage } }. Blank ones are left alone.
  app.post("/pipeline/stage-top", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const pairs = Object.entries((req.body && req.body.stages) || {}).filter(([id, st]) => id && STAGES.includes(st));
    if (!pairs.length) return res.status(400).json({ error: "no_stages", sentence: "Pick a stage for at least one person." });
    const ids = pairs.map(([id]) => id);
    const owned = await query("SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL", [ids, orgId]);
    if (owned.length !== ids.length) return res.status(404).json({ error: "One or more donors not found in your org" });
    for (const st of STAGES) {
      const these = pairs.filter(p => p[1] === st).map(p => p[0]);
      if (these.length) await run("UPDATE donors SET stage=?, updated_at=NOW() WHERE id = ANY(?) AND org_id=? AND deleted_at IS NULL", [st, these, orgId]);
    }
    const [me] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
    await run(`UPDATE donors SET assigned_to = COALESCE(assigned_to, ?), assigned_to_name = COALESCE(assigned_to_name, ?), updated_at = NOW()
                WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`, [req.user.userId, (me && me.name) || "", ids, orgId]);
    res.json({ staged: ids.length, sentence: `${ids.length} ${ids.length === 1 ? "person has" : "people have"} a stage now. Anyone nobody owned is on your board.` });
  }));
}

module.exports = { mountStageTop, STAGES, LIMIT };
