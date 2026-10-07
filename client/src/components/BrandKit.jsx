// COMMS-2 — the brand kit (Settings) and the template library
// (Communications → Templates). Every template, printed letter and receipt
// reads the kit: two colours from the safe palette, the signature block, the
// address and the tax language. The logo is the existing logo upload.
import { useState, useEffect, useRef } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, Spin } from "./shared";
import { errorMessage } from "../lib/domainError";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "16px 18px" };
const field = { width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 10px", fontSize: 13.5, fontFamily: "inherit", background: T.white, color: T.ink };
const btn = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

function Swatches({ palette, value, onPick, label, disabled }) {
  return (
    <div>
      <div style={{ ...LABEL, marginBottom: 6 }}>{label}</div>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {palette.map(p => (
          <button key={p.hex} type="button" role="radio" aria-checked={value === p.hex} aria-label={p.name} title={p.name} disabled={disabled}
            onClick={() => onPick(p.hex)}
            style={{ width: 34, height: 34, borderRadius: 8, background: p.hex, cursor: disabled ? "default" : "pointer",
              border: value === p.hex ? "3px solid " + T.ink : "1px solid " + T.bg3, outline: value === p.hex ? "2px solid " + T.white : "none", outlineOffset: -5 }} />
        ))}
      </div>
    </div>
  );
}

export function BrandKitManager({ isAdmin, isReadOnly }) {
  const [k, setK] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiFetch("/brand-kit").then(setK).catch(() => setK(false)); }, []);
  if (k === null) return <div style={{ padding: 30 }}><Spin /></div>;
  if (!k) return <div style={card}>The brand kit could not be loaded.</div>;
  const can = isAdmin && !isReadOnly;
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch("/brand-kit", { method: "PUT", body: JSON.stringify({ primary: k.primary, secondary: k.secondary,
        signatureName: k.signatureName, signatureTitle: k.signatureTitle, signatureExtra: k.signatureExtra, address: k.address,
        taxLanguage: k.taxLanguage, statementYourYear: k.statementYourYear }) });
      setK(r); setMsg("Saved. Every template, printed letter and receipt uses it from now on.");
    } catch (e) { setMsg(errorMessage(e, "The brand kit could not be saved.")); }
    setBusy(false);
  };
  const set = (f, v) => setK(x => ({ ...x, [f]: v }));
  return (
    <div data-testid="brand-kit" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
        What your letters, emails and receipts look and sound like. The logo is the one you upload under Organization.
      </p>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
        <Swatches label="Main colour" palette={k.palette} value={k.primary} onPick={v => set("primary", v)} disabled={!can} />
        <Swatches label="Second colour" palette={k.palette} value={k.secondary} onPick={v => set("secondary", v)} disabled={!can} />
        <div style={{ fontSize: 12, color: T.ink3 }}>Only colours that stay readable on paper and on screen are offered.</div>
        {/* A small letterhead, the way a printed letter will open. */}
        <div aria-hidden="true" style={{ border: "1px solid " + T.bg3, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ height: 8, background: k.primary }} />
          <div style={{ padding: "10px 14px" }}>
            {k.logo && <img src={k.logo} alt="" style={{ height: 30, maxWidth: 140, objectFit: "contain", display: "block", marginBottom: 6 }} />}
            <div style={{ fontWeight: 700, fontSize: 13, color: T.ink }}>{k.orgName}</div>
            <div style={{ fontSize: 11.5, color: T.ink3, whiteSpace: "pre-line" }}>{k.address || "Your address appears here"}</div>
            <div style={{ height: 2, background: k.secondary, marginTop: 8 }} />
          </div>
        </div>
      </div>
      <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <div style={{ gridColumn: "1 / -1", ...LABEL }}>Signature block</div>
        <input aria-label="Signer name" placeholder="Name, for example Dana Reyes" value={k.signatureName} disabled={!can} onChange={e => set("signatureName", e.target.value)} style={field} />
        <input aria-label="Signer title" placeholder="Title, for example Executive Director" value={k.signatureTitle} disabled={!can} onChange={e => set("signatureTitle", e.target.value)} style={field} />
        <input aria-label="Another signature line" placeholder="One more line (optional): a phone number or a P.S." value={k.signatureExtra} disabled={!can} onChange={e => set("signatureExtra", e.target.value)} style={{ ...field, gridColumn: "1 / -1" }} />
        <div style={{ gridColumn: "1 / -1", fontSize: 12, color: T.ink3 }}>The same signer your receipts carry.</div>
      </div>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={LABEL}>Your address</div>
        <textarea aria-label="Organisation address" value={k.address} disabled={!can} onChange={e => set("address", e.target.value)} style={{ ...field, minHeight: 60 }} />
        <div style={LABEL}>Tax language</div>
        <textarea aria-label="Tax language" placeholder={k.taxLanguageDefault} value={k.taxLanguage} disabled={!can} onChange={e => set("taxLanguage", e.target.value)} style={{ ...field, minHeight: 70 }} />
        <div style={{ fontSize: 12, color: T.ink3 }}>Printed at the foot of every receipt and statement, followed by your EIN. Left empty, Steward uses the sentence shown in grey.</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink2, marginTop: 6 }}>
          <input type="checkbox" checked={!!k.statementYourYear} disabled={!can} onChange={e => set("statementYourYear", e.target.checked)} />
          Year-end statements include "Your year with us": the hours they volunteered and the events they came to.
        </label>
      </div>
      {can && <div><button style={btn} data-testid="brand-kit-save" disabled={busy} onClick={save}>{busy ? "Saving" : "Save brand kit"}</button></div>}
      {msg && <div style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
    </div>
  );
}

// ── ONE LETTER OR ONE-PERSON EMAIL ──────────────────────────────────────────
// Its cards live in the one Templates tab now (EmailTemplates.jsx, WIRE-1-ADDENDUM).
export function TemplateEditor({ t, fields, donors, isReadOnly, onClose, onSaved, onOpenDrafts }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [who, setWho] = useState(donors[0] ? donors[0].id : "");
  const [q, setQ] = useState("");
  const [pv, setPv] = useState(null);
  const [msg, setMsg] = useState("");
  const bodyRef = useRef(null);
  const dirty = subject !== t.subject || body !== t.body;
  useEffect(() => {
    if (!who) return undefined;
    const h = setTimeout(() => apiFetch(`/templates/${t.kind}/preview`, { method: "POST", body: JSON.stringify({ donorId: who, subject, body }) }).then(setPv).catch(() => setPv(null)), 250);
    return () => clearTimeout(h);
  }, [who, subject, body, t.kind]);
  const insert = key => {
    const el = bodyRef.current, tok = `{{${key}}}`;
    if (!el) { setBody(b => b + tok); return; }
    const a = el.selectionStart ?? body.length, b2 = el.selectionEnd ?? body.length;
    setBody(body.slice(0, a) + tok + body.slice(b2));
  };
  const save = async () => {
    setMsg("");
    try { const r = await apiFetch(`/templates/${t.kind}`, { method: "PUT", body: JSON.stringify({ subject, body }) }); onSaved(r); setMsg("Saved and marked reviewed."); }
    catch (e) { setMsg(e?.data?.sentence || errorMessage(e, "The template could not be saved.")); }
  };
  const use = async () => {
    setMsg("");
    try {
      if (t.channel === "letter") {
        const r = await fetch(`${API}/templates/${t.kind}/letter.pdf`, { method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ donorId: who }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.sentence || "The letter could not be made."); return; }
        const url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
        a.href = url; a.download = `${t.kind}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        setMsg("The letter is downloaded, ready to print.");
      } else {
        const r = await apiFetch(`/templates/${t.kind}/draft`, { method: "POST", body: JSON.stringify({ donorId: who }) });
        setMsg(r.sentence);
      }
    } catch (e) { setMsg(e?.data?.sentence || errorMessage(e, "That did not work.")); }
  };
  const people = q.trim() ? donors.filter(x => (x.name || "").toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const brand = pv && pv.brand;
  return (
    <div data-testid="template-editor" style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: 15, color: T.ink }}>{t.label}</strong>
          <button style={quiet} onClick={onClose}>Close</button>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.reviewed && !dirty ? T.greenDk : T.gold700 }}>{t.reviewed && !dirty ? "Reviewed" : dirty ? "Changed, not saved" : "Not yet reviewed"}</span>
        <input aria-label="Subject" value={subject} disabled={isReadOnly} onChange={e => setSubject(e.target.value)} style={field} />
        <textarea ref={bodyRef} aria-label="Body" value={body} disabled={isReadOnly} onChange={e => setBody(e.target.value)} style={{ ...field, minHeight: 220, lineHeight: 1.5 }} />
        <div style={LABEL}>Merge fields</div>
        <div data-testid="merge-picker" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {fields.map(f => <button key={f.key} type="button" disabled={isReadOnly} onClick={() => insert(f.key)} title={`Insert {{${f.key}}}`}
            style={{ ...quiet, padding: "4px 8px", fontSize: 12 }}>{f.label}</button>)}
        </div>
        {!isReadOnly && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn} data-testid="template-save" onClick={save}>Save in my words</button>
          <button style={quiet} data-testid="template-use" disabled={!t.reviewed || dirty || !who} onClick={use}
            title={!t.reviewed ? "Review and save it first" : undefined}>{t.channel === "letter" ? "Print for this person" : "Make a draft for this person"}</button>
          {onOpenDrafts && t.channel === "email" && <button style={quiet} onClick={onOpenDrafts}>Open drafts to review</button>}
        </div>}
        {msg && <div style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={LABEL}>Preview with a real person</div>
        <input aria-label="Find a person to preview with" placeholder="Type a name" value={q} onChange={e => setQ(e.target.value)} style={field} />
        {people.length > 0 && <div style={{ border: "1px solid " + T.bg3, borderRadius: 8 }}>
          {people.map(p => <button key={p.id} type="button" onClick={() => { setWho(p.id); setQ(""); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid " + T.bg2, padding: "7px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>{p.name}</button>)}
        </div>}
        {pv ? (
          <div data-testid="template-preview" style={{ border: "1px solid " + T.bg3, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ height: 8, background: brand ? brand.primary : T.greenDk }} />
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {brand && brand.logo && <img src={brand.logo} alt="" style={{ height: 26, maxWidth: 120, objectFit: "contain" }} />}
              <div style={{ fontSize: 12, color: T.ink3 }}>To {pv.donor.name}{pv.donor.email ? ` · ${pv.donor.email}` : ""}</div>
              <div style={{ fontWeight: 700, color: T.ink, fontSize: 13.5 }}>{pv.subject}</div>
              <div style={{ height: 2, background: brand ? brand.secondary : T.gold }} />
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: T.ink, lineHeight: 1.55 }}>{pv.body}</div>
              {pv.missing.length > 0 && <div style={{ fontSize: 12, color: T.gold700 }}>{pv.donor.name} has nothing on file for: {pv.missing.map(m => m.replace(/_/g, " ")).join(", ")}.</div>}
              {pv.unknown.length > 0 && <div style={{ fontSize: 12, color: T.gold700 }}>Not merge fields: {pv.unknown.map(u => `{{${u}}}`).join(", ")}.</div>}
            </div>
          </div>
        ) : <div style={{ fontSize: 13, color: T.ink3 }}>{who ? "Loading the preview" : "Choose a person to see it with their details."}</div>}
      </div>
    </div>
  );
}
