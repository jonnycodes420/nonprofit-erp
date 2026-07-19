import { useState, useEffect, useMemo } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, fmtFull, Spin, Card, EmptyState, PageTitle, SectionTabs, StartHere, LockedFeature } from "./shared";

// ── Reports (BUILD-02) ──────────────────────────────────────────────────────
// Six fixed, parameterized, table-first, CSV-downloadable reports — each one
// an answer to a question a development director or board member actually
// asks. Deliberately NOT an Analytics revival: no chart dashboard, no custom
// report builder. All aggregation happens server-side (GET /reports/:key).

// BUILD-12: the per-report `q` ("question this answers") strings were removed —
// they rendered as a decorative grey subtitle line that Part 1 cut as clutter.
const REPORT_DEFS = [
  { key: "giving-summary", label: "Giving Summary" },
  { key: "by-group", label: "Gifts by Fund" },
  { key: "lybunt", label: "LYBUNT" },
  { key: "sybunt", label: "SYBUNT" },
  { key: "retention", label: "Retention" },
  { key: "top-donors", label: "Top Donors" },
  // BUILD-17 — the development reporting cadence.
  { key: "week-in-review", label: "Week in Review" },
  { key: "three-year", label: "3-Year Comparison" },
  { key: "annual", label: "Annual Report" },
  { key: "solicitations", label: "Solicitations", team: true },
];

// Which reports take which controls
const PERIOD_REPORTS = ["giving-summary", "by-group", "top-donors"];
const YEAR_REPORTS = ["lybunt", "sybunt"];
// Reports that take a year dropdown + fiscal/calendar toggle (BUILD-17 added
// three-year/annual to the year-selecting family).
const YEAR_SELECT_REPORTS = ["lybunt", "sybunt", "three-year", "annual"];
const YEARMODE_TOGGLE_REPORTS = ["lybunt", "sybunt", "retention", "three-year", "annual", "solicitations"];
const DIGEST_REPORTS = ["week-in-review"]; // fetched from /digests/preview, not /reports/:key

const now = new Date();
const CUR_FY = now.getMonth() < 6 ? now.getFullYear() : now.getFullYear() + 1; // FY label = its June-30 end year
const CUR_CY = now.getFullYear();

const PRESETS = [
  { id: "thisFY", label: "This FY", year: CUR_FY, yearMode: "fiscal" },
  { id: "lastFY", label: "Last FY", year: CUR_FY - 1, yearMode: "fiscal" },
  { id: "thisCY", label: "This CY", year: CUR_CY, yearMode: "calendar" },
  { id: "lastCY", label: "Last CY", year: CUR_CY - 1, yearMode: "calendar" },
  { id: "custom", label: "Custom" },
];

const fyRangeLabel = y => `Jul ${y - 1} – Jun ${y}`;
const monthLabel = m => new Date(m + "-15T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
const fmtDate = d => d ? new Date(d.length > 10 ? d : d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const pctStr = v => v === null || v === undefined ? "—" : `${v}%`;

// ── Sortable table ──────────────────────────────────────────────────────────
// Plain, dense, client-side sortable. cols: {key,label,align,render,sortVal}.
function ReportTable({ cols, rows, onRowClick, accentRow }) {
  const [sort, setSort] = useState(null); // {key,dir}
  useEffect(() => { setSort(null); }, [cols.map(c => c.key).join(","), rows]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols.find(c => c.key === sort.key);
    const val = r => (col.sortVal ? col.sortVal(r) : r[sort.key]);
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, cols]);

  return <div className="reports-table-wrap" style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          {cols.map(c => <th key={c.key}
            onClick={() => setSort(s => s?.key === c.key ? (s.dir === "desc" ? { key: c.key, dir: "asc" } : null) : { key: c.key, dir: "desc" })}
            style={{ textAlign: c.align || "left", padding: "8px 10px", borderBottom: `2px solid ${T.bg3}`, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
            {c.label}{sort?.key === c.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
          </th>)}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => <tr key={r.id || i} onClick={onRowClick ? () => onRowClick(r) : undefined}
          className={onRowClick ? "rpt-row-click" : undefined}
          style={{ cursor: onRowClick ? "pointer" : "default", borderLeft: accentRow ? `3px solid ${T.terracotta}` : "3px solid transparent" }}>
          {cols.map(c => <td key={c.key} style={{ padding: "9px 10px", borderBottom: `1px solid ${T.bg2}`, textAlign: c.align || "left", whiteSpace: "nowrap", color: T.ink2 }}>
            {c.render ? c.render(r) : r[c.key]}
          </td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

// Free visual: % share as a thin gold bar (five-color palette — gold =
// positive/primary emphasis).
function PctBar({ pct }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
    <div style={{ flex: 1, height: 6, background: T.bg2, borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: T.gold, borderRadius: 99 }} />
    </div>
    <span style={{ fontSize: 12, color: T.ink3, minWidth: 42, textAlign: "right" }}>{pct}%</span>
  </div>;
}

export function Reports({ onNavigate }) {
  const [active, setActive] = useState("giving-summary");
  const [yearMode, setYearModeState] = useState(() => localStorage.getItem("steward_reports_yearmode") || "fiscal");
  const [preset, setPreset] = useState(null); // null → default per yearMode
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [year, setYear] = useState(null); // LYBUNT/SYBUNT; null → current per yearMode
  const [groupBy, setGroupBy] = useState("funds");
  const [scope, setScope] = useState("period");
  const [fundId, setFundId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [funds, setFunds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [planLocked, setPlanLocked] = useState(false); // 403 plan_required → upgrade card
  const [digestType, setDigestType] = useState("weekly"); // week-in-review: weekly | monthly
  const [downloading, setDownloading] = useState(false);

  // The default period resolves from data, not the calendar: early in a new
  // fiscal year "This FY" is nearly empty (e.g. two weeks in), which makes a
  // terrible first impression — so until the current year has real volume
  // (≥10 gifts, or ≥1% of the prior year's dollars), default to Last FY/CY.
  // The user picking any chip overrides this permanently for the session.
  const [autoDefault, setAutoDefault] = useState(null); // null = still resolving

  const setYearMode = v => { localStorage.setItem("steward_reports_yearmode", v); setYearModeState(v); setYear(null); };

  const effPreset = preset || autoDefault;
  const effYear = year || (yearMode === "fiscal" ? CUR_FY : CUR_CY);
  const isPeriodReport = PERIOD_REPORTS.includes(active) && !(active === "top-donors" && scope === "lifetime");
  const showFilters = PERIOD_REPORTS.includes(active) && !(active === "top-donors" && scope === "lifetime");
  const presetPending = isPeriodReport && !effPreset;

  useEffect(() => {
    apiFetch("/finance/funds").then(setFunds).catch(() => {});
    apiFetch("/campaigns").then(setCampaigns).catch(() => {});
    const fiscal = yearMode === "fiscal";
    const thisId = fiscal ? "thisFY" : "thisCY", lastId = fiscal ? "lastFY" : "lastCY";
    apiFetch(`/reports/giving-summary?year=${fiscal ? CUR_FY : CUR_CY}&yearMode=${yearMode}`)
      .then(d => {
        const lowVolume = d.prior.total > 0 && d.giftCount < 10 && d.total < d.prior.total * 0.01;
        setAutoDefault(lowVolume ? lastId : thisId);
      })
      .catch(() => setAutoDefault(thisId));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only; yearMode toggles don't re-resolve the default

  function buildParams() {
    const q = new URLSearchParams();
    if (DIGEST_REPORTS.includes(active)) { q.set("type", digestType); return q; }
    if (active === "solicitations") { q.set("yearMode", yearMode); return q; }
    if (active === "retention") { q.set("yearMode", yearMode); return q; }
    if (YEAR_SELECT_REPORTS.includes(active)) { q.set("year", effYear); q.set("yearMode", yearMode); return q; }
    if (active === "top-donors" && scope === "lifetime") { q.set("scope", "lifetime"); q.set("limit", 50); return q; }
    // Period reports: preset chips encode year+mode; custom sends from/to
    const pr = PRESETS.find(x => x.id === effPreset);
    if (effPreset === "custom") { q.set("from", customFrom); q.set("to", customTo); }
    else { q.set("year", pr.year); q.set("yearMode", pr.yearMode); }
    if (active === "by-group") q.set("groupBy", groupBy);
    if (active === "top-donors") { q.set("scope", "period"); q.set("limit", 50); }
    if (showFilters && fundId) q.set("fundId", fundId);
    if (showFilters && campaignId) q.set("campaignId", campaignId);
    return q;
  }

  const paramsStr = presetPending ? "" : buildParams().toString();
  const customIncomplete = isPeriodReport && effPreset === "custom" && (!customFrom || !customTo);

  useEffect(() => {
    if (customIncomplete || presetPending) return;
    let dead = false;
    setLoading(true); setErr(""); setPlanLocked(false);
    const url = DIGEST_REPORTS.includes(active) ? `/digests/preview?${paramsStr}` : `/reports/${active}?${paramsStr}`;
    apiFetch(url)
      // Tag the payload with the report key it belongs to — between
      // switching reports and the effect firing there's one render where
      // `data` still holds the previous report's shape.
      .then(d => { if (!dead) { setData({ key: active, d }); setPlanLocked(!!d?.locked); setLoading(false); } })
      .catch(e => { if (!dead) { if (e.error === "plan_required" || e.status === 403) setPlanLocked(true); setErr(e.message); setLoading(false); } });
    return () => { dead = true; };
  }, [active, paramsStr, customIncomplete, presetPending]);

  async function downloadCsv() {
    setDownloading(true);
    try {
      const r = await fetch(`${API}/reports/${active}?${paramsStr}&format=csv`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Download failed"); }
      const blob = await r.blob();
      // Content-Disposition isn't CORS-exposed cross-origin, so build the
      // filename client-side (mirrors the server's naming).
      const suffix = active === "retention" ? yearMode
        : active === "top-donors" && scope === "lifetime" ? "lifetime"
        : YEAR_SELECT_REPORTS.includes(active) ? `${yearMode === "fiscal" ? "fy" : "cy"}${effYear}`
        : active === "solicitations" ? yearMode
        : effPreset === "custom" ? `${customFrom}_${customTo}`
        : effPreset ? effPreset.toLowerCase() : "report";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${active}-${suffix}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message || "Download failed"); }
    setDownloading(false);
  }

  const openDonor = r => onNavigate && onNavigate("donors", { selectDonorId: r.id });

  // ── Controls ──────────────────────────────────────────────────────────────
  const chipStyle = on => ({ background: on ? T.greenDk : T.white, color: on ? "#fff" : T.ink2, border: `1.5px solid ${on ? T.greenDk : T.bg3}`, borderRadius: 99, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" });
  const selStyle = { padding: "7px 10px", borderRadius: 8, fontSize: 12, fontFamily: "'DM Sans',sans-serif", maxWidth: 180 };

  const yearModeToggle = <div style={{ display: "flex", border: `1.5px solid ${T.bg3}`, borderRadius: 99, overflow: "hidden" }}>
    {["fiscal", "calendar"].map(m => <button key={m} onClick={() => setYearMode(m)}
      style={{ background: yearMode === m ? T.greenDk : T.white, color: yearMode === m ? "#fff" : T.ink3, border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
      {m === "fiscal" ? "Fiscal (Jul–Jun)" : "Calendar"}
    </button>)}
  </div>;

  const yearOptions = Array.from({ length: 6 }, (_, i) => (yearMode === "fiscal" ? CUR_FY : CUR_CY) - i);

  // ── Narrative + table per report ──────────────────────────────────────────
  let narrative = null, table = null, empty = false;
  const d = data && data.key === active ? data.d : null;

  if (!loading && !err && d) {
    if (active === "giving-summary") {
      empty = d.giftCount === 0;
      const diff = d.total - d.prior.total;
      narrative = <>You've raised <strong>{fmtFull(d.total)}</strong> from <strong>{d.giftCount} gift{d.giftCount === 1 ? "" : "s"}</strong> this period
        {d.prior.total > 0 && <> — {diff >= 0 ? "up" : "down"} from {fmtFull(d.prior.total)} the prior period</>}.
        {" "}<strong>{d.uniqueDonors}</strong> donor{d.uniqueDonors === 1 ? "" : "s"} gave ({d.newDonors} new, {d.returningDonors} returning); the median gift was <strong>{fmtFull(d.medianGift)}</strong>.</>;
      table = <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
          {[["Total raised", fmtFull(d.total)], ["Gifts", d.giftCount], ["Unique donors", d.uniqueDonors],
            ["Average gift", fmtFull(Math.round(d.avgGift))], ["Median gift", fmtFull(d.medianGift)],
            ["New donors", d.newDonors], ["Returning donors", d.returningDonors],
            ["Online", `${fmtFull(d.onlineTotal)} (${d.onlineCount})`], ["Offline", `${fmtFull(d.offlineTotal)} (${d.offlineCount})`],
          ].map(([l, v]) => <div key={l} style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, marginTop: 2 }}>{v}</div>
          </div>)}
        </div>
        <ReportTable cols={[
          { key: "month", label: "Month", render: r => monthLabel(r.month) },
          { key: "gifts", label: "Gifts", align: "right" },
          { key: "total", label: "Total", align: "right", render: r => fmtFull(r.total) },
          { key: "donors", label: "Unique donors", align: "right" },
        ]} rows={d.monthly} />
      </>;
    } else if (active === "by-group") {
      empty = d.rows.length === 0;
      const top = d.rows[0];
      narrative = top && <>Your largest {groupBy === "funds" ? "fund" : groupBy === "campaigns" ? "campaign" : "giving page"} this period is <strong>{top.name}</strong> at <strong>{fmtFull(top.total)}</strong> — {top.pct}% of the {fmtFull(d.grandTotal)} raised.</>;
      table = <ReportTable cols={[
        { key: "name", label: groupBy === "funds" ? "Fund" : groupBy === "campaigns" ? "Campaign" : "Giving page" },
        { key: "total", label: "Total", align: "right", render: r => fmtFull(r.total) },
        { key: "giftCount", label: "Gifts", align: "right" },
        { key: "uniqueDonors", label: "Unique donors", align: "right" },
        { key: "pct", label: "% of total", render: r => <PctBar pct={r.pct} /> },
      ]} rows={d.rows} />;
    } else if (active === "lybunt" || active === "sybunt") {
      empty = d.rows.length === 0;
      const atStake = d.rows.reduce((s, r) => s + r.priorYearTotal, 0);
      const yl = yearMode === "fiscal" ? `FY${d.year}` : d.year;
      const priorLabel = yearMode === "fiscal" ? `FY${d.year - 1}` : String(d.year - 1);
      const havent = d.rows.length === 1 ? "hasn't" : "haven't";
      narrative = <><strong>{d.rows.length} donor{d.rows.length === 1 ? "" : "s"}</strong> {active === "lybunt" ? `gave in ${priorLabel} but ${havent} yet given in ${yl}` : `${d.rows.length === 1 ? "has" : "have"} given before, but not in ${yl}`}
        {active === "lybunt" && atStake > 0 && <> — <strong>{fmtFull(atStake)}</strong> of last year's giving is at stake</>}. This is a call list, not a chart.</>;
      table = <ReportTable accentRow onRowClick={openDonor} cols={[
        { key: "name", label: "Donor", render: r => <span style={{ fontWeight: 700, color: T.ink }}>{r.name}</span> },
        { key: "priorYearTotal", label: active === "lybunt" ? `Gave ${yearMode === "fiscal" ? "FY" + (d.year - 1) : d.year - 1}` : "Gave prior year", align: "right", render: r => r.priorYearTotal > 0 ? fmtFull(r.priorYearTotal) : "—" },
        { key: "lastGiftDate", label: "Last gift", render: r => `${fmtDate(r.lastGiftDate)}${r.lastGiftAmount ? ` · ${fmtFull(r.lastGiftAmount)}` : ""}` },
        { key: "lifetimeGiving", label: "Lifetime", align: "right", render: r => fmtFull(r.lifetimeGiving) },
        { key: "assignedTo", label: "Assigned to", render: r => r.assignedTo || "—" },
        { key: "email", label: "Email", render: r => r.email || "—" },
      ]} rows={d.rows} />;
    } else if (active === "retention") {
      empty = d.rows.every(r => r.priorDonors === 0);
      const latest = [...d.rows].reverse().find(r => r.retentionRate !== null);
      narrative = latest
        ? <>In <strong>{latest.label}</strong> you retained <strong>{latest.retentionRate}%</strong> of the prior year's donors ({latest.retainedDonors} of {latest.priorDonors}) and <strong>{pctStr(latest.dollarRetentionRate)}</strong> of their dollars.{latest.firstYearRetentionRate !== null && <> First-year donors came back at <strong>{latest.firstYearRetentionRate}%</strong> — that number is what stewardship moves.</>}</>
        : <>Not enough multi-year giving history yet to compute retention.</>;
      table = <ReportTable cols={[
        { key: "label", label: "Year" },
        { key: "priorDonors", label: "Prior-yr donors", align: "right" },
        { key: "retainedDonors", label: "Retained", align: "right" },
        { key: "retentionRate", label: "Retention", align: "right", render: r => <strong style={{ color: T.ink }}>{pctStr(r.retentionRate)}</strong> },
        { key: "dollarRetentionRate", label: "$ retained", align: "right", render: r => `${pctStr(r.dollarRetentionRate)}${r.priorDollars > 0 ? ` of ${fmtFull(r.priorDollars)}` : ""}` },
        { key: "firstYearDonors", label: "First-yr donors", align: "right" },
        { key: "firstYearRetentionRate", label: "First-yr retention", align: "right", render: r => <strong style={{ color: r.firstYearRetentionRate !== null && r.firstYearRetentionRate < 30 ? T.terracotta : T.ink }}>{pctStr(r.firstYearRetentionRate)}</strong> },
      ]} rows={d.rows} />;
    } else if (active === "top-donors") {
      empty = d.rows.length === 0;
      const sum = d.rows.reduce((s, r) => s + r.total, 0);
      narrative = d.rows.length > 0 && <>Your top <strong>{d.rows.length}</strong> donors {scope === "lifetime" ? "have given" : "gave"} <strong>{fmtFull(sum)}</strong>{scope === "lifetime" ? " all-time" : " this period"}.</>;
      table = <ReportTable onRowClick={openDonor} cols={[
        { key: "rank", label: "#", align: "right" },
        { key: "name", label: "Donor", render: r => <span style={{ fontWeight: 700, color: T.ink }}>{r.name}</span> },
        { key: "total", label: scope === "lifetime" ? "Lifetime giving" : "Total this period", align: "right", render: r => fmtFull(r.total) },
        { key: "giftCount", label: "Gifts", align: "right" },
        { key: "lastGiftDate", label: "Last gift", render: r => fmtDate(r.lastGiftDate) },
      ]} rows={d.rows} />;
    } else if (active === "three-year") {
      empty = d.years.every(y => y.total === 0);
      const g = d.orgGrowthPct;
      narrative = <>Across the last three years your giving went {d.years.map((y, i) => <span key={y.year}>{i ? " → " : ""}<strong>{fmtFull(y.total)}</strong> ({y.label})</span>)}
        {g !== null && <> — {g >= 0 ? "up" : "down"} <strong>{Math.abs(g)}%</strong> year over year</>}. Each row compares a donor across the three years.</>;
      const chg = r => r.changePct === null ? <span style={{ color: T.gold600 || "#a97f22", fontWeight: 700 }}>new</span>
        : <span style={{ color: r.changePct > 0 ? T.greenDk : r.changePct < 0 ? T.terracotta : T.ink3, fontWeight: 700 }}>{r.changePct > 0 ? "+" : ""}{r.changePct}%</span>;
      table = <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          {d.years.map(y => <div key={y.year} style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>{y.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, marginTop: 2 }}>{fmtFull(y.total)}</div>
            <div style={{ fontSize: 11, color: T.ink3 }}>{y.donors} donor{y.donors === 1 ? "" : "s"}</div>
          </div>)}
        </div>
        <ReportTable onRowClick={openDonor} cols={[
          { key: "name", label: "Donor", render: r => <span style={{ fontWeight: 700, color: T.ink }}>{r.name}</span> },
          { key: "y2", label: d.labels.y2, align: "right", render: r => fmtFull(r.y2) },
          { key: "y1", label: d.labels.y1, align: "right", render: r => fmtFull(r.y1) },
          { key: "y0", label: d.labels.y0, align: "right", render: r => <strong style={{ color: T.ink }}>{fmtFull(r.y0)}</strong> },
          { key: "changePct", label: "YoY change", align: "right", render: chg, sortVal: r => r.changePct ?? Infinity },
          { key: "assignedTo", label: "Assigned to", render: r => r.assignedTo || "—" },
        ]} rows={d.rows} />
      </>;
    } else if (active === "annual") {
      empty = d.giftCount === 0;
      narrative = <>In <strong>{d.label}</strong> you raised <strong>{fmtFull(d.total)}</strong> from <strong>{d.uniqueDonors}</strong> donor{d.uniqueDonors === 1 ? "" : "s"}
        {d.growthPct !== null && <> — {d.growthPct >= 0 ? "up" : "down"} {Math.abs(d.growthPct)}% from {d.priorLabel}</>}.
        {" "}{d.newDonors} new, {d.returningDonors} returning{d.retentionRate !== null && <>; you kept <strong>{d.retentionRate}%</strong> of {d.priorLabel}'s donors</>}.</>;
      table = <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
          {[["Total raised", fmtFull(d.total)], ["Gifts", d.giftCount], ["Unique donors", d.uniqueDonors], ["Average gift", fmtFull(Math.round(d.avgGift))],
            ["Growth vs prior", d.growthPct === null ? "—" : `${d.growthPct >= 0 ? "+" : ""}${d.growthPct}%`], ["New donors", d.newDonors],
            ["Returning donors", d.returningDonors], ["Donor retention", d.retentionRate === null ? "—" : `${d.retentionRate}%`],
          ].map(([l, v]) => <div key={l} style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, marginTop: 2 }}>{v}</div>
          </div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18 }}>
          <div><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.greenDk, marginBottom: 8 }}>By fund</div>
            <ReportTable cols={[{ key: "name", label: "Fund" }, { key: "total", label: "Total", align: "right", render: r => fmtFull(r.total) }, { key: "pct", label: "% ", render: r => <PctBar pct={r.pct} /> }]} rows={d.byFund} /></div>
          <div><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.greenDk, marginBottom: 8 }}>By campaign</div>
            <ReportTable cols={[{ key: "name", label: "Campaign" }, { key: "total", label: "Total", align: "right", render: r => fmtFull(r.total) }, { key: "pct", label: "% ", render: r => <PctBar pct={r.pct} /> }]} rows={d.byCampaign} /></div>
        </div>
      </>;
    } else if (active === "solicitations") {
      empty = d.forecast.open === 0 && d.byOfficer.every(o => o.asksMade === 0 && o.giftsClosed === 0);
      narrative = <>You have <strong>{fmtFull(d.forecast.open)}</strong> in open asks; the stage-weighted forecast is <strong>{fmtFull(d.forecast.weighted)}</strong>. Below: asks by stage, activity by officer, and the prospects that have stalled longest.</>;
      const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
      table = <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 18 }}>
          {[["Open asks", fmtFull(d.forecast.open)], ["Stage-weighted forecast", fmtFull(d.forecast.weighted)]].map(([l, v]) =>
            <div key={l} style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.greenDk, marginTop: 2 }}>{v}</div>
            </div>)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.greenDk, marginBottom: 8 }}>Open asks by stage</div>
        <ReportTable cols={[
          { key: "stage", label: "Stage", render: r => cap(r.stage) },
          { key: "count", label: "Open asks", align: "right" },
          { key: "ask", label: "Ask total", align: "right", render: r => fmtFull(r.ask) },
          { key: "weight", label: "Close prob.", align: "right", render: r => `${Math.round(r.weight * 100)}%` },
          { key: "weighted", label: "Weighted", align: "right", render: r => fmtFull(r.weighted) },
        ]} rows={d.byStage} />
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.greenDk, margin: "22px 0 8px" }}>Asks vs. closes by officer</div>
        <ReportTable cols={[
          { key: "name", label: "Officer", render: r => <span style={{ fontWeight: 700, color: T.ink }}>{r.name}</span> },
          { key: "openAsks", label: "Open", align: "right", render: r => `${r.openAsks} · ${fmtFull(r.openAskAmount)}` },
          { key: "asksMade", label: "Made", align: "right", render: r => `${r.asksMade} · ${fmtFull(r.asksMadeAmount)}` },
          { key: "giftsClosed", label: "Closed", align: "right", render: r => `${r.giftsClosed} · ${fmtFull(r.giftsClosedAmount)}` },
          { key: "winRate", label: "Close rate", align: "right", render: r => r.winRate === null ? "—" : `${r.winRate}%` },
        ]} rows={d.byOfficer} />
        {d.aging.length > 0 && <>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.terracotta, margin: "22px 0 8px" }}>Aging prospects</div>
          <ReportTable accentRow onRowClick={openDonor} cols={[
            { key: "name", label: "Prospect", render: r => <span style={{ fontWeight: 700, color: T.ink }}>{r.name}</span> },
            { key: "stage", label: "Stage", render: r => cap(r.stage) },
            { key: "ask", label: "Ask", align: "right", render: r => fmtFull(r.ask) },
            { key: "stageAge", label: "Days in stage", align: "right", render: r => <strong style={{ color: r.stageAge > 60 ? T.terracotta : T.ink }}>{r.stageAge}</strong> },
            { key: "assignedTo", label: "Officer", render: r => r.assignedTo || "—" },
          ]} rows={d.aging} />
        </>}
      </>;
    } else if (active === "week-in-review") {
      if (d.type === "monthly") {
        const r = d.report;
        empty = false;
        narrative = <>Your month at a glance — <strong>{r.officerName}</strong>, {d.window.start} to {d.window.end}.</>;
        table = <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          {[["Asks made", `${r.asksMade} · ${fmtFull(r.asksMadeAmount)}`], ["Moves made", r.movesMade],
            ["Gifts closed", `${r.giftsClosed} · ${fmtFull(r.giftsClosedAmount)}`], ["Portfolio", `${r.portfolioCount} · ${fmtFull(r.portfolioValue)}`]].map(([l, v]) =>
            <div key={l} style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, marginTop: 2 }}>{v}</div>
            </div>)}
        </div>;
      } else {
        const s = d.sections, tt = s.totals;
        empty = false;
        narrative = <><strong>{d.window.start}</strong> to <strong>{d.window.end}</strong>{d.scope === "officer" ? " · your portfolio" : ""} — <strong style={{ color: T.greenDk }}>{fmtFull(tt.giftTotal)}</strong> in {tt.giftCount} gift{tt.giftCount === 1 ? "" : "s"}, {tt.askCount} ask{tt.askCount === 1 ? "" : "s"}, {tt.moveCount} move{tt.moveCount === 1 ? "" : "s"}, <strong style={{ color: tt.pastDueCount ? T.terracotta : T.ink2 }}>{tt.pastDueCount} past-due task{tt.pastDueCount === 1 ? "" : "s"}</strong>.{d.teamRollup && <> Team-wide this week: {fmtFull(d.teamRollup.giftTotal)} across {d.teamRollup.giftCount} gifts.</>}</>;
        const Section = ({ title, items, empty: e, render }) => <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.greenDk, marginBottom: 8 }}>{title}</div>
          {items.length === 0 ? <div style={{ fontSize: 13, color: T.ink3 }}>{e}</div>
            : <div style={{ border: `1px solid ${T.bg3}`, borderRadius: 10, overflow: "hidden" }}>{items.map((it, i) => <div key={i} style={{ padding: "9px 14px", borderTop: i ? `1px solid ${T.bg2}` : "none", display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5, color: T.ink }}>{render(it)}</div>)}</div>}
        </div>;
        table = <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20 }}>
          <Section title="Gifts received" items={s.gifts} empty="No gifts this week." render={g => <><span>{g.donorName}</span><strong style={{ color: T.greenDk }}>{fmtFull(g.amount)}</strong></>} />
          <Section title="Asks / pledges made" items={s.asks} empty="No new asks this week." render={a => <><span>{a.donorName}{a.name ? ` — ${a.name}` : ""}</span><strong>{fmtFull(a.targetAmount)}</strong></>} />
          <Section title="Moves" items={s.moves} empty="No pipeline moves this week." render={m => <div style={{ width: "100%" }}><div style={{ fontWeight: 600 }}>{m.donorName} · {m.fromStage || "—"} → {m.toStage}</div><div style={{ fontSize: 12, color: T.ink3 }}>{m.description}</div></div>} />
          <Section title="Past-due tasks" items={s.pastDueTasks} empty="Nothing past due — nice." render={t => <><span>{t.title}{t.donorName ? ` · ${t.donorName}` : ""}</span><span style={{ color: T.terracotta, fontSize: 12, whiteSpace: "nowrap" }}>due {(t.due || "").slice(0, 10)}</span></>} />
        </div>;
      }
    }
  }

  const activeDef = REPORT_DEFS.find(r => r.key === active);

  return <div className="fade-in">
    <PageTitle main="Your" accent="Reports" />

    {/* First-visit signpost (BUILD-08 Phase D) — shown until "Got it". */}
    <div style={{ marginBottom: 14 }}>
      <StartHere dismissKey="reports_intro"
        line="If you only ever open one report, make it LYBUNT — the people who gave last year and haven't yet this year. It's where retention is won or lost, and every row clicks through to the donor."
        actionLabel="Open LYBUNT" onAction={() => setActive("lybunt")} />
    </div>

    <div className="reports-layout" style={{ display: "flex", flexDirection: "column" }}>
      {/* Report picker — horizontal tabs. (BUILD-12: the per-report grey
          "question this answers" subtitle was removed as decorative clutter.) */}
      <SectionTabs className="reports-tabbar"
        tabs={REPORT_DEFS.map(r => ({ id: r.key, label: r.label }))}
        active={active} onSelect={setActive} style={{ marginBottom: 14 }} />

      {/* Main */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Card style={{ padding: "18px 22px" }}>
          {/* Param bar */}
          <div className="reports-parambar" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
            {isPeriodReport && PRESETS.map(p => <button key={p.id} onClick={() => setPreset(p.id)} style={chipStyle(effPreset === p.id)}>{p.label}</button>)}
            {isPeriodReport && effPreset === "custom" && <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={selStyle} />
              <span style={{ color: T.ink3, fontSize: 12 }}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={selStyle} />
            </>}
            {YEARMODE_TOGGLE_REPORTS.includes(active) && yearModeToggle}
            {YEAR_SELECT_REPORTS.includes(active) && <select value={effYear} onChange={e => setYear(parseInt(e.target.value, 10))} style={{ ...selStyle, maxWidth: 230 }}>
              {yearOptions.map(y => <option key={y} value={y}>{yearMode === "fiscal" ? `FY${y} (${fyRangeLabel(y)})` : y}</option>)}
            </select>}
            {active === "week-in-review" && <div style={{ display: "flex", border: `1.5px solid ${T.bg3}`, borderRadius: 99, overflow: "hidden" }}>
              {["weekly", "monthly"].map(s => <button key={s} onClick={() => setDigestType(s)}
                style={{ background: digestType === s ? T.greenDk : T.white, color: digestType === s ? "#fff" : T.ink3, border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>{s}</button>)}
            </div>}
            {active === "by-group" && <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={selStyle}>
              <option value="funds">By fund</option>
              <option value="campaigns">By campaign</option>
              <option value="giving_pages">By giving page</option>
            </select>}
            {active === "top-donors" && <div style={{ display: "flex", border: `1.5px solid ${T.bg3}`, borderRadius: 99, overflow: "hidden" }}>
              {["period", "lifetime"].map(s => <button key={s} onClick={() => setScope(s)}
                style={{ background: scope === s ? T.greenDk : T.white, color: scope === s ? "#fff" : T.ink3, border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>{s}</button>)}
            </div>}
            {showFilters && funds.length > 0 && <select value={fundId} onChange={e => setFundId(e.target.value)} style={selStyle}>
              <option value="">All funds</option>
              {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>}
            {showFilters && campaigns.length > 0 && <select value={campaignId} onChange={e => setCampaignId(e.target.value)} style={selStyle}>
              <option value="">All campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>}
            <div style={{ flex: 1 }} />
            {!DIGEST_REPORTS.includes(active) && <button onClick={downloadCsv} disabled={downloading || loading || customIncomplete || planLocked}
              style={{ background: T.white, border: `1.5px solid ${T.greenDk}`, borderRadius: 10, padding: "7px 16px", color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: downloading ? "wait" : "pointer", whiteSpace: "nowrap", opacity: downloading || loading || planLocked ? 0.6 : 1 }}>
              {downloading ? "Downloading…" : "Download CSV"}
            </button>}
          </div>

          {DIGEST_REPORTS.includes(active) && !planLocked && <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 14, marginTop: -4 }}>
            {digestType === "weekly"
              ? "This is the Week in Review that's emailed to your whole team every Monday — the last completed week's gifts, asks, moves, and past-due tasks."
              : "This is your Monthly Report, emailed at the start of each month — your asks, moves, gifts closed, and portfolio."}
          </div>}

          {customIncomplete && <div style={{ fontSize: 13, color: T.ink3, padding: "24px 0", textAlign: "center" }}>Pick a start and end date to run this report.</div>}

          {!customIncomplete && loading && <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", padding: "48px 0", color: T.ink3, fontSize: 13 }}>
            <span style={{ display: "inline-block", width: 14, height: 14, border: `2px solid ${T.bg3}`, borderTopColor: T.greenDk, borderRadius: "50%", animation: "sp 0.7s linear infinite" }} />
            Running {activeDef.label}…
          </div>}

          {/* Team sub-tab on a Core org: the server returns the org's OWN data
              flagged locked, and we dim it behind the shared LockedFeature
              glass — a real preview, not a bare 403 card. Fallback (no data)
              still renders the locked overlay. */}
          {(() => {
            const lockMeta = active === "solicitations"
              ? { title: "Oversight for a staffed office", blurb: "Open asks by stage, a stage-weighted forecast, and asks-vs-closes by officer — this preview shows your own pipeline data. Unlock the Team plan to work it." }
              : { title: "Monthly per-officer reports", blurb: "Each officer's month — asks made, moves logged, and gifts closed. This preview shows your own numbers; the full per-officer roll-up is on the Team plan." };
            const errBlock = !planLocked && err && <div style={{ fontSize: 13, color: T.terracotta, padding: "24px 0", textAlign: "center" }}>{err}</div>;
            const body = !err && d && (empty
              ? <EmptyState icon="▤" title={active === "lybunt" || active === "sybunt" ? "No one — that's good news" : "No gifts in this period yet"}
                  message={active === "lybunt" ? "Every donor who gave last year has already given this year." : active === "sybunt" ? "Every past donor has given this year." : "Once gifts land in this period, this report fills in automatically."} />
              : d ? <>
                  {narrative && <div style={{ fontSize: 14, color: T.ink2, lineHeight: 1.7, marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${T.bg2}` }}>{narrative}</div>}
                  {table}
                </> : null);
            if (customIncomplete || loading) return null;
            if (planLocked) return (
              <LockedFeature minHeight={d ? 420 : 300} title={lockMeta.title} blurb={lockMeta.blurb} onCta={() => onNavigate && onNavigate("settings")}>
                {body}
              </LockedFeature>
            );
            return <>{errBlock}{body}</>;
          })()}
        </Card>
      </div>
    </div>
  </div>;
}
