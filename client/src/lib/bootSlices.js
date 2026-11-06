// STALE-1 · THE APP'S FIRST LOAD KEEPS UP, ONE SLICE AT A TIME.
//
// App.jsx reads grants, volunteers, tasks and the financials once, at sign-in,
// and hands them to every page (the Grants board's cards, the Volunteers
// header, Fundraising's funds). Only an import or a task drafted from a profile
// re-read them (loadData), and then all six reads went out together. Now a
// change of one kind (lib/changes.js) re-reads only the slice that shows it:
// a grant payment asks for /grants and nothing else.
import { apiFetch, adaptGrant, adaptVolunteer, adaptTask, adaptFinancials } from "../api";
import { useChanged } from "./changes";

const SLICES = [
  { key: "grants",     kinds: ["grant", "pledge"],       path: "/grants",     shape: rows => rows.map(adaptGrant) },
  { key: "volunteers", kinds: ["volunteer"],             path: "/volunteers", shape: rows => rows.map(adaptVolunteer) },
  { key: "tasks",      kinds: ["task"],                  path: "/tasks",      shape: rows => rows.map(adaptTask) },
  { key: "financials", kinds: ["fund", "totals"],        path: "/financials", shape: adaptFinancials },
];

function reread(slice, setData) {
  apiFetch(slice.path).then(raw => {
    const value = slice.shape(raw);
    setData(d => (d ? { ...d, [slice.key]: value } : d));
  }).catch(() => { /* a failed refresh keeps what is on screen */ });
}

// A pledge write re-reads grants only when it names a grant's award pledge;
// any other pledge is a person's, and the Grants board does not show it.
export function useBootSlices(enabled, setData, dataRef) {
  for (const slice of SLICES) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useChanged(slice.kinds, c => {
      if (!enabled) return;
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
