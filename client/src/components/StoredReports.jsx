// StoredReports.jsx · SHEETS-1, REPORTS-5. PAST REPORTS, UNDER REPORTS.
//
// Every report kept from before: board reports brought in from spreadsheets
// (SHEETS-1) and old systems' reports (REPORTS-5), by year and then by kind,
// each with the system it came from, its original file to download, its table
// when Steward could read one, and the historical totals pulled in from it (a
// figure that opens its rows). Bring in more from here: the old-reports wizard,
// or one spreadsheet as a board report. Taking one off offers Undo.
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import SheetImport from "./SheetImport";
import OldReportsImport from "./OldReportsImport";
import { Figure } from "./Figure";

const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", minWidth: 0 };
const day = iso => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; } };
export const OLD_REPORTS_EVENT = "steward-old-reports";

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
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/old-reports").then(d => setList(d.reports || [])).catch(e => { setList([]); setMsg(errorMessage(e, "The past reports did not load.")); });
  useEffect(() => {
    load();
    const again = () => load();
    window.addEventListener(OLD_REPORTS_EVENT, again);
    return () => window.removeEventListener(OLD_REPORTS_EVENT, again);
  }, []);
  const show = async id => {
    setMsg("");
    if (open && open.id === id) { setOpen(null); return; }
    try { setOpen(await apiFetch(`/sheets/${id}`)); } catch (e) { setMsg(errorMessage(e, "That report did not open.")); }
  };
  const remove = async r => {
    setMsg("");
    try {
      await apiFetch(`/sheets/${r.id}/remove`, { method: "POST", body: "{}" }); setOpen(null); load();
      offerUndo({ message: `Took "${r.title}" off Reports.`, undoAction: async () => { const x = await apiFetch(`/sheets/${r.id}/restore`, { method: "POST", body: "{}" }); load(); return x; } }, "report");
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };
  if (!list) return <div style={{ padding: 24, color: T.ink3, fontSize: 13 }}>Loading…</div>;
  // By year, newest first, and within a year by kind.
  const years = [];
  for (const r of list) {
    const y = r.year || "No year given";
    let g = years.find(x => x.year === y);
    if (!g) { g = { year: y, kinds: [] }; years.push(g); }
    let k = g.kinds.find(x => x.kind === r.reportKindLabel);
    if (!k) { k = { kind: r.reportKindLabel, items: [] }; g.kinds.push(k); }
    k.items.push(r);
  }
  return (
    <div data-testid="stored-reports" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, color: T.ink, flex: "1 1 260px", lineHeight: 1.5 }}>
          {list.length ? `${list.length} past ${list.length === 1 ? "report" : "reports"}, each with the file it came from. Numbers pulled in from them sit beside Steward's, never inside them.` : "No past reports yet. Bring in the reports from the system you used before, and your history does not start the day you switched."}
        </div>
        <button type="button" style={btn(true)} onClick={() => setImporting(true)} data-testid="stored-import-old">Import old reports</button>
        <button type="button" style={btn(false)} onClick={() => setAdding(true)} data-testid="stored-bring-in">Bring in a spreadsheet</button>
      </div>
      {msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
      {years.map(g => (
        <section key={g.year} data-testid="stored-year" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>{g.year}</div>
          {g.kinds.map(k => (
            <div key={k.kind} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, fontWeight: 800 }}>{k.kind}</div>
              {k.items.map(r => (
                <div key={r.id} data-testid="stored-report" style={card}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => show(r.id)} style={{ all: "unset", cursor: "pointer", fontSize: 15, fontWeight: 800, color: T.ink, flex: "1 1 220px", overflowWrap: "anywhere" }}>{r.title}{r.periodLabel ? ` · ${r.periodLabel}` : ""}</button>
                    <span style={{ fontSize: 12, color: T.ink3 }}>{r.system ? `From ${r.system} · ` : ""}brought in {day(r.createdAt)}{r.createdByName ? ` by ${r.createdByName}` : ""}</span>
                  </div>
                  {r.scanned && <div style={{ fontSize: 12.5, color: T.ink, marginTop: 6 }}>A scan: its pages are pictures, so its numbers cannot be read. The file is kept.</div>}
                  {r.totals > 0 && r.source && (
                    <div data-testid="stored-totals" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>
                      Pulled in: {r.totals} {r.totals === 1 ? "total" : "totals"} adding up to <Figure variant="inline" kind="money" value={r.totalAmount} label={`From ${r.system || "your old system"}: ${r.title}`} source={r.source}
                        definition={`What ${r.fileName} said, imported from ${r.system || "your old system"}. Kept beside Steward's numbers, never added into them.`} />, from your old system.
                    </div>)}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <button type="button" style={{ ...btn(false), maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }} data-testid="stored-file" onClick={() => download(r.id, r.fileName).catch(e => setMsg(e.message))}>{r.fileName}</button>
                    {!r.scanned && <button type="button" style={btn(false)} onClick={() => show(r.id)}>{open && open.id === r.id ? "Close the table" : "Open the table"}</button>}
                    <button type="button" style={btn(false)} onClick={() => remove(r)}>Take off</button>
                  </div>
                  {open && open.id === r.id && (open.headers || []).length > 0 && (
                    <div style={{ overflowX: "auto", border: "1px solid " + T.bg3, borderRadius: 10, marginTop: 10, maxHeight: 420 }}>
                      <table data-testid="stored-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead><tr style={{ textAlign: "left", color: T.ink3 }}>{open.headers.map((h, i) => <th key={i} style={{ padding: "7px 10px", borderBottom: "1px solid " + T.bg3, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                        <tbody>{open.rows.map((row, i) => <tr key={i} style={{ borderTop: "1px solid " + T.bg3 }}>{row.map((c, j) => <td key={j} style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{c}</td>)}</tr>)}</tbody>
                      </table>
                    </div>)}
                  {open && open.id === r.id && !(open.headers || []).length && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 8 }}>Steward found no table in this file. Download it to read it.</div>}
                </div>))}
            </div>))}
        </section>))}
      {adding && <SheetImport where="reports" onClose={() => setAdding(false)} onDone={() => load()} />}
      {importing && <OldReportsImport onClose={() => setImporting(false)} onDone={() => load()} />}
    </div>);
}
