// STALE-1 · THE APP'S FIRST LOAD KEEPS UP, ONE SLICE AT A TIME.
//
// App.jsx reads grants, volunteers, tasks and the financials once, at sign-in,
// and hands them to every page (the Grants board's cards, the Volunteers
// header, Fundraising's funds). Only an import or a task drafted from a profile
// re-read them (loadData), and then all six reads went out together. Now a
// change of one kind (lib/changes.js) re-reads only the slice that shows it:
// a grant payment asks for /grants and nothing else.
import { apiFetch, adaptGrant, adaptVolunteer, adaptTask, adaptFinancials, adaptOrg } from "../api";
import { useChanged } from "./changes";

const SLICES = [
  { key: "grants",     kinds: ["grant", "pledge"],       path: "/grants",     shape: rows => rows.map(adaptGrant) },
  { key: "volunteers", kinds: ["volunteer"],             path: "/volunteers", shape: rows => rows.map(adaptVolunteer) },
  { key: "tasks",      kinds: ["task"],                  path: "/tasks",      shape: rows => rows.map(adaptTask) },
  { key: "financials", kinds: ["fund", "totals"],        path: "/financials", shape: adaptFinancials },
  // FRESH-4 item 4 (Area 5): a rename moved the header's pill but Home's greeting kept the old name
  { key: "org",        kinds: ["org"],                   path: "/org",        shape: o => { const { programs: _programs, ...rest } = adaptOrg(o); return rest; }, merge: true },
];

function reread(slice, setData) {
  apiFetch(slice.path).then(raw => {
    const value = slice.shape(raw);
    setData(d => (d ? { ...d, [slice.key]: slice.merge ? { ...(d[slice.key] || {}), ...value } : value } : d));   // FRESH-4: the org keeps what the shell added to it
  }).catch(() => { /* a failed refresh keeps what is on screen */ });
}

// A pledge write re-reads grants only when it names a grant's award pledge;
// any other pledge is a person's, and the Grants board does not show it.
export function useBootSlices(enabled, setData, dataRef) {
  for (const slice of SLICES) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useChanged(slice.kinds, c => {
      if (!enabled) return;
      // FRESH-4 item 2: these are the shell's shared lists, not a surface on screen. Whatever shows them
      // re-renders from them, and the pages that read them on their own re-read on any write. A write
      // that names none of a slice's kinds leaves it (on Home, grants, volunteers, tasks and the org
      // re-read for every gift: 24 requests a save, not 13).
      if (!slice.kinds.some(k => c.kinds.has(k))) return;
      if (slice.key === "grants" && !c.kinds.has("grant")) {
        const named = c.ids.pledge ? [...c.ids.pledge] : [];
        const grants = (dataRef && dataRef.current && dataRef.current.grants) || [];
        if (!named.some(id => grants.some(g => g.awardPledgeId === id))) return;
      }
      if (slice.key === "financials" && c.source === "worker" && !c.kinds.has("fund")) return;
      reread(slice, setData);
    }, null, 200);
  }
}
