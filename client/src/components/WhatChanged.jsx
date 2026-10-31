// client/src/components/WhatChanged.jsx · LIVE-1. "What changed", under Agent.
//
// Every import, giving-source read and QuickBooks read leaves a readout here:
// what it told us, newest first, kept by date. Each line is a count that opens
// its rows (a <Figure> on the "readout-line" source), one sentence of Why, and
// one action that makes the real thing (tasks, thank-you drafts) or opens the
// group or Data health. A line can be dismissed; a kind dismissed three times
// running moves to the bottom and says so, and one click puts it back.
//
// Below the readouts: What worked (gifts that came after a readout action,
// never claimed as caused by it) and what Steward has learned about this
// organisation, each rule with its one-sentence Why.
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Figure } from "./Figure";
import { errorMessage } from "../lib/domainError";
import { displayDateShort } from "../../../shared/displayDate";

// ── Shared consts, above everything that reads them (the TDZ rule) ─────────
const SERIF = "'DM Serif Display',Georgia,serif";
const CARD = { background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: "18px 20px", marginBottom: 16 };
const BTN = { background: T.white, border: "1.5px solid " + T.ink, borderRadius: 8, padding: "6px 12px", color: T.ink,
              fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" };
const LINK = { background: "none", border: "none", padding: 0, color: T.ink3, fontSize: 12, cursor: "pointer",
               textDecoration: "underline", fontFamily: "inherit" };
const LEAD_COUNT = /^[\d,]+\s+/;

function WhyToggle({ text, testid }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <button type="button" style={LINK} aria-expanded={on} data-testid={testid} onClick={() => setOn(v => !v)}>Why</button>
      {on && <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 4, lineHeight: 1.5, flexBasis: "100%" }}>{text}</div>}
    </>
  );
}

function ReadoutLine({ ro, line, isReadOnly, onDone, onNavigate }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(line.acted ? "Done." : "");
  const act = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/readouts/${ro.id}/lines/${line.kind}/act`, { method: "POST", body: "{}" });
      if (r.open && onNavigate) {
        if (r.open.tab === "groups") onNavigate("groups", r.open.groupId ? { groupId: r.open.groupId } : {});
        else onNavigate("donors", { view: "health" });
        return;
      }
      setSaid(r.sentence || "Done.");
    } catch (e) { setSaid(errorMessage(e, "That did not work. Nothing was made.")); }
    setBusy(false);
  };
  const dismiss = async () => {
    setBusy(true);
    try { await apiFetch(`/readouts/${ro.id}/lines/${line.kind}/dismiss`, { method: "POST", body: "{}" }); onDone(); }
    catch (e) { setSaid(errorMessage(e, "That did not work.")); setBusy(false); }
  };
  const restore = async () => {
    try { await apiFetch(`/readout-kinds/${line.kind}/restore`, { method: "POST", body: "{}" }); onDone(); }
    catch (e) { setSaid(errorMessage(e, "That did not work.")); }
  };
  return (
    <li data-testid={`readout-line-${line.kind}`} style={{ padding: "12px 0", borderTop: "1px solid " + T.bg2, listStyle: "none" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 12px" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 14.5, color: T.ink, lineHeight: 1.5 }}>
          <Figure variant="inline" value={line.count} kind="count" label={line.sentence} definition={line.why}
            source={{ key: "readout-line", params: { readout: ro.id, kind: line.kind } }} figureKey={`readout-${line.kind}`}/>
          {" "}{line.sentence.replace(LEAD_COUNT, "")}.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          {!said && line.actionLabel && <button type="button" style={{ ...BTN, opacity: isReadOnly || busy ? 0.5 : 1 }} disabled={isReadOnly || busy}
            data-testid={`readout-act-${line.kind}`} onClick={act}>{line.actionLabel}</button>}
          {!ro.isExample && <button type="button" style={LINK} disabled={isReadOnly || busy} onClick={dismiss}
            data-testid={`readout-dismiss-${line.kind}`}>Dismiss</button>}
          <WhyToggle text={line.why} testid={`readout-why-${line.kind}`}/>
        </div>
      </div>
      {said && <div data-testid={`readout-said-${line.kind}`} style={{ fontSize: 12.5, color: T.greenDk, marginTop: 4 }}>{said}</div>}
      {line.demoted && (
        <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>
          {line.demotedWhy}{" "}<button type="button" style={LINK} onClick={restore} data-testid={`readout-restore-${line.kind}`}>Put it back</button>
        </div>
      )}
    </li>
  );
}

export function WhatChanged({ isReadOnly, onNavigate, wide }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    apiFetch("/readouts").then(d => { setData(d); setErr(""); }).catch(e => setErr(errorMessage(e, "What changed did not load.")));
  }, []);
  useEffect(() => { load(); }, [load]);
  const restoreKind = async kind => { try { await apiFetch(`/readout-kinds/${kind}/restore`, { method: "POST", body: "{}" }); load(); } catch (e) { setErr(errorMessage(e, "That did not work.")); } };

  if (err) return <div data-testid="what-changed-error" style={{ color: T.gold700, fontSize: 14 }}>{err}</div>;
  if (!data) return <div style={{ color: T.ink3, fontSize: 14 }}>Loading what changed…</div>;
  const { readouts = [], whatWorked, learned = {} } = data;
  return (
    <div data-testid="agent-view-changed" style={{ maxWidth: 860 }}>
      <div style={{ fontSize: 14, color: T.ink2, lineHeight: 1.55, margin: "0 0 18px" }}>
        Every import and every read from a giving source or your books leaves a readout here: what it told us, each line counted from your own records and opening the people behind it.
      </div>

      {whatWorked && whatWorked.sentence && (
        <section style={{ ...CARD, borderLeft: "3px solid " + T.greenDk }} data-testid="what-worked">
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>What worked</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline", marginTop: 6 }}>
            <div style={{ fontFamily: SERIF, fontSize: wide ? 20 : 18, color: T.ink, flex: "1 1 280px" }}>{whatWorked.sentence}</div>
            <WhyToggle text={whatWorked.why} testid="what-worked-why"/>
          </div>
        </section>
      )}

      {readouts.length === 0 ? (
        <section style={CARD} data-testid="what-changed-empty">
          <div style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 6 }}>Nothing to tell yet.</div>
          <div style={{ color: T.ink3, fontSize: 14, lineHeight: 1.55 }}>When you import a file, or Steward reads a giving source or your books, it says here who came back, who gave more, who stopped and what to do about each one.</div>
        </section>
      ) : readouts.map(ro => (
        <section key={ro.id} style={CARD} data-testid="readout">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 22 : 19, margin: 0, color: T.ink }}>{ro.title}</h2>
            <div style={{ fontSize: 12, color: T.ink3 }}>
              {ro.isExample && <span data-testid="readout-example" style={{ border: "1px solid " + T.gold, color: T.gold700, borderRadius: 999, padding: "1px 8px", marginRight: 8, fontWeight: 700 }}>Example</span>}
              {displayDateShort(ro.forDate, new Date())}
            </div>
          </div>
          {ro.lines.length === 0
            ? <div style={{ fontSize: 13.5, color: T.ink3, marginTop: 8 }}>Every line on this readout was dismissed.</div>
            : <ul style={{ margin: "10px 0 0", padding: 0 }}>{ro.lines.map(l => (
                <ReadoutLine key={l.kind} ro={ro} line={l} isReadOnly={isReadOnly || ro.isExample} onDone={load} onNavigate={onNavigate}/>))}</ul>}
        </section>
      ))}

      <section style={CARD} data-testid="what-steward-learned">
        <div style={{ fontFamily: SERIF, fontSize: 19, color: T.ink, marginBottom: 4 }}>What Steward has learned</div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 8 }}>Rules and counts only. Each one says where it came from.</div>
        {!(learned.fileMappings || []).length && !(learned.values || []).length && !(learned.demoted || []).length && (
          <div style={{ fontSize: 13.5, color: T.ink2 }}>Nothing yet. Map a file once and the next one with the same columns maps itself.</div>
        )}
        <ul style={{ margin: 0, padding: 0 }}>
          {(learned.fileMappings || []).map(m => (
            <li key={m.id} style={{ listStyle: "none", padding: "8px 0", borderTop: "1px solid " + T.bg2, display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, color: T.ink, flex: "1 1 260px" }}>{m.sentence}{m.isExample ? " (example)" : ""}</span>
              <WhyToggle text={m.why}/>
            </li>
          ))}
          {(learned.values || []).map(v => (
            <li key={v.id} style={{ listStyle: "none", padding: "8px 0", borderTop: "1px solid " + T.bg2, display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, color: T.ink, flex: "1 1 260px" }}>{v.sentence}</span>
              <WhyToggle text={v.why}/>
            </li>
          ))}
          {(learned.demoted || []).map(d => (
            <li key={d.kind} style={{ listStyle: "none", padding: "8px 0", borderTop: "1px solid " + T.bg2, display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, color: T.ink, flex: "1 1 260px" }}>{d.sentence}</span>
              <button type="button" style={LINK} disabled={isReadOnly} onClick={() => restoreKind(d.kind)} data-testid={`learned-restore-${d.kind}`}>Put it back</button>
              <WhyToggle text={d.why}/>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default WhatChanged;
