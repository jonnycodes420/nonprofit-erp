// SALES-1 Part B · the Partners sub-tab: the partner report (deals sourced,
// won, MRR brought, owed, paid), each partner's page with its terms, its
// organizations, its payout ledger (mark a month paid with a day and a note)
// and its statement as CSV. Nothing is sent to a partner from here.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";
import { INK, CREAM, card, h2, says, btn, quiet, box, link, brassTag, usd, dayWords, downloadCsv } from "./salesBits";

const KINDS = [["finder", "Finder"], ["closer", "Closer"], ["reseller", "Reseller"], ["custom", "Custom"]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthWords = k => { const [y, m] = String(k).split("-").map(Number); return m ? `${MONTHS[m - 1]} ${y}` : k; };

function TermForm({ onAdd }) {
  const [t, setT] = useState({ kind: "finder", custom_name: "", how: "percent", amount: "", recurring: true, months: "", cap: "" });
  const add = () => onAdd({ kind: t.kind, custom_name: t.custom_name, recurring: t.recurring, months: t.months === "" ? null : Number(t.months),
    cap_cents: t.cap === "" ? null : Math.round(Number(t.cap) * 100),
    ...(t.how === "percent" ? { percent: Number(t.amount) } : { flat_cents: Math.round(Number(t.amount) * 100) }) });
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: CREAM, padding: 8, borderRadius: 8 }} data-term-form="1">
    <select value={t.kind} onChange={e => setT(x => ({ ...x, kind: e.target.value }))} style={box} aria-label="Type">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    {t.kind === "custom" ? <input value={t.custom_name} onChange={e => setT(x => ({ ...x, custom_name: e.target.value }))} placeholder="Name" style={{ ...box, width: 110 }} aria-label="Custom name" /> : null}
    <select value={t.how} onChange={e => setT(x => ({ ...x, how: e.target.value }))} style={box} aria-label="Percent or flat"><option value="percent">% of MRR</option><option value="flat">Flat $</option></select>
    <input value={t.amount} onChange={e => setT(x => ({ ...x, amount: e.target.value }))} placeholder={t.how === "percent" ? "10" : "250"} style={{ ...box, width: 70 }} aria-label="Amount" data-term-amount="1" />
    <select value={t.recurring ? "r" : "o"} onChange={e => setT(x => ({ ...x, recurring: e.target.value === "r" }))} style={box} aria-label="Recurring"><option value="r">Every month</option><option value="o">One-time</option></select>
    {t.recurring ? <input value={t.months} onChange={e => setT(x => ({ ...x, months: e.target.value }))} placeholder="months (blank: no end)" style={{ ...box, width: 150 }} aria-label="Months" /> : null}
    <input value={t.cap} onChange={e => setT(x => ({ ...x, cap: e.target.value }))} placeholder="cap $ (optional)" style={{ ...box, width: 120 }} aria-label="Cap" />
    <button type="button" style={btn} onClick={add} disabled={!t.amount} data-term-add="1">Add term</button>
  </div>;
}

function Ledger({ rows, reload }) {
  const [pay, setPay] = useState(null);   // { lineId, month, on, note }
  const [msg, setMsg] = useState(null);
  const save = async () => {
    setMsg(null);
    try { await apiFetch("/ops/sales/ledger/paid", { method: "POST", body: JSON.stringify({ lineId: pay.lineId, month: pay.month, paid_on: pay.on, note: pay.note }) }); setPay(null); reload(); }
    catch (e) { setMsg(e.message); }
  };
  const unpay = async (lineId, month) => { await apiFetch("/ops/sales/ledger/unpaid", { method: "POST", body: JSON.stringify({ lineId, month }) }); reload(); };
  if (!rows.length) return <p style={says}>No deal carries this partner yet.</p>;
  return <div data-sales-ledger="1">
    {rows.map(r => <div key={r.lineId} style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13 }}><b>{r.deal}</b> · {r.term}{r.paying ? ` · MRR now ${usd(r.mrrCents)}` : ""}</div>
      {!r.paying ? <div style={{ fontSize: 12.5, opacity: 0.7 }}>Nothing owed yet: the deal hasn't been won, or its organization isn't linked to a paying Steward org.</div> :
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, marginTop: 4 }}><tbody>{r.months.map(m => <tr key={m.month} data-ledger-month={`${r.lineId}:${m.month}`}>
          <td style={{ padding: "3px 12px 3px 0" }}>{monthWords(m.month)}</td><td style={{ padding: "3px 12px 3px 0" }}>{usd(m.owedCents)}{m.capped ? " (cap reached)" : ""}</td>
          <td style={{ padding: "3px 12px 3px 0" }}>{m.paid ? <span>Paid {dayWords(m.paid.on)}{m.paid.note ? ` · ${m.paid.note}` : ""} <button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.6 }} onClick={() => unpay(r.lineId, m.month)}>undo</button></span>
            : <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => setPay({ lineId: r.lineId, month: m.month, on: "", note: "" })} data-ledger-pay={`${r.lineId}:${m.month}`}>Mark paid</button>}</td>
        </tr>)}</tbody></table>}
    </div>)}
    {pay ? <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: CREAM, padding: 8, borderRadius: 8 }}>
      <b style={{ fontSize: 13 }}>{monthWords(pay.month)} paid on</b><DateInput value={pay.on} onChange={e => setPay(p => ({ ...p, on: e.target.value }))} style={box} aria-label="Paid on" />
      <input value={pay.note} onChange={e => setPay(p => ({ ...p, note: e.target.value }))} placeholder="Note (e.g. check 1042)" style={box} aria-label="Note" />
      <button type="button" style={btn} disabled={!pay.on} onClick={save}>Save</button><button type="button" style={quiet} onClick={() => setPay(null)}>Cancel</button></div> : null}
    {msg ? <p style={{ ...says, opacity: 1 }}><span style={brassTag}>Not saved</span> {msg}</p> : null}
  </div>;
}

function OrgPicker({ onPick }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return undefined; }
    const t = setTimeout(() => apiFetch(`/ops/sales/search?q=${encodeURIComponent(q)}`).then(d => setRes(d.results.filter(r => r.type === "org"))).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return <div style={{ marginTop: 6 }}>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Link an organization" aria-label="Link an organization" style={{ ...box, width: 280 }} data-partner-org-find="1" />
    {res.map(r => <button key={r.id} type="button" style={{ ...link, display: "block", padding: "3px 0" }} onClick={() => { setQ(""); onPick(r); }}>{r.name}</button>)}
  </div>;
}

function PartnerPage({ id, back, open }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => apiFetch(`/ops/sales/partners/${id}`).then(setD).catch(() => setD({ ok: false })), [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <section style={card}><p style={says}>Loading…</p></section>;
  if (d.ok === false) return <section style={card}><button type="button" style={link} onClick={back}>← Partners</button><p style={says}>This partner could not be read.</p></section>;
  const p = d.partner, r = d.report;
  const call = async (fn) => { setMsg(null); try { await fn(); load(); } catch (e) { setMsg(e.message); } };
  return <div data-sales-partner={id}>
    <button type="button" style={{ ...link, marginBottom: 8 }} onClick={back}>← Partners</button>
    <section style={card}>
      <h2 style={{ ...h2, fontSize: 19 }}>{p.name}</h2>
      <p style={says}>{[p.company, p.contact_name, p.contact_email, p.phone].filter(Boolean).join(" · ") || "No contact details yet."}</p>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", fontSize: 13 }}>
        {[["Deals sourced", r.dealsSourced, d.sentences.dealsSourced], ["Won", r.dealsWon, d.sentences.dealsWon], ["MRR brought", usd(r.mrrBroughtCents), d.sentences.mrrBrought],
          ["Owed", usd(r.owedCents), d.sentences.owed], ["Paid", usd(r.paidCents), d.sentences.paid], ["Due", usd(r.dueCents), d.sentences.due]]
          .map(([k, v, s]) => <div key={k} title={s}><div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div><div style={{ opacity: 0.7 }}>{k}</div></div>)}
      </div>
    </section>
    <section style={card}>
      <h2 style={h2}>Terms</h2>
      <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <input type="checkbox" checked={!!p.terms_stack} onChange={e => call(() => apiFetch(`/ops/sales/partners/${id}`, { method: "PATCH", body: JSON.stringify({ terms_stack: e.target.checked }) }))} data-terms-stack="1" />
        Terms stack (unticked: only one of this partner's terms applies to a deal)</label>
      {d.terms.map(t => <div key={t.id} style={{ fontSize: 13, padding: "4px 0", display: "flex", gap: 8 }} data-term={t.id}><b>{t.name}</b><span>{t.says}</span>
        <button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.6 }} onClick={() => call(() => apiFetch(`/ops/sales/terms/${t.id}`, { method: "DELETE" }))}>Remove</button></div>)}
      <TermForm onAdd={t => call(() => apiFetch(`/ops/sales/partners/${id}/terms`, { method: "POST", body: JSON.stringify(t) }))} />
      {msg ? <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not saved</span> {msg}</p> : null}
    </section>
    <section style={card}>
      <h2 style={h2}>Organizations</h2>
      {d.orgs.length ? d.orgs.map(o => <div key={o.id} style={{ fontSize: 13, padding: "3px 0" }}><button type="button" style={link} onClick={() => open("org", o.id)}>{o.name}</button>{" "}
        <button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.6 }} onClick={() => call(() => apiFetch(`/ops/sales/partners/${id}/orgs/remove`, { method: "POST", body: JSON.stringify({ org_id: o.id }) }))}>Unlink</button></div>)
        : <p style={says}>No organization linked yet.</p>}
      <OrgPicker onPick={o => call(() => apiFetch(`/ops/sales/partners/${id}/orgs`, { method: "POST", body: JSON.stringify({ org_id: o.id }) }))} />
    </section>
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h2 style={{ ...h2, flex: 1 }}>Payout ledger</h2>
        <button type="button" style={quiet} onClick={() => downloadCsv(`/ops/sales/statement/${id}`, `partner-statement.csv`).catch(e => setMsg(e.message))} data-partner-statement="1">Statement CSV</button></div>
      <p style={says}>{d.sentences.ledger}</p>
      <Ledger rows={d.ledger} reload={load} />
    </section>
  </div>;
}

export default function PartnersView({ open }) {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  const [n, setN] = useState({ name: "", company: "", contact_name: "", contact_email: "" });
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => apiFetch("/ops/sales/partners").then(setD).catch(() => setD({ ok: false })), []);
  useEffect(() => { load(); }, [load]);
  if (sel) return <PartnerPage id={sel} back={() => { setSel(null); load(); }} open={open} />;
  if (!d) return <section style={card}><p style={says}>Loading…</p></section>;
  if (d.ok === false) return <section style={card}><p style={says}>The partners could not be read.</p></section>;
  const add = async () => { setMsg(null); try { const r = await apiFetch("/ops/sales/partners", { method: "POST", body: JSON.stringify(n) }); setN({ name: "", company: "", contact_name: "", contact_email: "" }); setSel(r.id); } catch (e) { setMsg(e.message); } };
  return <section style={card} data-sales-partners="1">
    <h2 style={h2}>Partner report</h2>
    <p style={says}>{d.sentences.dealsSourced} {d.sentences.mrrBrought} {d.sentences.owed} {d.sentences.paid}</p>
    <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead><tr>{["Partner", "Terms", "Deals", "Won", "MRR brought", "Owed", "Paid", "Due"].map(h => <th key={h} style={{ textAlign: "left", fontSize: 12, fontWeight: 600, opacity: 0.65, padding: "0 10px 6px 0" }}>{h}</th>)}</tr></thead>
      <tbody>{d.partners.map(p => { const r = d.report.find(x => x.partnerId === p.id) || {};
        return <tr key={p.id} data-partner-row={p.id}>
          <td style={{ padding: "6px 10px 6px 0", borderTop: `1px solid ${CREAM}` }}><button type="button" style={link} onClick={() => setSel(p.id)}>{p.name}</button><div style={{ fontSize: 12, opacity: 0.7 }}>{p.company || ""}</div></td>
          <td style={{ borderTop: `1px solid ${CREAM}`, fontSize: 12.5 }}>{p.terms.map(t => `${t.name}: ${t.says}`).join("; ") || "–"}{p.terms.length > 1 ? (p.terms_stack ? " (stack)" : " (one per deal)") : ""}</td>
          {[r.dealsSourced, r.dealsWon, usd(r.mrrBroughtCents), usd(r.owedCents), usd(r.paidCents), usd(r.dueCents)].map((v, i) => <td key={i} style={{ borderTop: `1px solid ${CREAM}` }}>{v}</td>)}
        </tr>; })}</tbody>
    </table></div>
    {d.partners.length === 0 ? <p style={says}>No partner yet.</p> : null}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
      {[["name", "Partner name"], ["company", "Company"], ["contact_name", "Contact"], ["contact_email", "Contact email"]].map(([k, l]) =>
        <input key={k} value={n[k]} onChange={e => setN(x => ({ ...x, [k]: e.target.value }))} placeholder={l} aria-label={l} style={box} data-partner-new={k} />)}
      <button type="button" style={btn} onClick={add} disabled={!n.name.trim()} data-partner-add="1">Add partner</button>
    </div>
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not added</span> {msg}</p> : null}
  </section>;
}
