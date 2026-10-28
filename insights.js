// insights.js · INSIGHTS-1. WHO TO CALL, WHY, AND EXACTLY WHAT TO SAY.
//
// PURE MODULE: every input, `asOf` included, is a parameter. No clock, no
// query. insightsData.js reads the org's rows and calls computeInsights; the
// tests call it with the same rows and asOf = 2026-10-27.
//
// Three layers, each computed from the one before:
//   1. SIGNALS   read off what is already there: a gift's memo, category and
//                method (honor, memorial, program, sponsor level, a relation,
//                a gift type, "this row looks like a purchase"), and each
//                giver's rhythm.
//   2. THE LADDER every giving unit (a household, or a person on their own)
//                sits on one rung: new, second gift, retain, upgrade, major;
//                with a status (steady, slipping, moving up) and a planned flag
//                beside it.
//   3. CARDS     the insight library. Each card is What (the facts and the
//                people), Why (one sentence, the org's own numbers when it
//                can), How (who, when, channel, what to say, the ask and its
//                rule) and what Steward can do, each needing her click.
//
// The words on a card are written HERE from the facts (the template). Atlas
// may rewrite a sentence, and numbersOk() refuses any rewrite that carries a
// number the facts do not.
//
// Money is in cents everywhere inside. A gift with no date counts toward
// lifetime and gift counts, never toward a time window, and a giver whose
// gifts include an undated one is never called slipping on time.
"use strict";
const CT = require("./creditTypes");

const RUNGS = ["new", "second", "retain", "upgrade", "major"];
const RUNG_LABEL = { new: "New", second: "Second gift", retain: "Retain", upgrade: "Upgrade", major: "Major", planned: "Planned" };
const RUNG_SENTENCE = {
  new: "No gift yet.",
  second: "One gift so far. The next step is a second gift.",
  retain: "Two or more gifts: the regular base to keep.",
  upgrade: "A regular donor whose giving grew: last 12 months at least 1.5 times the 12 before, a move into a family foundation, or a gift designated to a program.",
  major: "Last 12 months, or any single gift, at or above your major-gift line.",
  planned: "Signs of legacy capacity: a gift of stock, an IRA or investment distribution, a donor-advised fund or family foundation gift, a memorial or honor gift, or 5 or more years in a row of giving.",
};
const STATUS_LABEL = { steady: "Steady", slipping: "Slipping", up: "Moving up" };
// Cards rank by rung first, in this order, then by dollars at stake.
const RANK_ORDER = ["retain", "second", "upgrade", "major", "planned"];
const MAJOR_DEFAULT_CAP = 500000;   // $5,000
const SECOND_BEST_DAYS = 90, SECOND_MAX_DAYS = 365;
const OUTCOME_DAYS = 60;

// ── dates (civil YYYY-MM-DD strings) ───────────────────────────────────────
// a stored day is its own day: a Date from the driver goes through the civil helper
const ymd = d => (d ? String(d instanceof Date ? require("./orgTime").civilOf(d) : d).slice(0, 10) : null);
const dayNum = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const fromDay = n => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (s, k) => fromDay(dayNum(s) + k);
const daysBetween = (a, b) => dayNum(b) - dayNum(a);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map(m => m.slice(0, 3));
const longDate = s => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}`;
const monthYear = s => `${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;

// ── money ──────────────────────────────────────────────────────────────────
const money = c => {
  const neg = c < 0, v = Math.abs(c);
  const s = v % 100 ? (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : (v / 100).toLocaleString("en-US");
  return (neg ? "-$" : "$") + s;
};
// A natural ask: $7,500 not $7,512. Rounded to a quarter of its leading power
// of ten ($7,512 → $7,500, $37,512 → $37,500, $1,000.03 → $1,000).
function naturalCents(c) {
  if (c <= 0) return 0;
  const d = c / 100;
  const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(d))) / 4);
  return Math.round(d / step) * step * 100;
}
const wholeDollars = c => Math.round(c / 100) * 100;
const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : (many || one + "s")}`;

// ── 1. SIGNALS FROM A GIFT'S OWN WORDS ─────────────────────────────────────
const RELATION = "Mother|Father|Mom|Dad|Sister|Brother|Daughter|Son|Wife|Husband|Friend|Grandmother|Grandfather|Grandson|Granddaughter|Aunt|Uncle|Cousin|Niece|Nephew|Partner|Neighbor|Neighbour";
const SPONSOR_LEVELS = ["table", "logo", "bronze", "silver", "gold", "platinum"];   // low to high
const SPONSOR_WORD = /\b(platinum|gold|silver|bronze|logo|table)\b/i;
const EVENTY = /\b(sponsor|sponsorship|ball|gala|dinner|classic|tournament|luncheon|breakfast|auction|benefit|5k|golf)\b/i;
const GIFT_TYPES = [
  ["stock", "Stock", /\bstock( transfer)?\b|\bshares\b|\bsecurities\b/i],
  ["ira", "Retirement account (IRA) distribution", /retirement dist|\bira\b|\bqcd\b|required minimum/i],
  ["investment", "Investment distribution", /investment (dist|pledge)|\binvestment\b/i],
  ["daf", "Donor-advised fund", /\bdaf\b|donor[- ]advised/i],
  ["foundation", "Family foundation", /\bfoundation\b/i],
];
const GIFT_TYPE_LABEL = Object.fromEntries(GIFT_TYPES.map(([k, l]) => [k, l]));

function giftTypeOf(text) {
  const t = String(text || "");
  for (const [k, , re] of GIFT_TYPES) if (re.test(t)) return k;
  return null;
}

// Not-a-gift words. Each returns its reason; the first that fits wins.
const NOT_GIFT = [
  [/reimburse/i, "reimbursement", "The memo says it is a reimbursement"],
  [/\brefund/i, "refund", "The memo says it is a refund"],
  [/\bpurchase(d)? of\b|\bpurchased?\b/i, "purchase", "The memo says it is a purchase"],
  [/\btickets?\b|\braffle\b/i, "tickets", "The memo says it paid for tickets or a raffle"],
  [/\bauction\b/i, "auction", "The memo names an auction"],
  [/\b(basket|table|session|set)\b/i, "auction", "The memo names an item (basket, table, session or set)"],
];
function notAGift(text) {
  const t = String(text || "");
  for (const [re, kind, why] of NOT_GIFT) {
    if (!re.test(t)) continue;
    // "Table sponsor" is a sponsor level, not a table someone bought.
    if (kind === "auction" && /\btable\b/i.test(t) && /\bsponsor/i.test(t) && !/\bauction\b/i.test(t)) continue;
    return { kind, why };
  }
  return null;
}

// The words of one gift, read once.
function readGift(g, programs) {
  const text = [g.memo, g.notes, g.campaign].filter(Boolean).join(" · ");
  const memoText = [g.memo, g.notes].filter(Boolean).join(" · ");
  const out = { text };
  // honor and memorial, from the tribute columns first, then the words
  if (g.tribute_type && g.tribute_name) out.tribute = { kind: /memor/i.test(g.tribute_type) ? "memorial" : "honor", name: g.tribute_name };
  else {
    const m = memoText.match(/\bin (?:loving )?memory of ([A-Z][\w.'’-]*(?:\s+(?:&|and)?\s*[A-Z][\w.'’-]*){0,4})/i);
    const h = memoText.match(/\b(?:in hono(?:u)?r of|hono(?:u)?r(?:ing)?)\s+([A-Z][\w.'’-]*(?:\s+(?:&|and)?\s*[A-Z][\w.'’-]*){0,4})/i);
    if (m) out.tribute = { kind: "memorial", name: m[1].trim() };
    else if (h) out.tribute = { kind: "honor", name: h[1].trim() };
    else if (/\bin memory\b|\bmemorial\b/i.test(memoText)) out.tribute = { kind: "memorial", name: null };
  }
  // a sponsor level, only where the words are about an event or a sponsorship
  const lv = text.match(SPONSOR_WORD);
  if (lv && EVENTY.test(text) && !(lv[1].toLowerCase() === "table" && !/\bsponsor/i.test(text))) {
    out.sponsor = { level: lv[1].toLowerCase(), half: /\b1\/2\b|\bhalf\b/i.test(text) };
  }
  // a program designation: a program or fund the org has, named in the words
  for (const p of programs || []) {
    if (p && p.length >= 4 && new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(memoText)) { out.program = p; break; }
  }
  // a relation: "Ulwen Warbury's Mother", "Friend of Falric Warbury"
  const rel = memoText.match(new RegExp(`([A-Z][\\w'-]+(?:\\s+(?:&|and)\\s+[A-Z][\\w'-]+)?(?:\\s+[A-Z][\\w'-]+){1,2})['’]s\\s+(${RELATION})\\b`))
           || memoText.match(new RegExp(`\\b(${RELATION}) of ([A-Z][\\w'-]+(?:\\s+[A-Z][\\w'-]+){1,2})`));
  if (rel) out.relation = rel[0].includes(" of ") && !/['’]s\s/.test(rel[0]) ? { word: rel[1], of: rel[2] } : { word: rel[2], of: rel[1] };
  // gift type: the stored field, else the method and words
  out.giftType = g.gift_type || giftTypeOf([g.payment_method, memoText].filter(Boolean).join(" "));
  if (g.amount_cents > 0) out.notGift = notAGift(memoText);
  return out;
}

// A program the memos name: a two- or three-word Title Case phrase written as
// a designation. "Stable Moments Donation" names one for that giver; "for
// Stable Moments" must recur in two givers' memos. Never a name or an event.
function memoPrograms(gifts, people) {
  const nameWords = new Set();
  for (const p of people) for (const w of String(p.name || "").split(/[\s,.&]+/)) if (w.length > 2) nameWords.add(w.toLowerCase());
  const seen = new Map();   // "d|phrase" or "f|phrase" -> Set(donor)
  const PH = "([A-Z][a-z]+(?: [A-Z][a-z]+){1,2})";
  const res = [new RegExp(`${PH} (?:Donation|Program|Fund|Scholarship)\\b`, "g"), new RegExp(`\\b(?:for|to|designated(?: to| for)?) (?:the )?${PH}\\b`, "g")];
  for (const g of gifts) {
    const t = [g.memo, g.notes].filter(Boolean).join(" ").replace(/\. Category: .*$/, "");
    res.forEach((re, i) => {
      for (const m of t.matchAll(re)) {
        const ph = m[1];
        if (EVENTY.test(ph) || /\b(Donation|Deposit|Contribution|Family|Foundation|Memory|Memorial|Honor|The|Online|General|Annual|Year|End|Holiday|Christmas|Monthly|Matching|Corporate|Business|Individual)\b/.test(ph)) continue;
        if (ph.split(" ").every(w => nameWords.has(w.toLowerCase()))) continue;
        const k = `${i ? "f" : "d"}|${ph}`;
        (seen.get(k) || seen.set(k, new Set()).get(k)).add(g.donor_id);
      }
    });
  }
  return [...new Set([...seen].filter(([k, ds]) => ds.size >= (k[0] === "d" ? 1 : 2)).map(([k]) => k.slice(2)))];
}

// ── 2. RHYTHM ──────────────────────────────────────────────────────────────
// Usual months (a month given in two or more different years, or every gift
// in Nov/Dec), cadence (median days between giving days), and the expected
// next gift window.
function rhythmOf(dated, asOf) {
  const days = [...new Set(dated.map(g => g.date))].sort();
  if (!days.length) return { kind: "none", words: null, next: null };
  const byMonth = new Map();
  for (const d of days) {
    const m = +d.slice(5, 7);
    if (!byMonth.has(m)) byMonth.set(m, new Set());
    byMonth.get(m).add(d.slice(0, 4));
  }
  const usual = [...byMonth.entries()].filter(([, ys]) => ys.size >= 2).map(([m]) => m).sort((a, b) => a - b);
  const last = days[days.length - 1];
  let cadence = null;
  if (days.length >= 2) {
    const iv = [];
    for (let i = 1; i < days.length; i++) iv.push(daysBetween(days[i - 1], days[i]));
    iv.sort((a, b) => a - b);
    cadence = iv.length % 2 ? iv[(iv.length - 1) / 2] : Math.round((iv[iv.length / 2 - 1] + iv[iv.length / 2]) / 2);
  }
  const yearEnd = days.length >= 2 && days.every(d => +d.slice(5, 7) >= 11);
  let kind = "none", words = null, next = null;
  if (usual.length === 1 || (yearEnd && days.length >= 2)) {
    const m = usual.length === 1 ? usual[0] : +last.slice(5, 7);
    kind = m === 12 || m === 11 ? "year_end" : "yearly";
    words = `Gives in ${MONTHS[m - 1]}`;
    const y = +asOf.slice(0, 4);
    let start = `${y}-${String(m).padStart(2, "0")}-01`;
    // this year's window already passed, or a gift already landed in it
    if (start.slice(0, 7) < asOf.slice(0, 7) || last.slice(0, 7) === start.slice(0, 7)) start = `${y + 1}-${String(m).padStart(2, "0")}-01`;
    next = { from: start, to: addDays(start, 30 + 30) };
  } else if (cadence != null && cadence >= 70 && cadence < 135 && days.length >= 3) {
    kind = "quarterly"; words = "Gives about every three months";
  } else if (cadence != null && cadence < 45 && days.length >= 4) {
    kind = "monthly"; words = "Gives about every month";
  } else if (cadence != null && cadence >= 300 && cadence < 450) {
    kind = "yearly"; words = "Gives about once a year";
  } else if (cadence != null && cadence >= 600 && cadence < 850) {
    kind = "biennial"; words = "Gives about every other year";
  }
  if (!next && cadence != null && kind !== "none") {
    const at = addDays(last, cadence);
    next = { from: addDays(at, -Math.round(cadence * 0.15)), to: addDays(at, Math.max(30, Math.round(cadence * 0.25))) };
  }
  return { kind, words, next, cadence, usual, last };
}

// ── 3. UNITS AND THE LADDER ────────────────────────────────────────────────
// A unit is a household (named for the household) or a person on their own.
function buildUnits(people, households) {
  const hh = new Map((households || []).map(h => [h.id, h]));
  const units = new Map(), unitOf = new Map();
  for (const p of people) {
    const h = p.household_id && hh.get(p.household_id);
    const key = h ? "h:" + h.id : "p:" + p.id;
    if (!units.has(key)) units.set(key, { key, name: h ? h.name : p.name, people: [], householdId: h ? h.id : null });
    const u = units.get(key);
    u.people.push(p);
    unitOf.set(p.id, u);
  }
  // A unit is led by its first-listed member with gifts; the profile link opens them.
  return { units, unitOf };
}

function majorLine(unitTotals, setting) {
  if (setting && setting > 0) return { cents: setting, rule: `Your major-gift line: ${money(setting)} (set in Settings).` };
  const sorted = unitTotals.filter(c => c > 0).sort((a, b) => b - a);
  if (!sorted.length) return { cents: MAJOR_DEFAULT_CAP, rule: `Your major-gift line: ${money(MAJOR_DEFAULT_CAP)}.` };
  const k = Math.max(1, Math.ceil(sorted.length * 0.05));
  const top5 = sorted[k - 1];
  const cents = Math.min(MAJOR_DEFAULT_CAP, top5);
  const rule = cents === MAJOR_DEFAULT_CAP
    ? `Your major-gift line: ${money(cents)} (the smaller of $5,000 and the ${money(top5)} your top 5% of donors reach).`
    : `Your major-gift line: ${money(cents)} (what your top 5% of donors reach, below $5,000).`;
  return { cents, rule };
}

// ── THE ENTRY POINT ────────────────────────────────────────────────────────
// input: { asOf, org: { name, majorLineCents }, people, households, gifts,
//          pledges, programs, reviewed: { giftId: "keep" }, linksDismissed:
//          Set(networkKey), outcomes: [{ card_key, state, until }],
//          imports: { id: name } }
function computeInsights(input) {
  const asOf = ymd(input.asOf);
  if (!asOf) throw new Error("computeInsights needs asOf");
  const thisYear = +asOf.slice(0, 4);
  const people = (input.people || []).filter(p => !p.deleted_at && !p.is_sample);
  const { units, unitOf } = buildUnits(people, input.households);
  const programs = [...(input.programs || []), ...memoPrograms(input.gifts || [], people)];
  const reviewed = input.reviewed || {};
  const importName = input.imports || {};

  // gifts, read once
  const gifts = [];
  for (const g of input.gifts || []) {
    const u = unitOf.get(g.donor_id);
    if (!u) continue;
    // a soft or matching credit is nobody's giving (creditTypes.js)
    if (CT.isCredit(g.type)) continue;
    const cents = g.amount_cents != null ? g.amount_cents : Math.round(Number(g.amount || 0) * 100);
    const row = { ...g, amount_cents: cents, date: ymd(g.date), unit: u };
    row.sig = readGift(row, programs);
    gifts.push(row);
  }
  const pledges = [];
  for (const p of input.pledges || []) {
    const u = unitOf.get(p.donor_id);
    if (!u) continue;
    const cents = Math.round(Number(p.amount || 0) * 100);
    const paid = Math.round(Number(p.paid || 0) * 100);
    pledges.push({ ...p, cents, paid, balance: Math.max(0, cents - paid), unit: u,
      giftType: p.gift_type || giftTypeOf(String(p.notes || "").match(/Method in your file: ([^.]+)/)?.[1] || p.notes || ""),
      installments: (p.installments || []).map(i => ({ ...i, due_date: ymd(i.due_date), cents: Math.round(Number(i.amount || 0) * 100) })) });
  }

  // coverage: what the data covers
  const datedAll = gifts.filter(g => g.date && g.amount_cents > 0).map(g => g.date).sort();
  const lastDated = datedAll[datedAll.length - 1] || null, firstDated = datedAll[0] || null;
  const undatedCount = gifts.filter(g => !g.date && g.amount_cents > 0).length;
  const gapDays = lastDated ? daysBetween(lastDated, asOf) : null;
  const dataEnd = lastDated && gapDays > 30 ? lastDated : asOf;
  const coverage = {
    firstDated, lastDated, undatedCount, gapDays, end: dataEnd, stale: gapDays != null && gapDays > 30,
    sentence: !lastDated ? "No dated gifts yet, so nothing here depends on time."
      : (gapDays > 30 ? `Gift history ends ${longDate(lastDated)}, ${plural(gapDays, "day")} before today. Anything after that isn't in Steward yet.`
                      : `Gift history ends ${longDate(lastDated)} (it starts ${longDate(firstDated)}).`)
      + (undatedCount ? ` ${plural(undatedCount, "gift")} ${undatedCount === 1 ? "has" : "have"} no date.` : ""),
  };
  // time windows run to the end of the data when the data stops early
  const L12from = addDays(dataEnd, -364), P12from = addDays(dataEnd, -729), P12to = addDays(dataEnd, -365);

  // per unit giving
  const U = [];
  const giftsOfUnit = new Map(), pledgesOfUnit = new Map();
  for (const g of gifts) (giftsOfUnit.get(g.unit) || giftsOfUnit.set(g.unit, []).get(g.unit)).push(g);
  for (const p of pledges) (pledgesOfUnit.get(p.unit) || pledgesOfUnit.set(p.unit, []).get(p.unit)).push(p);
  for (const u of units.values()) {
    const gs = (giftsOfUnit.get(u) || []).filter(g => g.amount_cents > 0 && reviewed[g.id] !== "not_gift");
    const dated = gs.filter(g => g.date).sort((a, b) => (a.date < b.date ? -1 : 1));
    const sum = arr => arr.reduce((n, g) => n + g.amount_cents, 0);
    const inSpan = (a, b) => dated.filter(g => g.date >= a && g.date <= b);
    const byYear = {};
    for (const g of dated) byYear[g.date.slice(0, 4)] = (byYear[g.date.slice(0, 4)] || 0) + g.amount_cents;
    const ps = pledgesOfUnit.get(u) || [];
    const openPledges = ps.filter(p => p.status !== "fulfilled" && p.status !== "cancelled" && p.status !== "written_off" && p.balance > 0);
    const x = {
      unit: u, key: u.key, name: u.name, ids: u.people.map(p => p.id),
      lead: (u.people.find(p => gs.some(g => g.donor_id === p.id)) || u.people[0]).id,
      owner: u.people.map(p => p.assigned_to_name).find(Boolean) || null,
      noContact: u.people.every(p => p.deceased || p.do_not_contact),
      noAsk: u.people.some(p => p.do_not_solicit),
      kind: u.people.length === 1 ? u.people[0].kind : "household",
      gifts: gs, dated, undated: gs.filter(g => !g.date), count: gs.length,
      lifetime: sum(gs), largest: gs.reduce((m, g) => Math.max(m, g.amount_cents), 0),
      L12: sum(inSpan(L12from, dataEnd)), P12: sum(inSpan(P12from, P12to)),
      byYear, first: dated[0] || null, last: dated[dated.length - 1] || null,
      pledges: ps, openPledges,
      rhythm: rhythmOf(dated, asOf),
    };
    U.push(x);
  }
  const line = majorLine(U.map(x => x.lifetime), input.org && input.org.majorLineCents);

  // the ladder
  for (const x of U) {
    const sig = { tributes: [], programs: new Set(), sponsor: [], types: new Set(), relations: [] };
    for (const g of x.gifts) {
      if (g.sig.tribute) sig.tributes.push({ ...g.sig.tribute, date: g.date, cents: g.amount_cents });
      if (g.sig.program) sig.programs.add(g.sig.program);
      if (g.sig.sponsor && g.date) sig.sponsor.push({ ...g.sig.sponsor, date: g.date, cents: g.amount_cents, year: +g.date.slice(0, 4), id: g.id });
      if (g.sig.giftType) sig.types.add(g.sig.giftType);
      if (g.sig.relation) sig.relations.push(g.sig.relation);
    }
    for (const p of x.pledges) if (p.giftType) sig.types.add(p.giftType);
    // an organisation called "… Foundation" gives foundation money
    if (x.unit.people.length === 1 && /\bfoundation\b/i.test(x.name)) sig.types.add("foundation");
    x.sig = sig;
    const years = [...new Set(x.dated.map(g => +g.date.slice(0, 4)))].sort();
    let run = 0, best = 0;
    for (let i = 0; i < years.length; i++) { run = i && years[i] === years[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
    x.yearsInRow = best;
    // moved into a family foundation: the latest 12 months came through one, the ones before did not
    const recentFdn = x.dated.filter(g => g.date >= L12from && /\bfoundation\b/i.test(g.sig.text));
    const earlierFdn = x.dated.filter(g => g.date < L12from && /\bfoundation\b/i.test(g.sig.text));
    x.movedToFoundation = recentFdn.length > 0 && earlierFdn.length === 0 && x.dated.some(g => g.date < L12from) && !/\bfoundation\b/i.test(x.name);
    x.designated = x.dated.filter(g => g.date >= L12from && g.sig.program).map(g => g.sig.program);
    x.grew = x.P12 > 0 && x.L12 >= Math.round(x.P12 * 1.5);
    x.shrank = x.P12 > 0 && x.L12 < Math.round(x.P12 * 0.5);

    if (!x.count && !x.openPledges.length) x.rung = "new";
    else if (x.L12 >= line.cents || x.largest >= line.cents) x.rung = "major";
    else if (x.count >= 2 && (x.grew || x.movedToFoundation || x.designated.length)) x.rung = "upgrade";
    else if (x.count >= 2) x.rung = "retain";
    else x.rung = "second";

    const plannedWhy = [];
    for (const t of ["stock", "ira", "investment", "daf", "foundation"]) if (sig.types.has(t)) plannedWhy.push(GIFT_TYPE_LABEL[t]);
    if (sig.tributes.length) plannedWhy.push(sig.tributes[0].kind === "memorial" ? "A memorial gift" : "An honor gift");
    if (x.yearsInRow >= 5) plannedWhy.push(`${x.yearsInRow} years in a row`);
    x.planned = plannedWhy.length > 0 && x.count + x.openPledges.length > 0;
    x.plannedWhy = plannedWhy;

    // status. Undated gifts and open pledges keep a giver off "slipping" on time.
    const r = x.rhythm;
    const sinceLast = x.last ? daysBetween(x.last.date, dataEnd) : null;
    const inWindow = r.next && dataEnd <= r.next.to;   // their usual time hasn't passed
    const lateByRhythm = r.next ? dataEnd > r.next.to : (sinceLast != null && sinceLast >= 274);
    x.timeQuiet = !x.undated.length && !x.openPledges.length && sinceLast != null && lateByRhythm && !inWindow;
    // a major giver far below last calendar year, unless their usual time (a
    // year-end giver in October) has not come yet
    const y0 = +dataEnd.slice(0, 4), lastYr = x.byYear[y0 - 1] || 0;
    x.yearBehind = lastYr > 0 && (x.byYear[y0] || 0) < lastYr * 0.5 && r.kind !== "year_end" && !x.undated.length && !x.openPledges.length;
    x.status = x.grew || x.movedToFoundation ? "up"
      : (x.timeQuiet || (x.shrank && !x.undated.length && !inWindow) || (x.yearBehind && (x.L12 >= line.cents || x.largest >= line.cents)) ? "slipping" : "steady");

    x.signals = [];
    if (r.words) x.signals.push(r.words);
    for (const t of sig.types) x.signals.push(t === "stock" ? "Gave stock" : t === "ira" ? "Gave from an IRA" : t === "investment" ? "Gave an investment distribution" : t === "daf" ? "Gives through a donor-advised fund" : "Gives through a foundation");
    for (const t of sig.tributes.slice(0, 2)) x.signals.push(t.kind === "memorial" ? (t.name ? `Memorial gift for ${t.name}` : "A memorial gift") : (t.name ? `Honor gift for ${t.name}` : "An honor gift"));
    for (const p of sig.programs) x.signals.push(`Designated ${p}`);
    if (sig.sponsor.length) { const s = sig.sponsor[sig.sponsor.length - 1]; x.signals.push(`${s.half ? "Half " : ""}${cap(s.level)} sponsor (${s.year})`); }
    if (x.yearsInRow >= 5) x.signals.push(`${x.yearsInRow} years in a row`);
    if (x.undated.length) x.signals.push("Has an undated gift");
    if (x.openPledges.length) x.signals.push(`Open pledge ${money(x.openPledges.reduce((n, p) => n + p.balance, 0))}`);
  }

  const stats = orgStats(U, gifts, asOf, dataEnd, reviewed, lastDated);
  const ctx = { asOf, dataEnd, thisYear, line, coverage, stats, importName, reviewed, outcomes: indexOutcomes(input.outcomes, asOf), linksDismissed: input.linksDismissed || new Set() };
  const cards = [];
  for (const make of LIBRARY) {
    const c = make(U, ctx, { gifts, people, units, unitOf });
    if (c && c.items.length) cards.push(finishCard(c, ctx));
  }
  const live = cards.filter(c => c.items.length);
  live.sort((a, b) => rankOf(a) - rankOf(b) || b.cents - a.cents);

  const ladder = [...RUNGS.slice(1), "planned"].map(rung => {
    const xs = rung === "planned" ? U.filter(x => x.planned) : U.filter(x => x.rung === rung);
    return { rung, label: RUNG_LABEL[rung], sentence: RUNG_SENTENCE[rung], units: xs.length, people: xs.reduce((n, x) => n + x.ids.length, 0),
             cents: xs.reduce((n, x) => n + x.L12, 0), slipping: xs.filter(x => x.status === "slipping").length, up: xs.filter(x => x.status === "up").length,
             ids: xs.flatMap(x => x.ids) };
  });

  return {
    asOf, coverage, majorLine: line, stats, ladder,
    centsSentence: "Dollars on the ladder are each rung's giving in the 12 months to the end of your gift history.",
    units: U.map(x => ({ ...unitView(x), undatedNote: undatedNote(x, importName) })),
    cards: live,
  };
}

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function rankOf(c) {
  if (c.kind === "review") return -2;      // the totals are not right until these are settled
  if (c.kind === "pace") return -1;
  const i = RANK_ORDER.indexOf(c.rung);
  return i < 0 ? RANK_ORDER.length : i;
}
function unitView(x) {
  return { key: x.key, name: x.name, ids: x.ids, lead: x.lead, rung: x.rung, rungLabel: RUNG_LABEL[x.rung], status: x.status, statusLabel: STATUS_LABEL[x.status],
           planned: x.planned, plannedWhy: x.plannedWhy, signals: x.signals, lifetimeCents: x.lifetime, l12Cents: x.L12, p12Cents: x.P12, gifts: x.count,
           rhythm: x.rhythm.words, nextWindow: x.rhythm.next, owner: x.owner };
}
function indexOutcomes(rows, asOf) {
  const m = new Map();
  for (const r of rows || []) {
    if (r.state === "snoozed" && r.until && ymd(r.until) <= asOf) continue;   // the snooze ran out
    m.set(r.item_key, r);
  }
  return m;
}

// Facts the brief asks the org to see about itself (the first-look numbers).
function orgStats(U, gifts, asOf, dataEnd, reviewed, lastDated) {
  const pos = gifts.filter(g => g.amount_cents > 0 && reviewed[g.id] !== "not_gift");
  const givers = U.filter(x => x.count > 0);
  const yearSet = y => new Set(givers.filter(x => x.byYear[y] > 0).map(x => x.key));
  const y0 = +dataEnd.slice(0, 4), y1 = y0 - 1, y2 = y0 - 2;
  const S0 = yearSet(y0), S1 = yearSet(y1), S2 = yearSet(y2);
  const firstIn = y => givers.filter(x => x.first && +x.first.date.slice(0, 4) === y);
  const ft1 = firstIn(y1);
  const lybunt = givers.filter(x => S1.has(x.key) && !S0.has(x.key));
  const big = lybunt.filter(x => x.byYear[y1] >= 100000);
  const decSpan = [`${y1}-12-01`, `${y1}-12-31`];
  const dec = givers.filter(x => x.dated.some(g => g.date >= decSpan[0] && g.date <= decSpan[1]));
  const decCents = pos.filter(g => g.date && g.date >= decSpan[0] && g.date <= decSpan[1]).reduce((n, g) => n + g.amount_cents, 0);
  const totals = givers.map(x => x.lifetime).sort((a, b) => b - a);
  const all = totals.reduce((n, c) => n + c, 0);
  const top10 = totals.slice(0, 10).reduce((n, c) => n + c, 0);
  // pace runs to the last dated gift: a file that ends Sep 30 is compared to Sep 30 last year
  const paceEnd = lastDated && lastDated < dataEnd ? lastDated : dataEnd;
  const md = paceEnd.slice(5);
  const paceThis = pos.filter(g => g.date && g.date >= `${y0}-01-01` && g.date <= paceEnd).reduce((n, g) => n + g.amount_cents, 0);
  const lastEnd = `${y1}-${md === "02-29" ? "02-28" : md}`;
  const paceLast = pos.filter(g => g.date && g.date >= `${y1}-01-01` && g.date <= lastEnd).reduce((n, g) => n + g.amount_cents, 0);
  return {
    givers: givers.length,
    byYear: { [y2]: S2.size, [y1]: S1.size, [y0]: S0.size },
    retainedFromPrior: [...S2].filter(k => S1.has(k)).length, retainedYears: [y2, y1],
    firstTime: { year: y1, count: ft1.length, gaveAgain: ft1.filter(x => S0.has(x.key)).length },
    lybunt: { year: y1, count: lybunt.length, cents: lybunt.reduce((n, x) => n + x.byYear[y1], 0), big: big.length, bigCents: big.reduce((n, x) => n + x.byYear[y1], 0) },
    december: { year: y1, count: dec.length, cents: decCents },
    top10Share: all ? Math.round((top10 / all) * 10000) / 100 : 0,
    once: givers.filter(x => x.count === 1).length,
    pace: { end: paceEnd, lastEnd, thisCents: paceThis, lastCents: paceLast },
  };
}

// ── THE CARD ───────────────────────────────────────────────────────────────
// make() returns { kind, rung, title, items: [item], why, facts, does }.
// An item is one giving unit: { key, name, ids, lead, facts:[[label,value]],
// how: { who, when, channel, say, ask }, cents }.
function finishCard(c, ctx) {
  // an item done, snoozed or dismissed stays off until its snooze runs out
  c.items = c.items.filter(it => !ctx.outcomes.has(`${c.kind}:${it.key}`));
  c.items.sort((a, b) => b.cents - a.cents);
  c.cents = c.items.reduce((n, it) => n + it.cents, 0);
  c.ids = [...new Set(c.items.flatMap(it => it.ids))];
  c.people = c.items.length;
  const lead = c.items[0];
  c.how = lead ? lead.how : null;
  c.words = {
    what: c.what ? c.what(c) : `${plural(c.items.length, "giver")}.`,
    why: c.why,
    how: lead && lead.how ? howWords(lead.how, lead) : "",
  };
  delete c.what;
  // the card's own counts and dollars are facts too, so its words may say them
  c.cardFacts = [...(c.cardFacts || []), ["givers", String(c.items.length)], ["dollars", money(c.cents)], ...(c.more ? c.more(c) : [])];
  delete c.more;
  c.facts = factsOf(c);
  c.rungLabel = RUNG_LABEL[c.rung] || null;
  return c;
}
function howWords(h, it) {
  const bits = [];
  if (h.who) bits.push(`${h.who} ${h.channel ? h.channel.toLowerCase() : "reaches out"}`);
  if (h.when) bits.push(h.when.words);
  let s = bits.length ? `${bits.join(", ")}.` : "";
  if (h.ask) s += ` ${h.ask.words}`;
  return s.trim();
}
// Every number a card's words may use: its facts, its items' facts and asks.
function factsOf(c) {
  const out = [];
  for (const [k, v] of c.cardFacts || []) out.push([k, v]);
  for (const it of c.items) {
    for (const [k, v] of it.facts) out.push([`${it.name}: ${k}`, v]);
    if (it.how && it.how.ask) out.push([`${it.name}: ask`, it.how.ask.words]);
    if (it.how && it.how.when) out.push([`${it.name}: when`, it.how.when.words]);
    if (it.how && it.how.say) out.push([`${it.name}: say`, it.how.say]);
  }
  return out;
}
// The number check: every number in the words appears in the facts.
const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const normNum = s => s.replace(/[$,%]/g, "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
function numbersIn(text) { return (String(text || "").match(NUM_RE) || []).map(normNum).filter(Boolean); }
function numbersOk(words, facts) {
  const have = new Set(numbersIn(facts.map(([k, v]) => `${k} ${v}`).join(" ")));
  const bad = numbersIn(words).filter(n => !have.has(n));
  return { ok: bad.length === 0, bad };
}

const whoFor = (x, rung) => (rung === "major" ? "The director" : x.owner || "You");
const firstName = x => {
  const n = String(x.name || "").replace(/^(the|mr\.?|mrs\.?|ms\.?|dr\.?)\s+/i, "");
  if (x.kind === "organisation" || x.kind === "organization" || /foundation|farm|club|inc|llc|company|fund/i.test(n)) return null;
  return n.split(/\s+/)[0];
};
// "Hi Selin and Orlie" for a couple, "Hi Alin" for one person, "Hello" for an organisation
const hello = x => {
  const f = firstName(x);
  if (!f) return "Hello";
  const two = String(x.name || "").match(/^([A-Z][\w'-]+)\s+(?:&|and)\s+([A-Z][\w'-]+)\s/);
  return two ? `Hi ${two[1]} and ${two[2]}` : `Hi ${f}`;
};
const yearsLine = x => Object.keys(x.byYear).sort().map(y => `${money(x.byYear[y])} (${y})`).join(", ");
const windowWords = (from, to) => ({ from, to, words: from === to ? `on ${longDate(from)}` : `between ${longDate(from)} and ${longDate(to)}` });
const reachable = x => !x.noContact;

// ── THE INSIGHT LIBRARY ────────────────────────────────────────────────────
const LIBRARY = [
  // 9. Rows that may not be gifts
  function review(U, ctx, { gifts }) {
    const rows = gifts.filter(g => g.amount_cents > 0 && g.sig.notGift && !ctx.reviewed[g.id]);
    if (!rows.length) return null;
    const items = rows.map(g => ({
      key: "g:" + g.id, giftId: g.id, name: g.unit.name, ids: g.unit.people.map(p => p.id), lead: g.donor_id, cents: g.amount_cents,
      reason: g.sig.notGift.why, memo: [g.memo, g.notes].filter(Boolean).join(" · "), date: g.date,
      facts: [["amount", money(g.amount_cents)], ["date", g.date ? longDate(g.date) : "no date"], ["memo", [g.memo, g.notes].filter(Boolean).join(" · ")], ["reason", g.sig.notGift.why]],
      how: null,
    }));
    return {
      kind: "review", rung: null, title: "Rows that may not be gifts",
      what: c => `${plural(c.items.length, "row")} (${money(c.items.reduce((n, i) => n + i.cents, 0))}) look like purchases, tickets or reimbursements, not gifts.`,
      why: "A purchase or a reimbursement counted as a gift makes every total and every ask built on it wrong. Nothing changes until you decide each one.",
      cardFacts: [["rows", String(items.length)], ["dollars", money(items.reduce((n, i) => n + i.cents, 0))]],
      items, does: [{ action: "keep", label: "Keep as gift" }, { action: "not_gift", label: "Not a gift" }],
    };
  },
  // 10. Pace vs the same days last year (Home only)
  function pace(U, ctx) {
    const p = ctx.stats.pace;
    if (!p.lastCents) return null;
    const gap = p.thisCents - p.lastCents;
    const item = { key: "org", name: "Your organisation", ids: [], lead: null, cents: Math.abs(Math.min(0, gap)),
      facts: [["this year", money(p.thisCents)], ["this year to", longDate(p.end)], ["last year", money(p.lastCents)], ["last year to", longDate(p.lastEnd)], ["difference", money(Math.abs(gap))]], how: null };
    return {
      kind: "pace", rung: null, homeOnly: true, title: gap < 0 ? "Behind last year's pace" : "Ahead of last year's pace",
      what: () => `${money(p.thisCents)} by ${longDate(p.end)}, against ${money(p.lastCents)} by ${longDate(p.lastEnd)}.`,
      why: gap < 0 ? `Giving is ${money(-gap)} behind last year at this point. The cards below are where most of it can come back.`
                   : `Giving is ${money(gap)} ahead of last year at this point.`,
      cardFacts: item.facts, items: [item], does: [],
    };
  },
  // 2. Year-end givers due
  function yearEnd(U, ctx) {
    const y1 = ctx.thisYear - 1, from = `${y1}-12-01`, to = `${y1}-12-31`, season = `${ctx.thisYear}-11-01`;
    const xs = U.filter(x => reachable(x) && x.dated.some(g => g.date >= from && g.date <= to) && !x.dated.some(g => g.date >= season));
    if (!xs.length) return null;
    const items = xs.map(x => {
      const dec = x.dated.filter(g => g.date >= from && g.date <= to).reduce((n, g) => n + g.amount_cents, 0);
      const when = ctx.asOf <= `${ctx.thisYear}-11-15` ? windowWords(ctx.asOf > season ? ctx.asOf : season, `${ctx.thisYear}-11-15`) : windowWords(ctx.asOf, `${ctx.thisYear}-12-15`);
      return { key: x.key, name: x.name, ids: x.ids, lead: x.lead, cents: dec,
        facts: [[`December ${y1}`, money(dec)]],
        how: { who: whoFor(x, x.rung), channel: dec >= 100000 ? "Call" : "Note", when,
          say: `${hello(x)}, thank you for your gift last December. It mattered. We're planning this year's year-end and hoped we could count on you again.`,
          ask: x.noAsk ? null : { cents: wholeDollars(dec), words: `Ask ${money(wholeDollars(dec))}: last December's gift.`, rule: "Retain asks last year's amount." } } };
    });
    return {
      kind: "year_end", rung: "retain", title: "Year-end givers due",
      what: c => `${plural(c.items.length, "giver")} gave ${money(c.items.reduce((n, i) => n + i.cents, 0))} in December ${y1} and haven't given this year-end yet.`,
      why: `In your own data, ${plural(ctx.stats.december.count, "donor")} gave ${money(ctx.stats.december.cents)} in December ${y1}. December givers do best when asked in early November.`,
      cardFacts: [["December givers", String(ctx.stats.december.count)], ["December dollars", money(ctx.stats.december.cents)], ["year", String(y1)]],
      items, does: [{ action: "call_list", label: "Make a call list" }, { action: "task", label: "Create tasks for Nov 1" }, { action: "group", label: "Make a group" }],
    };
  },
  // 3. Sponsors not renewed, or downgraded
  function sponsors(U, ctx) {
    const y = ctx.thisYear, items = [];
    for (const x of U.filter(reachable)) {
      const s = x.sig.sponsor;
      if (!s.length) continue;
      const last = s.filter(v => v.year === y - 1), now = s.filter(v => v.year === y);
      if (!last.length) continue;
      const top = arr => arr.reduce((b, v) => (SPONSOR_LEVELS.indexOf(v.level) > SPONSOR_LEVELS.indexOf(b.level) ? v : b), arr[0]);
      const L = top(last);
      const nextUp = SPONSOR_LEVELS[Math.min(SPONSOR_LEVELS.length - 1, SPONSOR_LEVELS.indexOf(L.level) + 1)];
      const anniv = `${y}${L.date.slice(4)}`;
      let state = null;
      if (!now.length) state = "not_renewed";
      else if (SPONSOR_LEVELS.indexOf(top(now).level) < SPONSOR_LEVELS.indexOf(L.level)) state = "downgraded";
      if (!state) continue;
      const from = addDays(anniv, -42) > ctx.asOf ? addDays(anniv, -42) : ctx.asOf;
      items.push({ key: x.key, name: x.name, ids: x.ids, lead: x.lead, cents: L.cents, state,
        facts: [[`${y - 1} level`, `${L.half ? "half " : ""}${cap(L.level)}`], [`${y - 1} amount`, money(L.cents)], [`${y - 1} date`, longDate(L.date)]]
          .concat(state === "downgraded" ? [[`${y} level`, cap(top(now).level)]] : []),
        how: { who: whoFor(x, x.rung), channel: "Call", when: anniv >= ctx.asOf ? windowWords(from, anniv) : windowWords(ctx.asOf, addDays(ctx.asOf, 14)),
          say: `${hello(x)}, your ${L.half ? "half " : ""}${cap(L.level)} sponsorship last year made the night. We'd love to have you back${nextUp !== L.level ? `, and there's a ${cap(nextUp)} level this year if you'd like to go further` : ""}.`,
          ask: x.noAsk ? null : { cents: L.cents, words: `Ask to renew at ${cap(L.level)} (${money(L.cents)}), and offer ${cap(nextUp)}.`, rule: "Sponsor renewal asks last year's level and offers the next one up." } } });
    }
    if (!items.length) return null;
    return {
      kind: "sponsors", rung: "retain", title: "Sponsors to renew",
      what: c => `${plural(c.items.filter(i => i.state === "not_renewed").length, "sponsor")} from ${y - 1} not renewed, ${plural(c.items.filter(i => i.state === "downgraded").length, "sponsor")} at a lower level.`,
      why: "A sponsor asked before last year's date usually renews. One asked after it often has already spent that budget.",
      cardFacts: [["year", String(y - 1)], ["this year", String(y)]], items,
      more: c => [["not renewed", String(c.items.filter(i => i.state === "not_renewed").length)], ["downgraded", String(c.items.filter(i => i.state === "downgraded").length)]],
      does: [{ action: "call_list", label: "Make a call list" }, { action: "task", label: "Create tasks" }],
    };
  },
  // 4. First gift, no second yet
  function secondGift(U, ctx) {
    const from = addDays(ctx.dataEnd, -SECOND_MAX_DAYS + 1);
    const xs = U.filter(x => reachable(x) && x.count === 1 && x.first && x.first.date >= from);
    if (!xs.length) return null;
    const ft = ctx.stats.firstTime;
    const items = xs.map(x => {
      const g = x.first, best = addDays(g.date, SECOND_BEST_DAYS), last = addDays(g.date, SECOND_MAX_DAYS);
      const when = best >= ctx.asOf ? windowWords(ctx.asOf, best) : windowWords(ctx.asOf, last);
      return { key: x.key, name: x.name, ids: x.ids, lead: x.lead, cents: g.amount_cents,
        facts: [["first gift", money(g.amount_cents)], ["first gift date", longDate(g.date)]],
        how: { who: whoFor(x, x.rung), channel: g.amount_cents >= 25000 ? "Call" : "Note", when,
          say: `${hello(x)}, your first gift in ${monthYear(g.date)} is already at work. Here's one thing it did. Would you give again before the year is out?`,
          ask: x.noAsk ? null : { cents: wholeDollars(g.amount_cents), words: `Ask ${money(wholeDollars(g.amount_cents))}: their first gift, within 12 months of it.`, rule: "Second gift asks the first gift's amount within 12 months of it." } } };
    });
    return {
      kind: "second_gift", rung: "second", title: "First gift, no second yet",
      what: c => `${plural(c.items.length, "donor")} made a first gift in the last 12 months and no second.`,
      why: ft.count ? `In your own data, ${ft.gaveAgain} of ${ft.count} first-time donors from ${ft.year} gave again. A second gift within 90 days is the best sign they'll stay.`
                    : "A second gift within 90 days of the first is the best sign a new donor will stay.",
      cardFacts: [["gave again", String(ft.gaveAgain)], ["first-time donors", String(ft.count)], ["year", String(ft.year)], ["days", "90"], ["months", "12"]],
      items, does: [{ action: "draft", label: "Draft a note" }, { action: "task", label: "Create tasks" }, { action: "group", label: "Make a group" }],
    };
  },
  // 5. Upgraded on their own
  function upgraded(U, ctx) {
    const xs = U.filter(x => reachable(x) && x.count >= 2 && x.status === "up" || (reachable(x) && x.count >= 2 && x.designated.length && x.status !== "slipping"));
    if (!xs.length) return null;
    const items = xs.map(x => {
      const ask = naturalCents(Math.round(x.L12 * 1.5));
      const fdn = x.dated.find(g => g.date >= addDays(ctx.dataEnd, -364) && /\bfoundation\b/i.test(g.sig.text));
      const fdnName = fdn ? (String(fdn.sig.text).match(/((?:The\s+)?[A-Z][\w'&]*(?:\s+[A-Z][\w'&]*)*\s+Family Foundation|(?:The\s+)?[A-Z][\w'&]*(?:\s+[A-Z][\w'&]*)*\s+Foundation)/) || [])[1] : null;
      const before = x.dated.filter(g => g.date < addDays(ctx.dataEnd, -364)).slice(-1)[0];
      const after = x.dated.filter(g => g.date >= addDays(ctx.dataEnd, -364)).sort((a, b) => b.amount_cents - a.amount_cents)[0];
      const facts = [["12 months before", money(x.P12)], ["last 12 months", money(x.L12)]];
      if (before) facts.push(["earlier gift", `${money(before.amount_cents)} (${monthYear(before.date)})`]);
      if (after) facts.push(["recent gift", `${money(after.amount_cents)} (${monthYear(after.date)})`]);
      if (fdnName) facts.push(["through", fdnName]);
      if (x.designated.length) facts.push(["designated", x.designated[0]]);
      return { key: x.key, name: x.name, ids: x.ids, lead: x.lead, cents: x.L12,
        facts,
        how: { who: whoFor(x, "upgrade"), channel: "Visit", when: windowWords(ctx.asOf, addDays(ctx.asOf, 30)),
          say: `${hello(x)}, thank you. Your gift${after ? ` of ${money(after.amount_cents)}` : ""}${fdnName ? ` through ${fdnName}` : ""}${x.designated.length ? ` for ${x.designated[0]}` : ""} went further than you might know. Could we show you what it did, in person?`,
          ask: x.noAsk ? null : { cents: ask, words: `Ask ${money(ask)}: 1.5 times their last 12 months (${money(x.L12)}), rounded.`, rule: "Upgrade asks 1.5 times their last 12 months, rounded to a natural number." } } };
    });
    return {
      kind: "upgraded", rung: "upgrade", title: "Upgraded on their own",
      what: c => `${plural(c.items.length, "donor")} gave much more in the last 12 months than the 12 before, moved into a family foundation, or designated a program.`,
      why: "A donor who raises their own gift is telling you they want to be closer. Thank them first, then invite them in.",
      cardFacts: [["multiplier", "1.5"], ["months", "12"]], items,
      does: [{ action: "brief", label: "Build a visit briefing" }, { action: "task", label: "Create a task" }, { action: "draft", label: "Draft a thank-you" }],
    };
  },
  // 1. Major donor slipping
  function majorSlipping(U, ctx) {
    const y0 = ctx.thisYear, y1 = y0 - 1;
    const xs = U.filter(x => reachable(x) && x.rung === "major" && x.status === "slipping" && x.yearBehind && (x.byYear[y1] || 0) >= ctx.line.cents);
    if (!xs.length) return null;
    const items = xs.map(x => {
      const last = x.byYear[y1] || 0, now = x.byYear[y0] || 0;
      const lo = naturalCents(Math.round(last * 0.5)), hi = naturalCents(last);
      const decGiver = x.rhythm.kind === "year_end";
      return { key: x.key, name: x.name, ids: x.ids, lead: x.lead, cents: last - now,
        facts: [["giving by year", yearsLine(x)], [`${y1}`, money(last)], [`${y0} so far`, money(now)], ["behind", money(last - now)]],
        how: { who: "The director", channel: "Visit", when: decGiver ? windowWords(ctx.asOf <= `${y0}-11-01` ? `${y0}-11-01` : ctx.asOf, `${y0}-11-15`) : windowWords(ctx.asOf, addDays(ctx.asOf, 21)),
          say: `${hello(x)}, your support has carried this work${Object.keys(x.byYear).length > 1 ? " year after year" : ""}. Before we plan next year, I'd like to sit down and hear what matters most to you now.`,
          ask: x.noAsk ? null : { range: [lo, hi], words: `History: ${yearsLine(x)}. A range to talk about: ${money(lo)} to ${money(hi)}.`, rule: "Major shows their history and suggests a range, never a single number." } } };
    });
    return {
      kind: "major_slipping", rung: "major", title: "Major donor slipping",
      what: c => `${plural(c.items.length, "major donor")} ${c.items.length === 1 ? "is" : "are"} far below last year: ${money(c.items.reduce((n, i) => n + i.cents, 0))} behind.`,
      why: `A major donor who slips is the largest single risk on the ladder. ${ctx.line.rule}`,
      cardFacts: [["line", money(ctx.line.cents)], ["line rule", ctx.line.rule]], items,
      does: [{ action: "brief", label: "Build a visit briefing" }, { action: "task", label: "Create a task" }],
    };
  },
  // 6. Open pledges to collect
  function pledges(U, ctx) {
    const y = ctx.thisYear, items = [];
    for (const x of U) {
      for (const p of x.openPledges) {
        const inst = p.installments.slice().sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
        const multi = inst.length > 1;
        const dueNow = inst.filter(i => !i.paid_gift_id && i.due_date && +i.due_date.slice(0, 4) <= y);
        const later = inst.filter(i => !i.paid_gift_id && i.due_date && +i.due_date.slice(0, 4) > y);
        const nowCents = multi ? dueNow.reduce((n, i) => n + i.cents, 0) : p.balance;
        const facts = [["pledged", money(p.cents)], ["paid", money(p.paid)], ["still to come", money(p.balance)]];
        if (multi) for (const i of inst) facts.push([`${i.due_date.slice(0, 4)} installment`, `${money(i.cents)}${i.paid_gift_id ? " (paid)" : ""}`]);
        const due = (dueNow[0] && dueNow[0].due_date) || p.due_date && ymd(p.due_date);
        items.push({ key: x.key + ":" + p.id, pledgeId: p.id, name: x.name, ids: x.ids, lead: x.lead, cents: nowCents || p.balance, multi,
          installments: inst.map(i => ({ year: i.due_date ? i.due_date.slice(0, 4) : null, due: i.due_date, cents: i.cents, paid: !!i.paid_gift_id })),
          facts,
          how: { who: whoFor(x, x.rung), channel: p.balance >= 100000 ? "Call" : "Letter",
            when: due && due > ctx.asOf ? windowWords(addDays(due, -14) > ctx.asOf ? addDays(due, -14) : ctx.asOf, due) : windowWords(ctx.asOf, addDays(ctx.asOf, 14)),
            say: `${hello(x)}, thank you again for your pledge of ${money(p.cents)}. ${multi ? `This year's part is ${money(nowCents)}.` : ""} Is there a way of giving that's easiest for you?`.replace(/\s+/g, " "),
            ask: { cents: nowCents || p.balance, words: `Collect ${money(nowCents || p.balance)}${multi ? `: this year's installment of the ${money(p.cents)} pledge` : ": the pledge as promised"}.`, rule: "A pledge is collected as promised; nothing new is asked." } } });
      }
    }
    if (!items.length) return null;
    const multiN = items.filter(i => i.multi).length;
    return {
      kind: "pledges", rung: "retain", title: "Open pledges to collect",
      what: c => `${plural(c.items.length, "open pledge")}, ${money(c.items.reduce((n, i) => n + i.cents, 0))} to collect now${multiN ? `; ${plural(multiN, "multi-year pledge")} with installments ahead` : ""}.`,
      why: "Money already promised is the easiest money to lose by not asking. A short, warm reminder is a service to the donor.",
      cardFacts: [["multi-year", String(multiN)]], items,
      does: [{ action: "call_list", label: "Make a call list" }, { action: "task", label: "Create tasks" }],
    };
  },
  // 7. Planned-gift signals
  function planned(U, ctx) {
    const xs = U.filter(x => reachable(x) && x.planned);
    if (!xs.length) return null;
    const items = xs.map(x => ({ key: x.key, name: x.name, ids: x.ids, lead: x.lead, cents: x.lifetime + x.openPledges.reduce((n, p) => n + p.balance, 0),
      facts: [["signals", x.plannedWhy.join(", ")], ["lifetime", money(x.lifetime)]],
      how: { who: whoFor(x, "major"), channel: "Visit", when: windowWords(ctx.asOf, addDays(ctx.asOf, 60)),
        say: `${hello(x)}, you've given in a way that tells us this work matters to you for the long run. I'd love to hear what you hope it looks like years from now.`,
        ask: { cents: null, words: "No money ask. Start a conversation about legacy and impact.", rule: "Planned never asks for money: it suggests a conversation about legacy and impact." } } }));
    return {
      kind: "planned", rung: "planned", title: "Planned-gift signals",
      what: c => `${plural(c.items.length, "donor")} show signs of legacy capacity: assets, IRA or investment gifts, a foundation, a memorial or honor gift, or long loyalty.`,
      why: "People who give from assets or in someone's memory are the likeliest to remember you in a will. The first step is a conversation, never an ask.",
      cardFacts: [["years", "5"]], items,
      does: [{ action: "brief", label: "Build a visit briefing" }, { action: "group", label: "Make a group" }],
    };
  },
  // 8. Family or network to link
  function family(U, ctx, { people }) {
    // a name in another unit's memo, a foundation memo naming people, or the same surname at the same address
    const named = [];
    const nameKeys = [];
    for (const x of U) for (const p of x.unit.people) {
      const parts = String(p.name || "").replace(/[.,]/g, " ").split(/\s+/).filter(w => w.length >= 3 && /^[A-Z]/.test(w));
      if (parts.length >= 2 && parts[0] !== parts[parts.length - 1] && !/foundation|farm|club|inc|llc/i.test(p.name)) nameKeys.push({ x, first: parts[0], last: parts[parts.length - 1] });
    }
    const edges = new Map();
    const edge = (a, b, why) => {
      if (a === b) return;
      const k = [a.key, b.key].sort().join("|");
      if (!edges.has(k)) edges.set(k, { a, b, why: [] });
      edges.get(k).why.push(why);
    };
    // A memo names someone when both their first and last name are words in it.
    // Indexed by last name, so this is one pass over each giver's memo words.
    const byLast = new Map();
    for (const n of nameKeys) (byLast.get(n.last) || byLast.set(n.last, []).get(n.last)).push(n);
    const wordsOf = t => new Set(String(t).split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean).flatMap(w => [w, w.replace(/['’]s$/, "")]));
    for (const x of U) {
      const words = wordsOf(x.gifts.map(g => [g.memo, g.notes].filter(Boolean).join(" ")).join(" "));
      if (!words.size) continue;
      for (const w of words) {
        for (const n of byLast.get(w) || []) {
          if (n.x === x || !words.has(n.first)) continue;
          const rel = x.sig.relations.find(r => wordsOf(r.of).has(n.last));
          edge(x, n.x, rel ? `${x.name}'s memo says "${rel.of}'s ${rel.word}"` : `${x.name}'s memo names ${n.first} ${n.last}`);
        }
      }
    }
    const byAddr = new Map();
    for (const p of people) {
      const last = String(p.name || "").trim().split(/\s+/).pop();
      if (!p.address || !last) continue;
      const k = `${String(p.address).toLowerCase().replace(/\W+/g, "")}|${last.toLowerCase()}`;
      (byAddr.get(k) || byAddr.set(k, []).get(k)).push(p);
    }
    for (const ps of byAddr.values()) if (ps.length > 1) {
      const xs = [...new Set(ps.map(p => U.find(x => x.ids.includes(p.id))).filter(Boolean))];
      for (let i = 1; i < xs.length; i++) edge(xs[0], xs[i], `Same surname at the same address`);
    }
    // networks: connected groups of units
    const parent = new Map();
    const find = k => { while (parent.get(k) !== k) k = parent.get(k); return k; };
    // Worth showing: a name in a memo, or two GIVING records at one address.
    for (const [k, e] of edges) {
      const memo = e.why.some(w => !/^Same surname/.test(w));
      if (!(memo ? (e.a.count || e.b.count) : (e.a.count && e.b.count))) edges.delete(k);
    }
    for (const { a, b } of edges.values()) { for (const u of [a, b]) if (!parent.has(u.key)) parent.set(u.key, u.key); parent.set(find(a.key), find(b.key)); }
    const nets = new Map();
    for (const k of parent.keys()) { const r = find(k); (nets.get(r) || nets.set(r, []).get(r)).push(k); }
    const items = [];
    for (const keys of nets.values()) {
      const xs = keys.map(k => U.find(x => x.key === k)).sort((a, b) => b.lifetime - a.lifetime);
      const netKey = "n:" + xs.map(x => x.key).sort().join("+");
      if (ctx.linksDismissed.has(netKey)) continue;
      const why = [...edges.values()].filter(e => keys.includes(e.a.key)).flatMap(e => e.why);
      const comb = xs.reduce((n, x) => n + x.lifetime, 0);
      items.push({ key: netKey, name: xs.map(x => x.name).join(", "), ids: xs.flatMap(x => x.ids), lead: xs[0].lead, cents: comb, members: xs.map(x => ({ name: x.name, ids: x.ids, lead: x.lead, cents: x.lifetime })),
        reasons: [...new Set(why)],
        facts: [["records", String(xs.length)], ["combined giving", money(comb)]], how: null });
    }
    if (!items.length) return null;
    return {
      kind: "family", rung: null, title: "Family or network to link",
      what: c => c.items.length === 1 ? `These ${c.items[0].members.length} records look like one family or network.` : `${plural(c.items.length, "group")} of records look like one family or network.`,
      why: "Linked, each profile shows what the family gives together, so nobody is asked as if they were a stranger. Steward links nothing until you say so.",
      cardFacts: [], items, does: [{ action: "link", label: "Link" }, { action: "not_related", label: "Not related" }],
    };
  },
];

// The undated note, for a profile or a card about one giver.
function undatedNote(x, importName) {
  const g = x.undated[0];
  if (!g) return null;
  const from = g.event_name || (g.import_id && importName[g.import_id]) || "an import";
  return `Has an undated gift from ${from}; set its date.`;
}

// One unit's next move: the first card item about them, by rank.
function nextMoveFor(result, donorId) {
  for (const c of result.cards) {
    if (c.homeOnly || c.kind === "review") continue;
    const it = c.items.find(i => i.ids.includes(donorId));
    if (it) return { kind: c.kind, title: c.title, rung: c.rung, rungLabel: c.rungLabel, why: c.words.why, item: it, words: { how: it.how ? howWords(it.how, it) : "" } };
  }
  return null;
}

module.exports = {
  RUNGS, RUNG_LABEL, RUNG_SENTENCE, STATUS_LABEL, RANK_ORDER, OUTCOME_DAYS, GIFT_TYPES, GIFT_TYPE_LABEL,
  computeInsights, nextMoveFor, undatedNote, giftTypeOf, notAGift, readGift, rhythmOf, naturalCents, numbersIn, numbersOk, money, longDate,
};
