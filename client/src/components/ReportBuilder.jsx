// BUILD-98 (switch) Part 3 — REPORTS PEOPLE CAN BUILD.
//
// The twelve standard reports, the org's saved ones, and a builder. The
// builder writes a DEFINITION — a list of field names from the server's
// catalogue — never SQL; the server compiles it (shared/reportBuilder.js).
import { useState, useEffect } from "react";
import { apiFetch, API } from "../api";
import { T, Card } from "./shared";
import { errorMessage } from "../lib/domainError";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };
const btn = (primary) => ({ background: primary ? T.gold : T.white, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9,
  padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer" });

function fmtCell(v, type) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money") return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === "bool") return v ? "Yes" : "No";
  return String(v);
}

async function download(path, name) {
  const r = await fetch(API + path, { headers: { Authorization: "Bearer " + localStorage.getItem("npe_token") } });
  if (!r.ok) throw new Error("Could not make the file.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function ResultTable({ out }) {
  if (!out) return null;
  return (
    <div style={{ overflowX: "auto" }} data-testid="rb-result">
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead><tr>{out.columns.map(c => <th key={c.key} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid " + T.bg3, color: T.ink3, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>{c.label}</th>)}</tr></thead>
        <tbody>{out.rows.map((r, i) => <tr key={i}>{out.columns.map(c => <td key={c.key} style={{ padding: "6px 10px", borderBottom: "1px solid " + T.bg3, color: T.ink }}>{fmtCell(r[c.key], c.type)}</td>)}</tr>)}</tbody>
      </table>
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>
        {out.totals.count.toLocaleString("en-US")} {out.totals.count === 1 ? "row" : "rows"}
        {out.totals.sums.map(s => ` · ${s.label} ${fmtCell(s.cents / 100, "money")}`).join("")}
        {out.capped ? ` · the first ${out.rows.length} are shown here; the file has them all` : ""}
      </div>
    </div>
  );
}

function RuleRow({ rule, fields, ops, onChange, onRemove }) {
  const f = fields.find(x => x.key === rule.field) || fields[0];
  const allowed = ops.filter(o => o.types.includes(f?.type));
  const needsValue = !["empty", "not_empty"].includes(rule.cmp);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select value={rule.field} onChange={e => onChange({ ...rule, field: e.target.value, cmp: "" , value: "" })} style={inp}>
        {fields.filter(x => !x.groupOnly).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
      <select value={rule.cmp} onChange={e => onChange({ ...rule, cmp: e.target.value })} style={inp}>
        <option value="">choose…</option>
        {allowed.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {needsValue && (f?.type === "bool"
        ? <select value={String(rule.value)} onChange={e => onChange({ ...rule, value: e.target.value === "true" })} style={inp}><option value="true">Yes</option><option value="false">No</option></select>
        : <input value={rule.cmp === "between" ? (Array.isArray(rule.value) ? rule.value.join(",") : rule.value || "") : (rule.value ?? "")}
            type={f?.type === "date" && rule.cmp !== "between" ? "date" : "text"}
            placeholder={rule.cmp === "between" ? "from,to" : rule.cmp === "in" ? "a,b,c" : ""}
            onChange={e => onChange({ ...rule, value: rule.cmp === "between" ? e.target.value.split(",").map(s => s.trim()) : e.target.value })} style={{ ...inp, width: 160 }} />)}
      <button onClick={onRemove} style={{ ...btn(false), padding: "5px 9px" }} aria-label="Remove this filter">×</button>
    </div>
  );
}

function GroupEditor({ group, fields, ops, onChange, depth = 1 }) {
  const set = (i, r) => onChange({ ...group, rules: group.rules.map((x, j) => j === i ? r : x) });
  const del = i => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  const first = fields.find(x => !x.groupOnly)?.key || "";
  return (
    <div style={{ borderLeft: depth > 1 ? "2px solid " + T.bg3 : "none", paddingLeft: depth > 1 ? 10 : 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: T.ink3 }}>
        Match <select value={group.op} onChange={e => onChange({ ...group, op: e.target.value })} style={{ ...inp, padding: "3px 6px" }}>
          <option value="and">all</option><option value="or">any</option></select> of these
      </div>
      {group.rules.map((r, i) => r.rules
        ? <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <GroupEditor group={r} fields={fields} ops={ops} depth={depth + 1} onChange={g => set(i, g)} />
            <button onClick={() => del(i)} style={{ ...btn(false), padding: "5px 9px" }} aria-label="Remove this group">×</button>
          </div>
        : <RuleRow key={i} rule={r} fields={fields} ops={ops} onChange={x => set(i, x)} onRemove={() => del(i)} />)}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onChange({ ...group, rules: [...group.rules, { field: first, cmp: "", value: "" }] })} style={btn(false)}>Add a filter</button>
        {depth < 3 && <button onClick={() => onChange({ ...group, rules: [...group.rules, { op: group.op === "and" ? "or" : "and", rules: [] }] })} style={btn(false)}>Add a group</button>}
      </div>
    </div>
  );
}

function Builder({ catalogue, initial, onSaved, onCancel }) {
  const [entity, setEntity] = useState(initial?.entity || "people");
  const E = catalogue.entities.find(e => e.key === entity) || catalogue.entities[0];
  const [columns, setColumns] = useState(initial?.columns || ["name"]);
  const [filter, setFilter] = useState(initial?.filter || { op: "and", rules: [] });
  const [groupBy, setGroupBy] = useState(initial?.groupBy || "");
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [out, setOut] = useState(null);
  const [msg, setMsg] = useState("");
  const pickEntity = k => { setEntity(k); const e = catalogue.entities.find(x => x.key === k); setColumns([e.fields.find(f => !f.groupOnly)?.key].filter(Boolean)); setFilter({ op: "and", rules: [] }); setGroupBy(""); setOut(null); };
  const def = () => ({ entity, columns: groupBy ? [] : columns, filter: filter.rules.length ? filter : undefined, groupBy: groupBy || undefined });
  const runIt = async () => { setMsg(""); try { setOut(await apiFetch("/report-builder/run", { method: "POST", body: JSON.stringify({ definition: def() }) })); } catch (e) { setOut(null); setMsg(errorMessage(e, "That report could not run.")); } };
  const save = async () => {
    setMsg("");
    try { const r = await apiFetch("/saved-reports", { method: "POST", body: JSON.stringify({ name, shared, schedule: weekly ? "weekly" : null, definition: def() }) }); onSaved(r.id); }
    catch (e) { setMsg(errorMessage(e, "That report could not be saved.")); }
  };
  const toggleCol = k => setColumns(c => c.includes(k) ? c.filter(x => x !== k) : [...c, k]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="rb-builder">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: T.ink }}>A report about</span>
        <select value={entity} onChange={e => pickEntity(e.target.value)} style={inp} data-testid="rb-entity">
          {catalogue.entities.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
      </div>
      {!groupBy && <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, marginBottom: 6 }}>Columns</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {E.fields.filter(f => !f.groupOnly).map(f => (
            <label key={f.key} style={{ fontSize: 13, color: T.ink, display: "flex", gap: 5, alignItems: "center" }}>
              <input type="checkbox" checked={columns.includes(f.key)} onChange={() => toggleCol(f.key)} style={{ accentColor: T.greenDk }} />{f.label}
            </label>))}
        </div>
      </div>}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, marginBottom: 6 }}>Filters</div>
        <GroupEditor group={filter} fields={E.fields} ops={catalogue.ops} onChange={setFilter} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: T.ink }}>Group and total by</span>
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={inp}>
          <option value="">no grouping</option>
          {E.fields.filter(f => ["text", "date"].includes(f.type)).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <button onClick={runIt} style={btn(false)} data-testid="rb-run">Run it</button>
      </div>
      {msg && <div role="alert" style={{ fontSize: 13, color: T.terracotta }}>{msg}</div>}
      <ResultTable out={out} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid " + T.bg3, paddingTop: 12 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name this report" style={{ ...inp, width: 240 }} data-testid="rb-name" />
        <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 5 }}><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} style={{ accentColor: T.greenDk }} />Share with everyone here</label>
        <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 5 }}><input type="checkbox" checked={weekly} onChange={e => setWeekly(e.target.checked)} style={{ accentColor: T.greenDk }} />Email it to me every Monday</label>
        <button onClick={save} disabled={!name.trim()} style={{ ...btn(true), opacity: name.trim() ? 1 : 0.5 }} data-testid="rb-save">Save report</button>
        <button onClick={onCancel} style={btn(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function SavedReportsView({ initialReportId = null }) {
  const [list, setList] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [sel, setSel] = useState(initialReportId || "std:lybunt");
  const [out, setOut] = useState(null);
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/saved-reports").then(setList).catch(e => setMsg(errorMessage(e, "Could not load your reports.")));
  useEffect(() => { load(); apiFetch("/report-builder/catalogue").then(setCatalogue).catch(() => {}); }, []);
  useEffect(() => {
    if (!sel || building) return;
    setOut(null); setMsg("");
    apiFetch(`/saved-reports/${encodeURIComponent(sel)}/run`).then(setOut).catch(e => setMsg(errorMessage(e, "That report could not run.")));
  }, [sel, building]);
  if (!list) return <div style={{ padding: 24, color: T.ink3, fontSize: 13 }}>{msg || "Loading…"}</div>;
  const all = [...list.standard, ...list.saved];
  const current = all.find(r => r.id === sel);
  const item = r => (
    <button key={r.id} onClick={() => { setBuilding(false); setSel(r.id); }} data-testid={`rb-item-${r.id}`}
      style={{ textAlign: "left", background: sel === r.id && !building ? T.bg2 : "transparent", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", color: T.ink, fontSize: 13 }}>
      {r.name}{r.schedule === "weekly" ? " · weekly" : ""}{r.shared ? "" : r.mine === false ? "" : r.id.startsWith("std:") ? "" : " · just you"}
    </button>);
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }} data-testid="rb-view">
      <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 2 }}>
        <button onClick={() => setBuilding(true)} style={{ ...btn(true), marginBottom: 10 }} data-testid="rb-new">Build a report</button>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", margin: "6px 10px" }}>Everyday questions</div>
        {list.standard.map(item)}
        {list.saved.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", margin: "12px 10px 6px" }}>Saved here</div>}
        {list.saved.map(item)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Card style={{ padding: "18px 22px" }}>
          {building && catalogue
            ? <Builder catalogue={catalogue} onCancel={() => setBuilding(false)} onSaved={id => { setBuilding(false); load().then(() => setSel(id)); }} />
            : <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{current?.name}</div>
                    {current?.question && <div style={{ fontSize: 13, color: T.ink3, marginTop: 2 }}>{current.question}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={btn(false)} onClick={() => download(`/saved-reports/${encodeURIComponent(sel)}/csv`, `${current?.name || "report"}.csv`).catch(e => setMsg(e.message))}>CSV</button>
                    <button style={btn(false)} onClick={() => download(`/saved-reports/${encodeURIComponent(sel)}/pdf`, `${current?.name || "report"}.pdf`).catch(e => setMsg(e.message))}>PDF</button>
                  </div>
                </div>
                {msg && <div role="alert" style={{ fontSize: 13, color: T.terracotta }}>{msg}</div>}
                {out ? <ResultTable out={out} /> : !msg && <div style={{ color: T.ink3, fontSize: 13 }}>Running…</div>}
              </>}
        </Card>
      </div>
    </div>
  );
}
