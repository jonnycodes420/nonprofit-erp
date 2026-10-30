// FIX-57 · MY PROFILE: A SIGNATURE FOR EACH PERSON. The name she signs with,
// her title, phone, an optional photo from the media library, and the block
// itself, with a preview of exactly what her drafts will close with. What is
// drafted for her (a campaign she sends, a thank-you task assigned to her, a
// draft she opens) signs with this; without it, Brand's; without that, the
// organization's name (shared/brandKit.js senderSignature).
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Spin } from "./shared";
import { errorMessage } from "../lib/domainError";
import MediaPicker from "./MediaPicker";
import { resolveAssetUrl } from "../lib/assetUrl";

const LABEL = { fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 6, display: "block" };
const field = { width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 10px", fontSize: 13.5, fontFamily: "inherit", background: T.white, color: T.ink };
const btn = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const FROM = { person: "Your drafts are signed with this.", brand: "Until you fill this in, your drafts are signed with your organization's signature from Brand.", org: "Until you fill this in, your drafts are signed with your organization's name." };

const linesOf = f => [f.signName, f.title, f.phone].map(s => String(s || "").trim()).filter(Boolean).join("\n");

export default function MyProfile({ isReadOnly }) {
  const [p, setP] = useState(null);
  const [f, setF] = useState({ signName: "", title: "", phone: "", block: "", photoId: undefined, photo: null });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = d => { setP(d); setF({ signName: d.signName, title: d.title, phone: d.phone, block: d.block, photoId: undefined, photo: d.photo }); };
  useEffect(() => { apiFetch("/me/profile").then(load).catch(e => setMsg(errorMessage(e, "Your profile could not be opened."))); }, []);
  const set = patch => { setF(x => ({ ...x, ...patch })); setMsg(""); };
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const body = { signName: f.signName, title: f.title, phone: f.phone, block: f.block, ...(f.photoId !== undefined ? { photoId: f.photoId } : {}) };
      load(await apiFetch("/me/profile", { method: "PUT", body: JSON.stringify(body) }));
      setMsg("Saved.");
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  if (!p) return <div style={{ padding: 24 }}>{msg || <Spin />}</div>;
  // What a draft will close with if she saves now: the block, else the lines.
  const preview = String(f.block || "").trim() || linesOf(f);
  return (
    <div data-testid="my-profile" style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: T.ink, marginBottom: 4 }}>My profile</div>
      <div style={{ fontSize: 13, color: T.ink2, marginBottom: 18, lineHeight: 1.5 }}>
        How you sign. Emails and letters drafted for you close with this: a campaign you send, a thank-you task assigned to you, a draft you open.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <label><span style={LABEL}>Name as signed</span>
          <input data-testid="profile-sign-name" style={field} value={f.signName} disabled={isReadOnly} placeholder={p.name || ""} onChange={e => set({ signName: e.target.value })} /></label>
        <label><span style={LABEL}>Title</span>
          <input data-testid="profile-title" style={field} value={f.title} disabled={isReadOnly} placeholder="Executive Director" onChange={e => set({ title: e.target.value })} /></label>
        <label><span style={LABEL}>Phone</span>
          <input data-testid="profile-phone" style={field} value={f.phone} disabled={isReadOnly} inputMode="tel" onChange={e => set({ phone: e.target.value })} /></label>
      </div>
      <div style={{ marginTop: 14 }}>
        <span style={LABEL}>Photo (optional, for emails)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {f.photo ? <img src={resolveAssetUrl(f.photo)} alt="" width={48} height={48} style={{ borderRadius: 24, objectFit: "cover", border: "1px solid " + T.bg3 }} />
            : <span style={{ fontSize: 13, color: T.ink3 }}>No photo.</span>}
          {!isReadOnly && <button type="button" style={quiet} onClick={() => setPicking(true)}>{f.photo ? "Change photo" : "Choose a photo"}</button>}
          {!isReadOnly && f.photo && <button type="button" style={quiet} onClick={() => set({ photoId: null, photo: null })}>Remove</button>}
        </div>
        {picking && <MediaPicker kind="photo" onClose={() => setPicking(false)} onPick={m => { set({ photoId: m.id, photo: m.url }); setPicking(false); }} />}
      </div>
      <label style={{ display: "block", marginTop: 14 }}><span style={LABEL}>Signature block</span>
        <textarea data-testid="profile-block" rows={4} style={{ ...field, resize: "vertical" }} value={f.block} disabled={isReadOnly}
          placeholder={linesOf(f) || "Leave blank to sign with your name, title and phone."} onChange={e => set({ block: e.target.value })} /></label>
      <div style={{ marginTop: 14 }}>
        <span style={LABEL}>Preview</span>
        <div data-testid="profile-preview" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "14px 16px", fontSize: 13.5, color: T.ink, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {preview ? `With thanks,\n${preview}` : `With thanks,\n${p.signature}`}
        </div>
        <div style={{ fontSize: 12, color: T.ink2, marginTop: 6 }}>{preview ? FROM.person : FROM[p.from] || FROM.org}</div>
      </div>
      {!isReadOnly && <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <button type="button" data-testid="profile-save" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        {msg && <span role="status" style={{ fontSize: 13, color: T.ink2 }}>{msg}</span>}
      </div>}
    </div>
  );
}
