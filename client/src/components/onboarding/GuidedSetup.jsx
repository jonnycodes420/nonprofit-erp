// ONBOARD-4 item 4 · HOME'S GUIDED SETUP. Five steps, skippable and resumable,
// read from GET /onboarding/guided (server/onboard/guided.js). It is ONBOARD-2's
// "Getting set up" and ONBOARD-3's "Your first 30 minutes" in one card: step 3
// IS the first session, and Settings still shows the five onboarding stages.
// Nothing here can tick a step; a skip is the one thing she stores.
import { useEffect, useState, lazy, Suspense } from "react";
import { apiFetch, API, getToken } from "../../api";
import { T } from "../shared";

const FirstSession = lazy(() => import("./FirstWin").then(m => ({ default: m.FirstSession })));
const SERIF = "'DM Serif Display',Georgia,serif";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = v => { if (!v) return ""; const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const btn = primary => ({ background: primary ? T.greenDk : "none", color: primary ? T.white : T.greenDk, border: primary ? 0 : "1px solid " + T.bg3,
  borderRadius: 8, padding: "7px 13px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 34 });
const quiet = { background: "none", border: 0, color: T.ink3, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "4px 2px" };
const p13 = { margin: "0 0 8px", fontSize: 13.5, color: T.ink2, lineHeight: 1.5 };

function Part({ ok, label, says }) {
  return <div style={{ display: "flex", gap: 8, fontSize: 13.5, padding: "3px 0" }}>
    <span aria-hidden style={{ color: ok ? T.greenDk : T.ink3, fontWeight: 700, width: 14 }}>{ok ? "✓" : "•"}</span>
    <span><b>{label}:</b> {says}</span></div>;
}

function Way({ title, children, testid }) {
  return <div data-testid={testid} style={{ border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", background: T.white, display: "flex", flexDirection: "column", gap: 6 }}>
    <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: T.ink }}>{title}</h4>{children}</div>;
}

// A "Send it to us" job: Received, Being mapped, Ready for you to check, Loaded, each with its date.
function JobLine({ j }) {
  return <div data-testid="concierge-job" data-state={j.key} style={{ borderTop: "1px solid " + T.bg2, paddingTop: 6 }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{j.fileName}</div>
    <ol style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
      {j.steps.map(s => <li key={s.key} data-reached={s.at ? "1" : "0"} style={{ fontSize: 12.5, color: s.at ? T.ink : T.ink3, display: "flex", gap: 6 }}>
        <span aria-hidden style={{ width: 12, color: T.greenDk }}>{s.at ? "✓" : "○"}</span>{s.words}{s.at ? `, ${dayWords(s.at)}` : ""}</li>)}
    </ol>
    {j.undone && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: T.ink2 }}>The load was undone. Jonathan will load it again.</p>}
    {j.key === "ready" && <a href="/onboard/totals" style={{ fontSize: 13, fontWeight: 700, color: T.greenDk }}>Check the totals →</a>}
  </div>;
}

// Her own file again, to import it herself. A GET with her session; nothing changes.
async function download(b) {
  const r = await fetch(`${API}/onboarding/booking-file/${encodeURIComponent(b.bookingId)}`, { headers: { Authorization: `Bearer ${getToken()}` } }).catch(() => null);
  if (!r || !r.ok) return;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = b.fileName || "donors"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function SendToUs({ send, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const post = async (path, body) => {
    setBusy(true); setMsg("");
    try { await apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) }); setFile(null); onDone(); }
    catch (e) { setMsg((e && e.message) || "That did not go through. Try again in a minute."); }
    setBusy(false);
  };
  const upload = () => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => post("/onboarding/concierge", { fileName: file.name, fileType: file.type, data: String(r.result || "") });
    r.onerror = () => setMsg("That file could not be read. Try again.");
    r.readAsDataURL(file);
  };
  return <>
    <p style={{ ...p13, margin: 0 }}>Send us the file and we map it for you. Nothing goes in until a person presses Load, and you check the totals after.</p>
    {send.waiting.map(b => <div key={b.bookingId} data-testid="concierge-waiting" style={{ background: T.bg2, borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
      Your file from booking the call is here: <b>{b.fileName}</b>.
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" data-testid="concierge-send-booking" disabled={busy} style={btn(true)} onClick={() => post(`/onboarding/concierge/booking/${encodeURIComponent(b.bookingId)}`)}>Send this one</button>
        <button type="button" style={btn(false)} onClick={() => download(b)}>Download it</button>
      </div></div>)}
    {send.jobs.map(j => <JobLine key={j.id} j={j} />)}
    <label style={{ fontSize: 12.5, fontWeight: 600, color: T.ink2 }}>{send.jobs.length ? "Send another file" : "Your donor file"}
      <input type="file" data-testid="concierge-file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods" onChange={e => setFile(e.target.files && e.target.files[0])}
        style={{ display: "block", marginTop: 4, fontSize: 13, maxWidth: "100%" }} /></label>
    <div><button type="button" data-testid="concierge-send" disabled={!file || busy} style={btn(!!file)} onClick={upload}>{busy ? "Sending…" : "Send it to us"}</button></div>
    {msg && <p role="alert" style={{ fontSize: 13, color: T.ink, margin: 0 }}>{msg}</p>}
  </>;
}

function Body({ s, onNavigate, reload }) {
  const go = (tab, opts) => onNavigate && onNavigate(tab, opts);
  if (s.id === "yours") return <>
    {s.parts.map(p => <Part key={p.key} {...p} />)}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      <button type="button" style={btn(true)} onClick={() => go("settings", { section: "brandkit" })}>Logo and colors →</button>
      <button type="button" style={btn(false)} onClick={() => go("settings", { section: "words" })}>Fiscal year →</button>
      <button type="button" style={btn(false)} onClick={() => go("settings", { section: "org" })}>Name →</button>
    </div></>;
  if (s.id === "people") {
    const w = s.ways;
    return <>
      <p style={p13}>{s.done ? `Your people are in, checked ${dayWords(s.dataInAt)}.` : "Three ways in. Pick the one that suits you."}</p>
      <div data-testid="guided-ways" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <Way title="Upload a file" testid="guided-way-file">
          <p style={{ ...p13, margin: 0 }}>{w.file.words}</p>
          <div>{s.peopleIn && !s.dataInAt ? <a href="/onboard/totals" style={{ ...btn(true), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Check the totals →</a>
            : <button type="button" style={btn(true)} onClick={() => go("settings", { section: "imports" })}>Import a file →</button>}</div>
        </Way>
        <Way title="Start from where gifts come in" testid="guided-way-giving">
          {w.giving.map(g => <div key={g.key} data-testid={`guided-reach-${g.key}`} style={{ fontSize: 13, color: T.ink2 }}>
            <p style={{ margin: "0 0 4px", lineHeight: 1.45 }}>{g.words}</p>
            {!g.connected && <button type="button" style={btn(false)} onClick={() => go("settings", { section: "connections", focus: g.key === "stripe" ? "stripe" : "giving" })}>Connect {g.label} →</button>}
          </div>)}
        </Way>
        <Way title="Send it to us" testid="guided-way-send"><SendToUs send={w.send} onDone={reload} /></Way>
      </div></>;
  }
  if (s.id === "call") return s.ready
    ? <Suspense fallback={null}><FirstSession onNavigate={onNavigate} onClosed={reload} /></Suspense>
    : <p style={p13}>{s.done ? "Done: a call is logged from your list." : "Once your people are in and checked, Steward lists the people worth a call first, each with the reason."}</p>;
  if (s.id === "connect") return <>
    {s.parts.map(p => <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "3px 0" }}>
      <span style={{ flex: "1 1 220px" }}><Part ok={p.ok} label={p.label} says={p.says} /></span>
      {!p.ok && <button type="button" style={btn(!!p.first)} onClick={() => go("settings", { section: "connections", focus: p.key })}>Connect {p.label} →</button>}
    </div>)}</>;
  if (s.id === "team") return <>
    <p style={p13}>{s.people === 1 ? "Only you can sign in so far." : `${s.people} people can sign in.`}{s.invited ? ` ${s.invited === 1 ? "One invitation is" : `${s.invited} invitations are`} out.` : ""} Everyone on your team is included.</p>
    <button type="button" style={btn(!s.done)} onClick={() => go("settings", { section: "team" })}>Invite someone →</button></>;
  return null;
}

export default function GuidedSetup({ onNavigate, prefer = null }) {
  const [d, setD] = useState(null);
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(null);
  useEffect(() => { apiFetch("/onboarding/guided").then(setD).catch(() => setD({ show: false })); }, [n]);
  if (!d || !d.show) return null;
  const reload = () => setN(x => x + 1);
  const skip = async (step, on) => { const r = await apiFetch("/onboarding/guided/skip", { method: "POST", body: JSON.stringify({ step, skip: on }) }).catch(() => null); if (r) setD(r); if (on) setOpen(null); };
  const preferred = prefer && d.steps.find(s => s.id === prefer && !s.done) ? prefer : null;
  const shown = open || preferred || d.current;
  return <section data-testid="guided-setup" aria-label="Set up Steward"
    style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: T.ink }}>Set up Steward</h2>
      <span data-testid="guided-count" style={{ fontSize: 13, color: T.ink3 }}>{d.doneCount} of 5 done{d.skippedCount ? `, ${d.skippedCount} skipped for now` : ""}</span>
    </div>
    <p style={{ margin: "0 0 6px", fontSize: 12.5, color: T.ink3 }}>{d.sentence}</p>
    {d.steps.map(s => {
      const isOpen = shown === s.id;
      return <div key={s.id} data-testid="guided-step" data-step={s.id} data-done={s.done ? "1" : "0"} data-skipped={s.skipped ? "1" : "0"} data-open={isOpen ? "1" : "0"}
        style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span aria-hidden style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
            background: s.done ? T.green600 : "transparent", color: s.done ? T.white : T.ink, border: s.done ? 0 : "1.5px solid " + T.bg3 }}>{s.done ? "✓" : s.n}</span>
          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "__none" : s.id)}
            style={{ flex: 1, minWidth: 160, textAlign: "left", background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 16, fontWeight: 700, color: s.done || s.skipped ? T.ink3 : T.ink }}>{s.title}</button>
          {s.skipped ? <button type="button" data-testid="guided-bring-back" style={quiet} onClick={() => { skip(s.id, false); setOpen(s.id); }}>Skipped · Bring it back</button>
            : isOpen && !s.done ? <button type="button" data-testid="guided-skip" style={quiet} onClick={() => skip(s.id, true)}>Skip for now</button> : null}
        </div>
        {isOpen && <div style={{ padding: "8px 0 2px 34px" }}><Body s={s} onNavigate={onNavigate} reload={reload} /></div>}
      </div>;
    })}
  </section>;
}
