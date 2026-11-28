// REPORTS-6 item 4 · YOUR DASHBOARD. A new org opens Reports here, on nine
// reports Steward already has, each a tile that opens the full report.
// "Add a report" opens a gallery of every report, one line and a preview
// each, added in one click and taken off in one (with Undo). Every number is
// read from its report's own answer on the server (GET /your-dashboard); a
// figure with a source opens its rows, and a tile opens its report.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal, fmtFull } from "../shared";
import { Figure } from "../Figure";
import { errorMessage } from "../../lib/domainError";
import { offerUndo } from "../EditHistory";

const GHOST = { background: T.white, color: T.greenDk, border: "1px solid " + T.greenDk, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const LINK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" };

function TileFigures({ t, onOpen }) {
  if (t.error) return <div style={{ fontSize: 12.5, color: T.ink3 }}>{t.error}</div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {(t.figures || []).map((f, i) => (
      <div key={i}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>{f.label}</div>
        <div style={{ fontSize: i === 0 ? 22 : 15, fontWeight: 800, color: T.ink }}>
          {f.source
            ? <Figure variant="inline" kind={f.kind} value={f.value} label={f.label} definition={f.definition} source={f.source} blank={f.blank} />
            : <button type="button" style={{ ...LINK, color: T.ink, fontSize: "inherit", fontWeight: "inherit", textDecoration: "underline dotted" }}
                title="Opens the report, which lists every row behind this number" onClick={onOpen}>
                {f.value === null || f.value === undefined ? "None yet" : f.kind === "money" ? fmtFull(f.value) : f.kind === "percent" ? `${f.value}%` : Number(f.value).toLocaleString("en-US")}
              </button>}
        </div>
        {f.value === null && f.blank && <div style={{ fontSize: 11.5, color: T.ink3 }}>{f.blank}</div>}
      </div>))}
  </div>;
}

export function YourDashboard({ onPick }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [gallery, setGallery] = useState(false);
  const load = () => apiFetch("/your-dashboard").then(d => { setData(d); setErr(""); }).catch(e => setErr(errorMessage(e, "Your dashboard did not load.")));
  useEffect(() => { load(); }, []);
  const remove = async t => {
    try {
      const r = await apiFetch(`/your-dashboard/tiles/${encodeURIComponent(t.key)}`, { method: "DELETE" });
      load();
      offerUndo({ message: r.message, undoAction: async () => { const u = await apiFetch(r.undo.path, { method: "POST", body: JSON.stringify(r.undo.body) }); load(); return u; } }, "dashboard tile");
    } catch (e) { setErr(errorMessage(e, "That report was not taken off.")); }
  };
  return (
    <div data-testid="your-dashboard">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, color: T.ink, margin: 0 }}>Your dashboard</h1>
          <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>{data ? data.sentence : "Each tile is a report Steward already has."}</div>
        </div>
        <button type="button" data-testid="yd-add" style={GHOST} onClick={() => setGallery(true)}>Add a report</button>
      </div>
      {err && <div style={{ fontSize: 13, color: T.ink, marginTop: 12 }}>{err}</div>}
      {!data && !err && <div style={{ fontSize: 13, color: T.ink3, marginTop: 16 }}>Loading your reports…</div>}
      {data && data.tiles.length === 0 && <div style={{ fontSize: 13, color: T.ink2, marginTop: 16 }}>Nothing on your dashboard. Add a report to start.</div>}
      {data && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 12, marginTop: 16 }}>
        {data.tiles.map(t => (
          <div key={t.key} data-testid="yd-tile" data-tile={t.key} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{t.title}</div>
              <button type="button" aria-label={`Take ${t.title} off your dashboard`} data-testid="yd-remove" onClick={() => remove(t)}
                style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.4 }}>{t.description}</div>
            <TileFigures t={t} onOpen={() => onPick(t.opens)} />
            <button type="button" data-testid="yd-open" style={{ ...LINK, alignSelf: "flex-start", marginTop: "auto" }} onClick={() => onPick(t.opens)}>Open the report</button>
          </div>))}
      </div>}
      {gallery && <Gallery onClose={() => { setGallery(false); load(); }} />}
    </div>
  );
}

// Every report Steward has, one line each, a preview asked for a few at a time.
function Gallery({ onClose }) {
  const [list, setList] = useState(null);
  const [previews, setPreviews] = useState({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const load = () => apiFetch("/your-dashboard/gallery").then(r => setList(r.reports || [])).catch(e => setErr(errorMessage(e, "The gallery did not load.")));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!list) return;
    let alive = true;
    (async () => {
      for (const c of list) {
        if (!alive) return;
        const p = await apiFetch(`/your-dashboard/preview/${encodeURIComponent(c.key)}`).catch(() => null);
        if (alive) setPreviews(prev => ({ ...prev, [c.key]: p || { error: "No preview." } }));
      }
    })();
    return () => { alive = false; };
  }, [list && list.length]);
  const toggle = async c => {
    setBusy(c.key); setErr("");
    try {
      if (c.added) await apiFetch(`/your-dashboard/tiles/${encodeURIComponent(c.key)}`, { method: "DELETE" });
      else await apiFetch("/your-dashboard/tiles", { method: "POST", body: JSON.stringify({ key: c.key }) });
      setList(l => l.map(x => x.key === c.key ? { ...x, added: !c.added } : x));
    } catch (e) { setErr(errorMessage(e, "That did not change.")); }
    setBusy("");
  };
  return (
    <Modal onClose={onClose} width={720} ariaLabel="Add a report" dialogStyle={{ background: T.bg, borderRadius: 14 }}>
      <div data-testid="yd-gallery">
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, color: T.ink }}>Add a report</div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3 }}>Every report Steward has. One click puts it on your dashboard; one click takes it off.</div>
        {err && <div style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{err}</div>}
        {!list && <div style={{ fontSize: 13, color: T.ink3, marginTop: 12 }}>Loading…</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10, marginTop: 12, maxHeight: "60vh", overflowY: "auto" }}>
          {(list || []).map(c => {
            const p = previews[c.key];
            return (
              <div key={c.key} data-testid="yd-gallery-card" data-tile={c.key} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{c.title}</div>
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.4 }}>{c.description}</div>
                <div data-testid="yd-preview" style={{ fontSize: 12.5, color: T.ink2, minHeight: 18 }}>
                  {!p ? "Preview loading…" : p.error ? p.error : (p.figures || []).slice(0, 1).map((f, i) => <span key={i}>{f.label}: <strong>{f.value === null || f.value === undefined ? "None yet" : f.kind === "money" ? fmtFull(f.value) : f.kind === "percent" ? `${f.value}%` : Number(f.value).toLocaleString("en-US")}</strong></span>)}
                </div>
                <button type="button" data-testid="yd-toggle" disabled={busy === c.key} onClick={() => toggle(c)}
                  style={{ ...GHOST, alignSelf: "flex-start", ...(c.added ? { color: T.ink, borderColor: T.bg3 } : {}) }}>{c.added ? "Take it off" : "Add it"}</button>
              </div>);
          })}
        </div>
      </div>
    </Modal>
  );
}
