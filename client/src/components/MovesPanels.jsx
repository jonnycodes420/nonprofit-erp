// client/src/components/MovesPanels.jsx — INT-BUILD-1 Part 6. MOVES MANAGEMENT.
//
// Two questions a major gifts officer asks every Monday, and both answered by
// the same figure sources the profile reads, so every number opens its rows:
//   · who have we not met in 90 days (owner and amount aware), on Donors
//   · how many meetings each of us held, month by month, in Reports
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { Figure } from "./Figure";

const LABEL = { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 24px" };
const field = { padding: "7px 10px", border: "1px solid " + T.bg3, borderRadius: 8, fontSize: 13, background: T.white, color: T.ink, fontFamily: "inherit" };
const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

export function NoRecentMeetingPanel({ officers = [], onSelectDonor, onClose }) {
  const [owner, setOwner] = useState("");
  const [min, setMin] = useState("");
  const [d, setD] = useState(null);
  const since = isoDaysAgo(90);
  const params = { since, ...(owner ? { owner } : {}), ...(/^\d+$/.test(min) ? { min } : {}) };
  useEffect(() => {
    setD(null);
    apiFetch(`/figures/no-recent-meeting/rows?${new URLSearchParams({ ...params, pageSize: 200 })}`).then(setD).catch(() => setD({ rows: [], totalRows: 0 }));
  }, [owner, min]);
  return (
    <div data-testid="no-recent-meeting" style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={LABEL}>No meeting in 90 days</div>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 28, color: T.ink, lineHeight: 1.1, marginTop: 4 }}>
            {d ? <Figure value={d.value ?? d.totalRows ?? 0} kind="count" label="No meeting in 90 days" definition={d.sentence} source={{ key: "no-recent-meeting", params }} variant="inline"/> : "…"}
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: T.ink3 }}> people</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select aria-label="Relationship owner" value={owner} onChange={e => setOwner(e.target.value)} style={field}>
            <option value="">Every owner</option>
            {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input aria-label="Given at least" inputMode="numeric" placeholder="Given at least $" value={min} onChange={e => setMin(e.target.value.replace(/[^\d]/g, ""))} style={{ ...field, width: 150 }}/>
          {onClose && <button type="button" onClick={onClose} style={{ ...field, cursor: "pointer" }}>Close</button>}
        </div>
      </div>
      {d?.sentence && <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{d.sentence}</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {(d?.rows || []).slice(0, 60).map(r => (
          <button key={r.id} type="button" onClick={() => onSelectDonor && onSelectDonor(r.donorId || r.donor_id || r.id)}
            style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 14, padding: "9px 2px", border: "none", borderTop: "1px solid " + T.bg2,
              background: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: T.ink }}>
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}<span style={{ fontWeight: 400, color: T.ink3 }}> · {r.detail}</span></span>
            <span style={{ color: T.ink3 }}>{r.date ? `Last met ${r.date}` : "Never met"}</span>
            <span style={{ fontWeight: 600 }}>{fmtFull(Number(r.amount) || 0)}</span>
          </button>
        ))}
        {d && (d.rows || []).length > 60 && <div style={{ fontSize: 12.5, color: T.ink3, paddingTop: 8 }}>Open the number above for all of them.</div>}
      </div>
    </div>
  );
}

export function MeetingsByStaffCard() {
  const [d, setD] = useState(null);
  useEffect(() => { apiFetch("/meetings/by-staff").then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const monthLabel = m => new Date(m + "-01T12:00:00").toLocaleDateString("en-US", { month: "short" });
  return (
    <div data-testid="meetings-by-staff" style={{ ...card, overflowX: "auto" }}>
      <div style={LABEL}>Meetings by staff member, last 12 months</div>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, margin: "6px 0 12px", maxWidth: 720 }}>{d.sentence}</div>
      <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
        <thead><tr>
          <th style={{ textAlign: "left", padding: "6px 10px 6px 0", ...LABEL }}>Staff</th>
          {d.months.map(m => <th key={m.month} style={{ textAlign: "right", padding: "6px 8px", ...LABEL }}>{monthLabel(m.month)}</th>)}
          <th style={{ textAlign: "right", padding: "6px 0 6px 8px", ...LABEL }}>Total</th>
        </tr></thead>
        <tbody>{d.staff.map(s => (
          <tr key={s.id} style={{ borderTop: "1px solid " + T.bg2 }}>
            <td style={{ padding: "8px 10px 8px 0", fontWeight: 600, color: T.ink, whiteSpace: "nowrap" }}>{s.name}</td>
            {s.cells.map(c => <td key={c.month} style={{ textAlign: "right", padding: "8px" }}>
              <Figure value={c.value} kind="count" label={`${s.name}, ${monthLabel(c.month)}`} definition={d.sentence} source={c.source} variant="cell"/></td>)}
            <td style={{ textAlign: "right", padding: "8px 0 8px 8px", fontWeight: 700 }}>
              <Figure value={s.total.value} kind="count" label={`${s.name}, 12 months`} definition={d.sentence} source={s.total.source} variant="cell"/></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
