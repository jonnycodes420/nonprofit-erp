// SALES-4 item 3 · Sales → Pipeline: the deals as a board, one column per stage with its count
// and dollar total. The board is the Deals list's own (Board.jsx), read from the same rows.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { card, says, Failure } from "./salesBits";
import Board from "./Board";

export default function PipelineView({ meta, open, onChanged }) {
  const [d, setD] = useState(null);
  const load = useCallback(() => apiFetch(`/ops/sales/list/deal?view=${encodeURIComponent(JSON.stringify({ sort: { key: "value_cents", dir: "desc" } }))}`).then(setD).catch(e => setD({ ok: false, e })), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <section style={card}><p style={says}>Loading…</p></section>;
  if (d.ok === false) return <section style={card}><Failure e={d.e} fallback="The pipeline could not be read." /></section>;
  return <section style={card} data-sales-pipeline="1"><Board rows={d.rows} meta={meta} open={open} onMoved={() => { load(); onChanged(); }} /></section>;
}
