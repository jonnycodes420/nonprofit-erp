// LOAD-1 · A PROFILE OPENS IN TWO REQUESTS.
//
// Opening one person fired 37 reads at once (every panel's own apiFetch on
// mount). Each was quick; together they queued for the server's connections,
// and under load a profile took 2 to 4 s. Now the profile asks for them in two
// requests (GET /donors/:id/bundle, routes/homeBundle.js): first what shows
// above the fold (the header, status, scores, the rail, the relationship and
// thank-you, the next step), then everything below it once the first has
// answered. Each panel's own apiFetch(path) is handed the bundle's answer
// (api.js prefetch), so no panel changed, and every figure is the route's own.
// A path here must be one the server's PROFILE_READS allows, spelled exactly
// as the panel asks for it.
import { prefetch } from "../api";

const enc = encodeURIComponent;
export const PROFILE_TOP = id => [
  `/donors/${id}`, `/donors/${id}/status`, `/donors/${id}/scores`, `/donors/${id}/rail`, `/donors/${id}/relationship`,
  `/threads?donorId=${id}`, `/insights/donor/${enc(id)}`, `/donors/${enc(id)}/before-meeting`, `/donors/${id}/blocked-mail`,
  `/people/${id}`, `/atlas/notes?place=person&id=${enc(id)}`, `/donors/${id}/plan`, `/donors/${id}/journeys`,
];
export const PROFILE_BELOW = id => [
  `/donors/${id}/journey-suggestion`, `/donors/${id}/groups`, `/donors/${id}/proposals`, `/donors/${id}/relationships`,
  `/donors/${id}/custom-fields`, `/donors/${id}/events`, `/donors/${id}/attachments`, `/donors/${id}/tasks`,
  `/donors/${id}/volunteer-hours`, `/donors/${id}/recurring-subscription`, `/donors/${id}/soft-credit`, `/donors/${id}/moves`,
  `/donors/${id}/opportunities`, `/donors/${id}/move-suggestions`, `/donors/${id}/designations`, `/donors/${id}/receipts`,
  `/donors/${id}/planned-gifts`, `/donors/${id}/pledges`,
  "/mailbox", "/sequences", "/org", "/journeys", "/fundraising/campaigns", "/custom-fields?entity=gift",
];
const bundleFor = id => paths => `/donors/${enc(id)}/bundle?` + paths.map(p => "p=" + enc(p)).join("&");

// Called while the profile renders, before any panel's effect runs (a child's
// effect runs before its parent's), so every panel finds its read in flight.
export function openProfileReads(id) {
  if (!id) return;
  const top = prefetch(PROFILE_TOP(id), { keep: true, bundle: bundleFor(id) });
  prefetch(PROFILE_BELOW(id), { keep: true, bundle: bundleFor(id), after: top });
}
