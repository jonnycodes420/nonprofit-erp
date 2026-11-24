// BUILD-98 (switch) Part 4 — THE DONOR SIDE OF A GALA, for the people running it.
//
// Fundraising → Events. An event, its ticket and sponsorship levels, the
// guest list with tables, who came, and the sponsor lines for the programme.
// Not a ticketing system: the public page sells tickets through the giving
// page, and everything a ticket is (a gift with a fair-market split) is the
// server's to decide.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useChanged } from "../lib/changes";   // STALE-2
import { personNamed } from "../lib/people";
import { PeopleDatalist } from "./PeopleDatalist";
import { T, Card } from "./shared";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";
import { RecordLink, useUrlWriter } from "./RecordLink";
import { tabHref, urlParam, donorHref } from "../lib/appUrls";
import { EventKiosk } from "./Events";
import { EventPageEditor } from "./EventPageEditor";
import EventTicketTypes from "./events/EventTicketTypes";   // EVENTS-4
import { SaveAsGroup } from "./Groups";
import RemoveMenu, { removeMany } from "./RemoveMenu";
import { displayOrgDate } from "../lib/orgDay";
import DateInput from "./inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };
// SWEEP-4: emerald is the one action colour; the primary here was brass
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9,
  padding: "8px 14px", fontSize: 13, fontWeight: 700, color: primary ? T.white : T.ink, cursor: "pointer" });
const h = { fontSize: 11, fontWeight: 800, color: T.ink3, marginBottom: 8 };

function EventDetail({ event, orgSlug, donors, isReadOnly, onBack }) {
  const [levels, setLevels] = useState([]);
  const [guests, setGuests] = useState(null);
  const [msg, setMsg] = useState("");
  // PARITY-2 Part 3: check-in at the door, from the guest list, on a phone.
  const [door, setDoor] = useState(false);
  const [reg, setReg] = useState({ who: "", email: "", levelId: "", quantity: 1, paid: true });
  const [marks, setMarks] = useState({});
  // EVENTS-2 — who asked to be told if a place comes free.
  const [wait, setWait] = useState(null);
  // FIX-41: guests ticked for Remove selected.
  const [picked, setPicked] = useState(() => new Set());
  const load = () => {
    apiFetch(`/events/${event.id}/levels`).then(r => { setLevels(r.levels || []); setReg(x => ({ ...x, levelId: x.levelId || (r.levels || []).find(l => !l.retired)?.id || "" })); }).catch(() => {});
    apiFetch(`/events/${event.id}/guests`).then(setGuests).catch(e => setMsg(errorMessage(e, "Could not load the guest list.")));
    apiFetch(`/events/${event.id}/waitlist`).then(setWait).catch(() => setWait(null));
  };
  const offer = async w => {
    setMsg("");
    try { const r = await apiFetch(`/events/${event.id}/waitlist/${w.id}/offer`, { method: "POST" }); setMsg(r.sentence || ""); load(); }
    catch (e) { setMsg(errorMessage(e, "That offer did not go out.")); }
  };
  useEffect(() => { load(); }, [event.id]);
  // STALE-2: a guest added, marked or removed on the event page (or at the
  // door) re-reads this desk's guest list.
  useChanged(["event"], load, { event: event.id });
  const act = async (fn, okMsg) => { setMsg(""); try { await fn(); if (okMsg) setMsg(okMsg); load(); } catch (e) { setMsg(errorMessage(e, "That did not save.")); } };
  const register = async () => {
    // SCALE-2: the person with exactly this name, highest giving first, from the server.
    const d = await personNamed(reg.who).catch(() => null);
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
      {/* FIX-26: at 390 the address ran under the title broken mid-word
          ("…/give/harb / orlight?event="). It is one line now, cut with an
          ellipsis, with a button that copies the whole of it. */}
      <div data-testid="event-detail-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 240px" }}>
          <button onClick={onBack} style={{ ...btn(false), padding: "4px 10px", marginBottom: 8 }}>← All events</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, lineHeight: 1.25 }}>{event.name}</div>
          <div style={{ fontSize: 13, color: T.ink3, marginTop: 2 }}>{displayDate(event.date)}{event.location ? ` · ${event.location}` : ""}</div>
        </div>
        {ticketLevels.length > 0 && <div style={{ fontSize: 12, color: T.ink3, minWidth: 0, flex: "1 1 260px", maxWidth: 420 }}>
          <div style={{ marginBottom: 4 }}>Tickets sell on your giving page at</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
            <span title={publicUrl} style={{ color: T.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="event-public-url">{publicUrl}</span>
            <button type="button" onClick={() => { try { navigator.clipboard.writeText(publicUrl); setMsg("The ticket link is copied."); } catch { setMsg(publicUrl); } }}
              style={{ ...btn(false), padding: "4px 10px", fontSize: 12, flexShrink: 0 }} data-testid="event-public-url-copy">Copy link</button>
          </div>
        </div>}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}

      <EventPageEditor eventId={event.id} isReadOnly={isReadOnly} />

      {/* EVENTS-4: the one ticket-types card, also on the Events page. */}
      <EventTicketTypes eventId={event.id} isReadOnly={isReadOnly} levels={levels} onChanged={load} />

      {/* EVENTS-2 — THE WAITING LIST. A place is offered by a PERSON pressing
          this button, never by a sweep: nothing is held and nothing is
          charged, so it is an invitation to come and buy, in order. */}
      {wait?.waitlist?.length > 0 && <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Waiting list</div>
        <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>{wait.sentence}</div>
        {wait.waitlist.map(w => (
          <div key={w.id} data-testid="event-waitlist-row" style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13, color: T.ink, padding: "6px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap" }}>
            <strong style={{ minWidth: 160 }}>{w.name}</strong>
            <span style={{ color: T.ink3 }}>{w.level_name}</span>
            <span style={{ color: T.ink3 }}>{w.offered_at ? `offered ${displayOrgDate(w.offered_at)}` : `number ${w.position}`}</span>
            {!isReadOnly && !w.taken_at && <button onClick={() => offer(w)} style={{ ...btn(false), marginLeft: "auto" }} data-testid="event-waitlist-offer">
              {w.offered_at ? "Offer again" : "Offer a place"}</button>}
            <RemoveMenu kind="waitlist" id={w.id} disabled={isReadOnly} onDone={load} />
          </div>))}
      </Card>}

      {!isReadOnly && levels.length > 0 && <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Register someone</div>
        <PeopleDatalist id="event-people" text={reg.who} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input list="event-people" placeholder="Name" value={reg.who} onChange={e => setReg({ ...reg, who: e.target.value })} style={{ ...inp, width: 200 }} data-testid="event-reg-who" />
          <input placeholder="Email if new" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} style={{ ...inp, width: 180 }} />
          <select value={reg.levelId} onChange={e => setReg({ ...reg, levelId: e.target.value })} style={inp}>{levels.filter(l => !l.retired).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <input type="number" min={1} max={50} value={reg.quantity} onChange={e => setReg({ ...reg, quantity: e.target.value })} style={{ ...inp, width: 60 }} />
          {levels.find(l => l.id === reg.levelId)?.kind === "sponsor" &&
            <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 5 }}><input type="checkbox" checked={reg.paid} onChange={e => setReg({ ...reg, paid: e.target.checked })} style={{ accentColor: T.greenDk }} />Paid now</label>}
          <button onClick={register} disabled={!reg.who.trim() || !reg.levelId} style={btn(true)} data-testid="event-register">Register</button>
        </div>
        <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>A paid ticket is recorded as a gift with its value received noted for the receipt. An unpaid sponsorship is a pledge until the money arrives.</div>
      </Card>}

      <Card style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={h}>Guest list</div>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {!isReadOnly && guests?.guests?.length > 0 && <button onClick={() => setDoor(d => !d)} style={btn(!door)} data-testid="event-door-checkin">{door ? "Close check-in" : "Check in at the door"}</button>}
            {!isReadOnly && picked.size > 0 && <button data-testid="event-remove-selected" style={btn(false)}
              onClick={() => removeMany({ kind: "guest", ids: [...picked], onDone: () => { setPicked(new Set()); load(); } })}>Remove selected ({picked.size})</button>}
            {!isReadOnly && guests?.guests?.length > 0 && <button onClick={saveAttendance} disabled={!Object.keys(marks).length} style={btn(false)} data-testid="event-save-attendance">Save attendance</button>}
            {/* WIRE-1: the guest list as a group by rule, kept up to date. */}
            {!isReadOnly && guests?.guests?.length > 0 && <SaveAsGroup name={`${event.name} guests`} rules={{ registeredEvent: event.id }} label="Save these guests as a group" testid="event-save-group" />}
          </span>
        </div>
        {door && <div style={{ marginTop: 10 }}><EventKiosk eventId={event.id} /></div>}
        {!guests ? <div style={{ color: T.ink3, fontSize: 13 }}>Loading…</div> : guests.guests.length === 0
          ? <div style={{ color: T.ink3, fontSize: 13 }}>Nobody has registered yet.</div>
          : guests.guests.map(g => (
            <div key={g.id} data-testid="event-guest-row" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, padding: "6px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap" }}>
              {!isReadOnly && <input type="checkbox" aria-label={`Select ${g.name}`} data-testid="event-guest-pick" checked={picked.has(g.id)} style={{ accentColor: T.greenDk }}
                onChange={e => setPicked(x => { const n = new Set(x); if (e.target.checked) n.add(g.id); else n.delete(g.id); return n; })} />}
              {/* FIX-27 Part 6: a guest's name opens their person. */}
              <strong style={{ minWidth: 170 }}>{g.donor_id
                ? <RecordLink to={donorHref(g.donor_id)} data-testid="event-guest-name" style={{ textDecoration: "underline dotted", textUnderlineOffset: 3 }}>{g.name}</RecordLink>
                : g.name}</strong>
              <span style={{ color: T.ink3, minWidth: 120 }}>{g.level_name || ""}{g.quantity > 1 ? ` ×${g.quantity}` : ""}</span>
              <input defaultValue={g.table_label || ""} placeholder="Table" onBlur={e => e.target.value !== (g.table_label || "") && setTable(g.id, e.target.value)} disabled={isReadOnly} style={{ ...inp, width: 110, padding: "4px 7px" }} />
              <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                {["attended", "no_show"].map(st => (
                  <button key={st} onClick={() => setMarks(m => ({ ...m, [g.id]: st }))} disabled={isReadOnly}
                    style={{ ...btn(false), padding: "4px 9px", background: (marks[g.id] || g.status) === st ? T.bg2 : T.white }}>{st === "attended" ? "Came" : "Didn't come"}</button>))}
                <RemoveMenu kind="guest" id={g.id} disabled={isReadOnly} onDone={load} />
              </span>
            </div>))}
      </Card>

      {guests?.recognition?.length > 0 && <Card style={{ padding: "16px 18px" }} data-testid="event-recognition">
        <div style={h}>For the program</div>
        {guests.recognition.map((r, i) => <div key={i} style={{ fontSize: 14, color: T.ink, padding: "3px 0" }}>{r}</div>)}
      </Card>}
    </div>
  );
}

export function EventsDesk({ orgSlug, donors = [], isReadOnly }) {
  const [events, setEvents] = useState(null);
  const [open, setOpenRaw] = useState(null);
  const [form, setForm] = useState({ name: "", date: "", location: "" });
  const [msg, setMsg] = useState("");
  // FIX-14 Part 5: an event here is /app/fundraising?fr=events&event=<id>.
  const goUrl = useUrlWriter();
  const hrefOf = e => tabHref("fundraising", { frSection: "events", eventId: e ? e.id : null });
  const setOpen = e => { setOpenRaw(e); goUrl(hrefOf(e)); };
  const [wantId] = useState(() => urlParam("fundraising", "event"));
  const load = () => apiFetch("/events").then(r => {
    const list = (Array.isArray(r) ? r : r.events || []).filter(e => !e.is_sample);
    setEvents(list);
    if (wantId) setOpenRaw(o => o || list.find(e => e.id === wantId) || null);
  }).catch(e => setMsg(errorMessage(e, "Could not load your events.")));
  useEffect(() => { load(); }, []);
  useChanged(["event"], load);   // STALE-2: each card's counts move with any event's guests
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
        <DateInput value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} data-testid="event-new-date" />
        <input placeholder="Where" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} style={{ ...inp, width: 180 }} />
        <button onClick={create} disabled={!form.name.trim() || !form.date} style={btn(true)} data-testid="event-create">Create event</button>
      </div>}
      {msg && <div role="alert" style={{ fontSize: 13, color: T.terracotta }}>{msg}</div>}
      {!events ? <div style={{ color: T.ink3, fontSize: 13 }}>Loading…</div> : events.length === 0
        ? <div style={{ color: T.ink3, fontSize: 13 }}>No events yet. Create one above and add its tickets.</div>
        : events.map(e => (
          <RecordLink key={e.id} to={hrefOf(e)} onOpen={() => setOpen(e)} data-record-link="event" style={{ display: "block", textAlign: "left", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", cursor: "pointer", color: T.ink }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{e.name}</div>
            <div style={{ fontSize: 12, color: T.ink3 }}>{displayDate(e.date)}{e.location ? ` · ${e.location}` : ""}</div>
          </RecordLink>))}
    </div>
  );
}
