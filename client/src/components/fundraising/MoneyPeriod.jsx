// client/src/components/fundraising/MoneyPeriod.jsx · FLOWS-7 (W-1112-Fundraising-05).
//
// Fundraising showed "Raised · FY 2026–27 $805,697" beside "Annual Fund 2026
// $1,700,673" with nothing saying one is a fiscal year and the other a
// calendar one. Every money card on the page now names its period the same
// way (shared/displayDate.js periodWords): the name, then its dates, also on
// hover. Words only: no number is worked out here.
import { T } from "../shared";
import { periodWords } from "../../../../shared/displayDate.js";

export function MoneyPeriod({ name, start, end, style }) {
  const words = periodWords(name, start, end);
  if (!words) return null;
  return (
    <span data-testid="money-period" title={words}
      style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}>
      {words}
    </span>
  );
}
