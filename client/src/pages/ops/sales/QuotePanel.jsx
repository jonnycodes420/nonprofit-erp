// SALES-3 item 1-3 · the quote on a deal. Pick the plan and add-ons (Sales settings → Plans),
// the monthly price (a reason below list), the day billing starts (Jan 1, 2027 by default), an
// optional setup fee and the term. Each save is a new version. "Copy link" makes the private
// page Jonathan sends himself; Steward sends nothing. Once a version is accepted, the signed
// agreement is here as a PDF, and what billing did (or why it couldn't) is said in words.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";
import { INK, CREAM, EMERALD, says, btn, quiet, box, link, brassTag, usd, dayWords, whenWords, downloadCsv, failureWords } from "./salesBits";

const lab = { display: "block", fontSize: 11, fontWeight: 700, opacity: 0.65, margin: "8px 0 2px" };
const STATE = { draft: "Draft, no link yet", open: "Link made, not signed", expired: "Link expired", superseded: "Replaced by a newer version", accepted: "Accepted" };

function QuoteForm({ data, last, onSaved, onCancel }) {
  const plans = data.plans.plans, addons = data.plans.addons;
  const [f, setF] = useState(() => ({
    plan: last ? last.plan_key : plans[0].key, addons: last ? last.addons.map(a => a.key) : [],
    price: last ? String(last.price_cents / 100) : "", reason: last ? last.below_list_reason || "" : "",
    start_on: last ? last.start_on : data.defaultStart, setup_fee: last && last.setup_fee_cents ? String(last.setup_fee_cents / 100) : "", term: last ? last.term : "month_to_month",
  }));
  const [err, setErr] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const plan = plans.find(p => p.key === f.plan) || plans[0];
  const listCents = plan.listCents + addons.filter(a => f.addons.includes(a.key)).reduce((n, a) => n + a.listCents, 0);
  const priceCents = f.price === "" ? listCents : Math.round(Number(String(f.price).replace(/[$,\s]/g, "")) * 100);
  const below = Number.isFinite(priceCents) && priceCents < listCents;
  const save = async () => {
    setErr(null);
    try { await apiFetch(`/ops/sales/deals/${encodeURIComponent(data.dealId)}/quotes`, { method: "POST", body: JSON.stringify(f) }); onSaved(); }
    catch (e) { setErr(failureWords(e, "Not saved.")); }
  };
  return <div data-quote-form="1">
    <label style={lab} htmlFor="q-plan">Plan</label>
    <select id="q-plan" value={f.plan} onChange={e => set("plan", e.target.value)} style={{ ...box, width: "100%" }} data-quote-plan="1">
      {plans.map(p => <option key={p.key} value={p.key}>{p.name} · {usd(p.listCents)}/mo</option>)}</select>
    {addons.length ? <><span style={lab}>Add-ons</span>{addons.map(a => <label key={a.key} style={{ display: "block", fontSize: 13 }}>
      <input type="checkbox" checked={f.addons.includes(a.key)} onChange={e => set("addons", e.target.checked ? [...f.addons, a.key] : f.addons.filter(k => k !== a.key))} /> {a.name} · {usd(a.listCents)}/mo</label>)}</> : null}
    <label style={lab} htmlFor="q-price">Monthly price ($) · list {usd(listCents)}</label>
    <input id="q-price" value={f.price} onChange={e => set("price", e.target.value)} placeholder={String(listCents / 100)} inputMode="decimal" style={{ ...box, width: "100%" }} data-quote-price="1" />
    {below ? <><label style={lab} htmlFor="q-reason">Why below list (kept here, not shown to her)</label>
      <input id="q-reason" value={f.reason} onChange={e => set("reason", e.target.value)} placeholder="family pricing, beta" style={{ ...box, width: "100%" }} data-quote-reason="1" /></> : null}
    <label style={lab} htmlFor="q-start">Billing starts</label>
    <DateInput id="q-start" value={f.start_on} onChange={e => set("start_on", e.target.value)} style={{ ...box, width: "100%" }} aria-label="Billing starts" data-quote-start="1" />
    <label style={lab} htmlFor="q-setup">Setup fee ($, optional, charged with the first monthly charge)</label>
    <input id="q-setup" value={f.setup_fee} onChange={e => set("setup_fee", e.target.value)} placeholder="none" inputMode="decimal" style={{ ...box, width: "100%" }} data-quote-setup="1" />
    <label style={lab} htmlFor="q-term">Term</label>
    <select id="q-term" value={f.term} onChange={e => set("term", e.target.value)} style={{ ...box, width: "100%" }}>
      {Object.entries(data.terms).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button type="button" style={btn} onClick={save} data-quote-save="1">Save as version {(last ? last.version : 0) + 1}</button>
      {onCancel ? <button type="button" style={quiet} onClick={onCancel}>Cancel</button> : null}
    </div>
    {err ? <p style={{ ...says, opacity: 1, marginTop: 6 }} data-quote-error="1"><span style={brassTag}>Not saved</span> {err}</p> : null}
  </div>;
}

function Version({ q, reload }) {
  const [link1, setLink] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const makeLink = async () => {
    setErr(null); setCopied(false);
    try {
      const r = await apiFetch(`/ops/sales/quotes/${encodeURIComponent(q.id)}/link`, { method: "POST" });
      const url = `${window.location.origin}${r.path}`;
      setLink({ url, says: r.says });
      try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* the field below can be copied by hand */ }
      reload();
    } catch (e) { setErr(failureWords(e, "No link made.")); }
  };
  const schedule = async () => { setErr(null); try { await apiFetch(`/ops/sales/quotes/${encodeURIComponent(q.id)}/schedule`, { method: "POST" }); reload(); } catch (e) { setErr(failureWords(e, "Not scheduled.")); } };
  const live = q.state === "draft" || q.state === "open" || q.state === "expired";
  return <div style={{ fontSize: 13, padding: "8px 0", borderTop: `1px solid ${CREAM}` }} data-quote-version={q.version} data-quote-state={q.state}>
    <div><b>Version {q.version}</b> · {q.plan_name} · <b>{usd(q.price_cents)}/mo</b>{q.price_cents < q.list_cents ? <span style={{ opacity: 0.7 }}> (list {usd(q.list_cents)}: {q.below_list_reason})</span> : null}</div>
    <div style={{ opacity: 0.75 }}>Starts {dayWords(q.start_on)}{q.setup_fee_cents ? ` · setup ${usd(q.setup_fee_cents)}` : ""} · {STATE[q.state]}{q.state === "open" ? `, link made ${whenWords(q.link_made_at)}` : ""}</div>
    {q.state === "accepted" ? <div style={{ marginTop: 4 }} data-quote-accepted="1">
      Signed by <b>{q.signer_name}</b>, {q.signer_title}, {whenWords(q.accepted_at)}.{" "}
      <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => downloadCsv(`/ops/sales/quotes/${encodeURIComponent(q.id)}/pdf`, `steward-quote-v${q.version}-signed.pdf`).catch(e => setErr(e.message))} data-quote-pdf="1">Signed agreement (PDF)</button>
      <div style={{ marginTop: 3 }} data-quote-billing="1">{q.billing_scheduled_at
        ? <>Billing scheduled: first charge {whenWords(q.billing_starts_at)}{q.card_saved_at ? `, ${q.card_brand || "card"} ending ${q.card_last4} on file` : ", no card on file yet"}.</>
        : <><span style={brassTag}>Billing not scheduled</span> {q.billing_error} <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={schedule} data-quote-schedule="1">Schedule billing</button></>}</div>
    </div> : null}
    {live ? <div style={{ marginTop: 6 }}>
      <button type="button" style={quiet} onClick={makeLink} data-quote-link="1">{q.state === "draft" ? "Copy link" : "Make a new link"}</button>
      {link1 ? <div style={{ marginTop: 6 }}><input readOnly value={link1.url} onFocus={e => e.target.select()} style={{ ...box, width: "100%" }} aria-label="Quote link" data-quote-url="1" />
        <p style={{ ...says, marginTop: 4 }}>{copied ? "Copied. " : ""}{link1.says}</p>
        <a href={`mailto:?subject=${encodeURIComponent("Your Steward quote")}&body=${encodeURIComponent(`Here is the quote we talked about:\n\n${link1.url}\n`)}`} style={{ ...link, fontSize: 12.5 }}>Open in my email</a></div> : null}
    </div> : null}
    {err ? <p style={{ ...says, opacity: 1 }}><span style={brassTag}>Not done</span> {err}</p> : null}
  </div>;
}

export default function QuotePanel({ dealId, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [making, setMaking] = useState(false);
  const load = useCallback(() => apiFetch(`/ops/sales/deals/${encodeURIComponent(dealId)}/quotes`).then(d => { setData({ ...d, dealId }); setErr(null); }).catch(e => setErr(e)), [dealId]);
  useEffect(() => { load(); }, [load]);
  if (err) return <p style={says}>The quotes could not be read.</p>;
  if (!data) return <p style={says}>Loading…</p>;
  const accepted = data.quotes.find(q => q.state === "accepted");
  const reload = () => { load(); onChanged(); };
  return <div data-sales-quotes="1">
    <p style={says}>{data.sentences.value} Steward sends nothing: copy the link, or open it in your own email.</p>
    {!accepted && (making || !data.quotes.length) ? <QuoteForm data={data} last={data.quotes[0] || null} onSaved={() => { setMaking(false); reload(); }} onCancel={data.quotes.length ? () => setMaking(false) : null} />
      : !accepted ? <button type="button" style={{ ...link, fontSize: 13, color: EMERALD }} onClick={() => setMaking(true)} data-quote-new="1">New version</button> : null}
    {data.quotes.map(q => <Version key={q.id} q={q} reload={reload} />)}
    <p style={{ ...says, marginTop: 8, color: INK }}>{data.sentences.price}</p>
  </div>;
}
