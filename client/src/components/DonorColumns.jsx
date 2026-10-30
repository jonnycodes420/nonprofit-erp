// DonorColumns.jsx · LIST-1. THE DONOR LIST'S COLUMNS ARE HERS.
//
// The fields come from the server (GET /donors/list-setup), grouped the way
// she thinks about a person: Contact, Giving, Pledges, Events, Volunteering,
// Communication, and whatever her own imports brought in. The layout she
// picks (which columns, their order, their widths, rows per page) is saved
// for her alone; an org admin can set the org's starting layout, and Reset
// always takes her back to it.
import { useState, useMemo } from "react";
import { T, Modal, fmtFull } from "./shared";
import { displayDate } from "../../../shared/displayDate.js";

// ── Shared consts (TDZ rule: declared above every reader) ──────────────────
export const PAGE_SIZES = [25, 50, 100];
export const NAME_KEY = "name";
// The list before the setup answers, or if it never does: the columns the
// list always had, so the page still draws.
export const FALLBACK_SETUP = {
  groups: ["Contact", "Giving", "Pledges", "Events", "Volunteering", "Communication", "From your imports"],
  fields: [
    { key: "name", label: "Donor", group: "Contact", column: true, sortable: true, format: "name", filter: null },
    { key: "stage", label: "Stage", group: "Giving", column: true, sortable: false, format: "stage", filter: null },
    { key: "owner", label: "Owner", group: "Contact", column: true, sortable: false, format: "owner", filter: null },
    { key: "lifetime", label: "Lifetime", group: "Giving", column: true, sortable: true, format: "money", filter: null },
    { key: "last_gift_date", label: "Last gift", group: "Giving", column: true, sortable: true, format: "date", filter: null },
    { key: "engagement", label: "Engagement", group: "Giving", column: true, sortable: true, format: "number", filter: null },
    { key: "generosity", label: "Giving strength", group: "Giving", column: true, sortable: true, format: "number", filter: null },
  ],
  defaultColumns: ["name", "stage", "owner", "lifetime", "last_gift_date", "engagement", "generosity"],
  layout: { columns: ["name", "stage", "owner", "lifetime", "last_gift_date", "engagement", "generosity"], widths: {}, pageSize: 50, source: "default" },
  views: [],
  canSetOrgDefault: false,
  hasGeocoding: false,
};
// The widths the list had before LIST-1, so the default layout looks the same.
const DEFAULT_TRACKS = {
  name: "minmax(180px,2fr)", stage: "minmax(110px,1fr)", owner: "minmax(120px,1fr)",
  lifetime: "120px", last_gift_date: "110px", engagement: "88px", generosity: "70px",
  room_to_give: "104px", room: "104px",
};
const RIGHT_FORMATS = new Set(["money", "number", "date"]);
export const MIN_WIDTH = 60;

// One grid track per column: her width when she has set one.
export function columnTrack(key, widths) {
  const w = widths && Number(widths[key]);
  if (w && w >= MIN_WIDTH) return `${Math.round(w)}px`;
  return DEFAULT_TRACKS[key] || "130px";
}
// The grid's minimum width, so many columns scroll sideways instead of crushing the names.
export function gridMinWidth(columns, widths) {
  return columns.reduce((s, k) => {
    const w = widths && Number(widths[k]);
    if (w) return s + w;
    const t = DEFAULT_TRACKS[k] || "130px";
    const m = /(\d+)px/.exec(t);
    return s + (m ? Number(m[1]) : 130);
  }, 0);
}
export const alignFor = field => (field && RIGHT_FORMATS.has(field.format) ? "right" : "left");

// A cell's words, by the field's format.
export function formatCell(field, v) {
  if (v === null || v === undefined || v === "") return "";
  const f = field ? field.format : "text";
  if (f === "money") { const n = Number(v); return Number.isFinite(n) ? fmtFull(n) : String(v); }
  if (f === "date") return displayDate(v) || String(v);
  if (f === "number") { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString("en-US") : String(v); }
  if (f === "list") return Array.isArray(v) ? v.join(", ") : String(v);
  if (f === "bool") return v === true || v === "true" || v === 1 ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// The columns kept in a usable shape: name first, no duplicates, only known fields.
export function cleanColumns(columns, fields) {
  const known = new Set((fields || []).map(f => f.key));
  const out = [NAME_KEY];
  for (const k of columns || []) if (k !== NAME_KEY && known.has(k) && !out.includes(k)) out.push(k);
  return out;
}

export function moveKey(list, from, to) {
  if (from === to || from === NAME_KEY || to === NAME_KEY) return list;
  const out = list.filter(k => k !== from);
  const at = out.indexOf(to);
  if (at < 0) return list;
  const fromIdx = list.indexOf(from), toIdx = list.indexOf(to);
  out.splice(fromIdx < toIdx ? at + 1 : at, 0, from);
  return out;
}

const btn = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", color: T.ink, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const primary = { ...btn, background: T.greenDk, border: "none", color: T.white, fontWeight: 700 };
const groupHead = { fontSize: 10.5, fontWeight: 800, color: T.ink3, margin: "12px 0 4px" };

// ── THE EDITOR ──────────────────────────────────────────────────────────────
// Every field on the left, searchable and grouped; the chosen columns on the
// right, in order, dragged to reorder and X to remove.
export function ColumnEditor({ setup, layout, onSave, onReset, onSaveOrg, onClose }) {
  const fields = useMemo(() => (setup.fields || []).filter(f => f.column), [setup]);
  const byKey = useMemo(() => Object.fromEntries((setup.fields || []).map(f => [f.key, f])), [setup]);
  const [chosen, setChosen] = useState(() => cleanColumns(layout.columns, setup.fields));
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? fields.filter(f => f.label.toLowerCase().includes(needle) || (f.group || "").toLowerCase().includes(needle)) : fields;
  const groups = [...(setup.groups || []), ...[...new Set(fields.map(f => f.group))].filter(g => !(setup.groups || []).includes(g))];
  const toggle = key => {
    if (key === NAME_KEY) return;
    setChosen(c => (c.includes(key) ? c.filter(k => k !== key) : [...c, key]));
  };
  const act = async (fn, after) => {
    setBusy(true); setMsg("");
    try { const r = await fn(); if (after) after(r); }
    catch (e) { setMsg((e && e.sentence) || (e && e.message) || "That did not save."); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} width={760} title="Edit columns" subtitle="Pick the columns you want on your list. Only you see this layout." ariaLabel="Edit columns">
      <div data-testid="col-editor" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 18 }}>
        <div style={{ minWidth: 0 }}>
          <input data-testid="col-editor-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search fields"
            aria-label="Search fields"
            style={{ width: "100%", boxSizing: "border-box", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, outline: "none" }} />
          <div style={{ maxHeight: 380, overflowY: "auto", marginTop: 6, paddingRight: 4 }}>
            {groups.map(g => {
              const list = shown.filter(f => f.group === g);
              if (!list.length) return null;
              return (
                <div key={g}>
                  <div style={groupHead}>{g}</div>
                  {list.map(f => (
                    <label key={f.key} data-testid={`col-editor-field-${f.key}`} title={f.sentence || ""}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 13, color: T.ink, cursor: f.key === NAME_KEY ? "default" : "pointer" }}>
                      <input type="checkbox" checked={chosen.includes(f.key)} disabled={f.key === NAME_KEY} onChange={() => toggle(f.key)}
                        style={{ width: 15, height: 15, accentColor: T.greenDk }} />
                      {f.label}
                    </label>
                  ))}
                </div>
              );
            })}
            {!shown.length && <div style={{ fontSize: 13, color: T.ink3, padding: "12px 2px" }}>No field matches that.</div>}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...groupHead, marginTop: 0 }}>Your columns, in order</div>
          <div data-testid="col-editor-chosen" style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 400, overflowY: "auto" }}>
            {chosen.map(k => {
              const f = byKey[k];
              const fixed = k === NAME_KEY;
              return (
                <div key={k} data-testid={`col-editor-chosen-${k}`} draggable={!fixed}
                  onDragStart={e => { setDrag(k); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", k); } catch { /* old browsers */ } }}
                  onDragOver={e => { if (drag && !fixed) e.preventDefault(); }}
                  onDrop={e => { e.preventDefault(); if (drag) setChosen(c => moveKey(c, drag, k)); setDrag(null); }}
                  onDragEnd={() => setDrag(null)}
                  style={{ display: "flex", alignItems: "center", gap: 8, background: drag === k ? T.bg2 : T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, cursor: fixed ? "default" : "grab" }}>
                  <span aria-hidden="true" style={{ color: T.ink3, fontSize: 12, letterSpacing: "-2px" }}>{fixed ? "" : "⋮⋮"}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f ? f.label : k}</span>
                  {fixed
                    ? <span style={{ fontSize: 11, color: T.ink3 }}>always first</span>
                    : <button type="button" aria-label={`Remove ${f ? f.label : k}`} data-testid={`col-editor-remove-${k}`} onClick={() => toggle(k)}
                        style={{ background: "none", border: "none", color: T.ink3, fontSize: 15, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {msg && <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: T.ink }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
        <button type="button" data-testid="col-editor-reset" disabled={busy} style={btn}
          onClick={() => act(onReset, r => { if (r && r.columns) setChosen(cleanColumns(r.columns, setup.fields)); })}>
          Reset to default
        </button>
        {setup.canSetOrgDefault && <button type="button" data-testid="col-editor-org" disabled={busy} style={btn}
          onClick={() => act(() => onSaveOrg(chosen), () => setMsg("This is now the starting layout for everyone in your organization."))}>
          Make this the org's default view
        </button>}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} style={btn}>Cancel</button>
        <button type="button" data-testid="col-editor-save" disabled={busy} style={primary}
          onClick={() => act(() => onSave(chosen), onClose)}>
          Save columns
        </button>
      </div>
    </Modal>
  );
}
