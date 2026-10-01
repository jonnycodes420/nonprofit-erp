// HelpPanel.jsx — HELP-1. The "?" on every page.
//
// Opens beside the page, without leaving it, on the article for the screen
// the person is on. Ask Steward sits at the top and answers only from the
// help articles; when they do not cover it, "Ask a person" sends a ticket
// with the screen and the browser attached, and never any donor data.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { HELP_ARTICLES } from "../../../shared/helpArticles.js";
import { searchArticles } from "../../../shared/helpSearch.js";

const box = { background: T.white, borderRadius: 14, padding: "14px 16px" };
const label = { fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 };
const btn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const primary = { ...btn, background: T.greenDk, borderColor: T.greenDk, color: T.white };

export function articleForScreen(screen) {
  const s = String(screen || "");
  return HELP_ARTICLES.find(a => (a.screens || []).includes(s))
    || HELP_ARTICLES.find(a => (a.screens || []).includes(s.split(":")[0]))
    || null;
}

export function Article({ a, onFeedback }) {
  const [voted, setVoted] = useState(null);
  if (!a) return null;
  const vote = v => { setVoted(v); apiFetch("/help/feedback", { method: "POST", body: JSON.stringify({ slug: a.slug, helpful: v }) }).catch(() => {}); onFeedback && onFeedback(v); };
  return (
    <div data-testid="help-article" data-slug={a.slug}>
      <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 24, color: T.ink, lineHeight: 1.15 }}>{a.title}</div>
      {a.summary && <div style={{ fontSize: 14, color: T.ink3, margin: "6px 0 12px", lineHeight: 1.5 }}>{a.summary}</div>}
      {(a.sections || []).map((s, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          {s.h && <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{s.h}</div>}
          {(s.p || []).map((p, k) => <p key={k} style={{ fontSize: 14, color: T.ink2, lineHeight: 1.55, margin: "0 0 6px" }}>{p}</p>)}
          {s.steps && <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: T.ink2, lineHeight: 1.55 }}>{s.steps.map((st, k) => <li key={k}>{st}</li>)}</ol>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink3, marginTop: 6 }}>
        {voted === null ? <>Did this help?
          <button type="button" onClick={() => vote(true)} style={btn}>Yes</button>
          <button type="button" onClick={() => vote(false)} style={btn}>No</button></>
          : <span>Thank you.{voted ? "" : " Ask a person below and we will help."}</span>}
      </div>
    </div>
  );
}

export function HelpPanel({ screen, onClose }) {
  const [current, setCurrent] = useState(() => articleForScreen(screen));
  const [query, setQuery] = useState("");
  const [ask, setAsk] = useState(null);
  const [asking, setAsking] = useState(false);
  const [settings, setSettings] = useState({ replyPromise: "within one business day" });
  const [ticket, setTicket] = useState({ open: false, body: "", sent: "" });
  useEffect(() => { apiFetch("/help/settings").then(setSettings).catch(() => {}); }, []);
  const results = query.trim() ? searchArticles(HELP_ARTICLES, query, 6) : [];
  const doAsk = async e => {
    e.preventDefault(); if (!query.trim()) return;
    setAsking(true); setAsk(null);
    try { setAsk(await apiFetch("/help/ask", { method: "POST", body: JSON.stringify({ question: query, screen }) })); }
    catch { setAsk({ covered: false, sentence: "Ask Steward did not answer. Try again, or ask a person." }); }
    setAsking(false);
  };
  const sendTicket = async e => {
    e.preventDefault();
    try { const r = await apiFetch("/help/tickets", { method: "POST", body: JSON.stringify({ body: ticket.body, screen }) }); setTicket({ open: false, body: "", sent: r.sentence }); }
    catch (err) { setTicket(t => ({ ...t, sent: err?.message || "That did not send." })); }
  };
  return (
    <div role="dialog" aria-label="Help" data-testid="help-panel" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.35)", zIndex: 400, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(460px,100%)", height: "100%", overflowY: "auto", background: T.bg, padding: "20px 20px 40px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={label}>Help</span>
          <button type="button" onClick={onClose} aria-label="Close help" style={{ background: "none", border: "none", fontSize: 22, color: T.ink3, cursor: "pointer" }}>×</button>
        </div>
        <form onSubmit={doAsk} style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={label}>Ask Steward</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="How do I…" aria-label="Ask a question"
              style={{ flex: 1, minWidth: 0, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 10px", fontSize: 14, fontFamily: "inherit" }} />
            <button type="submit" disabled={asking || !query.trim()} style={primary}>{asking ? "…" : "Ask"}</button>
          </div>
          <span style={{ fontSize: 12, color: T.ink3 }}>Answers come only from these help articles. Ask Steward never sees your donors and never changes anything.</span>
          {ask && <div data-testid="help-answer" style={{ fontSize: 14, color: T.ink, lineHeight: 1.55 }}>
            {ask.answer && <div style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{ask.answer}</div>}
            {ask.sentence && <div style={{ color: T.ink3 }}>{ask.sentence}</div>}
            {(ask.articles || []).map(a => <button type="button" key={a.slug} onClick={() => { setCurrent(HELP_ARTICLES.find(x => x.slug === a.slug)); setAsk(null); }}
              style={{ ...btn, display: "block", marginTop: 6, textAlign: "left", fontWeight: 600 }}>{a.title}</button>)}
            {!ask.covered && <button type="button" onClick={() => setTicket(t => ({ ...t, open: true, body: query }))} style={{ ...primary, marginTop: 8 }}>Ask a person</button>}
          </div>}
          {!ask && results.length > 0 && <div>{results.map(a => <button type="button" key={a.slug} onClick={() => setCurrent(a)}
            style={{ ...btn, display: "block", width: "100%", marginTop: 6, textAlign: "left", fontWeight: 600 }}>{a.title}</button>)}</div>}
        </form>
        <div style={box}>
          {current ? <Article a={current} /> : <div style={{ fontSize: 14, color: T.ink3 }}>There is no article for this screen yet. Ask Steward above, or ask a person.</div>}
        </div>
        <div style={box}>
          <span style={label}>Ask a person</span>
          <div style={{ fontSize: 13, color: T.ink3, margin: "6px 0 8px" }}>A person reads every message and replies {settings.replyPromise}. We see the screen you are on and your browser, never your donors.</div>
          {ticket.sent && <div role="status" style={{ fontSize: 13, color: T.ink, marginBottom: 6 }}>{ticket.sent}</div>}
          {ticket.open ? <form onSubmit={sendTicket} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea value={ticket.body} onChange={e => setTicket(t => ({ ...t, body: e.target.value }))} rows={4} aria-label="Your question"
              style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: 10, fontSize: 14, fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8 }}><button type="submit" disabled={!ticket.body.trim()} style={primary}>Send</button>
              <button type="button" onClick={() => setTicket(t => ({ ...t, open: false }))} style={{ ...btn, border: "none" }}>Cancel</button></div>
          </form> : <button type="button" onClick={() => setTicket(t => ({ ...t, open: true }))} style={btn}>Write to us</button>}
        </div>
        <a href={current ? `/help/${current.slug}` : "/help"} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: T.greenDk }}>Open the help centre</a>
      </div>
    </div>
  );
}

export default HelpPanel;
