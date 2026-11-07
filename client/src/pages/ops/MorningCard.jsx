// LEAD-IMPORT-1 · "This morning", at the top of /ops: the latest imported
// report's date, its fails by tier, its top five in the lead's order (tier,
// repeats above new fails) with each one's state now, and how many items were
// verified on that day or the day before.
import { countLabel } from "../../../../shared/countWords.js";
import { TierPill, dayWords as day } from "./leadBits";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", BRASS = "#C9A84C";

export default function MorningCard({ m }) {
  const card = { background: INK, color: WHITE, borderRadius: 10, padding: "18px 20px", marginBottom: 18 };
  if (!m) return <section style={card} data-testid="ops-morning">
    <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>This morning</h2>
    <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>No report imported yet. Import the lead's summary below, under Import a walk report.</p>
  </section>;
  return <section style={card} data-testid="ops-morning">
    <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>This morning · {day(m.date)}</h2>
    <p style={{ fontSize: 13, opacity: 0.8, margin: "0 0 12px" }}>
      {m.shape === "lead" ? "The QA fleet lead's summary" : "Muse's walk"} ({m.file}): {countLabel(m.fails, "fail")}.
      {" "}Verified since yesterday: <b data-testid="ops-morning-verified">{m.verifiedSinceYesterday}</b>, the items whose check passed on {day(m.yesterday)} or {day(m.date)}.</p>
    {m.shape === "lead" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {Object.entries(m.tiers).map(([t, n]) => <div key={t} data-tier={t} style={{ background: n && Number(t) <= 2 ? BRASS : CREAM, color: INK, borderRadius: 8, padding: "6px 10px", minWidth: 120 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{n}</div>
        <div style={{ fontSize: 11 }}>Tier {t} · {m.tierNames[t]}</div></div>)}
    </div>}
    {m.top.length > 0 && <ol style={{ margin: 0, paddingLeft: 20 }}>
      {m.top.map(i => <li key={i.id || i.check} style={{ fontSize: 13, margin: "4px 0" }}>
        <TierPill tier={i.tier} /><span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{i.id || i.check}</span>
        {" "}{i.words}<span style={{ opacity: 0.75 }}>{i.seen ? ` · ${i.seen.toLowerCase()}` : ""} · {i.state}</span>
        {i.evidence ? <span style={{ opacity: 0.75 }}> · evidence {i.evidence}</span> : null}</li>)}
    </ol>}
    {m.top.length === 0 && <p style={{ fontSize: 13, margin: 0, color: CREAM }}>No fails in that report.</p>}
  </section>;
}
