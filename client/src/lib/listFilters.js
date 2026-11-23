// client/src/lib/listFilters.js · LIST-6 item 2. THE PEOPLE LIST'S FILTERS ARE ONE OBJECT, AND THE ADDRESS HOLDS IT.
//
// Jarvis (22 Nov, staging and prod): "Clear filters" left the Owner filter on, with ?owner= still in
// the address. The list kept about fifteen useState hooks seeded once from the address, and two clear
// functions that each forgot something; `urlList.owner` then put Owner back.
//
// Now the filters are read from the address on every render, and only from there. Changing one is a
// replace of the address (lib/appUrls.js donorsListHref, the same names a link uses); "Clear filters"
// sets every one of them to empty, Owner included. While a profile is open (/donors/:id) the list's
// filters are the ones it had when it was last on screen, so closing the profile brings them back.
//
// Not filters, and not cleared: the tab (Directory, Re-engage…), the sort and its direction.
import { useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { donorsListHref, donorsListState } from "./appUrls";

// The filter's keys, as donorsListState names them. `where` is the chips' JSON; `savedView` the view
// they were picked from (FLOWS-2's chips plus LIST-6's view id).
export const FILTER_KEYS = ["search", "stage", "owner", "designation", "household", "status", "people", "fromImport", "where", "savedView"];
export const EMPTY_FILTERS = Object.freeze(Object.fromEntries(FILTER_KEYS.map(k => [k, ""])));

export function filtersOf(search) {
  const st = donorsListState(search);
  const out = { ...EMPTY_FILTERS };
  for (const k of FILTER_KEYS) if (st[k] != null) out[k] = String(st[k]);
  return out;
}

// Is any filter on? The view a filter came from is not itself a filter.
export function anyFilterOn(f) {
  return FILTER_KEYS.some(k => k !== "savedView" && String(f[k] || "").trim() !== "");
}

const onListPath = p => String(p || "").replace(/\/+$/, "") === "/donors";

export function useListFilters() {
  const loc = useLocation();
  const nav = useNavigate();
  const onList = onListPath(loc.pathname);
  const last = useRef(EMPTY_FILTERS);
  const f = useMemo(() => (onList ? filtersOf(loc.search) : last.current), [onList, loc.search]);
  if (onList) last.current = f;
  // `patch` names filter keys only; "" or null takes one off. The other parts of the address stay.
  const set = patch => {
    const here = onListPath(window.location.pathname);
    const cur = here ? donorsListState(window.location.search) : { ...last.current };
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!FILTER_KEYS.includes(k)) continue;
      next[k] = v == null ? "" : String(v);
    }
    const merged = { ...EMPTY_FILTERS };
    for (const k of FILTER_KEYS) merged[k] = next[k] == null ? "" : String(next[k]);
    last.current = merged;
    if (here) nav(donorsListHref(next), { replace: true, state: { internal: true } });
  };
  const clear = () => set(EMPTY_FILTERS);
  return { f, set, clear };
}
