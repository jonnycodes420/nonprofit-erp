// client/src/components/donors/FilterSuggest.jsx · FLOWS-20 (W-1119-Donors-T8, a repeat).
// UNDER A FILTER'S EMPTY BOX: WHAT TO TYPE, AND WHAT HAS BEEN TYPED BEFORE.
//
// Donors → Filters → Touch titled sat there with Add filter disabled and nothing said why: the
// server's "Type the touch's title." only reached a filter that was sent, and an empty one never
// was. A field that names an `emptyHint` says it under its empty box, and one that names a
// `suggest` path offers what it answers (the org's recent touch titles) as one-click choices.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

export function FilterSuggest({ filter, value, onPick }) {
  const [titles, setTitles] = useState([]);
  const path = filter && filter.suggest;
  useEffect(() => {
    if (!path) return undefined;
    let dead = false;
    apiFetch(path).then(r => { if (!dead) setTitles(Array.isArray(r && r.titles) ? r.titles : []); }).catch(() => {});
    return () => { dead = true; };
  }, [path]);
  const empty = typeof value === "string" && !value.trim();
  if (!filter || (!filter.emptyHint && !titles.length)) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {empty && filter.emptyHint && <div data-testid="filter-empty-hint" role="status" style={{ fontSize: 12.5, color: T.ink2 }}>{filter.emptyHint}</div>}
      {titles.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: T.ink3 }}>Recent:</span>
        {titles.map(t => (
          <button key={t} type="button" data-testid="filter-suggest" onClick={() => onPick(t)}
            style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 99, padding: "3px 10px", fontSize: 12, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>
        ))}
      </div>}
    </div>
  );
}
