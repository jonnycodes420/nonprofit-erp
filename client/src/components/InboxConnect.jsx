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
import { Figure } from "./Figure";
import { DonorLink } from "./RecordLink";

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

const MAIN = {
  serif: "'DM Serif Display',Georgia,serif",
  label: { fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" },
  big: { display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", minHeight: 56, borderRadius: 12,
    font: "600 16px 'DM Sans',sans-serif", cursor: "pointer", textAlign: "left", width: "100%" },
};
const PROVIDER_BUTTON = { google: "Connect Gmail and Google Calendar", microsoft: "Connect Outlook and Microsoft 365" };
const ICON_MAIL = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>;
const ICON_CAL = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>;

// docs/int-build-1/Main.html — the connect page. Values copied from it.
export function InboxConnectCard({ focused = false, isReadOnly = false, onNavigate }) {
  const [d, load] = useMailbox();
  const [first, setFirst] = useState(null);
  const [bcc, setBcc] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState("");
  const [ref, setRef] = useState(null);
  useEffect(() => { if (focused && ref) ref.scrollIntoView({ behavior: "smooth", block: "start" }); }, [focused, ref]);
  useEffect(() => { apiFetch("/settings/inbound-email").then(r => setBcc(r?.address || "")).catch(() => {}); }, []);
  const connected = !!d?.connected;
  useEffect(() => { if (connected) apiFetch("/calendar/first-sync").then(setFirst).catch(() => {}); }, [connected]);

  if (!d) return <div style={card}><div style={h}>Email and calendar</div><div style={{ fontSize: 13, color: T.ink3, marginTop: 8 }}>Loading.</div></div>;
  const providers = d.providers || [];
  const mine = providers.filter(p => p.connected);
  const me = (d.team || []).find(t => t.you);

  const connect = async key => {
    setBusy("connect:" + key); setMsg("");
    const sentence = await startInboxConnect(key);
    if (sentence) { setMsg(sentence); setBusy(""); }
  };
  const act = async (key, path, body, label) => {
    setBusy(label + ":" + key); setMsg("");
    try { const r = await apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) }); setMsg(r.sentence || r.message || "Done."); load(); }
    catch (e) { setMsg(e?.sentence || errorMessage(e, "That did not change.")); }
    setBusy("");
  };
  const disconnect = (p, purge) => {
    if (!window.confirm(purge
      ? `Disconnect ${p.label} and remove every conversation it logged? This cannot be undone.`
      : `Disconnect ${p.label}? Steward stops reading it. What is already logged stays on the records.`)) return;
    act(p.key, `/oauth/${p.key}/disconnect`, purge ? { purge: true } : {}, "disconnect");
  };
  const teamLink = name => {
    const url = `${window.location.origin}/dashboard?tab=settings&sub=connections`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(`${url}  (copied. Send it to ${name} yourself; Steward does not email it.)`);
  };
  const look = first?.worthALook || [];
  const lookLine = w => w.kind === "meeting"
    ? <><b style={{ fontWeight: 600 }}>{w.name}</b> · you meet {new Date(w.startsAt).toDateString() === new Date(Date.now() + 864e5).toDateString() ? "tomorrow" : new Date(w.startsAt).toLocaleDateString("en-US", { weekday: "long" })} at {new Date(w.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</>
    : w.kind === "unanswered"
    ? <><b style={{ fontWeight: 600 }}>{w.name}</b> · emailed you{w.count > 1 ? ` ${w.count === 2 ? "twice" : `${w.count} times`}` : ""}, no reply in {w.days} days</>
    : <><b style={{ fontWeight: 600 }}>{w.name}</b> · gave {"$" + Math.round(w.given).toLocaleString("en-US")}, {w.lastMet ? `last met ${new Date(w.lastMet + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : "no meeting on record"}</>;

  return (
    <div ref={setRef} data-testid="inbox-connect-card" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ ...MAIN.label, color: T.ink3 }}>Settings · Connections</div>
        <h2 style={{ margin: 0, fontFamily: MAIN.serif, fontWeight: 400, fontSize: 44, lineHeight: 1.1, color: T.ink }}>Email and calendar</h2>
      </div>

      <section className="inbox-promise" style={{ background: T.white, borderRadius: 20, padding: "clamp(22px, 4vw, 44px) clamp(18px, 4vw, 48px)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <h3 style={{ margin: 0, fontFamily: MAIN.serif, fontWeight: 400, fontSize: 38, lineHeight: 1.12, color: T.ink }}>Let your inbox and calendar keep the record.</h3>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: T.ink3, maxWidth: 520 }}>Connect once. Every email and meeting with someone already in Steward lands on their profile by itself, replies included. Nobody forwards anything, nobody types up a lunch.</p>
          {d.demo && <div data-testid="inbox-demo-note" style={{ background: T.bg, borderLeft: "3px solid " + T.gold, borderRadius: 10, padding: "10px 14px", fontSize: 14, color: T.ink, lineHeight: 1.55, maxWidth: 520 }}>{d.demoSentence}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 440, marginTop: 6 }}>
            {providers.map((p, i) => {
              const primary = i === 0;
              const needsCalendar = p.connected && !p.calendarGranted && !p.example;
              return (
                <div key={p.key} data-testid={`inbox-provider-${p.key}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(!p.connected || p.lastError || needsCalendar) ? (
                    <button type="button" data-testid={`inbox-connect-${p.key}`} onClick={() => connect(p.key)} disabled={isReadOnly || !!busy}
                      style={{ ...MAIN.big, border: primary ? 0 : "1.5px solid " + T.ink, background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, opacity: isReadOnly || busy ? 0.7 : 1 }}>
                      {primary ? ICON_MAIL : ICON_CAL}
                      <span style={{ flexGrow: 1 }}>{busy === "connect:" + p.key ? "Opening…" : needsCalendar ? `Add your ${p.key === "google" ? "Google Calendar" : "Outlook calendar"}` : p.lastError ? `Reconnect ${p.label}` : PROVIDER_BUTTON[p.key] || `Connect ${p.label}`}</span>
                      <span style={{ fontWeight: 400, fontSize: 14, opacity: primary ? 0.8 : 1, color: primary ? undefined : T.ink3 }}>About a minute</span>
                    </button>
                  ) : (
                    <div style={{ ...MAIN.big, cursor: "default", border: "1px solid " + T.bg2, background: T.bg, color: T.ink, flexWrap: "wrap" }}>
                      {primary ? ICON_MAIL : ICON_CAL}
                      <span style={{ flexGrow: 1, fontWeight: 600 }}>{p.label}{p.calendarGranted ? " and calendar" : ""}<span style={{ display: "block", fontWeight: 400, fontSize: 13, color: T.ink3 }}>{p.paused ? "Paused" : "Connected"} as {p.address} · {syncedPhrase(p.lastSyncedAt)}{p.example ? " · an example" : ""}</span></span>
                      {!p.example && <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => act(p.key, `/mailbox/${p.key}/sync`, {}, "sync")} disabled={!!busy} style={quiet}>Sync now</button>
                        <button type="button" onClick={() => act(p.key, `/mailbox/${p.key}/pause`, { paused: !p.paused }, "pause")} disabled={!!busy} style={quiet}>{p.paused ? "Turn back on" : "Pause"}</button>
                        <button type="button" onClick={() => disconnect(p, false)} disabled={!!busy} style={quiet}>Disconnect</button>
                        <button type="button" onClick={() => disconnect(p, true)} disabled={!!busy} style={quiet}>Disconnect and remove</button>
                      </span>}
                    </div>
                  )}
                  {needsCalendar && <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>Your mail is logging. Add your calendar and meetings with people in Steward show up too. {p.key === "google" ? "Google will ask you to approve the calendar." : "Microsoft will ask you to approve the calendar."}</div>}
                  {p.lastError && <div style={{ fontSize: 13, color: T.gold700 }}>{p.lastError}</div>}
                  {!p.connected && p.unverifiedNote && !d.demo && <div data-testid="inbox-unverified-note" style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>{p.unverifiedNote}</div>}
                </div>
              );
            })}
            <div style={{ fontSize: 14, color: T.ink3, lineHeight: 1.5 }}>Each person connects their own.{bcc ? <> Rather not? Your BCC address works too: <span style={{ fontWeight: 600, color: T.ink }}>{bcc}</span></> : null}</div>
            {msg && <div data-testid="inbox-msg" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{msg}</div>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 20, alignContent: "start" }}>
          <div style={{ background: T.bg, borderRadius: 16, padding: 26, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...MAIN.label, color: T.greenDk, fontWeight: 600 }}>What Steward reads</div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>Emails with people already in your Steward</div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>Meetings where one of them is invited</div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>Who, when, the subject and what was said</div>
          </div>
          <div style={{ background: T.bg, borderRadius: 16, padding: 26, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...MAIN.label, color: T.ink3, fontWeight: 600 }}>What it never touches</div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>Anyone who isn't in Steward. Not even a count.</div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>Attachments. It notes that there were two.</div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>Sending, deleting or moving any email. It adds to your calendar only when you book a visit.</div>
          </div>
          <div style={{ gridColumn: "1 / -1", border: "1px solid " + T.bg2, borderRadius: 16, padding: "22px 26px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>You stay in charge</div>
            <div style={{ fontSize: 15, lineHeight: 1.55, color: T.ink3 }}>Keep a never-log list for family, your doctor, your own church. Hide any one email with a click. Pause whenever you like. Disconnect and everything already logged stays, or remove it all.</div>
          </div>
        </div>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        {connected && first && (
          <div data-testid="inbox-first-sync" style={{ flex: "2 1 520px", minWidth: 0, background: T.ink, color: T.inkInverse, borderRadius: 20, padding: "36px 40px", display: "flex", flexDirection: "column", gap: 24 }} className="inbox-first-sync">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontFamily: MAIN.serif, fontWeight: 400, fontSize: 32 }}>You're connected{me?.name ? `, ${String(me.name).split(" ")[0]}` : ""}.</h3>
              <span style={{ fontSize: 13, color: T.gold, letterSpacing: "0.08em", textTransform: "uppercase" }}>{syncedPhrase(mine[0]?.lastSyncedAt)}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
              {[[first.emails, "emails with people on file, last 2 years", "Emails logged from your inbox", "Every email with someone on file that your connected inbox logged in the last two years."],
                [first.meetings, "meetings on your calendar", "Meetings on your calendar", "Every meeting with someone on file on your connected calendar, from a month back to two months ahead."],
                [first.people, "people now have a history", "People who now have a history", "Each person on file with at least one email or meeting from your inbox or calendar in the last two years."]]
                .map(([f, words, label, def]) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontFamily: MAIN.serif, fontSize: 56, lineHeight: 1 }}><Figure value={f.value} kind="count" label={label} definition={def} source={f.source} variant="inline"/></span>
                    <span style={{ fontSize: 14, opacity: 0.7 }}>{words}</span>
                  </div>))}
            </div>
            {look.length > 0 && (
              <div style={{ borderTop: "1px solid rgba(240,237,230,0.15)", paddingTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ ...MAIN.label, opacity: 0.6 }}>Worth a look</div>
                {look.map(w => (
                  <div key={w.kind} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 15, flexWrap: "wrap" }}>
                    <span>{lookLine(w)}</span>
                    <DonorLink id={w.donorId} onOpen={onNavigate ? () => onNavigate("donors", { selectDonorId: w.donorId }) : undefined}
                      style={{ background: "none", border: "none", color: T.inkInverse, opacity: 0.7, cursor: "pointer", font: "inherit", padding: 0, textDecoration: "underline" }}>{w.action}</DonorLink>
                  </div>))}
              </div>
            )}
          </div>
        )}
        <div style={{ flex: "1 1 280px", minWidth: 0, background: T.white, borderRadius: 20, padding: 30, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...MAIN.label, color: T.ink3 }}>Your team</div>
          {(d.team || []).map((t, i) => (
            <div key={t.id} data-testid="inbox-team-row" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {i > 0 && <div style={{ height: 1, background: T.bg2, marginBottom: 14 }}/>}
              <span style={{ fontSize: 15, fontWeight: 600 }}>{t.name}{t.you ? " (you)" : ""}</span>
              <span style={{ fontSize: 14, color: T.ink3 }}>{t.connections.length
                ? t.connections.map(c => `${c.label}${c.paused ? ", paused" : c.broken ? ", needs reconnecting" : ""} · ${syncedPhrase(c.lastSyncedAt).replace(/^read /, "synced ")}`).join("; ")
                : "Not connected yet"}</span>
              {!t.connections.length && !t.you && <button type="button" onClick={() => teamLink(String(t.name).split(" ")[0])}
                style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 600, fontSize: 14, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>Copy a one-click link for {String(t.name).split(" ")[0]}</button>}
            </div>
          ))}
          {copied && <div style={{ fontSize: 12.5, color: T.ink3, overflowWrap: "anywhere" }}>{copied}</div>}
        </div>
      </section>

      {mine.some(p => !p.example) && <div style={card}><NeverLogList d={d} reload={load}/></div>}
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
