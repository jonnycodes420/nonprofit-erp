// ONBOARD-2 · HOME → "GETTING SET UP". The customer's side of the onboarding
// board: the same five stages, in her words, each step with one button. It
// shows on Home until the first month is done, and Settings → Account keeps it
// (`always`). The kickoff step opens "Who to call tomorrow": the first five
// people on her moves, each with the last gift and why, and "Log the call".
// Every done-state comes from GET /onboarding/mine, computed from what really
// happened; nothing here can tick a step.
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

const LogConversationModal = lazy(() => import("../LogConversation").then(m => ({ default: m.LogConversationModal })));
const SERIF = "'DM Serif Display',Georgia,serif";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
// "$250" for whole dollars, "$4,506.60" otherwise (never "$4,506.6").
const usd = c => { const n = Number(c || 0); return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };
const withDates = s => String(s || "").replace(/(\d{4}-\d{2}-\d{2})/g, (_, d) => dayWords(d));

export { useOnboarding } from "./useOnboarding";

function Track({ stages }) {
  return <ol aria-label="Your five stages" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
    {stages.map(s => <li key={s.id} data-onb-stage={s.id} data-done={s.done ? "1" : "0"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: s.done ? T.ink3 : T.ink,
        padding: "4px 10px", borderRadius: 999, background: s.done ? T.bg2 : T.white, border: "1px solid " + T.bg3 }}>
      <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: s.done ? T.greenDk : "transparent", border: "1.5px solid " + T.greenDk }} />
      {s.title}</li>)}
  </ol>;
}

export function KickoffView({ onNavigate, onLogged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [logFor, setLogFor] = useState(null);
  const [logged, setLogged] = useState({});
  useEffect(() => { apiFetch("/onboarding/kickoff").then(setD).catch(e => setErr((e && e.message) || "Your list could not be read. Try again in a minute.")); }, []);
  if (err) return <p role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</p>;
  if (!d) return <p style={{ fontSize: 13, color: T.ink3 }}>Reading your list…</p>;
  if (d.preparing) return <p style={{ fontSize: 13, color: T.ink3 }}>Steward is still reading your donors. Your list will be here in a few minutes.</p>;
  if (!d.people.length) return <p style={{ fontSize: 13, color: T.ink3 }}>Nobody is on your moves yet. Once your import is in, the people to call come here.</p>;
  return <section data-testid="onb-kickoff" aria-label="Who to call tomorrow" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <h3 style={{ margin: "4px 0 2px", fontFamily: SERIF, fontWeight: 400, fontSize: 21, color: T.ink }}>Who to call tomorrow</h3>
    <p style={{ margin: "0 0 6px", fontSize: 12.5, color: T.ink3 }}>{d.sentence}</p>
    {d.people.map(p => <div key={p.id} data-testid="onb-kickoff-person" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <button type="button" onClick={() => onNavigate && onNavigate("donors", { selectDonorId: p.id })}
          style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: T.ink, textAlign: "left" }}>{p.name}</button>
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>
          {p.lastGift ? `Last gift ${usd(p.lastGift.cents)} on ${dayWords(p.lastGift.date)}` : "No gift on file"}{p.label ? ` · ${p.label}` : ""}</div>
        {p.why && <div style={{ fontSize: 13, color: T.ink, marginTop: 4, lineHeight: 1.45 }}><b>Why:</b> {p.why}</div>}
      </div>
      {logged[p.id] ? <span style={{ fontSize: 13, fontWeight: 700, color: T.greenDk, padding: "8px 0" }}>Logged ✓</span>
        : <button type="button" data-testid="onb-log-call" onClick={() => setLogFor(p)}
          style={{ background: T.greenDk, color: T.white, border: 0, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 36 }}>Log the call</button>}
    </div>)}
    {logFor && <Suspense fallback={null}><LogConversationModal donor={{ id: logFor.id, name: logFor.name }} fromMove onNavigate={onNavigate}
      onSaved={() => { setLogged(l => ({ ...l, [logFor.id]: true })); onLogged && onLogged(); }} onClose={() => setLogFor(null)} /></Suspense>}
  </section>;
}

// `data` is GET /onboarding/mine. `onHome` records that Home was opened (once).
export default function GettingSetUp({ data, onNavigate, onHome = false, always = false, onReload = null }) {
  const [kick, setKick] = useState(() => !!(data && data.stage === "kickoff"));   // the kickoff stage opens the list
  const told = useRef(false);
  useEffect(() => {
    if (!onHome || !data || !data.tracked || data.homeOpened || told.current) return;
    told.current = true;
    apiFetch("/onboarding/home-opened", { method: "POST", body: "{}" }).catch(() => {});
  }, [onHome, data]);
  if (!data || !data.tracked || (!data.show && !always)) return null;
  const go = s => { if (s.go[0] === "kickoff") return setKick(k => !k); onNavigate && onNavigate(s.go[0], s.go[1]); };
  const next = data.steps.find(s => !s.done);
  return <section data-testid="home-getting-set-up" aria-label="Getting set up"
    style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 24, fontWeight: 400, color: T.ink }}>Getting set up</h2>
      <span style={{ fontSize: 13, color: T.ink3 }}>{data.show ? `${data.doneCount} of ${data.totalCount} done` : "All done: you're billing and Steward is yours."}</span>
    </div>
    <Track stages={data.stages} />
    <div>
      {data.steps.map(s => <div key={s.id} data-testid="onb-step" data-step={s.id} data-done={s.done ? "1" : "0"}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
        <span aria-hidden style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11,
          background: s.done ? T.green600 : "transparent", color: T.white, border: s.done ? 0 : "1.5px solid " + T.bg3 }}>{s.done ? "✓" : ""}</span>
        <span style={{ flex: 1, minWidth: 180, fontSize: 13.5, fontWeight: s === next ? 700 : 600, color: s.done ? T.ink3 : T.ink }}>{withDates(s.words)}</span>
        {(!s.done || s.id === "kickoff") && <button type="button" data-testid={`onb-go-${s.id}`} onClick={() => go(s)}
          style={{ background: s === next ? T.greenDk : "none", color: s === next ? T.white : T.greenDk, border: s === next ? 0 : "1px solid " + T.bg3,
            borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 32 }}>
          {s.id === "kickoff" && kick ? "Hide the list" : s.button}{s.go[0] === "kickoff" ? "" : " →"}</button>}
      </div>)}
    </div>
    {kick && <KickoffView onNavigate={onNavigate} onLogged={onReload} />}
  </section>;
}
