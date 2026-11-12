// STALE-2 (W-1107-Volunteers-23) · ADDING PAST AN EVENT'S CAPACITY ASKS FIRST.
// The server answers 409 { error: "over_capacity", message: "This puts the
// event at 3 of 2." } (server/events/capacity.js). The person sees that
// sentence and confirms, and the same add goes again with overCapacity: true.
// Every add-guest door on the event page (from the directory, a typed guest,
// a walk-in at the door) posts through here.
import { apiFetch } from "../api";
import { askConfirm } from "../components/ConfirmDialog";
import { pickPeople } from "./people";

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

// FLOWS-8 (W-1112-Volunteers-20): a new guest named exactly like someone already
// on file is asked about first. True: add a new person. False: she chose to find
// them in the directory, so they stay one person.
export async function newGuestOrOnFile(name) {
  // Case and accents aside, as the person search reads names ("Zoe Angstrom" is "Zoë Ångström").
  const fold = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const want = fold(name);
  const same = want ? (await pickPeople({ q: name.trim(), match: "person", limit: 20 }).catch(() => [])).filter(p => fold(p.name) === want) : [];
  if (!same.length) return true;
  return askConfirm({ title: `${same[0].name} is already on file`,
    body: `${same.length > 1 ? "More than one person" : "Someone"} called ${same[0].name} is already in your records. Add them from the directory so they stay one person, or add a new person with the same name.`,
    yes: "Add a new person", no: "Find them in the directory" });
}
