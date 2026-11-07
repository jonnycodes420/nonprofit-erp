// PortalEditorBlockOptions.jsx · the editor's "This block" options and the
// editor chrome's own palette. Split from PortalEditor.jsx by PAGES-1 so the
// editor stays well under 1,500 lines; the code is unchanged. It is the same
// editor surface as PortalEditor.jsx, so tests/brand-allowlist.test.js scopes
// it out for the same reason.
import { useState } from "react";
import { WIDGETS } from "../../../shared/pageWidgets";
import { resolveAssetUrl } from "../lib/assetUrl";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "../components/Uploader";
import PhotoField from "../components/PhotoField";
import { PortalBannerCrop, PORTAL_WIDGET_IMAGE_RATIO } from "../components/PortalBanner";
import MediaPicker from "../components/MediaPicker";

const WIDGET_META = Object.fromEntries(WIDGETS.map(w => [w.key, { label: w.label, hint: w.hint }]));
export const E = {
  ink: "#0f1a12", cream: "#f0ede6", gold: "#c9a84c", bg3: "#dcd8cc", terra: "#8a3a24", green: "#0d5c3a",
  // The editor chrome's own four, named rather than repeated thirty-four times.
  line: "#3a4a3e", muted: "#6b6b64", panel: "#1b2a20", preview: "#1a6b4a",

  // FIX-2 C — named here once, where they were inline.
  white: "#ffffff",
  paper: "#faf9f6",
  hair: "#e7e4dc",
  editInk: "#101a13",
  editPanel2: "#2a3a2e",
  sage: "#8fa896",
  terra100: "#f6e3dd",
  editGround: "#f7f5ef",
  editLine: "#e0dcd0",
  body: "#1c1c1a",
};
export const btnQuiet = { background: "transparent", color: E.cream, border: "1px solid " + E.line, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
export const inp = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1px solid " + E.bg3, borderRadius: 8, fontFamily: "inherit" };
export const lbl = { fontSize: 11, fontWeight: 700, color: E.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" };

export default function WidgetOptions({ w, funds, camps, volData, onChange, onClose }) {
  // EMAIL-1: the media library, shared with emails. `picker` is
  // { kind, onPick } while the picker is open; picking fills the widget with
  // the item's /portal-assets path (and its words where the widget has them),
  // which the draft route stores as it is. The upload beside it still works.
  const [picker, setPicker] = useState(null);
  const pickerModal = picker && (
    <MediaPicker kind={picker.kind} onClose={() => setPicker(null)}
      onPick={item => { setPicker(null); picker.onPick(item); }} />
  );
  const libraryBtn = (kind, onPick) => (
    <button type="button" data-testid="choose-from-library" onClick={() => setPicker({ kind, onPick })}
      style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 6, padding: "6px 12px", fontSize: 12 }}>
      Choose from your library
    </button>
  );
  const head = (<>{pickerModal}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{WIDGET_META[w.type]?.label}</div>
      <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: E.muted }}>Done ✕</button>
    </div></>
  );
  const imgUploader = (value, set, label = "Photo", onPickItem = null) => (
    <>
      <div style={lbl}>{label}</div>
      {/* FIX-41: the one picture control, as on the cover and every item. */}
      <PhotoField variant="cover" noAlt value={value || null} name={w.heading || w.caption || ""} testid="widget-photo"
        onChange={p => set(p ? p.url : null)} />
      {libraryBtn("photo", item => (onPickItem ? onPickItem(item) : set(item.url)))}
    </>
  );
  // The words a screen reader hears for the photo; filled from the library.
  const altField = () => (
    <><div style={lbl}>Describe the photo</div>
      <input style={inp} value={w.alt || ""} maxLength={300} placeholder="What the photo shows, in a few words"
        onChange={e => onChange({ alt: e.target.value })} /></>
  );
  // BUILD-65 Part 3 — the non-destructive crop for a widget image; same
  // PortalBannerCrop the banner uses, at the widget ratio, so preview==render.
  const imgCropper = (value, crop, setCrop) => value ? (
    <div style={{ marginTop: 8 }}>
      <PortalBannerCrop url={String(value).startsWith("data:") ? value : resolveAssetUrl(value)}
        crop={crop || null} ratio={PORTAL_WIDGET_IMAGE_RATIO} onChange={setCrop} />
    </div>
  ) : null;
  switch (w.type) {
    case "hero": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      <div style={lbl}>Subheading</div><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={w.sub || ""} onChange={e => onChange({ sub: e.target.value })} />
      <div style={lbl}>Size</div>
      <select style={inp} value={w.size || "standard"} onChange={e => onChange({ size: e.target.value })}>
        <option value="standard">Standard</option><option value="tall">Tall</option>
      </select>
      {imgUploader(w.image, v => onChange({ image: v, imageCrop: null }), "Photo", item => onChange({ image: item.url, imageCrop: null, alt: item.alt }))}
      {imgCropper(w.image, w.imageCrop, c => onChange({ imageCrop: c }))}
      {w.image && altField()}</>;
    // EDITOR-1: a text block's words are typed in the preview, where they show.
    case "richtext": return <>{head}
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5 }}>Type in the block in the preview. A blank line starts a new paragraph, "## " a heading, "- " a list.</div></>;
    case "image": return <>{head}
      {imgUploader(w.image, v => onChange({ image: v, imageCrop: null }), "Photo", item => onChange({ image: item.url, imageCrop: null, alt: item.alt }))}
      {imgCropper(w.image, w.imageCrop, c => onChange({ imageCrop: c }))}
      {w.image && altField()}
      <div style={lbl}>Caption</div><input style={inp} value={w.caption || ""} onChange={e => onChange({ caption: e.target.value })} /></>;
    case "gallery": return <>{head}
      <div style={lbl}>Photos</div>
      {/* Multi-photo site: the images array is not a single preview, so the
          thumbnail strip renders as children below the drop zone. */}
      <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact multiple
        label="Drag photos here, or browse"
        hint={"Up to 8 photos · " + IMAGE_ACCEPT_LABEL}
        disabled={(w.images || []).length >= 8}
        onFile={({ dataUrl }) => onChange({ images: [...(w.images || []), dataUrl].slice(0, 8) })}>
        {(w.images || []).length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {(w.images || []).map((u, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={String(u).startsWith("data:") ? u : resolveAssetUrl(u)} alt="" style={{ height: 48, borderRadius: 6 }} />
                <button onClick={() => onChange({ images: w.images.filter((_, j) => j !== i) })}
                  style={{ position: "absolute", top: -6, right: -6, background: E.ink, color: E.white, border: "none", borderRadius: "50%", width: 16, height: 16, fontSize: 9, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Uploader>
      {(w.images || []).length < 8 && libraryBtn("photo", item => onChange({ images: [...(w.images || []), item.url].slice(0, 8) }))}</>;
    case "stats": return <>{head}
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5, marginBottom: 4 }}>Your own numbers, in your own words, nothing is computed or invented for you.</div>
      {(w.items || []).map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input style={{ ...inp, width: 90 }} placeholder="1,200" value={it.value} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
          <input style={inp} placeholder="meals served" value={it.label} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
          <button onClick={() => onChange({ items: w.items.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: E.terra, cursor: "pointer" }}>✕</button>
        </div>
      ))}
      {(w.items || []).length < 4 && <button onClick={() => onChange({ items: [...(w.items || []), { value: "", label: "" }] })} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add stat</button>}</>;
    case "funds": {
      // BUILD-55 — manual sort: fundIds IS the display order. Chosen funds
      // list with ↑ ↓ reorder (the first leads the section); the rest are
      // one-tap adds below.
      const chosen = (w.fundIds || []).map(id => funds.find(f => f.id === id)).filter(Boolean);
      const unchosen = funds.filter(f => !(w.fundIds || []).includes(f.id));
      const moveFund = (i, dir) => {
        const next = (w.fundIds || []).slice();
        const j = i + dir;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        onChange({ fundIds: next });
      };
      return <>{head}
        <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
        <div style={lbl}>Funds, in display order</div>
        {chosen.map((f, i) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, background: E.white, border: "1px solid "+E.editLine, borderRadius: 8, padding: "6px 8px", marginBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            <button aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => moveFund(i, -1)} style={{ background: "none", border: "1px solid "+E.editLine, borderRadius: 6, width: 24, height: 22, fontSize: 11, cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1 }}>↑</button>
            <button aria-label={`Move ${f.name} down`} disabled={i === chosen.length - 1} onClick={() => moveFund(i, +1)} style={{ background: "none", border: "1px solid "+E.editLine, borderRadius: 6, width: 24, height: 22, fontSize: 11, cursor: i === chosen.length - 1 ? "default" : "pointer", opacity: i === chosen.length - 1 ? 0.35 : 1 }}>↓</button>
            <button aria-label={`Remove ${f.name}`} onClick={() => onChange({ fundIds: (w.fundIds || []).filter(x => x !== f.id) })} style={{ background: "none", border: "none", color: E.terra, fontSize: 12, cursor: "pointer" }}>✕</button>
          </div>
        ))}
        {!chosen.length && <div style={{ fontSize: 12, color: E.muted, marginBottom: 4 }}>Nothing selected yet, the first fund you add leads the section.</div>}
        {chosen.length >= 6 && <div style={{ fontSize: 11.5, color: E.muted, marginBottom: 4 }}>Up to 6 funds show here.</div>}
        {unchosen.length > 0 && chosen.length < 6 && <>
          <div style={lbl}>Add a fund</div>
          {unchosen.map(f => (
            <button key={f.id} onClick={() => onChange({ fundIds: [...(w.fundIds || []), f.id].slice(0, 6) })}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "1px dashed " + E.bg3, borderRadius: 8, padding: "6px 10px", marginBottom: 4, fontSize: 13, cursor: "pointer" }}>
              + {f.name}
            </button>
          ))}
        </>}
        {!funds.length && <div style={{ fontSize: 12, color: E.muted }}>No funds yet, create them in Finance.</div>}
        <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
          Each card's Give button carries that fund as the gift's designation.
        </div>
      </>;
    }
    case "campaign": return <>{head}
      <div style={lbl}>Campaign</div>
      <select style={inp} value={w.campaignId || ""} onChange={e => onChange({ campaignId: e.target.value })}>
        <option value="">Pick a campaign</option>
        {camps.map(c => <option key={c.id} value={c.id}>{c.donorFacingName || c.name}</option>)}
      </select>
      <div style={{ fontSize: 12, color: E.muted, marginTop: 8, lineHeight: 1.5 }}>
        The story, photo, and goal come from the campaign itself, edit them in Fundraising. A campaign with no donor-facing content shows nothing here.
      </div></>;
    case "impact": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} /></>;
    case "quote": return <>{head}
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5 }}>Type the quote and who said it in the preview.</div></>;
    case "staff": return <>{head}
      {(w.members || []).map((m, i) => (
        <div key={i} style={{ border: "1px solid "+E.editLine, borderRadius: 8, padding: 8, marginTop: 8 }}>
          <input style={inp} placeholder="Name" value={m.name} onChange={e => onChange({ members: w.members.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
          <input style={{ ...inp, marginTop: 6 }} placeholder="Role" value={m.role} onChange={e => onChange({ members: w.members.map((x, j) => j === i ? { ...x, role: e.target.value } : x) })} />
          {imgUploader(m.photo, v => onChange({ members: w.members.map((x, j) => j === i ? { ...x, photo: v } : x) }), "Photo (optional)")}
          <button onClick={() => onChange({ members: w.members.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: E.terra, fontSize: 12, cursor: "pointer", marginTop: 6 }}>Remove person</button>
        </div>
      ))}
      {(w.members || []).length < 6 && <button onClick={() => onChange({ members: [...(w.members || []), { name: "", role: "", photo: null }] })} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add person</button>}
      <div style={lbl}>Contact email</div><input style={inp} value={w.contactEmail || ""} onChange={e => onChange({ contactEmail: e.target.value })} /></>;
    case "faq": return <>{head}
      {(w.items || []).map((it, i) => (
        <div key={i} style={{ border: "1px solid "+E.editLine, borderRadius: 8, padding: 8, marginTop: 8 }}>
          <input style={inp} placeholder="Question" value={it.q} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, q: e.target.value } : x) })} />
          <textarea style={{ ...inp, marginTop: 6, resize: "vertical" }} rows={2} placeholder="Answer" value={it.a} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, a: e.target.value } : x) })} />
          <button onClick={() => onChange({ items: w.items.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: E.terra, fontSize: 12, cursor: "pointer", marginTop: 6 }}>Remove</button>
        </div>
      ))}
      {(w.items || []).length < 10 && <button onClick={() => onChange({ items: [...(w.items || []), { q: "", a: "" }] })} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add question</button>}</>;
    case "video": return <>{head}
      <div style={lbl}>YouTube or Vimeo link</div>
      <input style={inp} placeholder="https://youtu.be/…" value={w.url || (w.videoId ? `(saved ${w.provider} video)` : "")}
        onChange={e => onChange({ url: e.target.value, provider: undefined, videoId: undefined })} />
      {libraryBtn("video", item => onChange({ url: item.url, provider: undefined, videoId: undefined, caption: w.caption || item.title || "" }))}
      <div style={{ fontSize: 12, color: E.muted, marginTop: 6, lineHeight: 1.5 }}>Only YouTube and Vimeo links work, the video ID is stored, never pasted embed code.</div>
      <div style={lbl}>Caption</div><input style={inp} value={w.caption || ""} onChange={e => onChange({ caption: e.target.value })} /></>;
    case "give": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      <div style={lbl}>Button label</div><input style={inp} value={w.buttonLabel || ""} onChange={e => onChange({ buttonLabel: e.target.value })} /></>;
    // ── VOL-PAGE-1 · the volunteer blocks. Roles, shifts and numbers come
    // from Volunteers; only headings, choices and the org's own words are set here.
    case "opportunities":
    case "shiftpicker": {
      const opps = (volData && volData.opportunities) || [];
      const ids = Array.isArray(w.opportunityIds) ? w.opportunityIds : [];
      const toggleOpp = id => onChange({ opportunityIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] });
      return <>{head}
        <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
        <div style={lbl}>Roles to show</div>
        <div style={{ fontSize: 12, color: E.muted, marginBottom: 6, lineHeight: 1.5 }}>Leave them all unticked to show every public role, including ones you add later.</div>
        {opps.map(o => (
          <label key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={ids.includes(o.id)} onChange={() => toggleOpp(o.id)} /> {o.name}
          </label>
        ))}
        {!opps.length && <div style={{ fontSize: 12, color: E.muted }}>No public volunteer roles yet. Add one in Volunteers.</div>}
        <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
          {w.type === "shiftpicker" ? "Shifts, open spots and the waiting list come from Volunteers and update themselves." : "Each role's description, time, skills and place come from Volunteers."}
        </div></>;
    }
    case "volsignup": {
      const qs = Array.isArray(w.questions) ? w.questions.map(q => (typeof q === "string" ? q : (q && (q.label || q.q)) || "")) : [];
      const setQs = next => onChange({ questions: next });
      const flag = (k, text) => (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={w[k] !== false} onChange={e => onChange({ [k]: e.target.checked })} /> {text}
        </label>
      );
      return <>{head}
        <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
        <div style={lbl}>Ask for</div>
        <div style={{ fontSize: 12, color: E.muted, marginBottom: 4 }}>Name, email and a shift are always asked.</div>
        {flag("askPhone", "Phone")}
        {flag("askAvailability", "When they can usually help")}
        {flag("askInterests", "Which roles interest them")}
        <div style={lbl}>Your own questions (up to 5)</div>
        {qs.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input style={inp} value={q} maxLength={200} placeholder="Do you have a T-shirt size preference?" onChange={e => setQs(qs.map((x, j) => j === i ? e.target.value : x))} />
            <button aria-label="Remove question" onClick={() => setQs(qs.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: E.terra, cursor: "pointer" }}>✕</button>
          </div>
        ))}
        {qs.length < 5 && <button onClick={() => setQs([...qs, ""])} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add a question</button>}
        <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
          A sign-up finds the person if they are already in Steward, or adds them, and books the shift they chose.
        </div></>;
    }
    case "volwaiver":
    case "volimpact":
    case "groupsignup": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      {w.type === "groupsignup" && <><div style={lbl}>Text</div><textarea style={{ ...inp, resize: "vertical" }} rows={3} value={w.text || ""} onChange={e => onChange({ text: e.target.value })} /></>}
      <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
        {w.type === "volwaiver" ? "Which roles ask for a waiver or a background check comes from each role in Volunteers."
          : w.type === "volimpact" ? "Hours served this year and the volunteer roster are counted from your records when the page is opened, never typed in."
          : "Adds a group option to the sign-up form: the group's name, kind, size and the leader's phone."}
      </div></>;
    case "volquote": return <>{head}
      <div style={lbl}>Their words</div>
      <textarea style={{ ...inp, resize: "vertical" }} rows={3} value={w.text || ""} maxLength={500} placeholder="Add a quote from one of your volunteers" onChange={e => onChange({ text: e.target.value })} />
      <div style={lbl}>Their name</div><input style={inp} value={w.name || ""} maxLength={120} onChange={e => onChange({ name: e.target.value })} />
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 10, cursor: "pointer", lineHeight: 1.5 }}>
        <input type="checkbox" checked={w.permission === true} onChange={e => onChange({ permission: e.target.checked })} style={{ marginTop: 3 }} />
        This volunteer said we may share these words with their name.
      </label>
      <div style={{ fontSize: 12, color: E.muted, marginTop: 8, lineHeight: 1.5 }}>The quote shows on the page only with this box ticked.</div></>;
    // PAGES-1: the page system's own blocks. What they show comes from records.
    case "goalbar": case "memberlevels": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} maxLength={120} onChange={e => onChange({ heading: e.target.value })} />
      {w.type === "goalbar" && volData == null && <><div style={lbl}>Members you are aiming for</div>
        <input style={inp} type="number" min={1} data-testid="goalbar-target" value={w.target ?? ""} onChange={e => onChange({ target: e.target.value === "" ? null : Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></>}
      <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
        {w.type === "memberlevels" ? "Every level you sell in Memberships, each with Join. Prices, terms and what is deductible come from the level."
          : volData != null ? "Spots filled on your upcoming shifts, counted from Volunteers when the page is opened."
          : "Members today, counted from Memberships when the page is opened."}
      </div></>;
    case "pageheader": case "pagefooter": return <>{head}
      <div style={{ fontSize: 12.5, color: E.muted, lineHeight: 1.6 }}>
        {w.type === "pageheader" ? "Your logo and name, from Design." : "Your name, footer text, contact email and EIN line, from Design."} Nothing to type here.
      </div></>;
    case "mygiving": return <>{head}
      <div style={{ fontSize: 12.5, color: E.muted, lineHeight: 1.6 }}>
        Signed-in donors see their own giving history, recurring gifts, and receipts here.
        On the public page it shows a sign-in prompt instead. Nothing to configure.
      </div></>;
    default: return head;
  }
}
