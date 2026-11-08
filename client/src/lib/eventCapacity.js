// STALE-2 (W-1107-Volunteers-23) · ADDING PAST AN EVENT'S CAPACITY ASKS FIRST.
// The server answers 409 { error: "over_capacity", message: "This puts the
// event at 3 of 2." } (server/events/capacity.js). The person sees that
// sentence and confirms, and the same add goes again with overCapacity: true.
// Every add-guest door on the event page (from the directory, a typed guest,
// a walk-in at the door) posts through here.
import { apiFetch } from "../api";
import { askConfirm } from "../components/ConfirmDialog";

// The add's answer, or null when the person said no.
export async function addGuests(eventId, body) {
  const post = b => apiFetch(`/events/${eventId}/attendees`, { method: "POST", body: JSON.stringify(b) });
  try { return await post(body); }
  catch (e) {
    if (!(e && e.status === 409 && e.error === "over_capacity")) throw e;
    const yes = await askConfirm({ title: "Over capacity", body: `${e.message} Add anyway?`, yes: "Add anyway" });
    if (!yes) return null;
    return post({ ...body, overCapacity: true });
  }
}
