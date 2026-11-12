// SALES-3 items 5-7 · Sales → Customers. One row per organization linked to a Steward org:
// plan, price, billing start or next charge, days to it, and a plain health line from counts and
// dates Steward already has (never a donor). Every fact opens what it counted. Per customer: the
// nurture rhythm (tasks only), a check-in log ("what annoyed you this week?", a line tagged bug
// goes to /ops's board), and proof: the testimonial and the references owed.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, CREAM, EMERALD, BRASS, card, h2, says, btn, quiet, box, link, brassTag, usd, dayWords, failureWords } from "./salesBits";

const FACT_ORDER = ["daysSinceSignIn", "signIns14", "people", "gifts30", "journeysOn", "dataHealthOpen"];
const T_WORDS = { none: "Not asked", asked: "Asked", received: "Received, not approved", approved: "Approved to publish" };
const STEP_WORDS = { named: "named", contacted: "contacted", meeting: "meeting", won: "won" };
const factValue = (k, v) => (v == null ? (k === "daysSinceSignIn" ? "never" : "–") : k === "daysSinceSignIn" ? `${v} day${v === 1 ? "" : "s"} ago` : Number(v).toLocaleString("en-US"));

function FactRows({ row, k, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    // A slower answer for the fact clicked before must never fill this one's panel.
    let live = true;
    setD(null);
    apiFetch(`/ops/sales/customers/${encodeURIComponent(row.salesOrgId)}/fact/${k}`).then(x => live && setD(x)).catch(() => live && setD({ failed: true }));
    return () => { live = false; };
  }, [row.salesOrgId, k]);
  return <div style={{ background: CREAM, borderRadius: 8, padding: "8px 10px", margin: "6px 0" }} data-fact-rows={k}>
    <div style={{ display: "flex", gap: 8 }}><b style={{ fontSize: 13, flex: 1 }}>{d && d.label ? d.label : "…"}</b><button type="button" style={{ ...link, fontSize: 12 }} onClick={onClose}>Close</button></div>
    {d && d.sentence ? <p style={{ ...says, margin: "2px 0 6px" }}>{d.sentence}</p> : null}
    {!d ? <p style={says}>Loading…</p> : d.failed ? <p style={says}>Could not be read.</p> : d.rows.length === 0 ? <p style={says}>Nothing counted.</p>
      : d.rows.map((r, i) => <div key={i} style={{ fontSize: 12.5, display: "flex", gap: 10 }}><span style={{ opacity: 0.7, minWidth: 92 }}>{dayWords(r.day)}</span><span>{r.says}</span></div>)}
  </div>;
}

function CheckIn({ row, prompt, onDone }) {
  const [lines, setLines] = useState([{ text: "", bug: false }]);
  const [msg, setMsg] = useState(null);
  const set = (i, x) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...x } : l)));
  const save = async () => {
    setMsg(null);
    try { const r = await apiFetch(`/ops/sales/customers/${encodeURIComponent(row.salesOrgId)}/checkin`, { method: "POST", body: JSON.stringify({ lines }) }); setLines([{ text: "", bug: false }]); setMsg(r.says); onDone(); }
    catch (e) { setMsg(failureWords(e, "Not logged.")); }
  };
  return <div data-checkin={row.salesOrgId}>
    <p style={says}>Ask: <b>"{prompt}"</b> One answer a line. Tick bug and it goes to the /ops board with {row.name} named.</p>
    {lines.map((l, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
      <input value={l.text} onChange={e => set(i, { text: e.target.value })} placeholder="What she said" aria-label={`Answer ${i + 1}`} style={{ ...box, flex: 1 }} data-checkin-line={i} />
      <label style={{ fontSize: 12.5, whiteSpace: "nowrap" }}><input type="checkbox" checked={l.bug} onChange={e => set(i, { bug: e.target.checked })} data-checkin-bug={i} /> bug</label>
    </div>)}
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" style={quiet} onClick={() => setLines(ls => [...ls, { text: "", bug: false }])}>Another line</button>
      <button type="button" style={btn} onClick={save} disabled={!lines.some(l => l.text.trim())} data-checkin-save="1">Log the check-in</button>
    </div>
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 6 }} data-checkin-msg="1">{msg}</p> : null}
  </div>;
}

function Proof({ row, open, onDone }) {
  const p = row.proof || { testimonial: { state: "none" }, referencesAsked: 0, referrals: [], counts: {} };
  const [text, setText] = useState(p.testimonial.text || "");
  const [refs, setRefs] = useState(String(p.referencesAsked || 0));
  const [msg, setMsg] = useState(null);
  const save = async body => {
    setMsg(null);
    try { await apiFetch(`/ops/sales/customers/${encodeURIComponent(row.salesOrgId)}/proof`, { method: "PUT", body: JSON.stringify(body) }); onDone(); }
    catch (e) { setMsg(failureWords(e, "Not saved.")); }
  };
  const t = p.testimonial;
  return <div data-proof={row.salesOrgId}>
    <div style={{ fontSize: 13 }}><b>Testimonial:</b> {T_WORDS[t.state]}{t.askedOn ? ` · asked ${dayWords(t.askedOn)}` : ""}{t.receivedOn ? ` · received ${dayWords(t.receivedOn)}` : ""}{t.approvedOn ? ` · approved ${dayWords(t.approvedOn)}` : ""}</div>
    <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Her words, once she sends them" aria-label="Testimonial" style={{ ...box, width: "100%", margin: "4px 0" }} data-proof-text="1" />
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {t.state === "none" ? <button type="button" style={quiet} onClick={() => save({ testimonial_state: "asked" })} data-proof-asked="1">Mark asked</button> : null}
      {t.state === "asked" || t.state === "none" ? <button type="button" style={quiet} onClick={() => save({ testimonial_state: "received", testimonial_text: text })} data-proof-received="1">Mark received</button> : null}
      {t.state === "received" ? <button type="button" style={btn} onClick={() => save({ testimonial_state: "approved", testimonial_text: text })} data-proof-approved="1">She approved it to publish</button> : null}
      {t.state !== "none" && text !== (t.text || "") ? <button type="button" style={quiet} onClick={() => save({ testimonial_text: text })}>Save the words</button> : null}
    </div>
    <div style={{ fontSize: 13, marginTop: 8 }}><b>References:</b> asked for{" "}
      <input value={refs} onChange={e => setRefs(e.target.value)} onBlur={() => Number(refs) !== p.referencesAsked && save({ references_asked: Number(refs) || 0 })} inputMode="numeric" aria-label="References asked for" style={{ ...box, width: 50 }} data-proof-refs="1" />
      {" "}· {p.counts.named || 0} named, {p.counts.contacted || 0} contacted, {p.counts.meeting || 0} met, {p.counts.won || 0} won</div>
    {p.referrals.map(r => <div key={r.dealId} style={{ fontSize: 12.5 }}><button type="button" style={link} onClick={() => open("deal", r.dealId)}>{r.name}</button> · {STEP_WORDS[r.step]}</div>)}
    <p style={{ ...says, marginTop: 4 }}>Name a reference with "Log a referral from this customer" on the organization: it becomes a deal, source Customer referral.</p>
    {msg ? <p style={{ ...says, opacity: 1 }}><span style={brassTag}>Not saved</span> {msg}</p> : null}
  </div>;
}

function Row({ row, data, open, reload }) {
  const [fact, setFact] = useState(null);
  const [panel, setPanel] = useState(null);   // checkin | proof
  const [msg, setMsg] = useState(null);
  const nurture = async () => { setMsg(null); try { const r = await apiFetch(`/ops/sales/customers/${encodeURIComponent(row.salesOrgId)}/nurture`, { method: "POST" }); setMsg(r.says); reload(); } catch (e) { setMsg(failureWords(e, "Not started.")); } };
  const b = row.billing;
  return <div style={{ padding: "12px 0", borderTop: `1px solid ${CREAM}` }} data-customer-row={row.salesOrgId}>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
      <button type="button" style={{ ...link, fontSize: 15 }} onClick={() => open("org", row.salesOrgId)}>{row.name}</button>
      <span style={{ fontSize: 12.5, opacity: 0.75 }}>{row.status || "no plan"} · {row.plan || "no plan"} · <span title={data.sentences.price}>{row.priceCents != null ? `${usd(row.priceCents)}/mo` : "no price"}</span></span>
      <button type="button" style={{ ...link, fontSize: 12.5, color: INK }} onClick={() => setFact(f => (f === "daysToStart" ? null : "daysToStart"))} title={data.facts.daysToStart.sentence} data-customer-billing="1">
        {b.on ? `${b.kind === "next" ? "Next charge" : "Billing starts"} ${dayWords(b.on)}${row.daysToStart != null ? ` (${row.daysToStart >= 0 ? `in ${row.daysToStart} days` : `${-row.daysToStart} days ago`})` : ""}` : "No billing day yet"}</button>
    </div>
    <div style={{ fontSize: 13.5, margin: "4px 0", padding: "4px 8px", borderRadius: 6, background: row.health.ok ? "transparent" : `${BRASS}22`, fontWeight: 600 }} data-customer-health={row.health.ok ? "ok" : "needs"} title={data.sentences.health}>{row.health.says}</div>
    {row.proof && row.proof.owes ? <div style={{ fontSize: 13, margin: "2px 0" }} data-customer-owes="1"><span style={brassTag}>proof</span> {row.proof.owes}</div> : null}
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5, margin: "4px 0" }}>
      {FACT_ORDER.map(k => <button key={k} type="button" style={{ ...link, fontWeight: 500, color: row.health.facts.includes(k) ? INK : EMERALD }} title={data.facts[k].sentence}
        onClick={() => setFact(f => (f === k ? null : k))} data-customer-fact={k}>{data.facts[k].label}: <b>{factValue(k, row.facts[k])}</b></button>)}
    </div>
    {fact ? <FactRows row={row} k={fact} onClose={() => setFact(null)} /> : null}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
      <button type="button" style={quiet} onClick={nurture} data-customer-nurture="1">Start the pilot rhythm</button>
      <button type="button" style={quiet} onClick={() => setPanel(p => (p === "checkin" ? null : "checkin"))} data-customer-checkin-open="1">Log a check-in</button>
      <button type="button" style={quiet} onClick={() => setPanel(p => (p === "proof" ? null : "proof"))} data-customer-proof-open="1">Testimonial and references</button>
    </div>
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 4 }} data-customer-msg="1">{msg}</p> : null}
    {panel === "checkin" ? <div style={{ marginTop: 8 }}><CheckIn row={row} prompt={data.prompt} onDone={reload} /></div> : null}
    {panel === "proof" ? <div style={{ marginTop: 8 }}><Proof key={JSON.stringify(row.proof)} row={row} open={open} onDone={reload} /></div> : null}
  </div>;
}

export default function CustomersView({ open }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => apiFetch("/ops/sales/customers").then(setData).catch(() => setData({ failed: true })), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <section style={card}><p style={says}>Loading…</p></section>;
  if (data.failed) return <section style={card}><p style={says}>The customers could not be read. Try again in a minute.</p></section>;
  return <section style={card} data-sales-customers="1">
    <h2 style={h2}>Customers</h2>
    <p style={says}>{data.sentences.board} {data.sentences.health} The rule is in Sales settings.</p>
    {data.rows.length === 0 ? <p style={says}>No organization is linked to a Steward org yet. Link one from its page (Steward account).</p>
      : data.rows.map(r => <Row key={r.salesOrgId} row={r} data={data} open={open} reload={load} />)}
  </section>;
}
