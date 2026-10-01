// client/src/components/InboxConnect.jsx — INT-BUILD-1 Part 0.
//
// ONE CONNECT FLOW, FOUR DOORS TO IT.
//
// INT-4 shipped Gmail and Outlook logging and nobody could find it: the only
// button was a Gmail card halfway down Settings → Integrations, below the QR
// code and the embed form; Outlook had no button anywhere; the "profile menu"
// INT-4 described did not exist (the name chip went straight to Account); and
// Connections, where a person would look, had no mailbox card at all.
//
// So the card lives here, once, and is mounted in Settings → Connections and
// Settings → Integrations. The profile menu, the donor profile's timeline and
// the Home setup list all send the person to that card. Every button calls
// `startInboxConnect`, so there is one handshake and one wording of every
// refusal, including the demo's.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: "1px solid " + (primary ? T.greenDk : T.ink),
  borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: primary ? T.white : T.ink,
  cursor: "pointer", fontFamily: "inherit" });
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px" };
const quiet = { background: "transparent", border: "none", fontSize: 12, color: T.ink3, cursor: "pointer",
  fontWeight: 600, padding: "6px 4px", fontFamily: "inherit", textDecoration: "underline" };

export function syncedPhrase(ts) {
  if (!ts) return "not read yet";
  const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (mins < 1) return "read just now";
  if (mins < 60) return `read ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `read ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return "read " + new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// THE ONE HANDSHAKE. Resolves only on failure, with the sentence to show; on
// success the browser has already left for the provider.
export async function startInboxConnect(provider) {
  try {
    const r = await apiFetch(`/oauth/${encodeURIComponent(provider)}/start`, { method: "POST" });
    window.location.href = r.url;
    return null;
  } catch (e) {
    return e?.body?.sentence || e?.sentence || errorMessage(e, "That connection could not be started.");
  }
}

// One read of /mailbox, shared by every door.
export function useMailbox() {
  const [d, setD] = useState(null);
  const load = () => apiFetch("/mailbox").then(setD).catch(() => setD({ providers: [], team: [], failed: true }));
  useEffect(() => { load(); }, []);
  return [d, load];
}

// The donor profile's quiet line. Nothing at all once she has connected, and
// nothing while the answer is still coming (a line that flickers in and out
// on every profile is worse than none).
export function InboxNudge({ firstName, onNavigate }) {
  const [d] = useMailbox();
  if (!d || d.failed || d.connected) return null;
  const go = () => onNavigate && onNavigate("settings", { section: "connections", focus: "inbox" });
  return (
    <div data-testid="inbox-nudge" style={{ fontSize: 12.5, color: T.ink3, padding: "8px 2px", lineHeight: 1.5 }}>
      <button onClick={go} style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700,
        cursor: "pointer", fontSize: 12.5, fontFamily: "inherit", textDecoration: "underline" }}>Connect your inbox</button>
      {" "}and emails with {firstName || "this person"} show up here.
    </div>
  );
}

export function InboxConnectCard({ focused = false, isReadOnly = false }) {
  const [d, load] = useMailbox();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [ref, setRef] = useState(null);
  useEffect(() => { if (focused && ref) ref.scrollIntoView({ behavior: "smooth", block: "start" }); }, [focused, ref]);

  if (!d) return <div style={card}><div style={h}>Email and calendar</div><div style={{ fontSize: 13, color: T.ink3, marginTop: 8 }}>Loading.</div></div>;
  const providers = d.providers || [];

  const connect = async key => {
    setBusy("connect:" + key); setMsg("");
    const sentence = await startInboxConnect(key);
    if (sentence) { setMsg(sentence); setBusy(""); }
  };
  const act = async (key, path, body, label) => {
    setBusy(label + ":" + key); setMsg("");
    try { const r = await apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) }); setMsg(r.sentence || r.message || "Done."); load(); }
    catch (e) { setMsg(e?.body?.sentence || e?.sentence || errorMessage(e, "That did not change.")); }
    setBusy("");
  };
  const disconnect = p => {
    if (!window.confirm(`Disconnect ${p.label}? Steward stops reading it. What is already logged stays on the records.`)) return;
    act(p.key, `/oauth/${p.key}/disconnect`, {}, "disconnect");
  };

  return (
    <div ref={setRef} data-testid="inbox-connect-card" style={card}>
      <div style={h}>Email and calendar</div>
      <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: T.ink, margin: "6px 0 4px" }}>
        Connect your inbox
      </div>
      <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, maxWidth: 620, marginBottom: 14 }}>
        Your conversations with people already in Steward log themselves onto their records. Nothing else in your mailbox is kept, and Steward never sends from it.
      </div>
      {d.demo && (
        <div data-testid="inbox-demo-note" style={{ background: T.bg, border: "1px solid " + T.bg3, borderLeft: "3px solid " + T.gold,
          borderRadius: 10, padding: "10px 14px", fontSize: 13, color: T.ink, lineHeight: 1.55, marginBottom: 14 }}>
          {d.demoSentence}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {providers.map((p, i) => (
          <div key={p.key} data-testid={`inbox-provider-${p.key}`}
            style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "12px 14px",
              background: T.bg, border: "1px solid " + T.bg3, borderRadius: 12 }}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{p.label}</div>
              <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>
                {p.connected
                  ? <>{p.paused ? "Paused" : "Connected"} as {p.address} · {syncedPhrase(p.lastSyncedAt)}{p.example ? " · an example" : ""}</>
                  : p.sentence}
              </div>
              {p.lastError && <div style={{ fontSize: 12, color: T.gold700, marginTop: 2 }}>{p.lastError}</div>}
              {!p.connected && p.unverifiedNote && !d.demo && (
                <div data-testid="inbox-unverified-note" style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>{p.unverifiedNote}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {(!p.connected || p.lastError) && (
                <button data-testid={`inbox-connect-${p.key}`} onClick={() => connect(p.key)} disabled={isReadOnly || !!busy}
                  style={{ ...btn(i === 0), opacity: isReadOnly || busy ? 0.6 : 1 }}>
                  {busy === "connect:" + p.key ? "Opening…" : p.lastError ? `Reconnect ${p.label}` : `Connect ${p.label}`}
                </button>
              )}
              {p.connected && !p.example && <>
                <button onClick={() => act(p.key, `/mailbox/${p.key}/pause`, { paused: !p.paused }, "pause")} disabled={!!busy}
                  style={btn(false)}>{p.paused ? "Turn back on" : "Pause"}</button>
                <button onClick={() => disconnect(p)} disabled={!!busy} style={quiet}>Disconnect</button>
              </>}
            </div>
          </div>
        ))}
      </div>
      {msg && <div data-testid="inbox-msg" style={{ marginTop: 12, fontSize: 13, color: T.ink, lineHeight: 1.5 }}>{msg}</div>}

      {(d.team || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={h}>Your team</div>
          <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, margin: "4px 0 8px" }}>{d.teamDefinition}</div>
          {d.team.map(t => (
            <div key={t.id} data-testid="inbox-team-row" style={{ display: "flex", justifyContent: "space-between", gap: 12,
              padding: "7px 0", borderTop: "1px solid " + T.bg2, fontSize: 13 }}>
              <span style={{ color: T.ink, fontWeight: 600 }}>{t.name}{t.you ? " (you)" : ""}</span>
              <span style={{ color: T.ink3, textAlign: "right" }}>
                {t.connections.length
                  ? t.connections.map(c => `${c.label}${c.paused ? ", paused" : c.broken ? ", needs reconnecting" : ""}, ${syncedPhrase(c.lastSyncedAt)}`).join(" · ")
                  : "Not connected"}
              </span>
            </div>
          ))}
        </div>
      )}

      {providers.some(p => p.connected && !p.example) && <NeverLogList d={d} reload={load}/>}
    </div>
  );
}

// HER LIST, not the organisation's (INT-4). Every route behind it is scoped
// to her user id; an admin colleague cannot reach it.
function NeverLogList({ d, reload }) {
  const [pattern, setPattern] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const v = pattern.trim();
    if (!v) return;
    setBusy(true);
    try { const r = await apiFetch("/mailbox/never-log", { method: "POST", body: JSON.stringify({ pattern: v }) }); setMsg(r.sentence); setPattern(""); reload(); }
    catch (e) { setMsg(e?.error || e?.sentence || "That did not save."); }
    setBusy(false);
  };
  const remove = async id => {
    setBusy(true);
    try { const r = await apiFetch(`/mailbox/never-log/${id}`, { method: "DELETE" }); setMsg(r.sentence); reload(); }
    catch { setMsg("That did not change."); }
    setBusy(false);
  };
  return (
    <div data-testid="mailbox-controls" style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid " + T.bg3 }}>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.55, marginBottom: 10 }}>{d.fieldsSentence}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Never log these</div>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 8 }}>
        An email address, or a whole domain. Nobody here can see this list but you.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input data-testid="mailbox-never-input" value={pattern} onChange={e => setPattern(e.target.value)}
          placeholder="doctor@surgery.example or surgery.example"
          style={{ flex: "1 1 260px", minWidth: 0, padding: "8px 10px", fontFamily: "inherit", fontSize: 13,
            border: "1px solid " + T.bg3, borderRadius: 8, background: T.white, color: T.ink }}/>
        <button data-testid="mailbox-never-add" onClick={add} disabled={busy || !pattern.trim()}
          style={{ ...btn(false), opacity: busy || !pattern.trim() ? 0.5 : 1 }}>Add</button>
      </div>
      {(d.neverLog || []).map(n => (
        <div key={n.id} data-testid="mailbox-never-row" style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid " + T.bg3 }}>
          <span style={{ fontSize: 13, color: T.ink }}>{n.pattern}</span>
          <button onClick={() => remove(n.id)} disabled={busy} style={quiet}>Remove</button>
        </div>
      ))}
      {!(d.neverLog || []).length && <div style={{ fontSize: 12, color: T.ink3 }}>Nothing on the list yet.</div>}
      <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.5, marginTop: 12 }}>{d.touchSentence}</div>
      {msg && <div data-testid="mailbox-msg" style={{ marginTop: 10, fontSize: 12.5, color: T.ink }}>{msg}</div>}
    </div>
  );
}

export default InboxConnectCard;
