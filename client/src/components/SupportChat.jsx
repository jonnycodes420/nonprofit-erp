// SupportChat.jsx · SUPPORT-1. The help assistant, in the "?" panel and on the website.
//
// A short conversation. Each answer comes from Steward's own sources (help
// articles, the FAQ, the connections list) and, for a signed-in person, their
// own organization's facts, shown as they were read. Every answer cites its
// sources and ends with the screen to go to. "Talk to Jonathan" is always one
// tap away, and it is offered on its own when the assistant cannot answer, or
// the question is about money, billing, data, security or cancelling.
//
// It only reads. Nothing here changes anything in Steward; the screen button
// takes the person to where they do it themselves.
//
// `visitor`: the website. No sign-in, no org, and the hand-off asks for an
// email to reply to. `send(path, body)` is the caller's fetch, so the app
// passes apiFetch and the site passes its own.
import { useState, useRef, useEffect } from "react";

// The T tokens (shared.jsx), by value, so the website can use this file without the app's shared module.
const C = { ink: "#0f1a12", ink3: "#5a554f", white: "#ffffff", cream: "#f0ede6", line: "#d4cfc6", green: "#0d5c3a", brass: "#c9a84c" };
const btn = { background: C.white, border: "1px solid " + C.line, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 700, color: C.ink, cursor: "pointer", fontFamily: "inherit" };
const primary = { ...btn, background: C.green, borderColor: C.green, color: C.white };
const label = { fontSize: 11, color: C.ink3, fontWeight: 700 };

export function SupportChat({ visitor = false, screen = null, send, onOpenRoute, onOpenArticle, page = null }) {
  const [turns, setTurns] = useState([]);        // { role, text, reply? }
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hand, setHand] = useState({ open: false, email: "", name: "", sent: "", reason: null, error: "" });
  const end = useRef(null);
  useEffect(() => { if ((turns.length || hand.open) && end.current && end.current.scrollIntoView) end.current.scrollIntoView({ block: "nearest" }); }, [turns.length, hand.open, hand.sent]);

  const history = list => list.map(t => ({ role: t.role, text: t.text }));
  const askIt = async e => {
    e && e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...turns, { role: "user", text }];
    setTurns(next); setDraft(""); setBusy(true);
    try {
      const r = await send(visitor ? "/support/site/chat" : "/support/chat", { messages: history(next), screen });
      setTurns(t => [...t, { role: "assistant", text: r.text || "", reply: r }]);
      if (r.handoff && r.handoff !== "not_covered" && !r.covered) setHand(h => ({ ...h, open: true, reason: r.handoff }));
    } catch (err) {
      setTurns(t => [...t, { role: "assistant", text: "That did not go through. Try again, or talk to Jonathan.", reply: { offerJonathan: true } }]);
    }
    setBusy(false);
  };
  const handOff = async e => {
    e && e.preventDefault();
    setHand(h => ({ ...h, error: "" }));
    try {
      const body = visitor
        ? { messages: history(turns.length ? turns : [{ role: "user", text: draft || "I'd like to talk to someone." }]), email: hand.email, name: hand.name, page }
        : { messages: history(turns.length ? turns : [{ role: "user", text: draft || "I'd like to talk to someone." }]), screen, reason: hand.reason };
      const r = await send(visitor ? "/support/site/handoff" : "/support/handoff", body);
      setHand(h => ({ ...h, open: false, sent: r.sentence || "Sent to Jonathan." }));
    } catch (err) {
      setHand(h => ({ ...h, error: (err && err.message) || "That did not send. Write to jonathan@stewardapp.dev." }));
    }
  };

  return (
    <div data-testid="support-chat" style={{ background: C.white, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={label}>Ask Steward</span>
        <button type="button" data-testid="talk-to-jonathan" onClick={() => setHand(h => ({ ...h, open: true }))} style={{ ...btn, padding: "5px 10px" }}>Talk to Jonathan</button>
      </div>
      {!turns.length && <div style={{ fontSize: 13, color: C.ink3, lineHeight: 1.5 }}>
        {visitor
          ? "Ask how Steward works. Answers come from the help center and this site, and a person is one tap away."
          : "Ask how to do something, or why something looks wrong. Answers come from Steward's help and what Steward can see in your organization. It never changes anything."}
      </div>}
      <div role="log" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.map((t, i) => t.role === "user"
          ? <div key={i} style={{ alignSelf: "flex-end", maxWidth: "88%", background: C.cream, borderRadius: 12, padding: "8px 12px", fontSize: 14, color: C.ink, whiteSpace: "pre-wrap" }}>{t.text}</div>
          : <Answer key={i} r={t.reply || {}} text={t.text} visitor={visitor} onOpenRoute={onOpenRoute} onOpenArticle={onOpenArticle} onJonathan={() => setHand(h => ({ ...h, open: true, reason: (t.reply && t.reply.handoff) || h.reason }))} />)}
        {busy && <div style={{ fontSize: 13, color: C.ink3 }}>Looking it up…</div>}
      </div>
      {hand.sent && <div role="status" data-testid="handoff-sent" style={{ fontSize: 14, color: C.ink, background: C.cream, borderRadius: 10, padding: "10px 12px" }}>{hand.sent}</div>}
      {hand.open && !hand.sent && <form onSubmit={handOff} data-testid="handoff-form" style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid " + C.line, borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.5 }}>
          Jonathan built Steward and reads every one of these himself. He gets this whole conversation{visitor ? "" : ", the screen you are on and your organization's name"}, never your donors.
        </div>
        {visitor && <>
          <input value={hand.name} onChange={e => setHand(h => ({ ...h, name: e.target.value }))} placeholder="Your name" aria-label="Your name" style={field} />
          <input value={hand.email} onChange={e => setHand(h => ({ ...h, email: e.target.value }))} placeholder="Your email, for his reply" aria-label="Your email" type="email" required style={field} />
        </>}
        {!turns.length && <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder="What do you need?" aria-label="What do you need" style={{ ...field, resize: "vertical" }} />}
        {hand.error && <div role="alert" style={{ fontSize: 13, color: C.ink }}>{hand.error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" style={primary} disabled={visitor && !hand.email.trim()}>Send to Jonathan</button>
          <button type="button" onClick={() => setHand(h => ({ ...h, open: false }))} style={{ ...btn, border: "none" }}>Not now</button>
        </div>
      </form>}
      <form onSubmit={askIt} style={{ display: "flex", gap: 8 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={turns.length ? "Ask a follow-up" : "How do I…"} aria-label="Ask a question"
          data-testid="support-input" style={{ ...field, flex: 1, minWidth: 0 }} />
        <button type="submit" disabled={busy || !draft.trim()} style={primary}>{busy ? "…" : "Ask"}</button>
      </form>
      <div ref={end} />
    </div>
  );
}

const field = { border: "1px solid " + C.line, borderRadius: 8, padding: "9px 10px", fontSize: 14, fontFamily: "inherit", color: C.ink, background: C.white };

function Answer({ r, text, visitor, onOpenRoute, onOpenArticle, onJonathan }) {
  const facts = r.facts || [];
  return (
    <div data-testid="support-answer" data-mode={r.mode || ""} style={{ alignSelf: "stretch", fontSize: 14, color: C.ink, lineHeight: 1.55 }}>
      {facts.length > 0 && <div data-testid="support-facts" style={{ borderLeft: "3px solid " + C.brass, padding: "4px 0 4px 10px", marginBottom: 8 }}>
        <div style={{ ...label, marginBottom: 2 }}>In your organization</div>
        {facts.map((f, i) => <div key={i} style={{ color: C.ink }}>{f}</div>)}
      </div>}
      <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
      {r.aiOff && <div style={{ fontSize: 12, color: C.ink3, marginTop: 4 }}>AI is off, so this is the help article's own words.</div>}
      {(r.citations || []).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: C.ink3 }}>From</span>
        {r.citations.map(c => {
          const slug = c.link.startsWith("/help/") ? c.link.slice(6) : null;
          const name = c.title + (c.heading && c.source !== "help" && c.source !== "helpdoc" ? ": " + c.heading : "");
          return slug && onOpenArticle
            ? <button type="button" key={c.id} onClick={() => onOpenArticle(slug)} style={{ ...btn, padding: "3px 8px", fontSize: 12, fontWeight: 600 }}>{name}</button>
            : <a key={c.id} href={c.link} target={visitor ? undefined : "_blank"} rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, color: C.green }}>{name}</a>;
        })}
      </div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {r.screen && onOpenRoute && <button type="button" data-testid="support-screen" onClick={() => onOpenRoute(r.screen.route)} style={primary}>{r.screen.label}</button>}
        {r.offerJonathan && <button type="button" onClick={onJonathan} style={btn}>Talk to Jonathan</button>}
      </div>
    </div>
  );
}

export default SupportChat;
