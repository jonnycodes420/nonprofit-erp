// DonorFilters.jsx · LIST-1. FILTER THE LIST BY ANYTHING STEWARD KNOWS.
//
// A filter is a list of conditions, each a field, a way of matching and a
// value, joined by AND or OR. The server runs them (GET /donors?where=), so
// the count, every page, the export and a group saved from them are the same
// people. Each condition shows as a chip she can take off.
import { useState, useMemo } from "react";
import { T, fmtFull } from "./shared";
import { displayDate } from "../../../shared/displayDate.js";

// ── Shared consts ───────────────────────────────────────────────────────────
export const EMPTY_WHERE = { join: "and", conditions: [] };
const ctl = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
const btn = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", color: T.ink, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const primary = { ...btn, background: T.greenDk, border: "none", color: T.white, fontWeight: 700 };
const groupHead = { fontSize: 10.5, fontWeight: 800, color: T.ink3, margin: "10px 0 3px" };

// The where param for a request, or "" when there is nothing to filter by.
export function whereParam(where) {
  if (!where || !Array.isArray(where.conditions) || !where.conditions.length) return "";
  return JSON.stringify({ join: where.join === "or" ? "or" : "and", conditions: where.conditions });
}

function emptyValue(input) {
  if (input === "daterange" || input === "moneyrange") return { from: "", to: "" };
  if (input === "zipmiles") return { zip: "", miles: "10" };
  return "";
}
function valueReady(input, v) {
  if (input === "none") return true;
  if (input === "daterange" || input === "moneyrange") return !!(v && (String(v.from).trim() || String(v.to).trim()));
  if (input === "zipmiles") return !!(v && String(v.zip).trim() && Number(v.miles) > 0);
  return String(v ?? "").trim() !== "";
}

// The chip's words: "Zip is 40502", "Last gift between Jan 1, 2026 and today".
export function chipText(cond, byKey) {
  const f = byKey[cond.field];
  const label = f ? f.label : cond.field;
  const op = f && f.filter ? (f.filter.ops || []).find(o => o.op === cond.op) : null;
  const opLabel = op ? op.label : cond.op;
  const input = op ? op.input : "text";
  const v = cond.value;
  let val = "";
  if (input === "none") val = "";
  else if (input === "daterange") val = `${v && v.from ? displayDate(v.from) : "any time"} to ${v && v.to ? displayDate(v.to) : "today"}`;
  else if (input === "moneyrange") val = `${v && v.from !== "" && v.from != null ? fmtFull(Number(v.from)) : "$0"} and ${v && v.to !== "" && v.to != null ? fmtFull(Number(v.to)) : "any amount"}`;
  else if (input === "zipmiles") val = `${v && v.miles} miles of ${v && v.zip}`;
  else if (input === "select") { const o = ((f && f.filter && f.filter.options) || []).find(x => String(x.value) === String(v)); val = o ? o.label : String(v); }
  else if (input === "money") val = Number.isFinite(Number(v)) ? fmtFull(Number(v)) : String(v);
  else if (input === "date") val = displayDate(v) || String(v);
  else val = String(v);
  return [label, opLabel, val].filter(Boolean).join(" ");
}

function ValueInput({ input, value, onChange, options }) {
  if (input === "none") return null;
  if (input === "daterange") return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="date" aria-label="From" value={value.from || ""} onChange={e => onChange({ ...value, from: e.target.value })} style={ctl} />
      <span style={{ fontSize: 12, color: T.ink3 }}>to</span>
      <input type="date" aria-label="To" value={value.to || ""} onChange={e => onChange({ ...value, to: e.target.value })} style={ctl} />
    </span>
  );
  if (input === "moneyrange") return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="number" min="0" aria-label="From dollars" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} placeholder="$ least" style={{ ...ctl, width: 100 }} />
      <span style={{ fontSize: 12, color: T.ink3 }}>and</span>
      <input type="number" min="0" aria-label="To dollars" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })} placeholder="$ most" style={{ ...ctl, width: 100 }} />
    </span>
  );
  if (input === "zipmiles") return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="number" min="1" aria-label="Miles" value={value.miles} onChange={e => onChange({ ...value, miles: e.target.value })} style={{ ...ctl, width: 70 }} />
      <span style={{ fontSize: 12, color: T.ink3 }}>miles of zip</span>
      <input aria-label="Zip" value={value.zip} onChange={e => onChange({ ...value, zip: e.target.value })} placeholder="40502" style={{ ...ctl, width: 90 }} />
    </span>
  );
  if (input === "select") return (
    <select aria-label="Value" data-testid="filter-value" value={value} onChange={e => onChange(e.target.value)} style={{ ...ctl, minWidth: 160 }}>
      <option value="">Choose one</option>
      {(options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const type = input === "number" || input === "money" ? "number" : input === "date" ? "date" : "text";
  return (
    <input data-testid="filter-value" aria-label="Value" type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={input === "list" ? "Separate with commas" : input === "money" ? "Dollars" : ""}
      style={{ ...ctl, minWidth: input === "list" ? 200 : 120 }} />
  );
}

// ── THE BUILDER ─────────────────────────────────────────────────────────────
export function FilterBuilder({ setup, where, setWhere, error, total }) {
  const byKey = useMemo(() => Object.fromEntries((setup.fields || []).map(f => [f.key, f])), [setup]);
  const filterable = useMemo(() => (setup.fields || []).filter(f => f.filter && Array.isArray(f.filter.ops) && f.filter.ops.length), [setup]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [field, setField] = useState(null);
  const [op, setOp] = useState("");
  const [value, setValue] = useState("");
  const conds = (where && where.conditions) || [];
  const join = where && where.join === "or" ? "or" : "and";
  const ops = field ? field.filter.ops.filter(o => o.input !== "zipmiles" || setup.hasGeocoding) : [];
  const opDef = ops.find(o => o.op === op) || null;
  const needle = q.trim().toLowerCase();
  const shown = needle ? filterable.filter(f => f.label.toLowerCase().includes(needle) || (f.group || "").toLowerCase().includes(needle)) : filterable;
  const groups = [...(setup.groups || []), ...[...new Set(filterable.map(f => f.group))].filter(g => !(setup.groups || []).includes(g))];

  const reset = () => { setOpen(false); setQ(""); setField(null); setOp(""); setValue(""); };
  const pickField = f => {
    const first = f.filter.ops.filter(o => o.input !== "zipmiles" || setup.hasGeocoding)[0];
    setField(f); setOp(first ? first.op : ""); setValue(emptyValue(first ? first.input : "text"));
  };
  const pickOp = o => { setOp(o); const d = ops.find(x => x.op === o); setValue(emptyValue(d ? d.input : "text")); };
  const add = () => {
    if (!field || !opDef || !valueReady(opDef.input, value)) return;
    const cond = { field: field.key, op: opDef.op };
    if (opDef.input !== "none") cond.value = typeof value === "string" ? value.trim() : value;
    setWhere({ join, conditions: [...conds, cond] });
    reset();
  };
  const remove = i => setWhere({ join, conditions: conds.filter((_, j) => j !== i) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
        {conds.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: T.ink3 }}>{join}</span>}
            <span data-testid="filter-chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 99, padding: "4px 6px 4px 12px", fontSize: 12, fontWeight: 600, color: T.ink }}>
              {chipText(c, byKey)}
              <button type="button" aria-label={`Remove the filter ${chipText(c, byKey)}`} data-testid="filter-chip-remove" onClick={() => remove(i)}
                style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 4px" }}>×</button>
            </span>
          </span>
        ))}
        {conds.length > 1 && (
          <button type="button" data-testid="filter-join" onClick={() => setWhere({ join: join === "and" ? "or" : "and", conditions: conds })} style={btn}
            title="All of these, or any one of them">
            {join === "and" ? "Matching all" : "Matching any"}
          </button>
        )}
        <button type="button" data-testid="dir-add-filter" onClick={() => (open ? reset() : setOpen(true))} style={btn} aria-expanded={open}>
          + Add filter
        </button>
        {conds.length > 0 && <>
          <span data-testid="filter-count" style={{ fontSize: 12, color: T.ink3 }}>{Number(total || 0).toLocaleString("en-US")} {total === 1 ? "person matches" : "people match"}</span>
          <button type="button" onClick={() => setWhere({ join: "and", conditions: [] })}
            style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Clear filters</button>
        </>}
        {open && (
          <div data-testid="filter-panel" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 600, background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, boxShadow: "0 10px 30px rgba(15,26,18,0.16)", padding: 14, width: "min(440px, calc(100vw - 32px))" }}>
            {!field ? <>
              <input autoFocus data-testid="filter-field-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by" aria-label="Filter by" style={{ ...ctl, width: "100%" }} />
              <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 4 }}>
                {groups.map(g => {
                  const list = shown.filter(f => f.group === g);
                  if (!list.length) return null;
                  return (
                    <div key={g}>
                      <div style={groupHead}>{g}</div>
                      {list.map(f => (
                        <button key={f.key} type="button" data-testid={`filter-field-${f.key}`} onClick={() => pickField(f)} title={f.sentence || ""}
                          style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "6px 4px", fontSize: 13, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
                {!shown.length && <div style={{ fontSize: 13, color: T.ink3, padding: "10px 4px" }}>No field matches that.</div>}
              </div>
            </> : <>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>{field.label}</div>
              {field.sentence && <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8, lineHeight: 1.5 }}>{field.sentence}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select data-testid="filter-op" aria-label="How it matches" value={op} onChange={e => pickOp(e.target.value)} style={ctl}>
                  {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {opDef && <ValueInput input={opDef.input} value={value} onChange={setValue} options={field.filter.options} />}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" onClick={() => { setField(null); setOp(""); setValue(""); }} style={btn}>Back</button>
                <div style={{ flex: 1 }} />
                <button type="button" data-testid="filter-apply" onClick={add} disabled={!opDef || !valueReady(opDef.input, value)}
                  style={{ ...primary, opacity: !opDef || !valueReady(opDef.input, value) ? 0.55 : 1 }}>Add filter</button>
              </div>
            </>}
          </div>
        )}
      </div>
      {error && <div role="alert" data-testid="filter-error" style={{ fontSize: 12.5, color: T.ink, background: T.gold100, border: "1px solid " + T.gold500, borderRadius: 8, padding: "7px 10px" }}>{error}</div>}
    </div>
  );
}

// ── SAVED VIEWS ─────────────────────────────────────────────────────────────
// A view is a name for a set of columns and filters ("Major donors, Lexington").
export function ViewsMenu({ views, activeId, onPick, onSave, onDelete }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const active = (views || []).find(v => v.id === activeId) || null;
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    setMsg("");
    try { await onSave(n); setNaming(false); setName(""); }
    catch (e) { setMsg((e && e.sentence) || (e && e.message) || "That view did not save."); }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select data-testid="dir-views" aria-label="Saved views" value={activeId || ""} style={{ ...ctl, cursor: "pointer" }}
        onChange={e => {
          const v = e.target.value;
          if (v === "__save") { setNaming(true); return; }
          const view = (views || []).find(x => x.id === v);
          onPick(view || null);
        }}>
        <option value="">{(views || []).length ? "Saved views" : "No saved views yet"}</option>
        {(views || []).map(v => <option key={v.id} value={v.id}>{v.name}{v.mine ? "" : " (shared)"}</option>)}
        <option value="__save">Save this view…</option>
      </select>
      {naming && <>
        <input autoFocus data-testid="dir-view-name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setNaming(false); }}
          placeholder="Major donors, Lexington" aria-label="Name this view" style={{ ...ctl, width: 190 }} />
        <button type="button" data-testid="dir-view-save" onClick={save} disabled={!name.trim()} style={{ ...primary, opacity: name.trim() ? 1 : 0.55 }}>Save view</button>
        <button type="button" onClick={() => { setNaming(false); setName(""); }} style={btn}>Cancel</button>
      </>}
      {active && active.mine && !naming && <button type="button" data-testid="dir-view-delete" onClick={() => onDelete(active)}
        style={{ background: "none", border: "none", padding: 0, color: T.ink3, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Delete this view</button>}
      {msg && <span role="alert" style={{ fontSize: 12, color: T.ink }}>{msg}</span>}
    </span>
  );
}
