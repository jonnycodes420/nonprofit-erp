// why.js — WHY-1. Ask Steward why, and who to call tomorrow.
//
// THE FACTS HALF of every answer. Seven deterministic analyses on the org's
// own data: no model, no guess. Each returns the answer shape (shared/whyShape.js):
//   facts    the numbers the sentence may use, and nothing else
//   reasons  ranked, each a computed fact { key, label, cents, count, phrase,
//            definition, rows }. `rows` are figure rows, and a reason's cents
//            and count are computed FROM its rows, so the number and the rows
//            behind it cannot disagree (figure source "why").
//   who      the people it is about, ranked
//   step     one recommended action; it plans or opens, it never sends
//   cantSee  one honest line when the evidence is thin, or null
//
// The sentence is written elsewhere (routes/why.js): the template from
// whyShape.templateSentence, or the model's, checked number by number.

const { query } = require("./db");
const orgTime = require("./orgTime");
const AW = require("./appealWhy");

let HN = null;
const homeNote = async () => (HN = HN || await import("./shared/homeNote.js"));

const toC = v => Math.round(Number(v || 0) * 100);
const sumRows = rows => rows.reduce((s, r) => s + toC(r.amount), 0);
const fmt = c => "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const spell = n => (n >= 0 && n < 10 ? WORDS[n] : String(n));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const monthOf = d => MONTHS[Number(String(d).slice(5, 7)) - 1];

// A reason is built from its rows. Never the other way round.
function reason(key, label, rows, { phrase, definition, measure = "sum" } = {}) {
  return { key, label, rows, count: rows.length, cents: sumRows(rows), measure, phrase, definition };
}
// No em dashes reach a screen from here, including sentences other modules wrote.
const plain = t => String(t == null ? "" : t).replace(/\s*\u2014\s*/g, ", ").trim();
const row = (id, type, donorId, name, date, cents, detail) =>
  ({ id: String(id), type, donor_id: donorId, name, date: date ? String(date).slice(0, 10) : null, amount: cents == null ? null : cents / 100, detail: plain(detail) });
// When something happened, in words: "two weeks ago" while it is recent, the
// month and year once "months ago" stops saying anything.
function whenPhrase(H, date, today) {
  const d = orgTime.daysBetween(date, today);
  if (d != null && d < 75) return H.agoPhrase(d);
  return `in ${monthOf(date)} ${String(date).slice(0, 4)}`;
}

async function today(orgId) {
  const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]);
  return orgTime.orgToday({ timezone: o && o.timezone });
}

// How many of these people have ANY logged contact: the evidence behind a
// "who" list that was built from giving alone.
async function contactCoverage(orgId, ids) {
  if (!ids.length) return 0;
  const [r] = await query(`SELECT COUNT(DISTINCT donor_id)::int AS n FROM interactions
     WHERE org_id = ? AND donor_id = ANY(?) AND type IN ('call','meeting','email','stewardship','note')`, [orgId, ids]);
  return r ? r.n : 0;
}
function coverageLine(n, total) {
  if (!total || n * 2 > total) return null;
  return n === 0
    ? `None of these donors has any logged contact, so this is based on giving alone.`
    : `Only ${spell(n)} of these ${total === 1 ? "donor has" : "donors have"} any logged contact, so this is based on giving alone.`;
}

// ── (a) Why did <campaign> come in under (or over) last year? ──────────────
// A variance breakdown against the comparable campaign (appealWhy.js, the
// math ENGAGE-1's "How did it do?" used). Every donor of either campaign lands
// in exactly one part, so the parts sum to the difference to the cent:
//   lapsed     gave last time, not this time            minus last time's total
//   timing     the same, but last time they gave later in the campaign than
//              this year's window has run (a later send, or still open)
//   less/more  gave both times: this time minus last time
//   new        first gift to the organisation came through this campaign
//   back       gave to the organisation before, but not to last year's campaign
// A donor who gave the same both times moves nothing and is in no part.
async function defaultCampaign(orgId) {
  const t = await today(orgId);
  const rows = await query(`SELECT id, name, start_date::text AS start_date FROM campaigns
     WHERE org_id = ? AND start_date IS NOT NULL AND start_date <= ? AND sent_at IS NULL
       AND COALESCE(subject,'') = '' AND COALESCE(goal_amount,0) > 0
     ORDER BY start_date DESC, name LIMIT 12`, [orgId, t]);
  for (const c of rows) {
    const full = await AW.campaignRow(orgId, c.id);
    const { compare } = await AW.comparableFor(orgId, full);
    if (compare) return c;
  }
  return rows[0] || null;
}

async function appeal(orgId, { campaign } = {}) {
  const c = campaign ? await AW.campaignRow(orgId, campaign) : null;
  if (!c) return null;
  const { compare } = await AW.comparableFor(orgId, c);
  const subject = { campaign: { id: c.id, name: c.name } };
  if (!compare) {
    return { ...subject, facts: { campaignName: c.name, compareName: null }, reasons: [], who: [], step: null,
      cantSee: "Steward needs last year's campaign to compare with. Choose it on the campaign and this answer appears." };
  }
  const p = await AW.campaignRow(orgId, compare.id);
  const t = await today(orgId);
  const tg = await AW.campaignGifts(orgId, c), lg = await AW.campaignGifts(orgId, p);
  const by = gifts => {
    const m = new Map();
    for (const g of gifts) {
      const x = m.get(g.donor_id) || { donorId: g.donor_id, name: g.name, cents: 0, first: g.date, last: g.date };
      x.cents += g.cents; if (g.date < x.first) x.first = g.date; if (g.date > x.last) x.last = g.date;
      m.set(g.donor_id, x);
    }
    return m;
  };
  const T = by(tg), L = by(lg);
  // NEW to the organisation: no gift anywhere before their first gift here.
  const ids = [...T.keys()].filter(id => !L.has(id));
  const before = ids.length ? new Set((await query(
    `SELECT DISTINCT g.donor_id FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?)
        AND NOT (COALESCE(g.campaign_id, '') = ? OR (g.campaign_id IS NULL AND COALESCE(g.campaign, '') = ?))
        AND LEFT(g.date, 10) < (SELECT MIN(LEFT(h.date, 10)) FROM gifts h WHERE h.org_id = g.org_id AND h.donor_id = g.donor_id
                                  AND (h.campaign_id = ? OR (h.campaign_id IS NULL AND h.campaign = ?)))`,
    [orgId, ids, c.id, c.name, c.id, c.name])).map(r => r.donor_id)) : new Set();

  // THE WINDOW. How far into its campaign this year has run, in days from its
  // start: to today, or to its end date if that has passed. A lapsed donor
  // whose gift last time came later than that point is TIMING, not lost.
  const days = (a, b) => orgTime.daysBetween(a, b);
  const thisEnd = c.end_date && c.end_date < t ? c.end_date : t;
  const windowDays = c.start_date ? days(c.start_date, thisEnd) : null;
  const lastWindowDays = p.start_date && p.end_date ? days(p.start_date, p.end_date) : null;
  // The appeal went out later than last year: this start against last year's
  // start a year on, in days. Zero or less is not late.
  let lateDays = 0;
  if (c.start_date && p.start_date) {
    const y = Number(c.start_date.slice(0, 4)) - Number(p.start_date.slice(0, 4));
    const lastOnThisYear = `${Number(p.start_date.slice(0, 4)) + y}${p.start_date.slice(4)}`;
    lateDays = Math.max(0, days(lastOnThisYear, c.start_date) || 0);
  }
  const lateRow = x => windowDays != null && p.start_date && days(p.start_date, x.first) > windowDays
    && (lastWindowDays == null || windowDays < lastWindowDays);

  const lapsed = [], timing = [], less = [], more = [], newcomers = [], back = [];
  for (const x of L.values()) {
    if (T.has(x.donorId)) continue;
    const r = row(x.donorId, "donor", x.donorId, x.name, x.last, -x.cents, `Gave ${fmt(x.cents)} last time, nothing yet this time`);
    (lateRow(x) ? timing : lapsed).push({ ...r, lastCents: x.cents });
  }
  for (const x of T.values()) {
    const l = L.get(x.donorId);
    if (l) {
      const d = x.cents - l.cents;
      if (d < 0) less.push({ ...row(x.donorId, "donor", x.donorId, x.name, x.last, d, `${fmt(x.cents)} this time, ${fmt(l.cents)} last time`), lastCents: l.cents });
      else if (d > 0) more.push(row(x.donorId, "donor", x.donorId, x.name, x.last, d, `${fmt(x.cents)} this time, ${fmt(l.cents)} last time`));
    } else if (before.has(x.donorId)) back.push(row(x.donorId, "donor", x.donorId, x.name, x.last, x.cents, "Gave before, but not to last year's campaign"));
    else newcomers.push(row(x.donorId, "donor", x.donorId, x.name, x.last, x.cents, "Their first gift to the organisation"));
  }
  const byAmt = (a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name);
  [lapsed, timing, less, more, newcomers, back].forEach(a => a.sort(byAmt));
  const n = a => a.length;
  const reasons = [
    reason("lapsed", "Last year's donors who haven't given yet", lapsed, {
      phrase: `${spell(n(lapsed))} of last year's donors ${n(lapsed) === 1 ? "hasn't" : "haven't"} given yet`,
      definition: "Each person who gave to last year's campaign and has not given to this one, with what they gave last time, subtracted." }),
    reason("timing", lateDays > 0 ? `Gave later last year; this appeal went out ${lateDays} days later` : "Gave later in the campaign last year", timing, {
      phrase: lateDays > 0 ? `the appeal went out ${lateDays} days later and ${spell(n(timing))} of last year's donors gave after this point last time`
        : `${spell(n(timing))} of last year's donors gave after this point last time`,
      definition: "Each person who gave to last year's campaign later in it than this campaign has run so far, and has not given to this one yet. Their gift may still come." }),
    reason("less", "Gave less than last year", less, {
      phrase: `${spell(n(less))} ${n(less) === 1 ? "donor" : "donors"} gave less than last year`,
      definition: "Each person who gave to both campaigns and gave less this time: this time minus last time." }),
    reason("more", "Gave more than last year", more, {
      phrase: `${spell(n(more))} ${n(more) === 1 ? "donor" : "donors"} gave more than last year`,
      definition: "Each person who gave to both campaigns and gave more this time: this time minus last time." }),
    reason("new", "New donors", newcomers, {
      phrase: `${spell(n(newcomers))} new ${n(newcomers) === 1 ? "donor" : "donors"} gave`,
      definition: "Each person whose first gift to the organisation came through this campaign, with what they gave." }),
    reason("back", "Donors who skipped last year's campaign", back, {
      phrase: `${spell(n(back))} ${n(back) === 1 ? "donor" : "donors"} who skipped last year's campaign gave`,
      definition: "Each person who had given to the organisation before but not to last year's campaign, with what they gave this time." }),
  ].filter(r => r.count > 0).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

  const thisCents = tg.reduce((s, g) => s + g.cents, 0), lastCents = lg.reduce((s, g) => s + g.cents, 0);
  const diff = thisCents - lastCents;
  // "Mostly because": the largest reason that moved money the same way.
  const top = reasons.find(r => Math.sign(r.cents) === Math.sign(diff)) || null;
  // WHO: the lapsed (and timing) and downgraded donors, ranked by last year's gift.
  const whoRows = [...lapsed, ...timing, ...less].sort((a, b) => b.lastCents - a.lastCents || a.name.localeCompare(b.name));
  const who = whoRows.map(r => ({ donorId: r.donor_id, name: r.name, cents: r.lastCents,
    reason: r.amount < 0 && !less.includes(r) ? `Gave ${fmt(r.lastCents)} last time, nothing yet this time.` : r.detail + "." }));
  const coverage = await contactCoverage(orgId, who.map(w => w.donorId));
  const top5 = who.slice(0, 5);
  return {
    ...subject, compare: { id: p.id, name: p.name },
    facts: {
      campaignName: c.name, compareName: p.name, thisCents, lastCents, differenceCents: diff, lateDays,
      topReason: top ? { label: top.label, cents: top.cents, count: top.count, phrase: top.phrase } : null,
    },
    reasons, who,
    step: top5.length ? { kind: "plan", label: `Plan calls to the top ${spell(top5.length)}`, items: top5.map(w => ({ donorId: w.donorId, name: w.name,
      label: `Call about ${c.name}` })), dueIn: 1 } : null,
    cantSee: coverageLine(coverage, who.length),
  };
}

// ── (b) Who should I call tomorrow morning? ────────────────────────────────
// Five names for the signed-in person (their donors, and the unassigned ones),
// one reason each, ranked by dollars at stake. Somebody already on the Thread
// with an open step is left off: they are already planned.
// PARITY-1 Part C · the floor is the org's (Home's "Calls to make" setting,
// $250 until somebody changes it), so this answer and the Home panel name the
// same size of gift. The window is shared with the panel too.
const BIG_GIFT_FLOOR_CENTS = 25000;
const BIG_GIFT_DAYS = 60;
async function orgCallFloorCents(orgId) {
  const [o] = await query(`SELECT call_gift_floor_cents FROM orgs WHERE id = ?`, [orgId]);
  const v = o && o.call_gift_floor_cents != null ? Number(o.call_gift_floor_cents) : null;
  return v && v > 0 ? v : BIG_GIFT_FLOOR_CENTS;
}
async function call(orgId, { user } = {}, deps = {}) {
  const t = await today(orgId);
  const tomorrow = orgTime.addDays(t, 1);
  const H = await homeNote();
  const ago = d => whenPhrase(H, d, t);
  const people = await query(`SELECT d.id, d.name FROM donors d
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND COALESCE(d.deceased,false) = false AND COALESCE(d.do_not_contact,false) = false
       AND COALESCE(d.kind,'') <> 'anonymous' AND (d.assigned_to = ? OR d.assigned_to IS NULL OR d.assigned_to = '')
       AND NOT EXISTS (SELECT 1 FROM threads th WHERE th.org_id = d.org_id AND th.donor_id = d.id AND th.closed_at IS NULL)`, [orgId, user || ""]);
  const inScope = new Map(people.map(p => [p.id, p.name]));
  const cands = [];   // { kind, donorId, name, cents, date, reason }
  const push = (kind, donorId, cents, date, why) => { if (inScope.has(donorId)) cands.push({ kind, donorId, name: inScope.get(donorId), cents, date, reason: why }); };

  // A big gift not yet thanked: a live gift (never an import) in the last 60
  // days, at least $250 and at least the org's own 75th percentile gift.
  const [p75] = await query(`SELECT COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount), 0) AS v FROM gifts
     WHERE org_id = ? AND amount > 0 AND LEFT(date,10) >= ?`, [orgId, orgTime.addDays(t, -730)]);
  const orgFloor = await orgCallFloorCents(orgId);
  const floor = Math.max(orgFloor, toC(p75 && p75.v));
  for (const g of await query(`SELECT id, donor_id, amount, LEFT(date,10) AS date FROM gifts
     WHERE org_id = ? AND import_id IS NULL AND COALESCE(acknowledgement_sent,false) = false AND amount * 100 >= ?
       AND LEFT(date,10) >= ? AND LEFT(date,10) <= ?`, [orgId, floor, orgTime.addDays(t, -BIG_GIFT_DAYS), t]))
    push("thank", g.donor_id, toC(g.amount), g.date, `Gave ${fmt(toC(g.amount))} ${ago(g.date)} and hasn't been thanked yet.`);
  // An open ask past its expected date.
  for (const o of await query(`SELECT id, donor_id, name, target_amount, expected_close::text AS due FROM opportunities
     WHERE org_id = ? AND status = 'open' AND expected_close IS NOT NULL AND expected_close < ?::date`, [orgId, tomorrow]))
    push("ask", o.donor_id, toC(o.target_amount), o.due, `The ${fmt(toC(o.target_amount))} ask${o.name ? ` for ${o.name}` : ""} was expected ${ago(o.due)} and is still open.`);
  // A monthly card that failed: a year of that gift is what is at stake.
  for (const s of await query(`SELECT donor_id, amount, interval, COALESCE(last_failed_at, first_failed_at)::date::text AS failed FROM recurring_subscriptions
     WHERE org_id = ? AND status IN ('past_due','recovering')`, [orgId])) {
    const yearly = toC(s.amount) * (s.interval === "year" ? 1 : s.interval === "week" ? 52 : 12);
    push("card", s.donor_id, yearly, s.failed, `Their ${fmt(toC(s.amount))} ${s.interval === "year" ? "yearly" : "monthly"} card failed ${ago(s.failed)}; ${fmt(yearly)} a year rides on it.`);
  }
  // A meeting tomorrow (on this person's calendar). At stake: what they gave in
  // the last twelve months.
  const meetings = await query(`SELECT DISTINCT unnest(c.person_ids) AS donor_id, c.title FROM calendar_events c
     WHERE c.org_id = ? AND c.dismissed_at IS NULL AND (c.owner_user_id = ? OR ? = '')
       AND TO_CHAR(c.starts_at AT TIME ZONE COALESCE((SELECT NULLIF(timezone,'') FROM orgs WHERE id = c.org_id),'America/New_York'), 'YYYY-MM-DD') = ?`,
    [orgId, user || "", user || "", tomorrow]);
  if (meetings.length) {
    const yr = new Map((await query(`SELECT donor_id, SUM(amount)::text AS s FROM gifts WHERE org_id = ? AND donor_id = ANY(?) AND LEFT(date,10) > ? GROUP BY 1`,
      [orgId, meetings.map(m => m.donor_id), orgTime.addDays(t, -365)])).map(r => [r.donor_id, toC(r.s)]));
    for (const m of meetings) push("meeting", m.donor_id, yr.get(m.donor_id) || 0, tomorrow,
      `You meet them tomorrow${m.title ? ` (${m.title})` : ""}; they gave ${fmt(yr.get(m.donor_id) || 0)} in the last twelve months.`);
  }
  // Gave last year in this month, and nothing since.
  const ly = `${Number(t.slice(0, 4)) - 1}${t.slice(4, 7)}`;
  for (const g of await query(`SELECT donor_id, SUM(amount)::text AS s, MAX(LEFT(date,10)) AS d FROM gifts g
     WHERE org_id = ? AND LEFT(date,7) = ? AND amount > 0
       AND NOT EXISTS (SELECT 1 FROM gifts h WHERE h.org_id = g.org_id AND h.donor_id = g.donor_id AND LEFT(h.date,7) > ?)
     GROUP BY donor_id`, [orgId, ly, ly]))
    push("season", g.donor_id, toC(g.s), g.d, `Gave ${fmt(toC(g.s))} in ${monthOf(ly + "-01")} last year and nothing since.`);
  // A donor drifting from their own rhythm (drift.js, high or medium
  // confidence, not already handled by a recent contact).
  if (deps.computeDriftForDonors) {
    const { map } = await deps.computeDriftForDonors(orgId);
    for (const [id, a] of map) if (a && a.state === "drifting" && !a.handled)
      push("drift", id, toC(a.usualGift), a.lastGiftDate, plain(a.reason || "Past their usual gap between gifts."));
  }
  // One reason per person: the one with the most at stake.
  const best = new Map();
  for (const x of cands) { const b = best.get(x.donorId); if (!b || x.cents > b.cents) best.set(x.donorId, x); }
  const ranked = [...best.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  // A MORNING, NOT A LEAGUE TABLE. The largest of each kind of reason first,
  // so five big thank-yous never crowd out a failed card; the rest by dollars.
  // The five are then shown largest first.
  const five = [];
  for (const x of ranked) if (five.length < 5 && !five.some(y => y.kind === x.kind)) five.push(x);
  for (const x of ranked) if (five.length < 5 && !five.includes(x)) five.push(x);
  five.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const LABEL = { thank: "A big gift not yet thanked", ask: "An open ask past its expected date", card: "A monthly card that failed",
    meeting: "A meeting tomorrow", season: "Gave in this month last year, nothing since", drift: "Drifting from their own rhythm" };
  const DEF = { thank: `A gift made in Steward (not imported) in the last ${BIG_GIFT_DAYS} days, at least ${fmt(orgFloor)} and at least your own 75th percentile gift, with no thank-you marked. At stake: the gift.`,
    ask: "An open ask whose expected date has passed. At stake: the amount asked.",
    card: "A recurring gift whose card payment failed and has not recovered. At stake: a year of that gift.",
    meeting: "A meeting on your calendar tomorrow with this person. At stake: what they gave in the last twelve months.",
    season: "Somebody who gave in this calendar month last year and has given nothing since. At stake: what they gave that month.",
    drift: "Somebody past their own usual gap between gifts (the drift rule). At stake: their usual gift." };
  const STEP = { thank: "Call to thank them", ask: "Call about the open ask", card: "Call about the card", meeting: "Prepare for tomorrow's meeting",
    season: "Call before their usual gift", drift: "Call to check in" };
  const reasons = Object.keys(LABEL).map(k => {
    const rs = five.filter(x => x.kind === k).map(x => row(x.donorId, "donor", x.donorId, x.name, x.date, x.cents, x.reason));
    return reason(k, LABEL[k], rs, { phrase: LABEL[k].toLowerCase(), definition: DEF[k] });
  }).filter(r => r.count > 0).sort((a, b) => b.cents - a.cents);
  const atStake = five.reduce((s, x) => s + x.cents, 0);
  const mine = user ? (await query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ? AND assigned_to = ? AND deleted_at IS NULL`, [orgId, user]))[0].n : 0;
  return {
    facts: { count: five.length, atStakeCents: atStake, first: five[0] ? { name: five[0].name, reason: five[0].reason, cents: five[0].cents } : null,
      kinds: five.map(x => x.kind), tomorrow },
    reasons,
    who: five.map(x => ({ donorId: x.donorId, name: x.name, cents: x.cents, reason: x.reason, kind: x.kind })),
    step: five.length ? { kind: "plan", label: five.length === 1 ? "Put this call on tomorrow's Thread" : `Put all ${spell(five.length)} on tomorrow's Thread`,
      items: five.map(x => ({ donorId: x.donorId, name: x.name, label: STEP[x.kind] })), dueIn: 1 } : null,
    cantSee: !mine && user ? "None of your donors are assigned to you yet, so this looks across everyone who is unassigned."
      : five.length && five.length < 5 ? `Only ${spell(five.length)} ${five.length === 1 ? "person stands" : "people stand"} out; nothing else pressing is on file.` : null,
  };
}

// ── (c) Why is retention down this year? ───────────────────────────────────
// Last year's donors who have given this year, against the same measure a year
// earlier TO THE SAME DAY, so a part-year is never compared with a whole one.
// Split three ways, each a reason: first-year against repeat donors, monthly
// against one-time, and by how they first gave. Ranked by donors lost.
function channelOf(g) {
  if (g.event_id) return "At an event";
  if (g.giving_page_id || g.stripe_payment_id || /card|online|stripe|paypal/i.test(g.payment_method || "")) return "Online";
  if (/che(ck|que)/i.test(g.payment_method || "")) return "By cheque";
  return "Another way";
}
async function retentionCohort(orgId, year, md) {
  const gifts = await query(`SELECT donor_id, LEFT(date,10) AS date, amount, event_id, giving_page_id, stripe_payment_id, payment_method, recurring_subscription_id
       FROM gifts g WHERE g.org_id = ? AND amount > 0
        AND EXISTS (SELECT 1 FROM donors d WHERE d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL)
      ORDER BY date, id`, [orgId]);
  const y = String(year), py = String(year - 1);
  const first = new Map(), base = new Map(), kept = new Set();
  for (const g of gifts) {
    if (!first.has(g.donor_id)) first.set(g.donor_id, g);
    if (g.date.slice(0, 4) === py) {
      const b = base.get(g.donor_id) || { cents: 0, last: g.date, monthly: false };
      b.cents += toC(g.amount); b.last = g.date; if (g.recurring_subscription_id) b.monthly = true;
      base.set(g.donor_id, b);
    }
    if (g.date.slice(0, 4) === y && g.date.slice(5) <= md) kept.add(g.donor_id);
  }
  return { first, base, kept };
}
async function retention(orgId) {
  const t = await today(orgId);
  const Y = Number(t.slice(0, 4)), md = t.slice(5);
  const now = await retentionCohort(orgId, Y, md), prev = await retentionCohort(orgId, Y - 1, md);
  const subs = new Set((await query(`SELECT DISTINCT donor_id FROM recurring_subscriptions WHERE org_id = ?`, [orgId])).map(r => r.donor_id));
  const names = new Map((await query(`SELECT id, name FROM donors WHERE org_id = ? AND deleted_at IS NULL`, [orgId])).map(r => [r.id, r.name]));
  const segs = (C, yr) => {
    const out = {};
    for (const [id, b] of C.base) {
      const f = C.first.get(id);
      const keys = [
        f && f.date.slice(0, 4) === String(yr - 1) ? "firstYear" : "repeat",
        b.monthly || subs.has(id) ? "monthly" : "oneTime",
        "via:" + channelOf(f || {}),
      ];
      for (const k of keys) { const s = out[k] = out[k] || { base: [], lost: [] }; s.base.push(id); if (!C.kept.has(id)) s.lost.push(id); }
    }
    return out;
  };
  const S = segs(now, Y), P = segs(prev, Y - 1);
  const rate = (k, X) => (X.base.size ? Math.round((100 * [...X.base.keys()].filter(id => X.kept.has(id)).length) / X.base.size) : null);
  const LABEL = { firstYear: "First-year donors", repeat: "Repeat donors", monthly: "Monthly donors", oneTime: "One-time donors" };
  const labelOf = k => LABEL[k] || `Donors who first gave ${k.slice(4).toLowerCase()}`;
  const reasons = Object.entries(S).map(([k, s]) => {
    const ps = P[k];
    const r = s.base.length ? Math.round(100 * (s.base.length - s.lost.length) / s.base.length) : null;
    const pr = ps && ps.base.length ? Math.round(100 * (ps.base.length - ps.lost.length) / ps.base.length) : null;
    const rows = s.lost.map(id => { const b = now.base.get(id); return row(id, "donor", id, names.get(id) || "", b.last, b.cents, `Gave ${fmt(b.cents)} last year, nothing yet this year`); })
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.amount - a.amount);
    const label = labelOf(k);
    return { ...reason(k.replace(":", "-").replace(/\s+/g, "_"), label, rows, { measure: "count",
      phrase: `${label.toLowerCase()}, ${s.lost.length} of ${s.base.length} not back${pr != null ? ` (${r}% kept against ${pr}% a year ago)` : ""}`,
      definition: `Each of last year's ${label.toLowerCase()} who has not given this year, to today's date, with what they gave last year. Most recent first.` }),
      base: s.base.length, rate: r, prevRate: pr };
  }).filter(r => r.count > 0).sort((a, b) => b.count - a.count || b.cents - a.cents);
  // The dimensions overlap (a first-year donor is also monthly or one-time),
  // so the reasons are not added together; each says which group lost most.
  const lostAll = [...now.base.keys()].filter(id => !now.kept.has(id));
  const who = lostAll.map(id => { const b = now.base.get(id); return { donorId: id, name: names.get(id) || "", cents: b.cents, last: b.last,
    reason: `Gave ${fmt(b.cents)} last year, most recently in ${monthOf(b.last)}, and nothing yet this year.` }; })
    .sort((a, b) => b.last.localeCompare(a.last) || b.cents - a.cents);
  const thisRate = rate(null, now), prevRate = rate(null, prev);
  const ids = who.map(w => w.donorId);
  return {
    facts: { rate: thisRate, prevRate, lastYearDonors: now.base.size, lostDonors: lostAll.length,
      topReason: reasons[0] ? { label: reasons[0].label, count: reasons[0].count, base: reasons[0].base, phrase: reasons[0].phrase } : null },
    reasons, who,
    // The ten most recent: a journey is a commitment of somebody's time, and
    // these are the ones whose giving is freshest.
    step: ids.length ? { kind: "journey", preset: "welcome_back", label: `Start the Welcome back journey for the ${ids.length >= 10 ? "ten" : spell(ids.length)} most recent`, donorIds: ids.slice(0, 10),
      fallback: { kind: "plan", items: who.slice(0, 5).map(w => ({ donorId: w.donorId, name: w.name, label: "Call to reconnect" })), dueIn: 1 } } : null,
    cantSee: now.base.size && now.base.size < 30
      ? `Only ${now.base.size} people gave last year, so a few donors move this rate a lot.`
      : `The year is not over; this compares with the same day a year ago, not with last year's final rate.`,
  };
}

// ── (d) Why did <donor> stop giving? ───────────────────────────────────────
// Only facts that are on their record, each dated before or around the last
// gift. A fact that is not there is not said.
async function stopped(orgId, { donor } = {}) {
  const [d] = await query(`SELECT id, name, email, stage, updated_at FROM donors WHERE org_id = ? AND id = ? AND deleted_at IS NULL`, [orgId, donor || ""]);
  if (!d) return null;
  const t = await today(orgId);
  const H = await homeNote();
  const gifts = await query(`SELECT id, LEFT(date,10) AS date, amount, acknowledgement_sent FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0 ORDER BY date DESC, id`, [orgId, d.id]);
  const subject = { donor: { id: d.id, name: d.name } };
  if (!gifts.length) return { ...subject, facts: { name: d.name, lastGift: null }, reasons: [], who: [], step: null, cantSee: null };
  const last = gifts[0];
  const maxC = Math.max(...gifts.map(g => toC(g.amount)));
  const reasons = [];
  // A card that failed.
  const subs = await query(`SELECT id, amount, status, COALESCE(last_failed_at, first_failed_at)::date::text AS failed FROM recurring_subscriptions
     WHERE org_id = ? AND donor_id = ? AND (first_failed_at IS NOT NULL OR status IN ('past_due','recovering','canceled','lost'))`, [orgId, d.id]);
  const failed = subs.filter(s => s.failed);
  if (failed.length) reasons.push(reason("card", "A card payment failed", failed.map(s => row(s.id, "subscription", d.id, d.name, s.failed, toC(s.amount), `Recurring ${fmt(toC(s.amount))}, ${s.status.replace("_", " ")}`)), {
    measure: "count", phrase: `their recurring card failed ${whenPhrase(H, failed[0].failed, t)}`,
    definition: "Each recurring gift of theirs whose card payment failed." }));
  // Email bouncing.
  if (d.email) {
    const sup = await query(`SELECT id, reason, created_at::date::text AS date FROM email_suppressions WHERE org_id = ? AND lower(email) = lower(?)`, [orgId, d.email]);
    if (sup.length) reasons.push(reason("email", "Their email stopped reaching them", sup.map(s => row(s.id, "suppression", d.id, d.name, s.date, null, s.reason || "Suppressed")), {
      measure: "count", phrase: "their email address stopped accepting mail", definition: "Their email address on Steward's suppression list: a bounce, a complaint or an unsubscribe." }));
  }
  // No thank-you on the last gift.
  if (!last.acknowledgement_sent) reasons.push(reason("thanks", "No thank-you on the last gift", [row(last.id, "gift", d.id, d.name, last.date, toC(last.amount), "Not marked thanked")], {
    measure: "count", phrase: `their last gift of ${fmt(toC(last.amount))} was never marked thanked`, definition: "Their most recent gift, which has no thank-you marked." }));
  // An ask bigger than any gift they had made.
  const asks = await query(`SELECT id, name, target_amount, created_at::date::text AS date FROM opportunities WHERE org_id = ? AND donor_id = ? AND target_amount * 100 > ?`, [orgId, d.id, maxC]);
  if (asks.length) reasons.push(reason("ask", "Asked for more than they had ever given", asks.map(o => row(o.id, "ask", d.id, d.name, o.date, toC(o.target_amount), o.name || "Ask")), {
    measure: "count", phrase: `they were asked for ${fmt(toC(asks[0].target_amount))}, more than their largest gift of ${fmt(maxC)}`,
    definition: "Each ask of theirs for more than the largest gift they had made." }));
  // No contact for months before the last gift, or since.
  const contact = await query(`SELECT id, type, LEFT(date,10) AS date FROM interactions WHERE org_id = ? AND donor_id = ? AND type IN ('call','meeting','email','stewardship') ORDER BY date DESC LIMIT 5`, [orgId, d.id]);
  const lastContact = contact[0] ? contact[0].date : null;
  const months = Math.floor(orgTime.daysBetween(lastContact || gifts[gifts.length - 1].date, t) / 30);
  if (months >= 6) reasons.push(reason("contact", lastContact ? `No contact in ${months} months` : "No contact ever logged", contact.map(i => row(i.id, "interaction", d.id, d.name, i.date, null, i.type)), {
    measure: "count", phrase: lastContact ? `nobody has been in touch for ${months} months` : "no conversation with them was ever logged",
    definition: "Their logged calls, meetings and emails, most recent first." }));
  const step = failed.length ? { kind: "plan", label: "Plan a call about the card", items: [{ donorId: d.id, name: d.name, label: "Call about the card" }], dueIn: 1 }
    : !last.acknowledgement_sent ? { kind: "log", label: "Log the thank-you you make", donorId: d.id, name: d.name }
    : { kind: "plan", label: "Plan a call to reconnect", items: [{ donorId: d.id, name: d.name, label: "Call to reconnect" }], dueIn: 1 };
  return {
    ...subject,
    facts: { name: d.name, lastGift: { cents: toC(last.amount), date: last.date }, lastGiftPhrase: `${fmt(toC(last.amount))} ${whenPhrase(H, last.date, t)}`,
      reasons: reasons.map(r => ({ label: r.label, phrase: r.phrase })) },
    reasons, who: [{ donorId: d.id, name: d.name, cents: toC(last.amount), reason: `Last gave ${fmt(toC(last.amount))} ${whenPhrase(H, last.date, t)}.` }],
    step,
    cantSee: "Steward sees gifts, logged contact, asks and mail; a conversation nobody logged is not here.",
  };
}

// ── (e) Who is about to lapse, and why? ────────────────────────────────────
// Donors past their own usual gap (drift.js, the one definition), each with
// drift's own sentence. Split by how sure the pattern is.
async function lapse(orgId, deps = {}) {
  if (!deps.computeDriftForDonors) throw new Error("lapse needs the drift engine");
  const { map } = await deps.computeDriftForDonors(orgId);
  const names = new Map((await query(`SELECT id, name FROM donors WHERE org_id = ? AND deleted_at IS NULL`, [orgId])).map(r => [r.id, r.name]));
  const all = [...map.entries()].filter(([, a]) => a && a.state === "drifting")
    .map(([id, a]) => ({ donorId: id, name: names.get(id) || "", cents: toC(a.usualGift), reason: plain(a.reason), confidence: a.confidence, last: a.lastGiftDate }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const rowsOf = xs => xs.map(x => row(x.donorId, "donor", x.donorId, x.name, x.last, x.cents, x.reason));
  const high = all.filter(x => x.confidence === "high"), medium = all.filter(x => x.confidence !== "high");
  const reasons = [
    reason("clear", "Past a clear giving pattern", rowsOf(high), { phrase: "a clear giving pattern", definition: "Each donor past their own usual gap between gifts, whose gifts come at a steady rhythm. With their usual gift." }),
    reason("early", "Early signs", rowsOf(medium), { phrase: "early signs", definition: "Each donor past their usual gap whose pattern is less certain (two gifts, or an uneven rhythm). With their usual gift." }),
  ].filter(r => r.count > 0).sort((a, b) => b.cents - a.cents);
  const usual = all.reduce((s, x) => s + x.cents, 0);
  return {
    facts: { count: all.length, usualCents: usual, atRiskCents: usual, first: all[0] ? { name: all[0].name } : null },
    reasons, who: all.map(x => ({ donorId: x.donorId, name: x.name, cents: x.cents, reason: x.reason })),
    step: all.length ? { kind: "plan", label: `Plan calls to the top ${spell(Math.min(5, all.length))}`, items: all.slice(0, 5).map(x => ({ donorId: x.donorId, name: x.name, label: "Call to check in" })), dueIn: 1 } : null,
    cantSee: medium.length ? `${cap(spell(medium.length))} of these ${medium.length === 1 ? "has" : "have"} an uneven or short record, so their usual gap is a best reading.` : null,
  };
}

// ── (f) Which volunteers should we ask to give? ────────────────────────────
// People with the volunteer type, hours on file and no gift ever, ranked by
// hours this year and then how recently they served. Who knows them best: the
// staff member who logged most of their hours, else the volunteer coordinator.
async function volunteers(orgId) {
  const t = await today(orgId);
  const Y = t.slice(0, 4);
  const vs = await query(`SELECT d.id, d.name, d.assigned_to,
       COALESCE(SUM(s.hours) FILTER (WHERE LEFT(s.date,4) = ?), 0)::numeric AS hours_year,
       COALESCE(SUM(s.hours), 0)::numeric AS hours_all, MAX(LEFT(s.date,10)) AS last_served,
       EXISTS (SELECT 1 FROM interactions i WHERE i.org_id = d.org_id AND i.donor_id = d.id AND i.type IN ('ask','solicitation'))
         OR EXISTS (SELECT 1 FROM opportunities o WHERE o.org_id = d.org_id AND o.donor_id = d.id) AS asked
     FROM donors d JOIN volunteer_shifts s ON s.person_id = d.id AND s.org_id = d.org_id
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.person_types @> '["volunteer"]'::jsonb
       AND COALESCE(d.deceased,false) = false AND COALESCE(d.do_not_contact,false) = false AND COALESCE(d.do_not_solicit,false) = false
       AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id)
     GROUP BY d.id, d.name, d.assigned_to HAVING SUM(s.hours) > 0`, [Y, orgId]);
  const ids = vs.map(v => v.id);
  const loggers = ids.length ? await query(`SELECT s.person_id, s.created_by, u.name, COUNT(*)::int AS n FROM volunteer_shifts s
     JOIN users u ON u.id = s.created_by AND u.org_id = s.org_id
     WHERE s.org_id = ? AND s.person_id = ANY(?) GROUP BY 1,2,3 ORDER BY n DESC, u.name`, [orgId, ids]) : [];
  const [coord] = await query(`SELECT id, name FROM users WHERE org_id = ? AND role = 'volunteer_coordinator' ORDER BY created_at LIMIT 1`, [orgId]);
  const users = new Map((await query(`SELECT id, name FROM users WHERE org_id = ?`, [orgId])).map(u => [u.id, u.name]));
  const knows = id => {
    const l = loggers.find(x => x.person_id === id);
    if (l) return { id: l.created_by, name: l.name, why: `logged ${l.n === 1 ? "their shift" : `${l.n} of their shifts`}` };
    const v = vs.find(x => x.id === id);
    if (v && v.assigned_to && users.has(v.assigned_to)) return { id: v.assigned_to, name: users.get(v.assigned_to), why: "is assigned to them" };
    if (coord) return { id: coord.id, name: coord.name, why: "is the volunteer coordinator" };
    return null;
  };
  const H = await homeNote();
  const all = vs.map(v => {
    const hy = Number(v.hours_year), k = knows(v.id);
    const served = v.last_served ? `served ${H.agoPhrase(orgTime.daysBetween(v.last_served, t))}` : "";
    return { donorId: v.id, name: v.name, hours: hy, hoursAll: Number(v.hours_all), last: v.last_served, asked: v.asked, knows: k,
      reason: `${cap(`${hy} hours this year, ${served}, ${v.asked ? "asked before" : "never asked"}`)}.` };
  }).sort((a, b) => b.hours - a.hours || String(b.last).localeCompare(String(a.last)) || a.name.localeCompare(b.name));
  const rowsOf = xs => xs.map(x => row(x.donorId, "volunteer", x.donorId, x.name, x.last, null, x.reason));
  const recent = all.filter(x => x.last && orgTime.daysBetween(x.last, t) <= 30);
  const reasons = [
    reason("never", "Served and never given", rowsOf(all), { measure: "count", phrase: "served and never given", definition: "Each volunteer with hours on file and no gift ever. Most hours this year first." }),
    reason("recent", "Served in the last 30 days", rowsOf(recent), { measure: "count", phrase: "served in the last 30 days", definition: "Each of them who served in the last 30 days." }),
    reason("notAsked", "Never asked", rowsOf(all.filter(x => !x.asked)), { measure: "count", phrase: "never asked", definition: "Each of them with no ask logged and no proposal ever opened." }),
  ].filter(r => r.count > 0);
  const top = all.slice(0, 5);
  const noLogger = all.length && !loggers.length;
  return {
    facts: { count: all.length, first: all[0] ? { name: all[0].name, hours: all[0].hours } : null },
    reasons,
    who: all.map(x => ({ donorId: x.donorId, name: x.name, cents: null, hours: x.hours, reason: x.reason,
      knows: x.knows ? { userId: x.knows.id, name: x.knows.name, why: x.knows.why } : null })),
    step: top.length ? { kind: "plan", label: `Plan a personal ask for the top ${spell(top.length)}`, dueIn: 7,
      items: top.map(x => ({ donorId: x.donorId, name: x.name, label: "Personal ask to give", ownerId: x.knows ? x.knows.id : null, ownerName: x.knows ? x.knows.name : null })) } : null,
    cantSee: noLogger ? "Their hours were not logged by a staff member, so Steward can't tell who knows them best; it names the coordinator or their owner instead." : null,
  };
}

// ── (g) Which first-time donors need a second ask? ─────────────────────────
// First gift ever in the last 90 days, no second gift, no call or meeting
// logged since. Split by whether the first gift was thanked at all.
async function second(orgId) {
  const t = await today(orgId);
  const since = orgTime.addDays(t, -90);
  const rows = await query(`SELECT d.id, d.name, MIN(LEFT(g.date,10)) AS first, SUM(g.amount)::text AS s, COUNT(*)::int AS n,
       BOOL_OR(COALESCE(g.acknowledgement_sent,false)) AS thanked
     FROM donors d JOIN gifts g ON g.donor_id = d.id AND g.org_id = d.org_id AND g.amount > 0
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND COALESCE(d.deceased,false) = false AND COALESCE(d.do_not_contact,false) = false
       AND COALESCE(d.kind,'') NOT IN ('organisation','anonymous')
     GROUP BY d.id, d.name HAVING COUNT(*) = 1 AND MIN(LEFT(g.date,10)) >= ?`, [orgId, since]);
  const called = rows.length ? new Set((await query(`SELECT DISTINCT i.donor_id FROM interactions i WHERE i.org_id = ? AND i.donor_id = ANY(?) AND i.type IN ('call','meeting')`,
    [orgId, rows.map(r => r.id)])).map(r => r.donor_id)) : new Set();
  const H = await homeNote();
  const all = rows.filter(r => !called.has(r.id)).map(r => ({ donorId: r.id, name: r.name, cents: toC(r.s), first: r.first, thanked: r.thanked,
    reason: `First gift of ${fmt(toC(r.s))} ${H.agoPhrase(orgTime.daysBetween(r.first, t))}; ${r.thanked ? "thanked, but no call" : "not thanked yet"}, no second gift.` }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const rowsOf = xs => xs.map(x => row(x.donorId, "donor", x.donorId, x.name, x.first, x.cents, x.reason));
  const reasons = [
    reason("unthanked", "Not thanked at all", rowsOf(all.filter(x => !x.thanked)), { phrase: "not thanked at all", definition: "Each first-time donor from the last 90 days whose gift has no thank-you marked, with their first gift." }),
    reason("noCall", "Thanked, but no call", rowsOf(all.filter(x => x.thanked)), { phrase: "thanked but never called", definition: "Each first-time donor from the last 90 days who was thanked but has no call or meeting logged, with their first gift." }),
  ].filter(r => r.count > 0).sort((a, b) => b.cents - a.cents);
  const total = all.reduce((s, x) => s + x.cents, 0);
  return {
    facts: { count: all.length, firstCents: total, first: all[0] ? { name: all[0].name, cents: all[0].cents } : null },
    reasons, who: all.map(x => ({ donorId: x.donorId, name: x.name, cents: x.cents, reason: x.reason })),
    step: all.length ? { kind: "plan", label: `Plan the thank-you call for the top ${spell(Math.min(5, all.length))}`, dueIn: 1,
      items: all.slice(0, 5).map(x => ({ donorId: x.donorId, name: x.name, label: "Thank-you call" })) } : null,
    cantSee: all.length && !called.size ? "No calls with these donors are logged, so a thank-you call that happened may simply not be on file." : null,
  };
}

const ANSWERS = { appeal, call, retention, stopped, lapse, volunteers, second };

// The answer for one question, with the drift engine handed in (it lives in
// server.js and is the only integration point for drift).
async function answer(orgId, key, ctx = {}, deps = {}) {
  const fn = ANSWERS[key];
  if (!fn) return null;
  return key === "lapse" ? fn(orgId, deps) : fn(orgId, ctx, deps);
}

module.exports = { answer, defaultCampaign, ANSWERS, sumRows, BIG_GIFT_FLOOR_CENTS, BIG_GIFT_DAYS, orgCallFloorCents };
