// SALES-2 item 11 · Sales → Scoreboard. This week against Jonathan's goals, the eight weeks
// before it, conversion step to step, and which source and which list books meetings. Every
// number opens the rows behind it (scoreboard.js says what each one counts). Works at 390.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, CREAM, EMERALD, BRASS, card, h2, says, btn, quiet, box, link, brassTag, usd, dayWords, whenWords, Failure } from "./salesBits";

const ROWS = [["dials", "Dials"], ["connects", "Connects"], ["meetingsBooked", "Meetings booked"], ["meetingsHeld", "Meetings held"], ["dealsWon", "Deals won"], ["mrrAdded", "MRR added"]];
const short = d => dayWords(d).replace(/, \d{4}$/, "");

function Num({ v, money, onOpen, testid }) {
  return <button type="button" style={{ ...link, color: INK, fontWeight: 700 }} onClick={onOpen} data-sb-num={testid}>{money ? usd(v) : v}</button>;
}

function Goals({ goals, onSaved }) {
  const [g, setG] = useState(goals);
  const [msg, setMsg] = useState(null);
  const save = async () => { try { await apiFetch("/ops/sales/scoreboard/goals", { method: "PUT", body: JSON.stringify({ goals: g }) }); setMsg("Saved."); onSaved(); } catch (e) { setMsg(e.message); } };
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }} data-sb-goals="1">
    <b>Weekly goals:</b>
    {[["dials", "dials"], ["connects", "conversations"], ["meetingsBooked", "meetings booked"]].map(([k, l]) =>
      <label key={k}><input value={g[k]} onChange={e => setG(x => ({ ...x, [k]: e.target.value }))} style={{ ...box, width: 60 }} aria-label={`Goal: ${l}`} /> {l}</label>)}
    <button type="button" style={quiet} onClick={save}>Save goals</button>{msg ? <span>{msg}</span> : null}
  </div>;
}

export default function Scoreboard({ open }) {
  const [d, setD] = useState(null);
  const [rows, setRows] = useState(null);   // { title, list }
  const load = useCallback(() => apiFetch("/ops/sales/scoreboard").then(setD).catch(e => setD({ ok: false, e })), []);
  useEffect(() => { load(); }, [load]);
  const show = async (title, qs) => {
    setRows({ title, list: null });
    try { const r = await apiFetch(`/ops/sales/scoreboard/rows?${new URLSearchParams(qs)}`); setRows({ title, list: r.rows }); } catch { setRows({ title, list: [] }); }
  };
  if (!d) return <section style={card}><p style={says}>Loading…</p></section>;
  if (d.ok === false) return <section style={card}><Failure e={d.e} fallback="The scoreboard could not be read." /></section>;
  const week = d.weeks[0];
  const goalFor = { dials: d.goals.dials, connects: d.goals.connects, meetingsBooked: d.goals.meetingsBooked };
  return <div data-sales-scoreboard="1">
    <section style={card}>
      <h2 style={h2}>This week · {short(week.week)} to {short(week.to)}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, margin: "8px 0 10px" }}>
        {ROWS.map(([k, l]) => { const goal = goalFor[k]; const v = week[k]; const behind = goal != null && v < goal;
          return <div key={k} title={d.sentences[k]} style={{ background: CREAM, borderRadius: 10, padding: "10px 12px" }} data-sb-week={k}>
            <div style={{ fontSize: 24 }}><Num v={v} money={k === "mrrAdded"} testid={`this:${k}`} onOpen={() => show(`${l}, week of ${short(week.week)}`, { metric: k, week: week.week })} /></div>
            <div style={{ fontSize: 12.5, opacity: 0.75 }}>{l}{goal != null ? <> · goal {goal}{behind ? <span style={{ ...brassTag, marginLeft: 4 }}>{goal - v} to go</span> : null}</> : null}</div>
            {goal != null ? <div style={{ height: 5, background: "#fff", borderRadius: 3, marginTop: 6 }}><div style={{ height: 5, width: `${Math.min(100, (v / Math.max(goal, 1)) * 100)}%`, background: behind ? BRASS : EMERALD, borderRadius: 3 }} /></div> : null}
          </div>; })}
      </div>
      <Goals goals={d.goals} onSaved={load} />
      <p style={{ ...says, marginTop: 8 }}>Weeks run Monday to Sunday, New York. Click any number for the rows behind it.</p>
    </section>
    {rows ? <section style={card} data-sb-rows="1">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><h2 style={{ ...h2, flex: 1 }}>{rows.title}</h2><button type="button" style={quiet} onClick={() => setRows(null)}>Close</button></div>
      {rows.list === null ? <p style={says}>Loading…</p> : rows.list.length === 0 ? <p style={says}>None.</p> : rows.list.map((r, i) => <div key={i} style={{ fontSize: 13, padding: "5px 0", borderTop: `1px solid ${CREAM}` }} data-sb-row={r.id || i}>
        <span style={{ opacity: 0.7 }}>{whenWords(r.at)} · </span>{r.type && r.id ? <button type="button" style={link} onClick={() => open(r.type, r.id)}>{r.name}</button> : r.name}<span style={{ opacity: 0.75 }}> · {r.says}</span></div>)}
    </section> : null}
    <section style={card}>
      <h2 style={h2}>The last nine weeks</h2>
      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
        <thead><tr><th style={{ textAlign: "left", padding: "0 10px 6px 0", fontSize: 12, opacity: 0.65 }}>Week of</th>{ROWS.map(([k, l]) => <th key={k} style={{ textAlign: "right", padding: "0 0 6px 10px", fontSize: 12, opacity: 0.65 }} title={d.sentences[k]}>{l}</th>)}</tr></thead>
        <tbody>{d.weeks.map(w => <tr key={w.week} style={{ borderTop: `1px solid ${CREAM}` }} data-sb-row-week={w.week}>
          <td style={{ padding: "5px 10px 5px 0", whiteSpace: "nowrap" }}>{short(w.week)}</td>
          {ROWS.map(([k, l]) => <td key={k} style={{ textAlign: "right", padding: "5px 0 5px 10px" }}><Num v={w[k]} money={k === "mrrAdded"} testid={`${w.week}:${k}`} onOpen={() => show(`${l}, week of ${short(w.week)}`, { metric: k, week: w.week })} /></td>)}
        </tr>)}</tbody></table></div>
    </section>
    <section style={card}>
      <h2 style={h2}>Conversion</h2>
      <p style={says}>{d.sentences.conversion}</p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>{d.conversion.map(c => <div key={c.from} data-sb-conv={c.from}>
        <b style={{ fontSize: 17 }}>{c.pct == null ? "–" : `${c.pct}%`}</b><div style={{ opacity: 0.75 }}>{ROWS.find(r => r[0] === c.from)[1]} → {ROWS.find(r => r[0] === c.to)[1].toLowerCase()} ({c.toN} of {c.fromN})</div></div>)}</div>
    </section>
    <section style={card}>
      <h2 style={h2}>Which channel and which list book meetings</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div><div style={{ fontSize: 13, fontWeight: 700 }}>By source</div><p style={says}>{d.sentences.bySource}</p>
          {d.bySource.length === 0 ? <p style={says}>No deals in these weeks.</p> : <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}><tbody>{d.bySource.map(s => <tr key={s.key} style={{ borderTop: `1px solid ${CREAM}` }} data-sb-source={s.key}>
            <td style={{ padding: "4px 8px 4px 0" }}>{s.key}</td>
            <td><Num v={s.deals} testid={`src:${s.key}:deals`} onOpen={() => show(`${s.key}: deals`, { group: "source", key: s.key, metric: "deals" })} /> deals</td>
            <td><Num v={s.met} testid={`src:${s.key}:met`} onOpen={() => show(`${s.key}: with a meeting`, { group: "source", key: s.key, metric: "met" })} /> met</td>
            <td><Num v={s.won} testid={`src:${s.key}:won`} onOpen={() => show(`${s.key}: won`, { group: "source", key: s.key, metric: "won" })} /> won</td></tr>)}</tbody></table>}</div>
        <div><div style={{ fontSize: 13, fontWeight: 700 }}>By list</div><p style={says}>{d.sentences.byList}</p>
          {d.byList.length === 0 ? <p style={says}>No calls from a list in these weeks.</p> : <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}><tbody>{d.byList.map(s => <tr key={s.key} style={{ borderTop: `1px solid ${CREAM}` }} data-sb-list={s.key}>
            <td style={{ padding: "4px 8px 4px 0" }}>{s.name}</td>
            <td><Num v={s.dials} testid={`list:${s.key}:dials`} onOpen={() => show(`${s.name}: dials`, { group: "list", key: s.key, metric: "dials" })} /> dials</td>
            <td><Num v={s.connects} testid={`list:${s.key}:connects`} onOpen={() => show(`${s.name}: connects`, { group: "list", key: s.key, metric: "connects" })} /> connects</td>
            <td><Num v={s.meetings} testid={`list:${s.key}:meetings`} onOpen={() => show(`${s.name}: meetings`, { group: "list", key: s.key, metric: "meetings" })} /> meetings{s.meetingPct != null ? ` (${s.meetingPct}%)` : ""}</td></tr>)}</tbody></table>}</div>
      </div>
    </section>
  </div>;
}
