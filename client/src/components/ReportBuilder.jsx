// BUILD-98 (switch) Part 3 — REPORTS PEOPLE CAN BUILD.
//
// The standard reports, the org's saved ones, and a builder. The builder
// writes a DEFINITION — a list of field names from the server's catalogue —
// never SQL; the server compiles it (shared/reportBuilder.js).
//
// FIX-2 B — this file no longer keeps a list of reports of its own: Reports'
// one rail (client/src/lib/reportsRail.js) picks the report, and this file
// runs it (ReportRunView) or builds one (BuilderView). ReportTable is the one
// results table both files draw: human dates, whole dollars unless cents, a
// totals row summed from the rows in cents, sortable headers with the total
// kept at the foot, and every person row opening that person.
import { useState, useEffect, useMemo } from "react";
import { apiFetch, API } from "../api";
import { T, Card } from "./shared";
import { errorMessage } from "../lib/domainError";
import { cellText, centsOf, footCents, footCount, sortValue, nextSort, sortRows, splitHandlerRows } from "../lib/reportFormat";
import { DonorLink, useUrlWriter } from "./RecordLink";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };
const btn = (primary) => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9,
  padding: "8px 14px", fontSize: 13, fontWeight: 700, color: primary ? T.white : T.ink, cursor: "pointer" });
const SUMMED = new Set(["money", "count"]);

async function download(path, name) {
  const r = await fetch(API + path, { headers: { Authorization: "Bearer " + localStorage.getItem("npe_token") } });
  if (!r.ok) throw new Error("Could not make the file.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── THE ONE RESULTS TABLE ──────────────────────────────────────────────────
// cols: { key, label, type, align?, value?(r) raw, render?(r) node, sum?,
//         sortVal?(r), person? (this cell links the row's person) }
// personOf(r) → the person id a row opens, or null (a month, a fund).
// foot: draw the totals row (every `sum` column: money in cents, counts).
export function ReportTable({ cols, rows, personOf, onOpen, foot = true, footLabel = "Total", testid = "report-table" }) {
  // FIX-14 Part 5: on Reports the sort is in the URL (?sort=-total is
  // descending, ?sort=name ascending), so a sorted report reloads, and opens
  // in a new tab, sorted. Rows are all loaded, so the table sorts them here.
  const goUrl = useUrlWriter();
  const onReports = () => /^\/app\/reports\/?$/.test(window.location.pathname);
  const urlSort = () => {
    if (!onReports()) return null;
    const v = new URLSearchParams(window.location.search).get("sort");
    const key = v && v.replace(/^-/, "");
    return key && cols.some(c => c.key === key) ? { key, dir: v.startsWith("-") ? "desc" : "asc" } : null;
  };
  const [sort, setSortRaw] = useState(urlSort);
  const colKey = cols.map(c => c.key).join(",");
  useEffect(() => { setSortRaw(urlSort()); }, [colKey, rows]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setSort = n => {
    setSortRaw(n);
    if (!onReports()) return;
    const q = new URLSearchParams(window.location.search);
    if (n) q.set("sort", (n.dir === "desc" ? "-" : "") + n.key); else q.delete("sort");
    const qs = q.toString();
    goUrl(window.location.pathname + (qs ? "?" + qs : ""), true);
  };
  const valueOf = (r, key) => { const c = cols.find(x => x.key === key); return c.sortVal ? c.sortVal(r) : sortValue(c.value ? c.value(r) : r[key], c.type); };
  const sorted = useMemo(() => sortRows(rows, sort, valueOf), [rows, sort, colKey]);
  const raw = (c, r) => (c.value ? c.value(r) : r[c.key]);
  const summed = c => c.sum !== undefined ? c.sum : SUMMED.has(c.type);
  const showFoot = foot && rows.length > 0 && cols.some(summed);
  const open = r => { const id = personOf && personOf(r); if (id && onOpen) onOpen(id); };
  const align = c => c.align || (["money", "count", "number", "pct", "price"].includes(c.type) ? "right" : "left");
  const th = { padding: "8px 10px", borderBottom: `2px solid ${T.bg3}`, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3, whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", borderBottom: `1px solid ${T.bg2}`, whiteSpace: "nowrap", color: T.ink2 };
  // A figure or a date stays on one line; words (a name, an email, a note) may
  // wrap, so a six-column report fits its card at 1440 instead of hiding its
  // last column behind a scrollbar the Mac does not draw (the FIX-2 walk).
  const wraps = c => !["money", "count", "number", "pct", "price", "date"].includes(c.type);
  const cell = (c, r) => {
    const v = raw(c, r);
    const body = c.render ? c.render(r) : cellText(v, c.type === "price" ? "money" : c.type);
    const pid = c.person && personOf ? personOf(r) : null;
    return pid
      ? <DonorLink id={pid} onOpen={onOpen ? () => onOpen(pid) : undefined}
          style={{ color: T.ink, fontWeight: 700, textDecoration: "none" }}>{body}</DonorLink>
      : body;
  };
  return <div className="reports-table-wrap" style={{ overflowX: "auto" }}>
    <table data-testid={testid} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          {cols.map(c => {
            const on = sort?.key === c.key;
            return <th key={c.key} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} style={{ ...th, textAlign: align(c) }}>
              <button type="button" data-sort-key={c.key} onClick={() => setSort(nextSort(sort, c.key))}
                style={{ all: "unset", cursor: "pointer", font: "inherit", letterSpacing: "inherit", textTransform: "inherit", color: on ? T.ink : T.ink3 }}>
                {c.label}{on ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
              </button>
            </th>;
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => {
          const pid = personOf ? personOf(r) : null;
          return <tr key={r.id || r._pid || i} data-testid="report-row" data-person-id={pid || undefined}
            onClick={pid ? () => open(r) : undefined} className={pid ? "rpt-row-click" : undefined}
            style={{ cursor: pid ? "pointer" : "default" }}>
            {cols.map(c => <td key={c.key} data-cents={c.type === "money" && summed(c) ? centsOf(raw(c, r)) : undefined}
              style={{ ...td, textAlign: align(c), ...(wraps(c) ? { whiteSpace: "normal", overflowWrap: "anywhere", minWidth: 96 } : null) }}>{cell(c, r)}</td>)}
          </tr>;
        })}
      </tbody>
      {showFoot && <tfoot>
        <tr data-testid="report-total-row">
          {cols.map((c, i) => {
            const style = { padding: "10px 10px", borderTop: `2px solid ${T.bg3}`, fontWeight: 800, color: T.ink, whiteSpace: "nowrap", textAlign: align(c) };
            if (summed(c) && c.type === "money") {
              const cents = footCents(rows, r => raw(c, r));
              return <td key={c.key} data-cents={cents} style={style}>{cellText(cents / 100, "money")}</td>;
            }
            if (summed(c)) return <td key={c.key} style={style}>{cellText(footCount(rows, r => raw(c, r)), "count")}</td>;
            return <td key={c.key} style={style}>{i === 0 ? footLabel : ""}</td>;
          })}
        </tr>
      </tfoot>}
    </table>
  </div>;
}

// A saved or standard report's output → ReportTable columns. A handler
// report's cells are text with a `display` hint; a builder report's are typed.
function outColumns(out) {
  return out.columns.map((c, i) => {
    const type = out.grouped && c.key === "count" ? "count" : (c.display || c.type);
    return { key: c.key, label: c.label, type, person: i === 0 };
  });
}

function ResultTable({ out, onOpen }) {
  if (!out) return null;
  const { rows } = splitHandlerRows(out.rows, out.columns[0]?.key);
  return (
    <div data-testid="rb-result">
      <ReportTable cols={outColumns(out)} rows={rows} personOf={r => r._pid || null} onOpen={onOpen} />
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>
        {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "row" : "rows"}
        {out.capped ? ` · the first ${out.rows.length} are shown here; the file has all ${out.totals.count.toLocaleString("en-US")}` : ""}
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

function Builder({ catalogue, initial, onSaved, onCancel, onOpen }) {
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
      <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>Build a report</div>
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
      <ResultTable out={out} onOpen={onOpen} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid " + T.bg3, paddingTop: 12 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name this report" style={{ ...inp, width: 240, maxWidth: "100%" }} data-testid="rb-name" />
        <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 5 }}><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} style={{ accentColor: T.greenDk }} />Share with everyone here</label>
        <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 5 }}><input type="checkbox" checked={weekly} onChange={e => setWeekly(e.target.checked)} style={{ accentColor: T.greenDk }} />Email it to me every Monday</label>
        <button onClick={save} disabled={!name.trim()} style={{ ...btn(true), opacity: name.trim() ? 1 : 0.5 }} data-testid="rb-save">Save report</button>
        <button onClick={onCancel} style={btn(false)}>Cancel</button>
      </div>
    </div>
  );
}

// The builder, in its own card. `onSaved(id)` lands on the saved report.
export function BuilderView({ onSaved, onCancel, onOpen }) {
  const [catalogue, setCatalogue] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { apiFetch("/report-builder/catalogue").then(setCatalogue).catch(e => setMsg(errorMessage(e, "The builder could not load."))); }, []);
  return (
    <div data-testid="rb-view">
      <Card style={{ padding: "18px 22px" }}>
        {catalogue
          ? <Builder catalogue={catalogue} onCancel={onCancel} onSaved={onSaved} onOpen={onOpen} />
          : <div style={{ color: T.ink3, fontSize: 13 }}>{msg || "Loading…"}</div>}
      </Card>
    </div>
  );
}

// One standard or saved report, run: its name, its question, CSV and PDF, and
// the results. `meta` is its entry from /saved-reports, when it is known.
export function ReportRunView({ id, meta, onOpen }) {
  const [out, setOut] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let dead = false;
    setOut(null); setMsg("");
    apiFetch(`/saved-reports/${encodeURIComponent(id)}/run`)
      .then(o => { if (!dead) setOut(o); })
      .catch(e => { if (!dead) setMsg(errorMessage(e, "That report could not run.")); });
    return () => { dead = true; };
  }, [id]);
  const name = meta?.name || out?.report?.name || "";
  const question = meta?.question || out?.report?.question || "";
  return (
    <div data-testid="rb-view">
      <Card style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{name}</div>
            {question && <div style={{ fontSize: 13, color: T.ink3, marginTop: 2 }}>{question}</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn(false)} onClick={() => download(`/saved-reports/${encodeURIComponent(id)}/csv`, `${name || "report"}.csv`).catch(e => setMsg(e.message))}>CSV</button>
            <button style={btn(false)} onClick={() => download(`/saved-reports/${encodeURIComponent(id)}/pdf`, `${name || "report"}.pdf`).catch(e => setMsg(e.message))}>PDF</button>
          </div>
        </div>
        {msg && <div role="alert" style={{ fontSize: 13, color: T.terracotta }}>{msg}</div>}
        {out ? (out.rows.length ? <ResultTable out={out} onOpen={onOpen} /> : <div style={{ color: T.ink3, fontSize: 13 }}>Nothing matches this report yet.</div>)
          : !msg && <div style={{ color: T.ink3, fontSize: 13 }}>Running…</div>}
      </Card>
    </div>
  );
}
