// GrantFunders.jsx · GRANTS-1. A FUNDER AND ITS HISTORY.
//
// The list: every funder with its asks, awards, win rate and next deadline.
// One funder: its kind, its program officers and contacts (people on file,
// linked), what it likes to fund, typical award size, grant cycle and due
// months, every ask and award with the win rate, notes, the public filing
// when its EIN is on file, and what went to it. Every change offers Undo.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { FunderHistoryPanel } from "./GrantReports";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = c => "$" + Math.round((Number(c) || 0) / 100).toLocaleString("en-US");
const day = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : ""; };
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, fontFamily: "inherit", boxSizing: "border-box" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px" };
const eyebrow = { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: T.ink3, marginBottom: 8 };
const CYCLE_LABEL = { annual: "Once a year", biannual: "Twice a year", quarterly: "Quarterly", rolling: "Rolling", invitation_only: "By invitation only", unknown: "Not known" };

export default function GrantFunders({ isReadOnly, onOpenGrant, openFunderId, onOpenPerson }) {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(openFunderId || "");
  const [adding, setAdding] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/grant-funders").then(setList).catch(e => setMsg(errorMessage(e, "The funders did not load.")));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (openFunderId) setSel(openFunderId); }, [openFunderId]);
  const add = async () => {
    setMsg("");
    try {
      const r = await apiFetch("/grant-funders", { method: "POST", body: JSON.stringify(adding) });
      setAdding(null); load(); setSel(r.id);
    } catch (e) { setMsg((e && e.sentence) || errorMessage(e, "That funder did not save.")); }
  };
  if (sel) return <FunderDetail id={sel} isReadOnly={isReadOnly} onBack={() => { setSel(""); load(); }} onOpenGrant={onOpenGrant} onOpenPerson={onOpenPerson} />;
  if (!list) return <div style={{ padding: 30, color: T.ink3, fontSize: 13 }}>{msg || "Loading the funders…"}</div>;
  return (
    <div data-testid="grant-funders" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, color: T.ink }}>{list.funders.length ? `${list.funders.length} ${list.funders.length === 1 ? "funder" : "funders"} on file.` : "No funders yet. Add the foundations, companies, agencies and churches you ask."}</div>
        {!isReadOnly && !adding && <button type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={() => setAdding({ name: "", funderType: "private_foundation", email: "" })} data-testid="funder-add">Add a funder</button>}
      </div>
      {adding && (
        <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input aria-label="Funder name" placeholder="Name" value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} style={{ ...inp, flex: "1 1 200px" }} />
          <select aria-label="Kind of funder" value={adding.funderType} onChange={e => setAdding({ ...adding, funderType: e.target.value })} style={inp}>
            {list.funderTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input aria-label="Funder email" placeholder="General email (optional)" value={adding.email} onChange={e => setAdding({ ...adding, email: e.target.value })} style={{ ...inp, flex: "1 1 180px" }} />
          <button type="button" style={btn(true)} onClick={add} disabled={!adding.name.trim()}>Add</button>
          <button type="button" style={btn(false)} onClick={() => setAdding(null)}>Cancel</button>
        </div>)}
      {msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {list.funders.map(f => (
          <button key={f.id} type="button" onClick={() => setSel(f.id)} data-testid="funder-card" style={{ ...card, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: T.ink }}>{f.name}</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{(list.funderTypes.find(t => t.key === f.funderType) || {}).label || "Kind not set"}{f.contacts ? ` · ${f.contacts} ${f.contacts === 1 ? "contact" : "contacts"}` : ""}</div>
            <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 8 }}>{f.asks} {f.asks === 1 ? "ask" : "asks"}, {f.awards} awarded{f.awardedCents ? ` (${money(f.awardedCents)})` : ""}</div>
            <div style={{ fontSize: 12.5, color: T.ink2 }}>{f.winRate == null ? "No decided asks yet" : `Win rate ${f.winRate}%`}{f.nextDeadline ? ` · next due ${day(f.nextDeadline)}` : ""}</div>
          </button>))}
      </div>
    </div>);
}

function FunderDetail({ id, isReadOnly, onBack, onOpenGrant, onOpenPerson }) {
  const [f, setF] = useState(null);
  const [edit, setEdit] = useState(null);
  const [contact, setContact] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch(`/grant-funders/${id}`).then(setF).catch(e => setMsg(errorMessage(e, "That funder did not load.")));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <div style={{ padding: 30, color: T.ink3, fontSize: 13 }}>{msg || "Loading…"}</div>;
  const profile = x => ({ funderType: x.funderType || "", interests: x.interests || "", awardMin: x.awardMin ?? "", awardMax: x.awardMax ?? "", cycle: x.cycle || "", dueMonths: x.dueMonths || [], notes: x.notes || "" });
  const save = async () => {
    setMsg("");
    const was = profile(f);
    try {
      await apiFetch(`/grant-funders/${id}`, { method: "PUT", body: JSON.stringify(edit) });
      setEdit(null); load();
      offerUndo({ message: `Saved ${f.name}.`, undoAction: async () => { const x = await apiFetch(`/grant-funders/${id}`, { method: "PUT", body: JSON.stringify(was) }); load(); return x; } }, "funder");
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  const addContact = async () => {
    setMsg("");
    try {
      const r = await apiFetch(`/grant-funders/${id}/contacts`, { method: "POST", body: JSON.stringify(contact) });
      setContact(null); load();
      offerUndo({ message: `Added ${contact.name} to ${f.name}.`, undoAction: async () => { const x = await apiFetch(`/grant-funders/contacts/${r.relId}/remove`, { method: "POST", body: "{}" }); load(); return x; } }, "contact");
    } catch (e) { setMsg(errorMessage(e, "That contact did not save.")); }
  };
  const removeContact = async c => {
    setMsg("");
    try {
      const r = await apiFetch(`/grant-funders/contacts/${c.relId}/remove`, { method: "POST", body: "{}" });
      load();
      offerUndo({ message: `Took ${c.name} off ${f.name}. Their own record is kept.`, undoAction: async () => { const x = await apiFetch(`/grant-funders/${id}/contacts`, { method: "POST", body: JSON.stringify({ personId: r.personId, role: r.role, title: r.title }) }); load(); return x; } }, "contact");
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };
  const typeLabel = (f.funderTypes.find(t => t.key === f.funderType) || {}).label || "Kind not set";
  const size = f.awardMin != null || f.awardMax != null ? `Typical award ${f.awardMin != null ? "$" + f.awardMin.toLocaleString("en-US") : "?"} to ${f.awardMax != null ? "$" + f.awardMax.toLocaleString("en-US") : "?"}` : "Typical award size not set";
  return (
    <div data-testid="funder-detail" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={btn(false)} onClick={onBack}>All funders</button>
        <h2 style={{ margin: 0, fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 26, color: T.ink }}>{f.name}</h2>
        <span style={{ fontSize: 13, color: T.ink3 }}>{typeLabel}</span>
        {onOpenPerson && <button type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => onOpenPerson(f.id)}>Open their record</button>}
      </div>
      <div data-testid="funder-winrate" style={{ fontSize: 14.5, color: T.ink, lineHeight: 1.5 }}>
        {f.asks} {f.asks === 1 ? "ask" : "asks"}, {money(f.requestedCents)} requested, {money(f.awardedCents)} awarded. {f.winSentence}
      </div>
      {msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
        <div style={card}>
          <div style={eyebrow}>What they fund</div>
          {edit ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select aria-label="Kind of funder" value={edit.funderType} onChange={e => setEdit({ ...edit, funderType: e.target.value })} style={inp}>
                <option value="">Kind not set</option>{f.funderTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <textarea aria-label="Giving interests" rows={3} placeholder="Giving interests" value={edit.interests} onChange={e => setEdit({ ...edit, interests: e.target.value })} style={{ ...inp, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <input aria-label="Smallest typical award" type="number" placeholder="From $" value={edit.awardMin} onChange={e => setEdit({ ...edit, awardMin: e.target.value })} style={{ ...inp, width: "50%" }} />
                <input aria-label="Largest typical award" type="number" placeholder="To $" value={edit.awardMax} onChange={e => setEdit({ ...edit, awardMax: e.target.value })} style={{ ...inp, width: "50%" }} />
              </div>
              <select aria-label="Grant cycle" value={edit.cycle} onChange={e => setEdit({ ...edit, cycle: e.target.value })} style={inp}>
                <option value="">Cycle not set</option>{f.cycles.map(c => <option key={c} value={c}>{CYCLE_LABEL[c] || c}</option>)}
              </select>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} aria-label="Due months">
                {MONTHS.map((m, i) => { const on = edit.dueMonths.includes(i + 1); return (
                  <button key={m} type="button" aria-pressed={on} onClick={() => setEdit({ ...edit, dueMonths: on ? edit.dueMonths.filter(x => x !== i + 1) : [...edit.dueMonths, i + 1] })}
                    style={{ ...btn(false), padding: "4px 8px", fontSize: 12, background: on ? T.ink : T.white, color: on ? T.white : T.ink }}>{m}</button>); })}
              </div>
              <textarea aria-label="Notes" rows={3} placeholder="Notes" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} style={{ ...inp, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8 }}><button type="button" style={btn(true)} onClick={save}>Save</button><button type="button" style={btn(false)} onClick={() => setEdit(null)}>Cancel</button></div>
            </div>
          ) : (
            <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>
              <div>{f.interests || "Giving interests not written down yet."}</div>
              <div>{size}</div>
              <div>{CYCLE_LABEL[f.cycle] || "Cycle not set"}{f.dueMonths.length ? `, due in ${f.dueMonths.map(m => MONTHS[m - 1]).join(", ")}` : ""}</div>
              {f.notes && <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{f.notes}</div>}
              {!isReadOnly && <button type="button" style={{ ...btn(false), marginTop: 8 }} onClick={() => setEdit(profile(f))} data-testid="funder-edit">Edit</button>}
            </div>)}
          {f.ein && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 10 }}>EIN {f.ein}{f.filing ? ` · public filing on file${f.filing.assets_cents ? `, assets ${money(f.filing.assets_cents)}` : ""}` : " · open their record to look up the public filing"}</div>}
        </div>

        <div style={card}>
          <div style={eyebrow}>Program officers and contacts</div>
          {!f.contacts.length && <div style={{ fontSize: 13, color: T.ink3 }}>No one yet. Add the program officer, and email to and from them lands on this funder's grants.</div>}
          {f.contacts.map(c => (
            <div key={c.relId} data-testid="funder-contact" style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "6px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 180px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{c.name}</div>
                <div style={{ fontSize: 12, color: T.ink3 }}>{c.role === "program_officer" ? "Program officer" : "Contact"}{c.title ? `, ${c.title}` : ""}{c.email ? ` · ${c.email}` : ""}</div>
              </div>
              {!isReadOnly && <button type="button" style={{ ...btn(false), padding: "4px 10px" }} onClick={() => removeContact(c)}>Take off</button>}
            </div>))}
          {!isReadOnly && (contact ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              <input aria-label="Contact name" placeholder="Name" value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} style={inp} />
              <input aria-label="Contact email" placeholder="Email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} style={inp} />
              <input aria-label="Contact title" placeholder="Title (optional)" value={contact.title} onChange={e => setContact({ ...contact, title: e.target.value })} style={inp} />
              <select aria-label="Contact role" value={contact.role} onChange={e => setContact({ ...contact, role: e.target.value })} style={inp}>
                <option value="program_officer">Program officer</option><option value="funder_contact">Other contact</option>
              </select>
              <div style={{ display: "flex", gap: 8 }}><button type="button" style={btn(true)} onClick={addContact} disabled={!contact.name.trim()}>Add</button><button type="button" style={btn(false)} onClick={() => setContact(null)}>Cancel</button></div>
            </div>
          ) : <button type="button" style={{ ...btn(false), marginTop: 8 }} onClick={() => setContact({ name: "", email: "", title: "", role: "program_officer" })} data-testid="funder-contact-add">Add a contact</button>)}
        </div>
      </div>

      <div style={card}>
        <div style={eyebrow}>Every ask and award</div>
        {!f.grants.length && <div style={{ fontSize: 13, color: T.ink3 }}>Nothing asked of them yet.</div>}
        {f.grants.map(g => (
          <div key={g.id} data-testid="funder-grant" style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap" }}>
            <button type="button" onClick={() => onOpenGrant(g.id)} style={{ all: "unset", cursor: "pointer", flex: "1 1 220px", fontSize: 13.5, fontWeight: 700, color: T.ink, textDecoration: "underline dotted" }}>{g.program || "A grant"}{g.cycleName ? ` (${g.cycleName})` : ""}</button>
            <span style={{ fontSize: 12.5, color: T.ink2, minWidth: 90 }}>{g.statusLabel}</span>
            <span style={{ fontSize: 12.5, color: T.ink2, minWidth: 150 }}>{money(g.requestedCents)} asked{g.awardedCents ? `, ${money(g.awardedCents)} awarded` : ""}</span>
            <span style={{ fontSize: 12, color: T.ink3 }}>{g.nextDue ? `next due ${day(g.nextDue)}` : g.awardedAt ? `awarded ${day(String(g.awardedAt).slice(0, 10))}` : ""}</span>
          </div>))}
      </div>
      <FunderHistoryPanel funderId={f.id} />
    </div>);
}
