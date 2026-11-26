// server/admin/sales/routesE.js · SALES-4 Part A. NOW, ONE-CLICK NEXT STEPS, UNDO.
// Mounted by routes.js behind the same door (super-admins only; 404 to anyone else).
//
//   GET  /ops/sales/now                         the ranked list, this week's scoreboard bar, moves to undo
//   POST /ops/sales/deals/:id/next-step         { body, due_on } accept a proposed next step (one click)
//   POST /ops/sales/auto-moves/:id/undo         put a deal back where a calendar meeting moved it from
//   GET  /ops/sales/deals/:id/header            the deal page's header: stage, value, next step, last touch
//   POST /ops/sales/deals/:id/use-quote-price   SALES-6: the open quote's price becomes the deal's value (Undo is the value PATCH)
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
// SALES-6 item 4: with no sales mailbox connected, email can't be a touch, and the screens say so.
const NO_MAILBOX = "Your mailbox isn't connected, so emails don't count as touches. Connect it in Sales settings.";
const mailboxConnected = async query => (await require("./email").mailboxes(query)).length > 0;

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
  out.mailbox = { connected: await mailboxConnected(query), says: NO_MAILBOX, settings: "/ops?tab=sales&panel=settings" };
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

  // SALES-6 item 3: one click puts the open quote's price on the deal (actor-stamped by REC.update; the
  // audit row is the middleware's). Undo is the value PATCH with the old value, which the answer carries.
  app.post("/ops/sales/deals/:id/use-quote-price", salesLimiter, door, wrap(async (req, res) => {
    const p = (await require("./customerPrice").forDealIds(query, [req.params.id])).get(req.params.id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (!p.openQuote) return res.status(400).json({ error: "invalid", message: "There is no open quote with a different price on this deal." });
    const was = p.prices.deal;
    const r = await require("./records").update(ctx, "deal", req.params.id, { value_cents: p.openQuote.cents }, whoOf(req), { force: true });
    if (!r.ok) return send(res, r);
    const { usd } = require("../../../shared/numbers/orderFigures");
    if (req.audit) req.audit.label(`sales deal: value set to the quote's ${usd(p.openQuote.cents)}/mo (was ${usd(was)}/mo)`);
    res.json({ ok: true, valueCents: p.openQuote.cents, undo: { value_cents: was, valueOnly: true },
      says: `The deal's value is now ${usd(p.openQuote.cents)}/mo, the quote's price (it was ${usd(was)}/mo).` });
  }));

  app.get("/ops/sales/deals/:id/header", salesLimiter, door, wrap(async (req, res) => {
    const now = Date.now();
    const deals = await LISTS.rowsFor(query, "deal");
    const d = deals.find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: "not_found" });
    const [touches, people, rules, moved, connected] = await Promise.all([T.lastTouches(query, now), NOW.peopleOf(query, [d]), CM.rules(query), CAL.recentMoves(query, d.id, now), mailboxConnected(query)]);
    const ps = people.get(d.id) || [];
    // SALES-6 item 1: the deal's one action, when its newest quote is not signed yet.
    const newest = (await require("./quotes").forDeal(query, d.id)).find(x => x.status !== "superseded") || null;
    const can = newest && !["accepted", "ordered"].includes(newest.status) ? await require("./sendToSign").canOrder(query, newest) : null;
    const touch = T.dealTouch(touches, d, ps.map(c => c.id));
    const lead = ps.find(c => c.role === "ED") || ps.find(c => c.role === "Development Director") || ps[0] || null;
    const today = TODAY.civil(now, "America/New_York");
    const bare = d.stage_kind === "open" && !String(d.next_step || "").trim() && !d.has_open_task;
    res.json({ ok: true, header: {
      stage: d.stage_name, stageKind: d.stage_kind, probability: d.probability, org: d.primary_org_name, orgId: d.org_id,
      // SALES-5: the customer's one price (customerPrice.js, on the row the board reads too), its ARR and its sentence.
      valueCents: d.price_cents, arrCents: d.arr_cents, priceSays: d.price_says, priceSource: d.price_source, billing: d.price_billing,
      dealValueCents: d.value_cents, dealDiffers: d.price_deal_differs,
      // SALES-6 item 3: what the tile leads with, the open quote beside it, and when a price was signed.
      priceTile: d.price_tile || null, openQuote: d.price_open_quote || null,
      mailbox: { connected, says: NO_MAILBOX, settings: "/ops?tab=sales&panel=settings" },
      sendToSign: can ? { ready: can.ok, says: can.ok ? can.says : can.message, version: newest.version, sent: !!newest.start_link_id } : null,
      nextStep: d.next_step || null, nextStepOn: d.next_step_on || null, hasOpenTask: d.has_open_task, nextUp: d.next_up || null, nextUpOn: d.next_up_on || null,
      lastTouch: touch ? { ...touch, reason: T.reasonOf(touch, now), days: T.daysSince(touch.at, now) } : null,
      propose: bare ? NOW.propose(touch, lead ? lead.name.split(" ")[0] : d.primary_org_name, today, rules, CM.addBusinessDays) : null,
      moved: moved.map(m => ({ id: m.id, from: m.from_name, to: m.to_name, why: m.why, at: new Date(m.created_at).toISOString() })),
      sentences: { lastTouch: connected ? NOW.SENTENCES.touch : NO_MAILBOX, price: require("./customerPrice").SENTENCE } } });
  }));
}

module.exports = { mount, nowFor, todayFor };
