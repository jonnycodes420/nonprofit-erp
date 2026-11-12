// SALES-1 · the Sales tab's shared bits: the four colours, the words for money
// and days, the inline field editor every record page and list uses, and the
// CSV download (the export is a file, not JSON).
import { useState } from "react";
import { API, getToken } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";

export const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
export const TERRA = "#b8593f";   // the one red, for a destructive confirm only (design-system.md)
export const card = { background: WHITE, borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: `1px solid ${INK}14` };
export const h2 = { fontSize: 16, fontWeight: 700, margin: "0 0 4px" };
export const says = { fontSize: 12.5, opacity: 0.72, margin: "0 0 10px", lineHeight: 1.45 };
export const btn = { fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: 0, background: EMERALD, color: WHITE, cursor: "pointer", fontFamily: "inherit", minHeight: 34 };
export const quiet = { fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${INK}33`, background: WHITE, color: INK, cursor: "pointer", fontFamily: "inherit", minHeight: 32 };
export const box = { fontSize: 13, padding: "6px 8px", border: `1px solid ${INK}33`, borderRadius: 6, fontFamily: "inherit", background: WHITE, color: INK, boxSizing: "border-box" };
export const link = { color: EMERALD, background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", fontWeight: 600, textAlign: "left" };
export const brassTag = { background: `${BRASS}55`, padding: "1px 6px", borderRadius: 6, fontWeight: 700, fontSize: 12 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const usd = c => `$${(Number(c || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const dayWords = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : "–"; };
export const whenWords = t => { if (!t) return "–"; const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
export const TYPE_WORDS = { org: "Organization", contact: "Contact", deal: "Deal" };

// The export is a CSV file: read with this session, saved by the browser.
export async function downloadCsv(path, name) {
  const t = getToken();
  const res = await fetch(`${API}${path}`, { credentials: "include", headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error("The export could not be read.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// A field's value as words, for a list cell or a read-only line.
export function showValue(field, v, meta) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "–";
  switch (field.type) {
    case "owner": return (meta.owners.find(o => o.id === v) || {}).name || "–";
    case "stage": { for (const p of meta.pipelines) { const s = p.stages.find(x => x.id === v); if (s) return s.name; } return "–"; }
    case "pipeline": return (meta.pipelines.find(p => p.id === v) || {}).name || "–";
    case "currency": return field.key === "value_cents" ? usd(v) : `$${Number(v).toLocaleString("en-US")}`;
    case "date": return String(v).length > 10 ? whenWords(v) : dayWords(v);
    case "checkbox": return v ? "Yes" : "No";
    case "list": case "multiselect": return [].concat(v).join(", ");
    case "url": return <a href={/^https?:/.test(v) ? v : `https://${v}`} target="_blank" rel="noopener noreferrer" style={{ color: EMERALD }}>{v}</a>;
    default: return String(v);
  }
}

// One field, edited where it shows: click, change, Save. `onSave(value)` returns a promise.
export function InlineField({ field, value, meta, onSave, testid }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (field.readOnly) return <div data-sales-field={testid}>{showValue(field, value, meta)}</div>;
  const start = () => {
    setErr(null); setEditing(true);
    setDraft(field.type === "list" || field.type === "multiselect" ? [].concat(value || []).join(", ")
      : field.key === "value_cents" ? (value ? String(Number(value) / 100) : "") : field.type === "checkbox" ? !!value : value == null ? "" : String(value).slice(0, field.type === "date" ? 10 : undefined));
  };
  const save = async () => {
    setBusy(true); setErr(null);
    const v = field.key === "value_cents" ? Math.round(Number(String(draft).replace(/[$,\s]/g, "") || 0) * 100) : draft;
    try { await onSave(v); setEditing(false); } catch (e) { setErr((e && e.message) || "That did not save."); }
    setBusy(false);
  };
  if (!editing) return <button type="button" onClick={start} data-sales-field={testid} title="Click to edit"
    style={{ ...link, color: INK, fontWeight: 400, width: "100%", minHeight: 22 }}>{showValue(field, value, meta)}</button>;
  const opts = field.type === "owner" ? meta.owners.map(o => [o.id, o.name]) : (field.options || []).map(o => [o, o]);
  const input = field.type === "picklist" || field.type === "owner"
    ? <select value={draft || ""} onChange={e => setDraft(e.target.value)} style={{ ...box, width: "100%" }} aria-label={field.label}>
        <option value="">–</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    : field.type === "checkbox" ? <input type="checkbox" checked={!!draft} onChange={e => setDraft(e.target.checked)} aria-label={field.label} />
    : field.type === "date" ? <DateInput value={draft || ""} onChange={e => setDraft(e.target.value)} style={{ ...box, width: "100%" }} aria-label={field.label} />
    : field.type === "long_text" ? <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} style={{ ...box, width: "100%" }} aria-label={field.label} />
    : <input value={draft} onChange={e => setDraft(e.target.value)} style={{ ...box, width: "100%" }} aria-label={field.label}
        placeholder={field.type === "list" || field.type === "multiselect" ? "comma between each" : ""} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} />;
  return <div>
    {input}
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <button type="button" style={{ ...btn, padding: "4px 10px", minHeight: 28 }} onClick={save} disabled={busy} data-sales-save={testid}>{busy ? "Saving…" : "Save"}</button>
      <button type="button" style={{ ...quiet, padding: "3px 10px", minHeight: 28 }} onClick={() => setEditing(false)}>Cancel</button>
    </div>
    {err ? <div style={{ fontSize: 12, marginTop: 4 }}><span style={brassTag}>Not saved</span> {err}</div> : null}
  </div>;
}

// Every field of an object, core then custom, as one list the pages and lists read.
export function fieldsOf(meta, type) {
  const core = meta.objects[type].fields;
  const custom = meta.properties.filter(p => p.object === type).map(p => ({ key: `props.${p.key}`, label: p.label, type: p.type, options: p.options || [], custom: true }));
  return [...core, ...custom];
}
export const valueAt = (row, key) => (key.startsWith("props.") ? (row.props || {})[key.slice(6)] : key === "name" ? row.displayName : row[key]);

// SALES-FIX-1 item 1: a read or a write the door refused says why. A stale page (its sign-in
// changed across a ship or a restart) is told to reload, with the button, instead of "could
// not be read". Anything else keeps the screen's own sentence.
const RELOAD_CODES = new Set(["csrf_header_missing", "csrf_token_invalid"]);   // a moved org has its own banner (lib/orgBinding.js)
export const needsReload = e => !!e && RELOAD_CODES.has(e.error);
export function Failure({ e, fallback, testid = "sales-failure" }) {
  const reload = needsReload(e);
  return <p style={{ ...says, opacity: 1 }} data-testid={testid} data-reload={reload ? "1" : "0"}>
    {reload ? (e.message || "This page's sign-in has changed. Reload the page and try again.") : fallback}
    {reload ? <> <button type="button" style={{ ...quiet, marginLeft: 6 }} onClick={() => window.location.reload()} data-sales-reload="1">Reload</button></> : null}
  </p>;
}
// For a message line: the refusal's own words when the page must reload, else the error's.
export const failureWords = (e, fallback) => (needsReload(e) ? (e.message || "Reload the page and try again.") : (e && e.message) || fallback);
