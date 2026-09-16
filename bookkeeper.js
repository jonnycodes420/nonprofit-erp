// bookkeeper.js — BUILD-87 Part 4. THE ASSERTION THAT GATES THE FILE.
//
// The bookkeeper's export may not be written unless it foots. This is the one
// place that decides, and it lives outside server.js for the same reason
// money.js and orgTime.js do: the rule has to be provable on a synthetic tree
// containing the exact defect, without a database and without a server.
//
// A GUARD WHOSE NUMBER CANNOT FALL IS NOT MEASURING ANYTHING (BUILD-75 A.6).
// `gifts.amount` is NUMERIC(12,2), so in the live schema the row sum and the
// database sum cannot currently disagree — which means the live path alone
// could never demonstrate this guard working. It is therefore stated as a pure
// function over four inputs and PROVEN able to fire in tests/bookkeeper-
// export.test.js, one synthetic case per refusal. What would make it fire for
// real: a column whose scale is widened, a row dropped or duplicated between
// the two reads, a fund bucket that loses a gift, or a filter that diverges
// between the row query and the total query.
//
// EVERYTHING IS COMPARED IN INTEGER CENTS. `dbCents` may arrive as a
// fractional number — that is the point: Postgres is asked for the sum
// EXACTLY, not pre-rounded to the same two decimals the file uses, because
// rounding it first would make the two sides agree by construction.

function fmtMoney(cents) {
  const n = Number(cents) || 0;
  const neg = n < 0, abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const rest = (abs % 100).toFixed(0).padStart(2, "0");
  return (neg ? "-$" : "$") + whole.toLocaleString("en-US") + "." + rest;
}
const fmtInt = n => Number(n || 0).toLocaleString("en-US");

// rows     — [{cents}] exactly as they will be written, one per gift
// byFund   — [{name, cents}] the trailing section of the same file
// dbCents  — the database's own SUM(amount * 100), unrounded
// dbCount  — the database's own COUNT(*)
// Returns a list of sentences. Empty means the file may be written.
function bookkeeperRefusals(rows, byFund, dbCents, dbCount) {
  const out = [];
  const list = Array.isArray(rows) ? rows : [];
  const funds = Array.isArray(byFund) ? byFund : [];
  const rowCents = list.reduce((s, r) => s + (Number(r && r.cents) || 0), 0);
  const fundCents = funds.reduce((s, f) => s + (Number(f && f.cents) || 0), 0);
  const db = Number(dbCents) || 0;

  if (rowCents !== db)
    out.push(`the ${fmtInt(list.length)} rows total ${fmtMoney(rowCents)} but the database holds ${(db / 100).toFixed(4)} dollars`);
  if (fundCents !== rowCents)
    out.push(`the fund totals come to ${fmtMoney(fundCents)} but the rows come to ${fmtMoney(rowCents)}`);
  if (Number(dbCount) !== list.length)
    out.push(`the database counts ${fmtInt(Number(dbCount) || 0)} gifts but ${fmtInt(list.length)} rows were built`);
  return out;
}

// The sentence the user sees. Nothing is repaired, and the file is not written:
// a bookkeeper's file that does not foot is worse than no file, because it
// will be trusted.
function bookkeeperRefusalMessage(refusals) {
  if (!refusals || !refusals.length) return null;
  return `This export does not foot, so nothing was written: ${refusals.join("; ")}. `
       + `Nobody should reconcile against a file that disagrees with itself.`;
}

module.exports = { bookkeeperRefusals, bookkeeperRefusalMessage };
