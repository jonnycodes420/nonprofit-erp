// shared/yearAxis.js · POLISH-12 item 1. THE YEAR LABELS UNDER A BAR CHART NEVER RUN INTO EACH OTHER.
//
// A donor with 11 fiscal years read "FY 2018–19FY 2019–20FY 2020–21" under the
// Giving tab's bars: every bar printed its whole chartLabel whatever the width
// of its slot. The chart measures the slot and takes the first of these that fits:
//
//   1. every bar's full label        "FY 2016–17"
//   2. every bar's short label       "FY17" ("2016" for a year that is the calendar year)
//   3. every other short label, always keeping the first, the last and the
//      year still running; then every third, and so on, until none touch.
//
// Every bar keeps its full name in its hover title; this only decides what is
// printed under it. JSX-free, so Node reads it (tests/profile1-giving.test.js).

const GAP = 4;   // the least room between two labels, in the chart's own units

// "FY 2016–17" → "FY17"; "FY 2016" → "2016"; "2016" and anything else stay as they are.
export function shortYearLabel(label) {
  const s = String(label || "");
  let m = /^FY (\d{4})[–-](\d{2})$/.exec(s);
  if (m) return `FY${m[2]}`;
  m = /^FY (\d{4})$/.exec(s);
  if (m) return m[1];
  return s;
}

// A width for a label when there is no canvas to measure with (Node, a test):
// about 0.6 of the font size per character, which is generous for these fonts.
export const estimateWidth = (text, fontSize) => String(text || "").length * fontSize * 0.6;

// years: [{ chartLabel, current }] in the order drawn; slot: each bar's width;
// measure(text) → width, in the same units as slot. Returns
// { mode: "full" | "short" | "some", labels: [string, "" for a bar left unlabelled] }.
export function fitYearLabels(years, slot, measure) {
  const n = (years || []).length;
  if (!n) return { mode: "full", labels: [] };
  const full = years.map(y => String(y.chartLabel || ""));
  const short = full.map(shortYearLabel);
  const widest = list => Math.max(...list.map(t => measure(t)));
  if (widest(full) + GAP <= slot) return { mode: "full", labels: full };
  if (widest(short) + GAP <= slot) return { mode: "short", labels: short };

  // Labels are centred on their bars: two labels touch when the room between
  // their centres is less than half of each plus the gap.
  const centre = i => i * slot + slot / 2;
  const w = short.map(t => measure(t));
  const clash = (a, b) => Math.abs(centre(a) - centre(b)) < (w[a] + w[b]) / 2 + GAP;
  const kept = new Set([0, n - 1]);
  years.forEach((y, i) => { if (y.current) kept.add(i); });
  for (let step = 2; step <= n; step++) {
    const shown = [...kept];
    for (let i = 0; i < n; i += step) {
      if (kept.has(i)) continue;
      if (shown.every(j => !clash(i, j))) shown.push(i);
    }
    shown.sort((a, b) => a - b);
    // The kept ones may sit next to each other (the year running is the last one, or two bars in all).
    const ok = shown.every((i, k) => k === 0 || !clash(shown[k - 1], i));
    if (ok || step === n) {
      const on = new Set(ok ? shown : [n - 1]);
      return { mode: "some", labels: short.map((t, i) => (on.has(i) ? t : "")) };
    }
  }
  return { mode: "some", labels: short.map((t, i) => (i === n - 1 ? t : "")) };
}

// Two printed labels overlap (the guard's own check: boxes from left to right).
export function labelsOverlap(boxes) {
  const b = boxes.filter(x => x && x.width > 0).sort((p, q) => p.left - q.left);
  return b.some((x, i) => i > 0 && x.left < b[i - 1].right);
}
