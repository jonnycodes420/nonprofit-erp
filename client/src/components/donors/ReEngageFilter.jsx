// components/donors/ReEngageFilter.jsx · FLOWS-4 (W-1109-Donors-18X).
// RE-ENGAGE CARRIES THE DIRECTORY'S FILTERS.
//
// Re-engage read the whole org's people and kept only its own filters, so a
// Directory narrowed to Ely, NC (in the address: owner=, where=, stage=, …)
// opened Re-engage on everyone lapsed. Now the Directory's filters travel:
// Re-engage asks the server which people they match (GET /donors/ids, the
// Directory's own filter, every page of it) and lists only those, under a
// chip "Filtered: 3 filters" with Clear. The search box is not counted: it is
// on screen already, and Re-engage reads it as before.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

// How many of the Directory's filters are set. `f` holds the list's own state.
export function directoryFilterCount(f) {
  const conds = (f.where && Array.isArray(f.where.conditions)) ? f.where.conditions.length : 0;
  return [f.stage, f.owner, f.designation, f.household, f.status, f.fromImport].filter(Boolean).length + conds;
}

// The ids the Directory's filters match, or null when none are set (or while
// they load). `params` is the query the Directory itself sends.
export function useDirectoryIds(params, on) {
  const key = on ? JSON.stringify(params) : "";
  const [ids, setIds] = useState(null);
  useEffect(() => {
    if (!key) { setIds(null); return undefined; }
    let live = true;
    setIds(null);
    (async () => {
      const qs = new URLSearchParams();
      Object.entries(JSON.parse(key)).forEach(([k, v]) => { if (v) qs.set(k, v); });
      const all = [];
      let offset = 0;
      for (let i = 0; i < 60 && offset != null; i++) {
        qs.set("offset", String(offset));
        const r = await apiFetch(`/donors/ids?${qs.toString()}`);
        if (Array.isArray(r && r.ids)) all.push(...r.ids);
        offset = r && r.next != null ? r.next : null;
      }
      if (live) setIds(new Set(all));
    })().catch(e => { console.error("[re-engage] the Directory's filters:", e && e.message); if (live) setIds(new Set()); });
    return () => { live = false; };
  }, [key]);
  return ids;
}

export function FilteredChip({ count, onClear }) {
  if (!count) return null;
  return (
    <div data-testid="reengage-filtered" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "0 0 12px", padding: "5px 6px 5px 12px",
      borderRadius: 99, border: "1px solid " + T.greenDk, background: T.white, fontSize: 12.5, fontWeight: 700, color: T.ink }}>
      <span>Filtered: {count} {count === 1 ? "filter" : "filters"} from the Directory</span>
      <button type="button" data-testid="reengage-filtered-clear" onClick={onClear}
        style={{ border: "none", background: "transparent", color: T.greenDk, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>
    </div>
  );
}
