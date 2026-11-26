// SALES-4 item 1 · NOW, the first thing on the Sales tab. This week's scoreboard bar (dials,
// conversations, meetings against the goals; each number opens its rows), the calendar's
// automatic stage moves with Undo, then one ranked list: each row one action with one button.
// The order is the server's (now.js) and every row shows why it is where it is.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, WHITE, CREAM, EMERALD, BRASS, card, h2, says, btn, quiet, link, brassTag, dayWords, whenWords, usd, Failure, failureWords } from "./salesBits";
import EmailDraft from "./EmailDraft";

const BAR = [["dials", "Dials"], ["connects", "Conversations"], ["meetingsBooked", "Meetings"]];
const KIND_WORDS = { task: "Task", next_step: "Next step", meeting: "Today", after: "How did it go?", revisit: "Back from Later", trial: "Trial or billing",
  followup: "Follow up", reply: "Reply", stale: "Going stale", call: "Call" };
const ACTION_WORDS = { call: "Call", email: "Follow up", prep: "Prep", after: "Answer", open: "Open" };

function WeekBar({ week }) {
  const [rows, setRows] = useState(null);
  const show = async (k, label) => {
    setRows({ k, label, list: null });
    try { const r = await apiFetch(`/ops/sales/scoreboard/rows?${new URLSearchParams({ metric: k, week: week.week })}`); setRows({ k, label, list: r.rows }); }
    catch { setRows({ k, label, list: [] }); }
  };
  return <div data-now-week="1">
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {BAR.map(([k, label]) => {
        const n = week.numbers[k], goal = week.goals[k] || 0, pct = goal ? Math.min(100, Math.round((n / goal) * 100)) : 0;
        return <button key={k} type="button" onClick={() => (rows && rows.k === k ? setRows(null) : show(k, label))} title={week.sentences[k]} data-now-num={k}
          style={{ flex: "1 1 150px", textAlign: "left", background: WHITE, border: `1px solid ${rows && rows.k === k ? EMERALD : `${INK}1f`}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", color: INK }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{label} this week</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{n}<span style={{ fontSize: 13, fontWeight: 500, opacity: 0.6 }}> of {goal}</span></div>
          <div style={{ height: 6, background: CREAM, borderRadius: 3, marginTop: 6 }}><div style={{ width: `${pct}%`, height: 6, background: n >= goal ? EMERALD : BRASS, borderRadius: 3 }} /></div>
        </button>;
      })}
    </div>
    {rows ? <div style={{ background: CREAM, borderRadius: 10, padding: "10px 12px", marginTop: 8 }} data-now-rows={rows.k}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{rows.label}, {dayWords(week.week).replace(/, \d{4}$/, "")} to {dayWords(week.to).replace(/, \d{4}$/, "")}</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{week.sentences[rows.k]}</div>
      {rows.list == null ? <div style={{ fontSize: 13 }}>Loading…</div> : rows.list.length === 0 ? <div style={{ fontSize: 13, opacity: 0.7 }}>None yet this week.</div>
        : rows.list.map((r, i) => <div key={i} style={{ fontSize: 13, padding: "2px 0" }}><span style={{ opacity: 0.65 }}>{whenWords(r.at)}</span> {r.name} · {r.says}</div>)}
    </div> : null}
  </div>;
}

function Moved({ m, onDone }) {
  const [err, setErr] = useState(null);
  const undo = async () => { setErr(null); try { await apiFetch(`/ops/sales/auto-moves/${encodeURIComponent(m.id)}/undo`, { method: "POST", body: "{}" }); onDone(); } catch (e) { setErr(failureWords(e, "Not undone.")); } };
  return <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, padding: "6px 10px", background: CREAM, borderRadius: 8, marginBottom: 6 }} data-now-moved={m.id}>
    <span><b>{m.deal}</b> moved from {m.from} to {m.to}. {m.why}.</span>
    <button type="button" style={{ ...link, fontSize: 13 }} onClick={undo} data-now-undo={m.id}>Undo</button>
    {err ? <span>{err}</span> : null}
  </div>;
}

function Prep({ dealId }) {
  const [h, setH] = useState(null);
  useEffect(() => { apiFetch(`/ops/sales/deals/${encodeURIComponent(dealId)}/header`).then(d => setH(d.header)).catch(() => setH({ failed: true })); }, [dealId]);
  if (!h) return <div style={{ fontSize: 13 }}>Loading…</div>;
  if (h.failed) return <div style={{ fontSize: 13 }}>The deal could not be read.</div>;
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, background: CREAM, borderRadius: 10, padding: "10px 12px", marginTop: 6 }} data-now-prep={dealId}>
    {[["Stage", `${h.stage} · ${h.probability}%`], ["Value", `${usd(h.valueCents)}/mo`], ["Next step", h.nextStep ? `${h.nextStep}${h.nextStepOn ? `, ${dayWords(h.nextStepOn)}` : ""}` : "None"],
      ["Last touch", h.lastTouch ? `${h.lastTouch.reason}: ${h.lastTouch.says}` : h.mailbox && !h.mailbox.connected ? `None yet. ${h.mailbox.says}` : "None yet"]].map(([k, v]) =>
      <div key={k}><div style={{ fontSize: 11.5, opacity: 0.65 }}>{k}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div></div>)}
  </div>;
}

function Row({ r, first, startCalling, open, meta, reload }) {
  const [shown, setShown] = useState(null);   // "score" | "email" | "prep"
  const [msg, setMsg] = useState(null);
  const accept = async () => {
    setMsg(null);
    try { const d = await apiFetch(`/ops/sales/deals/${encodeURIComponent(r.dealId)}/next-step`, { method: "POST", body: JSON.stringify(r.propose) }); setMsg(d.says); reload(); }
    catch (e) { setMsg(failureWords(e, "Not set.")); }
  };
  const after = async key => { try { await apiFetch(`/ops/sales/meetings/${encodeURIComponent(r.meetingId)}/after`, { method: "POST", body: JSON.stringify({ outcome: key }) }); reload(); } catch (e) { setMsg(failureWords(e, "Not moved.")); } };
  const go = () => {
    if (r.action === "call") return startCalling(r.orgId);
    if (r.action === "email") return setShown(s => (s === "email" ? null : "email"));
    if (r.action === "prep") return setShown(s => (s === "prep" ? null : "prep"));
    if (r.open) return open(r.open.type, r.open.id);
    return null;
  };
  const due = ["task", "next_step", "meeting", "after", "revisit", "trial"].includes(r.kind);
  return <div style={{ borderTop: first ? 0 : `1px solid ${CREAM}`, padding: "10px 0" }} data-now-row={r.key} data-now-kind={r.kind} data-now-rank={r.rank}>
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ width: 26, fontSize: 13, fontWeight: 700, opacity: 0.5, textAlign: "right" }}>{r.rank}</div>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2, color: r.overdue ? INK : EMERALD, textTransform: "uppercase" }}>
          {r.overdue ? <span style={brassTag}>overdue</span> : KIND_WORDS[r.kind]}{r.stage ? <span style={{ fontWeight: 500, opacity: 0.7, textTransform: "none" }}> · {r.stage}</span> : null}</div>
        {r.open ? <button type="button" style={{ ...link, color: INK, fontSize: 14.5 }} onClick={() => open(r.open.type, r.open.id)}>{r.says}</button> : <span style={{ fontSize: 14.5, fontWeight: 600 }}>{r.says}</span>}
        <div style={{ fontSize: 13, opacity: 0.8 }} data-now-reason="1">{r.reason}</div>
      </div>
      {/* Jonathan, 17 Nov: the weighted value, not the score; the score's sum still opens on a click. */}
      {r.score && r.score.value ? <button type="button" style={{ ...link, color: INK, fontWeight: 600, fontSize: 12.5, opacity: 0.8 }} title="Monthly value × stage probability. Click for why it's in this place." onClick={() => setShown(s => (s === "score" ? null : "score"))} data-now-likely={Math.round((r.score.value * r.score.probability) / 100)}>
        {usd(Math.round(r.score.value * r.score.probability))}/mo likely</button> : null}
      {first && r.action === "call" ? <button type="button" style={{ ...btn, minHeight: 40, padding: "8px 18px", fontSize: 14 }} onClick={() => startCalling(r.orgId)} data-now-start="1">Start</button>
        : r.action === "after" ? null
        : <button type="button" style={r.action === "call" || first ? btn : quiet} onClick={go} data-now-action={r.action}>{ACTION_WORDS[r.action]}</button>}
    </div>
    {r.action === "after" ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 0 38px" }}>
      {(meta.afterMeeting || []).filter(o => o.key !== "later" && o.key !== "lost").map(o => <button key={o.key} type="button" style={{ ...quiet, minHeight: 28, padding: "3px 9px", fontSize: 12.5 }} onClick={() => after(o.key)}>{o.label}</button>)}
      <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => open(r.open.type, r.open.id)}>Later or Lost…</button></div> : null}
    {r.propose ? <div style={{ margin: "6px 0 0 38px", fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-now-propose="1">
      <span style={{ opacity: 0.75 }}>Proposed next step:</span><b>{r.propose.body}, {dayWords(r.propose.due_on).replace(/, \d{4}$/, "")}</b>
      <button type="button" style={{ ...quiet, minHeight: 28, padding: "3px 10px" }} onClick={accept} data-now-accept="1">Accept</button></div> : null}
    {shown === "score" && r.score ? <div style={{ margin: "6px 0 0 38px", fontSize: 12.5, background: CREAM, borderRadius: 8, padding: "6px 10px" }} data-now-sum="1">
      {r.score.says}. {r.score.touch ? `Last touch ${whenWords(r.score.touch.at)}: ${r.score.touch.says || r.score.touch.kind}.` : "No touch yet: days are counted from when the deal was made."}
      {due ? " Due rows come first whatever their score." : ""}</div> : null}
    {shown === "email" && r.contactId ? <div style={{ marginLeft: 38 }}><EmailDraft contactId={r.contactId} orgId={r.orgId} dealId={r.dealId} onClose={() => setShown(null)} /></div> : null}
    {shown === "prep" && r.dealId ? <div style={{ marginLeft: 38 }}><Prep dealId={r.dealId} /></div> : null}
    {msg ? <div style={{ margin: "4px 0 0 38px", fontSize: 12.5 }}>{msg}</div> : null}
  </div>;
}

export default function NowView({ meta, open, startCalling, startList, refreshKey }) {
  const [d, setD] = useState(null);
  const [all, setAll] = useState(false);
  const load = useCallback(() => apiFetch("/ops/sales/now").then(setD).catch(e => setD({ ok: false, e })), []);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!d) return <section style={card}><p style={says}>Loading…</p></section>;
  if (d.ok === false) return <section style={card}><Failure e={d.e} fallback="Now could not be read. Try again in a minute." /></section>;
  const rows = all ? d.rows : d.rows.slice(0, 12);
  return <section style={card} data-sales-now="1">
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
      <h2 style={{ ...h2, fontSize: 20 }}>Now</h2>
      <span style={{ fontSize: 12.5, opacity: 0.7, flex: 1 }}>{d.rows.length === 1 ? "1 thing" : `${d.rows.length} things`} to do, most pressing first</span>
      {d.start && d.rows[0] && d.rows[0].action !== "call" ? <button type="button" style={btn} onClick={() => startCalling(null)} data-now-start="1">Start calling · {d.start.orgIds.length}</button> : null}
    </div>
    <WeekBar week={d.week} />
    {d.mailbox && !d.mailbox.connected ? <p style={{ ...says, opacity: 1, margin: "8px 0 0" }} data-now-no-mailbox="1"><span style={brassTag}>Mailbox</span> {d.mailbox.says.replace(/ Connect it in Sales settings\.$/, "")}{" "}
      <a href={d.mailbox.settings} style={{ ...link, fontSize: 12.5 }} data-now-connect-mailbox="1">Connect it in Sales settings.</a></p> : null}
    <div style={{ marginTop: 12 }}>{d.moved.map(m => <Moved key={m.id} m={m} onDone={load} />)}</div>
    {d.empty ? <div style={{ padding: "18px 0 6px" }} data-now-empty="1">
      <div style={{ fontSize: 15, fontWeight: 600 }}>{d.empty.says}{d.empty.listId ? <> <button type="button" style={{ ...link, fontSize: 15 }} onClick={() => startList(d.empty.listId)} data-now-empty-list={d.empty.listId}>→</button></> : "."}</div>
    </div> : <>
      <p style={{ ...says, margin: "8px 0 2px" }}>{d.sentences.order}</p>
      {rows.map((r, i) => <Row key={r.key} r={r} first={i === 0} startCalling={startCalling} open={open} meta={meta} reload={load} />)}
      {d.rows.length > rows.length ? <button type="button" style={{ ...link, marginTop: 6 }} onClick={() => setAll(true)}>Show all {d.rows.length}</button> : null}
    </>}
  </section>;
}
