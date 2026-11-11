// DEVBOARD-3 · the top of /admin leads to Ops, the Map and the Journey.
// /admin is behind RequireSuperAdmin (main.jsx), and so is /ops; the API
// behind each tab answers 404 to anyone who is not a live super-admin.
import { Link } from "react-router-dom";

const INK = "#0F1A12", WHITE = "#FFFFFF", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
export const OPS_LINKS = [
  { to: "/ops", label: "Ops", says: "health, builds and the board" },
  { to: "/ops?tab=sales", label: "Sales", says: "organizations, contacts and deals, from a lead to paying" },   // SALES-1
  { to: "/ops?tab=onboarding", label: "Onboarding", says: "each deal from a yes to billing" },   // ONBOARD-2
  { to: "/ops?tab=map", label: "Map", says: "every area and its checks" },
  { to: "/ops?tab=journey", label: "Journey", says: "where each customer is" },
];

export default function AdminOpsNav() {
  return <nav aria-label="Ops" data-admin-ops-nav="1"
    style={{ background: INK, color: WHITE, padding: "8px 20px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: BRASS, marginRight: 8 }}>The machine</span>
    {OPS_LINKS.map(l => <Link key={l.to} to={l.to} data-ops-link={l.label} title={l.says}
      style={{ color: WHITE, textDecoration: "none", fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${WHITE}2e`,
        background: `${EMERALD}`, minHeight: 32, boxSizing: "border-box", display: "inline-flex", alignItems: "center" }}>{l.label} →</Link>)}
  </nav>;
}
