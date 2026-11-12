// SALES-1 · the list of one object: chosen columns (custom properties too),
// a sort on any column, filters on any property or association, saved views,
// bulk edit / owner / stage / delete, export of the view as CSV, and for deals
// a board to drag between stages. The server filters and sorts (lists.js
// applyView); this draws its answer.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, WHITE, CREAM, BRASS, TERRA, card, says, btn, quiet, box, link, brassTag, showValue, fieldsOf, valueAt, downloadCsv, Failure, failureWords } from "./salesBits";
import Board from "./Board";
import NewRecord from "./NewRecord";

const OP_WORDS = { eq: "is", neq: "is not", contains: "contains", empty: "is empty", notempty: "is not empty", gt: "more than", lt: "less than",
  before: "before", after: "after", in: "is any of", is_true: "is yes", is_false: "is no", none_since: "none since" };
const NO_VALUE = new Set(["empty", "notempty", "is_true", "is_false"]);
const opsFor = t => (t === "number" || t === "currency" ? ["eq", "gt", "lt", "empty", "notempty"]
  : t === "date" ? ["before", "after", "none_since", "empty", "notempty"] : t === "checkbox" ? ["is_true", "is_false"]
  : t === "stage" || t === "owner" || t === "picklist" || t === "multiselect" || t === "org" || t === "salesList" ? ["in", "empty", "notempty"] : ["contains", "eq", "neq", "empty", "notempty"]);

function FilterRow({ f, fields, meta, onChange, onRemove }) {
  const field = fields.find(x => x.key === f.field) || fields[0];
  const ops = opsFor(field.type);
  const choices = field.type === "stage" ? meta.pipelines.flatMap(p => p.stages.map(s => [s.id, meta.pipelines.length > 1 ? `${p.name}: ${s.name}` : s.name]))
    : field.type === "owner" ? meta.owners.map(o => [o.id, o.name]) : field.type === "salesList" ? (meta.lists || []).map(l => [l.id, l.name]) : (field.options || []).map(o => [o, o]);
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }} data-sales-filter={f.field}>
    <select value={f.field} onChange={e => { const nf = fields.find(x => x.key === e.target.value); onChange({ field: nf.key, op: opsFor(nf.type)[0], value: "" }); }} style={box} aria-label="Filter on">
      {fields.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
    <select value={f.op} onChange={e => onChange({ ...f, op: e.target.value })} style={box} aria-label="How">{ops.map(o => <option key={o} value={o}>{OP_WORDS[o]}</option>)}</select>
    {NO_VALUE.has(f.op) ? null : choices.length && f.op === "in"
      ? <select multiple value={[].concat(f.value || [])} onChange={e => onChange({ ...f, value: [...e.target.selectedOptions].map(o => o.value) })} style={{ ...box, minWidth: 180, height: 70 }} aria-label="Values">
          {choices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      : <input value={f.value || ""} type={field.type === "date" ? "date" : field.type === "number" || field.type === "currency" ? "number" : "text"}
          onChange={e => onChange({ ...f, value: e.target.value })} style={box} aria-label="Value" />}
    <button type="button" style={{ ...quiet, minHeight: 28, padding: "3px 9px" }} onClick={onRemove} aria-label="Remove filter">×</button>
  </div>;
}

// SALES-2: a prospect list opens here as the Organizations list with "On the list" first.
export default function ListView({ type, meta, open, onChanged, onMeta, list = null, startCalling = null }) {
  const obj = meta.objects[type];
  const fields = useMemo(() => [{ key: "name", label: "Name", type: "text" }, ...fieldsOf(meta, type).filter(f => !["first_name", "last_name", "name"].includes(f.key)),
    ...meta.assocFields[type].map(a => ({ ...a, assoc: true }))], [meta, type]);
  const [columns, setColumns] = useState(["name", ...obj.defaultColumns.filter(c => c !== "name")]);
  const [filters, setFilters] = useState([]);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [mode, setMode] = useState("list");
  const [showCols, setShowCols] = useState(false);
  const [msg, setMsg] = useState(null);
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState({ action: "", field: "", value: "" });
  const listFilter = list ? [{ field: "list_ids", op: "in", value: [list.id] }] : [];
  const liveFilters = filters.filter(f => NO_VALUE.has(f.op) || (f.value !== "" && f.value != null));
  const viewJson = JSON.stringify({ filters: [...listFilter, ...liveFilters], sort, q });
  useEffect(() => { if (list && list.config) { setFilters(list.config.filters || []); if (list.config.sort) setSort(list.config.sort); } }, [list]);
  useEffect(() => { if (type === "org") setColumns(c => (c.includes("fit_line") ? c : [...c.slice(0, 1), "fit_line", ...c.slice(1)])); }, [type]);

  const load = useCallback(() => apiFetch(`/ops/sales/list/${type}?view=${encodeURIComponent(viewJson)}`).then(d => { setData(d); setSel(new Set()); })
    .catch(e => setData({ ok: false, err: e })), [type, viewJson]);
  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);

  const views = meta.views.filter(v => v.object === type);
  const applyView = v => { const c = v.config || {}; setFilters(c.filters || []); setSort(c.sort || { key: "name", dir: "asc" }); if (c.columns) setColumns(c.columns); setQ(c.q || ""); };
  const [viewName, setViewName] = useState("");
  const doSaveView = async () => {
    if (!viewName.trim()) return;
    await apiFetch("/ops/sales/views", { method: "POST", body: JSON.stringify({ object: type, name: viewName, config: { filters, sort, columns, q } }) });
    setViewName(""); setMsg(`Saved the view "${viewName}".`); onMeta();
  };
  const doBulk = async () => {
    if (!sel.size || !bulk.action) return;
    if (bulk.action === "delete" && bulk.value !== "confirm") { setBulk(b => ({ ...b, value: "confirm" })); return; }
    try {
      const body = { ids: [...sel], action: bulk.action, field: bulk.field, value: bulk.action === "delete" ? undefined : bulk.value };
      const r = await apiFetch(`/ops/sales/bulk/${type}`, { method: "POST", body: JSON.stringify(body) });
      setMsg(`Done on ${r.done} of ${sel.size}.${r.problems.length ? ` Not done: ${r.problems.map(p => p.says).slice(0, 3).join("; ")}` : ""}`);
      setBulk({ action: "", field: "", value: "" }); load(); onChanged();
    } catch (e) { setMsg(e.message); }
  };
  // SALES-2 item 1: this view, saved as a named list with these organizations on it.
  const [listNameDraft, setListNameDraft] = useState("");
  const saveAsList = async () => {
    if (!listNameDraft.trim()) return;
    try {
      const r = await apiFetch("/ops/sales/lists", { method: "POST", body: JSON.stringify({ name: listNameDraft, config: { filters: liveFilters, sort }, add: ((data && data.rows) || []).map(x => x.id) }) });
      setMsg(`Saved the list "${listNameDraft}" with ${((data && data.rows) || []).length} organizations.`); setListNameDraft(""); onMeta(); void r;
    } catch (e) { setMsg(failureWords(e, "The list was not saved.")); }
  };
  const saveListFilters = async () => {
    try { await apiFetch(`/ops/sales/lists/${encodeURIComponent(list.id)}`, { method: "PATCH", body: JSON.stringify({ config: { filters: liveFilters, sort } }) }); setMsg(`Saved these filters on "${list.name}".`); onMeta(); }
    catch (e) { setMsg(failureWords(e, "The list was not saved.")); }
  };
  const exportCsv = () => downloadCsv(`/ops/sales/export/${type}?view=${encodeURIComponent(viewJson)}&columns=${encodeURIComponent(JSON.stringify(columns))}`, `steward-sales-${obj.plural.toLowerCase()}.csv`).catch(e => setMsg(e.message));
  const head = k => (fields.find(f => f.key === k) || { label: k }).label;
  const rows = (data && data.rows) || [];
  const editable = fieldsOf(meta, type).filter(f => !f.readOnly && f.type !== "stage" && f.type !== "pipeline" && f.type !== "list" && f.key !== "owner_id");

  return <section style={card} data-sales-list={type}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <button type="button" style={btn} onClick={() => setAdding(a => !a)} data-sales-new={type}>New {obj.label.toLowerCase()}</button>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Find in ${obj.plural.toLowerCase()}`} style={{ ...box, flex: "1 1 180px", maxWidth: 260 }} aria-label="Find in this list" />
      {views.length ? <select onChange={e => { const v = views.find(x => x.id === e.target.value); if (v) applyView(v); }} defaultValue="" style={box} aria-label="Saved views" data-sales-views="1">
        <option value="" disabled>Saved views</option>{views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select> : null}
      <button type="button" style={quiet} onClick={() => setFilters(f => [...f, { field: fields[1].key, op: opsFor(fields[1].type)[0], value: "" }])} data-sales-add-filter="1">Add filter</button>
      <button type="button" style={quiet} onClick={() => setShowCols(s => !s)}>Columns</button>
      <button type="button" style={quiet} onClick={exportCsv} data-sales-export="1">Export CSV</button>
      {type === "deal" ? <button type="button" style={quiet} onClick={() => setMode(m => (m === "list" ? "board" : "list"))} data-sales-board-toggle="1">{mode === "list" ? "Board" : "List"}</button> : null}
      {type === "org" && startCalling ? <button type="button" style={btn} onClick={() => startCalling({ filters: liveFilters, sort, q }, list ? list.id : null)} data-sales-start-calling="1">Start calling</button> : null}
    </div>
    {list ? <p style={{ ...says, opacity: 1 }} data-sales-list-head={list.id}><b>{list.name}</b> · a list of {list.orgs} organizations. Its own filters and sort are below; the list keeps them when you save.{" "}
      <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={saveListFilters} data-sales-list-save="1">Save these filters on the list</button></p> : null}
    {adding ? <NewRecord type={type} meta={meta} onDone={id => { setAdding(false); load(); onChanged(); if (id) open(type, id); }} onCancel={() => setAdding(false)} /> : null}
    {filters.map((f, i) => <FilterRow key={i} f={f} fields={fields} meta={meta} onChange={nf => setFilters(fs => fs.map((x, j) => (j === i ? nf : x)))} onRemove={() => setFilters(fs => fs.filter((_, j) => j !== i))} />)}
    {filters.length ? <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "4px 0 10px" }}>
      <input value={viewName} onChange={e => setViewName(e.target.value)} placeholder="Name this view" style={box} aria-label="View name" data-sales-view-name="1" />
      <button type="button" style={quiet} onClick={doSaveView} disabled={!viewName.trim()} data-sales-save-view="1">Save view</button></div> : null}
    {type === "org" && !list ? <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "4px 0 10px", flexWrap: "wrap" }}>
      <input value={listNameDraft} onChange={e => setListNameDraft(e.target.value)} placeholder="Name a prospect list" style={box} aria-label="New list name" data-sales-list-name="1" />
      <button type="button" style={quiet} onClick={saveAsList} disabled={!listNameDraft.trim()} data-sales-save-list="1">Save these {data && data.rows ? data.rows.length : ""} as a list</button></div> : null}
    {showCols ? <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", background: CREAM, padding: 10, borderRadius: 8, marginBottom: 10 }}>
      {fields.map(f => <label key={f.key} style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}>
        <input type="checkbox" checked={columns.includes(f.key)} disabled={f.key === "name"} onChange={e => setColumns(c => (e.target.checked ? [...c, f.key] : c.filter(x => x !== f.key)))} />{f.label}</label>)}
    </div> : null}
    {sel.size ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: CREAM, padding: 8, borderRadius: 8, marginBottom: 10 }} data-sales-bulk="1">
      <b style={{ fontSize: 13 }}>{sel.size} selected</b>
      <select value={bulk.action} onChange={e => setBulk({ action: e.target.value, field: "", value: "" })} style={box} aria-label="Bulk action">
        <option value="">Choose…</option><option value="set">Edit a property</option><option value="owner">Change owner</option>
        {type === "deal" ? <option value="stage">Change stage</option> : null}<option value="delete">Delete</option></select>
      {bulk.action === "set" ? <><select value={bulk.field} onChange={e => setBulk(b => ({ ...b, field: e.target.value }))} style={box} aria-label="Property">
        <option value="">Property…</option>{editable.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
        <input value={bulk.value} onChange={e => setBulk(b => ({ ...b, value: e.target.value }))} style={box} aria-label="New value" placeholder="New value" /></> : null}
      {bulk.action === "owner" ? <select value={bulk.value} onChange={e => setBulk(b => ({ ...b, value: e.target.value }))} style={box} aria-label="Owner">
        <option value="">Owner…</option>{meta.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : null}
      {bulk.action === "stage" ? <select value={bulk.value} onChange={e => setBulk(b => ({ ...b, value: e.target.value }))} style={box} aria-label="Stage">
        <option value="">Stage…</option>{meta.pipelines.flatMap(p => p.stages.filter(s => s.kind !== "later" && s.kind !== "lost").map(s => <option key={s.id} value={s.id}>{meta.pipelines.length > 1 ? `${p.name}: ` : ""}{s.name}</option>))}</select> : null}
      <button type="button" onClick={doBulk} data-sales-bulk-go="1" style={bulk.action === "delete" && bulk.value === "confirm" ? { ...btn, background: TERRA } : btn}>
        {bulk.action === "delete" ? (bulk.value === "confirm" ? `Yes, delete ${sel.size}` : "Delete…") : "Apply"}</button>
      {bulk.action === "delete" && bulk.value === "confirm" ? <span style={{ fontSize: 12 }}>Deletes only these {sel.size}; what they link to stays.</span> : null}
    </div> : null}
    {msg ? <p style={{ ...says, opacity: 1 }}>{msg}</p> : null}
    {!data ? <p style={says}>Loading…</p> : data.ok === false ? <Failure e={data.err} fallback="This list could not be read." />
      : mode === "board" ? <Board rows={rows} meta={meta} open={open} onMoved={() => { load(); onChanged(); }} />
      : <>
        <p style={says}>{data.total === 1 ? "1 record" : `${data.total} records`}{filters.length ? " match the filters" : ""}. Click a heading to sort.</p>
        <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && sel.size === rows.length} onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th>
            {columns.map(k => <th key={k} style={{ textAlign: "left", fontSize: 12, fontWeight: 600, padding: "0 12px 8px 0", whiteSpace: "nowrap" }}>
              <button type="button" style={{ ...link, color: INK, fontWeight: 600, fontSize: 12, opacity: 0.75 }} data-sales-sort={k}
                onClick={() => { const sk = k === "fit_line" ? "fit_met" : k; setSort(s => ({ key: sk, dir: s.key === sk ? (s.dir === "asc" ? "desc" : "asc") : (sk === "fit_met" ? "desc" : "asc") })); }}>{head(k)}{sort.key === (k === "fit_line" ? "fit_met" : k) ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</button></th>)}
          </tr></thead>
          <tbody>{rows.map(r => <tr key={r.id} data-sales-row={r.id} style={{ background: type === "deal" && r.stage_kind === "open" && !r.next_step && !r.has_open_task ? `${BRASS}18` : WHITE }}>
            <td style={{ borderTop: `1px solid ${CREAM}` }}><input type="checkbox" aria-label={`Select ${r.displayName}`} checked={sel.has(r.id)} onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} /></td>
            {columns.map(k => { const f = fields.find(x => x.key === k) || { key: k, type: "text" };
              return <td key={k} style={{ padding: "7px 12px 7px 0", borderTop: `1px solid ${CREAM}`, verticalAlign: "top" }}>
                {k === "name" ? <><button type="button" style={link} onClick={() => open(type, r.id)}>{r.displayName}</button>{r.dnc ? <span style={{ ...brassTag, marginLeft: 6 }} title={r.dnc_reason || "Do not contact"}>Do not contact</span> : null}</>
                  : k === "open_deal_stage" ? [].concat(r.open_deal_stage || []).map(id => showValue({ type: "stage" }, id, meta)).join(", ") || "–"
                  : k === "has_open_task" ? (r.has_open_task ? "Yes" : <span style={brassTag}>No</span>)
                  : k === "fit_line" ? <span title={(r.fit_misses || []).join("; ") || "Meets every line of the fit rule."} data-fit={r.fit_met}>{r.fit_line}{(r.fit_misses || []).length ? <span style={{ opacity: 0.65 }}> · {(r.fit_misses || []).join("; ")}</span> : null}</span>
                  : k === "list_ids" ? [].concat(r.list_ids || []).map(id => ((meta.lists || []).find(l => l.id === id) || {}).name).filter(Boolean).join(", ") || "–"
                  : showValue(f, valueAt(r, k), meta)}</td>; })}
          </tr>)}</tbody>
        </table></div>
        {rows.length === 0 ? <p style={says}>{filters.length || q ? "No record matches." : `No ${obj.plural.toLowerCase()} yet. Add one, or import a CSV.`}</p> : null}
      </>}
  </section>;
}
