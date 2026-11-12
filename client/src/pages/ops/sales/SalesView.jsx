// SALES-1 · /ops?tab=sales: Steward's own sales CRM (super-admins only; every
// /ops/sales route answers 404 to anyone else). Today and the forecast at the
// top, then the four sub-tabs. Where you are lives in the address:
//   &sub=org|contact|deal|task   the list
//   &rec=<type>:<id>             a record page
//   &panel=settings|import|call  Sales settings, Import, or call mode (&list=<id>&view=<json>)
//   &sub=list&list=<id>          SALES-2: one prospect list
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { countLabel } from "../../../../shared/countWords.js";
import { apiFetch } from "../../../api";
import { INK, WHITE, CREAM, EMERALD, BRASS, card, h2, says, btn, quiet, box, link, brassTag, usd, dayWords, TYPE_WORDS, Failure, failureWords } from "./salesBits";
import CallMode from "./CallMode";
import Scoreboard from "./Scoreboard";
import ListView from "./ListView";
import RecordPage from "./RecordPage";
import TasksView from "./TasksView";
import SettingsPanel from "./SettingsPanel";
import ImportPanel from "./ImportPanel";
import PartnersView from "./PartnersView";

const SUBS = [["org", "Organizations"], ["contact", "Contacts"], ["deal", "Deals"], ["task", "Tasks"], ["partner", "Partners"], ["list", "Lists"], ["score", "Scoreboard"]];
const LINES = [
  ["howDidItGo", "How did it go?"], ["billingStarts", "Billing starts soon"], ["quoteUnsigned", "Quote sent, not signed"], ["booked", "Meetings booked"],
  ["due", "Due today or overdue"], ["revisit", "Back from Later"], ["noReply", "No reply"], ["trials", "Trials and betas ending"], ["quiet", "Gone quiet"],
  ["noNext", "No next step"], ["meetings", "This week's meetings"], ["stuck", "Stuck in a stage"],
];

// SALES-2 item 6: the day after a meeting, one click moves its deal.
function AfterMeeting({ r, meta, onDone }) {
  const [need, setNeed] = useState(null);   // { key, field }
  const [val, setVal] = useState("");
  const [err, setErr] = useState(null);
  const send = async (key, extra = {}) => {
    setErr(null);
    try { await apiFetch(`/ops/sales/meetings/${encodeURIComponent(r.id)}/after`, { method: "POST", body: JSON.stringify({ outcome: key, ...extra }) }); onDone(); }
    catch (e) { setErr(failureWords(e, "Not moved.")); }
  };
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "2px 0 6px" }} data-after-meeting={r.id}>
    {(meta.afterMeeting || []).map(o => <button key={o.key} type="button" style={{ ...quiet, minHeight: 28, padding: "3px 9px", fontSize: 12.5 }} data-after-outcome={o.key}
      onClick={() => (o.key === "later" ? setNeed({ key: o.key, field: "revisit_on" }) : o.key === "lost" ? setNeed({ key: o.key, field: "lost_reason" }) : send(o.key))}>{o.label}</button>)}
    {need ? <><input type={need.field === "revisit_on" ? "date" : "text"} value={val} onChange={e => setVal(e.target.value)} style={box}
      aria-label={need.field === "revisit_on" ? "Revisit on" : "Why it was lost"} placeholder={need.field === "lost_reason" ? "Why" : ""} />
      <button type="button" style={{ ...btn, minHeight: 28, padding: "3px 9px" }} disabled={!val} onClick={() => send(need.key, { [need.field]: val })}>Save</button></> : null}
    {err ? <span style={{ fontSize: 12 }}><span style={brassTag}>Not moved</span> {err}</span> : null}
  </div>;
}

// SALES-2 item 1: the prospect lists.
function ListsView({ meta, go, onMeta }) {
  const [msg, setMsg] = useState(null);
  const del = async l => { try { await apiFetch(`/ops/sales/lists/${encodeURIComponent(l.id)}`, { method: "DELETE" }); onMeta(); } catch (e) { setMsg(failureWords(e, "Not deleted.")); } };
  const lists = meta.lists || [];
  return <section style={card} data-sales-lists="1">
    <p style={says}>A list is a saved view of organizations plus its own members, so one organization can be on several. Import a lead list into one, or save any Organizations view as one.</p>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
      <button type="button" style={btn} onClick={() => go({ panel: "call", cadence: "1", list: null, view: null })} data-sales-cadence-calls="1">Today's cadence calls</button>
      <span style={{ fontSize: 12.5, opacity: 0.75 }}>Everyone with a cadence call step due today or earlier.</span></div>
    {lists.length === 0 ? <p style={says}>No lists yet. Import a lead list, or filter Organizations and save them as a list.</p> : lists.map(l => <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${CREAM}` }} data-sales-list-row={l.id}>
      <button type="button" style={{ ...link, fontSize: 14 }} onClick={() => go({ sub: "list", list: l.id, rec: null })}>{l.name}</button>
      <span style={{ fontSize: 12.5, opacity: 0.7, flex: 1 }}>{l.orgs} organizations · made by {l.created_by_name}</span>
      <button type="button" style={btn} onClick={() => go({ panel: "call", list: l.id, view: null })} data-sales-list-call={l.id}>Start calling</button>
      <button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.7 }} onClick={() => del(l)}>Delete list</button>
    </div>)}
    {msg ? <p style={says}>{msg}</p> : null}
  </section>;
}

function Today({ today, open, meta, reload }) {
  return <section style={card} data-sales-today="1">
    <h2 style={h2}>Today</h2>
    <p style={says}>Each line opens its record. Overdue is in brass.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
      {LINES.map(([k, title]) => {
        const rows = today.lines[k] || [];
        return <div key={k} data-today-line={k}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{title} <span style={{ opacity: 0.6, fontWeight: 500 }}>{rows.length}</span></div>
          <div style={{ fontSize: 11.5, opacity: 0.65, margin: "2px 0 6px" }}>{today.sentences[k]}</div>
          {rows.length === 0 ? <div style={{ fontSize: 12.5, opacity: 0.55 }}>Nothing.</div> :
            rows.slice(0, 8).map((r, i) => <div key={i} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 6, alignItems: "baseline",
              background: r.overdue || k === "stuck" || k === "noNext" || k === "quoteUnsigned" ? `${BRASS}22` : "transparent", borderRadius: 4 }}>
              {r.overdue ? <span style={brassTag}>overdue</span> : null}
              {r.on ? <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{dayWords(r.on)}</span> : null}
              {r.open ? <button type="button" style={link} onClick={() => open(r.open.type, r.open.id)} data-today-open={r.open.id}>{r.says}</button> : <span>{r.says}</span>}
            </div>).flatMap((el, i) => (k === "howDidItGo" ? [el, <AfterMeeting key={`a${i}`} r={rows[i]} meta={meta} onDone={reload} />] : [el]))}
          {rows.length > 8 ? <div style={{ fontSize: 12, opacity: 0.6 }}>and {rows.length - 8} more</div> : null}
        </div>;
      })}
    </div>
  </section>;
}

function Forecast({ f }) {
  const max = Math.max(f.goal.cents, ...f.months.map(m => m.projectedCents), 1);
  return <section style={card} data-sales-forecast="1">
    <h2 style={h2}>Forecast</h2>
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap", margin: "6px 0 10px" }}>
      <div title={f.sentences.weighted}><div style={{ fontSize: 22, fontWeight: 700 }} data-fc-weighted="1">{usd(f.weightedCents)}</div><div style={{ fontSize: 12, opacity: 0.7 }}>weighted pipeline</div></div>
      <div title={f.sentences.signed}><div style={{ fontSize: 22, fontWeight: 700 }} data-fc-signed="1">{usd(f.signedCents || 0)}</div><div style={{ fontSize: 12, opacity: 0.7 }}>signed, not billing yet · {countLabel(f.signedDeals || 0, "deal")}</div></div>
      <div title={f.sentences.mrrNow}><div style={{ fontSize: 22, fontWeight: 700 }} data-fc-mrr="1">{usd(f.mrrNowCents)}</div><div style={{ fontSize: 12, opacity: 0.7 }}>MRR now · {f.mrrPctOfGoal}% of goal</div></div>
      <div title={f.sentences.goal}><div style={{ fontSize: 22, fontWeight: 700 }}>{usd(f.goal.cents)}</div><div style={{ fontSize: 12, opacity: 0.7 }}>goal · {f.goal.says}</div></div>
      <div><div style={{ fontSize: 22, fontWeight: 700 }}>{f.projectedPctOfGoal}%</div><div style={{ fontSize: 12, opacity: 0.7 }}>of goal, MRR now plus signed and weighted</div></div>
    </div>
    <p style={says}>{f.sentences.weighted} {f.sentences.signed} {f.sentences.mrrNow}{f.mrrError ? ` ${f.mrrError}` : ""}</p>
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead><tr>{["Month", "Weighted closing", "Signed, billing starts", "MRR now + all of it", "Goal line", ""].map(h => <th key={h} style={{ textAlign: "left", fontSize: 12, fontWeight: 600, opacity: 0.65, padding: "0 10px 6px 0" }}>{h}</th>)}</tr></thead>
      <tbody>{f.months.map(m => <tr key={m.month} data-fc-month={m.month}>
        <td style={{ padding: "4px 10px 4px 0", borderTop: `1px solid ${CREAM}` }}>{m.label}</td>
        <td style={{ padding: "4px 10px 4px 0", borderTop: `1px solid ${CREAM}` }}>{usd(m.weightedClosingCents)}</td>
        <td style={{ padding: "4px 10px 4px 0", borderTop: `1px solid ${CREAM}` }} data-fc-signed-month={m.month}>{usd(m.signedStartingCents || 0)}</td>
        <td style={{ padding: "4px 10px 4px 0", borderTop: `1px solid ${CREAM}` }}>{usd(m.projectedCents)}{m.behind ? <span style={{ ...brassTag, marginLeft: 6 }}>behind</span> : null}</td>
        <td style={{ padding: "4px 10px 4px 0", borderTop: `1px solid ${CREAM}` }}>{usd(m.goalPathCents)}</td>
        <td style={{ width: "30%", borderTop: `1px solid ${CREAM}` }}><div style={{ height: 8, background: CREAM, borderRadius: 4, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, width: `${(m.projectedCents / max) * 100}%`, background: EMERALD, borderRadius: 4 }} />
          <div style={{ position: "absolute", top: -2, bottom: -2, left: `${(m.goalPathCents / max) * 100}%`, width: 2, background: BRASS }} /></div></td>
      </tr>)}</tbody>
    </table>
    <p style={{ ...says, marginTop: 8 }}>{f.sentences.months} {f.undatedWeightedCents ? `${usd(f.undatedWeightedCents)} weighted has no close date. ` : ""}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 6 }}>
      {[["By source", f.bySource], ["By stage", f.byStage]].map(([t, rows]) => <div key={t}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t}, last 90 days</div>
        {rows.length === 0 ? <div style={{ fontSize: 12.5, opacity: 0.6 }}>No deal won or lost in the last 90 days.</div> :
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}><tbody>{rows.map(r => <tr key={r.key}>
            <td style={{ padding: "3px 8px 3px 0" }}>{r.key}</td><td>{r.won} won · {r.lost} lost</td>
            <td>{r.winRate == null ? "–" : `${r.winRate}% win`}</td><td>{r.avgDaysToClose == null ? "–" : `${r.avgDaysToClose} days to close`}</td></tr>)}</tbody></table>}
      </div>)}
    </div>
    <p style={{ ...says, marginTop: 8 }}>{f.sentences.winRate} {f.sentences.daysToClose}</p>
  </section>;
}

function Search({ open }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return undefined; }
    const t = setTimeout(() => apiFetch(`/ops/sales/search?q=${encodeURIComponent(q)}`).then(d => setRes(d.results)).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 420 }}>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search organizations, contacts, deals" aria-label="Search sales" style={{ ...box, width: "100%" }} data-sales-search="1" />
    {res.length ? <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: WHITE, border: `1px solid ${INK}22`, borderRadius: 8, zIndex: 20, maxHeight: 320, overflowY: "auto", boxShadow: "0 6px 20px rgba(15,26,18,0.12)" }}>
      {res.map(r => <button key={`${r.type}:${r.id}`} type="button" onClick={() => { setQ(""); open(r.type, r.id); }}
        style={{ ...link, display: "block", width: "100%", padding: "8px 10px", color: INK, fontWeight: 500, borderBottom: `1px solid ${CREAM}` }}>
        <span style={{ fontSize: 11, opacity: 0.6, marginRight: 6 }}>{TYPE_WORDS[r.type]}</span>{r.name}{r.hint ? <span style={{ opacity: 0.6 }}> · {r.hint}</span> : null}</button>)}
    </div> : null}
  </div>;
}

export default function SalesView() {
  const [params, setParams] = useSearchParams();
  const sub = SUBS.some(s => s[0] === params.get("sub")) ? params.get("sub") : "org";
  const rec = /^(org|contact|deal):(.+)$/.exec(params.get("rec") || "");
  const panel = params.get("panel");
  const [meta, setMeta] = useState(null);
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);

  const loadMeta = useCallback(() => apiFetch("/ops/sales/meta").then(setMeta).catch(e => setErr(e)), []);
  const loadHome = useCallback(() => apiFetch("/ops/sales/home").then(setHome).catch(() => setHome({ ok: false })), []);
  useEffect(() => { loadMeta(); loadHome(); }, [loadMeta, loadHome]);

  const go = useCallback(next => setParams(p => { const o = { tab: "sales", sub: p.get("sub") || "org", ...next }; Object.keys(o).forEach(k => o[k] == null && delete o[k]); return o; }), [setParams]);
  const open = useCallback((type, id) => go({ sub: type, rec: `${type}:${id}`, panel: null }), [go]);
  const changed = useCallback(() => { loadHome(); }, [loadHome]);

  if (err) return <section style={card}><Failure e={err} fallback={err.status === 404 ? "This page is for Steward's super-admins." : "The sales CRM could not be read. Try again in a minute."} /></section>;
  const callView = (() => { try { return params.get("view") ? JSON.parse(params.get("view")) : null; } catch { return null; } })();
  const listId = params.get("list");
  const startCalling = (view, lid) => go({ panel: "call", list: lid || null, view: view ? JSON.stringify(view) : null, rec: null });
  if (!meta) return <section style={card}><p style={says}>Loading…</p></section>;
  return <div data-testid="ops-sales">
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
      <Search open={open} />
      <span style={{ flex: 1 }} />
      <button type="button" style={quiet} onClick={() => go({ panel: panel === "import" ? null : "import", rec: null })} data-sales-import-open="1">Import</button>
      <button type="button" style={quiet} onClick={() => go({ panel: panel === "settings" ? null : "settings", rec: null })} data-sales-settings-open="1">Sales settings</button>
    </div>
    {panel === "call" ? <CallMode key={`${listId}:${params.get("view")}:${params.get("cadence")}`} meta={meta} listId={listId} view={callView} cadence={params.get("cadence") === "1"} onClose={() => { go({ panel: null, view: null, cadence: null }); loadHome(); }} open={open} />
      : panel === "settings" ? <SettingsPanel meta={meta} onChanged={() => { loadMeta(); loadHome(); }} onClose={() => go({ panel: null })} />
      : panel === "import" ? <ImportPanel meta={meta} onChanged={changed} onClose={() => go({ panel: null })} />
      : rec ? <RecordPage key={rec[0]} type={rec[1]} id={rec[2]} meta={meta} open={open} onBack={() => go({ rec: null })} onChanged={changed} />
      : <>
        {home && home.ok ? <><Today today={home.today} open={open} meta={meta} reload={loadHome} /><Forecast f={home.forecast} /></>
          : home ? <section style={card}><p style={says}>Today could not be read. Try again in a minute.</p></section> : null}
        <div role="tablist" aria-label="Sales" style={{ display: "flex", flexWrap: "wrap", columnGap: 18, rowGap: 0, borderBottom: `1px solid ${INK}1f`, margin: "0 0 14px" }}>
          {SUBS.map(([id, label]) => <button key={id} role="tab" aria-selected={sub === id} data-sales-sub={id} onClick={() => go({ sub: id, rec: null })}
            style={{ background: "none", border: 0, borderBottom: `2px solid ${sub === id ? EMERALD : "transparent"}`, padding: "8px 0", minHeight: 38, fontSize: 14,
              fontWeight: sub === id ? 700 : 500, color: INK, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>)}
        </div>
        {sub === "task" ? <TasksView meta={meta} open={open} onChanged={changed} />
          : sub === "partner" ? <PartnersView open={open} />
          : sub === "score" ? <Scoreboard open={open} />
          : sub === "list" && listId && (meta.lists || []).some(l => l.id === listId) ? <ListView key={`list:${listId}`} type="org" list={meta.lists.find(l => l.id === listId)} meta={meta} open={open} onChanged={changed} onMeta={loadMeta} startCalling={startCalling} />
          : sub === "list" ? <ListsView meta={meta} go={go} onMeta={loadMeta} />
          : <ListView key={sub} type={sub} meta={meta} open={open} onChanged={changed} onMeta={loadMeta} startCalling={sub === "org" ? startCalling : null} />}
      </>}
  </div>;
}
