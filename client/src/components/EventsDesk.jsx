// BUILD-98 (switch) Part 4 — THE DONOR SIDE OF A GALA, for the people running it.
//
// Fundraising → Events. An event, its ticket and sponsorship levels, the
// guest list with tables, who came, and the sponsor lines for the programme.
// Not a ticketing system: the public page sells tickets through the giving
// page, and everything a ticket is (a gift with a fair-market split) is the
// server's to decide.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull, Card } from "./shared";
import { errorMessage } from "../lib/domainError";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };
const btn = primary => ({ background: primary ? T.gold : T.white, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9,
  padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer" });
const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };

function EventDetail({ event, orgSlug, donors, isReadOnly, onBack }) {
  const [levels, setLevels] = useState([]);
  const [guests, setGuests] = useState(null);
  const [msg, setMsg] = useState("");
  const [lv, setLv] = useState({ kind: "ticket", name: "", price: "", fmv: "", capacity: "", recognition: "" });
  const [reg, setReg] = useState({ who: "", email: "", levelId: "", quantity: 1, paid: true });
  const [marks, setMarks] = useState({});
  const load = () => {
    apiFetch(`/events/${event.id}/levels`).then(r => { setLevels(r.levels || []); setReg(x => ({ ...x, levelId: x.levelId || r.levels?.[0]?.id || "" })); }).catch(() => {});
    apiFetch(`/events/${event.id}/guests`).then(setGuests).catch(e => setMsg(errorMessage(e, "Could not load the guest list.")));
  };
  useEffect(() => { load(); }, [event.id]);
  const act = async (fn, okMsg) => { setMsg(""); try { await fn(); if (okMsg) setMsg(okMsg); load(); } catch (e) { setMsg(errorMessage(e, "That did not save.")); } };
  const addLevel = () => act(() => apiFetch(`/events/${event.id}/levels`, { method: "POST", body: JSON.stringify(lv) })
    .then(() => setLv({ kind: "ticket", name: "", price: "", fmv: "", capacity: "", recognition: "" })));
  const register = () => {
    const d = donors.find(x => String(x.name || "").toLowerCase() === reg.who.trim().toLowerCase());
    const body = d ? { donorId: d.id } : { name: reg.who.trim(), email: reg.email.trim() };
    return act(() => apiFetch(`/events/${event.id}/register`, { method: "POST", body: JSON.stringify({ ...body, levelId: reg.levelId, quantity: Number(reg.quantity) || 1, paid: reg.paid, idempotencyKey: crypto.randomUUID() }) })
      .then(() => setReg(x => ({ ...x, who: "", email: "", quantity: 1 }))), "Registered.");
  };
  const saveAttendance = () => {
    const attended = Object.keys(marks).filter(k => marks[k] === "attended"), noShow = Object.keys(marks).filter(k => marks[k] === "no_show");
    return act(() => apiFetch(`/events/${event.id}/attendance`, { method: "POST", body: JSON.stringify({ attended, noShow }) }), "Attendance saved to each person's record.");
  };
  const setTable = (id, table) => act(() => apiFetch(`/events/${event.id}/attendees/${id}/table`, { method: "PUT", body: JSON.stringify({ table }) }));
  const publicUrl = `${window.location.origin}/give/${orgSlug}?event=${event.id}`;
  const ticketLevels = levels.filter(l => l.kind === "ticket");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="event-detail">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <button onClick={onBack} style={{ ...btn(false), padding: "4px 10px", marginBottom: 8 }}>← All events</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.ink }}>{event.name}</div>
          <div style={{ fontSize: 13, color: T.ink3 }}>{String(event.date).slice(0, 10)}{event.location ? ` · ${event.location}` : ""}</div>
        </div>
        {ticketLevels.length > 0 && <div style={{ fontSize: 12, color: T.ink3, maxWidth: 420 }}>
          Tickets sell on your giving page at <span style={{ color: T.ink, wordBreak: "break-all" }} data-testid="event-public-url">{publicUrl}</span>
        </div>}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}

      <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Tickets and sponsorships</div>
        {levels.map(l => (
          <div key={l.id} style={{ display: "flex", gap: 10, fontSize: 13, color: T.ink, padding: "6px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap" }}>
            <strong style={{ minWidth: 160 }}>{l.name}</strong>
            <span>{fmtFull(l.price)}</span>
            <span style={{ color: T.ink3 }}>{l.kind === "sponsor" ? "sponsorship" : `worth ${fmtFull(l.fmv)}, so ${fmtFull(l.deductible)} deductible`}</span>
            <span style={{ marginLeft: "auto", color: T.ink3 }}>{l.capacity == null ? `${l.taken} taken` : `${l.taken} of ${l.capacity} taken`}</span>
          </div>))}
        {!isReadOnly && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          <select value={lv.kind} onChange={e => setLv({ ...lv, kind: e.target.value })} style={inp}><option value="ticket">Ticket</option><option value="sponsor">Sponsorship</option></select>
          <input placeholder="Name (e.g. Dinner ticket)" value={lv.name} onChange={e => setLv({ ...lv, name: e.target.value })} style={{ ...inp, width: 170 }} />
          <input placeholder="Price" type="number" value={lv.price} onChange={e => setLv({ ...lv, price: e.target.value })} style={{ ...inp, width: 80 }} />
          <input placeholder="Value received" type="number" value={lv.fmv} onChange={e => setLv({ ...lv, fmv: e.target.value })} style={{ ...inp, width: 110 }} title="What the guest receives, such as the dinner. The receipt says only the rest is deductible." />
          <input placeholder="Places" type="number" value={lv.capacity} onChange={e => setLv({ ...lv, capacity: e.target.value })} style={{ ...inp, width: 70 }} />
          {lv.kind === "sponsor" && <input placeholder="Recognition, e.g. {{name}}, Gold sponsor" value={lv.recognition} onChange={e => setLv({ ...lv, recognition: e.target.value })} style={{ ...inp, width: 240 }} />}
          <button onClick={addLevel} style={btn(false)} data-testid="event-add-level">Add</button>
        </div>}
      </Card>

      {!isReadOnly && levels.length > 0 && <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Register someone</div>
        <datalist id="event-people">{donors.slice(0, 2000).map(d => <option key={d.id} value={d.name} />)}</datalist>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input list="event-people" placeholder="Name" value={reg.who} onChange={e => setReg({ ...reg, who: e.target.value })} style={{ ...inp, width: 200 }} data-testid="event-reg-who" />
          <input placeholder="Email if new" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} style={{ ...inp, width: 180 }} />
          <select value={reg.levelId} onChange={e => setReg({ ...reg, levelId: e.target.value })} style={inp}>{levels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <input type="number" min={1} max={50} value={reg.quantity} onChange={e => setReg({ ...reg, quantity: e.target.value })} style={{ ...inp, width: 60 }} />
          {levels.find(l => l.id === reg.levelId)?.kind === "sponsor" &&
            <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 5 }}><input type="checkbox" checked={reg.paid} onChange={e => setReg({ ...reg, paid: e.target.checked })} style={{ accentColor: T.greenDk }} />Paid now</label>}
          <button onClick={register} disabled={!reg.who.trim() || !reg.levelId} style={btn(true)} data-testid="event-register">Register</button>
        </div>
        <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>A paid ticket is recorded as a gift with its value received noted for the receipt. An unpaid sponsorship is a pledge until the money arrives.</div>
      </Card>}

      <Card style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={h}>Guest list</div>
          {!isReadOnly && guests?.guests?.length > 0 && <button onClick={saveAttendance} disabled={!Object.keys(marks).length} style={btn(true)} data-testid="event-save-attendance">Save attendance</button>}
        </div>
        {!guests ? <div style={{ color: T.ink3, fontSize: 13 }}>Loading…</div> : guests.guests.length === 0
          ? <div style={{ color: T.ink3, fontSize: 13 }}>Nobody has registered yet.</div>
          : guests.guests.map(g => (
            <div key={g.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, padding: "6px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap" }}>
              <strong style={{ minWidth: 170 }}>{g.name}</strong>
              <span style={{ color: T.ink3, minWidth: 120 }}>{g.level_name || ""}{g.quantity > 1 ? ` ×${g.quantity}` : ""}</span>
              <input defaultValue={g.table_label || ""} placeholder="Table" onBlur={e => e.target.value !== (g.table_label || "") && setTable(g.id, e.target.value)} disabled={isReadOnly} style={{ ...inp, width: 110, padding: "4px 7px" }} />
              <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                {["attended", "no_show"].map(st => (
                  <button key={st} onClick={() => setMarks(m => ({ ...m, [g.id]: st }))} disabled={isReadOnly}
                    style={{ ...btn(false), padding: "4px 9px", background: (marks[g.id] || g.status) === st ? T.bg2 : T.white }}>{st === "attended" ? "Came" : "Didn't come"}</button>))}
              </span>
            </div>))}
      </Card>

      {guests?.recognition?.length > 0 && <Card style={{ padding: "16px 18px" }} data-testid="event-recognition">
        <div style={h}>For the programme</div>
        {guests.recognition.map((r, i) => <div key={i} style={{ fontSize: 14, color: T.ink, padding: "3px 0" }}>{r}</div>)}
      </Card>}
    </div>
  );
}

export function EventsDesk({ orgSlug, donors = [], isReadOnly }) {
  const [events, setEvents] = useState(null);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ name: "", date: "", location: "" });
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/events").then(r => setEvents((Array.isArray(r) ? r : r.events || []).filter(e => !e.is_sample))).catch(e => setMsg(errorMessage(e, "Could not load your events.")));
  useEffect(() => { load(); }, []);
  const create = async () => {
    setMsg("");
    try { const e = await apiFetch("/events", { method: "POST", body: JSON.stringify({ ...form, eventType: "gala" }) }); setForm({ name: "", date: "", location: "" }); await load(); setOpen(e); }
    catch (e) { setMsg(errorMessage(e, "That event could not be created.")); }
  };
  if (open) return <EventDetail event={open} orgSlug={orgSlug} donors={donors} isReadOnly={isReadOnly} onBack={() => { setOpen(null); load(); }} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="events-desk">
      <div style={{ fontSize: 13, color: T.ink3, maxWidth: 620, lineHeight: 1.6 }}>
        The donor side of an event: tickets and sponsorships, the guest list and tables, and who came. A ticket's receipt states the part that is deductible.
      </div>
      {!isReadOnly && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input placeholder="Event name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ ...inp, width: 220 }} data-testid="event-new-name" />
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} data-testid="event-new-date" />
        <input placeholder="Where" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} style={{ ...inp, width: 180 }} />
        <button onClick={create} disabled={!form.name.trim() || !form.date} style={btn(true)} data-testid="event-create">Create event</button>
      </div>}
      {msg && <div role="alert" style={{ fontSize: 13, color: T.terracotta }}>{msg}</div>}
      {!events ? <div style={{ color: T.ink3, fontSize: 13 }}>Loading…</div> : events.length === 0
        ? <div style={{ color: T.ink3, fontSize: 13 }}>No events yet. Create one above and add its tickets.</div>
        : events.map(e => (
          <button key={e.id} onClick={() => setOpen(e)} style={{ textAlign: "left", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", cursor: "pointer", color: T.ink }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{e.name}</div>
            <div style={{ fontSize: 12, color: T.ink3 }}>{String(e.date).slice(0, 10)}{e.location ? ` · ${e.location}` : ""}</div>
          </button>))}
    </div>
  );
}
