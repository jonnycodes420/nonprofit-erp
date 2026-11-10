// ONBOARD-2 · GET /onboarding/mine, read once (and again after a call is
// logged). Its own small module so Home can read it without loading the card,
// which is lazy: an org not in onboarding never downloads it (perf-app's budget).
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";

export function useOnboarding(on) {
  const [data, setData] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    apiFetch("/onboarding/mine").then(d => { if (live) setData(d); }).catch(() => { if (live) setData(x => x || { tracked: false, show: false, steps: [] }); });
    return () => { live = false; };
  }, [on, n]);
  return [data, setData, () => setN(x => x + 1)];   // the third reads it again (after a call is logged)
}
