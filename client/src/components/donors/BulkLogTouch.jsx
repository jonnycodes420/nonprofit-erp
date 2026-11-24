// client/src/components/donors/BulkLogTouch.jsx · EDIT-2 item 3. LOG ONE TOUCH TO MANY PEOPLE.
//
// From the Donors selection bar, or from Log a touch's picker with more than one
// person ticked: what she did, a short title ("Invited to Spring awareness
// night"), an optional note and the day. Save writes one touch per person, each
// on that person's timeline, in one step (server/donors/touchBatch.js), with one
// Undo for the batch. It sends nothing, and makes a task only when she ticks
// "Also add a follow-up task".
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { offerUndo } from "../EditHistory";
import { errorMessage } from "../../lib/domainError";
import { TOUCH_KINDS } from "../../../../shared/touchKinds.js";
import { orgTodayCivil } from "../../lib/orgToday";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box

export const MAX_BATCH = 2000;
const people = n => `${Number(n).toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
const OFFERED = ["email", "letter", "call", "meeting", "event_invite", "other"];

export function BulkLogTouch({ ids, onClose, onDone, zIndex = 320 }) {
  const today = orgTodayCivil();
  const [kind, setKind] = useState("email");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [follow, setFollow] = useState(false);
  const [due, setDue] = useState("");
  const [had, setHad] = useState(null);        // { people, already, sentence }
  const [skipHad, setSkipHad] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const tooMany = ids.length > MAX_BATCH;

  // Who already has a touch with this title, asked once she stops typing.
  // Keyed on the ids' contents: the selection bar hands a new array each render.
  const idsKey = ids.join(",");
  useEffect(() => {
    const t = title.trim();
    if (!t || tooMany) { setHad(null); return undefined; }
    let live = true;
    const h = setTimeout(() => {
      apiFetch("/touch-batches/preview", { method: "POST", body: JSON.stringify({ ids, title: t }) })
        .then(r => { if (live) setHad(r); }).catch(() => { if (live) setHad(null); });
    }, 350);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, idsKey, tooMany]);

  const already = had ? Number(had.already) || 0 : 0;
  const writing = Math.max(0, ids.length - (skipHad ? already : 0));

  async function save() {
    if (busy) return;
    if (!title.trim()) { setErr("Give the touch a short title."); return; }
    if (date > today) { setErr("A touch is something already done: pick today or an earlier day."); return; }
    if (follow && !due) { setErr("Pick the day the follow-up is due."); return; }
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/touch-batches", { method: "POST", body: JSON.stringify({
        ids, touchKind: kind, title: title.trim(), note: note.trim() || undefined, date,
        skipHad: skipHad && already > 0, ...(follow ? { followUp: { due } } : {}) }) });
      onDone && onDone(r);
      onClose && onClose();
      // FLOWS-20: the batch is a line in Recent changes from the server (listed), with this same undo.
      offerUndo({ undoSeconds: 60, listed: true, message: `Logged to ${people(r.people)}`, undoAction: async () => {
        await apiFetch(r.undo, { method: "POST", body: "{}" });
        onDone && onDone(null);
        return { restored: r.people };
      } }, "touch");
    } catch (e) {
      setErr((e && e.sentence) || errorMessage(e, "Nothing was logged. Try again."));
      setBusy(false);
    }
  }

  const inp = { width: "100%", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 11px", color: T.ink, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" };
  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 5, display: "block" };
  const chip = on => ({ background: on ? T.ink : T.white, color: on ? T.white : T.ink, border: "1px solid " + (on ? T.ink : T.bg3), borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" });

  return (
    <Modal onClose={onClose} width={480} zIndex={zIndex} padding={24} ariaLabel="Log a touch to many people">
      <div data-testid="bulk-log-touch" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>Log a touch</div>
          <div style={{ fontSize: 13, color: T.ink3, marginTop: 2 }}>To {people(ids.length)}. One touch on each person's timeline. Nothing is sent.</div>
        </div>
        {tooMany && <div role="alert" style={{ fontSize: 13, color: T.ink }}>A batch is at most {MAX_BATCH.toLocaleString("en-US")} people. Pick fewer, or log it in two batches.</div>}
        <div>
          <span style={lbl}>What you did</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="What you did">
            {TOUCH_KINDS.filter(k => OFFERED.includes(k.key)).map(k => (
              <button key={k.key} type="button" aria-pressed={kind === k.key} data-kind={k.key} onClick={() => setKind(k.key)} style={chip(kind === k.key)}>{k.label}</button>
            ))}
          </div>
        </div>
        <label>
          <span style={lbl}>Title</span>
          <input data-testid="bulk-touch-title" autoFocus value={title} maxLength={120} onChange={e => setTitle(e.target.value)}
            placeholder="Invited to Spring awareness night" style={inp} />
        </label>
        {already > 0 && (
          <div data-testid="bulk-touch-already" style={{ background: T.bg, border: "1px solid " + T.gold500, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.ink, display: "flex", flexDirection: "column", gap: 6 }}>
            <span>{had.sentence}</span>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" data-testid="bulk-touch-skip-had" checked={skipHad} onChange={e => setSkipHad(e.target.checked)} />
              {already >= ids.length
                ? `Skip them. Everyone picked already has it, so nothing would be logged; untick to log it again for all ${ids.length.toLocaleString("en-US")}.`
                : `Skip them, and log it for the other ${people(ids.length - already)}`}
            </label>
          </div>
        )}
        <label>
          <span style={lbl}>Note (optional)</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} />
        </label>
        <label>
          <span style={lbl}>Day</span>
          <DateInput data-testid="bulk-touch-date" aria-label="Day" value={date} max={today} onChange={e => setDate(e.target.value)} style={{ ...inp, width: "auto" }} />
        </label>
        <div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, cursor: "pointer" }}>
            <input type="checkbox" data-testid="bulk-touch-follow" checked={follow} onChange={e => setFollow(e.target.checked)} />
            Also add a follow-up task for each person
          </label>
          {follow && <div style={{ marginTop: 8 }}><DateInput aria-label="Follow-up due" data-testid="bulk-touch-follow-due" value={due} min={today} onChange={e => setDue(e.target.value)} style={{ ...inp, width: "auto" }} /></div>}
        </div>
        {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={{ background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" data-testid="bulk-touch-save" onClick={save} disabled={busy || tooMany || !title.trim() || writing < 1}
            style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", opacity: busy || tooMany || !title.trim() || writing < 1 ? 0.5 : 1 }}>
            {busy ? "Logging…" : `Log to ${people(writing)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The selection bar's button: opens the dialog for the people picked.
export function BulkLogTouchButton({ ids, disabled, onDone }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" data-testid="bulk-log-touch-open" onClick={() => setOpen(true)} disabled={disabled || !ids.length}
      style={{ background: "transparent", border: "1px solid " + T.gold500, borderRadius: 8, padding: "7px 12px", color: T.gold500, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
      Log a touch
    </button>
    {open && <BulkLogTouch ids={ids} onClose={() => setOpen(false)} onDone={onDone} />}
  </>;
}
