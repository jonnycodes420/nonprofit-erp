// SALES-4 item 4 · ADD PROSPECTS. Search ProPublica's Nonprofit Explorer by state, category and
// revenue; each row shows the organization, its city, revenue and year, its fit by Sales settings'
// rule, and whether it is already in Sales. Pick rows and add them to a named prospect list. When
// ProPublica can't be reached, the same rows come from a CSV of its results.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, CREAM, EMERALD, card, h2, says, btn, quiet, box, link, brassTag, Failure, failureWords } from "./salesBits";

const money = n => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);

export default function ProspectsPanel({ onClose, onAdded, startList }) {
  const [meta, setMeta] = useState(null);
  const [f, setF] = useState({ state: "KY", category: "food", min: "100000", max: "2000000", q: "", page: 0 });
  const [res, setRes] = useState(null);   // { rows, … } | { error }
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(new Set());
  const [listName, setListName] = useState("");
  const [listId, setListId] = useState("");
  const [msg, setMsg] = useState(null);
  const [all, setAll] = useState(false);
  const [csv, setCsv] = useState(false);
  useEffect(() => { apiFetch("/ops/sales/prospects/meta").then(setMeta).catch(e => setMeta({ ok: false, e })); }, []);

  const search = useCallback(async page => {
    setBusy(true); setMsg(null); setPick(new Set());
    const qs = new URLSearchParams({ state: f.state, category: f.category, min: f.min, max: f.max, q: f.q, page: String(page) });
    try { setRes(await apiFetch(`/ops/sales/prospects/search?${qs}`)); setF(x => ({ ...x, page })); }
    catch (e) { setRes({ error: e.status === 503 ? "unreachable" : "failed", message: failureWords(e, "The search failed.") }); }
    setBusy(false);
  }, [f]);
  const readCsv = async file => {
    setBusy(true); setMsg(null); setPick(new Set());
    try { const text = await file.text(); setRes({ ...(await apiFetch("/ops/sales/prospects/csv", { method: "POST", body: JSON.stringify({ csv: text, range: { min: f.min, max: f.max } }) })), fromCsv: true }); }
    catch (e) { setMsg(failureWords(e, "The file could not be read.")); }
    setBusy(false);
  };
  const add = async () => {
    setBusy(true); setMsg(null);
    const rows = res.rows.filter((r, i) => pick.has(i));
    try {
      const r = await apiFetch("/ops/sales/prospects/add", { method: "POST", body: JSON.stringify({ list: listId ? { id: listId } : { name: listName }, rows }) });
      setMsg({ says: r.says, listId: r.listId, listName: r.listName }); setPick(new Set()); onAdded();
      setRes(x => ({ ...x, rows: x.rows.map((row, i) => (pick.has(i) ? { ...row, already: row.already || { name: row.name, by: "added" } } : row)) }));
    } catch (e) { setMsg(failureWords(e, "Nothing was added.")); }
    setBusy(false);
  };

  if (!meta) return <section style={card}><p style={says}>Loading…</p></section>;
  if (meta.ok === false) return <section style={card}><Failure e={meta.e} fallback="Add prospects could not be read." /></section>;
  const rows = res && res.rows ? res.rows.map((r, i) => ({ ...r, i })).filter(r => all || r.inRange) : [];
  return <section style={card} data-sales-prospects="1">
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <button type="button" style={link} onClick={onClose}>← Back</button>
      <h2 style={{ ...h2, fontSize: 18, flex: 1 }}>Add prospects</h2>
    </div>
    <p style={says}>{meta.sentences.source}</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>State<br /><select value={f.state} onChange={e => setF(x => ({ ...x, state: e.target.value }))} style={box} data-pp-state="1">
        {meta.states.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Category<br /><select value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))} style={box} data-pp-category="1">
        {meta.categories.map(c => <option key={c.key} value={c.key} title={c.how}>{c.label}</option>)}</select></label>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Revenue from ($)<br /><input value={f.min} onChange={e => setF(x => ({ ...x, min: e.target.value }))} style={{ ...box, width: 110 }} inputMode="numeric" /></label>
      <label style={{ fontSize: 12, fontWeight: 600 }}>to ($)<br /><input value={f.max} onChange={e => setF(x => ({ ...x, max: e.target.value }))} style={{ ...box, width: 110 }} inputMode="numeric" /></label>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Words (optional)<br /><input value={f.q} onChange={e => setF(x => ({ ...x, q: e.target.value }))} style={{ ...box, width: 150 }} placeholder="e.g. pantry" /></label>
      <button type="button" style={btn} disabled={busy} onClick={() => search(0)} data-pp-search="1">{busy ? "Searching…" : "Search ProPublica"}</button>
      <button type="button" style={quiet} onClick={() => setCsv(c => !c)} data-pp-csv-open="1">Use a CSV instead</button>
    </div>
    {csv || (res && res.error === "unreachable") ? <div style={{ background: CREAM, borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 13 }} data-pp-csv="1">
      {res && res.error === "unreachable" ? <p style={{ margin: "0 0 6px" }}><span style={brassTag}>ProPublica unreachable</span> {res.message}</p> : <p style={{ margin: "0 0 6px" }}>A CSV with columns Name, EIN, City, State, Revenue, Year (and Phone, Executive director, Development director if you have them).</p>}
      <input type="file" accept=".csv,text/csv" onChange={e => e.target.files[0] && readCsv(e.target.files[0])} aria-label="CSV of ProPublica results" data-pp-csv-file="1" />
    </div> : null}
    {res && res.error && res.error !== "unreachable" ? <p style={says}>{res.message}</p> : null}
    {res && res.rows ? <>
      <p style={{ ...says, opacity: 1 }} data-pp-count="1">
        {res.fromCsv ? `${res.rows.length} rows in the file` : `Step ${res.page + 1} of ${res.pages}: ${res.looked} organizations looked at, ${res.rows.length} in the category`}, {res.shown} with revenue from {money(Number(f.min))} to {money(Number(f.max))}.{" "}
        <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => setAll(a => !a)}>{all ? "Show only those" : "Show all"}</button></p>
      <p style={says}>{meta.sentences.missing}</p>
      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead><tr>{["", "Organization", "City", "Revenue", "Year", "Fit", "Officers", ""].map((h, i) => <th key={i} style={{ textAlign: "left", fontSize: 12, fontWeight: 600, opacity: 0.7, padding: "0 10px 6px 0" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.i} data-pp-row={r.ein || r.name} style={{ opacity: r.already ? 0.6 : 1 }}>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 8px 6px 0" }}><input type="checkbox" aria-label={`Pick ${r.name}`} checked={pick.has(r.i)} disabled={!!r.already}
            onChange={e => setPick(s => { const n = new Set(s); e.target.checked ? n.add(r.i) : n.delete(r.i); return n; })} /></td>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 10px 6px 0" }}><b>{r.name}</b>{r.ein ? <div style={{ fontSize: 11.5, opacity: 0.65 }}>EIN {r.ein.slice(0, 2)}-{r.ein.slice(2)}{r.ntee ? ` · NTEE ${r.ntee}` : ""}</div> : null}</td>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 10px 6px 0" }}>{[r.city, r.state].filter(Boolean).join(", ")}</td>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 10px 6px 0" }}>{money(r.revenue)}</td>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 10px 6px 0" }}>{r.year || "–"}</td>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 10px 6px 0" }} title={(r.fit.misses || []).join("; ")}>{r.fit.line}</td>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 10px 6px 0", fontSize: 12.5 }}>{(r.officers || []).length ? r.officers.map(o => `${o.name} (${o.role === "ED" ? "ED" : "DD"})`).join(", ") : <span style={{ opacity: 0.6 }}>Not in ProPublica's data</span>}</td>
          <td style={{ borderTop: `1px solid ${CREAM}`, padding: "6px 0", fontSize: 12.5, whiteSpace: "nowrap" }}>
            {r.already ? <span style={brassTag}>{r.already.by === "added" ? "Added" : "Already in Sales"}</span> : null}{" "}
            {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: EMERALD, fontWeight: 600 }}>ProPublica</a> : null}</td>
        </tr>)}</tbody>
      </table></div>
      {!res.fromCsv && res.pages > 1 ? <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" style={quiet} disabled={busy || res.page <= 0} onClick={() => search(res.page - 1)}>Back</button>
        <button type="button" style={quiet} disabled={busy || res.page + 1 >= res.pages} onClick={() => search(res.page + 1)} data-pp-next="1">Look further</button></div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${INK}1a` }} data-pp-add="1">
        <b style={{ fontSize: 13 }}>{pick.size} picked.</b>
        <span style={{ fontSize: 13 }}>Add to</span>
        <select value={listId} onChange={e => setListId(e.target.value)} style={box} aria-label="Prospect list">
          <option value="">a new list…</option>{(meta.lists || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        {!listId ? <input value={listName} onChange={e => setListName(e.target.value)} placeholder="Name the list, e.g. KY food pantries" style={{ ...box, width: 230 }} aria-label="New list name" data-pp-list-name="1" /> : null}
        <button type="button" style={btn} disabled={busy || !pick.size || (!listId && !listName.trim())} onClick={add} data-pp-add-go="1">{pick.size ? `Add ${pick.size} to the list` : "Add to the list"}</button>
      </div>
    </> : null}
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 8 }} data-pp-msg="1">{typeof msg === "string" ? msg : <>{msg.says} <button type="button" style={link} onClick={() => startList(msg.listId)}>Start calling {msg.listName} →</button></>}</p> : null}
  </section>;
}
