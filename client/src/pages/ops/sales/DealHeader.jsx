// SALES-4 item 3 · the deal page's header: stage, value, next step and last touch at a glance,
// a proposed next step accepted with one click, and any stage move the calendar made, with Undo.
// SALES-6: the Price tile names an open quote whose price differs ("Use $149 as the deal value", with
// Undo) and says when a price was signed; Send to sign is the deal's one way to a signature; with no
// mailbox connected, Last touch says email can't count yet.
import { useCallback, useEffect, useState } from "react";
import { useLive } from "../../../lib/liveRead";
import { apiFetch } from "../../../api";
import { INK, WHITE, CREAM, EMERALD, BRASS, quiet, link, usd, dayWords, whenWords, failureWords } from "./salesBits";
import SendToSign from "./SendToSign";

export default function DealHeader({ id, reloadKey, onChanged }) {
  const [h, setH] = useState(null);
  const [msg, setMsg] = useState(null);
  const [undo, setUndo] = useState(null);
  const load = useCallback(() => apiFetch(`/ops/sales/deals/${encodeURIComponent(id)}/header`).then(d => setH(d.header)).catch(() => setH(null)), [id]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useLive("sales.deal-header", ["sales", "org"], load);   // SALES-5: a saved value, an order or billing re-reads the header
  if (!h) return null;
  const post = async (path, body) => { setMsg(null); setUndo(null); try { const r = await apiFetch(path, { method: "POST", body: JSON.stringify(body) }); setMsg(r.says || null); if (r.undo) setUndo(r.undo); load(); onChanged(); return r; } catch (e) { setMsg(failureWords(e, "Not done.")); return null; } };
  const undoValue = async () => { setMsg(null); try { await apiFetch(`/ops/sales/rec/deal/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(undo) }); setUndo(null); setMsg(`Undone: the deal's value is ${usd(undo.value_cents)}/mo again.`); load(); onChanged(); } catch (e) { setMsg(failureWords(e, "Not undone.")); } };
  const settings = () => { window.location.assign(h.mailbox.settings); };
  const tile = (label, main, sub, testid, brass = false) => <div style={{ background: brass ? `${BRASS}33` : WHITE, borderRadius: 10, padding: "10px 12px", border: `1px solid ${brass ? BRASS : `${INK}14`}` }} data-deal-head={testid}>
    <div style={{ fontSize: 11.5, opacity: 0.65 }}>{label}</div><div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{main}</div>{sub ? <div style={{ fontSize: 12.5, opacity: 0.8 }}>{sub}</div> : null}</div>;
  const noNext = h.stageKind === "open" && !h.nextStep && !h.hasOpenTask;
  return <div style={{ background: CREAM, borderRadius: 12, padding: 12, marginBottom: 14 }} data-deal-header={id}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
      {tile("Stage", h.stage || "–", `${h.probability}% likely${h.org ? ` · ${h.org}` : ""}`, "stage")}
      <div title={`${h.priceSays || ""}. ${h.sentences.price || ""}`}>{tile("Price", h.priceTile ? h.priceTile.main : `${usd(h.valueCents)}/mo`,
        <>{h.priceTile ? h.priceTile.sub : h.priceSays ? h.priceSays.replace(/^\$[\d,.]+\/mo, /, "") : ""}{h.stageKind === "open" && !h.billing && h.probability ? ` · ${usd(Math.round((h.valueCents * h.probability) / 100))}/mo weighted` : ""}{h.dealDiffers ? ` · the deal's own value ${usd(h.dealValueCents)} is not used` : ""}
          {h.openQuote && h.priceSource === "deal" ? <div><button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => post(`/ops/sales/deals/${encodeURIComponent(id)}/use-quote-price`, {})} data-deal-use-quote="1">Use {usd(h.openQuote.cents)} as the deal value</button></div> : null}</>, "value", !!h.openQuote)}</div>
      <div title="The monthly price times 12.">{tile("ARR", usd(h.arrCents), "the monthly price × 12", "arr")}</div>
      {tile("Next step", h.nextStep || h.nextUp || "None", h.nextStepOn ? dayWords(h.nextStepOn) : h.nextUpOn ? `Task due ${dayWords(h.nextUpOn)}` : noNext ? "Nothing planned" : null, "next", noNext)}
      {tile("Last touch", h.lastTouch ? h.lastTouch.reason : "None yet", <>{h.lastTouch ? `${whenWords(h.lastTouch.at)} · ${h.lastTouch.says || h.lastTouch.kind}` : h.mailbox && !h.mailbox.connected ? null : h.sentences.lastTouch}
        {h.mailbox && !h.mailbox.connected ? <div data-deal-no-mailbox="1">{h.mailbox.says.replace(/ Connect it in Sales settings\.$/, "")} <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={settings} data-deal-connect-mailbox="1">Connect it in Sales settings.</button></div> : null}</>, "touch")}
    </div>
    {h.sendToSign ? <div style={{ marginTop: 10, fontSize: 13 }} data-deal-send="1">
      {h.sendToSign.ready ? <><SendToSign dealId={id} label={h.sendToSign.sent ? "Send a new link to sign" : "Send to sign"} onDone={() => { load(); onChanged(); }} />
        <span style={{ marginLeft: 8, opacity: 0.8 }}>Quote version {h.sendToSign.version}. {h.sendToSign.says}</span></>
        : <span style={{ opacity: 0.8 }}><b>Send to sign</b> isn't ready: {h.sendToSign.says}</span>}
    </div> : null}
    {h.propose ? <div style={{ marginTop: 10, fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-deal-propose="1">
      <span style={{ opacity: 0.75 }}>Proposed next step:</span><b>{h.propose.body}, {dayWords(h.propose.due_on)}</b>
      <button type="button" style={{ ...quiet, minHeight: 28, padding: "3px 10px", borderColor: EMERALD, color: EMERALD }} onClick={() => post(`/ops/sales/deals/${encodeURIComponent(id)}/next-step`, h.propose)} data-deal-accept="1">Accept</button></div> : null}
    {h.moved.map(m => <div key={m.id} style={{ marginTop: 8, fontSize: 13 }} data-deal-moved={m.id}>{m.why}: moved from {m.from} to {m.to} on {whenWords(m.at)}.{" "}
      <button type="button" style={{ ...link, fontSize: 13 }} onClick={() => post(`/ops/sales/auto-moves/${encodeURIComponent(m.id)}/undo`, {})} data-deal-undo={m.id}>Undo</button></div>)}
    {msg ? <div style={{ marginTop: 6, fontSize: 12.5 }} data-deal-head-msg="1">{msg}{undo ? <> <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={undoValue} data-deal-value-undo="1">Undo</button></> : null}</div> : null}
  </div>;
}
