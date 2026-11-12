// SALES-2 items 9 and 10 · cadences: edited in Sales settings; a contact's running cadences on
// their page (enroll, or end by hand); and a customer's referral logged from their organization.
// Steps are tasks Jonathan does. Nothing is sent or dialled by Steward.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { CREAM, card, h2, says, btn, quiet, box, link, brassTag, dayWords, failureWords } from "./salesBits";

const ACTION_WORDS = { call: "Call", email: "Email", linkedin: "LinkedIn touch", custom: "Task" };
const END_WORDS = { reply: "they replied", connected: "a call reached them", meeting: "a meeting was booked", dnc: "Do not contact", ended: "ended by hand" };

function CadenceEditor({ c, templates, onSaved }) {
  const [name, setName] = useState(c.name);
  const [steps, setSteps] = useState(c.steps.map(s => ({ ...s })));
  const [msg, setMsg] = useState(null);
  const set = (i, patch) => setSteps(ss => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const save = async () => {
    setMsg(null);
    try { await apiFetch(c.id && !c.isNew ? `/ops/sales/cadences/${c.id}` : "/ops/sales/cadences", { method: c.id && !c.isNew ? "PUT" : "POST", body: JSON.stringify({ name, steps }) }); setMsg("Saved."); onSaved(); }
    catch (e) { setMsg(failureWords(e, "Not saved.")); }
  };
  return <div style={{ background: CREAM, borderRadius: 8, padding: 10, marginBottom: 10 }} data-cadence={c.id || "new"}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input value={name} onChange={e => setName(e.target.value)} style={{ ...box, flex: "1 1 220px" }} aria-label="Cadence name" disabled={!!c.builtin} />
      {c.builtin ? <span style={{ fontSize: 12, opacity: 0.7 }}>Built in: starts for a deal's people when it reaches Paying.</span> : null}
    </div>
    {steps.map((s, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
      <label style={{ fontSize: 12.5 }}>Day <input value={s.day} onChange={e => set(i, { day: e.target.value })} style={{ ...box, width: 56 }} aria-label="Day" /></label>
      <select value={s.action} onChange={e => set(i, { action: e.target.value })} style={box} aria-label="Action">{Object.entries(ACTION_WORDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {s.action === "email" ? <select value={s.template || ""} onChange={e => set(i, { template: e.target.value || undefined })} style={box} aria-label="Template">
        <option value="">no template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select> : null}
      <input value={s.text || ""} onChange={e => set(i, { text: e.target.value })} placeholder={s.action === "custom" ? "What to do" : "Note (optional)"} style={{ ...box, flex: "1 1 160px" }} aria-label="Step text" />
      <button type="button" style={{ ...link, fontSize: 12 }} onClick={() => setSteps(ss => ss.filter((_, j) => j !== i))}>Remove</button>
    </div>)}
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" style={quiet} onClick={() => setSteps(ss => [...ss, { day: (ss.at(-1) || { day: 0 }).day, action: "call" }])}>Add a step</button>
      <button type="button" style={btn} onClick={save} data-cadence-save={c.id || "new"}>Save</button>{msg ? <span style={{ fontSize: 13 }}>{msg}</span> : null}
    </div>
  </div>;
}

export function CadenceSettings({ meta }) {
  const [d, setD] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => apiFetch("/ops/sales/cadences").then(setD).catch(() => setD({ ok: false })), []);
  useEffect(() => { load(); }, [load]);
  return <section style={card} data-sales-cadences="1">
    <h2 style={h2}>Cadences</h2>
    <p style={says}>A cadence is a list of steps, each a day and an action. Enrolling a contact makes each step a task on its day; you do every one of them. A reply from them, a call that reaches them, a booked meeting, or Do not contact ends it and closes what's left.</p>
    {!d ? <p style={says}>Loading…</p> : d.ok === false ? <p style={says}>The cadences could not be read.</p> : <>
      {d.cadences.map(c => <CadenceEditor key={c.id} c={c} templates={meta.settings.templates} onSaved={load} />)}
      {adding ? <CadenceEditor c={{ id: "new", isNew: true, name: "", steps: [{ day: 0, action: "call" }] }} templates={meta.settings.templates} onSaved={() => { setAdding(false); load(); }} />
        : <button type="button" style={quiet} onClick={() => setAdding(true)}>New cadence</button>}
      <p style={{ ...says, marginTop: 8 }}>{d.running.length === 1 ? "1 contact is" : `${d.running.length} contacts are`} in a cadence right now.</p>
    </>}
  </section>;
}

// On a contact's page.
export function ContactCadences({ contactId, reload }) {
  const [d, setD] = useState(null);
  const [cads, setCads] = useState([]);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => Promise.all([apiFetch(`/ops/sales/contacts/${contactId}/cadences`), apiFetch("/ops/sales/cadences")])
    .then(([a, b]) => { setD(a.enrollments); setCads(b.cadences.filter(c => !c.builtin)); }).catch(() => setD([])), [contactId]);
  useEffect(() => { load(); }, [load]);
  const enroll = async () => { setMsg(null); try { const r = await apiFetch(`/ops/sales/cadences/${pick}/enroll`, { method: "POST", body: JSON.stringify({ contactIds: [contactId] }) }); setMsg(r.enrolled ? "Enrolled: its steps are tasks now." : `Not enrolled: ${r.skipped.map(s => s.says).join("; ")}.`); load(); reload(); } catch (e) { setMsg(failureWords(e, "Not enrolled.")); } };
  const end = async () => { setMsg(null); try { await apiFetch("/ops/sales/cadences/end", { method: "POST", body: JSON.stringify({ contactId }) }); load(); reload(); } catch (e) { setMsg(failureWords(e, "Not ended.")); } };
  if (!d) return <p style={says}>Loading…</p>;
  const live = d.filter(e => !e.ended_at);
  return <div data-contact-cadences={contactId}>
    {d.length === 0 ? <p style={says}>Not in a cadence.</p> : d.map(e => <div key={e.id} style={{ fontSize: 13, padding: "4px 0" }} data-enrollment={e.id}>
      <b>{e.cadence}</b> · since {dayWords(e.started_on)}{e.ended_at ? <span style={{ opacity: 0.7 }}> · ended: {END_WORDS[e.end_reason] || e.end_reason}</span> : <span> · {e.open_steps} steps left</span>}</div>)}
    {live.length ? <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={end} data-cadence-end="1">End {live.length === 1 ? "it" : "them"} now</button> : null}
    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
      <select value={pick} onChange={e => setPick(e.target.value)} style={{ ...box, flex: 1 }} aria-label="Cadence" data-cadence-pick="1"><option value="">Add to a cadence…</option>{cads.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button type="button" style={quiet} disabled={!pick} onClick={enroll} data-cadence-enroll="1">Enroll</button>
    </div>
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 6 }}>{msg}</p> : null}
  </div>;
}

// On a customer's organization: a referral they gave.
export function CustomerReferral({ orgId, open }) {
  const [f, setF] = useState({ orgName: "", contactName: "", email: "", phone: "", note: "" });
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const go = async () => {
    setMsg(null);
    try { const r = await apiFetch("/ops/sales/referrals", { method: "POST", body: JSON.stringify({ fromOrgId: orgId, ...f }) }); setF({ orgName: "", contactName: "", email: "", phone: "", note: "" }); setMsg({ ok: true, dealId: r.dealId }); }
    catch (e) { setMsg({ ok: false, says: failureWords(e, "Not logged.") }); }
  };
  return <div data-customer-referral={orgId}>
    <p style={says}>Someone this customer introduced you to. It becomes a deal in Lead, source "Customer referral", naming this customer, with a call-within-the-hour task.</p>
    {[["orgName", "Their organization"], ["contactName", "Who to talk to"], ["email", "Email"], ["phone", "Phone"], ["note", "Note"]].map(([k, l]) =>
      <input key={k} value={f[k]} onChange={e => set(k, e.target.value)} placeholder={l} aria-label={l} style={{ ...box, width: "100%", marginBottom: 6 }} data-referral-field={k} />)}
    <button type="button" style={quiet} onClick={go} disabled={!f.orgName.trim() && !f.contactName.trim()} data-customer-referral-go="1">Log the referral</button>
    {msg ? (msg.ok ? <p style={{ ...says, opacity: 1, marginTop: 6 }}>Logged. <button type="button" style={link} onClick={() => open("deal", msg.dealId)}>Open the deal</button></p>
      : <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not logged</span> {msg.says}</p>) : null}
  </div>;
}
