// SALES-1 · Import a CSV of organizations, contacts or deals. HubSpot's
// standard export columns map themselves; every column can be re-mapped. The
// preview shows the first rows as they'd be written and how many already
// exist; choose skip, update or create for those. Each import can be undone
// as a whole.
// SALES-2 item 1: a lead list (one row per organization, with its ED and DD) lands in a
// named list. SALES-FIX-1: the preview says what won't link and why, the commit lists the
// rows that didn't, and the column map is a two-column list (file column → Steward field)
// that wraps at 1440 and at 390.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, CREAM, card, h2, says, btn, quiet, box, link, brassTag, whenWords, Failure, failureWords } from "./salesBits";

const MODES = [["skip", "Skip them (their links and lists are still added)"], ["update", "Update them with the file's values"], ["create", "Create another record anyway"]];
const OBJECTS = [["prospect", "A lead list (organizations with their ED and DD)"], ["org", "Organizations"], ["contact", "Contacts"], ["deal", "Deals"]];
const OBJECT_WORDS = { prospect: "Lead list", org: "Organizations", contact: "Contacts", deal: "Deals" };
const SAME = { prospect: "website, EIN, or name and state", org: "domain", contact: "email, or name at the same organization", deal: "deal name" };

function MapList({ pv, mapping, setMapping }) {
  return <div role="list" aria-label="Column map" data-import-map="1"
    style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", columnGap: 12, rowGap: 6, background: CREAM, padding: 10, borderRadius: 8, alignItems: "center", maxWidth: 760 }}>
    <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.65 }}>Column in the file</div>
    <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.65 }}>Steward field</div>
    {pv.headers.map(h => [
      <div key={`h:${h}`} role="listitem" style={{ fontSize: 12.5, minWidth: 0, overflowWrap: "anywhere", lineHeight: 1.3 }} data-import-col={h}>{h}</div>,
      <select key={`s:${h}`} value={mapping[h] || ""} onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))} style={{ ...box, width: "100%", minWidth: 0 }} aria-label={`Map ${h}`}>
        <option value="">Don't import</option>{pv.targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>,
    ])}
  </div>;
}

export default function ImportPanel({ meta, onChanged, onClose }) {
  const [object, setObject] = useState("prospect");
  const [file, setFile] = useState(null);   // { name, text }
  const [pv, setPv] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [mode, setMode] = useState("skip");
  const [listName, setListName] = useState("");
  const [msg, setMsg] = useState(null);
  const [fail, setFail] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const loadRecent = useCallback(() => apiFetch("/ops/sales/imports").then(d => setRecent(d.imports)).catch(() => {}), []);
  useEffect(() => { loadRecent(); }, [loadRecent]);
  const lists = meta.lists || [];
  const listable = object === "prospect" || object === "org";

  const preview = async (map = null) => {
    if (!file) return;
    setBusy(true); setMsg(null); setFail(null); setResult(null);
    try { const d = await apiFetch("/ops/sales/import/preview", { method: "POST", body: JSON.stringify({ object, csv: file.text, mapping: map }) }); setPv(d); setMapping(d.mapping); }
    catch (e) { setFail(e); setPv(null); }
    setBusy(false);
  };
  useEffect(() => { setPv(null); setMapping(null); setResult(null); }, [object, file]);
  const pick = e => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setFile({ name: f.name, text: String(r.result || "") }); r.readAsText(f); };
  const commit = async () => {
    setBusy(true); setMsg(null); setFail(null);
    try {
      const list = listable && listName.trim() ? (lists.find(l => l.id === listName) ? { id: listName } : { name: listName.trim() }) : null;
      const d = await apiFetch("/ops/sales/import/commit", { method: "POST", body: JSON.stringify({ object, csv: file.text, mapping, mode, fileName: file.name, list }) });
      const c = d.counts;
      const people = c.people ? ` People: ${c.people.created} created, ${c.people.updated} updated, ${c.people.skipped} skipped.` : "";
      setMsg(`Imported: ${c.created} created, ${c.updated} updated, ${c.skipped} skipped, ${c.linked} links made.${people}${c.list ? ` On the list "${c.list.name}".` : ""}${c.problems.length ? ` ${c.problems.length} rows not imported (row ${c.problems[0].row}: ${c.problems[0].says})` : ""}`);
      setResult(c); setPv(null); setFile(null); loadRecent(); onChanged();
    } catch (e) { setFail(e); }
    setBusy(false);
  };
  const undo = async id => { setMsg(null); setFail(null); try { const d = await apiFetch(`/ops/sales/import/${id}/undo`, { method: "POST", body: "{}" }); setMsg(`Undone: ${d.removed} removed, ${d.restored} restored, ${d.unlinked} links removed.`); loadRecent(); onChanged(); } catch (e) { setMsg(failureWords(e, "That import could not be undone.")); } };
  const shownList = (lists.find(l => l.id === listName) || {}).name || listName;

  return <div data-sales-importer="1">
    <button type="button" style={{ ...link, marginBottom: 10 }} onClick={onClose}>← Back to Sales</button>
    <section style={card}>
      <h2 style={h2}>Import a CSV</h2>
      <p style={says}>A lead list is one row per organization, in any shape: its name, EIN, city, state, revenue, type, website and phone, and the executive director's and development director's name, email and phone. HubSpot's Companies, Contacts and Deals exports read as they are. Contacts and deals are linked to their organization by its domain, or else its name, so import organizations first.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={object} onChange={e => setObject(e.target.value)} style={{ ...box, maxWidth: "100%" }} aria-label="What the file holds" data-import-object="1">
          {OBJECTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="file" accept=".csv,text/csv" onChange={pick} aria-label="CSV file" data-import-file="1" style={{ maxWidth: "100%" }} />
        <button type="button" style={btn} onClick={() => preview(null)} disabled={!file || busy} data-import-preview="1">Preview</button>
      </div>
      {fail ? <Failure e={fail} fallback={failureWords(fail, "The import could not be read.")} testid="import-failure" /> : null}
      {msg ? <p style={{ ...says, opacity: 1, marginTop: 10 }} data-import-msg="1">{msg}</p> : null}
      {result && result.unlinked && result.unlinked.length ? <div style={{ fontSize: 12.5, marginTop: 6 }} data-import-unlinked="1">
        <span style={brassTag}>{result.unlinkedRows} rows not linked</span>
        {result.unlinked.slice(0, 20).map(u => <div key={u.row} style={{ padding: "2px 0" }}>Row {u.row}: {u.says}</div>)}
        {result.unlinkedRows > 20 ? <div style={{ opacity: 0.7 }}>and {result.unlinkedRows - 20} more.</div> : null}
        <div style={{ opacity: 0.75, marginTop: 4 }}>Import those organizations, then import this file again with Skip: the links are added and nobody is duplicated.</div>
      </div> : null}
      {pv ? <div style={{ marginTop: 14 }}>
        <p style={says}>{pv.says || `${pv.rows} rows.`} {pv.duplicates ? <><span style={brassTag}>{pv.duplicates} already exist</span> (same {SAME[object]}).</> : "None already exists."}</p>
        {pv.warning ? <p style={{ ...says, opacity: 1 }} data-import-warning="1"><span style={brassTag}>Before you import</span> {pv.warning}</p> : null}
        <MapList pv={pv} mapping={mapping} setMapping={setMapping} />
        <button type="button" style={{ ...quiet, marginTop: 8 }} onClick={() => preview(mapping)} disabled={busy}>Preview with these columns</button>
        <div style={{ overflowX: "auto", marginTop: 10 }}><table style={{ borderCollapse: "collapse", fontSize: 12.5 }}><tbody>
          {pv.sample.map((s, i) => <tr key={i} style={{ borderTop: `1px solid ${CREAM}` }} data-import-sample={i}>
            <td style={{ padding: "4px 10px 4px 0", verticalAlign: "top" }}>{s.duplicateOf ? <span style={brassTag}>exists</span> : "new"}</td>
            <td style={{ padding: "4px 10px 4px 0", verticalAlign: "top" }}>{Object.entries(s.body).filter(([k]) => !["props", "pipeline_id", "stage_id"].includes(k)).map(([k, v]) => `${k}: ${[].concat(v).join(", ")}`).join(" · ")}</td>
            <td style={{ padding: "4px 0", opacity: 0.85, verticalAlign: "top" }}>
              {s.people ? s.people.map(p => <div key={p.role}>{p.role}: {p.name || "–"}{p.email ? ` · ${p.email}` : ""}{p.phone ? ` · ${p.phone}` : <span style={{ opacity: 0.7 }}> · no phone</span>}</div>) : null}
              {(s.links || []).map((l, j) => <div key={j}>{l.ok ? l.says : <span style={brassTag}>{l.says}</span>}</div>)}
              {!s.people && !(s.links || []).length ? [s.assoc.stageName].filter(Boolean).join(" · ") : null}
            </td>
          </tr>)}</tbody></table></div>
        {(() => { const below = (pv.unlinked || []).filter(u => u.row > pv.sample.length + 1);   // rows past the sample above
          return below.length ? <p style={{ ...says, marginTop: 6 }} data-import-preview-unlinked="1">Further down the file, won't link: {below.slice(0, 5).map(u => `row ${u.row}, ${u.says}`).join("; ")}{below.length > 5 ? `; and ${below.length - 5} more` : ""}.</p> : null; })()}
        {listable ? <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>Put the organizations on a list:</b>
          <input list="sales-list-names" value={shownList} onChange={e => { const l = lists.find(x => x.name === e.target.value); setListName(l ? l.id : e.target.value); }}
            placeholder="e.g. KY orgs $100K–$2M" style={{ ...box, minWidth: 0, width: 260, maxWidth: "100%" }} aria-label="List name" data-import-list="1" />
          <datalist id="sales-list-names">{lists.map(l => <option key={l.id} value={l.name} />)}</datalist>
          <span style={{ fontSize: 12, opacity: 0.7 }}>An existing list's name adds to it; a new name makes one. Leave it empty for none.</span>
        </div> : null}
        <div style={{ marginTop: 10 }}><b style={{ fontSize: 13 }}>For a row that already exists:</b>
          {MODES.map(([k, l]) => <label key={k} style={{ display: "block", fontSize: 13 }}><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} /> {l}</label>)}</div>
        <button type="button" style={{ ...btn, marginTop: 10 }} onClick={commit} disabled={busy} data-import-commit="1">{busy ? "Importing…" : `Import ${pv.rows} rows`}</button>
      </div> : null}
    </section>
    <section style={card}>
      <h2 style={h2}>Recent imports</h2>
      {recent.length === 0 ? <p style={says}>None yet.</p> : recent.map(r => <div key={r.id} style={{ fontSize: 13, padding: "6px 0", borderTop: `1px solid ${CREAM}`, display: "flex", gap: 8, flexWrap: "wrap", color: INK }} data-import-row={r.id}>
        <span>{whenWords(r.created_at)}</span><b>{OBJECT_WORDS[r.object] || r.object}</b><span>{r.file_name || ""}</span>
        <span style={{ opacity: 0.75 }}>{r.counts.created} created · {r.counts.updated} updated · {r.counts.skipped} skipped{r.counts.unlinkedRows ? ` · ${r.counts.unlinkedRows} not linked` : ""}{r.counts.list ? ` · list "${r.counts.list.name}"` : ""}</span>
        {r.undone_at ? <span style={{ opacity: 0.6 }}>undone {whenWords(r.undone_at)}</span> : <button type="button" style={link} onClick={() => undo(r.id)} data-import-undo={r.id}>Undo this import</button>}
      </div>)}
    </section>
  </div>;
}
