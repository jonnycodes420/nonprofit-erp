// SALES-1 · one organization, contact or deal. The giving page editor's rails
// (StewardEditor's RailSection): properties on the left, edited where they
// show; the activity timeline in the middle; linked records on the right (an
// organization's contacts and deals, a contact's organizations and deals, a
// deal's organization and contacts). A linked Steward org shows its facts box,
// and a deal from Verbal yes on shows ONBOARD-2's five gates, read-only.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { RailSection, useNarrow } from "../../../components/StewardEditor";
import { INK, WHITE, CREAM, EMERALD, BRASS, TERRA, card, h2, says, btn, quiet, box, link, brassTag, usd, dayWords, whenWords, TYPE_WORDS, InlineField, fieldsOf, valueAt, Failure, failureWords } from "./salesBits";
import EmailDraft from "./EmailDraft";
import MeetingForm from "./MeetingForm";
import { ContactCadences, CustomerReferral } from "./Cadences";
import Timeline from "./Timeline";
import NewRecord from "./NewRecord";
import DealPartners from "./DealPartners";

const PLURAL = { org: "Organizations", contact: "Contacts", deal: "Deals" };
const SIDES = { org: ["contact", "deal"], contact: ["org", "deal"], deal: ["org", "contact"] };
const GATES = [["paper", "Paper"], ["data", "Data in"], ["connections", "Connections"], ["kickoff", "Kickoff"], ["first_month", "First month"]];

// Find a record of one type by name, for linking or merging.
function Picker({ type, onPick, label, exclude = [] }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return undefined; }
    const t = setTimeout(() => apiFetch(`/ops/sales/search?q=${encodeURIComponent(q)}`).then(d => setRes(d.results.filter(r => r.type === type && !exclude.includes(r.id)))).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [q, type, exclude]);
  return <div style={{ marginTop: 6 }}>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder={label} aria-label={label} style={{ ...box, width: "100%" }} data-sales-picker={type} />
    {res.map(r => <button key={r.id} type="button" style={{ ...link, display: "block", padding: "4px 0" }} onClick={() => { setQ(""); onPick(r); }}>{r.name}{r.hint ? <span style={{ opacity: 0.6, fontWeight: 400 }}> · {r.hint}</span> : null}</button>)}
  </div>;
}

function Linked({ type, id, side, rows, meta, open, reload }) {
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState(null);
  const call = async (path, body, method = "POST") => {
    setErr(null);
    try { await apiFetch(path, { method, body: JSON.stringify(body) }); reload(); } catch (e) { setErr(e.message); }
  };
  const pair = other => ({ from: { type, id }, to: { type: side, id: other } });
  return <div style={{ padding: "12px 16px", borderBottom: `1px solid ${CREAM}` }} data-sales-linked={side}>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <b style={{ fontSize: 13, flex: 1 }}>{PLURAL[side]} <span style={{ opacity: 0.6, fontWeight: 500 }}>{rows.length}</span></b>
      <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => setAdding(a => !a)} data-sales-link-add={side}>Link</button>
      <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => setCreating(c => !c)}>New</button>
    </div>
    {rows.map(r => <div key={r.id} style={{ fontSize: 13, padding: "6px 0", borderTop: `1px solid ${CREAM}` }} data-linked-row={r.id}>
      <button type="button" style={link} onClick={() => open(side, r.id)}>{r.displayName}</button>
      {r.primary ? <span style={{ fontSize: 11, marginLeft: 6, padding: "0 6px", borderRadius: 8, background: EMERALD, color: WHITE }}>primary</span> : null}
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        {side === "deal" ? `${r.stage_name || "–"} · ${usd(r.value_cents)}` : side === "contact" ? [r.title, (r.emails || [])[0]].filter(Boolean).join(" · ") : r.domain || ""}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
        <input defaultValue={r.label || ""} placeholder="Label, e.g. Champion" aria-label={`Label for ${r.displayName}`} style={{ ...box, fontSize: 12, padding: "3px 6px", width: 140 }}
          onBlur={e => { if ((e.target.value || "") !== (r.label || "")) call("/ops/sales/link", { ...pair(r.id), label: e.target.value }, "PATCH"); }} />
        {side === "org" && type !== "org" && !r.primary ? <button type="button" style={{ ...link, fontSize: 12 }} onClick={() => call("/ops/sales/link", { ...pair(r.id), primary: true }, "PATCH")}>Make primary</button> : null}
        <button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.7 }} onClick={() => call("/ops/sales/unlink", pair(r.id))} data-sales-unlink={r.id}>Unlink</button>
      </div>
    </div>)}
    {adding ? <div><input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)" style={{ ...box, width: "100%", marginTop: 6 }} aria-label="Label" />
      <Picker type={side} label={`Find ${PLURAL[side].toLowerCase()}`} exclude={rows.map(r => r.id)} onPick={r => { call("/ops/sales/link", { ...pair(r.id), label }); setAdding(false); setLabel(""); }} /></div> : null}
    {creating ? <NewRecord type={side} meta={meta} links={[{ type, id }]} onDone={() => { setCreating(false); reload(); }} onCancel={() => setCreating(false)} /> : null}
    {err ? <div style={{ fontSize: 12 }}><span style={brassTag}>Not done</span> {err}</div> : null}
  </div>;
}

function StewardBox({ s, orgId, reload, canLink }) {
  const [err, setErr] = useState(null);
  const set = async sid => { setErr(null); try { await apiFetch(`/ops/sales/orgs/${encodeURIComponent(orgId)}/steward`, { method: "POST", body: JSON.stringify({ stewardOrgId: sid }) }); reload(); } catch (e) { setErr(e.message); } };
  const [cands, setCands] = useState([]);
  const [q, setQ] = useState("");
  useEffect(() => { if (!canLink || s || q.trim().length < 2) { setCands([]); return undefined; }
    const t = setTimeout(() => apiFetch(`/ops/sales/steward-orgs?q=${encodeURIComponent(q)}`).then(d => setCands(d.orgs)).catch(() => {}), 200); return () => clearTimeout(t); }, [q, s, canLink]);
  if (!s) return canLink ? <div><p style={says}>Link this organization to the Steward org it became, to see its sign-ins, its people count and its MRR here.</p>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a Steward org" style={{ ...box, width: "100%" }} aria-label="Find a Steward org" data-sales-steward-find="1" />
    {cands.map(c => <button key={c.id} type="button" style={{ ...link, display: "block", padding: "4px 0" }} onClick={() => set(c.id)}>{c.name} <span style={{ opacity: 0.6, fontWeight: 400 }}>{c.id}</span></button>)}
    {err ? <div style={{ fontSize: 12 }}>{err}</div> : null}</div> : <p style={says}>The primary organization isn't linked to a Steward org.</p>;
  if (s.missing) return <p style={says}>Linked to {s.stewardOrgId}, which no longer exists.</p>;
  const row = (k, v, sentence) => <div style={{ fontSize: 13, padding: "4px 0" }} title={sentence}><span style={{ opacity: 0.7 }}>{k}:</span> <b>{v}</b></div>;
  return <div data-sales-steward-facts={s.stewardOrgId}>
    <div style={{ fontSize: 13, marginBottom: 4 }}>Steward org: <b>{s.name}</b> <span style={{ opacity: 0.6 }}>({s.status || "no plan"})</span></div>
    {row("Last sign-in", s.lastSignInAt ? whenWords(s.lastSignInAt) : "nobody yet", s.sentences.lastSignIn)}
    {row("People imported", s.peopleImported.toLocaleString("en-US"), s.sentences.people)}
    {row("Trial or beta ends", s.trialEndsOn ? dayWords(s.trialEndsOn) : "–", s.sentences.trial)}
    {row("MRR", s.mrrNowCents == null ? "not paying yet" : usd(s.mrrNowCents), s.sentences.mrr)}
    <p style={{ ...says, marginTop: 6 }}>Counts and dates only; no donor's name or gift is read here.</p>
    {canLink ? <button type="button" style={{ ...link, fontSize: 12 }} onClick={() => set(null)}>Unlink</button> : null}
  </div>;
}

function Gates({ o }) {
  return <div data-sales-gates="1">
    <div style={{ fontSize: 13, marginBottom: 6 }}>Onboarding: <b>{o.title}</b>{o.red ? <span style={{ ...brassTag, marginLeft: 6 }}>past its window</span> : null}</div>
    {GATES.map(([k, t]) => { const g = o.gates[k] || {}; return <div key={k} style={{ fontSize: 13, display: "flex", gap: 6, padding: "3px 0" }} data-gate={k}>
      <span aria-hidden style={{ color: g.met ? EMERALD : BRASS, fontWeight: 700 }}>{g.met ? "✓" : "•"}</span><span>{t}{g.met && (g.day || g.at) ? ` · ${dayWords(g.day || g.at)}` : ""}</span></div>; })}
    {o.next ? <p style={{ ...says, marginTop: 6 }}>Next: {o.next}</p> : null}
    <p style={says}>Read from the Onboarding tab; it moves on signals there, not here.</p>
  </div>;
}

// SALES-2 item 4: Do not contact, with its reason and day. It takes the record out of every
// call queue, cadence and list export; lifting it is a deliberate second step.
function DoNotContact({ type, id, r, reload }) {
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState(null);
  const call = async body => { setErr(null); try { await apiFetch(`/ops/sales/rec/${type}/${encodeURIComponent(id)}/dnc`, { method: "POST", body: JSON.stringify(body) }); setReason(""); setSure(false); reload(); } catch (e) { setErr(failureWords(e, "Not saved.")); } };
  if (r.dnc_at) return <div data-sales-dnc-rail="1">
    <p style={says}>Marked {whenWords(r.dnc_at)} by {r.dnc_by_name}: {r.dnc_reason}</p>
    {sure ? <span style={{ fontSize: 12.5 }}>Put them back in queues, cadences and exports?{" "}<button type="button" style={{ ...quiet, minHeight: 28 }} onClick={() => call({ clear: true })} data-sales-dnc-clear="1">Yes, lift it</button></span>
      : <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => setSure(true)}>Lift Do not contact…</button>}
    {err ? <div style={{ fontSize: 12 }}>{err}</div> : null}
  </div>;
  return <div>
    <p style={says}>Takes {type === "org" ? "this organization and its people" : "this person"} out of every call queue, cadence and list export, for good, until you lift it.</p>
    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why (kept with the flag)" aria-label="Reason for Do not contact" style={{ ...box, width: "100%" }} data-sales-dnc-reason="1" />
    <button type="button" style={{ ...quiet, marginTop: 6 }} disabled={!reason.trim()} onClick={() => call({ reason })} data-sales-dnc-set="1">Mark Do not contact</button>
    {err ? <div style={{ fontSize: 12 }}>{err}</div> : null}
  </div>;
}

function Merge({ type, id, onMerged }) {
  const [other, setOther] = useState(null);
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    try { await apiFetch(`/ops/sales/merge/${type}`, { method: "POST", body: JSON.stringify({ keep: id, merge: other.id }) }); setOther(null); onMerged(); } catch (e) { setErr(e.message); }
  };
  return <div>
    <p style={says}>Merge another {TYPE_WORDS[type].toLowerCase()} into this one: its links, activities and email move here, its empty fields fill this one's, and the merge is recorded.</p>
    {other ? <div style={{ fontSize: 13 }}>Merge <b>{other.name}</b> into this one?{" "}
      <button type="button" style={{ ...btn, background: TERRA, padding: "4px 10px", minHeight: 28 }} onClick={go} data-sales-merge-go="1">Yes, merge</button>{" "}
      <button type="button" style={{ ...quiet, minHeight: 28 }} onClick={() => setOther(null)}>Cancel</button></div>
      : <Picker type={type} exclude={[id]} label={`Find the ${TYPE_WORDS[type].toLowerCase()} to merge in`} onPick={setOther} />}
    {err ? <div style={{ fontSize: 12 }}>{err}</div> : null}
  </div>;
}

export default function RecordPage({ type, id, meta, open, onBack, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [doing, setDoing] = useState(null);   // SALES-2: "email" | "meeting"
  const narrow = useNarrow();
  const load = useCallback(() => apiFetch(`/ops/sales/rec/${type}/${encodeURIComponent(id)}`).then(r => { setD(r); setErr(null); })
    .catch(e => setErr(e)), [type, id]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged(); };
  if (err) return <section style={card}><button type="button" style={link} onClick={onBack}>← Back</button><Failure e={err} fallback={err.status === 404 ? "This record was deleted or merged." : "This record could not be read."} /></section>;
  if (!d) return <section style={card}><p style={says}>Loading…</p></section>;
  const r = d.record;
  const save = key => async value => {
    const body = key.startsWith("props.") ? { props: { [key.slice(6)]: value } } : { [key]: value };
    await apiFetch(`/ops/sales/rec/${type}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
    changed();
  };
  const all = fieldsOf(meta, type);
  const core = all.filter(f => !f.custom && f.type !== "stage" && f.type !== "pipeline" && !f.readOnly);
  const custom = all.filter(f => f.custom);
  const stamp = all.filter(f => f.readOnly);
  const pipe = meta.pipelines.find(p => p.id === r.pipeline_id) || meta.pipelines[0];
  const del = async () => { await apiFetch(`/ops/sales/rec/${type}/${encodeURIComponent(id)}`, { method: "DELETE" }); onChanged(); onBack(); };
  const fieldRow = f => <div key={f.key} style={{ padding: "6px 0" }}><div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>{f.label}</div>
    <InlineField field={f} value={valueAt(r, f.key)} meta={meta} onSave={save(f.key)} testid={f.key} /></div>;

  return <div data-sales-record={`${type}:${id}`}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
      <button type="button" style={link} onClick={onBack}>← {PLURAL[type]}</button>
      <h2 style={{ ...h2, fontSize: 20, margin: 0, flex: 1 }}>{r.displayName} <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.6 }}>{TYPE_WORDS[type]}</span>
        {d.reply ? <span style={{ fontSize: 12.5, fontWeight: 500, marginLeft: 10 }} data-sales-reply="1" title={`Last emailed: the latest email you sent that is on this record. No reply: you emailed last and nothing came back for ${d.noReplyAfterDays} days or more.`}>
          {d.reply.lastEmailedAt ? `Last emailed ${whenWords(d.reply.lastEmailedAt)}` : "Not emailed yet"}
          {d.reply.noReplyDays != null ? <span style={{ ...brassTag, marginLeft: 6 }}>No reply in {d.reply.noReplyDays} days</span> : null}</span> : null}</h2>
      {type !== "org" ? <button type="button" style={quiet} onClick={() => setDoing(x => (x === "email" ? null : "email"))} data-sales-email-open="1">Email</button> : null}
      {type !== "contact" ? <button type="button" style={quiet} onClick={() => setDoing(x => (x === "meeting" ? null : "meeting"))} data-sales-meeting-open="1">Book a meeting</button> : null}
      {confirmDel ? <span style={{ fontSize: 13 }}>Delete only this {TYPE_WORDS[type].toLowerCase()}? What it links to stays.{" "}
        <button type="button" style={{ ...btn, background: TERRA }} onClick={del} data-sales-delete-go="1">Yes, delete</button>{" "}
        <button type="button" style={quiet} onClick={() => setConfirmDel(false)}>Cancel</button></span>
        : <button type="button" style={quiet} onClick={() => setConfirmDel(true)} data-sales-delete="1">Delete</button>}
    </div>
    {r.dnc_at || d.dncViaOrg ? <p style={{ background: `${BRASS}33`, border: `1px solid ${BRASS}`, borderRadius: 8, padding: "8px 12px", fontSize: 13.5, margin: "0 0 12px" }} data-sales-dnc="1">
      <b>Do not contact.</b> {r.dnc_at ? `${r.dnc_reason} · marked ${whenWords(r.dnc_at)} by ${r.dnc_by_name}.` : `${d.dncViaOrg.name} is marked Do not contact: ${d.dncViaOrg.dnc_reason}.`} Out of every call queue, cadence and list export.</p> : null}
    {type === "org" && d.fit ? <p style={{ ...says, opacity: 1 }} data-sales-fit="1" title="The fit rule in Sales settings: arithmetic on this organization's fields."><b>{d.fit.line}</b>{d.fit.misses.length ? ` · ${d.fit.misses.join("; ")}` : " · meets every line"}{r.lost_at ? <span style={{ ...brassTag, marginLeft: 6 }}>{r.lost_reason || "Not a fit"}</span> : null}</p> : null}
    {doing === "email" ? <EmailDraft contactId={type === "contact" ? id : null} dealId={type === "deal" ? id : null} onClose={() => setDoing(null)} onLogged={changed} /> : null}
    {doing === "meeting" ? <section style={card}><MeetingForm dealId={type === "deal" ? id : null} orgId={type === "org" ? id : null} contactIds={(d.linked.contact || []).filter(c => type === "deal").map(c => c.id)}
      attendeesHint={(d.linked.contact || []).map(c => c.displayName).join(", ")} onDone={() => { setDoing(null); changed(); }} onCancel={() => setDoing(null)} /></section> : null}
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "300px minmax(0, 1fr) 300px", gap: 14, alignItems: "start" }}>
      <aside style={{ background: WHITE, borderRadius: 12, border: `1px solid ${INK}14`, overflow: "hidden" }} data-sales-rail="left">
        {type === "deal" ? <RailSection id="stage" title="Stage" testid="rail-stage">
          <select value={r.stage_id || ""} aria-label="Stage" style={{ ...box, width: "100%" }} data-sales-stage-select="1"
            onChange={async e => { const st = pipe.stages.find(s => s.id === e.target.value);
              const extra = st.kind === "later" ? { revisit_on: r.revisit_on || "" } : st.kind === "lost" ? { lost_reason: r.lost_reason || "" } : {};
              try { await apiFetch(`/ops/sales/deals/${encodeURIComponent(id)}/stage`, { method: "POST", body: JSON.stringify({ stage_id: st.id, ...extra }) }); changed(); }
              catch (x) { setD(v => ({ ...v, stageMsg: x.message })); } }}>
            {meta.pipelines.flatMap(p => p.stages.map(s => <option key={s.id} value={s.id}>{meta.pipelines.length > 1 ? `${p.name}: ` : ""}{s.name} ({s.probability}%)</option>))}</select>
          {d.stageMsg ? <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not moved</span> {d.stageMsg} Fill it in below, then choose the stage again.</p> : null}
          <div style={{ fontSize: 12, marginTop: 8, opacity: 0.75 }}>In this stage since {whenWords(r.stage_entered_at)}</div>
        </RailSection> : null}
        <RailSection id="about" title="About" testid="rail-about">{core.map(fieldRow)}</RailSection>
        <RailSection id="custom" title="Custom properties" testid="rail-custom" defaultOpen={custom.length > 0}>
          {custom.length ? custom.map(fieldRow) : <p style={says}>None yet. Add them in Sales settings.</p>}</RailSection>
        {type === "deal" ? <RailSection id="history" title="Stage history" testid="rail-history" defaultOpen={false}>
          {(d.history || []).map(h => <div key={h.id} style={{ fontSize: 12.5, padding: "4px 0", borderTop: `1px solid ${CREAM}` }} data-stage-history={h.id}>
            {h.from_name ? `${h.from_name} → ` : "Created in "}<b>{h.to_name}</b><div style={{ opacity: 0.7 }}>{whenWords(h.at)} · {h.created_by_name}</div></div>)}
        </RailSection> : null}
        {type === "contact" ? <RailSection id="cadences" title="Cadences" testid="rail-cadences"><ContactCadences contactId={id} reload={changed} /></RailSection> : null}
        {type === "org" ? <RailSection id="referral" title="Log a referral from this customer" testid="rail-referral" defaultOpen={false}><CustomerReferral orgId={id} open={open} /></RailSection> : null}
        {type !== "deal" ? <RailSection id="dnc" title="Do not contact" testid="rail-dnc" defaultOpen={!!r.dnc_at}><DoNotContact type={type} id={id} r={r} reload={changed} /></RailSection> : null}
        {type !== "deal" ? <RailSection id="merge" title="Merge" testid="rail-merge" defaultOpen={false}><Merge type={type} id={id} onMerged={changed} />
          {(d.merges || []).map(m => <div key={m.id} style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>Merged in {m.gone_snapshot && (m.gone_snapshot.name || [m.gone_snapshot.first_name, m.gone_snapshot.last_name].filter(Boolean).join(" "))} on {whenWords(m.created_at)} by {m.created_by_name}</div>)}
        </RailSection> : null}
        <RailSection id="stamp" title="Record" testid="rail-stamp" defaultOpen={false}>{stamp.map(fieldRow)}
          <div style={{ fontSize: 12, opacity: 0.7 }}>Made by {r.created_by_name}{r.updated_by_name ? `, last changed by ${r.updated_by_name}` : ""}</div></RailSection>
      </aside>
      <main style={{ minWidth: 0 }}><Timeline type={type} id={id} items={d.timeline} emails={d.emails || []} linked={d.linked} meta={meta} open={open} reload={changed} /></main>
      <aside style={{ background: WHITE, borderRadius: 12, border: `1px solid ${INK}14`, overflow: "hidden" }} data-sales-rail="right">
        {SIDES[type].map(side => <Linked key={side} type={type} id={id} side={side} rows={d.linked[side]} meta={meta} open={open} reload={changed} />)}
        {type !== "contact" ? <RailSection id="steward" title="Steward account" testid="rail-steward" defaultOpen={!!d.steward}>
          <StewardBox s={d.steward} orgId={id} reload={changed} canLink={type === "org"} /></RailSection> : null}
        {d.onboarding ? <RailSection id="gates" title="Onboarding gates" testid="rail-gates"><Gates o={d.onboarding} /></RailSection> : null}
        {type === "deal" ? <RailSection id="partners" title="Partners" testid="rail-partners" defaultOpen={(d.partners || []).length > 0}>
          <DealPartners dealId={id} lines={d.partners || []} reload={changed} /></RailSection> : null}
      </aside>
    </div>
  </div>;
}
