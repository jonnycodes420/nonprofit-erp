// shared/homeLead.js · HOME-2. WHAT LEADS HOME TODAY, AND WHY.
//
// Home has a fixed frame (the day, Ask, the Thread, the Today rail) and one
// slot at the top that changes with the day: the one or two things that
// matter most for the person signed in, each with one line saying why it is
// there. This module decides what goes in it. It is PURE, like threadRank.js:
// no clock, no DB, no imports. routes/homeLead.js reads the facts and passes
// them in; this scores them, writes the template sentences and orders the rail.
//
// THE RULES (the same three threadRank.js is built on)
//  1. Every point is named. A card's score is a sum of labelled parts:
//     STAKES (dollars, against the org's own line), TIME (how soon it matters)
//     and UNUSUAL (how different it is from this person's usual).
//  2. Money is relative to the org. `line` is the org's p90 of lifetime
//     giving (majorThreshold); a dollar figure scores against it, never as an
//     absolute amount.
//  3. The score never reaches the screen. The route strips it.
//
// A card is never invented: every one comes from a fact the route read, and
// its sentence is a template over that fact. The lead is never empty: on a
// quiet day it is "Nothing urgent" and three people worth a note.

import { countLabel } from "./countWords.js";
export const KINDS = ["meeting", "gift", "confirm", "drift", "card", "season", "seasonCall", "event", "quiet"];
// A card has to clear this to lead. Below it, the day is quiet.
export const LEAD_FLOOR = 15;
// After this many "Not now"s of one kind, that kind ranks at half for that person.
export const DISMISS_RUN = 3;

const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const rel = (dollars, line) => Math.min(1, Math.max(0, Number(dollars) || 0) / Math.max(Number(line) || 0, 1000));
const first = name => String(name || "").trim().split(/\s+/)[0] || "them";
const plural = countLabel;
const mins = (fromIso, toIso) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000);
const inWords = m => {
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  return `in ${plural(h, "hour", "hours")}`;
};

function card(kind, key, points, body) {
  const score = points.reduce((s, p) => s + p.n, 0);
  return { kind, key, score, points, ...body };
}

// ── EACH KIND OF CARD ─────────────────────────────────────────────────────
function meetingCards(f) {
  return (f.meetings || []).filter(m => m.person && Date.parse(m.startsAt) > Date.parse(f.now)).map(m => {
    const until = mins(f.now, m.startsAt);
    const b = m.brief || {};
    const lifetime = (b.giving && b.giving.lifetime) || 0;
    const ask = (b.openAsk && b.openAsk.amount) || 0;
    const time = until <= 180 ? 50 : until <= 480 ? 30 : 15;
    const stakes = Math.round(30 * rel(lifetime + ask, f.line));
    const big = lifetime >= f.line && f.line > 0;
    const why = until <= 180
      ? `First because it is ${inWords(until)}${big ? `, and ${first(m.person.name)} is one of your largest donors` : ""}${ask ? `, with ${money(ask)} asked and no answer yet` : ""}.`
      : `On your calendar today${big ? `, with one of your largest donors` : ""}.`;
    return card("meeting", "meeting:" + m.id, [{ name: "time", n: time }, { name: "stakes", n: stakes }], {
      eyebrow: `${inWords(until).replace(/^in/, "In")} · ${m.time}${m.location ? " · " + m.location : ""}`,
      title: m.title, why, meetingId: m.id, donorId: m.person.id, donorName: m.person.name, startsAt: m.startsAt,
      // The facts are drawn by VOICE-3's beforeLines(brief), the one list the
      // profile, the calendar and Home share.
      brief: m.brief || null,
    });
  });
}

function giftCards(f) {
  return (f.gifts || []).map(g => {
    const unusual = g.priorMax > 0 && g.amount > g.priorMax ? 15 : g.priorCount === 0 ? 10 : 0;
    const usualX = g.priorMax > 0 ? Math.round((g.amount / g.priorMax) * 10) / 10 : null;
    const parts = [];
    if (g.priorMax > 0 && g.amount > g.priorMax) parts.push(`their largest gift${usualX >= 1.5 ? `, ${usualX} times the one before` : ""}`);
    else if (g.priorCount === 0) parts.push("their first gift");
    parts.push(`received ${g.when}`);
    return card("gift", "gift:" + g.giftId, [{ name: "stakes", n: Math.round(40 * rel(g.amount, f.line)) }, { name: "time", n: 25 }, { name: "unusual", n: unusual }], {
      eyebrow: `A gift arrived · ${g.when}`,
      title: `${g.donorName} gave ${money(g.amount)}. Thank them today.`,
      why: parts.join(", ").replace(/^./, c => c.toUpperCase()) + ". A thank-you sent today keeps the gift-to-thank-you time under a day.",
      giftId: g.giftId, donorId: g.donorId, donorName: g.donorName, amount: g.amount, draftId: g.draftId || null, draft: g.draft || null,
    });
  });
}

function confirmCard(f) {
  const c = f.toConfirm;
  if (!c || !c.count) return [];
  const dollars = c.cents / 100;
  return [card("confirm", "confirm", [{ name: "stakes", n: Math.round(35 * rel(dollars, f.line)) }, { name: "time", n: 10 + (c.count >= 3 ? 5 : 0) }], {
    eyebrow: "Money waiting",
    title: `${plural(c.count, "gift", "gifts")} waiting to be confirmed, ${money(dollars)}`,
    why: `${c.from}. None of it is in your totals until you confirm it.`,
    count: c.count, amount: dollars, lines: c.lines || [],
  })];
}

function driftCards(f) {
  const top = (f.drift || [])[0];
  if (!top) return [];
  return [card("drift", "drift:" + top.donorId, [{ name: "stakes", n: Math.round(30 * rel(top.usualGift, f.line)) }, { name: "time", n: 5 }, { name: "unusual", n: 10 }], {
    eyebrow: "Gone quiet",
    title: `Call ${top.donorName}`,
    why: `${top.reason}${f.driftCount > 1 ? ` The largest of the ${f.driftCount} people drifting${f.role === "officer" ? " in your portfolio" : ""}.` : ""}`,
    donorId: top.donorId, donorName: top.donorName, count: f.driftCount || 1,
  })];
}

function failedCardCards(f) {
  const c = (f.failedCards || [])[0];
  if (!c) return [];
  const yearly = c.interval === "year" ? c.amount : c.amount * 12;
  return [card("card", "card:" + c.subId, [{ name: "stakes", n: Math.round(30 * rel(yearly, f.line)) }, { name: "time", n: c.dunningStep >= 2 ? 20 : 10 }], {
    eyebrow: "A monthly card failed",
    title: `${c.donorName}'s ${money(c.amount)} ${c.interval === "year" ? "yearly" : "monthly"} gift didn't go through`,
    why: `${money(yearly)} a year rides on this card${c.dunningStep >= 2 ? `, and ${c.dunningStep} reminders have already gone` : ""}. A link lets them update it themselves.`,
    donorId: c.donorId, donorName: c.donorName, subId: c.subId,
  })];
}

function seasonCards(f) {
  const s = f.season;
  if (!s || !(s.goal > 0)) return [];
  const gap = Math.max(0, s.goal - s.raised);
  const behind = s.lastYearByToday > (s.seasonThisYear || 0) ? s.lastYearByToday - (s.seasonThisYear || 0) : 0;
  const out = [card("season", "season:" + s.campaignId, [{ name: "time", n: s.daysLeft <= 21 ? 40 : 25 }, { name: "stakes", n: Math.round(40 * rel(gap, f.line)) }], {
    eyebrow: `${s.label} · ${plural(s.daysLeft, "day", "days")} left`,
    title: `${money(s.raised)} of ${money(s.goal)}`,
    why: [s.shareLine,
      s.lapsed.count ? `${plural(s.lapsed.count, "person", "people")} who gave last ${s.lapsedSeason}${f.role === "officer" ? " in your portfolio" : ""} haven't given this year. They gave ${money(s.lapsed.total)} then.` : null,
    ].filter(Boolean).join(" "),
    campaignId: s.campaignId, goal: s.goal, raised: s.raised, behind,
    lapsedCount: s.lapsed.count, lapsedTotal: s.lapsed.total,
  })];
  const p = s.lapsed.top && s.lapsed.top[0];
  if (p) out.push(card("seasonCall", "seasonCall:" + p.donorId, [{ name: "stakes", n: Math.round(30 * rel(p.amount, f.line)) }, { name: "time", n: s.daysLeft <= 21 ? 20 : 10 }], {
    eyebrow: `The first of the ${s.lapsed.count}`,
    title: `Call ${p.name}`,
    why: `${money(p.amount)} last ${s.lapsedSeason}, the largest of the ${s.lapsed.count}. Nothing yet this year.`,
    donorId: p.donorId, donorName: p.name,
  }));
  return out;
}

function eventCards(f) {
  return (f.events || []).filter(e => e.daysAway >= 0 && e.daysAway <= 7).slice(0, 1).map(e =>
    card("event", "event:" + e.id, [{ name: "time", n: Math.max(5, 30 - 3 * e.daysAway) }, { name: "stakes", n: Math.round(10 * rel(e.unpaidAmount, f.line)) + (e.unpaid ? 10 : 0) }], {
      eyebrow: e.daysAway === 0 ? "Today" : e.daysAway === 1 ? "Tomorrow" : `This week · ${e.dayName}`,
      title: e.name,
      why: `${plural(e.guests, "guest", "guests")}${e.capacity ? ` of ${e.capacity} places` : ""}${e.unpaid ? `, ${e.unpaid} not paid yet` : ""}.`,
      eventId: e.id,
    }));
}

function quietCard(f) {
  const people = (f.quiet || []).slice(0, 3);
  return card("quiet", "quiet", [], {
    eyebrow: "A quiet day",
    title: people.length ? `Nothing urgent. Here ${people.length === 1 ? "is one person" : `are ${people.length} people`} worth a note this week.` : "Nothing urgent today.",
    why: people.length ? "Each gave in the last two years and hasn't heard from you in three months." : "Nothing is waiting on you. The Thread below has your next steps.",
    people,
  });
}

// ── THE DECISION ──────────────────────────────────────────────────────────
export function rankLead(f) {
  const dismissed = f.dismissals || {};
  const all = [...meetingCards(f), ...giftCards(f), ...confirmCard(f), ...driftCards(f), ...failedCardCards(f), ...seasonCards(f), ...eventCards(f)]
    .map(c => (dismissed[c.kind] || 0) >= DISMISS_RUN
      ? { ...c, score: Math.round(c.score / 2), points: [...c.points, { name: "set aside", n: -Math.round(c.score / 2) }] }
      : c)
    .sort((a, b) => b.score - a.score || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const ranked = all.filter(c => c.score >= LEAD_FLOOR);
  // One card of a kind: the second gift waits in the rail, not in the lead.
  const lead = ranked.filter((c, i) => ranked.findIndex(x => x.kind === c.kind) === i).slice(0, 2);
  if (!lead.length) lead.push(quietCard(f));
  return { lead, ranked: all, rail: railOrder(f, lead), doors: doors(f), tries: tries(f), pace: paceLine(f.pace) };
}

// HOME-3 · THE GREETING'S ONE SENTENCE ON PACE. numbers.vsLastYear over the
// org's fiscal year (the number Fundraising and the Board show), in whole
// dollars. "This fiscal year" when the year doesn't start January 1. None
// without a year of history.
export function paceLine(p) {
  if (!p || !(p.lastYear > 0)) return null;
  const diff = Math.round((p.thisYear - p.lastYear) * 100) / 100;
  const subject = p.fiscal ? "Giving this fiscal year" : "Giving this year";
  const even = Math.abs(diff) < Math.max(100, p.lastYear * 0.01);
  const dir = even ? "even" : diff < 0 ? "behind" : "ahead";
  return {
    dir, amount: Math.abs(diff), thisYear: p.thisYear, lastYear: p.lastYear, fiscal: !!p.fiscal, span: p.span, source: p.source,
    lead: `${subject} is `,
    figure: even ? null : money(Math.abs(diff)),
    tail: even ? "on pace with last year at this point." : dir === "behind" ? " behind last year at this point." : " ahead of last year at this point.",
    after: dir === "behind" ? "Here's where most of it comes back." : null,
    line: even ? `${subject} is on pace with last year at this point.` : `${subject} is ${money(Math.abs(diff))} ${dir === "behind" ? "behind" : "ahead of"} last year at this point.`,
    definition: p.definition || "Giving since the year began, against the same days last year.",
  };
}

// The Today rail reorders the same way: a meeting soon goes to the top, the
// gift-to-thank-you tile drops below the numbers when nothing is waiting.
export function railOrder(f, lead) {
  const soon = (f.meetings || []).some(m => { const m2 = mins(f.now, m.startsAt); return m2 > 0 && m2 <= 180; });
  const waiting = (f.gifts || []).length > 0 || ((f.toConfirm && f.toConfirm.count) || 0) > 0;
  const order = [];
  if (soon) order.push("meetings");
  if (waiting) order.push("thankClock");
  order.push("mailbox");
  if (!soon) order.push("meetings");
  order.push("firstThing", "tiles");
  if (!waiting) order.push("thankClock");
  return order;
}

// Why and What show only when there is something to say. Otherwise the two
// doors fold into Ask's suggestions.
export function doors(f) {
  const c = f.compare;
  if (!c || !(c.lastYear > 0)) return { why: null, what: null };
  const diff = c.thisYear - c.lastYear;
  const share = Math.abs(diff) / c.lastYear;
  if (share < 0.05 || Math.abs(diff) < 500) return { why: null, what: null };
  return diff < 0
    ? { why: { line: `${c.label} is ${money(-diff)} behind last year at this point.`, question: (c.question && c.question.why) || "Why are we behind last year?" }, what: null }
    : { why: null, what: { line: `${c.label} is ${money(diff)} ahead of last year at this point.`, question: (c.question && c.question.what) || "What is working this year?" } };
}

export function tries(f) {
  if (f.season) return ["Who gave last December but not this one?", "How much is left on the year-end goal?", "Who should I call today?"];
  const t = ["Who should I call this week?", "How is the Annual Fund doing?"];
  const m = (f.meetings || []).find(x => x.person);
  if (m) t.push(`What did ${first(m.person.name)} give last year?`);
  else if ((f.gifts || [])[0]) t.push("Who hasn't been thanked yet?");
  else t.push("Who gave this week?");
  return t;
}

// What the screen gets: the cards without their arithmetic.
export function forScreen(out) {
  const strip = c => { const { score, points, ...rest } = c; return rest; };
  return { lead: out.lead.map(strip), rail: out.rail, doors: out.doors, tries: out.tries, pace: out.pace || null };
}
