// ONBOARD-4 item 3 · /book, THE WEBSITE'S ONE ACTION (Jonathan, 23 Nov 2026).
//
// Nobody signs up cold: every org that signs does it after a call with Jonathan, through the
// close link he sends. This page is the way to that call. A short form first, then his open
// slots (booking/slots.jsx, the one adapter to the booking tool). The form lands in the sales CRM
// as a deal with its answers, the file and the partner, and a task for Jonathan (POST /public/book,
// server/admin/sales/booking.js). Steward sends the prospect nothing; the booking tool sends its
// own confirmation.
//
// /book?partner=<code> shows "Recommended by <partner>" at the top when the code is known; an
// unknown code shows nothing and she books the same way.
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Crumbs, Photo, Tick } from "../lib";
import { API } from "../../api";
import { SlotPicker } from "../booking/slots";

export const BOOK_FALLBACK = "That did not go through. Please email jonathan@stewardapp.dev and he will set up a time with you.";
const DONOR_COUNTS = ["Under 500", "500 to 2,500", "2,500 to 10,000", "Over 10,000", "Not sure"];
const MAX_FILE = 3 * 1024 * 1024;   // the server's limit (an anonymous request is read by the 5 MB parser)

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  // Sent whole, as a data: URL: the server's field caps let a data: URL through (it has its own
  // byte limit, 3 MB here), where a bare base64 string over a million characters is refused.
  r.onload = () => resolve(String(r.result).replace(/^data:(;base64,)/, "data:application/octet-stream$1"));
  r.onerror = () => reject(new Error("read"));
  r.readAsDataURL(file);
});

export function Book() {
  const { search } = useLocation();
  const code = new URLSearchParams(search).get("partner") || "";
  const [partner, setPartner] = useState(null);
  const [f, setF] = useState({ name: "", orgName: "", email: "", phone: "", currentSystem: "", donorCount: "Not sure", worthIt: "", website: "" });
  const [file, setFile] = useState(null);
  const [state, setState] = useState("idle");
  const [err, setErr] = useState("");
  const set = k => e => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!code) return undefined;
    let live = true;
    fetch(API + "/public/book/partner/" + encodeURIComponent(code)).then(r => (r.ok ? r.json() : null))
      .then(j => { if (live && j && j.name) setPartner(j.name); }).catch(() => {});
    return () => { live = false; };
  }, [code]);

  function pick(e) {
    const x = e.target.files && e.target.files[0];
    setErr("");
    if (x && x.size > MAX_FILE) { setFile(null); e.target.value = ""; setErr("That file is over 3 MB. Book the call without it and bring it with you; we'll load it together."); return; }
    setFile(x || null);
  }

  async function submit(e) {
    e.preventDefault();
    setState("sending"); setErr("");
    try {
      const body = { ...f, name: f.name.trim(), orgName: f.orgName.trim(), email: f.email.trim(), partner: code || undefined };
      if (file) body.file = { name: file.name, type: file.type, data: await readAsDataUrl(file) };
      const r = await fetch(API + "/public/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || BOOK_FALLBACK);
      setState("slots");
      setTimeout(() => { const el = document.querySelector("[data-book-slots]"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
    } catch (x) {
      setState("idle"); setErr((x && x.message) || BOOK_FALLBACK);
    }
  }
  const booked = useCallback(() => setState("booked"), []);

  return <>
    <Crumbs list={[["Book a call"]]} />
    <section className="hero phero"><div className="wrap hero-g">
      <div>
        {/* The walk: two eyebrows ran together on one line; a partner's name takes the eyebrow's place. */}
        {partner ? <div className="eyebrow" data-book-partner>Recommended by {partner}</div> : <div className="eyebrow">Book a call</div>}
        <h1 className="mix h-xl">Bring one question you can't answer about your donors. <b>We'll answer it with your own file.</b></h1>
        <p className="lede">Twenty minutes with Jonathan, who built Steward. Tell us a little first, then pick a time. Pricing depends on the size of your donor file and comes with hands-on setup; we'll walk you through it on the call.</p>
        {state === "slots" || state === "booked" ? (
          <div data-book-sent>
            <p className="lede" style={{ marginTop: 22 }}>{state === "booked" ? "You're booked. The calendar has sent you the invitation, and Jonathan will have read your answers before the call." : "Thank you. Now pick a time below; the calendar sends you the invitation."}</p>
          </div>
        ) : (
          <form className="form" onSubmit={submit} data-book-form>
            <label htmlFor="book-name">Your name<input id="book-name" required name="name" autoComplete="name" value={f.name} onChange={set("name")} /></label>
            <label htmlFor="book-org">Organization<input id="book-org" required name="organization" autoComplete="organization" value={f.orgName} onChange={set("orgName")} /></label>
            <label htmlFor="book-email">Work email<input id="book-email" type="email" required name="email" autoComplete="email" value={f.email} onChange={set("email")} /></label>
            <label htmlFor="book-phone">Phone<input id="book-phone" type="tel" name="phone" autoComplete="tel" value={f.phone} onChange={set("phone")} /></label>
            <label htmlFor="book-system">What do you use for donors today?<input id="book-system" name="currentSystem" autoComplete="off" placeholder="A spreadsheet, another donor system, not sure" value={f.currentSystem} onChange={set("currentSystem")} /></label>
            <label htmlFor="book-count">Roughly how many donors?<select id="book-count" name="donorCount" value={f.donorCount} onChange={set("donorCount")}>{DONOR_COUNTS.map(c => <option key={c}>{c}</option>)}</select></label>
            <label htmlFor="book-file">Your donor file, if you'd like us to look before the call (optional, up to 3 MB)<input id="book-file" type="file" name="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.zip" onChange={pick} /></label>
            <label htmlFor="book-worth">What would make this worth it?<textarea id="book-worth" name="worthIt" rows={3} value={f.worthIt} onChange={set("worthIt")} style={{ font: "17px var(--sans)", padding: "14px 16px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--white)", color: "var(--ink)" }} /></label>
            <label htmlFor="book-website" aria-hidden="true" style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>Website<input id="book-website" tabIndex={-1} autoComplete="off" name="website" value={f.website} onChange={set("website")} /></label>
            {err && <p className="form-err" role="alert">{err}</p>}
            <button className="pill pill-ink" type="submit" disabled={state === "sending"}><i></i>{state === "sending" ? "Sending…" : "Next: pick a time"}</button>
          </form>
        )}
      </div>
      <div>
        <Photo k="video-call" cls="tall" eager />
        <div className="incl" style={{ gridTemplateColumns: "1fr", marginTop: 26 }}>
          <span><Tick />See your own drifting donors</span><span><Tick />A clear plan for the move</span><span><Tick />Hands-on setup, done with you</span>
        </div>
      </div>
    </div></section>
    {/* The walk: inside the hero's left column the calendar was too narrow to use; it gets the page's width. */}
    {state === "slots" && <section style={{ paddingTop: 0, scrollMarginTop: 110 }} data-book-slots><div className="wrap"><SlotPicker name={f.name.trim()} email={f.email.trim()} onBooked={booked} /></div></section>}
  </>;
}
