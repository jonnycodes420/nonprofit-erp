// PARITY-3 Part 2 · THE RECRUITMENT PAGE AND PENDING APPLICATIONS.
//
// RecruitmentView edits the org's public volunteer page: a title, the words
// (a small rich-text editor: headings, bold and italic, lists, links, images
// and a YouTube or Vimeo video), the questions the application asks, and
// whether it is live. What is kept is decided by shared/richText.js, the same
// function the server runs before it stores anything, so the preview is what
// the public sees.
//
// ApplicationsView is where applications wait. Approve adds the person as a
// volunteer, onto the record already on file when their email is; Decline
// sends nothing.
import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch, API } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";
import { sanitizeRichText, embedFor } from "../../../shared/richText.js";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary = { background: T.green, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer", fontFamily: "inherit" };
const btnQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.green, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const card = { background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: "16px 18px" };
const eyebrow = { fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 };
const lbl = { display: "block", fontSize: 12, fontWeight: 700, color: T.ink3, margin: "10px 0 4px" };
// The editor shows an uploaded image from the API; the stored page keeps the
// path relative (the sanitizer makes it so), and the public page serves it.
const absAssets = html => String(html || "").replace(/src="\/portal-assets\//g, `src="${API}/portal-assets/`);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
}

export function RecruitmentView({ isReadOnly }) {
  const [data, setData] = useState(null);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState([]);
  const [published, setPublished] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState("");
  const [link, setLink] = useState("");
  const ed = useRef(null);
  const fileRef = useRef(null);
  useEffect(() => {
    apiFetch("/volunteer-hub/recruitment").then(d => {
      setData(d); setTitle(d.title); setQuestions(d.questions.map(q => ({ ...q, options: (q.options || []).join("\n") }))); setPublished(d.published);
      if (ed.current) ed.current.innerHTML = absAssets(d.bodyHtml) || "<p></p>";
    }).catch(e => setMsg(errorMessage(e, "The page did not load.")));
  }, []);
  useEffect(() => { if (data && ed.current && !ed.current.innerHTML) ed.current.innerHTML = absAssets(data.bodyHtml) || "<p></p>"; }, [data]);
  const cmd = (c, v) => { if (ed.current) ed.current.focus(); document.execCommand(c, false, v); };
  const addImage = async file => {
    if (!file) return;
    setMsg("");
    try {
      const r = await apiFetch("/volunteer-hub/recruitment/image", { method: "POST", body: JSON.stringify({ file: await readAsDataUrl(file) }) });
      cmd("insertHTML", `<img src="${API}${r.path}" alt="">`);
    } catch (e) { setMsg(errorMessage(e, "That image did not upload.")); }
  };
  const addVideo = () => {
    const src = embedFor(video);
    if (!src) { setMsg("Paste a YouTube or Vimeo link."); return; }
    cmd("insertHTML", `<iframe src="${src}"></iframe><p></p>`); setVideo(""); setMsg("");
  };
  const addLink = () => { if (!/^https?:\/\/|^mailto:/i.test(link)) { setMsg("A link starts with https:// or mailto:."); return; } cmd("createLink", link); setLink(""); };
  const save = async pub => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch("/volunteer-hub/recruitment", { method: "PUT", body: JSON.stringify({
        title, bodyHtml: sanitizeRichText(ed.current ? ed.current.innerHTML : ""), published: pub,
        questions: questions.map(q => ({ ...q, options: String(q.options || "").split("\n") })) }) });
      setData(r); setPublished(r.published); setMsg(r.message);
      if (ed.current) ed.current.innerHTML = absAssets(r.bodyHtml) || "<p></p>";
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  const setQ = (i, k, v) => setQuestions(qs => qs.map((q, j) => j === i ? { ...q, [k]: v } : q));
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>{msg || "Loading…"}</div>;
  const tb = (label, on, aria) => <button type="button" style={btnQuiet} aria-label={aria || label} onMouseDown={e => e.preventDefault()} onClick={on} disabled={isReadOnly}>{label}</button>;
  return (
    <div data-testid="vol-recruitment" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>{data.sentence}</div>
      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: published ? T.green : T.ink3 }}>{published ? "Live" : "Not published"}</span>
        {data.publicUrl && published && <a href={data.publicUrl} target="_blank" rel="noreferrer" style={{ ...btnLink, overflowWrap: "anywhere" }}>{data.publicUrl}</a>}
        {data.publicUrl && published && <button style={btnQuiet} onClick={() => navigator.clipboard.writeText(data.publicUrl).then(() => setMsg("Link copied."))}>Copy link</button>}
      </div>
      <div style={card}>
        <label style={lbl} htmlFor="rc-title">Title</label>
        <input id="rc-title" value={title} onChange={e => setTitle(e.target.value)} style={{ ...inp, width: "100%" }} disabled={isReadOnly} />
        <label style={lbl}>The page</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }} role="toolbar" aria-label="Formatting">
          {tb("Heading", () => cmd("formatBlock", "h2"))}{tb("Subheading", () => cmd("formatBlock", "h3"))}{tb("Paragraph", () => cmd("formatBlock", "p"))}
          {tb("Bold", () => cmd("bold"))}{tb("Italic", () => cmd("italic"))}{tb("List", () => cmd("insertUnorderedList"))}
          {tb("Image", () => fileRef.current && fileRef.current.click(), "Add an image")}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: "none" }} onChange={e => { addImage(e.target.files[0]); e.target.value = ""; }} />
        </div>
        <div ref={ed} data-testid="rc-editor" contentEditable={!isReadOnly} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="The page's words"
          style={{ minHeight: 220, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px", background: T.white, fontSize: 14, lineHeight: 1.6, color: T.ink, overflowWrap: "anywhere" }} />
        <style>{`[data-testid="rc-editor"] img{max-width:100%;border-radius:8px}[data-testid="rc-editor"] iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:8px}`}</style>
        {!isReadOnly && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <input aria-label="Video link" placeholder="A YouTube or Vimeo link" value={video} onChange={e => setVideo(e.target.value)} style={{ ...inp, flex: "1 1 220px" }} />
          <button style={btnQuiet} onClick={addVideo}>Add video</button>
          <input aria-label="Link address" placeholder="Select words, then paste a link" value={link} onChange={e => setLink(e.target.value)} style={{ ...inp, flex: "1 1 220px" }} />
          <button style={btnQuiet} onMouseDown={e => e.preventDefault()} onClick={addLink}>Make a link</button>
        </div>}
        <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>The opportunities open now are added under your words on their own, with their dates.</div>
      </div>
      <div style={card}>
        <div style={eyebrow}>The application's questions</div>
        <div style={{ fontSize: 12.5, color: T.ink3, margin: "4px 0 8px" }}>Name, email and phone are always asked, and when they are free. Add your own below: text, a choice, yes or no, or a file (a signed waiver, say).</div>
        {questions.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>
            <input aria-label={`Question ${i + 1}`} value={q.label} onChange={e => setQ(i, "label", e.target.value)} placeholder="Why would you like to help?" style={{ ...inp, flex: "2 1 240px" }} disabled={isReadOnly} />
            <select aria-label={`Question ${i + 1} kind`} value={q.type} onChange={e => setQ(i, "type", e.target.value)} style={inp} disabled={isReadOnly}>
              {data.types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={!!q.required} onChange={e => setQ(i, "required", e.target.checked)} disabled={isReadOnly} /> Required</label>
            {!isReadOnly && <button style={btnLink} onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}>Remove</button>}
            {q.type === "choice" && <textarea aria-label={`Question ${i + 1} choices, one per line`} rows={3} value={q.options} onChange={e => setQ(i, "options", e.target.value)} placeholder={"One choice per line"} style={{ ...inp, width: "100%" }} disabled={isReadOnly} />}
          </div>))}
        {!isReadOnly && <button style={btnLink} onClick={() => setQuestions(qs => [...qs, { label: "", type: "text", required: false, options: "" }])}>Add a question</button>}
      </div>
      {!isReadOnly && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btnPrimary} disabled={busy} data-testid="rc-publish" onClick={() => save(true)}>{published ? "Save" : "Save and publish"}</button>
        {published ? <button style={btnQuiet} disabled={busy} onClick={() => save(false)}>Take it down</button>
          : <button style={btnQuiet} disabled={busy} onClick={() => save(false)}>Save as a draft</button>}
      </div>}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
    </div>
  );
}

export function ApplicationsView({ isReadOnly, onOpenPerson, onCount }) {
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [choose, setChoose] = useState(null);
  const [busy, setBusy] = useState(null);
  // onCount is held in a ref: the hub passes a new function each render, and a
  // load that depended on it would reload, recount and reload forever.
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const load = useCallback(() => apiFetch(`/volunteer-hub/applications?status=${status}`).then(d => { setData(d); countRef.current && countRef.current(d.pending); })
    .catch(e => setMsg(errorMessage(e, "The applications did not load."))), [status]);
  useEffect(() => { load(); }, [load]);
  const approve = async (a, personId) => {
    setBusy(a.id); setMsg("");
    try { const r = await apiFetch(`/volunteer-hub/applications/${a.id}/approve`, { method: "POST", body: JSON.stringify(personId ? { personId } : {}) }); setMsg(r.message); setChoose(null); load(); }
    catch (e) {
      if (e && e.error === "choose_person") setChoose({ app: a, choices: e.choices, message: e.message });
      else setMsg(errorMessage(e, "That approval did not go through."));
    }
    setBusy(null);
  };
  const decline = async a => {
    setBusy(a.id); setMsg("");
    try { const r = await apiFetch(`/volunteer-hub/applications/${a.id}/decline`, { method: "POST" }); setMsg(r.message); load(); }
    catch (e) { setMsg(errorMessage(e, "That did not work.")); }
    setBusy(null);
  };
  const openFile = (a, qid, name) => {
    const token = localStorage.getItem("npe_token");
    fetch(`${API}/volunteer-hub/applications/${a.id}/file/${qid}`, { headers: { Authorization: "Bearer " + token } })
      .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
      .then(b => { const u = URL.createObjectURL(b); const el = document.createElement("a"); el.href = u; el.download = name || "file"; el.click(); URL.revokeObjectURL(u); })
      .catch(() => setMsg("The file did not download."));
  };
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>{msg || "Loading…"}</div>;
  return (
    <div data-testid="vol-applications" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, color: T.ink3, maxWidth: 680, lineHeight: 1.6 }}>{data.sentence}</div>
      <div role="tablist" aria-label="Which applications" style={{ display: "flex", gap: 6 }}>
        {[["pending", `Pending (${data.pending})`], ["approved", "Approved"], ["declined", "Declined"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)} style={{ ...btnQuiet, background: status === k ? T.ink : T.white, color: status === k ? T.white : T.ink }}>{l}</button>))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
      {!data.applications.length && <div style={{ ...card, fontSize: 13, color: T.ink3 }}>{status === "pending" ? "Nobody is waiting. Share your volunteer page from Recruitment page." : "None yet."}</div>}
      {data.applications.map(a => (
        <div key={a.id} data-app={a.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{a.name}</div>
              <div style={{ fontSize: 12.5, color: T.ink3, overflowWrap: "anywhere" }}>{a.email}{a.phone ? ` · ${a.phone}` : ""} · applied {displayDate(String(a.submittedAt).slice(0, 10))}</div>
            </div>
            {a.status === "pending" && !isReadOnly && <div style={{ display: "flex", gap: 6 }}>
              <button style={btnPrimary} disabled={busy === a.id} data-testid="app-approve" onClick={() => approve(a)}>Approve</button>
              <button style={btnQuiet} disabled={busy === a.id} onClick={() => decline(a)}>Decline</button>
            </div>}
            {a.status !== "pending" && <div style={{ fontSize: 12.5, color: T.ink3 }}>{a.status === "approved" ? "Approved" : "Declined"}{a.decidedBy ? ` by ${a.decidedBy}` : ""}{a.personId && <> · <button style={btnLink} onClick={() => onOpenPerson && onOpenPerson({ id: a.personId, name: a.name })}>Open their record</button></>}</div>}
          </div>
          {a.status === "pending" && a.onFile.length > 0 && (
            <div style={{ fontSize: 12.5, color: T.ink, background: T.green100, borderRadius: 8, padding: "6px 10px" }}>
              Already on file: {a.onFile.map(m => `${m.name}${m.gives ? " (gives)" : ""}`).join(", ")}. Approving adds volunteering to {a.onFile.length === 1 ? "that record" : "the one you choose"}; nobody is added twice.
            </div>)}
          {a.answers.map(x => (
            <div key={x.questionId} style={{ fontSize: 13, color: T.ink }}><strong>{x.question}</strong>{" "}
              {x.type === "file" && x.answer ? <button style={btnLink} onClick={() => openFile(a, x.questionId, x.answer.fileName)}>{x.answer.fileName}</button> : (x.answerText || <span style={{ color: T.ink3 }}>No answer</span>)}
            </div>))}
          {a.availability.length > 0 && <div style={{ fontSize: 13, color: T.ink }}><strong>Free:</strong> {a.availability.join(", ")}</div>}
        </div>))}
      {choose && (
        <Modal onClose={() => setChoose(null)} width={460} ariaLabel="Choose which person">
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, marginBottom: 6 }}>Which person is this?</div>
          <div style={{ fontSize: 13, color: T.ink3, marginBottom: 10 }}>{choose.message}</div>
          {choose.choices.map(c => <button key={c.id} style={{ ...btnQuiet, display: "block", width: "100%", textAlign: "left", marginBottom: 6 }} onClick={() => approve(choose.app, c.id)}>{c.name}</button>)}
        </Modal>)}
    </div>
  );
}
