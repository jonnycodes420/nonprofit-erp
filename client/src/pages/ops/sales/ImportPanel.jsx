// SALES-1 · Import a CSV of organizations, contacts or deals. HubSpot's
// standard export columns map themselves; every column can be re-mapped. The
// preview shows the first rows as they'd be written and how many already
// exist; choose skip, update or create for those. Each import can be undone
// as a whole.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { CREAM, card, h2, says, btn, quiet, box, link, brassTag, whenWords } from "./salesBits";

const MODES = [["skip", "Skip them"], ["update", "Update them with the file's values"], ["create", "Create another record anyway"]];

export default function ImportPanel({ meta, onChanged, onClose }) {
  const [object, setObject] = useState("org");
  const [file, setFile] = useState(null);   // { name, text }
  const [pv, setPv] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [mode, setMode] = useState("skip");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const loadRecent = useCallback(() => apiFetch("/ops/sales/imports").then(d => setRecent(d.imports)).catch(() => {}), []);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const preview = async (map = null) => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try { const d = await apiFetch("/ops/sales/import/preview", { method: "POST", body: JSON.stringify({ object, csv: file.text, mapping: map }) }); setPv(d); setMapping(d.mapping); }
    catch (e) { setMsg(e.message); setPv(null); }
    setBusy(false);
  };
  useEffect(() => { setPv(null); setMapping(null); }, [object, file]);
  const pick = e => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setFile({ name: f.name, text: String(r.result || "") }); r.readAsText(f); };
  const commit = async () => {
    setBusy(true); setMsg(null);
    try {
      const d = await apiFetch("/ops/sales/import/commit", { method: "POST", body: JSON.stringify({ object, csv: file.text, mapping, mode, fileName: file.name }) });
      const c = d.counts;
      setMsg(`Imported: ${c.created} created, ${c.updated} updated, ${c.skipped} skipped, ${c.linked} links made.${c.problems.length ? ` ${c.problems.length} rows not imported (row ${c.problems[0].row}: ${c.problems[0].says})` : ""}`);
      setPv(null); setFile(null); loadRecent(); onChanged();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const undo = async id => { setMsg(null); try { const d = await apiFetch(`/ops/sales/import/${id}/undo`, { method: "POST", body: "{}" }); setMsg(`Undone: ${d.removed} removed, ${d.restored} restored, ${d.unlinked} links removed.`); loadRecent(); onChanged(); } catch (e) { setMsg(e.message); } };

  return <div data-sales-importer="1">
    <button type="button" style={{ ...link, marginBottom: 10 }} onClick={onClose}>← Back to Sales</button>
    <section style={card}>
      <h2 style={h2}>Import a CSV</h2>
      <p style={says}>HubSpot's Companies, Contacts and Deals exports read as they are. Contacts and deals are linked to their organization by its domain, or else its name, so import organizations first.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={object} onChange={e => setObject(e.target.value)} style={box} aria-label="What the file holds" data-import-object="1">
          <option value="org">Organizations</option><option value="contact">Contacts</option><option value="deal">Deals</option></select>
        <input type="file" accept=".csv,text/csv" onChange={pick} aria-label="CSV file" data-import-file="1" />
        <button type="button" style={btn} onClick={() => preview(null)} disabled={!file || busy} data-import-preview="1">Preview</button>
      </div>
      {msg ? <p style={{ ...says, opacity: 1, marginTop: 10 }} data-import-msg="1">{msg}</p> : null}
      {pv ? <div style={{ marginTop: 14 }}>
        <p style={says}>{pv.rows} rows. {pv.duplicates ? <><span style={brassTag}>{pv.duplicates} already exist</span> (same {object === "org" ? "domain" : object === "contact" ? "email" : "deal name"}).</> : "None already exists."}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6, background: CREAM, padding: 10, borderRadius: 8 }}>
          {pv.headers.map(h => <label key={h} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ flex: "0 0 120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h}>{h}</span>
            <select value={mapping[h] || ""} onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))} style={{ ...box, flex: 1 }} aria-label={`Map ${h}`}>
              <option value="">Don't import</option>{pv.targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>)}
        </div>
        <button type="button" style={{ ...quiet, marginTop: 8 }} onClick={() => preview(mapping)} disabled={busy}>Preview with these columns</button>
        <div style={{ overflowX: "auto", marginTop: 10 }}><table style={{ borderCollapse: "collapse", fontSize: 12.5 }}><tbody>
          {pv.sample.map((s, i) => <tr key={i} style={{ borderTop: `1px solid ${CREAM}` }}>
            <td style={{ padding: "4px 10px 4px 0" }}>{s.duplicateOf ? <span style={brassTag}>exists</span> : "new"}</td>
            <td style={{ padding: "4px 10px 4px 0" }}>{Object.entries(s.body).filter(([k]) => !["props", "pipeline_id", "stage_id"].includes(k)).map(([k, v]) => `${k}: ${[].concat(v).join(", ")}`).join(" · ")}</td>
            <td style={{ padding: "4px 0", opacity: 0.75 }}>{[s.assoc.orgName || s.assoc.orgDomain, s.assoc.stageName, (s.assoc.contacts || []).join(", ")].filter(Boolean).join(" · ")}</td>
          </tr>)}</tbody></table></div>
        <div style={{ marginTop: 10 }}><b style={{ fontSize: 13 }}>For a row that already exists:</b>
          {MODES.map(([k, l]) => <label key={k} style={{ display: "block", fontSize: 13 }}><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} /> {l}</label>)}</div>
        <button type="button" style={{ ...btn, marginTop: 10 }} onClick={commit} disabled={busy} data-import-commit="1">{busy ? "Importing…" : `Import ${pv.rows} rows`}</button>
      </div> : null}
    </section>
    <section style={card}>
      <h2 style={h2}>Recent imports</h2>
      {recent.length === 0 ? <p style={says}>None yet.</p> : recent.map(r => <div key={r.id} style={{ fontSize: 13, padding: "6px 0", borderTop: `1px solid ${CREAM}`, display: "flex", gap: 8, flexWrap: "wrap" }} data-import-row={r.id}>
        <span>{whenWords(r.created_at)}</span><b>{meta.objects[r.object].plural}</b><span>{r.file_name || ""}</span>
        <span style={{ opacity: 0.75 }}>{r.counts.created} created · {r.counts.updated} updated · {r.counts.skipped} skipped</span>
        {r.undone_at ? <span style={{ opacity: 0.6 }}>undone {whenWords(r.undone_at)}</span> : <button type="button" style={link} onClick={() => undo(r.id)} data-import-undo={r.id}>Undo this import</button>}
      </div>)}
    </section>
  </div>;
}
