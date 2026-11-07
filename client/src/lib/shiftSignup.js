// STALE-2 (W-1107-Volunteers-09X) · A SIGN-UP THAT CLASHES ASKS FIRST.
// The server answers 409 { error: "overlap", message: "Tomas Reyes is
// already on Kitchen, Sat, Nov 8, 9am to 12pm, which overlaps this shift." }
// (server/volunteers/shiftRules.js). The person reads the clash by name and
// confirms, and the same sign-up goes again with overlapOk: true. Every staff
// door that places somebody on a shift (the shift drawer, roster mode, the
// list's Add to a shift) posts through here.
import { apiFetch } from "../api";
import { askConfirm } from "../components/ConfirmDialog";

// The sign-up's answer, or null when the person said no.
export async function signUpForShift(body) {
  const post = b => apiFetch("/volunteer-hub/signups", { method: "POST", body: JSON.stringify(b) });
  try { return await post(body); }
  catch (e) {
    if (!(e && e.status === 409 && e.error === "overlap")) throw e;
    const yes = await askConfirm({ title: "This overlaps another shift", body: `${e.message} Put them on both?`, yes: "Put them on both" });
    if (!yes) return null;
    return post({ ...body, overlapOk: true });
  }
}
