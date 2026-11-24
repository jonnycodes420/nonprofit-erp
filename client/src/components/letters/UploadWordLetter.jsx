// UploadWordLetter.jsx · LETTERS-1 item 1. "Is there a way to upload it?"
//
// She chooses her .docx. Steward reads it (POST /acknowledgments/templates/docx)
// and shows, side by side, her original (drawn in the browser by docx-preview)
// and the letter as Steward will print it (the server's own PDF, for a made-up
// donor). Every "[First Name]", "<<FirstName>>" or «FirstName» it found is a
// row to confirm, never a guess; what did not carry over is said plainly.
// Nothing is saved until she presses Save.
import { useState, useEffect, useRef } from "react";
import { API, apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";

const input = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, fontFamily: "inherit" };
const primary = { background: T.green, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const quiet = { background: "transparent", color: T.ink, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const pane = { flex: "1 1 340px", minWidth: 0, border: `1px solid ${T.bg2}`, borderRadius: 8, background: T.bg, height: 560, overflow: "auto" };

const toBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = () => reject(new Error("That file could not be read."));
  r.readAsDataURL(file);
});

export default function UploadWordLetter({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [read, setRead] = useState(null);
  const [fields, setFields] = useState({});
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const original = useRef(null);

  const chosen = () => Object.fromEntries(Object.entries(fields).filter(([, k]) => k));
  const choose = async f => {
    if (!f) return;
    setErr(""); setRead(null); setFile(f); setBusy("read");
    if (!/\.docx$/i.test(f.name)) { setErr("Choose a Word file that ends in .docx. In Word, choose File, Save As, Word Document (.docx)."); setBusy(""); return; }
    try {
      const r = await apiFetch("/acknowledgments/templates/docx", { method: "POST", body: JSON.stringify({ file: await toBase64(f) }) });
      setRead(r);
      setName(f.name.replace(/\.docx$/i, ""));
      // A field Steward recognises starts on its suggestion; she can change or clear it.
      setFields(Object.fromEntries((r.candidates || []).filter(c => !c.token).map(c => [c.raw, c.suggest || ""])));
    } catch (e) { setErr(errorMessage(e, "That Word file could not be read.")); }
    setBusy("");
  };

  // Her original, drawn in the browser.
  useEffect(() => {
    if (!file || !read || !original.current) return;
    let gone = false;
    import("docx-preview").then(m => { if (!gone && original.current) { original.current.innerHTML = ""; return m.renderAsync(file, original.current, null, { inWrapper: false, ignoreLastRenderedPageBreak: true }); } })
      // The Word page is 8½ inches wide; it is shown whole, scaled to the pane.
      .then(() => { const el = original.current, pg = el && el.querySelector("section"); if (pg && pg.scrollWidth > el.clientWidth) el.style.zoom = String(Math.max(0.3, (el.clientWidth - 8) / pg.scrollWidth)); })
      .catch(() => { if (original.current) original.current.textContent = "Your original could not be shown here, but Steward read it."; });
    return () => { gone = true; };
  }, [file, read]);

  // The letter as Steward prints it.
  const refresh = async () => {
    if (!read) return;
    setBusy("pdf");
    try {
      const r = await fetch(API + "/acknowledgments/templates/docx/preview", { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("npe_token"), "Content-Type": "application/json" },
        body: JSON.stringify({ layout: read.layout, fields: chosen() }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || "The preview could not be made.");
      const url = URL.createObjectURL(await r.blob());
      setPdfUrl(old => { if (old) URL.revokeObjectURL(old); return url; });
    } catch (e) { setErr(errorMessage(e, "The preview could not be made.")); }
    setBusy("");
  };
  useEffect(() => { if (read) refresh(); }, [read, JSON.stringify(fields)]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const save = async () => {
    setBusy("save"); setErr("");
    try {
      await apiFetch("/acknowledgments/templates", { method: "POST", body: JSON.stringify({ name, isDefault, layout: read.layout, fields: chosen(), sourceName: file.name, notCarried: read.notCarried }) });
      onSaved && onSaved();
    } catch (e) { setErr(errorMessage(e, "The letter could not be saved.")); }
    setBusy("");
  };

  // {{first}} and {{first_name}} are one field; a Word letter is offered the Word name once.
  const keys = read ? (read.mergeFields || []).filter(k => k.key !== "first") : [];
  const tokens = read ? read.candidates.filter(c => c.token) : [];
  const unknown = tokens.filter(c => !c.known);
  const offered = read ? read.candidates.filter(c => !c.token) : [];
  return (
    <div style={{ border: `1px solid ${T.bg3}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 12, background: T.ground || T.white }} data-testid="letters-upload">
      <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>Your Word letter</span>
        <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => choose(e.target.files && e.target.files[0])} data-testid="letters-upload-file" />
      </label>
      {busy === "read" && <div style={{ fontSize: 13, color: T.ink3 }}>Reading your letter…</div>}
      {read && (<>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, marginBottom: 4 }}>YOUR ORIGINAL</div>
            <div ref={original} style={{ ...pane, background: T.white }} data-testid="letters-original" />
          </div>
          <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, marginBottom: 4 }}>AS STEWARD PRINTS IT, FOR A MADE-UP DONOR</div>
            {pdfUrl ? <iframe title="The letter as Steward prints it" src={pdfUrl} style={{ ...pane, width: "100%", border: `1px solid ${T.bg2}` }} data-testid="letters-steward-pdf" />
              : <div style={{ ...pane, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: T.ink3 }}>Making the preview…</div>}
          </div>
        </div>
        {offered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="letters-fields">
            <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>Steward found {offered.length} {offered.length === 1 ? "place" : "places"} for a name or a gift. Confirm what goes in each.</div>
            {offered.map(c => (
              <label key={c.raw} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: T.ink, flexWrap: "wrap" }}>
                <code style={{ background: T.bg, borderRadius: 4, padding: "2px 6px", minWidth: 140 }}>{c.raw}</code>
                <span aria-hidden="true">→</span>
                <select value={fields[c.raw] || ""} onChange={e => setFields(f => ({ ...f, [c.raw]: e.target.value }))} style={input} aria-label={`What goes in ${c.raw}`}>
                  <option value="">Leave it as I wrote it</option>
                  {keys.map(k => <option key={k.key} value={k.key}>{k.label} {`{{${k.key}}}`}</option>)}
                </select>
                {!c.suggest && <span style={{ fontSize: 12, color: T.ink3 }}>Steward could not tell what this is.</span>}
              </label>))}
          </div>)}
        {tokens.length > 0 && <div style={{ fontSize: 13, color: T.ink2 }}>Fields already in your letter: {tokens.map(c => c.raw).join(", ")}.</div>}
        {unknown.length > 0 && <div style={{ background: T.bg, border: `1px solid ${T.gold}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.ink }}>Steward does not know {unknown.map(c => c.raw).join(", ")}. Change {unknown.length === 1 ? "it" : "them"} in Word to one of the fields above and upload again; the letter cannot be saved with {unknown.length === 1 ? "it" : "them"}.</div>}
        {read.notCarried && read.notCarried.length > 0 && (
          <div style={{ background: T.bg, border: `1px solid ${T.gold}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.ink }} data-testid="letters-not-carried">
            <strong>What did not carry over:</strong>
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{read.notCarried.map(n => <li key={n}>{n}</li>)}</ul>
          </div>)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name this letter" aria-label="Letter name" style={{ ...input, minWidth: 240 }} data-testid="letters-upload-name" />
          <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Use it unless I choose another</label>
          <button type="button" style={primary} disabled={!!busy || !name.trim()} onClick={save} data-testid="letters-upload-save">{busy === "save" ? "Saving…" : "Save this letter"}</button>
          <button type="button" style={quiet} onClick={onClose}>Cancel</button>
        </div>
      </>)}
      {!read && <div><button type="button" style={quiet} onClick={onClose}>Cancel</button></div>}
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
    </div>
  );
}
