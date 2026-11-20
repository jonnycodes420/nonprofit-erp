// client/src/components/profile/ProfileFinish.jsx · FLOWS-20 (W-1120-Donors-T11).
// A CALL OR MEETING TICKED ON A PROFILE OPENS THE TASKS PAGE'S OWN FINISH DIALOG.
//
// FLOWS-17 sent a profile tick that has to say how it went to the generic Log a touch. That
// dialog never names the task, so logging the call three ways left the task open, and its
// default "Follow up" replaced the person's next step. Every profile door (Coming up, the
// Activity timeline, the Tasks tab, and the task sheet's Mark done) now opens FinishSheet, which
// logs the conversation and completes THIS task with it. api.js announces both writes, so the
// profile, the Tasks page and the badge re-read with no reload.
import { useCallback, useState } from "react";
import { apiFetch } from "../../api";
import { offerUndo } from "../EditHistory";
import { orgTodayPlus } from "../../lib/orgToday";
import { FinishSheet, finishedWords } from "../tasks/FinishSheet";

export function useProfileFinish({ donor }) {
  const [finish, setFinish] = useState(null);
  const onTaskOutcome = useCallback(t => {
    if (!t || !t.id) return;
    setFinish({ ...t, donor_id: t.donor_id || (donor && donor.id), donor_name: t.donor_name || (donor && donor.name) });
  }, [donor]);
  const finishUi = finish ? <FinishSheet t={finish} today={orgTodayPlus(0)} onClose={() => setFinish(null)} onDone={async row => {
    const t = finish;
    setFinish(null);
    offerUndo({ message: finishedWords(t, row),
      undoAction: async () => apiFetch(`/tasks/${encodeURIComponent(t.id)}/complete`, { method: "POST", body: JSON.stringify({ done: false }) }) }, t.title);
  }} /> : null;
  return { onTaskOutcome, finishUi };
}
