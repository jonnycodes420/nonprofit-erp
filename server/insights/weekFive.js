// server/insights/weekFive.js · HOME-7 item 1. THIS WEEK'S FIVE.
//
// Home leads with five people a week, not four tiles of hundreds. On the org's Monday (its civil
// day) the five are the top of the deck (insights.js buildDeck, with Drift and the event guests
// added, routes/insights.js deckWithDrift) across Keep, Grow, Major and Planned, one move per
// person, ranked by what is at stake:
//
//   at stake   a major gift's ask (the top of its range), else the person's last 12 months of
//              giving (the unit's l12Cents, insights.js). Planned never outranks money (HOME-3):
//              every Planned move comes after every other move. The people she owns come first
//              (the Owners card says "your five start with them"), each group by dollars.
//
// The week's five are stored per user (home_week_five), so the list is the same all week; a new
// org or a new user gets its five on first open. A GET writes nothing: Home's first read answers
// with the five it would store (`preview`) and the page asks POST /home/five/start to keep them.
//
//   GET  /home/five              the week's five (or the preview), the done strip, how many more
//   POST /home/five/start        keep this week's five (once; a second call changes nothing)
//   POST /home/five/:id/skip     Not now (this week only) or Doesn't fit (out of the deck too);
//                                the next in rank comes in, so five show until the deck runs out
//   POST /home/five/:id/done     the move's Done: the person moves to the done strip
//   POST /home/five/:id/called   Add to calls made its task; the row says so
//
// Done is also found at read, never written by a GET: the move's Done in the deck, a call or
// meeting logged with them since Monday, or a gift in since Monday (givingBetween's money rule).
// Done never brings in the next person. Nothing here sends anything.
"use strict";
const GB = require("../../shared/numbers/givingBetween");
const { newId } = require("../shared/newId");

const FIVE = 5;
// The deck's own rule for a Planned sign (insights.js computeInsights' plannedWhy), said as Home says it.
const PLANNED_SENTENCE = "A sign is something in their own record: a gift of stock, an IRA or investment distribution, a donor-advised fund or family foundation gift, a memorial or honor gift, or 5 or more years in a row of giving. Steward never guesses wealth or age.";
const SENTENCE = "At stake is each person's last 12 months of giving, or the ask for a major gift.";
const PILL = { year_end: "Year-end", pledges: "Pledge", sponsors: "Sponsor", lapsing: "Lapsing", second_gift: "Second gift", gave_before: "Gave before",
  upgraded: "Moving up", major_slipping: "Major gift", planned: "Planned", came_no_gift: "Came, didn't give" };
const pillOf = m => (m.kind === "drift" ? (/Early/.test(m.label || "") ? "Early sign" : "Drifting") : PILL[m.kind] || String(m.label || "").replace(/^.*· /, ""));

// The Monday of the week `day` (YYYY-MM-DD) is in, as a civil day.
function weekStartOf(day) {
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay();   // 0 Sunday
  return new Date(t - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

// Every move on the deck, one per person, ranked (pure). `units` are the stored answer's units
// (for l12Cents); `owned` the ids she owns.
function rankMoves(deck, units = [], owned = new Set()) {
  const byId = new Map();
  for (const u of units || []) for (const id of u.ids || []) byId.set(id, u);
  const seen = new Set(), out = [];
  let n = 0;
  for (const t of (deck && deck.tabs) || []) {
    for (const m of t.moves || []) {
      const lead = m.lead || (m.ids || [])[0];
      if (!lead || seen.has(lead)) continue;
      seen.add(lead);
      const askCents = m.kind === "major_slipping" && m.ask && Number(m.ask.cents) > 0 ? Number(m.ask.cents) : null;
      const u = byId.get(lead);
      const stakeCents = askCents != null ? askCents : Math.max(0, Number(u && u.l12Cents) || 0);
      out.push({ lead, m, stakeCents, figure: askCents != null ? "ask" : "year", planned: t.key === "planned" || m.kind === "planned",
        owned: (m.ids || [lead]).some(id => owned.has(id)), n: n++ });
    }
  }
  out.sort((a, b) => (a.planned - b.planned) || (b.owned - a.owned) || (b.stakeCents - a.stakeCents) || (a.n - b.n));
  return out;
}

// What a row keeps of the move (the snapshot it reads all week).
const snapshot = (c, tabKey) => ({
  id: c.m.id, kind: c.m.kind, itemKey: c.m.itemKey, tab: tabKey || c.m.tab, ids: c.m.ids || [c.lead], name: c.m.name, pill: pillOf(c.m),
  stakeCents: c.stakeCents, figure: c.figure, what: c.m.what || "", say: c.m.say || null, ask: c.m.ask || null,
  when: c.m.when || null, whenFrom: c.m.whenFrom || null, why: c.m.why || null,
});

const money = cents => "$" + Math.round((Number(cents) || 0) / 100).toLocaleString("en-US");
const figureWords = f => (f === "ask" ? "the ask" : "a year of giving");

// What made an open row done this week, found at read: { words } or null.
function doneBy(row, { gifts, talks, outcomes }) {
  if (row.state === "done") return { words: row.outcome || "marked done" };
  const ids = (row.move && row.move.ids) || [row.donor_id];
  const g = ids.map(id => gifts.get(id)).filter(Boolean);
  if (g.length) return { words: `gave ${money(g.reduce((n, x) => n + x.cents, 0))}` };
  const t = talks.find(x => ids.includes(x.donor_id));
  if (t) return { words: t.type === "meeting" ? "met with them" : "called" };
  if (row.move && outcomes.has(`${row.move.kind}|${row.move.itemKey}`)) return { words: "marked done" };
  return null;
}

function mount(app, { query, run, wrap, requireAuth, checkWriteAccess, actor, deckFor }) {
  const own = async (orgId, userId) => new Set((await query(`SELECT id FROM donors WHERE org_id=? AND assigned_to=? AND deleted_at IS NULL`, [orgId, userId])).map(r => r.id));
  const stored = (orgId, userId, weekOf) => query(`SELECT id, donor_id, rank, move, state, outcome, called_on::text AS called_on FROM home_week_five
      WHERE org_id=? AND user_id=? AND week_of=? ORDER BY rank, created_at`, [orgId, userId, weekOf]);

  async function context(req) {
    const d = await deckFor(req);
    if (d.preparing) return { ...d, ranked: [] };
    const ranked = rankMoves(d.deck, d.units, await own(req.user.orgId, req.user.userId));
    return { ...d, ranked, weekOf: weekStartOf(d.asOf) };
  }

  // The rows Home draws: the open five (or fewer, when the deck ran out), the done strip, and how many more.
  async function view(req, ctx, rows, { preview = false } = {}) {
    const orgId = req.user.orgId;
    const live = rows.filter(r => r.state === "open" || r.state === "done");
    const ids = [...new Set(live.flatMap(r => (r.move && r.move.ids) || [r.donor_id]))];
    const [gifts, talks, outs] = ids.length && !preview ? await Promise.all([
      GB.givingBetweenOf(query, orgId, { from: ctx.weekOf, to: ctx.asOf, today: ctx.asOf, donorIds: ids }),
      query(`SELECT donor_id, type FROM interactions WHERE org_id=? AND donor_id = ANY(?) AND type IN ('call','meeting') AND is_sample IS NOT TRUE
              AND LEFT(date,10) >= ? AND LEFT(date,10) <= ?`, [orgId, ids, ctx.weekOf, ctx.asOf]),
      query(`SELECT kind, item_key FROM insight_outcomes WHERE org_id=? AND state='done' AND created_at >= ?::date AND donor_ids && ?::text[]`, [orgId, ctx.weekOf, ids]),
    ]) : [new Map(), [], []];
    const outcomes = new Set(outs.map(o => `${o.kind}|${o.item_key}`));
    const open = [], done = [];
    for (const r of live) {
      const m = r.move || {};
      const out = { id: r.id || null, donorId: r.donor_id, name: m.name, pill: m.pill, tab: m.tab, kind: m.kind, itemKey: m.itemKey, ids: m.ids,
        stakeCents: m.stakeCents, stakeWords: money(m.stakeCents), figure: m.figure, figureWords: figureWords(m.figure),
        what: m.what, say: m.say, ask: m.ask, when: m.when, whenFrom: m.whenFrom, calledOn: r.called_on || null };
      const by = preview ? null : doneBy(r, { gifts, talks, outcomes });
      if (by) done.push({ ...out, outcome: by.words }); else open.push(out);
    }
    const total = ((ctx.deck && ctx.deck.tabs) || []).reduce((n, t) => n + (Number(t.count) || 0), 0);
    const inWeek = new Set(rows.map(r => r.donor_id));
    const more = Math.max(0, total - live.length - rows.filter(r => r.state !== "open" && r.state !== "done" && ctx.ranked.some(c => c.lead === r.donor_id)).length);
    return {
      asOf: ctx.asOf, weekOf: ctx.weekOf, preview, sentence: SENTENCE, open: open.slice(0, FIVE), done, shown: Math.min(FIVE, open.length + done.length),
      allDone: open.length === 0 && done.length > 0,
      more, moreSentence: `${more.toLocaleString("en-US")} more ${more === 1 ? "person has" : "people have"} a next move in Keep, Grow, Major and Planned.`,
      left: ctx.ranked.filter(c => !inWeek.has(c.lead)).length,
      drift: ctx.deck && ctx.deck.drift ? { ...ctx.deck.drift, people: (ctx.deck.drift.people || []).slice(0, 10) } : { count: 0, people: [] },
      planned: await plannedOf(orgId, ctx),
    };
  }

  // HOME-7 item 3: Planned giving, the deck's own Planned tab (its count is the tab's), the top three
  // with their sign, and the people whose record holds a bequest (profile, Giving, Planned giving).
  async function plannedOf(orgId, ctx) {
    const t = ((ctx.deck && ctx.deck.tabs) || []).find(x => x.key === "planned");
    if (!t || !t.count) return null;
    const [b] = await query(`SELECT COUNT(DISTINCT pg.donor_id)::int AS n FROM planned_gifts pg JOIN donors d ON d.id = pg.donor_id AND d.org_id = pg.org_id
                              WHERE pg.org_id=? AND pg.type='bequest' AND d.deleted_at IS NULL`, [orgId]).catch(() => [{ n: 0 }]);
    return { count: t.count, definition: PLANNED_SENTENCE, bequests: Number(b && b.n) || 0, bequestSource: { key: "planned-bequests", params: {} },
      top: (t.moves || []).slice(0, 3).map(m => ({ donorId: m.lead, name: m.name, sign: String(m.what || "").replace(/^Signals: /, "").replace(/\.\s*\$[\d,]+ given in all\.$/, "") })) };
  }

  const tabOf = (deck, m) => ((deck.tabs || []).find(t => (t.moves || []).includes(m)) || {}).key;
  const asRow = (ctx, c, rank) => ({ id: null, donor_id: c.lead, rank, move: snapshot(c, tabOf(ctx.deck, c.m)), state: "open", outcome: null, called_on: null });
  async function insert(req, ctx, cands, from) {
    const a = actor(req);
    let rank = from;
    for (const c of cands) {
      await run(`INSERT INTO home_week_five (id, org_id, user_id, week_of, donor_id, rank, move, state, created_by, created_by_name)
                 VALUES (?,?,?,?,?,?,?::jsonb,'open',?,?) ON CONFLICT (org_id, user_id, week_of, donor_id) DO NOTHING`,
        [newId("wf"), req.user.orgId, req.user.userId, ctx.weekOf, c.lead, rank++, JSON.stringify(snapshot(c, tabOf(ctx.deck, c.m))), a.id, a.name]);
    }
  }

  app.get("/home/five", requireAuth, wrap(async (req, res) => {
    const ctx = await context(req);
    if (ctx.preparing) return res.json({ preparing: true, sentence: SENTENCE, open: [], done: [], more: 0, drift: { count: 0, people: [] } });
    const rows = await stored(req.user.orgId, req.user.userId, ctx.weekOf);
    if (rows.length) return res.json(await view(req, ctx, rows));
    res.json(await view(req, ctx, ctx.ranked.slice(0, FIVE).map((c, i) => asRow(ctx, c, i + 1)), { preview: true }));
  }));

  app.post("/home/five/start", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const ctx = await context(req);
    if (ctx.preparing) return res.json({ preparing: true, open: [], done: [] });
    const have = await stored(req.user.orgId, req.user.userId, ctx.weekOf);
    if (!have.length) await insert(req, ctx, ctx.ranked.slice(0, FIVE), 1);
    res.setHeader("X-Steward-Changed", "none");   // keeping the week's five changes nothing any screen shows (FRESH-4 re-reads nothing)
    res.json(await view(req, ctx, await stored(req.user.orgId, req.user.userId, ctx.weekOf)));
  }));

  async function rowOf(req) {
    const [r] = await query(`SELECT id, donor_id, week_of::text AS week_of, move, state FROM home_week_five WHERE id=? AND org_id=? AND user_id=?`,
      [req.params.id, req.user.orgId, req.user.userId]);
    return r || null;
  }

  app.post("/home/five/:id/skip", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const why = req.body && req.body.why === "not_fit" ? "not_fit" : "not_now";
    const r = await rowOf(req);
    if (!r) return res.status(404).json({ error: "not_found", sentence: "That person is not in your five this week." });
    const ctx = await context(req);
    await run(`UPDATE home_week_five SET state=?, state_at=NOW() WHERE id=? AND org_id=? AND state='open'`, [why, r.id, req.user.orgId]);
    if (why === "not_fit" && r.move && r.move.kind && r.move.itemKey) {
      // Doesn't fit is the deck's Doesn't fit: the move leaves the deck too (insight_outcomes, as POST /insights/outcome writes it).
      const a = actor(req);
      await run(`INSERT INTO insight_outcomes (id, org_id, kind, item_key, donor_ids, state, until, reason, created_by, created_by_name) VALUES (?,?,?,?,?,'dismissed',NULL,?,?,?)`,
        [newId("io"), req.user.orgId, String(r.move.kind).slice(0, 40), String(r.move.itemKey).slice(0, 300), r.move.ids || [r.donor_id],
         req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : "Doesn't fit (this week's five)", a.id, a.name]);
    }
    // The next in rank comes in: someone not yet in this week's list, in any state.
    const rows = await stored(req.user.orgId, req.user.userId, ctx.weekOf);
    const inWeek = new Set(rows.map(x => x.donor_id));
    const next = ctx.ranked.find(c => !inWeek.has(c.lead));
    if (next && rows.filter(x => x.state === "open").length < FIVE) await insert(req, ctx, [next], Math.max(0, ...rows.map(x => x.rank)) + 1);
    res.json(await view(req, ctx, await stored(req.user.orgId, req.user.userId, ctx.weekOf)));
  }));

  app.post("/home/five/:id/done", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const r = await rowOf(req);
    if (!r) return res.status(404).json({ error: "not_found", sentence: "That person is not in your five this week." });
    await run(`UPDATE home_week_five SET state='done', state_at=NOW(), outcome=COALESCE(outcome, 'marked done') WHERE id=? AND org_id=?`, [r.id, req.user.orgId]);
    if (r.move && r.move.kind && r.move.itemKey) {
      const a = actor(req);
      await run(`INSERT INTO insight_outcomes (id, org_id, kind, item_key, donor_ids, state, until, reason, created_by, created_by_name) VALUES (?,?,?,?,?,'done',NULL,NULL,?,?)`,
        [newId("io"), req.user.orgId, String(r.move.kind).slice(0, 40), String(r.move.itemKey).slice(0, 300), r.move.ids || [r.donor_id], a.id, a.name]);
    }
    const ctx = await context(req);
    res.json(await view(req, ctx, await stored(req.user.orgId, req.user.userId, ctx.weekOf)));
  }));

  app.post("/home/five/:id/called", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const r = await rowOf(req);
    if (!r) return res.status(404).json({ error: "not_found", sentence: "That person is not in your five this week." });
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body && req.body.due || "")) ? req.body.due : null;
    await run(`UPDATE home_week_five SET called_on=COALESCE(?::date, CURRENT_DATE) WHERE id=? AND org_id=?`, [day, r.id, req.user.orgId]);
    res.json({ ok: true });
  }));
}

module.exports = { mount, rankMoves, weekStartOf, doneBy, SENTENCE, PLANNED_SENTENCE, FIVE };
