// DEVBOARD-3 · /ops, the Journey tab: how a customer gets onboarded, step by step.
// Pure: it draws the answer of GET /ops/journey and fetches nothing itself, so
// the test renders it. The path is the ten real steps; each opens what the
// customer sees, what Steward does behind it, how the step is detected, Open
// in demo and its Map checks. Under it, one row per live customer: the step
// they are on, when they reached each, and how long they have sat (brass past
// a week). Counts and timestamps only: no donor's name or amount.
import { useState } from "react";
import { countLabel, countWords, plural, spell } from "../../../../shared/countWords.js";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const SERIF = "'DM Serif Display', Georgia, serif";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Nov 5": an instant, read in this browser's day; a step reached on an unknown day says so.
const onDay = at => { if (!at) return null; const d = new Date(at); return Number.isNaN(d.getTime()) ? null : `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const pill = tone => ({ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
  background: tone === "good" ? EMERALD : tone === "warn" ? BRASS : CREAM, color: tone === "good" ? WHITE : INK });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const verdictTone = v => (/^pass$/i.test(v || "") ? "good" : /^fail$/i.test(v || "") ? "warn" : null);

const CSS = `
.db3j-path { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); position: relative; }
.db3j-path::before { content: ""; position: absolute; left: 5%; right: 5%; top: 23px; height: 2px; background: ${INK}14; }
.db3j-step { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 0 4px; }
.db3j-step button { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; color: inherit; display: flex; flex-direction: column; align-items: center; gap: 8px; border-radius: 12px; }
.db3j-step button:focus-visible { outline: 2px solid ${EMERALD}; outline-offset: 4px; }
.db3j-ring { width: 48px; height: 48px; position: relative; }
.db3j-ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.db3j-ring .arc { transition: stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1); }
.db3j-num { position: absolute; inset: 6px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;
  background: ${WHITE}; color: ${INK}; transition: background 200ms, color 200ms; animation: db3j-in 520ms both; }
.db3j-step[aria-current="step"] .db3j-num { background: ${EMERALD}; color: ${WHITE}; }
.db3j-step:hover .db3j-num { box-shadow: 0 0 0 4px ${EMERALD}1f; }
.db3j-title { font-size: 13px; font-weight: 600; line-height: 1.25; }
.db3j-count { font-size: 12px; opacity: .68; }
@keyframes db3j-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes db3j-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.db3j-card { background: ${WHITE}; border-radius: 16px; padding: 24px 26px; border: 1px solid ${INK}0f; animation: db3j-rise 360ms both; }
.db3j-two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.db3j-table { width: 100%; border-collapse: collapse; }
.db3j-table th { text-align: left; font-size: 12px; font-weight: 600; opacity: .62; padding: 0 12px 10px 0; }
.db3j-table td { padding: 14px 12px 14px 0; border-top: 1px solid ${CREAM}; vertical-align: middle; font-size: 14px; }
.db3j-row { cursor: pointer; animation: db3j-rise 420ms both; }
.db3j-row:hover td { background: ${CREAM}66; }
.db3j-dots { display: flex; gap: 5px; }
.db3j-dot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid ${EMERALD}; animation: db3j-in 380ms both; }
.db3j-dot.on { background: ${EMERALD}; }
.db3j-dot.cur { border-color: ${INK}; border-style: dashed; }
.db3j-dot.cur.stuck { border-color: ${BRASS}; background: ${BRASS}55; border-style: solid; }
.db3j-when { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px 18px; padding: 4px 0 8px; font-size: 13px; }
@media (max-width: 860px) {
  .db3j-path { grid-template-columns: 1fr; gap: 6px; }
  .db3j-path::before { left: 23px; right: auto; top: 24px; bottom: 24px; width: 2px; height: auto; }
  .db3j-step { flex-direction: row; text-align: left; padding: 0; }
  .db3j-step button { flex-direction: row; gap: 14px; width: 100%; padding: 2px 0; text-align: left; }
  .db3j-two { grid-template-columns: 1fr; gap: 14px; }
  .db3j-card { padding: 18px 16px; }
  .db3j-table thead { display: none; }
  .db3j-table, .db3j-table tbody, .db3j-table tr, .db3j-table td { display: block; width: 100%; box-sizing: border-box; }
  .db3j-table tr.db3j-row { border-top: 1px solid ${CREAM}; padding: 12px 0; }
  .db3j-table td { border: 0; padding: 3px 0; }
  .db3j-when { grid-template-columns: 1fr 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .db3j-num, .db3j-card, .db3j-row, .db3j-dot { animation: none !important; }
  .db3j-ring .arc, .db3j-num { transition: none !important; }
}`;

function Ring({ share, delay }) {
  const r = 22, c = 2 * Math.PI * r;
  return <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r={r} fill="none" stroke={`${INK}14`} strokeWidth="3" />
    <circle className="arc" cx="24" cy="24" r={r} fill="none" stroke={EMERALD} strokeWidth="3" strokeLinecap="round"
      strokeDasharray={c} strokeDashoffset={c * (1 - share)} style={{ transitionDelay: `${delay}ms` }} />
  </svg>;
}

function StepDetail({ step, reached, total }) {
  return <section className="db3j-card" key={step.id} data-step-detail={step.id} aria-live="polite">
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: EMERALD }}>Step {step.n} of 10</span>
      <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0, letterSpacing: "-0.01em" }}>{step.title}</h3>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 13, opacity: 0.72 }}>{total ? `${reached} of ${countLabel(total, "customer")} reached it` : "No live customers yet"}</span>
    </div>
    <div className="db3j-two">
      <div>
        <h4 style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, margin: "0 0 6px" }}>What the customer sees</h4>
        <p style={{ margin: "0 0 16px", lineHeight: 1.55 }}>{step.sees}</p>
        <h4 style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, margin: "0 0 6px" }}>What Steward does behind it</h4>
        <p style={{ margin: "0 0 16px", lineHeight: 1.55 }}>{step.behind}</p>
        <h4 style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, margin: "0 0 6px" }}>How this page knows</h4>
        <p style={{ margin: 0, lineHeight: 1.55, opacity: 0.85 }}>{step.detect}</p>
      </div>
      <div>
        {step.demo
          ? <a href={step.demo} target="_blank" rel="noopener noreferrer" data-demo-link="1"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: EMERALD, color: WHITE, textDecoration: "none", fontWeight: 600, fontSize: 14, padding: "10px 16px", borderRadius: 10, minHeight: 40, boxSizing: "border-box" }}>
              Open in demo ↗</a>
          : <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>Sign-up happens before there is an org, so the demo has no screen for it.</p>}
        <h4 style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, margin: "20px 0 8px" }}>Map checks for this step</h4>
        {step.checks.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {step.checks.map(c => <li key={c.id} data-check={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
            <span style={{ ...pill(verdictTone(c.walk && c.walk.verdict)), minWidth: 56, textAlign: "center" }}>
              {c.walk ? `${c.walk.verdict.toLowerCase()}` : "not walked"}</span>
            <span><strong>{c.id}</strong> {c.says || "This check is no longer on the map."}
              {c.mark ? <span style={{ opacity: 0.7 }}> · you marked it {c.mark.verdict} on {onDay(c.mark.at)}</span> : null}
              {c.open ? <span style={{ ...pill("warn"), marginLeft: 6 }}>open item</span> : null}</span>
          </li>)}
        </ul> : <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>No Map check covers this step yet.</p>}
      </div>
    </div>
  </section>;
}

function OrgRow({ o, steps, i, open, onToggle, stuckAfter }) {
  const cur = steps.find(s => s.id === o.current);
  const reachedOn = Object.fromEntries(o.steps.map(s => [s.id, s]));
  return <>
    <tr className="db3j-row" style={{ animationDelay: `${120 + i * 50}ms` }} onClick={onToggle} data-org-row={o.name}
      aria-expanded={open} tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
      <td style={{ fontWeight: 600 }}>{o.name}</td>
      <td><div className="db3j-dots" aria-label={`${o.reachedCount} of 10 steps reached`}>
        {o.steps.map((s, k) => <span key={s.id} title={`${steps[k].title}: ${s.reached ? (onDay(s.at) || "reached") : "not yet"}`}
          className={`db3j-dot${s.reached ? " on" : ""}${s.id === o.current ? " cur" : ""}${s.id === o.current && o.stuck ? " stuck" : ""}`}
          style={{ animationDelay: `${160 + i * 50 + k * 35}ms` }} />)}
      </div></td>
      <td data-on-step={o.current}>{cur ? <span><span style={{ opacity: 0.6 }}>{cur.n}.</span> {cur.title}</span> : <span style={pill("good")}>All ten done</span>}</td>
      <td data-stuck={o.stuck ? "1" : "0"}>{cur && o.stuckDays != null
        ? <span style={pill(o.stuck ? "warn" : null)} title={o.stuck ? `More than ${countWords(stuckAfter, "day")} on this step` : undefined}>
            {o.stuckDays === 0 ? "since today" : `${o.stuckDays.toLocaleString("en-US")} ${plural(o.stuckDays, "day")} here`}</span>
        : null}</td>
    </tr>
    {open ? <tr><td colSpan={4} style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="db3j-when" data-org-steps={o.name}>
        {steps.map(s => { const r = reachedOn[s.id] || {};
          return <div key={s.id} style={{ opacity: r.reached ? 1 : 0.5 }}>
            <div style={{ fontSize: 12, opacity: 0.65 }}>{s.n}. {s.title}</div>
            <div style={{ fontWeight: 600 }}>{r.reached ? (onDay(r.at) || "Reached, day unknown") : "Not yet"}</div>
          </div>; })}
      </div>
    </td></tr> : null}
  </>;
}

export default function JourneyView({ data, error, initialStep = null }) {
  const [sel, setSel] = useState(initialStep);
  const [openOrg, setOpenOrg] = useState(null);
  if (error) return <p style={{ fontSize: 14 }}>{error}</p>;
  if (!data) return <p style={{ fontSize: 14, opacity: 0.7 }}>Reading the journey…</p>;
  const steps = data.steps || [];
  const rows = (data.orgs && data.orgs.ok && data.orgs.rows) || [];
  const total = rows.length;
  const reachedBy = id => rows.filter(o => (o.steps.find(s => s.id === id) || {}).reached).length;
  const onStep = id => rows.filter(o => o.current === id).length;
  const stuck = rows.filter(o => o.stuck).length;
  // Open on the step where most customers are waiting, else the first.
  const busiest = steps.reduce((best, s) => (onStep(s.id) > (best ? onStep(best.id) : 0) ? s : best), null);
  const active = steps.find(s => s.id === sel) || busiest || steps[0];

  return <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
    <style>{CSS}</style>
    <header>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: "0 0 6px", letterSpacing: "-0.01em" }}>How a customer gets going</h2>
      <p style={{ margin: 0, fontSize: 15, opacity: 0.78, maxWidth: 680, lineHeight: 1.5 }}>
        Ten steps from sign-up to a first active week.{" "}
        {total ? <>{cap(countWords(total, "live customer"))}, and {stuck ? <strong>{spell(stuck)} {plural(stuck, "has", "have")} sat on one step for more than a week.</strong> : "none has sat on one step for more than a week."}</>
          : "No live customers yet: when one signs up, their row appears below."}
      </p>
    </header>

    <nav aria-label="Onboarding steps">
      <ol className="db3j-path">
        {steps.map((s, i) => {
          const n = reachedBy(s.id), share = total ? n / total : 0;
          return <li key={s.id} className="db3j-step" aria-current={active && active.id === s.id ? "step" : undefined} data-step={s.id}>
            <button type="button" onClick={() => setSel(s.id)} aria-label={`Step ${s.n}: ${s.title}`}>
              <span className="db3j-ring"><Ring share={share} delay={i * 80} /><span className="db3j-num" style={{ animationDelay: `${i * 60}ms` }}>{s.n}</span></span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="db3j-title">{s.title}</span>
                <span className="db3j-count">{total ? `${n} of ${total}` : " "}{onStep(s.id) ? ` · ${onStep(s.id)} here` : ""}</span>
              </span>
            </button>
          </li>;
        })}
      </ol>
    </nav>

    {active ? <StepDetail step={active} reached={reachedBy(active.id)} total={total} /> : null}

    <section className="db3j-card" style={{ animationDelay: "80ms" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 22, margin: 0 }}>Live customers</h3>
        <span style={{ fontSize: 13, opacity: 0.7 }}>Customer orgs that are not archived. Click a row for the day each step was reached. A step held more than {countWords(data.stuckDays || 7, "day")} is brass.</span>
      </div>
      {data.orgs && !data.orgs.ok ? <p style={{ fontSize: 14 }}>{data.orgs.error}</p>
        : !rows.length ? <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>No live customer orgs yet.</p>
        : <table className="db3j-table">
          <thead><tr><th>Customer</th><th>Steps</th><th>On step</th><th>For</th></tr></thead>
          <tbody>{rows.map((o, i) => <OrgRow key={o.name + i} o={o} i={i} steps={steps} stuckAfter={data.stuckDays || 7}
            open={openOrg === o.name} onToggle={() => setOpenOrg(openOrg === o.name ? null : o.name)} />)}</tbody>
        </table>}
    </section>
  </div>;
}
