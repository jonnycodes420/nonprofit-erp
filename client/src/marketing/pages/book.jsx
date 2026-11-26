// ONBOARD-4 item 3, BOOK-1 · /book, THE WEBSITE'S ONE ACTION.
//
// Nobody signs up cold: every org that signs does it after a call with Jonathan. BOOK-1 (Jonathan,
// 25 Nov: "cmonn now that looks shit") puts everything on one screen, as the approved mockup:
// the headline, Jonathan and three ticks on the left, the booking card on the right; on a phone the
// card comes first, under the headline. At 1440x900 and 1280x800 the Book button is in view.
//
// The card books. Name, work email, organization and what she uses today, then the next five
// weekdays and the intro call's open times (GET /public/book/times, read from the booking tool by
// the server). Book sends the form (POST /public/book: the deal in the sales CRM with her answers
// and partner code, server/admin/sales/booking.js) with her time; the booking tool then books it,
// or opens that time on its own page, prefilled, for her last click. The tool sends the invite and
// the reminder; Steward sends her nothing. With no times to read, the card opens the tool's own
// calendar after the form (booking/slots.jsx), as before.
//
// /book?partner=<code> shows "Recommended by <partner>" as the eyebrow when the code is known.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { API } from "../../api";
import { track } from "../../lib/analyticsDoor";   // ANALYTICS-1: the /book funnel, never her answers
import { SlotPicker, SlotFrame } from "../booking/slots";
import { showTestimonial, CUSTOMER_QUOTE, FOUNDER_PHOTO } from "../booking/config";

export const BOOK_FALLBACK = "That did not go through. Please email jonathan@stewardapp.dev and he will set up a time with you.";
const USING = ["Spreadsheets", "Salesforce", "Bloomerang", "Nothing yet", "Something else"];
const POINTS = ["See who's gone quiet and what they used to give", "No pitch deck, no pressure, no prices thrown at you", "Leave with a list of people worth a call this week"];
const FINE = "You'll get a calendar invite and a reminder. Nothing else.";

// "Book Tue, Dec 1 at 10:30 AM"
const bookWords = (day, slot) => `Book ${day.dow}, ${day.mon} ${day.day} at ${slot.time} ${slot.ampm}`;

function Founder() {
  return <div className="bk-you">
    {FOUNDER_PHOTO ? <img className="bk-ph" src={FOUNDER_PHOTO} alt="Jonathan Atkinson" width="58" height="58" />
      : <span className="bk-ph bk-initial" aria-hidden="true">J</span>}
    <div><b>Jonathan Atkinson</b><span>Founder, Steward · Wilmore, Kentucky</span></div>
  </div>;
}

function Card({ code }) {
  const [f, setF] = useState({ name: "", email: "", orgName: "", currentSystem: USING[0], website: "" });
  const [t, setT] = useState(null);
  const [dayI, setDayI] = useState(0);
  const [slot, setSlot] = useState(null);
  const [state, setState] = useState("idle");   // idle · sending · open (last click on the tool) · embed (the tool's calendar) · booked
  const [open, setOpen] = useState("");
  const [err, setErr] = useState("");
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const booked = useCallback(() => { setState("booked"); track("book_submitted", { stage: "booked", partner: !!code }); }, [code]);
  const started = useRef(false);
  const startedOnce = () => { if (!started.current) { started.current = true; track("book_form_started", { partner: !!code }); } };

  useEffect(() => {
    let alive = true;
    fetch(API + "/public/book/times").then(r => (r.ok ? r.json() : { source: "embed" })).catch(() => ({ source: "embed" }))
      .then(j => { if (!alive) return; setT(j); const first = (j.days || []).findIndex(d => d.slots.length); setDayI(first < 0 ? 0 : first); });
    return () => { alive = false; };
  }, []);

  const live = !!t && t.source === "calendly";
  const day = live ? t.days[dayI] : null;

  async function submit(e) {
    e.preventDefault();
    if (live && !slot) { setErr("Pick a time first."); return; }
    setState("sending"); setErr("");
    try {
      const body = { name: f.name.trim(), orgName: f.orgName.trim(), email: f.email.trim(), currentSystem: f.currentSystem, website: f.website,
        partner: code || undefined, slot: live ? slot.start : undefined };
      const r = await fetch(API + "/public/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) { setState("idle"); setSlot(null); setErr(d.message || "That time was just taken. Pick another one."); return; }
      if (!r.ok) throw new Error(d.message || BOOK_FALLBACK);
      track("book_submitted", { stage: d.booked ? "booked" : d.open ? "confirm" : "pick", partner: !!code });
      if (d.booked) setState("booked");
      else if (d.open) { setOpen(d.open); setState("open"); }
      else setState("embed");
    } catch (x) {
      setState("idle"); setErr((x && x.message) || BOOK_FALLBACK);
    }
  }

  if (state === "booked") return <div className="bk-card" data-book-card data-book-state="booked">
    <h2 className="bk-h2">You're booked.</h2>
    <p className="bk-sub">The calendar has sent you the invitation, and Jonathan will have read your answers before the call.</p>
    <p className="bk-fine">{FINE}</p>
  </div>;
  if (state === "open" || state === "embed") return <div className="bk-card" data-book-card data-book-state={state}>
    <h2 className="bk-h2">{state === "open" ? "One last click" : "Pick a time"}</h2>
    <div className="bk-sub">{state === "open" ? "Confirm the time on the calendar below." : "All times Eastern · Google Meet"}</div>
    {state === "open" ? <SlotFrame src={open} onBooked={booked} /> : <SlotPicker name={f.name.trim()} email={f.email.trim()} onBooked={booked} />}
    <p className="bk-fine">{FINE}</p>
  </div>;

  return <form className="bk-card" onSubmit={submit} onFocus={startedOnce} data-book-card data-book-form data-book-source={t ? t.source : "loading"}>
    <h2 className="bk-h2">Pick a time</h2>
    <div className="bk-sub">All times Eastern · Google Meet</div>
    <div className="bk-two">
      <label htmlFor="book-name" className="bk-f">Your name<input id="book-name" required name="name" autoComplete="name" placeholder="Your name" value={f.name} onChange={set("name")} /></label>
      <label htmlFor="book-email" className="bk-f">Work email<input id="book-email" type="email" required name="email" autoComplete="email" placeholder="you@yourorg.org" value={f.email} onChange={set("email")} /></label>
    </div>
    <div className="bk-two">
      <label htmlFor="book-org" className="bk-f">Organization<input id="book-org" required name="organization" autoComplete="organization" placeholder="Your organization" value={f.orgName} onChange={set("orgName")} /></label>
      <label htmlFor="book-system" className="bk-f">Using today<select id="book-system" name="currentSystem" value={f.currentSystem} onChange={set("currentSystem")}>{USING.map(u => <option key={u}>{u}</option>)}</select></label>
    </div>
    <label htmlFor="book-website" aria-hidden="true" style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>Website<input id="book-website" tabIndex={-1} autoComplete="off" name="website" value={f.website} onChange={set("website")} /></label>
    {live && <>
      <div className="bk-days" role="radiogroup" aria-label="Day">
        {t.days.map((d, i) => <button type="button" key={d.date} role="radio" aria-checked={i === dayI} disabled={!d.slots.length} data-book-day={d.date}
          className={i === dayI ? "on" : ""} onClick={() => { setDayI(i); setSlot(null); }}>{d.dow}<b>{d.day}</b>{d.mon}</button>)}
      </div>
      {day && day.slots.length ? <div className="bk-slots" role="radiogroup" aria-label="Time">
        {day.slots.map(s => <button type="button" key={s.start} role="radio" aria-checked={!!slot && slot.start === s.start} data-book-slot={s.start}
          aria-label={`${s.time} ${s.ampm}`} className={slot && slot.start === s.start ? "on" : ""} onClick={() => { setSlot(s); track("book_time_picked", { day_index: dayI }); }}>{s.time}</button>)}
      </div> : <p className="bk-none">No open times this week. Email jonathan@stewardapp.dev and he will find one.</p>}
    </>}
    {err && <p className="form-err" role="alert">{err}</p>}
    <button className="bk-btn" type="submit" data-book-button disabled={state === "sending" || !t || (live && !slot)}>
      {state === "sending" ? "Booking…" : !t ? "Loading times…" : live ? (slot ? bookWords(day, slot) : "Pick a time above") : "Next: pick a time"}</button>
    <p className="bk-fine">{FINE}</p>
  </form>;
}

export function Book() {
  const { search } = useLocation();
  const code = new URLSearchParams(search).get("partner") || "";
  const [partner, setPartner] = useState(null);
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    fetch(API + "/public/book/partner/" + encodeURIComponent(code)).then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j && j.name) setPartner(j.name); }).catch(() => {});
    return () => { alive = false; };
  }, [code]);

  return <section className="bk" data-book-page>
    <div className="bk-head">
      {partner ? <div className="bk-eyebrow" data-book-partner>Recommended by {partner}</div> : <div className="bk-eyebrow">Book a call</div>}
      <h1 className="bk-h1">Bring one question you can't answer about your donors. <em>We'll answer it with you.</em></h1>
      <p className="bk-lead">20 minutes with Jonathan. Bring your question and your export, and we'll look at it in Steward together.</p>
    </div>
    <div className="bk-side"><Card code={code} /></div>
    <div className="bk-rest">
      <Founder />
      <ul className="bk-points">{POINTS.map(p => <li key={p}>{p}</li>)}</ul>
      {showTestimonial && <blockquote className="bk-quote" data-quote="customer" data-book-quote>"{CUSTOMER_QUOTE.words}" <b>{CUSTOMER_QUOTE.who}</b></blockquote>}
    </div>
  </section>;
}
