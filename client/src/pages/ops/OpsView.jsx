// DEVBOARD-1 · /ops, the view. Pure: it draws the one answer of GET /ops and
// fetches nothing, so tests/devboard1-ops.test.js can render it with a source
// down. Each section says so when its source could not be read.
import { useState } from "react";
import { countLabel } from "../../../../shared/countWords.js";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const STATES = ["open", "reopened", "fixed", "verified"];
const SOURCES = ["walk", "jonathan", "customer", "build follow-up"];   // DEVBOARD-2: "jonathan" is a Fail marked on the Map tab

const page = { background: CREAM, minHeight: "100vh", color: INK, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 16px 48px" };
const sheet = { maxWidth: 1100, margin: "0 auto" };
const card = { background: WHITE, borderRadius: 10, padding: "18px 20px", marginBottom: 18, border: `1px solid rgba(15,26,18,0.08)` };
const h2 = { fontSize: 17, fontWeight: 700, margin: "0 0 4px" };
const says = { fontSize: 13, opacity: 0.7, margin: "0 0 12px" };
const cell = { padding: "6px 10px 6px 0", fontSize: 13, verticalAlign: "top", borderTop: `1px solid ${CREAM}` };
const pill = good => ({ display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600,
  background: good === true ? EMERALD : good === false ? BRASS : CREAM, color: good === true ? WHITE : INK });

export function ago(iso, now) {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${Math.floor(h / 24)} days`;
}
const short = s => (s ? String(s).slice(0, 7) : "none");
const levelGood = l => (l === "ok" ? true : l === "yellow" || l === "red" ? false : null);

function Down({ error }) {
  return <p style={{ ...says, opacity: 1, color: INK, background: CREAM, padding: "8px 10px", borderRadius: 6 }}>
    <span style={pill(false)}>unavailable</span> {error || "This could not be read."}</p>;
}

function Row({ label, good, value, detail }) {
  return <tr><td style={{ ...cell, width: 150, fontWeight: 600 }}>{label}</td>
    <td style={{ ...cell, width: 150 }}><span style={pill(good)}>{value}</span></td><td style={cell}>{detail}</td></tr>;
}

function Health({ h, now }) {
  const ci = h.ci || {}, load = h.load || {};
  const stepGood = s => (s === "success" ? true : s == null ? null : s === "in_progress" || s === "queued" ? null : false);
  const running = ci.run && !["success", "failure", "cancelled", "skipped", "timed_out"].includes(ci.run);
  const stepWord = s => s || (running ? "running" : "not run");
  return <section style={card}>
    <h2 style={h2}>Prod health</h2>
    <p style={says}>The same checks as npm run status, read on the server. The web, the worker and the frontend should be on one commit.</p>
    <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
      <Row label="Commits" good={h.aligned} value={h.aligned === true ? "aligned" : h.aligned === false ? "not aligned" : "unverified"}
        detail={`web ${short(h.shas.web)} · worker ${short(h.shas.worker)} · frontend ${h.shas.frontend ? short(h.shas.frontend) : (h.frontendError || "unknown")}`} />
      <Row label="Worker" good={h.worker.ok} value={h.worker.ok ? "ok" : h.worker.ok === false ? "check" : "unverified"} detail={h.worker.detail} />
      {ci.ok === false ? <tr><td style={{ ...cell, fontWeight: 600 }}>Smoke</td><td colSpan={2} style={cell}><Down error={ci.error} /></td></tr> : <>
        <Row label="Smoke" good={stepGood(ci.smoke)} value={stepWord(ci.smoke)} detail={`the deploy of ${short(ci.sha)} on main${ci.at ? `, ${ago(ci.at, now)} ago` : ""}`} />
        <Row label="AI smoke" good={stepGood(ci.aiSmoke)} value={stepWord(ci.aiSmoke)} detail="one Ask and one Agent plan on prod, saving nothing" />
      </>}
      <Row label="Queue" good={levelGood(h.queue.level)} value={h.queue.level || "unverified"} detail={h.queue.detail} />
      <Row label="Pool" good={levelGood(h.pool.level)} value={h.pool.level || "unverified"} detail={h.pool.detail} />
      {load.ok === false ? <tr><td style={{ ...cell, fontWeight: 600 }}>Nightly load</td><td colSpan={2} style={cell}><Down error={load.error} /></td></tr>
        : <Row label="Nightly load" good={levelGood(load.level)} value={load.level === "ok" ? "passed" : load.level === "red" ? "failed" : "unverified"} detail={load.detail} />}
      <Row label="Mailboxes" good={h.mailbox.ok} value={h.mailbox.ok ? "ok" : h.mailbox.ok === false ? "reconnect" : "unverified"}
        detail={[h.mailbox.detail, ...(h.mailbox.lines || [])].join(" · ")} />
      <Row label="Guards" good={h.guards.ok === true ? true : h.guards.ok === false ? false : null} value={h.guards.ok ? "ok" : h.guards.ok === false ? "failing" : "unverified"}
        detail={h.guards.failed && h.guards.failed.length ? `failing: ${h.guards.failed.join(", ")}` : "every guard on /health is clean and fresh"} />
    </tbody></table>
  </section>;
}

function Board({ board, onShot }) {
  const [source, setSource] = useState("");
  const [state, setState] = useState("live");
  if (!board.ok) return <section style={card}><h2 style={h2}>The board</h2><Down error={board.error} /></section>;
  const keep = it => (!source || it.source === source) && (state === "all" || (state === "live" ? it.state === "open" || it.state === "reopened" : it.state === state));
  const groups = board.builds.map(g => ({ ...g, shown: g.items.filter(keep) })).filter(g => g.shown.length);
  const sel = { fontSize: 13, padding: "4px 6px", marginRight: 8, border: `1px solid ${INK}33`, borderRadius: 6, background: WHITE, color: INK };
  return <section style={card}>
    <h2 style={h2}>The board</h2>
    <p style={says}>Every finding, from a walk, your checks on the Map, a customer or a build. Open → fixed when its build merges → verified when the next walk passes it.
      {" "}{STATES.map(s => `${board.counts[s]} ${s}`).join(" · ")}.</p>
    <div style={{ marginBottom: 10 }}>
      <select aria-label="Source" style={sel} value={source} onChange={e => setSource(e.target.value)}>
        <option value="">Every source</option>{SOURCES.map(s => <option key={s} value={s}>{s}</option>)}</select>
      <select aria-label="State" style={sel} value={state} onChange={e => setState(e.target.value)}>
        <option value="live">Open and reopened</option>{STATES.map(s => <option key={s} value={s}>{s}</option>)}<option value="all">Every state</option></select>
    </div>
    {groups.length === 0 && <p style={says}>No item matches.</p>}
    {groups.map(g => <div key={g.build || "none"} style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14, margin: "6px 0" }}>
        {g.build ? (g.url ? <a href={g.url} style={{ color: EMERALD }}>{g.build}</a> : g.build) : "No build yet"}
        <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>
          {"  "}{STATES.filter(s => g.counts[s]).map(s => `${g.counts[s]} ${s}`).join(" · ")}{g.build ? ` · report .claude/reports/${g.build}.md` : ""}</span></div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
        {g.shown.map(it => <tr key={it.id}>
          <td style={{ ...cell, width: 190, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{it.id}</td>
          <td style={cell}>{it.words}{it.customer ? <span style={{ opacity: 0.7 }}> · from {it.customer}</span> : null}
            {it.check && it.source === "jonathan" ? <span style={{ opacity: 0.7 }}> · {it.check}</span> : null}
            {it.verifiedBy === "jonathan" ? <span style={{ opacity: 0.7 }}> · you passed it on the Map</span> : null}
            {it.shot && onShot ? <> · <button type="button" onClick={() => onShot(it.shot)} style={{ color: EMERALD, background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>screenshot</button></> : null}</td>
          <td style={{ ...cell, width: 110 }}>{it.source}</td>
          <td style={{ ...cell, width: 90 }}><span style={pill(it.state === "verified" ? true : it.state === "open" || it.state === "reopened" ? false : null)}>{it.state}</span></td>
        </tr>)}
      </tbody></table>
    </div>)}
  </section>;
}

function Builds({ builds, now }) {
  return <section style={card}>
    <h2 style={h2}>Builds</h2>
    <p style={says}>Each open pull request, and each merged in the last three days, with how long it has been in its state. A tab with no push or CI for 45 minutes is called quiet; one with none for a week is parked.</p>
    {!builds.ok ? <Down error={builds.error} /> : builds.rows.length === 0 ? <p style={says}>No open or recent pull request.</p> :
      <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
        {builds.rows.map(b => <tr key={b.number}>
          <td style={{ ...cell, width: 60 }}><a href={b.url} style={{ color: EMERALD }}>#{b.number}</a></td>
          <td style={cell}>{b.title}{b.note ? <span style={{ opacity: 0.7 }}> · {b.note}</span> : null}</td>
          <td style={{ ...cell, width: 100 }}><span style={pill(b.state === "live" || b.state === "green" ? true : b.state === "red" ? false : null)}>{b.state}</span></td>
          <td style={{ ...cell, width: 170 }}>{b.state === "merged" || b.state === "live" ? `merged ${ago(b.since, now)} ago` : b.state === "parked" ? `no push or CI for ${ago(b.since, now)}` : `${ago(b.since, now)} in this state`}{b.quietMinutes ? <div style={{ ...pill(false), marginTop: 3 }}>quiet {ago(new Date(now - b.quietMinutes * 60000).toISOString(), now)}</div> : null}</td>
        </tr>)}
      </tbody></table>}
    {builds.ok && builds.bots ? <p style={{ ...says, marginTop: 8 }}>{countLabel(builds.bots, "pull request")} from bots (dependency bumps) not shown.</p> : null}
  </section>;
}

function Trend({ walks }) {
  if (!walks.length) return <section style={card}><h2 style={h2}>The walk trend</h2><p style={says}>No walk imported yet: node scripts/ops/board-import-walk.js &lt;report.md&gt; --write.</p></section>;
  const W = 640, H = 140, P = 28, max = Math.max(1, ...walks.map(w => w.fail));
  const x = i => P + (walks.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (walks.length - 1));
  const y = v => H - P - (v / max) * (H - 2 * P);
  return <section style={card}>
    <h2 style={h2}>The walk trend</h2>
    <p style={says}>Fails per walk, each morning's report as imported. {walks.map(w => w.fail).join(", ")}.</p>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto" }} role="img" aria-label="Fails per walk">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke={INK} strokeOpacity="0.2" />
      <polyline fill="none" stroke={EMERALD} strokeWidth="2" points={walks.map((w, i) => `${x(i)},${y(w.fail)}`).join(" ")} />
      {walks.map((w, i) => <g key={w.date}><circle cx={x(i)} cy={y(w.fail)} r="3.5" fill={EMERALD} />
        <text x={x(i)} y={y(w.fail) - 8} fontSize="11" textAnchor="middle" fill={INK}>{w.fail}</text>
        <text x={x(i)} y={H - 10} fontSize="10" textAnchor="middle" fill={INK} opacity="0.6">{w.date.slice(5)}</text></g>)}
    </svg>
    <table style={{ borderCollapse: "collapse", marginTop: 8 }}><tbody>
      {walks.slice(-7).reverse().map(w => <tr key={w.date}><td style={{ ...cell, width: 100 }}>{w.date}</td>
        <td style={cell}>{w.fail} fail · {w.pass} pass · {w.skip} skip</td></tr>)}
    </tbody></table>
  </section>;
}

// PERF-4: the page-ready mark (client/src/lib/pageReady.js) as browsers report
// it to this web process: time only, kept a day in memory, so a deploy starts it again.
function PageTiming({ t }) {
  const ms = v => (v == null ? "–" : `${(v / 1000).toFixed(1)} s`);
  const NAMES = { home: "Home", donors: "Donors", profile: "A profile", fundraising: "Fundraising", "giving-report": "Giving report", journeys: "Journeys", settings: "Settings" };
  return <section style={card} data-testid="ops-page-timing">
    <h2 style={h2}>Page timing</h2>
    <p style={says}>How long each page took to be ready (drawn, its numbers in, no spinner), as people's browsers reported it to this web process since {t && t.since ? t.since.slice(0, 16).replace("T", " ") + " UTC" : "its last deploy"}. First is the first page after signing in or a reload; Moved is a page opened from inside the app. Median and the slowest one in twenty; the bar is 2 s.</p>
    {!t ? <p style={says}>Not reported yet.</p> :
      <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
        <tr><td style={cell} /><td style={{ ...cell, fontWeight: 600 }}>First</td><td style={{ ...cell, fontWeight: 600 }}>Moved</td></tr>
        {t.pages.map(r => <tr key={r.page}><td style={{ ...cell, fontWeight: 600 }}>{NAMES[r.page] || r.page}</td>
          <td style={cell}>{r.first.n ? `${ms(r.first.p50)} · ${ms(r.first.p95)} (${r.first.n})` : "none yet"}</td>
          <td style={cell}>{r.moved.n ? `${ms(r.moved.p50)} · ${ms(r.moved.p95)} (${r.moved.n})` : "none yet"}</td></tr>)}
      </tbody></table>}
  </section>;
}

function Customers({ customers, now }) {
  return <section style={card}>
    <h2 style={h2}>Customers</h2>
    <p style={says}>One row per live org (Kind is Customer, not archived): its last sign-in, and the board items still open that came from it.</p>
    {!customers.ok ? <Down error={customers.error} /> : customers.rows.length === 0 ? <p style={says}>No live customer org.</p> :
      <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
        {customers.rows.map(c => <tr key={c.name}><td style={{ ...cell, fontWeight: 600 }}>{c.name}</td>
          <td style={cell}>{c.lastLogin ? `signed in ${ago(c.lastLogin, now)} ago` : "never signed in"}</td>
          <td style={cell}>{countLabel(c.open, "open item")}</td></tr>)}
      </tbody></table>}
  </section>;
}

export default function OpsView({ data, error, now = Date.now(), tabs = null, onShot = null }) {
  if (error) return <div style={page}><div style={sheet}><h1 style={{ fontSize: 24 }}>Ops</h1>{tabs}<Down error={error} /></div></div>;
  if (!data) return <div style={page}><div style={sheet}><h1 style={{ fontSize: 24 }}>Ops</h1>{tabs}<p style={says}>Loading…</p></div></div>;
  return <div style={page}><div style={sheet}>
    <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Ops</h1>
    {tabs}
    <p style={says}>{data.refreshedAt ? `Summaries refreshed ${ago(data.refreshedAt, now)} ago by the worker${data.stale ? ", which is late: it should refresh every five minutes" : ""}.` : "The worker has not refreshed the summaries yet."}
      {data.githubAt ? ` GitHub read ${ago(data.githubAt, now)} ago.` : ""}</p>
    <Health h={data.health} now={now} />
    <Board board={data.board} onShot={onShot} />
    <Builds builds={data.builds} now={now} />
    <Trend walks={data.board.ok ? data.board.walks : []} />
    <PageTiming t={data.pageTiming} />
    <Customers customers={data.customers} now={now} />
  </div></div>;
}
