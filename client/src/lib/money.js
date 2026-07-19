// Pure, null-safe money formatting — kept JSX-free so it can be unit-tested
// directly by the Node suite (tests/finance-funds.test.js dynamic-imports it).
// Re-exported from components/shared.jsx so every existing `import { fmt,
// fmtFull } from "./shared"` keeps working unchanged.
//
// Null-safety is the point (BUILD-21 Part 2): a fund with no transactions, a
// NUMERIC pg-serialized as a string, or a missing field must NEVER throw —
// fmt(null) used to crash the Funds view via null.toLocaleString().

// Compact: $1.2k / $850 / −$36.9k. abs() keeps large NEGATIVE values in the "k"
// branch (a treasurer's −$36,898 reads as −$36.9k, not "$-36,898").
export const fmt = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  return a >= 1000
    ? `${sign}$${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}k`
    : `${sign}$${a.toLocaleString()}`;
};

// Full: whole dollars stay clean ($1,200); cents-carrying amounts render as
// money ($140.50, never "$140.5"). Non-finite → $0.
export const fmtFull = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  return `$${v.toLocaleString(undefined, Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
