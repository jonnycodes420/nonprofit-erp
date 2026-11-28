// REPORTS-6 item 2 · ANY REPORT'S ROWS BECOME AN ACTION IN ONE CLICK.
//
// "Do something with these N people", under every report and the builder's
// results: add to calls (the Plan calls path, POST /threads/plan), make a
// group (kept in step with the report, or a fixed list), add to a journey
// (the journeys' bulk add, with its own Undo) or start a mailing draft (never
// sent). The count comes from the server (GET /report-people, the same
// function every action runs), each dialog states it before anything runs,
// and each action offers Undo. Rows that are gifts or funds act on the
// people behind them, and the bar says so.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { offerUndo } from "../EditHistory";
import { BulkAddToJourney } from "../BulkJourney";
import { orgTodayCivil } from "../../lib/orgToday";
import { addCivilDays } from "../../../../shared/threadShape";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box

const BTN = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const CHIP = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left" };
const FIELD = { padding: "8px 10px", borderRadius: 8, border: "1px solid " + T.bg3, background: T.white, color: T.ink, fontSize: 13, boxSizing: "border-box", width: "100%" };
const people = n => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;

export function ReportActions({ spec }) {
  const key = JSON.stringify(spec || null);
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(null);   // "menu" | "calls" | "group" | "mailing"
  const [ids, setIds] = useState(null);
  useEffect(() => {
    if (!spec) return;
    let alive = true;
    setInfo(null); setIds(null); setOpen(null);
    apiFetch(`/report-people?spec=${encodeURIComponent(key)}`).then(r => { if (alive) setInfo(r); }).catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [key]);
  if (!spec || !info) return null;
  if (info.cannot) return <div data-testid="report-actions-cannot" style={{ fontSize: 12, color: T.ink3, margin: "6px 0 10px" }}>{info.cannot}</div>;
  if (!info.count) return null;
  const loadIds = async () => { if (ids) return ids; const r = await apiFetch(`/report-people?ids=1&spec=${encodeURIComponent(key)}`); setIds(r.ids || []); return r.ids || []; };
  const openMenu = async () => { setOpen("menu"); loadIds().catch(() => {}); };
  return (
    <div data-testid="report-actions" style={{ margin: "8px 0 12px" }}>
      <button type="button" data-testid="report-actions-open" onClick={openMenu} style={BTN}>{info.headline}</button>
      {info.sentence && <span data-testid="report-actions-behind" style={{ fontSize: 12, color: T.ink3, marginLeft: 10 }}>{info.sentence}</span>}
      {info.capped && <span style={{ fontSize: 12, color: T.ink3, marginLeft: 10 }}>The report shows its first rows; this acts on the people in them.</span>}
      {open && <Modal onClose={() => setOpen(null)} width={500} ariaLabel="Do something with these people" dialogStyle={{ background: T.bg, borderRadius: 14 }}>
        {open === "menu" && <div data-testid="report-actions-menu">
          <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, color: T.ink }}>{info.headline}</div>
          {info.sentence && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3 }}>{info.sentence}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            <button type="button" data-testid="ra-calls" style={CHIP} onClick={() => setOpen("calls")}>Add to calls: a call step on the Thread for each of them</button>
            <button type="button" data-testid="ra-group" style={CHIP} onClick={() => setOpen("group")}>Make a group</button>
            <div style={{ ...CHIP, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span>Add to a journey</span>
              {ids ? <BulkAddToJourney ids={ids} onDone={() => setOpen(null)} /> : <span style={{ fontSize: 12, color: T.ink3 }}>Loading…</span>}
            </div>
            <button type="button" data-testid="ra-mailing" style={CHIP} onClick={() => setOpen("mailing")}>Start a mailing draft (nothing is sent)</button>
          </div>
        </div>}
        {open === "calls" && <CallsForm info={info} loadIds={loadIds} onClose={() => setOpen(null)} />}
        {open === "group" && <GroupForm info={info} spec={spec} onClose={() => setOpen(null)} />}
        {open === "mailing" && <MailingForm info={info} spec={spec} onClose={() => setOpen(null)} />}
      </Modal>}
    </div>
  );
}

function Head({ title, children }) {
  return <>
    <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, color: T.ink }}>{title}</div>
    <div data-testid="ra-count-sentence" style={{ fontSize: 12.5, color: T.ink2, marginTop: 4, lineHeight: 1.5 }}>{children}</div>
  </>;
}

function CallsForm({ info, loadIds, onClose }) {
  const [label, setLabel] = useState("Call");
  const [due, setDue] = useState(addCivilDays(orgTodayCivil(), 7));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const tooMany = info.count > info.callsMax;
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const donorIds = await loadIds();
      const r = await apiFetch("/threads/plan", { method: "POST", body: JSON.stringify({ donorIds, label, due }) });
      const threadIds = ((r.details && r.details.planned) || []).map(p => p.threadId).filter(Boolean);
      offerUndo({ message: `Planned ${r.planned} ${r.planned === 1 ? "call" : "calls"}${r.skipped ? `; ${r.skipped} already had an open step and kept it` : ""}.`,
        undoAction: () => apiFetch("/report-people/calls/undo", { method: "POST", body: JSON.stringify({ threadIds }) }) }, "calls");
      onClose();
    } catch (e) { setErr(errorMessage(e, "The calls were not planned.")); }
    setBusy(false);
  };
  return <div data-testid="ra-calls-form">
    <Head title="Add to calls">This opens a step on the Thread for {people(info.count)}, due on the day you pick. Anyone who already has an open step keeps it. Nothing is sent.</Head>
    {tooMany && <div style={{ fontSize: 13, color: T.ink, marginTop: 10 }}>That is more than {info.callsMax} people at once. Narrow the report first.</div>}
    <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
      <label style={{ flex: 2 }}><span style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>The step</span><input style={FIELD} value={label} onChange={e => setLabel(e.target.value)} /></label>
      <label style={{ flex: 1 }}><span style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>Due</span><DateInput style={FIELD} value={due} onChange={e => setDue(e.target.value)} /></label>
    </div>
    {err && <div style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{err}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
      <button type="button" data-testid="ra-calls-go" disabled={busy || tooMany || !label.trim()} style={{ ...BTN, opacity: busy || tooMany ? 0.6 : 1 }} onClick={go}>{busy ? "Planning…" : `Plan ${people(info.count)}`}</button>
      <button type="button" style={CHIP} onClick={onClose}>Cancel</button>
    </div>
  </div>;
}

function GroupForm({ info, spec, onClose }) {
  const [keep, setKeep] = useState("in_step");
  const [name, setName] = useState(String(spec.label || "From a report").slice(0, 60));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/report-people/group", { method: "POST", body: JSON.stringify({ spec, keep, name }) });
      offerUndo({ message: r.message, undoAction: () => apiFetch(r.undo.path, { method: "DELETE" }) }, "group");
      onClose();
    } catch (e) { setErr(errorMessage(e, "The group was not made.")); }
    setBusy(false);
  };
  return <div data-testid="ra-group-form">
    <Head title="Make a group">A group of the {people(info.count)} on this report, to use in a mailing, a journey or the Donors list.</Head>
    <label style={{ display: "block", marginTop: 14 }}><span style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>Name</span><input style={FIELD} value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>
    <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, fontSize: 13, color: T.ink }}>
      <label><input type="radio" data-testid="ra-group-instep" checked={keep === "in_step"} onChange={() => setKeep("in_step")} /> Keep it in step with the report: whoever is on the report when the group is read.</label>
      <label><input type="radio" data-testid="ra-group-fixed" checked={keep === "fixed"} onChange={() => setKeep("fixed")} /> A fixed list: these {people(info.count)}, as they are today.</label>
    </div>
    {err && <div style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{err}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
      <button type="button" data-testid="ra-group-go" disabled={busy || !name.trim()} style={{ ...BTN, opacity: busy ? 0.6 : 1 }} onClick={go}>{busy ? "Making…" : "Make the group"}</button>
      <button type="button" style={CHIP} onClick={onClose}>Cancel</button>
    </div>
  </div>;
}

function MailingForm({ info, spec, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/report-people/mailing", { method: "POST", body: JSON.stringify({ spec }) });
      setDone(r);
      offerUndo({ message: r.message, undoAction: () => apiFetch(r.undo.path, { method: "POST", body: "{}" }) }, "mailing draft");
    } catch (e) { setErr(errorMessage(e, "The mailing draft was not started.")); }
    setBusy(false);
  };
  return <div data-testid="ra-mailing-form">
    <Head title="Start a mailing draft">An email draft addressed to the {people(info.count)} on this report. It is a draft: nothing is sent until you write it and press Send in Email.</Head>
    {done && <div data-testid="ra-mailing-done" style={{ fontSize: 13, color: T.greenDk, fontWeight: 600, marginTop: 12 }}>{done.message}</div>}
    {err && <div style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{err}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
      {!done && <button type="button" data-testid="ra-mailing-go" disabled={busy} style={{ ...BTN, opacity: busy ? 0.6 : 1 }} onClick={go}>{busy ? "Starting…" : `Start a draft to ${people(info.count)}`}</button>}
      <button type="button" style={CHIP} onClick={onClose}>{done ? "Close" : "Cancel"}</button>
    </div>
  </div>;
}
