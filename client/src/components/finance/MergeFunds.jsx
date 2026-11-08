// TRUTH-3 item 5 · MERGE FUNDS. Funds are a managed list: "General" and
// "General Operating" are one fund in two names. She picks the fund to keep
// and the ones to fold into it, sees what will move (gifts, lines, pages…),
// confirms, and can Undo. server/finance/fundMerge.js does the work.
import { useState, useEffect } from "react";
import { T, Card, SectionLabel } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";

const btn = (primary) => ({ background: primary ? T.green : "transparent", color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" });

export default function MergeFunds({ funds, onChanged, isReadOnly }) {
  const live = (funds || []).filter(f => !f.retired_at);
  const [keeper, setKeeper] = useState("");
  const [merge, setMerge] = useState([]);
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const [near, setNear] = useState([]);
  useEffect(() => { apiFetch("/finance/funds/near-duplicates").then(r => setNear(r.groups || [])).catch(() => setNear([])); }, [funds]);
  if (isReadOnly || live.length < 2) return null;
  const body = () => JSON.stringify({ keeperId: keeper, mergeIds: merge });
  const look = () => { setErr(""); setDone(null); apiFetch("/finance/funds/merge/preview", { method: "POST", body: body() }).then(setPreview).catch(e => setErr(errorMessage(e))); };
  const go = () => apiFetch("/finance/funds/merge", { method: "POST", body: body() })
    .then(r => { setDone(r); setPreview(null); setMerge([]); onChanged && onChanged(); }).catch(e => setErr(errorMessage(e)));
  const undo = () => apiFetch(`/finance/funds/merge/${done.mergeId}/undo`, { method: "POST", body: "{}" })
    .then(r => { setDone({ ...done, undone: r.sentence }); onChanged && onChanged(); }).catch(e => setErr(errorMessage(e)));
  return (
    <Card>
      <SectionLabel>Merge funds</SectionLabel>
      <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10, lineHeight: 1.6 }}>
        Two funds that are one fund in different words become one. Pick the fund to keep, then the ones to fold into it. You see what moves before anything changes, and you can undo it.
      </div>
      {near.map((g, i) => <div key={i} data-testid="fund-near-duplicate" style={{ fontSize: 12.5, color: T.ink, marginBottom: 6 }}>{g.sentence}</div>)}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 6 }}>
        <label style={{ fontSize: 12.5, color: T.ink }}>Keep{" "}
          <select data-testid="merge-keeper" value={keeper} onChange={e => { setKeeper(e.target.value); setMerge(m => m.filter(x => x !== e.target.value)); setPreview(null); }}>
            <option value="">Pick a fund</option>
            {live.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        {keeper && live.filter(f => f.id !== keeper).map(f => (
          <label key={f.id} style={{ fontSize: 12.5, color: T.ink }}>
            <input type="checkbox" checked={merge.includes(f.id)} onChange={e => { setMerge(m => e.target.checked ? [...m, f.id] : m.filter(x => x !== f.id)); setPreview(null); }} /> {f.name}
          </label>))}
        <button type="button" style={btn(false)} disabled={!keeper || !merge.length} onClick={look} data-testid="merge-preview">See what moves</button>
      </div>
      {preview && <div style={{ marginTop: 10, fontSize: 13, color: T.ink }}>
        <div data-testid="merge-preview-sentence">{preview.sentence}</div>
        <button type="button" data-commit style={{ ...btn(true), marginTop: 8 }} onClick={go} data-testid="merge-confirm">Merge</button>
      </div>}
      {done && <div style={{ marginTop: 10, fontSize: 13, color: T.ink }}>
        <span data-testid="merge-done">{done.undone || done.sentence}</span>
        {!done.undone && <button type="button" style={{ ...btn(false), marginLeft: 8 }} onClick={undo} data-testid="merge-undo">Undo</button>}
      </div>}
      {err && <div style={{ marginTop: 8, fontSize: 12.5, color: T.ink }}>{err}</div>}
    </Card>
  );
}
