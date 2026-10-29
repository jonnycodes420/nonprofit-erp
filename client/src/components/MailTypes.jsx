// MailTypes.jsx · SEND-GATE-2. WHAT STEWARD SENDS FOR YOU.
//
//   MailTypeSwitch     one email's switch, with what it does, its state and who
//                      gets it. The same switch in Settings and in every editor
//                      that uses the email (giving pages, events, auctions…).
//   MailTypesSettings  Settings, "What Steward sends automatically".
//   GoingOut           Settings, "Going out": next 7 days, Sent, Held.
//   MailStatusChip     the quiet chip in the top bar, on every page.
//   HomeMailLine       the one line at the top of Home.
//
// Off is the normal, safe state: it reads calm, never as a warning. The server
// decides everything (routes/mailTypes.js); this file asks and shows.
import { useEffect, useState } from "react";
import { T, Modal, SectionLabel } from "./shared";
import { apiFetch, API, getToken } from "../api";
import { useMailTypes, setMailType, reloadMailTypes } from "../lib/mailTypes";
import { askConfirm } from "./ConfirmDialog";

const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 24px", marginBottom: 14 };
const help = { fontSize: 12.5, color: T.ink3, lineHeight: 1.5 };
const linkBtn = { background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" };
const quiet = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 10, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const day = d => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const dayLong = d => d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";

function Switch({ on, disabled, onClick, label, testid }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} data-testid={testid}
      style={{ background: "none", border: "none", padding: 0, cursor: disabled ? "default" : "pointer", flex: "0 0 auto" }}>
      <span aria-hidden style={{ display: "block", width: 38, height: 22, borderRadius: 11, background: on ? T.greenDk : T.bg3, position: "relative", opacity: disabled ? 0.5 : 1 }}>
        <span style={{ position: "absolute", top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: T.white }} />
      </span>
    </button>
  );
}

// Turning one on: one clear sentence, and who gets it.
function TurnOnDialog({ t, onClose, onDone }) {
  const [who, setWho] = useState("everyone");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const btn = { font: "inherit", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
  const go = async () => {
    setBusy(true); setErr("");
    try { await onDone(who); }
    catch (e) { setErr((e && (e.sentence || e.message)) || "That didn't save."); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Turn on ${t.name.toLowerCase()}?`} width={460} zIndex={500}
      footer={<>
        <button type="button" data-testid="mail-type-cancel" onClick={onClose} style={{ ...btn, background: T.white, color: T.ink, border: "1px solid " + T.ink }}>Cancel</button>
        <button type="button" data-testid="mail-type-confirm" disabled={busy} onClick={go} style={{ ...btn, background: T.green, color: T.white, border: "none", opacity: busy ? 0.6 : 1 }}>Turn on</button>
      </>}>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: T.ink }} data-testid="mail-type-confirm-sentence">
        {who === "everyone" ? t.turnOn : `${t.name} will go only to donors you set to Always include on their profile or from the Donors list.`}
      </div>
      <div role="radiogroup" aria-label="Who gets it" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>Who gets it</div>
        {[["everyone", "Everyone, from now on"], ["chosen", "Only donors I choose"]].map(([k, label]) => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, color: T.ink, cursor: "pointer" }}>
            <input type="radio" name="who" data-testid={`mail-type-who-${k}`} checked={who === k} onChange={() => setWho(k)} style={{ accentColor: T.green }} /> {label}
          </label>
        ))}
      </div>
      {err && <div style={{ ...help, color: T.ink, marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}

// One email's row: name, sentence, switch, and a small state line. `compact`
// is the editor's one line under its section.
export function MailTypeSwitch({ typeKey, from = "settings", compact = false, onPreview }) {
  const { page, types } = useMailTypes();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = types.find(x => x.key === typeKey);
  if (!page || !t) return null;
  const can = page.canChange;
  const waiting = t.on && !page.mailOn;
  const flip = async () => {
    if (!can || busy) return;
    if (!t.on) { setAsking(true); return; }
    setBusy(true);
    try { await setMailType(t.key, false, null, from); } catch { /* the page reloads as it is */ }
    setBusy(false);
  };
  const state = waiting ? page.waiting
    : t.on ? `${t.since} · ${t.whoGetsIt.toLowerCase()} · ${t.lastSent.charAt(0).toLowerCase() + t.lastSent.slice(1)}` : t.since;
  const line = compact
    ? (waiting ? page.waiting : t.on ? `${t.name}: on, ${t.whoGetsIt.toLowerCase()}.` : t.offLine)
    : null;
  return (
    <div data-testid={`mail-type-${t.key}`} data-on={t.on ? "1" : "0"} style={{ display: "flex", gap: compact ? 12 : 14, alignItems: compact ? "center" : "flex-start", padding: compact ? "4px 0" : "14px 0", borderTop: compact ? "none" : "1px solid " + T.bg2 }}>
      <div style={{ flex: compact ? "0 1 auto" : "1 1 auto", minWidth: 0 }}>
        {compact
          ? <div style={help} data-testid={`mail-type-line-${t.key}`}>{line}{!can && !t.on ? " An admin can turn it on." : ""}</div>
          : <>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: T.ink }}>{t.name}</div>
              <div style={{ ...help, fontSize: 13, marginTop: 2 }}>{t.sentence}</div>
              <div style={{ fontSize: 12, color: waiting ? T.ink2 : T.ink3, marginTop: 6 }} data-testid={`mail-type-state-${t.key}`}>
                {state}
                {onPreview && <> · <button type="button" style={{ ...linkBtn, fontSize: 12 }} data-testid={`mail-type-preview-${t.key}`} onClick={() => onPreview(t)}>Preview</button></>}
              </div>
            </>}
      </div>
      <Switch on={t.on} disabled={!can || busy} onClick={flip} label={t.name} testid={`mail-type-switch-${t.key}`} />
      {asking && <TurnOnDialog t={t} onClose={() => setAsking(false)}
        onDone={async who => { await setMailType(t.key, true, who, from); setAsking(false); }} />}
    </div>
  );
}

// Several in one place (an editor that uses more than one email).
export function MailTypeSwitches({ keys, from }) {
  return <div data-testid="mail-type-inline" style={{ marginTop: 8 }}>{keys.map(k => <MailTypeSwitch key={k} typeKey={k} from={from} compact />)}</div>;
}

function PreviewSheet({ preview, onClose }) {
  return (
    <div role="dialog" aria-label="Preview" data-testid="mail-preview" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.5)", zIndex: 400, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(560px,100%)", height: "100%", overflowY: "auto", background: T.bg, padding: "24px 22px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: T.ink }}>{preview.title || "Preview"}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 20, color: T.ink3, cursor: "pointer" }}>×</button>
        </div>
        {preview.note && <div style={{ ...help, marginBottom: 8 }}>{preview.note}</div>}
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 8 }}>{preview.subject}</div>
        {preview.html == null ? <div style={help}>Loading…</div>
          : <iframe title="The email" sandbox="" srcDoc={preview.html} style={{ width: "100%", height: "70vh", border: "1px solid " + T.bg3, borderRadius: 12, background: T.white }} />}
      </div>
    </div>
  );
}

// ── Settings: What Steward sends automatically ──────────────────────────
export function MailTypesSettings({ onNavigate }) {
  const { page } = useMailTypes();
  const [preview, setPreview] = useState(null);
  useEffect(() => { reloadMailTypes(); }, []);
  if (!page) return <div style={card}>Loading…</div>;
  const open = async t => {
    setPreview({ title: t.name, subject: "", html: null });
    try { const p = await apiFetch(`/mail-types/${t.key}/preview`); setPreview({ title: t.name, ...p }); }
    catch { setPreview({ title: t.name, subject: "", html: "<p>The preview could not load.</p>" }); }
  };
  return (
    <div data-testid="mail-types-page" style={{ maxWidth: 760 }}>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>What Steward sends automatically</div>
        <div style={{ ...help, fontSize: 13, marginTop: 4 }}>
          Steward sends nothing on its own until you turn it on here. Each email starts off. Anything you write and send yourself still goes.
          {" "}<button type="button" style={linkBtn} data-testid="mail-types-going-out" onClick={() => onNavigate && onNavigate("settings", { section: "going-out" })}>See what's going out</button>
        </div>
        {page.top && <div data-testid="mail-types-org-off" style={{ ...help, fontSize: 13, color: T.ink2, marginTop: 10 }}>{page.top}</div>}
        {page.mailSentence && page.mailOn && <div style={{ ...help, marginTop: 8 }}>{page.mailSentence}</div>}
        {!page.canChange && <div style={{ ...help, marginTop: 8 }}>Only an admin can change these.</div>}
      </div>
      {page.groups.map(g => (
        <div key={g.key} style={{ ...card, paddingTop: 16, paddingBottom: 6 }}>
          <SectionLabel>{g.label}</SectionLabel>
          {g.types.map(t => <MailTypeSwitch key={t.key} typeKey={t.key} onPreview={open} />)}
        </div>
      ))}
      <div style={{ ...card, paddingTop: 16 }}>
        <SectionLabel>Always sent</SectionLabel>
        {page.always.map(a => (
          <div key={a.name} data-testid="mail-types-always" style={{ borderTop: "1px solid " + T.bg2, paddingTop: 12 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: T.ink }}>{a.name}</div>
            <div style={{ ...help, fontSize: 13, marginTop: 2 }}>{a.sentence}</div>
          </div>
        ))}
      </div>
      {preview && <PreviewSheet preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ── Going out ───────────────────────────────────────────────────────────
const rowStyle = { display: "flex", gap: 12, alignItems: "baseline", padding: "9px 0", borderTop: "1px solid " + T.bg2, fontSize: 13.5, color: T.ink, flexWrap: "wrap" };
export function GoingOut({ onNavigate, isReadOnly, data: given, orgPath = "" }) {
  const [data, setData] = useState(given || null);
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [open, setOpen] = useState({});
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");
  const readOnly = isReadOnly || !!given;
  const q = () => { const u = new URLSearchParams(); if (type) u.set("type", type); if (from) u.set("from", from); return u.toString(); };
  const load = () => apiFetch(`/going-out${q() ? "?" + q() : ""}`).then(setData).catch(() => setData(d => d || { next: { groups: [] }, sent: [], held: [], types: [] }));
  useEffect(() => { if (!given) load(); }, [type, from]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div style={card}>Loading…</div>;
  const show = async (title, path) => {
    setPreview({ title, subject: "", html: null });
    try { const p = await apiFetch(path); setPreview({ title, ...p }); } catch { setPreview({ title, subject: "", html: "<p>The preview could not load.</p>" }); }
  };
  const pause = async g => {
    if (!(await askConfirm({ title: `Pause ${g.name.toLowerCase()}?`, body: `Nothing of this kind goes until you turn it back on. ${g.count} planned in the next 7 days will wait.`, yes: "Pause" }))) return;
    try { await setMailType(g.typeKey, false, null, "going_out"); await load(); } catch (e) { setMsg((e && e.sentence) || "That didn't save."); }
  };
  const skip = async (g, p) => {
    try { const r = await apiFetch("/going-out/skip", { method: "POST", body: JSON.stringify({ typeKey: g.typeKey, donorId: p.donorId }) }); setMsg(r.sentence); await load(); }
    catch (e) { setMsg((e && e.sentence) || "That didn't save."); }
  };
  const sendHeld = async h => {
    if (!(await askConfirm({ title: "Send this one email?", body: `${h.what}${h.name ? ", to " + h.name : ""}. Only this one message goes.`, yes: "Send" }))) return;
    try { await apiFetch(`/going-out/held/${h.id}/send`, { method: "POST", body: JSON.stringify({ confirm: true }) }); setMsg("Sent."); await load(); }
    catch (e) { setMsg((e && e.sentence) || "It wasn't sent."); await load(); }
  };
  const next = data.next || { groups: [] };
  return (
    <div data-testid="going-out" style={{ maxWidth: 820 }}>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Going out</div>
        <div style={{ ...help, fontSize: 13, marginTop: 4 }}>
          Every email Steward sends on its own: what's planned for the next 7 days, what went, and what it held back.
          {onNavigate && <> <button type="button" style={linkBtn} onClick={() => onNavigate("settings", { section: "automatic" })}>Choose which emails</button></>}
        </div>
        {!next.mailOn && <div style={{ ...help, fontSize: 13, color: T.ink2, marginTop: 8 }}>Email is off for your organization, so nothing below goes until Steward turns it on with you.</div>}
        {msg && <div data-testid="going-out-msg" style={{ ...help, color: T.ink, marginTop: 8 }}>{msg}</div>}
      </div>

      <div style={card} data-testid="going-out-next">
        <SectionLabel>Next 7 days</SectionLabel>
        {!next.groups.length && <div style={help}>Nothing is planned to go on its own in the next 7 days.</div>}
        {next.groups.map(g => (
          <div key={g.typeKey} data-testid={`going-out-next-${g.typeKey}`} style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{g.name}</span>
              <button type="button" style={{ ...linkBtn, color: T.ink2 }} onClick={() => setOpen(o => ({ ...o, [g.typeKey]: !o[g.typeKey] }))}>
                {g.count ? `${g.count} ${g.count === 1 ? "person" : "people"}` : `${g.campaigns.length} ${g.campaigns.length === 1 ? "campaign" : "campaigns"}`}
              </button>
              <span style={{ flex: 1 }} />
              {!readOnly && <button type="button" style={quiet} data-testid={`going-out-pause-${g.typeKey}`} onClick={() => pause(g)}>Pause this</button>}
            </div>
            {g.campaigns.map(c => <div key={c.id} style={{ ...help, marginTop: 4 }}>{c.name} · {dayLong(c.day)} · to its list</div>)}
            {open[g.typeKey] && g.people.map((p, i) => (
              <div key={p.donorId + i} style={{ ...rowStyle, paddingLeft: 2 }}>
                <span style={{ flex: "1 1 160px", fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: T.ink3, flex: "1 1 160px" }}>{p.what}</span>
                <span style={{ color: T.ink3 }}>{dayLong(p.day)}</span>
                {!readOnly && <button type="button" style={linkBtn} data-testid="going-out-skip" onClick={() => skip(g, p)}>Skip this person</button>}
              </div>
            ))}
          </div>
        ))}
        <div style={{ ...help, marginTop: 10 }}>{next.cantSee}</div>
      </div>

      <div style={card} data-testid="going-out-sent">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          <SectionLabel>Sent</SectionLabel>
          <span style={{ flex: 1 }} />
          <select aria-label="Which emails" value={type} onChange={e => setType(e.target.value)} style={{ ...quiet, fontWeight: 600 }}>
            <option value="">All emails</option>
            {(data.types || []).map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
          <input type="date" aria-label="From" value={from} onChange={e => setFrom(e.target.value)} style={{ ...quiet, fontWeight: 600 }} />
          {!given && <a href={`${API}/going-out/sent.csv${q() ? "?" + q() : ""}`} onClick={async e => {
            e.preventDefault();
            const r = await fetch(`${API}/going-out/sent.csv${q() ? "?" + q() : ""}`, { headers: { Authorization: "Bearer " + (getToken() || "") } }).catch(() => null);
            if (!r || !r.ok) { setMsg("The file could not be made."); return; }
            const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = "steward-sent.csv"; a.click(); URL.revokeObjectURL(url);
          }} style={{ ...linkBtn, fontSize: 12.5 }}>Export CSV</a>}
        </div>
        {!data.sent.length && <div style={help}>Nothing has gone on its own yet.</div>}
        {data.sent.map(s => (
          <div key={s.id} style={rowStyle} data-testid="going-out-sent-row">
            <span style={{ flex: "1 1 150px", fontWeight: 600 }}>{s.name || "Someone"}</span>
            <span style={{ flex: "2 1 220px", color: T.ink2 }}>{s.subject}</span>
            <span style={{ color: T.ink3 }}>{s.typeName} · {day(s.sentAt)}</span>
            <button type="button" style={linkBtn} onClick={() => show(s.typeName, `${orgPath}/going-out/sent/${s.id}`)}>See it</button>
          </div>
        ))}
      </div>

      <div style={card} data-testid="going-out-held">
        <SectionLabel>Held</SectionLabel>
        {!data.held.length && <div style={help}>Steward hasn't held anything back.</div>}
        {data.held.map(h => (
          <div key={h.id} style={rowStyle} data-testid="going-out-held-row">
            <span style={{ flex: "1 1 150px", fontWeight: 600 }}>{h.name || "Someone"}</span>
            <span style={{ flex: "2 1 220px", color: T.ink2 }}>{h.what}</span>
            <span style={{ color: T.ink3, flex: "1 1 200px" }}>Not sent: {h.why} · {day(h.at)}</span>
            <button type="button" style={linkBtn} onClick={() => show(h.typeName, `${orgPath}/going-out/held/${h.id}`)}>See it</button>
            {!readOnly && <button type="button" style={linkBtn} data-testid="going-out-held-send" onClick={() => sendHeld(h)}>Send</button>}
          </div>
        ))}
      </div>
      {preview && <PreviewSheet preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ── The top bar's chip ──────────────────────────────────────────────────
// Muted when off, the brand green with a small dot when on, never a badge.
// At phone width it shrinks to the dot and a short word.
export function MailStatusChip({ onNavigate, narrow = false }) {
  const { status } = useMailTypes();
  if (!status) return null;
  const on = status.state === "on";
  const waiting = status.state === "waiting";
  return (
    <button type="button" data-testid="topbar-mail-status" data-state={status.state} title={status.chip + (status.mailSentence ? ". " + status.mailSentence : "")}
      onClick={() => onNavigate && onNavigate("settings", { section: "automatic" })}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid " + T.green650,
        borderRadius: 999, padding: narrow ? "3px 8px" : "4px 10px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap",
        color: on ? T.inkInverse : "rgba(240,237,230,0.6)", fontSize: 12, fontWeight: 600 }}>
      {(on || waiting) && <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: on ? T.green500 : T.gold500 }} />}
      <span>{narrow ? (on ? status.short : waiting ? "Waiting" : "Email off") : status.chip}</span>
    </button>
  );
}

// ── Home's one line ─────────────────────────────────────────────────────
export function HomeMailLine({ onNavigate }) {
  const { status } = useMailTypes();
  if (!status) return null;
  const on = status.state !== "off";
  return (
    <div data-testid="home-mail-line" style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.5, padding: "0 2px" }}>
      {status.home}{status.mailSentence && status.state !== "off" ? " " + status.mailSentence : ""}{" "}
      <button type="button" style={{ ...linkBtn, fontSize: 13.5 }} data-testid="home-mail-link"
        onClick={() => onNavigate && onNavigate("settings", { section: on ? "going-out" : "automatic" })}>{on ? "See what's going out" : "Choose what's automatic"}</button>
    </div>
  );
}
