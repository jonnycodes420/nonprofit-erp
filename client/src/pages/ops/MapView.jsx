// DEVBOARD-2 · /ops, the Map tab. Pure: it draws the answer of GET /ops/map
// and calls onMark / onShot; it fetches nothing itself, so the test renders it.
// Every area of Steward, its checks, each check's last walk result and your
// last mark, its open board items, and "Open in demo" (a new tab, signed in as
// the demo director).
import { useState } from "react";
import { countLabel } from "../../../../shared/countWords.js";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const card = { background: WHITE, borderRadius: 10, padding: "16px 18px", marginBottom: 14, border: "1px solid rgba(15,26,18,0.08)" };
const says = { fontSize: 13, opacity: 0.7, margin: "0 0 10px" };
const cell = { padding: "7px 10px 7px 0", fontSize: 13, verticalAlign: "top", borderTop: `1px solid ${CREAM}` };
const pill = good => ({ display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
  background: good === true ? EMERALD : good === false ? BRASS : CREAM, color: good === true ? WHITE : INK });
const btn = primary => ({ fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, minHeight: 28,
  border: `1px solid ${primary ? EMERALD : INK + "33"}`, background: primary ? EMERALD : WHITE, color: primary ? WHITE : INK });
const link = { color: EMERALD, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" };

const verdictGood = v => (v === "PASS" || v === "pass" ? true : v === "FAIL" || v === "fail" ? false : null);
const day = s => (s ? String(s).slice(0, 10) : "");

function Result({ walk, mark }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
    <span title="The last walk's result">{walk ? <span style={pill(verdictGood(walk.verdict))}>walk {walk.verdict.toLowerCase()} · {day(walk.date).slice(5)}</span>
      : <span style={{ ...pill(null), opacity: 0.8 }}>not walked</span>}</span>
    {mark ? <span title="Your last mark"><span style={pill(verdictGood(mark.verdict))}>you {mark.verdict} · {day(mark.at).slice(5)}</span></span> : null}
  </div>;
}

function Demo({ href }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" style={link} data-demo-link="1">Open in demo ↗</a>;
}

function FailForm({ onSave, onCancel }) {
  const [note, setNote] = useState("");
  const [shot, setShot] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const take = file => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setErr("A screenshot is a PNG, JPEG or WebP.");
    if (file.size > 1_800_000) return setErr("That image is over 1.8 MB. Crop it, or save it as JPEG.");
    const r = new FileReader(); r.onload = () => { setShot(String(r.result)); setErr(null); }; r.readAsDataURL(file);
  };
  const save = async () => {
    if (!note.trim()) return setErr("Say in one line what went wrong.");
    setBusy(true); setErr(null);
    try { await onSave(note.trim(), shot); } catch (e) { setErr((e && e.message) || "That did not save. Try again."); setBusy(false); }
  };
  return <div style={{ background: CREAM, borderRadius: 8, padding: "10px 12px", marginTop: 6 }}
    onPaste={e => { const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith("image/")); if (f) { e.preventDefault(); take(f); } }}>
    <input autoFocus value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="What went wrong, in one line"
      aria-label="What went wrong" onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onCancel(); }}
      style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", border: `1px solid ${INK}33`, borderRadius: 6, fontFamily: "inherit" }} />
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
      <label style={{ ...btn(false), display: "inline-flex", alignItems: "center" }}>Add a screenshot
        <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={e => take(e.target.files && e.target.files[0])} /></label>
      <span style={{ opacity: 0.7 }}>{shot ? "Screenshot attached." : "Or paste one here (optional)."}</span>
      {shot ? <button type="button" style={btn(false)} onClick={() => setShot(null)}>Remove it</button> : null}
      <span style={{ flex: 1 }} />
      <button type="button" style={btn(false)} onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" style={btn(true)} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save the fail"}</button>
    </div>
    {err ? <p style={{ ...says, opacity: 1, margin: "8px 0 0" }}><span style={pill(false)}>check</span> {err}</p> : null}
  </div>;
}

function CheckRow({ area, c, onMark, walkOnly }) {
  const [failing, setFailing] = useState(false);
  const [msg, setMsg] = useState(null);
  const pass = async () => {
    try { const r = await onMark({ area: area.id, check: c.id, verdict: "pass" }); setMsg(r && r.item ? `${r.item.id} is verified.` : "Marked pass."); }
    catch (e) { setMsg((e && e.message) || "That did not save."); }
  };
  const fail = async (note, shot) => {
    const r = await onMark({ area: area.id, check: c.id, verdict: "fail", note, shot });
    setFailing(false); setMsg(r && r.item ? (r.item.joined ? `Added to ${r.item.id}, still open.` : `${r.item.id} is on the board.`) : "Marked fail.");
  };
  return <tr data-check={c.id}>
    <td style={{ ...cell, width: 72, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{c.id}</td>
    <td style={cell}>
      {walkOnly ? (c.words || <span style={{ opacity: 0.7 }}>A walk check the map does not name.</span>) : c.says}
      {c.item ? <div style={{ marginTop: 4, fontSize: 12 }}><span style={pill(false)}>{c.item.state}</span> <span style={{ fontFamily: "ui-monospace, monospace" }}>{c.item.id}</span> {c.item.words}</div> : null}
      {msg ? <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>{msg}</div> : null}
      {failing ? <FailForm onSave={fail} onCancel={() => setFailing(false)} /> : null}
    </td>
    <td style={{ ...cell, width: 130 }}><Result walk={walkOnly ? { verdict: c.verdict, date: c.date } : c.walk} mark={c.mark} /></td>
    <td style={{ ...cell, width: 220, textAlign: "right" }}>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
        <Demo href={c.open} />
        <button type="button" style={btn(false)} onClick={pass} aria-label={`Pass ${c.id}`}>Pass</button>
        <button type="button" style={btn(false)} onClick={() => setFailing(f => !f)} aria-label={`Fail ${c.id}`}>Fail</button>
      </div>
    </td>
  </tr>;
}

function Area({ a, onMark, onShot }) {
  const openCount = a.items.length;
  const empty = a.id === "unsorted" && !a.walkChecks.length && !a.items.length;
  return <section style={card} data-area={a.id}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{a.name}</h2>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        {[a.checks.length ? countLabel(a.checks.length, "check") : null, a.walkChecks.length ? `${a.walkChecks.length} from the walk` : null,
          countLabel(openCount, "open item"), a.prefixes.length ? `walk ids ${a.prefixes.join(", ")}` : null].filter(Boolean).join(" · ")}</span>
      <span style={{ flex: 1 }} />
      <Demo href={a.open} />
    </div>
    {a.says ? <p style={{ ...says, marginTop: 4 }}>{empty ? "Nothing here: every walk check's prefix belongs to an area." : a.says}</p> : null}
    {a.checks.length || a.walkChecks.length ? <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}><tbody>
      {a.checks.map(c => <CheckRow key={c.id} area={a} c={c} onMark={onMark} />)}
      {a.walkChecks.map(c => <CheckRow key={"w" + c.id} area={a} c={c} onMark={onMark} walkOnly />)}
    </tbody></table> : null}
    {openCount ? <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, margin: "4px 0" }}>Open on the board</div>
      {a.items.map(it => <div key={it.id} style={{ fontSize: 13, padding: "3px 0" }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{it.id}</span> <span style={pill(false)}>{it.state}</span>{" "}
        {it.words} <span style={{ opacity: 0.7 }}>· {it.source}{it.opened ? `, ${it.opened}` : ""}</span>
        {it.shot && onShot ? <> · <button type="button" onClick={() => onShot(it.shot)} style={{ ...link, background: "none", border: 0, padding: 0, cursor: "pointer" }}>screenshot</button></> : null}
      </div>)}
    </div> : null}
  </section>;
}

export default function MapView({ data, error, onMark, onShot }) {
  if (error) return <p style={says}><span style={pill(false)}>unavailable</span> {error}</p>;
  if (!data) return <p style={says}>Loading the map…</p>;
  if (!data.ok) return <p style={says}><span style={pill(false)}>unavailable</span> {data.error}</p>;
  const checks = data.areas.reduce((n, a) => n + a.checks.length, 0);
  const open = data.areas.reduce((n, a) => n + a.items.length, 0);
  return <div>
    <p style={{ ...says, opacity: 0.85 }}>
      Every part of Steward, {countLabel(checks, "check")} you can do in under a minute, and {countLabel(open, "open item")}.
      {" "}Each check shows the last walk's result{data.lastWalk ? ` (last walk ${data.lastWalk})` : " (no walk imported yet)"} and your last mark.
      {" "}Open in demo opens the screen in a new tab: sign in there as {data.demo.signIn}, in a private window so this one stays yours.
      {" "}Fail opens a board item; Pass verifies the open one.
    </p>
    {data.demo.missing && data.demo.missing.length ? <p style={says}><span style={pill(false)}>check</span> Not found in the demo: {data.demo.missing.join(", ")}. Their checks open the Donors list instead.</p> : null}
    {data.boardError ? <p style={says}><span style={pill(false)}>unavailable</span> The board file could not be read, so walk results are missing: {data.boardError}</p> : null}
    {data.areas.map(a => <Area key={a.id} a={a} onMark={onMark} onShot={onShot} />)}
  </div>;
}
