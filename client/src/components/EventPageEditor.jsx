// PARITY-2 Part 3: THE PUBLIC EVENT PAGE, FROM THE STAFF SIDE.
//
// One card, used on both event screens (Events and Fundraising > Events):
// when it starts and ends, the page's address, its picture or film, and the
// photographs that appear on the page once the night is over. The page itself
// is rendered by the server (GET /e/:slug); everything here is one of its
// fields, saved through PUT /events/:id (page fields only, never the rest of
// the event) or the two photo routes.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { resolveAssetUrl } from "../lib/assetUrl";
import { suggestEventSlug, parseEventVideo, galleryShows, civil, VIDEO_HOSTS_SENTENCE } from "../../../shared/eventPage";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: T.ink, fontFamily: "inherit", boxSizing: "border-box", minWidth: 0 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const head = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: T.ink3 };

const readFile = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });

export function EventPageEditor({ eventId, isReadOnly, today }) {
  const [ev, setEv] = useState(null);
  const [form, setForm] = useState({ startTime: "", endTime: "", heroVideoUrl: "", publicSlug: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => apiFetch(`/events/${eventId}`).then(e => {
    setEv(e);
    setForm({ startTime: e.start_time || "", endTime: e.end_time || "", heroVideoUrl: e.hero_video_url || "",
              publicSlug: e.public_slug || suggestEventSlug(e.name, civil(e.date)) });
  }).catch(e => setMsg(errorMessage(e, "Could not load this event's page.")));
  useEffect(() => { load(); }, [eventId]);
  if (!ev) return msg ? <div role="alert" style={{ fontSize: 13, color: T.ink }}>{msg}</div> : null;

  const save = async (body, ok) => {
    setBusy(true); setMsg("");
    try { await apiFetch(`/events/${eventId}`, { method: "PUT", body: JSON.stringify(body) }); await load(); setMsg(ok); }
    catch (e) { setMsg(errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  const upload = async (url, files, ok) => {
    setBusy(true); setMsg("");
    try {
      for (const f of files) await apiFetch(url, { method: "POST", body: JSON.stringify({ image: await readFile(f) }) });
      await load(); setMsg(ok);
    } catch (e) { setMsg(errorMessage(e, "That photograph did not upload.")); }
    setBusy(false);
  };
  const removeHero = async () => {
    setBusy(true); setMsg("");
    try { await apiFetch(`/events/${eventId}/hero`, { method: "POST", body: JSON.stringify({ image: "" }) }); await load(); setMsg("The picture is off the page."); }
    catch (e) { setMsg(errorMessage(e, "That did not come off.")); }
    setBusy(false);
  };
  const removePhoto = async p => {
    setBusy(true); setMsg("");
    try { await apiFetch(`/events/${eventId}/photos/remove`, { method: "POST", body: JSON.stringify({ path: p.path }) }); await load(); setMsg("Removed from the gallery."); }
    catch (e) { setMsg(errorMessage(e, "That did not come off.")); }
    setBusy(false);
  };

  const published = !!ev.public_slug;
  const video = parseEventVideo(form.heroVideoUrl);
  const gallery = Array.isArray(ev.gallery) ? ev.gallery : [];
  const over = galleryShows({ date: ev.date, endDate: ev.end_date, today: today || new Date().toISOString().slice(0, 10) });
  return (
    <div data-testid="event-page-editor" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", color: T.ink }}>
      <div style={head}>The public page</div>
      <div style={{ fontSize: 13, color: T.ink3, marginBottom: 12, lineHeight: 1.55 }}>
        {published
          ? <>Live at <a href={ev.public_page_url} target="_blank" rel="noreferrer" data-testid="event-page-link" style={{ color: T.greenDk, fontWeight: 700, wordBreak: "break-all" }}>{ev.public_page_url}</a>. People buy tickets, sponsor, give and add it to their calendar there.</>
          : "Not published yet. Give it an address and people can buy tickets, sponsor and give from it."}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={lbl}>Starts<input type="time" value={form.startTime} disabled={isReadOnly} onChange={e => setForm({ ...form, startTime: e.target.value })} style={inp} data-testid="event-start-time" /></label>
        <label style={lbl}>Ends<input type="time" value={form.endTime} disabled={isReadOnly} onChange={e => setForm({ ...form, endTime: e.target.value })} style={inp} data-testid="event-end-time" /></label>
        <label style={{ ...lbl, flex: "1 1 220px" }}>Page address
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 13, color: T.ink3, fontWeight: 400 }}>/e/</span>
            <input value={form.publicSlug} disabled={isReadOnly} onChange={e => setForm({ ...form, publicSlug: e.target.value })} style={{ ...inp, flex: 1 }} data-testid="event-slug" /></span>
        </label>
      </div>
      <label style={{ ...lbl, marginBottom: 12 }}>A film for the top of the page (optional)
        <input value={form.heroVideoUrl} disabled={isReadOnly} placeholder="https://www.youtube.com/watch?v=..." onChange={e => setForm({ ...form, heroVideoUrl: e.target.value })} style={inp} data-testid="event-video" />
        <span style={{ fontWeight: 400, color: form.heroVideoUrl && !video ? T.ink : T.ink3 }}>
          {form.heroVideoUrl && !video ? `That link is not one the page can show. ${VIDEO_HOSTS_SENTENCE}` : "A film takes the place of the picture. It plays from YouTube's no-cookie player or Vimeo's do-not-track player."}
        </span>
      </label>
      {!isReadOnly && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button disabled={busy} data-testid="event-page-save" style={btn(true)}
          onClick={() => save({ startTime: form.startTime, endTime: form.endTime, heroVideoUrl: form.heroVideoUrl, publicSlug: form.publicSlug },
            published || form.publicSlug ? "Saved. The page shows it now." : "Saved.")}>
          {published ? "Save the page" : "Publish the page"}</button>
        {published && <button disabled={busy} style={btn(false)} data-testid="event-page-unpublish"
          onClick={() => { if (confirm("Take the page down? Its address stops working, including any link already shared.")) save({ publicSlug: "" }, "The page is down. Nothing about the event changed."); }}>
          Take the page down</button>}
      </div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <div>
          <div style={head}>Picture</div>
          {ev.hero_image_url
            ? <img src={resolveAssetUrl(ev.hero_image_url) + "?w=640"} alt="" style={{ display: "block", width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 10, marginBottom: 8 }} />
            : <div style={{ fontSize: 13, color: T.ink3, marginBottom: 8 }}>No picture yet. A wide photograph works best.</div>}
          {!isReadOnly && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ ...btn(false), display: "inline-block" }}>{ev.hero_image_url ? "Replace" : "Add a picture"}
              <input type="file" accept="image/*" hidden data-testid="event-hero-file"
                onChange={e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) upload(`/events/${eventId}/hero`, f.slice(0, 1), "The picture is on the page."); }} /></label>
            {ev.hero_image_url && <button disabled={busy} style={btn(false)} onClick={removeHero}>Remove</button>}
          </div>}
        </div>
        <div>
          <div style={head}>Photographs from the night</div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 8, lineHeight: 1.5 }} data-testid="event-gallery-note">
            {over ? `${gallery.length} on the page now.` : `Add them whenever you have them. They appear on the page once the event is over${gallery.length ? `; ${gallery.length} waiting` : ""}.`}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6, marginBottom: 8 }}>
            {gallery.map(p => (
              <div key={p.path} style={{ position: "relative" }}>
                <img src={resolveAssetUrl(p.path) + "?w=320"} alt={p.caption || ""} title={p.caption || ""} style={{ display: "block", width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
                {!isReadOnly && <button disabled={busy} onClick={() => removePhoto(p)} aria-label="Remove this photograph" data-testid="event-photo-remove"
                  style={{ position: "absolute", top: 4, right: 4, background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 99, width: 24, height: 24, fontSize: 13, lineHeight: "20px", cursor: "pointer", padding: 0 }}>×</button>}
              </div>))}
          </div>
          {!isReadOnly && <label style={{ ...btn(false), display: "inline-block" }}>Add photographs
            <input type="file" accept="image/*" multiple hidden data-testid="event-photos-file"
              onChange={e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) upload(`/events/${eventId}/photos`, f.slice(0, 20), `${f.length} added to the gallery.`); }} /></label>}
        </div>
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink, marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
