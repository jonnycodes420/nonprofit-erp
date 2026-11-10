// components/settings/TrashLink.jsx · FLOWS-4 (W-1107-Finance-35).
// THE TRASH HAS ITS OWN PLACE, AND THE WAY THERE SAYS HOW MANY.
//
// INTEGRITY-2's Trash list sat at the bottom of Settings → Imports, inside
// Empty trash, and Muse checked every Settings section and Your Data without
// finding it. Now it is Settings → Trash, a section of its own named with its
// count, and "Trash (n)" links to it from the foot of the Donors list, from
// Your Data and from Imports. The count is the Trash list's own (GET
// /trash/people, server/donors/trashList.js: in the trash, not merged away,
// not erased). The list is an admin's (the route says so too), so a
// teammate who is not an admin sees no link.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { RecordLink } from "../RecordLink";
import { tabHref } from "../../lib/appUrls";

export function useTrashCount(on = true) {
  const [n, setN] = useState(null);
  useEffect(() => {
    if (!on) { setN(null); return undefined; }
    let live = true;
    const read = () => apiFetch("/trash/people?limit=1").then(r => { if (live) setN(Number(r && r.inTrash) || 0); }).catch(() => { if (live) setN(null); });
    read();
    window.addEventListener("steward:trash-changed", read);
    return () => { live = false; window.removeEventListener("steward:trash-changed", read); };
  }, [on]);
  return n;
}
export const trashLabel = n => (n == null ? "Trash" : `Trash (${n.toLocaleString("en-US")})`);

export function TrashLink({ isAdmin, onNavigate, lead = null, style }) {
  const n = useTrashCount(!!isAdmin);
  if (!isAdmin || n == null) return null;
  const to = tabHref("settings", { section: "trash" });
  return (
    <div style={{ fontSize: 13, color: T.ink3, ...(style || {}) }}>
      {lead}
      <RecordLink to={to} data-testid="trash-link" onOpen={onNavigate ? () => onNavigate("settings", { section: "trash" }) : undefined}
        style={{ color: T.greenDk, fontWeight: 700, textDecoration: "underline" }}>{trashLabel(n)}</RecordLink>
    </div>
  );
}
