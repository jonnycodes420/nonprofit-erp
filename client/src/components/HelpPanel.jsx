// HelpPanel.jsx — HELP-1. The "?" on every page.
//
// Opens beside the page, without leaving it, on the article for the screen
// the person is on. SUPPORT-1: the help assistant sits at the top. It answers
// from Steward's own sources and this organization's own facts, cites them,
// ends on the screen to go to, and "Talk to Jonathan" is one tap. It only
// reads; the screen button takes the person where they do it themselves.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { T } from "./shared";
import { HELP_ARTICLES } from "../../../shared/helpArticles.js";
import { HELP_DOCS } from "../../../shared/helpDocs.js";
import { SupportChat } from "./SupportChat";

// Every article the help center has: HELP-1's, and SUPPORT-1's written in docs/help.
export const ALL_ARTICLES = [...HELP_ARTICLES, ...HELP_DOCS];

const box = { background: T.white, borderRadius: 14, padding: "14px 16px" };
const label = { fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 };
const btn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" };

// The article written for exactly this screen wins over one that covers it
// along with others (Auctions has its own now, beside Fundraising's).
export function articleForScreen(screen) {
  const s = String(screen || "");
  return HELP_DOCS.find(a => (a.screens || []).includes(s))
    || HELP_ARTICLES.find(a => (a.screens || []).includes(s))
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
          : <span>Thank you.{voted ? "" : " Ask above, or talk to Jonathan, and we will help."}</span>}
      </div>
    </div>
  );
}

export function HelpPanel({ screen, onClose }) {
  const [current, setCurrent] = useState(() => articleForScreen(screen));
  const navigate = useNavigate();
  const send = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  const openRoute = route => { onClose && onClose(); navigate(route); };
  const openArticle = slug => setCurrent(ALL_ARTICLES.find(a => a.slug === slug) || current);
  return (
    <div role="dialog" aria-label="Help" data-testid="help-panel" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.35)", zIndex: 400, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(460px,100%)", height: "100%", overflowY: "auto", background: T.bg, padding: "20px 16px 40px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={label}>Help</span>
          <button type="button" onClick={onClose} aria-label="Close help" style={{ background: "none", border: "none", fontSize: 22, color: T.ink3, cursor: "pointer" }}>×</button>
        </div>
        <SupportChat screen={screen} send={send} onOpenRoute={openRoute} onOpenArticle={openArticle} />
        <div style={box}>
          {current ? <Article a={current} /> : <div style={{ fontSize: 14, color: T.ink3 }}>There is no article for this screen yet. Ask above, or talk to Jonathan.</div>}
        </div>
        <a href={current ? `/help/${current.slug}` : "/help"} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: T.greenDk }}>Open the help center</a>
      </div>
    </div>
  );
}

export default HelpPanel;
