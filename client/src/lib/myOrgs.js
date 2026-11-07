// lib/myOrgs.js · ACCESS-1. The orgs this person is in, for the account menu.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";

// The orgs this person is in. Null until read; [] when the read failed.
export function useMyOrgs(enabled = true) {
  const [orgs, setOrgs] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    apiFetch("/me/orgs").then(r => { if (live) setOrgs((r && r.orgs) || []); }).catch(() => { if (live) setOrgs([]); });
    return () => { live = false; };
  }, [enabled]);
  return orgs;
}
