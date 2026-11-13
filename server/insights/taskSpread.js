// server/insights/taskSpread.js · ASKS-2 item 2. WHEN A CARD'S TASKS ARE DUE, AND WHAT ITS BUTTON SAYS.
//
// The Year-end givers card said "Create tasks for Nov 1" on Nov 12: a button
// named a day already gone, and the tasks it made were due on it. A button
// never names a date in the past. From the day after its date it says "this
// week" (or the one working day it means), and the tasks are due from today,
// spread the way ATLAS-7 spreads a group's first calls: ten people or fewer
// all start on the first working day, more are spread evenly over the next
// ten working days, the earliest days to the largest givers.
//
// ATLAS-7's group ask (server/atlas/groupAsk.js) reads spreadDays and
// spreadSentence from here, so a card and Atlas spread alike.
// Pure: days are 'YYYY-MM-DD' strings, today is a parameter. No clock.
"use strict";

const SPREAD_OVER = 10;           // working days: the next two weeks
const SPREAD_FROM = 10;           // more than this many first calls are spread
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayWord = day => { const d = new Date(day + "T12:00:00Z"); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const shortDay = day => { const d = new Date(day + "T12:00:00Z"); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const isWorkday = day => { const w = new Date(day + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const nextWorkday = day => { let d = day; while (!isWorkday(d)) d = addDays(d, 1); return d; };

// Each person's first day, in order (largest giver first), from `today`.
function spreadDays(n, today) {
  const days = [];
  for (let d = today; days.length < SPREAD_OVER; d = addDays(d, 1)) if (isWorkday(d)) days.push(d);
  if (n <= SPREAD_FROM) return Array.from({ length: n }, () => days[0]);
  return Array.from({ length: n }, (_, i) => days[Math.floor(i * SPREAD_OVER / n)]);
}
function spreadSentence(dates, what) {
  if (!dates.length) return "";
  const first = dates[0], last = dates[dates.length - 1];
  if (first === last) return `Every first ${what} is due ${dayWord(first)}.`;
  const perDay = new Map(); for (const d of dates) perDay.set(d, (perDay.get(d) || 0) + 1);
  const lo = Math.min(...perDay.values()), hi = Math.max(...perDay.values());
  return `First ${what}s are spread over ${perDay.size} working days, ${dayWord(first)} to ${dayWord(last)}, ${lo === hi ? lo : `${lo} or ${hi}`} a day, largest givers first.`;
}

// A card's "Create tasks" button and each item's due day.
// `n` people (already largest first), `today`, and `onDay` the card's own
// day (Nov 1 for year-end) or null. Before or on that day every task is due on
// it and the button names it; after it the tasks are spread from today and
// the button never names a day gone.
// Returns { label, dues: [day per person], sentence }.
function cardTasks(n, today, onDay = null) {
  if (onDay && onDay >= today) {
    const day = nextWorkday(onDay);
    return { label: day === today ? "Create tasks for today" : `Create tasks for ${shortDay(day)}`,
      dues: Array.from({ length: n }, () => day), sentence: n ? `Every task is due ${dayWord(day)}.` : "" };
  }
  const dues = spreadDays(n, today);
  const first = dues[0] || nextWorkday(today), last = dues[dues.length - 1] || first;
  // The Friday of the week `first` falls in: "this week" only when every task is in it.
  const fri = addDays(first, 5 - new Date(first + "T12:00:00Z").getUTCDay());
  const label = first === last ? (first === today ? "Create tasks for today" : `Create tasks for ${shortDay(first)}`)
    : last <= fri ? "Create tasks for this week" : "Create tasks for the next two weeks";
  return { label, dues, sentence: n ? spreadSentence(dues, "task").replace(/^First tasks/, "Tasks").replace(/^Every first task/, "Every task") : "" };
}

module.exports = { SPREAD_OVER, SPREAD_FROM, addDays, dayWord, isWorkday, nextWorkday, spreadDays, spreadSentence, cardTasks };
