// email-builder/BlockSettings.jsx · EDITOR-1, BUILDER-1. THE EDIT TAB.
//
// The settings of the selected block, read from and written to the block
// itself (never a second copy of its words): what a text says is typed in the
// email, and a field here (a button's words, an image's words for screen
// readers) is the same field the email shows. Each type offers what its
// render supports (shared/emailBlocks.js, shared/emailBlockStyle.js).
import { useState, useEffect } from "react";
import { T } from "../shared";
import { apiFetch } from "../../api";
import { claimsOf, blockHint } from "../../../../shared/pastGiving.js";   // FLOWS-12 item 1
import { BUTTON_ACTION_LABEL } from "../../../../shared/emailBlocks.js";
import { LIMITS } from "../../../../shared/emailBlockStyle.js";
import { Sec, Row, Slider, Segmented, Switch, Swatches, paneInput, paneBtn, paneNote } from "./controls";
import { MoreSettings } from "./MoreSettings";   // BUILDER-2B: Columns, Box, Social, Code

const BUTTON_ACTIONS = Object.entries(BUTTON_ACTION_LABEL).map(([id, label]) => ({ id, label }));
export const ALIGN_OPTIONS = [{ id: "left", label: "Left" }, { id: "center", label: "Center" }, { id: "right", label: "Right" }];
const tokensIn = s => [...new Set([...String(s || "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]))];
const wordsOf = b => (b.blocks || []).map(p => (p.type === "ul" ? (p.items || []).join(" ") : p.text || "")).join(" ");

export function PhotoChoice({ value, alt, onChange, pick, what = "photo", testid }) {
  return (
    <div data-testid={testid}>
      {value && <img src={value} alt="" style={{ display: "block", width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 8, background: T.bg, marginBottom: 8 }} />}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!value && <span style={{ ...paneNote, flex: 1 }}>No {what} chosen yet</span>}
        <button type="button" style={paneBtn} data-testid={testid ? testid + "-replace" : undefined} onClick={() => pick("photo", item => onChange({ src: item.url, alt: alt || item.alt || "" }))}>{value ? "Replace photo" : "Choose a photo"}</button>
        {value && <button type="button" style={paneBtn} onClick={() => onChange({ src: null, alt })}>Remove</button>}
      </div>
    </div>
  );
}
function AltField({ value, onChange, needed }) {
  return (
    <Sec title="Words for screen readers">
      <input style={{ ...paneInput, borderColor: needed && !String(value || "").trim() ? T.gold : T.bg3 }} value={value || ""} data-testid="block-alt"
        placeholder="What the photo shows" aria-label="Words for screen readers" onChange={e => onChange(e.target.value)} />
      <div style={{ ...paneNote, marginTop: 6 }}>Required in email. Someone who can't see the photo hears these words.</div>
    </Sec>
  );
}

// FLOWS-12 item 1: a text block's version for people who have never given,
// in her words. Steward finds the words that thank them for giving and says so.
function FirstGiftVersion({ b, set }) {
  const claim = claimsOf([b])[0] || null;
  return (
    <Sec title="For people who have never given">
      {claim && <div data-testid="first-gift-hint" style={{ ...paneNote, color: T.ink, marginBottom: 6 }}>{blockHint(claim.phrase)}</div>}
      <textarea id="first-gift-version" data-testid="first-gift-version" aria-label="For people who have never given" style={{ ...paneInput, minHeight: 90, resize: "vertical" }} value={b.firstGift || ""}
        placeholder={claim ? "Your words for someone giving for the first time. A blank line starts a new paragraph." : "Optional. Someone who has never given reads this instead."}
        onChange={e => set({ firstGift: e.target.value || undefined }, "firstGift")} />
    </Sec>
  );
}
// FLOWS-15 item 1: the hero's heading for people who have never given.
function HeroFirstGift({ b, set }) {
  const claim = claimsOf([b])[0] || null;
  if (!claim && !b.firstGiftHeading) return null;
  return (
    <Sec title="For people who have never given">
      {claim && <div data-testid="first-gift-hint" style={{ ...paneNote, color: T.ink, marginBottom: 6 }}>{blockHint(claim.phrase)}</div>}
      <input id="first-gift-heading" data-testid="first-gift-heading" aria-label="Heading for people who have never given" style={paneInput} value={b.firstGiftHeading || ""}
        onChange={e => set({ firstGiftHeading: e.target.value || undefined }, "fgh")} placeholder="Your words for someone giving for the first time" />
      <textarea id="first-gift-sub" data-testid="first-gift-sub" aria-label="Line under it" style={{ ...paneInput, minHeight: 56, resize: "vertical", marginTop: 6 }} value={b.firstGiftSub || ""}
        onChange={e => set({ firstGiftSub: e.target.value || undefined }, "fgs")} placeholder="Line under it (optional)" />
    </Sec>
  );
}
function VideoLink({ onParsed }) {
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  const parse = () => {
    const s = v.trim();
    let m = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,20})/.exec(s)
      || /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,20})/.exec(s)
      || /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,20})/.exec(s);
    if (m) { onParsed({ provider: "youtube", videoId: m[1], thumbUrl: undefined }); setV(""); setBad(false); return; }
    m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/.exec(s);
    if (m) { onParsed({ provider: "vimeo", videoId: m[1] }); setV(""); setBad(false); return; }
    setBad(true);
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input style={{ ...paneInput, borderColor: bad ? T.gold : T.bg3 }} placeholder="or paste a YouTube or Vimeo link" aria-label="Video link" value={v} onChange={e => { setV(e.target.value); setBad(false); }} />
      <button type="button" style={paneBtn} disabled={!v.trim()} onClick={parse}>Use</button>
    </div>
  );
}

// Her signature from LETTERS-1 (Settings, Tax receipts, or her profile), stored
// as a picture the email can carry (a data image never rides in an email).
function SignaturePicture({ b, set }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sigs, setSigs] = useState(null);
  useEffect(() => { apiFetch("/letters/signatures").then(setSigs).catch(() => setSigs({})); }, []);
  const source = sigs && ((sigs.org && sigs.org.image) ? { image: sigs.org.image, who: sigs.org.signerName || "your receipt signer" } : (sigs.mine && sigs.mine.image) ? { image: sigs.mine.image, who: "you" } : null);
  const use = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch("/pictures/upload", { method: "POST", body: JSON.stringify({ image: source.image, as: "signature" }) });
      const err = set({ signatureImage: r.url }, "sig");
      setMsg(err || "");
    } catch (e) { setMsg((e && (e.sentence || e.message)) || "The signature could not be added."); }
    setBusy(false);
  };
  return (
    <Sec title="Signature picture" testid="block-signature-picture">
      {b.signatureImage
        ? <><img src={b.signatureImage} alt="" style={{ maxWidth: "100%", maxHeight: 60, display: "block", marginBottom: 6 }} />
            <button type="button" style={paneBtn} onClick={() => set({ signatureImage: undefined }, "sig")}>Remove it</button></>
        : source
          ? <><div style={{ ...paneNote, marginBottom: 6 }}>The signature saved for {source.who}, in its own ink, above the name.</div>
              <button type="button" style={paneBtn} disabled={busy} data-testid="block-signature-use" onClick={use}>{busy ? "Adding…" : "Add the signature"}</button></>
          : <div style={paneNote}>{sigs ? "No signature saved yet. Add one in Settings, Tax receipts, or in your profile." : "Looking for your signature…"}</div>}
      {msg && <div role="alert" style={{ ...paneNote, color: T.ink, marginTop: 6 }}>{msg}</div>}
    </Sec>
  );
}

// b: the block. set(patch, tag) → null or a sentence. setStyle(patch, tag).
// pick(kind, onPick): the photo or media picker. brand: the swatches.
export function BlockSettings({ b, set, setStyle, pick, events = [], pages = [], brand = {}, fieldLabel = k => k, onOpenBrand, onFieldsTab, role = null }) {
  const st = b.style || {};
  const typed = <Sec><div style={paneNote}>Type its words in the email.</div></Sec>;
  switch (b.type) {
    case "header": return <Sec title="Logo"><div style={paneNote}>Your logo and name, from Brand, so it matches every email.</div>
      {onOpenBrand && <button type="button" style={{ ...paneBtn, marginTop: 8 }} onClick={onOpenBrand}>Open Brand</button>}</Sec>;
    case "footer": return <Sec title="Footer"><div style={paneNote}>Your legal name, mailing address and an unsubscribe link. Always included, so it can't be removed.</div></Sec>;
    case "hero": return <>{typed}<Sec title="Photo"><PhotoChoice value={b.image} alt={b.alt} pick={pick} onChange={({ src, alt }) => set({ image: src, alt }, "photo")} /></Sec>
      <AltField value={b.alt} needed={!!b.image} onChange={v => set({ alt: v }, "alt")} /><HeroFirstGift b={b} set={set} /></>;
    case "richtext": {
      if (b.locked) return <Sec><div style={paneNote} data-testid="email-locked-block">Your tax lines, from your brand kit. This email must carry them, so this block can't be removed or changed.</div></Sec>;
      const used = tokensIn(wordsOf(b));
      return <>
        <Sec title="Text" testid="block-text">
          <Row label="Size"><Slider value={b.size || 16} min={LIMITS.size[0]} max={LIMITS.size[1]} label="Text size" testid="block-text-size" onChange={v => set({ size: v == null || v === 16 ? undefined : v }, "size")} /></Row>
          <Row label="Align"><Segmented options={ALIGN_OPTIONS} value={st.align || "left"} label="Text alignment" testid="block-text-align" onChange={v => setStyle({ align: v === "left" ? undefined : v })} /></Row>
          <Row label="Line spacing"><Slider value={b.lineHeight || 1.6} min={LIMITS.lineHeight[0]} max={LIMITS.lineHeight[1]} step={0.1} unit="" label="Line spacing" testid="block-text-lh" onChange={v => set({ lineHeight: v == null || v === 1.6 ? undefined : v }, "lh")} /></Row>
          <div style={{ ...paneNote, marginTop: 6 }}>Type in the email. Enter starts a new paragraph.</div>
        </Sec>
        <Sec title="Personal fields" testid="block-text-fields">
          <div style={paneNote}>{used.length ? <>In this text: {used.map(fieldLabel).join(", ")}.</> : "None in this text yet."} {onFieldsTab && <button type="button" onClick={onFieldsTab} style={{ background: "none", border: 0, padding: 0, color: T.green, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}>Add from the Fields tab</button>}</div>
        </Sec>
        <FirstGiftVersion b={b} set={set} />
      </>;
    }
    case "image": return <>
      <Sec title="Image" testid="block-image"><PhotoChoice value={b.image} alt={b.alt} pick={pick} testid="block-image-photo" onChange={({ src, alt }) => set({ image: src, alt }, "photo")} /></Sec>
      <AltField value={b.alt} needed onChange={v => set({ alt: v }, "alt")} />
      <Sec>
        <Row label="Width"><Slider value={st.width || 536} min={LIMITS.width[0]} max={LIMITS.width[1]} label="Image width" testid="block-image-width" onChange={v => setStyle({ width: v == null || v >= 536 ? undefined : v })} /></Row>
        <Row label="Rounded corners"><Switch on={!!st.radius} label="Rounded corners" testid="block-image-round" onChange={on => setStyle({ radius: on ? 12 : undefined })} /></Row>
        <Row label="Link it"><Switch on={b.link != null && b.link !== ""} label="Link the photo" testid="block-image-link-on" onChange={on => set({ link: on ? "{{give_link}}" : undefined }, "link")} /></Row>
        {b.link ? <input style={{ ...paneInput, marginTop: 4 }} aria-label="Where the photo goes" placeholder="https://" value={b.link} data-testid="block-image-link"
          onChange={e => set({ link: e.target.value }, "linkv")} /> : null}
        {b.link === "{{give_link}}" && <div style={{ ...paneNote, marginTop: 4 }}>Your giving page. Type a link to send it somewhere else.</div>}
        {b.caption != null && <div style={{ ...paneNote, marginTop: 6 }}>Type the caption under the photo in the email.</div>}
      </Sec>
    </>;
    case "photos2": return <>{[0, 1].map(k => {
      const im = (b.images || [])[k] || { src: null, alt: "" };
      const put = v => { const ims = [...(b.images || [{ src: null, alt: "" }, { src: null, alt: "" }])]; ims[k] = { ...ims[k], ...v }; set({ images: ims }, "ims" + k); };
      return <Sec key={k} title={`Photo ${k + 1}`}>
        <PhotoChoice value={im.src} alt={im.alt} pick={pick} onChange={v => put(v)} />
        <input style={{ ...paneInput, marginTop: 8 }} value={im.alt || ""} placeholder="Words for screen readers" aria-label={`Photo ${k + 1}, words for screen readers`} onChange={e => put({ alt: e.target.value })} />
      </Sec>;
    })}</>;
    case "stats": return <Sec title="Stats">
      <div style={paneNote}>Your own figures only. Type each number and what it counts in the email.</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {(b.items || []).length < 3 && <button type="button" style={paneBtn} onClick={() => set({ items: [...(b.items || []), { value: "", label: "" }] })}>Add a stat</button>}
        {(b.items || []).length > 1 && <button type="button" style={paneBtn} onClick={() => set({ items: (b.items || []).slice(0, -1) })}>Remove the last</button>}
      </div></Sec>;
    case "quote": return <Sec title="Quote"><div style={paneNote}>Type the quote and who said it in the email. The line beside it is your accent color.</div></Sec>;
    case "video": return <Sec title="Video">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ ...paneNote, flex: 1, color: b.videoId ? T.ink : T.ink3 }}>{b.videoId ? `${b.provider === "vimeo" ? "Vimeo" : "YouTube"} video ${b.videoId}` : "No video chosen yet"}</span>
        <button type="button" style={paneBtn} onClick={() => pick("video", item => set({ provider: item.provider, videoId: item.videoId, thumbUrl: item.thumbUrl || undefined, caption: b.caption || item.title || "" }))}>Choose from media</button>
      </div>
      <VideoLink onParsed={ref => set(ref)} />
      <div style={{ ...paneNote, marginTop: 8 }}>Inboxes can't play video, so the email shows its picture with a play button that opens it on your own video page. Type the caption in the email.</div></Sec>;
    case "button": {
      const sw = [brand.button && { id: "button", hex: brand.button, label: "Your button color" }, brand.band && { id: "band", hex: brand.band, label: "Your main color" }, brand.accent && { id: "accent", hex: brand.accent, label: "Your accent color" }].filter(Boolean);
      return <>
        <Sec title="Button" testid="block-button">
          <label style={{ ...paneNote, display: "block" }} htmlFor="blk-btn-words">Words</label>
          <input id="blk-btn-words" style={{ ...paneInput, marginTop: 4 }} value={b.label || ""} data-testid="block-button-words" onChange={e => set({ label: e.target.value }, "label")} />
          <label style={{ ...paneNote, display: "block", marginTop: 10 }} htmlFor="blk-btn-act">Goes to</label>
          <select id="blk-btn-act" style={{ ...paneInput, marginTop: 4 }} value={b.action || "give"} data-testid="block-button-action" onChange={e => set({ action: e.target.value }, "action")}>
            {BUTTON_ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <input style={{ ...paneInput, marginTop: 6 }} aria-label="Link" value={b.url || ""} data-testid="block-button-url" placeholder={b.action === "give" || !b.action ? "Empty: your giving page" : "https://"} onChange={e => set({ url: e.target.value }, "url")} />
        </Sec>
        <Sec>
          <Row label="Full width on phones"><Switch on={!!b.fullPhone} label="Full width on phones" testid="block-button-fullphone" onChange={on => set({ fullPhone: on || undefined }, "fullPhone")} /></Row>
          {sw.length > 0 && <Row label="Color"><Swatches options={sw} value={b.color || "button"} label="Button color" testid="block-button-color" onChange={v => set({ color: v === "button" ? undefined : v }, "color")} /></Row>}
          <div style={{ ...paneNote, marginTop: 4 }}>Colors come from Brand, so every button looks like yours.</div>
        </Sec>
      </>;
    }
    case "event": return <Sec title="Event">
      <select style={paneInput} aria-label="Which event" value={b.eventId || ""} onChange={e => set({ eventId: e.target.value })}>
        <option value="">Choose one of your events…</option>
        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}{ev.date ? ` · ${String(ev.date).slice(0, 10)}` : ""}</option>)}
      </select>
      <div style={{ ...paneNote, marginTop: 6 }}>Its name, date and an RSVP button, from the event itself.</div></Sec>;
    case "givingpage": return <Sec title="Giving page">
      <select style={paneInput} aria-label="Which giving page" value={b.givingPageId || ""} onChange={e => set({ givingPageId: e.target.value })}>
        <option value="">Choose one of your giving pages…</option>
        {pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      <div style={{ ...paneNote, marginTop: 6 }}>Its photo, title and a Give button, from the page itself.</div></Sec>;
    case "divider": return <Sec title="Divider" testid="block-divider">
      <Row label="Thickness"><Slider value={b.thickness || 1} min={LIMITS.thickness[0]} max={LIMITS.thickness[1]} label="Line thickness" testid="block-divider-thickness" onChange={v => set({ thickness: v == null || v === 1 ? undefined : v }, "th")} /></Row>
      <Row label="Spacing"><Slider value={b.spacing == null ? 8 : b.spacing} min={LIMITS.spacing[0]} max={LIMITS.spacing[1]} label="Space above and below" testid="block-divider-spacing" onChange={v => set({ spacing: v == null || v === 8 ? undefined : v }, "sp")} /></Row>
    </Sec>;
    case "giftsummary": return <Sec title="Gift summary">
      <div style={paneNote}>Each person's own gift: its amount, date and fund, filled when it goes. Somebody with no gift sees nothing here. Type its heading in the email.</div></Sec>;
    case "signature": return <>
      <Sec title="Signature" testid="block-signature">
        <label style={{ ...paneNote, display: "block" }} htmlFor="blk-sig-name">Signed by</label>
        <input id="blk-sig-name" style={{ ...paneInput, marginTop: 4 }} value={b.name || ""} data-testid="block-signature-name" onChange={e => set({ name: e.target.value }, "name")} />
        <label style={{ ...paneNote, display: "block", marginTop: 10 }} htmlFor="blk-sig-title">Title</label>
        <input id="blk-sig-title" style={{ ...paneInput, marginTop: 4 }} value={b.title || ""} placeholder="Executive Director" onChange={e => set({ title: e.target.value }, "title")} />
      </Sec>
      <SignaturePicture b={b} set={set} />
      <Sec title="Photo (optional)"><PhotoChoice value={b.photo} alt={b.name} pick={pick} onChange={({ src }) => set({ photo: src }, "photo")} /></Sec>
    </>;
    default: return <MoreSettings b={b} set={set} pick={pick} onOpenBrand={onOpenBrand} role={role} />;
  }
}
