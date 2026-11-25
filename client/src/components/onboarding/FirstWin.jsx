// ONBOARD-3 · HOME'S FIRST SCREEN AFTER ONBOARDING. Loaded only when
// /org/setup-status says `firstWin` (so every other org's Home is unchanged):
//   "totals"   the totals check is due: Home sends her to /onboard/totals first
//   "first"    Your first 30 minutes: three steps on one screen
//   "readout"  the day-30 readout (DayThirty.jsx)
// Every done-state comes from the server, computed from what really happened.
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

const LogConversationModal = lazy(() => import("../LogConversation").then(m => ({ default: m.LogConversationModal })));
const HomeOnboarding = lazy(() => import("./HomeOnboarding"));
const DayThirty = lazy(() => import("./DayThirty"));
const SERIF = "'DM Serif Display',Georgia,serif";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const usd = c => { const n = Number(c || 0); return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };
const btn = primary => ({ background: primary ? T.greenDk : "none", color: primary ? T.white : T.greenDk, border: primary ? 0 : "1px solid " + T.bg3,
  borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 36 });

function Tick({ done, n }) {
  return <span aria-hidden style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
    background: done ? T.green600 : "transparent", color: done ? T.white : T.ink, border: done ? 0 : "1.5px solid " + T.bg3 }}>{done ? "✓" : n}</span>;
}
function Step({ n, step, title, children }) {
  return <section data-testid="fs-step" data-step={step.id} data-done={step.done ? "1" : "0"} style={{ borderTop: "1px solid " + T.bg2, padding: "14px 0", display: "flex", gap: 12, alignItems: "flex-start" }}>
    <Tick done={step.done} n={n} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <h3 style={{ margin: "1px 0 6px", fontSize: 16, fontWeight: 700, color: T.ink }}>{title}</h3>
      {children}
    </div>
  </section>;
}
function Conn({ name, c, focus, onNavigate }) {
  const on = c.state === "connected";
  return <div data-testid={`fs-conn-${focus}`} data-state={c.state} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "4px 0" }}>
    <span style={{ fontWeight: 700, fontSize: 14, minWidth: 90 }}>{name}</span>
    <span style={{ flex: "1 1 200px", fontSize: 13, color: on ? T.greenDk : T.ink2 }}>{c.words}</span>
    {!on && <button type="button" style={btn(false)} onClick={() => onNavigate && onNavigate("settings", { section: "connections", focus })}>{c.state === "started" ? `Finish ${name}` : `Connect ${name}`} →</button>}
  </div>;
}

export function FirstSession({ onNavigate, onClosed }) {
  const [d, setD] = useState(null);
  const [n, setN] = useState(0);
  const [logFor, setLogFor] = useState(null);
  const [hidden, setHidden] = useState(false);
  const told = useRef(false);
  useEffect(() => { apiFetch("/onboard/first-session").then(setD).catch(() => setD({ show: false })); }, [n]);
  useEffect(() => {
    if (d && d.show && !d.dismissed && d.people && d.people.length && !d.steps[0].done && !told.current) {
      told.current = true;
      apiFetch("/onboard/first-session/seen", { method: "POST", body: "{}" }).then(() => setN(x => x + 1)).catch(() => {});
    }
  }, [d]);
  if (!d || !d.show || hidden) return null;
  const post = what => apiFetch(`/onboard/first-session/${what}`, { method: "POST", body: "{}" }).catch(() => {});
  if (d.dismissed) {
    return <div data-testid="fs-collapsed" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontFamily: SERIF, fontSize: 18, color: T.ink }}>Your first 30 minutes</span>
      <span style={{ fontSize: 13, color: T.ink3, flex: 1 }}>{d.doneCount} of 3 done</span>
      <button type="button" data-testid="fs-reopen" style={btn(true)} onClick={async () => { await post("reopen"); setN(x => x + 1); }}>Open</button>
    </div>;
  }
  if (d.allDone) {
    return <section data-testid="fs-done" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 20px" }}>
      <h2 style={{ margin: "0 0 6px", fontFamily: SERIF, fontSize: 24, fontWeight: 400, color: T.ink }}>That's your first 30 minutes done.</h2>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: T.ink2 }}>
        {d.touch && d.touch.by ? `${d.touch.by} logged a touch` : "A touch is logged"}, gifts have a way in, and you know who to call before {dayWords(d.deadline.day)}. Home is yours from here.</p>
      <button type="button" data-testid="fs-done-ok" style={btn(true)} onClick={async () => { await post("told"); setHidden(true); onClosed && onClosed(); }}>Back to Home</button>
    </section>;
  }
  const [s1, s2, s3] = d.steps;
  return <section data-testid="home-first-session" aria-label="Your first 30 minutes"
    style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 20px" }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: T.ink }}>Your first 30 minutes</h2>
      <span style={{ fontSize: 13, color: T.ink3, flex: 1 }}>{d.doneCount} of 3 done</span>
      <button type="button" data-testid="fs-dismiss" onClick={async () => { await post("dismiss"); setN(x => x + 1); }}
        style={{ background: "none", border: 0, color: T.ink3, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Not now</button>
    </div>
    <Step n={1} step={s1} title={`People worth a call before ${dayWords(d.deadline.day)}`}>
      <p style={{ margin: "0 0 6px", fontSize: 12.5, color: T.ink3 }}>{d.sentence}{d.deadline.why !== "December 31" ? ` ${dayWords(d.deadline.day)} is ${d.deadline.why}.` : ""}</p>
      {d.preparing ? <p style={{ fontSize: 13, color: T.ink3, margin: 0 }}>Steward is still reading your donors. The list will be here in a few minutes.</p>
        : !d.people.length ? <p style={{ fontSize: 13, color: T.ink3, margin: 0 }}>Nobody is on your moves yet, so nobody is waiting on a call. Steward will list them here as your giving comes in.</p>
          : <ol data-testid="fs-people" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {d.people.map(p => <li key={p.id} data-testid="fs-person" data-id={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <button type="button" onClick={() => onNavigate && onNavigate("donors", { selectDonorId: p.id })}
                  style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: T.ink, textAlign: "left" }}>{p.name}</button>
                {p.why && <div style={{ fontSize: 13, color: T.ink, marginTop: 2, lineHeight: 1.45 }}>{p.why}</div>}
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{p.lastGift ? `Last gift ${usd(p.lastGift.cents)} on ${dayWords(p.lastGift.date)}` : "No gift on file"}</div>
              </div>
              <button type="button" data-testid="fs-log" style={btn(!s3.done)} onClick={() => setLogFor(p)}>Log a touch</button>
            </li>)}
          </ol>}
    </Step>
    <Step n={2} step={s2} title="Connect how gifts come in">
      <Conn name="Stripe" c={d.connections.stripe} focus="stripe" onNavigate={onNavigate} />
      <Conn name="QuickBooks" c={d.connections.quickbooks} focus="quickbooks" onNavigate={onNavigate} />
    </Step>
    <Step n={3} step={s3} title="Make one call or write one note now">
      <p style={{ margin: 0, fontSize: 13.5, color: T.ink2 }}>{s3.done
        ? `Done${d.touch && d.touch.by ? `: ${d.touch.by} logged a touch` : ""} on ${dayWords(String(d.touch && d.touch.at || "").slice(0, 10))}.`
        : "Pick anyone on the list above, make the call or write the note, then press Log a touch beside their name."}</p>
    </Step>
    {logFor && <Suspense fallback={null}><LogConversationModal donor={{ id: logFor.id, name: logFor.name }} fromMove onNavigate={onNavigate}
      onSaved={() => setN(x => x + 1)} onClose={() => setLogFor(null)} /></Suspense>}
  </section>;
}

export default function FirstWin({ kind, onb, onNavigate }) {
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (kind === "totals") window.location.replace("/onboard/totals"); }, [kind]);
  if (kind === "totals") return null;
  const below = onb ? <Suspense fallback={null}><HomeOnboarding onNavigate={onNavigate} /></Suspense> : null;
  if (kind === "readout") return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}><Suspense fallback={null}><DayThirty onNavigate={onNavigate} /></Suspense>{below}</div>;
  // ONBOARD-4: in onboarding, the first 30 minutes is step 3 of the guided setup, opened on it; not a second card.
  if (onb) return <Suspense fallback={null}><HomeOnboarding onNavigate={onNavigate} prefer="call" /></Suspense>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    {!closed && <FirstSession onNavigate={onNavigate} onClosed={() => setClosed(true)} />}
    {below}
  </div>;
}
