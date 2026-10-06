// SheetImport.jsx · SHEETS-1. "BRING IN A SPREADSHEET."
//
// One door on Grants and on Reports. The file is read here (the one reader,
// parseFileToSheets); Steward says what it found (grants, a table of numbers,
// or neither) and nothing is saved until the person confirms. Columns that
// are not grant fields are listed and kept with the file. Every save offers
// Undo on the shared toast.
import { useState } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { parseFileToSheets } from "./DonorImport";
import { statusLabel } from "../../../shared/grantShape";

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, fontFamily: "inherit", boxSizing: "border-box" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const money = c => (c == null ? "" : "$" + Math.round(c / 100).toLocaleString("en-US"));
const cellOf = (row, i, h) => (Array.isArray(row) ? row[i] : row && row[h]);
const readAsDataUrl = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error("The file could not be read.")); r.readAsDataURL(file); });

export default function SheetImport({ onClose, onDone, where = "grants" }) {
  const [file, setFile] = useState(null);          // { raw, name, sheets:[{name, headers, rows, rowCount}], pick }
  const [found, setFound] = useState(null);
  const [plan, setPlan] = useState(null);
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const read = async (f, sheet) => {
    setMsg(""); setFound(null); setPlan(null); setBusy(true);
    try {
      const r = await apiFetch("/sheets/read", { method: "POST", body: JSON.stringify({ headers: sheet.headers, rows: sheet.rows, fileName: f.name, sheetName: sheet.name }) });
      setFound(r);
      if (r.kind === "grants") {
        const p = await apiFetch("/grants/import/preview", { method: "POST", body: JSON.stringify({ headers: sheet.headers, rows: sheet.rows }) });
        setPlan(p);
      }
      if (r.kind === "board_report") setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    } catch (e) { setMsg(errorMessage(e, "That sheet could not be read.")); }
    finally { setBusy(false); }
  };

  const pick = raw => {
    if (!raw) return;
    setMsg(""); setFound(null); setPlan(null);
    parseFileToSheets(raw, {
      onSingle: (headers, rows) => { const s = { name: null, headers, rows, rowCount: rows.length }; const f = { raw, name: raw.name, sheets: [s], pick: 0 }; setFile(f); read(f, s); },
      onMulti: () => setMsg("Save the sheet you need on its own and try again."),
      onWorkbook: ({ roled }) => {
        const sheets = roled.filter(s => s.rowCount > 0).map(s => ({ name: s.name, headers: s.headers, rows: s.rows, rowCount: s.rowCount }));
        if (!sheets.length) { setMsg("No rows were found in this file."); return; }
        const best = sheets.reduce((b, s, i) => (s.rowCount > sheets[b].rowCount ? i : b), 0);
        const f = { raw, name: raw.name, sheets, pick: best }; setFile(f); read(f, sheets[best]);
      },
      onError: m => setMsg(m),
    });
  };
  const sheet = file ? file.sheets[file.pick] : null;

  const importGrants = async () => {
    setMsg(""); setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file.raw);
      const r = await apiFetch("/grants/import", { method: "POST", body: JSON.stringify({ headers: sheet.headers, rows: sheet.rows, sheet: { file: dataUrl, fileName: file.name, sheetName: sheet.name } }) });
      onDone && onDone(r);
      offerUndo({ message: r.sentence || `Imported ${r.grants.length} grants.`, undoAction: r.sheet ? async () => { const x = await apiFetch(`/sheets/${r.sheet.id}/undo-grant-import`, { method: "POST", body: "{}" }); onDone && onDone(x); return x; } : undefined }, "import");
      onClose();
    } catch (e) { setMsg((e && e.sentence) || errorMessage(e, "The import did not run. Nothing was written.")); }
    finally { setBusy(false); }
  };
  const keepReport = async () => {
    setMsg(""); setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file.raw);
      const r = await apiFetch("/sheets/board-reports", { method: "POST", body: JSON.stringify({ headers: sheet.headers, rows: sheet.rows, file: dataUrl, fileName: file.name, sheetName: sheet.name, title, periodLabel: period }) });
      onDone && onDone(r);
      offerUndo({ message: r.sentence, undoAction: async () => { const x = await apiFetch(`/sheets/${r.id}/remove`, { method: "POST", body: "{}" }); onDone && onDone(x); return x; } }, "board report");
      onClose();
    } catch (e) { setMsg((e && e.sentence) || errorMessage(e, "That did not save. Nothing was kept.")); }
    finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} width={760} ariaLabel="Bring in a spreadsheet">
      <div data-testid="sheet-import" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>Bring in a spreadsheet</div>
        <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
          An old grant tracker, a board report or a budget, in Excel or CSV. Steward shows what it found, and nothing is saved until you say so.
          {where === "reports" ? " A table of numbers is kept under Reports with the file attached." : " Grants go into the pipeline."}
        </div>
        <input type="file" accept=".xlsx,.xls,.csv" aria-label="Spreadsheet" data-testid="sheet-file" onChange={e => pick(e.target.files && e.target.files[0])} />
        {file && file.sheets.length > 1 && (
          <label style={{ fontSize: 13, color: T.ink2, display: "flex", gap: 8, alignItems: "center" }}>Sheet
            <select value={file.pick} onChange={e => { const f = { ...file, pick: Number(e.target.value) }; setFile(f); read(f, f.sheets[f.pick]); }} style={inp} data-testid="sheet-pick">
              {file.sheets.map((s, i) => <option key={i} value={i}>{s.name} ({s.rowCount} rows)</option>)}
            </select>
          </label>)}
        {busy && <div style={{ fontSize: 13, color: T.ink3 }}>Reading…</div>}
        {found && <div data-testid="sheet-found" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{found.sentence}</div>}

        {found && found.kind === "grants" && plan && (
          <>
            {plan.grants && plan.grants.length > 0 && (
              <div style={{ overflowX: "auto", border: "1px solid " + T.bg3, borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead><tr style={{ textAlign: "left", color: T.ink3 }}>{["Funder", "Program", "Amount", "Stage", "Deadline"].map(h => <th key={h} style={{ padding: "7px 10px", borderBottom: "1px solid " + T.bg3 }}>{h}</th>)}</tr></thead>
                  <tbody>{plan.grants.slice(0, 12).map((g, i) => (
                    <tr key={i} style={{ borderTop: "1px solid " + T.bg3 }}>
                      <td style={{ padding: "6px 10px" }}>{g.funderName}</td><td style={{ padding: "6px 10px" }}>{g.program}</td>
                      <td style={{ padding: "6px 10px" }}>{money(g.amountAwardedCents != null ? g.amountAwardedCents : g.amountRequestedCents)}</td>
                      <td style={{ padding: "6px 10px" }}>{statusLabel(g.status) || g.status}</td><td style={{ padding: "6px 10px" }}>{g.deadline || ""}</td>
                    </tr>))}</tbody>
                </table>
              </div>)}
            {found.unplaced.length > 0 && <div data-testid="sheet-unplaced" style={{ fontSize: 13, color: T.ink2 }}>Kept with the file, not placed: {found.unplaced.join(", ")}.</div>}
            {plan.refused && plan.refused.length > 0 && <div style={{ fontSize: 13, color: T.ink2 }}>{plan.refused.length} {plan.refused.length === 1 ? "row is" : "rows are"} left out: {plan.refused.slice(0, 3).map(r => `line ${r.line}, ${r.reason || r.why || r.sentence || ""}`).join("; ")}{plan.refused.length > 3 ? "; and more" : ""}.</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn(true)} disabled={busy || !(plan.grants && plan.grants.length)} onClick={importGrants} data-testid="sheet-import-grants">Import {plan.grants ? plan.grants.length : 0} {plan.grants && plan.grants.length === 1 ? "grant" : "grants"}</button>
              <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
            </div>
          </>)}

        {found && found.kind === "board_report" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input aria-label="Title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ ...inp, flex: "2 1 220px" }} data-testid="sheet-title" />
              <input aria-label="Period" placeholder="Period (for example, FY 2024-25)" value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inp, flex: "1 1 160px" }} />
            </div>
            <div style={{ overflowX: "auto", border: "1px solid " + T.bg3, borderRadius: 10, maxHeight: 320 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr style={{ textAlign: "left", color: T.ink3 }}>{found.headers.map(h => <th key={h} style={{ padding: "7px 10px", borderBottom: "1px solid " + T.bg3, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                <tbody>{(found.preview || []).map((r, i) => <tr key={i} style={{ borderTop: "1px solid " + T.bg3 }}>{found.headers.map((h, j) => <td key={j} style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{cellOf(r, j, h)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn(true)} disabled={busy || !title.trim()} onClick={keepReport} data-testid="sheet-keep-report">Keep it as a board report</button>
              <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
            </div>
          </>)}
        {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
      </div>
    </Modal>);
}
