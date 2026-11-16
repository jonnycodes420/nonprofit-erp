// FundName.jsx · FLOWS-15 item 4 (W-1116-Finance-28). A FUND'S ONE NAME, AND ITS ONE BADGE.
// The name is shared/giftWords.js fundDisplayName on every surface; "Restricted" is never part of
// the name (no "Scholarship Fund (restricted)"), it is this badge, the same wherever it shows.
import { T } from "./shared";
import { fundDisplayName, FUND_RESTRICTED_BADGE } from "../../../shared/giftWords.js";

export function FundBadge({ style }) {
  return <span data-testid="fund-restricted-badge" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: T.gold700, background: T.gold100,
    borderRadius: 99, padding: "2px 7px", whiteSpace: "nowrap", ...(style || {}) }}>{FUND_RESTRICTED_BADGE}</span>;
}

export default function FundName({ fund, badge = true, style }) {
  return <span data-testid="fund-name" style={style}>{fundDisplayName(fund)}{badge && fund && fund.restricted ? <FundBadge /> : null}</span>;
}
