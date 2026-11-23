// RECEIPTS-1: a gift of property (In-kind, Stock) says what it was. The receipt prints this
// Description of property and states no value: the donor determines the value (IRS Pub 1771).
// In-kind needs a description; a stock gift may be described by its shares and ticker instead.
import { T } from "../shared";

const PROPERTY_TYPES = new Set(["in_kind", "stock"]);

export default function PropertyFields({ form, setForm, compact = false, testid = "gift-property" }) {
  if (!PROPERTY_TYPES.has(form.type)) return null;
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: compact ? 6 : 8, padding: compact ? "5px 8px" : "8px 10px", color: T.ink, fontSize: compact ? 12 : 13, outline: "none", boxSizing: "border-box" };
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <div data-testid={testid} style={{ flexBasis: "100%", marginBottom: compact ? 0 : 8 }}>
      <input value={form.property_description || ""} onChange={set("property_description")} data-testid={`${testid}-description`}
        placeholder={form.type === "in_kind" ? "Description of property (required): what was given" : "Description of property"}
        aria-label="Description of property" required={form.type === "in_kind"} style={{ ...inp, width: "100%" }} />
      {form.type === "stock" && <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input value={form.stock_shares ?? ""} onChange={set("stock_shares")} type="number" min="0" step="any" placeholder="Shares" aria-label="Shares" data-testid={`${testid}-shares`} style={{ ...inp, width: 110 }} />
        <input value={form.stock_ticker || ""} onChange={set("stock_ticker")} placeholder="Ticker" aria-label="Ticker" data-testid={`${testid}-ticker`} style={{ ...inp, width: 110, textTransform: "uppercase" }} />
      </div>}
      <div style={{ fontSize: 11, color: T.ink3, marginTop: 4, lineHeight: 1.4 }}>
        The receipt describes the property and states no value: the donor determines its fair market value. The amount above stays on the gift for your reports.
      </div>
    </div>
  );
}
