// ReportCheck.jsx · RECONCILE-1. "CHECKED AGAINST STEWARD", ON A PAST REPORT.
//
// An old system's report says one thing; Steward's own gifts may say another.
// This panel shows the check (reconcile.js on the server): one sentence first,
// then line by line, Matches or Differs, each Steward figure opening its rows;
// then why they differ when Steward can show it, each with the step that
// fixes it (add the person, map the fund, connect QuickBooks, open the
// import). Nothing here makes a gift. Every step is a click, with Undo.
//
// It also lets the report's total stand for last year ("Use as last year's
// total") and start this year's goal from it, both only on a click.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { Figure } from "./Figure";

const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const day = iso => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; } };
const money = c => fmtFull(Math.round(c) / 100);
const shown = (l, c) => l.kind === "money" ? money(c) : Number(c).toLocaleString("en-US");
const STATUS = { matches: "Matches", differs: "Differs", not_checked: "Not checked" };

function StewardCell({ l }) {
  if (l.steward === null || l.steward === undefined) return <span style={{ color: T.ink3 }}>{l.status === "not_checked" ? "" : "None"}</span>;
  return <Figure variant="inline" kind={l.kind === "money" ? "money" : "count"} value={l.steward} label={`Steward: ${l.label}`} source={l.source} />;
}

export function CheckStatus({ check }) {
  if (!check) return null;
  return (
    <div data-testid="report-check-line" style={{ fontSize: 13, color: T.ink, marginTop: 6, lineHeight: 1.5 }}>
      <strong>Checked against Steward:</strong> {check.sentence}
      {check.checkedAt && <span style={{ color: T.ink3 }}> Checked {day(check.checkedAt)}.</span>}
    </div>);
}

export default function ReportCheck({ report, onNavigate, onChanged }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [mapPick, setMapPick] = useState({});
  const [goalFor, setGoalFor] = useState(null);
  const load = () => apiFetch(`/old-reports/${report.id}/check`).then(d => setC(d.check)).catch(e => setErr(errorMessage(e, "The check did not load.")));
  useEffect(() => { load(); }, [report.id]);
  const after = x => { if (x && x.check) setC(x.check); else load(); onChanged && onChanged(); };
  const act = async (label, fn) => { setErr(""); setBusy(label); try { await fn(); } catch (e) { setErr(errorMessage(e, "That did not go through.")); } setBusy(""); };

  const addPerson = p => act("add:" + (p.email || p.name), async () => {
    const r = await apiFetch(`/old-reports/${report.id}/add-person`, { method: "POST", body: JSON.stringify({ name: p.name, email: p.email }) });
    after(r);
    offerUndo({ message: r.sentence, undoAction: async () => { const x = await apiFetch(`/old-reports/${report.id}/add-person/undo`, { method: "POST", body: JSON.stringify({ donorId: r.donorId }) }); after(x); return x; } }, "person");
  });
  const mapFund = label => act("map:" + label, async () => {
    const fundId = mapPick[label];
    if (!fundId) throw new Error("Choose one of your funds first.");
    const r = await apiFetch("/old-reports/fund-map", { method: "POST", body: JSON.stringify({ label, fundId }) });
    after(null);
    offerUndo({ message: r.sentence, undoAction: async () => { const x = await apiFetch("/old-reports/fund-map", { method: "POST", body: JSON.stringify({ label, fundId: r.previousFundId }) }); after(null); return x; } }, "fund");
  });
  const recheck = () => act("recheck", async () => after(await apiFetch(`/old-reports/${report.id}/check`, { method: "POST", body: "{}" })));
  const setAsBaseline = p => act("base:" + p.from, async () => {
    const r = await apiFetch("/old-reports/baseline", { method: "POST", body: JSON.stringify({ from: p.from, to: p.to, sheetId: report.id }) });
    onChanged && onChanged();
    offerUndo({ message: r.sentence, undoAction: async () => { const x = await apiFetch("/old-reports/baseline", { method: "POST", body: JSON.stringify({ from: p.from, to: p.to, sheetId: r.previousSheetId }) }); onChanged && onChanged(); return x; } }, "baseline");
  });

  if (err && !c) return <div role="status" style={{ fontSize: 12.5, color: T.ink, marginTop: 8 }}>{err}</div>;
  if (!c) return <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 8 }}>Checking against Steward…</div>;
  const people = c.people, list = c.list;
  const baselines = report.baselines || [];
  const givingPeriods = (c.periods || []).filter(p => p.reportCents !== null && p.reportCents !== undefined);
  return (
    <section data-testid="report-check" aria-label="Checked against Steward" style={{ marginTop: 10, borderTop: "1px solid " + T.bg3, paddingTop: 10, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, color: T.ink3, fontWeight: 800, flex: "1 1 auto" }}>Checked against Steward</div>
        <span data-testid="report-check-when" style={{ fontSize: 12, color: T.ink3 }}>{c.checkedAt ? `Checked ${day(c.checkedAt)}` : "Not checked yet: this is what Steward sees now"}</span>
        <button type="button" style={btn(false)} disabled={!!busy} onClick={recheck}>Check again</button>
      </div>
      <div data-testid="report-check-sentence" style={{ fontSize: 15, fontWeight: 700, color: T.ink, lineHeight: 1.45 }}>{c.sentence}</div>
      {err && <div role="status" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}

      {(c.lines || []).length > 0 && (
        <div data-testid="report-check-table" role="table" aria-label="The report against Steward, line by line" style={{ border: "1px solid " + T.bg3, borderRadius: 10, fontSize: 12.5 }}>
          {c.lines.map((l, i) => (
            <div key={l.key} role="row" data-testid="report-check-row" data-status={l.status}
              style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", padding: "8px 12px", borderTop: i ? "1px solid " + T.bg3 : "none", alignItems: "baseline" }}>
              <div role="rowheader" style={{ flex: "1 1 220px", minWidth: 0, color: T.ink, fontWeight: 600 }}>{l.label}{l.note && <div style={{ fontWeight: 400, color: T.ink3, fontSize: 11.5, marginTop: 2 }}>{l.note}</div>}</div>
              <div role="cell" style={{ flex: "0 0 auto", minWidth: 110, color: T.ink }}><span style={{ color: T.ink3 }}>Report </span>{shown(l, l.reportCents)}</div>
              <div role="cell" style={{ flex: "0 0 auto", minWidth: 130, color: T.ink }}>{l.status === "not_checked" ? null : <><span style={{ color: T.ink3 }}>Steward </span><StewardCell l={l} /></>}</div>
              <div role="cell" style={{ flex: "0 0 auto", minWidth: 120, fontWeight: 700, color: l.status === "differs" ? T.gold700 : T.ink }}>
                {STATUS[l.status]}{l.status === "differs" && l.stewardCents !== null && l.stewardCents !== undefined ? ` by ${shown(l, Math.abs(l.reportCents - l.stewardCents))}` : ""}
                {l.action && l.action.kind === "connect_quickbooks" && <div><button type="button" style={{ ...btn(false), marginTop: 4 }} onClick={() => onNavigate && onNavigate("settings", { section: "connections" })}>Connect QuickBooks</button></div>}
                {l.imports && l.imports.length > 0 && <div style={{ marginTop: 4 }}><button type="button" style={btn(false)} data-testid="report-check-open-import" onClick={() => onNavigate && onNavigate("settings", { section: "data", focus: l.imports[0].id })}>Open the import that brought these gifts</button></div>}
              </div>
            </div>))}
        </div>)}

      {(c.causes || []).length > 0 && (
        <div data-testid="report-check-why" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>Why they differ</div>
          {c.causes.map((x, i) => (
            <div key={i} data-testid="report-check-cause" data-cause={x.key} style={{ fontSize: 13, color: T.ink, lineHeight: 1.5 }}>
              {x.sentence}
              {x.key === "cannot_tell" && x.steward && <> The report's side: <Figure variant="inline" kind="money" value={x.reportCents / 100} label="The report's rows" source={x.report} />. Steward's side: <Figure variant="inline" kind="money" value={x.stewardCents / 100} label="Steward's gifts for the period" source={x.steward} />.</>}
              {x.key === "missing_people" && (x.people || []).length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                  {x.people.map(p => (
                    <li key={p.email || p.name} data-testid="report-check-missing">
                      <span style={{ fontWeight: 700 }}>{p.name}</span>{p.email ? ` (${p.email})` : ""}{p.cents ? `, ${money(p.cents)} on the report` : ""}{" "}
                      <button type="button" style={btn(true)} disabled={!!busy} data-testid="report-check-add" onClick={() => addPerson(p)}>Add this person</button>
                    </li>))}
                </ul>)}
              {x.action && x.action.kind === "map_fund" && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                  <select aria-label={`Map ${x.label} to one of your funds`} value={mapPick[x.label] || ""} onChange={e => setMapPick(m => ({ ...m, [x.label]: e.target.value }))}
                    style={{ fontSize: 12.5, padding: "5px 8px", borderRadius: 8, border: "1px solid " + T.bg3, maxWidth: "100%" }}>
                    <option value="">Choose one of your funds</option>
                    {(c.funds || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <button type="button" style={btn(false)} disabled={!!busy} onClick={() => mapFund(x.label)}>Map this fund to one of yours</button>
                </div>)}
              {x.action && x.action.kind === "connect_source" && <div><button type="button" style={{ ...btn(false), marginTop: 4 }} onClick={() => onNavigate && onNavigate("settings", { section: "connections" })}>Connect {x.provider}</button></div>}
            </div>))}
        </div>)}

      {people && people.note && <div data-testid="report-check-people" style={{ fontSize: 13, color: T.ink, lineHeight: 1.5 }}>{people.note}</div>}
      {people && people.differing.length > 0 && (
        <details style={{ fontSize: 13, color: T.ink }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>{people.differing.length} {people.differing.length === 1 ? "person differs" : "people differ"}, largest first</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {people.differing.slice(0, 50).map(p => <li key={p.donorId}>{p.name}: the report {money(p.reportCents)}, Steward {(p.records || [p]).map((x, i) => <span key={x.donorId}>{i ? " + " : ""}<Figure variant="inline" kind="money" value={(x.cents ?? x.stewardCents) / 100} label={`Steward: ${p.name}`} source={x.source} /></span>)}{(p.records || []).length > 1 ? ` (Steward keeps ${p.records.length} records for them)` : ""}{p.onlyByFund ? ", only by gifts to a fund Steward has no match for" : ""}</li>)}
          </ul>
        </details>)}

      {list && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: T.ink }}>
          {list.onlyReportCount > 0 && <div style={{ fontWeight: 700 }}>Only on the report ({list.onlyReportCount})</div>}
          {list.onlyReport.map(p => (
            <div key={p.email || p.name} data-testid="report-check-list-only-report">
              <span style={{ fontWeight: 700 }}>{p.name}</span>: {p.why}{" "}
              {p.missing && <button type="button" style={btn(true)} disabled={!!busy} onClick={() => addPerson(p)}>Add this person</button>}
            </div>))}
          {list.onlyStewardCount > 0 && <div style={{ fontWeight: 700, marginTop: 4 }}>Only on Steward's list ({list.onlyStewardCount})</div>}
          {list.onlySteward.map(p => <div key={p.donorId}>{p.name}</div>)}
        </div>)}

      {givingPeriods.length > 0 && (
        <div data-testid="report-baseline" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {givingPeriods.map(p => {
            const inUse = baselines.some(b => b.from === p.from && b.to === p.to);
            return (
              <div key={p.from} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: T.ink }}>
                {inUse
                  ? <span data-testid="report-baseline-in-use">In use as {p.label}'s total, from your old system, wherever Steward has no gifts for {p.label}.</span>
                  : <button type="button" style={btn(false)} disabled={!!busy} data-testid="report-use-baseline" onClick={() => setAsBaseline(p)}>Use as last year's total</button>}
                <button type="button" style={btn(false)} data-testid="report-goal-from" onClick={() => setGoalFor(p)}>Set this year's goal from it</button>
              </div>);
          })}
        </div>)}
      {goalFor && <GoalFromReport period={goalFor} onClose={() => setGoalFor(null)} />}
    </section>);
}

// The goal flow, prefilled: last year's total from the report, and the
// growth she types. Saved with the same POST /goals as Home's goal form.
function GoalFromReport({ period, onClose }) {
  const y = new Date().getFullYear();
  const base = Math.round(period.reportCents) / 100;
  const [growth, setGrowth] = useState("");
  const [msg, setMsg] = useState("");
  const g = Number(growth);
  const goal = growth !== "" && Number.isFinite(g) ? Math.round(base * (1 + g / 100)) : null;
  const save = async () => {
    if (goal === null || goal <= 0) { setMsg("Type the growth you are aiming for, as a percentage."); return; }
    try {
      await apiFetch("/goals", { method: "POST", body: JSON.stringify({ label: `${y} fundraising goal`, goalAmount: goal, goalType: "total_raised", periodStart: `${y}-01-01`, periodEnd: `${y}-12-31` }) });
      setMsg(`Saved: ${fmtFull(goal)} for ${y}. Home shows it now.`);
    } catch (e) { setMsg(errorMessage(e, "The goal was not saved.")); }
  };
  return (
    <div data-testid="report-goal-flow" style={{ border: "1px solid " + T.bg3, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8, background: T.white }}>
      <div style={{ fontSize: 13.5, color: T.ink }}>Your old system says you raised <strong>{fmtFull(base)}</strong> in {period.label}. How much more do you want to raise in {y}?</div>
      <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        Growth
        <input data-testid="report-goal-growth" inputMode="decimal" value={growth} onChange={e => setGrowth(e.target.value.replace(/[^0-9.\-]/g, ""))}
          style={{ width: 80, fontSize: 13, padding: "5px 8px", borderRadius: 8, border: "1px solid " + T.bg3 }} /> %
        {goal !== null && <span>Goal: <strong>{fmtFull(goal)}</strong></span>}
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btn(true)} data-testid="report-goal-save" onClick={save}>Set the goal</button>
        <button type="button" style={btn(false)} onClick={onClose}>Close</button>
      </div>
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink }}>{msg}</div>}
    </div>);
}
