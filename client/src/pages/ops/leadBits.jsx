// LEAD-IMPORT-1 · the small pure pieces the Machine tab, This morning and the
// import preview share. No fetching here: OpsView renders in a test under Node.
const INK = "#0F1A12", CREAM = "#F0EDE6", BRASS = "#C9A84C";

// A report's day (YYYY-MM-DD) in words: "Sat, Nov 7".
export const dayWords = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function TierPill({ tier }) {
  if (!tier) return null;
  return <span title={`Tier ${tier}`} style={{ display: "inline-block", padding: "0 7px", borderRadius: 9, fontSize: 11, fontWeight: 700, marginRight: 6,
    background: tier <= 2 ? BRASS : CREAM, color: INK }}>T{tier}</span>;
}

