// PrintedLetters.jsx · LETTERS-1. Communications → Printed letters.
//
// "I want everyone who donated to this event to get a tax letter. And then you
// can download a PDF... or download it as a Word document." (a pilot customer)
//
// Three parts, top to bottom:
//   1. Letters for everyone who gave: an event or a campaign, a date range and
//      a template; the preview says how many, shows each letter and who is left
//      out and why; Download PDF or Download Word sends nothing and marks
//      nothing; "Mark these as sent" is its own press.
//   2. Letter templates: her own letter, uploaded from Word (UploadWordLetter).
//   3. Your signature: the picture that prints above your name.
import { useState, useEffect, useCallback } from "react";
import { apiFetch, apiWriteFile } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";
import UploadWordLetter from "./UploadWordLetter";
import SignatureField from "./SignatureField";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box

const card = { background: T.white, border: `1px solid ${T.bg2}`, borderRadius: 12, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 };
const h2 = { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: T.ink, margin: 0 };
const sub = { fontSize: 13, color: T.ink3, lineHeight: 1.5, margin: 0 };
const input = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, fontFamily: "inherit" };
const primary = { background: T.green, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const quiet = { background: "transparent", color: T.ink, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const money = v => "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PICK_KEY = "steward.letters.pick";

// An event's or a campaign's page asks for its letters by leaving the choice here.
export function lettersFor(pick) {
  try { sessionStorage.setItem(PICK_KEY, JSON.stringify(pick)); } catch { /* the picker simply starts empty */ }
}
function takePick() {
  try { const v = JSON.parse(sessionStorage.getItem(PICK_KEY) || "null"); sessionStorage.removeItem(PICK_KEY); return v; } catch { return null; }
}

async function downloadPost(path, body, fallbackName) {
  const r = await apiWriteFile(path, { body: JSON.stringify(body) }).catch(e => { throw new Error(e.message || "The file could not be made."); });   // FRESH-5: marked printed is a write; it announces
  const name = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return Number(r.headers.get("X-Letters-Printed") || 0);
}

function GivingLetters({ isReadOnly, templates }) {
  const first = takePick();
  const [sources, setSources] = useState(null);
  // COMMS-3: Audience's "Send them a printed letter" leaves { group: "mail_only", from }.
  const [kind, setKind] = useState(first && first.group ? "group" : first && first.campaignId ? "campaign" : "event");
  const [id, setId] = useState(first ? (first.group || first.eventId || first.campaignId || "") : "");
  const [from, setFrom] = useState(first && first.from ? first.from : "");
  const [to, setTo] = useState("");
  const [tplId, setTplId] = useState("");
  const [preview, setPreview] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [thankYou, setThankYou] = useState(false);
  const [marked, setMarked] = useState(null);
  useEffect(() => { apiFetch("/letters/giving/sources").then(setSources).catch(() => setSources({ events: [], campaigns: [] })); }, []);
  const choice = () => ({ [kind === "group" ? "group" : kind === "event" ? "eventId" : "campaignId"]: id, from: from || null, to: to || null, templateId: tplId || null });
  const doPreview = useCallback(async () => {
    if (!id) return;
    setBusy("preview"); setMsg(""); setMarked(null);
    try { setPreview(await apiFetch("/letters/giving/preview", { method: "POST", body: JSON.stringify(choice()) })); }
    catch (e) { setPreview(null); setMsg(errorMessage(e, "The letters could not be previewed.")); }
    setBusy("");
  }, [id, kind, from, to, tplId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (id) doPreview(); else setPreview(null); }, [id, kind, from, to, tplId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dl = async (what) => {
    setBusy(what); setMsg("");
    try { const n = await downloadPost(`/letters/giving/${what}`, choice(), `letters.${what}`); setMsg(`Downloaded ${n} ${n === 1 ? "letter" : "letters"}. Nothing was sent and nothing is marked.`); }
    catch (e) { setMsg(errorMessage(e, "The file could not be made.")); }
    setBusy("");
  };
  const mark = async () => {
    setBusy("mark"); setMsg("");
    try { const r = await apiFetch("/letters/giving/mark", { method: "POST", body: JSON.stringify({ ...choice(), thankYou }) }); setMarked(r); }
    catch (e) { setMsg(errorMessage(e, "The letters could not be marked.")); }
    setBusy("");
  };
  const list = sources ? (kind === "event" ? sources.events : kind === "campaign" ? sources.campaigns : []) : [];
  return (
    <section style={card} data-testid="letters-giving">
      <h2 style={h2}>Letters for everyone who gave</h2>
      <p style={sub}>Pick an event, a campaign or your mail-only donors (no email, a postal address), and the dates. Steward writes one letter for each person who gave, with the deductible amount their receipt shows.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={kind} onChange={e => { setKind(e.target.value); setId(e.target.value === "group" ? "mail_only" : ""); }} style={input} aria-label="Event or campaign" data-testid="letters-kind">
          <option value="event">An event</option>
          <option value="campaign">A campaign</option>
          <option value="group">Your mail-only donors</option>
        </select>
        {kind !== "group" && <select value={id} onChange={e => setId(e.target.value)} style={{ ...input, minWidth: 220 }} aria-label={kind === "event" ? "Event" : "Campaign"} data-testid="letters-source">
          <option value="">{!sources ? "Loading…" : list.length ? `Choose ${kind === "event" ? "an event" : "a campaign"}` : `No ${kind === "event" ? "event" : "campaign"} has gifts yet`}</option>
          {list.map(s => <option key={s.id} value={s.id}>{s.name}{s.dateWords ? ` · ${s.dateWords}` : ""}</option>)}
        </select>}
        <label style={{ fontSize: 13, color: T.ink3 }}>From <DateInput value={from} onChange={e => setFrom(e.target.value)} style={input} data-testid="letters-from" /></label>
        <label style={{ fontSize: 13, color: T.ink3 }}>To <DateInput value={to} onChange={e => setTo(e.target.value)} style={input} data-testid="letters-to" /></label>
        <select value={tplId} onChange={e => setTplId(e.target.value)} style={input} aria-label="Letter template" data-testid="letters-template">
          {templates.map(t => <option key={t.id || "builtin"} value={t.id || ""}>{t.name}{t.from_word ? " (from Word)" : ""}</option>)}
        </select>
      </div>
      {busy === "preview" && <div style={sub}>Reading who gave…</div>}
      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="letters-preview">
          <div style={{ fontSize: 15, color: T.ink, fontWeight: 600 }}>{preview.sentence}</div>
          {preview.letters.length > 0 && <div style={{ fontSize: 13, color: T.ink2 }} data-testid="letters-deductible">{preview.deductibleSentence}</div>}
          {preview.signer && <div style={{ fontSize: 12, color: T.ink3 }}>Signed by {preview.signer.name || "nobody yet"}{preview.signer.hasImage ? ", with a signature" : ", with no signature picture (add one below)"}.</div>}
          {preview.letters.length > 0 && (
            <div style={{ border: `1px solid ${T.bg2}`, borderRadius: 8, maxHeight: 320, overflowY: "auto" }}>
              {preview.letters.map(l => (
                <div key={l.donorId} style={{ borderBottom: `1px solid ${T.bg2}`, padding: "8px 12px" }}>
                  <button type="button" onClick={() => setOpen(open === l.donorId ? null : l.donorId)} aria-expanded={open === l.donorId}
                    style={{ background: "none", border: "none", padding: 0, width: "100%", display: "flex", justifyContent: "space-between", gap: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: T.ink }}>
                    <span style={{ fontWeight: 600 }}>{l.name}</span>
                    <span>{money(l.total)} given · {money(l.deductible)} deductible</span>
                  </button>
                  {open === l.donorId && <pre style={{ whiteSpace: "pre-wrap", fontFamily: "Georgia, serif", fontSize: 13, color: T.ink, background: T.bg, borderRadius: 6, padding: 12, margin: "8px 0 0" }}>{l.text}</pre>}
                </div>))}
            </div>)}
          {preview.skipped && preview.skipped.length > 0 && (
            <div style={{ background: T.bg, border: `1px solid ${T.gold}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.ink }} data-testid="letters-left-out">
              <strong>Left out ({preview.skipped.length}):</strong> {preview.skipped.map(s => `${s.name} (${s.why})`).join("; ")}.
            </div>)}
          {preview.letters.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" style={primary} disabled={!!busy} onClick={() => dl("pdf")} data-testid="letters-pdf">{busy === "pdf" ? "Making the PDF…" : "Download PDF"}</button>
              <button type="button" style={quiet} disabled={!!busy} onClick={() => dl("docx")} data-testid="letters-docx">{busy === "docx" ? "Making the Word file…" : "Download Word"}</button>
              <span style={{ fontSize: 12, color: T.ink3 }}>Downloading sends nothing and marks nothing.</span>
            </div>)}
          {preview.letters.length > 0 && !isReadOnly && (
            <div style={{ borderTop: `1px solid ${T.bg2}`, paddingTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 13, color: T.ink, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={thankYou} onChange={e => setThankYou(e.target.checked)} data-testid="letters-thankyou" /> This letter was their thank-you
              </label>
              <button type="button" style={quiet} disabled={!!busy} onClick={mark} data-testid="letters-mark">{busy === "mark" ? "Marking…" : "Mark these as sent"}</button>
              <span style={{ fontSize: 12, color: T.ink3 }}>Records that a letter went to each person here, on each of their gifts. A tax letter is not a thank-you unless you tick the box.</span>
            </div>)}
          {marked && <div role="status" style={{ fontSize: 13, color: T.greenDk || T.green, fontWeight: 600 }} data-testid="letters-marked">{marked.sentence}</div>}
        </div>)}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
    </section>
  );
}

function Templates({ isReadOnly, templates, reload }) {
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const del = async t => {
    if (!t.id) return;
    try { await apiFetch(`/acknowledgments/templates/${t.id}`, { method: "DELETE" }); setMsg(`Deleted ${t.name}.`); reload(); }
    catch (e) { setMsg(errorMessage(e, "That template could not be deleted.")); }
  };
  return (
    <section style={card} data-testid="letters-templates">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={h2}>Letter templates</h2>
        {!isReadOnly && !uploading && <button type="button" style={primary} onClick={() => setUploading(true)} data-testid="letters-upload-open">Upload a Word letter (.docx)</button>}
      </div>
      <p style={sub}>Your own letter, from Word: Steward keeps the letterhead, logo, sizes, colors and spacing, and fills in each person's name and gift.</p>
      {uploading && <UploadWordLetter onClose={() => setUploading(false)} onSaved={() => { setUploading(false); reload(); setMsg("Saved. Pick it above to print with it."); }} />}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {templates.map(t => (
          <div key={t.id || "builtin"} style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderTop: `1px solid ${T.bg2}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{t.name}{t.is_default ? <span style={{ fontSize: 11, color: T.ink3, fontWeight: 700 }}> · DEFAULT</span> : null}</div>
              <div style={{ fontSize: 12, color: T.ink3 }}>{t.from_word ? `From Word${t.source_name ? ` (${t.source_name})` : ""}` : t.builtIn ? "Steward's letter" : "Words only"}</div>
              {Array.isArray(t.not_carried) && t.not_carried.length > 0 && <div style={{ fontSize: 12, color: T.ink2, marginTop: 4 }}>Did not carry over from Word: {t.not_carried.join(" ")}</div>}
            </div>
            {!isReadOnly && t.id && <button type="button" style={{ ...quiet, padding: "4px 10px", fontSize: 12 }} onClick={() => del(t)} aria-label={`Delete ${t.name}`}>Delete</button>}
          </div>))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
    </section>
  );
}

export default function PrintedLetters({ isReadOnly }) {
  const [tpls, setTpls] = useState([]);
  const load = useCallback(() => { apiFetch("/acknowledgments/templates").then(r => setTpls(r.templates || [])).catch(() => setTpls([])); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0 40px" }} data-testid="printed-letters">
      <GivingLetters isReadOnly={isReadOnly} templates={tpls} />
      <Templates isReadOnly={isReadOnly} templates={tpls} reload={load} />
      <section style={card}>
        <h2 style={h2}>Your signature</h2>
        <SignatureField scope="mine" isReadOnly={isReadOnly} />
      </section>
    </div>
  );
}
