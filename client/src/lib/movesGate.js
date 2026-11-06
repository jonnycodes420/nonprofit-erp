// FEEL-1 · Home never jumps.
//
// Home's moves deck answers on its own read (/insights?view=deck). Until it
// does it is a one-line "Reading your donors…" box; the deck it becomes can be
// 1,200 px tall. When that read came late (a cold server, CI's slower runner),
// everything drawn under the box was pushed down at once: perf-app's desktop
// CLS of 0.201, the Thread going from y 480 out of view at about 1.5 s.
//
// So on a wide screen Home draws what sits under the deck only once the deck has its size: it
// drew, or it failed (and draws nothing). New content below a settled deck
// moves nothing. A deck that never says either (its code never arrives) is
// let go after SAFETY_MS, so the Thread can never be held back for good.
import { useState, useEffect, useCallback } from "react";

export const SAFETY_MS = 6000;

// Off (a phone): settled from the start, no timer and no callback, so nothing
// re-renders Home when the deck lands: on a phone that re-render cost ~150 ms
// of the 3.58 s budget (perf-app), and a phone keeps its own order.
export function useMovesGate(enabled = true) {
  const [settled, setSettled] = useState(!enabled);
  const settle = useCallback(() => setSettled(true), []);
  useEffect(() => {
    if (settled || !enabled) return undefined;
    const t = setTimeout(settle, SAFETY_MS);
    return () => clearTimeout(t);
  }, [settled, settle, enabled]);
  return [settled || !enabled, enabled ? settle : null];
}
