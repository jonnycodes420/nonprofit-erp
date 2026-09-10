// ── THE COLUMN TARGET DROPDOWN — one component, every entry shape ──────────
// FIX (2026-09-09). Every importer asks the same question of every column —
// "what does this become?" — and until now three screens answered it three
// ways. The workbook mapper (BUILD-82) offered standard fields, the org's
// existing custom fields, and "＋ New custom field" created inline. The CSV
// donor mapper offered a FLAT list of 17 standard targets and nothing else, so
// a 30-column prospect-research export had no destination for 26 of its
// columns and no way to make one without leaving the import. The BUILD-78
// transaction mapper offered a third arrangement again.
//
// This is the one that ships. Everything that maps a column renders THIS.
//
// Props:
//   header          the column's own name (shown in the refusal/evidence line)
//   standardFields  [{key,label,flag?}] — the shape's own standard vocabulary
//   cfDefs          {donor:[],gift:[]} — the org's existing custom fields
//   entity          "donor" | "gift" — which custom-field family, and the
//                   default entity for a new one
//   value           "std:<key>" | "cf:<id>" | "ignore" | "flag"
//   takenStd        Set of standard keys already claimed by another column —
//                   rendered disabled, because two columns cannot become one
//                   field (FIX item 2)
//   locked          a reason string when the column is routed by law (an
//                   exclusion column goes to the flag family and can never be
//                   a custom field — BUILD-78's ask gate)
//   onChange(value) · onCreateField({label,type,entity}) → Promise<def>
import { useState } from "react";
import { T } from "./shared";
import { CF_TYPES } from "../../../shared/customFieldShape";
import { errorMessage } from "../lib/domainError";

export function ColumnTargetSelect({
  header, standardFields = [], cfDefs = { donor: [], gift: [] }, entity = "donor",
  value = "ignore", takenStd = null, locked = null, evidence = "", proposal = null,
  onChange, onCreateField, disabled = false, compact = false, testId,
}) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const existing = (cfDefs[entity] || []).filter(d => !d.archived_at && !d.archivedAt);

  if (locked) {
    return (
      <div style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: T.gold600 || "#a97f22" }}
        data-testid={testId} data-column-target="flag">
        → safety flags ({locked}) — locked
      </div>
    );
  }

  const create = async () => {
    if (!draft || !draft.label.trim() || !onCreateField) return;
    setBusy(true); setErr("");
    try {
      const def = await onCreateField({ label: draft.label.trim(), type: draft.type,
                                        options: draft.options || [], entity: draft.entity });
      if (def && def.id) onChange(`cf:${def.id}`);
      setDraft(null);
    } catch (e) { setErr(errorMessage(e, "Could not create the field.")); }
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <select
        data-testid={testId} data-column-target={value}
        value={value === "flag" ? "ignore" : value}
        disabled={disabled}
        onChange={e => {
          const v = e.target.value;
          if (v === "__new__") {
            // The proposal's OPTIONS ride with its type: a column of three
            // distinct values proposes `select`, and the custom-field seam
            // rightly refuses a select with no options (this 400'd silently
            // until the four-shape guard caught it).
            setDraft({ label: String(header || "").trim().slice(0, 60),
                       type: (proposal && proposal.type) || "text",
                       options: (proposal && proposal.options) || [], entity });
            return;
          }
          setDraft(null);
          onChange(v);
        }}
        style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 7,
                 padding: compact ? "4px 6px" : "5px 8px", color: T.ink, fontSize: compact ? 11.5 : 12.5,
                 cursor: disabled ? "not-allowed" : "pointer", maxWidth: compact ? 200 : 320, outline: "none" }}>
        <optgroup label="Standard fields">
          {standardFields.filter(f => !f.flag).map(f => {
            const v = `std:${f.key}`;
            return <option key={f.key} value={v} disabled={!!takenStd && takenStd.has(f.key) && value !== v}>{f.label}</option>;
          })}
        </optgroup>
        {existing.length > 0 && (
          <optgroup label="Your custom fields">
            {existing.map(d => <option key={d.id} value={`cf:${d.id}`}>{d.label}</option>)}
          </optgroup>
        )}
        <optgroup label="—">
          <option value="__new__">＋ New custom field…</option>
          <option value="ignore">Don't import this column</option>
        </optgroup>
      </select>

      {draft && (
        <div data-testid="ct-new-field" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
             background: T.bg, borderRadius: 8, padding: "7px 9px" }}>
          <input value={draft.label} onChange={e => setDraft(p => ({ ...p, label: e.target.value }))}
            placeholder="Field name"
            style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: 160 }} />
          <select value={draft.type} onChange={e => setDraft(p => ({ ...p, type: e.target.value,
                    // switching TO a choice type keeps the proposal's options; away from one drops them
                    options: /select/.test(e.target.value) ? ((proposal && proposal.options) || p.options || []) : [] }))}
            style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
            {CF_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
          <select value={draft.entity} onChange={e => setDraft(p => ({ ...p, entity: e.target.value }))}
            style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
            <option value="donor">on the donor</option>
            <option value="gift">on the gift</option>
          </select>
          {/select/.test(draft.type) && !(draft.options || []).length && (
            <span style={{ fontSize: 11, color: "#b8593f" }}>a choice field needs its options — pick another type</span>
          )}
          <button onClick={create} disabled={busy || !draft.label.trim() || (/select/.test(draft.type) && !(draft.options || []).length)} data-testid="ct-create-field"
            style={{ background: T.green600 || "#1e6b45", color: "#fff", border: "none", borderRadius: 7,
                     padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Creating…" : "Create field"}
          </button>
          <button onClick={() => setDraft(null)} style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 12, cursor: "pointer" }}>Cancel</button>
        </div>
      )}
      {err && <div style={{ fontSize: 11.5, color: "#b8593f" }}>{err}</div>}
      {evidence && !draft && <div style={{ fontSize: 11, color: T.ink3 }}>{evidence}</div>}
    </div>
  );
}

export default ColumnTargetSelect;
