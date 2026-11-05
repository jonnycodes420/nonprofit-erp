// components/BulkJourney.jsx · DATES-1. "Add to a journey" on the Donors list's
// bulk bar: pick a journey, see who will start and who will not and why, then
// start. The server starts each person through the same path the profile's
// "Add to a journey" uses; over 2,000 people it runs on the queue and this
// dialog follows its progress. One Undo for the batch, for 30 days.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { Modal, T } from "./shared";

const POLL_MS = 1500;
const btn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: "none", border: "none", padding: "9px 6px", color: T.ink3, fontSize: 13, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 3 };
const fmt = n => Number(n || 0).toLocaleString("en-US");

function Lines({ lines, testid, title = "Who won't start, and why" }) {
  if (!lines || !lines.length) return null;
  return (
    <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3 }}>{title}</div>
      {lines.map(l => <div key={l.reason} data-testid={testid + "-line"} data-reason={l.reason} style={{ fontSize: 13, color: T.ink, lineHeight: 1.45 }}>{l.sentence}</div>)}
    </div>
  );
}

export function BulkAddToJourney({ ids, disabled, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="bulk-add-to-journey" onClick={() => setOpen(true)} disabled={disabled || !ids.length}
        style={{ background: "transparent", border: "1px solid " + T.gold500, borderRadius: 8, padding: "7px 12px", color: T.gold500, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
        Add to a journey
      </button>
      {open && <BulkJourneyModal ids={ids} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function BulkJourneyModal({ ids: idsAtOpen, onClose, onDone }) {
  // The people checked when it opened: the list reloading behind the dialog
  // must not change who the preview and the start are about.
  const [ids] = useState(() => idsAtOpen.slice());
  const [journeys, setJourneys] = useState(null);
  const [pick, setPick] = useState("");
  const [preview, setPreview] = useState(null);
  const [batch, setBatch] = useState(null);
  const [undone, setUndone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    // FLOWS-1 item 1: each journey with, for these people, who can start it
    // and why not, so a row is either choosable or says why on itself.
    apiFetch("/journeys/batch-options", { method: "POST", body: JSON.stringify({ donorIds: ids }) })
      .then(r => { if (alive.current) setJourneys((r && r.journeys) || []); })
      .catch(e => { if (alive.current) { setJourneys([]); setErr((e && e.sentence) || errorMessage(e, "Steward could not load your journeys.")); } });
  }, [ids]);
  useEffect(() => {
    if (!pick) { setPreview(null); return; }
    setPreview(null); setErr("");
    apiFetch(`/journeys/${encodeURIComponent(pick)}/batch/preview`, { method: "POST", body: JSON.stringify({ donorIds: ids }) })
      .then(r => { if (alive.current) setPreview(r); })
      .catch(e => { if (alive.current) setErr((e && e.sentence) || errorMessage(e, "Steward could not work out who would start.")); });
  }, [pick, ids]);
  // A batch on the queue: follow it until it is done.
  useEffect(() => {
    if (!batch || batch.status !== "running") return undefined;
    const t = setTimeout(() => {
      apiFetch(`/journeys/batches/${encodeURIComponent(batch.batchId)}`)
        .then(r => { if (alive.current) { setBatch(r); if (r.status !== "running" && onDone) onDone(); } })
        .catch(e => { if (alive.current) setErr(errorMessage(e, "Steward lost track of the batch. It is still running.")); });
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [batch, onDone]);

  const start = async () => {
    if (!pick || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/journeys/${encodeURIComponent(pick)}/batch`, { method: "POST", body: JSON.stringify({ donorIds: ids }) });
      setBatch(r);
      if (r.status !== "running" && onDone) onDone();
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "Nobody was started.")); }
    setBusy(false);
  };
  const undo = async () => {
    if (!batch || busy) return;
    setBusy(true); setErr("");
    try { const r = await apiFetch(`/journeys/batches/${encodeURIComponent(batch.batchId)}/undo`, { method: "POST", body: "{}" }); setUndone(r); if (onDone) onDone(); }
    catch (e) { setErr((e && e.sentence) || errorMessage(e, "That did not undo.")); }
    setBusy(false);
  };

  const running = batch && batch.status === "running";
  const pct = running && batch.asked ? Math.round((batch.done / batch.asked) * 100) : 0;
  const footer = (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
      {!batch && <button type="button" onClick={onClose} style={quiet}>Cancel</button>}
      {!batch && <button type="button" data-testid="bulk-journey-start" onClick={start} disabled={!preview || !preview.willStart || busy}
        style={{ ...btn, opacity: !preview || !preview.willStart || busy ? 0.5 : 1 }}>
        {busy ? "Starting…" : preview ? `Start ${fmt(preview.willStart)} ${preview.willStart === 1 ? "person" : "people"}` : "Start"}
      </button>}
      {batch && !running && !undone && batch.canUndo && batch.started > 0 && <button type="button" data-testid="bulk-journey-undo" onClick={undo} disabled={busy} style={quiet}>{busy ? "Undoing…" : "Undo"}</button>}
      {batch && !running && <button type="button" data-testid="bulk-journey-close" onClick={onClose} style={btn}>Done</button>}
    </div>
  );
  return (
    <Modal onClose={running ? () => {} : onClose} title="Add to a journey" subtitle={`${fmt(ids.length)} ${ids.length === 1 ? "person" : "people"} checked`} width={520} footer={footer} ariaLabel="Add to a journey">
      <div data-testid="bulk-journey" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!batch && <>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3 }}>Which journey</div>
          {!journeys && <div style={{ fontSize: 13, color: T.ink3 }}>Loading your journeys…</div>}
          {journeys && journeys.length > 0 && <div role="radiogroup" aria-label="Which journey" data-testid="bulk-journey-rows" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {journeys.map(j => {
              const on = pick === j.id;
              return (
                <button key={j.id} type="button" role="radio" aria-checked={on} aria-disabled={!j.canPick}
                  data-testid="bulk-journey-row" data-journey={j.id} data-can-pick={j.canPick ? "1" : "0"}
                  onClick={() => { if (j.canPick) setPick(j.id); }}
                  style={{ textAlign: "left", background: on ? T.bg : T.white, border: "1px solid " + (on ? T.greenDk : T.bg3), borderRadius: 9,
                    padding: "9px 12px", cursor: j.canPick ? "pointer" : "default", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: j.canPick ? T.ink : T.ink3 }}>{j.name}{j.stateNote && j.state !== "running" ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {j.stateNote}</span> : null}</span>
                  <span data-testid="bulk-journey-row-why" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.4 }}>{j.why}</span>
                </button>
              );
            })}
          </div>}
          {journeys && !journeys.length && <div style={{ fontSize: 13, color: T.ink3 }}>Make a journey first, in Journeys. Then come back and add these people to it.</div>}
          {pick && !preview && !err && <div style={{ fontSize: 13, color: T.ink3 }}>Working out who would start…</div>}
          {preview && <div data-testid="bulk-journey-preview" style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" }}>
            <div data-testid="bulk-journey-sentence" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5, fontWeight: 600 }}>{preview.sentence}</div>
            <Lines lines={preview.lines} testid="bulk-journey-skips" />
            {preview.runsAsJob && <div data-testid="bulk-journey-job-note" style={{ fontSize: 12.5, color: T.ink3, marginTop: 10 }}>That is a big list, so it runs in the background. You can watch it here, and you can close this and come back.</div>}
          </div>}
        </>}
        {running && <div data-testid="bulk-journey-progress">
          <div style={{ fontSize: 14, color: T.ink, marginBottom: 8 }}>{batch.sentence}</div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 8, background: T.bg2, borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: pct + "%", height: "100%", background: T.greenDk, transition: "width .4s" }} />
          </div>
        </div>}
        {batch && !running && !undone && <div data-testid="bulk-journey-result">
          <div data-testid="bulk-journey-result-sentence" style={{ fontSize: 14, color: T.ink, fontWeight: 600, lineHeight: 1.5 }}>{batch.sentence}</div>
          <Lines lines={batch.lines} testid="bulk-journey-result-skips" title="Who didn't start, and why" />
          {batch.canUndo && batch.started > 0 && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 10 }}>Nothing was sent. You can undo this for 30 days, here or from the journey in Journeys.</div>}
        </div>}
        {undone && <div data-testid="bulk-journey-undone" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{undone.sentence}</div>}
        {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
      </div>
    </Modal>
  );
}

// The batches added to one journey from the Donors list, still undoable, for
// the journey's own page.
export function JourneyBatches({ journeyId }) {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/journeys/batches").then(r => setRows(((r && r.batches) || []).filter(b => b.journeyId === journeyId && b.canUndo && b.started > 0))).catch(() => setRows([]));
  useEffect(() => { load(); }, [journeyId]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length && !msg) return null;
  const undo = async b => {
    try { const r = await apiFetch(`/journeys/batches/${encodeURIComponent(b.batchId)}/undo`, { method: "POST", body: "{}" }); setMsg(r.sentence || ""); load(); }
    catch (e) { setMsg((e && e.sentence) || errorMessage(e, "That did not undo.")); }
  };
  return (
    <div data-testid="journey-batches" style={{ fontSize: 12.5, color: T.ink2, display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
      {rows.map(b => <div key={b.batchId}>{b.sentence} Added from the Donors list. <button type="button" onClick={() => undo(b)} data-testid="journey-batch-undo" style={{ ...quiet, padding: 0, fontSize: 12.5 }}>Undo</button></div>)}
      {msg && <div>{msg}</div>}
    </div>
  );
}
