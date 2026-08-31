// Pure, null-safe money formatting — kept JSX-free so it can be unit-tested
// directly by the Node suite (tests/finance-funds.test.js dynamic-imports it).
// Re-exported from components/shared.jsx so every existing `import { fmt,
// fmtFull } from "./shared"` keeps working unchanged.
//
// Null-safety is the point (BUILD-21 Part 2): a fund with no transactions, a
// NUMERIC pg-serialized as a string, or a missing field must NEVER throw —
// fmt(null) used to crash the Funds view via null.toLocaleString().

// Compact: $2.7M / $1.2k / $850 / -$36.9k. abs() keeps large NEGATIVE values in
// the abbreviated branch (a treasurer's -$36,898 reads as -$36.9k, not
// "$-36,898").
//
// BUILD-72 Part 5 — the MILLIONS branch was missing, so a real donor file's
// pipeline read "$2720.5k". Nobody writes that, and a fundraiser reads it as
// broken. It never showed up before because it only appears on a POPULATED
// org: the BUILD-44 pass cleared the empty one, and every fixture was small
// enough to stay under $1M. Found by the Part 5 walk, on the first screen.
export const fmt = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  // One decimal, with a bare ".0" trimmed so a round figure reads "$3M" not
  // "$3.0M". The threshold is the value that ROUNDS to the next unit, not the
  // unit itself: $999,999 was rendering "$1000.0k" — the same class of wrong as
  // "$2720.5k", one unit down.
  const one = x => { const t = x.toFixed(1); return t.endsWith(".0") ? t.slice(0, -2) : t; };
  if (a >= 999500) return `${sign}$${one(a / 1000000)}M`;
  if (a >= 1000)   return `${sign}$${one(a / 1000)}k`;
  return `${sign}$${a.toLocaleString()}`;
};

// Full: whole dollars stay clean ($1,200); cents-carrying amounts render as
// money ($140.50, never "$140.5"). Non-finite → $0.
export const fmtFull = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toLocaleString(undefined, Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// BUILD-64 Part 4 — the ONE human date formatter for every donor-facing
// surface. A bare ISO "2026-08-17" reads mechanical in a serif giving history;
// the cross-org dashboard already rendered "Aug 17, 2026" while the org portal
// leaked ISO on gift rows and impact updates. This is that one formatter, so an
// ISO date can never reach a donor's eyes again (pinned by the portal suite).
// Parses the leading YYYY-MM-DD off any ISO/timestamp string; passes anything
// unparseable through verbatim (never invents a date).
const FMT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return `${FMT_MONTHS[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
};

// BUILD-73 Part 3 — the at-risk threshold, rendered in words.
//
// The Home chip shipped for exactly one build reading "544 quiet donors · no
// gift in over a year" while the server's QUIET_DAYS was 180. The number and
// the sentence were maintained in different files, so they drifted the moment
// one changed. Every surface now derives the phrase from the payload's
// `quietSinceDays`, so the copy cannot contradict the figure it describes.
export const quietPhrase = days => {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return "a while";
  if (d >= 365) { const y = Math.round(d / 365); return y === 1 ? "a year" : `${y} years`; }
  const m = Math.round(d / 30);
  return m <= 1 ? "a month" : m === 12 ? "a year" : `${m} months`;
};
