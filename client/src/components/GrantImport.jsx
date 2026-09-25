// BUILD-100 (grants) Part 7 — THE GRANT IMPORTER, IN THE IMPORT MENU.
//
// A preset on the ONE mapper, never a second importer (the 89d rule): the file
// is read by the SAME parser every other import uses (Donors.jsx hands it in as
// `parseFile`), and everything that decides anything — which vendor wrote it,
// which column is which, which funder is which, what is refused and why —
// happens on the server in POST /grants/import/preview, which writes NOTHING.
// The import itself re-plans server-side and never trusts this screen's copy.
// The screen states what the import writes and what it does not, in the
// server's own words, before the button.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Modal, fmtFull } from "./shared";
import { errorMessage } from "../lib/domainError";

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box", maxWidth: "100%" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 40 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 40 };
const Num = ({ n, label, testid }) => (
  <div data-testid={testid} style={{ minWidth: 0 }}>
    <div style={{ fontSize: 24, fontFamily: "'DM Serif Display', Georgia, serif", color: T.ink }}>{n}</div>
    <div style={{ fontSize: 12, color: T.ink3 }}>{label}</div>
  </div>);

export function GrantImport({ onClose, parseFile, onDone }) {
  const [sources, setSources] = useState([]);
  const [file, setFile] = useState(null);           // {name, headers, rows}
  const [source, setSource] = useState("");
  const [funderCol, setFunderCol] = useState("");
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { apiFetch("/grants/import/sources").then(d => setSources(d.sources || [])).catch(() => setSources([])); }, []);

  const preview = async (f = file, src = source, fcol = funderCol) => {
    if (!f) return;
    setMsg(""); setBusy(true);
    try {
      const body = { headers: f.headers, rows: f.rows, source: src || undefined, mapping: fcol ? { funderName: fcol } : undefined };
      const p = await apiFetch("/grants/import/preview", { method: "POST", body: JSON.stringify(body) });
      setPlan(p); if (!src) setSource(p.source || "");
    } catch (e) {
      setPlan(e && e.code === "no_funder_column" ? { needsFunderColumn: true, headers: e.headers || f.headers } : null);
      setMsg(errorMessage(e, "That file could not be read."));
    } finally { setBusy(false); }
  };

  const pick = f => {
    if (!f) return;
    setMsg(""); setPlan(null); setResult(null);
    parseFile(f, {
      onSingle: (headers, rows) => { const x = { name: f.name, headers, rows }; setFile(x); preview(x, "", ""); },
      onMulti: () => setMsg("Save the grants sheet on its own and try again."),
      onWorkbook: ({ roled }) => {
        const s = [...roled].filter(r => r.rowCount > 0).sort((a, b) => b.rowCount - a.rowCount)[0];
        if (!s) { setMsg("No data rows found in this file."); return; }
        const x = { name: f.name + (roled.length > 1 ? ` (sheet ${s.name})` : ""), headers: s.headers, rows: s.rows };
        setFile(x); preview(x, "", "");
      },
      onError: m => setMsg(m),
    });
  };

  const commit = async () => {
    setMsg(""); setBusy(true);
    try {
      const r = await apiFetch("/grants/import", { method: "POST", body: JSON.stringify({ headers: file.headers, rows: file.rows, source, mapping: funderCol ? { funderName: funderCol } : undefined }) });
      setResult(r); onDone && onDone(r);
    } catch (e) { setMsg(errorMessage(e, "The import did not run. Nothing was written.")); }
    finally { setBusy(false); }
  };

  const srcMeta = sources.find(s => s.key === source);
  const footer = result
    ? <button style={primaryBtn} onClick={onClose}>Done</button>
    : <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button style={quietBtn} onClick={onClose}>Cancel</button>
        {plan && !plan.needsFunderColumn && plan.counts?.grants > 0 &&
          <button style={primaryBtn} disabled={busy} onClick={commit} data-testid="grant-import-commit">
            {busy ? "Importing…" : `Import ${plan.counts.grants} ${plan.counts.grants === 1 ? "grant" : "grants"}`}</button>}
      </div>;

  return (
    <Modal onClose={onClose} title="Import grants" width={720} footer={footer}>
      <div data-testid="grant-import" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!result && (
          <div>
            <div style={{ fontSize: 14, color: T.ink2, lineHeight: 1.55, marginBottom: 10 }}>
              A spreadsheet of grants from another system, or one you keep yourself. Steward reads it first and shows you what it found. Nothing is written until you press Import.
            </div>
            <input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={e => pick(e.target.files?.[0])} data-testid="grant-import-file" style={{ fontSize: 13, maxWidth: "100%" }} />
            {file && <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{file.name} · {file.rows.length} rows</div>}
          </div>)}

        {plan?.needsFunderColumn && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: T.ink2 }}>Which column holds the funder's name?
            <select value={funderCol} onChange={e => { setFunderCol(e.target.value); preview(file, source, e.target.value); }} style={inp} data-testid="grant-import-funder-col">
              <option value="">Choose a column</option>
              {(plan.headers || []).map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>)}

        {plan && !plan.needsFunderColumn && !result && (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: T.ink2 }}>Where this file came from
              <select value={source} onChange={e => { setSource(e.target.value); preview(file, e.target.value, funderCol); }} style={inp} data-testid="grant-import-source">
                {sources.map(s => <option key={s.key} value={s.key}>{s.label}{plan.detected?.source === s.key ? " (detected)" : ""}</option>)}
              </select>
              {srcMeta?.note && <span style={{ fontSize: 12, color: T.ink3 }}>{srcMeta.note}</span>}
            </label>
            <div data-testid="grant-import-counts" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12, background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px" }}>
              <Num n={plan.counts.grants} label="grants to import" testid="gi-grants" />
              <Num n={plan.counts.funders} label="funders" />
              <Num n={plan.counts.willCreateFunders} label="new funder records" testid="gi-new-funders" />
              <Num n={fmtFull(plan.pipeline)} label="open requests" />
            </div>
            {(plan.counts.skipped > 0) && <div style={{ fontSize: 13, color: T.ink3 }}>{plan.counts.skipped} {plan.counts.skipped === 1 ? "row is" : "rows are"} already on file and will be skipped.</div>}
            {plan.funders?.length > 0 && (
              <details>
                <summary style={{ fontSize: 13, color: T.ink2, cursor: "pointer" }}>The funders, and how each was matched</summary>
                {plan.funders.map(f => (
                  <div key={f.name} style={{ fontSize: 13, color: T.ink, padding: "5px 0", borderTop: "1px solid " + T.bg3 }}>
                    {f.name} <span style={{ color: T.ink3 }}>· {f.willCreate ? "new organisation record" : f.how === "ein" ? "matched by EIN" : "matched by name"} · {f.grants} {f.grants === 1 ? "grant" : "grants"}</span>
                  </div>))}
              </details>)}
            {plan.refused?.length > 0 && (
              <div data-testid="grant-import-refused">
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{plan.refused.length} {plan.refused.length === 1 ? "row is" : "rows are"} set aside</div>
                {plan.refused.slice(0, 20).map(r => <div key={r.line} style={{ fontSize: 12, color: T.ink3, padding: "3px 0" }}>Line {r.line}: {r.why}</div>)}
                {plan.refused.length > 20 && <div style={{ fontSize: 12, color: T.ink3 }}>and {plan.refused.length - 20} more</div>}
              </div>)}
            {plan.unrecognised?.length > 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Columns not read: {plan.unrecognised.join(", ")}</div>}
            <div data-testid="grant-import-writes" style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
              This writes {plan.writes.join(" and ")}. It does not write {plan.doesNotWrite.join(", ")}.
            </div>
          </>)}

        {result && (
          <div data-testid="grant-import-result" style={{ fontSize: 15, color: T.ink, lineHeight: 1.55 }}>{result.sentence}</div>)}
        {msg && <div role="status" style={{ fontSize: 13, color: T.ink3 }}>{msg}</div>}
      </div>
    </Modal>
  );
}
