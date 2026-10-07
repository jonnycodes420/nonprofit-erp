// REPORTS-4 · THE LINE UNDER A PERCENTAGE: its two halves, as the drawer's
// foot states them. JSX-free so the Node test can check it
// (tests/reports4-foot.test.js). A half that is money reads as money, with its
// dollars and cents ("$1,623,328 of $1,593,572.75"); a half that counts people
// reads as a count. Before REPORTS-4 a dollar half printed as a bare number.
import { fmtFull } from "./money.js";

const half = p => (p && p.measure === "sum" ? fmtFull(p.value) : Number(p && p.value).toLocaleString("en-US"));

export function ratioFootLine(formula, n, d) {
  return formula === "change"
    ? `(${half(n)} − ${half(d)}) ÷ ${half(d)}`
    : `${half(n)} of ${half(d)}`;
}
