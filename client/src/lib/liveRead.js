// FRESH-2 · EVERY LIST AND COUNT RE-READS AFTER A SAVE, FROM ONE PLACE.
//
// Jarvis's mega sweep (25 Nov): counts lagged after a trash, a gift saved or
// deleted, a touch, a campaign deleted, a volunteer deleted... while Home's
// Thread and the profile's rail moved at once. The fresh data existed; the
// list and count surfaces each kept their own refetch-on-save code, and every
// one nobody had wired stayed stale.
//
// This is LIVE-2's channel (lib/changes.js), not a second one. A surface names
// itself and the topics it shows, and hands over its read:
//
//   const { data, error, loading, reload } = useLiveRead("comms.recent-sends", ["fund", "totals"],
//     () => apiFetch("/communications/hub"));
//
// It reads on mount (and when `deps` change), and again whenever a change that
// reaches those topics lands: a write from this browser (its X-Steward-Changed
// header), Atlas or Tell Steward (told()), or the worker's marks on the bell.
// Only the newest read's answer is kept, so a read that left before a write
// and lands after the next one never puts the old list back ("one step behind").
//
// A surface whose read is tangled into a bigger page uses useLive(name, topics, fn)
// instead: the same subscription, with the page's own reload as `fn`.
//
// The name and the topics are literals on purpose: tests/lib/surfaceCensus.js reads
// them from the source, checks each against lib/surfaces.js (what the surface
// shows, by table) and shared/changeTopics.cjs (what a write to that table
// announces), and fails when a surface stops listening for what it shows.
import { useCallback, useEffect, useRef, useState } from "react";
import { useChanged, useChangeRev } from "./changes";

export function useLive(name, topics, fn, { ids = null } = {}) {
  useChanged(topics, fn, ids);
}

// A number that moves after each change that reaches this surface; put it in a read's dependencies.
export function useLiveRev(name, topics, ids = null) {
  return useChangeRev(topics, ids);
}

export function useLiveRead(name, topics, read, deps = [], { ids = null, keepWhileReading = true } = {}) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const seq = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;
  const reload = useCallback(() => {
    const n = ++seq.current;
    setState(s => (keepWhileReading && s.data !== undefined ? s : { ...s, loading: true }));
    return Promise.resolve().then(() => readRef.current()).then(
      data => { if (n === seq.current) setState({ data, error: null, loading: false }); return data; },
      error => { if (n === seq.current) setState(s => ({ data: s.data, error, loading: false })); },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); return () => { seq.current++; }; }, [reload]);
  useChanged(topics, () => { reload(); }, ids);
  const setData = useCallback(fn => setState(s => ({ ...s, data: typeof fn === "function" ? fn(s.data) : fn })), []);
  return { ...state, reload, setData };
}
