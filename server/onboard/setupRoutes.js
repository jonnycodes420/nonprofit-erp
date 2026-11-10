// server/onboard/setupRoutes.js · ONBOARD-2. THE CUSTOMER'S SIDE: HOME → "GETTING SET UP".
//
//   GET  /onboarding/mine          the same five stages, in her words, each with
//                                  one button; `show` is false once the first
//                                  month is done (Settings still draws it)
//   POST /onboarding/home-opened   Home was opened by a person at the org (a
//                                  kickoff signal; Steward's own staff and a
//                                  support session are not her)
//   GET  /onboarding/kickoff       "Who to call tomorrow": the top five moves
//                                  from Home, each with the name, the last gift
//                                  and why
//
// She sees her own steps only: never the red windows, Jonathan's next action,
// "Waiting on" or MRR. A stage is never set here.
"use strict";
const BOARD = require("./board");
const STAGES = require("./stages");
const { lastGifts } = require("../../shared/numbers/lastGift");

// Each step in her words, with its one button. `go` is where the button leads
// (the client's onNavigate): [tab, options].
function stepsFor(row) {
  const g = row.gates;
  const part = (s, k) => (g[s].parts || []).find(p => p.key === k) || {};
  const steps = [];
  steps.push({ id: "paper", stage: "paper", done: g.paper.met, words: "Sign your agreement and add a card", button: "Open billing", go: ["settings", { section: "account" }] });
  steps.push({ id: "data", stage: "data", done: g.data.met, words: "Check your import and say it matches", button: "Check the import", go: ["settings", { section: "imports" }] });
  steps.push({ id: "stripe", stage: "connections", done: !!part("connections", "stripe").ok, words: "Connect Stripe so gifts land in your bank", button: "Connect Stripe", go: ["settings", { section: "connections", focus: "giving" }] });
  const page = part("connections", "page");
  steps.push({ id: "page", stage: "connections", done: !!page.ok,
    words: page.ok ? "Your giving page shows your name" : /logo/.test(page.says || "") ? "Your giving page needs your logo" : "Your giving page shows your name: Publish",
    button: /logo/.test(page.says || "") ? "Add your logo" : "Publish", go: ["settings", { section: /logo/.test(page.says || "") ? "brandkit" : "giving" }] });
  for (const p of g.connections.parts.filter(x => x.key.startsWith("source:") || x.key.startsWith("statement:"))) {
    steps.push(p.key.startsWith("statement:")
      ? { id: p.key, stage: "connections", done: true, words: `${p.label}: you bring its statement in each month`, button: "Import a statement", go: ["settings", { section: "imports" }] }
      : { id: p.key, stage: "connections", done: p.ok, words: `Connect ${p.label} so its gifts come in by themselves`, button: `Connect ${p.label}`, go: ["settings", { section: "connections", focus: "giving" }] });
  }
  steps.push({ id: "kickoff", stage: "kickoff", done: g.kickoff.met, words: "Make your first call from your list", button: "Who to call", go: ["kickoff", null] });
  const gift = part("first_month", "gift"), paid = part("first_month", "paid");
  steps.push({ id: "gift", stage: "first_month", done: !!gift.ok, words: "Record your first gift in Steward", button: "Add a gift", go: ["donors", undefined] });
  steps.push({ id: "charge", stage: "first_month", done: !!paid.ok,
    words: row.gates.first_month.parts[1].says === "The payment failed" ? "Your Steward payment didn't go through: update your card" : row.firstChargeOn ? `Your first Steward charge is ${row.firstChargeOn}` : "Your first Steward charge",
    button: "Open billing", go: ["settings", { section: "account" }] });
  return steps;
}

// An org is shown "Getting set up" once onboarding has begun for it.
async function inOnboarding(query, orgId) {
  const [o] = await query(`SELECT paper_done_at FROM orgs WHERE id = ?`, [orgId]);
  if (o && o.paper_done_at) return true;
  const [l] = await query(`SELECT 1 AS y FROM start_links WHERE org_id = ? LIMIT 1`, [orgId]).catch(() => []);
  if (l) return true;
  const [ob] = await query(`SELECT 1 AS y FROM org_onboarding WHERE org_id = ? AND verbal_yes_on IS NOT NULL`, [orgId]).catch(() => []);
  return !!ob;
}

function mount(app, ctx) {
  const { query, run, wrap, requireAuth, orgToday, orgTz } = ctx;
  const isHer = req => req.user && !req.user.support && !req.user.isSuperAdmin;

  app.get("/onboarding/mine", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    if (!(await inOnboarding(query, orgId))) return res.json({ tracked: false, show: false, steps: [] });
    const row = await BOARD.one(query, orgId);
    if (!row) return res.json({ tracked: false, show: false, steps: [] });
    const steps = stepsFor(row);
    res.json({ tracked: true, show: row.stage !== "billing", stage: row.stage, stageTitle: STAGES.TITLE[row.stage],
      stages: STAGES.STAGES.map(id => ({ id, title: STAGES.TITLE[id], done: row.gates[id].met })),
      steps, doneCount: steps.filter(s => s.done).length, totalCount: steps.length,
      homeOpened: !!(row.gates.kickoff.parts[1] || {}).ok });
  }));

  app.post("/onboarding/home-opened", requireAuth, wrap(async (req, res) => {
    if (!isHer(req)) return res.json({ ok: true, recorded: false });
    const orgId = req.user.orgId;
    if (!(await inOnboarding(query, orgId))) return res.json({ ok: true, recorded: false });
    await BOARD.ensureRow(run, orgId, { id: req.user.userId, name: String(req.user.name || req.user.email || "user").slice(0, 120) });
    const [r] = await query(`UPDATE org_onboarding SET home_opened_at = ?, home_opened_by = ? WHERE org_id = ? AND home_opened_at IS NULL RETURNING org_id`,
      [new Date().toISOString(), req.user.userId, orgId]);
    if (r) await BOARD.recompute({ query, run }, [orgId]);
    res.json({ ok: true, recorded: !!r });
  }));

  app.get("/onboarding/kickoff", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const asOf = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const got = await require("../../insightsData").insightsFor(orgId, asOf);
    if (got.preparing || !got.result || !got.result.deck) return res.json({ preparing: true, people: [] });
    const deck = got.result.deck;
    const tabs = [...deck.tabs.filter(t => t.key === deck.open), ...deck.tabs.filter(t => t.key !== deck.open)];
    const seen = new Set(), picks = [];
    for (const t of tabs) for (const m of t.moves) {
      if (!m.lead || seen.has(m.lead) || picks.length >= 5) continue;
      seen.add(m.lead); picks.push(m);
    }
    const last = await lastGifts(query, orgId, picks.map(m => m.lead));
    res.json({ preparing: false, asOf,
      sentence: "The first five people on your moves, in the order Home shows them: who they are, their last gift, and why now.",
      people: picks.map(m => ({ id: m.lead, name: m.name, label: m.label || null, why: m.why || null, what: m.what || null,
        lastGift: last.get(m.lead) || null })) });
  }));
}

module.exports = { mount, stepsFor };
