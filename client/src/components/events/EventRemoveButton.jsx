// client/src/components/events/EventRemoveButton.jsx · WALKB-2.
//
// Item 5: an event can be taken away from its detail page. One with no gifts
// and no guests is deleted, after a confirmation; one with gifts or guests is
// archived instead, and its gifts stay counted (server/events/eventRemoval.js
// says which, and the button reads that answer rather than guessing).
// Item 2: an attendee's label is the server's (shared/numbers/donorLabel.js),
// the profile's rule, so someone who has given is never "Not a donor yet".
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, SC, Pill, stageName } from "../shared";
import { askConfirm } from "../ConfirmDialog";
import { errorMessage } from "../../lib/domainError";
import { useEventRowsRev } from "../../lib/eventRows";   // EVENTS-4: a guest added anywhere re-asks

const quiet = "rgba(240,237,230,0.7)";

export function AttendeeLabel({ a }) {
  const l = a && a.donor_label;
  if (l && l.key === "not_yet") return <span style={{ fontSize: 11, color: quiet }}>{l.label}</span>;
  if (l && l.key === "stage") return <Pill label={stageName(l.stage)} color={SC[l.stage] || T.ink3} />;
  if (l && l.key === "donor") return <Pill label="Donor" color={T.greenMid} />;
  // a row from before the label rode the answer: say nothing rather than guess
  return a && a.stage ? <Pill label={stageName(a.stage)} color={SC[a.stage] || T.ink3} /> : <span style={{ fontSize: 11, color: quiet }}>No record</span>;
}

export default function EventRemoveButton({ event, onArchived, onDeleted }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const id = event && event.id;
  const guests = (event && event.attendees ? event.attendees.length : 0);
  const rowsRev = useEventRowsRev(id);
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    apiFetch(`/events/${encodeURIComponent(id)}/removal`).then(r => { if (live) setInfo(r); }).catch(() => {});
    return () => { live = false; };
  }, [id, guests, rowsRev]);
  if (!id || !info) return null;
  const archived = !!event.archived_at;
  const btn = { background: "transparent", border: "1px solid " + T.green650, borderRadius: 8, padding: "7px 14px", color: T.inkInverse, fontSize: 12, fontWeight: 600, cursor: "pointer" };

  const act = async () => {
    setMsg("");
    // EVENTS-4 item 2: "Delete event" opened an Archive dialog when a guest had
    // arrived since the page read. Ask again on the press, so the button, the
    // line under it and the dialog are the same answer.
    let now = info;
    if (!archived) {
      try { now = await apiFetch(`/events/${encodeURIComponent(id)}/removal`); setInfo(now); } catch { now = info; }
      if (now.canDelete !== info.canDelete) return;   // the label just changed under her finger: let her read it first
    }
    if (archived) {
      setBusy(true);
      try { const r = await apiFetch(`/events/${encodeURIComponent(id)}/unarchive`, { method: "POST", body: "{}" }); setMsg(r.message || ""); onArchived && onArchived(null); }
      catch (e) { setMsg(errorMessage(e, "The event was not brought back.")); }
      setBusy(false);
      return;
    }
    if (now.canDelete) {
      if (!(await askConfirm({ title: `Delete ${event.name}?`, body: "It has no gifts and no guests. The event and its page go for good.", yes: "Delete the event", danger: true }))) return;
      setBusy(true);
      try { await apiFetch(`/events/${encodeURIComponent(id)}`, { method: "DELETE" }); onDeleted && onDeleted(); }
      catch (e) { setMsg(errorMessage(e, "The event was not deleted.")); }
      setBusy(false);
      return;
    }
    if (!(await askConfirm({ title: `Archive ${event.name}?`, body: `${now.sentence} It leaves the Events list; Archived shows it, and you can bring it back.`, yes: "Archive the event" }))) return;
    setBusy(true);
    try { const r = await apiFetch(`/events/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" }); setMsg(r.message || ""); onArchived && onArchived(r.archivedAt || true); }
    catch (e) { setMsg(errorMessage(e, "The event was not archived.")); }
    setBusy(false);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, maxWidth: 240 }}>
        <button data-testid={archived ? "ev-unarchive" : info.canDelete ? "ev-delete" : "ev-archive"} onClick={act} disabled={busy} title={archived ? "" : info.sentence} style={btn}>
          {busy ? "Working…" : archived ? "Bring back" : info.canDelete ? "Delete event" : "Archive event"}
        </button>
        {/* EVENTS-4 item 2: what it holds, before it is pressed (eventRemoval.js holdsLine). */}
        {!archived && info.line && <span data-testid="ev-remove-why" style={{ fontSize: 11, color: quiet, lineHeight: 1.35 }}>{info.line}</span>}
      </span>
      {msg && <span role="status" style={{ fontSize: 11.5, color: quiet, maxWidth: 260 }}>{msg}</span>}
    </span>
  );
}
