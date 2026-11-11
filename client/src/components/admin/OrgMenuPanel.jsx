// client/src/components/admin/OrgMenuPanel.jsx · NAV-1 (menu, 10 Nov).
// SUPER-ADMIN → ORGANIZATIONS: ONE ORG'S MENU AND MAJOR GIFTS TABS.
//
// The same editor an admin has in Settings (settings/OrgMenuEditor.jsx),
// pointed at any org through /admin/orgs/:id/menu. The change lands in that
// org's audit log as Steward support. This is how Justin's Place gets Major
// Gifts as Top 100 alone: a setting Jonathan sets, never an org id in the code.
import { OrgMenuCard, MajorGiftsTabsCard } from "../settings/OrgMenuEditor";

export default function OrgMenuPanel({ orgId, adminFetch, PSH }) {
  const load = () => adminFetch(`/admin/orgs/${orgId}/menu`);
  const save = body => adminFetch(`/admin/orgs/${orgId}/menu`, { method: "POST", body: JSON.stringify(body) });
  return (
    <div data-testid="admin-org-menu">
      <div style={PSH}>Menu and Major Gifts</div>
      <MajorGiftsTabsCard key={orgId + "-mg"} load={load} save={save} />
      <OrgMenuCard key={orgId + "-menu"} load={load} save={save} who="Everyone in this organization" />
    </div>
  );
}
