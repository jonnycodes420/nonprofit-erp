// HONEST-1 · what a connection's one status (`flow`, server/connections/status.js) looks like on a
// screen. The Settings badge and line, the summary over the page, Home's lines and Finance's
// QuickBooks line all draw from here, so the words cannot drift apart. Nothing here decides a state.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { Figure } from "../Figure";
import { errorMessage } from "../../lib/domainError";

// The badge word for a card. `flow` cards (every API connection) use the flow's own label; the
// page's other cards (inbox, BCC, keys) keep their words.
export const FLOW_WORD = { working: "Working", waiting: "Connected, nothing flowing yet", needs_you: "Needs you",
  not_connected: "Not connected", unavailable: "Not available yet", example: "Example",   // HONEST-2: a demo's made-up connection
  connected: "Connected", attention: "Needs attention", ready: "Ready" };
// The summary line's three buckets.
export const bucketOf = s => s === "needs_you" || s === "attention" ? "needs_you"
  : s === "waiting" ? "waiting" : s === "working" || s === "connected" || s === "ready" ? "working" : "off";
export const isBrass = s => bucketOf(s) === "needs_you";

// One flow sentence, with its figure opening the rows when it carries one (QuickBooks' waiting gifts).
export function FlowSentence({ flow, style }) {
  if (!flow) return null;
  const f = flow.figure;
  if (!f || !f.source) return <span style={style}>{flow.sentence}</span>;
  // "273 gifts ($261,998.91) are waiting: …" — the amount is the figure, and it opens the 273 rows.
  const m = /^(.*?)\((\$[\d,]+\.\d\d)\)(.*)$/.exec(flow.sentence);
  if (!m) return <span style={style}>{flow.sentence}</span>;
  return <span style={style}>{m[1]}(<Figure variant="inline" kind="money" value={f.value} figureKey="connection-waiting"
    label="Waiting to go to QuickBooks" source={f.source}
    definition="Every gift dated on or after the QuickBooks start date that has not been sent to QuickBooks or skipped. Real money only." />){m[3]}</span>;
}

// "Bring in a file": a tool with no account to connect. One row, one Upload button (ONBOARD-5's words).
export function FileRow({ card, onUpload, canPress }) {
  return (
    <div data-testid="file-row" data-key={card.key} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
      background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: "12px 16px", minWidth: 0 }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{card.name}</div>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{card.line}</div>
        {/* POLISH-15 item 5: a file row's own fact (Statement imports: its last file) under what it is */}
        {card.reason && <div data-testid="file-row-last" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>{card.reason}</div>}
      </div>
      {canPress && <button type="button" data-testid="file-upload" onClick={onUpload}
        style={{ background: T.white, color: T.ink, border: "1px solid " + T.ink, borderRadius: 9, padding: "7px 14px",
          fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
        aria-busy={card.button && card.button.label === "Opening…" ? "true" : undefined}>{(card.button && card.button.label === "Opening…") ? "Opening…" : "Upload"}</button>}
    </div>);
}

// "Not available yet. Tell us you need it": one line, a POST that records the ask for /ops.
export function UnavailableLine({ card, canPress }) {
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try { const r = await apiFetch("/connections/ask", { method: "POST", body: JSON.stringify({ provider: card.provider }) }); setSaid(r.sentence); }
    catch (e) { setSaid(errorMessage(e, "That did not go through. Try again in a minute.")); }
    setBusy(false);
  };
  return (
    <div data-testid="conn-unavailable" data-key={card.key} style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
      <strong style={{ color: T.ink }}>{card.name}</strong>: not available yet.{" "}
      {said ? <span role="status" style={{ color: T.ink }}>{said}</span>
        : canPress && <button type="button" data-testid="conn-ask" disabled={busy} onClick={ask}
          style={{ background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, fontWeight: 700,
            textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>Tell us you need it</button>}
    </div>);
}

// HONEST-2 item 1: a surface outside Connections that names a connection's state (Finance's Money in,
// the Stripe payments panel) shows the card's own flow word, never a "Connected" of its own.
export function FlowWord({ kind = null, provider = null, fallback = "", style, testid = "flow-word" }) {
  const [card, setCard] = useState(undefined);
  useEffect(() => { apiFetch("/connections").then(r => setCard((r.cards || []).find(c => (kind ? c.kind === kind : c.provider === provider)) || null)).catch(() => setCard(null)); }, [kind, provider]);
  const word = card && card.flow ? card.flow.label : fallback;
  if (!word) return null;
  return <span data-testid={testid} data-state={card && card.flow ? card.flow.state : ""} title={card && card.flow ? card.flow.sentence : undefined} style={style}>{word}</span>;
}

// Home and Finance: the connections a person has to act on, from the same GET /connections the
// Settings page reads. `providers` limits it (Finance shows QuickBooks only); `states` says which.
export function ConnectionLines({ onNavigate, providers = null, states = ["needs_you"], testid = "home-connection-line" }) {
  const [cards, setCards] = useState(null);
  useEffect(() => { apiFetch("/connections").then(r => setCards(r.cards || [])).catch(() => setCards([])); }, []);
  if (!cards) return null;
  const list = cards.filter(c => c.flow && states.includes(c.flow.state) && (!providers || providers.includes(c.provider)));
  if (!list.length) return null;
  return list.map(c => {
    const brass = c.flow.state === "needs_you";
    const step = c.flow.step && c.flow.step.to;
    return (
      <div key={c.id} data-testid={testid} data-provider={c.provider} data-state={c.flow.state}
        style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "10px 14px", borderRadius: 10,
          background: T.white, border: "1px solid " + (brass ? T.gold600 : T.bg2), margin: "8px 0" }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: brass ? T.gold600 : T.ink, flexShrink: 0 }} />
        <FlowSentence flow={c.flow} style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13.5, color: brass ? T.gold700 : T.ink, lineHeight: 1.5 }} />
        {step && onNavigate && <button type="button" data-testid={testid + "-step"}
          onClick={() => onNavigate("settings", { section: step.section, focus: step.focus })}
          style={{ background: T.white, color: T.ink, border: "1px solid " + T.ink, borderRadius: 9, padding: "6px 12px",
            fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{c.flow.step.label}</button>}
      </div>);
  });
}
