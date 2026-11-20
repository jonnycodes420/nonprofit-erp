// client/src/components/tasks/FinishSheet.jsx · THE ONE WAY A CALL OR MEETING TASK IS FINISHED.
//
// "How did it go, and what's next": the Tasks page's dialog since FIX-34, moved here in FLOWS-20
// (W-1120-Donors-T11) so the profile opens the same one. The profile's tick and its sheet's Mark
// done opened the generic Log a touch instead, which never names the task: the task stayed open,
// and the touch's default "Follow up" replaced the person's next step. Here the conversation is
// logged and THIS task is completed with it (POST /tasks/:id/complete with its interactionId).
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { fmtDayShort } from "../../lib/taskDue";
import { TASK_OUTCOMES, addDays, kindOf } from "../../../../shared/taskShape.js";
import DateInput from "../inputs/LazyDateInput";

const inp = { background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "9px 11px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%", boxSizing: "border-box" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: T.ink3 };
const outlineBtn = { background: T.white, border: `1px solid ${T.ink}`, borderRadius: 8, padding: "5px 12px", minHeight: 44, fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const textBtn = { background: "none", border: "none", padding: "5px 8px", minHeight: 44, minWidth: 44, fontSize: 12, fontWeight: 700, color: T.greenDk, cursor: "pointer", fontFamily: "inherit" };

// The person's open Thread step that is not this task's own, as { id, label, due }, or null.
export function otherOpenStep(list, t) {
  const s = (Array.isArray(list) ? list : []).find(x => x && x.kind !== "task" && x.id !== t.thread_id && x.id !== t.id);
  return s ? { id: s.id, label: s.stepLabel || (s.nextStep && s.nextStep.label) || "their next step", due: s.dueDate || (s.nextStep && s.nextStep.due) || null } : null;
}

// The Undo toast's words after a finish, the same on every page.
export const finishedWords = (t, row) => `Done: ${t.title}. Logged how it went${row && row.next ? `; the next one is on ${fmtDayShort(row.next.due)}` : ""}.`;

export function FinishSheet({ t, today, onClose, onDone }) {
  const [line, setLine] = useState("");
  const [reached, setReached] = useState(true);
  const [next, setNext] = useState({ label: "", due: addDays(today, 7) });
  const [none, setNone] = useState(false);
  // FLOWS-20 (W-1120-Donors-T11): the person's open next step when it is not this task's own.
  // Saving a next step replaces it (one open step per person), so the sheet says so, and starts
  // on "No next step" when one is open: finishing a call never closes another step unasked.
  const [otherStep, setOtherStep] = useState(null);
  const touched = useRef(false);   // she has answered "What's next?" herself: the default never overrides her
  useEffect(() => {
    if (!t.donor_id) return undefined;
    let dead = false;
    apiFetch(`/threads?donorId=${encodeURIComponent(t.donor_id)}`).then(r => {
      if (dead) return;
      const open = otherOpenStep(r && r.list, t);
      setOtherStep(open);
      if (open && !touched.current) setNone(true);
    }).catch(() => {});
    return () => { dead = true; };
  }, [t.donor_id, t.id, t.thread_id]);
  const [outcome, setOutcome] = useState("");   // JOURNEYS-4: how it ended, optional
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isCall = (t.kind || kindOf(t)) === "call";   // a quick-added "Call …" task has no kind of its own
  const emailed = !!t.emailInteractionId;   // FIX-34: the email is sent and logged; only the next step is asked
  const ready = (emailed || line.trim()) && (none || (next.label.trim() && next.due));
  const save = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      if (emailed) {
        const row = await apiFetch(`/tasks/${t.id}/complete`, { method: "POST", body: JSON.stringify({ done: true, interactionId: t.emailInteractionId,
          nextStep: none ? { skipped: true } : { type: "follow_up", label: next.label.trim(), due: next.due } }) });
        await onDone(row); setBusy(false); return;
      }
      const touch = isCall ? (reached ? "call_reached" : "call_no_answer") : "meeting";
      const c = await apiFetch(`/donors/${t.donor_id}/conversations`, { method: "POST", body: JSON.stringify({
        touch, line: line.trim(), ...(outcome ? { outcome } : {}),
        nextStep: none ? { skipped: true } : { type: "follow_up", label: next.label.trim(), due: next.due } }) });
      const row = await apiFetch(`/tasks/${t.id}/complete`, { method: "POST", body: JSON.stringify({ done: true, interactionId: c.interactionId }) });
      await onDone(row);
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} title={emailed ? `The email to ${t.donor_name || "them"} is sent` : `${isCall ? "The call" : "The meeting"} with ${t.donor_name || "them"}`} width={480}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={textBtn}>Cancel</button>
        <button onClick={save} disabled={!ready || busy} data-testid="finish-save"
          style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !ready || busy ? 0.5 : 1 }}>Save and mark done</button>
      </div>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {emailed && <div style={{ fontSize: 13, color: T.ink2 }}>It is on their timeline. Say what comes next, or "No next step", to finish the task.</div>}
        {isCall && !emailed && <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
          <label><input type="radio" checked={reached} onChange={() => setReached(true)} /> Reached them</label>
          <label><input type="radio" checked={!reached} onChange={() => setReached(false)} /> No answer</label>
        </div>}
        {!emailed && <label style={lbl}>How did it go?
          <textarea autoFocus value={line} onChange={e => setLine(e.target.value)} rows={2} data-testid="finish-line" placeholder="She will bring two tables to the gala." style={{ ...inp, resize: "vertical" }} />
        </label>}
        {!emailed && <div style={lbl}>How did it end? <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TASK_OUTCOMES.map(o => (
              <button key={o.key} type="button" aria-pressed={outcome === o.key} data-testid={"finish-outcome-" + o.key}
                onClick={() => setOutcome(outcome === o.key ? "" : o.key)}
                style={{ ...outlineBtn, fontSize: 12, padding: "5px 10px", textTransform: "none", letterSpacing: 0,
                         background: outcome === o.key ? T.bg2 : T.white, borderColor: outcome === o.key ? T.greenDk : T.bg3 }}>{o.label}</button>
            ))}
          </div>
        </div>}
        <div style={lbl}>What's next?
          {!none && <div style={{ display: "flex", gap: 8 }}>
            <input value={next.label} onChange={e => { touched.current = true; setNext({ ...next, label: e.target.value }); }} data-testid="finish-next" placeholder="Send the table details" style={{ ...inp, flex: 2 }} />
            <DateInput value={next.due} onChange={e => setNext({ ...next, due: e.target.value })} data-testid="finish-next-due" style={{ ...inp, flex: 1 }} />
          </div>}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            <input type="checkbox" checked={none} onChange={e => { touched.current = true; setNone(e.target.checked); }} data-testid="finish-none" /> No next step
          </label>
          {otherStep && <div data-testid="finish-other-step" style={{ fontSize: 12.5, color: T.ink2, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            {none ? `Their next step stays: ${otherStep.label}${otherStep.due ? ` (${fmtDayShort(otherStep.due)})` : ""}.`
                  : `This replaces their next step: ${otherStep.label}.`}
          </div>}
        </div>
        {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
      </div>
    </Modal>
  );
}
