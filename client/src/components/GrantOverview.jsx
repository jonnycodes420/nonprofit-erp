// GRANTS-1 — GRANTS → REPORTS. Every number on it opens.
//
// One read, GET /grant-overview, and every number it sends was computed by a
// figure source (figureSources.js) and comes with that source and its one
// defining sentence. This screen only draws them: each is a <Figure>, so a
// click opens the rows behind it, footing to the cent. Nothing here sums,
// divides or counts.
//
//   · the pipeline by stage, all eight present (an empty stage reads $0)
//   · awarded this fiscal year, against the grant goal (an admin sets it here,
//     with Undo)
//   · the win rate by funder type: awarded against decided
//   · deadlines in the next 30, 60 and 90 days, and the reports owed
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import Figure from "./Figure";

const card = { background: T.bgCard, border: "1px solid " + T.bg2, borderRadius: 12, padding: "16px 18px" };
const h2 = { fontSize: 15, fontWeight: 700, color: T.ink, margin: "0 0 4px" };
const note = { fontSize: 13, color: T.ink3, lineHeight: 1.5, margin: 0 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 };
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box", width: 140 };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36 };
const putGoal = goalCents => apiFetch("/org/grant-goal", { method: "PUT", body: JSON.stringify({ goalCents }) });
// "12,500" or "$12,500.50" → cents; anything else is null (refused, never guessed).
const dollarsToCents = s => {
  const t = String(s || "").replace(/[$,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
};

function GoalEditor({ goal, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async clear => {
    const cents = clear ? null : dollarsToCents(text);
    if (!clear && cents === null) { setMsg("Write the goal in dollars, for example 250,000."); return; }
    setBusy(true); setMsg("");
    try {
      const r = await putGoal(cents);
      setEditing(false);
      onSaved();
      offerUndo({ message: r.sentence, undoAction: () => putGoal(r.previousGoalCents) }, "grant goal", onSaved);
    } catch (e) { setMsg(errorMessage(e, "The goal could not be saved.")); }
    setBusy(false);
  };
  if (!editing) {
    return (
      <button type="button" style={quietBtn} data-testid="grant-goal-edit"
        onClick={() => { setText(goal.set ? String(goal.value) : ""); setEditing(true); setMsg(""); }}>
        {goal.set ? "Change the goal" : "Set a goal"}
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: 13, color: T.ink }}>
        Goal in dollars{" "}
        <input style={inp} value={text} inputMode="decimal" autoFocus data-testid="grant-goal-input"
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(false); if (e.key === "Escape") setEditing(false); }} />
      </label>
      <button type="button" style={primaryBtn} disabled={busy} onClick={() => save(false)}>Save</button>
      {goal.set && <button type="button" style={quietBtn} disabled={busy} onClick={() => save(true)}>Clear the goal</button>}
      <button type="button" style={quietBtn} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      {msg && <span role="alert" style={{ fontSize: 12.5, color: T.ink3 }}>{msg}</span>}
    </div>
  );
}

export default function GrantOverview({ onOpenGrant }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/grant-overview")
    .then(d => { setData(d); setMsg(""); })
    .catch(e => setMsg(errorMessage(e, "The grant reports could not be loaded.")));
  useEffect(() => { load(); }, []);

  if (!data) return <div style={{ padding: 8 }}>{msg ? <p role="alert" style={note}>{msg}</p> : <p style={note}>Loading the grant reports…</p>}</div>;
  const { year, stages, awarded, goal, progress, winRates, deadlines, reportsDue } = data;

  return (
    <div data-testid="grant-overview" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {msg && <p role="alert" style={note}>{msg}</p>}

      <section style={card} aria-labelledby="go-pipeline">
        <h2 id="go-pipeline" style={h2}>The pipeline by stage</h2>
        <p style={{ ...note, marginBottom: 12 }}>Open stages count what was asked for; awarded stages count what the funder awarded. Each opens its grants.</p>
        <div style={grid}>
          {stages.map(s => (
            <Figure key={s.status} figureKey={`grant-stage-${s.status}`} kind="money" value={s.value} label={s.label}
              definition={s.sentence} source={s.source}
              sub={<><Figure variant="inline" kind="count" value={s.count} label={`Grants at ${s.label}`} definition={s.sentence} source={s.source} />{s.count === 1 ? " grant" : " grants"}</>} />
          ))}
        </div>
      </section>

      <section style={card} aria-labelledby="go-year">
        <h2 id="go-year" style={h2}>Awarded this year</h2>
        <p style={{ ...note, marginBottom: 12 }}>{year.sentence}</p>
        <div style={grid}>
          <Figure figureKey="grant-awarded-year" kind="money" value={awarded.value} label={`Awarded, ${year.label}`}
            definition={awarded.sentence} source={awarded.source}
            sub={<><Figure variant="inline" kind="count" value={awarded.count} label="Grants awarded this year" definition={awarded.sentence} source={awarded.source} />{awarded.count === 1 ? " grant" : " grants"}</>} />
          <Figure figureKey="grant-goal" kind="money" value={goal.set ? goal.value : null} label="Grant goal"
            definition={goal.sentence} source={goal.source} blank={goal.set ? null : "No goal is set yet."} />
          <Figure figureKey="grant-goal-progress" kind="percent" value={progress.value} label="Toward the goal"
            definition={progress.sentence} source={progress.source} blank={progress.blank}
            blankShort={progress.blank ? "No goal set yet." : null} />
        </div>
        {goal.canEdit && <div style={{ marginTop: 12 }}><GoalEditor goal={goal} onSaved={load} /></div>}
      </section>

      <section style={card} aria-labelledby="go-win">
        <h2 id="go-win" style={h2}>Win rate by funder type</h2>
        <p style={{ ...note, marginBottom: 8 }}>Awarded against decided. A grant still waiting is neither a win nor a loss, so it is not counted.</p>
        <div role="table" aria-label="Win rate by funder type">
          {winRates.map(w => (
            <div role="row" key={w.funderType} data-testid="grant-win-row"
              style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "10px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
              <span role="cell" style={{ flex: "1 1 180px", fontSize: 14, color: T.ink, fontWeight: 600 }}>{w.label}</span>
              <span role="cell" style={{ fontSize: 13, color: T.ink3 }}>
                <Figure variant="inline" kind="count" value={w.won.value} label={`Awarded, ${w.label}`} definition={w.won.sentence} source={w.won.source} />
                {" of "}
                <Figure variant="inline" kind="count" value={w.decided.value} label={`Decided, ${w.label}`} definition={w.decided.sentence} source={w.decided.source} />
                {" decided"}
              </span>
              <span role="cell" style={{ minWidth: 64, textAlign: "right", fontSize: 15, color: T.ink }}>
                <Figure variant="cell" kind="percent" value={w.value} label={`Win rate, ${w.label}`} definition={w.blank || w.sentence} source={w.source} blank={w.blank} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section style={card} aria-labelledby="go-due">
        <h2 id="go-due" style={h2}>What is due</h2>
        <p style={{ ...note, marginBottom: 12 }}>Open deadlines on every grant, and the reports still owed. A deadline already past and not done is still owed, so it is counted.</p>
        <div style={grid}>
          {deadlines.map(d => (
            <Figure key={d.days} figureKey={`grant-deadlines-${d.days}`} kind="count" value={d.count}
              label={`Deadlines, next ${d.days} days`} definition={d.sentence} source={d.source} />
          ))}
          <Figure figureKey="grant-reports-due" kind="count" value={reportsDue.count} label="Reports owed"
            definition={reportsDue.sentence} source={reportsDue.source} />
        </div>
      </section>
    </div>
  );
}
