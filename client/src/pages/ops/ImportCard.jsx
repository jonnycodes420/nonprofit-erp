// LEAD-IMPORT-1 · "Import a walk report" on /ops (super-admins only: the routes
// answer 404 to anyone else). Drop or pick a .md file, a walk report or the QA
// fleet lead's summary. The preview says what it would add, verify or reopen
// and lists every line it could not read; Confirm writes it. The same file
// twice changes nothing.
import { useRef, useState } from "react";
import { apiFetch } from "../../api";
import { countLabel } from "../../../../shared/countWords.js";
import { TierPill, dayWords } from "./leadBits";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A";
const card = { background: WHITE, borderRadius: 10, padding: "18px 20px", marginBottom: 18, border: "1px solid rgba(15,26,18,0.08)" };
const says = { fontSize: 13, opacity: 0.7, margin: "0 0 10px" };
const row = { padding: "7px 0", borderTop: `1px solid ${CREAM}` };
const btn = primary => ({ fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", minHeight: 36,
  border: `1px solid ${primary ? EMERALD : INK + "33"}`, background: primary ? EMERALD : WHITE, color: primary ? WHITE : INK });

export function PreviewView({ p, onConfirm, onCancel, busy }) {
  const c = p.changes;
  const fails = p.items.filter(i => i.verdict === "FAIL"), passes = p.items.filter(i => i.verdict === "PASS");
  return <div data-testid="import-preview">
    <p style={{ fontSize: 14, margin: "4px 0 8px" }}>
      <b>{p.file}</b> · {p.shape === "lead" ? "the lead's summary" : "a walk report"} for {dayWords(p.date)}.{" "}
      {p.duplicate ? <span data-testid="import-duplicate">This file was already imported{p.duplicate.by ? ` by ${p.duplicate.by}` : ""}; importing it again changes nothing.</span>
        : <>It would add {countLabel(c.added.length, "item")}, verify {c.verified.length}, reopen {c.reopened.length}; {c.stillOpen.length} already open.</>}
    </p>
    {/* Stacked rows, not a table: they read the same at 390 wide. */}
    {[...fails, ...passes].map(i => <div key={i.verdict + (i.id || i.check)} data-item={i.id || i.check} style={row}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}><TierPill tier={i.tier} />{i.id || i.check}</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{[i.fleetArea, i.seen && i.seen.toLowerCase(), i.verdict === "PASS" ? "passing again" : null].filter(Boolean).join(" · ")}</span>
        {i.effect ? <span style={{ fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>{i.effect}</span> : null}
      </div>
      {i.words ? <div style={{ fontSize: 13, marginTop: 2 }}>{i.words}</div> : null}
      {i.evidence ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2, overflowWrap: "anywhere" }}>evidence {i.evidence}</div> : null}
    </div>)}
    {p.unread.length > 0 && <div data-testid="import-unread" style={{ marginTop: 10, background: CREAM, borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{countLabel(p.unread.length, "line")} not read</div>
      {p.unread.map(u => <div key={u.line} style={{ fontSize: 12, margin: "2px 0" }}>Line {u.line}: {u.text} <span style={{ opacity: 0.7 }}>({u.why})</span></div>)}
    </div>}
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      {!p.duplicate && <button type="button" style={btn(true)} disabled={busy} onClick={onConfirm}>{busy ? "Importing…" : "Confirm import"}</button>}
      <button type="button" style={btn(false)} disabled={busy} onClick={onCancel}>{p.duplicate ? "Close" : "Cancel"}</button>
    </div>
  </div>;
}

export default function ImportCard({ onImported }) {
  const [file, setFile] = useState(null);       // { name, text }
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef(null);

  const take = async f => {
    setError(null); setPreview(null); setDone(null);
    if (!f) return;
    if (!/\.md$/i.test(f.name)) { setError("Pick the report as a .md file."); return; }
    const text = await f.text();
    setFile({ name: f.name, text }); setBusy(true);
    try { setPreview(await apiFetch("/ops/imports/preview", { method: "POST", body: JSON.stringify({ fileName: f.name, text }) })); }
    catch (e) { setError(e && e.status === 404 ? "This is for Steward's super-admins." : (e && e.message) || "The file could not be read."); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch("/ops/imports", { method: "POST", body: JSON.stringify({ fileName: file.name, text: file.text }) });
      setDone(r.unchanged ? `${file.name} was already imported; nothing changed.` : `Imported ${file.name}: ${countLabel(r.changes.added.length, "new item")}, ${r.changes.verified.length} verified, ${r.changes.reopened.length} reopened.`);
      setPreview(null); setFile(null);
      if (onImported) onImported();
    } catch (e) { setError((e && e.message) || "The import did not go through. Try again."); }
    finally { setBusy(false); }
  };

  return <section style={card} data-testid="ops-import">
    <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Import a walk report</h2>
    <p style={says}>A Muse walk report or the QA fleet lead's morning summary (lead-YYYY-MM-DD.md). You see what it would change before anything is saved, and the same file twice changes nothing.</p>
    {!preview && <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files && e.dataTransfer.files[0]); }}
      style={{ border: `1.5px dashed ${over ? EMERALD : INK + "40"}`, borderRadius: 8, padding: "16px 14px", background: over ? CREAM : WHITE, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13 }}>{busy ? "Reading…" : "Drop a .md file here, or"}</span>
      <button type="button" style={btn(false)} disabled={busy} onClick={() => input.current && input.current.click()}>Choose a file</button>
      <input ref={input} type="file" accept=".md,text/markdown" aria-label="Walk report file" style={{ display: "none" }}
        onChange={e => { take(e.target.files && e.target.files[0]); e.target.value = ""; }} />
    </div>}
    {error && <p role="alert" style={{ fontSize: 13, margin: "10px 0 0", background: CREAM, padding: "8px 10px", borderRadius: 6 }}>{error}</p>}
    {done && <p role="status" style={{ fontSize: 13, margin: "10px 0 0", color: EMERALD, fontWeight: 600 }}>{done}</p>}
    {preview && <PreviewView p={preview} busy={busy} onConfirm={confirm} onCancel={() => { setPreview(null); setFile(null); }} />}
  </section>;
}
