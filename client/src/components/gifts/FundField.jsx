// FundField.jsx · GIFTS-2. THE GIFT FORM'S FUND, OR A SPLIT ACROSS FUNDS.
//
// One fund (the org's default when nothing is chosen), or "Split across funds":
// two or more lines, each a fund and an amount. The lines must add up to the
// gift before it saves; the server refuses a split that does not, with the same
// sentence (shared/numbers/fundLines.js). The value is
//   { fund_id, split, lines: [{ fundId, amount }] }
// and `fundLinesProblem(amount, value)` is the sentence that holds Save, or null.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, fmtFull } from "../shared";

const base = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
const cents = x => { const n = Number(String(x == null ? "" : x).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

export const emptyFund = () => ({ fund_id: "", split: false, lines: [] });
export const fundFromGift = g => (Array.isArray(g.fund_lines) && g.fund_lines.length
  ? { fund_id: g.fund_id || "", split: true, lines: g.fund_lines.map(l => ({ fundId: l.fundId, amount: String(Number(l.amount)) })) }
  : { fund_id: g.fund_id || "", split: false, lines: [] });

export function fundLinesProblem(amount, v) {
  if (!v || !v.split) return null;
  const lines = v.lines || [];
  if (lines.length < 2) return "A split needs two or more fund lines.";
  if (lines.some(l => !l.fundId)) return "Every fund line needs a fund.";
  if (new Set(lines.map(l => l.fundId)).size !== lines.length) return "Each fund can appear on one line only.";
  if (lines.some(l => !(cents(l.amount) > 0))) return "Every fund line needs an amount above $0.";
  const sum = lines.reduce((s, l) => s + cents(l.amount), 0), want = cents(amount);
  if (!(want > 0)) return "Enter the gift's amount first.";
  if (sum !== want) return `The lines add up to ${fmtFull(sum / 100)}, and the gift is ${fmtFull(want / 100)}. They must match before it saves.`;
  return null;
}

// The body the gift routes take: { fund_id } or { fundLines }.
export function fundBody(v, { editing = false } = {}) {
  if (v && v.split) return { fundLines: v.lines.map(l => ({ fundId: l.fundId, amount: Number(l.amount) })) };
  return editing ? { fund_id: (v && v.fund_id) || "", fundLines: null } : { fund_id: (v && v.fund_id) || "" };
}

export default function FundField({ value, onChange, amount, style, testid = "gift-fund", compact = false }) {
  const [funds, setFunds] = useState([]);
  useEffect(() => { apiFetch("/finance/funds").then(r => setFunds(Array.isArray(r) ? r : [])).catch(() => setFunds([])); }, []);
  const v = value || emptyFund();
  const set = patch => onChange({ ...v, ...patch });
  const def = funds.find(f => f.isOrgDefault);
  const problem = fundLinesProblem(amount, v);
  const sum = (v.lines || []).reduce((s, l) => s + (cents(l.amount) || 0), 0);
  const pad = compact ? { padding: "5px 8px", fontSize: 12 } : {};
  const fundOpts = funds.map(f => <option key={f.id} value={f.id}>{f.name}{f.restricted ? " (restricted)" : ""}</option>);

  if (!v.split) return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", ...(style || {}) }}>
      <select aria-label="Fund" value={v.fund_id || ""} onChange={e => set({ fund_id: e.target.value })} data-testid={testid}
        style={{ ...base, ...pad, flex: "1 1 180px", minWidth: 0 }}>
        <option value="">{def ? `Fund: ${def.name} (your default)` : "Fund: your default"}</option>
        {fundOpts}
      </select>
      {funds.length > 1 && (
        <button type="button" data-testid={testid + "-split"}
          onClick={() => set({ split: true, lines: [{ fundId: v.fund_id || (def && def.id) || "", amount: amount ? String(amount) : "" }, { fundId: "", amount: "" }] })}
          style={{ background: "none", border: "none", color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "2px 4px" }}>
          Split across funds
        </button>
      )}
    </div>
  );

  return (
    <div data-testid={testid + "-lines"} style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: 8, ...(style || {}) }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Split across funds</div>
      {v.lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <select aria-label={`Fund for line ${i + 1}`} value={l.fundId} data-testid={`${testid}-line-fund-${i}`}
            onChange={e => set({ lines: v.lines.map((x, j) => j === i ? { ...x, fundId: e.target.value } : x) })}
            style={{ ...base, ...pad, flex: "2 1 160px", minWidth: 0 }}>
            <option value="">Choose a fund</option>
            {fundOpts}
          </select>
          <input aria-label={`Amount for line ${i + 1}`} type="number" placeholder="Amount ($)" value={l.amount} data-testid={`${testid}-line-amount-${i}`}
            onChange={e => set({ lines: v.lines.map((x, j) => j === i ? { ...x, amount: e.target.value } : x) })}
            style={{ ...base, ...pad, flex: "1 1 90px", minWidth: 0 }} />
          {v.lines.length > 2 && (
            <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => set({ lines: v.lines.filter((_, j) => j !== i) })}
              style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", fontSize: 14 }}>×</button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => set({ lines: [...v.lines, { fundId: "", amount: "" }] })}
          style={{ background: "none", border: "none", color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>+ Add a line</button>
        <button type="button" data-testid={testid + "-unsplit"} onClick={() => set({ split: false, lines: [], fund_id: (v.lines[0] && v.lines[0].fundId) || v.fund_id || "" })}
          style={{ background: "none", border: "none", color: T.ink3, fontSize: 12, cursor: "pointer", padding: 0 }}>One fund instead</button>
      </div>
      <div data-testid={testid + "-sum"} style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, color: problem ? T.gold700 : T.ink3 }}>
        {problem || `The lines add up to ${fmtFull(sum / 100)}, the whole gift. One gift, one receipt, counted in each fund by its line.`}
      </div>
    </div>
  );
}
