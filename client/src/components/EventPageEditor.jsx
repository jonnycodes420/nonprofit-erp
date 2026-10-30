// PARITY-2 Part 3 / EDITOR-1: THE PUBLIC EVENT PAGE, FROM THE STAFF SIDE.
//
// On the event screens (Events and Fundraising > Events) this is a card that
// says where the page is and opens it in the one editor (StewardEditor). In
// the editor the preview is the page /e/:slug sends (GET /events/:id/page/preview,
// the same function), with its name and description typed where they show
// and its photo clicked for its focus. The rail holds when it starts and
// ends, the page's address, the film, the cover photo and the photographs
// that appear once the night is over. Everything is one of the page's fields,
// saved through PUT /events/:id, the two photo routes, or the one picture door.
import { useState, useEffect, useRef, useCallback } from "react";
import { MailTypeSwitches } from "./MailTypes";   // SEND-GATE-2: the same switch as Settings
import { apiFetch } from "../api";
import { T } from "./shared";
import { askConfirm } from "./ConfirmDialog";
import { errorMessage } from "../lib/domainError";
import { resolveAssetUrl } from "../lib/assetUrl";
import StockPhotoPicker from "./StockPhotoPicker";
import StewardEditor, { RailSection, DeviceFrame, RailPhoto, useNarrow, railLabel, railInput, railQuietBtn, railNote } from "./StewardEditor";
import { suggestEventSlug, parseEventVideo, galleryShows, civil, VIDEO_HOSTS_SENTENCE } from "../../../shared/eventPage";

const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const head = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
const FRAME_CSS = `
[data-st-edit]{outline:none;border-radius:4px;cursor:text;transition:box-shadow .12s}
[data-st-edit]:hover{box-shadow:0 0 0 1px ${T.green500}}
[data-st-edit]:focus{box-shadow:0 0 0 2px ${T.green}}
[data-st-edit]:empty:before{content:attr(data-ph);color:${T.ink3}}
[data-st-photo]{cursor:crosshair;position:relative}
a,button,summary,input,select,textarea{pointer-events:none}
`;
const readFile = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });

// The card on the event screens.
export function EventPageEditor({ eventId, isReadOnly }) {
  const [ev, setEv] = useState(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => apiFetch(`/events/${eventId}`).then(setEv).catch(e => setMsg(errorMessage(e, "Could not load this event's page."))), [eventId]);
  useEffect(() => { load(); }, [load]);
  if (!ev) return msg ? <div role="alert" style={{ fontSize: 13, color: T.ink }}>{msg}</div> : null;
  const published = !!ev.public_slug;
  return (
    <div data-testid="event-page-editor" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", color: T.ink }}>
      <div style={head}>The public page</div>
      <div style={{ fontSize: 13, color: T.ink3, marginBottom: 12, lineHeight: 1.55 }}>
        {published
          ? <>Live at <a href={ev.public_page_url} target="_blank" rel="noreferrer" data-testid="event-page-link" style={{ color: T.greenDk, fontWeight: 700, wordBreak: "break-all" }}>{ev.public_page_url}</a>. People buy tickets, sponsor, give and add it to their calendar there.</>
          : "Not published yet. Give it an address and people can buy tickets, sponsor and give from it."}
      </div>
      <div style={{ marginTop: -6, marginBottom: 10 }}><MailTypeSwitches keys={["event_ticket", "waitlist_offer"]} from="event_editor" /></div>
      <button type="button" style={btn(true)} data-testid="event-page-open" onClick={() => setOpen(true)}>{isReadOnly ? "See the page" : "Edit the page"}</button>
      {open && <EventPageStudio eventId={eventId} isReadOnly={isReadOnly} onClose={() => { setOpen(false); load(); }} />}
    </div>
  );
}

// The event page in the one editor.
export function EventPageStudio({ eventId, isReadOnly, onClose }) {
  const narrow = useNarrow();
  const [ev, setEv] = useState(null);
  const [form, setForm] = useState(null);
  const [html, setHtml] = useState("");
  const [device, setDevice] = useState(narrow ? "phone" : "desktop");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [focusAsk, setFocusAsk] = useState(0);
  const frameRef = useRef(null);
  const typing = useRef(false);
  const live = useRef(null);

  const load = useCallback(async () => {
    const e = await apiFetch(`/events/${eventId}`);
    setEv(e);
    setForm({ startTime: e.start_time || "", endTime: e.end_time || "", heroVideoUrl: e.hero_video_url || "",
      publicSlug: e.public_slug || suggestEventSlug(e.name, civil(e.date)), name: e.name || "", description: e.description || "" });
    return e;
  }, [eventId]);
  const redraw = useCallback(() => {
    if (typing.current) return;
    apiFetch(`/events/${eventId}/page/preview`).then(r => setHtml(r.html || "")).catch(e => setMsg(errorMessage(e, "The page could not be drawn.")));
  }, [eventId]);
  useEffect(() => { load().then(redraw).catch(e => setMsg(errorMessage(e, "Could not load this event's page."))); }, [load, redraw]);

  const cover = ev && ev.hero_image_url ? { url: ev.hero_image_url, ...(ev.hero_meta || {}) } : null;
  live.current = { form, cover };
  const setCover = async p => {
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/pictures/event_cover/${eventId}`, { method: "PUT", body: JSON.stringify({ picture: p }) });
      await load(); redraw(); setMsg(p ? "The cover photo is on the page." : "The cover photo is off the page. It shows without one.");
    } catch (e) { setMsg(errorMessage(e, "That photo did not save.")); }
    setBusy(false);
  };
  const onLoad = () => {
    let doc = null;
    try { doc = frameRef.current && frameRef.current.contentDocument; } catch { doc = null; }
    if (!doc || !doc.body) return;
    const st = doc.createElement("style"); st.textContent = FRAME_CSS; if (doc.head) doc.head.appendChild(st);
    doc.querySelectorAll("[data-st-edit]").forEach(el => {
      if (isReadOnly) return;
      const key = el.getAttribute("data-st-edit"), multi = el.hasAttribute("data-st-multi");
      el.setAttribute("contenteditable", "plaintext-only"); el.setAttribute("role", "textbox");
      el.setAttribute("data-ph", key === "name" ? "The event's name" : "A few words about the event");
      const commit = () => setForm(f => ({ ...f, [key]: el.innerText.replace(/ /g, " ").replace(multi ? /\n{3,}/g : /\s*\n+\s*/g, multi ? "\n\n" : " ").trim() }));
      el.addEventListener("input", commit);
      el.addEventListener("focus", () => { typing.current = true; });
      el.addEventListener("blur", () => { commit(); typing.current = false; });
      el.addEventListener("keydown", e => { if (!multi && e.key === "Enter") { e.preventDefault(); el.blur(); } });
    });
    doc.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a,form,summary"); if (a) e.preventDefault();
      const ph = e.target.closest && e.target.closest("[data-st-photo]");
      if (!ph || isReadOnly) return;
      const c = live.current.cover;
      if (!c) return;
      const r = ph.getBoundingClientRect();
      const fx = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 1000) / 1000;
      const fy = Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 1000) / 1000;
      setCover({ ...c, fx, fy });
      setFocusAsk(n => n + 1);
    });
  };

  if (!ev || !form) return null;
  const published = !!ev.public_slug;
  const video = parseEventVideo(form.heroVideoUrl);
  const gallery = Array.isArray(ev.gallery) ? ev.gallery : [];
  const over = galleryShows({ date: ev.date, endDate: ev.end_date, today: new Date().toISOString().slice(0, 10) });
  const dirty = form.startTime !== (ev.start_time || "") || form.endTime !== (ev.end_time || "") || form.heroVideoUrl !== (ev.hero_video_url || "")
    || form.publicSlug !== (ev.public_slug || "") || form.name !== (ev.name || "") || form.description !== (ev.description || "");
  const save = async (body, ok) => {
    setBusy(true); setMsg("");
    try { await apiFetch(`/events/${eventId}`, { method: "PUT", body: JSON.stringify(body) }); await load(); redraw(); setMsg(ok); }
    catch (e) { setMsg(errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  // The name and the description are the event's own fields, so a change to
  // them is saved with the rest of the event exactly as it stands.
  const saveAll = () => {
    const words = form.name !== (ev.name || "") || form.description !== (ev.description || "");
    const whole = words ? { name: form.name || ev.name, eventType: ev.event_type, date: civil(ev.date), endDate: ev.end_date ? civil(ev.end_date) : null, location: ev.location,
      description: form.description, capacity: ev.capacity, status: ev.status, revenue: ev.revenue, cost: ev.cost, notes: ev.notes } : {};
    return save({ ...whole, startTime: form.startTime, endTime: form.endTime, heroVideoUrl: form.heroVideoUrl, publicSlug: form.publicSlug },
      published || form.publicSlug ? "Saved. The page shows it now." : "Saved.");
  };
  const upload = async (files, ok) => {
    setBusy(true); setMsg("");
    try {
      for (const f of files) await apiFetch(`/events/${eventId}/photos`, { method: "POST", body: JSON.stringify({ image: await readFile(f) }) });
      await load(); redraw(); setMsg(ok);
    } catch (e) { setMsg(errorMessage(e, "That photograph did not upload.")); }
    setBusy(false);
  };
  const removePhoto = async p => {
    setBusy(true); setMsg("");
    try { await apiFetch(`/events/${eventId}/photos/remove`, { method: "POST", body: JSON.stringify({ path: p.path }) }); await load(); redraw(); setMsg("Removed from the gallery."); }
    catch (e) { setMsg(errorMessage(e, "That did not come off.")); }
    setBusy(false);
  };
  const back = async () => { if (!dirty || await askConfirm({ title: "Leave without saving?", body: "Your changes to the page have not been saved.", yes: "Leave" })) onClose(); };

  const left = (
    <fieldset disabled={isReadOnly} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
      <RailSection id="details" title="Details">
        <div style={railNote}>Type the event's name and description in the page.</div>
        <label style={railLabel}>Page address</label>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 13, color: T.ink3 }}>/e/</span>
          <input value={form.publicSlug} onChange={e => setForm({ ...form, publicSlug: e.target.value })} style={railInput} data-testid="event-slug" /></span>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ flex: 1 }}><span style={railLabel}>Starts</span><input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} style={railInput} data-testid="event-start-time" /></label>
          <label style={{ flex: 1 }}><span style={railLabel}>Ends</span><input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} style={railInput} data-testid="event-end-time" /></label>
        </div>
      </RailSection>
      <RailSection id="cover" title="Cover photo" focus={focusAsk}>
        <RailPhoto value={cover} name={ev.name} testid="editor-cover-photo" onChange={setCover} onLibrary={() => setStockOpen(true)} />
        {form.heroVideoUrl && video && <div style={{ ...railNote, marginTop: 6 }}>A film is set, so the film shows at the top of the page in place of the photo.</div>}
      </RailSection>
      <RailSection id="film" title="Film" defaultOpen={!!form.heroVideoUrl}>
        <label style={{ ...railLabel, marginTop: 0 }}>A film for the top of the page (optional)</label>
        <input value={form.heroVideoUrl} placeholder="https://www.youtube.com/watch?v=..." onChange={e => setForm({ ...form, heroVideoUrl: e.target.value })} style={railInput} data-testid="event-video" />
        <div style={{ ...railNote, marginTop: 6, color: form.heroVideoUrl && !video ? T.ink : T.ink3 }}>
          {form.heroVideoUrl && !video ? `That link is not one the page can show. ${VIDEO_HOSTS_SENTENCE}` : "A film takes the place of the picture. It plays from YouTube's no-cookie player or Vimeo's do-not-track player."}
        </div>
      </RailSection>
      <RailSection id="gallery" title="Photographs from the night" defaultOpen={false}>
        <div style={railNote} data-testid="event-gallery-note">
          {over ? `${gallery.length} on the page now.` : `Add them whenever you have them. They appear on the page once the event is over${gallery.length ? `; ${gallery.length} waiting` : ""}.`}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6, margin: "8px 0" }}>
          {gallery.map(p => (
            <div key={p.path} style={{ position: "relative" }}>
              <img src={resolveAssetUrl(p.path) + "?w=320"} alt={p.caption || ""} title={p.caption || ""} style={{ display: "block", width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
              {!isReadOnly && <button type="button" disabled={busy} onClick={() => removePhoto(p)} aria-label="Remove this photograph" data-testid="event-photo-remove"
                style={{ position: "absolute", top: 4, right: 4, background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 99, width: 24, height: 24, fontSize: 13, lineHeight: "20px", cursor: "pointer", padding: 0 }}>×</button>}
            </div>))}
        </div>
        {!isReadOnly && <label style={{ ...railQuietBtn, display: "inline-block" }}>Add photographs
          <input type="file" accept="image/*" multiple hidden data-testid="event-photos-file"
            onChange={e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) upload(f.slice(0, 20), `${f.length} added to the gallery.`); }} /></label>}
      </RailSection>
    </fieldset>
  );
  return (
    <div data-testid="event-page-studio" style={{ position: "fixed", inset: 0, zIndex: 390 }}>
      <StewardEditor kind="event" back={{ onClick: back, label: "Event" }} name={form.name || ev.name} badge="Event page"
        device={device} onDevice={setDevice}
        status={busy ? "Saving…" : dirty ? "Unsaved changes" : published ? "Live" : "Not published"}
        actions={[
          published && { id: "open", label: "Open the live page", onClick: () => window.open(ev.public_page_url, "_blank", "noopener") },
          published && !isReadOnly && { id: "unpublish", label: "Take the page down", testid: "event-page-unpublish", onClick: async () => {
            if (await askConfirm({ title: "Take the page down?", body: "Its address stops working, including any link already shared.", yes: "Take it down", danger: true })) save({ publicSlug: "" }, "The page is down. Nothing about the event changed.");
          } },
        ]}
        primary={isReadOnly ? null : { label: busy ? "Saving…" : published ? "Save the page" : "Publish the page", onClick: saveAll, disabled: busy || (published && !dirty), testid: "event-page-save" }}
        notice={msg ? <div role="status" data-testid="event-page-msg" style={{ background: T.gold50, color: T.ink, fontSize: 13, padding: "8px 16px", borderBottom: "1px solid " + T.gold300 }}>{msg}</div> : null}
        left={left}>
        <DeviceFrame device={device} narrow={narrow}>
          <iframe ref={frameRef} title="The event page" data-testid="event-page-preview" sandbox="allow-same-origin" srcDoc={html} onLoad={onLoad}
            style={{ display: "block", width: "100%", flex: 1, minHeight: 520, border: 0, background: T.white }} />
        </DeviceFrame>
      </StewardEditor>
      {stockOpen && <StockPhotoPicker current={cover} onClose={() => setStockOpen(false)} onPick={p => { setStockOpen(false); setCover(p); }} />}
    </div>
  );
}
