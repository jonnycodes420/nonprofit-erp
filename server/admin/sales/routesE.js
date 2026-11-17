// server/admin/sales/routesE.js · SALES-4 Part A. NOW, ONE-CLICK NEXT STEPS, UNDO.
// Mounted by routes.js behind the same door (super-admins only; 404 to anyone else).
//
//   GET  /ops/sales/now                         the ranked list, this week's scoreboard bar, moves to undo
//   POST /ops/sales/deals/:id/next-step         { body, due_on } accept a proposed next step (one click)
//   POST /ops/sales/auto-moves/:id/undo         put a deal back where a calendar meeting moved it from
//   GET  /ops/sales/deals/:id/header            the deal page's header: stage, value, next step, last touch
// Nothing here sends.
"use strict";
const LISTS = require("./lists");
const PIPES = require("./pipelines");
const TODAY = require("./today");
const NOW = require("./now");
const T = require("./touch");
const CAL = require("./calendar");
const SB = require("./scoreboard");
const CM = require("./callMode");

// Today's lines, exactly as /ops/sales/home reads them (one reader for both).
async function todayFor(query, deals, now, tz) {
  const pipelines = await PIPES.readAll(query);
  const input = await TODAY.loadToday(query, deals, PIPES.stageIndex(pipelines), now);
  const MAIL = require("./email");
  input.noReply = await MAIL.replyFacts(query, now, await MAIL.noReplyDays(query));
  const today = TODAY.buildToday(input, now, tz);
  const QUOTES = require("./quotes");
  const ql = QUOTES.todayLines(await QUOTES.todayFacts(query), now, tz);
  Object.assign(today.lines, { billingStarts: ql.billingStarts, quoteUnsigned: ql.quoteUnsigned });
  Object.assign(today.sentences, ql.sentences);
  return { today, noReply: input.noReply };
}

async function nowFor(query, now = Date.now(), tz = "America/New_York") {
  const deals = await LISTS.rowsFor(query, "deal");
  const [{ today, noReply }, touches, people, rules, lists, moved, facts] = await Promise.all([
    todayFor(query, deals, now, tz), T.lastTouches(query, now), NOW.peopleOf(query, deals), CM.rules(query),
    require("./prospectLists").all(query), CAL.recentMoves(query, null, now), SB.load(query, now)]);
  const out = NOW.buildNow({ today, deals, touches, people, noReply, rules, addBusinessDays: CM.addBusinessDays, lists,
    moved: moved.map(m => ({ id: m.id, dealId: m.deal_id, deal: m.deal_name, from: m.from_name, to: m.to_name, why: m.why, at: new Date(m.created_at).toISOString() })) }, now, tz);
  const sb = SB.build(facts, now, tz, facts.goals);
  const w = sb.weeks[0];
  out.week = { week: w.week, to: w.to, goals: sb.goals,
    numbers: { dials: w.dials.n, connects: w.connects.n, meetingsBooked: w.meetingsBooked.n },
    sentences: { dials: SB.SENTENCES.dials, connects: SB.SENTENCES.connects, meetingsBooked: SB.SENTENCES.meetingsBooked } };
  return out;
}

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send }) {
  const ctx = { query, run };
  // Each route names its gates on its own line, so the route inventory (tenant-matrix) can read them.

  app.get("/ops/sales/now", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, ...(await nowFor(query, Date.now())) })));

  app.post("/ops/sales/deals/:id/next-step", salesLimiter, door, wrap(async (req, res) => send(res, await NOW.acceptNext(ctx, req.params.id, req.body || {}, whoOf(req)))));

  app.post("/ops/sales/auto-moves/:id/undo", salesLimiter, door, wrap(async (req, res) => send(res, await CAL.undo(ctx, req.params.id, whoOf(req)))));

  app.get("/ops/sales/deals/:id/header", salesLimiter, door, wrap(async (req, res) => {
    const now = Date.now();
    const deals = await LISTS.rowsFor(query, "deal");
    const d = deals.find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: "not_found" });
    const [touches, people, rules, moved] = await Promise.all([T.lastTouches(query, now), NOW.peopleOf(query, [d]), CM.rules(query), CAL.recentMoves(query, d.id, now)]);
    const ps = people.get(d.id) || [];
    const touch = T.dealTouch(touches, d, ps.map(c => c.id));
    const lead = ps.find(c => c.role === "ED") || ps.find(c => c.role === "Development Director") || ps[0] || null;
    const today = TODAY.civil(now, "America/New_York");
    const bare = d.stage_kind === "open" && !String(d.next_step || "").trim() && !d.has_open_task;
    res.json({ ok: true, header: {
      stage: d.stage_name, stageKind: d.stage_kind, probability: d.probability, valueCents: d.value_cents, org: d.primary_org_name, orgId: d.org_id,
      nextStep: d.next_step || null, nextStepOn: d.next_step_on || null, hasOpenTask: d.has_open_task, nextUp: d.next_up || null, nextUpOn: d.next_up_on || null,
      lastTouch: touch ? { ...touch, reason: T.reasonOf(touch, now), days: T.daysSince(touch.at, now) } : null,
      propose: bare ? NOW.propose(touch, lead ? lead.name.split(" ")[0] : d.primary_org_name, today, rules, CM.addBusinessDays) : null,
      moved: moved.map(m => ({ id: m.id, from: m.from_name, to: m.to_name, why: m.why, at: new Date(m.created_at).toISOString() })),
      sentences: { lastTouch: NOW.SENTENCES.touch } } });
  }));
}

module.exports = { mount, nowFor, todayFor };
