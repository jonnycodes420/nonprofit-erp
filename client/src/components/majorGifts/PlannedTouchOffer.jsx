// components/majorGifts/PlannedTouchOffer.jsx · TOUCH-1. DONE ON A PLANNED TOUCH.
//
// Ticking a plan-of-care touch in Tasks, on any day (a touch planned for next
// month is done today when she did it today), offers to log the touch with
// the same kind, in her words. A touch that is not a call or a visit can also
// just be marked done; a call or a visit is finished by saying how it went.
import { useState } from "react";
import { T, Modal } from "../shared";
import { LogConversationModal } from "../LogConversation";
import { TOUCH_KINDS } from "../../../../shared/touchKinds.js";
import { touchKind, touchLabel } from "../../../../shared/careShape.js";
import { NEEDS_OUTCOME } from "../../../../shared/taskShape.js";

const kindForCare = type => (TOUCH_KINDS.find(k => k.care.includes(type)) || {}).key || null;

export function PlannedTouchOffer({ task, onJustDone, onLogged, onClose }) {
  const [logging, setLogging] = useState(false);
  const label = touchLabel(task.touch_type);
  const kind = kindForCare(task.touch_type);
  if (logging) return <LogConversationModal donor={{ id: task.donor_id, name: task.donor_name || "" }} initialKind={kind} completesTaskId={task.id}
    onClose={onClose} onSaved={onLogged} />;
  const btn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 14px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" };
  const quiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 14px", color: T.ink2, fontSize: 13, cursor: "pointer" };
  return (
    <Modal onClose={onClose} width={420} title={`${label}${task.donor_name ? ` with ${task.donor_name}` : ""}`}>
      <div data-testid="planned-touch-offer" style={{ fontSize: 13, color: T.ink2, marginBottom: 14, lineHeight: 1.5 }}>
        A planned touch from their plan of care. Log what you did and it is done today, whatever day it was planned for.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {kind && <button type="button" data-testid="offer-log" onClick={() => setLogging(true)} style={btn}>Log the {label.toLowerCase()}</button>}
        {!NEEDS_OUTCOME.has(touchKind(task.touch_type)) && <button type="button" data-testid="offer-just-done" onClick={onJustDone} style={quiet}>Just mark it done</button>}
        <button type="button" onClick={onClose} style={{ ...quiet, border: "none" }}>Cancel</button>
      </div>
    </Modal>
  );
}
