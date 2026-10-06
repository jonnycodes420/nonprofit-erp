// StoredReports.jsx · SHEETS-1. PAST BOARD REPORTS, UNDER REPORTS.
//
// Board reports brought in from old spreadsheets: each one's table exactly as
// it was, and its original file to download, so last year's numbers sit beside
// this year's Board pack. Bring in another from here. Taking one off offers
// Undo on the shared toast.
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import SheetImport from "./SheetImport";

const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px" };
const day = iso => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; } };

async function download(id, name) {
  const r = await fetch(`${API}/sheets/${encodeURIComponent(id)}/file`, { headers: { Authorization: "Bearer " + getToken() } });
  if (!r.ok) throw new Error("The original file could not be fetched.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function StoredReports() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/sheets/board-reports").then(d => setList(d.reports || [])).catch(e => { setList([]); setMsg(errorMessage(e, "The board reports did not load.")); });
  useEffect(() => { load(); }, []);
  const show = async id => {
    setMsg("");
    if (open && open.id === id) { setOpen(null); return; }
    try { setOpen(await apiFetch(`/sheets/${id}`)); } catch (e) { setMsg(errorMessage(e, "That report did not open.")); }
  };
  const remove = async r => {
    setMsg("");
    try {
      await apiFetch(`/sheets/${r.id}/remove`, { method: "POST", body: "{}" }); setOpen(null); load();
      offerUndo({ message: `Took "${r.title}" off Reports.`, undoAction: async () => { const x = await apiFetch(`/sheets/${r.id}/restore`, { method: "POST", body: "{}" }); load(); return x; } }, "board report");
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };
  if (!list) return <div style={{ padding: 24, color: T.ink3, fontSize: 13 }}>Loading…</div>;
  return (
    <div data-testid="stored-reports" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, color: T.ink, flex: "1 1 260px", lineHeight: 1.5 }}>
          {list.length ? `${list.length} past board ${list.length === 1 ? "report" : "reports"}, each with the file it came from. This year's is the Board pack.` : "No past board reports yet. Bring in last year's spreadsheet and it sits here, with the file attached."}
        </div>
        <button type="button" style={btn(true)} onClick={() => setAdding(true)} data-testid="stored-bring-in">Bring in a spreadsheet</button>
      </div>
      {msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
      {list.map(r => (
        <div key={r.id} data-testid="stored-report" style={card}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <button type="button" onClick={() => show(r.id)} style={{ all: "unset", cursor: "pointer", fontSize: 15, fontWeight: 800, color: T.ink, flex: "1 1 220px" }}>{r.title}{r.periodLabel ? ` · ${r.periodLabel}` : ""}</button>
            <span style={{ fontSize: 12, color: T.ink3 }}>{r.rowCount} rows · brought in {day(r.createdAt)}{r.createdByName ? ` by ${r.createdByName}` : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" style={btn(false)} data-testid="stored-file" onClick={() => download(r.id, r.fileName).catch(e => setMsg(e.message))}>{r.fileName}</button>
            <button type="button" style={btn(false)} onClick={() => show(r.id)}>{open && open.id === r.id ? "Close the table" : "Open the table"}</button>
            <button type="button" style={btn(false)} onClick={() => remove(r)}>Take off</button>
          </div>
          {open && open.id === r.id && (
            <div style={{ overflowX: "auto", border: "1px solid " + T.bg3, borderRadius: 10, marginTop: 10, maxHeight: 420 }}>
              <table data-testid="stored-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr style={{ textAlign: "left", color: T.ink3 }}>{open.headers.map((h, i) => <th key={i} style={{ padding: "7px 10px", borderBottom: "1px solid " + T.bg3, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                <tbody>{open.rows.map((row, i) => <tr key={i} style={{ borderTop: "1px solid " + T.bg3 }}>{row.map((c, j) => <td key={j} style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>)}
        </div>))}
      {adding && <SheetImport where="reports" onClose={() => setAdding(false)} onDone={() => load()} />}
    </div>);
}
