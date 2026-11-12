// SALES-2 item 5 · a filled email template, sent by Jonathan from his own mail. Steward never
// sends it: Copy puts it on the clipboard, Open in Mail opens a mailto: with the subject and
// body. Either one logs "Email drafted" on the person (and their organization and deal).
import { useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { CREAM, card, h2, says, btn, quiet, box, brassTag, Failure } from "./salesBits";

const mailtoOf = (to, subject, body) => `mailto:${encodeURIComponent(to || "").replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export default function EmailDraft({ contactId = null, orgId = null, dealId = null, onClose, onLogged }) {
  const [tpl, setTpl] = useState("");
  const [d, setD] = useState(null);
  const [fail, setFail] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState(null);
  useEffect(() => {
    const qs = new URLSearchParams({ ...(tpl ? { template: tpl } : {}), ...(contactId ? { contact: contactId } : {}), ...(orgId ? { org: orgId } : {}), ...(dealId ? { deal: dealId } : {}) });
    apiFetch(`/ops/sales/email/fill?${qs}`).then(r => { setD(r); setSubject(r.subject); setBody(r.body); setFail(null); }).catch(setFail);
  }, [tpl, contactId, orgId, dealId]);
  const logged = async how => {
    try {
      await apiFetch("/ops/sales/email/drafted", { method: "POST", body: JSON.stringify({ subject, template: d.template.name, contactId: d.contactId || contactId, orgId: d.orgId || orgId, dealId }) });
      setNote(how === "copy" ? "Copied. Logged as Email drafted; paste it into your mail and send it yourself." : "Opened in your mail. Logged as Email drafted; send it from there.");
      if (onLogged) onLogged();
    } catch (e) { setNote(e.message); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`); } catch { /* the log still says what was drafted */ }
    logged("copy");
  };
  return <section style={{ ...card, border: `1px solid ${CREAM}` }} data-sales-email-draft="1">
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <h2 style={{ ...h2, flex: 1 }}>Email</h2>
      <button type="button" style={quiet} onClick={onClose}>Close</button>
    </div>
    {fail ? <Failure e={fail} fallback={fail.message || "The template could not be filled."} /> : !d ? <p style={says}>Loading…</p> : <>
      <p style={says}>{d.says}</p>
      {d.dnc ? <p style={{ ...says, opacity: 1 }}><span style={brassTag}>Do not contact</span> This person or their organization is marked Do not contact. Nothing is offered to send.</p> : null}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <select value={d.template.id} onChange={e => setTpl(e.target.value)} style={box} aria-label="Template" data-email-template="1">
          {d.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <span style={{ fontSize: 12.5 }}>To: <b>{d.to || "no email on file"}</b></span>
      </div>
      {d.missing.length ? <p style={{ ...says, opacity: 1 }}><span style={brassTag}>Not filled</span> This record has no {d.missing.join(", ").replace(/_/g, " ")}; those words were left out. Read it before you send.</p> : null}
      <input value={subject} onChange={e => setSubject(e.target.value)} style={{ ...box, width: "100%", marginBottom: 6 }} aria-label="Subject" data-email-subject="1" />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={9} style={{ ...box, width: "100%" }} aria-label="Body" data-email-body="1" />
      {!d.dnc ? <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn} onClick={copy} data-email-copy="1">Copy</button>
        <a href={mailtoOf(d.to, subject, body)} onClick={() => logged("mail")} style={{ ...quiet, textDecoration: "none", display: "inline-flex", alignItems: "center" }} data-email-mailto="1">Open in Mail</a>
      </div> : null}
      {note ? <p style={{ ...says, opacity: 1, marginTop: 8 }} data-email-note="1">{note}</p> : null}
    </>}
  </section>;
}
