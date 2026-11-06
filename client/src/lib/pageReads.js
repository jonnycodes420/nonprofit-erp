// PERF-4 · A PAGE'S FIRST READS LEAVE WITH THE BOOT'S.
//
// Home's first reads leave as the page loads (lib/bootReads.js startHomeReads);
// every other page asked for its own only once its code had downloaded and the
// page had mounted: on the walk's org, 1.4 to 2 s after the boot's bundles had
// answered. main.jsx now asks for the page's first reads at the boot, in one
// bundle (GET /home/bundle, routes/homeBundle.js HOME_READS holds each path),
// parked for the page (api.js prefetch keep): when the page mounts, each
// apiFetch below is handed its answer as it always was, or asks on its own when
// the bundle could not answer it. The paths are the pages' own, exactly as
// they ask. A read that depends on another's answer (the Donors list on its
// columns, a report's second year) still asks when it can. Nothing here asks a
// third party: Settings' /stripe/status asks Stripe, so it is left to the page.
// JSX-free so a Node suite can read the lists.
import { prefetch } from "../api";
import { openProfileReads } from "./profileReads";

const DONORS = ["/privacy", "/me", "/donors/counts", "/donors/list-setup", "/org/team", "/portfolio/officers",
  "/custom-fields?entity=donor", "/donors/custom-field-values/all"];
export const PAGE_READS = [
  [/^\/donors\/?$/, () => DONORS],
  [/^\/donors\/[^/]+$/, () => DONORS],
  [/^\/app\/fundraising\/?$/, () => ["/atlas/notes?place=gifts", "/fundraising/overview", "/fundraising/campaigns", "/giving-pages"]],
  [/^\/app\/reports\/?$/, search => (new URLSearchParams(search).get("report") === "giving-summary"
    ? ["/ask/suggestions", "/meetings/by-staff", "/saved-reports", "/dashboards", "/saved-dashboards", "/finance/funds",
       "/reports/top-donors?scope=lifetime&limit=1", "/campaigns", "/reports/giving-summary?yearMode=fiscal"]
    : null)],
  [/^\/app\/journeys\/?$/, () => ["/atlas/notes?place=journey", "/journeys", "/auto-send/settings"]],
  [/^\/app\/settings\/?$/, search => (new URLSearchParams(search).get("sub") ? null
    : ["/people?role=staff_board", "/custom-fields/kept-raw", "/org/sending-domain", "/org/voice-samples", "/org/team",
       "/impact", "/custom-fields?entity=donor&includeArchived=1", "/custom-fields?entity=gift&includeArchived=1",
       "/impact-metrics", "/org/ai-status"])],
];

export function pageReadsFor(pathname, search = "") {
  const hit = PAGE_READS.find(([re]) => re.test(pathname));
  return (hit && hit[1](search)) || null;
}

export function startPageReads(pathname, search = "") {
  const paths = pageReadsFor(pathname, search);
  if (paths) prefetch(paths, { keep: true }).catch(() => {});
  // A profile's own two bundles (LOAD-1), the same call Donors makes when it opens.
  const prof = /^\/donors\/([^/]+)$/.exec(pathname);
  if (prof) openProfileReads(decodeURIComponent(prof[1]));
}
