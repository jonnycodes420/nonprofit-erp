// SheetDropTarget.jsx · PERF-4. The drop target and its two readers, out of
// SpreadsheetImport.jsx so a page can take a dropped spreadsheet without
// downloading the whole reader first (Donors draws its list inside one and
// opens the reader only when a file comes: 113 KB off its first look).
// SpreadsheetImport.jsx re-exports all of it, so every other import is as it was.
import { useRef, useState } from "react";
import { T } from "./shared";

const SHEET_FILE_RE = /\.(csv|tsv|txt|xlsx|xlsm|xls|ods)$/i;

// FIX-55: a spreadsheet dropped on a page (Donors, Settings, Imports) opens
// this same reader with that file. Anything else dropped is not ours.
export function droppedSpreadsheet(e) {
  const fs = Array.from((e && e.dataTransfer && e.dataTransfer.files) || []).filter(f => SHEET_FILE_RE.test(f.name || ""));
  return filesAsOne(fs);
}
// IMPORT-5: two files from one system (a Salesforce Contacts export and its
// Donations export) are one import: read together, people linked by their ID.
// More than one file is one file-like thing whose sheets are every file's.
export function filesAsOne(list) {
  const fs = Array.from(list || []).filter(Boolean);
  if (fs.length <= 1) return fs[0] || null;
  return { name: fs.map(f => f.name).join(" + "), lastModified: Math.max(...fs.map(f => f.lastModified || 0)) || undefined, files: fs };
}
export function isFileDrag(e) {
  return !!(e && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
}

// FIX-55: a page that takes a dropped spreadsheet. While a file is dragged
// over it, it says so; the dropped file opens the one reader (onFile).
export function SheetDropTarget({ onFile, disabled, children, style, testId = "sheet-drop-page" }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (disabled) return <div style={style}>{children}</div>;
  return (
    <div data-testid={testId} style={{ position: "relative", ...style }}
      onDragEnter={e => { if (isFileDrag(e)) { depth.current++; setOver(true); } }}
      onDragOver={e => { if (isFileDrag(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={e => { if (!isFileDrag(e)) return; e.preventDefault(); depth.current = 0; setOver(false); const f = droppedSpreadsheet(e); if (f) onFile(f); }}>
      {children}
      {over && (
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 50, borderRadius: 16, border: "2px dashed " + T.greenDk, background: T.white + "e6",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: T.greenDk, pointerEvents: "none" }}>
          Drop the spreadsheet to read it. Nothing is saved until you press Import.
        </div>
      )}
    </div>
  );
}
