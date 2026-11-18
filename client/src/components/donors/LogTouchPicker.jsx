// client/src/components/donors/LogTouchPicker.jsx · EDIT-2 item 3. WHO DID YOU TALK TO? ONE, OR MANY.
//
// Log a touch's people picker (Donors). Clicking a name opens Log a touch for
// that one person, as it always has. Ticking the box beside names collects
// people across searches ("type and click 20 names"); then "Log one touch to N
// people" opens the batch dialog (BulkLogTouch.jsx).
import { useState } from "react";
import { T, Modal } from "../shared";
import { usePeoplePicker } from "../../lib/people";
import { BulkLogTouch, MAX_BATCH } from "./BulkLogTouch";

export function LogTouchPicker({ onClose, onPickOne, onBatchDone, noPeople }) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState([]);   // [{ id, name }]
  const [batch, setBatch] = useState(false);
  const [found] = usePeoplePicker(search, { match: "either", limit: 30, emptyToo: true, enabled: true });
  const has = id => picked.some(p => p.id === id);
  const toggle = d => setPicked(ps => (ps.some(p => p.id === d.id) ? ps.filter(p => p.id !== d.id) : ps.length >= MAX_BATCH ? ps : [...ps, { id: d.id, name: d.name }]));

  if (batch) return <BulkLogTouch ids={picked.map(p => p.id)} onClose={() => { setBatch(false); onClose && onClose(); }} onDone={onBatchDone} />;
  return (
    <Modal onClose={onClose} width={440} zIndex={300} align="top" padding={0}
      ariaLabel="Log a touch" dialogStyle={{ borderRadius: 16, border: "1px solid " + T.bg3, maxHeight: "70vh" }}>
      <div data-testid="log-touch-picker" style={{ display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "100%" }}>
        <div style={{ padding: "16px 18px 10px" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, marginBottom: 2 }}>Who did you talk to?</div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>Click a name for one person, or tick several to log the same touch to all of them.</div>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search donors…" aria-label="Search donors"
            style={{ width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          {picked.length > 0 && (
            <div data-testid="log-touch-picked" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {picked.map(p => (
                <button key={p.id} type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.name}`}
                  style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 999, padding: "3px 10px", fontSize: 12, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
                  {p.name} ×
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ overflowY: "auto", padding: "0 8px 10px" }}>
          {found.map(d => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 4 }} className="click-card">
              <input type="checkbox" checked={has(d.id)} onChange={() => toggle(d)} aria-label={`Pick ${d.name}`} data-testid="log-touch-pick"
                style={{ margin: "0 4px 0 10px", width: 16, height: 16, cursor: "pointer" }} />
              <button type="button" onClick={() => onPickOne(d)}
                style={{ flex: 1, display: "block", textAlign: "left", background: "none", border: "none", borderRadius: 8, padding: "9px 6px", cursor: "pointer" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{d.name}</span>
                {d.email && <span style={{ fontSize: 11.5, color: T.ink3, marginLeft: 8 }}>{d.email}</span>}
              </button>
            </div>
          ))}
          {noPeople && <div style={{ fontSize: 12.5, color: T.ink3, padding: "6px 10px 12px" }}>No donors yet. Import your donors first, then log the first call.</div>}
        </div>
        {picked.length > 0 && (
          <div style={{ borderTop: "1px solid " + T.bg3, padding: "10px 16px", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            {picked.length >= MAX_BATCH && <span style={{ fontSize: 12, color: T.ink3, marginRight: "auto" }}>{MAX_BATCH.toLocaleString("en-US")} is the most in one batch.</span>}
            <button type="button" data-testid="log-touch-picked-go" onClick={() => (picked.length === 1 ? onPickOne(picked[0]) : setBatch(true))}
              style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {picked.length === 1 ? `Log a touch with ${picked[0].name}` : `Log one touch to ${picked.length.toLocaleString("en-US")} people`}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
