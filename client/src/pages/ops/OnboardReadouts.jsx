// ONBOARD-3 · /ops → Onboarding → "Day 30". Each org's day-30 readout, the one
// its Home shows from day 30 (GET /ops/onboarding/readouts, dayOne.js): what
// was done since data in and who on the day-one list gave again since. Steward
// never emails it; Jonathan reads it here and asks for the testimonial himself.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6";
const card = { background: WHITE, borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: `1px solid ${INK}14` };
const says = { fontSize: 13, opacity: 0.72, margin: "0 0 10px" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const withDays = s => String(s || "").replace(/(\d{4}-\d{2}-\d{2})/g, (_, d) => day(d));
const usd = c => { const n = Number(c || 0); return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };

export default function OnboardReadouts() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { apiFetch("/ops/onboarding/readouts").then(setD).catch(e => setErr((e && e.message) || "The readouts could not be read.")); }, []);
  return <section style={card} data-testid="ops-onboard-readouts">
    <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Day 30</h2>
    <p style={says}>{d ? d.sentence : err || "Reading…"}</p>
    {d && !d.readouts.length ? <p style={says}>No org has said its totals look right yet, so there is no day-one list to read back.</p> : null}
    {d && d.readouts.map(r => <div key={r.orgId} data-onb-readout={r.orgId} style={{ borderTop: `1px solid ${CREAM}`, padding: "10px 0", fontSize: 13.5 }}>
      <div style={{ fontWeight: 700 }}>{r.name} <span style={{ fontWeight: 400, opacity: 0.7 }}>· day {r.days} since data in{r.due ? "" : " (Home shows it from day 30)"}</span></div>
      <div style={{ marginTop: 2 }}>{r.headline}</div>
      {r.people.length ? <div style={{ marginTop: 2 }}>{r.people.map(p => `${p.name} (${usd(p.cents)})`).join(", ")}</div> : null}
      <div style={{ marginTop: 2, opacity: 0.75 }}>{withDays(r.did)}</div>
      {!r.people.length && r.next.length ? <div style={{ marginTop: 2, opacity: 0.75 }}>Next to call: {r.next.map(p => p.name).join(", ")}</div> : null}
    </div>)}
  </section>;
}
