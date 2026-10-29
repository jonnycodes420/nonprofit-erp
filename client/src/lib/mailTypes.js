// SEND-GATE-2 · the one copy of "which emails Steward sends on its own" on this
// page. Settings, every editor's switch, the top bar and Home read it, and a
// change anywhere reloads it everywhere (the same switch, shown in many places).
import { useEffect, useState } from "react";
import { apiFetch } from "../api";

let page = null, status = null, inflight = null;
const subs = new Set();
const tell = () => subs.forEach(f => f());

export function reloadMailTypes() {
  if (inflight) return inflight;
  inflight = Promise.all([apiFetch("/mail-types"), apiFetch("/mail-types/status")])
    .then(([p, s]) => { page = p; status = s; tell(); })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

export function useMailTypes() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump(n => n + 1);
    subs.add(f);
    if (!page && !inflight) reloadMailTypes();
    return () => subs.delete(f);
  }, []);
  return { page, status, types: page ? page.groups.flatMap(g => g.types) : [] };
}

// THE SWITCH. The server asks for the confirm and who gets it; the caller has
// already shown both. `from` says which screen it was flipped on (the audit row).
export async function setMailType(key, on, audience, from) {
  const body = on ? { on: true, audience, confirm: true, from } : { on: false, from };
  const p = await apiFetch(`/mail-types/${encodeURIComponent(key)}`, { method: "POST", body: JSON.stringify(body) });
  page = p;
  status = await apiFetch("/mail-types/status").catch(() => status);
  tell();
  return p;
}
