import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, Modal } from "../shared";

// INTEGRITY-2 (W-1108-Finance-50X) · DELETE ASKS FIRST. Delete donor used to
// go at once. Now it names what goes to the trash with them (their gifts,
// household and relationship links, open tasks) before anything moves, and
// says how they come back (Restore in Settings, Trash, for 30 days).
const n = (k, one, many) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;

export function DeletePersonConfirm({ person, onConfirm, onClose }) {
  const [w, setW] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch("/donors/trash-check", { method: "POST", body: JSON.stringify({ ids: [person.id] }) })
      .then(r => { if (live) setW(r); }).catch(e => { if (live) setErr(errorMessage(e, "Steward could not count what goes with them.")); });
    return () => { live = false; };
  }, [person.id]);
  const parts = w ? [w.gifts && n(w.gifts, "gift", "gifts"), (w.links + w.households) && n(w.links + w.households, "household or relationship link", "household and relationship links"),
    w.openTasks && n(w.openTasks, "open task", "open tasks")].filter(Boolean) : [];
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return (
    <Modal onClose={onClose} width={440} ariaLabel={`Delete ${person.name}`}>
      <div data-testid="delete-person-confirm" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>Move {person.name} to the trash?</div>
        <div data-testid="delete-person-what" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
          {!w ? (err || "Counting what goes with them…")
            : parts.length ? `Their ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")} go with them.` : "Nothing else goes with them: no gifts, links or open tasks."}
        </div>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.45 }}>Restore in Settings, Imports, Trash brings them back with all of it for 30 days. After that they are deleted for good.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" data-commit data-testid="delete-person-yes" disabled={!w || busy} onClick={go}
            style={{ background: T.terra700, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: !w || busy ? 0.6 : 1 }}>
            {busy ? "Moving…" : "Move to trash"}
          </button>
          <button type="button" data-testid="delete-person-keep" onClick={onClose} style={{ background: T.bg2, color: T.ink, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Keep them</button>
        </div>
      </div>
    </Modal>
  );
}
