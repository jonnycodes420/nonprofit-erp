// ONBOARD-3 · HOME → THE DAY-30 READOUT. From day 30 after "Looks right":
// what was done since (calls, notes, thank-yous) and who on the day-one list
// gave again since, with the amount, each name opening their profile. If
// nobody has, what was done and the next three to call. Every figure opens its
// rows. It never emails anyone. The voice rule: "gave again since you started".
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { Figure } from "../Figure";

const SERIF = "'DM Serif Display',Georgia,serif";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const withDays = s => String(s || "").replace(/(\d{4}-\d{2}-\d{2})/g, (_, d) => dayWords(d));
const usd = c => { const n = Number(c || 0); return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };

export function Readout({ r, onPerson, compact = false }) {
  const link = p => <button type="button" onClick={() => onPerson && onPerson(p.id)}
    style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: T.ink, textAlign: "left" }}>{p.name}</button>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div data-testid="readout-headline" style={{ fontSize: compact ? 14 : 16, fontWeight: 700, color: T.ink }}>{r.headline}</div>
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: T.ink2 }}>
      <span><Figure variant="inline" kind="count" value={r.calls} label="Calls since you started" definition="Every call a person at your organization logged since you said your totals looked right." source={r.sources.calls} why={false} /> {r.calls === 1 ? "call" : "calls"}</span>
      <span><Figure variant="inline" kind="count" value={r.notes} label="Notes and touches since you started" definition="Every note or touch other than a call logged since you said your totals looked right." source={r.sources.notes} why={false} /> {r.notes === 1 ? "note or touch" : "notes and touches"}</span>
      <span><Figure variant="inline" kind="count" value={r.thanks} label="Thank-yous since you started" definition="Every gift marked acknowledged since you said your totals looked right." source={r.sources.thanks} why={false} /> {r.thanks === 1 ? "thank-you" : "thank-yous"} marked sent</span>
      {r.people.length ? <span><Figure variant="inline" kind="money" value={r.totalCents / 100} label="Gave again since you started" definition={r.sentences.gave} source={r.sources.gave} why={false} /> given again</span> : null}
    </div>
    {r.people.length ? <ul data-testid="readout-people" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {r.people.map(p => <li key={p.id} style={{ padding: "6px 0", borderTop: "1px solid " + T.bg2, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        {link(p)}<span style={{ fontSize: 13, color: T.ink2 }}>gave again since you started: {usd(p.cents)}{p.gifts > 1 ? ` in ${p.gifts} gifts` : ""}, last on {dayWords(p.last)}</span>
      </li>)}
    </ul> : <>
      <div style={{ fontSize: 13, color: T.ink2 }}>{withDays(r.did)}</div>
      {r.next.length ? <div data-testid="readout-next">
        <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, margin: "4px 0 2px" }}>Who to call next</div>
        {r.next.map(p => <div key={p.id} style={{ padding: "4px 0" }}>{link(p)}{p.why ? <span style={{ fontSize: 13, color: T.ink2 }}>. {p.why}</span> : null}</div>)}
      </div> : null}
    </>}
    {r.people.length ? <div style={{ fontSize: 12.5, color: T.ink3 }}>{withDays(r.did)}</div> : null}
    <div style={{ fontSize: 12, color: T.ink3 }}>{withDays(r.sentences.list)}</div>
  </div>;
}

export default function DayThirty({ onNavigate }) {
  const [r, setR] = useState(null);
  const [gone, setGone] = useState(false);
  useEffect(() => { apiFetch("/onboard/readout").then(setR).catch(() => setR({ ready: false })); }, []);
  if (!r || !r.ready || gone) return null;
  return <section data-testid="home-day-thirty" aria-label="Your first month" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 20px" }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
      <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 24, fontWeight: 400, color: T.ink, flex: 1 }}>Your first {r.days} days</h2>
      <button type="button" data-testid="readout-dismiss" onClick={() => { apiFetch("/onboard/readout/dismiss", { method: "POST", body: "{}" }).catch(() => {}); setGone(true); }}
        style={{ background: "none", border: 0, color: T.ink3, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Done reading</button>
    </div>
    <Readout r={r} onPerson={id => onNavigate && onNavigate("donors", { selectDonorId: id })} />
  </section>;
}
