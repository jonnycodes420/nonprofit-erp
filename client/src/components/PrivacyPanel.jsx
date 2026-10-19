// CLIENT-SAFE-1 · Settings → Privacy, the line on the Connections card, and
// the client flag on a person. The rules and every sentence live in
// shared/clientSafe.js; the server decides, these only show and ask.
import { useState, useEffect } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { privacyLineParts } from "../../../shared/clientSafe";

const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 24px", marginBottom: 14 };
const primary = { background: T.green, color: T.white, border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: T.white, color: T.ink, border: "1px solid " + T.ink, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const linkBtn = { background: "none", border: "none", padding: 0, color: T.ink, fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" };
const said = (e, fallback) => (e && e.body && e.body.sentence) || errorMessage(e, fallback);
const when = iso => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return ""; } };

// "Privacy mode is on. 23 people marked as clients are never brought in. 4
// health details held back this month." Each number opens its list; a held
// detail shows who and when, never what.
export function PrivacyLine({ data }) {
  const [open, setOpen] = useState("");
  const [rows, setRows] = useState(null);
  if (!data || !data.on) return null;
  const show = async key => {
    if (open === key) { setOpen(""); return; }
    setOpen(key); setRows(null);
    try { setRows(await apiFetch(key === "clients" ? "/privacy/clients" : "/privacy/held")); }
    catch (e) { setRows({ error: said(e, "That list did not load.") }); }
  };
  return (
    <div data-testid="privacy-line" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.55, marginTop: 6 }}>
      {privacyLineParts(data).map((p, i) => p.open
        ? <button key={i} type="button" data-testid={"privacy-open-" + p.open} onClick={() => show(p.open)} style={linkBtn}>{p.text}</button>
        : <span key={i}>{p.text}</span>)}
      {data.aiOffSentence && <div data-testid="privacy-ai-off" style={{ color: T.gold700, marginTop: 4 }}>{data.aiOffSentence}</div>}
      {open && <div data-testid="privacy-list" style={{ marginTop: 8, padding: "10px 12px", background: T.bg, borderRadius: 10 }}>
        {!rows ? "Loading…" : rows.error ? rows.error : <>
          <div style={{ color: T.ink3, marginBottom: 6 }}>{rows.sentence}</div>
          {open === "clients" && (rows.people.length ? rows.people.map(p => <div key={p.id}>{p.name}{p.email ? <span style={{ color: T.ink3 }}> · {p.email}</span> : null}</div>) : "Nobody yet.")}
          {open === "held" && (rows.rows.length ? rows.rows.map((r, i) => <div key={i}>{(r.people || []).join(", ") || "Someone on file"} <span style={{ color: T.ink3 }}>· {when(r.at)} · {r.source === "bcc" ? "BCC address" : r.source === "capture" ? "an attachment" : "mailbox"}</span></div>) : "Nothing held back this month.")}
        </>}
      </div>}
    </div>
  );
}

export function usePrivacy() {
  const [p, setP] = useState(null);
  const load = () => apiFetch("/privacy").then(setP).catch(() => setP(null));
  useEffect(() => { load(); }, []);
  return [p, load, setP];
}

// A list someone uploads: a header row naming "name" and "email" columns, or
// plain lines of "Name, email". Only what is needed to MATCH is sent.
function parseList(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const cells = l => l.split(/[,\t;]/).map(c => c.trim().replace(/^"|"$/g, ""));
  const head = cells(lines[0]).map(c => c.toLowerCase());
  const ei = head.findIndex(c => /e-?mail/.test(c)), ni = head.findIndex(c => /name/.test(c));
  const body = ei >= 0 || ni >= 0 ? lines.slice(1) : lines;
  return body.map(l => {
    const c = cells(l);
    if (ei >= 0 || ni >= 0) return { name: ni >= 0 ? c[ni] || "" : "", email: ei >= 0 ? c[ei] || "" : "" };
    const email = c.find(x => /@/.test(x)) || "";
    return { name: c.filter(x => x !== email).join(" ").trim(), email };
  }).filter(r => r.name || r.email);
}

function MarkPreview({ preview, busy, onApply, onCancel }) {
  const fresh = preview.matched.filter(p => !p.already);
  return (
    <div data-testid="privacy-preview" style={{ marginTop: 12, padding: "12px 14px", background: T.bg, borderRadius: 10, fontSize: 13, color: T.ink }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{preview.matched.length} {preview.matched.length === 1 ? "person matches" : "people match"} someone on file.</div>
      <div style={{ maxHeight: 180, overflowY: "auto", lineHeight: 1.6 }}>
        {preview.matched.map(p => <div key={p.id}>{p.name}{p.email ? <span style={{ color: T.ink3 }}> · {p.email}</span> : null}{p.already ? <span style={{ color: T.ink3 }}> · already marked</span> : null}</div>)}
      </div>
      {preview.unmatchedSentence && <div style={{ color: T.ink3, marginTop: 6 }}>{preview.unmatchedSentence}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" data-testid="privacy-apply" disabled={busy || !fresh.length} onClick={onApply} style={{ ...primary, opacity: busy || !fresh.length ? 0.5 : 1 }}>
          {fresh.length ? `Mark ${fresh.length} as ${fresh.length === 1 ? "a client" : "clients"}` : "Nobody new to mark"}</button>
        <button type="button" onClick={onCancel} style={quiet}>Cancel</button>
      </div>
    </div>
  );
}

export function PrivacyPanel({ isAdmin, isReadOnly }) {
  const [p, load, setP] = usePrivacy();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);   // { kind: "upload"|"group", rows|ids, matched, ... }
  const [groups, setGroups] = useState(null);
  const [groupId, setGroupId] = useState("");
  const [removals, setRemovals] = useState(null);
  const loadRemovals = () => apiFetch("/privacy/removals").then(setRemovals).catch(() => setRemovals(null));
  useEffect(() => {
    apiFetch("/groups").then(r => setGroups(r.groups || r || [])).catch(() => setGroups([]));
    loadRemovals();
  }, []);
  if (!p) return <div style={card}>Loading…</div>;

  const flip = async () => {
    setBusy(true); setMsg("");
    try { setP(await apiFetch("/privacy", { method: "PUT", body: JSON.stringify({ on: !p.on }) })); }
    catch (e) { setMsg(said(e, "That did not change.")); }
    setBusy(false);
  };
  const upload = async file => {
    setMsg(""); setPreview(null);
    const rows = parseList(await file.text());
    if (!rows.length) { setMsg("Steward found no names or email addresses in that file."); return; }
    try { const r = await apiFetch("/privacy/clients/upload", { method: "POST", body: JSON.stringify({ rows }) }); setPreview({ ...r, kind: "upload", rows }); }
    catch (e) { setMsg(said(e, "That list could not be read.")); }
  };
  const fromGroup = async () => {
    if (!groupId) return;
    setMsg(""); setPreview(null);
    try {
      const g = await apiFetch(`/groups/${encodeURIComponent(groupId)}`);
      const ids = (g.members || []).map(m => m.id);
      if (!ids.length) { setMsg("That group has nobody in it."); return; }
      const r = await apiFetch("/privacy/clients/mark", { method: "POST", body: JSON.stringify({ donorIds: ids, source: "group" }) });
      setPreview({ ...r, kind: "group", ids });
    } catch (e) { setMsg(said(e, "That group could not be read.")); }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = preview.kind === "upload"
        ? await apiFetch("/privacy/clients/upload", { method: "POST", body: JSON.stringify({ rows: preview.rows, apply: true }) })
        : await apiFetch("/privacy/clients/mark", { method: "POST", body: JSON.stringify({ donorIds: preview.ids, source: "group", apply: true }) });
      setPreview(null); setMsg(r.sentence); load();
      offerUndo({ message: r.sentence, undoSeconds: 30, undoAction: async () => {
        await apiFetch(`/privacy/marks/${encodeURIComponent(r.markId)}/undo`, { method: "POST", body: "{}" }); load(); setMsg("Put back.");
      } });
    } catch (e) { setMsg(said(e, "Nobody was marked.")); }
    setBusy(false);
  };
  const undoRemoval = async id => {
    try { await apiFetch(`/privacy/removals/${encodeURIComponent(id)}/undo`, { method: "POST", body: "{}" }); setMsg("The email is back on their record."); loadRemovals(); }
    catch (e) { setMsg(said(e, "That could not be put back.")); }
  };

  return (
    <>
      <div style={card} data-testid="privacy-setting">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{p.label}</div>
            <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginTop: 4 }}>{p.description}</div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, color: T.ink, cursor: isAdmin && !isReadOnly ? "pointer" : "default" }}>
            <input type="checkbox" data-testid="privacy-toggle" checked={!!p.on} disabled={!isAdmin || isReadOnly || busy} onChange={flip} style={{ width: 18, height: 18, accentColor: T.green }} />
            {p.on ? "On" : "Off"}
          </label>
        </div>
        {!isAdmin && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 8 }}>Only an admin can change this.</div>}
        <PrivacyLine data={p} />
        {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, marginTop: 8 }}>{msg}</div>}
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Mark people as clients</div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginTop: 4 }}>
          Upload a list of names and email addresses, such as an export from your program system, or pick a group. Steward matches people already on file and never adds anyone. You can also mark one person on their profile.
        </div>
        {!isReadOnly && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <label style={{ ...quiet, display: "inline-block" }}>
            Upload a list
            <input type="file" accept=".csv,.txt,text/csv,text/plain" data-testid="privacy-upload" style={{ display: "none" }}
              onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) upload(f); }} />
          </label>
          <select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Pick a group"
            style={{ border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", maxWidth: "100%" }}>
            <option value="">Pick a group…</option>
            {(groups || []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button type="button" onClick={fromGroup} disabled={!groupId} style={{ ...quiet, opacity: groupId ? 1 : 0.5 }}>Check this group</button>
        </div>}
        {preview && <MarkPreview preview={preview} busy={busy} onApply={apply} onCancel={() => setPreview(null)} />}
      </div>

      {removals && removals.rows && removals.rows.length > 0 && <div style={card} data-testid="privacy-removals">
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Email removed from clients</div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, margin: "4px 0 8px" }}>{removals.sentence}</div>
        {removals.rows.map(r => (
          <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid " + T.bg2, fontSize: 13 }}>
            <span style={{ flex: "1 1 200px", minWidth: 0 }}>{r.name || "Someone"} · {r.count} {r.count === 1 ? "email" : "emails"} · {when(r.at)}</span>
            {!isReadOnly && <button type="button" onClick={() => undoRemoval(r.id)} style={quiet}>Undo</button>}
          </div>))}
      </div>}
    </>
  );
}

// On a person: the flag, and the one-step removal of what was already logged.
export function ClientFlag({ donorId, isClient, onChange, isReadOnly }) {
  const [on, setOn] = useState(!!isClient);
  const [logged, setLogged] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOn(!!isClient); }, [isClient]);
  const flip = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch(`/donors/${encodeURIComponent(donorId)}/client`, { method: "POST", body: JSON.stringify({ on: !on }) });
      setOn(r.isClient); setLogged(r.loggedEmail || 0); onChange && onChange(r.isClient);
    } catch (e) { setMsg(said(e, "That did not change.")); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/donors/${encodeURIComponent(donorId)}/client-email/remove`, { method: "POST", body: "{}" });
      setLogged(0); setMsg(r.sentence);
      offerUndo({ message: r.sentence, undoSeconds: 30, undoAction: async () => {
        await apiFetch(`/privacy/removals/${encodeURIComponent(r.removalId)}/undo`, { method: "POST", body: "{}" }); setMsg("The email is back on the record.");
      } });
    } catch (e) { setMsg(said(e, "Nothing was removed.")); }
    setBusy(false);
  };
  return (
    <div data-testid="client-flag" style={{ fontSize: 12.5, color: "inherit", lineHeight: 1.5 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, cursor: isReadOnly ? "default" : "pointer" }}>
        <input type="checkbox" checked={on} disabled={isReadOnly || busy} onChange={flip} style={{ accentColor: T.green }} />
        Client (never capture)
      </label>
      {on && logged > 0 && !isReadOnly && <button type="button" data-testid="client-remove-email" onClick={remove} disabled={busy} style={{ ...quiet, marginTop: 6 }}>
        Remove email already logged for this person ({logged})</button>}
      {msg && <div role="status" style={{ marginTop: 4, color: "inherit", opacity: 0.8 }}>{msg}</div>}
    </div>
  );
}
