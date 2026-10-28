// SetupPage.jsx · ONBOARD-1. "Set up Steward for me."
//
// Three things in (files, website, the tools they take gifts with), a plan in
// plain sentences, one Start, progress she can leave, and "Steward is ready".
// Every count and total on this page comes from the server's plan and the
// steps' own results; this file formats them and computes nothing.
//
// FIX-55: every spreadsheet goes to the one reader. A file is read here the
// way the import screen reads it (readSheetFile); the plan shows what POST
// /sheet-import/understand found in it, and its button opens the import
// screen (SpreadsheetImport) with that very file, for its questions, receipt
// and Undo. Start imports nothing and does only the steps left ticked.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { T } from "../components/shared";
import { errorMessage } from "../lib/domainError";
import SpreadsheetImport, { readSheetFile } from "../components/SpreadsheetImport";

const TOOLS = [
  ["stripe", "Stripe"], ["paypal", "PayPal"], ["zeffy", "Zeffy"], ["givebutter", "Givebutter"],
  ["square", "Square"], ["quickbooks", "QuickBooks"], ["checks", "Checks"], ["other", "Other"],
];
const STEP_LABEL = {
  read_site: "Reading your website", profile: "Filling in your profile and branding", import: "Importing and checking to the cent",
  funds: "Your funds", groups: "Starter groups", templates: "Thank-you drafts in your words", journeys: "Journeys, paused",
  invites: "Invitations for your team", connections: "Connections", finish: "Who to call tomorrow",
};
const POLL_MS = 1500;

const page = { minHeight: "100vh", background: T.bg, padding: "32px 16px 64px", boxSizing: "border-box", fontFamily: "'DM Sans',system-ui,sans-serif" };
const col = { maxWidth: 760, margin: "0 auto" };
const card = { background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 14, padding: "18px 20px", marginBottom: 14 };
const h1 = { fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 30, color: T.ink, margin: "0 0 6px", fontWeight: 400 };
const kicker = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 8 };
const line = { fontSize: 14, color: T.ink, lineHeight: 1.55, padding: "6px 0", borderTop: `1px solid ${T.bg3}` };

function Btn({ children, onClick, disabled, secondary, testid, danger }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testid}
      style={{ fontFamily: "inherit", background: secondary ? "transparent" : danger ? T.terracotta : T.green600, color: secondary ? T.green600 : T.white,
        border: secondary ? `1px solid ${T.green600}` : "none", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

// FIX-55: a file goes as the import screen reads it (its sheets of cells), with
// its own bytes so the plan can hand that very file to the import screen after
// a closed tab, and the date that screen would suggest for undated rows.
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function readFile(file) {
  const sheets = await readSheetFile(file);
  const t = file.lastModified ? new Date(file.lastModified) : null;
  return { name: file.name, sheets, bytes: toBase64(await file.arrayBuffer()), lastModified: file.lastModified || null,
    suggestedDate: t && !isNaN(t) ? localIso(t) : null };
}
// The stored file back as a File, for the import screen.
function fileFromStored(f) {
  const parts = f.bytes ? [Uint8Array.from(atob(f.bytes), c => c.charCodeAt(0))] : [f.text || ""];
  return new File(parts, f.name, f.lastModified ? { lastModified: f.lastModified } : undefined);
}

function Intake({ onMade }) {
  const [files, setFiles] = useState([]);
  const [siteUrl, setSiteUrl] = useState("");
  const [tools, setTools] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toggle = k => setTools(t => (t.includes(k) ? t.filter(x => x !== k) : [...t, k]));
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const read = await Promise.all(files.map(readFile));
      const r = await apiFetch("/setup/runs", { method: "POST", body: JSON.stringify({ files: read, siteUrl, tools }) });
      onMade(r, files);
    } catch (e) { setErr(errorMessage(e, "Steward could not read those files.")); }
    setBusy(false);
  };
  return (
    <div data-testid="setup-intake">
      <h1 style={h1}>Set up Steward for me</h1>
      <p style={{ fontSize: 15, color: T.ink2, margin: "0 0 20px", lineHeight: 1.55 }}>
        Hand Steward your files and your website. It shows you its plan before it does anything, and you only answer what a computer can't.
      </p>
      <div style={card}>
        <div style={kicker}>Your donor files</div>
        <p style={{ fontSize: 13, color: T.ink3, margin: "0 0 10px" }}>Any number, CSV or Excel, from your old system or a spreadsheet you kept. Each one is read by the import screen, which shows what it found and asks what it cannot tell before anything is written.</p>
        <input type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods" data-testid="setup-files"
          onChange={e => setFiles([...e.target.files])} style={{ fontSize: 13 }} />
        {files.length > 0 && <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 8 }}>{files.map(f => f.name).join(", ")}</div>}
      </div>
      <div style={card}>
        <div style={kicker}>Your website</div>
        <input value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="yourorganization.org" data-testid="setup-site"
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "9px 11px", fontSize: 14 }} />
        <p style={{ fontSize: 12, color: T.ink3, margin: "8px 0 0" }}>Steward reads a few public pages for your mission, logo, colors, address, EIN and team. Anything it is not sure of becomes a question.</p>
      </div>
      <div style={card}>
        <div style={kicker}>How you take gifts</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {TOOLS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => toggle(k)} data-testid={`setup-tool-${k}`} aria-pressed={tools.includes(k)}
              style={{ borderRadius: 999, padding: "6px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${tools.includes(k) ? T.green600 : T.bg3}`, background: tools.includes(k) ? T.green600 : T.white, color: tools.includes(k) ? T.white : T.ink }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {err && <div role="alert" style={{ color: T.ink, background: T.gold100, border: `1px solid ${T.gold300}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>{err}</div>}
      <Btn onClick={go} disabled={busy || !files.length} testid="setup-read">{busy ? "Reading…" : "Read my files and show me the plan"}</Btn>
    </div>
  );
}

function Question({ q, value, onChange }) {
  return (
    <div data-testid={`setup-q-${q.key}`} style={{ ...line }}>
      <div style={{ marginBottom: 6 }}>{q.text}</div>
      {q.options && q.kind === "choice" ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {q.options.map(o => (
            <label key={o.value} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="radio" name={q.key} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
            </label>
          ))}
        </div>
      ) : (
        <input value={value || ""} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 10px", fontSize: 13.5 }} />
      )}
    </div>
  );
}

// One spreadsheet in the plan: what the one reader found in it, and the button
// that opens the import screen with it. The import happens there, never here.
function SheetStep({ f, imported, onOpen, opening }) {
  const rd = f.reader;
  return (
    <div data-testid={`setup-file-${f.id}`} style={{ ...line, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ flex: "1 1 260px", minWidth: 0 }}>
        <strong>{f.name}</strong>
        <span data-testid="setup-file-reader" style={{ display: "block", fontSize: 13, color: T.ink2, marginTop: 2 }}>
          {!rd ? "Steward is reading it with the import screen's reader…" : rd.ok === false ? rd.sentence
            : `${rd.button || "Nothing to import"}${rd.questions ? `. ${rd.questions === 1 ? "One question" : `${rd.questions} questions`} to answer on the import screen.` : "."}`}
        </span>
      </span>
      {imported
        ? <span style={{ fontSize: 12.5, fontWeight: 700, color: T.green600 }}>Imported. Its receipt and Undo are in Imports.</span>
        : <Btn secondary onClick={onOpen} disabled={opening} testid={`setup-file-open-${f.id}`}>{opening ? "Opening…" : "Review and import"}</Btn>}
    </div>
  );
}

function Plan({ run, held, onRun, onChange, onStart }) {
  const p = run.plan || {};
  const [answers, setAnswers] = useState(run.answers || {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Every step she can leave out starts ticked; Start sends only the ticked ones.
  const [ticked, setTicked] = useState(() => new Set(p.choosable || []));
  const [importing, setImporting] = useState(null);   // { id, file }
  const [opening, setOpening] = useState(null);
  const [imported, setImported] = useState({});
  const sheets = (p.files || []).filter(f => f.role === "sheet");
  const reports = (p.files || []).filter(f => f.role === "old_report");
  // A plan a super-admin prepared has no reader numbers yet: read them as her.
  const unread = sheets.some(f => !f.reader);
  useEffect(() => {
    if (!unread) return;
    apiFetch(`/setup/runs/${run.id}/read`, { method: "POST", body: "{}" }).then(onRun).catch(e => setErr(errorMessage(e, "Steward could not read your files.")));
  }, [run.id, unread]);   // eslint-disable-line react-hooks/exhaustive-deps
  const open = async f => {
    setOpening(f.id); setErr("");
    try {
      const file = (held && held[f.name]) || fileFromStored(await apiFetch(`/setup/runs/${run.id}/files/${encodeURIComponent(f.id)}`));
      setImporting({ id: f.id, file });
    } catch (e) { setErr(errorMessage(e, "That file could not be opened.")); }
    setOpening(null);
  };
  const tick = k => setTicked(t => { const n = new Set(t); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const start = async () => {
    setBusy(true); setErr("");
    try {
      await apiFetch(`/setup/runs/${run.id}/answers`, { method: "PUT", body: JSON.stringify({ answers }) });
      onStart(await apiFetch(`/setup/runs/${run.id}/start`, { method: "POST", body: JSON.stringify({ steps: [...ticked] }) }));
    } catch (e) { setErr(errorMessage(e, "Setup could not start.")); setBusy(false); }
  };
  const stepLine = (a, i) => {
    const can = (p.choosable || []).includes(a.step) && !a.fixed;
    return (
      <label key={i} data-testid={`setup-step-choice-${a.step}`} style={{ ...line, display: "flex", gap: 10, alignItems: "flex-start", cursor: can ? "pointer" : "default" }}>
        {can
          ? <input type="checkbox" checked={ticked.has(a.step)} onChange={() => tick(a.step)} style={{ marginTop: 4, accentColor: T.green600 }} aria-label={a.sentence} />
          : <span style={{ width: 13, flex: "0 0 13px" }} />}
        <span style={{ flex: 1, minWidth: 0, color: can && !ticked.has(a.step) ? T.ink3 : T.ink }}>{a.sentence}</span>
      </label>
    );
  };
  return (
    <div data-testid="setup-plan">
      <h1 style={h1}>Here is the plan</h1>
      <p style={{ fontSize: 14.5, color: T.ink2, margin: "0 0 18px" }}>Nothing has happened yet. Bring in your files, untick anything you don't want, and press Start.</p>
      {sheets.length > 0 && (
        <div style={card} data-testid="setup-plan-files">
          <div style={kicker}>Your files, read by the import screen</div>
          <p style={{ fontSize: 12.5, color: T.ink3, margin: "0 0 6px", lineHeight: 1.5 }}>
            Each file opens the import screen: it shows what it found, asks what it cannot tell, and gives you a receipt and Undo. Start does not import anything.
          </p>
          {sheets.map(f => <SheetStep key={f.id} f={f} imported={!!imported[f.id]} opening={opening === f.id} onOpen={() => open(f)} />)}
        </div>
      )}
      {reports.length > 0 && (
        <div style={card}>
          <div style={kicker}>Old reports</div>
          {reports.map(f => <div key={f.id} style={line}><strong>{f.name}</strong>: an old report{f.rows ? ` of ${f.rows.toLocaleString("en-US")} rows` : ""}, not gifts. It is kept under Reports and checked against what Steward has.</div>)}
        </div>
      )}
      <div style={card} data-testid="setup-plan-auto">
        <div style={kicker}>What Steward will do when you press Start</div>
        {(p.auto || []).map(stepLine)}
      </div>
      <div style={card} data-testid="setup-plan-prepared">
        <div style={kicker}>Prepared for your click</div>
        {(p.prepared || []).map(stepLine)}
      </div>
      {(p.questions || []).length > 0 && (
        <div style={card} data-testid="setup-plan-questions">
          <div style={kicker}>{p.questions.length === 1 ? "One question" : `${p.questions.length} questions`}, each with an answer picked for you</div>
          {p.questions.map(q => <Question key={q.key} q={q} value={answers[q.key]} onChange={v => setAnswers(a => ({ ...a, [q.key]: v }))} />)}
          {(p.later || []).length > 0 && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 8 }}>{p.later.length} more for later, on the finish screen.</div>}
        </div>
      )}
      {err && <div role="alert" style={{ color: T.ink, background: T.gold100, border: `1px solid ${T.gold300}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn onClick={start} disabled={busy} testid="setup-start">{busy ? "Starting…" : "Start"}</Btn>
        <Btn onClick={onChange} secondary testid="setup-change">Change what I gave</Btn>
      </div>
      {importing && <SpreadsheetImport file={importing.file} onClose={() => setImporting(null)}
        onImported={() => { setImported(d => ({ ...d, [importing.id]: true })); setImporting(null); }} />}
    </div>
  );
}

function Progress({ run, onResume }) {
  return (
    <div data-testid="setup-progress">
      <h1 style={h1}>Setting up Steward</h1>
      <p style={{ fontSize: 14.5, color: T.ink2, margin: "0 0 18px" }}>You can close this tab. Setup keeps going, and this page picks up where it is when you come back.</p>
      <div style={card}>
        {run.steps.map(s => (
          <div key={s.key} data-testid={`setup-step-${s.key}`} style={{ ...line, display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ width: 74, flex: "0 0 74px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
              color: s.status === "done" ? T.green600 : s.status === "failed" ? T.gold600 : T.ink3 }}>
              {s.status === "done" ? "Done" : s.status === "running" ? "Working" : s.status === "failed" ? "Stopped" : s.status === "skipped" ? "Skipped" : "Waiting"}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{STEP_LABEL[s.key] || s.key}</span>
              {s.result && s.result.sentence && <span style={{ color: T.ink2 }}>. {s.result.sentence}</span>}
              {s.error && <span style={{ color: T.ink2 }}>. {s.error}</span>}
            </span>
          </div>
        ))}
      </div>
      {(run.status === "failed" || run.stalled) && <Btn onClick={onResume} testid="setup-resume">Carry on from where it stopped</Btn>}
    </div>
  );
}

function Invite({ inv, onSent }) {
  const [email, setEmail] = useState(inv.email || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const send = async () => {
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/setup/invites/${inv.id}`, { method: "PUT", body: JSON.stringify({ email }) });
      await apiFetch(`/setup/invites/${inv.id}/send`, { method: "POST", body: "{}" });
      onSent();
    } catch (e) { setMsg(errorMessage(e, "That invitation was not sent.")); }
    setBusy(false);
  };
  if (inv.status === "sent") return <div style={line}>Invitation sent to {inv.name}.</div>;
  return (
    <div style={{ ...line, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} data-testid={`setup-invite-${inv.id}`}>
      <span style={{ flex: "1 1 200px" }}>{inv.name}{inv.title ? `, ${inv.title}` : ""}</span>
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="their email" aria-label={`${inv.name}'s email`}
        style={{ flex: "1 1 180px", minWidth: 0, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "7px 9px", fontSize: 13 }} />
      <Btn onClick={send} disabled={busy || !email} testid={`setup-invite-send-${inv.id}`}>Send</Btn>
      {msg && <span style={{ fontSize: 12, color: T.ink2, flexBasis: "100%" }}>{msg}</span>}
    </div>
  );
}

function Ready({ run, onReload, onUndone }) {
  const nav = useNavigate();
  const r = run.readout || {};
  const [undo, setUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const open = o => {
    if (!o) return;
    if (o.kind === "import") nav("/donors");
    else if (o.kind === "settings") nav(`/app/settings?section=${o.section}`);
    else if (o.kind === "tab") nav(`/app/${o.tab === "templates" ? "communications" : o.tab}`);
    else if (o.kind === "old_report_check") nav(`/app/reports?report=board-files&check=${encodeURIComponent(o.id)}`);
  };
  const doUndo = async () => {
    setBusy(true);
    try { const u = await apiFetch(`/setup/runs/${run.id}/undo`, { method: "POST", body: "{}" }); onUndone(u.sentence); }
    catch (e) { setMsg(errorMessage(e, "Undo did not finish.")); }
    setBusy(false);
  };
  const home = async () => {
    await apiFetch("/onboarding/complete", { method: "POST", body: "{}" }).catch(() => {});
    try { const o = JSON.parse(localStorage.getItem("npe_org") || "{}"); localStorage.setItem("npe_org", JSON.stringify({ ...o, onboarding_complete: 1 })); } catch { /* the next sign-in reads it fresh */ }
    window.location.href = "/dashboard";
  };
  const invites = (run.invites || []);
  return (
    <div data-testid="setup-ready">
      <h1 style={h1}>Steward is ready.</h1>
      <p style={{ fontSize: 15, color: T.ink2, margin: "0 0 18px" }}>{r.headline}{r.minutesSentence ? ` ${r.minutesSentence}` : ""}</p>
      <div style={card} data-testid="setup-ready-did">
        <div style={kicker}>What Steward did</div>
        {(r.did || []).map((d, i) => (
          <div key={i} style={line}>
            {d.sentence}{" "}
            {d.open && <button type="button" onClick={() => open(d.open)} style={{ background: "none", border: "none", color: T.green600, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 13.5 }}>Open</button>}
          </div>
        ))}
      </div>
      <div style={card} data-testid="setup-ready-waiting">
        <div style={kicker}>Waiting on you</div>
        {invites.map(inv => <Invite key={inv.id} inv={inv} onSent={onReload} />)}
        {(r.waiting || []).filter(w => w.kind !== "invite").map((w, i) => (
          <div key={i} style={{ ...line, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 180 }}>{w.sentence}</span>
            {w.kind === "connection" && <Btn secondary onClick={() => nav(`/app/settings?section=connections&focus=${w.focus}`)}>Connect</Btn>}
            {w.kind === "receipt" && <Btn secondary onClick={() => nav("/app/settings?section=receipts")}>Add them</Btn>}
            {w.kind === "duplicates" && <><Btn secondary onClick={() => nav("/donors?view=health")}>Review now</Btn><span style={{ fontSize: 12.5, color: T.ink3 }}>or later, from Data health</span></>}
          </div>
        ))}
        {!(r.waiting || []).length && <div style={line}>Nothing. Every question is answered.</div>}
      </div>
      <div style={card} data-testid="setup-ready-calls">
        <div style={kicker}>Who to call tomorrow</div>
        {(r.calls || []).map(c => (
          <div key={c.donorId} style={line}>
            <button type="button" onClick={() => nav(`/donors/${c.donorId}`)} style={{ background: "none", border: "none", padding: 0, color: T.ink, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>{c.name}</button>
            <span style={{ color: T.ink2 }}>. {c.reason}</span>
          </div>
        ))}
      </div>
      {msg && <div role="alert" style={{ fontSize: 13, color: T.ink, marginBottom: 10 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Btn onClick={home} testid="setup-home">Go to my home screen</Btn>
        {!undo ? <Btn secondary onClick={() => setUndo(true)} testid="setup-undo">Undo all of setup</Btn> : (
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: T.ink }}>This removes every person, gift, fund, template and journey setup made.</span>
            <Btn danger onClick={doUndo} disabled={busy} testid="setup-undo-confirm">{busy ? "Undoing…" : "Yes, undo all of it"}</Btn>
            <Btn secondary onClick={() => setUndo(false)}>Keep it</Btn>
          </span>
        )}
      </div>
    </div>
  );
}

export default function SetupPage() {
  const [run, setRun] = useState(undefined);
  const [fresh, setFresh] = useState(false);
  const [note, setNote] = useState("");
  // The files she picked, by name, so the plan opens the import screen with them.
  const [held, setHeld] = useState({});
  const timer = useRef(null);
  const load = useCallback(async () => {
    try { const r = await apiFetch("/setup/current"); setRun(r.run || null); }
    catch { setRun(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (run && run.status === "running") timer.current = setTimeout(load, POLL_MS);
    return () => clearTimeout(timer.current);
  }, [run, load]);
  const resume = async () => { try { setRun(await apiFetch(`/setup/runs/${run.id}/resume`, { method: "POST", body: "{}" })); } catch { load(); } };
  let body;
  if (run === undefined) body = <div style={{ color: T.ink3, fontSize: 14 }}>Opening setup…</div>;
  else if (!run || fresh || run.status === "undone") body = <Intake onMade={(r, files) => { setHeld(Object.fromEntries((files || []).map(f => [f.name, f]))); setFresh(false); setRun(r); }} />;
  else if (run.status === "planned") body = <Plan run={run} held={held} onRun={setRun} onChange={() => setFresh(true)} onStart={setRun} />;
  else if (run.status === "running" || run.status === "failed") body = <Progress run={run} onResume={resume} />;
  else body = <Ready run={run} onReload={load} onUndone={s => { setNote(s); setRun(null); }} />;
  return (
    <div style={page}>
      <div style={col}>
        <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 22, color: T.ink, marginBottom: 22 }}>Steward</div>
        {note && <div role="status" style={{ ...card, fontSize: 14 }}>{note}</div>}
        {body}
        {(!run || fresh) && (
          <p style={{ fontSize: 12.5, color: T.ink3, marginTop: 22 }}>
            Rather do it step by step? <a href="/welcome" style={{ color: T.green600, fontWeight: 700 }}>Set it up yourself</a>.
          </p>
        )}
      </div>
    </div>
  );
}
