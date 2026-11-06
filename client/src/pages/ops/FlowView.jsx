// DEVBOARD-3 · /ops, the How-it-works tab: how a gift flows through Steward.
// Pure: it draws the answer of GET /ops/flow (ops/flow.json plus live health)
// and fetches nothing itself, so the test renders it. SVG only, no chart
// library. Hover a box and its whole path lights up; click it (or Enter) and
// its details open: the modules it lives in, its jobs' last run, the worker
// and the queue, and its Map area. Wide screens draw it left to right; a phone
// draws it top to bottom.
import { useEffect, useMemo, useState } from "react";
import { countLabel, countWords } from "../../../../shared/countWords.js";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const SERIF = "'DM Serif Display', Georgia, serif";
const BOX_W = { wide: 132, narrow: 104 }, BOX_H = 58;

const CSS = `
.db3f-box { cursor: pointer; outline: none; }
.db3f-box rect.face { transition: fill 180ms, stroke 180ms, opacity 180ms; }
.db3f-box:focus-visible rect.face { stroke: ${EMERALD}; stroke-width: 2.5; }
.db3f-box .in { animation: db3f-in 520ms cubic-bezier(.2,.7,.2,1) both; transform-box: fill-box; transform-origin: center; }
.db3f-edge { transition: stroke 180ms, opacity 180ms, stroke-width 180ms; }
.db3f-edge.draw { stroke-dasharray: 600; stroke-dashoffset: 600; animation: db3f-draw 900ms ease-out forwards; }
.db3f-dim { opacity: .22; }
@keyframes db3f-in { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes db3f-draw { to { stroke-dashoffset: 0; } }
@keyframes db3f-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.db3f-card { background: ${WHITE}; border-radius: 16px; padding: 24px 26px; border: 1px solid ${INK}0f; animation: db3f-rise 320ms both; }
.db3f-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
@media (max-width: 860px) { .db3f-grid { grid-template-columns: 1fr; gap: 16px; } .db3f-card { padding: 18px 16px; } }
@media (prefers-reduced-motion: reduce) {
  .db3f-box .in, .db3f-card { animation: none !important; }
  .db3f-edge.draw { animation: none !important; stroke-dasharray: none; stroke-dashoffset: 0; }
  .db3f-box rect.face, .db3f-edge { transition: none !important; }
}`;

// Split a title into at most two lines of about `max` characters.
function lines(title, max) {
  const words = String(title).split(" ");
  if (title.length <= max || words.length < 2) return [title];
  let best = [title], score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const s = Math.max(a.length, b.length);
    if (s < score) { score = s; best = [a, b]; }
  }
  return best;
}

// Where each box sits, for the wide (left to right) or narrow (top to bottom) drawing.
function layout(flow, mode) {
  const stages = flow.stages.length;
  const per = flow.stages.map((_, i) => flow.boxes.filter(b => b.stage === i));
  const most = Math.max(1, ...per.map(p => p.length));
  const w = BOX_W[mode], pos = {};
  if (mode === "wide") {
    const colW = 152, gapY = 18, top = 40;
    const width = stages * colW, height = top + most * (BOX_H + gapY) + 4;
    per.forEach((boxes, s) => boxes.forEach((b, i) => {
      const y0 = top + ((most - boxes.length) * (BOX_H + gapY)) / 2;
      pos[b.id] = { x: s * colW + (colW - w) / 2, y: y0 + i * (BOX_H + gapY) };
    }));
    return { width, height, pos, w, labels: flow.stages.map((t, s) => ({ t, x: s * colW + colW / 2, y: 18 })) };
  }
  const width = 340, rowH = BOX_H + 56, gapX = 8;
  per.forEach((boxes, s) => {
    const rowW = boxes.length * w + (boxes.length - 1) * gapX;
    boxes.forEach((b, i) => { pos[b.id] = { x: (width - rowW) / 2 + i * (w + gapX), y: s * rowH + 28 }; });
  });
  return { width, height: stages * rowH, pos, w, labels: flow.stages.map((t, s) => ({ t, x: width / 2, y: s * rowH + 16 })) };
}

// Every box upstream and downstream of `id`, and the edges between them.
function pathOf(edges, id) {
  if (!id) return null;
  const up = new Set([id]), down = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [a, b] of edges) {
      if (down.has(a) && !down.has(b)) { down.add(b); grew = true; }
      if (up.has(b) && !up.has(a)) { up.add(a); grew = true; }
    }
  }
  const boxes = new Set([...up, ...down]);
  const lit = new Set(edges.filter(([a, b]) => (down.has(a) && down.has(b)) || (up.has(a) && up.has(b))).map(e => e.join(">")));
  return { boxes, lit };
}

const ago = (at, now) => {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${countWords(Math.round(s / 60), "minute")} ago`;
  if (s < 2 * 86400) return `${countWords(Math.round(s / 3600), "hour")} ago`;
  return `${countWords(Math.round(s / 86400), "day")} ago`;
};
const boxHealthy = b => b.modules.every(m => m.exists) && b.jobs.every(j => !j.dead) && !(b.area && b.area.failed);

function Details({ box, health, now }) {
  const h = health || {};
  return <section className="db3f-card" key={box.id} data-box-detail={box.id} aria-live="polite">
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
      <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: 0 }}>{box.title}</h3>
      <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600,
        background: boxHealthy(box) ? EMERALD : BRASS, color: boxHealthy(box) ? WHITE : INK }}>{boxHealthy(box) ? "healthy" : "look at this"}</span>
    </div>
    <p style={{ margin: "0 0 20px", lineHeight: 1.55, maxWidth: 760 }}>{box.says}</p>
    <div className="db3f-grid">
      <div>
        <h4 style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, margin: "0 0 8px" }}>Lives in</h4>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {box.modules.map(m => <li key={m.path} data-module={m.path} style={{ fontSize: 13 }}>
            <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, background: CREAM, padding: "2px 6px", borderRadius: 5, wordBreak: "break-all" }}>{m.path}</code>
            {m.exists ? null : <span style={{ marginLeft: 6, fontWeight: 700 }}>missing</span>}
          </li>)}
        </ul>
      </div>
      <div>
        <h4 style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, margin: "0 0 8px" }}>Live health</h4>
        {box.jobs.length ? <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          {box.jobs.map(j => <li key={j.name}><strong>{j.name}</strong>: {j.lastDone ? `last done ${ago(j.lastDone, now)}` : "no run on record yet"}
            {j.waiting || j.running ? `, ${j.waiting} waiting, ${j.running} running` : ""}
            {j.dead ? <span style={{ fontWeight: 700 }}>, {countWords(j.dead, "run")} stopped this week</span> : null}</li>)}
        </ul> : <p style={{ fontSize: 13, margin: "0 0 10px", opacity: 0.75 }}>Runs inside the request; no queue job of its own.</p>}
        <p style={{ fontSize: 13, margin: "0 0 4px" }}><strong>Worker:</strong> {h.worker ? h.worker.detail : "not read"}</p>
        <p style={{ fontSize: 13, margin: 0 }}><strong>Queue:</strong> {h.queue ? h.queue.detail : "not read"}</p>
      </div>
      <div>
        <h4 style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, margin: "0 0 8px" }}>On the Map</h4>
        {box.area ? <>
          <p style={{ fontSize: 14, margin: "0 0 6px", fontWeight: 600 }}>{box.area.name}</p>
          <p style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
            {countLabel(box.area.checks, "check")}: {box.area.passed} passed and {box.area.failed} failed on the last walk
            {box.area.open ? `, ${countWords(box.area.open, "open item")}` : ""}.</p>
          <a href={`/ops?tab=map#area-${box.area.id}`} style={{ color: EMERALD, fontWeight: 600, fontSize: 13 }}>Open {box.area.name} on the Map</a>
        </> : <p style={{ fontSize: 13, opacity: 0.75, margin: 0 }}>No Map area named for this box.</p>}
      </div>
    </div>
  </section>;
}

export default function FlowView({ data, error, initialSelected = null, now = Date.now() }) {
  const [sel, setSel] = useState(initialSelected);
  const [hover, setHover] = useState(null);
  const [mode, setMode] = useState("wide");
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 860px)");
    const set = () => setMode(mq.matches ? "narrow" : "wide");
    set();
    mq.addEventListener ? mq.addEventListener("change", set) : mq.addListener(set);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", set) : mq.removeListener(set));
  }, []);
  const L = useMemo(() => (data && data.ok ? layout(data, mode) : null), [data, mode]);
  if (error) return <p style={{ fontSize: 14 }}>{error}</p>;
  if (!data) return <p style={{ fontSize: 14, opacity: 0.7 }}>Reading the flow…</p>;
  if (!data.ok) return <p style={{ fontSize: 14 }}>{data.error}</p>;

  const focus = pathOf(data.edges, hover || sel);
  const byId = new Map(data.boxes.map(b => [b.id, b]));
  const box = sel ? byId.get(sel) : null;
  const w = L.w;
  const edgePath = ([a, b]) => {
    const p = L.pos[a], q = L.pos[b];
    if (mode === "wide") { const x1 = p.x + w, y1 = p.y + BOX_H / 2, x2 = q.x, y2 = q.y + BOX_H / 2, mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; }
    const x1 = p.x + w / 2, y1 = p.y + BOX_H, x2 = q.x + w / 2, y2 = q.y, my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  };

  return <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
    <style>{CSS}</style>
    <header>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: "0 0 6px", letterSpacing: "-0.01em" }}>How a gift flows</h2>
      <p style={{ margin: 0, fontSize: 15, opacity: 0.78, maxWidth: 720, lineHeight: 1.5 }}>
        From the moment money arrives to the receipt and the report. Hover a box to light its path; click it for the code it lives in and how it is running now.
        Steward drafts and proposes; a person sends.</p>
      {data.problems && data.problems.length ? <p style={{ margin: "10px 0 0", fontSize: 13 }}>
        <span style={{ background: BRASS, padding: "2px 8px", borderRadius: 999, fontWeight: 600, marginRight: 6 }}>flow.json</span>{data.problems.join("; ")}</p> : null}
    </header>

    <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${INK}0f`, padding: mode === "wide" ? "22px 18px" : "16px 8px" }}>
      <svg viewBox={`0 0 ${L.width} ${L.height}`} width="100%" role="group" aria-label="How a gift flows through Steward"
        style={{ display: "block", maxWidth: mode === "wide" ? L.width : 420, margin: "0 auto", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        {L.labels.map((l, i) => <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize="10.5" fontWeight="700" letterSpacing=".06em"
          fill={INK} fillOpacity=".5" stroke={WHITE} strokeWidth="5" strokeLinejoin="round" paintOrder="stroke">{l.t.toUpperCase()}</text>)}
        {data.edges.map((e, i) => { const k = e.join(">"), on = focus && focus.lit.has(k);
          return <path key={k} d={edgePath(e)} fill="none" className={`db3f-edge draw${focus && !on ? " db3f-dim" : ""}`}
            stroke={on ? EMERALD : `${INK}40`} strokeWidth={on ? 2.4 : 1.4} style={{ animationDelay: `${300 + i * 40}ms` }} />; })}
        {data.boxes.map((b, i) => {
          const p = L.pos[b.id], on = focus && focus.boxes.has(b.id), chosen = sel === b.id;
          const ls = lines(b.title, mode === "wide" ? 15 : 12);
          return <g key={b.id} className={`db3f-box${focus && !on ? " db3f-dim" : ""}`} role="button" tabIndex={0} data-box={b.id}
            aria-pressed={chosen} aria-label={`${b.title}: open details`}
            onClick={() => setSel(chosen ? null : b.id)} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(b.id)} onBlur={() => setHover(null)}
            onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setSel(chosen ? null : b.id); } }}>
            <g className="in" style={{ animationDelay: `${b.stage * 90 + i * 15}ms` }}>
              <rect className="face" x={p.x} y={p.y} width={w} height={BOX_H} rx="12"
                fill={chosen ? EMERALD : on ? CREAM : WHITE} stroke={chosen || on ? EMERALD : `${INK}26`} strokeWidth={chosen ? 2 : 1.2} />
              <circle cx={p.x + w - 11} cy={p.y + 11} r="3.6" fill={boxHealthy(b) ? (chosen ? WHITE : EMERALD) : BRASS} />
              {ls.map((t, k) => <text key={k} x={p.x + w / 2} y={p.y + BOX_H / 2 + (k - (ls.length - 1) / 2) * 15 + 4.5} textAnchor="middle"
                fontSize={mode === "wide" ? 13 : 12} fontWeight="600" fill={chosen ? WHITE : INK}>{t}</text>)}
            </g>
          </g>;
        })}
      </svg>
    </div>

    {box ? <Details box={box} health={data.health} now={now} />
      : <p style={{ fontSize: 14, opacity: 0.7, margin: 0, textAlign: "center" }}>Choose a box to see where it lives and how it is running.</p>}
  </div>;
}
