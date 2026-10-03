// REPORTS-3 — SAVED DASHBOARDS AND THE BOARD PACK.
//
// From Reports she picks tiles, arranges them, names the dashboard and keeps
// it private or shares it with the team. The board pack is the same numbers as
// a PDF, on a schedule, to the org's own staff and board addresses.
//
// NOTHING HERE DRAWS A NUMBER OF ITS OWN. Every figure is a <Figure> carrying
// the `source` the server computed it from, so clicking it opens the rows
// behind it and they foot to it — the same contract the four Steward
// dashboards are under. A tile whose number could not open would be a number
// nobody can check, and this screen's whole job is numbers a board can check.
//
// It also draws no new layout language: the cards, tiles and rows are the ones
// Dashboards.jsx already uses, imported rather than copied, and a list tile is
// the ReportTable every report on this screen is drawn by.
import { useEffect, useState } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, Card, Spin, EmptyState } from "./shared";
import { Tile, GivingLine, Def, Eyebrow } from "./Dashboards";
import { ReportTable } from "./ReportBuilder";
import { errorMessage } from "../lib/domainError";
import { useUrlWriter } from "./RecordLink";
import { tabHref } from "../lib/appUrls";

const SD_CSS = `
.sd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:start}
.sd-wide{grid-column:1/-1}
.sd-pick{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:860px){.sd-pick{grid-template-columns:minmax(0,1fr)}}
`;

const btn = (on = false) => ({
  background: on ? T.greenDk : T.white, color: on ? T.white : T.greenDk,
  border: `1.5px solid ${T.greenDk}`, borderRadius: 10, padding: "8px 16px",
  fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
});
const quiet = {
  background: T.white, color: T.ink, border: `1.5px solid ${T.bg3}`, borderRadius: 10,
  padding: "8px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
};
const fieldStyle = { padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${T.bg3}`, background: T.white,
  color: T.ink, fontSize: 13, fontFamily: "'DM Sans',sans-serif", maxWidth: "100%", boxSizing: "border-box" };

async function download(path, name) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Download failed"); }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const qsOf = f => {
  const q = new URLSearchParams();
  for (const k of ["from", "to", "fund", "campaign", "owner", "group"]) if (f[k]) q.set(k, f[k]);
  return q.toString();
};

// ── THE FILTER BAR ─────────────────────────────────────────────────────────
// Date range, fund, campaign and owner. They save with the dashboard and they
// live in the URL, so a dashboard opens, reloads and shares as the same
// numbers rather than as whatever today's defaults happen to be.
function FilterBar({ value, funds, campaigns, officers, groups = [], onChange, onSaveDefault, saving }) {
  const set = (k, v) => onChange({ ...value, [k]: v || "" });
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
    <input type="date" aria-label="From" value={value.from || ""} onChange={e => set("from", e.target.value)} style={fieldStyle} />
    <span style={{ fontSize: 12, color: T.ink3 }}>to</span>
    <input type="date" aria-label="To" value={value.to || ""} onChange={e => set("to", e.target.value)} style={fieldStyle} />
    <select aria-label="Fund" value={value.fund || ""} onChange={e => set("fund", e.target.value)} style={fieldStyle}>
      <option value="">All funds</option>
      {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
    <select aria-label="Campaign" value={value.campaign || ""} onChange={e => set("campaign", e.target.value)} style={fieldStyle}>
      <option value="">All campaigns</option>
      {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
    <select aria-label="Owner" value={value.owner || ""} onChange={e => set("owner", e.target.value)} style={fieldStyle}>
      <option value="">Anyone</option>
      {officers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
    </select>
    {/* PARITY-1 Part D — gift figures from one Group's people only. */}
    <select aria-label="Group" value={value.group || ""} onChange={e => set("group", e.target.value)} style={fieldStyle}>
      <option value="">Every group</option>
      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
    {onSaveDefault && <button type="button" style={quiet} onClick={onSaveDefault} disabled={saving}>
      {saving ? "Saving…" : "Save these filters"}
    </button>}
  </div>;
}

function useFilterLists() {
  const [funds, setFunds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    apiFetch("/groups").then(r => setGroups((r && r.groups) || [])).catch(() => {});
    apiFetch("/finance/funds").then(r => setFunds(Array.isArray(r) ? r : [])).catch(() => {});
    apiFetch("/campaigns").then(r => setCampaigns(Array.isArray(r) ? r : [])).catch(() => {});
    // The officer list every other screen reads, so "owner" here means the
    // same person it means in the donor directory.
    apiFetch("/portfolio/officers").then(r => setOfficers(r.officers || [])).catch(() => {});
  }, []);
  return { funds, campaigns, officers, groups };
}

// ── ONE SAVED DASHBOARD ────────────────────────────────────────────────────
export function SavedDashboardView({ id, onNavigate, onEdit, onDeleted }) {
  const goUrl = useUrlWriter();
  const { funds, campaigns, officers, groups } = useFilterLists();
  const urlFilters = () => {
    const q = new URLSearchParams(window.location.search);
    const out = {};
    for (const k of ["from", "to", "fund", "campaign", "owner", "group"]) if (q.get(k)) out[k] = q.get(k);
    return out;
  };
  const [filters, setFilters] = useState(urlFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const qs = qsOf(filters);

  // The filters in the address bar, replaced: changing a filter is not a step
  // Back should have to undo one at a time.
  useEffect(() => {
    if (!/^\/app\/reports\/?$/.test(window.location.pathname)) return;
    goUrl(tabHref("reports", { report: "sdash:" + id, from: filters.from, to: filters.to,
      fundId: filters.fund, campaignId: filters.campaign, owner: filters.owner, group: filters.group }), true);
  }, [id, qs]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let dead = false;
    setLoading(true); setErr("");
    apiFetch(`/saved-dashboards/${encodeURIComponent(id)}/run${qs ? "?" + qs : ""}`)
      .then(d => { if (!dead) { setData(d); setLoading(false); } })
      .catch(e => { if (!dead) { setErr(errorMessage(e, "That dashboard would not open.")); setLoading(false); } });
    return () => { dead = true; };
  }, [id, qs]);

  // The dashboard's OWN saved filters are the starting point the first time it
  // is opened without any in the URL.
  useEffect(() => {
    if (!data || Object.keys(filters).length) return;
    if (data.filters && Object.keys(data.filters).length) setFilters(data.filters);
  }, [data]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function saveFilters() {
    setSaving(true);
    try { await apiFetch(`/saved-dashboards/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ filters }) }); }
    catch (e) { alert(errorMessage(e, "Those filters would not save.")); }
    setSaving(false);
  }
  async function remove() {
    if (!window.confirm("Delete this dashboard? The reports and numbers on it are not affected.")) return;
    try { await apiFetch(`/saved-dashboards/${encodeURIComponent(id)}`, { method: "DELETE" }); onDeleted && onDeleted(); }
    catch (e) { alert(errorMessage(e, "That dashboard would not delete.")); }
  }
  async function pdf() {
    setBusy(true);
    try { await download(`/board-pack/pdf?dashboard=${encodeURIComponent(id)}${qs ? "&" + qs : ""}`, `${(data && data.title) || "dashboard"}.pdf`); }
    catch (e) { alert(errorMessage(e, "The PDF would not download.")); }
    setBusy(false);
  }

  // THE FILTER BAR STAYS ON SCREEN WHILE THE TILES RELOAD.
  // It used to return a bare spinner whenever `loading` was true, which
  // unmounted the whole view — including the input being typed in. Changing a
  // filter therefore destroyed the control you changed it with: focus was
  // lost after the first keystroke and a date could not be typed at all. Only
  // the tiles below are replaced now, so the header and the filters you are
  // working in never move. (Found by typing a date in a browser; no server
  // test can see this.)
  if (err) return <Card style={{ padding: "22px 24px" }}><div style={{ fontSize: 13, color: T.terracotta }}>{err}</div></Card>;
  if (loading && !data) return <Card style={{ padding: 30 }}><Spin /></Card>;
  if (!data) return null;

  return <div><style>{SD_CSS}</style>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
      <div style={{ minWidth: 0, flex: "1 1 360px" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{data.title}</div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>
          {data.period.label}. Every number opens: click it to see the rows behind it.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={quiet} onClick={onEdit}>Edit tiles</button>
        <button type="button" style={quiet} onClick={remove}>Delete</button>
        <button type="button" style={btn()} onClick={pdf} disabled={busy}>{busy ? "Building…" : "Download PDF"}</button>
      </div>
    </div>
    <FilterBar value={filters} funds={funds} campaigns={campaigns} officers={officers} groups={groups}
      onChange={setFilters} onSaveDefault={saveFilters} saving={saving} />
    <div style={{ opacity: loading ? 0.45 : 1, transition: "opacity .15s" }} aria-busy={loading ? "true" : undefined}>
      <TileGrid sections={data.sections} onNavigate={onNavigate} />
    </div>
  </div>;
}

// Each tile, drawn by the component its kind already has.
function TileGrid({ sections, onNavigate }) {
  if (!sections.length) return <EmptyState icon="▤" title="No tiles yet" message="Edit the tiles and pick what this dashboard should show." />;
  return <div className="sd-grid">
    {sections.map(s => {
      if (s.kind === "figures") {
        const f = s.figures[0];
        return <section key={s.key} className="dash-card">
          <Eyebrow>{s.title}{f && f.definition ? <Def text={f.definition} /> : null}</Eyebrow>
          <div className="dash-tiles wide">
            {s.figures.map(x => <Tile key={x.key} m={{ ...x, key: x.key }} />)}
          </div>
          {f && f.note && <div style={{ fontSize: 11.5, color: T.gold, marginTop: 8 }}>{f.note}</div>}
        </section>;
      }
      if (s.kind === "chart") {
        return <section key={s.key} className="dash-card sd-wide">
          <GivingLine m={{ label: s.title, definition: s.definition, value: s.points }} />
        </section>;
      }
      if (s.kind === "report") {
        return <section key={s.key} className="dash-card sd-wide">
          <Eyebrow>{s.title}{s.definition ? <Def text={s.definition} /> : null}</Eyebrow>
          <ReportTable cols={s.columns || []} rows={s.rows || []} personOf={r => r._pid || null}
            onOpen={id => onNavigate && onNavigate("donors", { selectDonorId: id })}
            testid={`sd-list-${s.key}`} />
          {s.totalRows > (s.rows || []).length && <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>
            {(s.totalRows - s.rows.length).toLocaleString("en-US")} more rows in the report.
          </div>}
        </section>;
      }
      if (s.kind === "missing") {
        return <section key={s.key} className="dash-card">
          <Eyebrow>{s.title}</Eyebrow>
          <div style={{ fontSize: 12.5, color: T.gold, lineHeight: 1.6 }}>{s.definition}</div>
        </section>;
      }
      return null;
    })}
  </div>;
}

// ── PICKING THE TILES ──────────────────────────────────────────────────────
// The catalogue is the server's: every figure source, the one chart and every
// report. Arranging is moving a tile up or down, which is the whole of
// "arrange them" a one-column-of-cards layout can honestly offer.
export function DashboardBuilder({ editId, onSaved, onCancel }) {
  const [cat, setCat] = useState(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [tiles, setTiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState("figure");
  const [pick, setPick] = useState("");

  useEffect(() => { apiFetch("/dashboard-tiles").then(setCat).catch(() => setCat({ figures: [], charts: [], reports: [] })); }, []);
  useEffect(() => {
    if (!editId) return;
    apiFetch("/saved-dashboards").then(r => {
      const row = (r.dashboards || []).find(d => d.id === editId);
      if (row) { setName(row.name); setShared(!!row.shared); }
    }).catch(() => {});
    apiFetch(`/saved-dashboards/${encodeURIComponent(editId)}/run`).then(d => {
      if (d && d.dashboard) setName(d.dashboard.name);
    }).catch(() => {});
    apiFetch(`/saved-dashboards`).catch(() => {});
  }, [editId]);

  const add = () => {
    if (!pick) return;
    if (kind === "figure") setTiles(t => [...t, { kind: "figure", source: pick, params: {} }]);
    else if (kind === "chart") setTiles(t => [...t, { kind: "chart", chart: pick }]);
    else setTiles(t => [...t, { kind: "list", report: pick, limit: 10 }]);
    setPick("");
  };
  const move = (i, d) => setTiles(t => {
    const j = i + d;
    if (j < 0 || j >= t.length) return t;
    const c = [...t]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const drop = i => setTiles(t => t.filter((_, x) => x !== i));

  const labelOf = t => {
    if (!cat) return t.source || t.chart || t.report;
    if (t.kind === "figure") return (cat.figures.find(f => f.key === t.source) || {}).label || t.source;
    if (t.kind === "chart") return (cat.charts.find(c => c.key === t.chart) || {}).label || t.chart;
    return (cat.reports.find(r => r.id === t.report) || {}).name || t.report;
  };

  async function save() {
    setSaving(true); setErr("");
    try {
      const body = JSON.stringify({ name, tiles, shared });
      const r = editId
        ? await apiFetch(`/saved-dashboards/${encodeURIComponent(editId)}`, { method: "PUT", body })
        : await apiFetch("/saved-dashboards", { method: "POST", body });
      onSaved && onSaved(editId || r.id);
    } catch (e) { setErr(errorMessage(e, "That dashboard would not save.")); }
    setSaving(false);
  }

  const options = !cat ? [] : kind === "figure" ? cat.figures.map(f => [f.key, f.label])
    : kind === "chart" ? cat.charts.map(c => [c.key, c.label])
    : cat.reports.map(r => [r.id, r.name]);

  return <Card style={{ padding: "20px 24px" }}><style>{SD_CSS}</style>
    <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginBottom: 4 }}>{editId ? "Edit this dashboard" : "A new dashboard"}</div>
    <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 16, lineHeight: 1.6 }}>
      Pick the numbers, charts and lists this dashboard should show, put them in the order you want, and give it a name.
      Every tile keeps its own definition and opens the rows behind it.
    </div>
    <div className="sd-pick">
      <div>
        <Eyebrow>What goes on it</Eyebrow>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {[["figure", "A number"], ["chart", "A chart"], ["list", "A list"]].map(([k, l]) =>
            <button key={k} type="button" onClick={() => { setKind(k); setPick(""); }} aria-pressed={kind === k}
              style={kind === k ? btn(true) : quiet}>{l}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select aria-label="Pick a tile" value={pick} onChange={e => setPick(e.target.value)} style={{ ...fieldStyle, flex: "1 1 220px" }}>
            <option value="">Choose…</option>
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" style={btn()} onClick={add} disabled={!pick}>Add</button>
        </div>
      </div>
      <div>
        <Eyebrow>In this order</Eyebrow>
        {!tiles.length && <div style={{ fontSize: 12.5, color: T.ink3 }}>Nothing on it yet.</div>}
        {tiles.map((t, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
          borderTop: i === 0 ? "none" : `1px solid ${T.bg2}` }}>
          <span style={{ fontSize: 13, color: T.ink, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{labelOf(t)}</span>
          <button type="button" aria-label="Move up" onClick={() => move(i, -1)} style={{ ...quiet, padding: "4px 9px" }}>↑</button>
          <button type="button" aria-label="Move down" onClick={() => move(i, 1)} style={{ ...quiet, padding: "4px 9px" }}>↓</button>
          <button type="button" aria-label="Remove" onClick={() => drop(i)} style={{ ...quiet, padding: "4px 9px" }}>×</button>
        </div>)}
      </div>
    </div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.bg2}` }}>
      <input type="text" aria-label="Dashboard name" placeholder="Name this dashboard" value={name}
        onChange={e => setName(e.target.value)} style={{ ...fieldStyle, flex: "1 1 240px" }} />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: T.ink2 }}>
        <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />
        Share with the team
      </label>
      <div style={{ flex: 1 }} />
      <button type="button" style={quiet} onClick={onCancel}>Cancel</button>
      <button type="button" style={btn(true)} onClick={save} disabled={saving || !name.trim() || !tiles.length}>
        {saving ? "Saving…" : "Save dashboard"}
      </button>
    </div>
    {err && <div style={{ fontSize: 12.5, color: T.terracotta, marginTop: 10 }}>{err}</div>}
  </Card>;
}

// ── THE BOARD PACK ─────────────────────────────────────────────────────────
export function BoardPackPanel({ onNavigate, onOpenSettings }) {
  const [frequency, setFrequency] = useState("quarterly");
  const [dashboardId, setDashboardId] = useState("");
  const [dashboards, setDashboards] = useState([]);
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sch, setSch] = useState(null);
  const [day, setDay] = useState(5);
  const [enabled, setEnabled] = useState(false);
  const [schFreq, setSchFreq] = useState("quarterly");
  const [schDash, setSchDash] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { apiFetch("/saved-dashboards").then(r => setDashboards(r.dashboards || [])).catch(() => {}); }, []);
  const loadSchedule = () => apiFetch("/board-pack/schedule").then(r => {
    setSch(r);
    if (r.schedule) {
      setSchFreq(r.schedule.frequency); setDay(r.schedule.dayOfMonth);
      setEnabled(!!r.schedule.enabled); setSchDash(r.schedule.dashboardId || "");
    }
  }).catch(() => {});
  useEffect(() => { loadSchedule(); }, []);
  useEffect(() => {
    let dead = false;
    setLoading(true);
    const q = new URLSearchParams({ frequency });
    if (dashboardId) q.set("dashboard", dashboardId);
    apiFetch(`/board-pack?${q}`).then(d => { if (!dead) { setPack(d); setLoading(false); } })
      .catch(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [frequency, dashboardId]);

  async function pdf() {
    setBusy(true);
    try {
      const q = new URLSearchParams({ frequency });
      if (dashboardId) q.set("dashboard", dashboardId);
      await download(`/board-pack/pdf?${q}`, `${(pack && pack.title) || "board-pack"}.pdf`);
    } catch (e) { alert(errorMessage(e, "The PDF would not download.")); }
    setBusy(false);
  }
  async function saveSchedule(next) {
    setErr(""); setMsg("");
    try {
      await apiFetch("/board-pack/schedule", { method: "PUT", body: JSON.stringify({
        frequency: schFreq, dayOfMonth: Number(day), enabled: next === undefined ? enabled : next,
        dashboardId: schDash || null }) });
      if (next !== undefined) setEnabled(next);
      await loadSchedule();
      setMsg("Saved.");
    } catch (e) { setErr(errorMessage(e, "The schedule would not save.")); }
  }
  async function sendTest() {
    setErr(""); setMsg("");
    try {
      const r = await apiFetch("/board-pack/schedule/test", { method: "POST", body: "{}" });
      // FIX-15 Part 3 — what the provider actually said, never an optimistic
      // "sent" the person cannot check.
      setMsg(r.sent ? `Sent to ${r.to}.` : "Steward could not send it just now. Nothing went out.");
    } catch (e) { setErr(errorMessage(e, "The test would not send.")); }
  }

  const recipients = (sch && sch.recipients) || [];
  return <div><style>{SD_CSS}</style>
    <Card style={{ padding: "20px 24px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>Board pack</div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2, lineHeight: 1.6 }}>
            The same numbers your board asks for, as a PDF, with every one of them defined on the last page.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select aria-label="Period" value={frequency} onChange={e => setFrequency(e.target.value)} style={fieldStyle}>
            <option value="quarterly">Last full quarter</option>
            <option value="monthly">Last full month</option>
          </select>
          <select aria-label="Built from" value={dashboardId} onChange={e => setDashboardId(e.target.value)} style={fieldStyle}>
            <option value="">The default board pack</option>
            {dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button type="button" style={btn(true)} onClick={pdf} disabled={busy || loading}>{busy ? "Building…" : "Download PDF"}</button>
        </div>
      </div>
      {loading && <div style={{ padding: 24 }}><Spin /></div>}
      {!loading && pack && <>
        <div style={{ fontSize: 12.5, color: T.ink3, margin: "14px 0 10px" }}>
          {pack.period.label} · produced {pack.producedOnLabel}. Every number opens: click it to see the rows behind it.
        </div>
        <TileGrid sections={pack.sections} onNavigate={onNavigate} />
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.bg2}` }}>
          <Eyebrow>What each number means</Eyebrow>
          {pack.definitions.map((d, i) => <div key={i} style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, marginBottom: 7 }}>
            <strong style={{ color: T.ink }}>{d.label}.</strong> {d.definition}
          </div>)}
        </div>
      </>}
    </Card>

    <Card style={{ padding: "20px 24px" }}>
      <Eyebrow>On a schedule</Eyebrow>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.6, marginBottom: 14 }}>
        Steward emails the pack to your own staff and board addresses on the day you pick. It never goes to a donor.
        {!enabled && sch && <> {sch.offSentence}</>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select aria-label="How often" value={schFreq} onChange={e => setSchFreq(e.target.value)} style={fieldStyle}>
          <option value="monthly">Every month</option>
          <option value="quarterly">Every quarter</option>
        </select>
        <label style={{ fontSize: 12.5, color: T.ink2 }}>on day</label>
        <input type="number" min="1" max="28" aria-label="Day of the month" value={day}
          onChange={e => setDay(e.target.value)} style={{ ...fieldStyle, width: 78 }} />
        <select aria-label="Which pack" value={schDash} onChange={e => setSchDash(e.target.value)} style={fieldStyle}>
          <option value="">The default board pack</option>
          {dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" style={quiet} onClick={() => saveSchedule()}>Save</button>
        <button type="button" style={enabled ? quiet : btn(true)} onClick={() => saveSchedule(!enabled)}>
          {enabled ? "Turn the schedule off" : "Turn the schedule on"}
        </button>
        <button type="button" style={quiet} onClick={sendTest}>Send a test to me</button>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.7 }}>
        {recipients.length
          ? <>It goes to {recipients.join(", ")}.{" "}</>
          : <>Nobody is listed yet.{" "}</>}
        <button type="button" onClick={onOpenSettings}
          style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700,
                   cursor: "pointer", textDecoration: "underline" }}>
          {recipients.length ? "Change who gets it" : "Add the staff and board addresses"}
        </button>
      </div>
      {sch && sch.sends && sch.sends.length > 0 && <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.bg2}` }}>
        <Eyebrow>Already sent</Eyebrow>
        {sch.sends.map((s, i) => <div key={i} style={{ fontSize: 12.5, color: T.ink2, padding: "4px 0" }}>
          {s.periodLabel || s.periodKey} · {s.recipients} {s.recipients === 1 ? "recipient" : "recipients"}
        </div>)}
      </div>}
      {msg && <div style={{ fontSize: 12.5, color: T.greenDk, marginTop: 10, fontWeight: 700 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12.5, color: T.terracotta, marginTop: 10 }}>{err}</div>}
    </Card>
  </div>;
}
