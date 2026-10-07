// OldReportsImport.jsx · REPORTS-5. IMPORT OLD REPORTS: ONE WIZARD, TWO DOORS.
//
// Opened from the top of the Reports rail and from the Import menu on Donors.
// Three steps:
//   1. Upload. Drop CSV, Excel and PDF files, or a zip of them. Each shows its
//      name, type and a preview (its first rows, or the PDF's first page).
//   2. What is it. Steward's guess at the kind of report, the system it came
//      from and the period, with the one line that says why. Change any of it.
//   3. Keep or connect. Every file is kept, as it came. A table Steward can
//      read can also have its numbers pulled in, mapped column by column, as
//      HISTORICAL TOTALS: never gifts, never people. A scan is kept and said to
//      be unreadable.
// The whole import undoes in one step, from the toast or the last screen.
import { useState } from "react";
import { apiFetch } from "../api";
import { T, Modal, fmtFull } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20;
const OK_EXT = /\.(csv|xlsx|xls|pdf)$/i;
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const sel = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 13, background: T.white, color: T.ink, fontFamily: "inherit", maxWidth: "100%" };
const typeOf = name => (/\.([a-z]+)$/i.exec(name) || [])[1]?.toUpperCase() || "FILE";
const sizeOf = b => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

const dataUrlOf = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error("The file could not be read."));
  r.readAsDataURL(blob);
});

// An Excel file's first sheet, read here (the server reads CSV and PDF itself).
async function excelTable(blob) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await blob.arrayBuffer(), { type: "array" });
  const name = wb.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
  const at = grid.findIndex(r => r.some(c => String(c).trim() !== ""));
  if (at < 0) return { sheetName: name, headers: [], rows: [] };
  return { sheetName: name, headers: grid[at].map(String), rows: grid.slice(at + 1).filter(r => r.some(c => String(c).trim() !== "")).map(r => r.map(String)) };
}

// Files from what was dropped: a zip opens into the files inside it.
async function expand(list) {
  const out = [], refused = [];
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) {
      try {
        const JSZip = (await import("jszip")).default;
        const z = await JSZip.loadAsync(f);
        for (const e of Object.values(z.files)) {
          if (e.dir || /(^|\/)(__MACOSX|\.)/.test(e.name)) continue;
          const name = e.name.split("/").pop();
          if (!OK_EXT.test(name)) { refused.push(`${name} (inside ${f.name}) is not a CSV, Excel or PDF file`); continue; }
          const blob = await e.async("blob");
          out.push({ name, size: blob.size, blob, zip: f.name });
        }
      } catch { refused.push(`${f.name} could not be opened as a zip`); }
    } else if (OK_EXT.test(f.name)) out.push({ name: f.name, size: f.size, blob: f });
    else refused.push(`${f.name} is not a CSV, Excel, PDF or zip file`);
  }
  return { files: out, refused };
}

export default function OldReportsImport({ onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [items, setItems] = useState([]);       // one per file: { name, size, blob, dataUrl, url, read, title, kind, system, from, to, pull, mapping, preview }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [refused, setRefused] = useState([]);
  const [result, setResult] = useState(null);
  const set = (i, patch) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const add = async list => {
    setBusy(true); setMsg("");
    const { files, refused: no } = await expand([...list]);
    const big = files.filter(f => f.size > MAX_BYTES);
    const fit = files.filter(f => f.size <= MAX_BYTES).slice(0, Math.max(0, MAX_FILES - items.length));
    const extra = files.length - big.length - fit.length;
    setRefused(r => [...r, ...no, ...big.map(f => `${f.name} is ${sizeOf(f.size)}, over the 25 MB a file can be`),
      ...(extra > 0 ? [`${extra} more ${extra === 1 ? "file was" : "files were"} left out: one import takes ${MAX_FILES}`] : [])]);
    const next = [];
    for (const f of fit) {
      try {
        const dataUrl = await dataUrlOf(f.blob);
        const xl = /\.xlsx?$/i.test(f.name) ? await excelTable(f.blob) : null;
        const read = await apiFetch("/old-reports/read", { method: "POST", body: JSON.stringify({ fileName: f.name, file: dataUrl, ...(xl || {}) }) });
        next.push({ ...f, dataUrl, xl, read, url: /\.pdf$/i.test(f.name) ? URL.createObjectURL(f.blob) : null,
          title: (t => t.charAt(0).toUpperCase() + t.slice(1))(f.name.replace(/\.[^.]+$/, "").replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim()), kind: read.kind, system: read.system,
          from: read.period ? read.period.from : "", to: read.period ? read.period.to : "",
          pull: !!(read.readable && (read.kind === "giving_summary" || read.kind === "by_fund")), mapping: read.mapping || {}, preview: null });
      } catch (e) { setRefused(r => [...r, `${f.name}: ${errorMessage(e, "it could not be read")}`]); }
    }
    setItems(xs => [...xs, ...next]);
    setBusy(false);
  };

  const preview = async i => {
    const it = items[i];
    if (!it.read.table) return;
    try {
      const p = await apiFetch("/old-reports/preview", { method: "POST", body: JSON.stringify({ table: it.read.table, mapping: it.mapping, periodFrom: it.from, periodTo: it.to }) });
      set(i, { preview: p });
    } catch (e) { set(i, { preview: { ok: false, sentence: errorMessage(e, "The preview did not work.") } }); }
  };

  const run = async () => {
    setBusy(true); setMsg("");
    try {
      const b = await apiFetch("/old-reports/batches", { method: "POST", body: "{}" });
      const done = [];
      for (const it of items) {
        const r = await apiFetch(`/old-reports/batches/${b.id}/files`, { method: "POST", body: JSON.stringify({
          fileName: it.name, file: it.dataUrl, ...(it.xl || {}), title: it.title, kind: it.kind, system: it.system,
          periodFrom: it.from || null, periodTo: it.to || null, why: it.read.why, pull: !!(it.pull && it.read.readable), mapping: it.mapping }) });
        done.push(r);
      }
      // Past reports listens for this, so the list is right whichever door was used.
      const changed = () => { try { window.dispatchEvent(new Event("steward-old-reports")); } catch { /* no window */ } };
      const undo = async () => { const x = await apiFetch(`/old-reports/batches/${b.id}/undo`, { method: "POST", body: "{}" }); changed(); onDone && onDone(); return x; };
      setResult({ batchId: b.id, done, undo });
      offerUndo({ message: `Brought in ${done.length} old ${done.length === 1 ? "report" : "reports"}.`, undoAction: undo }, "import", () => setResult(r => r && { ...r, undone: true }));
      changed();
      onDone && onDone();
    } catch (e) { setMsg(errorMessage(e, "The import did not finish. Nothing after the last kept file was brought in.")); }
    setBusy(false);
  };

  const head = (n, t) => <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, fontWeight: 800 }}>Step {n} of 3 · {t}</div>;
  const table = (t, max = 5) => t && (
    <div style={{ overflowX: "auto", border: "1px solid " + T.bg3, borderRadius: 8, maxWidth: "100%" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead><tr>{t.headers.map((h, k) => <th key={k} style={{ textAlign: "left", padding: "5px 8px", color: T.ink3, whiteSpace: "nowrap", borderBottom: "1px solid " + T.bg3 }}>{h}</th>)}</tr></thead>
        <tbody>{t.rows.slice(0, max).map((r, k) => <tr key={k}>{r.map((c, m) => <td key={m} style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>);

  return (
    <Modal onClose={onClose} width={820} ariaLabel="Import old reports" padding="0">
      <div data-testid="old-reports-wizard" style={{ display: "flex", flexDirection: "column", gap: 14, padding: "22px 24px", maxHeight: "86vh", overflowY: "auto", boxSizing: "border-box" }}>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: T.ink }}>Import old reports</div>
        <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>Bring your reports from the system you used before, so your history does not start the day you switched. Every file is kept exactly as it is. Steward reads the numbers only where you ask it to, and keeps them beside your own, never inside them.</div>

        {result ? (
          <div data-testid="old-reports-done" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.done.map(d => <div key={d.sheetId} style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{d.sentence}</div>)}
            {result.undone ? <div style={{ fontSize: 13, color: T.ink3 }}>The import was taken back out.</div> : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btn(true)} onClick={onClose}>Done</button>
                <button type="button" style={btn(false)} data-testid="old-reports-undo" onClick={async () => { try { await result.undo(); setResult(r => ({ ...r, undone: true })); } catch (e) { setMsg(errorMessage(e, "It could not be undone.")); } }}>Undo this import</button>
              </div>)}
          </div>
        ) : step === 1 ? (<>
          {head(1, "Upload")}
          <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}
            style={{ border: "2px dashed " + T.bg3, borderRadius: 12, padding: "22px 16px", textAlign: "center", cursor: "pointer", fontSize: 13.5, color: T.ink2, background: T.bg }}>
            <input type="file" multiple accept=".csv,.xlsx,.xls,.pdf,.zip" data-testid="old-reports-input" style={{ display: "none" }} onChange={e => { add(e.target.files); e.target.value = ""; }} />
            <strong style={{ color: T.ink }}>Drop files here, or choose them</strong><br />
            CSV, Excel and PDF, or a .zip of them. Up to 25 MB each, 20 at a time.
          </label>
          {busy && <div style={{ fontSize: 13, color: T.ink3 }}>Reading…</div>}
          {refused.length > 0 && <div role="status" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>{refused.map(r => <div key={r}>Left out: {r}.</div>)}</div>}
          {items.map((it, i) => (
            <div key={i} data-testid="old-report-file" style={{ border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14, color: T.ink, overflowWrap: "anywhere" }}>{it.name}</strong>
                <span style={{ fontSize: 12, color: T.ink3 }}>{typeOf(it.name)} · {sizeOf(it.size)}{it.zip ? ` · inside ${it.zip}` : ""}{it.read.period ? ` · covers ${it.read.period.label}` : ""}{it.read.pages ? ` · ${it.read.pages} ${it.read.pages === 1 ? "page" : "pages"}` : ""}</span>
                <button type="button" onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} style={{ ...btn(false), padding: "3px 9px", fontSize: 12, marginLeft: "auto" }}>Remove</button>
              </div>
              {it.url
                ? <object data={`${it.url}#page=1&view=FitH`} type="application/pdf" aria-label={`First page of ${it.name}`} style={{ width: "100%", height: 260, border: "1px solid " + T.bg3, borderRadius: 8 }}>
                    <div style={{ fontSize: 12.5, color: T.ink3, padding: 8 }}>{it.read.table ? "This browser cannot show the page here; the table Steward read is below." : "This browser cannot show the page here."}</div>
                  </object>
                : table(it.read.table)}
              {it.url && it.read.table && table(it.read.table, 3)}
              <div style={{ fontSize: 12.5, color: it.read.scanned ? T.ink : T.ink3, lineHeight: 1.5 }}>{it.read.sentence}</div>
            </div>))}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn(true)} disabled={!items.length || busy} data-testid="old-reports-next" onClick={() => setStep(2)}>Next: what is it</button>
            <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
          </div>
        </>) : step === 2 ? (<>
          {head(2, "What is it")}
          {items.map((it, i) => (
            <div key={i} data-testid="old-report-guess" style={{ border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <strong style={{ fontSize: 14, color: T.ink, overflowWrap: "anywhere" }}>{it.name}</strong>
              <div data-testid="old-report-why" style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.5 }}>Steward's guess: {it.read.why}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
                <label style={{ fontSize: 12, color: T.ink3 }}>Kind of report<br /><select style={sel} value={it.kind} onChange={e => set(i, { kind: e.target.value })}>{it.read.kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
                <label style={{ fontSize: 12, color: T.ink3 }}>From<br /><select style={sel} value={it.system} onChange={e => set(i, { system: e.target.value })}>{it.read.systems.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
                <label style={{ fontSize: 12, color: T.ink3 }}>First day it covers<br /><input type="date" style={sel} value={it.from} onChange={e => set(i, { from: e.target.value })} /></label>
                <label style={{ fontSize: 12, color: T.ink3 }}>Last day it covers<br /><input type="date" style={sel} value={it.to} onChange={e => set(i, { to: e.target.value })} /></label>
              </div>
              <label style={{ fontSize: 12, color: T.ink3 }}>Name it<br /><input style={{ ...sel, width: "100%", boxSizing: "border-box" }} value={it.title} onChange={e => set(i, { title: e.target.value })} /></label>
            </div>))}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn(true)} data-testid="old-reports-next" onClick={() => { setStep(3); items.forEach((it, i) => it.pull && preview(i)); }}>Next: keep or connect</button>
            <button type="button" style={btn(false)} onClick={() => setStep(1)}>Back</button>
          </div>
        </>) : (<>
          {head(3, "Keep or connect")}
          {items.map((it, i) => {
            const t = it.read.table;
            const col = (k, label, optional) => (
              <label key={k} style={{ fontSize: 12, color: T.ink3 }}>{label}<br />
                <select style={sel} value={it.mapping[k] ?? ""} onChange={e => { const v = e.target.value === "" ? undefined : Number(e.target.value); set(i, { mapping: { ...it.mapping, [k]: v }, preview: null }); }}>
                  <option value="">{optional ? "Not in this file" : "Choose a column"}</option>
                  {it.read.wide ? t.rows.map((r, n) => <option key={n} value={n}>{r[0]}</option>) : t.headers.map((h, n) => <option key={n} value={n}>{h}</option>)}
                </select></label>);
            return (
              <div key={i} data-testid="old-report-keep" style={{ border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <strong style={{ fontSize: 14, color: T.ink, overflowWrap: "anywhere" }}>{it.title}</strong>
                <label style={{ fontSize: 13, color: T.ink }}><input type="checkbox" checked disabled /> Keep as a file, under Reports and in search</label>
                {it.read.readable ? (
                  <label style={{ fontSize: 13, color: T.ink }}><input type="checkbox" data-testid="old-report-pull" checked={it.pull} onChange={e => { set(i, { pull: e.target.checked, preview: null }); if (e.target.checked) setTimeout(() => preview(i), 0); }} /> Pull the numbers in, as historical totals for {it.from && it.to ? `${it.from} to ${it.to}` : "the periods in the file"}</label>
                ) : <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>{it.read.sentence}</div>}
                {it.pull && it.read.readable && (<>
                  <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{it.read.wide ? "The years run across the top. Say which row is each figure." : "Say which column is each figure, the way you would for a donor import."}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
                    {it.read.wide
                      ? [col("amountRow", "Total raised"), col("giftsRow", "Gifts", true), col("donorsRow", "Donors", true)]
                      : [col("amount", "Amount"), col("label", "Name of each line", true), col("period", "Year or date of each line", true), col("gifts", "Gifts", true), col("donors", "Donors", true)]}
                  </div>
                  <div><button type="button" style={{ ...btn(false), padding: "5px 10px", fontSize: 12 }} onClick={() => preview(i)}>Show what would come in</button></div>
                  {it.preview && (it.preview.ok ? (
                    <div data-testid="old-report-preview" style={{ fontSize: 13, color: T.ink, lineHeight: 1.5, background: T.bg, borderRadius: 8, padding: "8px 10px" }}>
                      {it.preview.count} {it.preview.count === 1 ? "total" : "totals"} adding up to <strong>{fmtFull(Number(it.preview.amount))}</strong>
                      {it.preview.footsToFile === true && <>, which matches the file's own Total line to the cent</>}
                      {it.preview.footsToFile === false && <>. The file's own Total line says {fmtFull(it.preview.fileTotal / 100)}: check the mapping</>}
                      {it.preview.setAside["total line"] ? <>. Its Total line is set aside, not added in twice</> : null}
                      {it.preview.setAside["no amount"] ? <>. {it.preview.setAside["no amount"]} {it.preview.setAside["no amount"] === 1 ? "line has" : "lines have"} no amount and {it.preview.setAside["no amount"] === 1 ? "is" : "are"} left out</> : null}.
                      {" "}These never become gifts or donors.
                    </div>) : <div style={{ fontSize: 12.5, color: T.ink }}>{it.preview.sentence}</div>)}
                </>)}
              </div>);
          })}
          {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn(true)} disabled={busy} data-testid="old-reports-import" onClick={run}>{busy ? "Bringing them in…" : `Bring in ${items.length} ${items.length === 1 ? "report" : "reports"}`}</button>
            <button type="button" style={btn(false)} onClick={() => setStep(2)}>Back</button>
          </div>
        </>)}
      </div>
    </Modal>
  );
}
