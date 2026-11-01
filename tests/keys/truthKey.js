// tests/keys/truthKey.js: TRUTH-1. THE ANSWER KEY, FROM THE ROWS, NOT THE APP.
//
// One pure function, computeKey(rows, { today, fiscalStartMonth }), that reads
// plain rows (people, gifts, soft-credit pointers, pledges, attendance) and
// says what every number should be. It imports NOTHING from the app: not
// orgTime, not lapseRule, not creditTypes, not figureSources. Every definition
// is written out below from the words of the TRUTH-1 brief (until ARCH-1's
// docs/architecture/ARCHITECTURE.md lands, those words are the definitions).
// If the app and this file disagree, one of them is wrong, and a person reads
// both to find out which. The app is never the reason this file changes.
//
// THE DEFINITIONS
//   money        hard credit only. A gift row typed as a soft or matching
//                credit is recognition, never money; a soft-credit pointer
//                (gift_soft_credits) is recognition, never money. A matching
//                gift is money on the company's record; the employee's credit
//                is recognition. Refunds (negative rows) come off a total.
//   live person  not deleted and not a sample row. A deleted person's gifts
//                count toward nothing.
//   gave         a hard-credit gift above zero, dated on or before today, or
//                an imported last gift (the old system's history is giving).
//   this year    the org's fiscal year, from its start month, labelled with
//                dates, from its first day to today.
//   lapsed       gave before, nothing in the last 12 months (the last gift on
//                or before today less 365 days), and not held by a pledge.
//   lapsing      last gift 9 to 12 months ago (after today less 365 days, on
//                or before today less 9 months), and not held by a pledge.
//   held         FIX-60: an open pledge (on schedule, or overdue, which is its
//                own state and not lapsed), or a pledge fulfilled that was
//                made in the last 12 months.
//   first-time   in a fiscal year: their first-ever gift falls in it.
//   retained     in a fiscal year: they gave in it and in the one before.
//   households   people who share a household count once in a household
//                count, and each person counts in a people count. A unit is
//                a household, or a person in none.
//   events       per event: parties (rows on the list) and people (each
//                person once), came, gave, came and gave, came and didn't.
//   deposited    a banked gift (check, cash, bank transfer, ACH) is deposited
//                when a deposit run holds it or a day it reached the bank is
//                recorded (deposited_on: a payout, or FIX-59's "already
//                deposited"). Undeposited is the rest, in the last 90 days.
"use strict";

// ── dates, by hand (civil YYYY-MM-DD; never an instant) ──────────────────
const p2 = n => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const day = s => { const c = parse(s); return c ? ymd(c.y, c.m, c.d) : null; };
function addDays(s, n) {
  const c = parse(s);
  const t = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
// n months back, the day clamped to the month's end (Mar 31 less 1 month is Feb 28)
function monthsBack(s, n) {
  const c = parse(s);
  let y = c.y, m = c.m - n;
  while (m < 1) { m += 12; y -= 1; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, Math.min(c.d, last));
}
function fiscalYear(today, startMonth, offset = 0) {
  const c = parse(today);
  const y = (c.m >= startMonth ? c.y : c.y - 1) + offset;
  return { from: ymd(y, startMonth, 1), to: addDays(ymd(y + 1, startMonth, 1), -1), label: `FY${y}` };
}

// ── what a row is ────────────────────────────────────────────────────────
// A credit row is recognition. Written out here, never read from the app.
const CREDIT_WORDS = /^(soft[\s_-]?credit|match(?:ing|ed)?\s+gift\s+credit)$/;
const isCreditType = t => CREDIT_WORDS.test(String(t || "").trim().toLowerCase());
const BANKED = new Set(["check", "cheque", "cash", "bank transfer", "ach"]);
const cents = v => Math.round(Number(v || 0) * 100);
const sortIds = a => [...a].sort();

function computeKey(rows, opts = {}) {
  const today = day(opts.today);
  if (!today) throw new Error("computeKey: opts.today (YYYY-MM-DD) is required");
  const sm = Number(opts.fiscalStartMonth) || 7;
  const fy = fiscalYear(today, sm), lastFy = fiscalYear(today, sm, -1);
  const lapsedOnOrBefore = addDays(today, -365);
  const lapsingTo = monthsBack(today, 9);
  const ninetyAgo = addDays(today, -90);

  const people = (rows.people || []).filter(p => !p.deleted && !p.sample);
  const live = new Map(people.map(p => [p.id, p]));
  // A gift counts when its person is live; a gift on nobody is in no screen's total.
  const gifts = (rows.gifts || []).filter(g => live.has(g.person) && !g.sample)
    .map(g => ({ ...g, c: g.cents != null ? Number(g.cents) : cents(g.amount), d: day(g.date), credit: isCreditType(g.type) }));
  const hard = gifts.filter(g => !g.credit);
  const credits = gifts.filter(g => g.credit);
  const pointers = (rows.softCredits || []).filter(s => live.has(s.person));
  const sumC = a => a.reduce((n, g) => n + g.c, 0);

  // ── people and households ──
  const unitOf = id => { const p = live.get(id); return p && p.household ? `h:${p.household}` : `p:${id}`; };
  const households = new Set(people.filter(p => p.household).map(p => p.household));

  // ── money ──
  const fyGifts = hard.filter(g => g.d && g.d >= fy.from && g.d <= today);
  const byFy = {};
  for (const g of hard) if (g.d) { const k = fiscalYear(g.d, sm).label; byFy[k] = (byFy[k] || 0) + g.c; }

  // ── gave: each person's dates of giving (hard, above zero, on or before today) ──
  const given = new Map();   // id -> sorted dates
  for (const g of hard) if (g.c > 0 && g.d && g.d <= today) (given.get(g.person) || given.set(g.person, []).get(g.person)).push(g.d);
  for (const p of people) {
    for (const k of ["importedLastGift", "importedFirstGift"]) {
      const d = day(p[k]);
      if (d && d <= today) (given.get(p.id) || given.set(p.id, []).get(p.id)).push(d);
    }
  }
  for (const a of given.values()) a.sort();

  // ── held by a pledge (FIX-60) ──
  const held = new Set(), overdue = new Set();
  for (const pl of rows.pledges || []) {
    if (!live.has(pl.person)) continue;
    const inst = pl.installments || [];
    if (pl.status === "open") {
      held.add(pl.person);
      const late = inst.length ? inst.some(i => !i.paid && day(i.due) && day(i.due) < today) : !!(day(pl.due) && day(pl.due) < today);
      if (late) overdue.add(pl.person);
    } else if (pl.status === "fulfilled") {
      const made = [day(pl.made), day(pl.due), ...inst.map(i => day(i.due))].filter(Boolean).sort()[0];
      if (made && made > lapsedOnOrBefore) held.add(pl.person);
    }
  }

  const lapsed = [], lapsing = [];
  for (const [id, dates] of given) {
    const last = dates[dates.length - 1];
    if (held.has(id)) continue;
    if (last <= lapsedOnOrBefore) lapsed.push(id);
    else if (last <= lapsingTo) lapsing.push(id);
  }

  // ── first-time and retained, per fiscal year ──
  const gaveIn = (id, span) => (given.get(id) || []).some(d => d >= span.from && d <= span.to);
  const firstIn = span => sortIds([...given].filter(([, ds]) => ds[0] >= span.from && ds[0] <= span.to).map(([id]) => id));
  const retainedIn = (span, prior) => sortIds([...given.keys()].filter(id => gaveIn(id, span) && gaveIn(id, prior)));

  // ── deposits ──
  const banked = hard.filter(g => BANKED.has(String(g.method || "").trim().toLowerCase()));
  const isDeposited = g => !!(g.depositRun || String(g.depositedOn || "").trim());
  const dep = banked.filter(isDeposited);
  const undep = banked.filter(g => !isDeposited(g) && g.d && g.d >= ninetyAgo && g.d <= today);

  // ── events ──
  const events = {};
  const CAME = a => a.status === "attended" || (a.checkedIn && !["cancelled", "canceled", "declined"].includes(a.status || "invited"));
  const att = (rows.attendance || []).filter(a => !a.person || live.has(a.person));
  // Gave at an event: a hard gift above zero, or a pledge not cancelled, made
  // there, by the person or anyone in their household (a couple's row is one
  // party: one gave, the row gave).
  const gaveAt = {};
  const mark = (ev, person) => { if (ev && live.has(person)) (gaveAt[ev] || (gaveAt[ev] = new Set())).add(unitOf(person)); };
  for (const g of hard) if (g.c > 0) mark(g.event, g.person);
  for (const pl of rows.pledges || []) if (!["cancelled", "canceled"].includes(pl.status)) mark(pl.event, pl.person);
  for (const a of att) {
    const e = events[a.event] || (events[a.event] = { parties: new Set(), people: new Set(), cameParties: new Set(), came: new Set() });
    const who = a.person || `row:${a.id}`;
    const party = a.party || (a.person ? unitOf(a.person) : who);
    e.parties.add(party); e.people.add(who);
    if (CAME(a)) { e.came.add(who); e.cameParties.add(party); }
  }
  const eventKey = {};
  for (const [id, e] of Object.entries(events)) {
    const g = gaveAt[id] || new Set();
    const personGave = p => g.has(p.startsWith("row:") ? p : unitOf(p));
    const cameP = [...e.came], cameR = [...e.cameParties];
    eventKey[id] = {
      parties: e.parties.size, people: e.people.size,
      came: { parties: cameR.length, people: cameP.length },
      gave: { parties: g.size },
      cameGave: { parties: cameR.filter(u => g.has(u)).length, people: cameP.filter(personGave).length },
      cameNoGift: { parties: cameR.filter(u => !g.has(u)).length, people: cameP.filter(p => !personGave(p)).length },
    };
  }

  return {
    asOf: today,
    fiscalYear: { from: fy.from, to: fy.to, label: `${fy.label} (${fy.from} to ${fy.to})` },
    people: people.length,
    households: households.size,
    peopleInHouseholds: people.filter(p => p.household).length,
    importedIds: sortIds(people.filter(p => p.imported).map(p => p.id)),
    units: new Set(people.map(p => unitOf(p.id))).size,
    gifts: { count: hard.length, cents: sumC(hard), undated: hard.filter(g => !g.d).length },
    creditIds: sortIds(credits.map(g => g.id)),
    credits: { rows: credits.length, cents: sumC(credits), pointerCents: pointers.reduce((n, s) => n + (s.cents != null ? Number(s.cents) : cents(s.amount)), 0) },
    thisFiscalYear: { from: fy.from, to: today, cents: sumC(fyGifts), count: fyGifts.length },
    byFiscalYear: byFy,
    lifetimeById: Object.fromEntries([...live.keys()].map(id => [id, sumC(hard.filter(g => g.person === id))])),
    lapsed: sortIds(lapsed),
    lapsing: sortIds(lapsing),
    pledgeOverdue: sortIds(overdue),
    firstTime: { [fy.label]: firstIn(fy), [lastFy.label]: firstIn(lastFy) },
    retained: { [fy.label]: retainedIn(fy, lastFy) },
    deposits: { deposited: { count: dep.length, cents: sumC(dep) }, undeposited: { count: undep.length, cents: sumC(undep), from: ninetyAgo, to: today },
      depositedIds: sortIds(gifts.filter(isDeposited).map(g => g.id)) },
    events: eventKey,
    unitOf,
    // hard money dated from..to (both inclusive)
    between: (from, to) => { const a = hard.filter(g => g.d && g.d >= from && g.d <= to); return { cents: sumC(a), count: a.length }; },
    // credit rows dated from..to (recognition: in no money total)
    creditsBetween: (from, to) => { const a = credits.filter(g => g.d && g.d >= from && g.d <= to); return { cents: sumC(a), count: a.length }; },
    // every gift row dated from..to, whatever its type or sign: what a screen
    // shows if it sums rows without asking what they are (the known defects)
    rowsBetween: (from, to) => {
      const a = gifts.filter(g => g.d && g.d >= from && g.d <= to);
      const ids = new Set(a.map(g => g.person));
      return { cents: sumC(a), count: a.length, people: ids.size, units: new Set([...ids].map(unitOf)).size };
    },
    // hard money on the rows a test names (a campaign's, a giving page's)
    sumHard: pred => sumC(hard.filter(pred)),
    depositRefOf: id => { const g = gifts.find(x => x.id === id); return g ? String(g.depositRef || "").trim() : null; },
    // who gave (hard, above zero) from..to: people, and units (a household once)
    giversBetween: (from, to) => {
      const ids = new Set(hard.filter(g => g.c > 0 && g.d && g.d >= from && g.d <= to).map(g => g.person));
      return { people: ids.size, units: new Set([...ids].map(unitOf)).size };
    },
  };
}

// The key as JSON (no functions), for a committed file.
const toJson = k => { const { unitOf, between, giversBetween, creditsBetween, rowsBetween, depositRefOf, sumHard, ...rest } = k; return rest; };

module.exports = { computeKey, toJson, isCreditType, fiscalYear, addDays, monthsBack };
