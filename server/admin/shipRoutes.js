// STAGE-1 · /ops's "Ship to customers" card (super-admins only).
//
//   GET  /ops/ship       what is on staging and not on prod, each build's staging
//                        walk, Muse's latest staging walk, the last ship, and
//                        whether Ship and Roll back may be pressed (and why not)
//   POST /ops/ship       { sha }  dispatches ship.yml for exactly staging's commit
//   POST /ops/rollback   { sha }  dispatches ship.yml for the previous prod commit
//
// Behind the same door as GET /ops: 404 to anyone who is not a live
// super-admin, and to a support session. A press re-reads every source and
// re-applies the rule (shipSources.decide) before it dispatches, so a stale
// page can never ship a red or moving staging. The sha in the body must be the
// one the rule allows: the confirm named those builds, and nothing else goes.
// Each press is one row in prod_ships and, through the audit middleware, one
// audit row naming the commit.
"use strict";
const crypto = require("crypto");
const SHIP = require("./shipSources");
const BOARD = require("./board");

function museWalk() {
  try {
    const w = BOARD.readBoard().walks.filter(x => /staging/i.test(String(x.file || "")) || x.env === "staging");
    const last = w[w.length - 1];
    return last ? { date: last.date, pass: last.pass, fail: last.fail, skip: last.skip, file: last.file } : null;
  } catch { return null; }
}

function mount(app, { query, run, wrap, opsOnly, opsLimiter, buildSha }) {
  const prodSha = () => (typeof buildSha === "function" ? buildSha() : buildSha) || null;

  // The previous prod commit is noted when a web process boots on a new one.
  if (String(process.env.STEWARD_PROCESS || "").toLowerCase() !== "worker" && process.env.TEST_MODE !== "1") {
    const t = setTimeout(() => SHIP.noteBoot({ run, sha: prodSha() }).catch(e => console.error(`[ship] could not note this boot's commit: ${e.message}`)), 15000);
    if (t.unref) t.unref();
  }

  app.get("/ops/ship", opsLimiter, opsOnly, wrap(async (req, res) => {
    const card = await SHIP.readCard({ run, query, prodSha: prodSha() });
    res.json({ ...card, muse: museWalk() });
  }));

  const press = mode => wrap(async (req, res) => {
    const want = String((req.body && req.body.sha) || "").trim().toLowerCase();
    if (!SHIP.SHA.test(want)) return res.status(400).json({ error: "bad_sha", message: "Name the full commit to send." });
    const card = await SHIP.readCard({ run, query, prodSha: prodSha() });
    const target = mode === "ship" ? card.staging && card.staging.web : card.previousSha;
    const ok = mode === "ship" ? card.canShip : card.canRollback;
    if (!ok) return res.status(409).json({ error: "not_now", message: mode === "ship" ? card.shipReason : card.rollbackReason });
    if (want !== target) return res.status(409).json({ error: "moved", message: "What is on staging changed since this page loaded. Read the card again before shipping." });
    const builds = mode === "ship" ? card.pending.map(p => p.build || p.title).filter(Boolean) : [];
    try { await SHIP.dispatchShip({ sha: want, mode, reason: "", by: req.user.name || req.user.email }); }
    catch (e) { return res.status(502).json({ error: "dispatch_failed", message: e instanceof SHIP.SourceError ? e.message : "GitHub did not start the ship." }); }
    const id = "shp_" + crypto.randomBytes(10).toString("hex");
    await SHIP.ensureTables(run);
    await run(`INSERT INTO prod_ships (id, mode, sha, from_sha, builds, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, mode, want, card.prodSha, builds.join(", ") || null, req.user.userId, String(req.user.name || req.user.email || "super-admin").slice(0, 120)]);
    if (req.audit) {
      req.audit.entity("prod_ship", id, `${mode} ${want.slice(0, 7)}`);
      req.audit.label(mode === "ship" ? `Shipped ${want} to customers${builds.length ? `: ${builds.join(", ")}` : ""}` : `Rolled prod back to ${want} from ${card.prodSha || "unknown"}`);
    }
    res.status(202).json({ id, mode, sha: want, builds, message: mode === "ship"
      ? `Shipping ${want.slice(0, 7)}. The card shows the deploy and the prod smoke as they run.`
      : `Rolling prod back to ${want.slice(0, 7)}. The card shows the deploy and the prod smoke as they run.` });
  });
  app.post("/ops/ship", opsLimiter, opsOnly, press("ship"));
  app.post("/ops/rollback", opsLimiter, opsOnly, press("rollback"));
}

module.exports = { mount, museWalk };
