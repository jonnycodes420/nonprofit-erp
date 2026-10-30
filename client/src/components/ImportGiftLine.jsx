// FIX-58 · ONE ACCOUNTING ON AN IMPORT RECEIPT.
//
// "106 rows · 100 gifts $111,790 · 6 first payments on pledges $12,500 ·
// $124,290 in all". The preview counted a pledge's paid first year as a gift
// and the receipt did not, so the two disagreed by six gifts and $12,500 and
// nothing said why. Every part is a figure that opens its rows (import-gifts).
import { Figure } from "./Figure";
import { T } from "./shared";

export default function ImportGiftLine({ line, importId, style }) {
  if (!line || !importId) return null;
  const src = part => ({ key: "import-gifts", params: { import: importId, ...(part ? { part } : {}) } });
  const n = (k, one, many) => `${Number(k).toLocaleString("en-US")} ${k === 1 ? one : many}`;
  const fig = (cents, part, label) => (
    <Figure variant="inline" kind="money" value={cents / 100} label={label} source={src(part)} why={false} />
  );
  return (
    <div data-testid="import-gift-line" onClick={e => e.stopPropagation()} style={{ fontSize: 13, color: T.ink, lineHeight: 1.6, ...(style || {}) }}>
      {n(line.rows, "row", "rows")} · {n(line.gifts, "gift", "gifts")} {fig(line.giftCents, line.firstPayments ? "gifts" : null, "Gifts")}
      {line.firstPayments ? <> · {n(line.firstPayments, "first payment", "first payments")} on pledges {fig(line.firstPaymentCents, "first", "First payments on pledges")} · {fig(line.totalCents, null, "Gifts in all")} in all</> : null}
    </div>
  );
}
