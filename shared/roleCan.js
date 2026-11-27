// shared/roleCan.js · POLISH-14 item 5. WHAT EACH ROLE CAN DO, the table on Settings → Team.
// Its own file so Home's bundle never carries it (perf-app's first-look budget).
// Each cell is what the server's gates allow (auth.js, the routes' requireAdmin), so
// the table says what happens. A viewer's export reads the org's switch.
export const ROLE_ACTIONS = ["View", "Edit", "Trash", "Bulk edit", "Export", "Send"];
export const ROLE_CAN = {
  admin: { View: "Everything, settings too", Edit: "Yes", Trash: "Yes", "Bulk edit": "Yes, assign and delete too", Export: "Yes", Send: "Yes, appeals too" },
  staff: { View: "Every page but billing", Edit: "Yes", Trash: "No", "Bulk edit": "Stage and tags", Export: "Yes", Send: "One email at a time, not appeals" },
  viewer: { View: "Every page but Team, billing and connections", Edit: "No", Trash: "No", "Bulk edit": "No", Export: null, Send: "No" },
  volunteer_coordinator: { View: "Volunteers and hours only", Edit: "Volunteers and hours only", Trash: "No", "Bulk edit": "No", Export: "No", Send: "No" },
};
// A viewer's Export cell: the org's switch (on, off, or not known to a non-admin).
export function viewerExportWord(on) {
  return on === true ? "Yes (Viewers can export is on)" : on === false ? "No (Viewers can export is off)" : "Only if an admin turns on Viewers can export";
}

